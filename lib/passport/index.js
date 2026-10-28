// Service passports: build (fetch code, extract, follow internal libraries), save, list, search.
// passports/<service>/passport.json   machine-readable, what tools and the page use
// passports/<service>/passport.md     the same for people and grep
// passports/<service>/history/*.json  earlier versions; `changes` says what moved since the last one
// passports/_repos.json               service -> Bitbucket repo, once resolved or set by hand
const fs = require('fs');
const path = require('path');
const { ROOT, getPersonal } = require('../config');
const { readJson, writeJson } = require('../util');
const limit = require('../limit');
const { extract } = require('./extract');

const DIR = require('../config').PATHS.passports;
const MAX_LIBS = 25;
const safe = (s) => String(s).replace(/[^\w.@-]/g, '_');
const file = (service) => path.join(DIR, safe(service), 'passport.json');

function load(service) { return readJson(file(service)); }

function repoMap() { return readJson(path.join(DIR, '_repos.json'), {}); }
function rememberRepo(service, project, repo) {
  const m = repoMap();
  m[service] = { project, repo };
  writeJson(path.join(DIR, '_repos.json'), m);
}

async function bb(fn) { await limit.take('bitbucket'); return fn(); }

// service name -> Bitbucket repo. Exact slug wins; otherwise common suffix variations; ambiguity is an error with candidates.
async function resolveRepo(service, explicit) {
  if (explicit) {
    const [project, repo] = explicit.split('/');
    if (!project || !repo) throw new Error(`repo must be PROJECT/slug, got "${explicit}"`);
    return { project: project.toUpperCase(), repo };
  }
  const known = repoMap()[service];
  if (known) return known;
  const atl = require('../atlassian');
  const base = service.replace(/-(service|svc|app)$/, '');
  const found = await bb(() => atl.repos(base));
  const norm = (s) => s.toLowerCase().replace(/[-_]/g, '');
  const exact = found.filter(r => r.repo === service);
  const close = found.filter(r => [service, base, `${base}-service`].map(norm).includes(norm(r.repo)));
  const pick = exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : found.length === 1 ? found[0] : null;
  if (!pick) {
    const list = found.slice(0, 15).map(r => `${r.project}/${r.repo}`);
    throw new Error(found.length ? `Several repos match "${service}": ${list.join(', ')}. Call again with repo="PROJECT/slug".` : `No Bitbucket repo matches "${service}". Pass repo="PROJECT/slug".`);
  }
  return { project: pick.project, repo: pick.repo };
}

// Deployed commit from Consul: /version of a passing instance (JSON git info or any sha-looking string).
async function deployedSha(env, service) {
  await limit.take(`consul:${env}`);
  const info = await require('../consul').service(env, service);
  if (!info.instances) throw new Error(`Consul: "${service}" not found in ${env}${info.matches?.length ? ` (did you mean ${info.matches.slice(0, 5).join(', ')}?)` : ''}`);
  for (const i of info.instances) {
    if (!i.version) continue;
    let sha = null;
    try {
      const j = JSON.parse(i.version);
      const flat = JSON.stringify(j);
      sha = (flat.match(/"(?:git\.commit\.id(?:\.full)?|commit(?:Id|Hash|_id)?|sha|revision|gitCommit|id)"\s*:\s*"([0-9a-f]{7,40})"/i) || [])[1];
    } catch {}
    sha = sha || (i.version.match(/\b[0-9a-f]{40}\b/) || i.version.match(/\b[0-9a-f]{7,12}\b/) || [])[0];
    if (sha) return { sha, instance: `${i.address}:${i.port}`, version: i.version.slice(0, 300) };
  }
  throw new Error(`No git sha in /version of ${service} in ${env}`);
}

const keyOf = {
  endpoints: (e) => `${e.method} ${e.path}`,
  consumes: (c) => c.topic,
  produces: (c) => c.topic,
  tables: (t) => `${t.table} (${t.access})`,
  calls: (f) => `${f.client} ${f.method} ${f.path}`,
  dependencies: (d) => `${d.groupId}:${d.artifactId}@${d.version || '?'}`,
};

