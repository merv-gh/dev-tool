// Postgres usage index: who uses which table, view and function, from both sides.
//   database side: views/matviews (rewrite deps), function bodies (tables read/written, functions called),
//                  triggers (table -> function), foreign keys (table -> table)
//   code side:     service passports (tables read/written/owned, entities, repositories, SQL function calls)
// One edge per "user uses target" with evidence, in cache/<env>/pg/_usage.json, rebuilt after every pg sync
// or passport build (no network). describe() / usages() / uses() answer the questions; catalog lines carry
// a short "used by" so find shows tables together with the services touching them.
const path = require('path');
const { CACHE, readJson, writeJson, fileStamp } = require('./util');
const { sqlRefs, sqlCalls } = require('./passport/extract');

const file = (env) => path.join(CACHE, env, 'pg', '_usage.json');
const ID = require('./semantic-identity'), norm = ID.norm;
const base = (s) => s.split('.').pop();

// Names known in one db: schema.name -> object, name -> [schema.name]
function namesOf(cat) {
  const rel = new Map(), fn = new Map(), relBy = new Map(), fnBy = new Map();
  for (const t of cat.tables) {
    const k = ID.qualified(t.schema, t.name);
    rel.set(k, t.kind);
    (relBy.get(ID.identifier(t.name)) || relBy.set(ID.identifier(t.name), []).get(ID.identifier(t.name))).push(k);
  }
  for (const f of cat.functions || []) {
    const k = ID.qualified(f.schema, f.name);
    if (!fn.has(k)) (fnBy.get(ID.identifier(f.name)) || fnBy.set(ID.identifier(f.name), []).get(ID.identifier(f.name))).push(k);
    fn.set(k, f.kind);
  }
  return { rel, fn, relBy, fnBy };
}

// Unqualified names resolve like search_path: the given schemas first, then public, then any unique match.
function resolve(map, by, name, schemas = []) {
  name = norm(name);
  if (name.includes('.')) return map.has(name) ? { keys: [name] } : { keys: [] };
  for (const s of [...schemas, 'public']) if (map.has(`${s}.${name}`)) return { keys: [`${s}.${name}`] };
  const all = by.get(name) || [];
  return { keys: all, ambiguous: all.length > 1 };
}

