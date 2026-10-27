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
    const chunk = (delta, finish) => res.write('data: ' + JSON.stringify({ id: 'demo', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: b.model, choices: [{ index: 0, delta, finish_reason: finish || null }] }) + '\n\n');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (fn) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${done}`, type: 'function', function: { name: fn, arguments: JSON.stringify(step.args) } }] });
      chunk({}, 'tool_calls');
    } else {
      const answer = s ? s.answer(results(msgs.slice(msgs.indexOf(user)))) : 'Ask "who writes sales.orders?", "how is demo doing?" or "any errors in the last hour?"';
      for (const part of answer.match(/[\s\S]{1,40}/g)) chunk({ role: 'assistant', content: part });
      chunk({}, 'stop');
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(PORT, '0.0.0.0', () => console.error(`demo llm on :${PORT}`));
