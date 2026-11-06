// Operational metadata: one SQLite owner worker, bounded producer queue, and a
// disposable bounded projection for older synchronous calls/jobs consumers.
// JSONL/jobs files are migration inputs, never a second SQLite write authority.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { create } = require('./state-machine'), lifecycles = require('./lifecycles');

const LEGACY_OWNER = Object.freeze({ principalId: 'local', storyId: 'default', role: 'admin', scopeKey: 'legacy', multiUser: false });
const KINDS = new Set(['calls', 'jobs', 'executions']);
function currentOwner() { try { return require('./access').owner(); } catch { return { ...LEGACY_OWNER }; } }
const keyOf = record => `${record.kind}\0${record.owner.scopeKey}\0${record.id}`;
const cleanOwner = owner => ({ principalId: String(owner.principalId), storyId: String(owner.storyId), role: owner.role || 'user', scopeKey: String(owner.scopeKey), multiUser: owner.multiUser === true });
// Early Node 22 releases require --experimental-sqlite. Test the actual builtin,
// without opening a database or doing synchronous SQL on the main thread.
const sqliteAvailable = () => { try { return typeof require('node:sqlite').DatabaseSync === 'function'; } catch { return false; } };
const clone = value => JSON.parse(JSON.stringify(value));
function operationalValue(kind, value) {
  const input = { ...value };
  for (const key of ['promise', 'controller', 'signal', 'token']) delete input[key];
  if (kind === 'calls') return clone(input); // call arguments are clipped/redacted by calls.js
  let remaining = 96 * 1024, truncated = false;
  const seen = new WeakSet();
  function bounded(item, depth = 0) {
    if (typeof item === 'string') {
      const limit = Math.max(0, Math.min(4000, Math.floor(remaining / 4)));
      remaining -= Math.min(item.length, limit) * 4;
      if (item.length > limit) { truncated = true; return `${item.slice(0, limit)}…`; }
      return item;
    }
    if (item === null || typeof item !== 'object') return typeof item === 'bigint' ? String(item) : item;
    if (seen.has(item) || depth > 8 || remaining < 100) { truncated = true; return Array.isArray(item) ? [] : { metadataOmitted: true }; }
    seen.add(item); remaining -= 100;
    if (Array.isArray(item)) { if (item.length > 100) truncated = true; return item.slice(0, 100).map(child => bounded(child, depth + 1)); }
    const entries = Object.entries(item);
    if (entries.length > 100) truncated = true;
    return Object.fromEntries(entries.slice(0, 100).map(([key, child]) => [key, bounded(child, depth + 1)]));
  }
  if (Array.isArray(input.log) && input.log.length > 100) { input.log = input.log.slice(-100); truncated = true; }
  if (input.result && typeof input.result === 'object') {
    // Preserve application verdicts even when a result's rows/logs are enormous.
    const preferred = ['outcome', 'counts', 'ok', 'status', 'view', 'job', 'workspace', 'runId', 'artifacts'];
    input.result = { ...Object.fromEntries(preferred.filter(key => input.result[key] !== undefined).map(key => [key, input.result[key]])), ...input.result };
  }
  const priority = ['id', 'state', 'tool', 'kind', 'title', 'owner', 'processId', 'parentId', 'startedAt', 'endedAt', 'ms', 'error', 'result'];
  const result = bounded({ ...Object.fromEntries(priority.filter(key => input[key] !== undefined).map(key => [key, input[key]])), ...input });
  if (truncated) result.metadataProjection = { truncated: true, reason: 'operational metadata budget; full output belongs in result artifacts' };
  return result;
}
const newestFirst = (a, b) => {
  if (a.cursor?.startsWith('pending:') && b.cursor?.startsWith('pending:')) return Number(b.cursor.slice(8)) - Number(a.cursor.slice(8));
  if (a.cursor?.startsWith('pending:')) return -1;
  if (b.cursor?.startsWith('pending:')) return 1;
  return Number(b.cursor || 0) - Number(a.cursor || 0) || String(b.value.at || b.value.startedAt || b.updatedAt).localeCompare(String(a.value.at || a.value.startedAt || a.updatedAt));
};

