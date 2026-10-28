const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-scenarios-'));
process.env.DT_HOME = home;
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_WORK_DIR', 'DT_TOOLS']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { commerce: 'postgres://localhost:1/commerce', risk: 'postgres://localhost:1/risk' } } } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const { writeJson } = require('../lib/util');
for (const db of ['commerce', 'risk']) writeJson(path.join(home, 'cache/dev/pg', `${db}.json`), { db, tables: [{ schema: 'shared', name: 'accounts', kind: 'table', columns: [{ name: 'tenant_id', type: 'bigint' }, { name: 'id', type: 'bigint' }, { name: 'status', type: 'text' }] }], functions: db === 'risk' ? [{ schema: 'risk', name: 'score', kind: 'function' }] : [] });
const S = require('../lib/scenario');
const passport = { service: 'orders', env: 'dev', repo: { sha: 'abc' }, db: { datasources: [{ db: 'commerce', key: 'spring.datasource.url' }, { db: 'risk', key: 'risk.datasource.url' }] }, config: { unresolved: ['region.code'] }, flows: [
  { kind: 'http', entry: 'POST /orders/{id}/settle', handler: 'example.OrderController#settle', inputSchema: { type: 'object', properties: { orderId: { type: 'integer' } }, required: ['orderId'] }, out: {
    tables: [{ db: 'commerce', table: 'shared.accounts', access: 'read', at: 'OrderRepository.java:10' }, { db: 'commerce', table: 'shared.accounts', access: 'write', at: 'OrderRepository.java:20' }],
    functions: [{ db: 'risk', function: 'risk.score', at: 'RiskDao.java:7' }],
    produces: [{ topic: 'orders.paid', at: 'OrderEvents.java:12' }], http: [{ call: 'GET /limits/{id}', client: 'limits', at: 'LimitsClient.java:5' }], es: [{ index: 'orders-v2', access: 'read', at: 'Search.java:4' }],
    external: [{ kind: 'cache', type: 'RedisTemplate', call: 'get', at: 'Cache.java:4' }, { kind: 'file', type: 'SftpStore', call: 'read', at: 'Imports.java:6' }, { type: 'MysteryRateService', call: 'estimate', at: 'Rate.java:9' }],
  }, mocks: [{ type: 'ClockProvider', name: 'clock', why: 'interface with no implementation on this flow' }], properties: [{ key: 'gateway.url', value: 'secret-configuration-value' }] },
  { kind: 'kafka', entry: 'kafka risk.created', handler: 'example.RiskListener#created', out: { tables: [{ db: 'risk', table: 'shared.accounts', access: 'read' }], produces: [{ topic: 'risk.indexed' }] }, properties: ['risk.enabled'] },
  { kind: 'scheduled', entry: 'scheduled Reconcile#run', handler: 'example.Reconcile#run', out: { tables: [{ db: 'commerce', table: 'shared.accounts', access: 'read' }] } },
] };

test('multi-action inventory enumerates all state/effects without inventing business values', () => {
  const before = JSON.stringify(passport), inv = S.inventory({ passport });
  assert.equal(inv.actions.length, 3);
  assert.ok(inv.states.some(s => s.kind === 'pg' && s.target.db === 'commerce' && s.target.table === 'shared.accounts'));
  assert.ok(inv.states.some(s => s.kind === 'pg' && s.target.db === 'risk' && s.target.table === 'shared.accounts'));
  assert.ok(inv.states.some(s => s.kind === 'pg' && s.target.function === 'risk.score'));
  for (const kind of ['kafka', 'http', 'es', 'config', 'cache', 'file', 'unknown']) assert.ok(inv.states.some(s => s.kind === kind), kind);
  assert.ok(inv.states.filter(s => ['cache', 'file', 'unknown'].includes(s.kind)).every(s => inv.gaps.some(g => g.stateId === s.id)));
  assert.ok(inv.expectations.some(e => e.kind === 'pg' && e.direction === 'write'));
  assert.ok(inv.expectations.some(e => e.kind === 'kafka' && e.target.topic === 'orders.paid'));
  assert.ok(inv.expectations.some(e => e.kind === 'status'));
  assert.ok(inv.expectations.every(e => e.valueKnown === false && !Object.hasOwn(e, 'match')));
  assert.equal(inv.complete, false); assert.equal(inv.coverage.exhaustive, false);
  assert.doesNotMatch(JSON.stringify(inv), /secret-configuration-value/);
  assert.equal(JSON.stringify(passport), before);
  assert.deepEqual(S.inventory({ passport }), inv, 'stable serializable IDs and ordering');
});

