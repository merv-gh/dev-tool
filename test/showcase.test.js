const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-showcase-local-'));
process.env.DT_HOME = home;
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, server: { publicUrl: 'http://localhost:4000' } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('showcase reads private adjustments and retained revisions without parsing or writing', async t => {
  const passport = { repo: { project: 'SHOP', repo: 'orders', sha: '1'.repeat(40) }, summary: { endpoints: 1, consumes: [], produces: [], tables: {} }, flows: [] };
  t.mock.method(require('../lib/passport'), 'load', () => passport);
  t.mock.method(require('../lib/codeindex'), 'load', () => ({}));
  const calls = [];
  t.mock.method(require('../lib/tools'), 'call', async (name, args) => {
    calls.push({ name, args });
    if (name === 'health') return { rows: [], summary: { healthy: 1, services: 1 } };
    if (name === 'overview') return {};
    if (name === 'consul_service') return { instances: [] };
    if (name === 'passport') return passport;
    if (name === 'passport_adjustments') return { view: 'http://localhost:4000/show/ports', ports: [{ id: 'manual-http' }], history: [{ revision: 'r1' }], revision: 'r1' };
    throw Error('Unexpected tool ' + name);
  });
  const S = require('../lib/semantic-code');
  t.mock.method(S, 'capabilities', () => ({ configured: false }));
  t.mock.method(S, 'list', args => {
    assert.deepEqual(args, { service: 'orders', versions: true });
    return { analyses: [{ id: 'retained', repo: 'SHOP/orders', sha: '1'.repeat(40), env: 'dev' }, { id: 'uat', env: 'uat' }] };
  });
  const result = await require('../lib/showcase').run({ service: 'orders', envs: ['dev'] });
  assert.equal(result.ok, true);
  const ports = result.steps.find(s => s.key === 'ports');
  assert.match(ports.summary, /1 ports.*1 adjustment/);
  assert.match(ports.admin, /env=dev.*repo=SHOP%2Forders.*revision=1{40}/);
  assert.deepEqual(calls.find(c => c.name === 'passport_adjustments').args, { service: 'orders', env: 'dev', repo: 'SHOP/orders', revision: '1'.repeat(40) });
  const semantic = result.steps.find(s => s.key === 'semantic');
  assert.equal(semantic.status, 'ready');
  const saved = require('../lib/results').load(semantic.view.split('/').pop());
  assert.equal(saved.data.analyses.length, 1);
  assert.equal(saved.data.analyses[0].id, 'retained');
  assert.ok(!calls.some(c => /^(semantic_index$|passport_adjust$|workspace_)/.test(c.name)));
  S.list.mock.mockImplementation(() => ({ analyses: [] }));
  const empty = await require('../lib/showcase').run({ service: 'orders', envs: ['dev'] });
  assert.equal(empty.ok, true);
  assert.match(empty.steps.find(s => s.key === 'semantic').summary, /Build one explicitly/);
});
