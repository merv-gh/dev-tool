// Coherent, bounded data captures. Schema FKs are facts; cross-database and event joins are explicit.
// No environment writes: replay creates only scratch databases through testdb.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson, writeJson } = require('./util');
const qi = s => `"${String(s).replace(/"/g, '""')}"`;
const qt = s => s.split('.').map(qi).join('.');
const stable = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const idOf = x => `${x.db}:${x.table}`;
const same = (a, b) => a == null || b == null ? a === b : String(a) === String(b);
const list = s => s.split(',').map(x => x.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

function number(v, def, max, name) {
  v = v ?? def;
  if (!Number.isInteger(v) || v < 1 || v > max) throw new Error(`${name} must be 1..${max}`);
  return v;
}
function catalog(env) {
  const cats = require('./pg').loadAll(env), tables = new Map();
  for (const cat of cats) for (const t of cat.tables) if (t.kind === 'table') tables.set(`${cat.db}:${t.schema}.${t.name}`, { ...t, db: cat.db, table: `${t.schema}.${t.name}` });
  return { cats, tables };
}
function endpoint(x, tables) {
  const t = tables.get(idOf(x));
  if (!t) throw new Error(`no cached table ${idOf(x)}: sync its database first`);
  const columns = x.columns || (x.column ? [x.column] : []);
  if (!columns.length || columns.some(c => !t.columns.some(k => k.name === c))) throw new Error(`unknown or empty columns on ${idOf(x)}: ${columns.join(', ')}`);
  if (new Set(columns).size !== columns.length) throw new Error(`duplicate columns on ${idOf(x)}`);
  return { db: t.db, table: t.table, columns };
}
function primary(t) {
  const c = (t.constraints || []).find(c => c.type === 'p');
  return c && /PRIMARY KEY\s*\(([^)]+)\)/i.test(c.def) ? list(c.def.match(/PRIMARY KEY\s*\(([^)]+)\)/i)[1]) : [];
}
function foreignKeys(tables, gaps) {
  const out = [];
  for (const t of tables.values()) for (const c of t.constraints || []) if (c.type === 'f') {
    const m = c.def?.match(/FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+.+?\(([^)]+)\)/i);
    const ref = c.ref && tables.get(`${t.db}:${c.ref}`);
    if (!m || !ref) { gaps.push({ kind: 'schema', table: idOf(t), detail: `cannot resolve FK ${c.name}` }); continue; }
    out.push({ from: endpoint({ ...t, columns: list(m[1]) }, tables), to: endpoint({ ...ref, columns: list(m[2]) }, tables), source: 'foreign-key', evidence: c.name, required: true });
  }
  return out;
}
// Plan is offline and JSON serializable: examine it, add candidates as explicit relations, then capture.
function plan({ env, service, seeds = [], relations = [], topics = [], limits = {}, includeChildren = false } = {}) {
  env ||= require('./config').envNames()[0];
  require('./config').getEnv(env);
  if (seeds.length > 100 || relations.length > 1000 || topics.length > 100) throw new Error('capture plan limit: 100 seeds, 1000 explicit relations and 100 topics');
  if (new Set(topics.map(t => t.topic)).size !== topics.length) throw new Error('duplicate capture topics');
  const { cats, tables } = catalog(env), gaps = [];
  const links = foreignKeys(tables, gaps);
  for (const r of relations.filter(r => r.source !== 'foreign-key')) {
    const from = endpoint(r.from, tables), to = endpoint(r.to, tables);
    if (from.columns.length !== to.columns.length) throw new Error('relationship column counts differ');
    links.push({ from, to, source: 'explicit', evidence: String(r.evidence || 'capture plan'), required: r.required === true });
  }
  const roots = seeds.map(s => {
    const t = tables.get(idOf(s));
    if (!t) throw new Error(`no cached table ${idOf(s)}`);
    if (!s.where || !Object.keys(s.where).length) throw new Error(`seed ${idOf(s)} needs equality filters in where`);
    if (Object.keys(s.where).some(c => !t.columns.some(x => x.name === c))) throw new Error(`unknown seed column on ${idOf(s)}`);
    if (Object.values(s.where).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw new Error('seed equality values must be JSON scalars');
    return { db: s.db, table: s.table, where: s.where };
  });
  const eventPlans = topics.map(t => {
    const cached = require('./kafka').cached(env, t.topic);
    if (!cached) throw new Error(`no cached topic ${t.topic}`);
    const matches = (t.matches || []).map(m => {
      if (!/^(value|key|headers)(\.[\w-]+|\[\])*$/.test(m.path || '')) throw new Error(`bad Kafka match path ${m.path}`);
      const from = endpoint({ ...m.from, columns: [m.from.column] }, tables);
      return { path: m.path, from: { db: from.db, table: from.table, column: from.columns[0] } };
    });
    if (!matches.length) throw new Error(`topic ${t.topic} needs matches against captured columns`);
    return { topic: t.topic, matches, match: t.match === 'any' ? 'any' : 'all', offsets: t.offsets || {}, required: t.required !== false, schema: { key: cached.keySchema, value: cached.valueSchema }, paths: require('./fixture-schema').paths(cached) };
  });
  // Equal names are suggestions, never traversed. Identity columns alone do not imply a relationship.
  const reachable = new Set(roots.map(idOf));
  if (service) for (const e of require('./pgindex').current(env).edges) if (e.user === service && e.db && e.targetKind === 'table') reachable.add(`${e.db}:${e.target}`);
  for (let change = true; change;) { change = false; for (const r of links) if (reachable.has(idOf(r.from)) || includeChildren && reachable.has(idOf(r.to))) for (const e of [r.from, r.to]) if (!reachable.has(idOf(e))) { reachable.add(idOf(e)); change = true; } }
  const candidates = [];
  for (const a of tables.values()) if (reachable.has(idOf(a))) for (const b of tables.values()) if (a.db !== b.db) {
    for (const c of a.columns) if (/_id$/.test(c.name) && b.columns.some(x => x.name === c.name)) {
      const r = { from: { db: a.db, table: a.table, columns: [c.name] }, to: { db: b.db, table: b.table, columns: [c.name] } };
      if (!links.some(l => stable(l.from) === stable(r.from) && stable(l.to) === stable(r.to))) candidates.push({ ...r, source: 'candidate', evidence: `same column name ${c.name}; confirm from code or a schema contract` });
    }
  }
  const reachableTables = [...reachable].map(id => tables.get(id)).filter(Boolean);
  let cachedTopics = [];
  try { cachedTopics = fs.readdirSync(path.join(CACHE, env, 'kafka')).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().map(f => readJson(path.join(CACHE, env, 'kafka', f))).filter(Boolean); } catch {}
  const topicCandidates = require('./fixture-schema').candidates(reachableTables, cachedTopics);
  return { version: 1, env, service, seeds: roots, relations: links.filter(r => reachable.has(idOf(r.from)) || reachable.has(idOf(r.to))), topics: eventPlans,
    limits: { depth: number(limits.depth, 8, 50, 'depth'), rowsPerTable: number(limits.rowsPerTable, 200, 10000, 'rowsPerTable'), totalRows: number(limits.totalRows, 2000, 50000, 'totalRows'), messagesPerTopic: number(limits.messagesPerTopic, 300, 10000, 'messagesPerTopic'), totalMessages: number(limits.totalMessages, 2000, 50000, 'totalMessages'), queries: number(limits.queries, 200, 1000, 'queries') },
    includeChildren: !!includeChildren, candidates: candidates.slice(0, 100), topicCandidates: topicCandidates.slice(0, 200), topicCandidatesTotal: topicCandidates.length, gaps: gaps.filter(g => !g.table || reachable.has(g.table)),
    catalogs: cats.map(c => ({ db: c.db, syncedAt: c.syncedAt, fingerprint: hash(stable(c)) })),
    tables: [...reachable].map(id => tables.get(id)).filter(Boolean).map(t => ({ id: idOf(t), db: t.db, table: t.table, columns: t.columns, constraints: t.constraints, primaryKey: primary(t) })),
    consistency: 'Independent read-only statements across databases and Kafka; observation window and offsets are recorded, not a distributed snapshot.' };
}

const tupleKey = tuple => stable(tuple.map(x => x == null ? null : String(x)));
function jsonValue(v) {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `\\x${v.toString('hex')}`;
  if (typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(jsonValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonValue(x)]));
  return v;
}
function valuesAt(obj, dotted) {
  if (!dotted) return [obj];
  const parts = dotted.replace(/\[\]/g, '.*').split('.');
  function read(o, i) {
    if (i === parts.length) return [o];
    if (parts[i] === '*') return Array.isArray(o) ? o.flatMap(v => read(v, i + 1)) : [];
    return o != null && Object.hasOwn(Object(o), parts[i]) ? read(o[parts[i]], i + 1) : [];
  }
  return read(obj, 0);
}

