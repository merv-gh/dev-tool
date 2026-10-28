// Index of every Bitbucket repo: its root build files, first-level folders and the modules they declare
// (Maven <modules> with each module's artifactId, Gradle settings includes), in cache/bitbucket/_index.json.
// Libraries often live in a repo named "commons" or "starter" with the real names only on the folders
// inside; lookup() finds a library's repo and module from that, before any name guessing.
// Built by catalog_sync what=bitbucket (a job); repos indexed in the last maxAgeDays are kept.
const path = require('path');
const { CACHE, readJson, writeJson, pool } = require('./util');

const FILE = path.join(CACHE, 'bitbucket', '_index.json');
const norm = (s) => String(s || '').toLowerCase().replace(/[-_.]/g, '');
// the project's own tag: not the parent's, a dependency's or a plugin's
const own = (xml) => String(xml).replace(/<(parent|dependencies|dependencyManagement|build|profiles|reporting|modules)>[\s\S]*?<\/\1>/g, '');
const tag = (xml, name) => { const m = own(xml).match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`)); return m ? m[1] : null; };
const parentGroup = (xml) => { const m = String(xml).match(/<parent>[\s\S]*?<groupId>\s*([^<]*?)\s*<\/groupId>[\s\S]*?<\/parent>/); return m ? m[1] : null; };

function load() { return readJson(FILE, { builtAt: null, repos: [] }); }

// a small throttle of its own: indexing is many cheap requests, the 1/s chat limit would take hours
function throttle(perSec) {
  let next = 0;
  return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / perSec; if (at > now) await new Promise(r => setTimeout(r, at - now)); };
}

async function indexRepo(r, atl, wait) {
  const call = async (fn) => { await wait(); return fn(); };
  const raw = (p) => call(() => atl.file(r.project, r.repo, p)).catch(() => null);
  const children = await call(() => atl.browse(r.project, r.repo));
  const files = children.filter(c => c.type === 'FILE').map(c => c.name);
  const dirs = children.filter(c => c.type === 'DIRECTORY' && !c.name.startsWith('.')).map(c => c.name);
  const out = { project: r.project, repo: r.repo, root: files.filter(f => /^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|package\.json)$/.test(f)), dirs, modules: [] };
  let wanted = [];
  if (files.includes('pom.xml')) {
    const pom = await raw('pom.xml');
    if (pom) {
      out.self = { groupId: tag(pom, 'groupId') || parentGroup(pom), artifactId: tag(pom, 'artifactId') };
      wanted = [...pom.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map(m => m[1]);
    }
  }
  const settings = files.find(f => /^settings\.gradle(\.kts)?$/.test(f));
  if (settings) {
    const text = await raw(settings) || '';
    const name = text.match(/rootProject\.name\s*=\s*["']([^"']+)["']/);
    if (name) out.self = { ...(out.self || {}), artifactId: out.self?.artifactId || name[1] };
    for (const m of text.matchAll(/include\s*\(?([^\n)]*)/g)) for (const x of m[1].matchAll(/["']:?([^"']+)["']/g)) out.modules.push({ dir: x[1].replace(/:/g, '/'), artifactId: x[1].split(':').pop(), build: 'gradle' });
  }
  // no root build: independent projects side by side, each folder may have its own pom
  if (!out.root.length && dirs.length <= 30) wanted = dirs;
  for (const dir of wanted.slice(0, 40)) {
    const pom = await raw(`${dir}/pom.xml`);
    if (pom) out.modules.push({ dir, artifactId: tag(pom, 'artifactId'), groupId: tag(pom, 'groupId') || parentGroup(pom), build: 'maven' });
    else if (!out.modules.some(m => m.dir === dir)) out.modules.push({ dir, artifactId: null, build: null });
  }
  out.indexedAt = new Date().toISOString();
  return out;
}

async function build({ log = () => {}, force = false, only, perSec, maxAgeDays = 7, atl = require('./atlassian') } = {}) {
  const prev = load();
  const byKey = new Map(prev.repos.map(r => [`${r.project}/${r.repo}`, r]));
  let all = await atl.repos('');
  if (only && only.length) all = all.filter(r => only.some(o => `${r.project}/${r.repo}`.toLowerCase().includes(String(o).toLowerCase())));
  const fresh = (r) => r && !r.error && Date.now() - Date.parse(r.indexedAt) < maxAgeDays * 864e5;
  const todo = all.filter(r => force || !fresh(byKey.get(`${r.project}/${r.repo}`)));
  log(`bitbucket: ${all.length} repos, indexing ${todo.length}`);
  const wait = throttle(perSec || require('./config').getPersonal().indexRatePerSec || 8);
  let done = 0;
  const results = await pool(todo, 4, async (r) => {
    const x = await indexRepo(r, atl, wait);
    if (++done % 50 === 0) log(`bitbucket: ${done}/${todo.length}`);
    return x;
  });
  for (const r of results) byKey.set(`${r.item.project}/${r.item.repo}`, r.error ? { project: r.item.project, repo: r.item.repo, error: r.error.message, indexedAt: new Date().toISOString() } : r.value);
  // repos that are gone from Bitbucket leave the index (unless only some were refreshed)
  if (!only) for (const k of [...byKey.keys()]) if (!all.some(r => `${r.project}/${r.repo}` === k)) byKey.delete(k);
  const data = { builtAt: new Date().toISOString(), repos: [...byKey.values()].sort((a, b) => `${a.project}/${a.repo}`.localeCompare(`${b.project}/${b.repo}`)) };
  writeJson(FILE, data);
  const failed = results.filter(r => r.error).length;
  log(`bitbucket: ${data.repos.length} repos in the index, ${data.repos.reduce((n, r) => n + (r.modules || []).length, 0)} modules${failed ? `, ${failed} failed` : ''}`);
  return { repos: data.repos.length, indexed: todo.length - failed, failed, modules: data.repos.reduce((n, r) => n + (r.modules || []).length, 0) };
}

// Where a library (groupId, artifactId) lives: [{ project, repo, module, score, why }], best first
function lookup(dep, index = load()) {
  const a = dep.artifactId, na = norm(a);
  const out = [];
  for (const r of index.repos || []) {
    if (r.error) continue;
    const g = (x) => (dep.groupId && x && x === dep.groupId ? 5 : 0);
    const add = (score, module, why, group) => out.push({ project: r.project, repo: r.repo, module: module || null, score: score + g(group), why });
    for (const m of r.modules || []) {
      if (m.artifactId === a) add(100, m.dir, `module ${m.dir} declares ${a}`, m.groupId || r.self?.groupId);
      else if (m.dir === a || norm(m.dir.split('/').pop()) === na) add(85, m.dir, `folder ${m.dir}`, m.groupId || r.self?.groupId);
    }
    if (r.self?.artifactId === a) add(95, null, `${r.repo} is ${a}`, r.self.groupId);
    if (r.repo === a || norm(r.repo) === na) add(90, null, 'same name', r.self?.groupId);
    for (const d of r.dirs || []) {
      if (d === a) add(80, d, `folder ${d}`, r.self?.groupId);
      else if (d.length >= 3 && a.endsWith(`-${d}`) && !(r.modules || []).some(m => m.dir === d && m.artifactId && m.artifactId !== a)) add(50, d, `folder ${d} (${a} without its prefix)`, r.self?.groupId);
    }
  }
  const best = new Map();
  for (const c of out.sort((x, y) => y.score - x.score)) { const k = `${c.project}/${c.repo}/${c.module}`; if (!best.has(k)) best.set(k, c); }
  return [...best.values()];
}

// catalog.txt lines: "repo LIB/commons: modules acme-web-starter (acme-web-starter), audit (acme-audit-core); dirs ..."
function catalogLines() {
  return (load().repos || []).filter(r => !r.error).map(r => {
    const mods = (r.modules || []).map(m => (m.artifactId && m.artifactId !== m.dir ? `${m.dir} (${m.artifactId})` : m.dir));
    return `repo ${r.project}/${r.repo}${r.self?.artifactId ? ` ${r.self.groupId || ''}:${r.self.artifactId}` : ''}: ${mods.length ? `modules ${mods.join(', ')}; ` : ''}dirs ${(r.dirs || []).join(', ')}`;
  });
}

module.exports = { build, lookup, load, catalogLines, indexRepo, FILE };
