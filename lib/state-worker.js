// One SQLite owner. This worker is also built as a standalone runtime asset.
// No SQL is accepted from callers; every command is bounded and parameterized.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const options = workerData;
let db, closed = false;
const statements = new Map();
const status = { backend: 'sqlite', schemaVersion: 1, journalMode: 'wal', durability: 'FULL', imported: {}, malformedImports: 0, oversizedImports: 0, retentionDeleted: 0, lastCommitAt: null, lastError: null };
const kinds = new Set(['calls', 'jobs', 'executions']);
const stmt = sql => { if (!statements.has(sql)) statements.set(sql, db.prepare(sql)); return statements.get(sql); };
const legacyOwner = options.legacyOwner;
const now = () => new Date().toISOString();
const parsed = text => { try { return JSON.parse(text); } catch { return null; } };
const publicRow = row => row ? ({ kind: row.kind, id: row.id, revision: row.revision, updatedAt: row.updated_at, owner: parsed(row.owner), value: { ...parsed(row.payload), ...(row.annotations !== '{}' ? { metadata: parsed(row.annotations) } : {}) }, editable: ['label', 'notes', 'tags'], cursor: String(row.seq) }) : null;

function begin(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); status.lastCommitAt = now(); status.lastError = null; return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function put({ kind, id, value, owner }) {
  if (!kinds.has(kind) || typeof id !== 'string' || !owner?.scopeKey) throw new Error('invalid operational metadata');
  if (kind === 'calls' && value.evidence?.job?.id) {
    const row = stmt("SELECT payload FROM records WHERE kind='jobs' AND scope=? AND id=?").get(owner.scopeKey, value.evidence.job.id);
    if (row) value = { ...value, evidence: require('./call-evidence').classify(value.target || value.tool, null, { invocation: value.evidence.invocation, traceId: value.evidence.traceId, job: parsed(row.payload) }) };
  }
  const payload = JSON.stringify(value), existing = stmt('SELECT revision, annotations FROM records WHERE kind=? AND scope=? AND id=?').get(kind, owner.scopeKey, id);
  const evidence = value.evidence || {}, revision = (existing?.revision || 0) + 1;
  const updatedAt = now(), at = value.at || value.startedAt || updatedAt;
  const state = evidence.execution?.status || evidence.invocation || value.state || '';
  const failed = evidence.failed === true || value.ok === false || require('./call-evidence').FAILED.has(value.state) || require('./call-evidence').FAILED.has(value.result?.outcome || value.resultSummary?.outcome);
  stmt(`INSERT INTO records(kind,id,scope,owner,at,updated_at,revision,tool,source,state,category,failed,job_id,payload,annotations)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,scope,id) DO UPDATE SET owner=excluded.owner,
    updated_at=excluded.updated_at,revision=excluded.revision,tool=excluded.tool,source=excluded.source,state=excluded.state,
    category=excluded.category,failed=excluded.failed,job_id=excluded.job_id,payload=excluded.payload`)
    .run(kind, id, owner.scopeKey, JSON.stringify(owner), at, updatedAt, revision, value.tool || '', value.source || '', state,
      evidence.execution?.kind || value.kind || '', failed ? 1 : 0, evidence.job?.id || '', payload, existing?.annotations || '{}');
  if (kind === 'jobs') reconcileCalls(id, owner.scopeKey, value);
}

function reconcileCalls(id, scope, job) {
  // A successful invocation returning a running job is not the execution verdict.
  const { classify } = require('./call-evidence');
  for (const row of stmt("SELECT id,payload FROM records WHERE kind='calls' AND scope=? AND job_id=?").all(scope, id)) {
    const value = parsed(row.payload);
    if (!value?.evidence) continue;
    value.evidence = classify(value.target || value.tool, null, { invocation: value.evidence.invocation, traceId: value.evidence.traceId, job });
    stmt("UPDATE records SET payload=?,state=?,category=?,failed=?,revision=revision+1,updated_at=? WHERE kind='calls' AND scope=? AND id=?")
      .run(JSON.stringify(value), value.evidence.execution?.status || value.evidence.invocation || '', value.evidence.execution?.kind || '', value.evidence.failed ? 1 : 0, now(), scope, row.id);
  }
}

function retain() {
  for (const kind of kinds) {
    // Retention is per story, so one busy client cannot evict another's history.
    const keep = options.retention[kind];
    status.retentionDeleted += Number(stmt(`DELETE FROM records WHERE seq IN (SELECT seq FROM (
      SELECT seq,ROW_NUMBER() OVER (PARTITION BY scope ORDER BY seq DESC) AS rn FROM records WHERE kind=?) WHERE rn>?)`).run(kind, keep).changes);
  }
  status.retentionDeleted += Number(stmt(`DELETE FROM records WHERE seq IN (SELECT seq FROM (
    SELECT seq,SUM(length(CAST(payload AS BLOB))) OVER (PARTITION BY scope ORDER BY seq DESC) AS bytes
    FROM records WHERE kind='calls') WHERE bytes>?)`).run(options.callBytes).changes);
}

