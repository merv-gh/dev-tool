// Explicit, bounded orchestration. Only leaf nodes invoke tools or models. Their
// write-ahead checkpoints prevent a restart from silently repeating side effects.
const path = require('node:path'), crypto = require('node:crypto');
const C = require('./config'), A = require('./access'), E = require('./execution');
const D = require('./durable-private-store'), live = new Map();
const { define, bind } = require('./state-machine');
const lifecycle = define('SM.automation-flow-run', 'pending', {
  pending: ['running', 'failed'], running: ['done', 'failed', 'cancelled', 'blocked', 'paused'],
  failed: ['running', 'blocked', 'paused'], cancelled: ['running', 'blocked', 'paused'],
  blocked: ['running', 'paused'], paused: ['running', 'blocked'], done: [],
}, ['done']);
const checkpointLifecycle = define('SM.automation-flow-checkpoint', 'pending', {
  pending: ['running', 'waiting', 'done'], running: ['done', 'uncertain'],
  waiting: ['done'], uncertain: ['pending', 'done'], failed: ['pending', 'uncertain', 'done'], done: [],
}, ['done']);
const LIMITS = Object.freeze({ nodes: 100, depth: 8, steps: 1000, iterations: 100, concurrency: 8, waitMs: 86400000, runMs: 7 * 86400000, resultBytes: 65536, runs: 200, definitions: 100 });
const fail = (message, code, status) => { throw D.invalid(message, code, status); };
const clone = value => JSON.parse(JSON.stringify(value));
const store = () => D.create(A.scopedDirectory(path.join(C.HOME, 'automation-flows')));
function id(value) { if (!/^[a-z][a-z0-9_-]{0,59}$/.test(value || '') || ['constructor', 'prototype'].includes(value)) fail('Flow id must use lowercase letters, digits, _ or - (max 60), excluding reserved object keys'); return value; }
function integer(value, fallback, min, max, name) { const n = value === undefined ? fallback : value; if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${name} must be ${min}..${max}`); return n; }
function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`); }
function cleanInput(value) { const data = JSON.stringify(value); if (!data || Buffer.byteLength(data) > 262144) fail('Flow definition/input exceeds 256 KiB'); const cleaned = require('./redact').clean(value); if (JSON.stringify(cleaned) !== data) fail('Do not save credentials in workflows; use configured authentication profiles'); return clone(value); }
function normalize(definition) {
  object(definition, 'definition');
  if (Object.keys(definition).some(k => !['title', 'nodes', 'limits'].includes(k))) fail('Unsupported flow definition field');
  if (typeof definition.title !== 'string' || !definition.title.trim() || definition.title.length > 300) fail('Flow needs a title of at most 300 characters');
  const l = definition.limits || {}; object(l, 'limits');
  if (Object.keys(l).some(k => !['maxSteps', 'maxIterations', 'maxConcurrency', 'maxWaitMs', 'maxRunMs'].includes(k))) fail('Unsupported flow limit');
  const limits = { maxSteps: integer(l.maxSteps, 250, 1, LIMITS.steps, 'maxSteps'), maxIterations: integer(l.maxIterations, 25, 1, LIMITS.iterations, 'maxIterations'), maxConcurrency: integer(l.maxConcurrency, 4, 1, LIMITS.concurrency, 'maxConcurrency'), maxWaitMs: integer(l.maxWaitMs, 3600000, 0, LIMITS.waitMs, 'maxWaitMs'), maxRunMs: integer(l.maxRunMs, 3600000, 10, LIMITS.runMs, 'maxRunMs') };
  let count = 0;
  function nodes(values, depth = 0) {
    if (!Array.isArray(values) || !values.length || depth > LIMITS.depth) fail('Flow needs nonempty nodes and at most 8 nesting levels');
    const ids = new Set();
    return values.map(n => {
      object(n, 'node'); if (++count > LIMITS.nodes) fail('Flow has more than 100 declared nodes');
      id(n.id); if (ids.has(n.id)) fail('Duplicate node id'); ids.add(n.id);
      const allowed = { tool: ['tool', 'arguments'], model: ['prompt', 'model', 'max_tokens'], wait: ['ms'], loop: ['iterations', 'until', 'nodes'], parallel: ['branches', 'concurrency'] }[n.type];
      if (!allowed || Object.keys(n).some(k => !['id', 'type', ...allowed].includes(k))) fail('Invalid node type or fields');
      const out = { ...n };
      if (n.type === 'tool') { if (!/^[a-z][a-z0-9_]{1,80}$/.test(n.tool || '') || /^(automation_flow_|continuation_flow$|tool_execute$|code$|script_run$)/.test(n.tool)) fail('Flow tool must be a concrete non-orchestrator tool; use explicit leaf nodes'); object(n.arguments || {}, 'tool arguments'); out.arguments ||= {}; }
      if (n.type === 'model') { if (typeof n.prompt !== 'string' || !n.prompt.trim() || n.prompt.length > 32000) fail('Model node needs an explicit prompt (max 32000 characters)'); if (n.model !== undefined && (typeof n.model !== 'string' || n.model.length > 200)) fail('Invalid model'); out.max_tokens = integer(n.max_tokens, 1200, 1, 8192, 'max_tokens'); }
      if (n.type === 'wait') { if (typeof n.ms === 'object' && n.ms !== null) { if (Array.isArray(n.ms) || Object.keys(n.ms).length !== 1 || typeof n.ms.$ref !== 'string') fail('wait ms must be an integer or a single typed $ref'); } else out.ms = integer(n.ms, undefined, 0, limits.maxWaitMs, 'wait ms'); }
      if (n.type === 'loop') { out.iterations = integer(n.iterations, undefined, 1, limits.maxIterations, 'loop iterations'); out.nodes = nodes(n.nodes, depth + 1); if (n.until !== undefined) { object(n.until, 'until'); if (Object.keys(n.until).some(k => !['ref', 'equals'].includes(k)) || typeof n.until.ref !== 'string' || !Object.hasOwn(n.until, 'equals')) fail('until needs ref and equals'); } }
      if (n.type === 'parallel') { out.concurrency = integer(n.concurrency, limits.maxConcurrency, 1, limits.maxConcurrency, 'parallel concurrency'); if (!Array.isArray(n.branches) || !n.branches.length || n.branches.length > 32) fail('parallel needs 1..32 branches'); const branches = new Set(); out.branches = n.branches.map(b => { object(b, 'branch'); id(b.id); if (branches.has(b.id) || Object.keys(b).some(k => !['id', 'nodes'].includes(k))) fail('Invalid or duplicate branch'); branches.add(b.id); return { id: b.id, nodes: nodes(b.nodes, depth + 1) }; }); }
      return out;
    });
  }
  return cleanInput({ title: definition.title.trim(), nodes: nodes(definition.nodes), limits });
}
function save({ id: name, definition, expected_revision } = {}) {
  id(name); const normalized = normalize(definition), s = store(), nameKey = 'definition-' + name;
  return s.update(nameKey, old => {
    if (expected_revision === undefined || (old?.revision || null) !== expected_revision) fail('Read the flow before saving; expected_revision=null creates a new flow', 'STATE_CONFLICT', 409);
    if (!old && s.list('definition-').length >= LIMITS.definitions) fail('Flow definition budget reached');
    const value = { protocol: 'dt.automation-flow/v1', id: name, revision: D.hash(JSON.stringify(normalized)), definition: normalized, owner: A.owner(), updatedAt: new Date().toISOString() };
    s.write(nameKey, value); return value;
  });
}
function get({ id: name } = {}) { const r = store().read('definition-' + id(name)); if (!r) fail('Flow not found', 'DT_NOT_FOUND', 404); A.assertOwner(r.owner); return r; }
function list() { return { definitions: store().list('definition-').map(({ definition, ...r }) => ({ ...r, title: definition.title })), runs: store().list('run-').sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50).map(summary), limits: LIMITS }; }
function hydrate(r) { bind(r, lifecycle); for (const cp of Object.values(r.checkpoints || {})) bind(cp, checkpointLifecycle); return r; }
function runRecord(runId) { D.key(runId); const r = store().read('run-' + runId); if (!r) fail('Flow run not found', 'DT_NOT_FOUND', 404); A.assertOwner(r.owner); if (r.protocol !== 'dt.automation-flow-run/v1' || D.hash(JSON.stringify(normalize(r.definition))) !== r.revision) fail('Flow run definition failed integrity validation', 'DT_FLOW_DAMAGED', 409); return hydrate(r); }
function isLive(r) { if (live.has(r.id)) return true; if (['running', 'waiting'].includes(r.state) && r.processId && r.processId !== process.pid) { try { process.kill(r.processId, 0); return true; } catch {} } return false; }
function summary(r) {
  const active = isLive(r), checkpoints = Object.values(r.checkpoints || {}), unresolved = checkpoints.filter(c => ['uncertain', 'failed', 'running'].includes(c.state) && ['tool', 'model'].includes(c.type));
  return { protocol: r.protocol, id: r.id, flow: r.flow, revision: r.revision, title: r.definition.title, state: !active && ['running', 'waiting'].includes(r.state) ? 'interrupted' : r.state, executionId: r.executionId, owner: r.owner, startedAt: r.startedAt, updatedAt: r.updatedAt, canResume: !active && r.state !== 'done', canCancel: active, counts: { completed: checkpoints.filter(c => c.state === 'done').length, checkpoints: checkpoints.length, unresolved: unresolved.length }, unresolved: unresolved.slice(0, 30).map(({ result, ...c }) => c), ...(r.error ? { error: r.error } : {}), ...(r.state === 'done' ? { output: r.output } : {}), guidance: 'Resume explicitly. Completed leaves are retained. Interrupted or failed tool/model calls need automation_flow_resolve before resume; resolve never executes a call.' };
}
function status({ run, detail = false } = {}) { const r = runRecord(run); return detail ? { ...summary(r), checkpoints: r.checkpoints, input: r.input, definition: r.definition } : summary(r); }
function valueAt(scope, ref) { if (typeof ref !== 'string' || ref.length > 500 || ref.split('.').some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) fail('Invalid flow reference'); let value = scope; for (const k of ref.split('.')) { if (value === null || typeof value !== 'object' || !Object.hasOwn(value, k)) fail('Unresolved flow reference: ' + ref); value = value[k]; } return value; }
function fill(value, scope) {
  if (Array.isArray(value)) return value.map(v => fill(v, scope));
  if (value && typeof value === 'object') { if (Object.keys(value).length === 1 && Object.hasOwn(value, '$ref')) return clone(valueAt(scope, value.$ref)); return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, scope)])); }
  if (typeof value === 'string') return value.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, ref) => { const v = valueAt(scope, ref); return typeof v === 'string' ? v : JSON.stringify(v); });
  return value;
}
function delay(ms) {
  E.check(); const signal = E.signal();
  return new Promise((resolve, reject) => { const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(E.abortError(signal?.reason)); }; const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms); signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop(); });
}
function persist(s, r) { r.updatedAt = new Date().toISOString(); s.write('run-' + r.id, r); }
function result(value) { const clean = require('./redact').clean(value === undefined ? null : value); if (Buffer.byteLength(JSON.stringify(clean)) > LIMITS.resultBytes) fail('Leaf result exceeds 64 KiB; use a compact tool response or save evidence in task context', 'DT_FLOW_RESULT_LIMIT'); return clean; }
async function execute(r, s, allowModel) {
  const limit = r.definition.limits, deadline = Date.parse(r.startedAt) + limit.maxRunMs;
  let active = 0; const waiting = [];
  async function permit() {
    E.check();
    if (active >= limit.maxConcurrency) { const signal = E.signal(); await new Promise((resolve, reject) => { const item = { resolve: () => { signal?.removeEventListener('abort', abort); resolve(); } }; const abort = () => { const i = waiting.indexOf(item); if (i >= 0) waiting.splice(i, 1); reject(E.abortError(signal.reason)); }; waiting.push(item); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); }); }
    else active++;
    let released = false; return () => { if (released) return; released = true; const next = waiting.shift(); if (next) next.resolve(); else active--; };
  }
  function check() { E.check(); if (Date.now() >= deadline) fail('Flow run time budget exceeded', 'DT_FLOW_LIMIT'); }
  async function sequence(nodes, prefix, scope) { const results = { ...(scope.results || {}) }, output = {}; for (let i = 0; i < nodes.length; i++) { check(); const node = nodes[i]; output[node.id] = results[node.id] = await visit(node, prefix + '/' + node.id, { ...scope, results }); } return output; }
  async function visit(node, location, scope) {
    check(); let cp = r.checkpoints[location];
    if (cp?.state === 'done') return cp.result;
    if (cp && ['running', 'uncertain', 'failed'].includes(cp.state) && ['tool', 'model'].includes(node.type)) fail('Resolve uncertain/failed leaf ' + location + ' before resuming', 'DT_FLOW_UNCERTAIN', 409);
    if (!cp) { if (Object.keys(r.checkpoints).length >= limit.maxSteps) fail('Flow step budget exceeded', 'DT_FLOW_LIMIT'); cp = r.checkpoints[location] = bind({ path: location, type: node.type, state: 'pending' }, checkpointLifecycle); }
    if (node.type === 'wait') {
      const ms = integer(fill(node.ms, scope), undefined, 0, limit.maxWaitMs, 'wait ms');
      cp.dueAt ||= new Date(Date.now() + ms).toISOString(); cp.state = 'waiting'; persist(s, r);
      await delay(Math.max(0, Math.min(Date.parse(cp.dueAt) - Date.now(), deadline - Date.now()))); check();
      cp.state = 'done'; cp.result = { dueAt: cp.dueAt, waited: true }; persist(s, r); return cp.result;
    }
    if (node.type === 'loop') {
      let latest = {}, iterations = 0;
      for (let i = 0; i < node.iterations; i++) { latest = await sequence(node.nodes, location + '/' + i, { ...scope, iteration: i, results: { ...scope.results, ...latest } }); iterations++; if (node.until && JSON.stringify(valueAt({ ...scope, iteration: i, results: { ...scope.results, ...latest } }, node.until.ref)) === JSON.stringify(node.until.equals)) break; }
      cp.state = 'done'; cp.result = result({ iterations, results: latest }); persist(s, r); return cp.result;
    }
    if (node.type === 'parallel') {
      const outputs = {}, children = new Set(); let cursor = 0, failure;
      async function worker() { while (!failure && cursor < node.branches.length) { const branch = node.branches[cursor++]; const child = E.start({ kind: 'flow-branch', title: branch.id }, () => sequence(branch.nodes, location + '/' + branch.id, scope)); children.add(child); try { outputs[branch.id] = await child.promise; } catch (e) { failure ||= e; for (const other of children) if (other !== child) E.cancel(other.id, 'parallel sibling failed'); } finally { children.delete(child); } } }
      await Promise.allSettled(Array.from({ length: Math.min(node.concurrency, node.branches.length) }, worker)); if (failure) throw failure;
      cp.state = 'done'; cp.result = result(outputs); persist(s, r); return cp.result;
    }
    if (node.type === 'model' && !allowModel) fail('Model nodes require allow_model=true on this start/resume', 'DT_FLOW_MODEL_PERMISSION', 403);
    const release = await permit();
    try {
      check(); cp.state = 'running'; cp.startedAt = new Date().toISOString(); cp.attempt = (cp.attempt || 0) + 1; persist(s, r);
      const name = node.type === 'model' ? 'automation_flow_model' : node.tool;
      const args = node.type === 'model' ? { prompt: fill(node.prompt, scope), ...(node.model ? { model: node.model } : {}), max_tokens: node.max_tokens } : fill(node.arguments, scope);
      const output = await require('./tools').call(name, args, { source: 'automation-flow' });
      cp.result = result(output);
      if (require('./call-outcome').classify(name, output).failed) fail('Tool returned an application failure; inspect retained result', 'DT_FLOW_APPLICATION_FAILURE');
      check(); cp.state = 'done'; cp.completedAt = new Date().toISOString(); persist(s, r); return cp.result;
    } catch (error) {
      // A transport error/cancellation cannot establish whether an external effect happened.
      if (cp.state !== 'done') cp.state = 'uncertain'; cp.error = require('./redact').clean({ code: error.code || 'ERROR', message: error.message }); persist(s, r); throw error;
    } finally { release(); }
  }
  return sequence(r.definition.nodes, '', { input: r.input, results: {} });
}
function launch(r, s, release, allowModel) {
  r.state = 'running'; r.processId = process.pid; delete r.error;
  const remaining = Math.max(0, Date.parse(r.startedAt) + r.definition.limits.maxRunMs - Date.now());
  const execution = E.start({ kind: 'automation-flow', title: r.definition.title, source: 'automation-flow', detached: true, signal: AbortSignal.timeout(remaining) }, async () => {
    try { E.check(); r.output = result(await execute(r, s, allowModel)); r.state = 'done'; }
    catch (error) { r.state = error.code === 'DT_CANCELLED' ? 'cancelled' : error.code === 'DT_FLOW_UNCERTAIN' ? 'blocked' : 'failed'; r.error = require('./redact').clean({ code: error.code || 'ERROR', message: error.message }); }
    finally { persist(s, r); }
  });
  r.executionId = execution.id;
  live.set(r.id, execution);
  execution.promise.catch(() => {}).finally(() => { live.delete(r.id); release(); });
  try { persist(s, r); } catch (error) { E.cancel(execution.id, 'Could not persist workflow admission'); throw error; }
  return execution;
}
async function start({ id: name, expected_revision, input = {}, allow_model = false, await_completion = false } = {}) {
  object(input, 'input');
  const def = get({ id: name }); if (expected_revision !== def.revision) fail('Start requires the exact reviewed definition revision', 'STATE_CONFLICT', 409);
  const s = store(); if (s.list('run-').length >= LIMITS.runs) fail('Flow run retention budget reached');
  const r = hydrate({ protocol: 'dt.automation-flow-run/v1', id: crypto.randomUUID(), flow: def.id, revision: def.revision, definition: def.definition, owner: A.owner(), startedAt: new Date().toISOString(), input: cleanInput(input), checkpoints: {}, state: 'pending' });
  const release = s.lock('run-' + r.id), execution = launch(r, s, release, allow_model === true);
  if (await_completion) await execution.promise.catch(() => {}); return summary(r);
}
async function resume({ run, allow_model = false, await_completion = false } = {}) {
  const s = store(), release = s.lock('run-' + D.key(run)); let r;
  try { r = runRecord(run); if (isLive(r)) fail('Flow is still running', 'STATE_CONFLICT', 409); if (r.state === 'done') { release(); return summary(r); }
    const unresolved = Object.values(r.checkpoints).filter(c => ['running', 'uncertain', 'failed'].includes(c.state) && ['tool', 'model'].includes(c.type));
    if (unresolved.length) { for (const cp of unresolved) if (cp.state === 'running') cp.state = 'uncertain'; r.state = 'blocked'; persist(s, r); fail('Resolve uncertain/failed leaves before resume', 'DT_FLOW_UNCERTAIN', 409); }
    const execution = launch(r, s, release, allow_model === true); if (await_completion) await execution.promise.catch(() => {}); return summary(r);
  } catch (error) { release(); throw error; }
}
function resolve({ run, path: location, action, result: supplied, acknowledge_uncertain = false, reason } = {}) {
  if (!['complete', 'retry', 'skip'].includes(action) || typeof reason !== 'string' || !reason.trim() || reason.length > 2000) fail('Resolve needs complete/retry/skip and an audit reason');
  const s = store(); return s.update('run-' + D.key(run), () => {
    const r = runRecord(run); if (isLive(r)) fail('Stop the active run before resolving a leaf', 'STATE_CONFLICT', 409);
    const cp = r.checkpoints[location]; if (!cp || !['running', 'uncertain', 'failed'].includes(cp.state) || !['tool', 'model'].includes(cp.type)) fail('Choose an unresolved tool/model checkpoint');
    if (!acknowledge_uncertain) fail('Resolution requires acknowledge_uncertain=true; verify the external effect before choosing retry', 'DT_FLOW_UNCERTAIN', 409);
    cp.resolutions ||= []; cp.resolutions.push({ at: new Date().toISOString(), action, reason: require('./redact').clean(reason), by: { principalId: A.current().principalId, storyId: A.current().storyId } });
    if (action === 'retry') { cp.state = 'pending'; delete cp.result; } else { cp.state = 'done'; cp.result = action === 'skip' ? { skipped: true } : result(supplied); }
    delete cp.error; r.state = 'paused'; persist(s, r); return summary(r);
  });
}
function cancel({ run, reason = 'cancelled' } = {}) { const r = runRecord(run), execution = live.get(r.id); if (!execution) { if (isLive(r)) fail('Cancel this run on the server process that owns it', 'DT_FLOW_REMOTE_OWNER', 409); return summary(r); } E.cancel(execution.id, reason); return { ...summary(r), cancellationRequested: true }; }
async function model({ prompt, model: selected, max_tokens = 1200 } = {}) {
  A.checkTool('automation_flow_model'); if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) fail('Model call needs an explicit prompt of at most 32000 characters');
  const cfg = C.getPersonal().llm; if (!cfg.baseUrl || !cfg.model) fail('Configure llm.baseUrl and llm.model before invoking a model', 'DT_MODEL_UNCONFIGURED', 503);
  const base = new URL(cfg.baseUrl); if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) fail('Configured model base must be HTTP(S) without inline credentials or query');
  const name = selected || cfg.model, allowed = [cfg.model, ...(Array.isArray(cfg.gatewayModels) ? cfg.gatewayModels : [])]; if (!allowed.includes(name)) fail('Model is not in the configured allowlist', 'DT_ACCESS_DENIED', 403);
  const response = await require('./util').http(base.href.replace(/\/$/, '') + '/chat/completions', { observe: { purpose: 'chat.task' }, method: 'POST', timeout: 60000, headers: cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}, body: { model: name, temperature: 0, max_tokens: integer(max_tokens, 1200, 1, 8192, 'max_tokens'), messages: [{ role: 'user', content: require('./redact').clean(prompt) }] } });
  const message = response.choices?.[0]?.message; if (response.error || typeof message?.content !== 'string') fail('Model provider returned no text completion', 'DT_MODEL_RESPONSE');
  return result({ model: name, content: message.content, usage: response.usage || {}, executedTools: false });
}
async function close() { const runs = [...live.values()]; for (const r of runs) A.run(r.owner, () => E.cancel(r.id, 'server shutdown')); await Promise.allSettled(runs.map(r => r.promise)); }
module.exports = { LIMITS, normalize, save, get, list, start, status, resume, resolve, cancel, model, close, fill, lifecycle, checkpointLifecycle };
