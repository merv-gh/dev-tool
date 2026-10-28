// Impact radius: what is affected when a code part, table, column, function, topic, index or endpoint
// changes. One graph from
//   - the code graphs of the indexed repos and workspaces (lib/codegraph.js, method level),
//   - the Postgres usage index of an env (functions, views, triggers, FKs; services from passports),
//   - the passports of services that are not indexed (service level: topics, tables, endpoints),
// walked backwards along "uses" edges, layer by layer. Columns are matched at query time: entity
// fields mapped to them, SQL in methods that names the table and the column, function bodies and view
// definitions that read the table and mention the column, indexes and constraints on it.
// Text mentions (yml, sql, xml, other languages) come from the trigram grep, so nothing named only in
// config is missed.
const CI = require('./codeindex');

const kindOf = (id) => {
  const m = id.match(/^(table|column|topic|es|pgfn|endpoint|svc|file|ext):/);
  if (m) return m[1];
  if (id.includes('#')) return 'method';
  return 'class-or-field';
};

// The combined graph is kept until an index, the usage index or the passports change
const memo = { sig: null, G: null };
function load({ repos, env } = {}) {
  const keys = CI.select(repos);
  let sig = null;
  try {
    const pdir = require('./passport').DIR;
    const pm = require('fs').existsSync(pdir) ? require('fs').statSync(pdir).mtimeMs : 0;
    sig = JSON.stringify([keys.map(k => `${k}@${CI.load(k)?.builtAt}`), env, env ? require('./pgindex').current(env).builtAt : null, pm]);
  } catch {}
  if (sig && memo.sig === sig) return memo.G;
  const G = build(keys, env);
  if (sig) Object.assign(memo, { sig, G });
  return G;
}

