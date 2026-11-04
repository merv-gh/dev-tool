// Small JS in scripts (js steps, before/after hooks), Postman/Bruno style. The code runs in a separate
// node process (one per script run) with the permission model on (no file system, no child processes, no
// workers), an empty environment (no secrets), a memory cap and a timeout. Direct network fetch is allowed. Data goes in and out as JSON.
//
// The code sees:
//   vars     params, collection vars, earlier results ("as") and captures; changes are kept for later steps
//   args     the step's arguments (before hooks; change them, or return new ones)
//   result   the step's result (after hooks; return a value to replace it), or the previous result (js steps)
//   uuid() now() date('YYYYMMDD') rand(6) hex(8)   diffLists(a, b) diffLines(a, b)   log(...)   test('name', () => expect(x).toBe(y))   assert(ok, msg)
//   text(...)  output for the user (objects as pretty JSON)
//   tools      dt tools, when the caller allows them: await tools.pg_query({ sql }), tools.call(name, args), await tools.list()
//              (the sandbox asks dt over its pipe; dt runs the tool with its usual checks and limits)
const { spawn, spawnSync } = require('child_process');

let flag, activeNodes = 0;
const permissionFlag = () => {
  if (flag === undefined) {
    flag = ['--permission', '--experimental-permission'].find(f => spawnSync(process.execPath, [f, '-e', '0'], { env: {}, stdio: 'ignore' }).status === 0) || null;
  }
  return flag;
};