// AND correlations from one table must use the same row and, inside arrays, the same element.
function correlated(message, rules, row) {
  const groups = new Map();
  for (const rule of rules) {
    const i = rule.path.indexOf('[]'), prefix = i < 0 ? '' : rule.path.slice(0, i + 2);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(rule);
  }
  for (const [prefix, group] of groups) {
    if (!prefix) {
      if (!group.every(rule => valuesAt(message, rule.path).some(v => v != null && same(row[rule.from.column], v)))) return false;
    } else if (!valuesAt(message, prefix).some(item => correlated(item, group.map(rule => ({ ...rule, path: rule.path.slice(prefix.length).replace(/^\./, '') })), row))) return false;
  }
  return true;
}

async function capture(input, { query, messages, mask = true, log = () => {} } = {}) {
  // Rebuild from source inputs: callers cannot smuggle arbitrary SQL or stale catalog metadata.
  const p = plan(input), { tables } = catalog(p.env);
  if (!p.seeds.length) throw new Error('capture needs at least one seed');
  const startedAt = new Date().toISOString(), rows = {}, provenance = {}, gaps = [...p.gaps], seen = new Map(), requested = new Set();
  let total = 0, queries = 0;
  query ||= async (db, sql, params) => { await require('./limit').take(`pg:${p.env}`); return (await require('./pg').query(p.env, sql, { db, params })).rows; };
  messages ||= (topic, options) => require('./kafka').captureMessages(p.env, topic, options);
  const addGap = g => { if (!gaps.some(x => stable(x) === stable(g))) gaps.push(g); };
  async function fetchRows(e, tuples, why, depth) {
    const id = idOf(e), t = tables.get(id);
    const fresh = tuples.filter(tuple => { const k = `${id}:${e.columns.join(',')}:${tupleKey(tuple)}`; if (requested.has(k)) return false; requested.add(k); return true; });
    if (!fresh.length) return [];
    if (depth > p.limits.depth) { addGap({ kind: 'depth-limit', table: id, detail: why }); return []; }
    const added = [];
    for (let i = 0; i < fresh.length; i += 100) {
      const remaining = Math.min(p.limits.rowsPerTable - (rows[id]?.length || 0), p.limits.totalRows - total);
      if (remaining < 1) { addGap({ kind: 'row-limit', table: id }); break; }
      if (queries >= p.limits.queries) { addGap({ kind: 'query-limit', table: id }); break; }
      const params = [], terms = fresh.slice(i, i + 100).map(vs => '(' + e.columns.map((c, n) => { if (vs[n] == null) return `${qi(c)} is null`; params.push(vs[n]); return `${qi(c)} = $${params.length}`; }).join(' and ') + ')');
      const pk = primary(t), order = pk.length ? pk.map(qi).join(', ') : 'tableoid, ctid';
      let identity = '__dt_capture_identity';
      while (t.columns.some(c => c.name === identity)) identity += '_';
      const fields = pk.length ? '*' : `*, tableoid::text || ':' || ctid::text as ${qi(identity)}`;
      const sql = `select ${fields} from ${qt(t.table)} where ${terms.join(' or ')} order by ${order} limit ${remaining + 1}`;
      log(`read ${id}: up to ${remaining} rows, depth ${depth}`);
      queries++;
      const result = await query(t.db, sql, params);
      if (result.length > remaining) addGap({ kind: 'row-limit', table: id });
      if (!rows[id]) { rows[id] = []; provenance[id] = []; seen.set(id, new Set()); }
      for (const r of result.slice(0, remaining)) {
        const row = { ...r }, key = pk.length ? tupleKey(pk.map(c => r[c])) : r[identity] || stable(r);
        if (!pk.length) delete row[identity];
        if (seen.get(id).has(key)) continue;
        seen.get(id).add(key); rows[id].push(jsonValue(row)); total++; added.push(row);
        provenance[id].push({ key, via: why, depth });
      }
    }
    return added;
  }
  let frontier = [];
  for (const s of p.seeds) {
    const e = { db: s.db, table: s.table, columns: Object.keys(s.where) };
    const added = await fetchRows(e, [Object.values(s.where)], 'seed', 0);
    if (!(rows[idOf(s)] || []).some(row => Object.entries(s.where).every(([column, value]) => same(row[column], value)))) addGap({ kind: 'missing-seed', table: idOf(s), where: s.where });
    frontier.push({ endpoint: e, rows: added, depth: 0 });
  }
  while (frontier.length) {
    const next = [];
    for (const node of frontier) for (const r of p.relations) {
      const directions = [];
      if (idOf(node.endpoint) === idOf(r.from)) directions.push([r.from, r.to]);
      if (p.includeChildren && idOf(node.endpoint) === idOf(r.to)) directions.push([r.to, r.from]);
      for (const [from, to] of directions) {
        const tuples = node.rows.map(row => from.columns.map(c => row[c])).filter(vs => vs.every(v => v != null));
        const added = await fetchRows(to, tuples, `${r.source}: ${r.evidence}`, node.depth + 1);
        if (added.length) next.push({ endpoint: to, rows: added, depth: node.depth + 1 });
      }
    }
    frontier = next;
  }
  const events = {};
  let scannedTotal = 0;
  for (const t of p.topics) {
    const budget = Math.min(p.limits.messagesPerTopic, p.limits.totalMessages - scannedTotal);
    if (budget < 1) { addGap({ kind: 'message-limit', topic: t.topic }); continue; }
    log(`scan ${t.topic}: up to ${budget} messages across partitions`);
    const scan = await messages(t.topic, { maxMessages: budget, offsets: t.offsets });
    scannedTotal += (scan.messages || []).length;
    const matched = [], unique = new Map();
    for (const m of scan.messages || []) {
      const key = `${m.partition}:${m.offset}`, envelope = stable(m);
      if (unique.has(key)) {
        if (unique.get(key) !== envelope) addGap({ kind: 'conflicting-event', topic: t.topic, partition: m.partition, offset: String(m.offset), detail: 'Different envelopes were returned for the same partition and offset' });
        continue;
      }
      unique.set(key, envelope);
      const groups = new Map();
      for (const rule of t.matches) { const id = idOf(rule.from); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(rule); }
      const hit = t.match === 'any'
        ? t.matches.some(rule => (rows[idOf(rule.from)] || []).some(row => correlated(m, [rule], row)))
        : [...groups].every(([id, rules]) => (rows[id] || []).some(row => correlated(m, rules, row)));
      if (!hit) continue;
      matched.push(jsonValue(m));
    }
    matched.sort((a, b) => a.partition - b.partition || (BigInt(a.offset) < BigInt(b.offset) ? -1 : BigInt(a.offset) > BigInt(b.offset) ? 1 : 0));
    events[t.topic] = { messages: matched, windows: scan.windows || [], schema: t.schema, matches: t.matches, scanned: (scan.messages || []).length };
    if (scan.truncated) addGap({ kind: 'kafka-window', topic: t.topic, detail: 'Only the bounded partition windows were scanned.' });
    if (!matched.length && t.required) addGap({ kind: 'missing-events', topic: t.topic });
  }
  const result = { version: 1, plan: p, startedAt, finishedAt: new Date().toISOString(), rows, events, provenance, gaps, counts: { rows: total, queries, messages: Object.values(events).reduce((n, e) => n + e.messages.length, 0) } };
  if (mask !== false) result.redactions = redact(result);
  else result.redactions = { enabled: false, fields: 0 };
  result.gaps.push(...validate(result).gaps);
  result.complete = result.gaps.length === 0;
  return result;
}

