// Optional pure-transform prototype. Node remains the engine for host-tool/file/network orchestration.
const path = require('path');
const { Worker } = require('worker_threads');
const capabilities = Object.freeze({ engine: 'quickjs', status: 'prototype', pureTransforms: true, tools: false, files: false, network: false, isolation: 'fresh WASM runtime in a terminable worker', memoryMb: 64 });
function run(code, data, { timeoutMs = 6000, onOutput } = {}) {
  const E = require('./execution'); E.check();
  const source = path.basename(__dirname) === 'lib' ? path.join(__dirname, 'quickjs-worker.js') : path.join(__dirname, 'quickjs-worker.js');
  return require('./limit').schedule('cpu', () => new Promise((resolve, reject) => {
    const worker = new Worker(source, { workerData: { code: String(code), data, timeoutMs }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    let settled = false;
    const release = E.resource(() => worker.terminate());
    const timer = setTimeout(() => finish(new Error(`js: stopped after ${timeoutMs}ms`)), timeoutMs + 100);
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); release(); worker.terminate().then(() => error ? reject(error) : resolve(result), reject); }
    worker.on('message', msg => { if (msg.event === 'output') onOutput?.(msg.value); else msg.ok ? finish(null, msg.result) : finish(new Error(`quickjs: ${msg.error}`)); });
    worker.on('error', e => finish(e));
    worker.on('exit', code => { if (!settled) finish(E.signal()?.aborted ? E.abortError(E.signal().reason) : new Error(`quickjs worker stopped (${code})`)); });
  }));
}
module.exports = { run, capabilities };
