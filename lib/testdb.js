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
  const lifecycle = require('./state-machine').create(require('./lifecycles').control);
  let primary;
  try {
    await sql`set statement_timeout = '120s'`;
    let systemId = null;
    try { const [system] = await sql`select system_identifier::text as id from pg_control_system()`; systemId = system.id; } catch (e) { if (e.code !== '42501') throw e; }
    // A session lock coordinates separate dt servers/processes, including CREATE DATABASE which
    // cannot run in a transaction. Cluster resource work is intentionally serialized (one copy).
    await sql`select pg_advisory_lock(hashtextextended('dev-tool scratch lifecycle v1', 0))`;
    lifecycle.to('locked');
    const schema = await sql`select obj_description(oid, 'pg_namespace') as comment from pg_namespace where nspname = ${SCHEMA}`;
    if (!schema.length) {
      if (!initialize) throw new Error('scratch cluster is not initialized: call testdb_initialize first');
      lifecycle.to('initializing');
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
    lifecycle.to('verifying');
    await sql.unsafe(`alter table ${SCHEMA}.identity add column if not exists system_id text`);
    const [identity] = await sql.unsafe(`select cluster_id, label, system_id, created_at from ${SCHEMA}.identity where id`);
    if (identity?.system_id && systemId && identity.system_id !== systemId) throw new Error('scratch physical cluster identity changed: copied registry cannot own this cluster');
    if (!identity?.system_id && systemId) { await sql.unsafe(`update ${SCHEMA}.identity set system_id=$1 where id`, [systemId]); identity.system_id = systemId; }
    if (!identity || !/^[0-9a-f-]{36}$/.test(identity.cluster_id)) throw new Error('invalid scratch cluster identity');
    lifecycle.to('ready');
    return await fn(sql, identity);
  } catch (error) { primary = error; lifecycle.to('failed'); throw error; }
  finally {
    lifecycle.to('releasing');
    try { await sql.end({ timeout: 2 }); lifecycle.to('closed'); }
    catch (cleanup) { lifecycle.to('cleanup-failed'); if (primary) { primary.cleanupError = cleanup.message; throw primary; } throw cleanup; }
  }
}
async function initialize({ label } = {}) {
  return withControl(async (sql, identity) => {
    const [role] = await sql`select rolcreatedb, rolcreaterole, rolsuper from pg_roles where rolname = current_user`;
    if (!role.rolcreatedb && !role.rolsuper) throw new Error('scratch role needs CREATEDB to prepare test databases');
    return { version: 1, initialized: true, cluster: identity.cluster_id, label: identity.label, copyConcurrency: 1, capabilities: { createDatabase: true, privateApplicationRoles: role.rolcreaterole || role.rolsuper, physicalClusterIdentity: identity.system_id ? 'verified' : 'registry-uuid (pg_control_system permission unavailable)' } };
  }, { initialize: true, label });
}
function marker(identity, resourceId) { return `dt-testdb:v1:${identity.cluster_id}:${resourceId}`; }
// withControl's advisory lock owns the operation; SQL also fences the prior
// state so a stale callback cannot revive a released lease or invalid template.
async function updateState(sql, table, key, to, details = {}, { replace = false } = {}) {
  const spec = { resources: ['name', 'scratch'], templates: ['key', 'template'], leases: ['id', 'lease'] }[table];
  if (!spec) throw new Error('Unknown scratch state table');
  const model = require('./lifecycles')[spec[1]];
  require('./state-machine').assertState(model, to);
  const from = model.states.filter(s => s === to || model.transitions[s].includes(to));
  const rows = await sql.unsafe(`update ${SCHEMA}.${table} set state=$2,details=${replace ? '$4::jsonb' : 'details || $4::jsonb'} where ${spec[0]}=$1 and state=any($3::text[]) returning state`, [key, to, from, details]);
  if (rows.length !== 1) throw Object.assign(new Error(`${model.name}: resource missing or transition to ${to} refused`), { code: 'DT_STATE_TRANSITION', machine: model.name, to });
  return rows[0];
}
async function ownedCreate(sql, identity, { kind = 'test', templateKey, lease, template = 'template0', details = {}, expiresAt, namePrefix = 'dt_test_' } = {}) {
  details = { ...details, owner: require('./access').owner() };
  const id = crypto.randomUUID(), name = namePrefix + crypto.randomBytes(14).toString('hex');
  await sql.unsafe(`insert into ${SCHEMA}.resources (name,resource_id,cluster_id,kind,state,template_key,lease,expires_at,details) values ($1,$2,$3,$4,'creating',$5,$6,$7,$8)`, [name, id, identity.cluster_id, kind, templateKey || null, lease || null, expiresAt || null, details]);
  try {
    await sql.unsafe(`create database ${qi(name)} template ${qi(template)}`);
    await sql.unsafe(`comment on database ${qi(name)} is ${ql(marker(identity, id))}`);
    await sql.unsafe(`revoke all on database ${qi(name)} from public`);
    await updateState(sql, 'resources', name, 'ready');
    return { name, resourceId: id };
  } catch (e) {
    await updateState(sql, 'resources', name, 'failed', { error: e.message });
    try { await ownedDrop(sql, identity, name); } catch (cleanup) { e.cleanupError = cleanup.message; }
    throw e;
  }
}
async function ownedDrop(sql, identity, name) {
  const [resource] = await sql.unsafe(`select * from ${SCHEMA}.resources where name=$1`, [name]);
  if (!resource || resource.cluster_id !== identity.cluster_id) throw new Error(`database ${name} has no owned scratch resource record`);
  require('./access').assertOwner(resource.details?.owner);
  const [db] = await sql`select d.oid, d.datallowconn, pg_get_userbyid(d.datdba) as owner, shobj_description(d.oid, 'pg_database') as comment from pg_database d where datname = ${name}`;
  if (db) {
    const [{ user }] = await sql`select current_user as "user"`;
    if (db.comment !== marker(identity, resource.resource_id) || db.owner !== user) {
      const error = `ownership mismatch for ${name}; database was not deleted`;
      await updateState(sql, 'resources', name, 'cleanup-failed', { cleanupError: error });
      throw new Error(error);
    }
    try { await sql.unsafe(`drop database ${qi(name)} with (force)`); }
    catch (e) {
      await updateState(sql, 'resources', name, 'cleanup-failed', { cleanupError: e.message });
      throw e;
    }
  }
  const role = resource.details?.applicationRole;
  if (role) {
    const [exists] = await sql`select shobj_description(oid,'pg_authid') as comment from pg_roles where rolname=${role}`;
    if (exists && exists.comment !== `dt-testdb-app:v1:${identity.cluster_id}:${resource.resource_id}`) throw new Error('scratch application role ownership mismatch; role was not deleted');
    if (exists) await sql.unsafe(`drop role ${qi(role)}`);
  }
  require('./state-machine').next(require('./lifecycles').scratch, resource.state, 'deleted');
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
async function runStatements(database, statements, { allowPartial = false, signal = require('./execution').signal() } = {}) {
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
async function create(runId, statements, { allowPartial = false, signal = require('./execution').signal() } = {}) {
  checkStatements(statements);
  return withControl(async (sql, identity) => {
    signal?.throwIfAborted();
    const resource = await ownedCreate(sql, identity, { details: { runId: String(runId).slice(0, 100) }, expiresAt: new Date(Date.now() + 3600000) });
    try {
      const errors = await runStatements(resource.name, statements, { allowPartial, signal });
      let application;
      if (require('./access').current().multiUser) {
        // Never give a tenant's test process the administrative scratch credentials.
        const role = `dt_app_${crypto.randomBytes(12).toString('hex')}`, password = crypto.randomBytes(24).toString('base64url');
        await sql.unsafe(`update ${SCHEMA}.resources set details=details || $2::jsonb where name=$1`, [resource.name, { applicationRole: role }]);
        await sql.unsafe(`create role ${qi(role)} login password ${ql(password)} noinherit nocreatedb nocreaterole nosuperuser`);
        await sql.unsafe(`comment on role ${qi(role)} is ${ql(`dt-testdb-app:v1:${identity.cluster_id}:${resource.resourceId}`)}`);
        await sql.unsafe(`grant connect,temporary on database ${qi(resource.name)} to ${qi(role)}`);
        const app = connect(resource.name);
        try { for (const schema of await app`select nspname from pg_namespace where nspname not in ('pg_catalog','information_schema') and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'`) {
          await app.unsafe(`grant usage,create on schema ${qi(schema.nspname)} to ${qi(role)}`);
          await app.unsafe(`grant all privileges on all tables in schema ${qi(schema.nspname)} to ${qi(role)}`);
          await app.unsafe(`grant all privileges on all sequences in schema ${qi(schema.nspname)} to ${qi(role)}`);
          await app.unsafe(`grant execute on all functions in schema ${qi(schema.nspname)} to ${qi(role)}`);
        } } finally { await app.end({ timeout: 2 }); }
        application = { user: role, password };
      }
      return { ...credentials(resource.name, application), errors, diagnostic: allowPartial };
    } catch (e) {
      try { await ownedDrop(sql, identity, resource.name); } catch (cleanup) { e.cleanupError = cleanup.message; }
      throw e;
    }
  }, { initialize: true });
}
async function drop(name) { return withControl((sql, identity) => ownedDrop(sql, identity, name)); }
async function resources({ limit = 100, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('resources limit 1..500 and nonnegative offset required');
  return withControl(async (sql, identity) => {
    const scope = require('./access').owner().scopeKey;
    const [{ total }] = await sql.unsafe(`select count(*)::int as total from ${SCHEMA}.resources where coalesce(details->'owner'->>'scopeKey','legacy')=$1`, [scope]);
    return { version: 1, cluster: identity.cluster_id, totalResources: total, offset, limit, resources: await sql.unsafe(`select name,kind,state,template_key,lease,created_at,expires_at,details from ${SCHEMA}.resources where coalesce(details->'owner'->>'scopeKey','legacy')=$3 order by created_at limit $1 offset $2`, [limit,offset,scope]) };
  });
}
module.exports = { create, drop, server, initialize, resources, withControl, connect, ownedCreate, ownedDrop, updateState, credentials, marker, checkStatements, runStatements, qi, ql, SCHEMA, sameServer };
