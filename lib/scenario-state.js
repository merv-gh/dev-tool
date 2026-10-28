// Arrange every declared read, emulate actions through local RPC, then check independently bound effects.
// A complete contract is not proof that arbitrary application code has no other runtime dependencies.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const { CACHE, readJson, writeJson, pool } = require('./util');
const supported = new Set(['pg', 'kafka', 'http', 'es', 'config', 'cache', 'queue', 'file', 'mock']);
const canonical = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
const hash = v => crypto.createHash('sha256').update(canonical(v)).digest('hex');
const clone = v => JSON.parse(canonical(v));
const inventoryHash = inv => hash({ ...inv, builtAt: undefined });
const problem = (kind, stateId, detail) => ({ kind, ...(stateId ? { stateId } : {}), detail });
const unresolved = dep => ['ambiguous', 'unresolved', 'missing', 'dynamic', 'unknown'].includes(typeof dep.resolution === 'string' ? dep.resolution : dep.resolution?.status);
const targetOf = (dep, binding) => unresolved(dep) ? { ...dep.target, ...Object.fromEntries(Object.entries(binding.resolve || {}).filter(([key]) => key !== 'evidence')) } : dep.target;

function planState(inventory, bindings = {}) {
  if (!inventory || inventory.version !== 1 || !Array.isArray(inventory.states)) throw new Error('scenario inventory required');
  const known = new Set(inventory.states.map(s => s.id));
  for (const id of Object.keys(bindings)) if (!known.has(id)) throw new Error(`unknown state binding ${id}`);
  const gaps = [], resolved = new Set();
  const states = inventory.states.map(dep => {
    const binding = bindings[dep.id];
    if (!binding) { if (dep.required !== false) gaps.push(problem('unbound-state', dep.id, `Bind ${dep.kind} ${canonical(dep.target)}`)); return { ...dep, binding: null }; }
    const mode = binding.mode || (binding.capture ? 'fixture' : Object.hasOwn(binding, 'value') ? 'provided' : 'capture');
    const needsResolution = unresolved(dep);
    const hasResolution = binding.resolve && typeof binding.resolve.evidence === 'string' && binding.resolve.evidence.trim();
    const candidates = dep.resolution?.candidates || [];
    const validResolution = hasResolution && (!candidates.length || candidates.some(c => Object.entries(c).every(([key, value]) => isDeepStrictEqual(binding.resolve[key], value))));
    if (dep.kind === 'unknown' || !supported.has(dep.kind)) gaps.push(problem('unsupported-state', dep.id, 'Model this dependency as a concrete supported read before emulating it'));
    else if (needsResolution && !validResolution) gaps.push(problem('unresolved-state', dep.id, 'An explicit candidate target resolution with evidence is required'));
    else if (needsResolution && validResolution) resolved.add(dep.id);
    if (!needsResolution && binding.resolve && Object.entries(binding.resolve).some(([key, value]) => key !== 'evidence' && !isDeepStrictEqual(dep.target[key], value))) gaps.push(problem('resolved-target-override', dep.id, 'A known dependency cannot be replaced by another target'));
    if (!['provided', 'capture', 'fixture'].includes(mode)) gaps.push(problem('state-mode', dep.id, `Unsupported state mode ${mode}`));
    if (mode === 'provided' && !Object.hasOwn(binding, 'value')) gaps.push(problem('missing-value', dep.id, 'Provided state must include value (null and empty collections are explicit values)'));
    return { ...dep, binding: { ...binding, mode } };
  });
  for (const gap of inventory.gaps || []) {
    const id = gap.stateId || gap.state;
    if (!id || !resolved.has(id)) gaps.push(gap);
  }
  return { version: 1, service: inventory.service, env: inventory.env, inventoryHash: inventoryHash(inventory), inventory, states, gaps, complete: !gaps.length,
    coverage: { required: inventory.states.filter(s => s.required !== false).length, bound: states.filter(s => s.binding).length, runtimeVerified: false } };
}

