// An invocation owns its cancellation signal, child invocations and stoppable handles.
// Ownership is captured once; never derive it from a caller-supplied execution id.
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const { bind } = require('./state-machine'), lifecycle = require('./lifecycles').execution;
const als = new AsyncLocalStorage(), records = new Map();
const TERMINAL = new Set(lifecycle.terminal);
const access = () => require('./access');
const abortError = why => Object.assign(new Error(String(why?.message || why || 'cancelled')), { name: 'AbortError', code: 'DT_CANCELLED' });
const current = () => als.getStore() || null;
const signal = () => current()?.controller.signal;
function check() { const s = signal(); if (s?.aborted) throw abortError(s.reason); }
function view(r) {
  return { id: r.id, parentId: r.parentId, kind: r.kind, tool: r.tool, title: r.title, source: r.source, owner: r.owner,
    ...(r.telemetry ? { traceId: r.telemetry.traceId, spanId: r.telemetry.spanId } : {}), revision: r.revision, registryRevision: r.registryRevision, processId: r.processId, canCancel: !TERMINAL.has(r.state), outcome: r.cleanupIncomplete ? 'unknown' : r.state === 'cancelled' ? 'cancelled' : r.state === 'failed' ? 'failed' : r.state === 'done' ? 'completed' : 'pending', state: r.state, startedAt: r.startedAt, endedAt: r.endedAt, ms: r.endedAt ? r.ms : Date.now() - r.started,
    ...(r.error ? { error: require('./redact').clean(r.error, { known: r.redactions || [] }) } : {}), resources: r.resources.size, children: r.children.size,
    ...(r.cleanupIncomplete ? { cleanupIncomplete: r.cleanupIncomplete } : {}) };
}
function persist(r) { try { const W = require('worker_threads'); if (!W.isMainThread && W.workerData?.dtIsolate) W.parentPort.postMessage({ dtExecution: view(r), owner: r.owner }); else require('./state-store').putExecution(view(r), r.owner); } catch {} }
function trim() {
  if (records.size < 500) return;
  for (const [id, r] of records) { if (TERMINAL.has(r.state)) records.delete(id); if (records.size < 400) break; }
}
function abort(r, why) {
  if (TERMINAL.has(r.state) || r.controller.signal.aborted) return 0;
  r.state = 'cancelling'; r.error = String(why || 'cancelled');
  r.controller.abort(abortError(why));
  let stopped = 0;
  for (const child of r.children) stopped += abort(child, why);
  for (const resource of r.resources) { if (!resource.stopped) { resource.stopped = true; stopped++; try { const p = resource.stop(why); if (p?.then) r.cleanups.add(Promise.resolve(p).catch(() => {})); } catch {} } }
  persist(r); return stopped;
}
function resource(stop) {
  const r = current(); if (!r || typeof stop !== 'function') return () => {};
  const item = { stop, stopped: false }; r.resources.add(item);
  if (r.controller.signal.aborted) { item.stopped = true; try { const p = stop(r.controller.signal.reason); if (p?.then) r.cleanups.add(Promise.resolve(p).catch(() => {})); } catch {} }
  return () => r.resources.delete(item);
}
function track(promise, stop) {
  const r = current(), p = Promise.resolve(promise); if (!r) return p;
  const release = stop ? resource(stop) : () => {};
  r.pending.add(p); p.then(() => { release(); r.pending.delete(p); }, () => { release(); r.pending.delete(p); });
  return p;
}
function start(metadata = {}, fn) {
  const inherited = current(), parent = metadata.detached ? null : inherited;
  const started = Date.now();
  const r = { id: metadata.id || crypto.randomUUID(), parentId: metadata.parentId ?? inherited?.id ?? null,
    kind: metadata.kind || 'tool', tool: metadata.tool || null, title: metadata.title || null, source: metadata.source || null,
    owner: access().owner(), codeActive: metadata.codeActive === true || (!metadata.detached && inherited?.codeActive === true), redactions: [...(metadata.redactions || inherited?.redactions || [])], revision: metadata.revision ?? inherited?.revision, registryRevision: metadata.registryRevision ?? metadata.revision ?? inherited?.registryRevision, registry: metadata.registry || inherited?.registry, configSnapshot: metadata.configSnapshot || inherited?.configSnapshot, processId: process.pid, state: 'queued', started, startedAt: new Date(started).toISOString(),
    controller: new AbortController(), resources: new Set(), children: new Set(), pending: new Set(), cleanups: new Set() };
  const telemetry = require('./telemetry').begin('execution.' + r.kind, { 'dt.kind': r.kind, 'dt.execution.id': r.id, 'dt.parent_execution.id': r.parentId, 'dt.tool.name': r.tool, 'dt.registry.revision': r.registryRevision });
  if (telemetry) r.telemetry = { traceId: telemetry.traceId, spanId: telemetry.spanId };
  bind(r, lifecycle); records.set(r.id, r); trim(); if (parent) parent.children.add(r);
  const externalSignal = metadata.signal;
  const onAbort = () => abort(r, externalSignal.reason || 'request cancelled');
  if (externalSignal) { if (externalSignal.aborted) onAbort(); else externalSignal.addEventListener('abort', onAbort, { once: true }); }
  persist(r);
  const execute = () => als.run(r, async () => {
    let value, error;
    try { check(); r.state = 'running'; persist(r); value = await fn(r); check(); } catch (e) { error = e; }
    // A returned value is not permission for forgotten host work to outlive its owner.
    // Completed child runs removed themselves already; cancel only the unfinished ones.
    let cancelling = r.controller.signal.aborted;
    if (r.children.size || r.resources.size || r.pending.size || r.cleanups.size) {
      r.state = 'draining'; persist(r);
      for (const child of r.children) abort(child, error?.message || 'owner completed');
      for (const item of r.resources) if (!item.stopped) { item.stopped = true; try { const p = item.stop(error?.message || 'owner completed'); if (p?.then) r.cleanups.add(Promise.resolve(p).catch(() => {})); } catch {} }
      const wait = [...r.children].map(c => c.promise).concat([...r.pending], [...r.cleanups]);
      let timer; const complete = await Promise.race([Promise.allSettled(wait).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), Number(metadata.drainMs ?? 5000)); })]); clearTimeout(timer);
      if (!complete) { r.cleanupIncomplete = Math.max(r.children.size + r.pending.size + r.resources.size, r.cleanups.size); error ||= Object.assign(new Error('Execution cleanup did not finish; outstanding operations may have an unknown outcome'), { code: 'DT_EXECUTION_DRAIN_TIMEOUT' }); }
    }
    cancelling = r.controller.signal.aborted;
    r.state = cancelling ? 'cancelled' : error ? 'failed' : 'done';
    r.error = error?.message || (cancelling ? r.error : undefined);
    r.endedAt = new Date().toISOString(); r.ms = Date.now() - started;
    if (!r.cleanupIncomplete) { r.resources.clear(); r.cleanups.clear(); }
    telemetry?.end(error || (cancelling ? abortError(r.controller.signal.reason) : null), { 'dt.state': r.state, 'dt.cancelled': cancelling, 'dt.cleanup.incomplete': r.cleanupIncomplete || 0 });
    persist(r); if (cancelling) throw abortError(r.controller.signal.reason); if (error) throw error; return value;
  });
  r.promise = Promise.resolve().then(() => telemetry ? telemetry.run(execute) : execute()).finally(() => {
    parent?.children.delete(r); externalSignal?.removeEventListener('abort', onAbort);
    if (!r.cleanupIncomplete) { r.resources.clear(); r.cleanups.clear(); }
    // Keep metadata, not resolved promises (which retain whole tool results) or config secrets.
    records.set(r.id, { ...r, error: view(r).error, promise: undefined, registry: undefined, configSnapshot: undefined, redactions: [] });
  });
  // A background caller may poll instead of awaiting. Its rejection remains available on promise.
  r.promise.catch(() => {});
  return r;
}
const run = (metadata, fn) => start(metadata, fn).promise;
function stored() { try { return require('./state-store').snapshot('executions'); } catch { return []; } }
function persistedView(record) { return { ...record, canCancel: !TERMINAL.has(record.state) && require('./isolate').hasExecution(record.id) }; }
function get(id) { const r = records.get(id); if (r) return access().visible(r.owner) ? view(r) : null; const record = stored().find(r => r.id === id && access().visible(r.owner)); return record ? persistedView(record) : null; }
function list({ limit = 100, state } = {}) {
  const merged = new Map(stored().filter(r => access().visible(r.owner)).map(r => [r.id, persistedView(r)]));
  for (const r of records.values()) if (access().visible(r.owner)) merged.set(r.id, view(r));
  return [...merged.values()].filter(r => !state || r.state === state).sort((a,b)=>String(b.startedAt || '').localeCompare(String(a.startedAt || ''))).slice(0, Math.min(500, Math.max(1, limit)));
}
function cancel(id, why = 'cancelled') { const r = records.get(id); if (!r) { const remote = require('./isolate').cancelExecution(id, why); if (remote) return remote; } if (!r || !access().visible(r.owner)) throw Object.assign(new Error(`no execution ${id}`), { code: 'DT_NOT_FOUND' }); return { ...view(r), stopped: abort(r, why), ...view(r) }; }
function carrier() {
  const r = current(), C = require('./config');
  return { ...(r ? { id: r.id, owner: r.owner, ...(r.telemetry ? { traceId: r.telemetry.traceId, spanId: r.telemetry.spanId } : {}), revision: r.revision, registryRevision: r.registryRevision } : { owner: access().owner() }), telemetry: require('./telemetry').carrier(), configData: C.serializeSnapshot(C.snapshot()) };
}
function runCarrier(c, fn) {
  const C = require('./config'), snapshot = c?.configData ? C.restoreSnapshot(c.configData) : C.snapshot();
  return access().run(c?.owner || access().owner(), () => C.pin(snapshot, () => require('./telemetry').remote(c?.telemetry?{...c.telemetry,scope:access().current().scopeKey}:null, null, () => run({ parentId: c?.id, kind: 'worker', revision: c?.revision, registryRevision: c?.registryRevision, configSnapshot: snapshot }, fn))));
}
module.exports = { start, run, current, signal, check, resource, track, list, get, cancel, carrier, runCarrier, abortError, TERMINAL };
