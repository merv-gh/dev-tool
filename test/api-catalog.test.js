const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-api-catalog-'));
for (const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_SECURITY_PROFILE','DT_API_KEY']) delete process.env[key];
Object.assign(process.env, { DT_HOME: home, DT_RATE_PER_SEC: '0', DT_NO_DOCTOR: '1', DT_LOG: 'quiet', DT_STATE_BACKEND: 'legacy' });
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {}, uat: {} }, scripts: { starters: false } }));
const C = require('../lib/config'), A = require('../lib/access'), catalog = require('../lib/api-catalog').catalog;
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
const instances = [{ id: 'orders-b', address: '10.2.0.2', port: 8080, status: 'critical' }, { id: 'orders-a', address: '10.2.0.1', port: 8443, status: 'passing', meta: { scheme: 'https' } }];
write(path.join(C.PATHS.passports, 'orders', 'passport.json'), { service: 'orders', effective: { endpoints: Array.from({ length: 263 }, (_, i) => ({ method: 'GET', path: '/orders/' + i, handler: 'Orders.get' + i })) } });
write(path.join(C.PATHS.cache, 'dev', 'consul.json'), { syncedAt: '2026-01-02T00:00:00Z', services: { orders: { instances }, worker: { instances: [], stale: true } } });
write(path.join(C.PATHS.cache, 'uat', 'consul.json'), { services: { orders: { instances: [{ address: '::1', port: 9000, status: 'passing' }] } } });
test.after(async () => { await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('offline catalog includes services without routes, exact replica evidence and complete paginated routes', () => {
  const root = catalog({ env: 'dev' });
  assert.equal(root.services.find(s => s.service === 'orders').routeCount, 263);
  assert.equal(root.services.find(s => s.service === 'worker').stale, true);
  assert.deepEqual(root.services.find(s => s.service === 'orders').targets.map(t => t.url), ['https://10.2.0.1:8443','http://10.2.0.2:8080']);
  assert.equal(root.routes.length, 0);
  const found = [];
  for (let offset = 0; offset !== null;) { const page = catalog({ env: 'dev', group: 'service:orders', offset, limit: 100 }); found.push(...page.routes); offset = page.nextOffset; }
  assert.equal(found.length, 263); assert.equal(new Set(found.map(r => r.path)).size, 263);
  assert.equal(catalog({ env: 'dev', group: 'service:orders', q: 'get262' }).routes[0].path, '/orders/262');
  assert.equal(catalog({ env: 'dev', group: 'missing' }).total, 0);
});

test('environment targets remain separate, restricted users see only allowed environments, and IPv6 is usable', () => {
  assert.equal(catalog({ env: 'uat' }).services.find(s => s.service === 'orders').targets[0].url, 'http://[::1]:9000');
  A.run({ multiUser: true, principalId: 'user', storyId: 'task', envs: ['dev'] }, () => {
    assert.deepEqual(catalog({}).environments, ['dev']); assert.throws(() => catalog({ env: 'uat' }), /Environment is not available/);
  });
  const target = require('../lib/api-catalog').target;
  for (const address of ['user@host','host/path','bad host','host?token=x']) assert.equal(target({ address, port: 80 }), null);
  assert.equal(target({ address: 'host', port: 0 }), null);
});

test('observed HTTPS origins are retained without URL credentials, paths or query secrets', () => {
  write(require('../lib/routes').FILE, { routes: { 'gateway.internal GET /health': { host: 'gateway.internal', method: 'GET', path: '/health', count: 1, statuses: {200:1}, query: [], sources: ['fixture'], example: 'https://user:secret@gateway.internal/health?token=secret' } } });
  const result = catalog({ env: 'dev', group: 'host:gateway.internal' });
  assert.equal(result.services.find(s => s.key === 'host:gateway.internal').targets[0].url, 'https://gateway.internal');
  assert.equal(result.routes[0].origin, 'https://gateway.internal'); assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('replica observations merge without losing the declared path or its parameter names', () => {
  write(path.join(C.PATHS.passports, 'billing', 'passport.json'), { service: 'billing', effective: { endpoints: [{ method: 'GET', path: '/invoices/{invoiceId}', handler: 'Invoices.get' }] } });
  const routes = {};
  for (const host of ['replica-a.internal', 'replica-b.internal']) routes[`${host} GET /invoices/<id>`] = { host, method: 'GET', path: '/invoices/<id>', count: 1, statuses: {200:1}, query: [], sources: ['fixture'], example: `https://${host}/invoices/42` };
  write(require('../lib/routes').FILE, { routes });
  const result = catalog({ env: 'dev', group: 'service:billing' });
  assert.equal(result.routes.length, 2);
  assert.ok(result.routes.some(r => r.path === '/invoices/{invoiceId}'));
  const observed = result.routes.find(r => r.path === '/invoices/<id>');
  assert.equal(observed.origins.length, 2); assert.equal(observed.seen, 2);
});

test('cancelled replay aborts the actual backend fetch instead of leaving a slow request running', async () => {
  let began, closed; const started = new Promise(r => began = r), disconnected = new Promise(r => closed = r);
  const api = http.createServer((req, res) => { began(); req.on('close', closed); });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + api.address().port;
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'))); config.scripts.http = { allow: [origin] }; write(path.join(home, 'config.json'), config); C.reload();
  const controller = new AbortController(), E = require('../lib/execution');
  try {
    const promise = E.run({ kind: 'tool', tool: 'api_request_replay', signal: controller.signal }, () => require('../lib/api-client').replay({ request: { method: 'GET', url: origin + '/slow', body: { kind: 'none' } } }));
    await started; controller.abort('Operator cancelled'); await assert.rejects(promise, /cancel|abort/i);
    await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(Error('Backend request did not disconnect')), 1500).unref())]);
  } finally { api.closeAllConnections(); await new Promise(r => api.close(r)); }
});
