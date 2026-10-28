const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-reproduce-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_WORK_DIR', 'DT_TOOLS']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { orders: 'postgres://u:p@127.0.0.1:1/orders', billing: 'postgres://u:p@127.0.0.1:1/billing' } } }, tests: { pgUrl: process.env.DT_TEST_PG_URL } }));
const { writeJson } = require('../lib/util');
const R = require('../lib/reproduction');
const c = (name, type = 'bigint', more = {}) => ({ name, type, nullable: false, ...more });
const table = (schema, name, columns, pk, fks = []) => ({ schema, name, kind: 'table', columns, constraints: [{ name: `${name}_pk`, type: 'p', def: `PRIMARY KEY (${pk.join(', ')})` }, ...fks] });
const fk = (name, columns, ref, refs) => ({ name, type: 'f', ref, def: `FOREIGN KEY (${columns.join(', ')}) REFERENCES ${ref}(${refs.join(', ')})` });
const orders = { db: 'orders', syncedAt: '2026-10-28T00:00:00Z', tables: [
  table('sales', 'orders', [c('id', 'bigint', { identity: 'a' }), c('tenant_id'), c('customer_id'), c('email', 'text'), c('tags', 'text[]'), c('binary', 'bytea'), c('matrix', 'integer[]')], ['id'], [fk('customer_fk', ['tenant_id', 'customer_id'], 'sales.customers', ['tenant_id', 'id'])]),
  table('sales', 'customers', [c('tenant_id'), c('id'), c('email', 'text')], ['tenant_id', 'id']),
], functions: [] };
const billing = { db: 'billing', syncedAt: orders.syncedAt, tables: [
  table('pay', 'payments', [c('id'), c('order_id'), c('status', 'text'), c('amount', 'numeric(12,2)'), c('computed', 'numeric', { generated: 's', default: '(amount * 2)' })], ['id'], [fk('status_fk', ['status'], 'pay.d_status', ['code'])]),
  table('pay', 'd_status', [c('code', 'text')], ['code']),
], functions: [] };
writeJson(path.join(home, 'cache/dev/pg/orders.json'), orders);
writeJson(path.join(home, 'cache/dev/pg/billing.json'), billing);
writeJson(path.join(home, 'cache/dev/kafka/order_paid.json'), { topic: 'order_paid', valueSchema: { type: 'JSON', schema: { type: 'object', properties: { orderId: { type: 'integer' } } } } });
const workspacePath = path.join(home, 'work/demo');
fs.mkdirSync(workspacePath, { recursive: true });
writeJson(path.join(home, 'cache/work/demo.json'), { id: 'demo', path: workspacePath, createdAt: new Date().toISOString() });
const data = {
  'orders:sales.orders': [{ id: 42, tenant_id: 1, customer_id: 9, email: 'alice@private.test', tags: ['a', "it's a test"], binary: Buffer.from([0, 255]), matrix: [[1, 2], [3, 4]] }],
  'orders:sales.customers': [{ tenant_id: 1, id: 9, email: 'alice@private.test' }, { tenant_id: 2, id: 9, email: 'other@private.test' }],
  'billing:pay.payments': [{ id: 80, order_id: 42, status: 'PAID', amount: '12.50', computed: '25.00' }],
  'billing:pay.d_status': [{ code: 'PAID' }],
};
const input = {
  env: 'dev', seeds: [{ db: 'orders', table: 'sales.orders', where: { id: 42 } }],
  relations: [{ from: { db: 'orders', table: 'sales.orders', columns: ['id'] }, to: { db: 'billing', table: 'pay.payments', columns: ['order_id'] }, required: true, evidence: 'PaymentListener.java:14' }],
  topics: [{ topic: 'order_paid', matches: [{ path: 'value.orderId', from: { db: 'orders', table: 'sales.orders', column: 'id' } }] }],
};
function query(db, sql, params) {
  assert.match(sql, /^select \* from /);
  assert.doesNotMatch(sql, /alice|private|42/);
  const m = sql.match(/from "([^"]+)"\."([^"]+)" where (.+) order by/);
  const rows = data[`${db}:${m[1]}.${m[2]}`] || [];
  const alternatives = m[3].split(' or ').map(s => [...s.matchAll(/"([^"]+)" = \$(\d+)/g)].map(x => [x[1], params[Number(x[2]) - 1]]));
  const limit = Number(sql.match(/limit (\d+)$/)[1]);
  return rows.filter(row => alternatives.some(terms => terms.every(([col, v]) => String(row[col]) === String(v)))).slice(0, limit);
}
const messages = async () => ({ messages: [
  { partition: 1, offset: '9007199254740994', key: '42', headers: { authorization: 'secret' }, value: { orderId: 42, email: 'alice@private.test' } },
  { partition: 0, offset: '4', key: '42', value: { orderId: 42 } },
  { partition: 0, offset: '4', key: '42', value: { orderId: 42 } },
  { partition: 2, offset: '9', key: '999', value: { orderId: 999 } },
], windows: [{ partition: 0, from: '4', highExclusive: '5' }], truncated: false });
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('offline plan resolves composite FKs and requires explicit cross-database joins', () => {
  const p = R.plan(input);
  assert.equal(p.relations.find(r => r.evidence === 'customer_fk').from.columns.length, 2);
  assert.equal(p.relations.find(r => r.source === 'explicit').evidence, 'PaymentListener.java:14');
  assert.ok(p.tables.some(t => t.id === 'billing:pay.d_status'));
  assert.ok(p.topicCandidates.some(c => c.topic === 'order_paid' && c.path === 'value.orderId' && c.from.table === 'sales.orders' && !c.verified));
  assert.ok(p.topics[0].paths.some(p => p.path === 'value.orderId'));
  assert.throws(() => R.plan({ ...input, seeds: [{ db: 'orders', table: 'sales.orders', where: {} }] }), /equality/);
  assert.throws(() => R.plan({ ...input, topics: [{ topic: 'order_paid', matches: [] }] }), /matches/);
});

test('schema inspection and capture validation are independently exposed tools', async () => {
  const T = require('../lib/tools');
  const shape = await T.call('fixture_schema', { env: 'dev', topic: 'order_paid', path: 'value.orderId' });
  assert.equal(shape.known, true);
  assert.equal((await T.call('fixture_schema', { env: 'dev', topic: 'order_paid', path: 'value.missing' })).known, false);
  const r = await R.capture(input, { query, messages });
  const result = await T.call('fixture_validate', { capture: R.save(r) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, r.counts);
  r.gaps.push({ kind: 'intentional-window-gap' }); r.complete = false;
  assert.equal((await T.call('fixture_validate', { capture: R.save(r) })).ok, false);
});

test('capture joins two databases and Kafka, masks consistently and deduplicates events', async () => {
  const r = await R.capture(input, { query, messages });
  assert.deepEqual(r.counts, { rows: 4, queries: 4, messages: 2 });
  assert.equal(r.rows['orders:sales.customers'].length, 1); // composite FK does not pull other tenant
  assert.equal(r.rows['billing:pay.payments'][0].order_id, 42);
  assert.equal(r.events.order_paid.messages[0].partition, 0);
  assert.equal(r.events.order_paid.messages[1].offset, '9007199254740994');
  const email = r.rows['orders:sales.orders'][0].email;
  assert.match(email, /@example.invalid$/);
  assert.equal(email, r.rows['orders:sales.customers'][0].email);
  assert.equal(email, r.events.order_paid.messages[1].value.email);
  assert.doesNotMatch(JSON.stringify(r), /alice@private|"authorization":"secret"/);
  assert.equal(r.complete, true);
  assert.equal(R.validate(r).ok, true);
  assert.equal(R.load(R.save(r)).counts.rows, 4);
  assert.equal(R.load(R.save(r)).rows['orders:sales.orders'][0].binary, '\\x00ff');
});

test('bounded traversal reports missing parents, missing seeds, depth and Kafka windows', async () => {
  const small = await R.capture({ ...input, limits: { depth: 1 } }, { query, messages });
  assert.equal(small.complete, false);
  assert.ok(small.gaps.some(g => g.kind === 'depth-limit'));
  assert.ok(small.gaps.some(g => g.kind === 'missing-parent'));
  const missing = await R.capture(input, { query: () => [], messages: async () => ({ messages: [], truncated: true }) });
  assert.ok(missing.gaps.some(g => g.kind === 'missing-seed'));
  assert.ok(missing.gaps.some(g => g.kind === 'missing-events'));
  assert.ok(missing.gaps.some(g => g.kind === 'kafka-window'));
  const capped = await R.capture({ ...input, limits: { totalRows: 2 } }, { query, messages });
  assert.equal(capped.counts.rows, 2);
  assert.ok(capped.gaps.some(g => g.kind === 'row-limit'));
});

test('each seed must match, even if an earlier seed populated the same table', async () => {
  const r = await R.capture({ ...input, seeds: [...input.seeds, { db: 'orders', table: 'sales.orders', where: { id: 999 } }] }, { query, messages });
  assert.ok(r.gaps.some(g => g.kind === 'missing-seed' && g.where.id === 999));
  const duplicate = await R.capture({ ...input, seeds: [...input.seeds, ...input.seeds] }, { query, messages });
  assert.equal(duplicate.complete, true);
});
test('missing sensitive seeds and gap metadata are masked even when no row exists', async () => {
  const r = await R.capture({ env: 'dev', seeds: [{ db: 'orders', table: 'sales.orders', where: { email: 'missing@private.test' } }] }, { query: async () => [] });
  assert.equal(r.complete, false);
  assert.doesNotMatch(JSON.stringify(r), /missing@private/);
  assert.match(r.gaps[0].where.email, /@example.invalid$/);
});

test('masking preserves numeric types and recognizes camelCase private fields', () => {
  const r = { rows: { test: [{ id: 12, phone: '12', customerEmail: 'alice@private.test', authToken: 'secret-value' }] }, events: { event: { messages: [{ value: { id: '12' } }] } }, plan: { seeds: [], tables: [] }, provenance: {} };
  R.redact(r);
  assert.equal(typeof r.rows.test[0].id, 'number');
  assert.equal(String(r.rows.test[0].id), r.rows.test[0].phone);
  assert.equal(r.events.event.messages[0].value.id, r.rows.test[0].phone);
  assert.doesNotMatch(JSON.stringify(r), /alice@private|secret-value/);
  assert.equal(R.literal([[1, 2], [3, 4]], 'integer[]'), 'ARRAY[ARRAY[1, 2], ARRAY[3, 4]]::integer[]');
  assert.equal(R.literal(Buffer.from([0, 255]), 'bytea'), "'\\x00ff'");
});

test('reverse FKs are opt-in and queries are bounded/deduplicated', async () => {
  const p = { env: 'dev', seeds: [{ db: 'orders', table: 'sales.customers', where: { tenant_id: 1, id: 9 } }] };
  assert.equal((await R.capture(p, { query })).rows['orders:sales.orders'], undefined);
  const r = await R.capture({ ...p, includeChildren: true }, { query });
  assert.equal(r.rows['orders:sales.orders'].length, 1);
  assert.ok(r.counts.queries <= 3);
});

test('tables without a primary key preserve physically distinct duplicate rows', async () => {
  const extra = table('sales', 'observations', [c('order_id'), c('status', 'text')], []);
  extra.constraints = [];
  const file = path.join(home, 'cache/dev/pg/orders.json');
  writeJson(file, { ...orders, tables: [...orders.tables, extra] });
  try {
    const r = await R.capture({ env: 'dev', seeds: [{ db: 'orders', table: 'sales.observations', where: { order_id: 42 } }] }, { query: async (_, sql) => {
      assert.match(sql, /tableoid::text/);
      return [{ order_id: 42, status: 'seen', __dt_capture_identity: '1:(0,1)' }, { order_id: 42, status: 'seen', __dt_capture_identity: '1:(0,2)' }];
    } });
    assert.equal(r.rows['orders:sales.observations'].length, 2);
    assert.deepEqual(r.rows['orders:sales.observations'][0], { order_id: 42, status: 'seen' });
  } finally { writeJson(file, orders); }
});

test('all topic scans share a total message budget', async () => {
  writeJson(path.join(home, 'cache/dev/kafka/other.json'), { topic: 'other' });
  let calls = 0;
  const r = await R.capture({ ...input, topics: [...input.topics, { ...input.topics[0], topic: 'other' }], limits: { totalMessages: 1 } }, { query, messages: async (_, opts) => {
    calls++; assert.equal(opts.maxMessages, 1);
    return { messages: [{ partition: 0, offset: 0, value: { orderId: 42 } }] };
  } });
  assert.equal(calls, 1);
  assert.ok(r.gaps.some(g => g.kind === 'message-limit' && g.topic === 'other'));
});

test('resource export replays SQL in schema/data/constraint order with hash verification', async () => {
  const r = await R.capture(input, { query, messages });
  const saved = R.exportFixture('demo', r, { name: 'paid' });
  assert.equal(require('../lib/workspace').checkId('demo').dirty, true);
  assert.ok(saved.files.includes('manifest.json'));
  const m = R.loadFixture('demo', saved.path);
  assert.deepEqual(Object.keys(m.databases).sort(), ['billing', 'orders']);
  const sql = m.databases.orders.statements;
  assert.ok(sql.data.some(s => /ARRAY\['a', 'it''s a test'\]/.test(s)));
  assert.ok(sql.data.some(s => /setval/.test(s)));
  assert.ok(sql.constraints.some(s => /customer_fk/.test(s)));
  assert.ok(!sql.schema.some(s => /add constraint/.test(s)));
  assert.ok(!m.databases.billing.statements.data.some(s => /"computed"/.test(s)));
  assert.throws(() => R.exportFixture('demo', r, { name: 'paid' }), /exists/);
  assert.throws(() => R.resourcePath('demo', '../escape'), /outside/);
  assert.throws(() => R.resourcePath('demo', 'src/main/resources/foo'), /test\/resources/);
  const file = path.join(workspacePath, saved.path, m.databases.orders.directory, 'data.sql');
  fs.appendFileSync(file, '\nselect 1;');
  assert.throws(() => R.loadFixture('demo', saved.path), /hash mismatch/);
  R.exportFixture('demo', r, { name: 'paid', overwrite: true });
});

test('fixture export rejects symlink directories', async () => {
  const outside = path.join(home, 'outside'); fs.mkdirSync(outside);
  fs.mkdirSync(path.join(workspacePath, 'unsafe/src/test'), { recursive: true });
  fs.symlinkSync(outside, path.join(workspacePath, 'unsafe/src/test/resources'));
  assert.throws(() => R.resourcePath('demo', 'unsafe/src/test/resources/dt-fixtures/foo'), /symlink/);
});

test('cyclic foreign keys terminate capture and install only after both row sets', async () => {
  const a = table('cycle', 'a', [c('id'), c('b_id')], ['id'], [fk('a_b', ['b_id'], 'cycle.b', ['id'])]);
  const b = table('cycle', 'b', [c('id'), c('a_id')], ['id'], [fk('b_a', ['a_id'], 'cycle.a', ['id'])]);
  const file = path.join(home, 'cache/dev/pg/orders.json');
  writeJson(file, { ...orders, tables: [...orders.tables, a, b] });
  try {
    const r = await R.capture({ env: 'dev', seeds: [{ db: 'orders', table: 'cycle.a', where: { id: 1 } }] }, { query: async (_, sql) => sql.includes('"cycle"."a"') ? [{ id: 1, b_id: 2 }] : [{ id: 2, a_id: 1 }] });
    assert.equal(r.complete, true); assert.equal(r.counts.queries, 2);
    const saved = R.exportFixture('demo', r, { name: 'cycle' });
    const m = R.loadFixture('demo', saved.path);
    assert.equal(m.databases.orders.statements.constraints.length, 2);
    if (process.env.DT_TEST_PG_URL) { const replay = await R.replay('demo', saved.path); await replay.cleanup(); }
  } finally { writeJson(file, orders); }
});

test('multi-database test-run bindings are explicit and do not collide', () => {
  const T = require('../lib/testrun');
  const dbs = { orders: { jdbcUrl: 'jdbc:orders', user: 'u', password: 'p' }, billing: { jdbcUrl: 'jdbc:billing', user: 'u', password: 'p' } };
  assert.throws(() => T.fixtureEnvironment(dbs), /multiple/);
  const env = T.fixtureEnvironment(dbs, { orders: 'SPRING_DATASOURCE', billing: 'BILLING_DATASOURCE' });
  assert.equal(env.BILLING_DATASOURCE_URL, 'jdbc:billing');
  assert.throws(() => T.fixtureEnvironment(dbs, { orders: 'SAME', billing: 'SAME' }), /unique/);
  assert.throws(() => T.fixtureEnvironment(dbs, { orders: 'SPRING_DATASOURCE' }), /every/);
});

test('reverse traversal includes every descendant of a self-referencing foreign key', async () => {
  const nodes = table('tree', 'nodes', [c('id'), c('parent_id', 'bigint', { nullable: true })], ['id'], [fk('parent_fk', ['parent_id'], 'tree.nodes', ['id'])]);
  const file = path.join(home, 'cache/dev/pg/orders.json');
  writeJson(file, { ...orders, tables: [...orders.tables, nodes] });
  data['orders:tree.nodes'] = [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 2 }];
  try {
    const input = { env: 'dev', seeds: [{ db: 'orders', table: 'tree.nodes', where: { id: 1 } }] };
    assert.equal((await R.capture(input, { query })).counts.rows, 1);
    const capture = await R.capture({ ...input, includeChildren: true }, { query });
    assert.deepEqual(capture.rows['orders:tree.nodes'].map(r => r.id), [1, 2, 3]);
    assert.equal(capture.complete, true);
  } finally { writeJson(file, orders); delete data['orders:tree.nodes']; }
});

test('live scratch Postgres enforces exported composite FKs and both databases', { skip: !process.env.DT_TEST_PG_URL }, async () => {
  const r = await R.capture(input, { query, messages });
  const saved = R.exportFixture('demo', r, { name: 'live' });
  const replay = await R.replay('demo', saved.path);
  try {
    assert.equal(Object.keys(replay.databases).length, 2);
    const db = replay.databases.orders;
    const sql = require('postgres')(db.jdbcUrl.replace(/^jdbc:/, ''), { username: db.user, password: db.password });
    try {
      const [row] = await sql`select "binary", matrix, tags from sales.orders where id = 42`;
      assert.deepEqual(row.binary, Buffer.from([0, 255]));
      assert.deepEqual(row.matrix, [[1, 2], [3, 4]]);
      assert.deepEqual(row.tags, ['a', "it's a test"]);
      await assert.rejects(() => sql`insert into sales.orders (id, tenant_id, customer_id, email, tags, "binary", matrix) overriding system value values (43, 999, 999, 'x', '{}', '\\x00', '{}')`, /foreign key/i);
    } finally { await sql.end(); }
  } finally { await replay.cleanup(); }
});

test('test_run binds every fixture database and drops them when the build throws', { skip: !process.env.DT_TEST_PG_URL }, async () => {
  const r = await R.capture(input, { query, messages });
  const saved = R.exportFixture('demo', r, { name: 'build-cleanup' });
  const source = path.join(workspacePath, 'src/test/java'); fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'FakeTest.java'), 'public class FakeTest { public void test() {} }');
  fs.writeFileSync(path.join(workspacePath, 'pom.xml'), '<project/>');
  const F = require('../lib/fastrun'), previous = F.run, previousMaven = process.env.DT_MAVEN;
  process.env.DT_MAVEN = process.execPath;
  const names = [];
  F.run = async options => {
    for (const prefix of ['SPRING_DATASOURCE', 'BILLING_DATASOURCE']) {
      assert.ok(options.env[`${prefix}_URL`]); names.push(new URL(options.env[`${prefix}_URL`].replace(/^jdbc:/, '')).pathname.slice(1));
    }
    assert.ok(options.env.DT_FIXTURE_PATH.endsWith(saved.path));
    throw new Error('intentional build failure');
  };
  try {
    await assert.rejects(() => require('../lib/testrun').run('demo', { tests: ['FakeTest'], fixturePath: saved.path, fixtureBindings: { orders: 'SPRING_DATASOURCE', billing: 'BILLING_DATASOURCE' } }), /intentional build failure/);
    assert.equal(names.length, 2);
    const sql = require('postgres')(process.env.DT_TEST_PG_URL);
    try { for (const name of names) assert.equal((await sql`select datname from pg_database where datname = ${name}`).length, 0); } finally { await sql.end(); }
  } finally { F.run = previous; if (previousMaven === undefined) delete process.env.DT_MAVEN; else process.env.DT_MAVEN = previousMaven; }
});
