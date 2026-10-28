// End to end over everything: the demo's mock (Consul, ES, kafka-ui and Bitbucket with real git repos,
// for two environments) and a dt server; the showcase of payments-service runs health, dashboards,
// versions, passport, impact, a workspace on master, a test run with Maven, and the patch; the page
// and its data are served. Needs Maven: DT_TEST_MAVEN=$(command -v mvn) npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MVN = process.env.DT_TEST_MAVEN;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-showcase-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];

let mock, server;
test.after(() => { if (mock) mock.kill(); if (server) server.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('showcase: two environments, passport, impact, a test on master, the patch; one page', { skip: !MVN && 'set DT_TEST_MAVEN', timeout: 900000 }, async () => {
  const port = 30000 + Math.floor(Math.random() * 20000), uat = port + 1;
  mock = spawn(process.execPath, [path.join(__dirname, '..', 'demo', 'mock.js'), String(port), String(uat)], { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => { let out = ''; mock.stderr.on('data', d => { out += d; if (out.includes('uat on')) resolve(); }); setTimeout(() => reject(new Error(`mock did not start: ${out}`)), 60000); });
  const m = `http://127.0.0.1:${port}`, u = `http://127.0.0.1:${uat}`;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: {
      dev: { elasticsearch: { hosts: [m] }, kafkaUi: m, consul: m },
      uat: { elasticsearch: { hosts: [u] }, kafkaUi: u, consul: u },
    },
    bitbucket: { url: m, token: 'demo' },
    tests: { maven: MVN },
    server: { ratePerSec: 0 },
  }));
  require('../lib/config').reload();
  server = require('../server').start({ port: 0, host: '127.0.0.1' });
  await new Promise(r => server.on('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.DT_PUBLIC_URL = base;

  const T = require('../lib/tools');
  const test = fs.readFileSync(path.join(__dirname, '..', 'demo', 'showcase', 'FeeCalculatorTest.java'), 'utf8');
  let r = await T.call('showcase', { service: 'payments-service', target: 'FeeCalculator#fee', test });
  while (r.state === 'running') r = await T.call('showcase', { job: r.job });
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  const step = (title) => r.steps.find(s => s.includes(title)) || '';
  assert.match(step('Health of dev'), /^ok .*5\/8 healthy, 1 down, 1 degraded/);
  assert.match(step('Health of uat'), /^ok .*degraded/);
  assert.match(step('payments-service in uat'), /1\/2 passing, version 1\.0\.0/);
  assert.match(step('Versions across environments'), /dev 1\.1\.0-SNAPSHOT@c0ffee1 vs uat 1\.0\.0@ab2ce56/);
  assert.match(step('Passport of payments-service'), /3 endpoints, consumes settlements, produces payments\.created/);
  assert.match(step('Impact of FeeCalculator#fee'), /endpoints POST \/payments/);
  assert.match(step('Run FeeCalculatorTest'), /failed: 3\/4 passed .*expected 0\.67, got 0\.66/);
  assert.match(step('Patch'), /1 file; tests 1 failing, 3 green-only/);

  // the page and what it shows
  const id = r.view.split('/').pop();
  assert.equal((await fetch(`${base}/showcase/${id}`)).status, 200);
  const data = (await (await fetch(`${base}/api/result/${id}`)).json()).data;
  const views = data.steps.filter(s => s.view).map(s => s.view);
  assert.ok(views.length >= 9, `${views.length} views`);
  for (const v of views) assert.equal((await fetch(v.replace(/^https?:\/\/[^/]+/, base))).status, 200, v);
});
