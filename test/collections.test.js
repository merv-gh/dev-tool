const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-collections-'));
process.env.DT_HOME = home; process.env.DT_RATE_PER_SEC = '0'; process.env.DT_LOG = 'quiet';
for (const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_SCRIPTS_DIR','DT_TOOLS']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs:{ dev:{} } }));
const S = require('../lib/scripts'), C = require('../lib/collections');
const script = (id, extra = {}) => S.save(id, { description:id, steps:[{js:'return vars.n;'}], ...extra });
const read = (id, code) => script(id, { steps:[{js:code}] });
test.after(() => fs.rmSync(home, {recursive:true, force:true}));

test('tool parity preserves collection vars, hooks and aliases during partial edits', async () => {
  const T = require('../lib/tools');
  await T.call('script_collection',{collection:'parity',description:'original',tool:true,vars:{base:2},before:'vars.base += 1;',after:'test("base",()=>expect(vars.base).toBe(3));',finally:'log("collection-clean");'});
  await T.call('script_collection',{collection:'parity',description:'edited'});
  const col = S.getCollection('parity'); assert.equal(col.tool,true); assert.equal(col.vars.base,2); assert.ok(col.finally);
  await T.call('script_save',{id:'parity/run',description:'parity',vars:{inner:4},before:'vars.start = true;',after:'test("inner",()=>expect(vars.inner).toBe(4));',finally:'log("script-clean");',steps:[{js:'return vars.base + vars.inner;'}]});
  await T.call('script_save',{id:'parity/run',description:'edited description',steps:[{js:'return vars.base + vars.inner;'}]});
  const result = await T.call('script_run',{id:'parity/run'}); assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(result.tests.passed,2); assert.deepEqual(result.logs.map(x=>x.msg),['script-clean','collection-clean']);
});

test('finally runs once after primary errors and retains independent cleanup errors', async () => {
  script('finally/fail',{before:'throw new Error("setup failed")',finally:'log("released"); throw new Error("cleanup failed")'});
  const r = await S.run('finally/fail'); assert.match(r.error,/setup failed/); assert.equal(r.cleanupErrors.length,1); assert.match(r.cleanupErrors[0].error,/cleanup failed/); assert.equal(r.logs[0].msg,'released');
  script('finally/step',{finally:'log("outer");',steps:[{js:'throw new Error("main")',finally:'log("step cleanup"); throw new Error("step cleanup failed")'}]});
  const step = await S.run('finally/step'); assert.match(step.error,/main/); assert.equal(step.cleanupErrors.length,1); assert.deepEqual(step.logs.map(x=>x.msg),['step cleanup','outer']);
});

test('nested collection finally is reverse order and runs after failed outer setup', async () => {
  script('cleanup/inner/run',{finally:'log("script")'});
  S.setCollection('cleanup',{before:'throw new Error("outer")',finally:'log("outer")'});
  S.setCollection('cleanup/inner',{finally:'log("inner")'});
  const r = await S.run('cleanup/inner/run'); assert.match(r.error,/outer/); assert.deepEqual(r.logs.map(x=>x.msg),['script','inner','outer']);
});

test('soft named assertions collect failures, hard assertions stop dependent steps', async () => {
  script('assertions/soft',{steps:[{js:'return 2;',assertions:[{name:'one',code:'expect(result).toBe(1)'},{name:'three',code:'expect(result).toBe(3)'}]},{set:{continued:true}}]});
  const r = await S.run('assertions/soft'); assert.equal(r.ok,false); assert.equal(r.tests.failed,2); assert.equal(r.results.continued,true);
  script('assertions/hard',{steps:[{js:'return 2;',assertions:[{name:'must',code:'expect(result).toBe(1)',hard:true}]},{set:{unsafe:true}}]});
  const hard = await S.run('assertions/hard'); assert.equal(hard.steps.length,1); assert.equal(hard.results.unsafe,undefined);
});

test('ordered nested datasets and matrix isolate captured variables and retain exact revisions', async () => {
  read('matrix/root','assert(vars.leaked === undefined,"case vars leaked"); vars.leaked = true; test("typed",()=>expect(typeof vars.n).toBe("number")); return vars.n;');
  read('matrix/nested/child','assert(vars.leaked === undefined,"parent case vars leaked"); test("scope",()=>expect(vars.ready).toBe(true));');
  C.save('matrix',{suite:{order:[{script:'root',datasets:[{n:1},{n:2}],matrix:{tenant:['a','b']}},{collection:'nested'}],before:'vars.ready = true; log("setup root");',after:'test("aggregate",()=>expect(vars.run.counts.passed).toBe(5));',finally:'log("cleanup root");'}});
  C.save('matrix/nested',{suite:{before:'test("inherited",()=>expect(vars.ready).toBe(true));',finally:'log("cleanup nested");'}});
  const p = C.plan('matrix',{seed:'123'}); assert.equal(p.cases.length,5); assert.deepEqual(p.cases.slice(0,4).map(c=>[c.params.n,c.params.tenant]),[[1,'a'],[1,'b'],[2,'a'],[2,'b']]);
  const r = await C.run('matrix',{seed:'123'}); assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.counts.passed,5); assert.ok(r.view.includes('/show/')); assert.equal(r.hooks.filter(x=>x.kind==='before').length,2); assert.deepEqual(r.hooks.filter(x=>x.kind==='finally').map(x=>x.collection),['matrix/nested','matrix']); assert.match(r.cases[0].revision,/^[a-f0-9]{64}$/); assert.equal(C.get(r.run).seed,'123');
});