// One replacement per source value, across database fields and Kafka bodies, keys and headers.
// Relational keys are left intact unless they also occur in a sensitive field; then all copies agree.
function redact(capture) {
  const sensitive = /(^|[_-])(password|secret|token|authorization|email|phone|first_name|last_name|full_name|address|iban|ssn|api_key)($|[_-])/i;
  const replacements = new Map();
  let fields = 0;
  function discover(v) {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (sensitive.test(k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[.\s-]/g, '_')) && x != null && typeof x !== 'object') {
        const key = String(x), digest = hash(key);
        // Numeric values retain their representation across string/numeric FK and event fields.
        const numeric = /^-?\d+(?:\.\d+)?$/.test(key);
        let n = 0;
        const replacement = numeric ? key.replace(/\d/g, () => String(1 + Number.parseInt(digest[n++ % digest.length], 16) % 9)) : typeof x === 'boolean' ? x : /email/i.test(k) ? `u${digest.slice(0, 10)}@example.invalid` : digest.slice(0, Math.max(1, Math.min(key.length, 24)));
        if (!replacements.has(key)) replacements.set(key, replacement);
        fields++;
      } else discover(x);
    }
  }
  discover(capture.rows); discover(capture.events); discover(capture.plan.seeds); discover(capture.gaps);
  function replace(v) {
    if (v == null) return v;
    if (typeof v !== 'object') { const x = replacements.get(String(v)); return x === undefined || typeof v === 'boolean' ? v : typeof v === 'string' ? String(x) : typeof v === 'number' && Number.isFinite(Number(x)) ? Number(x) : v; }
    if (Array.isArray(v)) return v.map(replace);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
  }
  capture.rows = replace(capture.rows);
  for (const e of Object.values(capture.events)) e.messages = replace(e.messages);
  // Seeds/provenance may contain the same sensitive values: do not leave the original in metadata.
  capture.plan.seeds = replace(capture.plan.seeds);
  if (capture.gaps) capture.gaps = replace(capture.gaps);
  for (const [id, records] of Object.entries(capture.provenance)) {
    const t = capture.plan.tables.find(t => t.id === id);
    records.forEach((r, i) => { const row = capture.rows[id][i]; r.key = t?.primaryKey.length ? tupleKey(t.primaryKey.map(c => row[c])) : `row:${i}`; });
  }
  return { enabled: true, fields, strategy: 'deterministic value replacement; review CHECK/length constraints when personal fields participate in them' };
}