// Runs inside the sandbox process.
const { diffLists, diffLines } = require('./diff');
const RUNNER = String.raw`
${diffLists.toString()}
${diffLines.toString()}
const fmt = (v) => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })());
const pad = (n, w = 2) => String(n).padStart(w, '0');
const date = (f = 'YYYY-MM-DD', d = new Date()) => f.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, (t) => ({ YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), SSS: pad(d.getMilliseconds(), 3) }[t]));
const rand = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b % 10).join('').replace(/^0/, '1');
const hex = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
const logs = [], tests = [], pending = [], output = [];
let outputBytes = 0;
function emit(kind, values) {
  const text = values.map(kind === 'text' ? pretty : fmt).join(' ');
  outputBytes += Buffer.byteLength(text);
  if (outputBytes > 1048576) throw new Error('code output exceeds 1 MB; summarize results or save them to context files');
  (kind === 'text' ? output : logs).push(text);
  process.stdout.write(JSON.stringify({ event: 'output', kind, text }) + '\n');
}
// tool calls go to dt over stdout; answers come back on stdin
let rpcSeq = 0;
const rpcWait = new Map();
const rpc = (tool, args) => new Promise((resolve, reject) => {
  if (rpcWait.size >= 32) return reject(new Error('at most 32 host tool calls may be outstanding'));
  const id = ++rpcSeq;
  rpcWait.set(id, { resolve, reject });
  process.stdout.write(JSON.stringify({ rpc: id, tool, args: args === undefined ? {} : args }) + '\n');
});
const tools = new Proxy({}, { get: (_, name) => {
  if (typeof name !== 'string' || name === 'then') return undefined;
  if (name === 'call') return (tool, args) => rpc(tool, args);
  if (name === 'list') return () => rpc('__list', {});
  return (args) => rpc(name, args);
} });
const pretty = (v) => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } })());
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
function expect(v) {
  const m = (neg) => ({
    toBe: (x) => check((v === x) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to be ' + fmt(x)),
    toEqual: (x) => check((JSON.stringify(v) === JSON.stringify(x)) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to equal ' + fmt(x)),
    toMatch: (re) => check(new RegExp(re).test(String(v)) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to match ' + re),
    toContain: (x) => check((v != null && v.includes(x)) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to contain ' + fmt(x)),
    toBeTruthy: () => check(!!v !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to be truthy'),
    toBeGreaterThan: (x) => check((v > x) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to be greater than ' + fmt(x)),
    toHaveProperty: (k) => check((v != null && k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), v) !== undefined) !== neg, 'expected ' + fmt(v).slice(0, 200) + (neg ? ' not' : '') + ' to have ' + k),
  });
  return Object.assign(m(false), { not: m(true) });
}
const helpers = {
  uuid: () => crypto.randomUUID(), now: () => new Date().toISOString(), date, rand, hex, diffLists, diffLines,
  log: (...a) => emit('log', a),
  text: (...a) => emit('text', a),
  tools,
  assert: (ok, msg) => check(ok, msg || 'assertion failed'),
  expect,
  test: (name, fn) => {
    const done = (error) => tests.push(error ? { name, ok: false, error: error.message || String(error) } : { name, ok: true });
    try { const r = fn(); if (r && typeof r.then === 'function') pending.push(r.then(() => done(), done)); else done(); } catch (e) { done(e); }
  },
};
// stdout is the RPC protocol. Ordinary console calls must never write into it.
const safeConsole = Object.create(null);
for (const name of ['log', 'info', 'warn', 'error', 'debug', 'dir', 'table', 'trace']) safeConsole[name] = (...args) => helpers.log(...args);
safeConsole.assert = (condition, ...args) => { if (!condition) helpers.log('Assertion failed:', ...args); };
globalThis.console = safeConsole;
// one JSON request per line, one JSON answer per line
let buf = '';
process.stdin.setEncoding('utf8');
let queue = Promise.resolve();
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    if (msg.rpcResult !== undefined) {
      const w = rpcWait.get(msg.rpcResult);
      rpcWait.delete(msg.rpcResult);
      if (w) msg.error ? w.reject(new Error(msg.error)) : w.resolve(msg.result);
    } else queue = queue.then(() => handle(msg));
  }
});
async function handle(input) {
  logs.length = 0; tests.length = 0; pending.length = 0; output.length = 0; outputBytes = 0;
  const out = { vars: input.vars, args: input.args, result: input.result, logs, tests, output };
  try {
    const AsyncFunction = (async () => {}).constructor;
    const revisions = new Map();
    const fileCall = (tool, args) => {
      if (!input.context) throw new Error('Nearby files need code context: pass the id from context_open');
      return rpc(tool, { ...args, id: input.context });
    };
    const readFile = async (path, options = {}) => {
      const r = await fileCall('context_read', { ...options, path });
      // A partial read must never authorize replacing unread parts of a file.
      if (!r.truncated) revisions.set(path, r.revision);
      return r;
    };
    const files = Object.freeze({
      id: input.context || null,
      list: (dir = '', options = {}) => fileCall('context_list', { ...options, dir }),
      search: (query, options = {}) => fileCall('context_search', { ...options, query }),
      readFile,
      read: async (path, options = {}) => (await readFile(path, options)).content,
      readJson: async path => JSON.parse((await readFile(path)).content),
      write: async (path, content, options = {}) => {
        const r = await fileCall('context_write', { expected_revision: revisions.get(path) || null, ...options, path, content });
        revisions.set(path, r.revision); return r;
      },
      writeJson: (path, value, options = {}) => {
        const json = JSON.stringify(value, null, 2);
        if (json === undefined) throw new Error('writeJson needs a JSON value');
        return files.write(path, json + '\n', options);
      },
      edit: async (path, edits, options = {}) => {
        if (!revisions.has(path)) await readFile(path);
        const r = await fileCall('context_edit', { expected_revision: revisions.get(path), ...options, path, edits });
        revisions.set(path, r.revision); return r;
      },
    });
    globalThis.files = files; // A global can be shadowed by existing local variables.
    const fn = new AsyncFunction('vars', 'args', 'result', ...Object.keys(helpers), input.code);
    const r = await fn(out.vars, out.args, out.result, ...Object.values(helpers));
    await Promise.all(pending);
    if (r !== undefined) { out.returned = r; out.hasReturn = true; }
  } catch (e) { out.error = (e && e.message) || String(e); }
  let text;
  try { text = JSON.stringify(out); } catch (e) { text = JSON.stringify({ logs, tests, output, error: 'result is not JSON: ' + e.message }); }
  process.stdout.write(text + '\n');
}
`;

function enabled() {
  const c = require('./config').getScripts();
  if (c.js === false) throw new Error('JavaScript in scripts is turned off (scripts.js: false in config.json)');
  return c;
}

// A sandbox process that runs pieces of code one after another (one per script run). A piece that runs
// too long kills the process; the next piece starts a new one.
class Session {
  constructor() { this.child = null; this.wait = null; this.busy = false; }

