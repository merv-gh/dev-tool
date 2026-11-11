// Optional observation boundary for OpenAI-compatible clients. One upstream
// request, unchanged payload, streaming backpressure, no retries or tool replay.
const {once}=require('node:events'),C=require('./config'),O=require('./observations');
const invalid=message=>Object.assign(Error(message),{statusCode:400,code:'DT_ARGUMENT_INVALID'});
function upstream(){const c=C.getPersonal().llm;if(c.gatewayEnabled!==true&&process.env.DT_MODEL_GATEWAY!=='1')throw Object.assign(Error('Model observation gateway is disabled; enable llm.gatewayEnabled explicitly'),{statusCode:403,code:'DT_MODEL_GATEWAY_DISABLED'});require('./access').checkTool('context_hint');if(!c.baseUrl)throw Object.assign(Error('Configure llm.baseUrl for the model observation gateway'),{statusCode:503,code:'DT_MODEL_UNCONFIGURED'});const u=new URL(c.baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||/\/model\/v1\/?$/.test(u.pathname))throw invalid('Use an upstream HTTP(S) API base without credentials/query; do not point llm.baseUrl at the observation gateway');const models=Array.isArray(c.gatewayModels)?c.gatewayModels:[c.model];if(!models.length||models.length>100||models.some(m=>typeof m!=='string'||!m||m.length>200))throw invalid('Configure llm.model or an explicit gatewayModels allowlist');return {base:u.href.replace(/\/$/,''),key:c.key,models,timeout:Math.max(1000,Math.min(1800000,Number(c.requestTimeoutMs)||300000))};}
function metadataParser(type,started){let buffer='',bytes=0,json=[],overflow=false,decoder=new TextDecoder(),facts={},done=false;
 const inspect=value=>{Object.assign(facts,O.usage(value));if(value?.error)facts.error=true;if(facts.firstTokenMs===undefined&&value?.choices?.some(c=>c.delta?.content||c.delta?.reasoning_content||c.delta?.tool_calls?.length)){facts.firstTokenMs=Date.now()-started;}};
 return {push(chunk){bytes+=chunk.length;if(type.includes('text/event-stream')){buffer+=decoder.decode(chunk,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).replace(/\r$/,'');buffer=buffer.slice(at+1);if(overflow){if(!line)overflow=false;continue;}if(line.startsWith('data:')){const text=line.slice(5).trim();if(text==='[DONE]'){done=true;continue;}if(text.length<=65536)try{inspect(JSON.parse(text));}catch{}}}if(buffer.length>65536){buffer='';overflow=true;}}
 else if(bytes<=2*1048576)json.push(chunk);else json=[];
 },finish(){if(!type.includes('text/event-stream')&&bytes<=2*1048576)try{inspect(JSON.parse(Buffer.concat(json).toString()));}catch{}return {...facts,responseBytes:bytes,...(type.includes('text/event-stream')&&!done?{error:true,errorCode:'STREAM_INCOMPLETE'}:{})};}};
}
async function proxy(req,res,route,body,span){
 const cfg=upstream(),method=req.method;let payload;
 if(route==='models'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({object:'list',data:cfg.models.map(id=>({id,object:'model',owned_by:'configured-upstream'}))}));return;}
 if(route==='chat/completions'){
  if(!body||Array.isArray(body)||typeof body.model!=='string'||!Array.isArray(body.messages)||body.messages.length>10000||typeof body.stream!=='undefined'&&typeof body.stream!=='boolean')throw invalid('Provide model, messages and an optional boolean stream');
  if(!cfg.models.includes(body.model))throw Object.assign(Error('Model is not in the configured gateway allowlist'),{statusCode:403,code:'DT_MODEL_NOT_ALLOWED'});
  payload=JSON.stringify(body);
 }
 const controller=new AbortController(),timeout=AbortSignal.timeout(cfg.timeout),signal=req.dtSignal?AbortSignal.any([req.dtSignal,controller.signal,timeout]):AbortSignal.any([controller.signal,timeout]);
 const attributed=!!(req.headers['x-openwebui-chat-id']||req.headers['x-chat-id']||req.headers['x-dt-story']||require('./access').current().storyBound);
 const purpose=attributed?'chat':'chat.unattributed',observation=route==='chat/completions'?O.start({kind:'model',name:'chat.completions',source:'model-gateway',purpose,model:body.model,endpoint:new URL(cfg.base).origin,requestBytes:Buffer.byteLength(payload),attributed}):null;
 let facts={},reader,complete=false;
 try{
  const response=await fetch(cfg.base+'/'+route,{method,headers:{...(cfg.key?{authorization:'Bearer '+cfg.key}:{}),...(payload?{'content-type':'application/json'}:{})},...(payload?{body:payload}:{}),signal,redirect:'error'});
  facts={httpStatus:response.status,headersMs:Date.now()-(observation?.row.startedAt||Date.now())};
  const headers={'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'};for(const key of ['retry-after','retry-after-ms','x-request-id'])if(response.headers.has(key))headers[key]=response.headers.get(key);
  res.writeHead(response.status,headers);res.flushHeaders();
  const parser=metadataParser(headers['content-type'],observation?.row.startedAt||Date.now());reader=response.body?.getReader();
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;parser.push(value);if(!res.write(value))await once(res,'drain',{signal});}
  const observed=parser.finish();facts={...facts,...observed,error:!response.ok||observed.error,errorCode:!response.ok?'HTTP_'+response.status:observed.errorCode||(observed.error?'UPSTREAM_ERROR':undefined)};complete=true;res.end();observation?.end(null,facts);span?.end(facts.error?Object.assign(Error('Upstream response failed'),{code:facts.errorCode}):null,{'http.response.status_code':response.status,'dt.model.purpose':purpose,'gen_ai.usage.input_tokens':facts.inputTokens,'gen_ai.usage.output_tokens':facts.outputTokens});
 }catch(error){const cancelled=req.dtSignal?.aborted;observation?.end(cancelled?Object.assign(Error('Client disconnected'),{code:'DT_CANCELLED'}):error,{...facts,errorCode:timeout.aborted?'TIMEOUT':undefined});
  span?.end(cancelled?Object.assign(Error('Client disconnected'),{code:'DT_CANCELLED'}):error,{'http.response.status_code':facts.httpStatus});if(!res.headersSent)throw Object.assign(Error(timeout.aborted?'Model request timed out':'Model upstream request failed'),{statusCode:timeout.aborted?504:502,code:timeout.aborted?'DT_MODEL_TIMEOUT':'DT_MODEL_NETWORK'});
  res.destroy();
 }finally{if(!complete){controller.abort();try{await reader?.cancel();}catch{}}}
}
async function handle(req,res,route,body){const span=route==='chat/completions'?require('./telemetry').begin('model.gateway',{'dt.kind':'model','gen_ai.operation.name':'chat','gen_ai.request.model':body?.model}):null;const run=()=>proxy(req,res,route,body,span);try{return await(span?span.run(run):run());}catch(error){span?.end(error);throw error;}finally{span?.end();}}
module.exports={handle,metadataParser};
