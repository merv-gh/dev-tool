const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-execution-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0'; process.env.DT_STATE_BACKEND = 'legacy';
for (const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, scripts: { jsTimeoutMs: 2000 } }));
const E = require('../lib/execution'), A = require('../lib/access'), J = require('../lib/jobs'), JS = require('../lib/js'), T = require('../lib/trace');
const delay = ms => new Promise(r => setTimeout(r, ms));
const identity = (principalId, storyId) => ({ principalId, storyId, multiUser: true, role: 'user' });
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('cancelling before admission fences job callback and a pre-aborted request', async () => {
  let writes = 0;
  const job = J.start('early', 'early job', () => writes++);
  assert.equal(J.cancel(job.id).state, 'cancelled'); await job.promise; assert.equal(writes, 0);
  const controller = new AbortController(); controller.abort('client left');
  await assert.rejects(E.run({ signal: controller.signal }, () => writes++), e => e.code === 'DT_CANCELLED'); assert.equal(writes, 0);
});

test('terminal ownership cancels and drains unfinished child resources', async () => {
  let stopped = false, child;
  const parent = E.start({ kind: 'test' }, async () => {
    child = E.start({ kind: 'host-tool' }, () => new Promise(resolve => { const release = E.resource(async () => { await delay(30); stopped = true; release(); resolve(); }); }));
    await delay(10); return 'parent result';
  });
  assert.equal(await parent.promise, 'parent result'); assert.equal(stopped, true); await assert.rejects(child.promise, /owner completed/);
  assert.equal(E.get(parent.id).children, 0); assert.equal(E.get(parent.id).state, 'done');
});

test('a released resource still drains its asynchronous cancellation cleanup', async () => {
  let admitted, finishBody, finishCleanup;
  const ready=new Promise(resolve=>admitted=resolve),cleanup=new Promise(resolve=>finishCleanup=resolve);
  const execution=E.start({kind:'released-cleanup'},()=>new Promise(resolve=>{
    finishBody=resolve;
    const release=E.resource(()=>{release();finishBody();return cleanup;});
    admitted();
  }));
  await ready;E.cancel(execution.id,'stop released handle');
  let settled=false;execution.promise.catch(()=>{settled=true;});
  try{await delay(20);assert.equal(settled,false,'terminal completion must await the pending stop operation');assert.equal(E.get(execution.id).state,'draining');}
  finally{finishCleanup();await assert.rejects(execution.promise,e=>e.code==='DT_CANCELLED');}
});

test('noncooperative work reports an unknown outcome rather than completed cleanup', async () => {
  const parent = E.start({ kind: 'test', drainMs: 20 }, () => { E.track(new Promise(() => {})); return 'no'; });
  await assert.rejects(parent.promise, e => e.code === 'DT_EXECUTION_DRAIN_TIMEOUT');
  assert.equal(E.get(parent.id).outcome, 'unknown'); assert.equal(E.get(parent.id).cleanupIncomplete, 1);
});

test('execution/job ids and deduplication are scoped to both user and story', async () => {
  let x, y, z;
  await A.run(identity('alice','one'), async () => { x = J.start('same','same job',()=>delay(100)); assert.equal(J.start('same','joined',()=>{}).id,x.id); });
  await A.run(identity('alice','two'), async () => { y = J.start('same','same job',()=>delay(100)); assert.notEqual(y.id,x.id); assert.equal(J.get(x.id),null); assert.equal(E.get(x.executionId),null); assert.throws(()=>E.cancel(x.executionId),/no execution/); });
  await A.run(identity('bob','one'), async () => { z=J.start('same','same job',()=>delay(100)); assert.notEqual(z.id,x.id); assert.equal(J.list().length,1); });
  await Promise.all([x.promise,y.promise,z.promise]);
});

test('parallel spans retain independent ancestry, and nested calls link to their parent span', async () => {
  await T.call('parallel_span_probe', {}, {}, () => Promise.all([
    T.step('left', async () => { await delay(15); await T.step('left child', () => T.call('nested_span_probe', {}, {}, async()=>{})); }),
    T.step('right', async () => { await delay(5); await T.step('right child', async()=>{}); }),
  ]));
  const end = T.tail({tool:'parallel_span_probe'}).at(-1), by = Object.fromEntries(end.steps.map(s=>[s.name,s]));
  assert.equal(by.left.depth,0); assert.equal(by.right.depth,0); assert.equal(by.left.parentId,null); assert.equal(by.right.parentId,null);
  assert.equal(by['left child'].parentId,by.left.id); assert.equal(by['right child'].parentId,by.right.id);
  const nested=T.tail({tool:'nested_span_probe'}).find(e=>e.event==='start'); assert.equal(nested.parentId,end.id); assert.equal(nested.parentSpanId,by['left child'].id);
});

