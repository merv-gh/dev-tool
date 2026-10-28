const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-experiments-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const E = require('../lib/experiments');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('experiments retain assertions and compare repeated read-only investigations', async () => {
  E.save({ id: 'orders', defaults: { id: 42 }, tools: ['pg_query'], code: 'const r = await tools.pg_query({sql:"select id from sales.orders where id = " + vars.id}); test("found", () => expect(r.rows.length).toBe(1)); return r.rows;' });
  const a = await E.run('orders', {}, { call: async () => ({ rows: [{ id: 42 }] }) });
  const b = await E.run('orders', { params: { id: 43 } }, { call: async () => ({ rows: [] }) });
  assert.equal(a.ok, true); assert.equal(b.ok, false);
  assert.equal(a.calls[0].tool, 'pg_query');
  const diff = E.compare('orders');
  assert.equal(diff.sameCode, true); assert.equal(diff.values.same, false);
  assert.equal(E.list('orders').runs.length, 2);
  assert.equal(E.list()[0].id, 'orders');
});
test('experiments reject writes, traversal and tools outside their allowlist', async () => {
  assert.throws(() => E.save({ id: 'write', code: 'return 1', tools: ['workspace_push'] }), /read-only/);
  assert.throws(() => E.list('../no'), /experiment id/);
  E.save({ id: 'restricted', code: 'return await tools.pg_query({sql:"select 1"})' });
  const r = await E.run('restricted', {}, { call: () => assert.fail('not allowed') });
  assert.equal(r.ok, false); assert.match(r.error, /allowlist/);
});
test('sandbox has no filesystem access and records JS errors', async () => {
  E.save({ id: 'no-files', tools: [], code: 'return process.getBuiltinModule("fs").readFileSync("/etc/passwd", "utf8")' });
  const r = await E.run('no-files');
  assert.equal(r.ok, false); assert.match(r.error, /Access|permission|not defined/i);
});
test('timeouts are retained as failed experiment runs', async () => {
  E.save({ id: 'timeout', tools: [], code: 'for (;;) {}' });
  const r = await E.run('timeout', { timeoutMs: 100 });
  assert.equal(r.ok, false); assert.match(r.error, /stopped after/);
  assert.equal(E.list('timeout').runs[0].ok, false);
});
test('new tools are exposed through the shared registry', async () => {
  const names = (await require('../lib/tools').schemas()).map(s => s.name);
  for (const n of ['fixture_plan', 'fixture_capture', 'fixture_export', 'fixture_replay', 'experiment_save', 'experiment_run', 'experiment_compare']) assert.ok(names.includes(n), n);
});
test('pg_query exposes parameter binding for read-only experiments', async () => {
  const pg = require('../lib/pg'), previous = pg.query;
  pg.query = async (env, sql, options) => {
    assert.equal(env, 'dev'); assert.equal(sql, 'select $1 as value');
    assert.deepEqual(options.params, ["value with 'quotes'"]);
    return { db: 'test', rows: [{ value: options.params[0] }] };
  };
  try {
    const r = await require('../lib/tools').call('pg_query', { env: 'dev', db: 'test', sql: 'select $1 as value', params: ["value with 'quotes'"] });
    assert.equal(r.rows[0].value, "value with 'quotes'");
  } finally { pg.query = previous; }
});
test('long captures run as resumable jobs and retain a usable capture result', async () => {
  const R = require('../lib/reproduction'), previous = R.capture;
  const configFile = path.join(home, 'config.json'), original = fs.readFileSync(configFile, 'utf8');
  fs.writeFileSync(configFile, JSON.stringify({ envs: { dev: {} }, tests: { waitMs: 1 } }));
  require('../lib/config').reload();
  R.capture = async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return { version: 1, plan: { env: 'dev', relations: [] }, rows: {}, events: {}, counts: { rows: 0, queries: 0, messages: 0 }, gaps: [], complete: true };
  };
  try {
    const first = await require('../lib/tools').call('fixture_capture', { plan: { env: 'dev', seeds: [] } });
    assert.equal(first.state, 'running');
    await require('../lib/jobs').find(first.job).promise;
    const done = await require('../lib/tools').call('fixture_capture', { job: first.job });
    assert.equal(done.state, 'done'); assert.match(done.capture, /^[a-f0-9]{24}$/);
    assert.equal(R.load(done.capture).complete, true);
  } finally { R.capture = previous; fs.writeFileSync(configFile, original); require('../lib/config').reload(); }
});