test('tag filters and exact selection account for exclusions and never run unselected setup', async () => {
  script('filter/a',{tags:['smoke']}); script('filter/slow/b',{tags:['slow']}); C.save('filter/slow',{suite:{before:'throw new Error("must not run")'}});
  const p = C.plan('filter',{tags:['smoke']}); assert.equal(p.cases.length,1); assert.equal(p.skipped.length,1); assert.equal(p.scopes.length,1);
  const r = await C.run('filter',{select:['a']}); assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.counts.cases,1);
});

test('preflight rejects all references, cycles, unknown templates/tools before any mutation', async () => {
  let calls=0;
  script('invalid/a',{steps:[{tool:'danger',args:{}},{script:'invalid/missing'},{set:{x:'{{misspelled.value}}'}}]});
  const r = await C.run('invalid',{}, {schemas:[{name:'danger'}],call:async()=>{calls++;}}); assert.equal(r.status,'invalid'); assert.equal(calls,0); assert.ok(r.validation.errors.some(e=>e.kind==='reference')); assert.ok(r.validation.errors.some(e=>e.kind==='template'));
  script('cycle/a',{steps:[{script:'cycle/b'}]}); script('cycle/b',{steps:[{script:'cycle/a'}]}); const cycle=await C.validate('cycle'); assert.ok(cycle.errors.some(e=>e.kind==='cycle'));
  script('unknown/a',{steps:[{tool:'not_a_tool'}]}); assert.equal((await C.validate('unknown')).ok,false);
});

test('typed parameters reject malformed matrix rows before setup', async () => {
  script('typed/a',{params:{n:{type:'integer',required:true}},steps:[{set:{seen:'{{n}}'}}]}); C.save('typed',{suite:{before:'throw new Error("no setup")',datasets:[{n:1},{n:'2'}]}});
  const r=await C.run('typed'); assert.equal(r.status,'invalid'); assert.match(r.validation.errors[0].error,/integer/);
  C.save('typed',{suite:{before:'',datasets:[{n:1},{n:2}]}}); assert.equal((await C.run('typed')).ok,true);
});

