const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-kafka-capture-'));
process.env.DT_HOME = home; process.env.DT_RATE_PER_SEC = '0';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[key];
const requests = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/api/clusters') return res.end('[{"name":"demo","status":"online"}]');
  if (!u.pathname.endsWith('/messages')) return res.end('{"partitions":[{"partition":0,"offsetMin":0,"offsetMax":10},{"partition":1,"offsetMin":0,"offsetMax":1},{"partition":2,"offsetMin":9007199254740992,"offsetMax":9007199254740994}]}');
  const p = Number(u.searchParams.get('partition')), from = BigInt(u.searchParams.get('offset')), limit = Number(u.searchParams.get('limit'));
  requests.push({ partition: p, from: String(from), limit });
  const high = [10n, 1n, 9007199254740994n][p];
  const out = [];
  for (let offset = from; offset < high && out.length < limit; offset++) out.push(`data: {"type":"MESSAGE","message":{"partition":${p},"offset":${offset},"key":"42","content":"{\\"orderId\\":42}"}}`);
  res.setHeader('content-type', 'text/event-stream'); res.end(out.join('\n') + '\n');
});
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { kafkaUi: `http://127.0.0.1:${server.address().port}` } } }));
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); });

test('capture scans every partition including quiet partitions within a total budget', async () => {
  const r = await require('../lib/kafka').captureMessages('dev', 'order_paid', { maxMessages: 6 });
  assert.deepEqual(r.windows.map(w => w.partition), [0, 1, 2]);
  assert.equal(r.messages.length, 5);
  assert.equal(r.windows[1].from, '0');
  assert.equal(r.windows[2].highExclusive, '9007199254740994');
  assert.deepEqual(r.messages.filter(m => m.partition === 2).map(m => m.offset), ['9007199254740992', '9007199254740993']);
  assert.ok(r.truncated);
  assert.ok(requests.some(r => r.partition === 1));
});
test('explicit start offsets still obey bounds and report expired offsets', async () => {
  const r = await require('../lib/kafka').captureMessages('dev', 'order_paid', { maxMessages: 3, offsets: { 0: '9', 1: '0', 2: '0' } });
  assert.equal(r.messages.length, 3);
  assert.equal(r.windows[2].offsetExpired, true);
  assert.equal(r.windows[2].next, '9007199254740993');
  await assert.rejects(() => require('../lib/kafka').captureMessages('dev', 'order_paid', { maxMessages: 0 }), /maxMessages/);
});
