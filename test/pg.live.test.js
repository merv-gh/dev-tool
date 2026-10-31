// Against a real Postgres, only when DT_TEST_PG_URL is set (a scratch database: the test creates schema "shop").
//   docker run -d --name dt-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:16-alpine
//   DT_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/postgres npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.env.DT_TEST_PG_URL;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-pglive-'));
process.env.DT_CONFIG_DIR = tmp;
process.env.DT_CACHE_DIR = tmp;
process.env.DT_PASSPORTS_DIR = path.join(tmp, 'passports');
fs.writeFileSync(path.join(tmp, '.env.live'), `DATABASE_URL_SHOP=${URL_ || ''}\n`);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('sync a real database: functions with arguments, view deps, triggers, FKs -> usage index', { skip: !URL_ && 'set DT_TEST_PG_URL' }, async () => {
  const postgres = require('postgres');
  const admin = postgres(URL_, { onnotice: () => {} });
  await admin.unsafe(fs.readFileSync(path.join(__dirname, 'fixtures', 'pg', 'shop.sql'), 'utf8'));
  await admin.end();

  const pg = require('../lib/pg');
  const [r] = await pg.sync('live', { log: () => {} });
  assert.ok(!r.error, r.error);
  const cat = pg.loadDb('live', 'shop');
  const total = cat.functions.find(f => f.name === 'order_total');
  assert.equal(total.signature, 'p_order_id bigint, p_with_tax boolean DEFAULT false');
  assert.deepEqual(total.arg_list.map(a => `${a.name}:${a.type}:${a.mode}`), ['p_order_id:bigint:in', 'p_with_tax:boolean:in']);
  assert.equal(cat.functions.find(f => f.name === 'close_order').kind, 'procedure');
  assert.ok(cat.viewDeps.some(d => d.view === 'shop.big_orders' && d.ref === 'shop.order_total' && d.ref_kind === 'function'));
  assert.ok(cat.triggers.some(t => t.table === 'shop.orders' && t.function === 'shop.audit'));
  assert.equal(cat.tables.find(t => t.name === 'orders').constraints.find(c => c.type === 'f').ref, 'shop.customers');

  const idx = require('../lib/pgindex');
  idx.build('live');
  const users = idx.usages('live', 'shop.orders').map(e => `${e.userKind} ${e.user} ${e.role}`);
  for (const u of ['procedure shop.close_order write', 'function shop.audit trigger', 'view shop.order_totals selects', 'table shop.order_items references', 'function shop.order_total read'])
    assert.ok(users.includes(u), `${u} in ${users.join(', ')}`);
  assert.deepEqual(idx.usages('live', 'shop.order_total').map(e => e.user).sort(), ['shop.big_orders', 'shop.close_order']);
  await pg.closeAll();
});

test('timeouts: queries and the index have their own limits, set per transaction; a cancel names the setting', { skip: !URL_ && 'set DT_TEST_PG_URL' }, async () => {
  const pg = require('../lib/pg');
  const cfg = require('../lib/config');
  process.env.DT_PG_QUERY_TIMEOUT_MS = '1500';
  process.env.DT_PG_INDEX_TIMEOUT_MS = '4000';
  try {
    const t = await pg.query('live', 'select current_setting($1) as v, current_setting($2) as ro', { db: 'shop', params: ['statement_timeout', 'transaction_read_only'] });
    assert.deepEqual([t.rows[0].v, t.rows[0].ro], ['1500ms', 'on']);
    await assert.rejects(pg.query('live', 'select pg_sleep(3)', { db: 'shop' }), /statement timeout.*the query limit is 2 s: raise timeouts\.pgQueryMs/);
    const [r] = await pg.sync('live', { log: () => {} });
    assert.ok(!r.error, r.error);
    assert.ok(cfg.getTimeouts().pgIndexMs === 4000);
  } finally {
    delete process.env.DT_PG_QUERY_TIMEOUT_MS; delete process.env.DT_PG_INDEX_TIMEOUT_MS;
    await pg.closeAll();
  }
});

test('an oversized function is rejected before client JSON parsing and keeps the previous catalog', { skip: !URL_ && 'set DT_TEST_PG_URL' }, async () => {
  const pg = require('../lib/pg'), admin = require('postgres')(URL_, { onnotice: () => {} });
  const before = pg.loadDb('live', 'shop');
  try {
    await admin.unsafe('create or replace function shop.oversized_catalog_test() returns int language sql as $body$ /*' + 'x'.repeat(9 * 1024 * 1024) + '*/ select 1 $body$');
    const [result] = await pg.sync('live', { log: () => {} });
    assert.match(result.error, /one functions object exceeds 8 MiB/);
    assert.equal(pg.loadDb('live', 'shop').syncedAt, before.syncedAt);
    assert.ok(!pg.loadDb('live', 'shop').functions.some(f => f.name === 'oversized_catalog_test'));
  } finally {
    await admin.unsafe('drop function if exists shop.oversized_catalog_test()');
    await admin.end(); await pg.closeAll();
  }
});
