const path = require('path');
const postgres = require('postgres');
const { getEnv, getTimeouts } = require('./config');
const { CACHE, pool, writeJson, readJson } = require('./util');

const conns = new Map();

// Read-only, timeout-guarded connection per URL, reused across calls. Each statement also runs in its own
// read-only transaction with SET LOCAL statement_timeout: poolers like PgBouncer may drop the startup
// parameters, and the index needs longer than ad-hoc queries (timeouts.pgIndexMs vs pgQueryMs).
function connect(url) {
  if (!conns.has(url)) {
    conns.set(url, postgres(url, {
      max: 4,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
      connection: {
        application_name: 'dev-tool',
        statement_timeout: getTimeouts().pgQueryMs,
        default_transaction_read_only: 'on',
      },
    }));
  }
  return conns.get(url);
}

// One statement in a read-only transaction with its own timeout; a cancel says which limit to raise.
async function guarded(sql, ms, kind, run) {
  try {
    return await sql.begin('read only', async (t) => {
      await t.unsafe(`set local statement_timeout = ${Math.max(1000, Math.floor(ms))}`);
      return run(t);
    });
  } catch (e) {
    if (e.code === '57014') e.message = `${e.message} (the ${kind} limit is ${Math.round(ms / 1000)} s: raise timeouts.${kind === 'index' ? 'pgIndexMs' : 'pgQueryMs'} in config.json, or DT_PG_${kind === 'index' ? 'INDEX' : 'QUERY'}_TIMEOUT_MS)`;
    throw e;
  }
}

async function closeAll() {
  await Promise.all([...conns.values()].map(c => c.end({ timeout: 2 })));
  conns.clear();
}

// Distinct databases: several names in envs.json may point to the same URL;
// then the name equal to the database in the URL wins, else the first one.
function databases(envName) {
  const env = getEnv(envName);
  const byUrl = new Map();
  for (const [name, url] of Object.entries(env.pg)) {
    if (!url) continue;
    const dbInUrl = url.replace(/\?.*$/, '').split('/').pop();
    if (!byUrl.has(url) || name === dbInUrl) byUrl.set(url, name);
  }
  return [...byUrl].map(([url, name]) => ({ name, url }));
}

const indexFile = (env) => path.join(CACHE, env, 'pg', '_index.json');

