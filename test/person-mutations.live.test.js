const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const enabled=process.env.DT_PERSON_MUTATIONS_LIVE==='1';
test('real PostgreSQL and rebuilt Spring HTTP kill every person-service mutation', {skip:!enabled,timeout:12*60000},async t=>{
  const gradle=process.env.DT_TEST_GRADLE,java=process.env.JAVA_HOME;
  assert.ok(gradle&&java,'Set DT_TEST_GRADLE and JAVA_HOME (Java 21)');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt-person-live-result-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const output=path.join(dir,'report.json');
  await require('../dev/person-runtime').command(process.execPath,[path.join(__dirname,'../dev/eval-person-mutations.js'),'--gradle',gradle,'--java-home',java,'--output',output],{timeoutMs:11*60000});
  const r=JSON.parse(fs.readFileSync(output));assert.equal(r.passed,true);assert.equal(r.cases.length,23);assert.ok(r.cases.every(c=>c.killed));assert.equal(r.cleanup.verified,true);
});
