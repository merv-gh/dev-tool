// A synthetic release workflow exercises capture and emulation as a single contract. Nothing in this
// suite can connect to a real environment: query/message adapters use the rows and envelopes below.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-scenario-complex-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_LOG = 'quiet';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_WORK_DIR', 'DT_TOOLS', 'DT_RUNNER_URL']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { commerce: 'postgres://u:p@127.0.0.1:1/commerce', risk: 'postgres://u:p@127.0.0.1:1/risk' } } } }));
const { writeJson } = require('../lib/util');
const R = require('../lib/reproduction');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const column = (name, type = 'bigint', extra = {}) => ({ name, type, nullable: false, ...extra });
const fk = (name, columns, ref, references) => ({ name, type: 'f', ref, def: `FOREIGN KEY (${columns.join(', ')}) REFERENCES ${ref}(${references.join(', ')})` });
const table = (schema, name, columns, primary, foreignKeys = []) => ({ schema, name, kind: 'table', columns,
  constraints: [{ name: `${name}_pk`, type: 'p', def: `PRIMARY KEY (${primary.join(', ')})` }, ...foreignKeys] });
const syncedAt = '2026-10-28T00:00:00.000Z';
const catalogs = {
  commerce: { db: 'commerce', syncedAt, functions: [], tables: [
    table('sales', 'orders', [column('tenant_id'), column('id'), column('account_id'), column('status', 'text'), column('amount', 'numeric(20,6)')], ['tenant_id', 'id'], [fk('order_account', ['tenant_id', 'account_id'], 'shared.accounts', ['tenant_id', 'id'])]),
    table('shared', 'accounts', [column('tenant_id'), column('id'), column('enabled', 'boolean')], ['tenant_id', 'id']),
  ] },
  risk: { db: 'risk', syncedAt, functions: [], tables: [
    table('shared', 'accounts', [column('tenant_id'), column('id'), column('limit', 'numeric(20,6)'), column('status', 'text')], ['tenant_id', 'id']),
  ] },
};
for (const [db, catalog] of Object.entries(catalogs)) writeJson(path.join(home, 'cache/dev/pg', `${db}.json`), catalog);
for (const topic of ['orders.paid', 'orders.released']) writeJson(path.join(home, 'cache/dev/kafka', `${topic}.json`), { topic, valueSchema: { type: 'JSON', version: 3, schema: { type: 'object', properties: { tenantId: { type: 'integer' }, orderId: { type: 'string' } } } } });
const orderA = '9007199254740993', orderB = '9007199254740995';
const rows = {
  'commerce:sales.orders': [
    { tenant_id: 11, id: orderA, account_id: 7, status: 'PAID', amount: '100.000001' },
    { tenant_id: 22, id: orderB, account_id: 7, status: 'PAID', amount: '200.000002' },
    { tenant_id: 11, id: orderB, account_id: 99, status: 'OTHER', amount: '999.000000' },
  ],
  'commerce:shared.accounts': [{ tenant_id: 11, id: 7, enabled: true }, { tenant_id: 22, id: 7, enabled: true }, { tenant_id: 33, id: 7, enabled: false }],
  'risk:shared.accounts': [{ tenant_id: 11, id: 7, limit: '150.000001', status: 'APPROVED' }, { tenant_id: 22, id: 7, limit: '250.000002', status: 'APPROVED' }, { tenant_id: 33, id: 7, limit: '0.000000', status: 'BLOCKED' }],
};
const event = (partition, offset, tenantId, orderId, value = { tenantId, orderId, eventId: `p${partition}:${offset}` }) => ({ partition, offset: String(offset), timestamp: '1793145600000', key: { tenantId, orderId }, value, headers: { schemaVersion: '3' } });
const envelopes = [
  event(2, '9007199254740995', 22, orderB),
  event(0, '10', 11, orderA),
  event(2, '9007199254740993', 22, orderB),
  event(0, '9', 11, orderA, null), // A compacted tombstone still belongs to this key.
  event(0, '10', 11, orderA), // Same physical Kafka record seen twice.
  event(1, '3', 11, orderB), // Both scalars exist, but their composite identity does not.
  event(1, '4', 33, orderA),
];
const fixturePlan = {
  env: 'dev', seeds: [
    { db: 'commerce', table: 'sales.orders', where: { tenant_id: 11, id: orderA } },
    { db: 'commerce', table: 'sales.orders', where: { tenant_id: 22, id: orderB } },
  ],
  relations: [{ from: { db: 'commerce', table: 'sales.orders', columns: ['tenant_id', 'account_id'] }, to: { db: 'risk', table: 'shared.accounts', columns: ['tenant_id', 'id'] }, required: true, evidence: 'ReleaseService.java:41: risk lookup uses tenant and account together' }],
  topics: [{ topic: 'orders.paid', matches: [
    { path: 'key.tenantId', from: { db: 'commerce', table: 'sales.orders', column: 'tenant_id' } },
    { path: 'key.orderId', from: { db: 'commerce', table: 'sales.orders', column: 'id' } },
  ] }],
};
function query(db, sql, params) {
  assert.match(sql, /^select \* from /);
  assert.doesNotMatch(sql, /900719925474099[35]/, 'values must be parameters');
  const m = sql.match(/from "([^"]+)"\."([^"]+)" where (.+) order by .+ limit (\d+)$/);
  assert.ok(m, sql);
  const alternatives = m[3].split(' or ').map(term => [...term.matchAll(/"([^"]+)" = \$(\d+)/g)].map(x => [x[1], params[Number(x[2]) - 1]]));
  return (rows[`${db}:${m[1]}.${m[2]}`] || []).filter(row => alternatives.some(terms => terms.every(([name, value]) => String(row[name]) === String(value)))).slice(0, Number(m[4]));
}
const messages = async topic => {
  assert.equal(topic, 'orders.paid');
  return { messages: structuredClone(envelopes), windows: [{ partition: 0, from: '9', highExclusive: '11' }, { partition: 1, from: '3', highExclusive: '5' }, { partition: 2, from: '9007199254740993', highExclusive: '9007199254740996' }], truncated: false };
};

test('capture preserves two database namespaces, composite parents, tombstones and 64-bit partition order', async () => {
  const capture = await R.capture(fixturePlan, { query, messages });
  assert.equal(capture.complete, true, JSON.stringify(capture.gaps));
  assert.equal(capture.counts.rows, 6);
  assert.deepEqual(Object.keys(capture.rows).sort(), ['commerce:sales.orders', 'commerce:shared.accounts', 'risk:shared.accounts']);
  for (const values of Object.values(capture.rows)) assert.deepEqual(values.map(row => row.tenant_id).sort(), [11, 22]);
  assert.equal(capture.rows['commerce:sales.orders'][0].amount, '100.000001');
  assert.equal(capture.rows['risk:shared.accounts'][0].limit, '150.000001');
  const records = capture.events['orders.paid'].messages;
  assert.deepEqual(records.map(record => [record.partition, record.offset]), [[0, '9'], [0, '10'], [2, '9007199254740993'], [2, '9007199254740995']]);
  assert.equal(records[0].value, null);
  assert.equal(records[0].key.orderId, orderA);
  assert.equal(R.validate(capture).ok, true);
});

test('every selected root and required cross-database relationship is checked independently', async () => {
  const missing = await R.capture({ ...fixturePlan, seeds: [...fixturePlan.seeds, { db: 'commerce', table: 'sales.orders', where: { tenant_id: 44, id: orderA } }] }, { query: (db, sql, params) => db === 'risk' ? query(db, sql, params).filter(row => row.tenant_id !== 22) : query(db, sql, params), messages });
  assert.equal(missing.complete, false);
  assert.ok(missing.gaps.some(gap => gap.kind === 'missing-seed' && gap.where.tenant_id === 44));
  assert.ok(missing.gaps.some(gap => gap.kind === 'missing-parent' && gap.target === 'risk:shared.accounts'));
});

test('Kafka correlation never combines fields from different nested array elements', async () => {
  const topic = path => ({ topic: 'orders.paid', matches: [
    { path: `${path}.tenantId`, from: { db: 'commerce', table: 'sales.orders', column: 'tenant_id' } },
    { path: `${path}.orderId`, from: { db: 'commerce', table: 'sales.orders', column: 'id' } },
  ] });
  const good = { groups: [{ items: [{ tenantId: 11, orderId: orderA }] }] };
  const mixedItem = { groups: [{ items: [{ tenantId: 11, orderId: orderB }, { tenantId: 22, orderId: orderA }] }] };
  const mixedGroup = { groups: [{ tenantId: 11, items: [{ orderId: orderB }] }, { tenantId: 22, items: [{ orderId: orderA }] }] };
  const nested = await R.capture({ ...fixturePlan, topics: [topic('value.groups[].items[]')] }, { query, messages: async () => ({ messages: [event(0, 1, 11, orderA, good), event(0, 2, 11, orderA, mixedItem)], truncated: false }) });
  assert.deepEqual(nested.events['orders.paid'].messages.map(record => record.offset), ['1']);
  const paths = topic('value.groups[]'); paths.matches[1].path = 'value.groups[].items[].orderId';
  const grouped = await R.capture({ ...fixturePlan, topics: [paths] }, { query, messages: async () => ({ messages: [event(0, 1, 11, orderA, { groups: [{ tenantId: 11, items: [{ orderId: orderA }] }] }), event(0, 2, 11, orderA, mixedGroup)], truncated: false }) });
  assert.deepEqual(grouped.events['orders.paid'].messages.map(record => record.offset), ['1']);
});

test('conflicting sightings of the same Kafka partition/offset prevent a completeness claim', async () => {
  const first = event(0, 10, 11, orderA);
  const conflicting = { ...structuredClone(first), value: { ...first.value, amount: 'unexpected alternative payload' } };
  const capture = await R.capture(fixturePlan, { query, messages: async () => ({ messages: [first, conflicting], truncated: false }) });
  assert.equal(capture.complete, false);
  assert.ok(capture.gaps.some(gap => gap.kind === 'conflicting-event' && gap.topic === 'orders.paid'));
  // Identical physical records remain ordinary duplicate sightings.
  const repeated = await R.capture(fixturePlan, { query, messages: async () => ({ messages: [first, structuredClone(first)], truncated: false }) });
  assert.equal(repeated.complete, true, JSON.stringify(repeated.gaps));
  assert.equal(repeated.events['orders.paid'].messages.length, 1);
});

test('complex capture exports exact database/event resources and rejects altered fixtures', async () => {
  const workspace = path.join(home, 'work/complex');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(home, 'cache/work/complex.json'), { id: 'complex', path: workspace, createdAt: syncedAt });
  const capture = await R.capture(fixturePlan, { query, messages });
  const exported = R.exportFixture('complex', capture, { name: 'release' });
  const loaded = R.loadFixture('complex', exported.path);
  assert.deepEqual(Object.keys(loaded.databases).sort(), ['commerce', 'risk']);
  assert.ok(loaded.databases.commerce.statements.data.some(sql => sql.includes(orderA) && sql.includes('100.000001')));
  assert.ok(loaded.databases.risk.statements.data.some(sql => sql.includes('150.000001')));
  const eventFile = path.join(workspace, exported.path, loaded.topics['orders.paid'].directory, 'messages.jsonl');
  const saved = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(saved, capture.events['orders.paid'].messages);
  fs.writeFileSync(eventFile, saved.filter(record => record.value !== null).map(JSON.stringify).join('\n') + '\n');
  assert.throws(() => R.loadFixture('complex', exported.path), /hash mismatch/);
});

