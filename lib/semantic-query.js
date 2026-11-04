const path=require('path'),{Worker}=require('worker_threads');
const OPERATIONS=['symbols','search','ports','callers','callees','neighborhood','neighbors','paths','slice','assertions','compare'];
function validate(args,analyses){if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Semantic query arguments must be an object');if(!OPERATIONS.includes(args.operation||'symbols'))throw Error('Unsupported semantic operation');if(!['reachability','controlflow','dataflow'].includes(args.mode||'reachability'))throw Error('Unsupported semantic query mode');if(!Array.isArray(analyses)||analyses.length>20)throw Error('Select at most 20 immutable analyses');for(const a of analyses)if(!a.id||!a.dir||!a.repo||!a.sha)throw Error('Query requires resolved immutable analyses');for(const selector of [args.from,args.to,args.target])if(selector&&(!selector||typeof selector!=='object'||Array.isArray(selector)))throw Error('Semantic selectors must be objects');}
async function query(args={},analyses=[],{runQuery,ports,bindings}={}){
 validate(args,analyses);
 let passportCandidates;
 analyses=analyses.map(a=>{if(a.ports)return a;try{
   const O=require('./passport/overrides'),ports=[],revisions=[],gaps=[],env=a.env??args.env;
   // A repository analysis can predate its deployment passport. Resolve every exact
   // deployment independently; never choose one service/environment by its name.
   const candidates=a.service?[{service:a.service,env,repo:a.repo,sha:a.sha}]:(passportCandidates??=require('./passport').list({manual:false})).filter(p=>p.repo===a.repo&&p.sha===a.sha&&(env==null||p.env===env));
   if(candidates.length>1)gaps.push({kind:'multiple-deployments',analysisId:a.id,candidates:candidates.slice(0,100).map(({service,env})=>({service,env})),detail:'The same source revision has multiple deployment identities; ports retain each service and environment'});
   if(candidates.length>100)gaps.push({kind:'passport-deployment-budget',detail:'Exact deployment matches were capped at 100'});
   for(const candidate of candidates.slice(0,100)){
     let cursor;do{const response=O.ports({service:candidate.service,env:candidate.env,repo:a.repo,revision:a.sha,limit:500,cursor});ports.push(...response.ports.slice(0,10000-ports.length));revisions.push([response.identity,response.revision]);gaps.push(...response.gaps);cursor=response.nextCursor;}while(cursor&&ports.length<10000);
     if(ports.length>=10000){gaps.push({kind:'passport-port-budget',detail:'Effective passport ports were capped at 10000'});break;}
   }
   return{...a,ports,overlayRevision:revisions,portGaps:gaps};
 }catch(error){return{...a,ports:[],portGaps:[{kind:'passport-port-unavailable',detail:error.message}]};}});
 if(!analyses.length)return{protocol:'dt.semantic/v1',operation:args.operation||'symbols',results:[],analyses:[],readiness:'missing-analysis',gaps:[{kind:'missing-analysis',detail:'Build or select an immutable semantic analysis; native code search remains available'}],truncated:false,proof:{status:'unavailable'}};
 const E=require('./execution');E.check();
 const workerFile=path.join(__dirname,'semantic-query-worker.js');
 const result=await require('./limit').schedule('cpu',()=>new Promise((resolve,reject)=>{
  const worker=new Worker(workerFile,{workerData:{args,analyses,options:{ports,bindings}},resourceLimits:{maxOldGenerationSizeMb:192}});
  const release=E.resource(()=>worker.terminate());let settled=false;
  const timer=setTimeout(()=>finish(Object.assign(new Error('Semantic query exceeded its ingestion/query deadline'),{code:'DT_SEMANTIC_QUERY_TIMEOUT'})),Math.max(30000,Math.min(120000,(args.budgetMs||5000)+30000)));
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);release();worker.terminate().then(()=>error?reject(error):resolve(value),reject);};
  worker.on('message',m=>m.ok?finish(null,m.value):finish(Object.assign(new Error(m.error.message),{code:m.error.code})));
  worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!settled)finish(E.signal()?.aborted?E.abortError(E.signal().reason):new Error(`Semantic navigation worker stopped (${code})`));});
 }));
 if(result.compositions?.length){
  const composed=result.compositions;delete result.compositions;delete result.deepRequests;
  const unique=new Map();for(const path of composed)for(const segment of path.segments)if(segment.request&&!unique.has(segment.id))unique.set(segment.id,segment);
  const selected=[...unique.values()].slice(0,16),responses=new Map();
  if(runQuery){for(const item of await require('./util').pool(selected,1,async segment=>({id:segment.id,response:await runQuery(analyses.find(a=>a.id===segment.analysisId),segment.request)})))responses.set(item.item.id,item.error?{error:item.error.message}:item.value.response);}
  for(const path of composed){
   for(const segment of path.segments){
    delete segment.fromNodeIds;delete segment.toNodeIds;delete segment.request;
    const response=responses.get(segment.id);
    if(!response){if(segment.status==='pending')segment.status='unavailable';path.gaps.push({kind:'local-query-unavailable',segment:segment.id,detail:runQuery?'The 16-segment query budget was exhausted':'Retained CPG runtime is unavailable'});continue;}
    if(response.error){segment.status='failed';path.gaps.push({kind:'local-query-failed',segment:segment.id,detail:response.error});continue;}
    const analysis=analyses.find(a=>a.id===segment.analysisId);
    segment.paths=(response.records||[]).filter(r=>r.type==='path'&&r.kind==='data-flow'&&r.proof?.status==='static-dataflow').map(r=>normalizePath(r,analysis));
    segment.ms=response.ms;segment.status=segment.paths.length?'static-dataflow':'no-supported-flow';
    if(!segment.paths.length)path.gaps.push({kind:'local-dataflow-gap',segment:segment.id,detail:'The bounded retained-CPG query did not establish this local value segment'});
    if((response.records||[]).some(r=>r.truncated)){result.truncated=true;path.gaps.push({kind:'local-query-truncated',segment:segment.id,detail:'Local data-flow coverage was bounded'});}
   }
   const complete=path.segments.length&&path.segments.every(s=>s.status==='static-dataflow')&&path.boundaries.every(b=>['declared','signature-binding'].includes(b.status))&&!path.gaps.length;
   path.proof.status=complete?'composed-static-lineage':'partial-lineage';path.proof.note='Local CPG data-flow segments are composed through explicit reviewed boundary mappings; this is not one Joern path or a runtime/path-feasibility proof';
  }
  result.results=composed;result.total=composed.length;result.proof={kind:'composed-data-lineage',status:composed.some(p=>p.proof.status==='composed-static-lineage')?'composed-static-lineage':'partial-lineage',feasibility:'unknown',runtime:'unknown',fieldMappings:'declared'};
  result.gaps.push(...composed.flatMap(p=>p.gaps));
 }
 if(result.deepRequests?.length){
  const requests=result.deepRequests;delete result.deepRequests;
  if(!runQuery){result.gaps.push({kind:'deep-query-unavailable',detail:'Retained CPG query runtime is unavailable; no data-flow or control-flow proof was produced'});result.proof.status='unavailable';}
  else{
   const deep=await require('./util').pool(requests,1,async item=>{const analysis=analyses.find(a=>a.id===item.analysisId);const response=await runQuery(analysis,item.request);return{analysisId:item.analysisId,...response};});
   for(const item of deep){if(item.error){result.gaps.push({kind:'deep-query-failed',analysisId:item.item.analysisId,detail:item.error.message});continue;}const response=item.value;for(const record of response.records||[]){if(record.type==='summary'){result.truncated ||= record.truncated;for(const gap of record.gaps||[])result.gaps.push({kind:'deep-query-coverage',analysisId:response.analysisId,detail:gap});}else result.results.push({...normalizePath(record,analyses.find(a=>a.id===response.analysisId)),analysisId:response.analysisId,id:record.id||`semantic-path:${response.analysisId}:${result.results.length}`});}}
   result.proof={kind:args.mode||'dataflow',status:result.results.length?'static-candidate':'no-supported-path',feasibility:'unknown',scope:'single-cpg'};
   result.total=result.results.length;result.results=result.results.slice(0,Math.max(1,Math.min(200,args.limit||30)));
  }
 }
 result.gaps.push(...analyses.flatMap(a=>a.portGaps||[]),...analyses.flatMap(a=>(a.coverage?.gaps||[]).filter(g=>g&&typeof g==='object').map(g=>({...g,analysisId:a.id}))));
 return result;
}
function normalizePath(record,analysis={}){return{...record,analysisId:analysis.id,nodes:(record.nodes||[]).map(node=>{const source=(analysis.sources||analysis.manifest?.sources||[]).filter(s=>s.prefix&&node.file?.startsWith(s.prefix+'/')).sort((a,b)=>b.prefix.length-a.prefix.length)[0];return{...node,id:node.id||`${analysis.id}:${node.nodeId}`,analysisId:analysis.id,repo:source?.repo||analysis.repo,sha:source?.sha||analysis.sha,file:source?node.file.slice(source.prefix.length+1):node.file,locator:{analysisId:analysis.id,generation:analysis.id,nodeId:node.nodeId}};}),conditions:(record.conditions||[]).map(condition=>({...condition,analysisId:analysis.id,status:['path_condition','declared','observed','unknown','counterexample'].includes(condition.status)?condition.status:'unknown'}))};}
module.exports={query,OPERATIONS};
