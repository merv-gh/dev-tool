// DDL snapshot of a synced database (cache/<env>/pg/<db>.json), for tests: schemas, extensions, enum and
// domain types, sequences, tables with columns, defaults, identity, constraints, indexes, comments; then
// functions and procedures, views in dependency order, triggers. A subset (tables, a service's tables)
// is closed over what it needs: referenced tables (FKs), trigger functions, functions the service or the
// included functions call, and the tables those read and write.
// Returns statements (run one by one, so one failure does not stop the rest) and the joined SQL text.
const { resolve, namesOf } = require('./pgindex');

const q = (name) => name.split('.').map(p => (/^[a-z_][a-z0-9_$]*$/.test(p) ? p : `"${p.replace(/"/g, '""')}"`)).join('.');
const key = (schema, name) => `${schema}.${name}`.toLowerCase();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function dollar(body) {
  let tag = '$fn$';
  for (let i = 0; body.includes(tag); i++) tag = `$fn${i}$`;
  return `${tag}${body}${tag}`;
}

// Which objects to include. opts: { tables: [names], service, functions: [names], views: [names] } or nothing = all.
function select(cat, opts, env) {
  const names = namesOf(cat);
  const all = !opts.tables?.length && !opts.service && !opts.functions?.length && !opts.views?.length;
  const tables = new Set(), fns = new Set(), views = new Set(), missing = [];
  const relOf = (n) => resolve(names.rel, names.relBy, n).keys;
  const fnOf = (n) => resolve(names.fn, names.fnBy, n).keys;
  if (all) {
    for (const t of cat.tables) (t.kind === 'table' || t.kind === 'foreign' ? tables : views).add(key(t.schema, t.name));
    for (const f of cat.functions || []) fns.add(key(f.schema, f.name));
    return { tables, fns, views, missing };
  }
  const addRel = (n) => {
    const ks = relOf(n);
    if (!ks.length) { missing.push(n); return; }
    for (const k of ks) (names.rel.get(k) === 'table' || names.rel.get(k) === 'foreign' ? tables : views).add(k);
  };
  for (const n of opts.tables || []) addRel(n);
  for (const n of opts.views || []) addRel(n);
  for (const n of opts.functions || []) { const ks = fnOf(n); if (!ks.length) missing.push(n); ks.forEach(k => fns.add(k)); }
  if (opts.service) {
    const usage = require('./pgindex').current(env).edges.filter(e => e.db === cat.db && e.user === opts.service);
    if (!usage.length) missing.push(`service ${opts.service} (no usage edges in ${cat.db}: build its passport, then catalog_sync what=index)`);
    for (const e of usage) (e.targetKind === 'function' || e.targetKind === 'procedure' ? fns : names.rel.get(e.target) === 'table' ? tables : views).add(e.target);
  }
  // closure: views' sources, FK targets, trigger functions, called functions and what they touch
  const edges = require('./pgindex').current(env).edges.filter(e => e.db === cat.db && e.source === 'db');
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    const add = (set, k) => { if (!set.has(k)) { set.add(k); changed = true; } };
    for (const t of cat.tables) {
      const k = key(t.schema, t.name);
      if (!tables.has(k)) continue;
      for (const c of t.constraints || []) if (c.type === 'f' && c.ref && names.rel.has(c.ref.toLowerCase())) add(tables, c.ref.toLowerCase());
    }
    for (const tr of cat.triggers || []) if (tables.has(tr.table.toLowerCase())) add(fns, tr.function.toLowerCase());
    for (const d of cat.viewDeps || []) {
      if (!views.has(d.view.toLowerCase())) continue;
      const r = d.ref.toLowerCase();
      if (d.ref_kind === 'function') add(fns, r); else if (names.rel.get(r) === 'table') add(tables, r); else add(views, r);
    }
    for (const e of edges) {
      if (!fns.has(e.user)) continue;
      if (e.role === 'calls') add(fns, e.target);
      else if (names.rel.get(e.target) === 'table') add(tables, e.target);
      else if (names.rel.has(e.target)) add(views, e.target);
    }
  }
  return { tables, fns, views, missing };
}

