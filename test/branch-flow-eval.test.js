const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const F=require('../dev/branch-flow-fixture'),{options}=require('../dev/eval-branch-flows');
test('synthetic feature oracle rejects the bug independently of edited tests and accepts a real entry-to-exit fix',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-flow-fixture-'));
 try{
  const f=F.create(root);assert.notEqual(f.baseline,f.feature);assert.equal(F.grade(root).passed,false);
  const execute=()=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;return require('node:child_process').spawnSync(process.execPath,['--test','test/rebate.test.cjs'],{cwd:root,encoding:'utf8',timeout:30000,env});};
  assert.equal(execute().status,1,'public regression must expose the seeded ledger mismatch');
  fs.writeFileSync(path.join(root,'test/payment.test.cjs'),'require("node:test")("always green",()=>{})');
  assert.equal(F.grade(root).passed,false);
  fs.writeFileSync(path.join(root,F.FILE),fs.readFileSync(path.join(root,F.FILE),'utf8').replace('ledger.save(tenant, gross);','ledger.save(tenant, payable);'));
  assert.deepEqual(F.grade(root),{passed:true,cases:13});
  assert.equal(execute().status,0,'entry-to-exit regression passes only after the real fix');
  fs.writeFileSync(path.join(root,F.FILE),fs.readFileSync(path.join(root,F.FILE),'utf8').replace('rebate < 0 || rebate > gross','rebate < 0 || rebate >= gross'));
  assert.equal(F.grade(root).passed,false,'full rebate is a valid boundary case');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('real-model evaluator accepts only loopback transports and bounded inputs',()=>{
 assert.equal(options([]).model,'qwen3.5:4b');
 assert.throws(()=>options(['--endpoint','http://example.com']),/loopback/);
 assert.throws(()=>options(['--semanticUrl','http://localhost:44110?secret=x']),/loopback/);
 assert.throws(()=>options(['--maxCalls','0']),/budget/);
 assert.throws(()=>options(['--maxTurns','100']),/budget/);
 assert.throws(()=>options(['--task','invented']),/format\/task/);
});
