const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-units-'));
process.env.DT_CONFIG_DIR = tmp; // no local .env files in tests
process.env.DT_CACHE_DIR = tmp;
process.env.DT_PASSPORTS_DIR = path.join(tmp, 'passports');

// Stub HTTP before modules capture it.
const util = require('../lib/util');
const calls = [];
let responder = () => { throw new Error('no stub'); };
util.http = async (url, opts = {}) => { calls.push({ url, opts }); return responder(url, opts); };

const logs = require('../lib/logs');
const monitor = require('../lib/monitor');
const { unified } = require('../lib/atlassian');

test('logs: time ranges and bucket sizes', () => {
  const r = logs.parseRange('15m');
  assert.equal(r.gte, 'now-15m');
  assert.equal(r.lte, 'now');
  assert.ok(Math.abs(r.end - r.start - 15 * 60e3) < 5);
  const abs = logs.parseRange('2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z');
  assert.equal(abs.gte, '2026-10-01T10:00:00.000Z');
  assert.equal(abs.lte, '2026-10-01T11:00:00.000Z');
  assert.throws(() => logs.parseRange('yesterday-ish'), /Bad time range/);
  assert.equal(logs.interval(15 * 60e3), '30s');
  assert.equal(logs.interval(24 * 36e5), '30m');
});

test('logs: query has range, text, service, level (both cases), trace', () => {
  const f = { time: '@timestamp', message: 'message', service: 'service.name', level: 'log.level', trace: 'trace.id' };
  const q = logs.buildQuery(f, { query: 'NPE', service: 'svc-a', level: 'error', traceId: 't1', range: logs.parseRange('1h') });
  const s = JSON.stringify(q);
  assert.match(s, /"gte":"now-1h"/);
  assert.match(s, /"query":"NPE"/);
  assert.match(s, /"service.name":"svc-a"/);
  assert.match(s, /"log.level":"error"/);
  assert.match(s, /"log.level":"ERROR"/);
  assert.match(s, /"trace.id":"t1"/);
});

test('logs: fields from nested or flat (dotted) sources', () => {
  const f = { time: '@timestamp', message: 'message', service: 'service.name', level: 'log.level', trace: 'trace.id' };
  const a = logs.normalize(f, { _index: 'i', _id: '1', _source: { '@timestamp': 't', message: 'm', service: { name: 's' }, log: { level: 'warn' }, 'trace.id': 'x' } });
  assert.deepEqual([a.time, a.message, a.service, a.level, a.trace], ['t', 'm', 's', 'WARN', 'x']);
});

test('logs: search builds hits + facets, retries facets on .keyword', async () => {
  process.env.LOGS_ES_HOSTS = 'http://logs:9200';
  require('../lib/config').getEnv('dev'); // env resolved lazily below
  let facetTries = 0;
  responder = (url, opts) => {
    const body = opts.body;
    if (body.size === 0) {
      facetTries++;
      if (!body.aggs.levels.terms.field.endsWith('.keyword')) throw new Error('400 fielddata disabled');
      return { aggregations: { levels: { buckets: [{ key: 'error', doc_count: 2 }] }, services: { buckets: [{ key: 'a', doc_count: 2 }] }, timeline: { buckets: [{ key: 1, doc_count: 2, level: { buckets: [{ key: 'error', doc_count: 2 }] } }] } } };
    }
    return { hits: { total: { value: 2 }, hits: [{ _index: 'logs-1', _id: '1', _source: { '@timestamp': '2026-10-01T10:00:00Z', message: 'boom', service: { name: 'a' }, log: { level: 'error' } } }] }, aggregations: { timeline: { buckets: [] } } };
  };
  const r = await logs.search('dev', { query: 'boom', from: '1h' });
  assert.equal(facetTries, 2);
  assert.equal(r.total, 2);
  assert.deepEqual(r.levels, [{ key: 'ERROR', count: 2 }]);
  assert.equal(r.timeline[0].levels.ERROR, 2);
  assert.equal(r.rows[0].message, 'boom');
  assert.ok(calls.some(c => c.url.startsWith('http://logs:9200/logs-*/_search')));
});

test('logs: trace groups lines into hops per service', async () => {
  responder = () => ({ hits: { total: { value: 3 }, hits: [
    { _source: { '@timestamp': '2026-10-01T10:00:00Z', service: { name: 'gw' }, log: { level: 'info' }, message: 'in' } },
    { _source: { '@timestamp': '2026-10-01T10:00:01Z', service: { name: 'orders' }, log: { level: 'error' }, message: 'fail' } },
    { _source: { '@timestamp': '2026-10-01T10:00:02Z', service: { name: 'gw' }, log: { level: 'info' }, message: 'out' } },
  ] }, aggregations: { timeline: { buckets: [] } } });
  const t = await logs.trace('dev', 'abc');
  assert.deepEqual(t.hops.map(h => [h.service, h.lines, h.errors]), [['gw', 2, 0], ['orders', 1, 1]]);
});