function bounded(v, def, max) { const n = v ?? def; if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`limit must be 1..${max}`); return n; }
const adapters = {
  pg: async (dep, binding, plan) => {
    const q = binding.query || {}, db = targetOf(dep, binding).db;
    if (!db || !q.sql) throw new Error('Postgres capture needs an exact database and query.sql with bound params');
    if (q.db && q.db !== db) throw new Error('query database differs from the resolved dependency');
    const max = bounded(q.maxRows, 200, 10000);
    await require('./limit').take(`pg:${plan.env}`);
    const r = await require('./pg').query(plan.env, `select * from (${q.sql.replace(/;\s*$/, '')}) as dt_state_rows limit ${max + 1}`, { db, params: q.params || [] });
    return { value: r.rows.slice(0, max), complete: r.rows.length <= max, truncated: r.rows.length > max };
  },
  kafka: async (dep, binding, plan) => {
    const q = binding.query || {};
    const r = await require('./kafka').captureMessages(plan.env, targetOf(dep, binding).topic, { maxMessages: bounded(q.maxMessages, 300, 10000), offsets: q.offsets || {} });
    return { value: r.messages, complete: !r.truncated, truncated: r.truncated, windows: r.windows };
  },
  es: async (dep, binding, plan) => {
    const q = binding.query || {}, size = bounded(q.maxRows, 200, 1000);
    if (!q.query) throw new Error('Elasticsearch capture needs an explicit query');
    await require('./limit').take(`es:${plan.env}`);
    const r = await require('./es').search(plan.env, targetOf(dep, binding).index, typeof q.query === 'string' ? q.query : JSON.stringify({ ...q.query, size }), { size });
    return { value: r.hits.slice(0, size), complete: r.total <= size, truncated: r.total > size };
  },
  http: async (dep, binding, plan) => {
    const q = binding.query || {}, method = String(q.method || dep.target.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) throw new Error('Live HTTP state capture supports GET/HEAD; provide response fixtures for other methods');
    const url = new URL(q.url), allow = require('./config').getScripts().http.allow || [];
    const allowed = u => allow.some(prefix => { const p = String(prefix).replace(/\/$/, ''); return u === p || u.startsWith(p + '/') || u.startsWith(p + '?'); });
    if (!allowed(url.href) || url.username || url.password) throw new Error('HTTP state URL must be in scripts.http.allow and contain no credentials');
    await require('./limit').take(`http:${url.host}:${plan.env}`);
    const r = await fetch(url, { method, headers: q.headers || {}, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (r.status >= 300 && r.status < 400) throw new Error('HTTP state redirects must be captured explicitly as another allowed URL');
    let size = 0, chunks = [];
    for await (const chunk of r.body || []) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('HTTP state exceeds 2 MiB'); chunks.push(chunk); }
    let body = Buffer.concat(chunks).toString('utf8'); try { body = JSON.parse(body); } catch {}
    return { value: { status: r.status, headers: Object.fromEntries(r.headers), body }, complete: true };
  },
};

function fixtureState(dep, binding) {
  const capture = require('./reproduction').load(binding.capture);
  const resolved = targetOf(dep, binding);
  let value;
  if (dep.kind === 'pg') {
    const target = binding.table || `${resolved.db}:${resolved.table}`;
    if (target !== `${resolved.db}:${resolved.table}`) throw new Error('fixture table differs from the declared read dependency');
    if (!Object.hasOwn(capture.rows, target)) throw new Error(`capture does not contain ${target}`);
    value = capture.rows[target];
  } else if (dep.kind === 'kafka') {
    const target = binding.topic || resolved.topic;
    if (target !== resolved.topic) throw new Error('fixture topic differs from the declared read dependency');
    if (!Object.hasOwn(capture.events, target)) throw new Error(`capture does not contain ${target}`);
    value = capture.events[target].messages;
  } else if (dep.kind === 'es') {
    const target = binding.index || resolved.index;
    if (target !== resolved.index) throw new Error('fixture index differs from the declared read dependency');
    if (!Object.hasOwn(capture.indexes || {}, target)) throw new Error(`capture does not contain ES ${target}`);
    value = capture.indexes[target].documents;
  } else throw new Error('Fixture captures contain PostgreSQL, Elasticsearch and Kafka; provide other dependencies separately');
  return { value, complete: capture.complete === true, gaps: capture.gaps, fixture: binding.capture };
}

async function captureState(plan, { adapters: supplied = {}, mask = true } = {}) {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.states)) throw new Error('scenario state plan required');
  if (!plan.inventory || inventoryHash(plan.inventory) !== plan.inventoryHash) throw new Error('state plan inventory fingerprint changed');
  const seen = new Set();
  for (const dep of plan.states) {
    const original = plan.inventory.states.find(d => d.id === dep.id), { binding, ...metadata } = dep;
    if (!original || seen.has(dep.id) || !isDeepStrictEqual(metadata, original)) throw new Error('state plan dependency differs from its inventory');
    seen.add(dep.id);
  }
  // Recompute obligations rather than trusting caller-supplied complete/gaps flags or a shortened list.
  plan = planState(plan.inventory, Object.fromEntries(plan.states.filter(d => d.binding).map(d => [d.id, d.binding])));
  const gaps = [...plan.gaps], states = {}, trace = [];
  const results = await pool(plan.states, 4, async dep => {
    const binding = dep.binding, start = Date.now();
    if (!binding) return { id: dep.id, status: 'missing' };
    try {
      let r;
      if (binding.mode === 'provided') r = { value: binding.value, complete: Object.hasOwn(binding, 'value') };
      else if (binding.mode === 'fixture') r = fixtureState(dep, binding);
      else {
        const adapter = supplied[dep.kind] || adapters[dep.kind];
        if (!adapter) throw new Error(`No ${dep.kind} live reader; bind explicit provided state`);
        r = await adapter(dep, binding, plan);
      }
      if (!r || !Object.hasOwn(r, 'value')) throw new Error('State adapter did not provide value');
      const complete = r.complete === true && !r.truncated && !(r.gaps || []).length;
      trace.push({ stateId: dep.id, mode: binding.mode, ms: Date.now() - start });
      return { id: dep.id, kind: dep.kind, target: dep.target, required: dep.required !== false, value: clone(r.value), status: complete ? 'captured' : 'partial', complete,
        source: { mode: binding.mode, ...(binding.resolve ? { resolve: binding.resolve } : {}), ...(r.fixture ? { capture: r.fixture } : {}), ...(r.windows ? { windows: r.windows } : {}) }, gaps: r.gaps || [] };
    } catch (e) { return { id: dep.id, kind: dep.kind, target: dep.target, status: 'failed', complete: false, error: String(e.message).slice(0, 500) }; }
  });
  for (const result of results) {
    const state = result.value;
    if (!state) { gaps.push(problem('state-error', result.item.id, result.error?.message || 'State capture failed')); continue; }
    states[state.id] = state;
    if (result.item.required !== false && state.status !== 'captured') gaps.push(problem('state-incomplete', state.id, state.error || `State is ${state.status}`));
  }
  if (mask) {
    const rows = {};
    for (const state of Object.values(states)) if (Object.hasOwn(state, 'value')) {
      const dep = plan.states.find(d => d.id === state.id), key = dep?.kind === 'config' ? dep.target.key : null;
      rows[state.id] = [{ value: state.value, ...(key ? { [key]: state.value } : {}) }];
    }
    const masked = { rows, events: {}, plan: { seeds: [], tables: [] }, provenance: {}, gaps };
    require('./reproduction').redact(masked);
    for (const [id, values] of Object.entries(masked.rows)) states[id].value = values[0].value;
    gaps.splice(0, gaps.length, ...masked.gaps);
  }
  return { version: 1, service: plan.service, env: plan.env, inventoryHash: plan.inventoryHash, inventory: plan.inventory, states, gaps, complete: !gaps.length,
    capturedAt: new Date().toISOString(), trace, coverage: { required: plan.states.filter(s => s.required !== false).length, captured: Object.values(states).filter(s => s.status === 'captured').length, runtimeVerified: false } };
}

