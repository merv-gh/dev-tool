const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../lib/fixture-schema');
const byPath = topic => new Map(S.paths(topic).map(p => [p.path, p]));

test('JSON Schema discovers nested arrays, nullable fields, unions and local references', () => {
  const topic = { topic: 'orders', valueSchema: { type: 'JSON', schema: JSON.stringify({
    type: 'object', $defs: { orderKey: { type: ['integer', 'null'] } }, properties: {
      orderId: { $ref: '#/$defs/orderKey' },
      lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, orderId: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } } },
      matrix: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
      state: { enum: ['open', 'paid'] }, freeform: {}, possible: true, forbidden: false,
      'literal.dot': { type: 'string' },
    }, allOf: [{ properties: { customer_id: { type: 'string' } } }],
  }) } };
  const p = byPath(topic);
  assert.ok(p.has('value.lines[].sku'));
  assert.ok(p.has('value.matrix[][]'));
  assert.ok(p.has('value.customer_id'));
  assert.deepEqual(p.get('value.lines[].orderId').types, ['integer', 'null']);
  assert.ok(p.get('value.orderId').types.includes('integer'));
  assert.deepEqual(p.get('value.orderId').sources, ['json-schema']);
  assert.equal(S.validatePath(topic, 'value.freeform'), true);
  assert.equal(S.validatePath(topic, 'value.possible'), true);
  assert.equal(S.validatePath(topic, 'value.forbidden'), false);
  assert.equal(S.validatePath(topic, 'value.literal.dot'), false, 'literal dotted keys cannot be expressed by match-path syntax');
});

test('Avro records, arrays, null unions and qualified named references preserve paths', () => {
  const topic = { topic: 'orders', keySchema: { type: 'AVRO', schema: '"string"' }, valueSchema: { type: 'AVRO', schema: { type: 'record', name: 'Event', namespace: 'events', fields: [
    { name: 'orders', type: ['null', { type: 'array', items: { type: 'record', name: 'Order', fields: [
      { name: 'orderId', type: 'long' }, { name: 'customer', type: { type: 'record', name: 'Customer', fields: [{ name: 'customerId', type: 'string' }] } },
    ] } }] },
    { name: 'lastOrder', type: ['null', 'events.Order'] },
    { name: 'state', type: { type: 'enum', name: 'State', symbols: ['OPEN', 'PAID'] } },
    { name: 'at', type: { type: 'long', logicalType: 'timestamp-millis' } },
  ] } } };
  const p = byPath(topic);
  assert.deepEqual(p.get('key').types, ['string']);
  assert.deepEqual(p.get('value.orders').types, ['array', 'null']);
  assert.deepEqual(p.get('value.orders[].orderId').types, ['integer']);
  assert.deepEqual(p.get('value.lastOrder.orderId').types, ['integer']);
  assert.deepEqual(p.get('value.orders[].customer.customerId').types, ['string']);
  assert.deepEqual(p.get('value.state').types, ['string']);
  assert.deepEqual(p.get('value.at').sources, ['avro-schema']);
  assert.equal(S.validatePath(topic, 'key.orderId'), false);
});

test('schema-less caches combine flattened fields and every sample array element', () => {
  const topic = { topic: 'orders', fields: { order_id: 'number', 'lines[].sku': 'string' }, samples: [
    { key: '007', headers: { orderId: '42' }, value: { customerId: 9, lines: [{ sku: 'a', orderId: 42 }, { refund_id: 8 }], ids: [1, 2], privateNote: 'not evidence' } },
    { key: '008', value: { customerId: null, lines: [], ids: [3] } },
  ] };
  const p = byPath(topic);
  assert.deepEqual(p.get('value.order_id').sources, ['cached-fields']);
  assert.ok(p.has('value.lines'));
  assert.ok(p.has('value.lines[]'));
  assert.ok(p.has('value.lines[].refund_id'));
  assert.deepEqual(p.get('value.ids[]').types, ['integer']);
  assert.deepEqual(p.get('value.customerId').types, ['integer', 'null']);
  assert.deepEqual(p.get('key').types, ['string']);
  assert.ok(p.has('headers.orderId'));
  assert.doesNotMatch(JSON.stringify(S.paths(topic)), /not evidence|007|008/);
});

test('known schemas validate exact paths and permit unknown header names', () => {
  const topic = { valueSchema: { type: 'JSON', schema: { type: 'object', properties: { orderId: { type: 'integer' } } } }, samples: [{ value: { typoId: 1 } }] };
  assert.equal(S.validatePath(topic, 'value.orderId'), true);
  assert.equal(S.validatePath(topic, 'value.typoId'), false);
  assert.equal(S.validatePath(topic, 'value.orderId.extra'), false);
  assert.equal(S.validatePath(topic, 'headers.x-order-id'), true);
  assert.equal(S.validatePath(topic, 'headers'), true);
  for (const p of ['values.orderId', 'headers..id', 'value[0].id', 'value.id;sql', '../value.id', null]) assert.equal(S.validatePath(topic, p), false, String(p));
});