function snapshot(env, db, opts = {}) {
  const cat = require('./pg').loadDb(env, db);
  if (!cat) throw new Error(`no synced catalog for db "${db}" in ${env}: call catalog_sync what=pg only=${db}`);
  const { tables, fns, views, missing } = select(cat, opts, env);
  const st = [];
  const relByKey = new Map(cat.tables.map(t => [key(t.schema, t.name), t]));
  const incTables = cat.tables.filter(t => tables.has(key(t.schema, t.name)));
  const incViews = cat.tables.filter(t => views.has(key(t.schema, t.name)));
  const incFns = (cat.functions || []).filter(f => fns.has(key(f.schema, f.name)));

  const schemas = new Set([...incTables, ...incViews, ...incFns].map(o => o.schema));
  const used = new Set();
  for (const t of [...incTables, ...incViews]) for (const c of t.columns) used.add(String(c.type).replace(/\[\]$/, '').toLowerCase());
  for (const f of incFns) for (const a of f.arg_list || []) used.add(String(a.type).replace(/\[\]$/, '').toLowerCase());
  const types = (cat.types || []).filter(t => used.has(`${t.schema}.${t.name}`.toLowerCase()) || (t.schema === 'public' && used.has(t.name.toLowerCase())) || (opts.all !== false && !opts.tables?.length && !opts.service));
  for (const t of types) schemas.add(t.schema);

  st.push('set check_function_bodies = false');
  for (const e of cat.extensions || []) st.push(`create extension if not exists ${q(e.name)}`);
  for (const s of [...schemas].sort()) if (s !== 'public') st.push(`create schema if not exists ${q(s)}`);
  for (const t of types) {
    if (t.kind === 'enum') st.push(`create type ${q(`${t.schema}.${t.name}`)} as enum (${(t.labels || []).map(lit).join(', ')})`);
    else st.push(`create domain ${q(`${t.schema}.${t.name}`)} as ${t.base}${t.default ? ` default ${t.default}` : ''}${t.not_null ? ' not null' : ''}${(t.checks || []).map(c => ` ${c}`).join('')}`);
  }
  // sequences named in included defaults (serial columns); identity columns make their own
  const seqs = new Set();
  for (const t of incTables) for (const c of t.columns) for (const m of String(c.default || '').matchAll(/nextval\('([^']+)'(?:::regclass)?\)/g)) seqs.add(m[1].replace(/"/g, ''));
  for (const sname of seqs) {
    const full = sname.includes('.') ? sname : `public.${sname}`;
    const meta = (cat.sequences || []).find(x => `${x.schema}.${x.name}` === full);
    st.push(`create sequence if not exists ${q(full)}${meta && meta.type && meta.type !== 'bigint' ? ` as ${meta.type}` : ''}`);
  }
  const fks = [];
  for (const t of incTables) {
    const cols = t.columns.map(c => {
      let s = `  ${q(c.name)} ${c.type}`;
      if (c.generated === 's') s += ` generated always as (${c.default}) stored`;
      else if (c.identity) s += ` generated ${c.identity === 'a' ? 'always' : 'by default'} as identity`;
      else if (c.default) s += ` default ${c.default}`;
      if (!c.nullable) s += ' not null';
      return s;
    });
    for (const c of t.constraints || []) {
      if (c.type === 'n') continue; // not-null constraints (pg 18) are on the columns
      if (c.type === 'f') { if (c.ref && tables.has(c.ref.toLowerCase())) fks.push(`alter table ${q(`${t.schema}.${t.name}`)} add constraint ${q(c.name)} ${c.def}`); continue; }
      cols.push(`  constraint ${q(c.name)} ${c.def}`);
    }
    st.push(`create ${t.kind === 'foreign' ? 'table' : 'table'} ${q(`${t.schema}.${t.name}`)} (\n${cols.join(',\n')}\n)`);
    const conNames = new Set((t.constraints || []).map(c => c.name));
    for (const def of t.indexes || []) {
      const name = (def.match(/INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?("?[^"\s]+"?)\s+ON/i) || [])[1];
      if (name && conNames.has(name.replace(/"/g, ''))) continue;
      st.push(def);
    }
    if (t.comment) st.push(`comment on table ${q(`${t.schema}.${t.name}`)} is ${lit(t.comment)}`);
    for (const c of t.columns) if (c.comment) st.push(`comment on column ${q(`${t.schema}.${t.name}`)}.${q(c.name)} is ${lit(c.comment)}`);
  }
  // owned by: the serial column using it
  const owners = new Map();
  for (const t of incTables) for (const c of t.columns) for (const m of String(c.default || '').matchAll(/nextval\('([^']+)'/g)) { const k = m[1].replace(/"/g, ''); if (!owners.has(k)) owners.set(k, `${q(`${t.schema}.${t.name}`)}.${q(c.name)}`); }
  for (const s of seqs) if (owners.has(s)) st.push(`alter sequence ${q(s.includes('.') ? s : `public.${s}`)} owned by ${owners.get(s)}`);
  st.push(...fks);
  for (const f of incFns) {
    if (f.kind === 'aggregate' || f.kind === 'window') continue;
    const head = f.kind === 'procedure' ? `create or replace procedure ${q(`${f.schema}.${f.name}`)}(${f.signature ?? f.args})` : `create or replace function ${q(`${f.schema}.${f.name}`)}(${f.signature ?? f.args}) returns ${f.returns}`;
    const opts2 = f.kind === 'procedure' ? '' : ` ${f.volatility || 'volatile'}${f.security_definer ? ' security definer' : ''}`;
    st.push(`${head} language ${f.lang}${opts2} as ${dollar(f.body || '')}`);
  }
  // views: sources first
  const order = [], seen = new Set();
  const deps = new Map();
  for (const d of cat.viewDeps || []) (deps.get(d.view.toLowerCase()) || deps.set(d.view.toLowerCase(), []).get(d.view.toLowerCase())).push(d.ref.toLowerCase());
  const visit = (k, depth = 0) => {
    if (seen.has(k) || depth > 50) return;
    seen.add(k);
    for (const r of deps.get(k) || []) if (views.has(r)) visit(r, depth + 1);
    order.push(k);
  };
  for (const v of incViews) visit(key(v.schema, v.name));
  for (const k of order) {
    const v = relByKey.get(k);
    if (!v || !v.definition) continue;
    st.push(v.kind === 'matview' ? `create materialized view ${q(k)} as ${v.definition.replace(/;\s*$/, '')} with no data` : `create view ${q(k)} as ${v.definition.replace(/;\s*$/, '')}`);
    if (v.comment) st.push(`comment on ${v.kind === 'matview' ? 'materialized view' : 'view'} ${q(k)} is ${lit(v.comment)}`);
  }
  for (const tr of cat.triggers || []) if (tables.has(tr.table.toLowerCase()) && fns.has(tr.function.toLowerCase())) st.push(tr.def + (tr.enabled ? '' : `;\nalter table ${q(tr.table)} disable trigger ${q(tr.name)}`));

  const header = `-- DDL snapshot of ${env}/${db} (${cat.database || db}), synced ${cat.syncedAt} by dt.\n-- ${incTables.length} tables, ${incViews.length} views, ${incFns.length} functions${opts.service ? `; for ${opts.service}` : ''}.\n-- Regenerate with the ddl_snapshot tool; data is not included.\n-- dt: tables=${[...tables].join(',')} views=${[...views].join(',')} functions=${[...fns].join(',')}\n`;
  return {
    env, db, syncedAt: cat.syncedAt, statements: st,
    sql: header + '\n' + st.map(s => s + ';').join('\n\n') + '\n',
    counts: { tables: incTables.length, views: incViews.length, functions: incFns.length, types: types.length, sequences: seqs.size },
    tables: incTables.map(t => key(t.schema, t.name)), views: order, functions: incFns.map(f => key(f.schema, f.name)),
    missing,
  };
}

// What an earlier snapshot file asked for (its "-- dt:" line), to extend it instead of replacing it
function requested(text) {
  const m = String(text || '').match(/^-- dt: tables=(\S*) views=(\S*) functions=(\S*)/m);
  if (!m) return null;
  const list = (x) => x.split(',').filter(Boolean);
  return { tables: list(m[1]), views: list(m[2]), functions: list(m[3]) };
}

module.exports = { snapshot, select, requested };
