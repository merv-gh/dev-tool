// Postgres usage index from a synced catalog (written here, no live db) + a passport of the fixture service:
// who uses which table / function, from database objects and from code, and how it reaches find and the tools.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-pgindex-'));
process.env.DT_CONFIG_DIR = tmp;
process.env.DT_CACHE_DIR = path.join(tmp, 'cache');
process.env.DT_PASSPORTS_DIR = path.join(tmp, 'passports');
process.env.DT_PLUGINS_DIR = path.join(tmp, 'plugins');
process.env.DT_RATE_PER_SEC = '0';
fs.writeFileSync(path.join(tmp, '.env.test'), 'DATABASE_URL_ORDERS=postgres://u:p@db:5432/orders\nDATABASE_URL_BILLING=postgres://u:p@db:5432/billing\n');
fs.mkdirSync(process.env.DT_PLUGINS_DIR);
fs.writeFileSync(path.join(process.env.DT_PLUGINS_DIR, 'hello.js'), `module.exports = [{ name: 'hello', group: 'demo', description: 'Say hi', input: { who: { type: 'string' } }, run: (a, ctx) => ({ hi: a.who, has: typeof ctx.tabular }) }];`);
fs.writeFileSync(path.join(process.env.DT_PLUGINS_DIR, 'broken.js'), `module.exports = [{ description: 'no name' }];`);

const { extract } = require('../lib/passport/extract');
const { writeJson } = require('../lib/util');
const pgDir = path.join(process.env.DT_CACHE_DIR, 'test', 'pg');

const col = (name, type = 'bigint') => ({ name, type, nullable: true, default: null, comment: null });
const table = (schema, name, columns, extra = {}) => ({ schema, name, kind: 'table', comment: null, est_rows: 10, columns: columns.map(c => col(...[].concat(c))), constraints: [], indexes: [], definition: null, ...extra });
const fn = (schema, name, args, returns, body, extra = {}) => ({ schema, name, kind: 'function', args, signature: args, returns, arg_list: [], lang: 'plpgsql', volatility: 'volatile', security_definer: false, comment: null, body, ...extra });

writeJson(path.join(pgDir, 'orders.json'), {
  db: 'orders', database: 'orders', syncedAt: new Date().toISOString(),
  tables: [
    table('sales', 'orders', ['id', ['status', 'text']]),
    table('sales', 'order_items', ['id', 'order_id'], { constraints: [{ name: 'oi_order_fk', type: 'f', def: 'FOREIGN KEY (order_id) REFERENCES sales.orders(id)', ref: 'sales.orders' }] }),
    table('sales', 'order_audit', ['id', ['ts', 'timestamptz']]),
    table('sales', 'open_orders', ['id'], { kind: 'view', definition: 'select id from sales.orders where status = \'open\'' }),
    table('archive', 'orders', ['id']),
  ],
  functions: [
    fn('sales', 'fn_order_total', 'p_id bigint', 'numeric', 'select sum(x) from sales.order_items where order_id = p_id', { lang: 'sql' }),
    fn('sales', 'order_total', 'p_id bigint, p_tax boolean', 'numeric', 'begin return sales.fn_order_total(p_id) * case when p_tax then 1.2 else 1 end; end'),
    fn('sales', 'close_order', 'IN p_id bigint', null, 'begin\n  -- update sales.order_audit set x = 1  (commented out)\n  update orders set status = \'closed\' where id = p_id;\n  perform order_total(p_id, false);\nend', { kind: 'procedure' }),
    fn('sales', 'calc_tax', 'p_id bigint', 'numeric', 'begin return 0; end'),
    fn('sales', 'audit', '', 'trigger', 'begin insert into sales.order_audit(id, ts) values (new.id, now()); return new; end'),
  ],
  viewDeps: [{ view: 'sales.open_orders', ref: 'sales.orders', ref_kind: 'relation' }],
  triggers: [{ table: 'sales.orders', name: 'orders_audit', function: 'sales.audit', def: 'CREATE TRIGGER orders_audit AFTER UPDATE ON sales.orders FOR EACH ROW EXECUTE FUNCTION sales.audit()', enabled: true }],
});
// a second database with a same-named table: the service connects only to "orders"
writeJson(path.join(pgDir, 'billing.json'), {
  db: 'billing', database: 'billing', syncedAt: new Date().toISOString(),
  tables: [table('sales', 'orders', ['id'])], functions: [], viewDeps: [], triggers: [],
});

