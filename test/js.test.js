// JS in scripts, Postman/Bruno style: js steps, before/after hooks on steps, scripts and collections,
// captures, collection/script vars, tests; and the sandbox (no files, no env, timeout).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-js-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.SECRET_FOR_TEST = 'do-not-leak';
delete process.env.DT_TOOLS;

const seen = [];
const api = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => b += c).on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body: b });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'job-7', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 5 }] }));
  });
});
let base;
const writeConfig = (scripts) => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { consul: 'http://127.0.0.1:9' } }, scripts: { http: { allow: [base] }, jsTimeoutMs: 6000, ...scripts } }));
  const t = new Date(Date.now() + Math.random() * 1e6); fs.utimesSync(path.join(home, 'config.json'), t, t);
  require('../lib/config').reload();
};
test.before(() => new Promise(r => api.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${api.address().port}`; writeConfig({}); r(); })));
test.after(() => { api.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('sandbox: helpers work; no files, no environment, a timeout', async () => {
  const js = require('../lib/js');
  const r = await js.run('vars.n++; log("n is", vars.n); test("ok", () => expect(vars.n).toBe(2)); test("bad", () => expect([1]).not.toContain(1)); return { u: uuid().length, d: date("YYYY").length, r: rand(4).length, h: hex(6) }', { vars: { n: 1 } });
  assert.equal(r.vars.n, 2);
  assert.deepEqual(r.logs, ['n is 2']);
  assert.deepEqual(r.tests.map(t => [t.name, t.ok]), [['ok', true], ['bad', false]]);
  assert.match(r.tests[1].error, /not to contain 1/);
  assert.deepEqual({ ...r.returned, h: r.returned.h.length }, { u: 36, d: 4, r: 4, h: 6 });
  assert.match((await js.run('return require("fs").readFileSync("/etc/hosts", "utf8")')).error, /restricted|not defined|denied/i);
  assert.equal(JSON.stringify((await js.run('return process.env')).returned).includes('do-not-leak'), false, 'no secrets in the sandbox');
  assert.match((await js.run('return require("child_process").execSync("id").toString()')).error || '', /restricted|not defined|denied/i);
  await assert.rejects(js.run('while (true) {}'), /stopped after 6000ms/);
});

test('steps: before changes args, capture, after tests and replaces the result, js steps', async () => {
  const S = require('../lib/scripts');
  S.save('jobs/start', {
    description: 'start a job and check it',
    vars: { region: 'eu' },
    params: { count: { type: 'number', default: 2 } },
    before: 'vars.runId = "run-" + hex(6); log("run", vars.runId)',
    steps: [
      { js: 'return Array.from({ length: vars.count }, (_, i) => ({ line: i + 1, id: uuid() }))', as: 'lines' },
      {
        http: `POST ${base}/jobs`, body: { lines: '{{lines}}', region: '{{region}}' },
        before: 'args.headers["x-run"] = vars.runId; args.body.total = vars.lines.length',
        capture: { jobId: 'json.id', firstSku: 'json.items[0].sku' },
        after: [
          'test("status 200", () => expect(result.status).toBe(200))',
          'test("has items", () => expect(result.json.items.length).toBeGreaterThan(1))',
          'return result.json.items.map(i => i.qty)',
        ],
        as: 'qtys',
      },
      { js: 'vars.total = result.reduce((a, b) => a + b, 0); return vars.total * 10', as: 'tenfold' },
      { set: { summary: '{{jobId}}/{{firstSku}}/{{total}}/{{region}}' } },
    ],
    after: 'test("job id captured", () => expect(vars.jobId).toMatch(/^job-/))',
  });
  const r = await S.run('jobs/start', {});
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  const sent = seen.at(-1);
  assert.match(sent.headers['x-run'], /^run-[0-9a-f]{6}$/);
  const body = JSON.parse(sent.body);
  assert.equal(body.total, 2);
  assert.equal(body.region, 'eu');
  assert.equal(body.lines.length, 2);
  assert.match(body.lines[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(r.results.qtys, [2, 5], 'after hook replaced the result');
  assert.equal(r.results.tenfold, 70);
  assert.equal(r.results.summary, 'job-7/A/7/eu');
  assert.deepEqual(r.tests, { passed: 3, failed: 0, list: [
    { script: 'jobs/start', step: 2, hook: 'after', name: 'status 200', ok: true },
    { script: 'jobs/start', step: 2, hook: 'after', name: 'has items', ok: true },
    { script: 'jobs/start', step: 5, hook: 'after', name: 'job id captured', ok: true },
  ] });
  assert.match(r.logs[0].msg, /^run run-/);
});

test('collections: vars and before/after hooks, outer first; a failing test fails the run', async () => {
  const S = require('../lib/scripts');
  S.mkdir('team/billing');
  S.setCollection('team', { vars: { tenant: 't1', level: 'team' }, before: 'vars.order = ["team"]', after: 'vars.order.push("team after")' });
  S.setCollection('team/billing', { vars: { level: 'billing', currency: 'EUR' }, before: 'vars.order.push("billing")', after: 'vars.order.push("billing after"); test("currency", () => expect(vars.currency).toBe("USD"))' });
  S.save('team/billing/invoice', { description: 'x', steps: [{ js: 'vars.order.push("step"); return `${vars.tenant}/${vars.level}/${vars.currency}`', as: 'who' }] });
  const r = await S.run('team/billing/invoice', { currency: 'EUR' });
  assert.equal(r.results.who, 't1/team/EUR', 'outer collection vars set first; params win');
  assert.deepEqual(r.results.order, ['team', 'billing', 'step', 'billing after', 'team after']);
  assert.equal(r.ok, false);
  assert.match(r.error, /1 of 1 tests failed: currency/);
  assert.equal(S.getCollection('team/billing').vars.currency, 'EUR');
});

test('errors: hook errors stop the step, capture of a missing path, validation, js turned off', async () => {
  const S = require('../lib/scripts');
  S.save('err/a', { description: 'x', steps: [{ set: { a: 1 }, after: 'throw new Error("nope")' }, { set: { b: 2 } }] });
  const r = await S.run('err/a');
  assert.equal(r.ok, false);
  assert.match(r.error, /after: nope/);
  assert.equal(r.steps.length, 1);
  S.save('err/b', { description: 'x', steps: [{ set: { a: { b: 1 } }, capture: { c: 'a.z' } }] });
  assert.match((await S.run('err/b')).error, /capture c: no "a.z"/);
  assert.throws(() => S.save('err/c', { description: 'x', steps: [{ set: {}, capture: ['x'] }] }), /capture must be/);
  assert.throws(() => S.save('err/c', { description: 'x', steps: [{ js: 42 }] }), /js must be JavaScript/);
  writeConfig({ js: false });
  assert.match((await S.run('jobs/start')).error, /turned off/);
  writeConfig({});
});
