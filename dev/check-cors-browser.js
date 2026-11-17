// Real Chromium CORS checks from a distinct origin and an opaque sandbox.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
async function run() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-cors-browser-'));
  for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_TOOLS', 'DT_SECURITY_PROFILE', 'DT_PUBLIC_URL']) delete process.env[key];
  Object.assign(process.env, { DT_HOME: home, DT_NO_DOCTOR: '1', DT_LOG: 'quiet', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy' });
  const token = 'cors-browser-fixture-0123456789';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, scripts: { starters: false }, server: { securityProfile: 'team', publicUrl: 'https://tools.internal', accessTokens: [{ id: 'admin', role: 'admin', token }] } }));
  const server = require('../server').start({ port: 0 }); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port, client = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Cross-origin tool client fixture</title>'); });
  await new Promise(r => client.listen(0, '127.0.0.1', r));
  const browser = await require('playwright').chromium.launch({ headless: true }), page = await browser.newPage(), checks = [];
  try {
    await page.goto('http://127.0.0.1:' + client.address().port);
    const result = await page.evaluate(async ({ base, token }) => {
      const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-dt-story': 'browser-cors', 'x-custom-client': 'future-header', traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01' };
      const call = async (route, args, extra = {}) => {
        const response = await fetch(base + route, { method: 'POST', credentials: 'include', headers: { ...headers, ...extra }, body: JSON.stringify(args) });
        return { status: response.status, body: await response.json(), session: response.headers.get('mcp-session-id'), location: response.headers.get('location'), disposition: response.headers.get('content-disposition'), context: response.headers.get('x-dt-context') };
      };
      const imported = await call('/oapi/api_exchange_import', { data: { request: { method: 'GET', url: 'http://orders.internal/orders/42' }, response: { status: 200, body: { id: 42 } } } });
      const listed = await call('/oapi/api_exchange_list', { q: 'orders' });
      const api = await call('/api/tool/api_exchange_list', {});
      const mcp = await call('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      const denied = await call('/api/tool/api_exchange_list', {}, { authorization: 'Bearer wrong' });
      const invalid = await call('/api/tool/api_exchange_get', {});
      const missing = await fetch(base + '/missing', { credentials: 'include' });
      const stream = await fetch(base + '/api/ui-events?channel=cors:browser', { credentials: 'include', headers });
      const reader = stream.body.getReader(), first = await reader.read(); await reader.cancel();
      return { imported, listed, api, mcp, denied, invalid, missing: { status: missing.status, body: await missing.json() }, stream: { status: stream.status, first: new TextDecoder().decode(first.value) } };
    }, { base, token });
    assert.equal(result.listed.status, 200); assert.equal(result.listed.body.exchanges.length, 1); assert.equal(result.api.body.result.exchanges.length, 1); checks.push('Chromium completes real credentialed CORS preflights and api_exchange_list on both transports from another origin');
    assert.equal(result.imported.disposition, 'inline'); assert.match(result.imported.location, /embed=1/); assert.ok(result.imported.context); checks.push('Open WebUI can read embed Location, Content-Disposition and context response headers');
    assert.equal(result.mcp.status, 200); assert.ok(result.mcp.session); checks.push('MCP session response headers are readable cross-origin');
    assert.equal(result.denied.status, 403); assert.match(result.denied.body.error, /token|Authentication/); assert.equal(result.invalid.status, 400); assert.equal(result.missing.status, 404); checks.push('Authentication, validation and unknown-route errors are readable JSON rather than opaque CORS failures');
    assert.equal(result.stream.status, 200); assert.match(result.stream.first, /event: ready/); checks.push('Authenticated SSE can be read and cancelled from another origin');
    const opaque = await page.evaluate(({ base, token }) => new Promise(resolve => {
      window.addEventListener('message', function received(event) { if (event.data?.fixture !== 'opaque-cors') return; window.removeEventListener('message', received); resolve({ origin: event.origin, ...event.data }); });
      const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts';
      frame.srcdoc = '<script>fetch(' + JSON.stringify(base + '/api/tool/api_exchange_list') + ',{method:"POST",credentials:"include",headers:{authorization:' + JSON.stringify('Bearer ' + token) + ',"content-type":"application/json","x-dt-story":"browser-cors"},body:"{}"}).then(async r=>parent.postMessage({fixture:"opaque-cors",status:r.status,body:await r.json()},"*")).catch(e=>parent.postMessage({fixture:"opaque-cors",error:e.message},"*"))<\/script>';
      document.body.append(frame);
    }), { base, token });
    assert.equal(opaque.origin, 'null'); assert.equal(opaque.status, 200); assert.equal(opaque.body.result.exchanges.length, 1); checks.push('Sandboxed opaque-origin iframe can call the authenticated tool using credentials mode include');
    return { checks, browser: 'Chromium with standard browser CORS enforcement', crossOrigin: true, opaqueOrigin: true, credentials: true, productionCalls: 0 };
  } finally { await browser.close(); client.closeAllConnections(); await new Promise(r => client.close(r)); server.closeAllConnections(); await new Promise(r => server.close(r)); await require('../lib/automation-flow').close(); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); }
}
module.exports = { run };
if (require.main === module) run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