test('same-schema DB ambiguity and explicit untraced database findings cannot be lost', () => {
  const p = { service: 'ambiguous', db: passport.db, flows: [{ kind: 'method', entry: 'Account#load', out: { tables: [{ table: 'shared.accounts', access: 'read' }] } }], effective: { tables: [{ db: 'risk', table: 'shared.accounts', access: 'read' }] } };
  const inv = S.inventory({ passport: p, env: 'dev' });
  const ambiguous = inv.states.find(s => s.kind === 'pg' && s.resolution.status === 'ambiguous');
  assert.deepEqual(ambiguous.resolution.candidates.map(c => c.db).sort(), ['commerce', 'risk']);
  assert.ok(inv.gaps.some(g => g.stateId === ambiguous.id));
  assert.ok(inv.states.some(s => s.target.db === 'risk' && !s.actions.length));
  assert.ok(inv.gaps.some(g => g.kind === 'unattributed-dependency'));
});

test('all hidden mocks, missing libraries and unresolved function effects remain explicit gaps', () => {
  const inv = S.inventory({ passport: { service: 'partial', flows: [{ kind: 'event', entry: 'event Price#changed', mocks: ['UnseenClient client: interface with no implementation on this flow'], out: { functions: [{ function: 'missing.lookup' }], produces: [{ topic: '${topic.name}' }] } }], libraries: [{ artifactId: 'hidden-library', error: 'not fetched' }] }, env: 'dev' });
  assert.ok(inv.states.some(s => s.kind === 'unknown' && s.target.type === 'UnseenClient'));
  assert.ok(inv.states.some(s => s.target.library === 'hidden-library'));
  assert.ok(inv.states.some(s => s.kind === 'pg' && s.target.function === 'missing.lookup'));
  assert.ok(inv.expectations.some(e => e.direction === 'function-effects-unknown'));
  assert.ok(inv.gaps.every(g => g.stateId));
});

test('pattern subscriptions and unspecified Elasticsearch effects are unresolved obligations', () => {
  const inv = S.inventory({ passport: { service: 'patterns', flows: [{ kind: 'kafka', entry: 'kafka orders.*', out: { es: [{ index: 'orders-v2' }] } }], effective: { consumes: [{ topic: 'orders.*', pattern: true }] } }, env: 'dev' });
  const source = inv.states.find(s => s.kind === 'kafka');
  assert.equal(source.target.pattern, true);
  assert.equal(source.resolution.status, 'unknown');
  assert.ok(inv.gaps.some(g => g.stateId === source.id));
  assert.ok(inv.expectations.some(e => e.kind === 'es' && e.direction === 'effects-unknown' && !e.valueKnown));
});

test('action selection retains explicit input bindings separately from schemas and rejects unknown ids', () => {
  const inv = S.inventory({ passport, entry: 'POST /orders/{orderId}/settle' });
  assert.equal(inv.actions.length, 1);
  const a = inv.actions[0], bound = S.actions(inv, { bindings: { [a.id]: { body: { orderId: 42 }, adapter: 'mock-http' } } });
  assert.equal(bound.ready, true);
  assert.equal(bound.actions[0].binding.body.orderId, 42);
  assert.equal(bound.actions[0].input.schema.required[0], 'orderId');
  assert.equal(S.actions(inv).complete, false);
  assert.equal(S.actions(inv, { bindings: { missing: {} } }).complete, false);
});