function sets(p) {
  const e = p.effective;
  return {
    endpoints: new Set(e.endpoints.map(keyOf.endpoints)),
    consumes: new Set(e.consumes.map(keyOf.consumes)),
    produces: new Set(e.produces.map(keyOf.produces)),
    tables: new Set(e.tables.map(keyOf.tables)),
    calls: new Set(e.calls.map(keyOf.calls)),
    dependencies: new Set([...p.dependencies.internal, ...p.dependencies.external].map(keyOf.dependencies)),
  };
}

function diff(prev, next) {
  if (!prev) return null;
  const a = sets(prev), b = sets(next), out = { fromSha: prev.repo?.sha, toSha: next.repo?.sha };
  let any = false;
  for (const k of Object.keys(b)) {
    const added = [...b[k]].filter(x => !a[k].has(x)), removed = [...a[k]].filter(x => !b[k].has(x));
    if (added.length || removed.length) { out[k] = { added, removed }; any = true; }
  }
  out.none = !any;
  return out;
}

const uniqBy = (arr, f) => { const s = new Set(); return arr.filter(x => { const k = f(x); if (s.has(k)) return false; s.add(k); return true; }); };

// Repo names a library may live in, best first: an explicit mapping (passports.libraryRepos), the
// artifact itself, shorter names (acme-starter-kafka -> acme-starter, a module of a bigger repo), the name
// without the usual suffixes, and the end of the groupId (com.acme.platform -> platform).
const SUFFIXES = /-(spring-boot-starter|boot-starter|starter|autoconfigure|auto-configure|core|api|client|common|commons|lib|library|module|parent|bom)$/;
function libraryRepoNames(dep) {
  const a = dep.artifactId;
  const names = [a];
  const parts = a.split('-');
  for (let n = parts.length - 1; n >= 1; n--) { const x = parts.slice(0, n).join('-'); if (x.length >= 3) names.push(x); }
  let stripped = a;
  while (SUFFIXES.test(stripped)) { stripped = stripped.replace(SUFFIXES, ''); names.push(stripped); }
  const g = String(dep.groupId || '').split('.');
  if (g.length >= 3) names.push(g.slice(-1)[0], g.slice(-2).join('-'));
  return [...new Set(names.filter(x => x && x.length >= 3))];
}