test('suite setup failure skips selected children and finally preserves both errors', async () => {
  script('setup/a'); script('setup/nested/b'); C.save('setup',{suite:{before:'throw new Error("setup primary")',finally:'log("cleanup attempted"); throw new Error("cleanup secondary")'}});
  const r=await C.run('setup'); assert.equal(r.status,'failed'); assert.match(r.error,/setup primary/); assert.equal(r.cleanupErrors.length,1); assert.match(r.cleanupErrors[0].error,/cleanup secondary/); assert.equal(r.counts.skipped,2); assert.equal(C.check(r).ok,false);
  const xml=C.junit(r); assert.match(xml,/errors="2"/); assert.match(xml,/skipped="2"/); assert.match(xml,/setup primary/); assert.match(xml,/cleanup secondary/);
});

test('cancellation interrupts JS and runs separate bounded cleanup without starting later cases', async () => {
  script('cancel/a',{steps:[{js:'await new Promise(resolve=>setTimeout(resolve,30000));'}],finally:'log("case cleanup");'}); script('cancel/b'); C.save('cancel',{suite:{finally:'log("suite cleanup");'}});
  let run;
  const promise=C.run('cancel',{onStart:id=>{run=id; setTimeout(()=>C.cancel(id,'test cancel'),60);}});
  const r=await promise; assert.equal(r.run,run); assert.equal(r.status,'cancelled'); assert.equal(r.counts.skipped,1); assert.ok(r.cases[0].result.logs.some(x=>x.msg==='case cleanup')); assert.equal(r.hooks.at(-1).kind,'finally'); assert.equal(C.check(r).ok,false); assert.equal(C.cancel(run).cancelled,false);
});

test('run and step deadlines run cleanup with a fresh JS process', async () => {
  script('deadline/a',{steps:[{js:'while(true) {}'}],finally:'log("released")'});
  const r=await C.run('deadline',{timeoutMs:80,cleanupTimeoutMs:2000}); assert.equal(r.ok,false); assert.ok(r.cases[0].result.logs.some(x=>x.msg==='released')); assert.match(r.cases[0].result.error,/stopped|deadline/);
});

