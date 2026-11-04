// Branch-specific sequence exports: independent reachable paths, never BFS order as execution order.
function sequence(model,format='plantuml') {
 const d=model.dossier,f=d.code.flows.find(f=>f.id===model.flow?.id)||d.code.flows[0],nodes=new Map(d.code.nodes.map(n=>[n.id,n])),aliases=new Map();
 const quote=s=>JSON.stringify(String(s||'').replace(/[\r\n]/g,' ')),text=s=>String(s||'').replace(/[\r\n]/g,' ').replace(/[\x00-\x1f]/g,'');
 for(const id of f?.nodes||[])if(nodes.has(id))aliases.set(id,'p'+aliases.size);
 if(format==='mermaid') {
  const rows=['sequenceDiagram','    autonumber'];for(const[id,alias]of aliases)rows.push('    participant '+alias+' as '+text(nodes.get(id).name).replace(/[<>;]/g,''));
  for(const[pathIndex,path]of (f?.paths||[]).entries()){rows.push('    rect rgb(245,246,248)','    Note over '+aliases.get(path.nodes[0])+': Path '+(pathIndex+1)+' · '+text(path.proof.status)+' · not a runtime trace');for(const id of path.edges){const e=d.code.edges.find(e=>e.id===id);if(e&&aliases.has(e.from)&&aliases.has(e.to))rows.push('    '+aliases.get(e.from)+'->>'+aliases.get(e.to)+': '+text(e.label).replace(/[<>;]/g,''));}rows.push('    end');}return rows.join('\n');
 }
 const rows=['@startuml','hide footbox','autonumber','title '+text(d.service+' · '+(f?.title||'No established flow'))];
 for(const[id,alias]of aliases){const n=nodes.get(id),kind=n.kind==='topic'?'queue':['database','table'].includes(n.kind)?'database':'participant';rows.push(kind+' '+quote(n.name)+' as '+alias);}
 for(const [i,path]of (f?.paths||[]).entries()){
  rows.push('group Path '+(i+1)+' · '+text(path.proof.status)+' (independent branch)');
  for(const id of path.edges){const e=d.code.edges.find(e=>e.id===id);if(!e||!aliases.has(e.from)||!aliases.has(e.to))continue;rows.push(aliases.get(e.from)+' -> '+aliases.get(e.to)+' : '+text(e.label)+' ['+text(e.certainty)+']');}
  const query=d.semantic.queries.find(q=>q.path===path.id);rows.push('note over '+aliases.get(path.nodes[0])+': '+text(query?'Joern: '+(query.proof?.status||'unknown'):'Value flow unverified')+'; runtime unknown','end');
 }
 if(!f?.paths.length)rows.push('legend No entry-to-boundary paths were established. Inspect coverage gaps.');
 rows.push("' Each path follows indexed edges. Independent paths do not imply execution order.",'@enduml');return rows.join('\n');
}
module.exports={sequence};