for (const ending of ['return 4;', 'throw Error("guest failed");', 'await new Promise(()=>{});']) test(`code drains forgotten host calls on ${ending}`, async () => {
  let started=0, stopped=0, lateWrites=0;
  const onTool = name => { if (name !== 'slow') return true; started++; const signal=E.signal(); return new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{lateWrites++;resolve();},30000); signal.addEventListener('abort',()=>{clearTimeout(timer);stopped++;reject(E.abortError(signal.reason));},{once:true}); }); };
  let result;
  try { result=await JS.run(`await tools.ready(); void tools.slow(); await tools.barrier(); ${ending}`,{}, {onTool,timeoutMs:3000}); }
  catch(e){ assert.match(ending,/new Promise/); assert.match(e.message,/stopped after/); }
  assert.equal(started,1); assert.equal(stopped,1); assert.equal(lateWrites,0);
  if(ending.startsWith('return'))assert.equal(result.returned,4);
  if(ending.startsWith('throw'))assert.equal(result.error,'guest failed');
});

test('code observations do not restart work and cursors deliver Unicode output exactly once', async () => {
  const cell=JS.start(`text('first😀'); await new Promise(r=>setTimeout(r,150)); log('second'); return 17;`,{}, {timeoutMs:2000});
  let cursor=0, output=[], last;
  for(let i=0;i<20;i++){last=await JS.wait(cell.id,{cursor,waitMs:100});output.push(...last.output);cursor=last.nextCursor;if(['done','failed','cancelled'].includes(last.state))break;}
  assert.equal(last.state,'done'); assert.equal(last.result.returned,17); assert.deepEqual(output.map(x=>x.text),['first😀','second']);
  assert.deepEqual((await JS.wait(cell.id,{cursor,waitMs:0})).output,[]);
  await A.run(identity('other','story'),()=>assert.rejects(JS.wait(cell.id),/no code cell/));
});

test('cancelling a CPU-bound resumable cell stops its process and reports terminal state', async () => {
  const cell=JS.start('while(true){}',{}, {timeoutMs:10000}); await delay(100); JS.cancel(cell.id);
  let result; for(let i=0;i<20;i++){result=await JS.wait(cell.id,{waitMs:100});if(['cancelled','failed'].includes(result.state))break;}
  assert.equal(result.state,'cancelled'); assert.equal(E.get(cell.executionId).children,0);
});

test('network fetch remains available while fresh cells discard prior globals', async () => {
  const server=require('http').createServer((req,res)=>res.end(JSON.stringify({answer:42})));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const session=new JS.Session();
  try{assert.equal((await session.run(`globalThis.secret='one'; return (await (await fetch('http://127.0.0.1:${server.address().port}')).json()).answer;`)).returned,42);assert.equal((await session.run('return globalThis.secret === undefined;')).returned,true);}
  finally{session.close();server.close();}
});

test('bounded fair scheduling serves another story and cancels queued work without invoking it', async () => {
  const {FairScheduler}=require('../lib/limit'), s=new FairScheduler({concurrency:1,maxQueued:10}), order=[];
  let release;
  const first=s.run(async()=>{order.push('a1');await new Promise(r=>release=r);},{key:'a'}); await delay(0);
  const a2=s.run(()=>order.push('a2'),{key:'a'}), a3=s.run(()=>order.push('a3'),{key:'a'}), b1=s.run(()=>order.push('b1'),{key:'b'});
  const controller=new AbortController(); let invoked=false; const cancelled=s.run(()=>{invoked=true;},{key:'c',signal:controller.signal});controller.abort(); await assert.rejects(cancelled,/abort/i);
  release(); await Promise.all([first,a2,a3,b1]); assert.deepEqual(order,['a1','a2','b1','a3']);assert.equal(invoked,false);assert.equal(s.stats().queued,0);
  const blocked=new FairScheduler({concurrency:1,maxQueued:1}); const p=blocked.run(async()=>{}); await assert.rejects(blocked.run(()=>{}),e=>e.code==='DT_QUEUE_FULL');await p;
});

