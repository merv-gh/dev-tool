const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-template-live-'));
process.env.DT_HOME = home;
for (const name of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR']) delete process.env[name];
const url = process.env.DT_TEST_PG_URL;
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { source: 'postgres://source:source@127.0.0.1:1/source' } } }, tests: { pgUrl: url } }));
const DB = require('../lib/testdb'), T = require('../lib/testdb-templates');
const pg = require('postgres');
const skip = !url && 'set DT_TEST_PG_URL to a dedicated scratch PostgreSQL';
const spec = {
  policy: { masking: 'deterministic-v1', referenceData: '2026-10' },
  databases: {
    commerce: { statements: [
      'create schema sales',
      'create table sales.customer(tenant int,id bigint,primary key(tenant,id))',
      'create table sales.orders(id bigint generated always as identity primary key, tenant int not null, customer_id bigint not null, amount numeric(16,6), generated_amount numeric generated always as (amount * 2) stored, foreign key(tenant,customer_id) references sales.customer(tenant,id))',
      'insert into sales.customer values(1,9007199254740993),(2,9007199254740993)',
      'insert into sales.orders(tenant,customer_id,amount) select 1,9007199254740993,42.123456 from generate_series(1,2500)',
      'create table sales.log(id bigint, detail text)',
      'create table sales.events(tenant int,id bigint,payload jsonb) partition by list(tenant)',
      'create table sales.events_t1 partition of sales.events for values in (1)',
      `insert into sales.events values(1,9007199254740993,'{"status":"PAID"}')`,
      "create type sales.order_status as enum ('OPEN','CLOSED')",
      'create domain sales.positive_money as numeric(16,6) check(value >= 0)',
      'create table sales.typed(id int,status sales.order_status,amount sales.positive_money)',
      "insert into sales.typed values(1,'OPEN',42.123456)",
      'create view sales.summary as select tenant,count(*) from sales.orders group by tenant',
      'create index orders_customer_idx on sales.orders(tenant,customer_id)',
      "create function sales.audit() returns trigger language plpgsql as $$ begin insert into sales.log values(new.id,'insert'); return new; end $$",
      'create trigger audit after insert on sales.orders for each row execute function sales.audit()',
    ] },
    risk: { statements: ['create schema risk', 'create table risk.account(tenant int primary key,enabled boolean not null)', 'insert into risk.account values(1,true),(2,false)'] },
  },
  sanity: [{ db: 'commerce', name: 'tenant-isolation', sql: 'select count(*)::text as count from sales.orders where tenant=2', expected: [{ count: '0' }] }],
};
function app(config) { const u = new URL(url); u.pathname = '/' + config.database; u.username = config.user; u.password = config.password; return pg(u.toString(), { max: 1, connect_timeout: 2, onnotice: () => {} }); }
async function appQuery(config, query) { const s = app(config); try { return await s.unsafe(query); } finally { await s.end({ timeout: 1 }); } }
async function child(code) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DT_HOME: home }, stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', b => stdout += b); proc.stderr.on('data', b => stderr += b); proc.on('error', reject);
    proc.on('close', (exit, signal) => resolve({ exit, signal, stdout, stderr }));
  });
}
let base;
test.before(async () => { if (url) await DB.initialize({ label: 'template integration tests' }); });
test.after(async () => {
  try { if (url) { await DB.withControl(sql => sql.unsafe(`update ${DB.SCHEMA}.leases set expires_at=now() where state <> 'released'`)); await T.gc({ templateTtlMs: 0 }); } }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('legacy DDL preparation fails closed, stops later writes and removes partial databases', { skip }, async () => {
  const before = (await DB.resources()).resources.length;
  await assert.rejects(DB.create('bad-ddl', ['create table first(id int)', 'create table bad(id not_a_type)', 'select pg_sleep(30)']), e => {
    assert.match(e.message, /statement 2/); assert.equal(e.failures[0].index, 1); assert.match(e.failures[0].statement, /create table bad/); return true;
  });
  assert.equal((await DB.resources()).resources.length, before);
  const diagnostic = await DB.create('diagnostic', ['create table first(id int)', 'select missing()'], { allowPartial: true });
  assert.equal(diagnostic.errors.length, 1); assert.equal(diagnostic.diagnostic, true); await DB.drop(diagnostic.database);
});
test('concurrent processes build one immutable, validated, prefilled multi-database template', { skip, timeout: 60000 }, async () => {
  const code = `(async()=>{const t=require('./lib/testdb-templates');console.log(JSON.stringify(await t.build(${JSON.stringify(spec)})))})().catch(e=>{console.error(e);process.exitCode=1})`;
  const result = await Promise.all([child(code), child(code), child(code)]);
  for (const r of result) assert.equal(r.exit, 0, r.stderr);
  const builds = result.map(r => JSON.parse(r.stdout));
  assert.equal(new Set(builds.map(b => b.id)).size, 1); assert.equal(builds.filter(b => !b.reused).length, 1);
  base = builds[0];
  const inspection = await T.inspect(base.id);
  assert.equal(inspection.failures.length, 0); assert.equal(inspection.databases.commerce.tables.find(t => t.name === 'orders').rows, '2500');
  assert.equal((await T.verify(base.id, { deep: true })).ok, true);
});
test('private roles, sequence state, triggers, constraints and commits remain isolated across parallel clones', { skip, timeout: 60000 }, async () => {
  const copies = await Promise.all([T.clone({ template: base.id }), T.clone({ template: base.id })]);
  try {
    const [a,b] = copies;
    assert.notEqual(a.databases.commerce.database, b.databases.commerce.database); assert.notEqual(a.databases.commerce.user, b.databases.commerce.user);
    await appQuery(a.databases.commerce, "insert into sales.orders(tenant,customer_id,amount) values(1,9007199254740993,1.250000)");
    assert.equal((await appQuery(a.databases.commerce, 'select count(*)::text as n from sales.orders'))[0].n, '2501');
    assert.equal((await appQuery(b.databases.commerce, 'select count(*)::text as n from sales.orders'))[0].n, '2500');
    assert.equal((await appQuery(a.databases.commerce, 'select count(*)::text as n from sales.log'))[0].n, '1');
    await assert.rejects(appQuery(a.databases.commerce, 'insert into sales.orders(tenant,customer_id) values(1,7)'), /foreign key/);
    await assert.rejects(appQuery({ ...a.databases.commerce, database: b.databases.commerce.database }, 'select 1'), /permission denied/);
    await assert.rejects(appQuery({ ...a.databases.commerce, database: base.databases.commerce.database }, 'select 1'), /not currently accepting connections|permission denied/);
    await assert.rejects(appQuery(a.databases.commerce, 'create database forbidden'), /permission denied/);
    assert.equal((await appQuery(a.databases.commerce, 'select id::text,payload from sales.events'))[0].id,'9007199254740993');
    assert.equal((await appQuery(a.databases.commerce, 'select amount::text from sales.typed'))[0].amount,'42.123456');
    await assert.rejects(appQuery(a.databases.commerce, "insert into sales.typed values(2,'OPEN',-1)"),/violates check constraint/);
    await assert.rejects(appQuery(a.databases.commerce, "insert into sales.typed values(2,'UNKNOWN',1)"),/invalid input value for enum/);
    assert.equal((await appQuery(a.databases.commerce, 'select count::text as n from sales.summary'))[0].n,'2501');
    assert.equal((await T.verify(base.id, { deep: true })).ok, true);
  } finally { await Promise.all(copies.map(c => c.cleanup())); }
});
test('fresh-clone reset removes committed writes and returns new bindings', { skip }, async () => {
  let c = await T.clone({ template: base.id, settings: { timezone: 'UTC' } });
  try {
    const previous = c;
    await appQuery(c.databases.risk, 'update risk.account set enabled=false where tenant=1');
    c = await T.reset(c.lease);
    assert.notEqual(c.lease, previous.lease);
    assert.equal((await appQuery(c.databases.risk, 'select enabled from risk.account where tenant=1'))[0].enabled, true);
    await assert.rejects(appQuery(previous.databases.risk, 'select 1'), /does not exist|authentication failed/);
  } finally { await c.cleanup(); }
});
test('idempotent allocation, renewal and repeated release do not duplicate resources', { skip }, async () => {
  const request = { template: base.id, runId: 'retry-test', idempotencyKey: 'template-test-retry-' + require('crypto').randomUUID() };
  const a = await T.clone(request), b = await T.clone(request);
  assert.equal(a.lease, b.lease); assert.equal(b.reused, true);
  await assert.rejects(T.clone({ ...request, runId: 'wrong-run' }), /different clone inputs/);
  await T.renew(a.lease, 60000); await a.cleanup(); await a.cleanup();
  await assert.rejects(T.clone(request), /no longer active/);
});
test('multi-database clone compensation removes partial copies and private role after failure or cancellation', { skip }, async () => {
  const original = DB.ownedCreate;
  for (const cancel of [false,true]) {
    let calls = 0; const controller = new AbortController();
    DB.ownedCreate = async (...args) => {
      if (++calls === 2 && !cancel) throw new Error('intentional second database failure');
      const r = await original(...args);
      if (cancel) controller.abort(new Error('intentional setup cancel'));
      return r;
    };
    try { await assert.rejects(T.clone({ template: base.id, runId: 'compensate', signal: controller.signal }), /intentional/); }
    finally { DB.ownedCreate = original; }
    assert.equal((await T.list()).leases.filter(l => l.runId === 'compensate' && l.state !== 'released').length, 0);
  }
});
test('process death after the first copy is recovered by lease expiry and explicit GC', { skip, timeout: 30000 }, async () => {
  const code = `const D=require('./lib/testdb'),T=require('./lib/testdb-templates'); const original=D.ownedCreate;D.ownedCreate=async(...a)=>{const r=await original(...a);process.kill(process.pid,'SIGKILL');return r}; T.clone({template:'${base.id}',runId:'killed-setup',ttlMs:1}).catch(e=>console.error(e));`;
  const killed = await child(code); assert.equal(killed.signal, 'SIGKILL');
  const leaked = (await T.list()).leases.find(l => l.runId === 'killed-setup'); assert.equal(leaked.state, 'creating');
  const cleanup = await T.gc({ templateTtlMs: 604800000 }); assert.ok(cleanup.leases.includes(leaked.lease)); assert.equal(cleanup.failures.length, 0);
  assert.equal((await DB.resources()).resources.some(r => r.lease === leaked.lease), false);
});
test('wrong ownership markers are never deleted, failures stay visible and GC retries after repair', { skip }, async () => {
  const c = await T.clone({ template: base.id, runId: 'marker-recovery', ttlMs: 1 });
  const name = c.databases.risk.database;
  let originalMarker;
  await DB.withControl(async sql => { const [db] = await sql`select shobj_description(oid,'pg_database') as comment from pg_database where datname=${name}`; originalMarker = db.comment; await sql.unsafe(`comment on database ${DB.qi(name)} is 'unrelated owner'`); });
  await assert.rejects(c.cleanup(), /ownership mismatch/);
  assert.equal((await T.list()).leases.find(l => l.lease === c.lease).state, 'cleanup-failed');
  const failed = await T.gc({ templateTtlMs: 604800000 }); assert.ok(failed.failures.length > 0);
  await DB.withControl(sql => sql.unsafe(`comment on database ${DB.qi(name)} is ${DB.ql(originalMarker)}`));
  assert.equal((await T.gc({ templateTtlMs: 604800000 })).failures.length, 0);
});
test('similarly named user databases have no ownership and cannot be dropped', { skip }, async () => {
  const name = 'dt_test_unowned_template_test';
  await DB.withControl(sql => sql.unsafe(`create database ${name}`));
  try { await assert.rejects(DB.drop(name), /no owned scratch resource/); }
  finally { await DB.withControl(sql => sql.unsafe(`drop database ${name}`)); }
});
test('partial builds, failed sanity, RLS, privileged functions and compatibility mismatches never publish ready bases', { skip, timeout: 30000 }, async () => {
  for (const statements of [
    ['create table x(id int)','select missing_function()'],
    ['create table x(id int)','alter table x enable row level security'],
    ["create function secret() returns int security definer language sql as 'select 1'"],
  ]) {
    await assert.rejects(T.build({ databases: { only: { statements } } }), /preparation failed|unsupported scratch fixture/);
  }
  await assert.rejects(T.build({ databases: { only: { statements: ['create table x(id int)'] } }, sanity: [{ db:'only',sql:'select 1 as a',expected:[{a:2}] }] }), /sanity check failed/);
  await assert.rejects(T.build({ databases: { only: { statements: ['create domain positive_number as int','create table bad_domain(value positive_number)','insert into bad_domain values(-1)','alter domain positive_number add constraint positive_number_check check(value > 0) not valid'] } } }), /constraint|violated/);
  await assert.rejects(T.build({ ...spec, compatibility: { major: 999 } }), /major mismatch/);
  await assert.rejects(T.build({ ...spec, compatibility: { extensions: { impossible_extension: '1' } } }), /extension compatibility mismatch/);
  assert.equal((await DB.resources()).resources.some(r => r.kind === 'template' && r.state !== 'frozen'), false);
});
test('changed row/policy/migration inputs get distinct keys and SQL upgrade leaves its base immutable', { skip, timeout: 30000 }, async () => {
  const changed = await T.build({ ...spec, policy: { masking: 'v2' } }); assert.notEqual(changed.id, base.id);
  const empty = await T.build({ mode:'migrations-empty',databases:{one:{statements:['create table versioned(id int primary key)']}} });
  const upgrade = await T.build({ mode:'upgrade',base:empty.id,databases:{one:{statements:['insert into versioned values(1)']}} });
  const a = await T.clone({ template: empty.id }), b = await T.clone({ template: upgrade.id });
  try {
    assert.equal((await appQuery(a.databases.one, 'select count(*)::text as n from versioned'))[0].n, '0');
    assert.equal((await appQuery(b.databases.one, 'select count(*)::text as n from versioned'))[0].n, '1');
  } finally { await a.cleanup(); await b.cleanup(); }
});
test('metadata/content drift invalidate future clones and never evict active leases', { skip }, async () => {
  const fresh = await T.build({ databases: { drift: { statements: ['create table d(id int)','insert into d values(1)'] } } });
  const c = await T.clone({ template: fresh.id });
  const database = fresh.databases.drift.database;
  await DB.withControl(sql => sql.unsafe(`alter database ${DB.qi(database)} allow_connections true`));
  await DB.runStatements(database, ['insert into d values(2)']);
  await DB.withControl(sql => sql.unsafe(`alter database ${DB.qi(database)} allow_connections false`));
  const verification = await T.verify(fresh.id, { deep: true }); assert.equal(verification.ok, false); assert.equal(verification.failures[0].kind, 'content-drift');
  await assert.rejects(T.clone({ template:fresh.id }), /cannot clone/);
  assert.equal((await appQuery(c.databases.drift, 'select count(*)::text as n from d'))[0].n, '1');
  const preview = await T.gc({ templateTtlMs: 0, maxBytes: 0, dryRun: true }); assert.ok(preview.retained.some(r => r.template === fresh.id && /lease/.test(r.reason)));
  await c.cleanup();
});
test('portable verified fixture replay can opt into templates, preserving default replay semantics', { skip, timeout: 30000 }, async () => {
  const root = path.join(home,'work/service'); fs.mkdirSync(root,{recursive:true});
  const { writeJson }=require('../lib/util'); writeJson(path.join(home,'cache/work/service.json'),{id:'service',path:root});
  const dbDir = `pg/${Buffer.from('logical').toString('hex')}`;
  const dir='src/test/resources/dt-fixtures/example', full=path.join(root,dir);fs.mkdirSync(path.join(full,dbDir),{recursive:true});
  const files={};for(const [part,content]of Object.entries({schema:'create table x(id int primary key);',data:'insert into x values(1);',constraints:''})){const rel=`${dbDir}/${part}.sql`;fs.writeFileSync(path.join(full,rel),content); files[rel]=require('crypto').createHash('sha256').update(content).digest('hex');}
  writeJson(path.join(full,'manifest.json'),{version:1,complete:true,files,databases:{logical:{directory:dbDir}},topics:{}});
  const R=require('../lib/reproduction'); const cold=await R.replay('service',dir);assert.equal(cold.lease,undefined);await cold.cleanup();
  const warm=await R.replay('service',dir,{template:true});try{assert.ok(warm.lease);assert.equal((await appQuery(warm.databases.logical,'select * from x'))[0].id,1);}finally{await warm.cleanup();}
  fs.writeFileSync(path.join(full,dbDir,'data.sql'),'insert into x values(2);');await assert.rejects(R.replay('service',dir,{template:true}),/hash mismatch/);
});

test('cancellation interrupts an active long SQL statement and compensates the allocated database', {skip,timeout:10000},async()=>{
 const before=(await DB.resources()).resources.length;const c=new AbortController(),start=Date.now();const timer=setTimeout(()=>c.abort(new Error('cancel long fixture query')),100);
 try{await assert.rejects(DB.create('cancel-query',['select pg_sleep(30)'],{signal:c.signal}),/cancel long fixture query/);assert.ok(Date.now()-start<5000);assert.equal((await DB.resources()).resources.length,before);}
 finally{clearTimeout(timer);}
});
test('copied physical cluster registry identity is rejected before resource access', {skip},async()=>{
 let original;await DB.withControl(async sql=>{const[row]=await sql.unsafe(`select system_id from ${DB.SCHEMA}.identity`);original=row.system_id;if(original)await sql.unsafe(`update ${DB.SCHEMA}.identity set system_id='different-cluster'`);});
 if(!original)return;try{await assert.rejects(DB.resources(),/physical cluster identity changed/);}
 finally{const sql=pg(url,{max:1,onnotice:()=>{}});try{await sql.unsafe(`update ${DB.SCHEMA}.identity set system_id=$1`,[original]);}finally{await sql.end({timeout:1});}}
});

test('pinning and storage/count pressure preserve leased bases and reclaim only eligible LRU bases', {skip},async()=>{
 const pinned=await T.build({databases:{pinned:{statements:['create table retained(id int)']}},pin:true});
 const result=await T.gc({templateTtlMs:0,maxBytes:0,maxTemplates:0,dryRun:true});assert.ok(result.retained.some(x=>x.template===pinned.id&&x.reason==='pinned'));assert.ok(!result.templates.includes(pinned.id));
 await T.pin(pinned.id,false);const next=await T.gc({templateTtlMs:0,maxBytes:0,maxTemplates:0,dryRun:true});assert.ok(next.templates.includes(pinned.id));
});

test('deep verification detects changed domain constraints even when every stored value still passes', {skip},async()=>{
 const base=await T.build({databases:{one:{statements:['create domain positive as numeric check(value >= 0)','create table d(amount positive)','insert into d values(42)']}}});const db=base.databases.one.database;
 await DB.withControl(sql=>sql.unsafe(`alter database ${DB.qi(db)} allow_connections true`));
 await DB.runStatements(db,['alter domain positive drop constraint positive_check','alter domain positive add check(value >= 10)']);
 await DB.withControl(sql=>sql.unsafe(`alter database ${DB.qi(db)} allow_connections false`));
 const result=await T.verify(base.id,{deep:true});assert.equal(result.ok,false);assert.ok(result.failures.some(x=>x.kind==='content-drift'));
});