function passport({ unknown = false } = {}) {
  const readTables = [
    { db: 'commerce', table: 'sales.orders', access: 'read', file: 'ReleaseService.java', line: 12 },
    { db: 'commerce', table: 'shared.accounts', access: 'read', file: 'ReleaseService.java', line: 14 },
    { db: 'risk', table: 'shared.accounts', access: 'read', file: 'RiskDao.java', line: 31 },
  ];
  const writes = [{ db: 'commerce', table: 'sales.orders', access: 'write', file: 'ReleaseService.java', line: 48 }];
  const calls = [{ client: 'customer-service', method: 'GET', path: '/customers/{id}', handler: 'CustomerClient#get', file: 'CustomerClient.java', line: 7 }];
  const out = { tables: [...readTables, ...writes], http: [{ call: 'GET /customers/{id}', ...calls[0], at: 'ReleaseService.java:20' }], produces: [{ topic: 'orders.released', at: 'ReleaseService.java:52' }], es: [{ index: 'release-policy', at: 'PolicyRepository.java:18' }], external: [
    { kind: 'cache', type: 'StringRedisTemplate', call: 'get', at: 'EligibilityCache.java:11' },
    ...(unknown ? [{ kind: 'unknown', type: 'ExternalRuleEngine', call: 'evaluate', at: 'ReleaseService.java:28' }] : []),
  ] };
  return {
    service: 'release-service', env: 'dev', builtAt: syncedAt,
    repo: { project: 'SALES', repo: 'release-service', sha: '1234567890abcdef' },
    effective: {
      tables: [...readTables, ...writes], calls,
      endpoints: [{ method: 'POST', path: '/orders/{id}/release', handler: 'ReleaseController#release', file: 'ReleaseController.java', line: 9 }],
      consumes: [{ topic: 'orders.paid', handler: 'PaidListener#onMessage', file: 'PaidListener.java', line: 10 }],
      produces: [{ topic: 'orders.released', file: 'ReleaseService.java', line: 52 }], dbCalls: [],
    },
    db: { tables: [...readTables, ...writes], calls: [], datasources: [{ db: 'commerce' }, { db: 'risk' }] },
    config: { merged: { 'release.enabled': 'true' }, unresolved: [] },
    libraries: [{ artifactId: 'eligibility-lib', version: '1.2.3', index: 'SALES/eligibility-lib' }],
    flows: [
      { kind: 'http', entry: 'POST /orders/{id}/release', handler: 'ReleaseController#release', out, properties: [{ key: 'release.enabled', value: 'true' }], chain: [{ method: 'ReleaseService#release', at: 'ReleaseService.java:12' }] },
      { kind: 'kafka', entry: 'kafka orders.paid', topic: 'orders.paid', handler: 'PaidListener#onMessage', out, properties: [{ key: 'release.enabled', value: 'true' }], chain: [{ method: 'ReleaseService#release', at: 'ReleaseService.java:12' }] },
    ],
  };
}

