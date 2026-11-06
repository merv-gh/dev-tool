const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-otel-'));
process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_NO_DOCTOR='1';process.env.DT_STATE_BACKEND='legacy';process.env.DT_RATE_PER_SEC='0';
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS','OTEL_EXPORTER_OTLP_ENDPOINT','OTEL_EXPORTER_OTLP_TRACES_ENDPOINT','OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'])delete process.env[key];
const A=require('../lib/access'),E=require('../lib/execution'),O=require('../lib/telemetry');
const alice={principalId:'alice',storyId:'one',multiUser:true},bob={principalId:'bob',storyId:'one',multiUser:true};
const received=[];let collector,app,base;
test.before(async()=>{
 collector=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({path:req.url,body:JSON.parse(body)});res.writeHead(200,{'content-type':'application/json'});res.end('{}');});await new Promise(r=>collector.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tools:{workerHeapMb:128},telemetry:{endpoint:`http://127.0.0.1:${collector.address().port}`},scripts:{starters:false}}));require('../lib/config').reload();
 app=require('../server').start({port:0});await new Promise(r=>app.once('listening',r));base=`http://127.0.0.1:${app.address().port}`;
});
test.after(async()=>{await require('../lib/isolate').stop();await O.shutdown();await new Promise(r=>app.close(r));await new Promise(r=>collector.close(r));await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('tracing is opt-in per authenticated story, and observers never alter state transitions',async()=>{
 await A.run(alice,async()=>{await O.run('untraced',{},async()=>{});assert.equal((await O.snapshot()).spans.length,0);O.setEnabled(true);});
 await A.run(bob,async()=>{assert.equal(O.enabled(),false);assert.equal((await O.snapshot()).spans.length,0);});
 const S=require('../lib/state-machine'),m=S.create(require('../lib/lifecycles').job),stop=S.observe(()=>{throw Error('observer broke');});m.to('done');assert.equal(m.state,'done');stop();
});
test('nested and parallel work preserve parent ids; secrets and mutable payloads never enter OTLP',async()=>{
 await A.run(alice,async()=>{
  const secret='private-sql-and-source-SECRET';
  await E.run({kind:'tool',tool:'fixture'},()=>require('../lib/trace').call('fixture',{password:secret},{},async()=>{
   await Promise.all([O.run('parallel.a',{'dt.kind':'step',password:secret},async()=>{}),O.run('parallel.b',{},async()=>{})]);
   await assert.rejects(O.run('failing',{'dt.kind':'step'},async()=>{throw Error(secret);}),/SECRET/);
  }));
  await O.flush();const snapshot=await O.snapshot(),spans=snapshot.spans;
  const a=spans.find(s=>s.name==='parallel.a'),b=spans.find(s=>s.name==='parallel.b'),parent=spans.find(s=>s.name==='tool.fixture');
  assert.equal(a.traceId,b.traceId);assert.equal(a.parentSpanId,parent.spanId);assert.equal(b.parentSpanId,parent.spanId);
  assert.equal(spans.find(s=>s.name==='failing').status,'error');assert.ok(spans.some(s=>s.events.some(e=>e.name==='state.transition')));
  assert.ok(received.some(r=>r.path==='/v1/traces'));assert.ok(received.some(r=>r.path==='/v1/metrics'));
  assert.doesNotMatch(JSON.stringify(received),/private-sql|SECRET|password/);assert.doesNotMatch(JSON.stringify(snapshot),/private-sql|SECRET/);
  const chrome=O.chrome(snapshot);assert.ok(chrome.traceEvents.some(e=>e.ph==='e'));assert.ok(chrome.traceEvents.every(e=>typeof e.tid==='number'));
 });
 await A.run(bob,async()=>assert.equal((await O.snapshot()).spans.length,0));
});
test('a real worker preserves the carrier and forwards diagnostic spans to the owning process',async()=>{
 await A.run(alice,async()=>{
  const result=E.start({kind:'worker-test'},()=>require('../lib/isolate').exec('codeSearch','indexed',[[], 'needle', {limit:5}]));await result.promise;
  await O.flush();const rows=(await O.snapshot()).spans,root=rows.find(r=>r.attributes['dt.execution.id']===result.id);
  const child=rows.find(r=>r.name==='execution.worker'&&r.traceId===root.traceId);assert.ok(child);assert.equal(child.parentSpanId,root.spanId);
 });
});
test('cancellation and cleanup have their own outcome and do not become successful completion',async()=>{
 await A.run(alice,async()=>{
  let entered;const ready=new Promise(r=>entered=r);
  const run=E.start({kind:'cancel-test'},()=>new Promise((resolve,reject)=>{E.signal().addEventListener('abort',()=>reject(E.abortError('stop')),{once:true});entered();}));
  await ready;E.cancel(run.id);await assert.rejects(run.promise,{code:'DT_CANCELLED'});await O.flush();
  const span=(await O.snapshot()).spans.find(r=>r.attributes['dt.execution.id']===run.id);assert.equal(span.status,'cancelled');assert.equal(span.attributes['dt.state'],'cancelled');
 });
});
test('actual HTTP request carries W3C context but telemetry endpoints do not trace themselves',async()=>{
 await A.run({...alice,principalId:'local',multiUser:false},()=>O.setEnabled(true));
 const trace='1234567890abcdef1234567890abcdef',parent='1234567890abcdef';
 const res=await fetch(base+'/api/tool/find',{method:'POST',headers:{'content-type':'application/json','x-dt-story':'one',traceparent:`00-${trace}-${parent}-01`},body:JSON.stringify({q:'no network query',env:'dev'})});assert.equal(res.status,200);await res.json();
 const read=()=>fetch(base+'/api/admin/runtime/observability',{headers:{'x-dt-story':'one'}}).then(r=>r.json());
 const first=await read(),server=first.spans.find(r=>r.traceId===trace&&r.name==='http.server');assert.ok(server);assert.equal(server.parentSpanId,parent);
 const second=await read();assert.equal(second.spans.length,first.spans.length);
});
test('SQLite retention survives restart, applies scope filters and bounds full queues',async()=>{
 const {TraceStore}=require('../lib/telemetry-store'),file=path.join(home,'retained.sqlite');let s=new TraceStore(file,{maxQueued:1,maxRows:2});
 const row=i=>({scope:'a',traceId:'a'.repeat(32),spanId:String(i).padStart(16,'0'),name:'retained'});
 s.put(row(1));s.put(row(2));s.put(row(3));await s.flush();assert.ok(s.status().dropped>0);await s.close();
 s=new TraceStore(file,{maxRows:2});assert.equal((await s.read('b')).length,0);assert.equal((await s.read('a')).length,1);await s.close();
});

test('changing local scope cannot attach another chat to the active trace',async()=>{
 await A.run(alice,()=>O.run('scope.a',{},async()=>{
  const before=O.carrier().traceparent;
  await A.run(bob,async()=>{O.setEnabled(true);await O.run('scope.b',{},async()=>{assert.notEqual(O.carrier().traceparent.split('-')[1],before.split('-')[1]);});});
 }));
});
test('diagnostic end failures cannot change a successful result or replace an application error',async()=>{
 await A.run(alice,async()=>{
  const original=O.begin('diagnostic.failure',{});assert.ok(original);
  const span=original.span,end=span.end.bind(span);span.end=()=>{throw Error('diagnostic sink failed');};
  assert.doesNotThrow(()=>original.end());span.end=end;end();
  const blocked=path.join(home,'not-a-directory');fs.writeFileSync(blocked,'x');
  const {TraceStore}=require('../lib/telemetry-store'),store=new TraceStore(path.join(blocked,'traces.sqlite'));
  store.put({scope:'a',traceId:'a'.repeat(32),spanId:'1'.repeat(16)});await store.flush();
  assert.equal(store.status().persistence,'unavailable');assert.ok(store.status().dropped);await store.close();
 });
});
test('unavailable collector and interrupted producers do not break successful work or invent span ends',async()=>{
 await new Promise(r=>collector.close(r));
 await A.run(alice,async()=>{
  const row={scope:A.current().scopeKey,traceId:'f'.repeat(32),spanId:'f'.repeat(16),name:'interrupted',startMs:Date.now(),startTime:[Math.floor(Date.now()/1000),0],attributes:{},events:[],running:true};
  O.ingest({row,running:true},row.scope,'stopped-worker');O.interruptProducer('stopped-worker');
  assert.equal(await O.run('collector.offline',{},async()=>42),42);await O.flush();
  const snapshot=await O.snapshot(),orphan=snapshot.spans.find(s=>s.spanId===row.spanId);assert.equal(orphan.orphaned,true);assert.equal(orphan.running,true);assert.equal(orphan.endTime,undefined);
  const events=O.chrome(snapshot).traceEvents.filter(e=>e.id===row.spanId);assert.equal(events.some(e=>e.ph==='e'),false);
 });
});
