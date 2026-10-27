// Shallow fetch of one ref (branch, tag or sha) of a Bitbucket repo into repos/<PROJECT>/<repo>.
// The token goes in a per-command header (-c http.extraHeader), never into .git/config.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ROOT, getPersonal } = require('./config');

const REPOS = require('./config').PATHS.repos;

function git(args, cwd, extra = []) {
  return new Promise((resolve, reject) => {
    execFile('git', [...extra, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 64 << 20, timeout: 600000 }, (err, stdout, stderr) => {
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
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git(['init', '-q'], dir);
    await git(['remote', 'add', 'origin', url], dir);
  } else {
    await git(['remote', 'set-url', 'origin', url], dir);
  }
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
  fs.writeFileSync(path.join(dir, '.git', 'dt-ref.json'), JSON.stringify(info, null, 2));
  return info;
}

// Try refs in order (e.g. tags for a library version), return the first that works.
async function fetchFirst(project, repo, refs, opts = {}) {
  let last;
  for (const ref of refs) {
    try { return await fetchRef(project, repo, ref, opts); } catch (e) { last = e; }
  }
  throw last;
}

module.exports = { fetchRef, fetchFirst, repoDir, REPOS, isSha };