function modules() { return { S: require('../lib/scenario'), State: require('../lib/scenario-state') }; }
const inventory = (options = {}) => require('../lib/scenario').inventory({ passport: passport(options), env: 'dev' });
function provided(dep) {
  if (dep.kind === 'pg') return structuredClone(rows[`${dep.target.db}:${dep.target.table}`] || []);
  if (dep.kind === 'kafka') return structuredClone(envelopes.filter(record => record.partition !== 1));
  if (dep.kind === 'http') return { status: 200, body: { active: true, suspended: false } };
  if (dep.kind === 'es') return [{ _id: 'EUR', _source: { currency: 'EUR', allowed: true } }];
  if (dep.kind === 'cache') return { 'eligibility:11:7': 'ALLOW', 'eligibility:22:7': 'ALLOW' };
  if (dep.kind === 'config') return 'true';
  return { resolved: true };
}
function allBindings(inv) { return Object.fromEntries(inv.states.map(dep => [dep.id, { mode: 'provided', value: provided(dep), ...(dep.resolution && dep.resolution !== 'resolved' ? { resolve: { ...dep.target, evidence: 'Synthetic complete release contract, test/scenario-complex.test.js' } } : {}) }])); }

test('passport inventory keeps every read system and source location, with explicit actions and output obligations', () => {
  const inv = inventory();
  for (const kind of ['pg', 'kafka', 'http', 'es', 'config', 'cache']) assert.ok(inv.states.some(dep => dep.kind === kind), `${kind}: ${JSON.stringify(inv.states)}`);
  const accounts = inv.states.filter(dep => dep.kind === 'pg' && dep.target.table === 'shared.accounts');
  assert.deepEqual(accounts.map(dep => dep.target.db).sort(), ['commerce', 'risk']);
  assert.equal(new Set(inv.states.map(dep => dep.id)).size, inv.states.length);
  assert.equal(inv.actions.length, 2);
  assert.ok(inv.actions.some(action => action.kind === 'http'));
  assert.ok(inv.actions.some(action => action.kind === 'kafka'));
  for (const dep of inv.states) assert.ok(dep.provenance.length, dep.id);
  for (const action of inv.actions) {
    assert.ok(action.dependencies.length >= 6, action.id);
    assert.ok(action.expectations.length >= 2, action.id);
  }
  assert.equal(inv.coverage.runtimeVerified, false);
  assert.equal(inv.complete, false, 'static discovery alone cannot promise every runtime read');
});