function getState(state, id, { where, key, request } = {}) {
  const item = state.states[id];
  if (!item || item.status !== 'captured' || !Object.hasOwn(item, 'value')) throw new Error(`state ${id} is not captured`);
  let value = item.value;
  const subset = (expected, actual) => expected && typeof expected === 'object' ? actual && typeof actual === 'object' && Object.entries(expected).every(([k, v]) => subset(v, actual[k])) : expected === actual;
  if (key !== undefined) { if (!value || !Object.hasOwn(value, key)) throw new Error(`state ${id} has no key ${key}`); value = value[key]; }
  if (where) { if (!Array.isArray(value)) throw new Error('where requires array state'); value = value.filter(row => subset(where, row)); }
  if (request) {
    if (!Array.isArray(value?.exchanges)) throw new Error('request matching requires explicit exchanges [{request,response}]');
    const matches = value.exchanges.filter(e => subset(e.request, request));
    if (matches.length !== 1) throw new Error(`request for ${id} matched ${matches.length} exchanges`);
    value = matches[0].response;
  }
  return clone(value);
}

async function emulate({ inventory, state, actions, expectations, code, timeoutMs = 30000, requireAllReads = true } = {}) {
  const S = require('./scenario'), gaps = contractGaps(inventory, state, actions, expectations), reads = [], performed = [], observed = {}, violations = [];
  const fail = detail => { violations.push(detail); throw new Error(detail); };
  const actionList = actions?.actions || [], expectationList = expectations?.expectations || [];
  if (gaps.length) return { ok: false, gaps, checks: { ok: false, passed: 0, failed: gaps.length, results: [] }, reads, actions: performed, observed, coverage: { runtimeVerified: false, proof: 'contract-emulation' } };
  let active = null, calls = 0, result;
  try {
    result = await require('./offline-js').run(code, { vars: { service: inventory.service, actions: actionList.map(a => ({ id: a.id, kind: a.kind, target: a.target, dependencies: a.dependencies, expectations: a.expectations })) } }, {
      timeoutMs,
      onTool: async (name, args = {}) => {
        if (++calls > 2000) return fail('scenario exceeds 2000 local operations');
        if (name === 'action_input') {
          const action = actionList.find(a => a.id === args.id);
          if (!action) return fail(`unknown scenario action ${args.id}`);
          if (!action.bound || !Object.hasOwn(action, 'binding')) return fail(`action ${args.id} has no input binding`);
          active = action.id; performed.push({ id: action.id });
          return clone(action.binding);
        }
        if (name === 'state_read') {
          const action = actionList.find(a => a.id === (args.action || active)), dep = inventory.states.find(d => d.id === args.id);
          if (!dep) return fail(`unknown scenario state ${args.id}`);
          if (!action || !action.dependencies.includes(dep.id)) return fail(`state ${args.id} is not declared for this action`);
          const value = getState(state, dep.id, args); reads.push({ id: dep.id, action: action.id, ...(args.key !== undefined ? { key: args.key } : {}) }); return value;
        }
        if (name === 'observe') {
          const e = expectationList.find(e => e.id === args.id);
          if (!e) return fail(`unknown scenario expectation ${args.id}`);
          if (e.action && !performed.some(a => a.id === e.action)) return fail('observe requires its action_input first');
          if (Object.hasOwn(observed, args.id)) return fail(`duplicate scenario observation ${args.id}; aggregate ordered/count effects explicitly`);
          observed[args.id] = clone(args.value); return { observed: args.id };
        }
        return fail(`only local scenario tools are available; refused ${name}`);
      },
    });
  } catch (e) { result = { error: e.message, tests: [], logs: [], output: [] }; }
  for (const action of actionList) {
    if (!performed.some(a => a.id === action.id)) gaps.push(problem('unperformed-action', null, action.id));
    if (requireAllReads) for (const id of action.dependencies || []) if (!reads.some(r => r.id === id && r.action === action.id)) gaps.push(problem('unread-state', id, `No read observed for action ${action.id}`));
  }
  const checks = S.check(expectations, observed);
  return { ok: !result.error && !violations.length && !gaps.length && checks.ok && (result.tests || []).every(t => t.ok), checks, gaps, violations, reads, actions: performed, observed,
    tests: result.tests || [], logs: result.logs || [], output: result.output || [], error: result.error, value: result.returned,
    coverage: { states: new Set(reads.map(r => r.id)).size, required: inventory.states.filter(s => s.required !== false).length, runtimeVerified: false, proof: 'contract-emulation', allReadsChecked: requireAllReads } };
}