test('handler aliases merge while unknown requested actions and extra config keys remain visible', () => {
  const p = { service: 'aliases', config: { merged: { 'branch.hidden.flag': 'secret-value' } }, flows: [{ kind: 'http', entry: 'POST /orders/{}', handler: 'example.Orders#submit', out: {} }], effective: { endpoints: [{ method: 'POST', path: '/orders/{id}', handler: 'Orders.submit' }] } };
  const inv = S.inventory({ passport: p, env: 'dev', entry: ['POST /orders/{id}', 'Missing#method'] });
  assert.equal(inv.actions.length, 1);
  assert.equal(inv.actions[0].handlers.length, 1);
  assert.ok(!inv.states.some(s => s.target.type === 'ambiguous-handler'));
  assert.ok(inv.states.some(s => s.target.entry === 'Missing#method'));
  assert.ok(inv.states.some(s => s.kind === 'config' && s.target.key === 'branch.hidden.flag'));
  assert.doesNotMatch(JSON.stringify(inv), /secret-value/);
});

test('cached passport loading and cached code graphs expose scheduled/method input type hints offline', () => {
  writeJson(path.join(home, 'passports/orders/passport.json'), passport);
  assert.equal(S.inventory({ service: 'orders' }).actions.length, 3);
  const root = path.join(home, 'code'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'Jobs.java'), 'package example;\n@Component\nclass Jobs {\n@Scheduled(fixedDelay = 1000)\nvoid run() {}\npublic String explain(Long orderId) { return "pending"; }\n}\n');
  require('../lib/codeindex').build(root, 'EXAMPLE/jobs');
  const p = { service: 'jobs', codeIndex: 'EXAMPLE/jobs', repo: { path: root } };
  const jobs = S.inventory({ passport: p, env: 'dev' });
  assert.ok(jobs.actions.some(a => a.kind === 'scheduled'));
  const method = S.inventory({ passport: p, env: 'dev', entry: 'Jobs#explain' }).actions[0];
  assert.equal(method.kind, 'method');
  assert.equal(method.input.parameters[0].name, 'orderId');
  assert.equal(method.input.parameters[0].type, 'Long');
  const absent = S.inventory({ passport: p, env: 'dev', entry: 'Jobs#invented' });
  assert.equal(absent.actions.length, 0);
  assert.ok(absent.gaps.some(g => g.kind === 'no-actions'));
});

const expectations = [
  { id: 'status', kind: 'status', target: 'POST /orders', action: 'create', required: true },
  { id: 'rows', kind: 'pg', target: { db: 'orders', table: 'sales.orders' }, action: 'create', required: true },
  { id: 'count', kind: 'kafka', target: { topic: 'orders.created' }, action: 'create', required: true },
  { id: 'forbidden', kind: 'kafka', target: { topic: 'orders.failed' }, action: 'create', required: true },
  { id: 'ordered', kind: 'http', target: { path: '/audit' }, action: 'create', required: true },
];
const inv = { version: 1, service: 'orders', expectations };
const bindings = {
  status: { match: { op: 'exact', value: 201 } }, rows: { match: { op: 'subset', value: [{ id: 42, status: 'PAID' }] } },
  count: { match: { op: 'count', value: 2 } }, forbidden: { match: { op: 'forbidden', value: { status: 'FAILED' } } },
  ordered: { match: { op: 'ordered', value: [{ stage: 'created' }, { stage: 'paid' }] } },
};
const observed = { status: 201, rows: [{ id: 42, status: 'PAID', tenant_id: 7 }], count: [{ orderId: 42 }, { orderId: 43 }], forbidden: [], ordered: [{ stage: 'created', at: 1 }, { stage: 'paid', at: 2 }] };

test('explicit exact/subset/count/forbidden/ordered expectations check independent observations', () => {
  const plan = S.expectations(inv, { bindings });
  assert.equal(plan.ready, true);
  assert.equal(S.check(plan, observed).ok, true);
  assert.equal(S.check(plan, { ...observed, status: 500 }).ok, false);
  assert.equal(S.check(plan, { ...observed, rows: [{ id: 42, status: 'PENDING' }] }).ok, false);
  assert.equal(S.check(plan, { ...observed, count: [{ orderId: 42 }] }).ok, false);
  assert.equal(S.check(plan, { ...observed, forbidden: [{ status: 'FAILED' }] }).ok, false);
  assert.equal(S.check(plan, { ...observed, ordered: [...observed.ordered].reverse() }).ok, false);
  const missing = { ...observed }; delete missing.status;
  assert.match(S.check(plan, missing).results.find(r => r.id === 'status').reason, /missing/);
});

