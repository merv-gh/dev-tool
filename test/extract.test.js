const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { extract, parseYaml, sqlRefs, stripComments, parsePom } = require('../lib/passport/extract');

const SVC = path.join(__dirname, 'fixtures', 'order-service');
const LIB = path.join(__dirname, 'fixtures', 'common-lib');
const p = extract(SVC, { internalGroups: ['com.acme.libs'] });
const has = (arr, pred) => assert.ok(arr.some(pred), `missing in ${JSON.stringify(arr, null, 1).slice(0, 1500)}`);

test('app identity from config and pom', () => {
  assert.equal(p.app.name, 'order-service');
  assert.equal(p.app.port, '8081');
  assert.equal(p.app.springBoot, '3.2.5');
  assert.equal(p.app.groupId, 'com.acme.shop');
  assert.deepEqual(p.app.profiles, ['dev']);
});

test('endpoints: class base path, methods, handlers; comments and tests ignored', () => {
  has(p.endpoints, e => e.method === 'GET' && e.path === '/api/orders/{id}' && e.handler === 'OrderController.getOrder');
  has(p.endpoints, e => e.method === 'POST' && e.path === '/api/orders' && e.handler === 'OrderController.create');
  has(p.endpoints, e => e.method === 'POST' && e.path === '/api/orders/search' && e.handler === 'OrderController.search');
  assert.equal(p.endpoints.length, 3);
  assert.ok(!p.endpoints.some(e => /commented|test-only/.test(e.path)));
  assert.match(p.endpoints[0].file, /OrderController\.java$/);
  assert.ok(p.endpoints[0].line > 1);
});

test('feign clients become outbound calls with target service', () => {
  has(p.feign, f => f.client === 'payment-service' && f.method === 'POST' && f.path === '/payments/charge' && f.handler === 'PaymentClient.charge');
  has(p.feign, f => f.path === '/payments/by-id/{id}' && f.method === 'GET');
  assert.equal(p.endpoints.filter(e => /payments/.test(e.path)).length, 0);
});

test('kafka consumers: placeholders with defaults, constants, arrays, stream bindings', () => {
  const c = p.kafka.consumes;
  has(c, x => x.topic === 'order_status' && x.group === 'order-svc' && x.handler === 'OrderListener.onStatus');
  has(c, x => x.topic === 'invoice_events' && x.group === 'order-svc-invoices');
  has(c, x => x.topic === 'refunds');
  has(c, x => x.topic === 'payment_results' && x.via === 'stream binding' && x.group === 'order-svc');
});

test('kafka producers: @Value field, ProducerRecord constant, StreamBridge binding; mail sender ignored', () => {
  const pr = p.kafka.produces;
  has(pr, x => x.topic === 'order_created' && x.via === 'kafkaTemplate.send');
  has(pr, x => x.topic === 'invoice_events');
  has(pr, x => x.topic === 'audit_events' && x.binding === 'audit-out-0');
  assert.ok(!pr.some(x => /mail/i.test(x.via)));
  has(p.kafka.declared, d => d.topic === 'order_created' && d.key === 'app.kafka.topics.orders');
  assert.ok(!p.kafka.declared.some(d => d.key.endsWith('partitions')));
});

test('database: datasource, entities, repository, SQL reads/writes, functions, migrations', () => {
  has(p.db.datasources, d => d.db === 'orders' && d.host === 'db-host:5432' && d.kind === 'postgresql');
  const t = p.db.tables;
  has(t, x => x.table === 'sales.orders' && x.access === 'entity');
  has(t, x => x.table === 'order_item' && x.access === 'entity');
  has(t, x => x.table === 'sales.orders' && x.access === 'repository');
  has(t, x => x.table === 'sales.orders' && x.access === 'read' && x.via === 'sql');
  has(t, x => x.table === 'sales.order_items' && x.access === 'read');
  has(t, x => x.table === 'sales.orders' && x.access === 'write');
  has(t, x => x.table === 'sales.order_history' && x.access === 'write');
  has(t, x => x.table === 'sales.order_audit' && x.access === 'write');
  assert.ok(!t.some(x => x.table === 'sales.order_audit' && x.access === 'read'), 'delete from is not a read');
  has(t, x => x.table === 'sales.fn_order_total' && x.access === 'function');
  has(t, x => x.table === 'sales.orders' && x.access === 'owner' && x.via === 'migration');
  has(t, x => x.table === 'sales.order_items' && x.access === 'owner');
  assert.ok(!t.some(x => x.table === 'the' || x.table === 'list'), 'prose is not SQL');
});

