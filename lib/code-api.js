// Small, permission-filtered call shapes for code-exported capabilities.
// These are registry contracts, never fixture-specific recipes or source facts.
function type(s={},depth=0){
 if(depth>3)return 'unknown';
 if(s.enum?.length&&s.enum.length<=8)return s.enum.map(x=>JSON.stringify(x)).join('|');
 if(s.type==='array')return 'Array<'+type(s.items,depth+1)+'>';
 if(s.type==='object'&&s.properties)return '{'+Object.entries(s.properties).slice(0,16).map(([k,v])=>k+((s.required||[]).includes(k)?'':'?')+':'+type(v,depth+1)).join(', ')+'}';
 return s.type||'object';
}
function describe(tools,{maxBytes=4096}={}){
 const header='Enabled JavaScript API shapes (documentation only; do not paste type annotations):\n',rows=[];
 for(const t of tools.filter(t=>t.codeHint).sort((a,b)=>(a.name==='result_read')-(b.name==='result_read'))){
  const required=t.required||t.inputRules?.else?.required||[],fields=Object.entries({...t.input,all:{type:'boolean'}}).map(([k,v])=>k+(required.includes(k)?'':'?')+':'+type(v)).join(', ');
  const row='tools.'+t.name+'({'+fields+'}) — '+t.codeHint;
  if(Buffer.byteLength(header+rows.concat(row).join('\n')+'\n\n')>maxBytes)continue;
  rows.push(row);
 }
 return rows.length?header+rows.join('\n')+'\n\n':'';
}
module.exports={describe};
