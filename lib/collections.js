// Collection suites reuse saved script steps, hooks and the shared tool registry.
// Plans are offline; a run cannot begin until every selected reference/template/tool validates.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./scripts');
const { CACHE, readJson, writeJson } = require('./util');
const DIR = path.join(CACHE, 'collection-runs');
const active = new Map();
const evidenceSecrets = new WeakMap();
const E = require('./collection-evidence');
const clone = x => JSON.parse(JSON.stringify(x));
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const names = x => [].concat(x || []).map(String);
const MAX_CASES = 1000;
function exactScript(id) {
  if (!/^[a-z0-9][\w.-]*(\/[a-z0-9][\w.-]*)*$/i.test(id || '') || id.split('/').some(s => s.startsWith('.')) || !fs.existsSync(path.join(S.DIR, `${id}.json`))) throw new Error(`exact script reference ${id} not found`);
  return S.get(id);
}

function suiteSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('suite must be an object');
  if (value.version !== undefined && value.version !== 1) throw new Error('unsupported collection suite version; expected 1');
  for (const h of ['before', 'after', 'finally']) if (value[h] !== undefined && ![].concat(value[h]).every(x => typeof x === 'string')) throw new Error(`suite ${h} must be JavaScript`);
  if (value.order !== undefined && !Array.isArray(value.order)) throw new Error('suite order must be an array');
  if (value.datasets !== undefined && (!Array.isArray(value.datasets) || value.datasets.some(x => !x || typeof x !== 'object' || Array.isArray(x)))) throw new Error('datasets must be an array of parameter objects');
  if (value.matrix !== undefined && (!value.matrix || typeof value.matrix !== 'object' || Array.isArray(value.matrix) || Object.values(value.matrix).some(x => !Array.isArray(x)))) throw new Error('matrix must map parameter names to arrays');
  return value;
}
function save(collection, changes) {
  if (changes.suite !== undefined) suiteSettings(changes.suite);
  try { S.getCollection(collection); } catch { S.mkdir(collection); }
  const prior = S.getCollection(collection);
  return S.setCollection(collection, { ...changes, ...(changes.suite !== undefined ? { suite: { version: 1, ...(prior.suite || {}), ...changes.suite } } : {}) });
}
function inspect(collection) {
  const metadata = S.getCollection(collection);
  return { ...metadata, version: 1, suite: metadata.suite || {}, definitions: metadata.scripts.map(id => S.get(id)), next: 'collection_plan → collection_validate → collection_run → collection_check / collection_history / collection_report' };
}
function cross(matrix = {}) {
  let values = [{}];
  for (const [k, vs] of Object.entries(matrix)) {
    if (values.length * vs.length > MAX_CASES) throw new Error(`matrix exceeds ${MAX_CASES} cases`);
    values = values.flatMap(v => vs.map(x => ({ ...v, [k]: x })));
  }
  return values;
}
function plan(collection, { params = {}, tags = [], excludeTags = [], select = [], seed = '0', datasets, matrix } = {}) {
  seed = String(seed);
  const scopes = [], cases = [], skipped = [], definitions = {}, visiting = new Set();
  const wanted = new Set(names(select)), include = new Set(names(tags)), exclude = new Set(names(excludeTags));
  const add = (id, values, inheritedTags, scope, entry = {}) => {
    const def = exactScript(id); definitions[def.id] = def;
    const allTags = [...new Set([...inheritedTags, ...names(def.tags), ...names(entry.tags)])];
    const reason = (wanted.size && !wanted.has(def.id) && !wanted.has(def.id.split('/').pop())) ? 'selection' : include.size && !allTags.some(x => include.has(x)) ? 'tags' : allTags.some(x => exclude.has(x)) ? 'excluded-tag' : null;
    if (reason) { skipped.push({ script: def.id, scope, reason, tags: allTags }); return; }
    suiteSettings(entry);
    for (const [rowIndex, row] of (entry.datasets || datasets || [{}]).entries()) for (const combination of cross(entry.matrix || matrix || {})) {
      if (cases.length >= MAX_CASES) throw new Error(`suite exceeds ${MAX_CASES} cases`);
      const overrides = { ...(entry.params || {}), ...row, ...combination, seed };
      const given = { ...values, ...overrides };
      const ordinal = cases.length + 1;
      cases.push({ id: `${def.id}#${ordinal}`, script: def.id, scope, row: rowIndex, matrix: combination, tags: allTags, params: clone(given), overrides: clone(overrides), revision: digest(def) });
    }
  };
  const visit = (id, parent, inherited, inheritedTags) => {
    if (visiting.has(id)) throw new Error(`collection cycle: ${[...visiting, id].join(' → ')}`);
    if (visiting.size >= 20) throw new Error('collection nesting exceeds 20');
    visiting.add(id);
    const meta = S.getCollection(id), suite = suiteSettings(meta.suite || {});
    const scope = { id, parent, before: suite.before, after: suite.after, finally: suite.finally, params: { ...inherited, ...(suite.params || {}), ...params }, revision: digest(meta) };
    scopes.push(scope);
    const inheritedAll = [...inheritedTags, ...names(suite.tags)];
    const prefix = id + '/', direct = meta.scripts.filter(x => !x.slice(prefix.length).includes('/'));
    const children = S.list(id).collections.map(x => x.collection).filter(x => x !== id && !x.slice(prefix.length).includes('/'));
    const order = suite.order || [...direct.map(script => ({ script })), ...children.map(collection => ({ collection }))];
    for (const raw of order) {
      const entry = typeof raw === 'string' ? { script: raw } : raw;
      if (!entry || (!!entry.script === !!entry.collection)) throw new Error(`collection ${id}: order entry needs script or collection`);
      const target = entry.script || entry.collection;
      const full = target.startsWith(prefix) ? target : `${prefix}${target}`;
      // References remain within this subtree; suites cannot silently run a neighboring collection.
      if (!full.startsWith(prefix) || full.includes('/../')) throw new Error(`collection ${id}: reference escapes its subtree`);
      if (entry.collection) visit(full, id, { ...scope.params, ...(entry.params || {}) }, [...inheritedAll, ...names(entry.tags)]);
      else add(full, scope.params, inheritedAll, id, { ...(suite.datasets ? { datasets: suite.datasets } : {}), ...(suite.matrix ? { matrix: suite.matrix } : {}), ...entry });
    }
    visiting.delete(id);
  };
  visit(collection, null, params, []);
  const selectedScopes = new Set(cases.map(x => x.scope));
  for (let changed = true; changed;) { changed = false; for (const s of scopes) if (selectedScopes.has(s.id) && s.parent && !selectedScopes.has(s.parent)) { selectedScopes.add(s.parent); changed = true; } }
  const selected = scopes.filter(s => selectedScopes.has(s.id));
  return { version: 1, collection, seed: String(seed), cases, skipped, scopes: selected, definitions, hash: digest({ cases, scopes: selected, definitions }), counts: { cases: cases.length, scripts: new Set(cases.map(c => c.script)).size, scopes: selected.length, skipped: skipped.length }, next: 'collection_validate before collection_run' };
}

