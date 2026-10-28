// Shallow fetch of one ref (branch, tag or sha) of a Bitbucket repo into repos/<PROJECT>/<repo>.
// The token goes in a per-command header (-c http.extraHeader), never into .git/config.
// repos/ is often a bind mount where git cannot chmod its own files (Windows drives under WSL, SMB,
// some Docker/Colima mounts): "could not set 'core.filemode' to 'false'". Then the git dir is kept
// on local disk (DT_GIT_DIR, default <tmp>/dt-git) and only the checked-out files go to repos/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { getPersonal } = require('./config');

const REPOS = require('./config').PATHS.repos;
const LOCAL_GIT = process.env.DT_GIT_DIR || path.join(os.tmpdir(), 'dt-git');

// safe.directory: on such mounts the files may look owned by another user ("dubious ownership")
function git(args, cwd, extra = []) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'safe.directory=*', ...extra, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 64 << 20, timeout: 600000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]}: ${(stderr || err.message).trim().split('\n').slice(-3).join(' | ')}`));
      else resolve(stdout.trim());
    });
  });
}

const isSha = (ref) => /^[0-9a-f]{7,40}$/i.test(ref || '');
const repoDir = (project, repo) => path.join(REPOS, project.toUpperCase(), repo);

function remote(project, repo) {
  const { url } = getPersonal().bitbucket;
  return `${url}/scm/${project.toLowerCase()}/${repo}.git`;
}

function authArgs(remoteUrl) {
  const { token } = getPersonal().bitbucket;
  return token && /^https?:/.test(remoteUrl) ? ['-c', `http.extraHeader=Authorization: Bearer ${token}`] : [];
}

// opts.url overrides the remote (tests use file:// repos)
async function fetchRef(project, repo, ref, opts = {}) {
  const dir = opts.dir || repoDir(project, repo);
  const url = opts.url || remote(project, repo);
  const auth = authArgs(url);
  fs.mkdirSync(dir, { recursive: true });
  await ensureRepo(dir, url, opts.gitKey || `${project.toUpperCase()}/${repo}`);
  const want = ref || 'HEAD';
  let fallback = null;
  try {
    await git(['fetch', '-q', '--depth', '1', '--no-tags', 'origin', want], dir, auth);
    await git(['checkout', '-q', '--detach', '--force', 'FETCH_HEAD'], dir);
  } catch (e) {
    if (!isSha(want)) throw e;
    // Server refused fetch-by-sha: take recent default-branch history and look for it there.
    await git(['fetch', '-q', '--depth', '300', '--no-tags', 'origin', 'HEAD'], dir, auth);
    try { await git(['checkout', '-q', '--detach', '--force', want], dir); fallback = 'found in last 300 commits of default branch'; }
    catch { await git(['checkout', '-q', '--detach', '--force', 'FETCH_HEAD'], dir); fallback = `sha ${want} not fetchable; using default branch head`; }
  }
  const sha = await git(['rev-parse', 'HEAD'], dir);
  const date = await git(['log', '-1', '--format=%cI'], dir).catch(() => null);
  const info = { project: project.toUpperCase(), repo, ref: want, sha, commitDate: date, fetchedAt: new Date().toISOString(), path: dir, fallback };
  fs.writeFileSync(path.join(await git(['rev-parse', '--absolute-git-dir'], dir), 'dt-ref.json'), JSON.stringify(info, null, 2));
  return info;
}

const NO_CHMOD = /core\.filemode|operation not permitted|chmod on|permission denied|could not (lock|write|set)|unable to (create|write)/i;

// A working repo in dir with origin = url. A broken .git (a half-done init) is removed and made again.
async function ensureRepo(dir, url, gitKey) {
  const dotgit = path.join(dir, '.git');
  if (fs.existsSync(dotgit)) {
    try {
      if (await git(['rev-parse', '--show-toplevel'], dir).then(t => path.resolve(t) === path.resolve(fs.realpathSync(dir)))) {
        await git(['remote', 'set-url', 'origin', url], dir).catch(() => git(['remote', 'add', 'origin', url], dir));
        return;
      }
    } catch {}
    fs.rmSync(dotgit, { recursive: true, force: true });
  }
  try {
    await git(['init', '-q'], dir);
    await git(['remote', 'add', 'origin', url], dir);
  } catch (e) {
    if (!NO_CHMOD.test(e.message)) throw e;
    // git cannot manage its files here: keep the git dir on local disk, the work tree stays in dir
    fs.rmSync(dotgit, { recursive: true, force: true });
    const gitDir = path.join(LOCAL_GIT, ...gitKey.split('/'));
    fs.rmSync(gitDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(gitDir), { recursive: true });
    try {
      await git(['init', '-q', `--separate-git-dir=${gitDir}`], dir);
      await git(['config', 'core.filemode', 'false'], dir);
      await git(['remote', 'add', 'origin', url], dir);
    } catch (e2) {
      throw new Error(`${e.message}; also with the git dir in ${gitDir}: ${e2.message}. git cannot write in ${dir}: run the containers as your user (run.sh sets DT_UID/DT_GID) or put the config folder on a local disk`);
    }
  }
}

// Try refs in order (e.g. tags for a library version), return the first that works.
async function fetchFirst(project, repo, refs, opts = {}) {
  let last;
  for (const ref of refs) {
    try { return await fetchRef(project, repo, ref, opts); } catch (e) { last = e; }
  }
  throw last;
}

module.exports = { fetchRef, fetchFirst, repoDir, REPOS, isSha, git };
