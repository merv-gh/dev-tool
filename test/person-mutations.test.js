const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const F = require('../dev/person-mutations');
const E = require('../dev/eval-person-mutations');

test('reference: whole-name policy, boundary dates, stable tie-break and registry fallback', () => {
  const d = F.dataset(42, 1), at = id => d.cases.find(c => c.id === id).expected;
  assert.equal(at(101).sourceDocumentId, 1011); // annulled newer document loses
  assert.equal(at(102).sourceDocumentId, 1021); // inactive
  assert.equal(at(103).sourceDocumentId, 1031); // tomorrow
  assert.equal(at(104).sourceDocumentId, 1041); // expired yesterday
  assert.equal(at(105).sourceDocumentId, 1052); // valid through today
  assert.equal(at(106).sourceDocumentId, 1062); // effective today
  assert.equal(at(107).sourceDocumentId, 1071); // issue date is irrelevant
  assert.equal(at(108).sourceDocumentId, 1082); // same effective date
  assert.equal(at(109).sourceDocumentId, 1091); // incomplete newer name
  assert.equal(at(110).fio.patronymic, null); // never borrow registry middle name
  assert.equal(at(114).sourceDocumentId, 1141); // null family name
  assert.equal(at(115).sourceDocumentId, null); // all invalid
  assert.equal(at(100).fio.lastName, 'Смирнов');
  assert.equal(at(112).birthDate, '1990-04-05');
  assert.equal(at(113).address.city, 'Город-113');
  assert.equal(at(116).fullName, 'Полное Мария');
});
test('hidden people differ by seed/name/id and row order; oracle isolates person relationships', () => {
  const a = F.dataset(37, 4), b = F.dataset(43, 4);
  assert.equal(a.cases.length, 68); assert.equal(new Set(a.people.map(p => p.id)).size,68);
  assert.notDeepEqual(a.cases.slice(17),b.cases.slice(17));
  const p = a.people[0], foreign = {...a.documents[0], active:true, annulled:false, effective_from:'2000-01-01', expires_on:null};
  assert.equal(F.reference(p,[foreign],a.asOf).sourceDocumentId,null);
  assert.deepEqual(F.diff({fio:{lastName:'Иванова'}},{fio:{lastName:'Анна'}}),[{path:'/fio/lastName',expected:'Иванова',actual:'Анна'}]);
});
test('all source mutations and compound cases apply once to real fixture; duplicate application is rejected', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'dt-person-fixture-test-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for (const id of [...F.mutations.map(m=>m.id),...F.compounds]) {
    const root = path.join(dir,id); E.seed(root); const before=F.sourceDigest(root); F.mutate(root,id);
    assert.notEqual(F.sourceDigest(root),before,id); assert.throws(()=>F.mutate(root,id),/exactly once/);
    assert.ok(!fs.existsSync(path.join(root,'person-mutations.js')));
  }
});
test('replay case names cannot become filesystem paths or certify an empty/unknown case',()=>{
  assert.equal(F.validCase('../../outside'),false);assert.equal(F.validCase(''),false);assert.equal(F.validCase(undefined),false);assert.equal(F.validCase('annulled+unknown'),false);assert.equal(F.validCase('annulled+future'),true);
});
test('model evaluation guards protect assertions, source boundary, database and destination', () => {
  const auth=(n,a)=>E.authorize(n,a,'mine','http://127.0.0.1:1234');
  assert.doesNotThrow(()=>auth('workspace_write',{workspace:'mine',path:F.BASE+'DocumentPolicy.java'})); // optional check=false is not required
  assert.throws(()=>auth('workspace_write',{workspace:'mine',path:'src/test/java/person/PersonHttpTest.java'}),/editable/);
  assert.throws(()=>auth('workspace_read',{workspace:'mine',path:'.dt/classpath.txt'}),/Read only/);
  assert.throws(()=>auth('workspace_read',{workspace:'mine',path:'src/../../config.json'}),/Read only/);
  assert.throws(()=>auth('code_search',{repo:'DEMO/other'}),/only repo/);
  assert.throws(()=>auth('pg_query',{env:'prod',db:'person'}),/fixture/);
  assert.throws(()=>auth('test_run',{workspace:'mine',tests:['other.Test']}),/only person/);
  assert.throws(()=>auth('api_request_replay',{request:{method:'GET',url:'http://example.test/person/1'}}),/owned fixture/);
  assert.throws(()=>auth('api_request_replay',{request:{method:'POST',url:'http://127.0.0.1:1234/person/1'}}),/owned fixture/);
  assert.throws(()=>auth('mapping_debug',{action:'save',definition:{env:'fixture',request:{method:'GET',url:'http://example.test/person/1'}}}),/owned fixture/);
});
test('standalone practice repo persists UTF-8 seed and Git baseline without copying the oracle or overwriting work',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt-person-public-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const r=require('../dev/create-person-repo').create(dir);assert.match(r.baseline,/^[a-f0-9]{40}$/);assert.equal(r.oracleIncluded,false);
  assert.match(fs.readFileSync(path.join(dir,'src/test/resources/seed.sql'),'utf8'),/Иванова/);assert.ok(fs.existsSync(path.join(dir,'.git')));
  assert.ok(!fs.existsSync(path.join(dir,'person-mutations.js')));assert.throws(()=>require('../dev/create-person-repo').create(dir),/never overwritten/);
});
test('HTTP failure evidence preserves bounded SQL causes and application locations',()=>{
  const text='noise\nERROR query failed\nCaused by: org.postgresql.util.PSQLException: column d.patronymic does not exist\n\tat person.PersonRepository.documents(PersonRepository.java:24)\n'+('noise\n'.repeat(1000));
  const d=require('../dev/person-runtime').diagnostics(text);assert.match(d,/column d.patronymic does not exist/);assert.match(d,/PersonRepository.java:24/);assert.ok(d.length<=2500);
});
