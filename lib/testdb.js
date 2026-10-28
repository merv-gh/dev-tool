// Scratch-only PostgreSQL ownership and lifecycle. Registry + database comments must agree before
// deletion. A prefix alone is never ownership evidence. Metadata is durable in the scratch cluster.
const postgres = require('postgres');
const crypto = require('crypto');
const { getTests, envNames, getEnv } = require('./config');
const SCHEMA = 'dt_test_control';
const MARK = 'dev-tool scratch control v1';
const qi = s => `"${String(s).replace(/"/g, '""')}"`;
const ql = s => `'${String(s).replace(/'/g, "''")}'`;
const normalizeHost = h => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h) ? 'loopback' : h.toLowerCase();
const sameServer = (a, b) => {
  try { const x = new URL(a), y = new URL(b); return normalizeHost(x.hostname) === normalizeHost(y.hostname) && (x.port || '5432') === (y.port || '5432'); } catch { return false; }
};
function server() {
  const url = getTests().pgUrl;
  if (!url) throw new Error('no test database: set tests.pgUrl in config.json (or DT_TEST_DB_URL) to a dedicated scratch PostgreSQL cluster');
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('tests.pgUrl must be a PostgreSQL URL');
  for (const e of envNames()) for (const [db, configured] of Object.entries(getEnv(e).pg)) if (configured && sameServer(configured, url) && new URL(configured).pathname === u.pathname) throw new Error(`tests.pgUrl is the ${e} database "${db}": use a separate scratch control database`);
  return url;
}
function connect(database) {
  const u = new URL(server());
  if (database) u.pathname = `/${database}`;
  return postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 10, idle_timeout: 0, connection: { application_name: 'dev-tool scratch' } });
}
async function withControl(fn, { initialize = false, label = 'dt configured scratch cluster' } = {}) {
  const sql = connect();
  try {
    await sql`set statement_timeout = '120s'`;
    let systemId = null;
    try { const [system] = await sql`select system_identifier::text as id from pg_control_system()`; systemId = system.id; } catch (e) { if (e.code !== '42501') throw e; }
    // A session lock coordinates separate dt servers/processes, including CREATE DATABASE which
    // cannot run in a transaction. Cluster resource work is intentionally serialized (one copy).
    await sql`select pg_advisory_lock(hashtextextended('dev-tool scratch lifecycle v1', 0))`;
    const schema = await sql`select obj_description(oid, 'pg_namespace') as comment from pg_namespace where nspname = ${SCHEMA}`;
    if (!schema.length) {
      if (!initialize) throw new Error('scratch cluster is not initialized: call testdb_initialize first');
      await sql.begin(async tx => {
        await tx.unsafe(`create schema ${SCHEMA}`);
        await tx.unsafe(`comment on schema ${SCHEMA} is ${ql(MARK)}`);
        await tx.unsafe(`revoke all on schema ${SCHEMA} from public`);
        await tx.unsafe(`create table ${SCHEMA}.identity (id boolean primary key default true check(id), cluster_id text not null, label text not null, system_id text, created_at timestamptz not null default now())`);
        await tx.unsafe(`create table ${SCHEMA}.resources (name text primary key, resource_id text not null, cluster_id text not null, kind text not null, state text not null, template_key text, lease text, created_at timestamptz not null default now(), expires_at timestamptz, details jsonb not null default '{}')`);
        await tx.unsafe(`create table ${SCHEMA}.templates (key text primary key, state text not null, created_at timestamptz not null default now(), used_at timestamptz not null default now(), details jsonb not null)`);
        await tx.unsafe(`create table ${SCHEMA}.leases (id text primary key, state text not null, created_at timestamptz not null default now(), expires_at timestamptz not null, details jsonb not null)`);
        await tx.unsafe(`insert into ${SCHEMA}.identity (cluster_id,label,system_id) values ($1,$2,$3)`, [crypto.randomUUID(), String(label).slice(0, 200), systemId]);
      });
    } else if (schema[0].comment !== MARK) throw new Error('scratch control schema exists without the dev-tool ownership marker; refusing to adopt it');
    await sql.unsafe(`alter table ${SCHEMA}.identity add column if not exists system_id text`);
    const [identity] = await sql.unsafe(`select cluster_id, label, system_id, created_at from ${SCHEMA}.identity where id`);
    if (identity?.system_id && systemId && identity.system_id !== systemId) throw new Error('scratch physical cluster identity changed: copied registry cannot own this cluster');
    if (!identity?.system_id && systemId) { await sql.unsafe(`update ${SCHEMA}.identity set system_id=$1 where id`, [systemId]); identity.system_id = systemId; }
    if (!identity || !/^[0-9a-f-]{36}$/.test(identity.cluster_id)) throw new Error('invalid scratch cluster identity');
    return await fn(sql, identity);
  } finally { await sql.end({ timeout: 2 }); }
}
async function initialize({ label } = {}) {
  return withControl(async (sql, identity) => {
    const [role] = await sql`select rolcreatedb, rolcreaterole, rolsuper from pg_roles where rolname = current_user`;
    if (!role.rolcreatedb && !role.rolsuper) throw new Error('scratch role needs CREATEDB to prepare test databases');
    return { version: 1, initialized: true, cluster: identity.cluster_id, label: identity.label, copyConcurrency: 1, capabilities: { createDatabase: true, privateApplicationRoles: role.rolcreaterole || role.rolsuper, physicalClusterIdentity: identity.system_id ? 'verified' : 'registry-uuid (pg_control_system permission unavailable)' } };
  }, { initialize: true, label });
}
function marker(identity, resourceId) { return `dt-testdb:v1:${identity.cluster_id}:${resourceId}`; }
async function ownedCreate(sql, identity, { kind = 'test', templateKey, lease, template = 'template0', details = {}, expiresAt, namePrefix = 'dt_test_' } = {}) {
  const id = crypto.randomUUID(), name = namePrefix + crypto.randomBytes(14).toString('hex');
  await sql.unsafe(`insert into ${SCHEMA}.resources (name,resource_id,cluster_id,kind,state,template_key,lease,expires_at,details) values ($1,$2,$3,$4,'creating',$5,$6,$7,$8)`, [name, id, identity.cluster_id, kind, templateKey || null, lease || null, expiresAt || null, details]);
  try {
    await sql.unsafe(`create database ${qi(name)} template ${qi(template)}`);
    await sql.unsafe(`comment on database ${qi(name)} is ${ql(marker(identity, id))}`);
    await sql.unsafe(`revoke all on database ${qi(name)} from public`);
    await sql.unsafe(`update ${SCHEMA}.resources set state='ready' where name=$1`, [name]);
    return { name, resourceId: id };
  } catch (e) {
    await sql.unsafe(`update ${SCHEMA}.resources set state='failed', details=details || $2::jsonb where name=$1`, [name, { error: e.message }]);
    try { await ownedDrop(sql, identity, name); } catch (cleanup) { e.cleanupError = cleanup.message; }
    throw e;
  }
}
async function ownedDrop(sql, identity, name) {
  const [resource] = await sql.unsafe(`select * from ${SCHEMA}.resources where name=$1`, [name]);
  if (!resource || resource.cluster_id !== identity.cluster_id) throw new Error(`database ${name} has no owned scratch resource record`);
  const [db] = await sql`select d.oid, d.datallowconn, pg_get_userbyid(d.datdba) as owner, shobj_description(d.oid, 'pg_database') as comment from pg_database d where datname = ${name}`;
  if (db) {
    const [{ user }] = await sql`select current_user as "user"`;
    if (db.comment !== marker(identity, resource.resource_id) || db.owner !== user) {
      const error = `ownership mismatch for ${name}; database was not deleted`;
      await sql.unsafe(`update ${SCHEMA}.resources set state='cleanup-failed',details=details || $2::jsonb where name=$1`, [name, { cleanupError: error }]);
      throw new Error(error);
    }
    try { await sql.unsafe(`drop database ${qi(name)} with (force)`); }
    catch (e) {
      await sql.unsafe(`update ${SCHEMA}.resources set state='cleanup-failed',details=details || $2::jsonb where name=$1`, [name, { cleanupError: e.message }]);
      throw e;
    }
  }
  await sql.unsafe(`delete from ${SCHEMA}.resources where name=$1`, [name]);
  return { version: 1, database: name, dropped: !!db };
}
function credentials(database, { user, password } = {}) {
  const u = new URL(server());
  const hostname = u.hostname.includes(':') && !u.hostname.startsWith('[') ? `[${u.hostname}]` : u.hostname;
  return { database, endpoint: { host: u.hostname, port: Number(u.port || 5432), database, parameters: Object.fromEntries([...u.searchParams].filter(([key]) => ['sslmode','sslrootcert','sslcert','sslkey'].includes(key))) }, jdbcUrl: `jdbc:postgresql://${hostname}:${u.port || 5432}/${database}${u.searchParams.has('sslmode') ? '?sslmode=' + encodeURIComponent(u.searchParams.get('sslmode')) : ''}`, user: user ?? decodeURIComponent(u.username), password: password ?? decodeURIComponent(u.password), errors: [] };
}
function checkStatements(statements) {
  if (!Array.isArray(statements) || statements.some(s => typeof s !== 'string')) throw new Error('scratch statements must be an array of SQL strings');
  if (statements.length > 100000 || statements.reduce((n, s) => n + Buffer.byteLength(s), 0) > 256 * 1024 * 1024) throw new Error('scratch SQL exceeds 100000 statements or 256 MiB');
  // Logical fixtures describe database-local state, never cluster administration.
  for (const statement of statements) if (/\b(?:create|alter|drop)\s+(?:database|role|user|tablespace)\b|\bcopy\b[^;]*\bprogram\b/i.test(statement)) throw new Error('fixture SQL contains unsupported cluster administration');
}
async function runStatements(database, statements, { allowPartial = false, signal } = {}) {
  checkStatements(statements);
  const sql = connect(database), errors = [];
  try {
    await sql`set statement_timeout = '120s'`;
    for (let i = 0; i < statements.length; i++) {
      signal?.throwIfAborted();
      try { const query = sql.unsafe(statements[i]); const cancel = () => query.cancel(); signal?.addEventListener('abort', cancel, { once: true }); try { await query; } finally { signal?.removeEventListener('abort', cancel); } }
      catch (e) {
        signal?.throwIfAborted();
        const failure = { index: i, statement: statements[i].split('\n')[0].slice(0, 160), error: e.message, code: e.code };
        errors.push(failure);
        if (!allowPartial) { const error = new Error(`scratch preparation failed at statement ${i + 1}: ${failure.error}`); error.failures = errors; throw error; }
      }
    }
    return errors;
  } finally { await sql.end({ timeout: 2 }); }
}
async function create(runId, statements, { allowPartial = false, signal } = {}) {
  checkStatements(statements);
  return withControl(async (sql, identity) => {
    signal?.throwIfAborted();
    const resource = await ownedCreate(sql, identity, { details: { runId: String(runId).slice(0, 100) }, expiresAt: new Date(Date.now() + 3600000) });
    try {
      const errors = await runStatements(resource.name, statements, { allowPartial, signal });
      return { ...credentials(resource.name), errors, diagnostic: allowPartial };
    } catch (e) {
      try { await ownedDrop(sql, identity, resource.name); } catch (cleanup) { e.cleanupError = cleanup.message; }
      throw e;
    }
  }, { initialize: true });
}
async function drop(name) { return withControl((sql, identity) => ownedDrop(sql, identity, name)); }
async function resources({ limit = 100, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('resources limit 1..500 and nonnegative offset required');
  return withControl(async (sql, identity) => { const [{ total }] = await sql.unsafe(`select count(*)::int as total from ${SCHEMA}.resources`); return { version: 1, cluster: identity.cluster_id, totalResources: total, offset, limit, resources: await sql.unsafe(`select name,kind,state,template_key,lease,created_at,expires_at,details from ${SCHEMA}.resources order by created_at limit $1 offset $2`, [limit,offset]) }; });
}
module.exports = { create, drop, server, initialize, resources, withControl, connect, ownedCreate, ownedDrop, credentials, marker, checkStatements, runStatements, qi, ql, SCHEMA, sameServer };
