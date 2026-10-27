// A fake environment for demos and screenshots, on one port:
//   Consul (/v1), Elasticsearch data + ELK logs (/, /_cat, /_mapping, /<index>/_search), kafka-ui (/api),
//   Schema Registry (/subjects), Bitbucket REST (/rest) and git over HTTP (/scm, real repos made from
//   test/fixtures plus a generated payment-service). Data is invented; names are generic.
//   node demo/mock.js [port]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 4900);
const FIX = path.join(__dirname, '..', 'test', 'fixtures');

// ── git repos served over smart HTTP ──
const GIT = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-demo-git-'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com' } }).toString().trim();
function makeRepo(slug, src, tag) {
  const work = path.join(GIT, 'work', slug);
  fs.cpSync(src, work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main'); git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', `${slug}: initial`);
  if (tag) git(work, 'tag', tag);
  git(GIT, 'clone', '-q', '--bare', work, path.join('bare', `${slug}.git`));
  git(path.join(GIT, 'bare', `${slug}.git`), 'config', 'http.uploadpack', 'true');
}
const pay = path.join(GIT, 'src', 'payment-service');
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(pay, f)), { recursive: true }); fs.writeFileSync(path.join(pay, f), t); };
w('pom.xml', '<project><groupId>com.acme.shop</groupId><artifactId>payment-service</artifactId><version>2.1.0</version>\n<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.4</version></parent>\n<dependencies><dependency><groupId>com.acme.libs</groupId><artifactId>common-lib</artifactId><version>1.4.2</version></dependency><dependency><groupId>org.springframework.kafka</groupId><artifactId>spring-kafka</artifactId></dependency></dependencies></project>\n');
w('src/main/resources/application.yml', 'spring:\n  application:\n    name: payment-service\n  datasource:\n    url: jdbc:postgresql://db:5432/orders\nserver:\n  port: 8082\n');
w('src/main/java/com/acme/pay/PaymentListener.java', `package com.acme.pay;

@Component
public class PaymentListener {
    @KafkaListener(topics = "order_created", groupId = "payment-service")
    public void onOrder(OrderEvent e) {
        BigDecimal total = jdbc.queryForObject("select sales.order_total(?, true)", BigDecimal.class, e.id());
        jdbc.update("insert into sales.payments (order_id, amount, status) values (?, ?, 'pending')", e.id(), total);
        kafkaTemplate.send("payment_results", e.id().toString(), new PaymentResult(e.id(), "ok"));
    }
}
`);
w('src/main/java/com/acme/pay/PaymentController.java', `package com.acme.pay;

@RestController
@RequestMapping("/api/payments")
public class PaymentController {
    @GetMapping("/{orderId}")
    public Payment get(@PathVariable Long orderId) {
        return jdbc.queryForObject("select * from sales.payments where order_id = ?", mapper, orderId);
    }
    @PostMapping("/{orderId}/refund")
    public void refund(@PathVariable Long orderId) {
        jdbc.update("update sales.payments set status = 'refunded' where order_id = ?", orderId);
    }
}
`);
makeRepo('order-service', path.join(FIX, 'order-service'));
makeRepo('common-lib', path.join(FIX, 'common-lib'), 'v1.4.2');
makeRepo('payment-service', pay);
const GIT_BACKEND = path.join(execFileSync('git', ['--exec-path']).toString().trim(), 'git-http-backend');

