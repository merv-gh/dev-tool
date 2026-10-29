const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fieldtrace-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, bitbucket: { url: 'https://bb.example.com' } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const F = require('../lib/fieldtrace');

// the body of sales.order_card in demo/seed.sql
const BODY = `
  select o.id, o.status, o.created_at, c.id, c.name, c.email, c.segment,
         (select count(*)::int from sales.order_items i where i.order_id = o.id),
         o.total, round(o.total * 1.2, 2), case when c.segment = 'vip' then 5 else 0 end,
         (select p.status from sales.payments p where p.order_id = o.id)
  from sales.orders o join sales.customers c on c.id = o.customer_id where o.id = p_id
`;

test('a function body: its select list by position, with lines, and what each item reads', () => {
  const list = F.selectList(BODY), map = F.aliases(BODY);
  assert.equal(list.items.length, 12);
  assert.deepEqual([map.o, map.c, map.i, map.p], ['sales.orders', 'sales.customers', 'sales.order_items', 'sales.payments']);
  const at = n => BODY.slice(0, list.items[n].at).split('\n').length;
  assert.deepEqual([at(0), at(7), at(8), at(11)], [2, 3, 4, 5]);
  assert.deepEqual(F.reads(list.items[5].text, map), ['sales.customers.email']);
  assert.deepEqual(F.reads(list.items[9].text, map), ['sales.orders.total']);
  assert.ok(F.reads(list.items[11].text, map).includes('sales.payments.status'));
  assert.deepEqual(F.reads('sales.order_total(o.id, true)', map), ['sales.orders.id', 'sales.order_total()']);
  assert.equal(F.selectList('begin return query select a.x, b.y from t a join u b on true; end').items.length, 2, 'plpgsql RETURN QUERY');
  assert.equal(F.stripAlias('o.total as amount'), 'o.total');
  assert.equal(F.stripAlias("case when c.segment = 'vip' then 5 else 0 end"), "case when c.segment = 'vip' then 5 else 0 end");
});

test('deprecations come from the comment: replacement, or removed when it has none', () => {
  const d = F.deprecations('Order card. DEPRECATED fields: customer_email -> sales.customer_contact(customer_id).email; total -> sales.order_total(order_id); legacy_discount -> no replacement (0 since v2). Others are fine.', ['customer_email', 'total', 'status', 'legacy_discount']);
  assert.deepEqual(d.customer_email, { replacement: 'sales.customer_contact(customer_id).email', status: 'deprecated' });
  assert.equal(d.total.replacement, 'sales.order_total(order_id)');
  assert.equal(d.legacy_discount.status, 'removed');
  assert.equal(d.legacy_discount.replacement, 'no replacement (0 since v2)', 'stops at the end of its sentence');
  assert.equal(d.status, undefined);
  assert.deepEqual(F.deprecations('Totals of an order', ['total']), {}, 'no deprecation word, nothing deprecated');
});

test('which source columns a statement selects: * is all of them', () => {
  const names = ['total', 'last_payment_status', 'legacy_discount', 'status'];
  assert.deepEqual(F.selected('select * from sales.order_card(?)', 'sales.order_card', names), names);
  assert.deepEqual(F.selected('select oc.total, oc.last_payment_status from sales.order_card(:id) oc', 'sales.order_card', names), ['total', 'last_payment_status']);
  assert.deepEqual(F.selected('select legacy_discount as d from sales.order_card(:id)', 'sales.order_card', names), ['legacy_discount']);
});

