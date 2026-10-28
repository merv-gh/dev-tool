const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-template-unit-'));process.env.DT_HOME=home;for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{}}},tests:{waitMs:1}}));
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const T = require('../lib/testdb-templates');
const DB = require('../lib/testdb');

test('template keys preserve semantics but ignore object key order', () => {
  assert.equal(T.hash({ b: [{ z: 1, a: 2 }], a: 3 }), T.hash({ a: 3, b: [{ a: 2, z: 1 }] }));
  assert.notEqual(T.hash({ rows: [1, 2] }), T.hash({ rows: [2, 1] }));
  assert.notEqual(T.hash({ mask: 'v1' }), T.hash({ mask: 'v2' }));
});
test('scratch protection rejects a different database on a configured environment server', () => {
  assert.equal(DB.sameServer('postgres://a:p@localhost/dev', 'postgres://b:q@127.0.0.1:5432/postgres'), true);
  assert.equal(DB.sameServer('postgres://a:p@db:5432/dev', 'postgres://a:p@db:5433/dev'), false);
  assert.equal(DB.sameServer('not a url', 'other'), false);
});
test('template planning validates modes, scopes, compatibility input and SQL budgets offline', () => {
  const sql = { databases: { a: { statements: ['create table x(id int)'] } } };
  assert.equal(T.inputs(sql).mode, 'snapshot');
  assert.equal(T.inputs({ ...sql, mode: 'migrations-empty' }).mode, 'migrations-empty');
  assert.throws(() => T.inputs({ ...sql, mode: 'upgrade' }), /needs an immutable base/);
  assert.throws(() => T.inputs({ ...sql, mode: 'bad' }), /mode/);
  assert.throws(() => T.inputs({ databases: {} }), /1..32/);
  assert.throws(() => T.inputs({ ...sql, sanity: [{ db: 'a', sql: 'delete from x', expected: [] }] }), /read-only/);
  assert.throws(() => DB.checkStatements(['create database another']), /cluster administration/);
  assert.throws(() => DB.checkStatements(['DROP ROLE user1']), /cluster administration/);
  assert.throws(() => DB.checkStatements(['copy foo to program \'bad\'']), /cluster administration/);
  assert.throws(() => DB.checkStatements([42]), /SQL strings/);
});
test('clone settings and lease/key inputs fail before connecting', async () => {
  assert.throws(() => T.validateSettings({ 'timezone; drop database foo': 'UTC' }), /invalid clone setting/);
  assert.throws(() => T.validateSettings({ timezone: {} }), /invalid clone setting/);
  await assert.rejects(T.clone({ ttlMs: 0 }), /ttlMs/);
  await assert.rejects(T.clone({ idempotencyKey: 'x'.repeat(201) }), /idempotencyKey/);
});
test('all PostgreSQL lifecycle stages are independently exposed with semantic descriptions', () => {
  const tools = require('../lib/tools-testdb')({ str: description => ({ type: 'string', description }), int: (description, def) => ({ type: 'integer', description, default: def }) });
  for (const name of ['testdb_capabilities','testdb_template_pin','testdb_template_plan','testdb_lease_inspect','testdb_initialize','testdb_resources','testdb_template_build','testdb_template_list','testdb_template_inspect','testdb_template_verify','testdb_template_invalidate','testdb_clone','testdb_lease_renew','testdb_reset','testdb_release','testdb_gc']) {
    assert.equal(tools.filter(t => t.name === name).length, 1);
    assert.ok(tools.find(t => t.name === name).description.length > 60);
  }
});

test('language-neutral plan, capability and schema descriptors can cross a JSON transport', () => {
  const caps=T.capabilities();assert.equal(caps.version,1);assert.equal(caps.protocol,'dt.postgres.templates/v1');
  const plan=T.plan({databases:{a:{statements:['create table x(id bigint)']}}});assert.equal(plan.databases[0].statements,1);assert.equal(plan.databases[0].sqlBytes,25);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)),plan);
  const schema=require('../docs/contracts/postgres-template-v1.schema.json');assert.equal(schema.$defs.lease.properties.version.const,1);assert.equal(schema.$defs.lease.properties.databases.additionalProperties.$ref,'#/$defs/binding');
});
test('long Open WebUI builds return a resumable job and cancellation reaches the adapter signal', async () => {
  const tools=require('../lib/tools-testdb')({str:description=>({type:'string',description}),int:(description,def)=>({type:'integer',description,default:def})});
  const build=tools.find(t=>t.name==='testdb_template_build'),original=T.build;let cancelled=false;
  T.build=async ({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason)},{once:true});});
  try{const started=await build.run({workspace:'unit',directory:'src/test/resources/dt-fixtures/unit'});assert.equal(started.state,'running');assert.ok(started.job);require('../lib/jobs').cancel(started.job);await require('../lib/jobs').find(started.job).promise;assert.equal(cancelled,true);const polled=await build.run({job:started.job});assert.equal(polled.state,'cancelled');assert.match(polled.error,/cancelled/);}
  finally{T.build=original;}
});
test('clone tool jobs persist only lease IDs and visualization artifacts never persist passwords or closures', async () => {
 const tools=require('../lib/tools-testdb')({str:description=>({type:'string',description}),int:(description,def)=>({type:'integer',description,default:def})});
 const clone=tools.find(t=>t.name==='testdb_clone'),oc=T.clone,ol=T.lease;
 T.clone=async()=>({version:1,lease:'a'.repeat(32),reused:false,cleanup:()=>{}});
 T.lease=async()=>({version:1,lease:'a'.repeat(32),template:'b'.repeat(64),expiresAt:new Date().toISOString(),databases:{a:{password:'sensitive-unit-password',database:'dt_test_example'}},cleanup:()=>{}});
 try{let r=await clone.run({template:'b'.repeat(64)});if(r.state==='running'){await require('../lib/jobs').find(r.job).promise;r=await clone.run({job:r.job});}assert.equal(r.state,'done');assert.equal(r.cleanup,undefined);assert.equal(r.databases.a.password,'sensitive-unit-password');const job=require('../lib/jobs').find(r.job);assert.doesNotMatch(JSON.stringify(job.result),/sensitive-unit-password|cleanup/);for(const f of fs.readdirSync(path.join(home,'cache/results')))assert.doesNotMatch(fs.readFileSync(path.join(home,'cache/results',f),'utf8'),/sensitive-unit-password/);}
 finally{T.clone=oc;T.lease=ol;}
});

test('the configured environment database is rejected before connection, with loopback aliases normalized',()=>{
 const file=path.join(home,'config.json'),prior=fs.readFileSync(file,'utf8');
 try{fs.writeFileSync(file,JSON.stringify({envs:{dev:{postgres:{source:'postgres://read:only@127.0.0.1:5432/source'}}},tests:{pgUrl:'postgres://test:secret@localhost/source'}}));require('../lib/config').reload();assert.throws(()=>DB.server(),/is the dev database/);
 fs.writeFileSync(file,JSON.stringify({envs:{dev:{postgres:{source:'postgres://read:only@127.0.0.1:5432/source'}}},tests:{pgUrl:'postgres://test:secret@localhost/scratch'}}));require('../lib/config').reload();assert.match(DB.server(),/scratch$/);const binding=DB.credentials('dt_test_driver',{user:'app',password:'ephemeral'});assert.deepEqual(binding.endpoint,{host:'localhost',port:5432,database:'dt_test_driver',parameters:{}});assert.equal(binding.user,'app');}
 finally{fs.writeFileSync(file,prior);require('../lib/config').reload();}
});