function createStore(settings = {}) {
  const cache = settings.cache || require('./util').CACHE;
  const directory = settings.directory || process.env.DT_STATE_DIR || path.join(cache, 'state');
  const requested = settings.backend || process.env.DT_STATE_BACKEND || 'auto';
  if (!['auto', 'sqlite', 'legacy'].includes(requested)) throw new Error('DT_STATE_BACKEND must be auto, sqlite, or legacy');
  const backend = requested === 'legacy' || requested === 'auto' && !sqliteAvailable() ? 'legacy' : 'sqlite';
  const options = {
    file: path.join(directory, 'operational.sqlite'), projection: path.join(directory, 'projection.json'),
    legacyCalls: settings.legacyCalls || path.join(cache, '_calls.jsonl'), legacyJobs: settings.legacyJobs || path.join(cache, '_jobs.json'),
    legacyScopes: path.join(cache, '_stories'),
    legacyOwner: LEGACY_OWNER, retention: { calls: 5000, jobs: 100, executions: 1000, ...settings.retention },
    projectionLimit: settings.projectionLimit || 5000, projectionBytes: settings.projectionBytes || 8 * 1048576, batchSize: settings.batchSize || 64,
    maxRecordBytes: settings.maxRecordBytes || 262144,
    callBytes: settings.callBytes || 50 * 1048576,
  };
  const maxQueue = settings.maxQueue || 1024, maxQueueBytes = settings.maxQueueBytes || 8 * 1048576;
  const ownerProvider = settings.ownerProvider || currentOwner;
  const callByteLimit = () => {
    if (settings.callBytes) return settings.callBytes;
    let configured;
    try { configured = require('./config').load().raw.log?.maxMb; } catch {}
    return Math.max(1, Number(process.env.DT_LOG_MAX_MB || configured || 50) * 1048576);
  };
  const lifecycle = create(lifecycles.store), shutdown = create(lifecycles.storeClose), writer = create(lifecycles.writer);
  let worker, starting, pumping, closingPromise, seq = 0, queuedBytes = 0, durable = false;
  let records = new Map(), queue = [], scheduled = false;
  const pending = new Map();
  let acceptedSequence = 0;
  const info = { backend, requestedBackend: requested, schemaVersion: backend === 'sqlite' ? 1 : null, durability: backend === 'sqlite' ? 'FULL' : 'legacy synchronous JSON', queued: 0, rejected: 0, failedWrites: 0, lastError: null, lastCommitAt: null, ready: false };
  if (backend === 'legacy' && requested !== 'legacy') info.fallbackReason = 'node:sqlite is unavailable (early Node 22 needs --experimental-sqlite); set DT_STATE_BACKEND=sqlite to require SQLite';
  const owner = supplied => cleanOwner(supplied || ownerProvider());
  const visible = (record, supplied) => record.owner.scopeKey === owner(supplied).scopeKey;
  function warn(error) {
    const next = { at: new Date().toISOString(), message: error.message, code: error.code || 'STATE_ERROR' };
    if (info.lastError?.message !== next.message) process.stderr.write(`dt metadata: ${next.code}: ${next.message}\n`);
    info.lastError = next;
  }
  function hydrate(rows) {
    const fresh = new Map(rows.map(row => [keyOf(row), row]));
    // Accepted records remain immediately observable while their batch commits.
    for (const item of queue) fresh.set(keyOf(item.record), item.record);
    records = fresh;
  }
  function loadProjection() {
    if (backend !== 'sqlite') return;
    try {
      if (fs.statSync(options.projection).size > 32 * 1048576) return;
      const document = JSON.parse(fs.readFileSync(options.projection, 'utf8'));
      if (document.version === 1 && Array.isArray(document.records)) hydrate(document.records.filter(row => KINDS.has(row.kind) && row.owner?.scopeKey));
    } catch {}
  }
  loadProjection();
  function status() {
    const selected = owner(), counts = {};
    for (const row of records.values()) if (row.owner.scopeKey === selected.scopeKey) counts[row.kind] = (counts[row.kind] || 0) + 1;
    return { ...info, state: lifecycle.state, closeState: shutdown.state, writeState: writer.state, counts, countsAreProjection: true, scopeKey: selected.scopeKey, queued: queue.length, queuedBytes, pendingRequests: pending.size, queueLimit: maxQueue, queueBytesLimit: maxQueueBytes, maxRecordBytes: options.maxRecordBytes, retention: { ...options.retention }, projection: 'bounded read cache; SQLite is authoritative', durable: backend === 'sqlite' && durable && !queue.length && !info.lastError };
  }
  function request(op, data, supplied) {
    if (!worker) return Promise.reject(new Error('state worker is not running'));
    if (pending.size >= 128) return Promise.reject(Object.assign(new Error('metadata query queue is full'), { code: 'STATE_QUEUE_FULL' }));
    return new Promise((resolve, reject) => {
      const id = ++seq; pending.set(id, { resolve, reject }); worker.ref();
      worker.postMessage({ id, op, data, owner: owner(supplied) });
    });
  }
  function start() {
    if (shutdown.is('closed', 'closing')) return Promise.reject(new Error('state store is closed'));
    if (starting) return starting;
    if (backend !== 'sqlite') { lifecycle.to('ready'); info.ready = true; return Promise.resolve(status()); }
    lifecycle.to('starting');
    starting = (async () => {
      const source = path.join(__dirname, 'state-worker.js');
      options.callBytes = callByteLimit();
      worker = new Worker(source, { workerData: options, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      const target = worker;
      target.on('message', message => {
        const call = pending.get(message.id); if (!call) return;
        pending.delete(message.id);
        if (message.ok) call.resolve(message.value);
        else call.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        if (!pending.size) target.unref();
      });
      const fail = error => {
        if (worker !== target || lifecycle.terminal) return;
        lifecycle.to('failed');
        warn(error); durable = false; info.ready = false; starting = null;
        for (const call of pending.values()) call.reject(error);
        pending.clear();
      };
      target.on('error', fail);
      target.on('exit', code => { if (worker === target) { if (!shutdown.is('closed', 'closing')) fail(Object.assign(new Error(`metadata worker stopped (${code})`), { code: 'STATE_WORKER_EXIT' })); worker = null; } });
      const result = await request('init'); lifecycle.to('ready'); hydrate(result.records); Object.assign(info, result.status, { ready: true }); durable = true;
      return status();
    })().catch(async error => { if (!lifecycle.terminal) lifecycle.to('failed'); warn(error); info.lastInitializationError = info.lastError; const failed = worker; worker = null; await failed?.terminate(); starting = null; throw error; });
    return starting;
  }
  function trimProjection(kind) {
    const matching = [...records.values()].filter(row => row.kind === kind).sort(newestFirst);
    for (const row of matching.slice(options.projectionLimit)) records.delete(keyOf(row));
  }
  function enqueue(kind, value, supplied) {
    if (!shutdown.is('open')) { warn(new Error('metadata write rejected: store is closed')); return false; }
    if (!KINDS.has(kind)) throw new Error('invalid metadata kind');
    const own = owner(supplied), copy = operationalValue(kind, value);
    const id = String(copy.id || crypto.randomUUID()); copy.id = id;
    const bytes = Buffer.byteLength(JSON.stringify(copy));
    if (bytes > options.maxRecordBytes || queue.length >= maxQueue || queuedBytes + bytes > maxQueueBytes) {
      info.rejected++; warn(Object.assign(new Error(bytes > options.maxRecordBytes ? 'metadata record exceeds byte budget' : 'metadata write queue is full'), { code: bytes > options.maxRecordBytes ? 'STATE_RECORD_TOO_LARGE' : 'STATE_QUEUE_FULL' })); info.lastRejected = info.lastError; return false;
    }
    const old = records.get(`${kind}\0${own.scopeKey}\0${id}`);
    const record = { kind, id, cursor: `pending:${++acceptedSequence}`, revision: (old?.revision || 0) + 1, updatedAt: new Date().toISOString(), owner: own, value: { ...copy, ...(old?.value.metadata ? { metadata: old.value.metadata } : {}) }, editable: ['label', 'notes', 'tags'] };
    records.set(keyOf(record), record); trimProjection(kind);
    if (backend === 'legacy') return true;
    queue.push({ record, bytes }); queuedBytes += bytes; durable = false;
    if (!scheduled) { scheduled = true; setImmediate(() => { scheduled = false; pump().catch(warn); }); }
    return true;
  }
  async function pump() {
    if (pumping) return pumping;
    writer.to('writing');
    pumping = (async () => {
      await start();
      while (queue.length) {
        const batch = queue.slice(0, options.batchSize);
        try {
          const result = await request('batch', { records: batch.map(item => ({ kind: item.record.kind, id: item.record.id, owner: item.record.owner, value: item.record.value })), callBytes: callByteLimit() });
          queue.splice(0, batch.length); queuedBytes -= batch.reduce((n, item) => n + item.bytes, 0);
          hydrate(result.records); Object.assign(info, result.status); durable = !queue.length;
        } catch (error) {
          info.failedWrites += batch.length; warn(error); info.lastWriteError = info.lastError;
          // Retain the accepted batch in memory. flush() can explicitly retry it
          // after disk/busy recovery; no external operation is ever replayed.
          throw error;
        }
      }
    })().catch(error => { writer.to('failed'); throw error; }).finally(() => { if (writer.is('writing')) writer.to('idle'); pumping = null; });
    return pumping;
  }
  function snapshot(kind, supplied) {
    return [...records.values()].filter(row => row.kind === kind && visible(row, supplied)).sort(newestFirst).map(row => ({ ...clone(row.value), owner: clone(row.owner), metadataRevision: row.revision }));
  }
  async function flush() {
    if (backend !== 'sqlite') return status();
    await pump(); const result = await request('flush'); hydrate(result.records); Object.assign(info, result.status); durable = !queue.length; return status();
  }
  async function list(query = {}, supplied) {
    const kind = query.kind || 'calls'; if (!KINDS.has(kind)) throw new Error('metadata kind must be calls, jobs, or executions');
    if (backend !== 'sqlite') {
      const rows = [...records.values()].filter(row => row.kind === kind && visible(row, supplied));
      return { records: clone(rows.slice(0, Math.min(500, query.limit || 100))), total: rows.length, nextCursor: null, backend: 'legacy' };
    }
    await flush(); return request('list', { ...query, kind }, supplied);
  }
  async function get(kind, id, supplied) {
    if (!KINDS.has(kind)) throw new Error('invalid metadata kind');
    if (backend !== 'sqlite') return clone(records.get(`${kind}\0${owner(supplied).scopeKey}\0${id}`) || null);
    await flush(); return request('get', { kind, id }, supplied);
  }
  async function edit(kind, id, update, supplied) {
    const expectedRevision = update.expectedRevision ?? update.expected_revision, patch = update.patch;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('expected_revision is required');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['label', 'notes', 'tags'].includes(key))) throw new Error('only label, notes and tags can be edited');
    if (patch.label !== undefined && (typeof patch.label !== 'string' || patch.label.length > 200)) throw new Error('label must be at most 200 characters');
    if (patch.notes !== undefined && (typeof patch.notes !== 'string' || Buffer.byteLength(patch.notes) > 8192)) throw new Error('notes must be at most 8192 bytes');
    if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.length > 32 || patch.tags.some(tag => typeof tag !== 'string' || tag.length > 80))) throw new Error('tags must be at most 32 strings of 80 characters');
    if (backend !== 'sqlite') throw Object.assign(new Error('editable metadata requires the SQLite backend'), { code: 'STATE_BACKEND_REQUIRED' });
    await flush(); const record = await request('edit', { kind, id, expectedRevision, patch }, supplied); records.set(keyOf(record), record); return record;
  }
  async function exportRecords(query = {}, supplied) {
    // Export uses the same byte/item bounded pages. Continue with nextCursor;
    // never materialize an entire multi-story database or giant history string.
    const page = await list({ ...query, before: query.before || query.cursor, limit: Math.min(500, query.limit || 500) }, supplied);
    return { version: 1, exportedAt: new Date().toISOString(), backend, ...page };
  }
  async function clear(kind, supplied) {
    if (!KINDS.has(kind)) throw new Error('invalid metadata kind');
    if (backend === 'sqlite') { await flush(); await request('clear', { kind }, supplied); }
    for (const [key, row] of records) if (row.kind === kind && visible(row, supplied)) records.delete(key);
    return { ok: true };
  }
  function close() {
    if (closingPromise) return closingPromise;
    if (shutdown.is('closed')) return Promise.resolve();
    shutdown.to('flushing');
    return closingPromise = (async () => {
      try {
        if (backend === 'sqlite' && (worker || queue.length)) { await flush(); shutdown.to('closing'); await request('close'); await worker?.terminate(); }
        lifecycle.to('closed'); info.ready = false; shutdown.to('closed');
      } catch (error) { shutdown.to('open'); closingPromise = null; throw error; }
    })();
  }
  return { enabled: () => backend === 'sqlite', storageEnabled: () => backend === 'sqlite', ready: start, status, snapshot, flush, list, get, edit, export: exportRecords, clear, close,
    recordCall: (value, supplied) => enqueue('calls', value, supplied), putJob: (value, supplied) => enqueue('jobs', value, supplied), persistJob: (value, supplied) => enqueue('jobs', value, supplied), putExecution: (value, supplied) => enqueue('executions', value, supplied) };
}
let defaultStore;
const instance = () => defaultStore ||= createStore();
module.exports = { createStore, LEGACY_OWNER, sqliteAvailable, ...Object.fromEntries(['enabled', 'storageEnabled', 'ready', 'status', 'snapshot', 'flush', 'list', 'get', 'edit', 'export', 'clear', 'close', 'recordCall', 'putJob', 'persistJob', 'putExecution'].map(method => [method, (...args) => instance()[method](...args)])) };