test('passport evidence outside a flow cannot disappear behind an equal table name in another database', () => {
  const source = passport();
  source.flows = source.flows.map(flow => ({ ...flow, out: { ...flow.out, tables: flow.out.tables.filter(table => table.db !== 'risk') } }));
  const inv = require('../lib/scenario').inventory({ passport: source, env: 'dev' });
  const risk = inv.states.find(dep => dep.kind === 'pg' && dep.target.db === 'risk' && dep.target.table === 'shared.accounts');
  assert.ok(risk, 'the passport still declares a second database read');
  assert.ok(inv.gaps.some(gap => gap.stateId === risk.id), 'unattributed evidence must remain a coverage gap');
});

test('uninspected libraries, dynamic database calls and failed flow analysis remain visible', () => {
  const S = require('../lib/scenario'), source = passport();
  source.libraries = [{ artifactId: 'dynamic-rules', error: 'source repository unavailable' }];
  source.flows[0].out.external.push({ kind: 'db', type: 'JdbcTemplate', call: 'queryForList', at: 'DynamicRules.java:17' });
  const dynamic = S.inventory({ passport: source, env: 'dev' });
  assert.ok(dynamic.states.some(dep => dep.kind === 'unknown' && dep.target.library === 'dynamic-rules'));
  const query = dynamic.states.find(dep => dep.kind === 'pg' && dep.target.call === 'queryForList');
  assert.ok(query, 'dynamic SQL cannot be treated as a known table capture');
  assert.ok(dynamic.gaps.some(gap => gap.stateId === query.id));
  const unavailable = S.inventory({ passport: { ...passport(), libraries: [], flows: { error: 'call graph exceeded bounds' } }, env: 'dev' });
  assert.ok(unavailable.states.some(dep => dep.kind === 'unknown' && dep.target.type === 'call-graph-coverage'));
  assert.equal(unavailable.complete, false);
});

test('state capture rechecks the original inventory before any adapter reads', async () => {
  const { State } = modules(), inv = inventory();
  const plan = State.planState(inv, allBindings(inv));
  const changed = structuredClone(plan);
  changed.states[0].target = { table: 'unrelated.table', db: 'other' };
  await assert.rejects(State.captureState(changed), /differs from its inventory/);
  const omitted = structuredClone(plan);
  omitted.states.pop(); omitted.gaps = []; omitted.complete = true;
  const result = await State.captureState(omitted);
  assert.equal(result.complete, false);
  assert.ok(result.gaps.some(g => g.kind === 'unbound-state'));
});

test('state planning refuses unbound and unknown dependencies instead of inventing empty state', async () => {
  const { State } = modules(), inv = inventory();
  const empty = State.planState(inv, {});
  assert.equal(empty.complete, false);
  assert.ok(empty.gaps.length >= inv.states.filter(dep => dep.required).length);
  const bound = allBindings(inv), omitted = inv.states.find(dep => dep.kind === 'http');
  delete bound[omitted.id];
  assert.equal(State.planState(inv, bound).complete, false);
  const unknown = inventory({ unknown: true });
  const unmodelled = State.planState(unknown, allBindings(unknown));
  assert.equal(unmodelled.complete, false, 'an invented generic value cannot resolve an unknown external read');
  assert.ok(unmodelled.gaps.length > 0);
});