// ── data ──
const now = Date.now();
const SERVICES = {
  'api-gateway': [['passing', 'passing']],
  'order-service': [['passing', 'passing']],
  'payment-service': [['passing', 'warning', 'slow responses: p99 2.4s']],
  'inventory-service': [['critical', 'critical', 'HTTP GET http://10.0.3.7:8080/actuator/health: 503 {"status":"DOWN","components":{"db":{"status":"DOWN"}}}']],
  'notification-service': [['passing', 'passing']],
  'customer-service': [['passing', 'passing']],
};
const TOPICS = [
  { name: 'order_created', partitionCount: 6, replicationFactor: 3, cleanUpPolicy: 'DELETE', partitions: [0, 1, 2, 3, 4, 5].map(p => ({ partition: p, offsetMin: 0, offsetMax: 4200 + p * 37 })) },
  { name: 'payment_results', partitionCount: 3, replicationFactor: 3, cleanUpPolicy: 'DELETE', partitions: [0, 1, 2].map(p => ({ partition: p, offsetMin: 100, offsetMax: 3100 + p })) },
  { name: 'audit_events', partitionCount: 1, replicationFactor: 3, cleanUpPolicy: 'COMPACT', partitions: [{ partition: 0, offsetMin: 0, offsetMax: 880 }] },
  { name: 'inventory_reserved', partitionCount: 3, replicationFactor: 3, cleanUpPolicy: 'DELETE', partitions: [0, 1, 2].map(p => ({ partition: p, offsetMin: 0, offsetMax: 950 })) },
];
const message = (topic, i) => ({
  order_created: { orderId: 51000 + i, customerId: 7300 + (i % 40), total: 129.9 + i, currency: 'EUR', items: [{ sku: `SKU-${100 + (i % 9)}`, qty: 1 + (i % 3) }], createdAt: new Date(now - i * 9000).toISOString() },
  payment_results: { orderId: 51000 + i, status: i % 7 ? 'ok' : 'declined', provider: 'cards', amount: 129.9 + i },
  audit_events: { entity: 'order', entityId: 51000 + i, action: 'status_changed', to: 'paid', actor: 'payment-service' },
  inventory_reserved: { orderId: 51000 + i, sku: `SKU-${100 + (i % 9)}`, warehouse: 'eu-1', qty: 1 },
}[topic]);
const GROUPS = [
  { groupId: 'notification-service', messagesBehind: 18240, state: 'STABLE', members: 2, topics: 2 },
  { groupId: 'payment-service', messagesBehind: 412, state: 'STABLE', members: 3, topics: 1 },
  { groupId: 'inventory-service', messagesBehind: 96, state: 'PREPARING_REBALANCE', members: 1, topics: 1 },
  { groupId: 'order-service', messagesBehind: 0, state: 'STABLE', members: 3, topics: 1 },
  { groupId: 'audit-archiver', messagesBehind: 0, state: 'EMPTY', members: 0, topics: 1 },
];
const INDICES = [
  { index: 'orders-v2', health: 'green', status: 'open', 'docs.count': '182340', 'store.size': '412mb', pri: '3', rep: '1' },
  { index: 'customers', health: 'yellow', status: 'open', 'docs.count': '9312', 'store.size': '18mb', pri: '1', rep: '1' },
  { index: 'products', health: 'green', status: 'open', 'docs.count': '2210', 'store.size': '6mb', pri: '1', rep: '1' },
];
const MAPPINGS = {
  'orders-v2': { properties: { id: { type: 'long' }, status: { type: 'keyword' }, customer: { properties: { id: { type: 'long' }, email: { type: 'keyword' }, name: { type: 'text' } } }, total: { type: 'scaled_float' }, items: { properties: { sku: { type: 'keyword' }, qty: { type: 'integer' } } }, createdAt: { type: 'date' } } },
  customers: { properties: { id: { type: 'long' }, email: { type: 'keyword' }, name: { type: 'text' }, segment: { type: 'keyword' } } },
  products: { properties: { sku: { type: 'keyword' }, title: { type: 'text' }, price: { type: 'scaled_float' } } },
};
const esDoc = (index, i) => ({
  'orders-v2': { id: 51000 + i, status: ['new', 'paid', 'shipped'][i % 3], customer: { id: 7300 + i, email: `customer${i}@example.com`, name: `Customer ${i}` }, total: 99 + i * 3, items: [{ sku: `SKU-${100 + i}`, qty: 1 }], createdAt: new Date(now - i * 36e5).toISOString() },
  customers: { id: 7300 + i, email: `customer${i}@example.com`, name: `Customer ${i}`, segment: ['retail', 'business'][i % 2] },
  products: { sku: `SKU-${100 + i}`, title: `Product ${i}`, price: 19.9 + i },
}[index]);