test('a hundred synthetic scopes stay within capacity and preserve each original owner', async () => {
  const {FairScheduler}=require('../lib/limit'), scheduler=new FairScheduler({concurrency:3,maxQueued:120});let active=0,peak=0;
  const results=await Promise.all(Array.from({length:100},(_,i)=>A.run(identity(`user${i}`,'story'),()=>scheduler.run(async()=>{active++;peak=Math.max(peak,active);await delay(1);const principal=A.current().principalId;active--;return principal;},{key:`scope${i}`}))));
  assert.equal(peak,3);assert.deepEqual(results,Array.from({length:100},(_,i)=>`user${i}`));assert.equal(scheduler.stats().running,0);
});

test('QuickJS prototype handles pure async transforms, cancellation and rejects unsupported effects without host calls', async () => {
  let calls=0;
  const r=await JS.run(`text('transform😀'); vars.count++; test('count',()=>expect(vars.count).toBe(2)); return await Promise.all([Promise.resolve(4),Promise.resolve(5)]);`,{vars:{count:1}},{engine:'quickjs',onTool:()=>calls++,timeoutMs:2000});
  assert.deepEqual(r.returned,[4,5]);assert.equal(r.tests[0].ok,true);assert.deepEqual(r.output,['transform😀']);
  assert.match((await JS.run('await tools.any({});',{}, {engine:'quickjs',onTool:()=>calls++})).error,/pure transforms/);assert.equal(calls,0);
  await assert.rejects(JS.run('while(true){}',{}, {engine:'quickjs',timeoutMs:100}),/stopped|interrupted/);
  assert.equal((await JS.run('return 9;',{}, {engine:'quickjs'})).returned,9);
});


test('top-level Node code admission is bounded while a nested script hook remains reentrant', async () => {
  const L=require('../lib/limit'),running=[];let active=0,peak=0;
  const onTool=async()=>{active++;peak=Math.max(peak,active);await delay(30);active--;return 1;};
  for(let i=0;i<5;i++)running.push(JS.run('return await tools.hold();',{}, {onTool,timeoutMs:3000}));
  assert.deepEqual((await Promise.all(running)).map(r=>r.returned),[1,1,1,1,1]);assert.ok(peak<=2);assert.equal(L.status().code.concurrency,2);
  const result=await JS.run('return await tools.script_hook();',{}, {onTool:async()=>{assert.equal(E.current().codeActive,true);return (await JS.run('return 23;',{}, {timeoutMs:3000})).returned;},timeoutMs:3000});
  assert.equal(result.returned,23);assert.equal(JS.runtimes()[0].active,0);
});


test('cancellation during drain wins over an earlier returned value', async () => {
  let began;const started=new Promise(resolve=>began=resolve);
  const execution=E.start({kind:'drain-cancel'},()=>{E.resource(async()=>{began();await delay(40);});return 'value';});
  await started;assert.equal(E.get(execution.id).state,'draining');E.cancel(execution.id,'cancelled while draining');
  await assert.rejects(execution.promise,e=>e.code==='DT_CANCELLED');assert.equal(E.get(execution.id).state,'cancelled');
});

test('a queued code deadline expires before any process or host tool starts', async () => {
  let ready, release, holds=0, unexpected=0;
  const admitted=new Promise(resolve=>ready=resolve), gate=new Promise(resolve=>release=resolve);
  const holders=Promise.all([JS.run('await tools.hold();',{}, {timeoutMs:3000,onTool:async()=>{if(++holds===2)ready();await gate;}}),JS.run('await tools.hold();',{}, {timeoutMs:3000,onTool:async()=>{if(++holds===2)ready();await gate;}})]);
  try{await Promise.race([admitted,holders.then(()=>{throw Error('holders ended before admission');})]);await assert.rejects(JS.run('return await tools.unexpected();',{}, {timeoutMs:100,onTool:()=>unexpected++}),/stopped after 100ms/);assert.equal(unexpected,0);}
  finally{release();await holders;}
});


test('cancelled observation stops waiting without cancelling the independent code cell', async () => {
  const cell=JS.start('await new Promise(r=>setTimeout(r,150)); return 31;',{}, {timeoutMs:3000});
  const controller=new AbortController(),observation=E.run({signal:controller.signal},()=>JS.wait(cell.id,{waitMs:10000}));
  const timer=setTimeout(()=>controller.abort('observer disconnected'),20);
  try{await assert.rejects(observation,e=>e.code==='DT_CANCELLED');assert.notEqual(E.get(cell.executionId).state,'cancelled');let result;for(let i=0;i<30;i++){result=await JS.wait(cell.id,{waitMs:100});if(result.state==='done')break;}assert.equal(result.result.returned,31);}
  finally{clearTimeout(timer);}
});