test('records get one line per component and accessor nodes; Lombok @Data gets getters', () => {
  const G = require('../lib/codegraph'), src = fs.readFileSync(path.join(__dirname, 'fixtures/order-view-service/src/main/java/com/acme/view/OrderCard.java'), 'utf8');
  const card = G.parseFile('src/main/java/com/acme/view/OrderCard.java', src).classes[0];
  assert.deepEqual(card.fields.slice(0, 3).map(f => `${f.name}:${f.line}`), ['orderId:8', 'status:9', 'createdAt:10']);
  assert.deepEqual(card.methods.filter(m => m.implicit === 'record-accessor').map(m => m.name).slice(0, 3), ['orderId', 'status', 'createdAt']);
  const dto = G.parseFile('A.java', 'package a;\n@Data\npublic class Dto {\n  private String name;\n  private boolean active;\n  public String getName() { return "x"; }\n}\n').classes[0];
  assert.deepEqual(dto.methods.map(m => `${m.name}${m.implicit ? '*' : ''}`).sort(), ['getName', 'isActive*'], 'an explicit getter is kept, the missing one added');
});

test('the code side: SQL places, row mapper argument -> record component, accessor calls by edge, with links', () => {
  const CI = require('../lib/codeindex');
  CI.build(path.join(__dirname, 'fixtures/order-view-service'), 'SHOP/order-view-service', { project: 'SHOP', repo: 'order-view-service' });
  const names = ['customer_email', 'total', 'last_payment_status', 'legacy_discount', 'segment'];
  // the private code side, through a trace over a stub catalog
  const P = require('../lib/pgindex'), describe = P.describe;
  P.describe = () => [{ db: 'orders', object: 'sales.order_card', kind: 'function', lang: 'sql', body: BODY, comment: 'DEPRECATED: customer_email -> sales.customer_contact(customer_id).email; total -> sales.order_total(order_id); legacy_discount -> no replacement',
    arg_list: [{ name: 'p_id', mode: 'in' }, ...['order_id', 'status', 'created_at', 'customer_id', 'customer_name', 'customer_email', 'segment', 'item_count', 'total', 'total_with_tax', 'legacy_discount', 'last_payment_status'].map(name => ({ name, type: 'x', mode: 'table' }))],
    usedBy: [], uses: [] }];
  try {
    const r = F.trace({ env: 'dev', name: 'sales.order_card', fields: names.join(','), repos: 'SHOP/order-view-service' });
    const f = Object.fromEntries(r.fields.map(x => [x.field, x]));
    assert.equal(f.customer_email.status, 'deprecated'); assert.equal(f.legacy_discount.status, 'removed'); assert.equal(f.segment.status, 'keep');
    assert.equal(f.customer_email.line, 2);
    assert.deepEqual(f.customer_email.code.mapper.map(m => `${m.where} ${m.component}`), ['src/main/java/com/acme/view/OrderCardRepository.java:17 customerEmail']);
    assert.equal(f.customer_email.code.mapper[0].url, 'https://bb.example.com/projects/SHOP/repos/order-view-service/browse/src/main/java/com/acme/view/OrderCardRepository.java#17');
    assert.deepEqual(f.customer_email.code.model.map(m => `${m.model}.${m.field} ${m.where}`), ['com.acme.view.OrderCard.customerEmail src/main/java/com/acme/view/OrderCard.java:13']);
    assert.deepEqual(f.customer_email.code.uses.map(u => u.where).sort(), ['src/main/java/com/acme/view/OrderViewService.java:17', 'src/main/java/com/acme/view/ReminderService.java:17']);
    assert.deepEqual(f.total.code.sql.map(s => s.method).sort(), ['DashboardDao#paymentLine', 'OrderCardRepository#find'], 'a native query selecting it is a place too');
    assert.equal(f.segment.mappedNotUsed, true, 'mapped into the model, read nowhere');
    assert.ok(!f.last_payment_status.code.uses.some(u => /OrderViewController/.test(u.where)), 'only accessor calls on the model, not any .status()');
    const rows = F.rows(r), m = F.model(r);
    assert.equal(rows.find(x => x.field === 'customer_email')['used in'].length, 2);
    assert.ok(m.relations.some(x => x.conflict && x.to === 'pg:sales.order_card'), 'deprecated reads are red');
    assert.ok(m.relations.some(x => x.confidence === 'stated' && x.to === 'pg:sales.customer_contact()'), 'the replacement, dashed');
  } finally { P.describe = describe; }
});