// passports.libraryRepos: { "acme-starter-*": "LIB/acme-starter", "com.acme.platform:*": "PLAT/platform" }
function mappedRepo(dep) {
  const map = getPersonal().libraryRepos || {};
  const glob = (g) => new RegExp(`^${String(g).split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  for (const [pat, repo] of Object.entries(map)) {
    const hit = pat.includes(':') ? glob(pat).test(`${dep.groupId}:${dep.artifactId}`) : glob(pat).test(dep.artifactId);
    if (hit) { const [project, slug] = String(repo).split('/'); if (project && slug) return { project: project.toUpperCase(), repo: slug, via: `passports.libraryRepos "${pat}"` }; }
  }
  return null;
}

async function findLibraryRepo(dep, searches) {
  const mapped = mappedRepo(dep);
  if (mapped) return mapped;
  const atl = require('../atlassian');
  const norm = (x) => x.toLowerCase().replace(/[-_.]/g, '');
  const tried = [];
  for (const name of libraryRepoNames(dep)) {
    if (!searches.has(name)) searches.set(name, await bb(() => atl.repos(name)));
    const found = searches.get(name);
    tried.push(name);
    const hit = found.find(r => r.repo === name) || found.find(r => norm(r.repo) === norm(name));
    if (hit) return { project: hit.project, repo: hit.repo, via: name === dep.artifactId ? 'same name' : `repo "${hit.repo}" (module of a bigger repo?)` };
  }
  const candidates = [...new Set(tried.flatMap(n => searches.get(n) || []).map(r => `${r.project}/${r.repo}`))].slice(0, 8);
  const err = new Error(`no Bitbucket repo for ${dep.artifactId} (tried ${tried.join(', ')})${candidates.length ? `; similar: ${candidates.join(', ')}` : ''}. Map it in config.json: passports.libraryRepos { "${dep.artifactId}": "PROJECT/repo" }`);
  err.candidates = candidates;
  throw err;
}

// The folder of a module inside a repo: its pom.xml declares the artifactId, or its Gradle build sets it
// (archivesBaseName / base.archivesName), or the folder is named like it (with or without the repo prefix).
function findModule(root, artifactId, repoName) {
  const short = repoName && artifactId.startsWith(`${repoName}-`) ? artifactId.slice(repoName.length + 1) : null;
  const hits = [];
  const visit = (dir, depth) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = new Set(ents.map(e => e.name));
    const rel = path.relative(root, dir).split(path.sep).join('/');
    if (names.has('pom.xml')) {
      const self = require('./extract').parsePom(fs.readFileSync(path.join(dir, 'pom.xml'), 'utf8')).self;
      if (self.artifactId === artifactId) hits.push({ dir: rel, score: 3 });
    }
    const gradle = ['build.gradle', 'build.gradle.kts'].find(n => names.has(n));
    if (gradle) {
      const text = fs.readFileSync(path.join(dir, gradle), 'utf8');
      const named = text.match(/archivesBaseName\s*=\s*["']([^"']+)["']|archivesName(?:\.set\()?\s*[=(]?\s*["']([^"']+)["']/);
      if (named && (named[1] || named[2]) === artifactId) hits.push({ dir: rel, score: 3 });
      else if (rel && (path.basename(dir) === artifactId)) hits.push({ dir: rel, score: 2 });
      else if (rel && short && path.basename(dir) === short) hits.push({ dir: rel, score: 1 });
    }
    if (depth < 4) for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.') && !['src', 'target', 'build', 'node_modules', 'gradle', 'out'].includes(e.name)) visit(path.join(dir, e.name), depth + 1);
  };
  visit(root, 0);
  hits.sort((a, b) => b.score - a.score || a.dir.length - b.dir.length);
  return hits.length ? hits[0].dir : null;
}

// file paths from a module's extract are relative to the module: make them relative to the repo
function underModule(x, mod) {
  if (!mod) return x;
  if (Array.isArray(x)) return x.map(v => underModule(v, mod));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'file' && typeof v === 'string' && v !== 'config' ? `${mod}/${v}` : underModule(v, mod)]));
  return x;
}

async function fetchLibrary(dep, git, searches = new Map()) {
  let repo;
  try { repo = await findLibraryRepo(dep, searches); } catch (e) { return { ...dep, error: e.message, candidates: e.candidates || [] }; }
  const v = dep.version && !/\$/.test(dep.version) ? dep.version : null;
  const refs = v ? [`v${v}`, v, `${dep.artifactId}-${v}`, `${repo.repo}-${v}`, `release/${v}`, undefined] : [undefined];
  await limit.take('bitbucket');
  const info = await git.fetchFirst(repo.project, repo.repo, refs);
  const mod = findModule(info.path, dep.artifactId, repo.repo);
  const notes = [];
  if (!mod && repo.repo !== dep.artifactId) notes.push(`no module declaring ${dep.artifactId} found in ${repo.repo}: read the whole repo`);
  if (dep.version && /\$/.test(dep.version)) notes.push(`version ${dep.version} could not be resolved: used the default branch`);
  const ex = underModule(extract(mod ? path.join(info.path, mod) : info.path, { internalGroups: getPersonal().internalGroups }), mod);
  return {
    ...dep, repo: `${repo.project}/${repo.repo}`, ...(mod ? { module: mod } : {}), found: repo.via, ref: info.ref, sha: info.sha,
    exactVersion: !!v && info.ref !== 'HEAD', path: path.relative(ROOT, mod ? path.join(info.path, mod) : info.path),
    ...(notes.length ? { note: notes.join('; ') } : {}),
    endpoints: ex.endpoints, feign: ex.feign, consumes: ex.kafka.consumes, produces: ex.kafka.produces, tables: ex.db.tables, dbCalls: ex.db.calls || [],
    internal: ex.dependencies.internal,
  };
}

async function build(service, { repo, ref, env, libraries = true, graph = false, gitImpl, rebuildCatalog = true } = {}) {
  const git = gitImpl || require('../git');
  const started = Date.now();
  const target = await resolveRepo(service, repo);
  let deployed = null;
  if (!ref && env) { deployed = await deployedSha(env, service); ref = deployed.sha; }
  await limit.take('bitbucket');
  const info = await git.fetchRef(target.project, target.repo, ref);
  rememberRepo(service, target.project, target.repo);
  const ex = extract(info.path, { internalGroups: getPersonal().internalGroups });

  // Internal libraries, transitively (a library's own internal deps), shallow, at their versions.
  const libs = [];
  if (libraries) {
    const queue = [...ex.dependencies.internal];
    const seen = new Set();
    const searches = new Map(); // Bitbucket name searches, shared by all libraries of this build
    while (queue.length && libs.length < MAX_LIBS) {
      const d = queue.shift();
      const k = `${d.groupId}:${d.artifactId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      try {
        const lib = await fetchLibrary(d, git, searches);
        libs.push(lib);
        for (const sub of lib.internal || []) queue.push({ ...sub, via: d.artifactId });
      } catch (e) { libs.push({ ...d, error: e.message }); }
    }
  }
  const from = (lib) => (x) => ({ ...x, source: lib.artifactId });
  const effective = {
    endpoints: [...ex.endpoints, ...libs.flatMap(l => (l.endpoints || []).map(from(l)))],
    consumes: [...ex.kafka.consumes, ...libs.flatMap(l => (l.consumes || []).map(from(l)))],
    produces: [...ex.kafka.produces, ...libs.flatMap(l => (l.produces || []).map(from(l)))],
    tables: [...ex.db.tables, ...libs.flatMap(l => (l.tables || []).map(from(l)))].filter(t => t.table),
    calls: [...ex.feign, ...libs.flatMap(l => (l.feign || []).map(from(l)))],
    // SQL function/procedure call candidates; the Postgres index keeps the ones that exist
    dbCalls: [...(ex.db.calls || []), ...libs.flatMap(l => (l.dbCalls || []).map(from(l)))],
  };
  const tablesByName = {};
  for (const t of effective.tables) (tablesByName[t.table] ??= new Set()).add(t.access);

  const passport = {
    service, env: env || null, builtAt: new Date().toISOString(),
    repo: { project: info.project, repo: info.repo, ref: info.ref, sha: info.sha, commitDate: info.commitDate, fallback: info.fallback, path: path.relative(ROOT, info.path) },
    deployed,
    ...ex,
    libraries: libs.map(({ endpoints, feign, consumes, produces, tables, dbCalls, internal, ...l }) => ({
      ...l, provides: { endpoints: endpoints?.length || 0, consumes: consumes?.length || 0, produces: produces?.length || 0, tables: tables?.length || 0, calls: feign?.length || 0 },
    })),
    effective,
    summary: {
      endpoints: uniqBy(effective.endpoints, keyOf.endpoints).length,
      consumes: [...new Set(effective.consumes.map(c => c.topic))],
      produces: [...new Set(effective.produces.map(c => c.topic))],
      tables: Object.fromEntries(Object.entries(tablesByName).map(([k, v]) => [k, [...v].sort()])),
      calls: [...new Set([...effective.calls.map(c => c.client), ...ex.http.map(h => h.target).filter(Boolean)])],
      datasources: ex.db.datasources.map(d => d.db).filter(Boolean),
      libraries: libs.map(l => `${l.artifactId}@${l.version || '?'}${l.error ? ' (not fetched)' : l.exactVersion === false ? ' (default branch)' : ''}`),
      unresolved: ex.config.unresolved.length,
    },
  };
  const prev = load(service);
  passport.changes = diff(prev, passport);
  if (prev) writeJson(path.join(DIR, safe(service), 'history', `${prev.builtAt.replace(/[:.]/g, '-')}.json`), prev);
  passport.stats.totalMs = Date.now() - started;
  writeJson(file(service), passport);
  fs.writeFileSync(path.join(DIR, safe(service), 'passport.md'), markdown(passport));

  // the code index (grep, symbols, impact radius) of the same checkout
  try { passport.codeIndex = require('../codeindex').build(info.path, `${info.project}/${info.repo}`, { project: info.project, repo: info.repo, ref: info.ref, sha: info.sha, service }, { extracted: ex }).builtAt; } catch (e) { passport.codeIndex = { error: e.message }; }
  if (graph) passport.graph = await graphBuild(info.path).catch(e => ({ error: e.message }));
  if (rebuildCatalog) try { for (const e of require('../config').envNames()) require('../catalog').build(e); } catch {}
  return passport;
}

