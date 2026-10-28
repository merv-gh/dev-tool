const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { select, gitChanges } = require('../dev/test');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-test-selection-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const put = (file, value) => { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
put('test/a.test.js', "require('../lib/a')");
put('test/b.test.js', "require('../lib/b')");
put('test/db.live.test.js', "require('../lib/a')");
put('test/dist.test.js', "require('../lib/a')");
put('lib/a.js', "require('./shared'); require('./cycle')");
put('lib/b.js', "require('./other')");
put('lib/shared.js', 'module.exports = 1');
put('lib/other.js', 'module.exports = 2');
put('lib/cycle.js', "require('./a')");

test('affected tests follow transitive and cyclic local require dependencies', () => {
  assert.deepEqual(select(root, ['lib/shared.js'], { local: true }).tests, ['test/a.test.js']);
  assert.deepEqual(select(root, ['lib/other.js'], { local: true }).tests, ['test/b.test.js']);
  assert.deepEqual(select(root, ['lib/shared.js'], { live: true }).tests, ['test/db.live.test.js']);
  assert.deepEqual(select(root, ['test/a.test.js'], { local: true }).tests, ['test/a.test.js']);
  assert.deepEqual(select(root, ['README.md', 'docs/plan.md'], { local: true }).tests, []);
  fs.rmSync(path.join(root, 'lib/shared.js'));
  assert.deepEqual(select(root, ['lib/shared.js'], { local: true }).tests, ['test/a.test.js'], 'a deleted file still has dependants');
});

test('runtime assets, child-process entrypoints, fixtures and uncovered modules select the full group', () => {
  const all = ['test/a.test.js', 'test/b.test.js'];
  for (const file of ['web/views/tests.html', 'package.json', 'cli.js', 'dev/test.js', 'test/fixtures/schema.sql', 'lib/new.js']) {
    const result = select(root, [file], { local: true });
    assert.deepEqual(result.tests, all, file);
    assert.match(result.reasons[0], /entire group/);
  }
  assert.deepEqual(select(root, ['test/db.live.test.js'], { local: true }).tests, []);
});

test('literal helper entrypoints passed to a child process are dependencies', () => {
  put('test/runtime.test.js', "const path = require('path'); const child = path.join(__dirname, '..', 'lib', 'child.js');");
  put('lib/child.js', "require('./other')");
  assert.deepEqual(select(root, ['lib/child.js'], { local: true }).tests, ['test/runtime.test.js']);
  assert.deepEqual(select(root, ['lib/other.js'], { local: true }).tests, ['test/b.test.js', 'test/runtime.test.js']);
  fs.rmSync(path.join(root, 'test/runtime.test.js'));
  fs.rmSync(path.join(root, 'lib/child.js'));
});

test('git changes include staged, unstaged, deleted and untracked paths', () => {
  const run = args => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
    assert.equal(r.status, 0, r.stderr);
  };
  run(['init', '-q', '-b', 'main']); run(['add', '.']); run(['commit', '-qm', 'initial']);
  put('lib/a.js', 'edited');
  put('lib/b.js', 'staged'); run(['add', 'lib/b.js']);
  fs.rmSync(path.join(root, 'lib/other.js'));
  put('test/new.test.js', 'new');
  assert.deepEqual(gitChanges(root).sort(), ['lib/a.js', 'lib/b.js', 'lib/other.js', 'test/new.test.js']);
});

test('CLI rejects incompatible groups, unknown flags and invalid concurrency', () => {
  const cli = path.join(__dirname, '..', 'dev', 'test.js');
  for (const args of [['--local', '--live'], ['--concurrency', '0'], ['--concurrency', 'lots'], ['--base'], ['--typo']]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1, args.join(' '));
    assert.ok(r.stderr.length > 0);
  }
  const empty = spawnSync(process.execPath, [cli, '--local', '--files', 'README.md', '--list'], { encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).tests, []);
});
