// Workspaces: a writable checkout of a repo at a branch, tag or commit (work/<id>), where generated
// tests and fixes are written and run. Nothing is committed or pushed: the result is a patch against
// the fetched commit (git apply). Each workspace has its own code index (cache/code/work/<id>).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('./config');
const { CACHE, readJson, writeJson } = require('./util');
const G = require('./git');

const WORK = PATHS.work;
const META = path.join(CACHE, 'work');
const metaFile = (id) => path.join(META, `${id}.json`);
const BUILD_OUTPUT = ['target/', 'build/', '.gradle/', 'out/', '*.class', '.idea/', 'bin/'];

function checkId(id) {
  if (!/^[\w.-]+$/.test(id || '')) throw new Error(`bad workspace id "${id}"`);
  const m = readJson(metaFile(id));
  if (!m) throw new Error(`no workspace "${id}" (workspace_list shows them)`);
  return m;
}

// service (resolved like passports) or project + repo; ref: branch, tag or sha (default branch if empty);
// env: the commit deployed there. url: another remote (tests use file:// repos).
// libraries: also fetch and index the internal libraries it depends on (their code is part of its flows);
// git: the git module for them (tests pass one that reads local repos)
async function open({ service, project, repo, ref, env, url, libraries = true, git, fresh = false } = {}) {
  const T = require('./trace');
  if (service && !(project && repo)) {
    const pp = require('./passport');
    const r = await T.step('resolve repo', () => pp.resolveRepo(service, project && repo ? `${project}/${repo}` : undefined), service);
    project = r.project; repo = r.repo;
    if (env && !ref) ref = await T.step('deployed commit', async () => (await pp.deployedSha(env, service)).sha, env);
  }
  if (!project || !repo) throw new Error('give service, or project and repo');
  // the same repo and ref opened earlier in this chat: that workspace, with its changes and its prepared build
  const session = T.current()?.session;
  if (session && !fresh) {
    const mine = list().map(w => readJson(metaFile(w.id))).find(w => w && w.session === session && w.project === project.toUpperCase() && w.repo === repo && (w.ref || null) === (ref || null) && fs.existsSync(w.path));
    if (mine) {
      T.note(`reusing workspace ${mine.id} opened earlier in this chat (fresh=true for a new checkout)`);
      touch(mine.id);
      const index = W().index(mine.id);
      return { ...mine, reused: true, path: path.relative(require('./config').HOME, mine.path), files: index.files, classes: index.classes, build: buildFiles(mine.path) };
    }
  }
  const slug = String(ref || 'default').replace(/[^\w.-]+/g, '-').slice(0, 40);
  const id = `${repo}-${slug}-${crypto.randomBytes(2).toString('hex')}`;
  const dir = path.join(WORK, id);
  fs.mkdirSync(dir, { recursive: true });
  // the commit may be here already: the passport's checkout, other workspaces of the repo
  const sources = [G.repoDir(project, repo), ...list().map(w => readJson(metaFile(w.id))).filter(w => w && w.project === project.toUpperCase() && w.repo === repo && fs.existsSync(w.path)).map(w => w.path)];
  let info;
  try { info = await G.fetchReusing(project, repo, ref, { dir, url, gitKey: `work/${id}`, sources }); }
  catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  // build output never goes into the patch
  try {
    const gitDir = await G.git(['rev-parse', '--absolute-git-dir'], dir);
    fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
    fs.appendFileSync(path.join(gitDir, 'info', 'exclude'), `\n# dt workspace\n${BUILD_OUTPUT.join('\n')}\n`);
  } catch {}
  const meta = { id, project: info.project, repo, ref: ref || null, sha: info.sha, commitDate: info.commitDate, service: service || null, env: env || null, path: dir, createdAt: new Date().toISOString(), usedAt: new Date().toISOString(), session: session || null, fallback: info.fallback || undefined, reusedFrom: info.reusedFrom ? path.relative(require('./config').HOME, info.reusedFrom) : undefined };
  meta.libs = [];
  if (libraries) {
    const ex = require('./passport/extract').extract(dir, { internalGroups: require('./config').getPersonal().internalGroups });
    const libs = await T.step('libraries', () => require('./passport').fetchLibraries(ex.dependencies.internal, git || G), ex.dependencies.internal.map(d => d.artifactId).join(', ') || 'none');
    for (const l of libs) if (l.error) T.note(`library ${l.artifactId}: ${l.error.slice(0, 200)}`);
    meta.libs = libs.map(l => ({ artifactId: l.artifactId, version: l.version || null, repo: l.repo || null, module: l.module || null, ref: l.ref || null, index: l.index || null, found: l.found, error: l.error }));
  }
  writeJson(metaFile(id), meta);
  const index = reindex(id);
  return { ...meta, path: path.relative(require('./config').HOME, dir), files: index.files, classes: index.classes, build: buildFiles(dir) };
}

function reindex(id) {
  const m = checkId(id);
  const r = require('./codeindex').build(m.path, `work/${id}`, { project: m.project, repo: m.repo, ref: m.ref, sha: m.sha, workspace: id });
  m.indexedAt = r.builtAt; m.dirty = false;
  writeJson(metaFile(id), m);
  return r;
}

// The index, rebuilt first when files were written since
function index(id) {
  const m = checkId(id);
  if (m.dirty || !require('./codeindex').load(`work/${id}`)) reindex(id);
  return require('./codeindex').load(`work/${id}`);
}

// The code indexes a workspace's flows span: its own and its libraries'
function keys(id) {
  const m = checkId(id);
  index(id);
  return [`work/${id}`, ...(m.libs || []).map(l => l.index).filter(Boolean)];
}

const W = () => module.exports;

