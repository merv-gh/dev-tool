// Isolated CPU/memory worker, shipped in dt's own bundle. Only named, vendored Joern scripts run here.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const P = require('./semantic-protocol');
const A = require('./access');
const { writeJson, readJson } = require('./util');
const { bind, create } = require('./state-machine'), lifecycles = require('./lifecycles');

const scriptDirectory = () => path.join(require('./config').ROOT, 'vendor', 'file-projections', 'joern');
function configuration(options = {}) {
  const e = process.env;
  return {
    data: path.resolve(options.data || e.DT_SEMANTIC_DATA || '/data/semantic'),
    token: options.token || e.DT_SEMANTIC_TOKEN,
    version: options.version || e.DT_SEMANTIC_JOERN_VERSION || '4.0.564',
    image: options.image || e.DT_SEMANTIC_IMAGE || 'ghcr.io/joernio/joern@sha256:54c7f728f813c1cefd4303e7c69c5d35003f0fc9fde1459872230e5bc4e4b7b4',
    java: options.java || e.DT_SEMANTIC_JAVA || '/opt/joern/joern-cli/javasrc2cpg',
    js: options.js || e.DT_SEMANTIC_JS || '/opt/joern/joern-cli/jssrc2cpg.sh',
    joern: options.joern || e.DT_SEMANTIC_JOERN || '/opt/joern/joern-cli/joern',
    parseMemoryMb: P.integer(options.parseMemoryMb ?? e.DT_SEMANTIC_PARSE_MEMORY_MB, 12288, 128, 1048576),
    queryMemoryMb: P.integer(options.queryMemoryMb ?? e.DT_SEMANTIC_QUERY_MEMORY_MB, 6144, 128, 1048576),
    totalMemoryMb: P.integer(options.totalMemoryMb ?? e.DT_SEMANTIC_MEMORY_MB, 24576, 128, 2097152),
    parseConcurrency: P.integer(options.parseConcurrency ?? e.DT_SEMANTIC_PARSE_CONCURRENCY, 1, 1, 8),
    queryConcurrency: P.integer(options.queryConcurrency ?? e.DT_SEMANTIC_QUERY_CONCURRENCY, 2, 1, 8),
    timeoutMs: P.integer(options.timeoutMs ?? e.DT_SEMANTIC_TIMEOUT_MS, 30 * 60000, 100, 12 * 3600000),
    maxSourceBytes: P.integer(options.maxSourceBytes ?? e.DT_SEMANTIC_SOURCE_BYTES, 512 * 1048576, 1024, 4 * 1024 ** 3),
    maxProjectionBytes: P.integer(options.maxProjectionBytes ?? e.DT_SEMANTIC_PROJECTION_BYTES, 256 * 1048576, 1024, 2 * 1024 ** 3),
  };
}

// Slots are separate, but all tasks share a weighted memory budget and fair owner rotation.
class Admission {
  constructor(config) { this.config = config; this.queue = []; this.used = 0; this.running = { parse: 0, query: 0 }; this.last = null; }
  run(kind, owner, signal, fn) {
    const memory = this.config[`${kind}MemoryMb`];
    if (memory > this.config.totalMemoryMb) return Promise.reject(P.error('Job memory reservation exceeds worker budget', 'DT_SEMANTIC_RESOURCE_EXHAUSTED', 503));
    if (this.queue.length >= 100) return Promise.reject(P.error('Semantic queue is full', 'DT_QUEUE_FULL', 429));
    return new Promise((resolve, reject) => {
      const item = { kind, owner, signal, fn, memory, resolve, reject, lifecycle: create(lifecycles.admission) };
      item.abort = () => { const i = this.queue.indexOf(item); if (i >= 0) { item.lifecycle.to('cancelled'); this.queue.splice(i, 1); reject(signal.reason); } };
      if (signal.aborted) { item.lifecycle.to('cancelled'); return reject(signal.reason); }
      signal.addEventListener('abort', item.abort, { once: true }); this.queue.push(item); this.drain();
    });
  }
  drain() {
    const fits = item => this.running[item.kind] < this.config[`${item.kind}Concurrency`] && this.used + item.memory <= this.config.totalMemoryMb;
    while (true) {
      let i = this.queue.findIndex(item => item.owner !== this.last && fits(item));
      if (i < 0) i = this.queue.findIndex(fits); if (i < 0) return;
      const item = this.queue.splice(i, 1)[0]; item.signal.removeEventListener('abort', item.abort);
      if (item.signal.aborted) { item.lifecycle.to('cancelled'); item.reject(item.signal.reason); continue; }
      item.lifecycle.to('running');
      this.used += item.memory; this.running[item.kind]++; this.last = item.owner;
      Promise.resolve().then(item.fn).then(value => { item.lifecycle.to('fulfilled'); item.resolve(value); }, error => { item.lifecycle.to('rejected'); item.reject(error); }).finally(() => { this.used -= item.memory; this.running[item.kind]--; this.drain(); });
    }
  }
  status() { return { queued: this.queue.length, running: { ...this.running }, reservedMemoryMb: this.used, totalMemoryMb: this.config.totalMemoryMb }; }
}

