// Heavy read-only tools run in a worker thread with its own heap limit. If one runs out of memory, that call
// fails with a clear error and dt keeps serving; the worker is replaced. The worker is kept warm between
// calls (its caches serve the next one) and recycled once it holds more than half its limit.
//   tools.workerHeapMb (config.json) or DT_WORKER_HEAP_MB: the worker's heap, default 1024; 0 runs them in-process.
const { Worker, isMainThread } = require('worker_threads');

const HEAVY = new Set(['impact', 'code_symbols', 'code_search', 'pg_usage', 'pg_function', 'pg_table', 'field_trace', 'who_uses', 'feature', 'docs_search', 'docs_page', 'docs_verify', 'knowledge_graph', 'knowledge_search']);
const heapMb = () => { const v = Number(process.env.DT_WORKER_HEAP_MB ?? require('./config').getTools().workerHeapMb ?? 1024); return Number.isFinite(v) ? v : 1024; };
const enabled = (name) => isMainThread && HEAVY.has(name) && heapMb() > 0;

// The worker runs this module's serve(). From the sources that is this file; in the bundle (dist/dt.js) the
// modules are inside it, so the worker starts the bundle, whose entry (cli.js) calls serve() in a worker.
function serve() {
  const { parentPort } = require('worker_threads'), T = require('./tools');
  parentPort.on('message', async ({ id, name, args, mod, fn }) => {
    try { const value = mod ? await MODULES[mod]()[fn](...args) : await T.callTool(name, args, { isolated: true }); parentPort.postMessage({ id, ok: true, value, heap: process.memoryUsage().heapUsed }); }
    catch (e) { parentPort.postMessage({ id, ok: false, error: { message: e.message, code: e.code, issues: e.issues }, heap: process.memoryUsage().heapUsed }); }
  });
}
// modules exec() may call, required statically so the bundler includes them
const MODULES = { indexer: () => require('./indexer') };
const bundled = !/[\\/]lib[\\/]isolate\.js$/.test(__filename), ENTRY = __filename; // lib/isolate.js, or dist/dt.js
if (!isMainThread && require('worker_threads').workerData?.dtIsolate && !bundled) serve();

let worker = null, queue = Promise.resolve(), seq = 0;
function spawn() {
  const w = new Worker(ENTRY, { workerData: { dtIsolate: true }, resourceLimits: { maxOldGenerationSizeMb: heapMb() }, env: process.env, stdout: false, stderr: false });
  w.pending = new Map();
  w.on('message', m => { const p = w.pending.get(m.id); if (!p) return; w.pending.delete(m.id); if (!w.pending.size) w.unref(); w.heap = m.heap; m.ok ? p.resolve(m.value) : p.reject(Object.assign(new Error(m.error.message), { code: m.error.code, issues: m.error.issues })); });
  const fail = (e) => {
    const oom = e?.code === 'ERR_WORKER_OUT_OF_MEMORY' || /out of memory/i.test(e?.message || '');
    for (const p of w.pending.values()) p.reject(Object.assign(new Error(oom
      ? `ran out of memory in its worker (${heapMb()} MB): narrow it (one repo, one db, a smaller depth), or raise tools.workerHeapMb. dt itself is still running.`
      : `worker stopped: ${e?.message || e}`), { code: oom ? 'DT_OUT_OF_MEMORY' : 'DT_WORKER_FAILED' }));
    w.pending.clear(); if (worker === w) worker = null;
  };
  w.on('error', fail); w.on('exit', code => { if (w.pending.size) fail(new Error(`exit ${code}`)); if (worker === w) worker = null; });
  w.unref();
  return w;
}

// One call at a time in the worker (heavy calls compete for the same heap); others wait their turn.
// exec runs an exported function of a lib module there instead of a tool (index rebuilds of sync jobs).
function exec(mod, fn, args = []) { return heapMb() > 0 && isMainThread ? run(null, null, { mod, fn, args }) : MODULES[mod]()[fn](...args); }
function run(name, args, extra = {}) {
  const job = queue.then(async () => {
    if (!worker) worker = spawn();
    const w = worker, id = ++seq;
    // referenced only while a call runs: an idle worker does not keep dt (or a CLI call) alive
    const value = await new Promise((resolve, reject) => { w.pending.set(id, { resolve, reject }); w.ref(); w.postMessage({ id, name, args, ...extra }); });
    if (w.heap > heapMb() * 1e6 / 2) { worker = null; w.terminate(); } // recycle a worker that holds a lot
    return value;
  });
  queue = job.catch(() => {});
  return job;
}
function stop() { const w = worker; worker = null; if (w) return w.terminate(); }

module.exports = { enabled, run, exec, stop, serve, HEAVY };