// passport of the fixture service, as the passport builder would save it
const ex = extract(path.join(__dirname, 'fixtures', 'order-service'));
writeJson(path.join(process.env.DT_PASSPORTS_DIR, 'order-service', 'passport.json'), {
  service: 'order-service', builtAt: new Date().toISOString(), repo: { project: 'SHOP', repo: 'order-service', ref: 'main', sha: 'a'.repeat(40) },
  ...ex,
  effective: { endpoints: ex.endpoints, consumes: ex.kafka.consumes, produces: ex.kafka.produces, tables: ex.db.tables.filter(t => t.table), calls: ex.feign, dbCalls: ex.db.calls },
  summary: { endpoints: ex.endpoints.length, consumes: [], produces: [], tables: {}, calls: [], libraries: [] },
});

const idx = require('../lib/pgindex');
const tools = require('../lib/tools');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const has = (rows, pred, msg) => assert.ok(rows.some(pred), msg + '\n' + JSON.stringify(rows.map(r => `${r.userKind} ${r.user} ${r.role} ${r.db} ${r.where}`), null, 1));

test('build: edges from db objects and from code', () => {
  const r = idx.build('test');
  assert.ok(r.edges > 10);
  assert.equal(r.dbs, 2);
});

test('who uses a table: services (with file:line), procedures, triggers, views, foreign keys', () => {
  const u = idx.usages('test', 'sales.orders');
  has(u, e => e.userKind === 'service' && e.role === 'read' && /OrderDao\.java:\d+/.test(e.where), 'service reads');
  has(u, e => e.userKind === 'service' && e.role === 'write', 'service writes');
  has(u, e => e.userKind === 'service' && e.role === 'owner' && /V1__init\.sql/.test(e.where), 'migration owner');
  has(u, e => e.userKind === 'procedure' && e.user === 'sales.close_order' && e.role === 'write', 'unqualified "orders" in a sales function resolves to sales.orders');
  has(u, e => e.userKind === 'function' && e.user === 'sales.audit' && e.role === 'trigger', 'trigger function');
  has(u, e => e.userKind === 'view' && e.user === 'sales.open_orders' && e.role === 'selects', 'view');
  has(u, e => e.userKind === 'table' && e.user === 'sales.order_items' && e.role === 'references', 'foreign key');
  assert.ok(u.every(e => e.db === 'orders'), 'the billing copy is not touched: the service connects to db "orders"');
  assert.equal(u[0].userKind, 'service', 'services first');
  // comments in function bodies are not usage
  assert.ok(!idx.usages('test', 'sales.order_audit').some(e => e.user === 'sales.close_order'));
  has(idx.usages('test', 'sales.order_audit'), e => e.user === 'sales.audit' && e.role === 'write', 'trigger function writes the audit table');
});

test('what touches a function: services by SQL, @Procedure and SimpleJdbcCall; functions; triggers', () => {
  has(idx.usages('test', 'sales.order_total'), e => e.userKind === 'service' && /OrderDao\.java:13/.test(e.where), 'select sales.order_total(?) in code');
  has(idx.usages('test', 'sales.order_total'), e => e.user === 'sales.close_order' && e.role === 'calls', 'perform order_total() in a procedure');
  has(idx.usages('test', 'sales.fn_order_total'), e => e.user === 'sales.order_total', 'function calling a function');
  has(idx.usages('test', 'sales.fn_order_total'), e => e.userKind === 'service', 'from sales.fn_order_total(?) in code');
  has(idx.usages('test', 'sales.close_order'), e => e.userKind === 'service' && /@Procedure/.test(e.detail), '@Procedure');
  has(idx.usages('test', 'calc_tax'), e => e.userKind === 'service' && /withFunctionName/.test(e.detail), 'unqualified name resolves to the only schema that has it');
  has(idx.usages('test', 'sales.audit'), e => e.userKind === 'trigger' && e.user === 'sales.orders' && e.role === 'executes', 'trigger executes it');
});

test('what something uses: a procedure, a service', () => {
  const p = idx.uses('test', 'sales.close_order').map(e => `${e.role} ${e.target}`);
  assert.deepEqual(p.sort(), ['calls sales.order_total', 'write sales.orders']);
  const s = idx.uses('test', 'order-service');
  assert.ok(s.some(e => e.target === 'sales.orders') && s.some(e => e.target === 'sales.close_order'));
});

test('tables named in code but missing from every db are kept, flagged', () => {
  const u = idx.usages('test', 'sales.order_history');
  assert.ok(u.length && u.every(e => e.known === false && e.db === null));
  const d = idx.describe('test', 'sales.order_history');
  assert.equal(d[0].kind, 'unknown');
});