// Ask the code-review-graph service (if configured) to (re)build the graph for a fetched repo.
async function graphBuild(repoPath) {
  const url = getPersonal().graphUrl;
  if (!url) return { skipped: 'GRAPH_URL not set' };
  const rel = path.relative(require('../git').REPOS, repoPath).split(path.sep).join('/');
  const { http } = require('../util');
  const res = await http(`${url}/build_or_update_graph_tool`, { method: 'POST', body: { repo_root: `/repos/${rel}`, full_rebuild: false }, timeout: 600000 });
  return { repo_root: `/repos/${rel}`, result: typeof res === 'string' ? res.slice(0, 500) : res };
}

function markdown(p) {
  const L = [];
  const row = (cells) => `| ${cells.map(c => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
  const table = (head, rows) => rows.length ? [row(head), `|${head.map(() => ' --- ').join('|')}|`, ...rows.map(row)].join('\n') : '_none_';
  const loc = (x) => (x.file === 'config' ? `config ${x.key || ''}` : `${x.file}:${x.line}`) + (x.source ? ` (lib ${x.source})` : '');
  L.push(`# ${p.service}`, '', `${p.repo.project}/${p.repo.repo} @ ${p.repo.ref} \`${p.repo.sha}\` (${p.repo.commitDate || ''})${p.deployed ? ` — deployed in ${p.env} on ${p.deployed.instance}` : ''}`, '',
    `Spring Boot ${p.app.springBoot || '?'} · port ${p.app.port || '?'} · profiles ${p.app.profiles.join(', ') || '-'} · built ${p.builtAt}`, '');
  if (p.changes && !p.changes.none) {
    L.push('## Changes since previous passport', '');
    for (const [k, v] of Object.entries(p.changes)) if (v && v.added) L.push(`- **${k}**: +${v.added.length} ${v.added.slice(0, 10).join(', ')} / -${v.removed.length} ${v.removed.slice(0, 10).join(', ')}`);
    L.push('');
  }
  L.push('## HTTP endpoints', '', table(['method', 'path', 'handler', 'where'], uniqBy(p.effective.endpoints, keyOf.endpoints).map(e => [e.method, e.path, e.handler, loc(e)])), '');
  L.push('## Outbound calls (Feign)', '', table(['client', 'method', 'path', 'handler', 'where'], p.effective.calls.map(c => [c.client, c.method, c.path, c.handler, loc(c)])), '');
  L.push('## Kafka consumes', '', table(['topic', 'group', 'handler', 'via', 'where'], p.effective.consumes.map(c => [c.topic, c.group, c.handler, c.via, loc(c)])), '');
  L.push('## Kafka produces', '', table(['topic', 'via', 'where'], p.effective.produces.map(c => [c.topic, c.via, loc(c)])), '');
  L.push('## Database', '', table(['datasource key', 'db', 'host'], p.db.datasources.map(d => [d.key, d.db, d.host])), '',
    table(['table', 'access', 'via', 'where'], p.effective.tables.map(t => [t.table, t.access, t.via, loc(t)])), '');
  L.push('## Elasticsearch', '', table(['index', 'via', 'where'], p.es.map(x => [x.index, x.via, loc(x)])), '');
  L.push('## Other HTTP targets', '', table(['target', 'url', 'where'], p.http.map(h => [h.target, h.url, loc(h)])), '');
  L.push('## Internal libraries', '', table(['library', 'version', 'repo', 'ref', 'provides', 'note'], p.libraries.map(l => [l.artifactId, l.version, l.repo, l.ref, l.provides ? Object.entries(l.provides).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') : '', l.error || (l.exactVersion === false ? 'default branch (no matching tag)' : '')])), '');
  L.push('## External dependencies', '', table(['group', 'artifact', 'version', 'scope'], p.dependencies.external.map(d => [d.groupId, d.artifactId, d.version, d.scope])), '');
  if (p.config.unresolved.length) L.push('## Unresolved config placeholders', '', p.config.unresolved.map(u => `- \`${u}\``).join('\n'), '');
  return L.join('\n') + '\n';
}

function list() {
  let dirs = [];
  try { dirs = fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  return dirs.map(d => readJson(path.join(DIR, d, 'passport.json'))).filter(Boolean).map(p => ({
    service: p.service, repo: `${p.repo.project}/${p.repo.repo}`, ref: p.repo.ref, sha: p.repo.sha, env: p.env, builtAt: p.builtAt,
    endpoints: p.summary.endpoints, consumes: p.summary.consumes, produces: p.summary.produces,
    tables: Object.keys(p.summary.tables), calls: p.summary.calls, libraries: p.summary.libraries.length,
    changed: p.changes ? !p.changes.none : null,
  }));
}

// Who consumes/produces a topic, touches a table, exposes a path, or calls a service — across all passports.
function whoUses(term) {
  const q = String(term).toLowerCase();
  const rows = [];
  const hit = (s) => s && String(s).toLowerCase().includes(q);
  for (const s of list()) {
    const p = load(s.service);
    const loc = (x) => (x.file === 'config' ? `config ${x.key || ''}` : `${x.file}:${x.line}`);
    for (const c of p.effective.consumes) if (hit(c.topic)) rows.push({ service: p.service, kind: 'kafka', role: 'consumes', name: c.topic, detail: c.group || '', where: loc(c), source: c.source || '' });
    for (const c of p.effective.produces) if (hit(c.topic)) rows.push({ service: p.service, kind: 'kafka', role: 'produces', name: c.topic, detail: c.via, where: loc(c), source: c.source || '' });
    for (const t of p.effective.tables) if (hit(t.table)) rows.push({ service: p.service, kind: 'table', role: t.access, name: t.table, detail: t.via, where: loc(t), source: t.source || '' });
    for (const e of p.effective.endpoints) if (hit(e.path) || hit(e.handler)) rows.push({ service: p.service, kind: 'http', role: 'exposes', name: `${e.method} ${e.path}`, detail: e.handler, where: loc(e), source: e.source || '' });
    for (const c of p.effective.calls) if (hit(c.client) || hit(c.path)) rows.push({ service: p.service, kind: 'http', role: 'calls', name: `${c.client} ${c.method} ${c.path}`, detail: c.handler, where: loc(c), source: c.source || '' });
    for (const i of p.es) if (hit(i.index)) rows.push({ service: p.service, kind: 'es', role: 'uses', name: i.index, detail: i.via, where: loc(i), source: '' });
    for (const d of p.db.datasources) if (hit(d.db)) rows.push({ service: p.service, kind: 'db', role: 'connects', name: d.db, detail: d.host, where: `config ${d.key}`, source: '' });
  }
  return rows;
}

module.exports = { build, load, list, whoUses, libraryRepoNames, findModule, resolveRepo, deployedSha, diff, markdown, graphBuild, DIR };
