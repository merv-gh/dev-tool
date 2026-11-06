// What every tool call and job does, while it does it: a start line, its steps with their times (git fetch,
// indexing, Maven prepare, compile, test run...), and the end: ok with the time, or FAILED with the step
// and the error. To stderr (docker logs dt) and to cache/logs/dt.log (JSON lines, rotated by size), and
// into the call history; running calls with their current step are listed by call_history.
//   DT_LOG=quiet|calls|steps (default steps: also each step that takes a second or fails)
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { bind } = require('./state-machine'), spanLifecycle = require('./lifecycles').span;

const als = new AsyncLocalStorage();
const running = new Map();
const callSecrets = new WeakMap();
const scope = () => als.getStore();
const context = () => scope()?.call || null;
const visible = c => require('./access').visible(c.owner);
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
function jsonStderr(){try{return (process.env.DT_LOG_FORMAT||require('./config').load().raw.log?.format)==='json';}catch{return process.env.DT_LOG_FORMAT==='json';}}
function write(event, c = context()) {
  const trace = require('./telemetry').carrier();
  if (trace?.traceparent) { const [,traceId,spanId] = trace.traceparent.split('-'); event = { ...event, traceId, otelSpanId: spanId }; }
  try { const line=JSON.stringify(require('./redact').clean({ at:new Date().toISOString(),owner:c?.owner||require('./access').owner(),...event },{known:callSecrets.get(c)||[]}));append(logFile(),line,limits());if(jsonStderr()&&level()!=='quiet')process.stderr.write(line+'\n'); } catch {}
}
function say(text, c = context()) { if (level() !== 'quiet'&&!jsonStderr()) process.stderr.write(`${clock()} dt ${require('./redact').clean(text, { known: callSecrets.get(c) || [] })}\n`); }

const short = (args) => {
  const s = JSON.stringify(require('./redact').clean(args || {}));
  return s.length > 160 ? `${s.slice(0, 160)}…}` : s;
};

// A call (a tool call or a job); fn runs inside it, so steps anywhere below are attributed to it
async function call(tool, args, { source, session, kind = 'call', redactions = [] } = {}, fn) {
  const parent = context();
  const c = { owner: require('./access').owner(), parentId: parent?.id || null, parentSpanId: scope()?.span || null, executionId: require('./execution').current()?.id || null, activeSpans: new Map(), spanSeq: 0, id: `${(++seq).toString(36)}${require('crypto').randomBytes(5).toString('hex')}`, kind, tool, source: source || 'api', session: session || null, args: require('./redact').clean(args), startedAt: Date.now(), steps: [], current: null, depth: 0, notes: [] };
  bind(c, spanLifecycle); callSecrets.set(c, [...(callSecrets.get(parent) || []), ...redactions, ...require('./redact').values(args)]);
  const execution = require('./execution').current(); if (execution) execution.redactions.push(...callSecrets.get(c));
  running.set(c.id, c);
  say(`${kind} ${tool}#${c.id} start ${short(args)} (${c.source})`);
  write({ event: 'start', kind, id: c.id, tool, source: c.source, session: c.session, owner: c.owner, parentId: c.parentId, parentSpanId: c.parentSpanId, executionId: c.executionId, args });
  try {
    const r = await require('./telemetry').run('tool.' + tool, { 'dt.kind': kind, 'dt.tool.name': tool, 'dt.call.id': c.id, 'dt.execution.id': c.executionId }, () => als.run({ call: c, span: null, depth: 0 }, fn));
    finish(c, { ok: true });
    return r;
  } catch (e) {
    finish(c, { ok:false,error:e.message,cancelled:e.code==='DT_CANCELLED'||e.name==='AbortError' });
    throw e;
  } finally { running.delete(c.id); }
}

function finish(c, { ok, error, cancelled }) {
  require('./operational-metrics').record(c.kind,Date.now()-c.startedAt,cancelled?'cancelled':ok?'succeeded':'failed');
  c.state = ok ? 'succeeded' : 'failed';
  c.ms = Date.now() - c.startedAt;
  const slow = c.steps.filter(s => s.depth === 0).map(s => `${s.name} ${secs(s.ms)}${s.ok ? '' : ' FAILED'}`).join(' · ');
  const failedStep = c.steps.filter(s => !s.ok).pop();
  if (ok) say(`${c.kind} ${c.tool}#${c.id} ok ${secs(c.ms)}${slow ? `  ${slow}` : ''}`, c);
  else say(`${c.kind} ${c.tool}#${c.id} FAILED ${secs(c.ms)}${failedStep ? ` in ${failedStep.name}` : ''}: ${String(error).split('\n')[0].slice(0, 300)}`, c);
  write({ event: ok ? 'ok' : 'failed', kind: c.kind, id: c.id, parentId: c.parentId, executionId: c.executionId, owner: c.owner, tool: c.tool, ms: c.ms, steps: c.steps, notes: c.notes, ...(error ? { error: String(error).slice(0, 4000) } : {}) }, c);
}

