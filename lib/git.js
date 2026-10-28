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
    require('./trace').child(execFile('git', ['-c', 'safe.directory=*', ...extra, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 64 << 20, timeout: 600000 }, (err, stdout, stderr) => {
      // name the git command, not its -c options
      const cmd = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c') || args[0];
      if (err) reject(new Error(`git ${cmd}: ${(stderr || err.message).trim().split('\n').slice(-3).join(' | ')}`));
      else resolve(stdout.trim());
    }));
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
  const T = require('./trace');
  const dir = opts.dir || repoDir(project, repo);
  const url = opts.url || remote(project, repo);
  const auth = authArgs(url);
  const where = `${project}/${repo}@${ref || 'default branch'}`;
  if (/^https?:/.test(url) && !auth.length) T.note(`no Bitbucket token: fetching ${url} without one`);
  fs.mkdirSync(dir, { recursive: true });
  await T.step('git init', () => ensureRepo(dir, url, opts.gitKey || `${project.toUpperCase()}/${repo}`), dir);
  const want = ref || 'HEAD';
  let fallback = null;
  const fetchHead = () => T.step('git fetch', () => git(['fetch', '-q', '--depth', '1', '--no-tags', 'origin', want], dir, auth), where);
  try {
    try { await fetchHead(); }
    catch (e) {
      // the local copy no longer fits the remote (a force-push or rebase moved the history its shallow
      // boundary is in): fetch into a fresh git dir. Missing refs, auth and network errors are not that.
      if (/couldn't find remote ref|not our ref|Authentication|403|401|Could not resolve|unable to access|timed out|Connection refused/i.test(e.message)) throw e;
      T.note(`the local copy of ${project}/${repo} did not match the remote any more (${e.message.split('\n')[0].slice(0, 100)}): fetched fresh`);
      const gitDir = await git(['rev-parse', '--absolute-git-dir'], dir).catch(() => path.join(dir, '.git'));
      fs.rmSync(gitDir, { recursive: true, force: true });
      fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
      await ensureRepo(dir, url, opts.gitKey || `${project.toUpperCase()}/${repo}`);
      await fetchHead();
    }
    await T.step('git checkout', () => git(['checkout', '-q', '--detach', '--force', 'FETCH_HEAD'], dir));
  } catch (e) {
    if (!isSha(want)) throw new Error(`${e.message} (${where} from ${url.replace(/\/\/[^@/]*@/, '//***@')})`);
    // Server refused fetch-by-sha: take recent default-branch history and look for it there.
    T.note(`fetching ${want} by sha was refused: looking for it in the last 300 commits of the default branch`);
    await T.step('git fetch (300 commits)', () => git(['fetch', '-q', '--depth', '300', '--no-tags', 'origin', 'HEAD'], dir, auth), where);
    try { await git(['checkout', '-q', '--detach', '--force', want], dir); fallback = 'found in last 300 commits of default branch'; }
    catch { await git(['checkout', '-q', '--detach', '--force', 'FETCH_HEAD'], dir); fallback = `sha ${want} not fetchable; using default branch head`; T.note(fallback); }
  }
  const sha = await git(['rev-parse', 'HEAD'], dir);
  const date = await git(['log', '-1', '--format=%cI'], dir).catch(() => null);
  const info = { project: project.toUpperCase(), repo, ref: want, sha, commitDate: date, fetchedAt: new Date().toISOString(), path: dir, fallback };
  fs.writeFileSync(path.join(await git(['rev-parse', '--absolute-git-dir'], dir), 'dt-ref.json'), JSON.stringify(info, null, 2));
  return info;
}

const NO_CHMOD = /core\.filemode|operation not permitted|chmod on|permission denied|could not (lock|write|set)|unable to (create|write)/i;