function templateErrors(value, known, location, errors) {
  if (Array.isArray(value)) return value.forEach((v, i) => templateErrors(v, known, `${location}[${i}]`, errors));
  if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => templateErrors(v, known, `${location}.${k}`, errors));
  if (typeof value !== 'string') return;
  for (const m of value.matchAll(/\{\{([^}]+)\}\}/g)) {
    const expr = m[1].trim(), root = expr.split('.')[0];
    if (/^(uuid|now|timestamp|date(?::.*)?|rand:\d+|hex:\d+|link:.*)$/.test(expr)) continue;
    if (!known.has(root)) errors.push({ location, kind: 'template', expression: expr, error: `variable ${root} is not declared before use; declare hook-produced vars explicitly` });
  }
}
async function validate(collectionOrPlan, options = {}, { schemas } = {}) {
  const p = typeof collectionOrPlan === 'string' ? plan(collectionOrPlan, options) : collectionOrPlan;
  const errors = [], warnings = [], capabilities = new Set(), references = new Map();
  const toolSchemas = schemas || await require('./tools').schemas();
  const available = new Set(toolSchemas.map(t => t.name));
  const byName = new Map(toolSchemas.map(t => [t.name, t]));
  p.collectionChains = {};
  const visit = (def, given, stack = []) => {
    if (stack.includes(def.id)) { errors.push({ kind: 'cycle', script: def.id, error: `script cycle: ${[...stack, def.id].join(' → ')}` }); return; }
    if (stack.length >= 5) { errors.push({ kind: 'depth', script: def.id, error: 'script nesting exceeds 5' }); return; }
    references.set(def.id, digest(def));
    p.definitions[def.id] = clone(def);
    try {
      S.validate(def);
      if (!stack.length) S.params(def, given);
      else for (const [key, spec] of Object.entries(def.params || {})) if (spec?.required && spec.default === undefined && !(key in given)) throw new Error(`script ${def.id}: missing param ${key}`);
    } catch (e) { errors.push({ script: def.id, error: e.message }); }
    p.collectionChains[def.id] = S.chain(def.id);
    const inherited = Object.assign({}, ...p.collectionChains[def.id].map(c => c.vars || {}));
    const known = new Set([...Object.keys(inherited), ...Object.keys(def.vars || {}), ...Object.keys(def.params || {}), ...Object.keys(given)]);
    templateErrors(inherited, known, `${def.id}.collection.vars`, errors);
    templateErrors(def.vars, known, `${def.id}.vars`, errors);
    for (const [i, step] of def.steps.entries()) {
      const loc = `${def.id}.steps[${i}]`;
      for (const [k, v] of Object.entries(step)) if (!['js', 'before', 'after', 'finally', 'assertions', 'set'].includes(k)) templateErrors(v, known, `${loc}.${k}`, errors);
      if (step.set) { for (const [k, v] of Object.entries(step.set)) { templateErrors(v, known, `${loc}.set.${k}`, errors); known.add(k); } }
      if (step.tool) {
        capabilities.add(`tool:${step.tool}`);
        if (!available.has(step.tool) || step.tool.startsWith('script_') || step.tool.startsWith('collection_')) errors.push({ location: loc, kind: 'tool', error: `tool ${step.tool} unavailable or recursive control tool; use script references` });
        for (const key of byName.get(step.tool)?.inputSchema?.required || []) if (!(key in (step.args || {})) && !step.before) errors.push({ location: loc, kind: 'argument', error: `tool ${step.tool} missing required argument ${key}` });
      }
      if (step.http) {
        capabilities.add(`http:${String(step.http).split(' ')[0].toUpperCase()}`);
        const url = String(step.http).split(/\s+/)[1];
        if (!url.includes('{{') && !require('./config').getScripts().httpAllow.some(prefix => url.startsWith(prefix))) errors.push({ location: loc, kind: 'capability', error: 'HTTP URL is not configured in scripts.http.allow' });
      }
      if (step.browser || step.open || step.wait !== undefined) { capabilities.add('browser'); try { if (!require('./config').getBrowser().mcp) errors.push({ location: loc, kind: 'capability', error: 'browser MCP is not configured' }); } catch (e) { errors.push({ location: loc, error: e.message }); } }
      if (step.js !== undefined || step.before || step.after || step.finally || step.assertions?.some(a => a.code !== undefined)) capabilities.add('javascript');
      if (step.script) {
        if (String(step.script).includes('{{')) errors.push({ location: loc, error: 'dynamic script references cannot be validated' });
        else try { const child = exactScript(step.script); visit(child, Object.fromEntries(Object.keys(step.params || step.args || {}).map(k => [k, undefined])), [...stack, def.id]); } catch (e) { errors.push({ location: loc, kind: 'reference', error: e.message }); }
      }
      for (const key of [...Object.keys(step.capture || {}), ...names(step.as)]) if (key) known.add(key);
    }
    if ([def.before, def.after, def.finally, ...S.chain(def.id).flatMap(c => [c.before, c.after, c.finally])].some(Boolean)) capabilities.add('javascript');
  };
  for (const c of p.cases) visit(p.definitions[c.script], c.params);
  for (const scope of p.scopes) if (scope.before || scope.after || scope.finally) capabilities.add('javascript');
  if (capabilities.has('javascript')) warnings.push('JavaScript can call dynamic tools. Static validation cannot establish these calls; use explicit tool steps when a complete preflight is required.');
  if (capabilities.has('javascript') && !require('./config').getScripts().js) errors.push({ kind:'capability', error:'JavaScript is disabled' });
  if (!p.cases.length) errors.push({ kind: 'selection', error: 'no cases selected' });
  p.hash = digest({ cases: p.cases, scopes: p.scopes, definitions: p.definitions, collectionChains: p.collectionChains });
  return { version: 1, ok: !errors.length, collection: p.collection, planHash: p.hash, errors, warnings, capabilities: [...capabilities].sort(), references: Object.fromEntries(references), counts: p.counts };
}

