// Reusable read adapters for common dashboard questions. Each underlying call
// still crosses the ordinary registry, permissions, rate limiter and telemetry.
const M=require('./ui-page-model');
const ROUTINES_SQL=`select n.nspname as schema, p.proname as name,
 pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
 case p.prokind when 'p' then 'procedure' else 'function' end as kind,
 pg_catalog.pg_get_function_result(p.oid) as returns, l.lanname as language,
 md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_hash
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
join pg_catalog.pg_language l on l.oid=p.prolang
where n.nspname=any($1::text[]) and p.prokind in ('f','p')
order by n.nspname,p.proname,arguments limit 2001`;
function version(instance){
 let v=instance.version;if(typeof v==='string'){try{const parsed=JSON.parse(v);v=parsed&&typeof parsed==='object'?parsed:{version:typeof parsed==='string'?parsed:v};}catch{v={version:v};}}
 if(!v||typeof v!=='object')v={};
 return {version:v.version||v.build?.version||v.app?.version||instance.meta?.version||null,commit:v.commit?.id||v.commit||v.git?.commit?.id||v.git?.commit||instance.meta?.commit||null};
}
async function data(a){
 const env=a.env||require('./config').envNames()[0];require('./config').getEnv(env);const T=require('./tools'),required=a.kind==='service_versions'?'consul_service':'pg_query';
 if(!(await T.schemas()).some(t=>t.name===required))throw Object.assign(Error('Required read tool is unavailable: '+required),{code:'DT_ACCESS_DENIED',statusCode:403});
 if(a.kind==='pg_routines'){
  if(typeof a.db!=='string'||!a.db||!Array.isArray(a.schemas)||!a.schemas.length||a.schemas.length>20||a.schemas.some(s=>typeof s!=='string'||s.length>200))throw M.invalid('pg_routines requires an exact database and 1..20 schemas');
  const r=await T.call('pg_query',{env,db:a.db,sql:ROUTINES_SQL,params:[a.schemas],all:true},{source:'ui-page'}),rows=r.rows||[],complete=rows.length<=2000&&r.total<=rows.length;
  return M.bounded(rows.slice(0,2000),{complete,gaps:complete?[]:['Routine query reached its 2,000-row limit; narrow schemas before interpreting absence'],env,db:r.db,kind:a.kind,observedAt:new Date().toISOString(),evidence:r.view});
 }
 if(a.kind!=='service_versions'||!Array.isArray(a.services)||!a.services.length||a.services.length>20||a.services.some(s=>typeof s!=='string'||!s||s.length>300))throw M.invalid('service_versions requires 1..20 exact service names');
 const rows=[],gaps=[];let complete=true;
 for(const service of new Set(a.services)){
  require('./execution').check();try{
   const r=await T.call('consul_service',{env,name:service},{source:'ui-page'});
   if(r.service!==service){rows.push({service,environment:env,status:'not registered',replicas:0,passing:0,version:null,commit:null,version_state:'not registered'});continue;}
   const instances=r.instances||[],versions=instances.map(version),reported=[...new Set(versions.map(v=>v.version).filter(Boolean))],commits=[...new Set(versions.map(v=>v.commit).filter(Boolean).map(x=>typeof x==='object'?JSON.stringify(x):String(x)))];
   rows.push({service,environment:env,status:instances.some(i=>i.status==='critical')?'critical':instances.some(i=>i.status==='warning')?'warning':instances.length?'passing':'no instances',replicas:instances.length,passing:instances.filter(i=>i.status==='passing').length,version:versions.every(v=>v.version)?reported.join(', ')||null:null,reported_versions:reported,commit:commits.join(', ')||null,version_state:reported.length>1?'mixed':reported.length&&versions.every(v=>v.version)?'reported':'not fully reported',instances:instances.slice(0,200).map((i,n)=>({id:i.id,status:i.status,...versions[n]}))});
  }catch(e){if(require('./execution').signal()?.aborted)throw e;complete=false;gaps.push(service+': '+require('./redact').clean(e.message));}
 }
 return M.bounded(rows,{complete,gaps,env,kind:a.kind,observedAt:new Date().toISOString()});
}
module.exports={data,ROUTINES_SQL,version};
