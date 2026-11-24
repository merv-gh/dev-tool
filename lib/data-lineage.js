// Main-process orchestration. CPU work remains in cancellable, heap-limited workers.
const S=require('./data-lineage-store');
const rpc=(fn,args,options)=>require('./isolate').exec('dataLineage',fn,[args],options);
function configure(args) {
  const env=require('./config').getEnv(args.env).name,old=require('./data-lineage-build').settings(env);
  if(args.expected_revision!==old.revision)throw Object.assign(Error('Index rules changed; reload data_index status and use its rulesRevision'),{code:'DT_REVISION_CONFLICT',statusCode:409});
  const rules=args.rules;
  if(!rules||typeof rules!=='object'||Array.isArray(rules)||Object.keys(rules).some(k=>!['aliases','links'].includes(k)))throw S.invalid('Rules contain aliases and links arrays only');
  const aliases=rules.aliases || [],links=rules.links || [];
  if(!Array.isArray(aliases)||!Array.isArray(links)||aliases.length>200||links.length>200)throw S.invalid('At most 200 aliases and 200 reviewed links');
  const text=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n&&!/[\x00-\x08]/.test(v);
  for(const a of aliases)if(!a||!text(a.target,2000)||!Array.isArray(a.names)||!a.names.length||a.names.length>20||a.names.some(n=>!text(n,200)))throw S.invalid('Each alias needs an exact target and 1–20 names');
  for(const l of links)if(!l||!text(l.from,2000)||!text(l.to,2000)||!text(l.evidence,2000)||l.access&&!['read','write','mapping'].includes(l.access)||l.relation&&!text(l.relation,100))throw S.invalid('Each reviewed link needs exact from/to ids and evidence; access is read, write or mapping');
  const value={aliases:aliases.map(a=>({target:a.target,names:a.names})),links:links.map(l=>({from:l.from,to:l.to,evidence:l.evidence,...(l.access?{access:l.access}:{}),...(l.relation?{relation:l.relation}:{})}))};
  const db=S.open(env,true);
  try{db.exec('BEGIN IMMEDIATE');const scope=require('./access').owner().scopeKey,row=db.prepare('SELECT payload FROM index_rules WHERE id=?').get(scope),current=row?JSON.parse(row.payload):{aliases:[],links:[]};if(S.hash(current)!==args.expected_revision)throw Object.assign(Error('Index rules changed; reload status'),{code:'DT_REVISION_CONFLICT',statusCode:409});db.prepare('INSERT OR REPLACE INTO index_rules VALUES (?,?)').run(scope,JSON.stringify(value));db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
  return {state:'configured',env,rulesRevision:S.hash(value),rules:value,note:'Rules are private to this principal/task scope. The next query refreshes the derived index.'};
}
function observe(id,waitMs=0) {
  const J=require('./jobs'),job=J.find(id);
  if(!job||!job.key.startsWith('data-index:'))throw Object.assign(Error('Data index job is unavailable in this task'),{code:'DT_ACCESS_DENIED'});
  require('./access').checkEnv(job.key.split(':')[1]);
  const get=()=>({protocol:'dt.data-index/v1',state:job.state,job:J.get(id),...(job.result || {}),...(job.error?{error:job.error}:{})});
  if(!job.promise||job.state!=='running'||!waitMs)return get();
  return new Promise(resolve=>{const timer=setTimeout(()=>resolve(get()),Math.max(0,Math.min(30000,waitMs)));job.promise.finally(()=>{clearTimeout(timer);resolve(get());});});
}
function start(status,args,force=false) {
  const J=require('./jobs'),key=`data-index:${status.env}:${status.selection}:${status.signature}`;
  const inFlight=J.list(100).find(j=>j.key.startsWith(`data-index:${status.env}:${status.selection}:`)&&j.state==='running');if(inFlight)return inFlight;
  const prior=J.list(100).find(j=>j.key===key);
  if(!force&&prior&&['failed','cancelled'].includes(prior.state))return prior;
  let job;
  job=J.start(key,`Data access index · ${status.env}`,async log=>{
    log(`Indexing ${status.sources} cached source revisions; ${status.unindexed.length} cold repositories.`);
    const result=await rpc('build',{env:status.env,repos:args.repos},{onProgress:p=>{log(`${p.phase}: ${p.source || p.database || ''}${p.current?` ${p.current}/${p.total}`:''}${p.stats?.reused?' reused':''}`);if(job)J.checkpoint(job);}});
    log(`Published ${result.generation.slice(0,12)} in ${result.stats.ms} ms; ${result.stats.reused} source/database segments reused.`);return result;
  });
  return J.get(job.id);
}
async function index(args={}) {
  if(args.job)return observe(args.job,args.waitMs);
  if(args.action==='configure')return configure(args);
  const status=await rpc('status',args),rules=require('./data-lineage-build').settings(status.env);
  if(args.action==='status'){const recent=require('./jobs').list(100).find(j=>j.key.startsWith(`data-index:${status.env}:${status.selection}:`)),job=recent&&(recent.state==='running'||status.state!=='ready'&&['failed','cancelled'].includes(recent.state))?recent:null;return {...status,indexState:status.state,...(job?{job,state:job.state==='running'?'running':status.state}:{}),rules:{aliases:rules.aliases,links:rules.links},rulesRevision:rules.revision};}
  if(status.state==='ready'&&args.refresh!==true)return {...status,rulesRevision:rules.revision};
  const job=start(status,args,true);
  return args.waitMs?observe(job.id,args.waitMs):{...status,state:job.state,job,rulesRevision:rules.revision};
}
async function query(args={}) {
  const status=await rpc('status',args),refresh=!args.generation&&!args.cursor&&status.state!=='ready'?start(status,args):null;
  if(!status.generation&&!args.generation&&!args.cursor)return {protocol:'dt.data-lineage/v1',env:status.env,operation:args.operation,target:args.name,from:args.from,to:args.to,request:{env:status.env,...(args.repos?{repos:args.repos}:{})},state:refresh?.state || 'missing',index:status,job:refresh,rows:[],paths:[],coverage:require('./data-lineage-engine').coverage,note:refresh?.state==='running'?'Indexing cached sources in the background. Observe data_index with this job id, then repeat the same query.':`No complete index is available. Index build ${refresh?.state || 'has not started'}; inspect the owned job and explicitly call data_index to retry.`};
  const value=await rpc('query',args);
  return {...value,request:Object.fromEntries(['env','repos','db','name','mode','from','to','service','includeCandidates','includeObjectAccess','limit','maxHops','maxNodes','maxPaths','fanout','budgetMs'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]])),index:{state:status.state,generation:value.generation,at:value.at},...(refresh?{refreshJob:refresh,note:(refresh.state==='running'?'Serving the last complete generation while refreshing in the background. ':`Serving the last complete generation. Index refresh ${refresh.state}; explicitly call data_index to retry. `)+(value.note || '')}:{})};
}
function compact(value,max=16384) {
  const budget=max-512;
  const out=JSON.parse(JSON.stringify(value));
  if(out.job)out.job={id:out.job.id,state:out.job.state,title:out.job.title,error:out.job.error,log:out.job.log?.slice(-6)};
  if(out.refreshJob)out.refreshJob={id:out.refreshJob.id,state:out.refreshJob.state,error:out.refreshJob.error};
  out.returnedRows=out.rows?.length;out.returnedPaths=out.paths?.length;
  for(const row of out.rows || [])row.services=(row.services || []).map(s=>({service:s.service,repo:s.repo,entry:s.entry?.name}));
  const bytes=()=>Buffer.byteLength(JSON.stringify(out));
  for(const key of ['candidates','resolved']) {
    const arrays=Array.isArray(out[key])?[out[key]]:out[key]&&typeof out[key]==='object'?Object.values(out[key]).filter(Array.isArray):[];
    for(const array of arrays)while(bytes()>budget&&array.length>1){array.pop();out.previewOmissions=true;}
  }
  if(bytes()>budget&&out.mentions){out.mentions=[];out.previewOmissions=true;}
  if(bytes()>budget&&out.gaps){out.gaps=out.gaps.slice(0,5);out.previewOmissions=true;}
  if(out.stats&&bytes()>budget){out.stats={sources:out.stats.sources?.length,databases:out.stats.databases?.length,reused:out.stats.reused,ms:out.stats.ms};out.previewOmissions=true;}
  if(out.index?.stats)delete out.index.stats;
  while(bytes()>budget&&(out.paths?.length>1||out.rows?.length>1)){if(out.paths?.length>1)out.paths.pop();else out.rows.pop();out.previewOmissions=true;}
  // A long single trace stays inspectable in the retained view; never clip it into a false complete path.
  if(bytes()>budget&&out.paths?.length){out.pathSummary=out.paths.map(p=>({proof:p.proof,steps:p.nodes.length,from:p.nodes[0],to:p.nodes.at(-1),assumptions:p.assumptions.slice(0,5)}));out.paths=[];out.previewOmissions=true;}
  if(bytes()>budget&&out.rows?.length){out.rows=[];out.previewOmissions=true;}
  if(bytes()>budget){out.gaps=[];out.rules=undefined;out.stats=undefined;out.previewOmissions=true;}
  if(bytes()>budget)throw Object.assign(Error('Lineage identity exceeds the model result budget; narrow the query or raise max_output_bytes'),{code:'DT_RESULT_TOO_LARGE'});
  if(out.previewOmissions)out.previewNote='Preview omits evidence. Inspect the retained view or increase max_output_bytes. Pagination continues the retained page.';
  if(bytes()>max)throw Object.assign(Error('Lineage preview exceeds max_output_bytes'),{code:'DT_RESULT_TOO_LARGE'});
  return out;
}
module.exports={index,query,compact};