function contractGaps(inventory, state, actions, expectations) {
  const gaps = [], S = require('./scenario');
  if (!inventory?.states || !state?.states || state.inventoryHash !== inventoryHash(inventory)) return [problem('inventory-mismatch', null, 'Captured state must match this exact passport inventory')];
  if (!state.complete || state.gaps?.length) gaps.push(problem('state-incomplete', null, 'Capture every required dependency first'));
  for (const dep of inventory.states) {
    const captured = state.states[dep.id];
    if (dep.required !== false && (captured?.status !== 'captured' || !Object.hasOwn(captured, 'value'))) gaps.push(problem('missing-state', dep.id, 'Required state is absent'));
    if (captured && (!isDeepStrictEqual(captured.target, dep.target) || captured.kind !== dep.kind)) gaps.push(problem('state-target-mismatch', dep.id, 'Captured state names another dependency'));
    if (!supported.has(dep.kind)) gaps.push(problem('unsupported-state', dep.id, 'Unknown read dependencies must be modeled before running'));
  }
  const readBindings = Object.fromEntries(inventory.states.filter(dep => Object.hasOwn(state.states[dep.id] || {}, 'value')).map(dep => [dep.id, { mode: 'provided', value: state.states[dep.id].value, ...(state.states[dep.id].source?.resolve ? { resolve: state.states[dep.id].source.resolve } : {}) }]));
  gaps.push(...planState(inventory, readBindings).gaps);
  const actionList = actions?.actions || [], expectationList = expectations?.expectations || [];
  const actionBindings = {}, expectationBindings = {};
  for (const action of actionList) {
    const original = inventory.actions.find(a => a.id === action.id);
    if (!original || ['kind', 'target', 'dependencies', 'expectations'].some(key => !isDeepStrictEqual(action[key], original[key]))) gaps.push(problem('action-mismatch', null, action.id));
    if (Object.hasOwn(actionBindings, action.id)) gaps.push(problem('duplicate-action', null, action.id));
    if (action.bound && Object.hasOwn(action, 'binding')) actionBindings[action.id] = action.binding;
  }
  for (const e of expectationList) {
    const original = inventory.expectations.find(x => x.id === e.id);
    if (!original || ['kind', 'target', 'action', 'required'].some(key => !isDeepStrictEqual(e[key], original[key]))) gaps.push(problem('expectation-mismatch', null, e.id));
    if (Object.hasOwn(expectationBindings, e.id)) gaps.push(problem('duplicate-expectation', null, e.id));
    if (e.bound && e.match) expectationBindings[e.id] = { match: e.match, select: e.select };
  }
  gaps.push(...S.actions(inventory, { bindings: actionBindings }).gaps, ...S.expectations(inventory, { bindings: expectationBindings }).gaps);
  return gaps;
}