// Can git manage its files in this folder? (Windows drives under WSL, SMB, some Docker/Colima mounts
// cannot chmod.) Tested once per parent folder by changing the mode of a scratch file.
const chmodWorks = new Map();
function canChmod(dir) {
  const parent = path.dirname(path.resolve(dir));
  if (chmodWorks.has(parent)) return chmodWorks.get(parent);
  let ok = true;
  try {
    fs.mkdirSync(parent, { recursive: true });
    const f = path.join(parent, `.dt-chmod-${process.pid}`);
    fs.writeFileSync(f, 'x', { mode: 0o644 });
    try { fs.chmodSync(f, 0o755); ok = (fs.statSync(f).mode & 0o777) === 0o755; } catch { ok = false; }
    fs.rmSync(f, { force: true });
  } catch { ok = false; }
  chmodWorks.set(parent, ok);
  if (!ok) require('./trace').note(`git cannot chmod in ${parent}: git data of its repos goes to ${LOCAL_GIT} (said once; set DT_GIT_DIR to a lasting place, compose uses a volume)`);
  return ok;
}

// git keeps its data on local disk (DT_GIT_DIR), the files stay in dir
async function initSeparate(dir, url, gitKey) {
  const gitDir = path.join(LOCAL_GIT, ...gitKey.split('/'));
  fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
  fs.rmSync(gitDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(gitDir), { recursive: true });
  try {
    await git(['init', '-q', `--separate-git-dir=${gitDir}`], dir);
    await git(['config', 'core.filemode', 'false'], dir);
    await git(['remote', 'add', 'origin', url], dir);
  } catch (e) {
    throw new Error(`git cannot set up ${dir} with its data in ${gitDir}: ${e.message}. Run the containers as your user (run.sh sets DT_UID/DT_GID), make DT_GIT_DIR writable, or put the config folder on a local disk`);
  }
}

// A working repo in dir with origin = url. A broken .git (a half-done init, git data that is gone) is made again.
async function ensureRepo(dir, url, gitKey) {
  const dotgit = path.join(dir, '.git');
  if (fs.existsSync(dotgit)) {
    try {
      if (await git(['rev-parse', '--show-toplevel'], dir).then(t => path.resolve(t) === path.resolve(fs.realpathSync(dir)))) {
        await git(['remote', 'set-url', 'origin', url], dir).catch(() => git(['remote', 'add', 'origin', url], dir));
        return;
      }
    } catch {}
    // a pointer to git data that is gone (DT_GIT_DIR was in /tmp of a restarted container) is not news
    const pointer = fs.statSync(dotgit).isFile();
    if (!pointer) require('./trace').note(`${dir}: a broken .git was replaced`);
    fs.rmSync(dotgit, { recursive: true, force: true });
  }
  if (!canChmod(dir)) return initSeparate(dir, url, gitKey);
  try {
    await git(['init', '-q'], dir);
    await git(['remote', 'add', 'origin', url], dir);
  } catch (e) {
    if (!NO_CHMOD.test(e.message)) throw e;
    chmodWorks.set(path.dirname(path.resolve(dir)), false);
    require('./trace').note(`git cannot chmod in ${dir} (${e.message.slice(0, 120)}): its git data goes to ${LOCAL_GIT}`);
    await initSeparate(dir, url, gitKey);
  }
}

// The commit a ref points to on the remote (one round trip, no objects)
async function remoteSha(url, ref) {
  if (isSha(ref)) return ref;
  const out = await git(['ls-remote', url, ref || 'HEAD'], process.cwd(), authArgs(url));
  const lines = out.split('\n').filter(Boolean).map(l => l.split('\t'));
  const hit = lines.find(([, r]) => r === (ref ? `refs/heads/${ref}` : 'HEAD')) || lines.find(([, r]) => r === `refs/tags/${ref}^{}`) || lines.find(([, r]) => r === `refs/tags/${ref}`) || lines[0];
  if (!hit) throw new Error(`git ls-remote: no ${ref || 'HEAD'} in ${url.replace(/\/\/[^@/]*@/, '//***@')}`);
  return hit[0];
}

// The commit of a local copy, only if the folder is a repo of its own and a copy of the same remote: a
// .git pointer to git data that is gone makes git walk up to a parent repo (dt's own folder), and that
// is not the copy.
async function headOf(dir, url) {
  try {
    const top = await git(['rev-parse', '--show-toplevel'], dir);
    if (path.resolve(top) !== path.resolve(fs.realpathSync(dir))) return null;
    const origin = await git(['remote', 'get-url', 'origin'], dir).catch(() => '');
    const same = (u) => String(u).replace(/\/\/[^@/]*@/, '//').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
    if (url && origin && same(origin) !== same(url)) return null;
    return await git(['rev-parse', 'HEAD'], dir);
  } catch { return null; }
}

