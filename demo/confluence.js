// Read-only, mutable mock shared by the demo and integration tests. No network dependencies.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8X8AAAAASUVORK5CYII=', 'base64');
const DRAWIO = '<mxfile><diagram name="Shop"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="orders" value="order-service" vertex="1" parent="1"/><mxCell id="payments" value="payment-service" vertex="1" parent="1"/><mxCell id="events" value="payment_received" vertex="1" parent="1"/><mxCell id="e1" source="orders" target="payments" value="HTTP" edge="1"/><mxCell id="e2" source="payments" target="events" value="Kafka" edge="1"/></root></mxGraphModel></diagram></mxfile>';
const macro = (kind, source) => `<ac:structured-macro ac:name="${kind}"><ac:plain-text-body><![CDATA[${source}]]></ac:plain-text-body></ac:structured-macro>`;
const PAGE_BODIES = [
  ['Architecture overview', '<h1>Shop architecture</h1><p>order-service calls payment-service. payment-service produces payment_received.</p><ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">architecture.drawio</ac:parameter></ac:structured-macro><ac:image ac:alt="Shop architecture"><ri:attachment ri:filename="architecture.drawio"/></ac:image><p>See <ac:link><ri:page ri:content-title="Refunds"/><ac:plain-text-link-body>Refunds</ac:plain-text-link-body></ac:link>.</p>'],
  ['Order flow', '<h1>Order processing</h1><p>order-service consumes order_created.</p>' + macro('plantuml', '@startuml\nparticipant "order-service" as orders\nparticipant "payment-service" as payments\norders -> payments: POST /api/payments/{orderId}/refund\n@enduml')],
  ['Payments', '<h1>Payments</h1><p>payment-service writes sales.payments. payment-service produces payment_received.</p><table><tr><th>State</th><th>Meaning</th></tr><tr><td>paid</td><td>The payment was captured.</td></tr><tr><td>refunded</td><td>The payment was returned.</td></tr></table>'],
  ['Refunds', '<h1>Refunds</h1><p>Refunds are handled by payment-service through POST /api/payments/{orderId}/refund.</p><h2>Rules</h2><p>Refunds over 500 EUR need a manual approval. Refunding an already refunded payment is a no-op.</p><table><tr><th>Limit</th><th>Value</th></tr><tr><td>Manual approval</td><td>500 EUR</td></tr><tr><td>Repeated refund</td><td>Idempotent</td></tr></table><h2>Dependencies</h2><p>payment-service calls fraud-service over HTTP.</p>' + macro('mermaid', 'sequenceDiagram\nparticipant payment as payment-service\nparticipant db as sales.payments\npayment->>db: update status to refunded') + '<ac:image ac:alt="Refund approval screenshot"><ri:attachment ri:filename="approval.png"/><ac:caption><p>Manual approval for refunds above 500 EUR.</p></ac:caption></ac:image><p>See <ac:link><ri:page ri:content-title="Payments"/></ac:link>.</p>'],
  ['Payment runbook', '<h1>Refund incident runbook</h1><p>Inspect payment-service logs by orderId, then inspect sales.payments before retrying a refund.</p><ul><li>Verify the payment status.</li><li>Check payment_received consumer lag.</li></ul>'],
  ['ADR 007: Refund idempotency', '<h1>Refund idempotency</h1><p>Refunds must not charge or return money twice. We use the existing payment state as an idempotency guard.</p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">SHOP-107</ac:parameter></ac:structured-macro>'],
  ['Error codes', '<h1>Refund error codes</h1><table><tr><th>Code</th><th>Meaning</th></tr><tr><td>PAYMENT_NOT_FOUND</td><td>The order has no captured payment.</td></tr><tr><td>APPROVAL_REQUIRED</td><td>A refund over 500 EUR awaits approval.</td></tr></table>'],
  ['Kafka events', '<h1>Events</h1><p>payment-service produces payment_received. notification-service consumes payment_received.</p>'],
  ['Database ownership', '<h1>Persistence</h1><p>order-service owns sales.orders. payment-service owns sales.payments.</p>'],
  ['Legacy refunds', '<h1>Legacy refunds</h1><p>Archived refund notes: the former approval threshold was 250 EUR. Use the Refunds page for current rules.</p>'],
];

