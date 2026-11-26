// A receipt for a tool result that a code cell forgot to print or return.
// This is evidence from the host call, never a claim about the cell's computation.
function receipt(tool, value) {
  const omitted = [];
  function preview(v, path = '$', depth = 0) {
    if (typeof v === 'string' && v.length > 500) { omitted.push(path); return v.slice(0, 500); }
    if (!v || typeof v !== 'object') return v;
    if (depth >= 7) { omitted.push(path); return Array.isArray(v) ? [] : {}; }
    if (Array.isArray(v)) {
      if (v.length > 5) omitted.push(path);
      return v.slice(0, 5).map((x, i) => preview(x, `${path}[${i}]`, depth + 1));
    }
    const entries = Object.entries(v);
    if (entries.length > 16) omitted.push(path);
    return Object.fromEntries(entries.slice(0, 16).map(([k, x]) => [k, preview(x, `${path}.${k}`, depth + 1)]));
  }
  let selected = preview(value);
  if (Buffer.byteLength(JSON.stringify(selected) || 'null') > 4096) {
    // Large schemas/graphs still have a raw read bridge; do not cut JSON text.
    selected = { keys: Object.keys(value || {}).slice(0, 30).map(k=>k.slice(0,100)) };
    // Keep the selected facts and evidence identities when graphs exceed the
    // receipt budget. A keys-only receipt forces another read before any fact.
    for(const key of ['evidenceType','state','job','mapView','traceView','analysisView'])if(typeof value?.[key]==='string'&&value[key].length<=500)selected[key]=value[key];
    if(value?.summary&&typeof value.summary==='object'&&!Array.isArray(value.summary)){
      selected.summary=Object.fromEntries(Object.entries(value.summary).slice(0,16).map(([k,v])=>[k,v===null||['boolean','number'].includes(typeof v)?v:typeof v==='string'?v.slice(0,256):{keys:Object.keys(v||{}).slice(0,8)}]));
      while(Buffer.byteLength(JSON.stringify(selected))>4096&&Object.keys(selected.summary).length)delete selected.summary[Object.keys(selected.summary).at(-1)];
    }
    while(Buffer.byteLength(JSON.stringify(selected))>4096&&selected.keys.length)selected.keys.pop();
    omitted.push('$');
  }
  const results=require('./results'),existing=typeof value?.view==='string'&&results.referenceId(value.view);
  const view = existing&&results.load(existing) ? value.view : results.saveTool(tool, JSON.stringify(value ?? null));
  return { tool, result: selected, output: { status: omitted.length ? 'part' : 'all', scope: 'tool-response', ...(omitted.length ? { omitted: [...new Set(omitted)].slice(0, 20) } : {}) }, view, read: { tool: 'result_read', arguments: { id: view.split('/').pop(), all: true } } };
}
module.exports = { receipt };
module.exports.discovery = (name, value) => {
  if (!value || typeof value !== 'object') return value;
  const direct = (target,args) => ({insideCodeCall:`tools.${target}`,...(args?{arguments:args}:{}),guidance:`Call await tools.${target}(args) directly inside code, using inputSchema. Do not wrap this in tool_execute.`});
  const action = next => next?.tool==='tool_execute'?direct(next.arguments?.name||next.name,next.arguments?.arguments):next?.tool==='tool_describe'?direct('tool_describe',next.arguments):next;
  if(name==='tool_describe'&&value.name)return {...value,next:direct(value.name)};
  if(name==='tool_search')return {...value,...(value.next?{next:action(value.next)}:{}),tools:value.tools?.map(t=>({...t,next:action(t.next)}))};
  return value;
};
module.exports.diagnostic = error => {
  if(/Cannot use import statement|require is not defined/.test(error||''))return {message:'tools is already supplied. Remove import/require; call tools.NAME(args) directly inside code. For discovery: return await tools.tool_search({query:"action words"});'};
  const reserved = /Identifier '([^']+)' has already been declared/.exec(error || '')?.[1];
  if (reserved) return {
    message:`${reserved} was declared twice or shadows a supplied helper. Use a different local variable name. Each code cell is fresh.`,
    ...(reserved==='tools'?{retry:{tool:'code',arguments:{code:'return await tools.list();'}}}:{}),
  };
};

module.exports.provenance = (returned, calls) => {
  const metadata=new Set(['tool_search','tool_describe','tool_profiles','which_analyses_exist']);
  const names=[...new Set(calls.filter(c=>c.ok&&!c.resultError).map(c=>c.tool==='tool_execute'?c.args?.name||c.tool:c.tool))];
  const provenance={kind:names.length?(names.every(n=>metadata.has(n))?'discovery':'tool-results'):'code-inputs',successfulTools:names};
  let value=returned;
  if(typeof value==='string'&&value.length<=65536)try{value=JSON.parse(value);}catch{}
  const missing=[];
  for(const object of [value,value?.summary])if(object&&typeof object==='object')for(const [field,kind]of [['mapView','map'],['traceView','trace']]){
    const url=object[field];if(typeof url!=='string')continue;
    const id=require('./results').referenceId(url),data=id&&require('./results').load(id)?.data;
    if(!(kind==='map'?data?.flowMap:data?.sides&&data?.operation==='trace'))missing.push(field);
  }
  return {provenance,...(missing.length?{evidenceCheck:{status:'unbacked-references',fields:[...new Set(missing)],meaning:'These returned map/trace references do not identify the corresponding retained evidence. A constructed value is not a source-query result.',retry:{tool:'code',arguments:{code:'return await tools.tool_describe({name:"what_happens_from"});'}}}}:{})};
};

module.exports.resolveName = (name, definitions) => {
  if(typeof name!=='string')return name;
  if(definitions.some(t=>t.name===name))return name;
  const key=s=>s.replace(/[_-]/g,'').toLowerCase();
  const matches=definitions.filter(t=>key(t.name)===key(name));
  return matches.length===1?matches[0].name:name;
};
