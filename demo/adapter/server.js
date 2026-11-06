#!/usr/bin/env node
// Dependency-free reference transport. Port this wire contract to any language.
// This is an in-memory conformance fixture, not a production storage service.
const http=require('node:http'),crypto=require('node:crypto');
function start({port=7090,token=process.env.DT_ADAPTER_TOKEN}={}){
 if(!token||token.length<16)throw Error('Set DT_ADAPTER_TOKEN to at least 16 characters');const notes=new Map();
 const capabilities={protocol:'dt.adapter-capabilities/v1',id:'reference-fixture',scopeAware:true,capabilities:[{operation:'find',languages:['text'],evidence:'fixture',sourceIdentity:'reference-fixture-v1',gaps:['Invented shared catalog; no language parser or external system.']}]};
 const server=http.createServer(async(req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  const secret=(req.headers.authorization||'').replace(/^Bearer /,'');if(secret.length!==token.length||!crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(token)))return send(401,{error:'Service authentication required'});
  if(req.method==='GET'&&req.url==='/capabilities')return send(200,capabilities);
  if(req.method!=='POST'||req.url!=='/execute')return send(404,{error:'Not found'});
  let input;try{let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>2*1024*1024)return send(413,{error:'Input too large'});chunks.push(c);}input=JSON.parse(Buffer.concat(chunks));}catch{return send(400,{error:'Invalid JSON'});}
  const c=input.context,scope=c&&crypto.createHash('sha256').update(c.principalId+'\0'+c.storyId).digest('hex').slice(0,32),envelope={protocol:'dt.tool/v1',requestId:input.requestId,tool:input.tool};
  const error=(code,message)=>send(200,{...envelope,error:{code,message,retryable:false}});
  if(input.protocol!=='dt.tool/v1'||typeof input.requestId!=='string'||!c||c.scopeKey!==scope)return error('DT_SCOPE_INVALID','Trusted scope is required');
  const args=input.arguments||{},key=scope+'\0'+String(args.name||'note');
  if(input.tool==='find')return send(200,{...envelope,result:['pg fixture sales.refunds ~2: id int'].filter(s=>s.includes(String(args.q||'')))});
  if(input.tool==='fixture_put'){notes.set(key,args.value);return send(200,{...envelope,result:{saved:true}});}
  if(input.tool==='fixture_get')return notes.has(key)?send(200,{...envelope,result:{value:notes.get(key)}}):error('NOT_FOUND','No note in this scope');
  if(input.tool==='fixture_delay'){const timer=setTimeout(()=>send(200,{...envelope,result:{completed:true}}),1000);res.once('close',()=>clearTimeout(timer));return;}
  return error('UNSUPPORTED_OPERATION','Operation is not supported');
 });server.listen(port,'127.0.0.1');return server;
}
module.exports={start};if(require.main===module)start({port:Number(process.argv[2]||7090)}).on('listening',()=>console.error('Reference adapter ready on localhost'));
