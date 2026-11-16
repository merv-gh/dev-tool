const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
async function seed(home,{auth=false}={}){
 const calls=[],state={failUat:false,partial:false,delay:0,closed:0};
 const rows=env=>[{schema:'sales',name:'price',arguments:'id bigint',kind:'function',returns:'numeric',language:'sql',definition_hash:env==='dev'?'price-v1':'price-v2'},{schema:'sales',name:'price',arguments:'id text',kind:'function',returns:'numeric',language:'sql',definition_hash:'same-overload'},...(env==='dev'?[{schema:'sales',name:'close_order',arguments:'id bigint',kind:'procedure',returns:null,language:'plpgsql',definition_hash:'close-v1'}]:[]),...(env==='uat'?[{schema:'sales',name:'audit_order',arguments:'id bigint',kind:'procedure',returns:null,language:'plpgsql',definition_hash:'audit-v1'}]:[])];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/adapter'){
   const chunks=[];for await(const b of req)chunks.push(b);const request=JSON.parse(Buffer.concat(chunks));calls.push({kind:'adapter',...request});let result;
   if(request.tool==='pg_query'){
    if(state.failUat&&request.arguments.env==='uat'){res.writeHead(503);res.end('unavailable');return;}
    const data=rows(request.arguments.env);result={db:request.arguments.db,rows:data,total:state.partial&&request.arguments.env==='uat'?3000:data.length,ms:3};
   }else if(request.tool==='es_health')result={summary:{status:'green',nodes:3},rows:[],total:0};
   else result={summary:{groups:2,lagging:1},rows:[{group:'invoice-workers',lag:42,state:'STABLE'}],total:1};
   const timer=setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({protocol:'dt.tool/v1',requestId:request.requestId,tool:request.tool,result}));},state.delay);res.once('close',()=>{if(!res.writableEnded){state.closed++;clearTimeout(timer);}});return;
  }
  calls.push({kind:'consul',url:req.url});const env=req.url.startsWith('/uat/')?'uat':'dev';let value;
  if(/\/v1\/catalog\/services$/.test(req.url))value={'orders-api':[],'billing-api':[]};
  else if(req.url.includes('/v1/health/state/any'))value=['orders-api','billing-api'].map(service=>({Node:'fixture-'+env,ServiceID:service+'-1',ServiceName:service,CheckID:'readiness',Name:'Readiness',Status:'passing',Output:''}));
  else if(req.url.includes('/v1/health/service/')){const service=decodeURIComponent(req.url.split('/').pop());value=[{Node:{Node:'fixture-'+env},Service:{ID:service+'-1',Service:service,Address:'127.0.0.1',Port:server.address().port,Meta:{version:service==='orders-api'?(env==='dev'?'2.8.1':'2.8.0'):'1.4.0',commit:service==='orders-api'?env+'-commit':'same-commit'}},Checks:[{Name:'Readiness',Status:'passing'}]}];}
  else{res.writeHead(404);res.end('No fixture version endpoint; version comes from Consul metadata');return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const backend={url:base+'/adapter',scopeAware:true,token:'fixture-adapter-token-012345'},config={envs:{dev:{consul:base+'/dev',postgres:{orders:'postgres://fixture:fixture@127.0.0.1:1/orders'}},uat:{consul:base+'/uat',postgres:{orders:'postgres://fixture:fixture@127.0.0.1:1/orders',archive:'postgres://fixture:fixture@127.0.0.1:1/archive'}}},server:{publicUrl:'http://127.0.0.1:4000'},scripts:{starters:false},tools:{backends:{pg_query:backend,es_health:backend,kafka_lag:backend}},...(auth?{}:{})};
 if(auth)config.server.accessTokens=[{id:'admin',role:'admin',token:'pages-admin-token-0123456'},{id:'reader',role:'user',token:'pages-reader-token-012345'},{id:'limited',role:'user',token:'pages-limited-token-01234',tools:['ui_page'],envs:['dev']}];
 fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
 for(const env of ['dev','uat']){const dir=path.join(home,'cache',env);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'consul.json'),JSON.stringify({services:{'orders-api':{},'billing-api':{}}}));}
 return {base,calls,state,rows,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
module.exports={seed};
