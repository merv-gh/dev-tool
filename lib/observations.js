// Request metadata is unsampled; diagnostic traces remain a separate opt-in.
// No prompts, arguments, response bodies, headers or exception messages here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('./access'),C=require('./config'),als=new(require('node:async_hooks').AsyncLocalStorage)();
const instance=crypto.randomUUID(),active=new Set(),inFlight=new Map();let store,dropped=0,closed=false;
const allowedPurposes=new Set(['tool','admin.suggest','admin.interpret','context.hint','docs.rerank','docs.vision','docs.relations','docs.embed','chat','chat.task','chat.unattributed']);
const token=(v,max=120)=>typeof v==='string'&&new RegExp('^[a-zA-Z0-9_.:/ -]{1,'+max+'}$').test(v)?require('./redact').clean(v):undefined;
const number=v=>Number.isFinite(v)&&v>=0?v:undefined;
const file=()=>path.join(C.PATHS.cache,'telemetry','requests.sqlite');
function enabled(){try{return process.env.DT_REQUEST_EVENTS!=='0'&&C.load().raw.telemetry?.requestEvents!==false;}catch{return false;}}
function storage(){if(!store&&!closed)store=new(require('./telemetry-store').TraceStore)(file(),{maxRows:25000,workerFile:'observation-worker.js'});return store;}
function put(row){try{storage()?.put(row);}catch{dropped++;}}
function status(){return {enabled:enabled(),...store?.status(),dropped:dropped+(store?.status().dropped||0),retentionRows:25000,retentionDays:7};}
function start(input){
 if(!enabled()||closed)return null;
 try{if(active.size>=1024){dropped++;return null;}
 const owner=A.owner(),execution=require('./execution').current(),trace=require('./telemetry').carrier()?.traceparent?.split('-'),id=crypto.randomUUID(),parent=als.getStore();
 const row={id,scope:owner.scopeKey,owner:{principalId:owner.principalId,storyId:owner.storyId},instance,startedAt:Date.now(),kind:input.kind==='model'?'model':'tool',name:token(input.name)||'request',purpose:allowedPurposes.has(input.purpose)?input.purpose:'tool',source:token(input.source)||'api',state:'running',...(input.name==='tool_execute'?{wrapper:true}:{}),...(execution?{executionId:execution.id,parentExecutionId:execution.parentId}:{}),...(parent?{parentId:parent.id}:{}),...(trace?{traceId:trace[1],spanId:trace[2]}:{}),...(token(input.model)?{model:token(input.model)}:{}),...(token(input.endpoint)?{endpoint:token(input.endpoint)}:{}),...(number(input.requestBytes)!==undefined?{requestBytes:input.requestBytes}:{}),...(input.attributed!==undefined?{attributed:!!input.attributed}:{})};
 const key=row.kind==='model'?(input.endpoint||'model'):null;if(key){inFlight.set(key,(inFlight.get(key)||0)+1);row.inFlightAtStart=inFlight.get(key);}active.add(id);put(row);let ended=false;
 return {id,row,run:fn=>als.run(row,fn),end(error,final={}){if(ended)return;ended=true;active.delete(id);if(key){const n=inFlight.get(key)-1;if(n)inFlight.set(key,n);else inFlight.delete(key);}
  try{const cancelled=error?.name==='AbortError'||error?.code==='DT_CANCELLED';Object.assign(row,{endedAt:Date.now(),durationMs:Date.now()-row.startedAt,state:cancelled?'cancelled':error||final.error?'error':'ok'});
   for(const k of ['httpStatus','responseBytes','requestBytes','headersMs','firstTokenMs','inputTokens','outputTokens','totalTokens','cachedTokens','itemCount'])if(number(final[k])!==undefined)row[k]=final[k];
   if(final.usageKnown!==undefined)row.usageKnown=!!final.usageKnown;
   if(['failed','passed','unknown','pending','not-applicable'].includes(final.application))row.application=final.application;
   if(token(final.errorCode,64))row.errorCode=token(final.errorCode,64);
   else if(error)row.errorCode=cancelled?'DT_CANCELLED':/^[A-Z0-9_]{1,64}$/.test(error.code||'')?error.code:error?.name==='TimeoutError'?'TIMEOUT':'ERROR';
   if(final.view&&/^\/(show|view|patch|logs|map|files)\/[a-z0-9]+$/.test(final.view))row.view=final.view;
   put({...row});if(row.kind==='model')require('./operational-metrics').record('model',row.durationMs,row.state==='ok'?'succeeded':row.state==='cancelled'?'cancelled':'failed');
  }catch{dropped++;}
 }};
 }catch{dropped++;return null;}
}
function usage(value){const u=value?.usage;if(!u||typeof u!=='object')return {};return {usageKnown:[u.prompt_tokens,u.input_tokens,u.completion_tokens,u.output_tokens].some(Number.isFinite),inputTokens:u.prompt_tokens??u.input_tokens,outputTokens:u.completion_tokens??u.output_tokens,totalTokens:u.total_tokens,cachedTokens:u.prompt_tokens_details?.cached_tokens??u.input_tokens_details?.cached_tokens};}
function toolResult(name,value){const e=require('./call-outcome').classify(name,value),status=e.execution?.status;let view;try{const u=new URL(value?.view);if(!u.search&&!u.hash)view=u.pathname;}catch{}return {application:e.failed?'failed':e.execution?.verdict==='passed'||status==='passed'?'passed':e.job?'pending':e.execution?'unknown':'not-applicable',view,...(Array.isArray(value?.rows)?{itemCount:value.rows.length}:{})};}
function query(input={}){
 const now=Date.now(),q={from:input.from==null?now-3600000:Number(input.from),to:input.to==null?now:Number(input.to),q:String(input.q||''),kind:input.kind||'',name:input.name||'',purpose:input.purpose||'',outcome:input.outcome||'',httpStatus:input.httpStatus?Number(input.httpStatus):null,minMs:input.minMs?Number(input.minMs):0,limit:input.limit==null?50:Number(input.limit),cursor:input.cursor?Number(input.cursor):null,scope:input.scope||'chat'};
 if(!Number.isSafeInteger(q.from)||!Number.isSafeInteger(q.to)||q.from<0||q.to<q.from||q.to-q.from>7*86400000||q.q.length>200||!['','tool','model'].includes(q.kind)||!['','failed','ok','error','cancelled','open','capacity'].includes(q.outcome)||!['chat','installation'].includes(q.scope)||!Number.isSafeInteger(q.limit)||q.limit<1||q.limit>200||q.cursor!==null&&(!Number.isSafeInteger(q.cursor)||q.cursor<1)||q.httpStatus!==null&&(!Number.isInteger(q.httpStatus)||q.httpStatus<100||q.httpStatus>599)||!Number.isFinite(q.minMs)||q.minMs<0||q.minMs>86400000||q.name&&!token(q.name)||q.purpose&&!allowedPurposes.has(q.purpose))throw Object.assign(Error('Invalid request-event filters; choose a time window up to seven days and valid field values.'),{statusCode:400,code:'DT_ARGUMENT_INVALID'});
 return q;
}
const scopeFor=q=>{if(q.scope==='installation'){A.requireAdmin();return null;}return A.current().scopeKey;};
function present(row){if(!row)return row;const {scope,instance:producer,...value}=row;return {...value,...(row.state==='running'?{live:producer===instance&&active.has(row.id),endObserved:false}:{}),...(row.view?{viewUrl:require('./results').publicUrl()+row.view}:{})};}
async function list(input={}){
 const q=query(input),scope=scopeFor(q);let data={records:[],summary:{total:0},timeline:{from:q.from,to:q.to,points:[]},groups:[],nextCursor:null};
 if(store||fs.existsSync(file())){const s=storage();await s?.flush();try{data=await s.request('query',{scope,query:q});}catch{data.storageUnavailable=true;}}
 return {protocol:'dt.request-events/v1',...data,records:data.records.map(present),filters:q,storage:status(),coverage:{tools:'Observed dev-tool invocations; dispatcher wrappers are separate from their target calls.',modelHelpers:'Instrumented Admin/context/documentation model calls.',chat:'Only calls routed through /model/v1/chat/completions are observed. Direct Open WebUI → GPUStack calls and its background requests are outside this journal.',payloads:'Metadata only. Existing result links retain their normal access checks.',sampling:'Unsampled request events, independent of per-chat diagnostic tracing.'},gateway:{path:'/model/v1',enabled:C.getPersonal().llm.gatewayEnabled===true||process.env.DT_MODEL_GATEWAY==='1',configured:!!C.getPersonal().llm.baseUrl,upstreamModel:C.getPersonal().llm.model||null},meaning:'Counts and latency use all retained matching events, not only this page. Time filters select request start times. Token sums cover only responses reporting usage. Open events have no observed end. Retention and dropped writes bound completeness.'};
}
async function get(id,input={}){if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(Error('Invalid event ID'),{statusCode:400});const q=query(input),scope=scopeFor(q),s=storage();await s.flush();return present(await s.request('event',{scope,eventId:id}));}
async function close(){closed=true;await store?.close();}
module.exports={enabled,start,usage,toolResult,list,get,query,status,close,flush:async()=>{await store?.flush();}};
