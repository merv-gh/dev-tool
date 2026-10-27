// Real HTTP server: OpenAPI for Open WebUI (embed headers), MCP, result/dash CORS rules, pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-server-'));
process.env.DT_CONFIG_DIR = tmp; // no local .env files in tests
process.env.DT_CACHE_DIR = tmp;
process.env.DT_PASSPORTS_DIR = path.join(tmp, 'passports');
process.env.DT_PUBLIC_URL = 'http://127.0.0.1:4999';

const server = require('../server').start({ port: 0, host: '127.0.0.1' });
let base;
test.before(() => new Promise(r => server.on('listening', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('openapi lists every tool as an operation', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  const ops = Object.values(spec.paths).map(p => p.post.operationId);
  for (const t of ['find', 'catalog_sync', 'pg_query', 'logs_search', 'logs_trace', 'bitbucket_pr', 'passport', 'who_uses', 'health', 'overview']) assert.ok(ops.includes(t), t);
  assert.equal(spec.paths['/oapi/passport'].post.requestBody.content['application/json'].schema.required[0], 'service');
});

test('oapi: plain results are JSON, table results embed the viewer and give the model context', async () => {
  const plain = await post('/oapi/find', { q: 'x' });
  assert.equal(plain.headers.get('content-disposition'), null);
  assert.match((await plain.json())[0], /catalog_sync/);

  fs.mkdirSync(path.join(process.env.DT_PASSPORTS_DIR, 'svc-a'), { recursive: true });
  const r = await post('/oapi/passports', {});
  assert.equal(r.headers.get('content-disposition'), 'inline');
  assert.match(r.headers.get('location'), /^http:\/\/127\.0\.0\.1:4999\/view\/[a-z0-9]+\?embed=1$/);
  const body = await r.json();
  assert.equal(body[0], 'embed');
  assert.equal(body[1].total, 0);

  const err = await post('/oapi/pg_query', {});
  assert.equal(err.status, 400);
  assert.match((await err.json()).error, /Missing argument: sql/);
});

test('mcp: initialize, tools/list, tools/call, notifications', async () => {
  const init = await (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
  assert.equal(init.result.serverInfo.name, 'dt');
  assert.equal((await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const list = await (await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.ok(list.result.tools.length >= 27);
  const call = await (await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope', arguments: {} } })).json();
  assert.equal(call.result.isError, true);
});

test('result data is CORS-readable by id; dashboard only with a valid token', async () => {
  const view = require('../lib/results').save('pg', [{ a: 1 }], { query: 'q' });
  const id = view.split('/').pop();
  const r = await fetch(`${base}/api/result/${id}`);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual((await r.json()).rows, [{ a: 1 }]);
  assert.equal((await fetch(`${base}/api/results`)).headers.get('access-control-allow-origin'), null);
  const { sign } = require('../lib/results');
  const ok = sign('dash:dev'), bad = 'f'.repeat(32);
  // dashboard data itself needs live systems; only the headers matter here
  const h1 = await fetch(`${base}/api/dash?env=dev&t=${ok}`), h2 = await fetch(`${base}/api/dash?env=dev&t=${bad}`);
  assert.equal(h1.headers.get('access-control-allow-origin'), '*');
  assert.equal(h2.headers.get('access-control-allow-origin'), null);
});

test('pages and static assets are served', async () => {
  for (const p of ['/view/x', '/logs/x', '/pr/x', '/passport/svc', '/dash?env=dev']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
  }
  assert.match((await fetch(`${base}/static/ui.js`)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/static/../server.js`)).status, 404);
});

test('admin: page, status, refresh job, config validation, notes, repo mapping', async () => {
  const page = await fetch(`${base}/admin`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /dt admin/);
  const s = await (await fetch(`${base}/api/admin/status`)).json();
  assert.ok(Array.isArray(s.envs) && Array.isArray(s.jobs) && s.tools.groups.length);
  const job = await (await post('/api/admin/refresh', { what: 'index' })).json();
  assert.ok(job.id);
  let j;
  for (let i = 0; i < 50 && (!j || j.state === 'running'); i++) { j = await (await fetch(`${base}/api/admin/job/${job.id}`)).json(); await new Promise(r => setTimeout(r, 20)); }
  assert.equal(j.state, 'done');
  assert.equal((await post('/api/admin/refresh', { what: 'nope' })).status, 400);

  const bad = await post('/api/admin/config', { text: '{"dev": {"pg": [1]}}' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /pg must be/);
  const good = await (await post('/api/admin/config', { text: '{"dev": {}, "qa": {"pg": "auto"}}' })).json();
  assert.deepEqual(good.envs, ['dev', 'qa']);
  assert.equal((await (await fetch(`${base}/api/admin/config`)).json()).exists, true);
  const openapi = await (await fetch(`${base}/openapi.json`)).json();
  assert.deepEqual(openapi.paths['/oapi/find'].post.requestBody.content['application/json'].schema.properties.env.enum, ['dev', 'qa'], 'tool env enum follows the config');

  assert.deepEqual(await (await post('/api/admin/notes', { name: 'Sales.Orders', note: 'old' })).json(), { name: 'sales.orders', note: 'old' });
  assert.equal((await (await fetch(`${base}/api/admin/notes`)).json())['sales.orders'], 'old');
  assert.deepEqual((await (await post('/api/admin/repos', { service: 'svc-x', repo: 'shop/svc-x' })).json()).repo, { project: 'SHOP', repo: 'svc-x' });
  assert.equal((await post('/api/admin/repos', { service: 'svc-x', repo: 'nope' })).status, 400);
});

test('api key: /admin?key= sets a cookie; pages stay public, data needs trust or a token', async () => {
  process.env.DT_API_KEY = 'k-123';
  try {
    const r = await fetch(`${base}/admin?key=k-123`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('set-cookie'), /dt_key=k-123; HttpOnly/);
    assert.equal((await fetch(`${base}/admin?key=wrong`, { redirect: 'manual' })).status, 200, 'loopback is trusted anyway');
    assert.equal((await fetch(`${base}/passport/x`)).status, 200);
    assert.equal((await fetch(`${base}/api/passport/x?t=${'0'.repeat(32)}`)).status, 404, 'loopback: trusted, no such passport');
  } finally { delete process.env.DT_API_KEY; }
});

test('trusted: loopback, bearer key, dt_key cookie, or DT_TRUST_NETWORK', () => {
  const { trusted } = require('../server');
  const req = (addr, headers = {}) => ({ socket: { remoteAddress: addr }, headers });
  assert.equal(trusted(req('127.0.0.1')), true);
  assert.equal(trusted(req('10.0.0.5')), false);
  process.env.DT_API_KEY = 's3cret';
  try {
    assert.equal(trusted(req('10.0.0.5', { authorization: 'Bearer s3cret' })), true);
    assert.equal(trusted(req('10.0.0.5', { authorization: 'Bearer nope' })), false);
    assert.equal(trusted(req('10.0.0.5', { cookie: 'a=1; dt_key=s3cret' })), true);
  } finally { delete process.env.DT_API_KEY; }
  process.env.DT_TRUST_NETWORK = '1';
  try { assert.equal(trusted(req('10.0.0.5')), true); } finally { delete process.env.DT_TRUST_NETWORK; }
});
