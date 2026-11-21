const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../dev/eval-test-leases-model');
test('model reasoning and budgets are explicit, and retries preserve their input report',()=>{
 const args=['--endpoint','http://127.0.0.1:11434','--gradle','gradle','--java-home','jdk'];
 assert.equal(E.options(args).think,true);
 assert.equal(E.options(args).contextWindow,32768);
 assert.equal(E.options([...args,'--context-window','16384']).contextWindow,16384);
 assert.throws(()=>E.options([...args,'--context-window','2048']),/at least 4096/);
 assert.equal(E.options([...args,'--think','false','--max-tokens','4000']).think,false);
 assert.throws(()=>E.options([...args,'--think','sometimes']),/true or false/);
 assert.throws(()=>E.options([...args,'--resume','work/previous.json','--output','work/previous.json']),/preserve/);
});
test('migration fixture preserves the independent entry-to-exit assertions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-adapter-fixture-'));
 try{
  const created=E.seed(root),original=fs.readFileSync(path.join(__dirname,'fixtures/multi-containers/src/test/java/demo/FlowTest.java'),'utf8');
  const body=s=>s.slice(s.indexOf('    @Test void'),s.indexOf('    public static class Dependencies'));
  assert.equal(body(created.oracle),body(original));
  assert.match(created.oracle,/LeaseAdapter\.properties\(properties\)/);
  assert.match(created.adapter,/"per-class-sequential"/);
  assert.match(created.adapter,/"fixture\.topic",\(\)->"quotes"/);
  assert(fs.existsSync(path.join(root,'src/main/java/demo/Quote.java')));
  assert.match(fs.readFileSync(path.join(root,'src/test/java/demo/LeaseLifecycleTest.java'),'utf8'),/sharedProvidersKeepTheContextAndBindingUntilTheLastClass/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('model can change only its adapter and cannot read private bindings or weaken tests',()=>{
 E.authorize('workspace_write',{workspace:'own',path:E.ADAPTER,check:false,content:'candidate'},'own');
 E.authorize('workspace_write',{workspace:'own',path:E.ADAPTER,content:'candidate'},'own');
 E.authorize('test_run',{workspace:'own',tests:E.TESTS,mode:'build'},'own');
 E.authorize('code_search',{repo:'work/own',pattern:'LeaseAdapter'},'own');
 for(const [name,args]of [
  ['workspace_write',{workspace:'other',path:E.ADAPTER,check:false}],
  ['workspace_write',{workspace:'own',path:'src/test/java/demo/FlowTest.java',check:false}],
  ['workspace_read',{workspace:'own',path:'.dt/pool-bindings.json'}],
  ['code_search',{repo:'another-repo',pattern:'secret'}],
  ['test_run',{workspace:'own',tests:E.TESTS,files:[{path:'override',content:'bad'}]}],
  ['test_run',{workspace:'own',tests:E.TESTS,target:'live-dev'}],
  ['workspace_push',{workspace:'own'}]
 ])assert.throws(()=>E.authorize(name,args,'own'),name);
});
test('grading requires fresh checks of both providers and verified cleanup',()=>{
 const report={state:'passed',cleanup:{state:'verified'},runs:['suite-parallel','workspace'].map(mode=>({mode,tests:{total:3,failed:0},exit:0}))};
 assert.equal(E.grade(report),true);
 for(const change of [r=>r.state='failed',r=>r.cleanup.state='recovered',r=>r.runs.pop(),r=>r.runs[0].tests.total=0,r=>r.runs[1].tests.failed=1]){const bad=structuredClone(report);change(bad);assert.equal(E.grade(bad),false);}
});
test('long model test runs retain workspace identity when polling the owned job',async()=>{
 const calls=[];
 const result=await E.settleOwned({state:'running',job:'owned-job'},'test_run',{workspace:'own'},async(name,args)=>{
  calls.push({name,args});assert.equal(args.workspace,'own');assert.equal(args.job,'owned-job');
  return calls.length===1?{state:'running',job:'owned-job'}:{state:'done',outcome:'passed'};
 },Date.now()+1000);
 assert.equal(result.outcome,'passed');assert.equal(calls.length,2);
 await assert.rejects(E.settleOwned({state:'running',job:'owned-job'},'test_run',{workspace:'own'},()=>assert.fail('Expired job must not poll'),Date.now()-1),/budget/);
});
test('a retry uses the prior candidate and measured verdict, without replaying its tool transcript',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-lease-retry-')),file=path.join(root,'previous.json');
 try{
  const previous={protocol:'dt.test-leases-model/v1',model:'local-model',adapter:'candidate source',independent:{state:'failed',runs:[{contexts:3}]} ,transcript:['not task guidance']};
  fs.writeFileSync(file,JSON.stringify(previous));const resumed=E.resumeCandidate(file);
  assert.equal(resumed.adapter,'candidate source');assert.equal(resumed.feedback.runs[0].contexts,3);assert.match(resumed.parentSha256,/^[a-f0-9]{64}$/);assert.equal(resumed.transcript,undefined);
  delete previous.independent;fs.writeFileSync(file,JSON.stringify(previous));assert.throws(()=>E.resumeCandidate(file),/graded/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