test('capture uses only selected adapters and reports partial and failed adapters as incomplete', async () => {
  const { State } = modules(), inv = inventory();
  const bindings = allBindings(inv), remote = inv.states.filter(dep => ['http', 'es'].includes(dep.kind));
  for (const dep of remote) bindings[dep.id] = { mode: 'capture', query: { fixture: dep.id } };
  const seen = [];
  const captured = await State.captureState(State.planState(inv, bindings), { adapters: {
    http: async (dep, binding) => { seen.push(dep.id); assert.equal(binding.query.fixture, dep.id); return { value: provided(dep), complete: true }; },
    es: async dep => { seen.push(dep.id); return { value: provided(dep), complete: true }; },
  } });
  assert.equal(captured.complete, true, JSON.stringify(captured.gaps));
  assert.deepEqual(seen.sort(), remote.map(dep => dep.id).sort());
  assert.equal(Object.keys(captured.states).length, inv.states.length);
  const failed = await State.captureState(State.planState(inv, bindings), { adapters: {
    http: async () => { throw new Error('fixture upstream unavailable'); },
    es: async () => ({ value: [], complete: false, truncated: true }),
  } });
  assert.equal(failed.complete, false);
  assert.ok(failed.gaps.length >= 2);
  assert.match(JSON.stringify(failed.gaps), /upstream unavailable/);
});

test('fixture bindings cannot substitute an unrelated database table for a declared read', async () => {
  const { State } = modules(), inv = inventory();
  const capture = await R.capture(fixturePlan, { query, messages }), captureId = R.save(capture);
  const bindings = allBindings(inv), order = inv.states.find(dep => dep.kind === 'pg' && dep.target.table === 'sales.orders');
  bindings[order.id] = { capture: captureId, table: 'risk:shared.accounts' };
  const state = await State.captureState(State.planState(inv, bindings));
  assert.equal(state.complete, false, 'capturing account rows cannot satisfy an order-table dependency');
  assert.ok(state.gaps.some(gap => gap.stateId === order.id));
});

test('validated schema resolutions select the exact fixture table and cannot replace known targets', async () => {
  const { State } = modules(), inv = structuredClone(inventory());
  const order = inv.states.find(dep => dep.kind === 'pg' && dep.target.table === 'sales.orders');
  order.target.table = 'orders';
  order.resolution = { status: 'ambiguous', candidates: [{ db: 'commerce', table: 'sales.orders' }, { db: 'commerce', table: 'archive.orders' }] };
  inv.gaps.push({ kind: 'ambiguous-state', stateId: order.id });
  const capture = await R.capture(fixturePlan, { query, messages });
  const bindings = allBindings(inv);
  bindings[order.id] = { capture: R.save(capture), table: 'commerce:sales.orders', resolve: { db: 'commerce', table: 'sales.orders', evidence: 'OrderRepository.java:7' } };
  const plan = State.planState(inv, bindings);
  assert.equal(plan.complete, true, JSON.stringify(plan.gaps));
  const result = await State.captureState(plan);
  assert.equal(result.complete, true, JSON.stringify(result.gaps));
  assert.deepEqual(State.getState(result, order.id), capture.rows['commerce:sales.orders']);
  const known = inventory(), knownOrder = known.states.find(dep => dep.kind === 'pg' && dep.target.table === 'sales.orders');
  const overrides = allBindings(known);
  overrides[knownOrder.id].resolve = { db: 'risk', table: 'shared.accounts', evidence: 'forged override' };
  const rejected = State.planState(known, overrides);
  assert.equal(rejected.complete, false);
  assert.ok(rejected.gaps.some(g => g.kind === 'resolved-target-override'));
});

test('dotted configuration secrets are masked in captured state and linked values', async () => {
  const { S, State } = modules(), source = passport();
  source.flows[0].properties.push({ key: 'spring.datasource.password', value: null });
  const inv = S.inventory({ passport: source, env: 'dev' }), bindings = allBindings(inv);
  const secret = 'synthetic-super-secret-credential';
  const password = inv.states.find(dep => dep.kind === 'config' && dep.target.key === 'spring.datasource.password');
  bindings[password.id].value = secret;
  const cache = inv.states.find(dep => dep.kind === 'cache');
  bindings[cache.id].value = { retainedReference: secret };
  const state = await State.captureState(State.planState(inv, bindings));
  assert.equal(state.complete, true, JSON.stringify(state.gaps));
  assert.equal(JSON.stringify(state).includes(secret), false, 'dotted secret keys and linked values must be masked');
  assert.equal(state.states[password.id].value, state.states[cache.id].value.retainedReference);
});

