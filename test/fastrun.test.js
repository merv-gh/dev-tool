// Fast runs and red-first proof without a JDK: test names shared by both kinds of run, the proof from
// the run history, what a fast run recompiles (changed files and their users from the code graph),
// and the context additions (bodies of callees, parameterized boundaries).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fast-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

let ws, root;
test.before(async () => {
  const src = path.join(home, 'remote', 'payments-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'payments-service'), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  ws = await require('../lib/workspace').open({ project: 'PAY', repo: 'payments-service', ref: 'main', url: `file://${src}`, libraries: false });
  root = path.join(home, ws.path);
});

test('one name per test in surefire reports and launcher results', () => {
  const { testName } = require('../lib/testrun');
  assert.equal(testName('feeIsRoundedHalfUp(String, String)[1]'), 'feeIsRoundedHalfUp[1]');
  assert.equal(testName('feeIsRoundedHalfUp [1] amount=12.70, fee=0.67'), 'feeIsRoundedHalfUp[1]');
  assert.equal(testName('settleCallsTheService'), 'settleCallsTheService');
});

test('red-green proof: failed, the code changed, passed; green-only; still failing; full build seen', () => {
  const R = require('../lib/testrun');
  const file = path.join(home, 'cache', 'work', `${ws.id}.runs.json`);
  const at = (s) => `2026-10-28T10:00:${String(s).padStart(2, '0')}.000Z`;
  fs.writeFileSync(file, JSON.stringify([
    { test: 'a.T#bug', status: 'failed', fp: 'A', at: at(1), mode: 'fast' },
    { test: 'a.T#ok', status: 'passed', fp: 'A', at: at(1), mode: 'fast' },
    { test: 'a.T#bug', status: 'passed', fp: 'B', at: at(2), mode: 'fast' },
    { test: 'a.T#bug', status: 'passed', fp: 'B', at: at(3), mode: 'build' },
    { test: 'a.T#flaky', status: 'failed', fp: 'A', at: at(1), mode: 'fast' },
    { test: 'a.T#flaky', status: 'passed', fp: 'A', at: at(2), mode: 'fast' },
    { test: 'a.T#broken', status: 'error', fp: 'B', at: at(3), mode: 'fast' },
  ]));
  const p = Object.fromEntries(R.proof(ws.id).map(x => [x.test.split('#')[1], x]));
  assert.equal(p.bug.verdict, 'red-green');
  assert.equal(p.bug.fullBuild, true);
  assert.equal(p.ok.verdict, 'green-only');
  assert.match(p.flaky.verdict, /^green \(failed only while the test itself changed\)/, 'no code change between red and green');
  assert.equal(p.broken.verdict, 'failing');
  assert.equal(p.ok.fullBuild, false);
  // the fingerprint follows the code under test, not the tests
  const before = R.fingerprint(root);
  require('../lib/workspace').write(ws.id, 'src/test/java/com/acme/pay/XTest.java', { content: 'class XTest {}' });
  assert.equal(R.fingerprint(root), before);
  require('../lib/workspace').write(ws.id, 'src/main/java/com/acme/pay/FeeCalculator.java', { edits: [{ find: 'RoundingMode.DOWN', replace: 'RoundingMode.HALF_UP' }] });
  assert.notEqual(R.fingerprint(root), before);
});

test('a fast run recompiles the changed files and the classes that use them', () => {
  const F = require('../lib/fastrun');
  const W = require('../lib/workspace');
  const g = W.index(ws.id).graph_();
  const stamp = Date.now() - 1;
  const file = path.join(root, 'src/main/java/com/acme/pay/FeeCalculator.java');
  const t = new Date(Date.now() + 2000);
  fs.utimesSync(file, t, t);
  const ch = F.changed(root, stamp, g, root);
  const rel = (fs_) => fs_.map(f => path.relative(root, f)).sort();
  assert.deepEqual(rel(ch.mainChanged), ['src/main/java/com/acme/pay/FeeCalculator.java', 'src/main/java/com/acme/pay/PaymentService.java'], 'PaymentService uses FeeCalculator');
  assert.deepEqual(F.supported(root, { tool: 'gradle', modDir: root }, []), 'the build is not Maven');
  assert.equal(F.supported(root, { tool: 'maven', modDir: root }, ['src/test/java/X.java']), null);
});

test('context: bodies of what the method calls; parameterized boundaries for pure logic', () => {
  const T = require('../lib/testgen');
  const svc = T.context(ws.id, 'PaymentService#create');
  assert.deepEqual(svc.callees.map(c => c.method), ['FeeCalculator#fee', 'PaymentEvents#created']);
  assert.match(svc.callees[0].code, /setScale\(2, RoundingMode\.HALF_UP\)/);
  const fee = T.context(ws.id, 'FeeCalculator');
  assert.match(fee.skeleton, /\/\/ @CsvSource\(\{ "0\.00, \?", "0\.01, \?", "1\.00, \?", "12\.345, \?", "-1\.00, \?" \}\)/);
  assert.match(fee.skeleton, /\/\/ void feeCases\(String amount, String expected\)/);
});

test('the JDK version is read (java -version writes to stderr): it decides the Byte Buddy flag', { skip: require('child_process').spawnSync('java', ['-version']).error && 'no java' }, () => {
  const major = require('../lib/testrun').jdkMajor({ javaHome: null });
  assert.ok(major >= 8, `major ${major}`);
});
