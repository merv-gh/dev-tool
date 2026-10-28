// Immutable PostgreSQL fixture bases and private, leased copies. All registry changes and database
// copies share a PostgreSQL session advisory lock, so independent dt processes coordinate safely.
const crypto = require('crypto');
const DB = require('./testdb');
const { SCHEMA, qi, ql } = DB;
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const errorText = e => ({ error: e.message, ...(e.failures ? { failures: e.failures } : {}), ...(e.cleanupError ? { cleanupError: e.cleanupError } : {}) });
const duration = (value, fallback = 3600000) => { value ??= fallback; if (!Number.isInteger(value) || value < 1 || value > 604800000) throw new Error('ttlMs must be 1..604800000'); return value; };
function id(value) { if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error('invalid template key'); return value; }
function leaseId(value) { if (!/^[a-f0-9]{32}$/.test(value || '')) throw new Error('invalid lease id'); return value; }
function inputs(options) {
  let databases, origin;
  if (options.workspace && options.directory) {
    const m = require('./reproduction').loadFixture(options.workspace, options.directory);
    if (!m.complete) throw new Error('templates require a complete verified fixture');
    databases = Object.fromEntries(Object.entries(m.databases).map(([name, db]) => [name, { statements: [...db.statements.schema, ...db.statements.data, ...db.statements.constraints] }]));
    origin = { format: m.version, sqlFiles: Object.fromEntries(Object.entries(m.files).filter(([file]) => /^pg\/[^/]+\/(schema|data|constraints)\.sql$/.test(file))), masked: m.masked }; // Kafka windows and unrelated catalog refreshes do not change PG state.
  } else {
    databases = options.databases;
    origin = { format: 'sql-statements-v1' };
  }
  if (!databases || !Object.keys(databases).length || Object.keys(databases).length > 32) throw new Error('template requires 1..32 logical databases');
  databases = Object.fromEntries(Object.entries(databases).sort(([a], [b]) => a.localeCompare(b)).map(([name, db]) => {
    if (!name || name.length > 200) throw new Error('invalid logical database name');
    DB.checkStatements(db.statements);
    return [name, { statements: db.statements }];
  }));
  const mode = options.mode || 'snapshot';
  if (!['snapshot', 'migrations-empty', 'upgrade'].includes(mode)) throw new Error('template mode must be snapshot, migrations-empty or upgrade');
  if (mode === 'upgrade' && !options.base) throw new Error('upgrade mode needs an immutable base template');
  if (mode !== 'upgrade' && options.base) throw new Error('base is supported only in upgrade mode');
  const sanity = options.sanity || [];
  if (!Array.isArray(sanity) || sanity.length > 100) throw new Error('at most 100 sanity checks');
  for (const check of sanity) {
    if (!Object.hasOwn(databases, check.db) || typeof check.sql !== 'string' || !/^\s*(select|with)\b/i.test(check.sql) || !Object.hasOwn(check, 'expected')) throw new Error('sanity checks need a logical db, read-only SELECT SQL and exact expected row array');
  }
  return { version: 1, databases, origin, mode, base: options.base ? id(options.base) : null, policy: options.policy || {}, compatibility: options.compatibility || {}, sanity };
}
async function compatibility(sql, requested = {}) {
  const [version] = await sql`select current_setting('server_version_num') as version, current_setting('server_encoding') as encoding`;
  const [locale] = await sql`select datcollate, datctype, to_jsonb(d)->>'datlocprovider' as locale_provider, to_jsonb(d)->>'daticulocale' as icu_locale, to_jsonb(d)->>'datcollversion' as collation_version from pg_database d where datname = 'template0'`;
  const extensions = await sql`select name, default_version from pg_available_extensions order by name`;
  if (requested.major && String(Math.floor(Number(version.version) / 10000)) !== String(requested.major)) throw new Error(`PostgreSQL major mismatch: requested ${requested.major}, available ${version.version}`);
  for (const [name, expected] of Object.entries(requested.extensions || {})) if (!extensions.some(e => e.name === name && e.default_version === String(expected))) throw new Error(`extension compatibility mismatch: ${name} ${expected}`);
  if (requested.collation && locale.datcollate !== requested.collation) throw new Error('PostgreSQL collation mismatch');
  return { ...version, ...locale, extensions };
}
async function snapshot(database, { validate = false, sanity = [], signal } = {}) {
  const sql = DB.connect(database);
  try {
    await sql`set statement_timeout = '120s'`;
    const unsupported = [
      ...await sql`select 'row-level-security' as kind, n.nspname || '.' || c.relname as object from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relrowsecurity and n.nspname not in ('pg_catalog','information_schema')`,
      ...await sql`select 'security-definer' as kind, p.oid::regprocedure::text as object from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname not in ('pg_catalog','information_schema') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`,
      ...await sql`select 'foreign-table' as kind, n.nspname || '.' || c.relname as object from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='f'`,
    ];
    if (unsupported.length) { const e = new Error(`unsupported scratch fixture fidelity: ${unsupported.map(x => `${x.kind} ${x.object}`).join(', ')}`); e.unsupported = unsupported; throw e; }
    if (validate) {
      for (const c of await sql`select conname,n.nspname,c.relname from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where not k.convalidated and n.nspname not in ('pg_catalog','information_schema')`) await sql.unsafe(`alter table ${qi(c.nspname)}.${qi(c.relname)} validate constraint ${qi(c.conname)}`);
      await sql`analyze`;
    }
    const tables = [];
    for (const t of await sql`select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','m') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' order by 1,2`) {
      signal?.throwIfAborted();
      const [counts] = await sql.unsafe(`select count(*)::text as rows, md5(coalesce(string_agg(h, '' order by h), '')) as content from (select md5(row_to_json(t)::text) as h from ${qi(t.schema)}.${qi(t.name)} t) s`);
      tables.push({ ...t, ...counts });
    }
    const columns = await sql`select table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,is_generated,generation_expression from information_schema.columns where table_schema not in ('pg_catalog','information_schema') order by 1,2,4`;
    const constraints = await sql`select n.nspname as schema,c.relname as table,k.conname,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') order by 1,2,3`;
    const sequences = await sql`select schemaname,sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,last_value from pg_sequences where schemaname not in ('pg_catalog','information_schema') order by 1,2`;
    const extensions = await sql`select extname,extversion from pg_extension order by extname`;
    const indexes = await sql`select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname not in ('pg_catalog','information_schema') order by 1,2,3`;
    const views = await sql`select schemaname,viewname,definition from pg_views where schemaname not in ('pg_catalog','information_schema') order by 1,2`;
    const triggers = await sql`select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname not in ('pg_catalog','information_schema') order by 1,2,3`;
    const types = await sql`select n.nspname,t.typname,t.typtype,t.typnotnull,t.typdefault,format_type(t.typbasetype,t.typtypmod) as base,coalesce((select json_agg(e.enumlabel order by e.enumsortorder)::text from pg_enum e where e.enumtypid=t.oid),'') as labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype in ('d','e') and n.nspname not in ('pg_catalog','information_schema') order by 1,2`;
    const functions = await sql`select p.oid::regprocedure::text as name,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.prokind <> 'a' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1`;
    const checks = [];
    for (const check of sanity) {
      signal?.throwIfAborted();
      const actual = await sql.begin(async tx => { await tx`set transaction read only`; return Array.from(await tx.unsafe(check.sql, check.params || [])); });
      if (stable(actual) !== stable(check.expected)) throw new Error(`template sanity check failed: ${check.name || check.sql.slice(0, 80)}`);
      checks.push({ name: check.name || check.sql.slice(0, 80), passed: true });
    }
    return { fingerprint: hash({ tables, columns, constraints, sequences, extensions, functions, indexes, views, triggers, types }), tables, extensions, checks };
  } finally { await sql.end({ timeout: 2 }); }
}
async function templateRow(sql, key) { const [row] = await sql.unsafe(`select * from ${SCHEMA}.templates where key=$1`, [id(key)]); if (!row) throw new Error('template not found'); return row; }
async function verifyOwned(sql, identity, row) {
  const failures = [];
  if (row.state !== 'ready') failures.push({ kind: 'state', state: row.state });
  for (const [logical, info] of Object.entries(row.details.databases || {})) {
    const [resource] = await sql.unsafe(`select * from ${SCHEMA}.resources where name=$1`, [info.database]);
    const [database] = await sql`select datallowconn,datistemplate,pg_get_userbyid(datdba) as owner,shobj_description(oid,'pg_database') as comment from pg_database where datname=${info.database}`;
    const [{ owner }] = await sql`select current_user as owner`;
    if (!resource || resource.template_key !== row.key || resource.cluster_id !== identity.cluster_id || !database || database.owner !== owner || database.comment !== DB.marker(identity, resource.resource_id)) failures.push({ kind: 'ownership', db: logical });
    else if (database.datallowconn || database.datistemplate) failures.push({ kind: 'not-frozen', db: logical });
  }
  if (Object.keys(row.details.databases || {}).length === 0) failures.push({ kind: 'empty-template' });
  return failures;
}
function publicTemplate(row) {
  return { version: 1, id: row.key, state: row.state, createdAt: row.created_at, usedAt: row.used_at, mode: row.details.mode, inputHash: row.details.inputHash, databases: row.details.databases, compatibility: row.details.compatibility, pinned: !!row.details.pinned, timings: row.details.timings, ...(row.details.failure ? { failure: row.details.failure } : {}), ...(row.details.invalidated ? { invalidated: row.details.invalidated } : {}) };
}
async function build(options = {}) {
  const spec = inputs(options), started = Date.now();
  return DB.withControl(async (sql, identity) => {
    options.signal?.throwIfAborted();
    const platform = await compatibility(sql, spec.compatibility), key = hash({ spec, platform });
    const [existing] = await sql.unsafe(`select * from ${SCHEMA}.templates where key=$1`, [key]);
    if (existing?.state === 'ready') {
      const failures = await verifyOwned(sql, identity, existing);
      if (failures.length) throw new Error(`template verification failed: ${stable(failures)}; invalidate before rebuilding`);
      await sql.unsafe(`update ${SCHEMA}.templates set used_at=now() where key=$1`, [key]);
      return { ...publicTemplate(existing), reused: true, cluster: identity.cluster_id, ms: Date.now() - started };
    }
    if (existing) throw new Error(`template ${key} is ${existing.state}; inspect and invalidate/delete it before rebuilding the same input`);
    let base;
    if (spec.base) {
      base = await templateRow(sql, spec.base);
      const failures = await verifyOwned(sql, identity, base);
      if (failures.length) throw new Error(`upgrade base is not verified: ${stable(failures)}`);
      if (stable(Object.keys(base.details.databases).sort()) !== stable(Object.keys(spec.databases).sort())) throw new Error('upgrade logical databases must match the base');
    }
    const details = { mode: spec.mode, inputHash: hash(spec), compatibility: platform, databases: {}, pinned: options.pin === true, timings: {} };
    await sql.unsafe(`insert into ${SCHEMA}.templates (key,state,details) values ($1,'building',$2)`, [key, details]);
    try {
      for (const [logical, input] of Object.entries(spec.databases)) {
        options.signal?.throwIfAborted();
        const step = Date.now();
        const resource = await DB.ownedCreate(sql, identity, { kind: 'template', templateKey: key, namePrefix: 'dt_tpl_', template: base?.details.databases[logical].database || 'template0', details: { logical, inputHash: hash(input) } });
        details.databases[logical] = { database: resource.name };
        await sql.unsafe(`update ${SCHEMA}.templates set details=$2 where key=$1`, [key, details]);
        await DB.runStatements(resource.name, input.statements, { signal: options.signal });
        const checked = await snapshot(resource.name, { validate: true, sanity: spec.sanity.filter(c => c.db === logical), signal: options.signal });
        await sql.unsafe(`alter database ${qi(resource.name)} allow_connections false`);
        await sql.unsafe(`update ${SCHEMA}.resources set state='frozen' where name=$1`, [resource.name]);
        const [{ bytes }] = await sql`select pg_database_size(${resource.name})::text as bytes`;
        details.databases[logical] = { database: resource.name, ...checked, bytes, ms: Date.now() - step };
      }
      details.timings.buildMs = Date.now() - started;
      await sql.unsafe(`update ${SCHEMA}.templates set state='ready',details=$2 where key=$1`, [key, details]);
      return { version: 1, id: key, state: 'ready', cluster: identity.cluster_id, databases: details.databases, timings: details.timings, reused: false, mode: spec.mode };
    } catch (e) {
      const cleanup = [];
      for (const resource of await sql.unsafe(`select name from ${SCHEMA}.resources where template_key=$1 and kind='template'`, [key])) try { await DB.ownedDrop(sql, identity, resource.name); } catch (dropError) { cleanup.push(dropError.message); }
      details.failure = { ...errorText(e), cleanup };
      await sql.unsafe(`update ${SCHEMA}.templates set state='failed',details=$2 where key=$1`, [key, details]);
      e.template = key; e.cleanupErrors = cleanup; throw e;
    }
  });
}
async function inspect(template) { return DB.withControl(async (sql, identity) => { const row = await templateRow(sql, template); return { ...publicTemplate(row), cluster: identity.cluster_id, failures: await verifyOwned(sql, identity, row) }; }); }
async function list({ limit = 50, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw new Error('template list limit 1..200 and nonnegative offset required');
  return DB.withControl(async (sql, identity) => {
    const [{templates,leases}] = await sql.unsafe(`select (select count(*)::int from ${SCHEMA}.templates) as templates,(select count(*)::int from ${SCHEMA}.leases) as leases`);
    return { version: 1, cluster: identity.cluster_id, totalTemplates: templates, totalLeases: leases, limit, offset,
      templates: (await sql.unsafe(`select * from ${SCHEMA}.templates order by used_at desc limit $1 offset $2`, [limit,offset])).map(t => ({ version: 1, id: t.key, state: t.state, mode: t.details.mode, inputHash: t.details.inputHash, createdAt: t.created_at, usedAt: t.used_at, pinned: !!t.details.pinned, databases: Object.keys(t.details.databases || {}), bytes: String(Object.values(t.details.databases || {}).reduce((n,d)=>n+BigInt(d.bytes || 0),0n)), timings: t.details.timings, ...(t.details.failure ? { failure: t.details.failure } : {}) })),
      leases: (await sql.unsafe(`select id,state,created_at,expires_at,details from ${SCHEMA}.leases order by created_at desc limit $1 offset $2`, [limit,offset])).map(l => ({ lease: l.id, state: l.state, createdAt: l.created_at, expiresAt: l.expires_at, template: l.details.template, runId: l.details.runId, databases: Object.fromEntries(Object.entries(l.details.databases || {}).map(([db, c]) => [db, c.database])), ...(l.details.cleanupErrors ? { cleanupErrors: l.details.cleanupErrors } : {}) })) };
  });
}
async function verify(template, { deep = false, signal } = {}) {
  return DB.withControl(async (sql, identity) => {
    const row = await templateRow(sql, template), failures = await verifyOwned(sql, identity, row), checks = {};
    if (deep && !failures.length) for (const [logical, info] of Object.entries(row.details.databases)) {
      signal?.throwIfAborted();
      const probe = await DB.ownedCreate(sql, identity, { kind: 'verification', templateKey: row.key, template: info.database, expiresAt: new Date(Date.now() + 600000) });
      try { const checked = await snapshot(probe.name, { signal }); checks[logical] = checked; if (checked.fingerprint !== info.fingerprint) failures.push({ kind: 'content-drift', db: logical }); }
      finally { await DB.ownedDrop(sql, identity, probe.name); }
    }
    if (failures.length && row.state === 'ready') await sql.unsafe(`update ${SCHEMA}.templates set state='invalid',details=details || $2::jsonb where key=$1`, [row.key, { invalidated: { reason: 'verification failed', failures, at: new Date().toISOString() } }]);
    return { version: 1, template: row.key, ok: failures.length === 0, depth: deep ? 'content' : 'metadata', failures, checks };
  });
}
async function invalidate(template, reason = 'explicit invalidation') { return DB.withControl(async sql => { const row = await templateRow(sql, template); await sql.unsafe(`update ${SCHEMA}.templates set state='invalid',details=details || $2::jsonb where key=$1`, [row.key, { invalidated: { reason: String(reason).slice(0, 500), at: new Date().toISOString() } }]); return { version: 1, template: row.key, state: 'invalid', existingLeasesPreserved: true }; }); }
function validateSettings(settings = {}) { for (const [name, value] of Object.entries(settings)) if (!/^[a-z_][a-z0-9_.]*$/.test(name) || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 4000) throw new Error(`invalid clone setting ${name}`); return settings; }
function leaseResult(row, extra = {}) { return { version: 1, lease: row.id, template: row.details.template, databases: row.details.databases, expiresAt: row.expires_at, timings: row.details.timings, ...extra, cleanup: () => release(row.id) }; }
async function clone({ template, runId, ttlMs, settings = {}, idempotencyKey, signal } = {}) {
  const ttl = duration(ttlMs), started = Date.now(); validateSettings(settings);
  if (idempotencyKey && (typeof idempotencyKey !== 'string' || idempotencyKey.length > 200)) throw new Error('idempotencyKey must be at most 200 characters');
  return DB.withControl(async (sql, identity) => {
    signal?.throwIfAborted();
    const row = await templateRow(sql, template), failures = await verifyOwned(sql, identity, row);
    if (failures.length) throw new Error(`cannot clone template: ${stable(failures)}`);
    const requestHash = hash({ template, runId, settings, ttlMs: ttl });
    if (idempotencyKey) {
      const [prior] = await sql.unsafe(`select * from ${SCHEMA}.leases where details->>'idempotencyKey'=$1 order by created_at desc limit 1`, [idempotencyKey]);
      if (prior) { if (prior.details.requestHash !== requestHash) throw new Error('idempotency key reused for different clone inputs'); if (prior.state !== 'active' || new Date(prior.expires_at) <= new Date()) throw new Error('idempotent clone lease is no longer active'); return leaseResult(prior, { reused: true }); }
    }
    const lease = crypto.randomBytes(16).toString('hex'), expires = new Date(Date.now() + ttl);
    const role = { name: `dt_app_${crypto.randomBytes(12).toString('hex')}`, password: crypto.randomBytes(24).toString('base64url') };
    const details = { template: row.key, runId: String(runId || '').slice(0, 200), idempotencyKey, requestHash, role, databases: {}, settings, timings: {} };
    await sql.unsafe(`insert into ${SCHEMA}.leases (id,state,expires_at,details) values ($1,'creating',$2,$3)`, [lease, expires, details]);
    try {
      await sql.unsafe(`create role ${qi(role.name)} login password ${ql(role.password)} noinherit nocreatedb nocreaterole`);
      await sql.unsafe(`comment on role ${qi(role.name)} is ${ql(`dt-testdb-role:v1:${identity.cluster_id}:${lease}`)}`);
      for (const [logical, info] of Object.entries(row.details.databases)) {
        signal?.throwIfAborted();
        const resource = await DB.ownedCreate(sql, identity, { kind: 'clone', templateKey: row.key, lease, template: info.database, expiresAt: expires, details: { logical } });
        details.databases[logical] = DB.credentials(resource.name, { user: role.name, password: role.password });
        await sql.unsafe(`update ${SCHEMA}.leases set details=$2 where id=$1`, [lease, details]);
        for (const [name, value] of Object.entries(settings)) await sql.unsafe(`alter database ${qi(resource.name)} set ${qi(name)} to ${ql(value)}`);
        await sql.unsafe(`grant connect,temporary on database ${qi(resource.name)} to ${qi(role.name)}`);
        const app = DB.connect(resource.name);
        try {
          for (const s of await app`select nspname from pg_namespace where nspname not in ('pg_catalog','information_schema') and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'`) {
            await app.unsafe(`grant usage on schema ${qi(s.nspname)} to ${qi(role.name)}`);
            await app.unsafe(`grant all privileges on all tables in schema ${qi(s.nspname)} to ${qi(role.name)}`);
            await app.unsafe(`grant all privileges on all sequences in schema ${qi(s.nspname)} to ${qi(role.name)}`);
            await app.unsafe(`grant execute on all functions in schema ${qi(s.nspname)} to ${qi(role.name)}`);
          }
        } finally { await app.end({ timeout: 2 }); }
      }
      signal?.throwIfAborted();
      details.timings.cloneMs = Date.now() - started;
      await sql.unsafe(`update ${SCHEMA}.leases set state='active',details=$2 where id=$1`, [lease, details]);
      await sql.unsafe(`update ${SCHEMA}.templates set used_at=now() where key=$1`, [row.key]);
      return leaseResult({ id: lease, details, expires_at: expires }, { reused: false });
    } catch (e) {
      const cleanupErrors = await releaseOwned(sql, identity, lease);
      e.lease = lease; e.cleanupErrors = cleanupErrors; throw e;
    }
  });
}
async function releaseOwned(sql, identity, lease) {
  const [row] = await sql.unsafe(`select * from ${SCHEMA}.leases where id=$1`, [leaseId(lease)]);
  if (!row) throw new Error('lease not found');
  if (row.state === 'released') return [];
  const errors = [];
  for (const resource of await sql.unsafe(`select name from ${SCHEMA}.resources where lease=$1 order by created_at desc`, [lease])) try { await DB.ownedDrop(sql, identity, resource.name); } catch (e) { errors.push(`${resource.name}: ${e.message}`); }
  if (!errors.length && row.details.role) {
    const role = row.details.role.name;
    const [exists] = await sql`select shobj_description(oid,'pg_authid') as comment from pg_roles where rolname=${role}`;
    if (exists) {
      if (exists.comment !== `dt-testdb-role:v1:${identity.cluster_id}:${lease}`) errors.push('role ownership mismatch; role was not deleted');
      else try { await sql.unsafe(`drop role ${qi(role)}`); } catch (e) { errors.push(`role ${role}: ${e.message}`); }
    }
  }
  await sql.unsafe(`update ${SCHEMA}.leases set state=$2,details=details || $3::jsonb where id=$1`, [lease, errors.length ? 'cleanup-failed' : 'released', { cleanupErrors: errors }]);
  return errors;
}
async function release(lease) { return DB.withControl(async (sql, identity) => { const cleanupErrors = await releaseOwned(sql, identity, lease); if (cleanupErrors.length) { const e = new Error(`lease cleanup failed: ${cleanupErrors.join('; ')}`); e.cleanupErrors = cleanupErrors; throw e; } return { version: 1, lease, released: true }; }); }
async function renew(lease, ttlMs) { const ttl = duration(ttlMs); return DB.withControl(async sql => { const expires = new Date(Date.now() + ttl); const rows = await sql.unsafe(`update ${SCHEMA}.leases set expires_at=$2 where id=$1 and state='active' returning id`, [leaseId(lease), expires]); if (!rows.length) throw new Error('active lease not found'); await sql.unsafe(`update ${SCHEMA}.resources set expires_at=$2 where lease=$1`, [lease, expires]); return { version: 1, lease, expiresAt: expires }; }); }
async function reset(lease, { ttlMs, signal } = {}) {
  const current = await DB.withControl(async sql => { const [row] = await sql.unsafe(`select * from ${SCHEMA}.leases where id=$1`, [leaseId(lease)]); if (!row || row.state !== 'active' || new Date(row.expires_at) <= new Date()) throw new Error('active unexpired lease required'); return row; });
  const next = await clone({ template: current.details.template, runId: current.details.runId, settings: current.details.settings, ttlMs, signal });
  try { await release(lease); return { ...next, previousLease: lease, reset: 'fresh-private-clone' }; } catch (e) { try { await next.cleanup(); } catch (cleanup) { e.cleanupError = cleanup.message; } throw e; }
}
async function gc({ templateTtlMs = 86400000, maxBytes, maxTemplates, dryRun = false } = {}) {
  if (!Number.isInteger(templateTtlMs) || templateTtlMs < 0) throw new Error('templateTtlMs must be a nonnegative integer');
  if (maxBytes != null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new Error('maxBytes must be a nonnegative safe integer');
  if (maxTemplates != null && (!Number.isInteger(maxTemplates) || maxTemplates < 0)) throw new Error('maxTemplates must be a nonnegative integer');
  return DB.withControl(async (sql, identity) => {
    const result = { version: 1, dryRun, leases: [], templates: [], resources: [], failures: [], retained: [] };
    for (const lease of await sql.unsafe(`select id from ${SCHEMA}.leases where state <> 'released' and expires_at <= now()`)) {
      result.leases.push(lease.id);
      if (!dryRun) { const errors = await releaseOwned(sql, identity, lease.id); result.failures.push(...errors.map(error => ({ lease: lease.id, error }))); }
    }
    const live = await sql.unsafe(`select distinct details->>'template' as key from ${SCHEMA}.leases where state <> 'released' and ${dryRun ? "expires_at > now()" : 'true'}`);
    const active = new Set(live.map(x => x.key));
    const templates = await sql.unsafe(`select * from ${SCHEMA}.templates order by used_at asc`);
    let count = templates.length, bytes = templates.reduce((sum, t) => sum + Object.values(t.details.databases || {}).reduce((n, d) => n + Number(d.bytes || 0), 0), 0);
    for (const template of templates) {
      const candidate = template.state !== 'ready' || Date.now() - new Date(template.used_at).getTime() >= templateTtlMs || (maxTemplates != null && count > maxTemplates) || (maxBytes != null && bytes > maxBytes);
      if (!candidate) continue;
      if (active.has(template.key) || template.details.pinned) { result.retained.push({ template: template.key, reason: active.has(template.key) ? 'active-or-unreleased-lease' : 'pinned' }); continue; }
      result.templates.push(template.key);
      let failed = false;
      if (!dryRun) for (const resource of await sql.unsafe(`select name from ${SCHEMA}.resources where template_key=$1 and kind='template'`, [template.key])) try { await DB.ownedDrop(sql, identity, resource.name); } catch (e) { failed = true; result.failures.push({ database: resource.name, error: e.message }); }
      if (!failed) {
        if (!dryRun) await sql.unsafe(`delete from ${SCHEMA}.templates where key=$1`, [template.key]);
        count--; bytes -= Object.values(template.details.databases || {}).reduce((n, d) => n + Number(d.bytes || 0), 0);
      }
    }
    // Legacy setup and crash-interrupted verification probes also have explicit expiry/ownership.
    for (const resource of await sql.unsafe(`select name from ${SCHEMA}.resources where kind in ('test','verification') and expires_at <= now()`)) {
      result.resources.push(resource.name);
      if (!dryRun) try { await DB.ownedDrop(sql, identity, resource.name); } catch (e) { result.failures.push({ database: resource.name, error: e.message }); }
    }
    result.remainingTemplateBytes = String(bytes); result.remainingTemplates = count; result.budgetSatisfied = (maxBytes == null || bytes <= maxBytes) && (maxTemplates == null || count <= maxTemplates);
    return result;
  });
}
function plan(options = {}) { const spec = inputs(options); return { version: 1, protocol: 'dt.postgres.templates/v1', inputHash: hash(spec), mode: spec.mode, base: spec.base, databases: Object.entries(spec.databases).map(([name, db]) => ({ name, statements: db.statements.length, sqlBytes: db.statements.reduce((n, s) => n + Buffer.byteLength(s), 0) })), compatibility: spec.compatibility, requiredCapabilities: ['initialized-scratch-control-database', 'CREATEDB', 'CREATEROLE for private clones'], verification: 'hash-verified SQL; source snapshot fidelity is limited to the captured/exported schema', next: 'testdb_template_build' }; }
function capabilities() { return { version: 1, protocol: 'dt.postgres.templates/v1', backend: 'postgresql-native-templates', portableInput: 'hashed-sql-statements-v1', concurrency: { copies: 1, coordination: 'PostgreSQL session advisory lock' }, operations: ['plan','build','inspect','list','verify','invalidate','pin','clone','lease','renew','reset','release','gc'], reset: 'fresh-private-clone; reconnect application', ownership: 'registry cluster UUID plus resource UUID in database comment plus database owner', migrationModes: ['snapshot','migrations-empty','upgrade'], unsupportedFidelity: ['row-level-security policies','security-definer ownership','foreign tables'], jsonContract: 'docs/contracts/postgres-template-v1.schema.json' }; }
async function lease(lease, { bindings = false } = {}) { return DB.withControl(async sql => { const [row] = await sql.unsafe(`select * from ${SCHEMA}.leases where id=$1`, [leaseId(lease)]); if (!row) throw new Error('lease not found'); if (bindings) { if (row.state !== 'active' || new Date(row.expires_at) <= new Date()) throw new Error('active unexpired lease required for bindings'); return leaseResult(row); } return { version: 1, lease: row.id, state: row.state, expiresAt: row.expires_at, template: row.details.template, runId: row.details.runId, databases: Object.fromEntries(Object.entries(row.details.databases || {}).map(([name, db]) => [name, { database: db.database, endpoint: db.endpoint, jdbcUrl: db.jdbcUrl, user: db.user }])), cleanupErrors: row.details.cleanupErrors || [] }; }); }
async function pin(template, pinned) { if (typeof pinned !== 'boolean') throw new Error('pinned must be boolean'); return DB.withControl(async sql => { const row = await templateRow(sql,template); await sql.unsafe(`update ${SCHEMA}.templates set details=details || $2::jsonb where key=$1`, [row.key,{pinned}]); return {version:1,template:row.key,pinned}; }); }
module.exports = { pin, lease, plan, capabilities, inputs, build, inspect, list, verify, invalidate, clone, release, renew, reset, gc, snapshot, stable, hash, validateSettings };