const file = id => { if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('invalid scenario state id'); return path.join(CACHE, 'scenarios', `${id}.json`); };
function save(state) { const id = crypto.randomBytes(12).toString('hex'); writeJson(file(id), state); return id; }
function load(id) { const value = readJson(file(id)); if (!value) throw new Error('scenario state not found'); return value; }

function exportScenario(workspace, { inventory, state, actions, expectations }, { name = 'scenario', directory, overwrite = false } = {}) {
  const R = require('./reproduction'), dest = R.resourcePath(workspace, directory || `src/test/resources/dt-fixtures/${name}`);
  if (!/^[a-z0-9][\w.-]{0,79}$/i.test(name)) throw new Error('invalid scenario name');
  if (contractGaps(inventory, state, actions, expectations).length) throw new Error('Only complete, bound scenario contracts can be exported');
  if (fs.existsSync(dest.full) && !overwrite) throw new Error('scenario resources exist; overwrite=true to replace');
  const stage = `${dest.full}.tmp-${crypto.randomBytes(4).toString('hex')}`, files = {};
  try {
    fs.mkdirSync(stage, { recursive: true });
    for (const [filename, value] of Object.entries({ 'inventory.json': inventory, 'state.json': state, 'actions.json': actions, 'expectations.json': expectations })) {
      const text = JSON.stringify(value, null, 2) + '\n'; fs.writeFileSync(path.join(stage, filename), text); files[filename] = crypto.createHash('sha256').update(text).digest('hex');
    }
    const instructions = 'Scenario contract resources. Arrange every state.json dependency with a real test container or a mock. Apply each actions.json input to the service. Observe each effects/return value and check expectations.json. scenario_emulate checks a local model; run the real application tests with test_run for application proof.\n';
    fs.writeFileSync(path.join(stage, 'README.txt'), instructions);
    fs.writeFileSync(path.join(stage, 'scenario.json'), JSON.stringify({ version: 1, name, inventoryHash: inventoryHash(inventory), files, coverage: state.coverage }, null, 2) + '\n');
    if (fs.existsSync(dest.full)) fs.rmSync(dest.full, { recursive: true });
    fs.mkdirSync(path.dirname(dest.full), { recursive: true }); fs.renameSync(stage, dest.full);
    require('./workspace').touch(workspace, { dirty: true });
    return { workspace, path: dest.rel, files: [...Object.keys(files), 'scenario.json', 'README.txt'] };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

module.exports = { inventoryHash, planState, captureState, getState, emulate, exportScenario, contractGaps, save, load };