function projection() {
  const records = [];
  // A global bound protects startup memory even when thousands of stories exist.
  let bytes = 0;
  for (const kind of kinds) {
    let before = Number.MAX_SAFE_INTEGER, count = 0;
    while (count < options.projectionLimit) {
      const rows = stmt('SELECT * FROM records WHERE kind=? AND seq<? ORDER BY seq DESC LIMIT ?').all(kind, before, Math.min(64, options.projectionLimit - count));
      if (!rows.length) break;
      let accepted = 0;
      for (const row of rows) {
        const size = Buffer.byteLength(row.payload) + Buffer.byteLength(row.annotations) + 400;
        if (bytes + size > options.projectionBytes) break;
        records.push(publicRow(row)); bytes += size; count++; accepted++;
      }
      if (accepted < rows.length || bytes >= options.projectionBytes) break;
      before = rows[rows.length - 1].seq;
      if (rows.length < 64) break;
    }
  }
  const document = { version: 1, backend: 'sqlite', writtenAt: now(), records };
  const temporary = `${options.projection}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(document), { mode: 0o600 }); fs.renameSync(temporary, options.projection); }
  catch (error) { try { fs.rmSync(temporary, { force: true }); } catch {} status.projectionError = error.message; }
  return document.records;
}

function migrationCursor(key) { return parsed(stmt('SELECT value FROM migrations WHERE id=?').get(key)?.value) || { offset: 0, lines: 0 }; }
function saveCursor(key, value) {
  const prior = migrationCursor(key), model = require('./lifecycles').migration;
  const lifecycle = require('./state-machine').create(model, prior.state || 'new');
  lifecycle.to('reading'); lifecycle.to(value.complete ? 'complete' : 'paused');
  stmt('INSERT INTO migrations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(key, JSON.stringify({ ...value, state: lifecycle.state }));
}

async function importCalls(file, importOwner = legacyOwner) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  const key = `jsonl:${path.resolve(file)}:${stat.dev}:${stat.ino}`, prior = migrationCursor(key);
  if (prior.offset > stat.size) { status.imported.calls = { complete: false, error: 'legacy source was truncated; retained imported records' }; return; }
  let offset = prior.offset, lines = prior.lines, batch = [];
  const flush = () => { if (!batch.length) return; begin(() => { for (const row of batch) put(row); saveCursor(key, { offset, lines }); }); batch = []; };
  // Split bytes with an explicit line budget. Even a corrupt multi-GB legacy
  // line must not become a multi-GB JS string in the owner worker.
  const input = fs.createReadStream(file, { start: prior.offset, end: Math.max(prior.offset, stat.size - 1) });
  let parts = [], size = 0, oversized = false;
  const consume = (chunk, terminated) => {
    size += chunk.length;
    if (!oversized && size <= options.maxRecordBytes) parts.push(chunk);
    else { oversized = true; parts = []; }
    if (!terminated) return;
    const lineOffset = offset; offset += size + 1; lines++;
    if (oversized) status.oversizedImports++;
    else {
      const line = Buffer.concat(parts).toString('utf8').replace(/\r$/, ''), value = parsed(line);
      if (value && typeof value.tool === 'string') batch.push({ kind: 'calls', id: `legacy:${crypto.createHash('sha256').update(`${path.resolve(file)}:${lineOffset}:${line}`).digest('hex').slice(0, 32)}`, value, owner: importOwner });
      else if (line.trim()) status.malformedImports++;
    }
    parts = []; size = 0; oversized = false;
    if (batch.length >= options.batchSize) flush();
  };
  try {
    for await (const chunk of input) {
      let start = 0, newline;
      while ((newline = chunk.indexOf(10, start)) >= 0) { consume(chunk.subarray(start, newline), true); start = newline + 1; }
      if (start < chunk.length) consume(chunk.subarray(start), false);
    }
    // A trailing partial write remains uncommitted until its newline arrives.
    flush(); begin(() => saveCursor(key, { offset, lines }));
    status.imported.calls = { complete: offset === stat.size, lines, offset, pendingBytes: stat.size - offset };
  } finally { input.destroy(); }
}

function importJobs(file, importOwner = legacyOwner) {
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  const key = `jobs:${path.resolve(file)}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (migrationCursor(key).complete) return;
  if (stat.size > 16 * 1048576) { status.imported.jobs = { complete: false, error: 'legacy jobs exceed 16 MiB; export and import bounded metadata' }; return; }
  const values = parsed(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(values)) { status.imported.jobs = { complete: false, error: 'legacy jobs are not a JSON array' }; return; }
  for (let index = 0; index < values.length; index += options.batchSize) begin(() => {
    for (const value of values.slice(index, index + options.batchSize)) {
      if (!value?.id || Buffer.byteLength(JSON.stringify(value)) > options.maxRecordBytes) continue;
      // A process handle is never resurrected after restart.
      const recovered = ['running', 'queued', 'cancelling', 'draining'].includes(value.state) ? { ...value, state: require('./state-machine').next(require('./lifecycles').job,value.state,'interrupted'), error: value.error || 'server restarted; operation was not replayed' } : value;
      if (!stmt("SELECT 1 FROM records WHERE kind='jobs' AND scope=? AND id=?").get(importOwner.scopeKey, value.id)) put({ kind: 'jobs', id: value.id, value: recovered, owner: importOwner });
    }
  });
  begin(() => saveCursor(key, { complete: true, count: values.length }));
  status.imported.jobs = { complete: true, count: values.length };
}

