const path = require('path');
const postgres = require('postgres');
const { getEnv } = require('./config');
const { CACHE, pool, writeJson, readJson } = require('./util');

const conns = new Map();

// Read-only, timeout-guarded connection per URL, reused across calls.
function connect(url) {
  if (!conns.has(url)) {
    conns.set(url, postgres(url, {
      max: 4,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
      connection: {
        application_name: 'dev-tool',
        statement_timeout: 60000,
        default_transaction_read_only: 'on',
      },
    }));
  }
  return conns.get(url);
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

async function query(envName, sql, { db } = {}) {
  const env = getEnv(envName);
  const target = resolveDb(envName, sql, db);
  const url = env.pg[target.db];
  if (!url) throw new Error(`No URL for db "${target.db}" (${env.envFile} missing or incomplete)`);
  const started = Date.now();
  const rows = await connect(url).unsafe(sql);
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
      'comment', col_description(c.oid, a.attnum)) order by a.attnum), '[]')
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
  (select coalesce(json_agg(json_build_object('name', k.conname, 'type', k.contype, 'def', pg_get_constraintdef(k.oid),
      'ref', (select rn.nspname || '.' || rc.relname from pg_class rc join pg_namespace rn on rn.oid = rc.relnamespace where rc.oid = k.confrelid))), '[]')
     from pg_constraint k where k.conrelid = c.oid) as constraints,
  (select coalesce(json_agg(pg_get_indexdef(i.indexrelid)), '[]')
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

const dbFile = (envName, name) => path.join(CACHE, envName, 'pg', `${name}.json`);

async function syncDb(envName, { name, url }) {
  const sql = connect(url);
  const started = Date.now();
  const [tables, functions, viewDeps, triggers, [meta]] = await Promise.all([
    sql.unsafe(CATALOG_SQL),
    sql.unsafe(FUNCTIONS_SQL),
    sql.unsafe(VIEW_DEPS_SQL),
    sql.unsafe(TRIGGERS_SQL),
    sql`select current_database() as database, version() as version`,
  ]);
  writeJson(dbFile(envName, name), {
    db: name, database: meta.database, version: meta.version,
    syncedAt: new Date().toISOString(), ms: Date.now() - started,
    tables: [...tables], functions: [...functions], viewDeps: [...viewDeps], triggers: [...triggers],
  });
  return { tables: tables.length, functions: functions.length, viewDeps: viewDeps.length, triggers: triggers.length, ms: Date.now() - started };
}

// Synced catalog of one db (null if never synced).
const loadDb = (envName, name) => readJson(dbFile(envName, name));

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

module.exports = { query, sync, closeAll, resolveDb, databases, loadDb, loadAll, writeIndex };