  start() {
    const pf = permissionFlag();
    if (!pf) throw new Error(`JavaScript needs Node 20+ with the permission model (this is ${process.version})`);
    const child = spawn(process.execPath, [pf, '--max-old-space-size=128', '-e', RUNNER], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1);
        let msg = null;
        try { msg = JSON.parse(line); } catch {}
        if (msg?.event === 'output') this.wait?.event?.(msg);
        else if (msg && msg.rpc !== undefined) this.dispatch?.(child, msg); else if (this.wait) this.wait.done(line);
      }
      if (out.length > 20e6) this.kill('more than 20 MB of output');
    });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('close', () => { if (this.child !== child) return; this.child = null; if (this.wait) this.wait.fail(new Error(`js: ${(err.split('\n').find(l => /Error/.test(l)) || err || 'the sandbox stopped').trim().slice(0, 500)}`)); });
    child.stdin.on('error', () => {});
    this.child = child;
  }

  // a tool call from the code: run it through onTool (or refuse), answer on stdin
  async tool(child, { rpc, tool, args }) {
    let reply;
    try {
      if (!this.onTool) throw new Error('dt tools are not available here');
      const result = await require('./execution').run({ kind: 'host-tool', tool }, () => this.onTool(tool, args));
      reply = { rpcResult: rpc, result };
    } catch (e) { reply = { rpcResult: rpc, error: e.message }; }
    let line;
    try { line = JSON.stringify(reply); if (Buffer.byteLength(line) > 16e6) throw new Error('tool result exceeds 16 MB; use paging or context artifacts'); }
    catch (e) { line = JSON.stringify({ rpcResult: rpc, error: `result is not JSON: ${e.message}` }); }
    if (this.child === child && !child.stdin.destroyed) child.stdin.write(line + '\n');
  }

  kill(why) {
    const w = this.wait;
    this.wait = null;
    if (this.child) { this.child.kill('SIGKILL'); this.child = null; }
    if (w) w.fail(new Error(`js: ${why}`));
  }

  // -> { vars, args, result, returned, hasReturn, logs, tests, output, error }
  // onTool(name, args): lets the code call dt tools; timeoutMs: instead of scripts.jsTimeoutMs
  async run(code, { vars = {}, args, result, context } = {}, { onTool, timeoutMs, onOutput, engine = 'node' } = {}) {
    if (this.busy) throw new Error('js: this session already has a running cell');
    const settings = enabled();
    this.busy = true;
    const E = require('./execution'), wallMs = timeoutMs || settings.jsTimeoutMs, deadline = Date.now() + wallMs;
    const controller = new AbortController(), inheritedSignal = E.signal();
    const stopAtDeadline = setTimeout(() => controller.abort(new Error(`js: stopped after ${wallMs}ms`)), wallMs);
    const signal = inheritedSignal ? AbortSignal.any([controller.signal, inheritedSignal]) : controller.signal;
    const execute = () => E.run({ kind: 'code', tool: 'code', codeActive: true, signal }, async () => {
      const c = enabled(); E.check();
      if (!['node', 'quickjs'].includes(engine)) throw new Error(`Unknown code engine: ${engine}`);
      if (engine === 'quickjs') return require('./quickjs').run(code, { vars, args, result, context }, { onTool, timeoutMs: Math.max(1, deadline - Date.now()), onOutput });
      if (activeNodes >= 32) throw Object.assign(new Error('At most 32 JavaScript children may execute, including nested hooks; wait or cancel active work'), { code: 'DT_QUEUE_FULL' });
      activeNodes++;
      try {
      this.onTool = onTool || this.onTool;
      this.dispatch = require('async_hooks').AsyncResource.bind((child, msg) => { this.tool(child, msg).catch(() => {}); });
      const limitMs = Math.max(1, deadline - Date.now());
      if (!this.child) this.start();
      const child = this.child;
      const release = E.resource(() => this.kill('cancelled'));
      let line;
      try { line = JSON.stringify({ code: String(code), vars, args, result, context }); }
      catch (e) { release(); this.close(); throw new Error(`js: data is not JSON: ${e.message}`); }
      try { return await new Promise((resolve, reject) => {
        const t = setTimeout(() => this.kill(`stopped after ${wallMs}ms`), limitMs);
        this.wait = {
          event: msg => onOutput?.({ kind: msg.kind, text: msg.text }),
          done: text => { clearTimeout(t); this.wait = null; try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`js: bad answer: ${e.message}`)); } },
          fail: e => { clearTimeout(t); this.wait = null; reject(e); },
        };
        child.stdin.write(line + '\n');
      }); } finally {
        release(); this.wait = null;
        // A fresh process per cell prevents unawaited fetches/timers from leaking into the next cell.
        const closed = new Promise(resolve => child.once('close', resolve));
        if (this.child === child) this.close();
        if (child.exitCode === null && child.signalCode === null) await closed;
      }
      } finally { activeNodes--; }
    });
    try { return await (engine === 'quickjs' || E.current()?.codeActive ? execute() : require('./limit').schedule('code', execute, { signal })); } finally { clearTimeout(stopAtDeadline); this.busy = false; }
  }

  close() { if (this.child) { this.child.stdin.end(); this.child.kill(); this.child = null; } }
}