async function importScopedLegacy() {
  let directories;
  try { directories = fs.readdirSync(options.legacyScopes, { withFileTypes: true }); } catch { return; }
  let imported = 0;
  for (const entry of directories) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
    const directory = path.join(options.legacyScopes, entry.name), file = path.join(directory, '_owner.json');
    let owner;
    try { if (fs.statSync(file).size > 2048) continue; owner = parsed(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!owner || !/^[a-zA-Z0-9][\w.:-]{0,159}$/.test(owner.principalId) || !/^[a-zA-Z0-9][\w.:-]{0,159}$/.test(owner.storyId)) continue;
    const expected = crypto.createHash('sha256').update(owner.principalId + '\0' + owner.storyId).digest('hex').slice(0, 32);
    if (expected !== entry.name || owner.scopeKey !== expected) continue;
    const importedOwner = { principalId: owner.principalId, storyId: owner.storyId, scopeKey: expected, role: owner.role === 'admin' ? 'admin' : 'user', multiUser: owner.multiUser === true };
    await importCalls(path.join(directory, '_calls.jsonl'), importedOwner);
    importJobs(path.join(directory, '_jobs.json'), importedOwner); imported++;
  }
  status.imported.scopes = imported;
}

async function init() {
  fs.mkdirSync(path.dirname(options.file), { recursive: true, mode: 0o700 });
  db = new DatabaseSync(options.file);
  fs.chmodSync(options.file, 0o600);
  db.exec('PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error(`operational state schema ${version} is newer than supported schema 1`);
  db.exec(`CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL,owner TEXT NOT NULL,
    at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL,tool TEXT NOT NULL,source TEXT NOT NULL,
    state TEXT NOT NULL,category TEXT NOT NULL,failed INTEGER NOT NULL,job_id TEXT NOT NULL,payload TEXT NOT NULL,
    annotations TEXT NOT NULL DEFAULT '{}',UNIQUE(kind,scope,id));
    CREATE INDEX IF NOT EXISTS records_scope_page ON records(kind,scope,seq DESC);
    CREATE INDEX IF NOT EXISTS records_scope_tool ON records(kind,scope,tool,seq DESC);
    CREATE INDEX IF NOT EXISTS records_scope_status ON records(kind,scope,state,failed,seq DESC);
    CREATE INDEX IF NOT EXISTS records_scope_job ON records(kind,scope,job_id);
    CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    PRAGMA user_version=1;`);
  await importCalls(options.legacyCalls); importJobs(options.legacyJobs);
  await importScopedLegacy();
  begin(() => { retain(); });
  // Recovery is scoped metadata only; no external operation is retried.
  begin(() => {
    for (const row of stmt("SELECT * FROM records WHERE kind IN ('jobs','executions') AND state IN ('queued','running','cancelling','draining')").all()) {
      const value = parsed(row.payload); value.state = require('./state-machine').next(require('./lifecycles')[row.kind === 'jobs' ? 'job' : 'execution'],value.state,'interrupted'); value.error ||= 'server restarted; operation was not replayed';
      // Another server/CLI may still own an active record. Only recover records whose pid is gone.
      let live = false;
      if (value.processId) { try { process.kill(value.processId, 0); live = true; } catch (error) { live = error.code === 'EPERM'; } }
      if (!live) put({ kind: row.kind, id: row.id, value, owner: parsed(row.owner) });
    }
  });
  return { records: projection(), status: stats() };
}

function whereFor(query, owner) {
  const filters = ['kind=?', 'scope=?'], args = [query.kind, owner.scopeKey];
  for (const [name, column] of [['tool', 'tool'], ['category', 'category']]) if (query[name]) { filters.push(`${column}=?`); args.push(query[name]); }
  if (query.status) {
    filters.push(query.kind === 'calls' ? "(state=? OR json_extract(payload,'$.evidence.invocation')=?)" : 'state=?');
    args.push(query.status); if (query.kind === 'calls') args.push(query.status);
  }
  if (query.source === 'direct') filters.push("source NOT LIKE 'script:%'");
  else if (query.source) { filters.push('source=?'); args.push(query.source); }
  if (query.failed === true) filters.push('failed=1');
  if (query.before) { filters.push('seq<?'); args.push(Number(query.before)); }
  if (query.q) for (const word of String(query.q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10)) { filters.push("lower(tool||' '||source||' '||payload||' '||annotations) LIKE ? ESCAPE '\\'"); args.push(`%${word.replace(/[\\%_]/g, '\\$&')}%`); }
  return { sql: filters.join(' AND '), args };
}
function list(query, owner) {
  if (!kinds.has(query.kind)) throw new Error('metadata kind must be calls, jobs, or executions');
  const { sql, args } = whereFor(query, owner), limit = Math.max(1, Math.min(500, Number(query.limit) || 100));
  const rows = []; let before = Number.MAX_SAFE_INTEGER, bytes = 0, more = false;
  while (rows.length <= limit) {
    const page = stmt(`SELECT * FROM records WHERE ${sql} AND seq<? ORDER BY seq DESC LIMIT ?`).all(...args, before, Math.min(32, limit - rows.length + 1));
    if (!page.length) break;
    let accepted = 0;
    for (const row of page) {
      const size = Buffer.byteLength(row.payload) + Buffer.byteLength(row.annotations) + 400;
      if (rows.length >= limit || bytes + size > 4 * 1048576) { more = true; break; }
      rows.push(row); bytes += size; accepted++;
    }
    if (more || accepted < page.length) break;
    before = page[page.length - 1].seq;
    if (page.length < 32) break;
  }
  return { records: rows.map(publicRow), total: stmt(`SELECT count(*) AS n FROM records WHERE ${sql}`).get(...args).n, nextCursor: more && rows.length ? String(rows[rows.length - 1].seq) : null };
}
function get(kind, id, owner) { return publicRow(stmt('SELECT * FROM records WHERE kind=? AND scope=? AND id=?').get(kind, owner.scopeKey, id)); }
function edit({ kind, id, patch, expectedRevision }, owner) {
  return begin(() => {
    const row = stmt('SELECT * FROM records WHERE kind=? AND scope=? AND id=?').get(kind, owner.scopeKey, id);
    if (!row) throw Object.assign(new Error('metadata record not found'), { code: 'NOT_FOUND' });
    if (row.revision !== expectedRevision) throw Object.assign(new Error('metadata changed; refresh before saving'), { code: 'STALE_REVISION' });
    const annotations = { ...parsed(row.annotations), ...patch };
    stmt('UPDATE records SET annotations=?,revision=revision+1,updated_at=? WHERE seq=?').run(JSON.stringify(annotations), now(), row.seq);
    return get(kind, id, owner);
  });
}
function stats() {
  return { ...status, counts: Object.fromEntries(stmt('SELECT kind,count(*) AS n FROM records GROUP BY kind').all().map(row => [row.kind, row.n])), bytes: (() => { try { return fs.statSync(options.file).size; } catch { return 0; } })() };
}

async function command(message) {
  const { op, data, owner } = message;
  switch (op) {
    case 'init': return init();
    case 'batch': options.callBytes = data.callBytes; begin(() => { for (const record of data.records) put(record); retain(); }); return { records: projection(), status: stats() };
    case 'list': return list(data, owner);
    case 'get': return get(data.kind, data.id, owner);
    case 'edit': { const record = edit(data, owner); projection(); return record; }
    case 'status': return stats();
    case 'flush': db.exec('PRAGMA wal_checkpoint(PASSIVE)'); return { records: projection(), status: stats() };
    case 'clear': begin(() => stmt('DELETE FROM records WHERE kind=? AND scope=?').run(data.kind, owner.scopeKey)); projection(); return { ok: true };
    case 'close': { projection(); db.close(); closed = true; return { ok: true }; }
    default: throw new Error('unknown state command');
  }
}
let chain = Promise.resolve();
parentPort.on('message', message => {
  chain = chain.then(async () => {
    try { if (closed) throw new Error('state worker closed'); parentPort.postMessage({ id: message.id, ok: true, value: await command(message) }); }
    catch (error) {
      const detail = { at: now(), message: error.message, code: error.code };
      if (['init', 'batch', 'flush', 'close'].includes(message.op) || message.op === 'edit' && !['NOT_FOUND', 'STALE_REVISION'].includes(error.code)) status.lastError = detail;
      else if (!['NOT_FOUND', 'STALE_REVISION'].includes(error.code)) status.lastQueryError = detail;
      parentPort.postMessage({ id: message.id, ok: false, error: { message: error.message, code: error.code } });
    }
  });
});