// fetchRef, but taking the commit from a local checkout that has it (the passport's repos/ copy, another
// workspace): no download. sources: folders to look in. When Bitbucket cannot be asked, the newest local
// copy is used and the call says so.
async function fetchReusing(project, repo, ref, opts = {}) {
  const T = require('./trace');
  const url = opts.url || remote(project, repo);
  const sources = (opts.sources || []).filter(d => d && d !== opts.dir && fs.existsSync(d));
  if (!sources.length) return fetchRef(project, repo, ref, opts);
  let want = null, offline = null;
  try { want = await T.step('git ls-remote', () => remoteSha(url, ref), `${project}/${repo}@${ref || 'default branch'}`); }
  catch (e) { offline = e; }
  let source = null;
  for (const d of sources) { const h = await headOf(d, url); if (h && (want ? h === want : true)) { source = { dir: d, sha: h }; break; } }
  if (!source) {
    if (offline) throw offline;
    return fetchRef(project, repo, ref, opts);
  }
  if (offline) T.note(`Bitbucket did not answer (${offline.message.slice(0, 160)}): using the copy in ${source.dir} (${source.sha.slice(0, 10)}), which may be behind`);
  else T.note(`reusing ${source.sha.slice(0, 10)} from ${source.dir}: nothing downloaded`);
  const dir = opts.dir || repoDir(project, repo);
  fs.mkdirSync(dir, { recursive: true });
  await T.step('git init', () => ensureRepo(dir, url, opts.gitKey || `${project.toUpperCase()}/${repo}`), dir);
  try {
    await T.step('git fetch (local)', () => git(['-c', 'protocol.file.allow=always', 'fetch', '-q', '--depth', '1', '--no-tags', path.resolve(source.dir), 'HEAD'], dir), source.dir);
    await T.step('git checkout', () => git(['checkout', '-q', '--detach', '--force', 'FETCH_HEAD'], dir));
  } catch (e) {
    // the local copy cannot be read after all: from Bitbucket, as without it
    if (offline) throw new Error(`Bitbucket did not answer (${offline.message.slice(0, 200)}) and the local copy in ${source.dir} cannot be read (${e.message.slice(0, 200)})`);
    T.note(`the local copy in ${source.dir} cannot be read (${e.message.slice(0, 160)}): fetching from Bitbucket`);
    return fetchRef(project, repo, ref, opts);
  }
  const sha = await git(['rev-parse', 'HEAD'], dir);
  const date = await git(['log', '-1', '--format=%cI'], dir).catch(() => null);
  const info = { project: project.toUpperCase(), repo, ref: ref || 'HEAD', sha, commitDate: date, fetchedAt: new Date().toISOString(), path: dir, fallback: offline ? `Bitbucket unreachable: local copy ${source.dir}` : null, reusedFrom: source.dir };
  fs.writeFileSync(path.join(await git(['rev-parse', '--absolute-git-dir'], dir), 'dt-ref.json'), JSON.stringify(info, null, 2));
  return info;
}

// The tags and branches of a remote repo (one round trip): { tags: Set, heads: Set }
async function remoteRefs(project, repo, opts = {}) {
  const url = opts.url || remote(project, repo);
  const out = await git(['ls-remote', '--tags', '--heads', url], process.cwd(), authArgs(url));
  const tags = new Set(), heads = new Set();
  for (const l of out.split('\n')) {
    const r = (l.split('\t')[1] || '').trim();
    if (r.startsWith('refs/tags/')) tags.add(r.slice(10).replace(/\^\{\}$/, ''));
    else if (r.startsWith('refs/heads/')) heads.add(r.slice(11));
  }
  return { tags, heads };
}

// Try refs in order (e.g. tags for a library version), return the first that works.
async function fetchFirst(project, repo, refs, opts = {}) {
  let last;
  for (const ref of refs) {
    try { return await fetchRef(project, repo, ref, opts); } catch (e) { last = e; }
  }
  throw last;
}

module.exports = { fetchRef, fetchReusing, remoteSha, remoteRefs, fetchFirst, repoDir, REPOS, isSha, git, remote, authArgs };