function createMock({ pageSize = 3 } = {}) {
  const pages = new Map(PAGE_BODIES.map(([title, body], i) => [String(810 + i), { id: String(810 + i), title, body, space: 'SHOP', version: i === 9 ? 2 : 1, modified: '2026-10-28T00:00:00.000Z', labels: ['shop', /refund/i.test(title) ? 'refunds' : 'architecture'], attachments: i === 0 ? [{ id: 'a1', title: 'architecture.drawio', version: 1, mediaType: 'application/xml', data: Buffer.from(DRAWIO) }] : i === 3 ? [{ id: 'a2', title: 'approval.png', version: 1, mediaType: 'image/png', data: PNG }] : [] }]));
  const requests = [];
  function handle(req, res) {
    const u = new URL(req.url, 'http://mock'), p = u.pathname;
    if (!/^\/(?:rest\/api\/content|api\/v2\/|download\/attachments\/)/.test(p)) return false;
    requests.push({ path: p, query: Object.fromEntries(u.searchParams), authorization: req.headers.authorization });
    const send = (o, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return true; };
    const paged = (items) => {
      const start = Number(u.searchParams.get('start') || u.searchParams.get('cursor') || 0), selected = items.slice(start, start + pageSize), next = new URL(u.href);
      next.searchParams.set(p.startsWith('/api/v2') ? 'cursor' : 'start', String(start + selected.length));
      return send({ results: selected, start, size: selected.length, limit: pageSize, _links: start + selected.length < items.length ? { next: next.pathname + next.search } : {} });
    };
    const pageSummary = (v) => ({ id: v.id, title: v.title, status: 'current', space: { key: v.space }, spaceId: v.space === 'SHOP' ? '1' : '2', version: { number: v.version, when: v.modified, createdAt: v.modified } });
    const attachment = (a) => ({ id: a.id, title: a.title, version: { number: a.version }, mediaType: a.mediaType, metadata: { mediaType: a.mediaType }, fileSize: a.data.length, _links: { download: `/download/attachments/${a.id}/${encodeURIComponent(a.title)}` }, downloadLink: `/download/attachments/${a.id}/${encodeURIComponent(a.title)}` });
    if (p === '/api/v2/spaces') return paged([{ id: '1', key: 'SHOP', name: 'Shop' }, { id: '2', key: 'PAY', name: 'Payments' }].filter(s => !u.searchParams.get('keys') || s.key === u.searchParams.get('keys')));
    if (p === '/rest/api/content' || p === '/rest/api/content/search' || /^\/api\/v2\/spaces\/\w+\/pages$/.test(p)) {
      const space = u.searchParams.get('spaceKey') || u.searchParams.get('cql')?.match(/space = "([^"]+)"/)?.[1] || (p.includes('/spaces/2/') ? 'PAY' : 'SHOP');
      return paged([...pages.values()].filter(v => v.space === space).map(pageSummary));
    }
    let m = p.match(/^\/(?:rest\/api\/content|api\/v2\/pages)\/([\w-]+)(?:\/(child\/attachment|attachments|ancestors|label))?$/);
    if (m) {
      const v = pages.get(m[1]); if (!v) return send({ message: 'not found' }, 404);
      if (v.fail) return send({ message: 'temporary failure' }, 503);
      if (/attachment/.test(m[2] || '')) return paged(v.attachments.map(attachment));
      if (m[2] === 'ancestors') return paged([]);
      if (m[2] === 'label') return paged(v.labels.map(name => ({ name })));
      return send({ ...pageSummary(v), body: { storage: { value: v.body } }, ancestors: [], metadata: { labels: { results: v.labels.map(name => ({ name })) } }, labels: { results: v.labels.map(name => ({ name })) }, _links: { webui: `/pages/viewpage.action?pageId=${v.id}` } });
    }
    m = p.match(/^\/download\/attachments\/([\w-]+)\//);
    if (m) { const a = [...pages.values()].flatMap(v => v.attachments).find(a => a.id === m[1]); if (!a) return send({}, 404); res.setHeader('content-type', a.mediaType); res.end(a.data); return true; }
    return send({ message: 'unsupported mock route' }, 404);
  }
  return { pages, requests, handle };
}

module.exports = { createMock, PAGE_BODIES, DRAWIO, PNG };