function createWorker(options = {}) {
  const config = configuration(options);
  if (!config.token || config.token.length < 16) throw P.error('DT_SEMANTIC_TOKEN must contain at least 16 characters');
  fs.mkdirSync(config.data, { recursive: true });
  const admission = new Admission(config), active = new Map(), instance = crypto.randomUUID();
  const directory = owner => path.join(config.data, owner.scopeKey);
  const file = (owner, id) => { if (!P.ID.test(id || '')) throw P.error('Invalid semantic job id'); return path.join(directory(owner), id); };
  const persist = job => { bind(job, lifecycles.semantic); return writeJson(path.join(file(job.owner, job.id), 'job.json'), job); };
  function load(owner, id) {
    const job = readJson(path.join(file(owner, id), 'job.json'));
    if (!job || job.owner.scopeKey !== owner.scopeKey) throw P.error('Semantic job is not available', 'DT_NOT_FOUND', 404);
    bind(job, lifecycles.semantic);
    if (job.instance !== instance && ['queued','uploading','parsing','enriching','querying','draining','cancelling'].includes(job.state)) {
      job.state = 'interrupted'; job.error = 'Worker restarted before completion; retained ready analyses remain usable'; persist(job);
    }
    return job;
  }
  const log = (job, message) => { job.log.push(String(message).slice(0, 1200)); if (job.log.length > 80) job.log.shift(); persist(job); };
  async function command(job, executable, args, cwd, signal) {
    signal.throwIfAborted();
    const env = Object.fromEntries(['PATH','LANG','LC_ALL','JAVA_HOME'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    env.HOME = path.join(cwd, 'home'); env.TMPDIR = path.join(cwd, 'tmp');
    fs.mkdirSync(env.HOME, { recursive: true }); fs.mkdirSync(env.TMPDIR, { recursive: true });
    const proc = spawn(executable, args, { cwd, env: require('./utf8').environment(env), detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
    require('./utf8').streams(proc.stdout, proc.stderr);
    const stop = () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); } };
    let killed = false, hard;
    const abort = () => { killed = true; stop(); hard = setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); } }, 1000); hard.unref(); };
    signal.addEventListener('abort', abort, { once: true });
    let tail = '', buffered = '', outputBytes = 0;
    const output = chunk => {
      outputBytes += Buffer.byteLength(chunk);
      tail = (tail + chunk.toString()).slice(-8000); buffered = (buffered + chunk.toString()).slice(-8000);
      if (buffered.includes('\n')) { log(job, buffered.split('\n').slice(-4).join('\n')); buffered = ''; }
      if (outputBytes > 16 * 1048576 && !killed) abort();
    };
    proc.stdout.on('data', output); proc.stderr.on('data', output);
    try {
      const [code, sig] = await once(proc, 'close');
      if (signal.aborted) throw signal.reason;
      if (code !== 0 || killed) throw P.error(`Joern command failed (${code ?? sig}): ${tail.slice(-3000)}`, code === 137 || /OutOfMemory|heap space|Cannot allocate memory/i.test(tail) ? 'DT_SEMANTIC_RESOURCE_EXHAUSTED' : 'DT_SEMANTIC_EXECUTION', 500);
    } finally { signal.removeEventListener('abort', abort); clearTimeout(hard); }
  }
  function schedule(job) {
    const controller = new AbortController(), key = `${job.owner.scopeKey}:${job.id}`;
    active.set(key, controller);
    const queryBudget = job.kind === 'query' ? P.integer(readJson(path.join(file(job.owner, job.id), 'request.json'))?.budgetMs, 5000, 100, 30000) + 30000 : config.timeoutMs;
    const timeout = setTimeout(() => controller.abort(P.error('Semantic job deadline exceeded', 'DT_SEMANTIC_TIMEOUT', 504)), Math.min(config.timeoutMs, queryBudget)); timeout.unref();
    admission.run(job.kind, job.owner.scopeKey, controller.signal, async () => {
      controller.signal.throwIfAborted(); const dir = file(job.owner, job.id);
      const heap = Math.floor(config[`${job.kind}MemoryMb`] * 0.67);
      if (job.kind === 'parse') {
        job.state = 'parsing'; persist(job);
        const raw = path.join(dir, 'raw.cpg.bin'), source = path.join(dir, 'source');
        const args = [`-J-Xmx${heap}m`, source, '--output', raw];
        if (job.language === 'java') args.push('--delombok-mode', 'no-delombok');
        await command(job, config[job.language], args, dir, controller.signal);
        job.state = 'enriching'; persist(job);
        await command(job, config.joern, [`-J-Xmx${heap}m`, '--script', path.join(scriptDirectory(), 'enrich-project.sc'), '--param', `cpgPath=${raw}`, '--param', `enrichedPath=${path.join(dir, 'cpg.bin')}`, '--param', `out=${path.join(dir, 'projection.jsonl')}`, '--param', `root=${source}`], dir, controller.signal);
        for (const name of ['cpg.bin','projection.jsonl']) if (!fs.statSync(path.join(dir, name)).size) throw P.error(`Missing ${name}`, 'DT_SEMANTIC_ARTIFACT', 500);
        if (fs.statSync(path.join(dir, 'projection.jsonl')).size > config.maxProjectionBytes) throw P.error('Projection exceeds worker byte budget', 'DT_SEMANTIC_LIMIT', 413);
        let meta = null, summary = null;
        for await (const line of P.lines(fs.createReadStream(path.join(dir, 'projection.jsonl')), { maxBytes: config.maxProjectionBytes })) { const row = JSON.parse(line); if (row.type === 'meta') meta = row; if (row.type === 'summary') summary = row; }
        if (!meta || !summary) throw P.error('Incomplete semantic projection', 'DT_SEMANTIC_ARTIFACT', 500);
        job.meta = meta; job.summary = summary;
        fs.rmSync(raw, { force: true });
      } else {
        const source = load(job.owner, job.analysisId);
        if (source.state !== 'ready' || source.kind !== 'parse') throw P.error('Query analysis is not ready', 'DT_SEMANTIC_NOT_READY', 409);
        job.state = 'querying'; persist(job);
        await command(job, config.joern, [`-J-Xmx${heap}m`, '--script', path.join(scriptDirectory(), 'query.sc'), '--param', `cpgPath=${path.join(file(job.owner, job.analysisId), 'cpg.bin')}`, '--param', `out=${path.join(dir, 'query.jsonl')}`, '--param', `request=${path.join(dir, 'request.json')}`, '--param', `root=${path.join(file(job.owner, job.analysisId), 'source')}`], dir, controller.signal);
        if (fs.statSync(path.join(dir, 'query.jsonl')).size > 4 * 1048576) throw P.error('Query output exceeds byte budget', 'DT_SEMANTIC_LIMIT', 413);
      }
      controller.signal.throwIfAborted(); job.state = 'ready'; job.endedAt = new Date().toISOString(); persist(job);
    }).catch(e => { job.state = controller.signal.aborted ? (e.code === 'DT_SEMANTIC_TIMEOUT' ? 'failed' : 'cancelled') : 'failed'; job.error = String(e.message || e).slice(0, 5000); job.code = e.code || 'DT_SEMANTIC_EXECUTION'; job.endedAt = new Date().toISOString(); persist(job); })
      .finally(() => { clearTimeout(timeout); active.delete(key); });
  }
  async function submit(req, owner) {
    let job, dir, done = false, bytes = 0, count = 0;
    const seen = new Set(), hash = crypto.createHash('sha256');
    try {
      for await (const line of P.lines(req, { maxBytes: config.maxSourceBytes * 1.5 + 1048576 })) {
        const row = JSON.parse(line);
        if (!job) {
          if (row.type !== 'request' || row.protocol !== P.VERSION || !P.ID.test(row.id || '') || !/^[a-f0-9]{64}$/.test(row.key || '') || !['java','js'].includes(row.language)) throw P.error('Invalid semantic upload request');
          dir = file(owner, row.id);
          try { fs.mkdirSync(dir, { recursive: false }); } catch (e) { if (e.code === 'EEXIST') return load(owner, row.id); throw e; }
          job = { protocol: P.VERSION, id: row.id, key: row.key, kind: 'parse', instance, owner, state: 'uploading', language: row.language, sourceDigest: row.sourceDigest, startedAt: new Date().toISOString(), log: [] }; persist(job); continue;
        }
        if (done) throw P.error('Unexpected records after upload end');
        if (row.type === 'end') { done = true; continue; }
        if (row.type !== 'file' || typeof row.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.content)) throw P.error('Invalid source record');
        const rel = P.relative(row.path); if (seen.has(rel)) throw P.error('Duplicate source path'); seen.add(rel);
        const content = Buffer.from(row.content, 'base64'); bytes += content.length; count++;
        if (content.length > 2 * 1048576 || bytes > config.maxSourceBytes || count > 100000) throw P.error('Source upload exceeds its budget', 'DT_SEMANTIC_LIMIT', 413);
        hash.update(rel).update('\0').update(content).update('\0');
        const target = path.join(dir, 'source', rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
      }
      if (!job || !done || !count || hash.digest('hex') !== job.sourceDigest) throw P.error('Incomplete source upload or source digest mismatch');
      job.files = count; job.bytes = bytes; job.state = 'queued'; persist(job); schedule(job); return job;
    } catch (e) { if (job) { job.state = 'failed'; job.error = String(e.message); job.code = e.code || 'DT_SEMANTIC_UPLOAD'; persist(job); } throw e; }
  }
  function ownerOf(req) {
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!A.sameSecret(config.token, supplied)) throw P.error('Semantic worker authentication required', 'DT_UNAUTHORIZED', 401);
    let value; try { value = JSON.parse(Buffer.from(String(req.headers['x-dt-owner'] || ''), 'base64url').toString()); } catch { throw P.error('Missing trusted owner context', 'DT_UNAUTHORIZED', 401); }
    const owner = A.normalize(value);
    if (owner.scopeKey !== value.scopeKey) throw P.error('Owner context does not match its scope', 'DT_UNAUTHORIZED', 401);
    fs.mkdirSync(directory(owner), { recursive: true }); return owner;
  }
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://semantic');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      const owner = ownerOf(req);
      if (req.method === 'GET' && url.pathname === '/v1/info') return json(res, 200, { protocol: P.VERSION, version: config.version, image: config.image, scriptsDigest: scriptsDigest(), enrichmentDigest: P.digest(fs.readFileSync(path.join(scriptDirectory(), 'enrich-project.sc'))), queryDigest: P.digest(fs.readFileSync(path.join(scriptDirectory(), 'query.sc'))), languages: ['java','js'], limits: { parseMemoryMb: config.parseMemoryMb, queryMemoryMb: config.queryMemoryMb, totalMemoryMb: config.totalMemoryMb, parseConcurrency: config.parseConcurrency, queryConcurrency: config.queryConcurrency, timeoutMs: config.timeoutMs, maxProjectionBytes: config.maxProjectionBytes }, ...(owner.role === 'admin' ? { scheduler: admission.status() } : {}) });
      if (req.method === 'POST' && url.pathname === '/v1/jobs') { const job = await submit(req, owner); return json(res, 202, job); }
      if (req.method === 'POST' && url.pathname === '/v1/queries') {
        const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) throw P.error('Query request too large', 'DT_SEMANTIC_LIMIT', 413); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks));
        if (!P.ID.test(body.id || '') || !P.ID.test(body.analysisId || '') || !['slice','paths','assertions'].includes(body.request?.operation)) throw P.error('Invalid named query request');
        const analysis = load(owner, body.analysisId); if (analysis.state !== 'ready') throw P.error('Analysis is not ready', 'DT_SEMANTIC_NOT_READY', 409);
        const dir = file(owner, body.id);
        if (fs.existsSync(dir)) return json(res, 202, load(owner, body.id));
        fs.mkdirSync(dir); writeJson(path.join(dir, 'request.json'), body.request);
        const job = { protocol: P.VERSION, id: body.id, analysisId: body.analysisId, kind: 'query', instance, owner, state: 'queued', startedAt: new Date().toISOString(), log: [] }; persist(job); schedule(job); return json(res, 202, job);
      }
      const match = url.pathname.match(/^\/v1\/jobs\/([^/]+)(?:\/(projection|result|cancel))?$/);
      if (!match) throw P.error('Unknown semantic endpoint', 'DT_NOT_FOUND', 404);
      const job = load(owner, match[1]);
      if (req.method === 'POST' && match[2] === 'cancel') {
        const controller = active.get(`${owner.scopeKey}:${job.id}`);
        if (controller && !lifecycles.semantic.terminal.includes(job.state)) { job.state = 'cancelling'; persist(job); controller.abort(P.error('Semantic job cancelled', 'DT_CANCELLED', 499)); }
        return json(res, 200, load(owner, job.id));
      }
      if (req.method !== 'GET') throw P.error('Method is not allowed', 'DT_METHOD', 405);
      if (!match[2]) return json(res, 200, job);
      if (job.state !== 'ready') throw P.error('Semantic result is not ready', 'DT_SEMANTIC_NOT_READY', 409);
      const name = match[2] === 'projection' ? 'projection.jsonl' : 'query.jsonl';
      if ((name === 'projection.jsonl') !== (job.kind === 'parse')) throw P.error('Result type does not match job', 'DT_NOT_FOUND', 404);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const stream = fs.createReadStream(path.join(file(owner, job.id), name)); res.on('close', () => stream.destroy()); stream.on('error', e => res.destroy(e)); stream.pipe(res);
    } catch (e) { if (!res.headersSent) json(res, e.statusCode || 500, { error: { code: e.code || 'DT_SEMANTIC_ERROR', message: String(e.message).slice(0, 5000) } }); else res.destroy(e); }
  });
  server.requestTimeout = 30 * 60000;
  return { server, config, admission, active, close: async () => { for (const controller of active.values()) controller.abort(P.error('Semantic worker stopped', 'DT_CANCELLED')); await new Promise(resolve => server.close(resolve)); } };
}
function scriptsDigest() { const dir = scriptDirectory(); return P.digest(fs.readdirSync(dir).filter(n => n.endsWith('.sc')).sort().map(n => [n, P.digest(fs.readFileSync(path.join(dir, n)))])); }
function serve(options = {}) { const worker = createWorker(options); worker.server.listen(Number(options.port || process.env.PORT || 4110), options.host || '0.0.0.0'); return worker; }
module.exports = { createWorker, serve, configuration, Admission, scriptsDigest, scriptDirectory };
