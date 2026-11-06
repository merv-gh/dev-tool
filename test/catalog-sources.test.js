// Exercise real source transports, admission, refresh publication and searches
// against disposable HTTP fixtures. No production infrastructure is contacted.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-catalog-sources-'));
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_SECURITY_PROFILE']) delete process.env[key];
Object.assign(process.env, { DT_HOME: home, DT_NO_DOCTOR: '1', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy', DT_LOG: 'quiet' });

test('HTTP source refresh publishes a consistent mixed catalog and preserves its preceding generation', async t => {
  let docs = 3, base;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'), route = url.pathname;
    requests.push(route);
    let result;
    if (route === '/_cat/indices') result = [{ index: 'orders-v2', 'docs.count': String(docs), 'store.size': '1kb', health: 'green' }, { index: '.system' }];
    else if (route === '/_cat/aliases') result = [{ index: 'orders-v2', alias: 'orders' }];
    else if (route === '/_mapping') result = { 'orders-v2': { mappings: { properties: { customer: { properties: { region: { type: 'keyword' } } }, untyped: {} } } } };
    else if (route === '/_settings') result = { 'orders-v2': { settings: { index: { analysis: { analyzer: {} }, number_of_replicas: '1' } } } };
    else if (route === '/') result = { version: { number: '8.0-fixture' } };
    else if (route === '/_msearch') {
      let body = ''; for await (const chunk of req) body += chunk;
      assert.match(body, /"index":"orders-v2"/);
      result = { responses: [{ hits: { hits: [{ _id: '42', _source: { customer: { region: 'eu' } } }] } }] };
    } else if (route === '/orders-v2/_search') result = { hits: { total: { value: 1 }, hits: [{ _index: 'orders-v2', _id: '42', _source: { customer: { region: 'eu' } } }] } };
    else if (route === '/v1/catalog/services') result = { checkout: ['java'], 'checkout-worker': ['java'] };
    else if (route.startsWith('/v1/health/service/')) result = [
      { Node: { Address: '127.0.0.1', Node: 'fixture', Datacenter: 'dev' }, Service: { ID: 'one', Port: new URL(base).port, Tags: [], Meta: {} }, Checks: [{ Status: 'passing' }] },
      { Node: { Address: '127.0.0.1', Node: 'fixture', Datacenter: 'dev' }, Service: { ID: 'two', Address: '127.0.0.1', Port: 1 }, Checks: [{ Status: 'warning' }] }
    ];
    else if (route === '/version') { res.end('fixture-v1'); return; }
    else { res.writeHead(404); res.end('{}'); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { elasticsearch: { hosts: [base] }, consul: base }, legacy: {} }, tools: { workerHeapMb: 0 }, scripts: { starters: false } }));
  const I = require('../lib/indexer'), C = require('../lib/catalog'), S = require('../lib/catalog-store');
  try {
    const job = I.refresh({ env: 'dev', what: 'all' }); await job.promise;
    assert.equal(job.state, 'done'); assert.equal(job.result.es.indices, 1); assert.equal(job.result.consul.services, 2);
    const before = S.status('dev').generation;
    assert.match(C.find('dev', 'es: customer.region')[0], /orders-v2 \[orders\] 3: customer.region keyword/);
    assert.match(C.find('dev', 'consul: checkout')[0], /1\/2/);
    assert.equal(C.find('dev', '.system').length, 0);
    const cached = JSON.parse(fs.readFileSync(path.join(home, 'cache/dev/es/orders-v2.json')));
    assert.equal(cached.samples[0]._id, '42'); assert.equal(cached.settings.number_of_replicas, undefined);
    const es = require('../lib/es'), query = await es.search('dev', 'orders-v2', 'customer.region==eu && status~open', { size: 2 });
    assert.equal(query.total, 1); assert.equal(query.hits[0]._id, '42');
    const consul = require('../lib/consul');
    assert.equal((await consul.service('dev', 'check')).matches.length, 2);
    assert.equal((await consul.service('dev', 'checkout')).instances[0].version, 'fixture-v1');
    docs = 9; const next = I.refresh({ env: 'dev', what: 'es' }); await next.promise;
    assert.equal(next.state, 'done'); assert.notEqual(S.status('dev').generation, before);
    assert.match(C.find('dev', 'es: orders-v2')[0], /\] 9:/);
    assert.match(S.page('dev', 'es: orders-v2', { generation: before }).results[0].line, /\] 3:/);
    assert.ok(requests.includes('/_msearch'));
    const read = fs.readFileSync; t.mock.method(fs, 'readFileSync', (file, ...args) => { if (typeof file === 'string' && file.endsWith('/catalog.txt')) throw Error('Admin must not read the indexed catalog text'); return read(file, ...args); });
    const status = I.status('dev'); assert.equal(status.es.error, null); assert.equal(status.index.catalogLines, 3); assert.equal(status.index.catalogCountKnown, true);
    const app = require('../server').start({ port: 0 }); await new Promise(resolve => app.once('listening', resolve));
    try { const health = await fetch('http://127.0.0.1:' + app.address().port + '/api/status').then(r => r.json()); assert.equal(health.envs.find(e => e.env === 'dev').catalogLines, 3); }
    finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
    const legacy = path.join(home, 'cache/legacy/catalog.txt'); fs.mkdirSync(path.dirname(legacy), { recursive: true }); const fd = fs.openSync(legacy, 'w'); fs.ftruncateSync(fd, 10 * 1048576); fs.closeSync(fd);
    assert.equal(I.status('legacy').index.catalogCountKnown, false, 'an unindexed large catalog reports an unknown count until refresh');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await require('../lib/isolate').stop(); await require('../lib/state-store').close();
  }
});
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