const stripSqlComments = (s) => String(s || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const loc = (x) => (x.file === 'config' ? `config ${x.key || ''}` : x.file ? `${x.file}:${x.line}` : '');

function dbSide(cat, names, edges) {
  const db = cat.db;
  const push = (e) => edges.push({ db, source: 'db', where: '', detail: '', ...e });
  for (const t of cat.tables) {
    const user = ID.qualified(t.schema, t.name);
    for (const c of t.constraints || []) {
      if (c.type === 'f' && c.ref) push({ target: norm(c.ref), targetKind: names.rel.get(norm(c.ref)) || 'table', user, userKind: t.kind, role: 'references', detail: c.def, where: c.name });
    }
  }
  for (const d of cat.viewDeps || []) {
    const ref = norm(d.ref);
    const fn = d.ref_kind === 'function';
    push({ target: ref, targetKind: fn ? (names.fn.get(ref) || 'function') : (names.rel.get(ref) || 'table'), user: norm(d.view), userKind: names.rel.get(norm(d.view)) || 'view', role: fn ? 'calls' : 'selects' });
  }
  for (const tr of cat.triggers || []) {
    const table = norm(tr.table), fn = norm(tr.function);
    const when = (tr.def.match(/\b(BEFORE|AFTER|INSTEAD OF)\b.*?\bON\b/i) || [''])[0].replace(/\s+ON$/i, '');
    push({ target: fn, targetKind: 'function', user: table, userKind: 'trigger', role: 'executes', detail: `${tr.name} ${when}${tr.enabled ? '' : ' (disabled)'}`, where: tr.name });
    push({ target: table, targetKind: names.rel.get(table) || 'table', user: fn, userKind: 'function', role: 'trigger', detail: `${tr.name} ${when}`, where: tr.name });
  }
  for (const f of cat.functions || []) {
    if (!/^(sql|plpgsql)$/.test(f.lang)) continue;
    const user = ID.qualified(f.schema, f.name);
    const body = stripSqlComments(f.body);
    const schemas = [ID.identifier(f.schema)];
    const seen = new Set();
    const once = (e) => { const k = `${e.target}|${e.role}`; if (!seen.has(k)) { seen.add(k); push(e); } };
    for (const r of sqlRefs(body)) {
      if (r.access === 'function') continue; // "from fn(...)": handled as a call below
      const { keys, ambiguous } = resolve(names.rel, names.relBy, r.table, schemas);
      for (const k of keys) once({ target: k, targetKind: names.rel.get(k), user, userKind: f.kind, role: r.access, ambiguous });
    }
    for (const c of sqlCalls(body)) {
      const { keys, ambiguous } = resolve(names.fn, names.fnBy, c, schemas);
      for (const k of keys) if (k !== user) once({ target: k, targetKind: names.fn.get(k), user, userKind: f.kind, role: 'calls', ambiguous });
    }
  }
}

function codeSide(cats, passports, edges) {
  for (const p of passports) {
    const e = p.effective || {};
    // only the dbs this service connects to, when its datasources name them
    const wanted = new Set((p.db?.datasources || []).map(d => String(d.db || '').toLowerCase()).filter(Boolean));
    const mine = cats.filter(c => wanted.has(String(c.cat.database || '').toLowerCase()) || wanted.has(c.cat.db.toLowerCase()));
    const targets = mine.length ? mine : cats;
    const seen = new Set();
    const add = (x) => {
      const k = `${x.db}|${x.target}|${x.role}|${x.where}`;
      if (!seen.has(k)) { seen.add(k); edges.push(x); }
    };
    for (const t of e.tables || []) {
      if (!t.table) continue;
      const role = t.access === 'function' ? 'calls' : t.access;
      let found = false;
      for (const { cat, names } of targets) {
        const r = role === 'calls' ? resolve(names.fn, names.fnBy, t.table) : resolve(names.rel, names.relBy, t.table);
        for (const k of r.keys) {
          found = true;
          add({ target: k, targetKind: (role === 'calls' ? names.fn : names.rel).get(k), db: cat.db, user: p.service, userKind: 'service', role, detail: t.via + (t.sql ? `: ${t.sql}` : ''), where: loc(t), source: t.source || 'code', ambiguous: r.ambiguous });
        }
      }
      // tables the code names but no synced db has: keep them, flagged
      if (!found && role !== 'calls') add({ target: norm(t.table), targetKind: 'table', db: null, known: false, user: p.service, userKind: 'service', role, detail: t.via + (t.sql ? `: ${t.sql}` : ''), where: loc(t), source: t.source || 'code' });
    }
    for (const c of e.dbCalls || []) {
      let found = false;
      for (const { cat, names } of targets) {
        const r = resolve(names.fn, names.fnBy, c.name);
        for (const k of r.keys) { found = true; add({ target: k, targetKind: names.fn.get(k), db: cat.db, user: p.service, userKind: 'service', role: 'calls', detail: c.via + (c.sql ? `: ${c.sql}` : ''), where: loc(c), source: c.source || 'code', ambiguous: r.ambiguous }); }
      }
      if (!found && c.explicit) add({ target: norm(c.name), targetKind: 'function', db: null, known: false, user: p.service, userKind: 'service', role: 'calls', detail: c.via, where: loc(c), source: c.source || 'code' });
    }
  }
}

function build(env) {
  const pg = require('./pg');
  const cats = pg.loadAll(env).map(cat => ({ cat, names: namesOf(cat) }));
  const store = require('./pgstore').writer(file(env));
  for (const name of ['edges', 'columns', 'gaps']) store.ensure(name);
  const edges = { length: 0, push(e) { store.add('edges', e); this.length++; } };
  try {
    for (const { cat, names } of cats) dbSide(cat, names, edges);
    const snapshot = require('./passport/edges').snapshot();
    codeSide(cats, snapshot.rows.map(x => x.passport).filter(p => !p.env || p.env === env), edges);
    for (const { cat } of cats) require('./column-lineage').catalog(cat, env, { edge: e => store.add('columns', e), gap: g => store.add('gaps', g) });
    const data = { identityVersion: 'dt.identity/v1', builtAt: new Date().toISOString(), env, passportSignature: snapshot.signature, dbs: cats.map(c => c.cat.db) };
    store.commit(data); memo.delete(env);
    return { edges: edges.length, dbs: data.dbs.length };
  } catch (e) { store.abort(); throw e; }

}

// The index. Never built: built now. Older than a database sync or a passport: the sync jobs rebuild it
// (indexer rebuildIndex), so a lookup answers from the one there is and says it is stale; on big catalogs a
// rebuild takes minutes, too long inside a chat call. rebuild: true builds it in any case.
function current(env, { rebuild = false } = {}) {
  const d = load(env);
  const synced = require('./pg').loadAll(env).map(c => c.syncedAt).sort().pop();
  const stale = (synced && (!d.builtAt || d.builtAt < synced)) || (d.passportSignature !== undefined && d.passportSignature !== require('./passport/edges').snapshot().signature);
  if (stale && (rebuild || !d.builtAt)) { build(env); return load(env); }
  if (stale) Object.defineProperty(d, 'stale', { value: `usage index built ${d.builtAt}, before the latest database sync or passport change: catalog_sync what=index rebuilds it`, configurable: true });
  return d;
}

const memo = new Map();
function load(env) {
  const stamp = fileStamp(file(env));
  if (!stamp) { memo.delete(env); return { edges: [] }; }
  const m = memo.get(env);
  if (m && m.stamp === stamp) return m.data;
  const d = require('./pgstore').load(file(env));
  if (!d) { memo.delete(env); return { edges: [] }; }
  memo.set(env, { stamp, data: d });
  return d;
}

// "schema.name", "name", or "db:schema.name"
function matcher(name) {
  let db = null, n = norm(name);
  const m = n.match(/^([\w-]+):(.+)$/);
  if (m) { db = m[1]; n = m[2]; }
  return (target, edgeDb) => (!db || edgeDb === db) && (n.includes('.') ? target === n : base(target) === n);
}

const ORDER = { service: 0, function: 1, procedure: 1, trigger: 2, view: 3, matview: 3, table: 4 };
const sortEdges = (rows) => rows.sort((a, b) => (ORDER[a.userKind] ?? 9) - (ORDER[b.userKind] ?? 9) || a.user.localeCompare(b.user) || a.role.localeCompare(b.role));

// Who uses this table / view / function (services, functions, triggers, views, FKs).
function usages(env, name) {
  const hit = matcher(name);
  if (isColumn(name)) return columnLineage(env, name).edges;
  return sortEdges(current(env).edges.filter(e => hit(e.target, e.db)));
}

// What this object uses: a function's tables and calls, a view's sources, a service's tables and functions.
function uses(env, name) {
  const hit = matcher(name);
  return current(env).edges.filter(e => hit(e.user, e.db)).sort((a, b) => a.target.localeCompare(b.target));
}

// Compact "used by" per object for catalog lines: "db|schema.name" -> "svc order-service(read,write); fn shop.audit(write)"
function usedBySummary(env, max = 8) {
  const by = new Map();
  for (const e of load(env).edges) {
    if (!e.db) continue;
    const k = `${e.db}|${e.target}`;
    const users = by.get(k) || by.set(k, new Map()).get(k);
    const label = `${{ service: 'svc', function: 'fn', procedure: 'proc', trigger: 'trigger', view: 'view', matview: 'matview', table: 'fk' }[e.userKind] || e.userKind} ${e.user}`;
    (users.get(label) || users.set(label, new Set()).get(label)).add(e.role);
  }
  const out = new Map();
  for (const [k, users] of by) {
    const parts = [...users].map(([label, roles]) => `${label}(${[...roles].join(',')})`);
    out.set(k, parts.slice(0, max).join('; ') + (parts.length > max ? `; +${parts.length - max} more` : ''));
  }
  return out;
}

// Full description of one table/view/function with its usages from both sides.
function describe(env, name, { body = true, bodyLimit } = {}) {
  const hit = matcher(name);
  const out = [];
  for (const cat of require('./pg').loadAll(env)) {
    for (const t of cat.tables) {
      const k = ID.qualified(t.schema, t.name);
      if (!hit(k, cat.db)) continue;
      out.push({ db: cat.db, object: k, ...t, triggers: (cat.triggers || []).filter(x => norm(x.table) === k) });
    }
    for (const f of cat.functions || []) {
      const k = ID.qualified(f.schema, f.name);
      if (!hit(k, cat.db)) continue;
      const definition = {};
      for (const key of Object.keys(f)) {
        if (key === 'body' && !body) continue;
        const value = f[key];
        definition[key] = key === 'body' && bodyLimit && typeof value === 'string' && value.length > bodyLimit ? Buffer.from(value.slice(0, bodyLimit)).toString('utf8') + `… (${value.length} chars)` : value;
      }
      out.push({ db: cat.db, object: k, ...definition });
    }
  }
  const all = load(env).edges;
  for (const o of out) {
    o.usedBy = sortEdges(all.filter(e => e.db === o.db && e.target === o.object));
    o.uses = all.filter(e => e.db === o.db && e.user === o.object);
  }
  // code references to a name no synced db has
  if (!out.length) {
    const unknown = all.filter(e => !e.db && hit(e.target, null));
    if (unknown.length) out.push({ db: null, object: norm(name), kind: 'unknown', note: 'Named in code but not found in any synced database', usedBy: sortEdges(unknown), uses: [] });
  }
  return out;
}

function isColumn(name) { return String(name).replace(/^column:/, '').split(':').pop().split('.').length >= 3; }
function columnLineage(env, name) {
  const I = require('./impact'), G = I.load({ env, target: `column:${String(name).replace(/^column:/, '')}` }), r = I.resolveTarget(G, `column:${String(name).replace(/^column:/, '')}`);
  if (!r.start.length) return { protocol: 'dt.column-lineage/v1', env, target: name, edges: [], complete: false, ambiguous: r.ambiguous || undefined, candidates: r.candidates || [], gaps: [{ kind: r.ambiguous ? 'ambiguous-target' : 'unknown-column' }] };
  const edges = [], gaps = [...G.gaps], callers = [];
  for (const id of r.start) {
    const ce = I.columnEdges(G, id); gaps.push(...ce.gaps);
    for (const e of ce.edges) {
      const n = G.nodes.get(e.from), object = require('./semantic-identity').parsePg(id);
      edges.push({ db: object.db, env, revision: e.revision || n?.revision || null, target: object.object, targetId: id, targetKind: 'column', user: n?.object || e.from, userId: e.from, userKind: n?.kind || 'code', access: e.access, role: e.access, file: e.file || n?.file || null, line: e.line || n?.line || null, where: e.where, source: e.repo?.startsWith('db:') ? 'db' : 'code', detail: e.syntax, ...e });
      const visited = new Set([e.from]), queue = [e.from];
      while (queue.length && visited.size <= 1000) { const child = queue.shift(); for (const c of G.rev.get(child) || []) { if (visited.has(c.from)) continue; visited.add(c.from); callers.push({ userId: c.from, via: child, role: c.kind, where: c.where, repo: c.repo, targetId: id }); queue.push(c.from); } }
      if (queue.length) gaps.push({ kind: 'caller-chain-limit', targetId: id });
    }
    // ORM mapping declarations and field access: object mutation is not proof of a persisted write.
    for (const e of G.rev.get(id) || []) { const field = G.nodes.get(e.from); if (field?.kind !== 'field') continue;
      edges.push({ env, db: require('./semantic-identity').parsePg(id).db, revision: field.revision, targetId: id, targetKind: 'column', target: require('./semantic-identity').parsePg(id).object, user: field.legacyId, userId: field.id, userKind: 'field', role: 'unknown', access: 'unknown', source: 'code', file: field.file, line: field.line, where: e.where, detail: 'ORM column mapping; persistence behavior requires runtime verification' });
      for (const use of G.rev.get(field.id) || []) if (['reads', 'writes'].includes(use.kind)) { const method = G.nodes.get(use.from); edges.push({ env, db: require('./semantic-identity').parsePg(id).db, revision: method?.revision, targetId: id, targetKind: 'column', target: require('./semantic-identity').parsePg(id).object, user: method?.legacyId || use.from, userId: use.from, userKind: 'method', role: use.kind === 'writes' ? 'write' : 'read', access: use.kind === 'writes' ? 'write' : 'read', source: 'code', file: method?.file, line: method?.line, where: use.where, detail: 'ORM object field access', persistenceWriteVerified: false }); }
      gaps.push({ kind: 'orm-runtime-persistence', userId: field.id });
    }
  }
  return { protocol: 'dt.column-lineage/v1', identityVersion: 'dt.identity/v1', env, target: name, resolved: r.start, edges, callers, complete: false, traversalComplete: !gaps.some(g => g.kind === 'caller-chain-limit'), gaps: [...new Map(gaps.map(g => [JSON.stringify(g), g])).values()], coverage: { source: 'cached-catalog-and-indexed-source', exhaustive: false, parser: 'bounded-sql-lexer/v1', unknowns: ['dynamic-sql', 'unindexed-repositories', 'generated-code', 'reflection', 'ORM runtime persistence'] } };
}
module.exports = { build, load, current, usages, uses, describe, usedBySummary, resolve, namesOf, isColumn, columnLineage };
