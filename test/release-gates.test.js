const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');

test('coverage policy rejects stale, partial and regressing evidence', () => {
  const { check } = require('../dev/coverage-gate');
  const report = { run: { scope: 'full-suite', exitCode: 0, sourceDigest: require('../lib/source-version').digest(), node: process.version, platform: process.platform }, summary: { lines: { percent: 95 }, functions: { percent: 95 }, branches: { percent: 95 }, transitions: { percent: 75 }, sourceFiles: { unmeasured: 3 } } };
  const baseline = structuredClone(report);
  assert.equal(check(report, baseline).passed, true);
  for (const [field, value, message] of [['scope', 'selected-files', /full suite/], ['sourceDigest', 'old', /stale/], ['exitCode', 1, /Expected/]]) {
    const candidate = structuredClone(report); candidate.run[field] = value;
    assert.throws(() => check(candidate, baseline), message);
  }
  const regressed = structuredClone(report); regressed.summary.lines.percent = 94;
  assert.throws(() => check(regressed, baseline), /94% < 95%/);
  const unmeasured = structuredClone(report); unmeasured.summary.sourceFiles.unmeasured++;
  assert.throws(() => check(unmeasured, baseline), /Unmeasured/);
  const otherPlatform = structuredClone(baseline); otherPlatform.run.platform = 'different';
  assert.equal(check(regressed, otherPlatform).comparableBaseline, false);
  regressed.summary.branches.percent = 80;
  assert.throws(() => check(regressed, otherPlatform), /branches/);
});

test('required integration runner treats skips as a failed gate', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-release-gate-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'required.test.js');
  const run = source => {
    fs.writeFileSync(file, source);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [path.join(__dirname, '../dev/required-tests.js'), file], { encoding: 'utf8', timeout: 15000, env });
  };
  const passed = run("require('node:test')('required',()=>{});");
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);
  const skipped = run("require('node:test')('required',{skip:true},()=>{});");
  assert.equal(skipped.status, 1); assert.match(skipped.stderr, /skipped/);
  const failed = run("require('node:test')('required',()=>{throw Error('fixture failed');});");
  assert.equal(failed.status, 1); assert.match(failed.stdout, /fixture failed/);
});
