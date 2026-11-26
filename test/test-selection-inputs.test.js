const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-selector-inputs-'));
const S=require('../lib/test-selection'),N=require('../lib/node-test');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('JSON-encoded selector arrays from small models normalize before comma splitting',()=>{
  assert.deepEqual(S.normalize({workspace:'demo',tests:'["test/a.test.cjs","test/b.test.cjs"]'}).tests,['test/a.test.cjs','test/b.test.cjs']);
  assert.equal(S.normalize({workspace:'demo',tests:'["-diff"]'}).scope,'diff');
  assert.equal(S.normalize({workspace:'demo',tests:'[]'}).scope,'all');
  assert.deepEqual(S.normalize({workspace:'demo',tests:'[id].test.cjs'}).tests,['[id].test.cjs']);
  assert.throws(()=>S.normalize({workspace:'demo',tests:'[42]'}),/test name|nonempty/);
  assert.throws(()=>S.normalize({workspace:'demo',tests:'["a",broken]'}),/JSON|array/);
});
test('short Node test filenames resolve only when unique, with explicit paths retaining precedence',()=>{
  const put=(file)=>{const f=path.join(root,file);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,"require('node:test')('works',()=>{})");};
  put('test/a.test.cjs');assert.equal(N.find(root,'a.test.cjs').file,'test/a.test.cjs');
  put('other/a.test.cjs');assert.throws(()=>N.find(root,'a.test.cjs'),/ambiguous|multiple/i);
  assert.equal(N.find(root,'test/a.test.cjs').file,'test/a.test.cjs');
  put('test/fixtures/sample.test.cjs');assert.equal(N.find(root,'sample.test.cjs'),null);
  put('test/helper.cjs');assert.equal(N.find(root,'helper.cjs'),null);
  assert.equal(N.find(root,'--eval=a.test.cjs'),null);
});
