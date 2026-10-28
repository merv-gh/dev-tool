// Offline given/when/then compiler. Static findings describe what must be supplied/observed,
// never the business values to assert. No environment queries, writes or action execution.
//
// inventory({service, passport?, env?, entry?}) -> {states, actions, expectations, gaps,...}.
// states.kind: pg/kafka/http/es/config/cache/queue/file/unknown; targets are JSON objects.
// actions(inv,{bindings:{actionId: payload}}) keeps payload separate as action.binding.
// expectations(inv,{bindings:{expectationId:{select?,match:{op,value?,min?,max?,exact?}}}}).
// check(plan, observations) accepts id->value or [{id?,kind,target,action?,value}].
// Selectors default to expectation kind/target/action. Unattributed cross-action records are
// ambiguous, not evidence for every action. count:0/forbidden explicitly assert absence.
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const fs = require('fs');
const path = require('path');

function canonical(v, seen = new Set()) {
  if (typeof v === 'bigint') return String(v);
  if (!v || typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if (seen.has(v)) throw new Error('scenario manifests must be acyclic JSON');
  const next = new Set(seen); next.add(v);
  return Array.isArray(v) ? v.map(x => canonical(x, next)) : Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k], next)]));
}
const json = v => JSON.stringify(canonical(v));
const copy = v => JSON.parse(json(v));
const id = (kind, value) => `${kind}:${crypto.createHash('sha256').update(json(value)).digest('hex').slice(0, 20)}`;
const array = v => Array.isArray(v) ? v : [];
const strings = v => [].concat(v || []).filter(x => typeof x === 'string');
const unique = values => [...new Map(values.map(v => [json(v), v])).values()].sort((a, b) => json(a).localeCompare(json(b)));
const unresolved = s => !s || /\$\{|^\?|^\(|<unresolved|\bunknown\b/i.test(String(s));
const route = s => String(s || '').replace(/\{[^}]*\}/g, '{}');
const handler = s => String(s || '').includes('#') ? String(s) : String(s || '').replace(/\.([^.()]+)$/, '#$1');
const WRITE = /^(write|insert|update|delete|save|merge|persist|remove)$/i;
function provenance(source, action, item = {}) {
  return copy({ source, ...(action ? { action } : {}), ...(item.file ? { file: item.file, line: item.line ?? null } : {}), ...(item.at ? { at: item.at } : {}), ...(item.via ? { via: item.via } : {}), ...(item.source ? { library: item.source } : {}) });
}
function externalKind(item) {
  const s = `${item.kind || ''} ${item.type || ''} ${item.why || ''}`;
  if (/cache|redis/i.test(s)) return 'cache';
  if (/queue|rabbit|jms|sqs|amqp/i.test(s)) return 'queue';
  if (/file|sftp|filesystem|FileStore|BlobStore|S3Client/i.test(s)) return 'file';
  if (/kafka|StreamBridge/i.test(s)) return 'kafka';
  if (/http|feign|RestTemplate|WebClient|RestClient|HttpClient/i.test(s)) return 'http';
  if (/\bes\b|elasticsearch/i.test(s)) return 'es';
  if (/\bdb\b|database|Jdbc|Repository|EntityManager|DataSource/i.test(s)) return 'pg';
  return 'unknown';
}

function inventory({ service, passport, env, entry } = {}) {
  const p = passport || (service && require('./passport').load(service));
  if (!p || typeof p !== 'object') throw new Error(`no cached passport for ${service || '(service required)'}`);
  service ||= p.service;
  if (!service) throw new Error('scenario inventory needs service or passport.service');
  env ||= p.env || require('./config').envNames()[0];
  const gaps = [], states = new Map(), effects = new Map(), entries = new Map(), methodShapes = new Map(), methodIds = new Set();
  const configKeys = new Set(Object.keys(p.config?.merged || {}));
  let cats = [], catalogError;
  try { cats = require('./pg').loadAll(env); } catch (e) { catalogError = e.message; }
  const datasources = array(p.db?.datasources);
  const wanted = new Set(datasources.map(d => d.db).filter(Boolean));
  const allowed = cats.filter(c => !wanted.size || wanted.has(c.db) || wanted.has(c.database));
  function resolveDb(name, item = {}, fn = false) {
    const hinted = item.db || datasources.find(d => item.datasource && (d.key === item.datasource || d.name === item.datasource))?.db;
    const candidates = [];
    for (const c of hinted ? cats.filter(c => c.db === hinted || c.database === hinted) : allowed) {
      for (const t of fn ? array(c.functions) : array(c.tables)) {
        const full = `${t.schema}.${t.name}`;
        if (full.toLowerCase() === String(name).toLowerCase() || !String(name).includes('.') && t.name?.toLowerCase() === String(name).toLowerCase()) candidates.push({ db: c.db, [fn ? 'function' : 'table']: full });
      }
    }
    const matches = unique(candidates);
    return { target: matches.length === 1 ? matches[0] : { db: hinted || (wanted.size === 1 ? [...wanted][0] : null), [fn ? 'function' : 'table']: name || null }, resolution: { status: matches.length === 1 ? 'resolved' : matches.length ? 'ambiguous' : 'unknown', ...(matches.length ? { candidates: matches } : {}) } };
  }
  const addState = (kind, target, action, evidence, resolution = { status: 'resolved' }, required = true) => {
    const sid = id('state', [service, kind, target]);
    let s = states.get(sid);
    if (!s) { s = { id: sid, kind, target, required, actions: [], provenance: [], resolution }; states.set(sid, s); }
    s.required ||= required;
    if (action && !s.actions.includes(action.id)) { s.actions.push(action.id); action.dependencies.push(sid); }
    s.provenance = unique([...s.provenance, evidence]);
    if (resolution.status !== 'resolved' && !gaps.some(g => g.stateId === sid)) gaps.push({ id: id('gap', [sid, resolution.status]), kind: resolution.status === 'ambiguous' ? 'ambiguous-dependency' : 'unresolved-dependency', stateId: sid, detail: `Resolve ${kind} dependency explicitly; static evidence does not identify its complete state.`, ...(resolution.candidates ? { candidates: resolution.candidates } : {}) });
    return s;
  };
  const addEffect = (kind, target, action, evidence, direction = 'write') => {
    const eid = id('expectation', [service, action?.id || null, kind, target, direction]);
    let e = effects.get(eid);
    if (!e) { e = { id: eid, kind, target, action: action?.id || null, required: true, direction, valueKnown: false, provenance: [] }; effects.set(eid, e); }
    e.provenance = unique([...e.provenance, evidence]);
    if (action && !action.expectations.includes(eid)) action.expectations.push(eid);
    return e;
  };
  const addAction = (kind, target, h, item, source) => {
    target = kind === 'http' ? route(target) : String(target);
    const aid = id('action', [service, kind, target]);
    let a = entries.get(aid);
    if (!a) { a = { id: aid, kind, target, entry: target, handler: h || null, handlers: [], required: true, input: { known: false, ...(item?.inputSchema ? { schema: item.inputSchema, known: true } : {}), ...(item?.inputType || item?.payloadType ? { type: item.inputType || item.payloadType } : {}), hints: ['Supply scenario-specific values; TestData factories provide type-valid objects, not expected behavior.'] }, dependencies: [], expectations: [], provenance: [] }; entries.set(aid, a); }
    if (item?.inputSchema) { a.input.schema = item.inputSchema; a.input.known = true; }
    if (item?.inputType || item?.payloadType) a.input.type = item.inputType || item.payloadType;
    if (item?.pattern) a.pattern = true;
    const shapes = methodShapes.get(handler(h));
    if (shapes?.length === 1) { a.input.parameters = shapes[0].parameters; a.returnType = shapes[0].returnType; }
    else if (shapes?.length) a.input.overloads = shapes;
    if (h) {
      const same = a.handlers.find(old => handler(old) === handler(h) || handler(old).endsWith(`.${handler(h)}`) || handler(h).endsWith(`.${handler(old)}`));
      if (!same) a.handlers.push(h);
      else if (h.length > same.length) { a.handlers[a.handlers.indexOf(same)] = h; a.handler = h; }
    }
    a.provenance = unique([...a.provenance, provenance(source, aid, item)]);
    return a;
  };
  const summaryFlows = array(p.flows);
  if (catalogError) addState('unknown', { type: 'catalog-analysis', detail: catalogError }, null, { source: 'cached-catalog' }, { status: 'unknown' });
  let flows = summaryFlows;
  // Reuse code already indexed by the passport. flows()/from() never fetch code.
  const keys = [typeof p.codeIndex === 'string' ? p.codeIndex : null, ...array(p.libraries).map(l => l.index)].filter(Boolean);
  if (keys.length) try {
    const CI = require('./codeindex');
    if (keys.every(k => CI.load(k))) {
      for (const key of keys) for (const c of CI.load(key).graph_().classes || []) if (!c.test) for (const m of c.methods || []) {
        methodIds.add(`${c.id}#${m.name}`);
        const shape = { parameters: m.params || [], returnType: m.ret || null };
        for (const name of [`${c.id}#${m.name}`, `${c.name}#${m.name}`]) methodShapes.set(name, unique([...(methodShapes.get(name) || []), shape]));
      }
      const F = require('./flows');
      const repo = p.repo?.path && path.resolve(require('./config').ROOT, p.repo.path);
      const config = repo && fs.existsSync(repo) ? F.serviceConfig(repo) : {};
      for (const key of Object.keys(config)) configKeys.add(key);
      const detailed = F.flows(keys, { config });
      if (detailed.length) flows = detailed;
    }
  } catch (e) { addState('unknown', { type: 'flow-analysis', detail: e.message }, null, { source: 'code-index' }, { status: 'unknown' }); }
  for (const f of flows) if (f?.entry) addAction(f.kind || 'method', f.entry, f.method || f.handler, f, 'flow');
  const effective = p.effective || {};
  for (const e of [...array(effective.endpoints), ...array(p.endpoints)]) addAction('http', `${e.method || 'ANY'} ${e.path || '?'}`, e.handler, e, 'passport-endpoint');
  for (const k of [...array(effective.consumes), ...array(p.kafka?.consumes)]) addAction(k.pattern ? 'kafka' : 'kafka', `kafka ${k.topic || '?'}`, k.handler, k, 'passport-listener');
  for (const f of [...array(p.scheduled), ...array(p.events), ...array(p.methods)]) if (f.entry || f.handler || f.method) addAction(f.kind || (array(p.scheduled).includes(f) ? 'scheduled' : 'method'), f.entry || f.handler || f.method, f.handler || f.method, f, 'passport-action');
  const selectors = entry == null ? [] : strings(entry);
  let selected = [...entries.values()].filter(a => !selectors.length || selectors.some(s => s === a.id || route(s) === a.target || handler(a.handler).endsWith(handler(s))));
  if (selectors.length && !selected.length && keys.length) try {
    const F = require('./flows');
    for (const s of selectors) if (s.includes('#')) {
      const matches = [...methodIds].filter(name => name === s || name.endsWith(`.${s}`));
      if (matches.length === 1) { const f = F.from(keys, matches[0]); flows = [...flows, f]; selected.push(addAction('method', f.entry, f.method, f, 'code-method')); }
    }
  } catch {}
  if (!selected.length) {
    const unknown = addState('unknown', { type: 'entrypoint-analysis', entry: entry || null, detail: p.flows?.error || 'No matching cached entrypoints; provide method/endpoint evidence.' }, null, { source: 'passport' }, { status: 'unknown' });
    gaps.push({ id: id('gap', [unknown.id, 'no-actions']), kind: 'no-actions', stateId: unknown.id, detail: 'No selected action can be invoked without an explicit entrypoint binding.' });
  }
  for (const selector of selectors) if (!selected.some(a => selector === a.id || route(selector) === a.target || handler(a.handler).endsWith(handler(selector)))) addState('unknown', { type: 'unmatched-action-selection', entry: selector }, null, { source: 'action-selection' }, { status: 'unknown' });
  const selectedIds = new Set(selected.map(a => a.id));
  const actionFor = f => selected.find(a => a.kind === (f.kind || 'method') && a.target === (f.kind === 'http' ? route(f.entry) : f.entry));
  const found = new Set();
  function pg(item, action, source) {
    const name = item.table || item.function || item.name;
    const fn = !!item.function || item.access === 'function' || source === 'passport-function';
    const resolved = resolveDb(name, item, fn), evidence = provenance(source, action?.id, item);
    const key = json(['pg', fn ? 'function' : item.access, resolved.target]);
    found.add(key);
    // Write targets also need their starting state/schema supplied; an insert/update's
    // defaults, uniqueness and FK behavior cannot be reproduced from output assertions.
    addState('pg', resolved.target, action, evidence, resolved.resolution, !/^(owner|entity|repository)$/.test(item.access || ''));
    if (WRITE.test(item.access || '') || fn) addEffect('pg', resolved.target, action, evidence, fn ? 'function-effects-unknown' : item.access);
  }
  function outgoing(item, action, source, kind) {
    const evidence = provenance(source, action?.id, item);
    if (kind === 'kafka') {
      const target = { topic: item.topic || null };
      found.add(json(['kafka-out', item.topic]));
      addEffect('kafka', target, action, evidence, 'produce');
      if (unresolved(item.topic)) addState('unknown', { type: 'kafka-topic', topic: item.topic || null }, action, evidence, { status: 'unknown' });
    } else if (kind === 'http') {
      const call = item.call?.match(/^([A-Z]+)\s+(.+)$/);
      const target = { method: item.method || call?.[1] || null, path: item.path || call?.[2] || item.url || item.target || null, ...(item.client ? { client: item.client } : {}) };
      found.add(json(['http', target]));
      addState('http', target, action, evidence, { status: unresolved(target.path) ? 'unknown' : 'resolved' });
      addEffect('http', target, action, evidence, 'call');
    } else {
      const target = { index: item.index || item.name || null };
      found.add(json(['es', target.index]));
      addState('es', target, action, evidence, { status: unresolved(target.index) ? 'unknown' : 'resolved' });
      const access = item.access || item.operation;
      if (!access || WRITE.test(access)) addEffect('es', target, action, evidence, access || 'effects-unknown');
    }
  }
  function mock(item, action, source) {
    if (typeof item === 'string') {
      const split = item.indexOf(': '), decl = split < 0 ? item : item.slice(0, split), last = decl.lastIndexOf(' ');
      item = { type: last < 0 ? decl : decl.slice(0, last), name: last < 0 ? null : decl.slice(last + 1), why: split < 0 ? null : item.slice(split + 2) };
    }
    const kind = externalKind(item), target = { type: item.type || item.name || 'unknown', ...(item.name ? { name: item.name } : {}), ...(item.call ? { call: item.call } : {}) };
    addState(kind, target, action, provenance(source, action?.id, item), { status: 'unknown' });
    if (item.call && /^(send|publish|put|set|write|save|delete|remove|update|post|exchange|execute)/i.test(item.call)) addEffect(kind, target, action, provenance(source, action?.id, item), item.call);
  }
  for (const a of selected) {
    if (a.handlers.length > 1 || a.input.overloads?.length > 1) addState('unknown', { type: 'ambiguous-handler', entry: a.target, handlers: a.handlers, ...(a.input.overloads ? { overloads: a.input.overloads } : {}) }, a, { source: 'entrypoint-analysis' }, { status: 'ambiguous' });
    if (a.kind === 'http') { addEffect('status', a.target, a, a.provenance[0], 'respond'); addEffect('return', a.target, a, a.provenance[0], 'respond'); }
    if (a.kind === 'kafka' || a.kind === 'queue') {
      const topic = a.target.replace(/^(?:kafka|queue)\s+/, '');
      addState(a.kind, { topic, direction: 'inbound', ...(a.pattern ? { pattern: true } : {}) }, a, a.provenance[0], { status: a.pattern || unresolved(topic) ? 'unknown' : 'resolved' });
    }
  }
  for (const f of flows) {
    const a = actionFor(f); if (!a || !selectedIds.has(a.id)) continue;
    for (const t of array(f.out?.tables)) pg(t, a, 'flow-table');
    for (const fn of array(f.out?.functions)) pg({ ...fn, access: 'function' }, a, 'flow-function');
    for (const k of array(f.out?.produces)) outgoing(k, a, 'flow-topic', 'kafka');
    for (const h of array(f.out?.http)) outgoing(h, a, 'flow-http', 'http');
    for (const es of array(f.out?.es)) outgoing(es, a, 'flow-es', 'es');
    for (const x of array(f.out?.external)) mock(x, a, 'flow-external');
    for (const x of array(f.mocks)) mock(x, a, 'flow-mock');
    for (const prop of array(f.properties)) {
      const k = typeof prop === 'string' ? prop : prop.key;
      addState('config', { key: k || null }, a, provenance('flow-property', a.id, typeof prop === 'string' ? {} : prop), { status: unresolved(k) ? 'unknown' : 'resolved' });
    }
  }
  // Findings outside a selected chain remain visible. Their attribution is unknown, rather
  // than silently assuming they cannot affect the scenario or assigning them to every action.
  for (const t of [...array(effective.tables), ...array(p.db?.tables)]) if (!found.has(json(['pg', t.access === 'function' ? 'function' : t.access, resolveDb(t.table, t, t.access === 'function').target]))) pg(t, null, 'passport-table');
  for (const fn of [...array(effective.dbCalls), ...array(p.db?.calls)]) if (!found.has(json(['pg', 'function', resolveDb(fn.name || fn.function, fn, true).target]))) pg({ ...fn, function: fn.function || fn.name }, null, 'passport-function');
  for (const k of [...array(effective.produces), ...array(p.kafka?.produces)]) if (!found.has(json(['kafka-out', k.topic]))) outgoing(k, null, 'passport-topic', 'kafka');
  for (const h of [...array(effective.calls), ...array(p.feign), ...array(p.http)]) {
    const target = { method: h.method || null, path: h.path || h.url || h.target || null, ...(h.client ? { client: h.client } : {}) };
    if (!found.has(json(['http', target]))) outgoing(h, null, 'passport-http', 'http');
  }
  for (const es of array(p.es)) if (!found.has(json(['es', es.index]))) outgoing(es, null, 'passport-es', 'es');
  for (const prop of [...configKeys, ...strings(p.config?.unresolved), ...array(p.config?.properties).map(x => typeof x === 'string' ? x : x.key), ...datasources.map(d => d.key).filter(Boolean)]) addState('config', { key: prop }, null, { source: 'passport-config' }, { status: unresolved(prop) ? 'unknown' : 'resolved' });
  for (const l of array(p.libraries)) if (l.error || l.found === false) addState('unknown', { type: 'unread-library', library: l.artifactId || l.repo || null, detail: l.error || 'Library was not inspected.' }, null, { source: 'passport-library' }, { status: 'unknown' });
  if (!flows.length || !Array.isArray(p.flows) && !keys.length) addState('unknown', { type: 'call-graph-coverage', detail: p.flows?.error || 'No cached transitive flow graph.' }, null, { source: 'passport' }, { status: 'unknown' });
  for (const s of states.values()) if (!s.actions.length && s.required && s.resolution.status === 'resolved') gaps.push({ id: id('gap', [s.id, 'attribution']), kind: 'unattributed-dependency', stateId: s.id, detail: 'Dependency is present in the passport but is not attributed to a selected action.' });
  for (const e of effects.values()) if (!e.action) {
    const s = addState('unknown', { type: 'effect-attribution', expectationId: e.id, kind: e.kind, target: e.target }, null, { source: 'passport-effect' }, { status: 'unknown' });
    gaps.push({ id: id('gap', [e.id, 'attribution']), kind: 'unattributed-effect', stateId: s.id, expectationId: e.id, detail: 'Bind the expected behavior explicitly; this effect is not attributed to a selected action.' });
  }
  selected = selected.map(a => ({ ...a, handlers: a.handlers.sort(), dependencies: [...new Set(a.dependencies)].sort(), expectations: a.expectations.sort() })).sort((a, b) => a.id.localeCompare(b.id));
  return copy({ version: 1, service, env, source: { passportSha: p.repo?.sha || null, passportBuiltAt: p.builtAt || null }, states: [...states.values()].map(s => ({ ...s, actions: s.actions.sort() })).sort((a, b) => a.id.localeCompare(b.id)), actions: selected, expectations: [...effects.values()].sort((a, b) => a.id.localeCompare(b.id)), gaps: unique(gaps), complete: false, coverage: { static: true, runtimeVerified: false, exhaustive: false, note: 'Static analysis records observed dependencies; reflection, runtime branches and unresolved external behavior still require explicit evidence.' } });
}

function actions(inv, { bindings = {} } = {}) {
  const gaps = [];
  const known = new Set(array(inv.actions).map(a => a.id));
  for (const key of Object.keys(bindings)) if (!known.has(key)) gaps.push({ kind: 'unknown-action-binding', id: key });
  const bound = array(inv.actions).map(a => {
    const present = Object.hasOwn(bindings, a.id);
    if (a.required !== false && !present) gaps.push({ kind: 'unbound-action', actionId: a.id, target: a.target });
    return { ...a, bound: present, ...(present ? { binding: copy(bindings[a.id]) } : {}) };
  });
  return copy({ version: 1, service: inv.service, env: inv.env, actions: bound, gaps, complete: !gaps.length, ready: !gaps.length, coverage: inv.coverage });
}
const OPS = new Set(['exact', 'subset', 'count', 'forbidden', 'ordered']);
function descriptorError(match) {
  if (!match || !OPS.has(match.op)) return 'match.op must be exact, subset, count, forbidden or ordered';
  if (['exact', 'subset', 'ordered'].includes(match.op) && !Object.hasOwn(match, 'value')) return `${match.op} requires an explicit value`;
  if (match.op === 'ordered' && !Array.isArray(match.value)) return 'ordered requires an array value';
  if (match.op === 'count') {
    if (!Object.hasOwn(match, 'value') && !Object.hasOwn(match, 'min') && !Object.hasOwn(match, 'max')) return 'count requires value, min or max';
    if (['value', 'min', 'max'].some(k => Object.hasOwn(match, k) && (!Number.isInteger(match[k]) || match[k] < 0))) return 'count bounds must be nonnegative integers';
    if (match.min != null && match.max != null && match.min > match.max) return 'count min exceeds max';
  }
  return null;
}
function expectations(inv, { bindings = {} } = {}) {
  const gaps = [], known = new Set(array(inv.expectations).map(e => e.id));
  for (const key of Object.keys(bindings)) if (!known.has(key)) gaps.push({ kind: 'unknown-expectation-binding', id: key });
  const bound = array(inv.expectations).map(e => {
    const b = bindings[e.id], present = Object.hasOwn(bindings, e.id);
    const match = b?.match || (b?.op ? b : undefined), error = present ? descriptorError(match) : null;
    if (e.required !== false && !present) gaps.push({ kind: 'unbound-expectation', expectationId: e.id });
    if (error) gaps.push({ kind: 'invalid-expectation', expectationId: e.id, detail: error });
    return { ...e, bound: present && !error, select: b?.select || { kind: e.kind, target: e.target, ...(e.action ? { action: e.action } : {}) }, ...(match ? { match } : {}) };
  });
  return copy({ version: 1, service: inv.service, env: inv.env, expectations: bound, gaps, complete: !gaps.length, ready: !gaps.length, coverage: inv.coverage });
}

function subset(actual, expected) {
  if (isDeepStrictEqual(actual, expected)) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length > actual.length) return false;
    // Maximum matching preserves multiplicity without a greedy false negative when
    // one expected pattern is broader than another.
    const owner = new Map();
    function assign(n, seen) {
      for (let i = 0; i < actual.length; i++) if (!seen.has(i) && subset(actual[i], expected[n])) {
        seen.add(i);
        if (!owner.has(i) || assign(owner.get(i), seen)) { owner.set(i, n); return true; }
      }
      return false;
    }
    return expected.every((_, n) => assign(n, new Set()));
  }
  return !!expected && typeof expected === 'object' && !!actual && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(expected).every(k => Object.hasOwn(actual, k) && subset(actual[k], expected[k]));
}
function check(plan, observed, { allowUnexpected = false } = {}) {
  const expected = array(plan?.expectations), gaps = [...array(plan?.gaps)], results = [];
  const records = Array.isArray(observed) ? observed : null;
  const map = !records && observed && typeof observed === 'object' ? observed : {};
  const used = new Set();
  const duplicates = expected.filter((e, i) => expected.findIndex(x => x.id === e.id) !== i);
  for (const e of duplicates) gaps.push({ kind: 'duplicate-expectation', expectationId: e.id });
  for (const e of expected) {
    const error = descriptorError(e.match);
    if (!e.bound || error) { results.push({ id: e.id, ok: e.required === false, reason: error || 'expectation has no explicit binding' }); continue; }
    const selector = e.select || { kind: e.kind, target: e.target, ...(e.action ? { action: e.action } : {}) };
    let present, value, ambiguous = false;
    if (records) {
      const selected = records.filter(r => r && (r.id === e.id || !r.id && Object.entries(selector).every(([key, wanted]) => key === 'action' && r.action == null ? true : isDeepStrictEqual(r[key], wanted))));
      for (const record of selected) used.add(record);
      if (selector.action && selected.some(r => r.action == null && !r.id)) {
        const peers = expected.filter(other => other.id !== e.id && other.select?.action !== selector.action && isDeepStrictEqual(other.select?.kind, selector.kind) && isDeepStrictEqual(other.select?.target, selector.target));
        ambiguous = peers.length > 0;
      }
      present = selected.length > 0;
      value = selected.length === 1 ? selected[0].value : selected.map(r => r.value);
    } else { present = Object.hasOwn(map, e.id); value = map[e.id]; if (present) used.add(e.id); }
    if (ambiguous) { results.push({ id: e.id, ok: false, reason: 'observation has no action id and matches multiple actions' }); continue; }
    if (!present && !(records && (e.match.op === 'forbidden' || e.match.op === 'count' && (e.match.value === 0 || e.match.max === 0)))) { results.push({ id: e.id, ok: false, reason: 'required observation is missing' }); continue; }
    const m = e.match, values = !present ? [] : Array.isArray(value) ? value : [value];
    let ok = false;
    if (m.op === 'exact') ok = isDeepStrictEqual(value, m.value);
    else if (m.op === 'subset') ok = subset(value, m.value);
    else if (m.op === 'count') { const n = values.length; ok = (m.value == null || n === m.value) && (m.min == null || n >= m.min) && (m.max == null || n <= m.max); }
    else if (m.op === 'forbidden') ok = Object.hasOwn(m, 'value') ? !values.some(v => subset(v, m.value)) : !values.length;
    else if (m.op === 'ordered') { let i = 0; for (const v of values) if (i < m.value.length && subset(v, m.value[i])) i++; ok = i === m.value.length && (m.exact === false || values.length === m.value.length); }
    results.push({ id: e.id, ok, reason: ok ? 'matched' : `${m.op} expectation did not match`, ...(m.op === 'count' ? { count: values.length } : {}) });
  }
  if (!allowUnexpected) {
    if (records) records.forEach((record, index) => { if (!used.has(record)) gaps.push({ kind: 'unexpected-observation', observation: index, ...(record?.id ? { id: record.id } : {}) }); });
    else for (const key of Object.keys(map)) if (!used.has(key)) gaps.push({ kind: 'unexpected-observation', id: key });
  }
  if (!expected.length) gaps.push({ kind: 'no-expectations', detail: 'No explicit business expectations were checked.' });
  const passed = results.filter(r => r.ok).length, failed = results.length - passed;
  return { ok: failed === 0 && gaps.length === 0, passed, failed, results, gaps, coverage: { runtimeVerified: false, checked: results.length, note: 'Checks apply to supplied observations; this function does not execute the service.' } };
}
module.exports = { inventory, actions, expectations, check };
