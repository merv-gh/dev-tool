const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-node-target-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
for (const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_BUILD_DIR','DT_RUNNER_URL','DT_TOOLS']) delete process.env[k];
const config = { envs: { dev: {}, staging: {} }, tests: { waitMs: 5000, timeoutMs: 2500, compileCheck: false, targets: { captured: { reviewed: true, kind: 'captured-dev', environment: 'dev', effects: 'scratch' }, unreviewed: { kind: 'live-dev' }, broken: { reviewed: true, kind: 'live-dev' }, remote: { reviewed: true, kind: 'live-dev', allowLive: true, runnerUrl: 'http://127.0.0.1:9', environment: 'dev', deployment: { revision: 'abc123', service: 'shipping' }, dependencies: [{ id: 'orders', kind: 'postgres', environment: 'dev', access: 'read-only' }], effects: 'read-only', env: { SOURCE_MARK: 'dev-target' } } }, differentialProfiles: { projection: { reviewed: true, kind: 'node-module', module: 'src/projection.cjs', export: 'load', observeFiles: ['result.txt'] } } } };
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
const U = require('../lib/util'), W = require('../lib/workspace');
function workspace(id, sources) {
  const root = path.join(home, 'work', id); fs.mkdirSync(root, { recursive: true });
  for (const [rel, text] of Object.entries(sources)) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f,text); }
  U.writeJson(path.join(home,'cache','work',`${id}.json`),{ id, path: root, project: 'T', repo: id, sha:'initial', createdAt: new Date().toISOString(), dirty:true });
  return root;
}
let root;
test.before(() => { root = workspace('node', { 'src/value.cjs': 'module.exports=1', 'test/value.test.cjs': `const t=require('node:test'),a=require('node:assert/strict');t('correct value',()=>a.equal(require('../src/value.cjs'),2));t('clean environment',()=>a.equal(process.env.DT_PARENT_SECRET,undefined));` }); process.env.DT_PARENT_SECRET='must-not-leak'; });
test.after(() => { delete process.env.DT_PARENT_SECRET; fs.rmSync(home, { recursive:true, force:true }); });
const call = (name,args) => require('../lib/tools').call('tool_execute',{name,arguments:args});
test('Node tests execute through registry with actual red/green history and explicit local provenance', async () => {
  const red = await call('test_run',{workspace:'node',tests:['test/value.test.cjs'],env:'dev'});
  assert.equal(red.outcome,'failed'); assert.equal(red.counts.failed,1); assert.equal(red.counts.passed,1);
  assert.equal(red.execution.kind,'local'); assert.equal(red.execution.sourceEnvironment,'dev'); assert.equal(red.execution.host.placement,'local');
  const green = await call('test_run',{workspace:'node',tests:['test/value.test.cjs'],files:[{path:'src/value.cjs',content:'module.exports=2'}]});
  assert.equal(green.outcome,'passed'); assert.equal(green.counts.tests,2); assert.ok(W.checkId('node'));
  assert.equal(require('../lib/testrun').proof('node').find(x=>x.test.endsWith('#correct value')).verdict,'red-green');
});
test('empty and skip-only Node files never yield a passing run; errors remain structured', async () => {
  W.write('node','test/empty.test.cjs',{content:'module.exports=123'});
  W.write('node','test/skip.test.cjs',{content:`require('node:test').skip('later',()=>{})`});
  W.write('node','test/broken.test.cjs',{content:'throw new TypeError("bad module")'});
  assert.equal((await call('test_run',{workspace:'node',tests:['test/empty.test.cjs']})).outcome,'no-tests-ran');
  assert.equal((await call('test_run',{workspace:'node',tests:['test/skip.test.cjs']})).outcome,'all-tests-skipped');
  const broken = await call('test_run',{workspace:'node',tests:['test/broken.test.cjs']});
  assert.equal(broken.outcome,'failed'); assert.equal(broken.counts.failed,1);
  await assert.rejects(()=>require('../lib/testrun').run('node',{tests:['--eval=bad.cjs']}),/no test class/);
  fs.symlinkSync(__filename,path.join(root,'test','escape.test.cjs'));
  await assert.rejects(()=>require('../lib/testrun').run('node',{tests:['test/escape.test.cjs']}),/escapes workspace/);
});
test('reviewed target manifests fail closed; live runner outage never falls back locally', async () => {
  const T = require('../lib/test-targets');
  assert.throws(()=>T.resolve('unreviewed'),/not reviewed/); assert.throws(()=>T.resolve('broken'),/requires/); assert.throws(()=>T.resolve('captured'),/fixture_path/);
  assert.throws(()=>T.resolve('remote',{env:'staging'}),/conflicts/);
  assert.throws(()=>T.resolve('remote',{db:{db:'orders'}}),/scratch/);
  const result = await call('test_run',{workspace:'node',tests:['test/value.test.cjs'],target:'remote',env:'dev'});
  assert.notEqual(result.outcome,'passed'); assert.equal(result.execution.kind,'live-dev'); assert.equal(result.execution.host.placement,'remote');
  assert.equal(result.counts.tests,0); assert.match(result.tail,/runner/);
});
test('all execution inputs and exact file contents change job identity; property ordering does not', () => {
  const {jobKey}=require('../lib/test-targets'), base={workspace:'node',tests:['test/value.test.cjs']};
  const key=jobKey(base); assert.equal(key,jobKey({tests:base.tests,workspace:'node'}));
  for(const extra of [{env:'dev'},{env:'staging'},{db:'orders'},{target:'remote'},{mode:'build'},{fixture_path:'a'},{fixture_bindings:{orders:'ONE'}},{files:[{path:'x.cjs',content:'one'}]},{check:false}])assert.notEqual(key,jobKey({...base,...extra}));
  const f=path.join(root,'src','value.cjs'), st=fs.statSync(f); fs.writeFileSync(f,'module.exports=3'); fs.utimesSync(f,st.atime,st.mtime); assert.notEqual(key,jobKey(base),'same-size same-mtime source edits change content fingerprint');
});
test('timeout and cancellation kill a subprocess descendant', async () => {
  const {execLocal}=require('../lib/testrun'), pidfile=path.join(home,'child.pid');
  const script=`const {spawn}=require('child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);require('fs').writeFileSync(${JSON.stringify(pidfile)},String(p.pid));setInterval(()=>{},1000);`;
  const r=await execLocal(process.execPath,['-e',script],{cwd:home,env:{PATH:process.env.PATH},timeoutMs:250});assert.equal(r.killed,true);
  const pid=Number(fs.readFileSync(pidfile)); await new Promise(r=>setTimeout(r,150)); assert.throws(()=>process.kill(pid,0),/ESRCH/);
  const J=require('../lib/jobs');const j=J.start('cancel-node','cancel node',()=>execLocal(process.execPath,['-e',script],{cwd:home,env:{PATH:process.env.PATH},timeoutMs:10000}));
  await new Promise(r=>setTimeout(r,250));const child=Number(fs.readFileSync(pidfile));assert.equal(J.cancel(j.id).stopped,1);await j.promise;await new Promise(r=>setTimeout(r,150));assert.throws(()=>process.kill(child,0),/ESRCH/);
});
test('differential tool preserves types/order/null/error/effects and reports exact executable evidence', async () => {
  workspace('before',{'src/projection.cjs':`exports.load=(n)=>{if(n==='error')throw new TypeError('invalid');require('fs').writeFileSync('result.txt',String(n));return {id:'9007199254740993',amount:'1.2300',optional:null,items:[n,undefined,1n,-0]}}`});
  workspace('after',{'src/projection.cjs':`exports.load=(n)=>{if(n==='error')throw new TypeError('invalid');require('fs').writeFileSync('result.txt',String(n));const extra={id:'9007199254740993',amount:'1.2300',optional:null,items:[n,undefined,1n,-0]};return extra}`});
  const inputs=[{id:'tenant-22',args:[22]},{id:'error',args:['error']}];
  const same=await call('differential_check',{profile:'projection',baseline:'before',candidate:'after',inputs});assert.equal(same.outcome,'equivalent');assert.equal(same.counts.cases,2);assert.match(same.view,/\/show\//);assert.equal(same.proof.databaseEffects,false);
  W.write('after','src/projection.cjs',{content:`exports.load=n=>({id:9007199254740992,amount:'1.23',optional:undefined,items:[n]})`});
  const diff=await call('differential_check',{profile:'projection',baseline:'before',candidate:'after',inputs});assert.equal(diff.outcome,'different');assert.notEqual(diff.versions[0].moduleSha256,diff.versions[1].moduleSha256);
  assert.throws(()=>require('../lib/differential').normalize({},{kind:'sort'}),/iterable/);
});