function runFile(id) { if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('invalid collection run id'); return path.join(DIR, `${id}.json`); }
function get(id) { const r = readJson(runFile(id)); if (!r) throw new Error(`collection run ${id} not found`); return r; }
function history(collection, limit = 30) {
  let files = []; try { files = fs.readdirSync(DIR).filter(x => /^[a-f0-9]{24}\.json$/.test(x)); } catch {}
  return files.map(f => readJson(path.join(DIR, f))).filter(r => r && (!collection || r.collection === collection)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.min(100, Math.max(1, limit))).map(({ run, collection, startedAt, status, counts, ms, seed, planHash, error }) => ({ run, collection, startedAt, status, counts, ms, seed, planHash, error }));
}
function artifact(r) { return E.artifact(r, evidenceSecrets.get(r)); }
function persist(r) { fs.mkdirSync(DIR, { recursive: true }); const file = runFile(r.run), temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(artifact(r), null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, file); }
function cancel(id, reason = 'cancelled by caller') { const running = active.get(id); if (!running) return { run: id, cancelled: false, status: get(id).status }; running.abort(new Error(reason)); return { run: id, cancelled: true, status: 'cancelling' }; }
function summary(r) { return { version: 1, run: r.run, collection: r.collection, status: r.status, ok: r.ok, counts: r.counts, ms: r.ms, planHash: r.planHash, ...(r.error ? { error: r.error } : {}), ...(r.view ? { view: r.view } : {}), next: 'collection_check, collection_report or collection_history with this run id' }; }
function check(run) { const r = typeof run === 'string' ? get(run) : run; return { ...summary(r), ok: r.status === 'passed' && r.counts.failed === 0 && r.counts.errors === 0 && r.counts.skipped === 0, failed: r.cases.filter(c => c.status === 'failed' || c.status === 'error').map(c => ({ case: c.id, script: c.script, error: c.result?.error || c.error, cleanupErrors: c.result?.cleanupErrors, tests: c.result?.tests })), hookErrors: r.hooks.filter(h => !h.result.ok).map(h => ({ collection:h.collection, kind:h.kind, error:h.result.error, tests:h.result.tests })), cleanupErrors: r.cleanupErrors || [] }; }