// Pick the DB for a query: explicit --db, else by schema.table found in the
// SQL and the synced schema index, else the db named like the schema, else default.
function resolveDb(envName, sql, db) {
  const env = getEnv(envName);
  if (db) {
    if (!env.pg[db]) throw new Error(`No URL for db "${db}" in ${env.envFile}. Known: ${Object.keys(env.pg).filter(k => env.pg[k]).join(', ')}`);
    return { db, reason: 'explicit' };
  }
  const index = readJson(indexFile(envName), {});
  const schemas = [...sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*\.\s*"?[a-z_]/gi)].map(m => m[1].toLowerCase());
  for (const s of schemas) {
    const dbs = (index.schemas || {})[s];
    if (dbs && dbs.length) return { db: dbs[0], reason: `schema ${s}` + (dbs.length > 1 ? ` (also in ${dbs.slice(1).join(', ')})` : '') };
    if (env.pg[s]) return { db: s, reason: `db named ${s}` };
  }
  return { db: env.defaultDb, reason: 'default' };
}

async function query(envName, sql, { db, params } = {}) {
  const env = getEnv(envName);
  const target = resolveDb(envName, sql, db);
  const url = env.pg[target.db];
  if (!url) throw new Error(`No URL for db "${target.db}" (${env.envFile} missing or incomplete)`);
  const started = Date.now();
  const rows = await guarded(connect(url), getTimeouts().pgQueryMs, 'query', (t) => t.unsafe(sql, params || []));
  return { env: envName, db: target.db, route: target.reason, ms: Date.now() - started, rowCount: rows.count ?? rows.length, rows: [...rows] };
}

// One round trip per DB for all tables/views with columns, constraints, indexes.
const CATALOG_SQL = `
select n.nspname as schema, c.relname as name,
  case c.relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view'
                 when 'm' then 'matview' when 'f' then 'foreign' end as kind,
  obj_description(c.oid, 'pg_class') as comment,
  greatest(c.reltuples, 0)::bigint as est_rows,
  (select coalesce(json_agg(json_build_object(
      'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'nullable', not a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', nullif(a.attidentity, ''), 'generated', nullif(a.attgenerated, ''),
      'comment', col_description(c.oid, a.attnum)) order by a.attnum), '[]')
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
  (select coalesce(json_agg(json_build_object('name', k.conname, 'type', k.contype, 'def', pg_get_constraintdef(k.oid),
      'ref', (select rn.nspname || '.' || rc.relname from pg_class rc join pg_namespace rn on rn.oid = rc.relnamespace where rc.oid = k.confrelid)) order by k.conname), '[]')
     from pg_constraint k where k.conrelid = c.oid) as constraints,
  (select coalesce(json_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text), '[]')
     from pg_index i where i.indrelid = c.oid) as indexes,
  case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end as definition
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p','v','m','f') and not c.relispartition
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
order by 1, 2`;

// Functions and procedures with structured arguments (name, type, mode, default), result, language, body.
const FUNCTIONS_SQL = `
select n.nspname as schema, p.proname as name,
  case p.prokind when 'p' then 'procedure' when 'a' then 'aggregate' when 'w' then 'window' else 'function' end as kind,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_arguments(p.oid) as signature,
  pg_get_function_result(p.oid) as returns,
  (select coalesce(json_agg(json_build_object(
      'name', coalesce(p.proargnames[i], ''),
      'type', format_type(t, null),
      'mode', case coalesce(p.proargmodes[i], 'i') when 'i' then 'in' when 'o' then 'out' when 'b' then 'inout' when 'v' then 'variadic' when 't' then 'table' end
    ) order by i), '[]')
     from unnest(coalesce(p.proallargtypes, string_to_array(nullif(p.proargtypes::text, ''), ' ')::oid[])) with ordinality as a(t, i)) as arg_list,
  l.lanname as lang,
  case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end as volatility,
  p.prosecdef as security_definer,
  obj_description(p.oid, 'pg_proc') as comment,
  p.prosrc as body
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
  and l.lanname not in ('c', 'internal')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- skip extension functions
order by 1, 2`;

// What views/matviews read: tables, other views and functions (from the rewrite rules).
const VIEW_DEPS_SQL = `
select distinct vn.nspname || '.' || v.relname as view,
  coalesce(rn.nspname || '.' || rc.relname, pn.nspname || '.' || pp.proname) as ref,
  case when rc.oid is not null then 'relation' else 'function' end as ref_kind
from pg_depend d
join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
join pg_class v on v.oid = r.ev_class
join pg_namespace vn on vn.oid = v.relnamespace
left join pg_class rc on d.refclassid = 'pg_class'::regclass and rc.oid = d.refobjid
left join pg_namespace rn on rn.oid = rc.relnamespace
left join pg_proc pp on d.refclassid = 'pg_proc'::regclass and pp.oid = d.refobjid
left join pg_namespace pn on pn.oid = pp.pronamespace
where d.refobjid <> v.oid and (rc.oid is not null or pp.oid is not null)
  and vn.nspname not in ('pg_catalog', 'information_schema')
  and coalesce(rn.nspname, pn.nspname) not in ('pg_catalog', 'information_schema')
order by 1, 2`;

const TRIGGERS_SQL = `
select tn.nspname || '.' || tc.relname as table, t.tgname as name, pn.nspname || '.' || p.proname as function,
  pg_get_triggerdef(t.oid) as def, t.tgenabled <> 'D' as enabled
from pg_trigger t
join pg_class tc on tc.oid = t.tgrelid join pg_namespace tn on tn.oid = tc.relnamespace
join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal and tn.nspname not in ('pg_catalog', 'information_schema')
order by 1, 2`;

// For DDL snapshots: enum and domain types, sequences, extensions.
const TYPES_SQL = `
select n.nspname as schema, t.typname as name, case t.typtype when 'e' then 'enum' else 'domain' end as kind,
  (select coalesce(json_agg(e.enumlabel order by e.enumsortorder), '[]') from pg_enum e where e.enumtypid = t.oid) as labels,
  case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end as base,
  t.typnotnull as not_null, t.typdefault as default,
  (select coalesce(json_agg(pg_get_constraintdef(c.oid)), '[]') from pg_constraint c where c.contypid = t.oid) as checks
from pg_type t join pg_namespace n on n.oid = t.typnamespace
where t.typtype in ('e', 'd') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
  and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
order by 1, 2`;

const SEQUENCES_SQL = `
select schemaname as schema, sequencename as name, data_type::text as type, start_value::text as start, increment_by::text as increment
from pg_sequences where schemaname not in ('pg_catalog', 'information_schema') order by 1, 2`;

const EXTENSIONS_SQL = `select extname as name, extversion as version from pg_extension where extname <> 'plpgsql' order by 1`;

const dbFile = (envName, name) => path.join(CACHE, envName, 'pg', `${name}.json`);

async function syncDb(envName, { name, url }) {
  const sql = connect(url);
  const started = Date.now();
  const ms = getTimeouts().pgIndexMs;
  const q = (text) => guarded(sql, ms, 'index', (t) => t.unsafe(text));
  const store = require('./pgstore').writer(dbFile(envName, name));
  const counts = {}, tables = [];
  try {
    const [meta] = await q('select current_database() as database, version() as version');
    // Cursor batches contain one object: even a large function body never causes
    // an entire database's source strings to accumulate in the driver result.
    for (const [section, query, optional] of [
      ['tables', CATALOG_SQL], ['functions', FUNCTIONS_SQL], ['viewDeps', VIEW_DEPS_SQL], ['triggers', TRIGGERS_SQL],
      ['types', TYPES_SQL, true], ['sequences', SEQUENCES_SQL, true], ['extensions', EXTENSIONS_SQL, true],
    ]) {
      store.ensure(section); counts[section] = 0;
      try {
        // Size is checked on the server before the driver's JSON parser sees
        // an object. A pathological single definition fails the refresh safely.
        const bounded = `select case when octet_length(row_to_json(dt_row)::text) <= ${require('./pgstore').LIMIT} then row_to_json(dt_row) else json_build_object('__dt_catalog_too_large', true) end as object from (${query}) dt_row`;
        await guarded(sql, ms, 'index', t => t.unsafe(bounded).cursor(1, rows => {
          for (const { object: row } of rows) {
            if (row.__dt_catalog_too_large) throw Object.assign(new Error(`Postgres catalog ${name}: one ${section} object exceeds 8 MiB; previous catalog preserved`), { code: 'DT_PG_CATALOG' });
            store.add(section, row); counts[section]++;
            if (section === 'tables') tables.push({ schema: row.schema, name: row.name, kind: row.kind });
          }
        }));
      } catch (e) { if (!optional || counts[section] || !/^[0-9A-Z]{5}$/.test(e.code || '')) throw e; }
    }
    const dictionaries = await dictionaryRows(q, tables);
    const fs = require('fs'), side = dictFile(envName, name);
    fs.mkdirSync(path.dirname(side), { recursive: true });
    writeJson(side, Object.fromEntries(Object.entries(dictionaries).filter(([, d]) => d.rows).map(([k, d]) => [k, { columns: d.columns, rows: d.rows }])));
    store.ensure('dictionaries');
    for (const [key, { rows, columns, ...d }] of Object.entries(dictionaries)) store.add('dictionaries', { ...d, ...(rows ? { count: rows.length } : {}), $key: key });
    const elapsed = Date.now() - started;
    store.commit({ db: name, database: meta.database, version: meta.version, syncedAt: new Date().toISOString(), ms: elapsed });
    return { ...counts, dictionaries: Object.keys(dictionaries).length, ms: elapsed };
  } catch (e) { store.abort(); throw e; }

}

// Rows of the dictionary tables (reference data: carriers, countries, statuses), for test data and the
// DDL snapshot: tables whose name matches pg.dictionaries (default ^d_), up to pg.dictionaryRows (10000) each and
// pg.dictionaryBytes (32 MB) for the whole database; past that, tables are listed without rows (skipped).
function dictionaryConfig() {
  let c = {};
  try { c = require('./config').load().raw.pg || {}; } catch {}
  return { re: new RegExp(process.env.DT_PG_DICTIONARIES || c.dictionaries || '^d_', 'i'), max: Number(process.env.DT_PG_DICTIONARY_ROWS || c.dictionaryRows || 10000),
    bytes: Number(process.env.DT_PG_DICTIONARY_BYTES || c.dictionaryBytes || 32e6) };
}
async function dictionaryRows(q, tables) {
  const { re, max, bytes } = dictionaryConfig();
  const out = {};
  const qi = (n) => `"${String(n).replace(/"/g, '""')}"`;
  const cell = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? String(v) : v);
  let size = 0;
  for (const t of tables) {
    if (t.kind !== 'table' || !re.test(t.name)) continue;
    const k = `${t.schema}.${t.name}`.toLowerCase();
    if (size >= bytes) { out[k] = { skipped: `over pg.dictionaryBytes (${bytes})` }; continue; }
    try {
      const rows = [...await q(`select * from ${qi(t.schema)}.${qi(t.name)} order by 1 limit ${max + 1}`)];
      const columns = rows.length ? Object.keys(rows[0]) : [], values = rows.slice(0, max).map(r => columns.map(c => cell(r[c])));
      size += JSON.stringify(values).length;
      out[k] = { columns, rows: values, ...(rows.length > max ? { truncated: true } : {}) };
    } catch (e) { out[k] = { error: e.message }; }
  }
  return out;
}
const dictFile = (envName, name) => path.join(CACHE, envName, 'pg', `${name}.dictionaries.json`);
// the rows of one db's dictionaries, read once per file version: { table: { columns, rows: [[...]] } }
const dictMemo = new Map();
function dictionaryData(envName, name) {
  const f = dictFile(envName, name), fs = require('fs');
  let stamp; try { const st = fs.statSync(f); stamp = `${st.mtimeMs}:${st.size}`; } catch { return {}; }
  const m = dictMemo.get(f); if (m?.stamp === stamp) return m.data;
  const data = require('./pgstore').loadDictionary(f); dictMemo.delete(f); dictMemo.set(f, { stamp, data });
  while (dictMemo.size > 2) dictMemo.delete(dictMemo.keys().next().value);
  return data;
}

