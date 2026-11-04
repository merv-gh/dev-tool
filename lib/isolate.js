// Heavy read-only tools run in a worker thread with its own heap limit. If one runs out of memory, that call
// fails with a clear error and dt keeps serving; the worker is replaced. The worker is kept warm between
// calls (its caches serve the next one) and recycled once it holds more than half its limit.
//   tools.workerHeapMb (config.json) or DT_WORKER_HEAP_MB: the worker's heap, default 1024; 0 runs them in-process.
const { Worker, isMainThread } = require('worker_threads');

const HEAVY = new Set(['impact', 'code_symbols', 'pg_usage', 'pg_function', 'pg_table', 'field_trace', 'who_uses', 'feature', 'docs_search', 'docs_page', 'docs_verify', 'knowledge_graph', 'knowledge_search']);
const heapMb = () => { const v = Number(process.env.DT_WORKER_HEAP_MB ?? require('./config').getTools().workerHeapMb ?? 1024); return Number.isFinite(v) ? v : 1024; };
const workerLimitMb = () => { const c = require('./config').getTools(); return Math.max(1, Math.min(heapMb(), Math.floor((c.workerMemoryMb || heapMb()) / (c.workerConcurrency || 1)))); };
const enabled = (name) => isMainThread && HEAVY.has(name) && heapMb() > 0;

// The worker runs this module's serve(). From the sources that is this file; in the bundle (dist/dt.js) the
// modules are inside it, so the worker starts the bundle, whose entry (cli.js) calls serve() in a worker.
function serve() {
  const { parentPort } = require('worker_threads'), T = require('./tools');
  parentPort.on('message', async ({ id, name, args, mod, fn, execution, trace }) => {
    let steps, notes;
    try {
      const value = await require('./execution').runCarrier(execution, () => require('./trace').runCarrier(trace, async () => { try { return await (mod ? MODULES[mod]()[fn](...args) : T.callTool(name, args, { isolated: true, admitted: true })); } finally { steps = require('./trace').current()?.steps; notes = require('./trace').current()?.notes; } }));
      parentPort.postMessage({ id, ok: true, value, steps, notes, heap: process.memoryUsage().heapUsed });
    } catch (e) { parentPort.postMessage({ id, ok: false, steps, notes, error: { message: e.message, code: e.code, issues: e.issues }, heap: process.memoryUsage().heapUsed }); }
  });
}
// modules exec() may call, required statically so the bundler includes them
const MODULES = { indexer: () => require('./indexer'), codeSearch: () => require('./code-search'), passport: () => require('./passport') };
const bundled = !/[\\/]lib[\\/]isolate\.js$/.test(__filename), ENTRY = __filename; // lib/isolate.js, or dist/dt.js
if (!isMainThread && require('worker_threads').workerData?.dtIsolate && !bundled) serve();

const workers = new Set(); let seq = 0;
function spawn() {
  const w = new Worker(ENTRY, { workerData: { dtIsolate: true }, resourceLimits: { maxOldGenerationSizeMb: workerLimitMb() }, env: process.env, stdout: false, stderr: false });
  w.pending = new Map(); w.remoteExecutions = new Map(); w.limitMb = workerLimitMb();
  w.on('message', m => { if (m.dtExecution) { if (require('./execution').TERMINAL.has(m.dtExecution.state)) w.remoteExecutions.delete(m.dtExecution.id); else w.remoteExecutions.set(m.dtExecution.id, m.dtExecution); require('./state-store').putExecution(m.dtExecution, m.owner); return; } const p = w.pending.get(m.id); if (!p) return; w.pending.delete(m.id); if (p.trace) { for (const step of m.steps || []) if (p.trace.steps.length < 200) p.trace.steps.push(step); for (const note of m.notes || []) if (p.trace.notes.length < 200) p.trace.notes.push(note); } if (!w.pending.size) w.unref(); w.heap = m.heap; m.ok ? p.resolve(m.value) : p.reject(Object.assign(new Error(m.error.message), { code: m.error.code, issues: m.error.issues })); });
  const fail = (e) => {
    for (const record of w.remoteExecutions.values()) if (!require('./execution').TERMINAL.has(record.state)) { record.state = w.cancelled ? 'cancelled' : 'interrupted'; record.outcome = w.cancelled ? 'cancelled' : 'unknown'; record.error = w.cancelled || 'worker stopped'; record.endedAt = new Date().toISOString(); require('./state-store').putExecution(record, record.owner); }
    const oom = e?.code === 'ERR_WORKER_OUT_OF_MEMORY' || /out of memory/i.test(e?.message || '');
    for (const p of w.pending.values()) p.reject(Object.assign(new Error(oom
      ? `ran out of memory in its worker (${workerLimitMb()} MB): narrow it (one repo, one db, a smaller depth), or raise tools.workerHeapMb. dt itself is still running.`
      : `worker stopped: ${e?.message || e}`), { code: oom ? 'DT_OUT_OF_MEMORY' : 'DT_WORKER_FAILED' }));
    w.pending.clear(); workers.delete(w);
  };
  w.on('error', fail); w.on('exit', code => { if (w.pending.size) fail(new Error(`exit ${code}`)); workers.delete(w); });
  w.unref();
  workers.add(w); return w;
}

// A bounded pool admits one call per worker, with round-robin fairness between stories.
// exec runs an exported function of a lib module there instead of a tool (index rebuilds of sync jobs).
function exec(mod, fn, args = []) { return heapMb() > 0 && isMainThread ? run(null, null, { mod, fn, args }) : MODULES[mod]()[fn](...args); }
function run(name, args, extra = {}) {
  const E = require('./execution');
  return require('./limit').schedule('cpu', async () => {
    E.check();
    for (const idle of workers) if (!idle.busy && idle.limitMb !== workerLimitMb()) { workers.delete(idle); await idle.terminate(); }
    const w = [...workers].find(w => !w.busy) || spawn(), id = ++seq;
    w.busy = true;
    const release = E.resource(why => { w.cancelled = String(why || 'cancelled'); return w.terminate(); });
    let steps, notes;
    try {
      const value = await new Promise((resolve, reject) => { w.pending.set(id, { resolve, reject, trace: require('./trace').current() }); w.ref(); w.postMessage({ id, name, args, ...extra, execution: E.carrier(), trace: require('./trace').carrier() }); });
      E.check();
      if (w.heap > workerLimitMb() * 1e6 / 2) { workers.delete(w); await w.terminate(); }
      return value;
    } finally { release(); w.busy = false; }
  });
}
function stop() { const active = [...workers]; workers.clear(); return Promise.all(active.map(w => w.terminate())); }

function hasExecution(id) { for (const w of workers) { const record = w.remoteExecutions.get(id); if (record && require('./access').visible(record.owner)) return true; } return false; }
function cancelExecution(id, why = 'cancelled') {
  for (const w of workers) { const record = w.remoteExecutions.get(id); if (!record || !require('./access').visible(record.owner)) continue; const parent = require('./execution').get(record.parentId); if (parent) { const cancelled = require('./execution').cancel(parent.id, why); return { ...record, state: 'cancelling', stopped: cancelled.stopped, cancelledOwner: parent.id }; } w.cancelled = String(why); w.terminate(); return { ...record, state: 'cancelling', stopped: 1 }; }
  return null;
}
const status = () => ({ workers: workers.size, busy: [...workers].filter(w => w.busy).length, heapLimitMb: workerLimitMb(), memoryBudgetMb: require('./config').getTools().workerMemoryMb || heapMb() });
module.exports = { hasExecution, cancelExecution, status, enabled, run, exec, stop, serve, HEAVY };