test('every required expectation needs an explicit valid predicate and an observation', () => {
  const pending = S.expectations(inv);
  assert.equal(pending.complete, false); assert.equal(S.check(pending, observed).ok, false);
  for (const match of [{ op: 'exact' }, { op: 'count', value: -1 }, { op: 'count', min: 3, max: 1 }, { op: 'invented', value: true }]) assert.equal(S.expectations({ expectations: [expectations[0]] }, { bindings: { status: { match } } }).ready, false);
  assert.equal(S.check({ expectations: [], gaps: [] }, {}).ok, false);
  const extra = S.check(S.expectations(inv, { bindings }), { ...observed, surprise: { table: 'unexpected_write' } });
  assert.equal(extra.ok, false); assert.ok(extra.gaps.some(g => g.kind === 'unexpected-observation'));
});

test('array subset matching preserves duplicate multiplicity and handles overlapping patterns', () => {
  const one = { expectations: [{ id: 'rows', kind: 'pg', target: 'rows', required: true }] };
  const plan = S.expectations(one, { bindings: { rows: { op: 'subset', value: [{ a: 1 }, { a: 1, b: 2 }] } } });
  assert.equal(S.check(plan, { rows: [{ a: 1, b: 2 }, { a: 1 }] }).ok, true);
  assert.equal(S.check(plan, { rows: [{ a: 1, b: 2 }] }).ok, false);
  const repeated = S.expectations(one, { bindings: { rows: { op: 'subset', value: [1, 1] } } });
  assert.equal(S.check(repeated, { rows: [1] }).ok, false);
});

test('record observations require action attribution when identical targets occur in different actions', () => {
  const i = { expectations: [{ id: 'a', kind: 'pg', target: { db: 'orders', table: 'sales.orders' }, action: 'create', required: true }, { id: 'b', kind: 'pg', target: { db: 'orders', table: 'sales.orders' }, action: 'settle', required: true }] };
  const p = S.expectations(i, { bindings: { a: { op: 'exact', value: { status: 'OPEN' } }, b: { op: 'exact', value: { status: 'PAID' } } } });
  assert.equal(S.check(p, [{ kind: 'pg', target: i.expectations[0].target, value: { status: 'PAID' } }]).ok, false);
  const outputs = [{ kind: 'pg', target: i.expectations[0].target, action: 'create', value: { status: 'OPEN' } }, { kind: 'pg', target: i.expectations[0].target, action: 'settle', value: { status: 'PAID' } }];
  assert.equal(S.check(p, outputs).ok, true);
  assert.equal(S.check(p, [...outputs, { kind: 'kafka', target: { topic: 'unplanned' }, value: {} }]).ok, false);
});

test('absence/count-zero and ordered subsequences require explicit descriptors', () => {
  const i = { expectations: [{ id: 'events', kind: 'kafka', target: { topic: 'orders.failed' }, required: true }] };
  const forbidden = S.expectations(i, { bindings: { events: { op: 'forbidden' } } });
  assert.equal(S.check(forbidden, []).ok, true);
  assert.equal(S.check(forbidden, {}).ok, false, 'missing map key is absent collector evidence');
  assert.equal(S.check(forbidden, { events: [{ error: true }] }).ok, false);
  const ordered = S.expectations(i, { bindings: { events: { op: 'ordered', value: [1, 3] } } });
  assert.equal(S.check(ordered, { events: [1, 2, 3] }).ok, false);
  const subsequence = S.expectations(i, { bindings: { events: { op: 'ordered', value: [1, 3], exact: false } } });
  assert.equal(S.check(subsequence, { events: [1, 2, 3] }).ok, true);
});