test('ambiguous unqualified names are marked, db:name narrows', () => {
  assert.ok(idx.usages('test', 'orders').some(e => e.target === 'sales.orders'));
  assert.equal(idx.describe('test', 'sales.orders').length, 2, 'both databases have sales.orders');
  assert.equal(idx.describe('test', 'billing:sales.orders').length, 1);
  assert.equal(idx.describe('test', 'billing:sales.orders')[0].usedBy.length, 0);
});

test('catalog lines carry signatures and "used by"; direct hits rank first; notes show up', () => {
  require('../lib/notes').set('sales.order_audit', 'Kept 30 days');
  const cat = require('../lib/catalog');
  cat.build('test');
  const lines = fs.readFileSync(path.join(process.env.DT_CACHE_DIR, 'test', 'catalog.txt'), 'utf8').split('\n');
  const orders = lines.find(l => l.startsWith('pg orders sales.orders '));
  assert.match(orders, /\| used by: .*svc order-service\((?=[^)]*read)(?=[^)]*write)[^)]*\)/);
  assert.match(lines.find(l => l.startsWith('pgfn orders sales.order_total(')), /^pgfn orders sales\.order_total\(p_id bigint, p_tax boolean\) -> numeric \[function plpgsql\] \| used by: /);
  assert.match(lines.find(l => l.includes('sales.order_audit ')), /# Kept 30 days$/);
  const found = cat.find('test', 'pg: order_items');
  assert.ok(found[0].startsWith('pg orders sales.order_items'), 'the table itself before tables that only mention it');
  assert.ok(cat.find('test', 'pg: order-service').length >= 3, 'tables a service touches');
});

test('tools: pg_usage (table view), pg_table, pg_function, who_uses merges db objects', async () => {
  const u = await tools.call('pg_usage', { name: 'sales.orders', env: 'test' });
  assert.ok(u.total >= 6 && u.view && u.summary['service:read']);
  const t = await tools.call('pg_table', { name: 'orders:sales.orders', env: 'test' });
  assert.equal(t.length, 1);
  assert.ok(t[0].usedBy.length >= 6 && t[0].triggers.length === 1);
  const f = await tools.call('pg_function', { name: 'sales.close_order', env: 'test' });
  assert.equal(f[0].kind, 'procedure');
  assert.ok(f[0].uses.length === 2 && f[0].usedBy.some(e => e.userKind === 'service'));
  await assert.rejects(tools.call('pg_table', { name: 'sales.order_total', env: 'test' }), /not in the test catalog/);
  const w = await tools.call('who_uses', { name: 'order_total', env: 'test' });
  assert.ok(w.rows.some(r => r.role === 'procedure calls'));
  const none = await tools.call('pg_usage', { name: 'nothing_here', env: 'test' });
  assert.match(none.hint, /find/);
});

test('indexer: index-only refresh runs as a job, a second request joins it, status counts', async () => {
  const indexer = require('../lib/indexer');
  const a = indexer.refresh({ env: 'test', what: 'index' });
  const b = indexer.refresh({ env: 'test', what: 'index' });
  assert.equal(a.id, b.id);
  const done = await a.promise;
  assert.equal(done.state, 'done');
  assert.ok(done.result.usageEdges > 10);
  const s = indexer.status('test');
  assert.equal(s.pg.find(d => d.db === 'orders').tables, 5);
  assert.equal(s.kafka.configured, false);
  assert.ok(require('../lib/jobs').list().some(j => j.id === a.id && j.state === 'done'));
  assert.throws(() => indexer.refresh({ env: 'test', what: 'bogus' }), /what must be one of/);
});

test('plugins load, broken ones are skipped; DT_TOOLS selects groups', async () => {
  assert.deepEqual(await tools.call('hello', { who: 'x' }), { hi: 'x', has: 'function' });
  assert.ok(tools.groups().some(g => g.group === 'demo'));
  const on = tools.enabled('catalog,pg,-pg_query');
  assert.equal(on({ name: 'find', group: 'catalog' }), true);
  assert.equal(on({ name: 'pg_query', group: 'pg' }), false);
  assert.equal(on({ name: 'logs_search', group: 'logs' }), false);
  assert.equal(tools.enabled('all,-browser')({ name: 'browser_sites', group: 'browser' }), false);
});

test('config: env auto-discovered from .env.test, databases from DATABASE_URL_*', () => {
  const { getEnv, envNames } = require('../lib/config');
  assert.deepEqual(envNames(), ['test']);
  assert.deepEqual(Object.keys(getEnv('test').pg).sort(), ['billing', 'orders']);
  assert.equal(getEnv().name, 'test');
});
