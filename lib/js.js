// Small JS in scripts (js steps, before/after hooks), Postman/Bruno style. The code runs in a separate
// node process (one per script run) with the permission model on (no file system, no child processes, no
// workers), an empty environment (no secrets), a memory cap and a timeout. Data goes in and out as JSON.
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

let flag;
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
// tool calls go to dt over stdout; answers come back on stdin
let rpcSeq = 0;
const rpcWait = new Map();
const rpc = (tool, args) => new Promise((resolve, reject) => {
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
  log: (...a) => { logs.push(a.map(fmt).join(' ').slice(0, 2000)); },
  text: (...a) => { output.push(a.map(pretty).join(' ')); },
  tools,
  assert: (ok, msg) => check(ok, msg || 'assertion failed'),
  expect,
  test: (name, fn) => {
    const done = (error) => tests.push(error ? { name, ok: false, error: error.message || String(error) } : { name, ok: true });
    try { const r = fn(); if (r && typeof r.then === 'function') pending.push(r.then(() => done(), done)); else done(); } catch (e) { done(e); }
  },
};
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
  logs.length = 0; tests.length = 0; pending.length = 0; output.length = 0;
  const out = { vars: input.vars, args: input.args, result: input.result, logs, tests, output };
  try {
    const AsyncFunction = (async () => {}).constructor;
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
  constructor() { this.child = null; this.wait = null; }

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
        if (msg && msg.rpc !== undefined) this.tool(child, msg); else if (this.wait) this.wait.done(line);
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
      reply = { rpcResult: rpc, result: await this.onTool(tool, args) };
    } catch (e) { reply = { rpcResult: rpc, error: e.message }; }
    let line;
    try { line = JSON.stringify(reply); } catch (e) { line = JSON.stringify({ rpcResult: rpc, error: `result is not JSON: ${e.message}` }); }
    if (this.child === child) child.stdin.write(line + '\n');
  }

  kill(why) {
    const w = this.wait;
    this.wait = null;
    if (this.child) { this.child.kill('SIGKILL'); this.child = null; }
    if (w) w.fail(new Error(`js: ${why}`));
  }

  // -> { vars, args, result, returned, hasReturn, logs, tests, output, error }
  // onTool(name, args): lets the code call dt tools; timeoutMs: instead of scripts.jsTimeoutMs
  run(code, { vars = {}, args, result } = {}, { onTool, timeoutMs } = {}) {
    const c = enabled();
    this.onTool = onTool || this.onTool;
    const limitMs = timeoutMs || c.jsTimeoutMs;
    if (!this.child) this.start();
    let line;
    try { line = JSON.stringify({ code: String(code), vars, args, result }); } catch (e) { return Promise.reject(new Error(`js: data is not JSON: ${e.message}`)); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => this.kill(`stopped after ${limitMs}ms`), limitMs);
      this.wait = {
        done: (text) => { clearTimeout(t); this.wait = null; try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`js: bad answer: ${e.message}`)); } },
        fail: (e) => { clearTimeout(t); this.wait = null; reject(e); },
      };
      this.child.stdin.write(line + '\n');
    });
  }

  close() { if (this.child) { this.child.stdin.end(); this.child.kill(); this.child = null; } }
}

// one-off: its own process
async function run(code, data, opts) {
  const s = new Session();
  try { return await s.run(code, data, opts); } finally { s.close(); }
}

module.exports = { run, Session, permissionFlag };