async function run(collection, options = {}, adapters = {}) {
  const p = plan(collection, options), validation = await validate(p, {}, adapters);
  // No hooks/actions run when any preflight error exists.
  if (!validation.ok) return { ok: false, status: 'invalid', collection, validation };
  const timeoutMs = options.timeoutMs ?? 120000, cleanupMs = options.cleanupTimeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000 || !Number.isInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > 60000) throw new Error('run timeout must be 1..900000; cleanup timeout 1..60000');
  const controller = new AbortController(), listener = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', listener, { once: true });
  if (options.signal?.aborted) listener();
  if (options.cancelled?.()) controller.abort(new Error('background job cancelled'));
  const cancellation = options.cancelled ? setInterval(() => { if (options.cancelled()) controller.abort(new Error('background job cancelled')); }, 50) : null;
  const r = { version: 1, run: crypto.randomBytes(12).toString('hex'), collection, startedAt: new Date().toISOString(), status: 'running', seed: p.seed, evidence: options.evidence === true, planHash: p.hash, validation, definitions: p.definitions, plan: p, cases: [], hooks: [], cleanupErrors: [], counts: { cases: p.cases.length, passed: 0, failed: 0, errors: 0, skipped: 0 } };
  evidenceSecrets.set(r, E.secrets(p, E.configuredSecrets()));
  active.set(r.run, controller); persist(r); options.onStart?.(r.run);
  const deadline = Date.now() + timeoutMs, scopeVars = new Map(), entered = [];
  let primary;
  const executeHook = async (scope, kind, cleaning = false) => {
    if (!scope[kind]) return;
    const vars = scopeVars.get(scope.id);
    vars.run = { cases: r.cases, counts: r.counts, status: r.status };
    const result = await S.run({ description: `${kind} ${scope.id}`, steps: [{ js: scope[kind] }] }, clone(vars), { call: adapters.call, signal: cleaning ? undefined : controller.signal, timeoutMs: cleaning ? cleanupMs : Math.max(1, deadline - Date.now()), cleanupTimeoutMs: cleanupMs, fullScope: true });
    if (result.scope) { E.secrets(result.scope, evidenceSecrets.get(r)); delete result.scope.run; scopeVars.set(scope.id, result.scope); delete result.scope; }
    r.hooks.push({ collection: scope.id, kind, result }); persist(r);
    if (!result.ok) throw new Error(`${scope.id} ${kind}: ${result.error}`);
  };
  const enter = async id => {
    if (scopeVars.has(id)) return;
    const scope = p.scopes.find(x => x.id === id);
    if (scope.parent) await enter(scope.parent);
    const inherited = scope.parent ? scopeVars.get(scope.parent) : {};
    scopeVars.set(id, clone({ ...inherited, ...scope.params })); entered.push(scope);
    await executeHook(scope, 'before');
  };
  try {
    for (const c of p.cases) {
      if (controller.signal.aborted || Date.now() >= deadline) throw new Error(controller.signal.aborted ? 'cancelled' : 'run deadline exceeded');
      await enter(c.scope);
      // Snapshots and fresh JSON vars ensure datasets/cases cannot mutate one another.
      const given = clone({ ...scopeVars.get(c.scope), ...c.overrides });
      const started = Date.now();
      const result = await S.run(clone(p.definitions[c.script]), given, { call: adapters.call, signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()), cleanupTimeoutMs: cleanupMs, definitions: p.definitions, collectionChains: p.collectionChains });
      const status = result.ok ? 'passed' : result.tests?.failed ? 'failed' : 'error';
      r.cases.push({ ...c, params: options.evidence ? given : undefined, status, ms: Date.now() - started, result }); r.counts[status === 'error' ? 'errors' : status]++;
      persist(r);
      if (controller.signal.aborted || /deadline|cancelled/.test(result.error || '')) throw new Error(controller.signal.aborted ? 'cancelled' : result.error);
      if (options.failFast && !result.ok) throw new Error(`case ${c.id} failed`);
    }
    for (const scope of [...entered].reverse()) await executeHook(scope, 'after');
  } catch (e) { primary = e.message; }
  finally {
    for (const c of p.cases.slice(r.cases.length)) { r.cases.push({ ...c, params: undefined, status: 'skipped', error: primary || 'scope setup failed' }); r.counts.skipped++; }
    for (const scope of entered.reverse()) try { await executeHook(scope, 'finally', true); } catch (e) { r.cleanupErrors.push({ collection: scope.id, error: e.message }); }
    r.ms = Date.now() - Date.parse(r.startedAt); r.endedAt = new Date().toISOString();
    r.ok = !primary && !r.cleanupErrors.length && !r.counts.failed && !r.counts.errors && !r.counts.skipped;
    r.status = controller.signal.aborted ? 'cancelled' : r.ok ? 'passed' : 'failed';
    if (primary) r.error = primary;
    else if (r.cleanupErrors.length) r.error = 'suite cleanup failed';
    if (options.visualize !== false) try { r.view = require('./results').saveView('collection-report', artifact(r), { title: `${collection}: ${r.status}` }); } catch (e) { r.viewError = e.message; }
    persist(r); active.delete(r.run); clearInterval(cancellation); options.signal?.removeEventListener('abort', listener);
  }
  return artifact(r);
}
const xml = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function junit(run) {
  const r = typeof run === 'string' ? get(run) : run;
  const extra = [...r.hooks.filter(h => !h.result.ok).map(h => ({ id: `${h.collection}:${h.kind}`, script: h.collection, status: 'error', result: h.result })), ...r.cleanupErrors.filter(e => !r.hooks.some(h => h.kind === 'finally' && h.collection === e.collection)).map(e => ({ id: `${e.collection}:finally`, script: e.collection, status: 'error', result: e }))];
  const cases = [...r.cases, ...extra];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xml(r.collection)}" tests="${cases.length}" failures="${cases.filter(c => c.status === 'failed').length}" errors="${cases.filter(c => c.status === 'error').length}" skipped="${cases.filter(c => c.status === 'skipped').length}" time="${(r.ms || 0) / 1000}">\n${cases.map(c => `<testcase classname="${xml(c.script)}" name="${xml(c.id)}" time="${(c.ms || 0) / 1000}">${c.status === 'skipped' ? `<skipped message="${xml(c.error)}"/>` : c.status !== 'passed' ? `<${c.status === 'failed' ? 'failure' : 'error'} message="${xml(c.result?.error || c.error || 'assertions failed')}">${xml(JSON.stringify(c.result || c))}</${c.status === 'failed' ? 'failure' : 'error'}>` : ''}</testcase>`).join('\n')}\n</testsuite>\n`;
}
module.exports = { save, inspect, plan, validate, run, get, history, cancel, check, junit, summary, DIR };
