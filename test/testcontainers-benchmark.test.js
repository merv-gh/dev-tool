const test=require('node:test'),assert=require('node:assert/strict');
const {parseOptions,makePlan,summarize,compareRuns}=require('../dev/benchmark-testcontainers');
test('overridden even sample counts retain the arithmetic median',()=>{
 const result=compareRuns([{mode:'workspace',wallMs:300},{mode:'workspace',wallMs:100},{mode:'suite-parallel',wallMs:500}],['workspace','suite-parallel','missing']);
 assert.deepEqual(result.workspace,{samples:[100,300],medianMs:200});assert.equal(result['suite-parallel'].medianMs,500);assert.equal(result.missing.medianMs,null);
});
test('multi-container plan exposes effective overrides without Docker or launching builds',()=>{
 const p=makePlan(parseOptions(['--databases','3','--parallelism','2','--iterations','1','--test-forks','2','--test-classes','FirstFlowTest,SecondFlowTest','--postgres-image','postgres:15-alpine','--scenarios','per-class-sequential,workspace']));
 assert.equal(p.effective.databases,3);assert.equal(p.effective.parallelism,2);assert.equal(p.effective.testForks,2);assert.deepEqual(p.effective.testClasses,['FirstFlowTest','SecondFlowTest']);assert.equal(p.effective.postgresImage,'postgres:15-alpine');assert.equal(p.scenarios[0].containersPerTestJvm,4);assert.equal(p.scenarios[1].containersPerTestJvm,0);assert.match(p.scenarios[1].lifetime,/private/);
 for(const args of [['--typo','x'],['--databases','0'],['--scenarios','workspace,workspace'],['--parallelism'],['--pull','sometimes'],['--compile-only','--preflight-only']])assert.throws(()=>parseOptions(args));
});
test('parallel dependency timing is a sum, with explicit failures and lease identities',()=>{
 const s=summarize([{operation:'container.start',resource:'pg',ms:100,outcome:'ok'},{operation:'container.start',resource:'kafka',ms:150,outcome:'failed',errorType:'TimeoutException'},{operation:'dependencies.bound',lease:'first',databaseNames:['private1'],topic:'topic1',ms:0,outcome:'ok'},{operation:'flow.http',pid:42,ms:5,outcome:'ok'}]);
 assert.equal(s.operations['container.start'].sumMs,250);assert.equal(s.operations['container.start'].maxMs,150);assert.equal(s.operations['container.start'].failed,1);assert.deepEqual(s.processes,[42]);assert.equal(s.leases[0].topic,'topic1');assert.equal(s.failures[0].resource,'kafka');
});