// Synced catalog of one db (null if never synced). Each dictionary's rows load on first use (rows is lazy).
function loadDb(envName, name) {
  const file = dbFile(envName, name);
  const cat = require('./pgstore').load(file);
  if (!cat) return null;
  for (const [k, d] of Object.entries(cat.dictionaries || {})) {
    if (!d || Object.hasOwn(d, 'rows')) continue;
    let rows;
    Object.defineProperty(d, 'rows', { enumerable: false, configurable: true, get() {
      if (rows) return rows;
      const x = dictionaryData(envName, name)[k];
      return (rows = x ? x.rows.map(r => Object.fromEntries(x.columns.map((c, i) => [c, r[i]]))) : undefined);
    } });
  }
  return cat;
}

// All synced dbs of an env (databases removed from the config are skipped).
function loadAll(envName) {
  return databases(envName).map(d => loadDb(envName, d.name)).filter(Boolean);
}

async function sync(envName, { only, log = console.error } = {}) {
  let dbs = databases(envName);
  if (only) dbs = dbs.filter(d => only.includes(d.name));
  if (!dbs.length) throw new Error(only ? `No configured db named ${only.join(', ')} in ${envName}` : `No Postgres URLs for ${envName}: set DATABASE_URL_<NAME> in ${getEnv(envName).envFile} (see .env.example)`);

  const results = await pool(dbs, 8, async (d) => {
    const r = await syncDb(envName, d);
    log(`pg ${d.name}: ${r.tables} tables, ${r.functions} functions, ${r.triggers} triggers, ${r.ms}ms`);
    return r;
  });
  for (const r of results) if (r.error) log(`pg ${r.item.name}: ERROR ${r.error.message}`);
  writeIndex(envName);
  await closeAll();
  return results.map(r => ({ db: r.item.name, ...(r.error ? { error: r.error.message } : r.value) }));
}

