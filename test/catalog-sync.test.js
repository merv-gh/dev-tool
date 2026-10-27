// catalog_sync on slow sources: answers "running" with a job id before the chat client gives up, then
// catalog_sync with that job waits for it and returns its result (without starting another sync).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-sync-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_CATALOG_SYNC_WAIT_MS = '300';
delete process.env.DT_TOOLS;

let hits = 0;
const consul = http.createServer((req, res) => {
  hits++;
  setTimeout(() => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/catalog/services')) return res.end(JSON.stringify({ orders: [] }));
    if (req.url.startsWith('/v1/health/state')) return res.end('[]');
    if (req.url.startsWith('/v1/agent/self')) return res.end(JSON.stringify({ Config: { Datacenter: 'dc' } }));
    res.end('[]');
  }, 700);
});
test.before(() => new Promise(r => consul.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { consul: `http://127.0.0.1:${consul.address().port}` } } }));
  r();
})));
test.after(() => { consul.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('catalog_sync: "running" + job id, then the result by job id', async () => {
  const T = require('../lib/tools');
  const first = await T.call('catalog_sync', { env: 'dev', what: 'consul' });
  assert.equal(first.state, 'running');
  assert.match(first.note, new RegExp(`job="${first.job}"`));
  let r = first;
  for (let i = 0; i < 20 && r.state === 'running'; i++) r = await T.call('catalog_sync', { job: first.job });
  assert.equal(r.state, 'done', JSON.stringify(r));
  assert.equal(r.job, first.job);
  const after = hits;
  const again = await T.call('catalog_sync', { job: first.job });
  assert.equal(again.state, 'done');
  assert.equal(hits, after, 'asking about a finished job does not sync again');
  await assert.rejects(T.call('catalog_sync', { job: 'nope' }), /no job nope/);
});
