// workspace_push against a local bare repo: off unless enabled; never to the default branch, main, master,
// release/* (also nested) or push.protect; a new branch; an existing branch that moved (the commit replayed
// on its tip); a conflict that stops it with nothing pushed; the workspace stands on the pushed commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-push-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_RUNNER_URL']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, stdio: 'pipe' }).toString().trim();
const config = (push) => { fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, ...(push ? { push } : {}) })); require('../lib/config').reload?.(); };

// a bare "Bitbucket" repo with develop as its default branch, main, release/1.0 and feature/x
const bare = path.join(home, 'remote', 'svc.git');
const seed = path.join(home, 'seed');
fs.mkdirSync(seed, { recursive: true });
git(seed, 'init', '-q', '-b', 'develop');
fs.writeFileSync(path.join(seed, 'App.java'), 'class App {}\n');
git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'init');
for (const b of ['main', 'release/1.0', 'feature/x', 'feature/moved', 'feature/conflict']) git(seed, 'branch', b);
fs.mkdirSync(path.dirname(bare), { recursive: true });
execFileSync('git', ['clone', '-q', '--bare', seed, bare], { env: ENV });
const url = `file://${bare}`;

const W = () => require('../lib/workspace');
const T = () => require('../lib/tools');
const open = (ref) => W().open({ project: 'SVC', repo: 'svc', ref, url, libraries: false, fresh: true });
const remoteFile = (branch, f) => { try { return git(bare, 'show', `${branch}:${f}`); } catch { return null; } };

test('off unless enabled', async () => {
  config(null);
  const ws = await open('feature/x');
  W().write(ws.id, 'src/test/java/AppTest.java', { content: 'class AppTest {}\n' });
  await assert.rejects(T().call('workspace_push', { workspace: ws.id, branch: 'dt/tests', message: 'tests' }), /pushing is off/);
});

test('protected: main, master, release/* below too, push.protect, the default branch', async () => {
  config({ enabled: true, protect: ['hotfix/*'] });
  const ws = await open('feature/x');
  W().write(ws.id, 'src/test/java/AppTest.java', { content: 'class AppTest {}\n' });
  for (const b of ['main', 'master', 'release/1.0', 'release/2/rc', 'hotfix/a']) await assert.rejects(T().call('workspace_push', { workspace: ws.id, branch: b, message: 'tests' }), /is protected/, b);
  await assert.rejects(T().call('workspace_push', { workspace: ws.id, branch: 'develop', message: 'tests' }), /default branch/);
  await assert.rejects(T().call('workspace_push', { workspace: ws.id, branch: 'bad..name', message: 'tests' }), /not a valid branch name/);
  // nothing was committed by the refusals: the change is still a patch
  assert.equal((await W().patch(ws.id)).files.length, 1);
});

test('a new branch from the workspace, then an existing one: the workspace stands on the pushed commit', async () => {
  config({ enabled: true, author: 'Test Bot <bot@example.com>' });
  const ws = await open('feature/x');
  W().write(ws.id, 'src/test/java/AppTest.java', { content: 'class AppTest {}\n' });
  const r = await T().call('workspace_push', { workspace: ws.id, branch: 'dt/svc-tests', message: 'Add AppTest' });
  assert.equal(r.created, true);
  assert.deepEqual(r.files, ['src/test/java/AppTest.java']);
  assert.equal(remoteFile('dt/svc-tests', 'src/test/java/AppTest.java'), 'class AppTest {}');
  assert.equal(git(bare, 'log', '-1', '--format=%an <%ae>|%s', 'dt/svc-tests'), 'Test Bot <bot@example.com>|Add AppTest');
  assert.equal(git(bare, 'rev-parse', 'dt/svc-tests~1'), git(bare, 'rev-parse', 'feature/x'));
  assert.equal((await W().patch(ws.id)).files.length, 0);
  // more on the same workspace: a second commit on the branch it pushed to
  W().write(ws.id, 'src/test/java/MoreTest.java', { content: 'class MoreTest {}\n' });
  const r2 = await T().call('workspace_push', { workspace: ws.id, branch: 'dt/svc-tests', message: 'Add MoreTest' });
  assert.equal(r2.created, false);
  assert.equal(r2.replayedOn, undefined);
  assert.equal(git(bare, 'rev-parse', 'dt/svc-tests~1'), r.commit);
  // to the existing feature branch it was opened at
  W().write(ws.id, 'src/test/java/ThirdTest.java', { content: 'class ThirdTest {}\n' });
  const r3 = await T().call('workspace_push', { workspace: ws.id, branch: 'feature/x', message: 'Add ThirdTest' }).catch(e => e);
  // feature/x is behind the workspace (it stands on dt/svc-tests now): replayed on its tip, only this commit
  assert.ok(!(r3 instanceof Error), String(r3));
  assert.equal(r3.replayedOn, git(seed, 'rev-parse', 'feature/x'));
  assert.equal(remoteFile('feature/x', 'src/test/java/ThirdTest.java'), 'class ThirdTest {}');
  assert.equal(remoteFile('feature/x', 'src/test/java/AppTest.java'), null);
});

test('an existing branch that moved: replayed on its tip; a conflict: nothing pushed, the changes kept', async () => {
  config({ enabled: true });
  const ws = await open('feature/moved');
  const wc = await open('feature/conflict');
  // others push to both branches after the workspaces were opened
  const other = path.join(home, 'other');
  execFileSync('git', ['clone', '-q', bare, other], { env: ENV });
  git(other, 'checkout', '-q', 'feature/moved');
  fs.writeFileSync(path.join(other, 'Other.java'), 'class Other {}\n');
  git(other, 'add', '.'); git(other, 'commit', '-qm', 'other'); git(other, 'push', '-q', 'origin', 'feature/moved');
  git(other, 'checkout', '-q', 'feature/conflict');
  fs.writeFileSync(path.join(other, 'App.java'), 'class App { int theirs; }\n');
  git(other, 'commit', '-qam', 'theirs'); git(other, 'push', '-q', 'origin', 'feature/conflict');
  const moved = git(bare, 'rev-parse', 'feature/moved');

  W().write(ws.id, 'src/test/java/AppTest.java', { content: 'class AppTest {}\n' });
  const r = await T().call('workspace_push', { workspace: ws.id, branch: 'feature/moved', message: 'Add AppTest' });
  assert.equal(r.replayedOn, moved);
  assert.equal(git(bare, 'rev-parse', 'feature/moved~1'), moved);
  assert.equal(remoteFile('feature/moved', 'Other.java'), 'class Other {}');
  assert.equal(remoteFile('feature/moved', 'src/test/java/AppTest.java'), 'class AppTest {}');

  const before = git(bare, 'rev-parse', 'feature/conflict');
  W().write(wc.id, 'App.java', { content: 'class App { int mine; }\n' });
  await assert.rejects(T().call('workspace_push', { workspace: wc.id, branch: 'feature/conflict', message: 'mine' }), /conflict with it in App\.java: nothing pushed/);
  assert.equal(git(bare, 'rev-parse', 'feature/conflict'), before);
  const p = await W().patch(wc.id);
  assert.deepEqual(p.files.map(f => f.path), ['App.java']);
  assert.match(p.patch, /\+class App \{ int mine; \}/);
});
