const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-cors-'));
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_TOOLS', 'DT_SECURITY_PROFILE', 'DT_API_KEY', 'DT_TRUST_NETWORK', 'DT_PUBLIC_URL']) delete process.env[key];
Object.assign(process.env, { DT_HOME: home, DT_NO_DOCTOR: '1', DT_LOG: 'quiet', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy' });
const token = 'cors-fixture-admin-0123456789', reader = 'cors-fixture-reader-0123456789';
const config = { envs: { dev: {} }, scripts: { starters: false }, server: { securityProfile: 'team', publicUrl: 'https://tools.internal', accessTokens: [{ id: 'admin', role: 'admin', token }, { id: 'reader', tools: ['find'], token: reader }] } };
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
const C = require('../lib/config'); let server, base;
const save = () => { fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config)); C.reload(); };
const origin = 'https://openwebui.internal:8443';
const headers = (extra = {}) => ({ origin, authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-dt-story': 'cors-case', ...extra });
const post = (url, args, extra) => fetch(base + url, { method: 'POST', headers: headers(extra), body: JSON.stringify(args) });
const list = value => (value || '').toLowerCase().split(',').map(v => v.trim());
function readable(response, from = origin) {
  assert.equal(response.headers.get('access-control-allow-origin'), from);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.ok(list(response.headers.get('vary')).includes('origin'));
}
test.before(async () => { server = require('../server').start({ port: 0 }); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await require('../lib/automation-flow').close(); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('tool/OpenAPI/MCP preflight accepts any origin and requested auth/context headers without credentials', async () => {
  for (const url of ['/oapi/api_exchange_list', '/api/tool/api_exchange_list', '/mcp', '/model/v1/chat/completions', '/api/ui-events', '/api/admin/config']) {
    const response = await fetch(base + url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, x-dt-story, x-openwebui-chat-id, mcp-session-id, traceparent, baggage, x-future-client-header' } });
    assert.equal(response.status, 204, url); readable(response);
    assert.ok(list(response.headers.get('access-control-allow-methods')).includes('post'));
    const allowed = list(response.headers.get('access-control-allow-headers'));
    for (const name of ['authorization', 'content-type', 'x-dt-story', 'x-openwebui-chat-id', 'mcp-session-id', 'traceparent', 'baggage', 'x-future-client-header']) assert.ok(allowed.includes(name), name);
    assert.equal(await response.text(), '');
  }
});

test('api_exchange_list works through both HTTP transports and retains story isolation', async () => {
  const imported = await post('/api/tool/api_exchange_import', { data: { request: { method: 'GET', url: 'http://orders.dev.internal/orders/42' }, response: { status: 200, body: { id: 42 } } } });
  assert.equal(imported.status, 200); readable(imported);
  for (const endpoint of ['/oapi/api_exchange_list', '/api/tool/api_exchange_list']) {
    const response = await post(endpoint, { q: 'orders' }); assert.equal(response.status, 200); readable(response);
    const body = await response.json(), result = body.result || body; assert.equal(result.exchanges.length, 1);
    assert.equal(result.exchanges[0].status, 200);
    const other = await post(endpoint, { q: 'orders' }, { 'x-dt-story': 'other-case' });
    const empty = await other.json(); assert.equal((empty.result || empty).exchanges.length, 0);
  }
});

test('errors, redirects, downloads, static assets and MCP session headers remain CORS readable', async () => {
  for (const [url, options, status] of [
    ['/api/tool/api_exchange_list', { method: 'POST', headers: headers({ authorization: 'Bearer incorrect' }), body: '{}' }, 403],
    ['/api/tool/api_exchange_list', { method: 'POST', headers: headers({ authorization: 'Bearer ' + reader }), body: '{}' }, 403],
    ['/api/tool/api_exchange_get', { method: 'POST', headers: headers(), body: '{}' }, 400],
    ['/not-a-route', { headers: { origin } }, 404],
    ['/static/ui.js', { headers: { origin } }, 200],
    ['/openapi.json', { headers: headers() }, 200],
  ]) { const response = await fetch(base + url, options); assert.equal(response.status, status, url); readable(response); }
  const imported = await (await post('/oapi/api_exchange_import', { data: { request: { method: 'GET', url: 'http://orders.dev.internal/other' }, response: { status: 200 } } })).json();
  assert.equal(imported[0], 'embed');
  const session = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  readable(session); assert.ok(session.headers.get('mcp-session-id'));
  const exposed = list(session.headers.get('access-control-expose-headers'));
  for (const name of ['mcp-session-id', 'location', 'content-disposition', 'x-dt-context', 'retry-after', 'x-dt-map-focus']) assert.ok(exposed.includes(name), name);
  const login = await fetch(base + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), redirect: 'manual' });
  assert.equal(login.status, 303); readable(login);
});

test('opaque sandbox origins and credentialed requests use explicit origin reflection', async () => {
  const response = await post('/api/tool/api_exchange_list', {}, { origin: 'null' }); readable(response, 'null'); assert.equal(response.status, 200);
  const cookie = await fetch(base + '/api/tool/api_exchange_list', { method: 'POST', headers: { origin, cookie: 'dt_key=' + token, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(cookie.status, 200); readable(cookie);
  const noOrigin = await fetch(base + '/health'); assert.equal(noOrigin.headers.get('access-control-allow-origin'), '*');
});

test('explicit origin lists restrict both profiles; empty and wildcard settings restore open defaults', async () => {
  try {
    for (const profile of ['team', 'local']) {
      config.server.securityProfile = profile; config.server.allowedOrigins = [origin]; save();
      const allowed = await post('/api/tool/api_exchange_list', {}); assert.equal(allowed.status, 200); readable(allowed);
      const denied = await post('/api/tool/api_exchange_list', {}, { origin: 'https://other.internal' }); assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
      const preflight = await fetch(base + '/mcp', { method: 'OPTIONS', headers: { origin: 'https://other.internal', 'access-control-request-method': 'POST' } }); assert.equal(preflight.status, 403);
      const own = await post('/api/tool/api_exchange_list', {}, { origin: config.server.publicUrl }); assert.equal(own.status, 200); readable(own, config.server.publicUrl);
    }
    for (const policy of [[], ['*']]) {
      config.server.allowedOrigins = policy; save();
      const response = await post('/api/tool/api_exchange_list', {}, { origin: 'https://any.internal' }); assert.equal(response.status, 200); readable(response, 'https://any.internal');
    }
  } finally { config.server.securityProfile = 'team'; delete config.server.allowedOrigins; save(); }
});

test('SSE responses share the global CORS policy and legacy private-network preflight is acknowledged', async () => {
  const response = await fetch(base + '/api/ui-events?channel=cors:events', { headers: headers() });
  try { assert.equal(response.status, 200); readable(response); assert.match(response.headers.get('content-type'), /text\/event-stream/); }
  finally { await response.body.cancel(); }
  const preflight = await fetch(base + '/api/tool/api_exchange_list', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
});

test('preflight header syntax fails readably while custom HTTP methods and ordinary OPTIONS work', async () => {
  const malformed = await fetch(base + '/mcp', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, not a header' } });
  assert.equal(malformed.status, 400); readable(malformed); assert.equal((await malformed.json()).code, 'DT_ARGUMENT_INVALID');
  const custom = await fetch(base + '/unknown', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PROPFIND' } });
  assert.equal(custom.status, 204); assert.ok(list(custom.headers.get('access-control-allow-methods')).includes('propfind'));
  const plain = await fetch(base + '/health', { method: 'OPTIONS' }); assert.equal(plain.status, 204); assert.equal(plain.headers.get('access-control-allow-origin'), '*');
});
