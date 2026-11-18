const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{WebSocket}=require('ws');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-tool-ws-'));for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_API_KEY','DT_SECURITY_PROFILE'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy'});
let server,upstream,base,hits=0,closed=0,consulCalls=0;
const headers=(token='admin',story='one')=>({authorization:'Bearer fixture-'+token+'-access-token-long','x-dt-story':story});
test.before(async()=>{
 upstream=http.createServer((req,res)=>{if(req.url==='/v1/catalog/services'){consulCalls++;return res.end(JSON.stringify({orders:[],other:[]}));}if(req.url.startsWith('/v1/health/service/')){consulCalls++;return res.end(JSON.stringify([{Node:{Node:'node',Address:'127.0.0.1'},Service:{ID:'new',Address:'127.0.0.1',Port:upstream.address().port},Checks:[{Status:'passing'}]}]));}hits++;res.setHeader('content-type','application/json');if(req.url==='/slow'){res.on('close',()=>{closed++;upstream.emit('api-close');});return;}res.end('{"status":"UP"}');});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+upstream.address().port;
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{consul:origin},uat:{}},server:{accessTokens:[{id:'administrator',role:'admin',token:'fixture-admin-access-token-long'},{id:'reader',role:'user',token:'fixture-reader-access-token-long',envs:['dev']}]},scripts:{starters:false}}));server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{for(const s of [server,upstream].filter(Boolean)){s.closeAllConnections();await new Promise(r=>s.close(r));}await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
async function client(options){const ws=new WebSocket(base.replace('http:','ws:')+'/api/tool-events',options),frames=[],waiters=[];ws.on('message',raw=>{const f=JSON.parse(raw);frames.push(f);for(const w of [...waiters])if(w.match(f)){waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve(f);}});await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return {ws,frames,send:f=>ws.send(JSON.stringify(f)),wait:match=>new Promise((resolve,reject)=>{const found=frames.find(match);if(found)return resolve(found);const w={match,resolve,timer:setTimeout(()=>reject(Error('Missing websocket frame')),7000)};waiters.push(w);}),close:()=>new Promise(r=>{if(ws.readyState===WebSocket.CLOSED)return r();ws.once('close',r);ws.close();})};}
const terminal=(c,id)=>c.wait(f=>f.id===id&&['result','error'].includes(f.type));
test('multiplexed commands authenticate per frame, preserve scope and return accepted/result without HTTP chains',async()=>{
 const c=await client();try{
  c.send({type:'call',id:'missing',tool:'script_list',args:{}});assert.equal((await terminal(c,'missing')).status,403);
  c.send({type:'call',id:'save',tool:'script_save',headers:headers(),args:{id:'own/check',description:'Scoped example',steps:[{set:{ok:true}}],expected_revision:null}});assert.equal((await terminal(c,'save')).result.saved,true);assert.ok(c.frames.some(f=>f.id==='save'&&f.type==='accepted'));
  c.send({type:'call',id:'read',tool:'script_list',headers:headers('reader','one'),args:{}});assert.equal((await terminal(c,'read')).result.scripts.length,0);
  c.send({type:'call',id:'env',tool:'api_client_catalog',headers:headers('reader'),args:{env:'uat'}});assert.equal((await terminal(c,'env')).status,403);
  c.send({type:'call',id:'bad',tool:'missing_tool',headers:headers(),args:{}});assert.match((await terminal(c,'bad')).error,/Unknown tool/);
  c.send({type:'call',id:'shape',tool:'script_list',headers:headers(),args:[]});assert.equal((await terminal(c,'shape')).status,400);
 }finally{await c.close();}
});
test('one replay command resolves stale Consul IPs, emits network phases, and skips full catalog rebuilding',async()=>{
 const cache=path.join(home,'cache/dev/consul.json');fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,JSON.stringify({services:{orders:{observedAt:'2000-01-01',instances:[{id:'old',address:'127.0.0.1',port:1,status:'passing'}]}}}));
 const old=require('../lib/catalog').build;let builds=0;require('../lib/catalog').build=()=>{builds++;throw Error('No rebuild allowed');};
 const c=await client(),before=hits,consulBefore=consulCalls;try{
  c.send({type:'call',id:'replay',tool:'api_request_replay',headers:headers(),args:{request:{method:'GET',url:'http://127.0.0.1:1/healthcheck'},service_target:{env:'dev',service:'orders',instance_id:'old'}}});const f=await terminal(c,'replay');assert.equal(f.result.response.status,200,JSON.stringify(f));assert.equal(f.result.response.body.value.status,'UP');assert.equal(f.result.resolvedTarget.id,'new');assert.equal(hits,before+1);assert.equal(consulCalls,consulBefore+1);assert.equal(builds,0);
  for(const phase of ['preparing','consul-fetching','connecting','headers','received','saving'])assert.ok(c.frames.some(f=>f.phase===phase),phase);
  c.send({type:'call',id:'warm',tool:'api_request_replay',headers:headers(),args:{request:{method:'GET',url:'http://127.0.0.1:1/healthcheck'},service_target:{env:'dev',service:'orders'}}});assert.equal((await terminal(c,'warm')).result.response.status,200);assert.equal(consulCalls,consulBefore+1);
  c.send({type:'call',id:'refresh',tool:'api_instances_refresh',headers:headers(),args:{env:'dev',catalog:true,service:'orders'}});assert.equal((await terminal(c,'refresh')).result.services,2);assert.equal(consulCalls,consulBefore+3);
 }finally{require('../lib/catalog').build=old;await c.close();}
});
test('cancel interrupts the actual request; a lost connection never replays a mutation',async()=>{
 const c=await client(),url='http://127.0.0.1:'+upstream.address().port+'/slow',before=hits;
 try{c.send({type:'call',id:'slow',tool:'api_request_replay',headers:headers(),args:{request:{method:'POST',url}}});await c.wait(f=>f.id==='slow'&&f.phase==='connecting');await new Promise(r=>setTimeout(r,30));
  c.send({type:'cancel',id:'slow',headers:headers('reader')});assert.equal((await c.wait(f=>f.type==='control-error')).status,403);
  const disconnected=new Promise(r=>upstream.once('api-close',r));c.send({type:'cancel',id:'slow',headers:headers()});assert.match((await terminal(c,'slow')).error,/cancel/i);assert.equal(hits,before+1);await Promise.race([disconnected,new Promise((_,reject)=>setTimeout(()=>reject(Error('HTTP did not abort')),1200).unref())]);assert.ok(closed>=1);
 }finally{await c.close();}
 const next=await client(),start=hits;next.send({type:'call',id:'lost',tool:'api_request_replay',headers:headers(),args:{request:{method:'POST',url}}});await next.wait(f=>f.phase==='connecting');await new Promise(r=>setTimeout(r,30));await next.close();await new Promise(r=>setTimeout(r,30));assert.equal(hits,start+1);
});
test('event subscriptions stream and reconnect with cursor under the authenticated story',async()=>{
 const c=await client();try{c.send({type:'subscribe',id:'events',channel:'test:events',headers:headers()});const ready=await c.wait(f=>f.type==='subscribed');assert.equal(ready.events.length,0);
  await require('../lib/access').run({multiUser:true,principalId:'administrator',role:'admin',storyId:'one'},()=>require('../lib/ui-events').publish('test:events','example.changed',{value:42}));const event=await c.wait(f=>f.type==='event');assert.equal(event.event.data.value,42);
  c.send({type:'unsubscribe',id:'events',headers:headers()});c.send({type:'subscribe',id:'resume',channel:'test:events',after:ready.cursor,headers:headers()});const r=await c.wait(f=>f.id==='resume'&&f.type==='subscribed');assert.equal(r.events[0].id,event.event.id);
  c.send({type:'subscribe',id:'other',channel:'test:events',after:ready.cursor,headers:headers('reader')});assert.equal((await c.wait(f=>f.id==='other'&&f.type==='subscribed')).reset,true);
 }finally{await c.close();}
});
test('malformed input stays bounded, dead peers terminate, and origin restrictions match the HTTP policy',async t=>{
 const c=await client();try{c.ws.send('{secret-not-json');const f=await c.wait(f=>f.id==='invalid');assert.equal(f.error,'Invalid command JSON');assert.doesNotMatch(JSON.stringify(f),/secret-not-json/);
  c.send({id:'wrong',type:'unknown',headers:headers()});assert.equal((await terminal(c,'wrong')).status,400);
 }finally{await c.close();}
 const config=JSON.parse(fs.readFileSync(path.join(home,'config.json')));config.server.allowedOrigins=['https://allowed.example'];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();try{await assert.rejects(client({origin:'https://untrusted.example'}),/403/);}finally{delete config.server.allowedOrigins;fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();}
 t.mock.timers.enable({apis:['setInterval']});const dead=await client({autoPong:false}),ping=new Promise(r=>dead.ws.once('ping',r)),lost=new Promise(r=>dead.ws.once('close',r));t.mock.timers.tick(20000);await ping;t.mock.timers.tick(20000);await lost;assert.equal(dead.ws.readyState,WebSocket.CLOSED);
});