// one-off: its own process
async function run(code, data, opts) {
  const s = new Session();
  try { return await s.run(code, data, opts); } finally { s.close(); }
}

const cellsById = new Map();
function cellView(cell) { const state = require('./execution').get(cell.executionId); return { id: cell.id, executionId: cell.executionId, state: ['done', 'failed', 'cancelled'].includes(cell.state) ? cell.state : state?.state || cell.state, engine: cell.engine, cursor: 0, nextCursor: cell.sequence, owner: cell.owner, ...(cell.error ? { error: cell.error } : {}) }; }
function start(code, data = {}, opts = {}) {
  const E = require('./execution');
  // Validate enablement before accepting a cell that cannot execute.
  enabled();
  if ([...cellsById.values()].filter(c => !['done', 'failed', 'cancelled'].includes(c.state)).length >= 32) throw Object.assign(new Error('Too many active code cells; wait or cancel an existing cell'), { code: 'DT_QUEUE_FULL' });
  const cell = { id: require('crypto').randomUUID(), owner: require('./access').owner(), state: 'queued', engine: opts.engine || 'node', sequence: 0, bytes: 0, output: [], watchers: new Set() };
  const notify = () => { for (const fn of cell.watchers) fn(); };
  const execution = E.start({ kind: 'code-cell', tool: 'code_start', title: opts.title || null, detached: true }, () => run(code, data, { ...opts, onOutput: event => { const row = { cursor: ++cell.sequence, ...event }; cell.output.push(row); cell.bytes += Buffer.byteLength(event.text || ''); opts.onOutput?.(event); notify(); } }));
  cell.executionId = execution.id; cellsById.set(cell.id, cell);
  cell.promise = execution.promise.then(r => { const bytes = Buffer.byteLength(JSON.stringify(r)); if (bytes > 4 * 1048576) { cell.error = 'Code cell result exceeds retained 4 MB budget; summarize or write large data to context files'; cell.state = 'failed'; } else { cell.result = r; cell.bytes += bytes; cell.state = r.error ? 'failed' : 'done'; } }, e => { cell.error = e.message; cell.state = e.code === 'DT_CANCELLED' ? 'cancelled' : 'failed'; }).finally(() => { notify(); trimCells(); });
  trimCells();
  return cellView(cell);
}
function trimCells() { let retained = [...cellsById.values()].reduce((n,c)=>n+c.bytes,0); for (const [id,c] of cellsById) { if (cellsById.size <= 100 && retained <= 32 * 1048576) break; if (['done', 'failed', 'cancelled'].includes(c.state)) { cellsById.delete(id); retained -= c.bytes; } } }
function cellById(id) { const c = cellsById.get(id); if (!c || !require('./access').visible(c.owner)) throw Object.assign(new Error(`no code cell ${id}`), { code: 'DT_NOT_FOUND' }); return c; }
async function wait(id, { cursor = 0, waitMs = 1000 } = {}) {
  const cell = cellById(id);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > cell.sequence) throw new Error('invalid output cursor');
  if (cell.sequence <= cursor && !['done', 'failed', 'cancelled'].includes(cell.state)) {
    let timer, wake, abort; const signal = require('./execution').signal();
    try { await new Promise((resolve, reject) => { wake = resolve; cell.watchers.add(wake); timer = setTimeout(resolve, Math.max(0, Math.min(30000, waitMs))); abort = () => reject(require('./execution').abortError(signal.reason)); if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); }); }
    finally { clearTimeout(timer); cell.watchers.delete(wake); signal?.removeEventListener('abort', abort); }
  }
  return { ...cellView(cell), output: cell.output.filter(x => x.cursor > cursor), nextCursor: cell.sequence, ...(cell.result ? { result: cell.result } : {}) };
}
function cancel(id, why = 'cancelled') { const c = cellById(id); return { ...cellView(c), execution: require('./execution').cancel(c.executionId, why) }; }
const cells = () => [...cellsById.values()].filter(c => require('./access').visible(c.owner)).map(cellView);
const runtimes = () => [{ engine: 'node', status: 'default', active: activeNodes, maxActive: 32, tools: true, files: true, network: true, memoryMb: 128, isolation: 'fresh permission-constrained child process' }, require('./quickjs').capabilities];
module.exports = { run, Session, permissionFlag, start, wait, cancel, cells, runtimes };