// logs: 3 services, mostly INFO, some WARN/ERROR, a few traces across services
const LV = ['INFO', 'INFO', 'INFO', 'INFO', 'DEBUG', 'WARN', 'INFO', 'ERROR'];
const SVC = ['api-gateway', 'order-service', 'payment-service', 'inventory-service'];
function logDocs(traceId) {
  if (traceId) {
    const hops = [['api-gateway', 'INFO', 'POST /api/orders from 10.1.4.20'], ['order-service', 'INFO', 'Creating order 51842 for customer 7344'], ['order-service', 'DEBUG', 'insert into sales.orders ... 3 items'], ['order-service', 'INFO', 'Published order_created key=51842'],
      ['payment-service', 'INFO', 'Received order_created 51842'], ['payment-service', 'WARN', 'Card provider slow: 2380 ms'], ['payment-service', 'ERROR', 'Payment declined for order 51842: java.lang.IllegalStateException: card expired\n\tat com.acme.pay.Charger.charge(Charger.java:88)\n\tat com.acme.pay.PaymentListener.onOrder(PaymentListener.java:9)'],
      ['payment-service', 'INFO', 'Published payment_results 51842 status=declined'], ['order-service', 'INFO', 'Order 51842 -> payment_failed'], ['api-gateway', 'INFO', '201 POST /api/orders 2.9s']];
    return hops.map(([service, level, message], i) => ({ _index: 'logs-2026.10.27', _id: `t${i}`, _source: { '@timestamp': new Date(now - 90000 + i * 310).toISOString(), service: { name: service }, log: { level }, trace: { id: traceId }, message } }));
  }
  return Array.from({ length: 240 }, (_, i) => {
    const level = LV[(i * 7) % LV.length], service = level === 'ERROR' ? ['payment-service', 'inventory-service'][Math.floor(i / 8) % 2] : SVC[i % SVC.length];
    const msg = level === 'ERROR' ? (service === 'inventory-service' ? 'Connection to db-inventory:5432 refused (pool exhausted, 20/20 in use)' : `Payment declined for order ${51000 + i}: java.lang.IllegalStateException: card expired\n\tat com.acme.pay.Charger.charge(Charger.java:88)`)
      : level === 'WARN' ? `Slow query 1840 ms: select * from sales.orders where customer_id = ${7300 + i}` : `Handled ${['GET', 'POST'][i % 2]} /api/orders/${51000 + i} in ${12 + (i % 60)} ms`;
    // errors cluster in the last 20 minutes, like an incident
    const t = now - (level === 'ERROR' ? 60000 + (i % 37) * 31000 + i * 97 : i * 14000);
    return { _index: 'logs-2026.10.27', _id: `l${i}`, _source: { '@timestamp': new Date(t).toISOString(), service: { name: service }, log: { level }, trace: { id: `tr-${(i % 12).toString(16)}a7c` }, message: msg } };
  }).sort((a, b) => b._source['@timestamp'].localeCompare(a._source['@timestamp']));
}

const PR = {
  id: 42, title: 'Refund endpoint + payments table', description: 'Adds POST /api/payments/{orderId}/refund.\n\nStores payments in sales.payments (new migration).', state: 'OPEN',
  author: { user: { displayName: 'Ann Lee' } }, fromRef: { displayId: 'feature/refunds', latestCommit: 'a1b2c3d4e5f6' }, toRef: { displayId: 'main', latestCommit: '0f9e8d7c6b5a', repository: { slug: 'payment-service', project: { key: 'SHOP' } } },
  reviewers: [{ user: { displayName: 'Bo Kim' }, status: 'NEEDS_WORK' }, { user: { displayName: 'Cy Ross' }, status: 'APPROVED' }],
  createdDate: now - 2 * 864e5, updatedDate: now - 3600e3, links: { self: [{ href: `http://127.0.0.1:${PORT}/projects/SHOP/repos/payment-service/pull-requests/42` }] },
};
const PR_DIFF = { diffs: [
  { source: { toString: 'src/main/java/com/acme/pay/PaymentController.java' }, destination: { toString: 'src/main/java/com/acme/pay/PaymentController.java' }, hunks: [{ sourceLine: 9, sourceSpan: 5, destinationLine: 9, destinationSpan: 9, segments: [
    { type: 'CONTEXT', lines: [{ line: '        return jdbc.queryForObject("select * from sales.payments where order_id = ?", mapper, orderId);' }, { line: '    }' }] },
    { type: 'ADDED', lines: [{ line: '    @PostMapping("/{orderId}/refund")' }, { line: '    public void refund(@PathVariable Long orderId) {' }, { line: '        jdbc.update("update sales.payments set status = \'refunded\' where order_id = ?", orderId);' }, { line: '    }' }] },
    { type: 'REMOVED', lines: [{ line: '    // TODO refunds' }] },
    { type: 'CONTEXT', lines: [{ line: '}' }] }] }] },
  { source: null, destination: { toString: 'src/main/resources/db/migration/V3__payments.sql' }, hunks: [{ sourceLine: 0, sourceSpan: 0, destinationLine: 1, destinationSpan: 3, segments: [{ type: 'ADDED', lines: [{ line: 'create table sales.payments (' }, { line: '  order_id bigint references sales.orders(id), amount numeric(12,2), status text' }, { line: ');' }] }] }] },
] };
const PR_ACTS = { values: [
  { action: 'APPROVED', user: { displayName: 'Cy Ross' }, createdDate: now - 3600e3 },
  { action: 'COMMENTED', user: { displayName: 'Bo Kim' }, createdDate: now - 5 * 3600e3, comment: { text: 'Refunding twice should be a no-op. Check the status first?' }, commentAnchor: { path: 'src/main/java/com/acme/pay/PaymentController.java', line: 14 } },
  { action: 'COMMENTED', user: { displayName: 'Ann Lee' }, createdDate: now - 4 * 3600e3, comment: { text: 'Good point, will add a where status = \'paid\'.' } },
] };