function receipt(tenantId, orderId) {
  return { tenantId, orderId, status: 'RELEASED', amount: tenantId === 11 ? '100.000001' : '200.000002', currency: 'EUR' };
}
function outputFor(kind, value) {
  if (kind === 'status') return 202;
  if (kind === 'return') return value;
  if (kind === 'pg') return [{ tenant_id: value.tenantId, id: value.orderId, status: value.status }];
  if (kind === 'kafka') return [{ key: { tenantId: value.tenantId, orderId: value.orderId }, value }];
  if (kind === 'http') return [{ method: 'GET', responseStatus: 200 }];
  if (kind === 'es') return [{ _id: value.orderId, _source: value }];
  throw new Error(`Unhandled observation kind ${kind}; extend this independent release model explicitly`);
}
async function modelFixture() {
  const { S, State } = modules(), inv = inventory();
  const captured = await R.capture(fixturePlan, { query, messages });
  const captureId = R.save(captured), stateBindings = allBindings(inv);
  for (const dep of inv.states) {
    if (dep.kind === 'pg') stateBindings[dep.id] = { capture: captureId, table: `${dep.target.db}:${dep.target.table}` };
    if (dep.kind === 'kafka') stateBindings[dep.id] = { capture: captureId, topic: 'orders.paid' };
  }
  const state = await State.captureState(State.planState(inv, stateBindings));
  assert.equal(state.complete, true, JSON.stringify(state.gaps));
  const inputBindings = Object.fromEntries(inv.actions.map((action, index) => [action.id, { tenantId: index === 0 ? 11 : 22, orderId: index === 0 ? orderA : orderB }]));
  const actions = S.actions(inv, { bindings: inputBindings });
  assert.equal(actions.complete, true, JSON.stringify(actions.gaps));
  const expected = Object.fromEntries(inv.expectations.map(expectation => {
    const input = inputBindings[expectation.action];
    assert.ok(input, `${expectation.id}: expectation must belong to one action`);
    return [expectation.id, { match: { op: 'exact', value: outputFor(expectation.kind, receipt(input.tenantId, input.orderId)) } }];
  }));
  const expectations = S.expectations(inv, { bindings: expected });
  assert.equal(expectations.complete, true, JSON.stringify(expectations.gaps));
  const code = `
    const inventory = ${JSON.stringify(inv)};
    const outputFor = ${outputFor.toString()};
    const money = value => BigInt(value.replace('.', ''));
    const results = [];
    for (const action of inventory.actions) {
      const input = await tools.action_input({id:action.id});
      const loaded = {};
      for (const id of action.dependencies) loaded[id] = await tools.state_read({id, action:action.id});
      const read = (kind, predicate = () => true) => {
        const dep = inventory.states.find(dep => action.dependencies.includes(dep.id) && dep.kind === kind && predicate(dep));
        assert(!!dep, 'missing model dependency ' + kind);
        return loaded[dep.id];
      };
      const orders = read('pg', dep => dep.target.db === 'commerce' && dep.target.table === 'sales.orders');
      const order = orders.find(row => row.tenant_id === input.tenantId && row.id === input.orderId);
      assert(!!order, 'missing composite order');
      const account = read('pg', dep => dep.target.db === 'commerce' && dep.target.table === 'shared.accounts').find(row => row.tenant_id === input.tenantId && row.id === order.account_id);
      const risk = read('pg', dep => dep.target.db === 'risk').find(row => row.tenant_id === input.tenantId && row.id === order.account_id);
      assert(account.enabled && risk.status === 'APPROVED' && money(risk.limit) >= money(order.amount), 'eligibility');
      if (action.kind === 'kafka') {
        const events = read('kafka');
        const messages = Array.isArray(events) ? events : events.messages;
        assert(messages.some(event => event.value !== null && event.key.tenantId === input.tenantId && event.key.orderId === input.orderId), 'paid event');
      }
      assert(read('http').body.active, 'customer active');
      assert(read('es').some(document => document._source.allowed), 'search policy');
      assert(read('cache')['eligibility:' + input.tenantId + ':' + account.id] === 'ALLOW', 'cache policy');
      assert(read('config') === 'true', 'release enabled');
      const value = {tenantId:input.tenantId, orderId:input.orderId, status:'RELEASED', amount:order.amount, currency:'EUR'};
      for (const expectation of inventory.expectations.filter(expectation => expectation.action === action.id)) {
        await tools.observe({id:expectation.id, value:outputFor(expectation.kind, value)});
      }
      results.push(value);
    }
    return results;
  `;
  return { inventory: inv, state, actions, expectations, code };
}

test('complete passport state supports both release actions and independently checked effects in a local sandbox', async () => {
  const { State } = modules(), input = await modelFixture();
  const outcome = await State.emulate(input);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.checks.failed, 0);
  assert.equal(outcome.checks.passed, input.inventory.expectations.length);
  assert.ok(outcome.reads.length >= input.inventory.states.length);
  assert.equal(outcome.actions.length, input.inventory.actions.length);
  // The database capture remains immutable after both modeled state transitions.
  for (const dep of input.inventory.states.filter(dep => dep.kind === 'pg' && dep.target.table === 'sales.orders')) {
    assert.ok(input.state.states[dep.id].value.every(row => row.status === 'PAID'));
  }
});

