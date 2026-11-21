const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('compiler feedback retains missing symbols and normalizes real paths through a workspace symlink',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-compile-feedback-'));
 try{
  process.env.DT_HOME=home;process.env.DT_NO_DOCTOR='1';process.env.DT_LOG='quiet';
  for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_BUILD_DIR'])delete process.env[key];
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{fixture:{}}}));
  const root=path.join(home,'actual'),alias=path.join(home,'alias');fs.mkdirSync(root);fs.symlinkSync(root,alias,'dir');
  const real=fs.realpathSync(root),file=path.join(real,'source files','КлассTest.java');
  const output=`${file}:14: error: cannot find symbol\n    static void before(TestContext context) {}\n                       ^\n  symbol:   class TestContext\n  location: class LeaseAdapter\n${file}:15: error: incompatible types\n  required: String\n  found: int\n`;
  const errors=require('../lib/testrun').compileErrors(output,alias);
  assert.equal(errors[0].file,'source files/КлассTest.java');
  assert.equal(errors[0].message,'cannot find symbol');
  assert.deepEqual(errors[0].details,['symbol:   class TestContext','location: class LeaseAdapter']);
  assert.deepEqual(errors[1].details,['required: String','found: int']);
  const compact=require('../lib/testout').compactLog(output);
  assert.match(compact,/symbol:   class TestContext/);assert.match(compact,/location: class LeaseAdapter/);
  assert.match(compact,/required: String/);assert.match(compact,/found: int/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