// schema -> [db] over everything in the cache (also DBs not synced this run)
function writeIndex(envName) {
  const schemas = {};
  for (const cat of loadAll(envName)) for (const s of new Set(cat.tables.map(t => t.schema))) (schemas[s] ??= []).push(cat.db);
  writeJson(indexFile(envName), { syncedAt: new Date().toISOString(), schemas });
}

// Offline discovery must use the same bounded reader as configured databases.
function loadCached(env, { onError = (db, e) => console.error(`pg cache ${db}: ${e.message}`) } = {}) {
  let files; try { files = require('fs').readdirSync(path.join(CACHE, env, 'pg')); } catch { return []; }
  const out = [];
  for (const f of files.filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.dictionaries.json'))) {
    const db = f.slice(0, -5);
    try { const cat = loadDb(env, db); if (cat?.db && Array.isArray(cat.tables)) out.push(cat); }
    catch (e) { onError(db, e); }
  }
  return out;
}
function functionCounts(cat) {
  const counts = new Map();
  for (const f of cat.functions || []) { const key = `${f.schema}\0${f.name}`; counts.set(key, (counts.get(key) || 0) + 1); }
  return counts;
}

module.exports = { loadCached, functionCounts, query, sync, closeAll, resolveDb, databases, loadDb, loadAll, writeIndex };
