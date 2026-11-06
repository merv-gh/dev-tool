const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-ops-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_SECURITY_PROFILE','OTEL_EXPORTER_OTLP_ENDPOINT','OTEL_EXPORTER_OTLP_METRICS_ENDPOINT','DT_OPERATIONAL_METRICS'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',DT_RATE_PER_SEC:'0'});
const config={envs:{dev:{postgres:{}}},tools:{workerHeapMb:0},scripts:{starters:false},server:{networkBudgets:{'test:dev':{concurrency:1,maxWaitMs:1000,maxQueued:10},'timeout:dev':{concurrency:1,maxWaitMs:30}}}};fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
const A=require('../lib/access'),E=require('../lib/execution'),L=require('../lib/limit');const owner=id=>({principalId:id,storyId:'task',role:'admin',multiUser:true});
test('network slots cover the operation and rotate fairly between waiting stories',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),order=[];
 const first=A.run(owner('a'),()=>L.network('test:dev',async()=>{entered();await gate;}));await ready;
 const run=(p,n)=>A.run(owner(p),()=>L.network('test:dev',async()=>order.push(n)));
 const rest=[run('a','a2'),run('a','a3'),run('b','b1'),run('b','b2')];await new Promise(r=>setImmediate(r));assert.deepEqual(order,[]);release();await Promise.all([first,...rest]);assert.deepEqual(order,['a2','b1','a3','b2']);
});
test('admission timeout prevents an operation rather than retrying its effect',async()=>{
 let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const first=L.network('timeout:dev',async()=>{entered();await gate;});await ready;let ran=false;
 const rejected=assert.rejects(L.network('timeout:dev',async()=>{ran=true;}),e=>e.code==='DT_RATE_LIMIT'&&e.statusCode===429);await new Promise(r=>setTimeout(r,60));await rejected;assert.equal(ran,false);release();await first;
});
test('shared refresh has private handles; cancelling one requester does not cancel another',async t=>{
 let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let calls=0;
 t.mock.method(require('../lib/isolate'),'exec',async(mod,fn)=>{assert.equal(mod,'indexer');calls++;if(fn==='buildDocs')return {};entered();await gate;return {lines:0,edges:0};});
 const I=require('../lib/indexer'),jobs=require('../lib/jobs');const first=A.run(owner('a'),()=>I.refresh({env:'dev',what:'index'}));await ready;const second=A.run(owner('b'),()=>I.refresh({env:'dev',what:'index'}));assert.notEqual(first.id,second.id);await new Promise(r=>setImmediate(r));A.run(owner('a'),()=>jobs.cancel(first.id));release();await Promise.all([first.promise,second.promise]);assert.equal(A.run(owner('b'),()=>jobs.get(second.id)).state,'done');assert.ok(calls<=2,'one producer executes docs and indexes');
});
test('aggregate OTLP metrics export with tracing off and omit mutable payloads',async()=>{
 const received=[];const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;received.push(body);res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 config.telemetry={operationalMetrics:true};fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT='http://127.0.0.1:'+server.address().port+'/v1/metrics';
 const M=require('../lib/operational-metrics');try{assert.equal(require('../lib/telemetry').enabled(),false);await require('../lib/tools').call('find',{env:'dev',q:'PRIVATE-QUERY-123'});M.record('network',12);await M.flush();assert.ok(received.some(body=>body.includes('dt.operations.completed')));assert.doesNotMatch(received.join(''),/PRIVATE-QUERY|scope_key|storyId/);assert.ok(M.snapshot().operations.some(r=>r.kind==='call'));assert.throws(()=>A.run({...owner('user'),role:'user'},()=>M.snapshot()),/Administrator/);
 server.closeAllConnections();await new Promise(r=>server.close(r));assert.deepEqual(await require('../lib/tools').call('find',{env:'dev',q:'still works'}),['(catalog for dev is empty: call catalog_sync with env="dev" first)']);
 }finally{await M.stop();if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}}
});
test.after(async()=>{await require('../lib/state-store').close();await require('../lib/isolate').stop();fs.rmSync(home,{recursive:true,force:true});});
