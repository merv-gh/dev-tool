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
    const priority=['summary','mapView','traceView','sourceView','proof','sourceCoverage','output'];
    const entries = Object.entries(v).sort(([a],[b])=>(priority.includes(b)?1:0)-(priority.includes(a)?1:0));
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
      selected.summary=preview(value.summary,'$.summary',0);
      while(Buffer.byteLength(JSON.stringify(selected))>4096&&Object.keys(selected.summary).length)delete selected.summary[Object.keys(selected.summary).at(-1)];
    }
    while(Buffer.byteLength(JSON.stringify(selected))>4096&&selected.keys.length)selected.keys.pop();
    omitted.push('$');
  }
  const results=require('./results'),existing=typeof value?.view==='string'&&results.referenceId(value.view);
  const sourceView=existing&&results.load(existing)?value.view:undefined;
  let view,readScope='tool-response',retentionError;
  try{view=results.saveTool(tool,JSON.stringify(value??null));}
  catch(error){retentionError=String(error.message).slice(0,300);if(sourceView){view=sourceView;readScope='source-evidence';}}
  return { tool, result: selected,...(sourceView?{sourceView}:{}),readScope,...(retentionError?{retentionError}:{}), output: { status: omitted.length ? 'part' : 'all', scope: 'tool-response', ...(omitted.length ? { omitted: [...new Set(omitted)].slice(0, 20) } : {}) }, ...(view?{view,read:{tool:'result_read',arguments:{id:view.split('/').pop(),all:true}}}:{read:null}) };
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
module.exports.recovery = (recentResults=[], receipts=[]) => {
    for(let i=recentResults.length-1;i>=0;i--){
      const call=recentResults[i],value=call.value?.summary?call.value:call.tool==='result_read'&&call.value?.value?.summary?call.value.value:null,receipt=receipts[i];
      if(!value?.summary?.proofLimits||!receipt?.read||receipt.readScope!=='tool-response')continue;
      const path=call.value===value?'/summary':'/value/summary',args={...receipt.read.arguments,path};
      const map=value.mapView||value.summary.mapView,id=require('./results').referenceId(map);
      const graphRead=id?{tool:'result_read',arguments:{id,path:'/flowMap',all:true}}:undefined;
      return {message:'Source evidence was already retrieved. The cell projection may be incorrect. Reuse the original selected summary below; proofLimits keeps proof and sourceCoverage separate. Do not rerun the completed source query to fix formatting. For graph calculations use graphRead; its value has nodes:[{id,kind}] and edges:[{from,to,kind}]. Declare calculation variables in this fresh cell.',availableResult:{tool:call.tool,summary:value.summary,path,read:{tool:'result_read',arguments:args},...(graphRead?{graphRead}:{})},retry:{tool:'code',arguments:{code:'return (await tools.result_read('+JSON.stringify(args)+')).value;'}}};
    }
    // A selected /flowMap read has no nested summary. Recover it from that
    // same owned source, never by executing another analysis/query.
    for(let i=recentResults.length-1;i>=0;i--){
      const call=recentResults[i];if(call.tool!=='result_read')continue;
      const R=require('./results'),sourceView=call.value?.sourceView,id=R.referenceId(sourceView),raw=id&&R.load(id)?.data;
      if(!raw?.flowMap||!Array.isArray(raw.flowMap.nodes)||!Array.isArray(raw.flowMap.methods))continue;
      const summary=require('./semantic-navigation').summarize({...raw,view:sourceView}).summary;
      let view;try{view=R.saveTool('retained_map_summary',JSON.stringify({summary,sourceView}));}catch{}
      const args=view?{id:R.referenceId(view),path:'/summary',all:true}:null;
      return {message:'The selected graph is result.value itself: use result.value.nodes and result.value.edges, not result.value.graph. The summary below was computed from this same full retained graph. If it answers the request, answer now. Do not rerun discovery or source queries; static graph facts do not prove runtime behavior.',availableResult:{tool:call.tool,summary,sourceView,summaryScope:'derived-from-retained-graph',read:args?{tool:'result_read',arguments:args}:null,graphRead:{tool:'result_read',arguments:{id,path:'/flowMap',all:true}}},...(args?{retry:{tool:'code',arguments:{code:'return (await tools.result_read('+JSON.stringify(args)+')).value;'}}}:{})};
    }
};
module.exports.diagnostic = (error, recentResults=[], receipts=[]) => {
  if(error&&/Cannot read properties of undefined|cannot read property|is not defined/i.test(error)){
    const recovery=module.exports.recovery(recentResults,receipts);if(recovery)return recovery;
  }
  if(/Cannot read properties of undefined.*compacted/.test(error||''))return {message:'modelContext is model-transport metadata and may be absent inside code. For result_read, use r.sourceCoverage.provenComplete and r.sourceView directly. A non-compacted result does not prove upstream completeness.'};
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
  const missing=[],sources={};
  for(const object of [value,value?.summary])if(object&&typeof object==='object')for(const [field,kind]of [['mapView','map'],['traceView','trace']]){
    const url=object[field];if(typeof url!=='string')continue;
    const id=require('./results').referenceId(url),data=id&&require('./results').load(id)?.data;
    if(!(kind==='map'?data?.flowMap:data?.sides&&data?.operation==='trace'))missing.push(field);else sources[kind]=data;
  }
  const claims=require('./semantic-claims').verify(value,sources);
  if(!missing.length&&!claims.valid)return {provenance,evidenceCheck:{status:'contradictory-static-claims',fields:claims.issues,observedProofLimits:claims.observed,meaning:'Reported proof/coverage values contradict the linked retained evidence. Use observedProofLimits below; static evidence does not establish runtime behavior. Repair the reported values without rerunning the source query.'}};
  const facts=[];
  for(const source of Object.values(sources)){
    if(source.flowMap&&(!Array.isArray(source.flowMap.nodes)||!Array.isArray(source.flowMap.methods)))continue;
    const summary=require('./semantic-navigation').summarize(source).summary;
    for(const object of [value,value?.summary])if(object&&typeof object==='object')for(const field of ['entry','decisionCount','changeCount','methodExitCount','externalCallBoundaryCount','nodeCount','controlEdgeCount','hasControlCycle','graphStructureComplete','traceSinkCall','argumentExpression','controlAssumptionStatus','dataAssumptionStatus']){
      if(Object.hasOwn(object,field)&&Object.hasOwn(summary,field)&&JSON.stringify(object[field])!==JSON.stringify(summary[field]))facts.push({field,reported:object[field],observed:summary[field]});
    }
  }
  if(!missing.length&&facts.length)return {provenance,evidenceCheck:{status:'contradictory-semantic-facts',fields:facts,meaning:'The cell projection contradicts the linked retained source summary. Read the original summary without rerunning the completed query.'}};
  return {provenance,...(missing.length?{evidenceCheck:{status:'unbacked-references',fields:[...new Set(missing)],meaning:'These returned map/trace references do not identify the corresponding retained evidence. A constructed value is not a source-query result.',retry:{tool:'code',arguments:{code:'return await tools.tool_describe({name:"what_happens_from"});'}}}}:{})};
};

module.exports.resolveName = (name, definitions) => {
  if(typeof name!=='string')return name;
  if(definitions.some(t=>t.name===name))return name;
  const aliases={list_analyses:'which_analyses_exist'};
  if(aliases[name]&&definitions.some(t=>t.name===aliases[name]))return aliases[name];
  const key=s=>s.replace(/[_-]/g,'').toLowerCase();
  const matches=definitions.filter(t=>key(t.name)===key(name));
  return matches.length===1?matches[0].name:name;
};
