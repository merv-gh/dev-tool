// Fetching repos where git cannot chmod its own files (Windows drives under WSL, SMB, some Docker
// mounts): a fake git fails `init` the way it does there and leaves a half-made .git behind. dt must
// clean that up, keep the git dir on local disk, and still check the files out into repos/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-git-'));
process.env.DT_HOME = tmp;
process.env.DT_GIT_DIR = path.join(tmp, 'local-git');

// a source repo to fetch from
const src = path.join(tmp, 'src', 'svc');
fs.mkdirSync(src, { recursive: true });
const g = (args, cwd) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString().trim();
g(['init', '-q', '-b', 'main'], src);
fs.writeFileSync(path.join(src, 'App.java'), 'class App {}\n');
g(['add', '.'], src);
g(['commit', '-q', '-m', 'one'], src);

// fake git on PATH: a plain `git init` fails like on a mount without chmod
const real = execFileSync('sh', ['-c', 'command -v git']).toString().trim();
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
for a in "$@"; do case "$a" in --separate-git-dir=*) exec "${real}" "$@";; esac; done
for a in "$@"; do
  if [ "$a" = init ]; then
    mkdir -p .git/objects && : > .git/config.lock
    echo "error: chmod on $(pwd)/.git/config.lock failed: Operation not permitted" >&2
    echo "fatal: could not set 'core.filemode' to 'false'" >&2
    exit 128
  fi
done
exec "${real}" "$@"
`, { mode: 0o755 });
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('fetch works where git cannot chmod: git dir on local disk, files in repos/', async () => {
  const git = require('../lib/git');
  const pathBefore = process.env.PATH;
  process.env.PATH = `${bin}:${pathBefore}`;
  try {
    // a broken .git from an earlier failed attempt
    const dir = git.repoDir('SHOP', 'svc');
    fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
    const info = await git.fetchRef('SHOP', 'svc', 'main', { url: `file://${src}` });
    assert.equal(info.sha, g(['rev-parse', 'HEAD'], src));
    assert.equal(fs.readFileSync(path.join(dir, 'App.java'), 'utf8'), 'class App {}\n');
    assert.ok(fs.statSync(path.join(dir, '.git')).isFile(), '.git is a pointer to the local git dir');
    assert.match(fs.readFileSync(path.join(dir, '.git'), 'utf8'), /local-git\/SHOP\/svc/);
    assert.ok(fs.existsSync(path.join(tmp, 'local-git', 'SHOP', 'svc', 'dt-ref.json')));

    // a second fetch reuses it
    fs.writeFileSync(path.join(src, 'App.java'), 'class App { int v = 2; }\n');
    g(['commit', '-qam', 'two'], src);
    const again = await git.fetchRef('SHOP', 'svc', 'main', { url: `file://${src}` });
    assert.equal(again.sha, g(['rev-parse', 'HEAD'], src));
    assert.match(fs.readFileSync(path.join(dir, 'App.java'), 'utf8'), /v = 2/);

    // the local git dir is gone (a container restart): fetched again from scratch
    fs.rmSync(path.join(tmp, 'local-git'), { recursive: true, force: true });
    const third = await git.fetchRef('SHOP', 'svc', 'main', { url: `file://${src}` });
    assert.equal(third.sha, again.sha);
  } finally { process.env.PATH = pathBefore; }
});

test('a broken .git is replaced on normal disks too', async () => {
  const git = require('../lib/git');
  // another folder: dt remembers per folder that the one above could not chmod
  const dir = git.repoDir('LIB', 'other');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'not a config');
  const info = await git.fetchRef('LIB', 'other', 'main', { url: `file://${src}` });
  assert.equal(info.sha, g(['rev-parse', 'HEAD'], src));
  assert.ok(fs.statSync(path.join(dir, '.git')).isDirectory());
});

test('a branch rewritten on the remote (force-push): the stale local copy is dropped and fetched fresh', async () => {
  const git = require('../lib/git');
  const src2 = path.join(tmp, 'src', 'rewritten');
  fs.mkdirSync(src2, { recursive: true });
  g(['init', '-q', '-b', 'main'], src2);
  fs.writeFileSync(path.join(src2, 'A.java'), 'class A {}\n'); g(['add', '.'], src2); g(['commit', '-q', '-m', 'one'], src2);
  fs.writeFileSync(path.join(src2, 'A.java'), 'class A { int v; }\n'); g(['commit', '-qam', 'two'], src2);
  const first = await git.fetchRef('SHOP', 'rewritten', 'main', { url: `file://${src2}` });
  // history rewritten: a new root, the old commits gone
  g(['checkout', '-q', '--orphan', 'fresh'], src2); g(['commit', '-q', '-m', 'rewritten'], src2);
  g(['branch', '-q', '-D', 'main'], src2); g(['branch', '-q', '-m', 'main'], src2);
  g(['reflog', 'expire', '--expire=now', '--all'], src2); g(['gc', '-q', '--prune=now'], src2);
  const again = await git.fetchRef('SHOP', 'rewritten', 'main', { url: `file://${src2}` });
  assert.notEqual(again.sha, first.sha);
  assert.equal(again.sha, g(['rev-parse', 'HEAD'], src2));
});

test('a local copy whose git data is gone is not used (git would walk up to a parent repo): fetched from the remote', async () => {
  const git = require('../lib/git');
  // dt's own folder is a git repo; inside it a checkout whose .git points at git data that is gone
  const outer = path.join(tmp, 'outer');
  fs.mkdirSync(path.join(outer, 'repos', 'SHOP', 'svc'), { recursive: true });
  g(['init', '-q', '-b', 'main'], outer);
  fs.writeFileSync(path.join(outer, 'README'), 'dt home\n'); g(['add', '.'], outer); g(['commit', '-q', '-m', 'home'], outer);
  const stale = path.join(outer, 'repos', 'SHOP', 'svc');
  fs.writeFileSync(path.join(stale, '.git'), `gitdir: ${path.join(tmp, 'gone', 'SHOP', 'svc')}\n`);
  const info = await git.fetchReusing('SHOP', 'svc', 'main', { url: `file://${src}`, dir: path.join(tmp, 'ws-from-stale'), gitKey: 'work/ws-from-stale', sources: [stale] });
  assert.equal(info.sha, g(['rev-parse', 'HEAD'], src));
  assert.equal(info.reusedFrom, undefined, 'the stale copy was not used');
});


test('remote queries work when the app cwd has a host-only Git pointer', async () => {
  const G = require('../lib/git');
  const cwd = process.cwd();
  const broken = path.join(tmp, 'mounted-app');
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, '.git'), `gitdir: ${path.join(tmp, 'missing-host-worktree')}\n`);
  process.chdir(broken);
  try {
    assert.equal(await G.remoteSha(`file://${src}`, 'main'), g(['rev-parse', 'HEAD'], src));
    const refs = await G.remoteRefs('SHOP', 'svc', { url: `file://${src}` });
    assert.ok(refs.heads.has('main'));
  } finally { process.chdir(cwd); }
});