// A step of the current call: timed, logged when slow or failed, kept in the call's record
async function step(name, fn, detail) {
  const parent = scope(), c = parent?.call;
  if (!c) return fn();
  const t0 = Date.now(), depth = parent.depth, id = `${c.id}:${require('crypto').randomBytes(6).toString('hex')}`, parentId = parent.span;
  const span = bind({ id, parentId, name, depth, startedAt: t0 }, spanLifecycle);
  c.activeSpans.set(id, span);
  c.current = name;
  try { const r = await require('./telemetry').run(require('./telemetry').stepName(name), { 'dt.kind': 'step', 'dt.execution.id': c.executionId }, () => als.run({ call: c, span: id, depth: depth + 1 }, fn)); done(true); return r; }
  catch (e) { done(false, e); throw e; }
  function done(ok, e) {
    span.state = ok ? 'succeeded' : 'failed';
    c.activeSpans.delete(id); c.current = [...c.activeSpans.values()].at(-1)?.name || null;
    const s = { id, parentId, name, startedAt: new Date(t0).toISOString(), ms: Date.now() - t0, ok, depth, ...(detail ? { detail: String(detail).slice(0, 200) } : {}), ...(e ? { error: String(e.message).split('\n')[0].slice(0, 300) } : {}) };
    if (c.steps.length < 200) c.steps.push(s);
    if (level() === 'steps' && (!ok || s.ms >= 1000)) say(`  ${c.tool}#${c.id} ${'· '.repeat(depth)}${name} ${ok ? secs(s.ms) : `FAILED after ${secs(s.ms)}: ${s.error}`}`);
    write({ event: 'step', id: c.id, owner: c.owner, executionId: c.executionId, tool: c.tool, ...s, spanId: id, id: c.id }, c);
  }
}

// Child processes of the current call (git, Maven, Gradle, javac, the test JVM): killed when its job is cancelled
function child(proc) {
  const c = context();
  if (!c || !proc) return proc;
  (c.children ||= new Set()).add(proc);
  const release = require('./execution').resource(() => require('./process-tree').stop(proc, 500));
  proc.once(typeof proc.pid === 'number' ? 'close' : 'exit', () => { release(); c.children.delete(proc); });
  return proc;
}

function kill(id, why = 'cancelled') {
  const c = running.get(id);
  if (!c || !visible(c)) return 0;
  c.cancelled = why;
  let n = 0;
  if (c.executionId) { try { n = require('./execution').cancel(c.executionId, why).stopped; } catch {} }
  for (const p of c.children || []) { try { p.kill('SIGTERM'); if (!c.executionId) n++; setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 5000).unref(); } catch {} }
  say(`${c.kind} ${c.tool}#${c.id} ${why}: ${n} process${n === 1 ? '' : 'es'} stopped`);
  write({ event: 'cancel', id, owner: c.owner, executionId: c.executionId, tool: c.tool, why, processes: n });
  return n;
}

// Something worth knowing about the current call (a fallback taken, a cache reused)
function note(text) {
  const c = context();
  const t = String(text).slice(0, 300);
  if (c) { c.notes.push(t); if (level() !== 'quiet') say(`  ${c.tool}#${c.id} note: ${t}`); write({ event: 'note', id: c.id, owner: c.owner, executionId: c.executionId, tool: c.tool, text: t }); } else say(`note: ${t}`);
}

const current = context;

// Running calls and jobs, for call_history and the admin page
function list() {
  return [...running.values()].filter(visible).map(c => ({ owner: c.owner, parentId: c.parentId, parentSpanId: c.parentSpanId, executionId: c.executionId, spans: [...c.activeSpans.values()], id: c.id, kind: c.kind, tool: c.tool, source: c.source, startedAt: new Date(c.startedAt).toISOString(), runningMs: Date.now() - c.startedAt, step: c.current, steps: c.steps.filter(s => s.depth === 0).map(s => `${s.name} ${secs(s.ms)}${s.ok ? '' : ' FAILED'}`).join(', ') }));
}

// The last lines of the log file (newest last), optionally only failures / one tool / words
function tail({ lines = 200, failed = false, tool, q } = {}) {
  const out = [];
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const f of [logFile(), `${logFile()}.1`]) {
    let text = '';
    try { const fd = fs.openSync(f, 'r'); try { const size = fs.fstatSync(fd).size, start = Math.max(0, size - 8 * 1048576), buffer = Buffer.alloc(Math.min(size, 8 * 1048576)); fs.readSync(fd, buffer, 0, buffer.length, start); text = buffer.toString('utf8'); if (start) text = text.slice(text.indexOf('\n') + 1); } finally { fs.closeSync(fd); } } catch { continue; }
    const ls = text.split('\n').filter(Boolean).reverse();
    for (const l of ls) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (!require('./access').visible(e.owner)) continue;
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

function carrier() { const c = context(); return c ? { id: c.id, spanId: scope()?.span, depth: scope()?.depth, session: c.session, owner: c.owner } : null; }
function runCarrier(carrier, fn) { if (!carrier) return fn(); const c = { id: carrier.id, owner: carrier.owner, session: carrier.session, executionId: require('./execution').current()?.id, steps: [], notes: [], activeSpans: new Map(), spanSeq: 0, tool: 'worker' }; return als.run({ call: c, span: carrier.spanId || null, depth: carrier.depth || 0 }, fn); }
function exportTrace({ executionId, lines = 1000 } = {}) {
  const records = tail({ lines: Math.min(2000, lines) });
  if (!executionId) return records;
  const executions = require('./execution').list({ limit: 500 }), ids = new Set([executionId]), traceIds = new Set();
  let changed = true;
  while (changed) { changed = false; for (const execution of executions) if (ids.has(execution.parentId) && !ids.has(execution.id)) { ids.add(execution.id); changed = true; } }
  for (const record of records) if (ids.has(record.executionId)) traceIds.add(record.id);
  changed = true;
  while (changed) { changed = false; for (const record of records) if (traceIds.has(record.parentId) && !traceIds.has(record.id)) { traceIds.add(record.id); changed = true; } }
  return records.filter(record => ids.has(record.executionId) || traceIds.has(record.id));
}
module.exports = { export: exportTrace, carrier, runCarrier, call, step, note, child, kill, current, list, tail, secs, append, logFile };