test('missing observations, mismatched expectations and omitted state reads all fail', async () => {
  const { State } = modules(), input = await modelFixture();
  const absent = await State.emulate({ ...input, code: 'return "did nothing";' });
  assert.equal(absent.ok, false);
  assert.ok(absent.checks.failed > 0);
  const wrong = structuredClone(input.expectations);
  wrong.expectations[0].match = { op: 'exact', value: 'a result the application must not produce' };
  const mismatched = await State.emulate({ ...input, expectations: wrong });
  assert.equal(mismatched.ok, false);
  assert.ok(mismatched.checks.failed > 0);
  const unread = await State.emulate({ ...input, code: input.code.replace('loaded[id] = await tools.state_read({id, action:action.id})', 'loaded[id] = null') });
  assert.equal(unread.ok, false);
  const repeated = await State.emulate({ ...input, code: input.code.replace('await tools.observe({id:expectation.id, value:outputFor(expectation.kind, value)});', 'await tools.observe({id:expectation.id, value:"hidden unexpected first effect"}); await tools.observe({id:expectation.id, value:outputFor(expectation.kind, value)});') });
  assert.equal(repeated.ok, false, 'later observations cannot erase an earlier incompatible effect');
});

test('forged complete flags cannot hide missing dependencies, actions or required expectations', async () => {
  const { State } = modules(), input = await modelFixture();
  const missingState = structuredClone(input.state);
  delete missingState.states[input.inventory.states[0].id];
  missingState.complete = true;
  assert.equal((await State.emulate({ ...input, state: missingState })).ok, false);
  const fewerActions = structuredClone(input.actions);
  fewerActions.actions.pop(); fewerActions.complete = true;
  assert.equal((await State.emulate({ ...input, actions: fewerActions })).ok, false);
  const unboundActions = structuredClone(input.actions);
  for (const action of unboundActions.actions) { delete action.binding; action.bound = false; }
  const unboundCode = input.code.replace('const input = await tools.action_input({id:action.id});', `await tools.action_input({id:action.id}); const input = action.id === ${JSON.stringify(input.inventory.actions[0].id)} ? {tenantId:11,orderId:${JSON.stringify(orderA)}} : {tenantId:22,orderId:${JSON.stringify(orderB)}};`);
  assert.equal((await State.emulate({ ...input, actions: unboundActions, code: unboundCode })).ok, false, 'the original input schema is not an action binding');
  const fewerExpectations = structuredClone(input.expectations);
  fewerExpectations.expectations.pop(); fewerExpectations.complete = true;
  assert.equal((await State.emulate({ ...input, expectations: fewerExpectations })).ok, false);
  const changedInventory = structuredClone(input.inventory);
  changedInventory.service = 'another-service';
  assert.equal((await State.emulate({ ...input, inventory: changedInventory })).ok, false);
});

test('full state and behavior resources export together, while forged incomplete contracts are rejected', async () => {
  const { State } = modules(), input = await modelFixture(), workspace = path.join(home, 'work/contract');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(home, 'cache/work/contract.json'), { id: 'contract', path: workspace, createdAt: syncedAt });
  const exported = State.exportScenario('contract', input, { name: 'release-contract' });
  const directory = path.join(workspace, exported.path), manifest = JSON.parse(fs.readFileSync(path.join(directory, 'scenario.json')));
  assert.deepEqual(Object.keys(manifest.files).sort(), ['actions.json', 'expectations.json', 'inventory.json', 'state.json']);
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex'), hash);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'state.json')));
  assert.equal(Object.keys(saved.states).length, input.inventory.states.length);
  assert.equal(saved.inventoryHash, State.inventoryHash(input.inventory));
  assert.throws(() => State.exportScenario('contract', { ...input, actions: { ...input.actions, actions: [] } }, { name: 'missing-actions' }), /action|complete|contract|bound/i);
  assert.throws(() => State.exportScenario('contract', { ...input, expectations: { ...input.expectations, expectations: [] } }, { name: 'missing-expectations' }), /expectation|complete|contract|bound/i);
});

test('sandbox refuses hidden reads, unrelated actions, live tools and writes outside scenario state', async () => {
  const { State } = modules(), input = await modelFixture();
  for (const code of [
    'return await tools.state_read({id:"undeclared-state"})',
    'return await tools.action_input({id:"undeclared-action"})',
    'return await tools.pg_query({env:"dev",sql:"select 1"})',
    'return await tools.workspace_write({workspace:"complex",file:"escape",content:"unsafe"})',
    `process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(path.join(home, 'escaped'))}, 'unsafe'); return 1`,
  ]) {
    const result = await State.emulate({ ...input, code });
    assert.equal(result.ok, false, code);
    assert.ok(result.error || result.checks.failed > 0, JSON.stringify(result));
  }
  assert.equal(fs.existsSync(path.join(home, 'escaped')), false);
});

