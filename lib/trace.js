// What every tool call and job does, while it does it: a start line, its steps with their times (git fetch,
// indexing, Maven prepare, compile, test run...), and the end: ok with the time, or FAILED with the step
// and the error. To stderr (docker logs dt) and to cache/logs/dt.log (JSON lines, rotated by size), and
// into the call history; running calls with their current step are listed by call_history.
//   DT_LOG=quiet|calls|steps (default steps: also each step that takes a second or fails)
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const running = new Map();
const callSecrets = new WeakMap();
let seq = 0;

const level = () => process.env.DT_LOG || 'steps';
const secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const clock = () => new Date().toISOString().slice(11, 19);

// ── the log file: JSON lines, rotated at log.maxMb (default 50), log.files kept (default 3) ──
function limits() {
  let c = {};
  try { c = require('./config').load().raw.log || {}; } catch {}
  return { maxBytes: Math.max(1, Number(process.env.DT_LOG_MAX_MB || c.maxMb || 50)) * 1048576, files: Math.max(1, Number(c.files || 3)) };
}
const logFile = () => path.join(require('./util').CACHE, 'logs', 'dt.log');
let written = 0;
function append(file, line, { maxBytes, files }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n');
  written += line.length;
  if (written < 1048576) return; // check the size about every megabyte
  written = 0;
  if (fs.statSync(file).size < maxBytes) return;
  for (let i = files - 1; i >= 1; i--) { const a = `${file}.${i}`, b = `${file}.${i + 1}`; if (fs.existsSync(a)) { if (i + 1 > files - 1) fs.rmSync(a, { force: true }); else fs.renameSync(a, b); } }
  if (files > 1) fs.renameSync(file, `${file}.1`); else fs.rmSync(file, { force: true });
}
function write(event, context = als.getStore()) {
  try { append(logFile(), JSON.stringify(require('./redact').clean({ at: new Date().toISOString(), ...event }, { known: callSecrets.get(context) || [] })), limits()); } catch {}
}
function say(text, context = als.getStore()) { if (level() !== 'quiet') process.stderr.write(`${clock()} dt ${require('./redact').clean(text, { known: callSecrets.get(context) || [] })}\n`); }

const short = (args) => {
  const s = JSON.stringify(require('./redact').clean(args || {}));
  return s.length > 160 ? `${s.slice(0, 160)}…}` : s;
};

// A call (a tool call or a job); fn runs inside it, so steps anywhere below are attributed to it
async function call(tool, args, { source, session, kind = 'call' } = {}, fn) {
  const c = { id: `${(++seq).toString(36)}${Date.now().toString(36).slice(-3)}`, kind, tool, source: source || 'api', session: session || null, args: require('./redact').clean(args), startedAt: Date.now(), steps: [], current: null, depth: 0, notes: [] };
  callSecrets.set(c, [...(callSecrets.get(als.getStore()) || []), ...require('./redact').values(args)]);
  running.set(c.id, c);
  say(`${kind} ${tool}#${c.id} start ${short(args)} (${c.source})`);
  write({ event: 'start', kind, id: c.id, tool, source: c.source, session: c.session, args });
  try {
    const r = await als.run(c, fn);
    finish(c, { ok: true });
    return r;
  } catch (e) {
    finish(c, { ok: false, error: e.message });
    throw e;
  } finally { running.delete(c.id); }
}

function finish(c, { ok, error }) {
  c.ms = Date.now() - c.startedAt;
  const slow = c.steps.filter(s => s.depth === 0).map(s => `${s.name} ${secs(s.ms)}${s.ok ? '' : ' FAILED'}`).join(' · ');
  const failedStep = c.steps.filter(s => !s.ok).pop();
  if (ok) say(`${c.kind} ${c.tool}#${c.id} ok ${secs(c.ms)}${slow ? `  ${slow}` : ''}`);
  else say(`${c.kind} ${c.tool}#${c.id} FAILED ${secs(c.ms)}${failedStep ? ` in ${failedStep.name}` : ''}: ${String(error).split('\n')[0].slice(0, 300)}`, c);
  write({ event: ok ? 'ok' : 'failed', kind: c.kind, id: c.id, tool: c.tool, ms: c.ms, steps: c.steps, notes: c.notes, ...(error ? { error: String(error).slice(0, 4000) } : {}) }, c);
}