test('malformed and cyclic schemas stay bounded and can fall back to cached evidence', () => {
  assert.deepEqual(S.paths(null), []);
  assert.deepEqual(S.candidates([null], [null]), []);
  const cyclic = { type: 'object', properties: {} }; cyclic.properties.self = cyclic;
  assert.ok(S.paths({ valueSchema: { type: 'JSON', schema: cyclic } }).length <= 2);
  const recursive = { type: 'record', name: 'Node', fields: [{ name: 'id', type: 'long' }, { name: 'next', type: ['null', 'Node'] }] };
  assert.ok(S.paths({ valueSchema: { type: 'AVRO', schema: recursive } }).length < 10);
  for (const schema of ['{invalid', null, 42, { properties: 'invalid' }, { type: 'record', fields: 'invalid' }]) {
    assert.doesNotThrow(() => S.paths({ valueSchema: { type: 'AVRO', schema } }));
    assert.ok(byPath({ valueSchema: { type: 'JSON', schema }, samples: [{ value: { orderId: 42 } }] }).has('value.orderId'));
  }
  assert.equal(S.validatePath({ valueSchema: { type: 'JSON', schema: { $ref: 'https://example.invalid/schema.json' } } }, 'value.orderId'), false);
  assert.equal(S.validatePath({ valueSchema: { type: 'AVRO', schema: 'constructor' } }, 'value.orderId'), false);
});

test('raw Avro primitives/arrays and flattened field-list caches are supported', () => {
  assert.deepEqual(byPath({ keySchema: { type: 'long' } }).get('key').types, ['integer']);
  assert.deepEqual(byPath({ valueSchema: { type: 'array', items: 'long' } }).get('value[]').types, ['integer']);
  const fields = byPath({ fields: [{ path: 'lines[].order_id', type: 'long' }, { name: 'status', type: 'string' }] });
  assert.deepEqual(fields.get('value.lines[].order_id').types, ['integer']);
  assert.equal(fields.get('value.lines').types[0], 'array');
  assert.ok(fields.has('value.status'));
});

test('correlation candidates retain ambiguous normalized names and semantic table ids', () => {
  const tables = [
    { db: 'orders', table: 'sales.orders', columns: [{ name: 'id', type: 'bigint' }, { name: 'customer_id', type: 'bigint' }] },
    { db: 'billing', table: 'pay.payments', columns: [{ name: 'id', type: 'bigint' }, { name: 'ORDER_ID', type: 'bigint' }] },
    { db: 'crm', table: 'crm.customers', columns: [{ name: 'id', type: 'bigint' }] },
  ];
  const topic = { topic: 'orders.paid', valueSchema: { type: 'JSON', schema: { type: 'object', properties: { orderId: { type: 'integer' }, customerId: { type: 'integer' }, id: { type: 'integer' }, lines: { type: 'array', items: { type: 'object', properties: { order_id: { type: 'integer' } } } } } } } };
  const before = JSON.stringify([tables, topic]);
  const c = S.candidates(tables, [topic]);
  assert.deepEqual(c.filter(x => x.path === 'value.orderId').map(x => `${x.from.db}:${x.from.table}.${x.from.column}`).sort(), ['billing:pay.payments.ORDER_ID', 'orders:sales.orders.id']);
  assert.equal(c.filter(x => x.path === 'value.customerId').length, 2);
  assert.equal(c.filter(x => x.path === 'value.id').length, 3);
  assert.equal(c.filter(x => x.path === 'value.lines[].order_id').length, 2);
  assert.ok(c.every(x => x.source === 'candidate' && x.verified === false && x.evidence.length >= 2));
  assert.ok(c.some(x => x.evidence.some(e => /table semantic id/.test(e))));
  assert.equal(JSON.stringify([tables, topic]), before, 'discovery is read-only');
  assert.deepEqual(S.candidates(tables, [topic]), c, 'ordering is deterministic');
});

test('candidate inference handles compound/plural table ids and observed headers without inventing fields', () => {
  const tables = ['order_items', 'companies', 'statuses'].map(name => ({ db: 'db', schema: 's', name, columns: [{ name: 'id' }] }));
  const topic = { topic: 'events', samples: [{ value: { orderItemId: 1, company_id: 2 }, headers: { statusId: '3' } }] };
  const c = S.candidates(tables, [topic]);
  assert.ok(c.some(x => x.path === 'value.orderItemId' && x.from.table === 's.order_items'));
  assert.ok(c.some(x => x.path === 'value.company_id' && x.from.table === 's.companies'));
  assert.ok(c.some(x => x.path === 'headers.statusId' && x.from.table === 's.statuses'));
  assert.deepEqual(S.candidates(tables, [{ topic: 'empty' }]), []);
});

test('existing cached JSON, Avro and sample-only Kafka fixtures expose their correlation fields', () => {
  const dir = path.join(__dirname, 'fixtures', 'kafka');
  const topics = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(topics.length >= 3);
  const p = new Map(topics.map(t => [t.topic, S.paths(t).map(x => x.path)]));
  assert.ok(p.get('orders.paid').includes('value.lines[].sku'));
  assert.ok(p.get('shipments.sent').includes('value.orderId'));
  assert.ok(p.get('parcels.scanned').includes('value.shipmentId'));
});
