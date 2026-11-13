const fs = require('node:fs'), path = require('node:path'), { Worker } = require('node:worker_threads');
// One bounded batch in flight. A stalled/full diagnostic sink drops diagnostics,
// never backpressures tools, history, execution cleanup or database queries.
class TraceStore {
  constructor(file, { maxQueued = 2048, maxBytes = 8 * 1048576, maxRows = 25000, workerFile = 'telemetry-worker.js' } = {}) {
    Object.assign(this, { file, maxQueued, maxBytes, maxRows, workerFile });
    this.phase = 'cold'; this.queue = []; this.bytes = 0; this.dropped = 0; this.seq = 0; this.pending = new Map();
    require('./state-machine').bind(this, require('./lifecycles').diagnosticStore, 'phase');
  }
  put(row) {
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (this.phase === 'closed' || this.phase === 'failed' || this.queue.length >= this.maxQueued || this.bytes + bytes > this.maxBytes) { this.dropped++; return; }
    this.queue.push({ row, bytes }); this.bytes += bytes;
    this.pump();
  }
  start() {
    if (this.starting) return this.starting;
    if (this.phase === 'closed' || this.phase === 'failed') return Promise.reject(Error('Diagnostic storage unavailable'));
    this.phase = 'starting'; fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const worker = this.worker = new Worker(path.join(__dirname, this.workerFile), { workerData: { file: this.file, maxRows: this.maxRows }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    this.starting = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(Error('Diagnostic storage startup timed out')), 5000);
      const fail = () => { clearTimeout(timer); if (this.phase === 'closed') return; this.phase = 'failed'; this.dropped += this.queue.length; this.queue = []; this.bytes = 0; reject(Error('Diagnostic storage unavailable')); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Diagnostic storage unavailable')); } this.pending.clear(); worker.terminate().catch(() => {}); };
      worker.on('error', fail); worker.on('exit', () => { if (this.phase !== 'closed') fail(); });
      worker.on('message', message => {
        // A queued ready message can arrive after startup timed out or close.
        // Diagnostic failures are terminal; late worker events must not revive them.
        if (message.ready) { if (this.phase !== 'starting') return; clearTimeout(timer); this.phase = 'ready'; worker.unref(); resolve(); return; }
        const p = this.pending.get(message.id); if (!p) return;
        this.pending.delete(message.id); clearTimeout(p.timer); if (!this.pending.size) worker.unref();
        message.error ? p.reject(Error(message.error)) : p.resolve(message.result);
      });
    });
    return this.starting;
  }
  async request(op, data = {}) {
    await this.start(); if (this.pending.size >= 64) throw Error('Diagnostic storage busy');
    return new Promise((resolve, reject) => {
      const id = ++this.seq, timer = setTimeout(() => { this.pending.delete(id); if (!this.pending.size) this.worker.unref(); reject(Error('Diagnostic storage timed out')); }, 5000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.ref(); this.worker.postMessage({ id, op, ...data });
    });
  }
  pump() {
    if (this.pumping || !this.queue.length || ['closed', 'failed'].includes(this.phase)) return;
    this.pumping = (async () => {
      await this.start();
      while (this.queue.length) {
        const batch = this.queue.splice(0, 128); this.bytes -= batch.reduce((n, x) => n + x.bytes, 0);
        try { await this.request('write', { rows: batch.map(x => x.row) }); }
        catch { this.dropped += batch.length; throw Error('Diagnostic write failed'); }
      }
    })().catch(() => { this.phase = 'failed'; this.dropped += this.queue.length; this.queue = []; this.bytes = 0; }).finally(() => { this.pumping = null; if (this.queue.length) this.pump(); });
  }
  async flush() { await this.pumping; }
  async read(scope, { traceId, limit = 1000 } = {}) {
    await this.flush();
    if (this.phase === 'cold' && !fs.existsSync(this.file)) return [];
    try { return await this.request('read', { scope, traceId, limit: Math.max(1, Math.min(2000, Number(limit) || 1000)) }); } catch { return []; }
  }
  status() { return { state: this.phase, queued: this.queue.length, queuedBytes: this.bytes, dropped: this.dropped, maxQueued: this.maxQueued, maxRows: this.maxRows, persistence: this.phase === 'ready' ? 'sqlite' : this.phase === 'failed' ? 'unavailable' : 'idle' }; }
  async close() { await this.flush(); if (this.phase === 'ready') try { await this.request('close'); } catch {} this.phase = 'closed'; await this.worker?.terminate(); }
}
module.exports = { TraceStore };
