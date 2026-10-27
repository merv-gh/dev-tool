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
  const dir = git.repoDir('SHOP', 'other');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'not a config');
  const info = await git.fetchRef('SHOP', 'other', 'main', { url: `file://${src}` });
  assert.equal(info.sha, g(['rev-parse', 'HEAD'], src));
  assert.ok(fs.statSync(path.join(dir, '.git')).isDirectory());
});
