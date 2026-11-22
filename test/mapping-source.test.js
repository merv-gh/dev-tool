const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-mapping-source-test-'));
process.env.DT_HOME=home;process.env.DT_STATE_BACKEND='legacy';process.env.DT_LOG='quiet';process.env.DT_NO_DOCTOR='1';
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{fixture:{}},tests:{compileCheck:false},scripts:{starters:false}}));
test('one bounded source discovery follows the actual HTTP-to-SQL/policy/DTO chain and refreshes after edits',async t=>{
  const E=require('../dev/eval-person-mutations'),F=require('../dev/person-mutations'),W=require('../lib/workspace'),A=require('../lib/access');
  const id='person-mapping-test',root=path.join(home,'work',id);E.seed(root);F.mutate(root,'annulled');
  require('../lib/util').writeJson(path.join(home,'cache/work',id+'.json'),{id,path:root,project:'DEMO',repo:'person',sha:'a'.repeat(40),owner:A.owner(),createdAt:new Date().toISOString(),dirty:true});
  t.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
  const source=require('../lib/mapping-source'),r=source({workspace:id});
  assert.equal(r.proof.runtimeLineageVerified,false);assert.ok(r.entries.some(e=>e.method==='person.PersonController#person'));
  for(const file of ['PersonController.java','PersonRepository.java','DocumentPolicy.java','PersonMapper.java','PersonData.java'])assert.ok(r.files.some(f=>f.path.endsWith(file)),file);
  assert.ok(r.files.some(f=>f.text.includes('&& true')));assert.ok(Buffer.byteLength(JSON.stringify(r))<=16384);
  const small=source({workspace:id,max_output_bytes:4096});assert.ok(Buffer.byteLength(JSON.stringify(small))<=4096);assert.ok(small.omitted.length);
  W.write(id,F.BASE+'DocumentPolicy.java',{edits:[{find:'&& true',replace:'&& !d.annulled()'}]});const after=source({workspace:id});assert.notEqual(after.digest,r.digest);assert.ok(after.files.find(f=>f.path.endsWith('DocumentPolicy.java')).text.includes('&& !d.annulled()'));
  assert.equal(source({workspace:id,entry:'absent'}).entries.length,0);
  const file=F.BASE+'PersonController.java',controller=W.read(id,file,{lineNumbers:false}).text;W.write(id,file,{content:controller.replace('/person/{id}','/'+('route'.repeat(1500))+'/{id}')});const huge=source({workspace:id,max_output_bytes:4096});assert.ok(Buffer.byteLength(JSON.stringify(huge))<=4096);assert.ok(huge.gaps.some(g=>/metadata/.test(g)));
  A.run({principalId:'someone-else',multiUser:true,storyId:'other'},()=>assert.throws(()=>source({workspace:id}),/workspace|available|own/));
});