// A step of the current call: timed, logged when slow or failed, kept in the call's record
async function step(name, fn, detail) {
  const c = als.getStore();
  if (!c) return fn();
  const t0 = Date.now(), depth = c.depth, prev = c.current;
  c.current = name; c.depth++;
  try {
    const r = await fn();
    done(true);
    return r;
  } catch (e) {
    done(false, e);
    throw e;
  }
  function done(ok, e) {
    c.depth = depth; c.current = prev;
    const s = { name, ms: Date.now() - t0, ok, depth, ...(detail ? { detail: String(detail).slice(0, 200) } : {}), ...(e ? { error: String(e.message).split('\n')[0].slice(0, 300) } : {}) };
    if (c.steps.length < 200) c.steps.push(s);
    if (level() === 'steps' && (!ok || s.ms >= 1000)) say(`  ${c.tool}#${c.id} ${'· '.repeat(depth)}${name}${detail ? ` (${String(detail).slice(0, 80)})` : ''} ${ok ? secs(s.ms) : `FAILED after ${secs(s.ms)}: ${s.error}`}`);
    write({ event: 'step', id: c.id, tool: c.tool, ...s });
  }
}

// Child processes of the current call (git, Maven, Gradle, javac, the test JVM): killed when its job is cancelled
function child(proc) {
  const c = als.getStore();
  if (!c || !proc) return proc;
  (c.children ||= new Set()).add(proc);
  proc.once('exit', () => c.children.delete(proc));
  return proc;
}

function kill(id, why = 'cancelled') {
  const c = running.get(id);
  if (!c) return 0;
  c.cancelled = why;
  let n = 0;
  for (const p of c.children || []) { try { p.kill('SIGTERM'); n++; setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 5000).unref(); } catch {} }
  say(`${c.kind} ${c.tool}#${c.id} ${why}: ${n} process${n === 1 ? '' : 'es'} stopped`);
  write({ event: 'cancel', id, tool: c.tool, why, processes: n });
  return n;
}

// Something worth knowing about the current call (a fallback taken, a cache reused)
function note(text) {
  const c = als.getStore();
  const t = String(text).slice(0, 300);
  if (c) { c.notes.push(t); if (level() !== 'quiet') say(`  ${c.tool}#${c.id} note: ${t}`); write({ event: 'note', id: c.id, tool: c.tool, text: t }); } else say(`note: ${t}`);
}

const current = () => als.getStore() || null;

// Running calls and jobs, for call_history and the admin page
function list() {
  return [...running.values()].map(c => ({ id: c.id, kind: c.kind, tool: c.tool, source: c.source, startedAt: new Date(c.startedAt).toISOString(), runningMs: Date.now() - c.startedAt, step: c.current, steps: c.steps.filter(s => s.depth === 0).map(s => `${s.name} ${secs(s.ms)}${s.ok ? '' : ' FAILED'}`).join(', ') }));
}

// The last lines of the log file (newest last), optionally only failures / one tool / words
function tail({ lines = 200, failed = false, tool, q } = {}) {
  const out = [];
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const f of [logFile(), `${logFile()}.1`]) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const ls = text.split('\n').filter(Boolean).reverse();
    for (const l of ls) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (failed && e.event !== 'failed' && !(e.event === 'step' && !e.ok)) continue;
      if (tool && e.tool !== tool) continue;
      if (words.length && !words.every(w => l.toLowerCase().includes(w))) continue;
      out.push(e);
      if (out.length >= lines) break;
    }
    if (out.length >= lines) break;
  }
  return out.reverse();
}

module.exports = { call, step, note, child, kill, current, list, tail, secs, append, logFile };