test('safe HTTP retries, exact polling and no automatic POST duplication', async () => {
  let calls=0;
  const server=http.createServer((req,res)=>{calls++; if(calls===1){res.writeHead(503);res.end('busy');}else{res.setHeader('content-type','application/json');res.end(JSON.stringify({ready:calls>=3}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{http:{allow:[url]}}})); require('../lib/config').reload();
  try {
    script('retry/a',{steps:[{http:`GET ${url}`,retry:{attempts:4,delayMs:1},poll:{path:'json.ready',equals:true,attempts:4,intervalMs:1}}]}); const r=await S.run('retry/a'); assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(calls,3); assert.equal(r.steps[0].attempts.length,3);
    assert.throws(()=>script('retry/post',{steps:[{http:`POST ${url}`,retry:{attempts:2,idempotent:true}}]}),/GET\/HEAD/); assert.equal(calls,3);
    script('retry/tool',{steps:[{tool:'find',args:{q:'a'},retry:{attempts:2,idempotent:true,delayMs:1}}]}); let tries=0; const rr=await S.run('retry/tool',{}, {call:async()=>{if(++tries===1)throw new Error('temporary');return {ok:true};}}); assert.equal(rr.ok,true); assert.equal(tries,2);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('durable history, independent check, JUnit and default views through shared registry', async () => {
  const T=require('../lib/tools'); script('registry/a',{steps:[{js:'test("business",()=>expect(2).toBe(3));'}]});
  await T.call('collection_save',{collection:'registry',description:'smoke',suite:{order:['a']}});
  const inspected=await T.call('collection_get',{collection:'registry'}); assert.equal(inspected.definitions.length,1);
  assert.equal((await T.call('collection_plan',{collection:'registry'})).counts.cases,1);
  assert.equal((await T.call('collection_validate',{collection:'registry'})).ok,true);
  const r=await T.call('collection_run',{collection:'registry',wait_ms:50000}); assert.equal(r.ok,false); assert.equal(r.counts.failed,1); assert.ok(r.view);
  assert.equal((await T.call('collection_check',{run:r.run})).ok,false);
  const history=await T.call('collection_history',{collection:'registry'}); assert.equal(history[0].run,r.run);
  const report=await T.call('collection_report',{run:r.run,format:'junit'}); assert.match(report.xml,/failures="1"/); assert.equal(report.ok,false);
  assert.equal((await T.call('collection_report',{run:r.run,format:'json'})).definitions['registry/a'].steps[0].js,'test("business",()=>expect(2).toBe(3));');
  assert.ok((await T.call('collection_report',{run:r.run})).view.includes('/show/'));
});

test('bounds reject invalid identities, oversized matrices and unsafe repeats', () => {
  assert.throws(()=>C.get('../escape'),/invalid/); assert.throws(()=>C.plan('../escape'),/bad script/);
  script('bounds/a'); C.save('bounds',{suite:{matrix:{n:Array.from({length:1001},(_,i)=>i)}}}); assert.throws(()=>C.plan('bounds'),/1000/);
  assert.throws(()=>script('bounds/retry',{steps:[{js:'return 1',retry:{attempts:2}}]}),/idempotent/);
  assert.throws(()=>C.save('bounds',{suite:{datasets:[null]}}),/datasets/);
});

test('CI runner has non-green exit codes for assertions/preflight and exports JUnit', () => {
  const {spawnSync}=require('child_process'), command=path.resolve(__dirname,'../dev/collection-test.js');
  script('ci/pass',{steps:[{js:'test("ok",()=>expect(1).toBe(1));'}]});
  script('ci/fail',{steps:[{js:'test("bad",()=>expect(1).toBe(2));'}]});
  const output=path.join(home,'reports','suite.xml');
  const passed=spawnSync(process.execPath,[command,'ci','--select','pass','--junit',output],{encoding:'utf8'}); assert.equal(passed.status,0,passed.stderr); assert.equal(JSON.parse(passed.stdout).ok,true); assert.match(fs.readFileSync(output,'utf8'),/failures="0"/);
  const failed=spawnSync(process.execPath,[command,'ci','--select','fail'],{encoding:'utf8'}); assert.equal(failed.status,1,failed.stderr); assert.equal(JSON.parse(failed.stdout).ok,false);
  const invalid=spawnSync(process.execPath,[command,'ci','--select','absent'],{encoding:'utf8'}); assert.equal(invalid.status,2); assert.equal(JSON.parse(invalid.stdout).status,'invalid');
});

test('source edits during a case cannot change later nested script or inherited hooks', async () => {
  script('snapshot/child',{steps:[{js:'test("snapshot child",()=>expect(1).toBe(1));'}]});
  script('snapshot/root',{steps:[{tool:'find',args:{q:'change'}},{script:'snapshot/child'}]});
  C.save('snapshot',{before:'test("snapshot hook",()=>expect(1).toBe(1));',suite:{order:['root']}});
  const r=await C.run('snapshot',{}, {schemas:[{name:'find'}],call:async()=>{ S.save('snapshot/child',{description:'changed',steps:[{js:'throw new Error("changed child");'}]}); C.save('snapshot',{before:'throw new Error("changed hook");'}); return {}; }});
  assert.equal(r.ok,true,JSON.stringify(r)); assert.ok(r.definitions['snapshot/child'].steps[0].js.includes('snapshot child'));
});

test('suite setup values reach cases and caller params override stored defaults', async () => {
  script('setup-values/a',{steps:[{js:'test("prepared",()=>expect(vars.prepared).toBe(7)); test("caller",()=>expect(vars.region).toBe("caller"));'}]});
  C.save('setup-values',{suite:{params:{region:'stored',prepared:1},before:'vars.prepared=7;'}});
  const r=await C.run('setup-values',{params:{region:'caller'}}); assert.equal(r.ok,true,JSON.stringify(r));
});

test('missing required tool arguments fail preflight before calls', async () => {
  script('arguments/a',{steps:[{tool:'find',args:{}}]});
  const r=await C.validate('arguments'); assert.equal(r.ok,false); assert.ok(r.errors.some(e=>e.kind==='argument'));
});

test('portable JSON assertions compose without JavaScript and contracts survive JSON roundtrip', async () => {
  const prior=fs.readFileSync(path.join(home,'config.json'),'utf8');
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{js:false}})); require('../lib/config').reload();
  try {
    script('portable/a',{steps:[{set:{status:'PAID',items:[{id:1},{id:2}],note:'ready'},assertions:[{name:'status',path:'status',op:'equal',value:'PAID'},{name:'count',path:'items',op:'count',value:2},{name:'contains item',path:'items',op:'contains',value:{id:2}},{name:'exists',path:'note',op:'exists'},{name:'absent',path:'missing',op:'exists',value:false}]}]});
    const r=await C.run('portable'); assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.cases[0].result.tests.passed,5); assert.ok(!r.validation.capabilities.includes('javascript'));
    const encoded=JSON.stringify(r), decoded=JSON.parse(encoded), schema=require('../schemas/collection-contract.schema.json');
    for(const [stage,value] of [['run',decoded],['plan',decoded.plan],['validation',decoded.validation]]) { assert.equal(value.version,1); for(const key of schema.$defs[stage].required) assert.ok(Object.hasOwn(value,key),`${stage} missing ${key}`); }
    assert.equal(C.check(decoded).ok,true); assert.match(C.junit(decoded),/failures="0"/);
    script('portable/js',{steps:[{set:{a:1},assertions:[{name:'js check',code:'expect(result.a).toBe(1)'}]}]}); assert.equal((await C.validate('portable',{select:['js']})).ok,false);
    assert.throws(()=>C.save('portable',{suite:{version:2}}),/unsupported/);
  } finally {fs.writeFileSync(path.join(home,'config.json'),prior);require('../lib/config').reload();}
});

test('background collection jobs can be polled independently and generic job cancellation still cleans up', async () => {
  const T=require('../lib/tools');
  script('background/a',{steps:[{js:'await new Promise(resolve=>setTimeout(resolve,30000));'}],finally:'log("background cleanup");'});
  const started=await T.call('collection_run',{collection:'background',wait_ms:0}); assert.ok(started.job);
  await T.call('job_cancel',{job:started.job});
  const completed=await T.call('collection_run',{job:started.job,wait_ms:50000}); assert.equal(completed.status,'cancelled',JSON.stringify(completed)); assert.equal(completed.ok,false);
  const retained=await T.call('collection_history',{run:completed.run}); assert.equal(retained.status,'cancelled'); assert.ok(retained.cases.length); assert.equal(C.check(retained).ok,false);
});

test('fifty typed complex datasets preserve exact money/large ids and never leak captures', async () => {
  const rows=Array.from({length:50},(_,i)=>({tenant:`tenant-${i%7}`,payload:{id:`900719925474099${String(i).padStart(2,'0')}`,money:`${i}.000001`,items:[{sku:`s-${i}`,qty:i+1}]}}));
  script('fifty/quote',{params:{tenant:{type:'string',required:true},payload:{type:'object',required:true}},vars:{seen:null},steps:[{tool:'find',args:{previous:'{{seen}}',tenant:'{{tenant}}',payload:'{{payload}}'},capture:{seen:'tenant'},assertions:[{name:'exact payload',path:'payload',op:'equal',value:'{{payload}}'},{name:'one item',path:'payload.items',op:'count',value:1}]}]});
  C.save('fifty',{suite:{datasets:rows}});
  let calls=0;
  const r=await C.run('fifty',{seed:'fixed'}, {schemas:[{name:'find'}],call:async(name,args)=>{calls++;assert.equal(args.previous,null);return args;}});
  assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(calls,50);assert.equal(r.counts.passed,50);assert.equal(r.cases.reduce((n,c)=>n+c.result.tests.passed,0),100);
});
