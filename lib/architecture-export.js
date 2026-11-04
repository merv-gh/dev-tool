const L = require('../web/architecture-layout');
const xml = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const clip = (s,n=36) => String(s||'').length>n?String(s).slice(0,n-1)+'…':String(s||'');
function svg(model) {
 const l=L.layout(model), out=[`<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}" role="img" aria-label="${xml(model.title)}"><title>${xml(model.title)} — ${xml(model.type)} — ${xml(model.env)}</title><desc>${xml(model.guidance)}</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="#737b86"/></marker></defs><rect width="100%" height="100%" fill="#fbfbfa"/><g font-family="system-ui,sans-serif"><text x="32" y="28" font-size="16" fill="#1d1d1b">${xml(model.title)} · ${xml(model.type)} · ${xml(model.env)}</text>`];
 for(const c of l.containers)out.push(`<g><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8" fill="#f2f1ee" stroke="#b9bec5" stroke-dasharray="5 4"/><text x="${c.x+12}" y="${c.y+21}" font-size="12" fill="#555">${xml(c.name)} · ${c.declared?'declared boundary':'prefix group'}</text></g>`);
 for(const e of l.edges){ const x=e.a.x+e.a.w/2,y=e.a.y+e.a.h/2,tx=e.b.x+e.b.w/2,ty=e.b.y+e.b.h/2;out.push(`<g><title>${xml([e.certainty,...e.evidence||[]].join('\n'))}</title><path d="M${x} ${y} L${tx} ${ty}" fill="none" stroke="#737b86" ${e.certainty==='declared'?'stroke-dasharray="5 4"':''} marker-end="url(#arrow)"/><text x="${(x+tx)/2}" y="${(y+ty)/2-6}" font-size="10" fill="#4e5661" stroke="#fbfbfa" stroke-width="3" paint-order="stroke">${xml(clip((e.order?e.order+'. ':'')+e.label,40))} [${xml(e.certainty)}]</text></g>`); }
 for(const n of l.nodes){const d=n.deployments?.[model.env],bad=d?.critical>0||n.status==='critical',fill=n.kind==='topic'?'#fff5e6':['database','table'].includes(n.kind)?'#f3edfc':bad?'#fcebea':'#edf3fc';out.push(`<g><title>${xml([n.name,n.description,...n.evidence||[]].join('\n'))}</title><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="${fill}" stroke="${bad?'#b84b45':'#a3b4cb'}"/><text x="${n.x+14}" y="${n.y+26}" font-size="13" font-weight="600" fill="#1d1d1b">${xml(clip(n.name,n.kind==='group'?34:28))}</text><text x="${n.x+14}" y="${n.y+46}" font-size="11" fill="#536071">${xml(n.kind==='group'?n.memberCount+' services · '+(d?.total??'?')+' replicas':n.kind+' · '+(n.technology||n.source||'declared'))}</text>${d?`<text x="${n.x+14}" y="${n.y+66}" font-size="11" fill="${bad?'#a3231a':'#3d6c47'}">${xml(model.env)} · ${d.passing??0} passing · ${d.critical??0} critical${d.stale?' · stale':''}</text>`:''}${n.kind==='group'?`<text x="${n.x+14}" y="${n.y+98}" font-size="10" fill="#6b6b66">${xml(n.grouping)}</text>`:''}</g>`); }
 out.push(`<text x="32" y="${l.height-18}" font-size="10" fill="#6b6b66">Solid: indexed/observed · Dashed: declared · Replica registration is not runtime traffic. Snapshot ${xml(model.at)}</text></g></svg>`);return out.join('');
}
function textExport(model,format){
 const aliases=new Map(model.nodes.map((n,i)=>[n.id,'n'+i])); const quoted=s=>JSON.stringify(String(s||'').replace(/[\r\n]/g,' '));
 if(format==='mermaid') {
  const rows=['flowchart LR'], emitted=new Set();
  for(const [i,g]of (model.groups||[]).entries()){const members=model.nodes.filter(n=>g.members.includes(n.id));if(!members.length)continue;rows.push(`  subgraph b${i}[${quoted(g.name+(g.declared?' · declared boundary':' · prefix navigation'))}]`);for(const n of members){rows.push(`    ${aliases.get(n.id)}[${quoted(n.name+' · '+n.kind)}]`);emitted.add(n.id);}rows.push('  end');}
  for(const n of model.nodes)if(!emitted.has(n.id))rows.push(`  ${aliases.get(n.id)}[${quoted(n.name+' · '+n.kind)}]`);
  rows.push(...model.relations.map(e=>`  ${aliases.get(e.from)} ${e.certainty==='declared'?'-.->':'-->'} |${quoted((e.order?e.order+'. ':'')+e.label+' ['+e.certainty+']')}| ${aliases.get(e.to)}`),'%% '+model.guidance,...model.relations.flatMap(e=>(e.evidence||[]).map(v=>'%% '+String(v).replace(/[\r\n]/g,' '))));return rows.join('\n');
 }
 // C4 standard library is an export dependency only; the application renders offline.
 const level={context:'Context',container:'Container',component:'Component'}[model.type];
 const rows=['@startuml',...(level?[`!include <C4/C4_${level}>`]:[]),`title ${String(model.title).replace(/[\r\n]/g,' ')} — ${model.env} (${model.type})`];
 const nodeLine=n=>{const alias=aliases.get(n.id);if(!level)return `rectangle ${quoted(n.name+' · '+n.kind)} as ${alias}`;const macro=n.kind==='person'?'Person':n.kind==='system'?'System':n.kind==='external'?'System_Ext':level==='Component'?'Component':'Container';return ['Person','System','System_Ext'].includes(macro)?`${macro}(${alias}, ${quoted(n.name)}, ${quoted(clip(n.description,160))})`:`${macro}(${alias}, ${quoted(n.name)}, ${quoted(n.technology||n.kind)}, ${quoted(clip(n.description,160))})`;};
 const emitted=new Set();
 if(level&&level!=='Context')for(const [i,g]of (model.groups||[]).entries())if(g.declared){const members=model.nodes.filter(n=>g.members.includes(n.id));if(!members.length)continue;rows.push(`${level==='Component'?'Container_Boundary':'System_Boundary'}(b${i}, ${quoted(g.name)}) {`);for(const n of members){rows.push('  '+nodeLine(n));emitted.add(n.id);}rows.push('}');}
 for(const n of model.nodes)if(!emitted.has(n.id))rows.push(nodeLine(n));
 for(const e of model.relations)rows.push(level?`Rel(${aliases.get(e.from)}, ${aliases.get(e.to)}, ${quoted((e.order?e.order+'. ':'')+e.label+' ['+e.certainty+']')})`:`${aliases.get(e.from)} ${e.certainty==='declared'?'..>':'-->'} ${aliases.get(e.to)} : ${String(e.label).replace(/[\r\n]/g,' ')} [${e.certainty}]`);
 rows.push("' "+model.guidance,'@enduml');return rows.join('\n');
}
function render(model,format='svg') {
 if(format==='svg')return {body:svg(model),type:'image/svg+xml',extension:'svg'};
 if(format==='json')return {body:JSON.stringify(model,null,2),type:'application/json',extension:'json'};
 if(['mermaid','plantuml'].includes(format))return {body:textExport(model,format),type:'text/plain; charset=utf-8',extension:format==='mermaid'?'mmd':'puml'};
 throw Object.assign(new Error('Unknown architecture export format'),{statusCode:400});
}
module.exports={render,svg};