test('observation matching keeps effects scoped to their action and rejects ambiguous shared targets', () => {
  const S = require('../lib/scenario'), inv = inventory();
  const expectations = S.expectations(inv, { bindings: Object.fromEntries(inv.expectations.map(expected => [expected.id, { match: { op: 'exact', value: { action: expected.action, expected: expected.id } } }])) });
  const scoped = expectations.expectations.map(expected => ({ ...expected.select, value: expected.match.value }));
  assert.equal(S.check(expectations, scoped).ok, true);
  const unscoped = scoped.map(({ action, ...observation }) => observation);
  assert.equal(S.check(expectations, unscoped).ok, false);
  const missing = Object.fromEntries(expectations.expectations.slice(1).map(expected => [expected.id, expected.match.value]));
  assert.equal(S.check(expectations, missing).ok, false);
  const complete = Object.fromEntries(expectations.expectations.map(expected => [expected.id, expected.match.value]));
  assert.equal(S.check(expectations, { ...complete, 'undeclared-write': { table: 'sales.payments', deleted: true } }).ok, false);
  assert.equal(S.check(expectations, [...scoped, { kind: 'kafka', target: { topic: 'orders.deleted' }, action: inv.actions[0].id, value: [{ orderId: orderA }] }]).ok, false);
});

test('scenario code cannot bypass captured state with direct HTTP requests', async () => {
  const { State } = modules(), input = await modelFixture(), http = require('http');
  let hits = 0;
  const server = http.createServer((_, response) => { hits++; response.end('live environment state'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mutate`;
  try {
    for (const code of [
      `return await fetch(${JSON.stringify(endpoint)}, {method:'POST',body:'must not escape'}).then(response=>response.text())`,
      `return await new Promise((resolve,reject)=>{const req=process.getBuiltinModule('http').request(${JSON.stringify(endpoint)}, {method:'POST'}, response=>{response.resume();response.on('end',()=>resolve('escaped'))});req.on('error',reject);req.end('must not escape')})`,
    ]) {
      const result = await State.emulate({ ...input, code });
      assert.equal(result.ok, false);
    }
    assert.equal(hits, 0, 'untracked environment reads/writes must never leave the scenario sandbox');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('every stage of the scenario is separately exposed through the shared tool registry', async () => {
  const schemas = await require('../lib/tools').schemas();
  const names = new Set(schemas.map(schema => schema.name));
  for (const name of ['scenario_inventory', 'scenario_state_plan', 'scenario_state_capture', 'scenario_state_get', 'scenario_actions', 'scenario_expectations', 'scenario_check', 'scenario_emulate', 'scenario_export']) assert.ok(names.has(name), name);
});

test('each registered scenario tool can be called and checked independently using one complete contract', async () => {
  const Tools = require('../lib/tools'), input = await modelFixture();
  const inv = await Tools.call('scenario_inventory', { passport: passport(), env: 'dev' });
  assert.deepEqual(inv.states.map(dep => dep.id), input.inventory.states.map(dep => dep.id));
  const bindings = allBindings(inv);
  for (const dep of inv.states) bindings[dep.id].value = input.state.states[dep.id].value;
  const plan = await Tools.call('scenario_state_plan', { inventory: inv, bindings });
  assert.equal(plan.complete, true, JSON.stringify(plan.gaps));
  const captured = await Tools.call('scenario_state_capture', { plan });
  assert.equal(captured.complete, true, JSON.stringify(captured.gaps));
  const orders = inv.states.find(dep => dep.kind === 'pg' && dep.target.table === 'sales.orders');
  const selected = await Tools.call('scenario_state_get', { capture: captured.capture, id: orders.id, where: { tenant_id: 11, id: orderA } });
  assert.equal(selected.length, 1); assert.equal(selected[0].amount, '100.000001');
  const actions = await Tools.call('scenario_actions', { inventory: inv, bindings: Object.fromEntries(input.actions.actions.map(action => [action.id, action.binding])) });
  const expectations = await Tools.call('scenario_expectations', { inventory: inv, bindings: Object.fromEntries(input.expectations.expectations.map(expected => [expected.id, { select: expected.select, match: expected.match }])) });
  assert.equal(actions.complete, true); assert.equal(expectations.complete, true);
  const checked = await Tools.call('scenario_check', { expectations, observed: Object.fromEntries(expectations.expectations.map(expected => [expected.id, expected.match.value])) });
  assert.equal(checked.ok, true);
  const emulated = await Tools.call('scenario_emulate', { inventory: inv, capture: captured.capture, actions, expectations, code: input.code });
  assert.equal(emulated.ok, true, JSON.stringify(emulated));
  const workspace = path.join(home, 'work/tools-contract');
  fs.mkdirSync(workspace, { recursive: true });
  writeJson(path.join(home, 'cache/work/tools-contract.json'), { id: 'tools-contract', path: workspace, createdAt: syncedAt });
  const exported = await Tools.call('scenario_export', { workspace: 'tools-contract', inventory: inv, capture: captured.capture, actions, expectations, name: 'independent-tool-contract' });
  assert.ok(exported.files.includes('state.json'));
  assert.ok(fs.existsSync(path.join(workspace, exported.path, 'expectations.json')));
});