function build(keys, env) {
  const rev = new Map(), fwd = new Map(), nodes = new Map(), sql = [];
  const add = (from, to, kind, where, repo) => {
    const e = { from, to, kind, where, repo };
    (rev.get(to) || rev.set(to, []).get(to)).push(e);
    (fwd.get(from) || fwd.set(from, []).get(from)).push(e);
  };
  const indexed = new Set();
  for (const key of keys) {
    const idx = CI.load(key);
    const g = idx && idx.graph_();
    if (!g) continue;
    if (g.app?.name) indexed.add(g.app.name);
    indexed.add(idx.repo || key.split('/').pop());
    for (const c of g.classes) {
      nodes.set(c.id, { id: c.id, kind: 'class', repo: key, file: c.file, line: c.line, role: c.role, test: c.test, name: c.name });
      for (const m of c.methods) nodes.set(`${c.id}#${m.name}`, { id: `${c.id}#${m.name}`, kind: 'method', repo: key, file: c.file, line: m.line, endLine: m.endLine, role: c.role, test: c.test, name: `${c.name}#${m.name}` });
      for (const f of c.fields) nodes.set(`${c.id}.${f.name}`, { id: `${c.id}.${f.name}`, kind: 'field', repo: key, file: c.file, line: f.line, role: c.role, test: c.test, name: `${c.name}.${f.name}`, column: f.column });
    }
    for (const [from, to, kind, where] of g.edges) add(from, to, kind, where, key);
    for (const s of g.sql || []) sql.push({ ...s, repo: key });
  }

  // database side (and service-level usage from passports) for the env
  let cats = [];
  if (env) {
    try { cats = require('./pg').loadAll(env); } catch {}
    try {
      for (const e of require('./pgindex').current(env).edges) {
        const t = e.targetKind === 'function' || e.targetKind === 'procedure' ? `pgfn:${e.target}` : `table:${e.target}`;
        if (e.source === 'db') {
          if (e.role === 'trigger') continue; // the "executes" edge says it: table -> function
          const u = e.userKind === 'function' || e.userKind === 'procedure' ? `pgfn:${e.user}` : `table:${e.user}`;
          add(u, t, e.role, e.where || e.detail || '', `db:${e.db}`);
        } else if (!indexed.has(e.user)) add(`svc:${e.user}`, t, e.role, e.where, `svc:${e.user}`);
      }
    } catch {}
  }
  try {
    const pp = require('./passport');
    for (const s of pp.list()) {
      if (indexed.has(s.service)) continue;
      const p = pp.load(s.service);
      const e = p?.effective || p || {};
      for (const k of e.kafka?.consumes || []) if (k.topic && !/^\?/.test(k.topic)) add(`svc:${s.service}`, `topic:${k.topic}`, 'consumes', `${k.file}:${k.line}`, `svc:${s.service}`);
      for (const k of e.kafka?.produces || []) if (k.topic && !/^[?(]/.test(k.topic)) add(`topic:${k.topic}`, `svc:${s.service}`, 'produced-by', `${k.file}:${k.line}`, `svc:${s.service}`);
      for (const x of e.feign || []) add(`svc:${s.service}`, `endpoint:${x.method} ${normPath(x.path)}`, 'calls-http', `${x.file}:${x.line}`, `svc:${s.service}`);
      for (const x of e.endpoints || []) add(`endpoint:${x.method} ${normPath(x.path)}`, `svc:${s.service}`, 'handler', `${x.file}:${x.line}`, `svc:${s.service}`);
      for (const x of e.es || []) if (x.index && !/^\?/.test(x.index)) add(`svc:${s.service}`, `es:${x.index}`, 'es', `${x.file}:${x.line}`, `svc:${s.service}`);
    }
  } catch {}

  // unqualified table names in code -> the catalog's schema.table
  const relNames = new Map();
  for (const cat of cats) for (const t of cat.tables) {
    const k = `${t.schema}.${t.name}`.toLowerCase();
    (relNames.get(t.name.toLowerCase()) || relNames.set(t.name.toLowerCase(), new Set()).get(t.name.toLowerCase())).add(k);
  }
  for (const id of [...rev.keys(), ...fwd.keys()]) {
    const m = id.match(/^(table|column):([^.]+)(?:\.([^.]+))?$/);
    if (!m) continue;
    const isCol = m[1] === 'column';
    const tname = m[2], col = m[3];
    if (isCol ? !col : col) continue; // qualified already
    const full = relNames.get(tname);
    if (full && full.size === 1) { const q = [...full][0]; add(id, isCol ? `column:${q}.${col}` : `table:${q}`, 'alias', 'catalog', 'catalog'); }
  }
  return { keys, rev, fwd, nodes, sql, cats };
}

const normPath = (p) => String(p || '').replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';

// "PaymentService#create", "com.acme.PaymentService", "pay.payments.fee", "topic:x", "GET /payments/7", "src/.../X.java:42"
function resolveTarget(G, target) {
  const t = String(target || '').trim();
  if (!t) throw new Error('target is empty');
  const pre = t.match(/^(table|column|topic|kafka|es|pgfn|fn|function|endpoint|svc|service|class|method):\s*(.+)$/i);
  const known = (id) => G.rev.has(id) || G.fwd.has(id) || G.nodes.has(id);
  if (pre) {
    const k = { kafka: 'topic', fn: 'pgfn', function: 'pgfn', service: 'svc' }[pre[1].toLowerCase()] || pre[1].toLowerCase();
    const v = pre[2].trim();
    if (k === 'endpoint') return endpointNodes(G, v);
    if (k === 'class' || k === 'method') return codeNodes(G, v);
    if (k === 'table' || k === 'column' || k === 'pgfn') return { start: [`${k}:${v.toLowerCase().replace(/"/g, '')}`], kind: k };
    return { start: [`${k}:${v}`], kind: k };
  }
  if (/^(GET|POST|PUT|DELETE|PATCH|ANY)\s+\//i.test(t)) return endpointNodes(G, t);
  const file = t.match(/^([\w./-]+\.(?:java|kt|groovy))(?::(\d+))?$/);
  if (file) return fileNodes(G, file[1], file[2] ? Number(file[2]) : null);
  // db names: schema.table(.column) / schema.function, when the catalog knows them
  const low = t.toLowerCase().replace(/"/g, '');
  const parts = low.split('.');
  for (const cat of G.cats) {
    for (const r of cat.tables) {
      const k = `${r.schema}.${r.name}`.toLowerCase();
      if (parts.length === 2 && low === k) return { start: [`table:${k}`], kind: 'table', db: cat.db };
      if (parts.length === 3 && `${parts[0]}.${parts[1]}` === k && r.columns.some(c => c.name.toLowerCase() === parts[2])) return { start: [`column:${low}`], kind: 'column', db: cat.db };
      if (parts.length === 2 && r.name.toLowerCase() === parts[0] && r.columns.some(c => c.name.toLowerCase() === parts[1])) return { start: [`column:${k}.${parts[1]}`], kind: 'column', db: cat.db };
    }
    for (const f of cat.functions || []) if (`${f.schema}.${f.name}`.toLowerCase() === low || (parts.length === 1 && f.name.toLowerCase() === low)) return { start: [`pgfn:${f.schema}.${f.name}`.toLowerCase()], kind: 'pgfn', db: cat.db };
    if (parts.length === 1) { const ts = cat.tables.filter(r => r.name.toLowerCase() === low); if (ts.length === 1) return { start: [`table:${ts[0].schema}.${ts[0].name}`.toLowerCase()], kind: 'table', db: cat.db }; }
  }
  for (const k of ['topic', 'es', 'table', 'pgfn']) if (known(`${k}:${t}`) || known(`${k}:${low}`)) return { start: [known(`${k}:${t}`) ? `${k}:${t}` : `${k}:${low}`], kind: k };
  const code = codeNodes(G, t);
  if (code.start.length) return code;
  return { start: [], kind: 'unknown', candidates: code.candidates };
}

function codeNodes(G, t) {
  const [cls, member] = t.split(/#|::/);
  const all = [...G.nodes.values()];
  let classes = all.filter(n => n.kind === 'class' && (n.id === cls || n.id.endsWith(`.${cls}`) || n.name === cls));
  let m = member;
  if (!classes.length && !member && cls.includes('.')) {
    // Class.method written with a dot
    const i = cls.lastIndexOf('.');
    const c2 = cls.slice(0, i);
    classes = all.filter(n => n.kind === 'class' && (n.id === c2 || n.id.endsWith(`.${c2}`) || n.name === c2));
    m = classes.length ? cls.slice(i + 1) : undefined;
  }
  if (!classes.length) {
    const words = t.toLowerCase().split(/[#.\s]+/).filter(Boolean);
    const candidates = all.filter(n => n.kind !== 'field' && words.every(w => n.id.toLowerCase().includes(w))).slice(0, 15).map(n => n.id);
    return { start: [], kind: 'code', candidates };
  }
  if (m) {
    const ids = classes.map(c => `${c.id}#${m}`).filter(id => G.nodes.has(id) || G.rev.has(id));
    const fields = classes.map(c => `${c.id}.${m}`).filter(id => G.nodes.has(id));
    return { start: [...ids, ...fields], kind: ids.length ? 'method' : 'field' };
  }
  const start = [];
  for (const c of classes) { start.push(c.id); for (const n of all) if (n.id.startsWith(`${c.id}#`) || n.id.startsWith(`${c.id}.`) && n.kind === 'field') start.push(n.id); }
  return { start, kind: 'class' };
}

function endpointNodes(G, t) {
  const [method, p] = t.trim().split(/\s+/);
  const want = normPath(p.replace(/\?.*$/, '')).split('/');
  const start = [...new Set([...G.rev.keys(), ...G.fwd.keys()])].filter(id => {
    const m = id.match(/^endpoint:(\w+) (.*)$/);
    if (!m || (m[1] !== method.toUpperCase() && m[1] !== 'ANY')) return false;
    const have = m[2].split('/');
    return have.length === want.length && have.every((s, i) => s === '{}' || want[i] === '{}' || s === want[i]);
  });
  return { start, kind: 'endpoint' };
}

function fileNodes(G, file, line) {
  const inFile = [...G.nodes.values()].filter(n => n.file === file || n.file.endsWith('/' + file) || file.endsWith('/' + n.file));
  if (line == null) return { start: inFile.filter(n => n.kind === 'class').flatMap(c => [c.id, ...inFile.filter(n => n.id.startsWith(c.id + '#')).map(n => n.id)]), kind: 'file' };
  const m = inFile.filter(n => n.kind === 'method' && n.line <= line + 3 && line <= (n.endLine || n.line)).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
  return m ? { start: [m.id], kind: 'method' } : { start: inFile.filter(n => n.kind === 'class').map(n => n.id), kind: 'file' };
}

// Edges into a column, found at query time.
function columnEdges(G, col) {
  const [, s, t, c] = col.match(/^column:([^.]+)\.([^.]+)\.(.+)$/) || [];
  if (!c) return { edges: [], facts: [] };
  const table = `${s}.${t}`, word = new RegExp(`\\b${c.replace(/[^\w$]/g, '')}\\b`, 'i');
  const out = [];
  const tableNames = new Set([table, t]);
  for (const x of G.sql) if (x.tables.some(n => tableNames.has(n)) && (word.test(x.sql) || /select\s+\*|returning\s+\*/i.test(x.sql))) out.push({ from: x.m, to: col, kind: word.test(x.sql) ? 'sql' : 'sql select *', where: x.sql.replace(/\s+/g, ' ').slice(0, 160), repo: x.repo });
  const facts = [];
  for (const cat of G.cats) {
    const r = cat.tables.find(x => `${x.schema}.${x.name}`.toLowerCase() === table);
    if (!r) continue;
    for (const ix of r.indexes || []) if (word.test(ix.replace(/^.*?\(/, '('))) facts.push({ db: cat.db, kind: 'index', def: ix });
    for (const k of r.constraints || []) if (word.test(k.def)) facts.push({ db: cat.db, kind: { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check' }[k.type] || k.type, name: k.name, def: k.def });
    for (const fk of cat.tables) for (const k of fk.constraints || []) if (k.type === 'f' && k.ref?.toLowerCase() === table && word.test(k.def.replace(/^.*REFERENCES/i, ''))) facts.push({ db: cat.db, kind: 'referenced by', name: `${fk.schema}.${fk.name}.${k.name}`, def: k.def });
    for (const f of cat.functions || []) {
      const fid = `pgfn:${f.schema}.${f.name}`.toLowerCase();
      const touches = (G.fwd.get(fid) || []).some(e => e.to === `table:${table}`);
      if (touches && word.test(f.body || '')) out.push({ from: fid, to: col, kind: 'body', where: `${f.schema}.${f.name}`, repo: `db:${cat.db}` });
    }
    for (const v of cat.tables) {
      if (!v.definition) continue;
      const vid = `table:${v.schema}.${v.name}`.toLowerCase();
      if ((cat.viewDeps || []).some(d => d.view.toLowerCase() === vid.slice(6) && d.ref.toLowerCase() === table) && word.test(v.definition)) out.push({ from: vid, to: col, kind: 'view', where: `${v.schema}.${v.name}`, repo: `db:${cat.db}` });
    }
  }
  return { edges: out, facts };
}

function impact(target, { repos, env, depth = 4, limit = 400, grep = true } = {}) {
  const G = load({ repos, env });
  const r = resolveTarget(G, target);
  if (!r.start.length) return { target, resolved: [], note: `nothing named "${target}" in ${G.keys.length} indexed repos${env ? ` or the ${env} catalog` : ''}`, candidates: r.candidates || [], repos: G.keys };
  let facts = [];
  const extra = new Map(); // column edges of this query only (G is shared between queries)
  for (const s of r.start.filter(x => x.startsWith('column:'))) {
    const ce = columnEdges(G, s);
    for (const e of ce.edges) (extra.get(e.to) || extra.set(e.to, []).get(e.to)).push(e);
    facts = facts.concat(ce.facts);
  }
  // walk backwards; data nodes (table/topic/es/column/endpoint) also pull their direct users the other way
  const seen = new Map(r.start.map(s => [s, { depth: 0, via: null }]));
  let frontier = [...r.start];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const ins = [...(G.rev.get(id) || []), ...(extra.get(id) || [])];
      const outs = d === 1 && /^(table|topic|es|column|endpoint|pgfn):/.test(id) ? (G.fwd.get(id) || []).filter(e => /produced-by|handler/.test(e.kind)) : [];
      for (const e of ins) visit(e.from, e, id);
      for (const e of outs) visit(e.to, e, id);
    }
    function visit(n, e, from) {
      if (seen.has(n) || /^ext:/.test(n)) return;
      seen.set(n, { depth: d, via: { from, kind: e.kind, where: e.where, repo: e.repo } });
      next.push(n);
    }
    frontier = next;
    if (seen.size > limit * 4) break;
  }
  const items = [];
  for (const [id, s] of seen) {
    if (s.depth === 0) continue;
    const n = G.nodes.get(id) || { id, kind: kindOf(id) };
    if (n.kind === 'class-or-field') n.kind = 'other';
    items.push({ depth: s.depth, kind: n.kind, id, name: n.name || id, repo: n.repo || s.via.repo, file: n.file || null, line: n.line || null, role: n.role || null, test: !!n.test, via: `${s.via.kind} ${short(s.via.from)}`, where: s.via.where });
  }
  items.sort((a, b) => a.depth - b.depth || (a.test - b.test) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const pick = (k) => items.filter(i => i.kind === k).map(i => i.id.replace(/^\w+:/, ''));
  const tests = [...new Set(items.filter(i => i.test).map(i => i.id.split(/[#]/)[0]))];
  const out = {
    target, resolved: r.start.slice(0, 20), kind: r.kind, depth, repos: G.keys.length,
    counts: Object.fromEntries(Object.entries(items.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {}))),
    endpoints: pick('endpoint'), topics: pick('topic'), tables: pick('table'), functions: pick('pgfn'), services: pick('svc'), es: pick('es'),
    tests, db: facts,
    items: items.slice(0, limit), truncated: items.length > limit || undefined,
  };
  if (grep) out.mentions = textMentions(G, target, r, items);
  return out;
}

const short = (id) => (id || '').replace(/^[\w.]+\.(?=[A-Z][\w$]*(?:[#.]|$))/, '');

// Plain-text mentions of the target's name outside the code graph (config, SQL files, other languages)
function textMentions(G, target, r, items) {
  const name = r.kind === 'column' ? r.start[0].split('.').pop()
    : r.kind === 'class' ? r.start[0].split('.').pop()
      : r.kind === 'method' || r.kind === 'field' ? r.start[0].split(/[#.]/).pop()
        : String(r.start[0] || target).replace(/^\w+:/, '').replace(/^(GET|POST|PUT|DELETE|PATCH|ANY) /, '').replace(/\{\}/g, '');
  if (!name || name.length < 3) return [];
  const known = new Set(items.filter(i => i.file).map(i => `${i.repo}|${i.file}`));
  const pattern = /^[\w$]+$/.test(name) ? `\\b${name}\\b` : name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const g = CI.grep(G.keys, pattern, { regex: true, ignoreCase: false, limit: 60, perFile: 3 });
    return g.hits.filter(h => !known.has(`${h.repo}|${h.path}`) && !/\.(java|kt)$/.test(h.path)).slice(0, 30);
  } catch { return []; }
}

module.exports = { impact, load, resolveTarget };
