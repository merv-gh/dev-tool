// A scripted OpenAI-compatible "model" for demos: a question picks a scenario (tool calls in order),
// then a canned answer that quotes the tool result. Lets Open WebUI show real tool calls and embeds
// without an LLM.   node demo/mock-llm.js [port]
const http = require('http');

const PORT = Number(process.argv[2] || 4910);
const text = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const results = (msgs) => msgs.filter(m => m.role === 'tool').map(m => { try { return JSON.parse(text(m)); } catch { return text(m); } });
const ctx = (r) => (Array.isArray(r) && r[0] === 'embed' ? r[1] : r); // OpenAPI embeds: ["embed", context]

const SCENARIOS = [
  {
    match: /(compute|calculate|average|per status)/i,
    steps: [{ tool: 'code', args: { title: 'Average order total per status', code: [
      "const r = await tools.pg_query({ env: 'demo', sql: 'select status, total from sales.orders', all: true });",
      'const by = {};',
      'for (const o of r.rows) (by[o.status] ||= []).push(Number(o.total));',
      'const rows = Object.entries(by).map(([status, xs]) => ({ status, orders: xs.length, avg: xs.reduce((a, b) => a + b, 0) / xs.length }))',
      '  .sort((a, b) => b.avg - a.avg);',
      "for (const x of rows) text(x.status.padEnd(15), String(x.orders).padStart(4), x.avg.toFixed(2));",
      "return { highest: rows[0].status, lowest: rows.at(-1).status };",
    ].join('\n') } }],
    answer: (rs) => {
      const r = ctx(rs[0]) || {};
      const lines = String(r.output || '').split('\n').filter(Boolean);
      return `Computed from all ${lines.reduce((n, l) => n + Number(l.trim().split(/\s+/)[1] || 0), 0)} orders in one \`code\` call (one query, the rest in JavaScript):\n\n` +
        lines.map(l => { const [s, n, avg] = l.trim().split(/\s+/); return `- **${s}**: ${n} orders, average **${avg}**`; }).join('\n') +
        `\n\nHighest average: **${(r.returned || {}).highest}**, lowest: **${(r.returned || {}).lowest}**. The spread is small, so status does not drive order size here.`;
    },
  },
  {
    match: /settlement|reconcil|shipped orders/i,
    steps: [{ tool: 'reconcile', args: { script: 'shipped settlement', params: { month: '2026/10' } } }],
    answer: (rs) => {
      const r = ctx(rs[0]) || {};
      const d = (r.results || {}).diff || {};
      const c = d.counts || {};
      return `Compared the **${c.first} shipped orders** in the database with the **${c.last} lines** of the partner's settlement report for 2026/10 (\`reports/2026/10/settlement-orders.csv\` on SFTP):\n\n` +
        `- **${c.onlyFirst} shipped but not settled:** ${(d.onlyFirst || []).join(', ')}. Ask the partner about these.\n` +
        `- **${c.onlyLast} settled but unknown to us:** ${(d.onlyLast || []).join(', ')}. Those ids do not exist as shipped orders.\n` +
        `- ${c.duplicatesLast} id is listed twice in the report; ${c.common} match.\n\nThe three columns above show them all.`;
    },
  },
  {
    match: /(browse|look at|what.s on).*(sftp|partner)/i,
    steps: [{ tool: 'files_browse', args: { store: 'partner' } }],
    answer: (rs) => { const r = ctx(rs[0]) || {}; return `The partner SFTP has **${r.folders} folders and ${r.files} files**: monthly settlement reports under \`reports/\`, the orders the partner sent under \`partner/inbox\`, processed batches in \`partner/archive\`. Click a file above to preview it.`; },
  },
  {
    match: /(show|open).*(order|file).*(inbox|1042)/i,
    steps: [
      { tool: 'files_search', args: { store: 'partner', pattern: 'order-1042*' } },
      { tool: 'files_show', args: (rs) => ({ store: 'partner', path: (((ctx(rs[0]) || {}).rows || [])[0] || {}).path || 'partner/inbox/order-1042.xml' }) },
    ],
    answer: (rs) => { const r = ctx(rs[1]) || {}; return `Here is \`${r.path}\` (${r.size} bytes), the order **ORD-1042** the partner sent: customer C-77 (Ada Shop), two items (KB-01 ×1, MS-02 ×2), express delivery to Berlin. The XML is pretty-printed above; the folder is on the left.`; },
  },
  {
    match: /who (writes|uses|touches).*orders|sales\.orders/i,
    steps: [{ tool: 'find', args: { env: 'demo', q: 'pg: sales.orders' } }, { tool: 'pg_usage', args: { env: 'demo', name: 'sales.orders' } }],
    answer: (rs) => {
      const u = ctx(rs[1]) || {};
      const s = u.summary || {};
      return `**sales.orders** (db \`orders\`) has ${u.total} users:\n\n` +
        `- **order-service** writes it (\`OrderDao.java:10\`, update of status) and reads it; it also owns it (migration \`V1__init.sql\`) and maps it as JPA entity \`Order\`.\n` +
        `- In the database: the trigger function \`sales.audit_status\` fires on updates, the procedure \`sales.close_order\` writes it, and \`sales.open_orders\` / \`sales.daily_revenue\` select from it.\n` +
        `- \`sales.order_items\` and \`sales.payments\` reference it by foreign key.\n\n` +
        `Counts by kind: ${Object.entries(s).map(([k, n]) => `${k} ${n}`).join(', ')}. The full list is in the table above.`;
    },
  },
  {
    match: /how is|overview|anything broken/i,
    steps: [{ tool: 'overview', args: { env: 'demo' } }],
    answer: (rs) => {
      const o = ctx(rs[0]) || {};
      return `Not all fine in **demo**:\n\n- **inventory-service is down** on both instances: its health check reports the database as DOWN.\n- payment-service is degraded (slow responses, p99 2.4s).\n` +
        `- Elasticsearch is **yellow** (one unassigned shard on \`customers\`).\n- Kafka: \`notification-service\` is 18,240 messages behind; inventory-service's group is rebalancing.\n\nThe live dashboard above refreshes every 30s.${o.services ? '' : ''}`;
    },
  },
  {
    match: /error|exception|log/i,
    steps: [{ tool: 'logs_search', args: { env: 'demo', level: 'ERROR', from: '1h', size: 12 } }],
    answer: (rs) => {
      const r = ctx(rs[0]) || {};
      return `${r.total} errors in the last hour, in two groups:\n\n1. **inventory-service**: \`Connection to db-inventory:5432 refused (pool exhausted, 20/20 in use)\`. That matches its failing health check.\n2. **payment-service**: \`IllegalStateException: card expired\` at \`Charger.java:88\`. These are declined payments, not an outage.\n\nThe errors started about 20 minutes ago (see the timeline above). Follow one request with logs_trace, e.g. trace \`tr-51842\`.`;
    },
  },
];

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c).on('end', () => {
    const j = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url.endsWith('/models')) return j({ data: [{ id: 'demo-model', object: 'model', owned_by: 'demo' }] });
    const b = JSON.parse(body || '{}');
    const msgs = b.messages || [];
    const user = [...msgs].reverse().find(m => m.role === 'user');
    const tools = (b.tools || []).map(t => t.function.name);
    const s = user && SCENARIOS.find(x => x.match.test(text(user)));
    const done = user ? msgs.slice(msgs.indexOf(user)).filter(m => m.role === 'tool').length : 0;
    const step = s && s.steps[done];
    const fn = step && tools.find(t => t === step.tool || t.endsWith(`_${step.tool}`));
    const args = step && (typeof step.args === 'function' ? step.args(results(msgs.slice(msgs.indexOf(user)))) : step.args);
    const chunk = (delta, finish) => res.write('data: ' + JSON.stringify({ id: 'demo', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: b.model, choices: [{ index: 0, delta, finish_reason: finish || null }] }) + '\n\n');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (fn) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${done}`, type: 'function', function: { name: fn, arguments: JSON.stringify(args) } }] });
      chunk({}, 'tool_calls');
    } else {
      const answer = s ? s.answer(results(msgs.slice(msgs.indexOf(user)))) : 'Ask "who writes sales.orders?", "how is demo doing?", "any errors in the last hour?", "compare shipped orders with the settlement report", "browse the partner sftp" or "show me the order file from the inbox"';
      for (const part of answer.match(/[\s\S]{1,40}/g)) chunk({ role: 'assistant', content: part });
      chunk({}, 'stop');
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(PORT, '0.0.0.0', () => console.error(`demo llm on :${PORT}`));
