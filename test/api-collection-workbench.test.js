const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-api-workbench-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_TOOL_PROFILE','DT_API_KEY','DT_SECURITY_PROFILE'])delete process.env[k];
Object.assign(process.env,{DT_HOME:home,DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});
let hits=0,broken=false,port=12345,origin,server,app;
test.before(async()=>{
 server=http.createServer((req,res)=>{hits++;if(req.url.startsWith('/drop'))return req.socket.destroy();if(req.url.startsWith('/slow')){const timer=setTimeout(()=>res.end('{}'),10000);res.on('close',()=>clearTimeout(timer));return;}if(broken){res.statusCode=503;return res.end('unavailable');}res.setHeader('content-type','application/json');res.end(JSON.stringify([{Node:{Node:'node',Address:'127.0.0.1'},Service:{ID:'new',Address:'127.0.0.1',Port:port,Tags:[]},Checks:[{Status:'passing'}]}]));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{consul:origin,postgres:{orders:'postgres://unused'}},uat:{}},scripts:{starters:false}}));
 app=require('../server').start({port:0});await new Promise(r=>app.once('listening',r));
});
test.after(async()=>{for(const s of [app,server]){s.closeAllConnections();await new Promise(r=>s.close(r));}await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
const T=()=>require('../lib/tools'),S=()=>require('../lib/scripts'),A=()=>require('../lib/access'),L=()=>require('../lib/workflow-library');
test('network failure is retained, sanitized, correlated and returned over HTTP without replay',async()=>{
 const before=hits;
 const r=await fetch('http://127.0.0.1:'+app.address().port+'/api/tool/api_request_replay',{method:'POST',headers:{'content-type':'application/json','x-dt-story':'network'},body:JSON.stringify({request:{method:'POST',url:origin+'/drop?token=private-secret-value',headers:{authorization:'Bearer private-bearer-value'},body:{kind:'json',value:{password:'private-password'}}}})});
 assert.equal(r.status,502);const body=await r.json();assert.equal(body.code,'DT_API_NETWORK');assert.equal(hits,before+1);assert.equal(body.exchange.response.status,null);assert.equal(body.exchange.failure.outcome,'unknown');assert.ok(body.exchange.failure.executionId);assert.match(body.exchange.view,/\/show\//);assert.doesNotMatch(JSON.stringify(body),/private-secret-value|private-bearer-value|private-password/);
 A().run({storyId:'network'},()=>{const e=require('../lib/api-client').get(body.exchange.id);assert.equal(e.failure.executionId,body.exchange.failure.executionId);assert.match(e.failure.code,/UND_ERR_SOCKET|ECONN/);assert.ok(require('../lib/trace').tail({lines:100}).some(r=>r.tool==='api_request_replay'&&r.event==='failed'));});
 await assert.rejects(T().call('api_request_replay',{request:{method:'GET',url:origin+'/slow'},timeoutMs:15}),e=>e.exchange?.failure.code==='TIMEOUT');
});
test('live Consul refresh changes only one service and keeps old evidence on failure and denied environments',async()=>{
 const C=require('../lib/config'),file=path.join(C.PATHS.cache,'dev','consul.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({syncedAt:'old',services:{orders:{instances:[]},other:{instances:[{address:'old',port:1}]}}}));
 let r=await T().call('api_instances_refresh',{env:'dev',service:'orders'});assert.equal(r.instances[0].url,'http://127.0.0.1:'+port);port=23456;r=await T().call('api_instances_refresh',{env:'dev',service:'orders'});assert.match(r.instances[0].url,/23456/);
 const snapshot=fs.readFileSync(file,'utf8');assert.equal(JSON.parse(snapshot).services.other.instances[0].address,'old');assert.equal(JSON.parse(snapshot).syncedAt,'old');
 broken=true;await assert.rejects(T().call('api_instances_refresh',{env:'dev',service:'orders'}),/503/);broken=false;assert.equal(fs.readFileSync(file,'utf8'),snapshot);
 await A().run({principalId:'restricted',storyId:'one',role:'user',multiUser:true,envs:['uat']},()=>assert.rejects(T().call('api_instances_refresh',{env:'dev',service:'orders'}),/Environment/));
});
test('cached database pages inspect columns/functions and quote SQL without live calls',async()=>{
 const file=path.join(require('../lib/config').PATHS.cache,'dev','pg','orders.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({tables:[{schema:'sales',name:'odd"table',columns:[{name:'id',type:'bigint'}]},{schema:'sales',name:'second',columns:[]}],functions:[{schema:'sales',name:'calculate',body:'select 1',arguments:'id bigint'}]}));const before=hits;
 let r=await T().call('api_database_inspect',{db:'orders',limit:1});assert.equal(r.objects[0].sql,'select * from "sales"."odd""table" limit 20');assert.equal(r.nextOffset,1);
 r=await T().call('api_database_inspect',{db:'orders',offset:r.nextOffset});assert.equal(r.objects[1].kind,'function');assert.equal(r.objects[1].body,'select 1');assert.equal(r.nextOffset,null);assert.equal(hits,before);
 assert.equal((await T().call('api_database_inspect',{db:'orders',q:'absent'})).objects.length,0);
 await assert.rejects(T().call('api_database_inspect',{db:'../orders'}),/database/);
});
test('named sharing pins referenced scripts and inherited hooks; copies and execution stay private',async()=>{
 let published;
 await A().run({storyId:'author',role:'admin'},async()=>{
  S().save('base/helper',{description:'Helper',steps:[{set:{value:42}}]});S().setCollection('base',{vars:{seed:'ok'},before:'log("setup");',finally:'log("cleanup");'});
  S().save('base/main',{description:'Shared example',steps:[{script:'base/helper'},{set:{done:true}}]});
  published=await T().call('workflow_share',{action:'publish',name:'checkout-check',id:'base/main',expected_revision:null});assert.match(published.url,/shared=checkout-check/);assert.doesNotMatch(published.url,/story|run=/);assert.equal(published.scripts.length,2);assert.equal(published.definitions,undefined);
  await assert.rejects(T().call('workflow_share',{action:'publish',name:'checkout-check',id:'base/main',expected_revision:null}),/changed/);
  S().save('base/helper',{description:'Changed helper',steps:[{set:{value:99}}]});const next=L().publish({name:'checkout-check',id:'base/main',expected_revision:published.revision});assert.notEqual(next.revision,published.revision);assert.equal(L().get('checkout-check',published.revision).definitions['base/helper'].steps[0].set.value,42);
 });
 await A().run({principalId:'reader',storyId:'consumer',role:'user',multiUser:true},async()=>{
  assert.equal(L().list().canPublish,false);assert.equal(L().list().workflows.length,1);assert.equal(S().list().scripts.length,0);
  await assert.rejects(T().call('workflow_share',{action:'publish',name:'denied',id:'base/main',expected_revision:null}),/Administrator/);
  const copy=await T().call('workflow_share',{action:'import',name:'checkout-check',revision:published.revision,prefix:'imports/check'});assert.equal(copy.id,'imports/check/base/main');assert.equal(S().get(copy.id).steps[0].script,'imports/check/base/helper');assert.equal(S().get('imports/check/base/helper').steps[0].set.value,42);
  assert.equal(S().chain(copy.id)[0].vars.seed,'ok');const run=await S().run(copy.id);assert.equal(run.ok,true);assert.ok(run.logs.some(l=>l.msg==='cleanup'));
  await assert.rejects(T().call('workflow_share',{action:'import',name:'checkout-check',prefix:'imports/check'}),/already exists/);
  await A().run({storyId:'other'},()=>{assert.equal(S().list().scripts.length,0);assert.throws(()=>S().get(copy.id),/no script/);});
 });
});
test('sharing validates names, credentials, dependencies and corrupt revisions; transfer rejects stale edits',async()=>{
 S().save('local/main',{description:'Example',steps:[{set:{value:1}}]});let def=S().get('local/main');
 assert.throws(()=>L().transfer({id:def.id,to:'local/copy',expected_revision:'stale'}),/changed/);
 assert.equal(L().transfer({id:def.id,to:'local/copy',expected_revision:def.revision}).saved,true);assert.throws(()=>L().transfer({id:def.id,to:'local/copy',expected_revision:def.revision}),/exists/);
 assert.equal(L().transfer({id:def.id,to:'local/moved',expected_revision:def.revision,move:true}).moved,true);assert.ok(!S().list().scripts.some(s=>s.id==='local/main'));
 assert.throws(()=>L().get('../escape'),/Shared name/);assert.throws(()=>L().get('missing'),/not found/);assert.throws(()=>L().tool({action:'wrong'}),/Choose/);
 S().save('local/secret',{description:'Unsafe',params:{token:{secret:true,default:'private'}},steps:[{set:{value:1}}]});assert.throws(()=>L().publish({name:'unsafe',id:'local/secret',expected_revision:null}),/secret parameter/);
 S().save('local/dynamic',{description:'Dynamic',steps:[{script:'{{which}}'}]});assert.throws(()=>L().snapshot('local/dynamic'),/dynamic/);
 S().save('local/credential',{description:'Unsafe',steps:[{http:'GET http://example.test',headers:{authorization:'Bearer literal-secret'}}]});assert.throws(()=>L().snapshot('local/credential'),/credentials/);
 const r=L().publish({name:'integrity',id:'local/moved',expected_revision:null}),file=path.join(home,'shared-workflows/integrity/revisions',r.revision+'.json');fs.writeFileSync(file,JSON.stringify({...r,description:'damaged'}));assert.throws(()=>L().get('integrity'),/damaged/);
});
test('publication recovers a dead writer and import rolls back a failed new copy without touching existing scripts',async()=>{
 S().save('recovery/main',{description:'Recoverable example',steps:[{set:{ok:true}}]});
 const dir=path.join(home,'shared-workflows/recovery');fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'.lock');fs.writeFileSync(lock,String(process.pid));
 assert.throws(()=>L().publish({name:'recovery',id:'recovery/main',expected_revision:null}),/being published/);
 fs.writeFileSync(lock,'987654321');const r=L().publish({name:'recovery',id:'recovery/main',expected_revision:null});assert.ok(!fs.existsSync(lock));
 assert.equal((await T().call('workflow_share',{action:'get',name:'recovery'})).definitions,undefined);assert.ok((await T().call('workflow_share',{action:'get',name:'recovery',include_definitions:true})).definitions['recovery/main']);
 const save=S().save;S().save=()=>{throw Error('Simulated disk failure');};try{assert.throws(()=>L().importWorkflow({name:'recovery',prefix:'rollback/new'}),/disk failure/);}finally{S().save=save;}
 assert.ok(!fs.existsSync(path.join(S().DIR,'rollback/new')));assert.ok(S().get('recovery/main'));
 assert.throws(()=>L().importWorkflow({name:'recovery',prefix:'../escape'}),/collection path/);assert.throws(()=>L().get('recovery','f'.repeat(64)),/revision not found/);
 const def=S().get('recovery/main');assert.throws(()=>L().transfer({id:'main',to:'other/main',expected_revision:def.revision}),/exact/);
 const revisionDir=path.join(dir,'revisions',r.revision+'.json');assert.ok(fs.existsSync(revisionDir));
});