function validate(capture) {
  const gaps = [];
  for (const r of capture.plan.relations) if (r.required) {
    for (const row of capture.rows[idOf(r.from)] || []) {
      const values = r.from.columns.map(c => row[c]);
      if (values.some(v => v == null)) continue;
      if (!(capture.rows[idOf(r.to)] || []).some(parent => r.to.columns.every((c, i) => same(parent[c], values[i])))) gaps.push({ kind: 'missing-parent', table: idOf(r.from), target: idOf(r.to), columns: r.from.columns, values });
    }
  }
  return { ok: !gaps.length, gaps };
}

function literal(v, type = '') {
  if (v == null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite numeric fixture value'); return String(v); }
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  if (Array.isArray(v) && /\[\]$/.test(type)) {
    const base = type.replace(/(?:\[\])+$/, '');
    const array = a => `ARRAY[${a.map(x => Array.isArray(x) ? array(x) : literal(x, base)).join(', ')}]`;
    return v.length ? `${array(v)}::${type}` : `'{}'::${type}`;
  }
  const s = typeof v === 'object' ? stable(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}
function statements(capture, db) {
  const ids = Object.keys(capture.rows).filter(id => id.startsWith(`${db}:`));
  if (!ids.length) return { schema: [], data: [], constraints: [] };
  const cat = require('./pg').loadDb(capture.plan.env, db);
  const original = capture.plan.catalogs.find(c => c.db === db);
  if (!cat || !original || original.fingerprint !== hash(stable(cat))) throw new Error(`catalog for ${db} changed since capture; capture again before exporting`);
  const ddl = require('./ddl').snapshot(capture.plan.env, db, { tables: ids.map(id => id.slice(db.length + 1)), dictionaries: false });
  const constraints = [], schema = [], data = ["set standard_conforming_strings = on"];
  for (const s of ddl.statements) (/^alter table .* add constraint .*FOREIGN KEY|^CREATE (?:CONSTRAINT )?TRIGGER/i.test(s) ? constraints : schema).push(s);
  for (const id of ids.sort()) {
    const t = capture.plan.tables.find(t => t.id === id);
    if (!t) throw new Error(`fixture metadata missing for ${id}`);
    for (const row of capture.rows[id]) {
      const columns = t.columns.filter(c => !c.generated && Object.hasOwn(row, c.name));
      if (!columns.length) data.push(`insert into ${qt(t.table)} default values`);
      else data.push(`insert into ${qt(t.table)} (${columns.map(c => qi(c.name)).join(', ')}) overriding system value values (${columns.map(c => literal(row[c.name], c.type)).join(', ')})`);
    }
    for (const c of t.columns) if (c.identity || /nextval\(/i.test(c.default || '')) data.push(`select setval(pg_get_serial_sequence(${literal(qt(t.table))}, ${literal(c.name)}), coalesce((select max(${qi(c.name)}) from ${qt(t.table)}), 1), exists(select 1 from ${qt(t.table)}))`);
  }
  return { schema, data, constraints };
}

// Reject symlink escapes as well as lexical traversal. No arbitrary server filesystem writes.
function resourcePath(workspace, relative) {
  const W = require('./workspace'), m = W.checkId(workspace), full = W.resolvePath(m, relative).full;
  const rel = path.relative(m.path, full).split(path.sep).join('/');
  if (!/(^|\/)src\/test\/resources\/(?:dt-fixtures\/[\w.-]+|dt-scenarios\/[\w.-]+\/fixture)$/.test(rel)) throw new Error('fixture path must be [module/]src/test/resources/dt-fixtures/<name> or dt-scenarios/<name>/fixture');
  let dir = full;
  while (dir !== m.path) { if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('fixture paths cannot contain symlinks'); dir = path.dirname(dir); }
  return { full, rel };
}

function exportFixture(workspace, capture, { name = 'scenario', directory, overwrite = false } = {}) {
  if (!/^[a-z0-9][\w.-]{0,79}$/i.test(name) || name === '..') throw new Error('invalid fixture name');
  if (capture.version !== 1 || !capture.plan || !capture.rows) throw new Error('not a fixture capture');
  const dest = resourcePath(workspace, directory || `src/test/resources/dt-fixtures/${name}`);
  if (fs.existsSync(dest.full) && !overwrite) throw new Error(`fixture already exists: ${dest.rel}; overwrite=true replaces it`);
  const stage = `${dest.full}.tmp-${crypto.randomBytes(4).toString('hex')}`, files = {};
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.writeFileSync(path.join(stage, rel), text); files[rel] = hash(text); };
  const encoded = s => Buffer.from(s).toString('hex'); // collisions and path components cannot escape
  const manifest = { ...capture, name, files, databases: {}, topics: {} };
  try {
    for (const db of [...new Set(Object.keys(capture.rows).map(id => id.split(':')[0]))].sort()) {
      const prefix = `pg/${encoded(db)}`, sql = statements(capture, db);
      manifest.databases[db] = { directory: prefix, files: ['schema.sql', 'data.sql', 'constraints.sql'], statements: sql };
      for (const [kind, items] of Object.entries(sql)) put(`${prefix}/${kind}.sql`, items.map(s => `${s};`).join('\n\n') + '\n');
      put(`${prefix}/schema.json`, JSON.stringify(capture.plan.tables.filter(t => t.db === db), null, 2) + '\n');
      put(`${prefix}/rows.json`, JSON.stringify(Object.fromEntries(Object.entries(capture.rows).filter(([id]) => id.startsWith(`${db}:`))), null, 2) + '\n');
    }
    for (const [topic, e] of Object.entries(capture.events)) {
      const prefix = `kafka/${encoded(topic)}`;
      manifest.topics[topic] = { directory: prefix, messages: e.messages.length };
      put(`${prefix}/messages.jsonl`, e.messages.map(stable).join('\n') + (e.messages.length ? '\n' : ''));
      put(`${prefix}/schema.json`, JSON.stringify(e.schema, null, 2) + '\n');
      put(`${prefix}/offsets.json`, JSON.stringify(e.windows, null, 2) + '\n');
    }
    put('README.txt', `Fixture ${name}\n\nLoad each database's schema.sql, data.sql, constraints.sql in that order.\nThe fixture_replay tool validates hashes and loads isolated scratch databases, dropping them on error.\nFor test_run give fixture_path and (for multiple datasources) fixture_bindings.\nKafka messages.jsonl preserves key, value, headers, partition, source offset and timestamp.\nUse the service's test producer to publish them to its test Kafka; no live publish tool is provided.\nCapture window: ${capture.startedAt} .. ${capture.finishedAt}\n${capture.plan.consistency}\nComplete: ${capture.complete}; gaps: ${capture.gaps.length}. See manifest.json.\n`);
    put('manifest.json', JSON.stringify({ ...manifest, files: { ...files } }, null, 2) + '\n');
    if (fs.existsSync(dest.full)) fs.rmSync(dest.full, { recursive: true });
    fs.mkdirSync(path.dirname(dest.full), { recursive: true }); fs.renameSync(stage, dest.full);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  require('./workspace').touch(workspace, { dirty: true });
  return { workspace, path: dest.rel, files: Object.keys(files), counts: capture.counts, complete: capture.complete, gaps: capture.gaps };
}

function loadFixture(workspace, directory) {
  const dest = resourcePath(workspace, directory), m = readJson(path.join(dest.full, 'manifest.json'));
  if (!m || m.version !== 1 || !m.files || !m.databases) throw new Error('invalid fixture manifest');
  for (const [rel, digest] of Object.entries(m.files)) {
    const file = path.resolve(dest.full, rel);
    if (!file.startsWith(dest.full + path.sep) || fs.lstatSync(file).isSymbolicLink() || fs.realpathSync(file) !== path.resolve(fs.realpathSync(dest.full), rel)) throw new Error('fixture file escapes its directory');
    if (hash(fs.readFileSync(file)) !== digest) throw new Error(`fixture hash mismatch: ${rel}`);
  }
  // Use verified SQL files as the replay source, never unchecked statements in manifest metadata.
  for (const db of Object.values(m.databases)) {
    if (!/^pg\/[0-9a-f]+$/.test(db.directory)) throw new Error('invalid fixture database directory');
    db.statements = Object.fromEntries(['schema', 'data', 'constraints'].map(kind => {
      const rel = `${db.directory}/${kind}.sql`;
      if (!Object.hasOwn(m.files, rel)) throw new Error(`missing hashed fixture file ${rel}`);
      return [kind, require('./testrun').splitSql(fs.readFileSync(path.join(dest.full, rel), 'utf8'))];
    }));
  }
  return m;
}

async function replay(workspace, directory, { allowIncomplete = false, runId = crypto.randomBytes(10).toString('hex'), template = false, ttlMs, settings, signal } = {}) {
  const m = loadFixture(workspace, directory);
  if (!m.complete && !allowIncomplete) throw new Error('fixture is incomplete: inspect gaps, or set allow_incomplete=true');
  if (template) {
    await require('./testdb').initialize({ label: 'dt fixture replay scratch' });
    const T = require('./testdb-templates'), base = await T.build({ workspace, directory, signal });
    const cloned = await T.clone({ template: base.id, runId, ttlMs, settings, signal });
    return { ...cloned, topics: m.topics, timings: { ...base.timings, ...cloned.timings, templateReused: base.reused } };
  }
  const databases = {};
  try {
    for (const [name, db] of Object.entries(m.databases)) {
      const s = db.statements;
      const created = await require('./testdb').create(`${runId}${hash(name).slice(0, 8)}`, [...s.schema, ...s.data, ...s.constraints], { signal });
      databases[name] = created;
      if (created.errors.length) throw new Error(`fixture ${name}: ${created.errors.map(e => e.error).join('; ')}`);
    }
    return { databases, topics: m.topics, cleanup: async () => { await Promise.all(Object.values(databases).map(db => require('./testdb').drop(db.database))); } };
  } catch (e) { const cleanup = await Promise.allSettled(Object.values(databases).map(db => require('./testdb').drop(db.database))); e.cleanupErrors = cleanup.filter(x => x.status === 'rejected').map(x => x.reason.message); throw e; }
}

const captureFile = id => { if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('invalid capture id'); return path.join(CACHE, 'captures', `${id}.json`); };
function save(capture) { const id = crypto.randomBytes(12).toString('hex'); writeJson(captureFile(id), capture); return id; }
function load(id) { const r = readJson(captureFile(id)); if (!r) throw new Error('capture not found'); return r; }

module.exports = { plan, capture, validate, redact, literal, statements, exportFixture, loadFixture, replay, resourcePath, save, load, valuesAt };