const html = (res, body) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><meta charset=utf-8><title>shop</title><body style="font:14px system-ui;margin:24px">${body}`); };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const chunks = [];
  req.on('data', c => chunks.push(c)).on('end', () => {
    const raw = Buffer.concat(chunks), body = raw.toString();
    const j = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    let m;
    // Consul
    if (p === '/v1/agent/self') return j({ Config: { Datacenter: 'demo-dc' } });
    if (p === '/v1/catalog/services') return j(Object.fromEntries([['consul', []], ...Object.keys(SERVICES).map(s => [s, ['spring']])]));
    if (p === '/v1/health/state/any') return j(Object.entries(SERVICES).flatMap(([s, inst]) => inst.flatMap(([a, b, out], k) => [
      { Node: `node-${k + 1}`, CheckID: `${s}-1`, Name: 'http /actuator/health', Status: a, Output: a === 'passing' ? 'HTTP 200' : out, ServiceName: s, ServiceID: `${s}-1` },
      { Node: `node-${k + 2}`, CheckID: `${s}-2`, Name: 'http /actuator/health', Status: b, Output: b === 'passing' ? 'HTTP 200' : out, ServiceName: s, ServiceID: `${s}-2` },
    ])).concat([{ Node: 'node-1', CheckID: 'serfHealth', Name: 'Serf Health Status', Status: 'passing', ServiceName: '', ServiceID: '' }]));
    if ((m = p.match(/^\/v1\/health\/service\/(.+)$/))) return j([1, 2].map(k => ({ Node: { Node: `node-${k}`, Address: '127.0.0.1' }, Service: { Address: '127.0.0.1', Port: PORT, Tags: ['spring'], Meta: { version: '2.1.0' } }, Checks: [{ Status: 'passing' }] })));
    if (p === '/version') return j({ git: { branch: 'main', commit: { id: 'demo' } }, build: { version: '2.1.0' } });
    // kafka-ui + schema registry
    if (p === '/api/clusters') return j([{ name: 'demo', status: 'online' }]);
    if (p === '/api/clusters/demo/topics') return j({ pageCount: 1, topics: TOPICS });
    if (p === '/api/clusters/demo/consumer-groups/paged') return j({ pageCount: 1, consumerGroups: GROUPS });
    if ((m = p.match(/^\/api\/clusters\/demo\/topics\/([^/]+)\/messages$/))) {
      const topic = decodeURIComponent(m[1]), lim = +u.searchParams.get('limit') || 3, off = +u.searchParams.get('offset') || 0;
      res.setHeader('content-type', 'text/event-stream');
      for (let i = 0; i < lim; i++) res.write('data:' + JSON.stringify({ type: 'MESSAGE', message: { partition: +u.searchParams.get('partition') || 0, offset: off + i, timestamp: new Date(now - (off % 997) * 4000 - i * 9000).toISOString(), key: String(51000 + (off + i) % 1000), headers: { source: 'demo' }, content: JSON.stringify(message(topic, (off + i) % 1000)) } }) + '\n\n');
      return res.end('data:{"type":"DONE"}\n\n');
    }
    if ((m = p.match(/^\/api\/clusters\/demo\/topics\/([^/]+)$/))) return j(TOPICS.find(t => t.name === decodeURIComponent(m[1])) || {});
    if (p === '/subjects') return j(['order_created-value', 'payment_results-value']);
    if ((m = p.match(/^\/subjects\/([^/]+)\/versions\/latest$/))) return j({ version: 3, id: 17, schema: JSON.stringify({ type: 'record', name: m[1].replace(/-value$/, ''), fields: [{ name: 'orderId', type: 'long' }] }) });
    // Elasticsearch (data + logs)
    if (p === '/') return j({ version: { number: '8.15.0' }, cluster_name: 'demo' });
    if (p === '/_cluster/health') return j({ cluster_name: 'demo', status: 'yellow', number_of_nodes: 3, active_shards: 14, unassigned_shards: 1 });
    if (p === '/_cat/indices') return j(INDICES);
    if (p === '/_cat/aliases') return j([{ alias: 'orders', index: 'orders-v2' }]);
    if (p === '/_mapping') return j(Object.fromEntries(Object.entries(MAPPINGS).map(([k, v]) => [k, { mappings: v }])));
    if (p === '/_msearch') return j({ responses: body.trim().split('\n').filter((_, i) => i % 2 === 0).map(l => { const idx = JSON.parse(l).index; return { hits: { hits: [0, 1].map(i => ({ _id: String(i), _source: esDoc(idx, i) })) } }; }) });
    if (p === '/logs-*/_search') {
      const b = JSON.parse(body || '{}');
      const trace = (JSON.stringify(b).match(/"trace\.id":"([^"]+)"/) || [])[1];
      const lv = [...new Set([...JSON.stringify(b).matchAll(/"log\.level":"(\w+)"/g)].map(x => x[1].toUpperCase()))];
      const docs = logDocs(trace).filter(d => !lv.length || lv.includes(d._source.log.level));
      if (b.size === 0) {
        const buckets = Array.from({ length: 60 }, (_, k) => ({ key: now - (59 - k) * 60000, doc_count: 0, level: { buckets: [] } }));
        for (const d of docs) {
          const k = 59 - Math.floor((now - Date.parse(d._source['@timestamp'])) / 60000);
          if (k < 0) continue;
          buckets[k].doc_count++;
          const l = d._source.log.level, e = buckets[k].level.buckets.find(x => x.key === l);
          e ? e.doc_count++ : buckets[k].level.buckets.push({ key: l, doc_count: 1 });
        }
        const count = (f) => Object.entries(docs.reduce((acc, d) => (acc[f(d)] = (acc[f(d)] || 0) + 1, acc), {})).map(([key, doc_count]) => ({ key, doc_count })).sort((a, b) => b.doc_count - a.doc_count);
        return j({ aggregations: { levels: { buckets: count(d => d._source.log.level) }, services: { buckets: count(d => d._source.service.name) }, timeline: { buckets } } });
      }
      const asc = JSON.stringify(b.sort || '').includes('asc');
      const sorted = [...docs].sort((x, y) => (asc ? 1 : -1) * x._source['@timestamp'].localeCompare(y._source['@timestamp']));
      return j({ hits: { total: { value: docs.length }, hits: sorted.slice(0, b.size || 200) }, aggregations: { timeline: { buckets: [] } } });
    }
    if ((m = p.match(/^\/([\w.-]+)\/_search$/))) return j({ hits: { total: { value: 2 }, hits: [0, 1].map(i => ({ _index: m[1], _id: String(i), _source: esDoc(m[1], i) || {} })) } });
    // Bitbucket
    if (p === '/rest/api/1.0/repos') {
      const name = u.searchParams.get('name') || '';
      return j({ isLastPage: true, values: ['order-service', 'payment-service', 'common-lib'].filter(r => r.includes(name)).map(slug => ({ slug, name: slug, project: { key: 'SHOP' } })) });
    }
    if (p === '/rest/api/1.0/dashboard/pull-requests') return j({ values: [PR, { ...PR, id: 41, title: 'Order history migration', reviewers: [{ user: { displayName: 'You' }, status: 'UNAPPROVED' }], toRef: { displayId: 'main', repository: { slug: 'order-service', project: { key: 'SHOP' } } }, updatedDate: now - 864e5 }] });
    if (p === '/rest/api/1.0/projects/SHOP/repos/payment-service/pull-requests/42') return j(PR);
    if (p === '/rest/api/1.0/projects/SHOP/repos/payment-service/pull-requests/42/diff') return j(PR_DIFF);
    if (p === '/rest/api/1.0/projects/SHOP/repos/payment-service/pull-requests/42/activities') return j(PR_ACTS);
    // A tiny back office UI (browser site "shop"): pages call the order and payment APIs, as a real UI would
    if (p === '/shop' || p === '/shop/login') return html(res, `<h1>Back office</h1><form onsubmit="location='/shop/orders/1042';return false"><input name=user placeholder=user><input name=password type=password placeholder=password><button>Sign in</button></form>`);
    if ((m = p.match(/^\/shop\/orders\/(\d+)$/))) return html(res, `<h1>Order ${m[1]}</h1><pre id=o>loading</pre><pre id=p></pre><script>
      fetch('/api/orders/${m[1]}?expand=items').then(r => r.json()).then(o => { document.getElementById('o').textContent = JSON.stringify(o, null, 2); return fetch('/api/payments/${m[1]}'); })
        .then(r => r.json()).then(x => { document.getElementById('p').textContent = 'payment: ' + x.status; });
      fetch('/api/customers/7/tickets?status=open');</script>`);
    if (p === '/shop/customers') return html(res, `<h1>Customers</h1><ul id=c></ul><script>fetch('/api/customers?page=1&size=20').then(r => r.json()).then(cs => { document.getElementById('c').innerHTML = cs.map(c => '<li>' + c.name).join(''); });</script>`);
    if ((m = p.match(/^\/api\/orders\/(\d+)$/))) return j({ id: Number(m[1]), status: 'paid', total: 129.9, items: [{ sku: 'KB-01', qty: 1 }] });
    if ((m = p.match(/^\/api\/payments\/(\d+)$/))) return j({ orderId: Number(m[1]), status: 'captured' });
    // partner import API: announces an uploaded folder (the files example)
    if (p === '/partner/api/imports' && req.method === 'POST') { let b = {}; try { b = JSON.parse(body); } catch {} res.statusCode = 202; return j({ accepted: true, importId: `imp-${Date.now().toString(36)}`, folder: b.folder || null, files: b.files || [] }); }
    if (p === '/api/customers') return j([{ id: 7, name: 'Ada Shop' }, { id: 8, name: 'Bo Store' }]);
    if (/^\/api\/customers\/\d+\/tickets$/.test(p)) return j([]);
    if (p.startsWith('/scm/')) {
      const rest = p.replace(/^\/scm\/[^/]+/, '');
      const cgi = spawn(GIT_BACKEND, [], { env: { GIT_PROJECT_ROOT: path.join(GIT, 'bare'), GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: rest, REQUEST_METHOD: req.method, QUERY_STRING: u.search.slice(1), CONTENT_TYPE: req.headers['content-type'] || '', REMOTE_ADDR: '127.0.0.1', GIT_PROTOCOL: req.headers['git-protocol'] || '' } });
      let out = Buffer.alloc(0), headDone = false;
      cgi.stdout.on('data', (d) => {
        if (headDone) return res.write(d);
        out = Buffer.concat([out, d]);
        const i = out.indexOf('\r\n\r\n');
        if (i < 0) return;
        headDone = true;
        for (const line of out.slice(0, i).toString().split('\r\n')) {
          const [k, ...v] = line.split(':');
          if (k.toLowerCase() === 'status') res.statusCode = parseInt(v.join(':')); else res.setHeader(k, v.join(':').trim());
        }
        res.write(out.slice(i + 4));
      });
      cgi.on('close', () => res.end());
      cgi.stdin.end(raw);
      return;
    }
    res.statusCode = 404; res.end('not in the demo');
  });
}).listen(PORT, '0.0.0.0', () => console.error(`demo mock on :${PORT} (git repos in ${GIT})`));

process.on('SIGTERM', () => { fs.rmSync(GIT, { recursive: true, force: true }); process.exit(0); });
process.on('SIGINT', () => { fs.rmSync(GIT, { recursive: true, force: true }); process.exit(0); });