// last use: workspaces unused for tests.workspaceDays are removed
function touch(id) {
  const m = readJson(metaFile(id));
  if (m) { m.usedAt = new Date().toISOString(); writeJson(metaFile(id), m); }
}

function list() {
  let files = [];
  // only workspace files: <id>.json, not the runs, fast-run state and results kept next to them
  try { files = fs.readdirSync(META).filter(f => f.endsWith('.json') && !/\.(fast|runs|results-[\w]+)\.json$/.test(f)); } catch {}
  return files.map(f => readJson(path.join(META, f))).filter(m => m && m.id && m.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(m => ({ id: m.id, repo: `${m.project}/${m.repo}`, ref: m.ref, sha: m.sha?.slice(0, 12), service: m.service, createdAt: m.createdAt, exists: fs.existsSync(m.path) }));
}

function resolvePath(m, rel) {
  const r = String(rel || '').replace(/^\/+/, '');
  const full = path.resolve(m.path, r);
  if (!full.startsWith(path.resolve(m.path) + path.sep)) throw new Error(`path outside the workspace: ${rel}`);
  if (/(^|[\\/])\.git([\\/]|$)/.test(r)) throw new Error('the .git folder is off limits');
  return { full, rel: path.relative(m.path, full).split(path.sep).join('/') };
}

function read(id, rel, { from = 1, to } = {}) {
  const m = checkId(id);
  const { full, rel: r } = resolvePath(m, rel);
  if (!fs.existsSync(full)) throw new Error(`no file ${r} in ${id}`);
  if (fs.statSync(full).isDirectory()) return { id, path: r, entries: fs.readdirSync(full, { withFileTypes: true }).map(e => e.name + (e.isDirectory() ? '/' : '')).sort() };
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const end = Math.min(lines.length, to || from + 399);
  return { id, path: r, from, to: end, lines: lines.length, text: lines.slice(from - 1, end).map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n') };
}

// content: the whole file; or edits: [{ find, replace }] applied in order, each find must match once
function write(id, rel, { content, edits } = {}) {
  const m = checkId(id);
  const { full, rel: r } = resolvePath(m, rel);
  let text;
  const existed = fs.existsSync(full);
  if (edits && edits.length) {
    if (!existed) throw new Error(`no file ${r} to edit (give content to create it)`);
    text = fs.readFileSync(full, 'utf8');
    for (const [i, e] of edits.entries()) {
      const n = e.find ? text.split(e.find).length - 1 : 0;
      if (n !== 1) throw new Error(`edit ${i + 1}: "find" must match exactly once in ${r}, matched ${n} times${n === 0 ? ' (read the file again: it may have changed)' : ''}`);
      text = text.replace(e.find, () => e.replace ?? '');
    }
  } else if (typeof content === 'string') text = content;
  else throw new Error('give content, or edits');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  m.dirty = true;
  m.usedAt = new Date().toISOString();
  writeJson(metaFile(id), m);
  return { id, path: r, created: !existed, bytes: Buffer.byteLength(text), lines: text.split('\n').length };
}

// Unified diff of everything changed and added since the fetched commit; also kept as work meta <id>.patch
async function patch(id) {
  const m = checkId(id);
  await G.git(['add', '-A', '-N', '.'], m.path).catch(() => {});
  const diff = await G.git(['-c', 'core.quotepath=off', 'diff', '--binary', '--no-color', '--no-ext-diff', 'HEAD'], m.path);
  const stat = await G.git(['-c', 'core.quotepath=off', 'diff', '--numstat', 'HEAD'], m.path);
  const files = stat.split('\n').filter(Boolean).map(l => { const [a, d, p] = l.split('\t'); return { path: p, added: Number(a) || 0, removed: Number(d) || 0 }; });
  for (const f of files) f.status = (diff.includes(`diff --git a/${f.path} b/${f.path}\nnew file mode`) ? 'added' : 'modified');
  const text = diff ? diff + '\n' : '';
  fs.writeFileSync(path.join(META, `${id}.patch`), text);
  return { id, repo: `${m.project}/${m.repo}`, base: m.sha, ref: m.ref, files, patch: text, apply: `git checkout ${m.sha.slice(0, 12)} && git apply --index ${id}.patch` };
}

async function drop(id) {
  const m = checkId(id);
  fs.rmSync(m.path, { recursive: true, force: true });
  fs.rmSync(path.join(process.env.DT_GIT_DIR || path.join(require('os').tmpdir(), 'dt-git'), 'work', id), { recursive: true, force: true });
  require('./codeindex').remove(`work/${id}`);
  for (const f of [metaFile(id), path.join(META, `${id}.patch`)]) fs.rmSync(f, { force: true });
  return { dropped: id };
}

// Build files of the workspace: the root and modules (pom.xml, build.gradle[.kts], settings)
function buildFiles(dir) {
  const out = [];
  (function rec(d, depth) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) { if (depth < 4 && !/^(\.|target$|build$|node_modules$|src$)/.test(e.name)) rec(path.join(d, e.name), depth + 1); continue; }
      if (/^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|mvnw|gradlew)$/.test(e.name)) out.push(path.relative(dir, path.join(d, e.name)).split(path.sep).join('/'));
    }
  })(dir, 0);
  return out.sort();
}

// Remove workspaces not used for tests.workspaceDays (default 7)
async function sweep() {
  const days = require('./config').getTests().workspaceDays;
  const out = [];
  for (const w of list()) {
    const m = readJson(metaFile(w.id));
    if (!m) continue;
    const used = Date.parse(m.usedAt || m.createdAt);
    if (Date.now() - used > days * 864e5) { await drop(m.id).catch(() => {}); out.push(m.id); }
  }
  return out;
}

module.exports = { open, sweep, touch, keys, list, read, write, patch, drop, reindex, index, checkId, resolvePath, buildFiles, WORK };