test('elasticsearch index and outbound http from config', () => {
  has(p.es, x => x.index === 'orders-v2');
  has(p.http, x => x.target === 'payment-service' && x.key === 'payments.url');
  assert.ok(!p.http.some(x => /w3\.org/.test(x.url)));
});

test('dependencies: internal vs external, version from properties, comments ignored', () => {
  has(p.dependencies.internal, d => d.artifactId === 'common-lib' && d.version === '1.4.2');
  has(p.dependencies.external, d => d.artifactId === 'spring-kafka');
  assert.ok(![...p.dependencies.internal, ...p.dependencies.external].some(d => d.artifactId === 'removed-lib'));
});

test('without INTERNAL_GROUPS, own group prefix marks internal libraries', () => {
  const q = extract(SVC);
  has(q.dependencies.internal, d => d.artifactId === 'common-lib');
  assert.ok(!q.dependencies.internal.some(d => d.groupId.startsWith('org.')));
});

test('unresolved placeholders are reported, not guessed', () => {
  assert.ok(p.config.unresolved.includes('NOT_DEFINED_ANYWHERE'));
  assert.ok(!p.config.unresolved.includes('STATUS_TOPIC'), 'has a default');
});

test('kotlin library: controller and listener', () => {
  const l = extract(LIB);
  has(l.endpoints, e => e.method === 'GET' && e.path === '/internal/info' && e.handler === 'InfoController.info');
  has(l.kafka.consumes, c => c.topic === 'lib_events' && c.handler === 'LibEvents.on');
});

test('yaml subset: nesting, lists, inline lists, comments, multi-doc', () => {
  const [a, b] = parseYaml('a:\n  b: 1 # c\n  list:\n    - x\n    - name: y\n      v: 2\n  inl: [p, "q"]\n---\nz: "k # not comment"\n');
  assert.equal(a['a.b'], '1');
  assert.equal(a['a.list[0]'], 'x');
  assert.equal(a['a.list[1].name'], 'y');
  assert.equal(a['a.list[1].v'], '2');
  assert.equal(a['a.inl[1]'], 'q');
  assert.equal(b.z, 'k # not comment');
});

test('sql refs and comment stripping', () => {
  assert.deepEqual(sqlRefs('SELECT * FROM a.b JOIN "c"."d" x ON 1=1').map(r => r.table), ['a.b', 'c.d']);
  assert.deepEqual(sqlRefs('delete from t where x').map(r => r.access), ['write']);
  const s = stripComments('a // x\n"http://y" /* z\n */ b');
  assert.ok(s.includes('"http://y"') && !s.includes('x') && !s.includes('z') && s.split('\n').length === 3);
});

test('pom: parent and property resolution', () => {
  const r = parsePom('<project><parent><groupId>g</groupId><version>9</version></parent><artifactId>a</artifactId><properties><v>1</v></properties><dependencies><dependency><groupId>x</groupId><artifactId>y</artifactId><version>${v}</version></dependency></dependencies></project>');
  assert.equal(r.self.groupId, 'g');
  assert.equal(r.self.version, '9');
  assert.equal(r.deps[0].version, '1');
});

test('db function calls: SQL calls, @Procedure, SimpleJdbcCall; column lists are not calls', () => {
  const names = p.db.calls.map(c => `${c.name} ${c.via}`);
  for (const n of ['sales.fn_order_total sql', 'sales.order_total sql', 'sales.close_order @Procedure', 'calc_tax withFunctionName']) assert.ok(names.includes(n), `${n} in ${names}`);
  assert.ok(!p.db.calls.some(c => c.name === 'sales.order_history' || c.name === 'coalesce'), 'insert into t (cols) and builtins are not calls');
  const { sqlCalls } = require('../lib/passport/extract');
  assert.deepEqual(sqlCalls('select a.fn(1), count(*), lower(x) from t where y in (1) and b.g(2) > 0'), ['a.fn', 'b.g']);
  assert.deepEqual(sqlCalls('insert into s.t (a, b) values (1, 2); create table if not exists u (id int)'), []);
});
