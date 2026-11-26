// Small intent-oriented contracts over retained semantic evidence. No implicit
// parsing, guessed sink arguments, runtime claims, or correlation of CFG/data paths.
const locate = n => ({ kind:n.kind, code:n.code, file:n.file, line:n.line });
function checks(sides, layer) {
  const groups = new Map();
  for (const side of sides || []) for (const [index, path] of (side[layer]?.paths || []).entries()) {
    const evaluation = path.assumptionEvaluation || {status:'unresolved'};
    const value = {side:side.side,status:evaluation.status,conditions:path.conditions?.map(c=>({expression:c.expression,polarity:c.polarity,file:c.file,line:c.line})),unresolved:evaluation.unresolved,conflicts:evaluation.conflicts};
    const key = JSON.stringify(value);
    if (!groups.has(key)) groups.set(key, {...value,retainedPaths:[]});
    groups.get(key).retainedPaths.push(index);
  }
  return [...groups.values()];
}
function summarize(raw) {
  const gaps=new Map();
  for(const gap of raw.gaps||[]){const value={kind:gap.kind,detail:gap.detail??gap.message,side:gap.side},key=JSON.stringify(value);if(!gaps.has(key))gaps.set(key,{...value,occurrences:0});gaps.get(key).occurrences++;}
  const common = {
    protocol:'dt.semantic-navigation/v1',
    answerHint:'Use the selected summary/fields and copy applicable mapView/traceView URLs exactly into the answer. These are retained evidence links, not analysis ids.',
    output:{status:'part',scope:'selected-evidence'},
    sourceCoverage:{complete:raw.flowMap?.complete??null,truncated:!!raw.truncated,gapCount:(raw.gaps||[]).length,gaps:[...gaps.values()]},
    proof:Object.fromEntries(['kind','status','feasibility','runtime','behaviorVerified'].filter(k=>raw.proof?.[k]!==undefined).map(k=>[k,raw.proof[k]])),view:raw.view,
    read:{tool:'result_read',arguments:{id:raw.view?.split('/').pop(),all:true}},
  };
  const proofLimits={proof:common.proof,sourceCoverage:{complete:common.sourceCoverage.complete,truncated:common.sourceCoverage.truncated,gapCount:common.sourceCoverage.gapCount}};
  if (raw.flowMap) {
    const m = raw.flowMap;
    const selectedEntries=m.methods.filter(x=>m.entries.includes(x.entry)).map(x=>({name:x.name,file:x.file,line:x.line}));
    const methodExits=m.nodes.filter(n=>['return','throw','exit'].includes(n.kind)).map(locate),externalCallBoundaries=m.nodes.filter(n=>n.exit).map(n=>({...locate(n),boundary:n.exit}));
    const decisions=m.nodes.filter(n=>n.kind==='decision').map(locate),changes=m.nodes.flatMap(n=>(n.changes||[]).map(c=>({...c,file:c.file??n.file,line:c.line??n.line})));
    const summary={...(selectedEntries.length===1?{entry:selectedEntries[0].name}:{}),decisionCount:decisions.length,changeCount:changes.length,methodExitCount:methodExits.length,externalCallBoundaryCount:externalCallBoundaries.length,...require('./graph-structure').summarize(m.nodes,m.edges),behaviorVerified:raw.proof?.behaviorVerified===true,mapComplete:m.complete,mapView:raw.view,proofLimits};
    return {evidenceType:'entry-map',mapView:raw.view,traceView:null,mapComplete:m.complete,...common,summary,counts:{...m.counts,methodExits:methodExits.length,externalCallBoundaries:externalCallBoundaries.length},
      entries:selectedEntries,
      methodExits,
      externalCallBoundaries,
      decisions,
      changes,declaredAssumptions:m.assumptions};
  }
  const data = checks(raw.sides,'data'), control = checks(raw.sides,'control');
  const observedPredicates=[...new Set(control.flatMap(c=>(c.conditions||[]).map(p=>p.expression)).filter(Boolean))];
  const unmatchedAssumptions=(raw.assumptions||[]).filter(a=>!observedPredicates.includes(a.expression));
  const status = xs => {const statuses=[...new Set(xs.map(x=>x.status))];return statuses.length===1?statuses[0]:statuses.length?'mixed':'no-paths';};
  const selectedSinks=(raw.sides||[]).flatMap(s=>(s.data?.selectedValues?.to||[]).map(v=>({side:s.side,traceSinkCall:v.name,argument:v.argument,argumentExpression:v.value,callExpression:v.call,file:v.file,line:v.line})));
  const distinctSinks=[...new Map(selectedSinks.map(s=>[JSON.stringify([s.traceSinkCall,s.argument,s.argumentExpression]),s])).values()];
  const summary={...(raw.request?.arguments?.from?.name?{entry:raw.request.arguments.from.name}:{}),...(distinctSinks.length===1?{traceSinkCall:distinctSinks[0].traceSinkCall,argumentExpression:distinctSinks[0].argumentExpression}:{sinkCandidates:distinctSinks}),controlAssumptionStatus:status(control),dataAssumptionStatus:status(data),behaviorVerified:raw.proof?.behaviorVerified===true,traceView:raw.view,proofLimits,...(unmatchedAssumptions.length?{unmatchedAssumptions,observedPredicates}: {})};
  return {evidenceType:'value-trace',traceView:raw.view,mapView:null,...common,summary,declaredAssumptions:raw.assumptions||[],
    selectedSinks,
    dataAssumptionStatus:status(data),controlAssumptionStatus:status(control),
    ...(unmatchedAssumptions.length?{unmatchedAssumptions,observedPredicates,assumptionGuidance:'These declarations did not match an exact observed control predicate. If your question refers to an observed predicate, copy its exact expression as a quoted string; do not invent a label. Retrying with a corrected declaration does not prove runtime feasibility.'}:{}),
    assumptionChecks:{data,control},
    ...(raw.request?.arguments?.from?.name?{relatedMap:{insideCodeCall:'tools.what_happens_from',arguments:{analysis:raw.analyses?.[0]?.id,entry:raw.request.arguments.from.name}}}:{}),
    meaning:'This value trace is not an entry-to-exit map. For a combined question call what_happens_from separately and keep its mapView plus this traceView. Statuses apply to retained paths only. mixed means paths differ; no-paths means no retained path. Data and control evidence are independent; neither proves runtime behavior.'};
}
module.exports = ({str,int,env,present}) => {
  const S = () => require('./semantic-code');
  const text = description => ({...str(description),minLength:1});
  const observation = {job:text('Observe the returned owned job; omit other selectors when polling'),waitMs:{...int('Wait for this job, at most 30000 ms',30000),minimum:0,maximum:30000}};
  const scope = {env,analysis:text('Exact retained id from which_analyses_exist; never a repository name')};
  const required = fields => ({if:{required:['job']},then:{properties:{job:{minLength:1}}},else:{required:fields}});
  const traceInputs={parameter:text('Source parameter name'),sink:text('Target call name'),argument:{type:'integer',minimum:1,maximum:64,description:'Required one-based sink argument position, e.g. 2 selects the second argument'},assumptions:{type:'array',maxItems:20,items:{type:'object',properties:{expression:{type:'string',minLength:1,maxLength:1000},holds:{type:'boolean'}},required:['expression','holds'],additionalProperties:false},description:'Literal predicate text and explicit truth values: [{expression:"input < 0",holds:false}], also accepts one object or JSON-encoded array/object. Explicit true/false strings are normalized. Copy the user expression verbatim and its truth value separately. Never negate, simplify or paraphrase it, or replace it with a descriptive label. Omitted or [] declares none.'}};
  const combined=require('./semantic-navigation-combined')({S,present,summarize});
  async function query(name, operation, a) {
    if(name==='what_happens_from'&&(a.parameter!==undefined||a.sink!==undefined||a.argument!==undefined||a.job&&require('./jobs').find(a.job)?.key.startsWith('semantic:navigation:')))return combined(a);
    const args = a.job ? {job:a.job,waitMs:a.waitMs??30000} : {
      analysis:a.analysis,env:a.env,operation,waitMs:a.waitMs??30000,
      from:operation==='flowmap'?{name:a.entry}:{kind:'method',name:a.entry,parameter:a.parameter},
      ...(operation==='trace'?{to:{kind:'call',name:a.sink,argument:Number(a.argument)},assumptions:Array.isArray(a.assumptions)?a.assumptions:Object.entries(a.assumptions||{}).map(([expression,holds])=>({expression,holds}))}:{})};
    const raw = await S().query(args);
    if(raw.operation&&raw.operation!==operation)throw Error(`This job belongs to ${raw.operation}; observe it with the original tool.`);
    if (raw.state==='running'||raw.state==='queued') return {...raw,next:{tool:name,arguments:{job:raw.job,waitMs:30000}},guidance:'Observe this job; do not start the query again.'};
    const retained = present(raw,{view:operation==='flowmap'?'semantic-flow-map':'semantic-path-trace',title:operation==='flowmap'?'Entry to exits':'Parameter to sink argument'});
    if(raw.error||raw.ready===false)return retained;
    const selected=summarize(retained);
    // A missing endpoint is a selection problem, not evidence that a value
    // cannot flow. Offer retained names without silently choosing another one.
    if (raw.flowMap?.entries.length===0 || (raw.gaps||[]).some(g=>g.kind==='endpoint-not-found')) {
      const analysis=a.analysis||raw.analyses?.[0]?.id,entry=a.entry||raw.request?.arguments?.from?.name;
      const symbols=analysis?await S().query({analysis,env:a.env,operation:'symbols',kind:'method',limit:20}):{results:[]};
      const availableEntries=(symbols.results||[]).map(m=>({name:m.name,signature:m.signature,file:m.file,line:m.line,parameters:m.parameters?.map(p=>({name:p.name,index:p.index}))}));
      selected.selection={resolved:false,requestedEntry:entry,availableEntries,candidatesTruncated:!!symbols.truncated};
      selected.entryCandidatesView=present(symbols,{title:'Retained method candidates'}).view;
      selected.ready=false;selected.error='No exact entry/parameter selection resolved. Available retained method names: '+[...new Set(availableEntries.map(m=>m.name))].join(', ')+'. Use the exact method name from the user request; do not append entry/method labels or replace it with the parameter name.';
      delete selected.summary;
      const stem=s=>String(s||'').replace(/(?:[_ -]?entry|[_ -]?method)$/i,'').toLowerCase();
      const matches=availableEntries.filter(m=>entry&&m.name!==entry&&stem(m.name)===stem(entry)||a.parameter&&entry===a.parameter&&m.parameters?.some(p=>p.name===a.parameter));
      if(!a.job&&matches.length===1){
        const arguments_={...a,entry:matches[0].name};delete arguments_.all;
        selected.selection.suggestedEntry={name:matches[0].name,reason:'One retained method matches the mistaken entry label or owns the named parameter. Verify it against the user request before retrying.'};
        selected.retry={tool:name,arguments:arguments_};
        selected.insideCodeRetry={tool:'code',arguments:{code:'return await tools.'+name+'('+JSON.stringify(arguments_)+');'}};
      }
      selected.guidance='Selection failed, so no answer summary is available. Read selection.availableEntries and correct the exact requested method/parameter. A suggested retry is never executed automatically. Do not answer a flow question from unresolved endpoints.';
    }
    return a.all?{...retained,...selected,proof:retained.proof,output:{status:'all',scope:'retained-evidence'}}:require('./semantic-response').compact(selected,8192);
  }
  return [
    {name:'which_analyses_exist',description:'List retained code analyses; optional exact workspace, repo and sha filters never parse code. Returns analyses:[{id,repo,sha,workspace,...}], total, analysisView; read result.analyses, not result.value. Choose the requested revision once and reuse its id.',input:{env,versions:{type:'boolean',description:'Include replaced retained generations; defaults true with an exact sha filter, otherwise false'},workspace:text('Exact workspace id; filter retained records only'),repo:text('Exact repository identity; filter retained records only'),sha:text('Exact source revision; filter retained records only')},run:async a=>{
      const versions=a.versions??(a.sha!==undefined),listed=await S().index({env:a.env,versions});
      const filters=Object.fromEntries(['workspace','repo','sha'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
      const records=(listed.analyses||[]).filter(x=>Object.entries(filters).every(([k,v])=>x[k]===v));
      const raw=present({...listed,analyses:records,total:records.length,versions,...(Object.keys(filters).length?{filters,sourceTotal:listed.total??listed.analyses?.length}: {})},{title:'Retained code analyses'});
      const common={evidenceType:'analysis-list',analysisView:raw.view,mapView:null,traceView:null,...raw,meaning:'This view lists analyses; it is not a map or trace. Use what_happens_from for mapView and where_value_flows for traceView.'};
      common.next={insideCodeCall:'tools.tool_describe',arguments:{name:'what_happens_from'},code:'return await tools.tool_describe({name:"what_happens_from"});'};common.guidance='Read analyses[] (not value[]). Analyses have been listed. Do not repeat this listing. Choose the requested analyses[].id and inspect the next schema, then query it using analysis:id.';if(!records.length){common.next={tool:'which_analyses_exist',insideCodeCall:'tools.which_analyses_exist',arguments:{env:a.env,versions}};common.guidance=Object.keys(filters).length?'No retained analysis matches these exact filters. Inspect the unfiltered retained list; do not invent an id or parse a new revision without an indexing request.':'No retained analyses are available. Report the missing evidence and inspect semantic configuration/indexing capabilities; do not invent a map or trace.';}if(!records.length&&Object.keys(filters).length){
        const mismatches=Object.keys(filters).map(field=>({field,peers:(listed.analyses||[]).filter(x=>Object.entries(filters).every(([k,v])=>k===field||x[k]===v))})).filter(x=>x.peers.length).sort((a,b)=>a.peers.length-b.peers.length);
        if(mismatches.length){
          const {field,peers}=mismatches[0];
          common.filterMismatch={field,requested:filters[field],candidates:peers.slice(0,10).map(x=>Object.fromEntries(['id','repo','sha','workspace','language'].filter(k=>x[k]!==undefined).map(k=>[k,x[k]]))),candidatesTruncated:peers.length>10,meaning:'Other retained identities matching the remaining filters, NOT matches for the requested revision. Verify against the user request before selecting an id.'};
          common.next={tool:'which_analyses_exist',insideCodeCall:'tools.which_analyses_exist',arguments:{env:a.env,versions,...Object.fromEntries(Object.entries(filters).filter(([k])=>k!==field))}};
          common.ready=false;common.error='Exact identity filter mismatch for '+field+'. No analysis selected. Use retry to inspect candidates without that filter, verify the requested revision, then reuse its id.';
          common.retry={tool:'which_analyses_exist',arguments:{...common.next.arguments}};
          common.insideCodeRetry={tool:'code',arguments:{code:'return await tools.which_analyses_exist('+JSON.stringify(common.next.arguments)+');'}};
          common.guidance='No retained analysis matches these exact filters. Exact identity filter mismatch. Inspect filterMismatch candidates and copy the actual requested identity verbatim; do not repeat the unchanged failed filters. Candidates are metadata, not a map/trace and not proof of the requested revision.';
        }
      }
      if(a.all)return common;
      return {...common,analyses:(raw.analyses||[]).map(x=>Object.fromEntries(['id','repo','sha','ref','workspace','language','state','coverage'].filter(k=>x[k]!==undefined).map(k=>[k,x[k]])))};
    }},
    {name:'what_happens_from',description:'Map an entry method: decisions, changes, method exits and external call boundaries. To answer a combined map and value-flow question, also provide parameter, sink, argument and assumptions; returns entryMap and valueTrace separately with both mapView and traceView. A sink argument is never guessed. Return summary directly as the answer projection: it includes proofLimits with proof and sourceCoverage kept separate. Keep its mapView/traceView links even for counts-only questions; unmatchedAssumptions identifies declarations to correct from observedPredicates. Poll the returned job. Static evidence, not runtime proof; omit all for compact navigation.',input:{...scope,entry:text('Exact method name from the user request; copy verbatim, never append entry/method labels'),...traceInputs,...observation},inputRules:{...required(['analysis','entry']),else:{required:['analysis','entry'],if:{anyOf:[{required:['parameter']},{required:['sink']},{required:['argument']}]},then:{required:['parameter','sink','argument']}}},run:a=>query('what_happens_from','flowmap',a)},
    {name:'where_value_flows',description:'Trace only: this tool does not create an entry-to-exit map. For a combined map and value trace use what_happens_from with parameter, sink, argument and assumptions. Trace an entry parameter to an explicitly selected one-based sink argument. argument is required: never guess argument 1. Pass literal user predicates in assumptions (array or one expression/holds object). Returns summary with selected argumentExpression, exact statuses, traceView and proofLimits (proof and sourceCoverage are separate); selectedSinks retains source positions and argument indexes; mixed statuses retain per-path checks. Static evidence, not runtime proof. Omit all for compact navigation.',input:{...scope,entry:text('Exact source method name, distinct from parameter; copy the user method name verbatim'),...traceInputs,...observation},inputRules:required(['analysis','entry','parameter','sink','argument']),run:a=>query('where_value_flows','trace',a)},
  ].map(t=>({...t,group:'semantic',origin:'built-in',strictInput:true,codeHint:t.name==='which_analyses_exist'?'Returns {analyses:[{id,repo,sha,workspace}],total}; metadata only. Use only when the requested analysis identity is unknown.':t.name==='what_happens_from'?'For a combined map AND value trace, use this tool with parameter,sink,argument,assumptions: summary contains BOTH mapView and traceView plus expression/statuses. Map-only (omit trace inputs) returns {summary,mapView}; summary has entry,decisionCount,changeCount,methodExitCount,externalCallBoundaryCount,nodeCount,controlEdgeCount,hasControlCycle,graphStructureComplete,mapComplete,behaviorVerified,mapView,proofLimits. Structural counts/cycles cover every retained graph row; they do not prove runtime behavior or full source coverage. With all:true, graph is flowMap:{nodes:[{id,kind}],edges:[{from,to,kind}]}, never entryMap.graph. Combined map/trace additionally returns entryMap,valueTrace and flat trace fields in summary. Return summary unchanged for summary questions. Poll with job only.':'Trace only; for a combined entry map AND value trace use what_happens_from instead. Returns {summary,selectedSinks}; summary has entry,traceSinkCall,argumentExpression,controlAssumptionStatus,dataAssumptionStatus,behaviorVerified,traceView,proofLimits. traceView is a URL string, never an object or array. Return summary unchanged. Static runtime/feasibility are unknown. Poll with job only.'}));
};
module.exports.summarize = summarize;
module.exports.normalize = (name, args) => {
  if(name==='which_analyses_exist'){
    const out={...args};
    for(const key of ['workspace','repo','sha'])if(out[key]===null||typeof out[key]==='string'&&!out[key].trim())delete out[key];
    return out;
  }
  if(!['what_happens_from','where_value_flows'].includes(name))return args;
  const out={...args};
  for(const key of ['argument','argumentIndex'])if(typeof out[key]==='string'&&/^\d+$/.test(out[key].trim()))out[key]=Number(out[key].trim());
  if(typeof out.assumptions==='string'){
    if(out.assumptions.length>32768)throw Error('assumptions JSON exceeds 32768 characters');
    try{out.assumptions=JSON.parse(out.assumptions);}catch{throw Error('assumptions must be an array of {expression,holds}; JSON-encoded arrays/objects are accepted. Use an explicit boolean truth value.');}
    if(!out.assumptions||typeof out.assumptions!=='object')throw Error('assumptions JSON must contain an array or one expression/holds object');
  }
  for(const [alias,key]of Object.entries({analysisId:'analysis',entryMethod:'entry',sinkCall:'sink',argumentIndex:'argument'}))if(out[alias]!==undefined){
    if(out[key]!==undefined&&out[key]!==out[alias])throw Error(`${key} and ${alias} disagree; pass only ${key}.`);
    out[key]=out[alias];delete out[alias];
  }
  if(out.controlAssumption!==undefined){
    if(out.assumptions!==undefined)throw Error('Pass assumptions only; controlAssumption is an alternative spelling, not an additional condition.');
    const match=typeof out.controlAssumption==='string'&&/^([\s\S]+?)\s+is\s+(true|false)\s*$/.exec(out.controlAssumption);
    if(!match)throw Error('Use assumptions:[{expression:"exact predicate",holds:false}] with an explicit boolean.');
    out.assumptions=[{expression:match[1].trim(),holds:match[2]==='true'}];delete out.controlAssumption;
  }
  if(out.assumptions&&typeof out.assumptions==='object'&&!Array.isArray(out.assumptions)){const a=out.assumptions;out.assumptions=Object.hasOwn(a,'expression')?[a]:Object.entries(a).map(([expression,holds])=>({expression,holds}));}
  if(Array.isArray(out.assumptions))out.assumptions=out.assumptions.map(a=>a&&typeof a==='object'&&!Array.isArray(a)&&typeof a.holds==='string'&&/^(true|false)$/i.test(a.holds.trim())?{...a,holds:a.holds.trim().toLowerCase()==='true'}:a);
  return out;
};