test('health: one Consul call set, node failures propagate, sorted worst first', async () => {
  process.env.CONSUL_URL = 'http://consul:8500';
  require('../lib/config').reload();
  responder = (url) => {
    if (url.endsWith('/v1/agent/self')) return { Config: { Datacenter: 'dc9' } };
    if (url.endsWith('/v1/catalog/services')) return { a: [], b: [], c: [] };
    return [
      { Node: 'n2', Name: 'Serf', Status: 'critical', Output: 'gone', ServiceName: '' },
      { Node: 'n1', Name: 'h', Status: 'passing', ServiceName: 'a', ServiceID: 'a1' },
      { Node: 'n2', Name: 'h', Status: 'passing', ServiceName: 'a', ServiceID: 'a2' },
      { Node: 'n1', Name: 'h', Status: 'critical', Output: '503', ServiceName: 'b', ServiceID: 'b1' },
    ];
  };
  calls.length = 0;
  const h = await monitor.health('dev');
  assert.equal(calls.length, 3);
  assert.deepEqual(h.rows.map(r => [r.service, r.status]), [['b', 'down'], ['a', 'degraded'], ['c', 'no checks']]);
  assert.match(h.rows[1].failing, /n2: node Serf: gone/);
  assert.match(h.rows[0].link, /\/ui\/dc9\/services\/b\/instances$/);
  assert.deepEqual(h.summary, { services: 3, healthy: 0, degraded: 1, down: 1, noChecks: 1 });
});

test('rate limit: per key, queued, rejects when the queue is too long', async () => {
  process.env.DT_RATE_PER_SEC = '20';
  process.env.DT_RATE_MAX_WAIT_MS = '120';
  delete require.cache[require.resolve('../lib/limit')];
  const limit = require('../lib/limit');
  const t0 = Date.now();
  const waits = await Promise.all([limit.take('a'), limit.take('a'), limit.take('a'), limit.take('b')]);
  const took = Date.now() - t0;
  // three calls on one key wait 0, 50, 100 ms; another key does not wait (a busy machine only adds time)
  assert.deepEqual(waits.map(w => Math.round(w / 50)), [0, 1, 2, 0], JSON.stringify(waits));
  assert.ok(took >= 95, `took ${took}`);
  const burst = Array.from({ length: 6 }, () => limit.take('c').then(() => 'ok', e => e.message));
  const res = await Promise.all(burst);
  assert.ok(res.some(r => /rate limit/.test(r)), JSON.stringify(res));
});

test('bitbucket diff -> unified text and counts', () => {
  const u = unified([{ source: { toString: 'a.txt' }, destination: { toString: 'a.txt' }, hunks: [{ sourceLine: 1, sourceSpan: 2, destinationLine: 1, destinationSpan: 2, segments: [
    { type: 'CONTEXT', lines: [{ line: 'same' }] }, { type: 'REMOVED', lines: [{ line: 'old' }] }, { type: 'ADDED', lines: [{ line: 'new' }, { line: 'new2' }] },
  ] }] }]);
  assert.deepEqual(u.files, [{ path: 'a.txt', from: 'a.txt', add: 2, del: 1 }]);
  assert.match(u.text, /@@ -1,2 \+1,2 @@\n same\n-old\n\+new\n\+new2/);
});

test('index first: find hints and pg schema guard', async () => {
  const tools = require('../lib/tools');
  const empty = await tools.call('find', { q: 'x', env: 'dev' });
  assert.match(empty[0], /catalog for dev is empty: call catalog_sync/);
  fs.mkdirSync(path.join(tmp, 'dev', 'pg'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dev', 'catalog.txt'), 'pg crm crm.person ~1: id bigint\n');
  fs.writeFileSync(path.join(tmp, 'dev', 'pg', '_index.json'), JSON.stringify({ schemas: { crm: ['crm'] } }));
  assert.deepEqual(await tools.call('find', { q: 'person', env: 'dev' }), ['pg crm crm.person ~1: id bigint']);
  assert.match((await tools.call('find', { q: 'nothing', env: 'dev' }))[0], /no match/);
  await assert.rejects(tools.call('pg_query', { sql: 'select * from sales.orders o join crm.person p on true', env: 'dev' }), /schema sales is not in the dev catalog/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('logs result keeps the ES hit total next to the stored lines', async () => {
  const results = require('../lib/results');
  const id = results.save('logs', [{ a: 1 }], { total: 99, matched: 99 }).split('/').pop();
  const r = results.load(id);
  assert.equal(r.total, 1);
  assert.equal(r.matched, 99);
});
