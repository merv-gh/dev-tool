// A reproducible notebook of explicit reads. Static references are never reported as wire traces.
const path = require('node:path'), crypto = require('node:crypto');
const C = require('./config'), A = require('./access'), D = require('./durable-private-store');
const clone = x => JSON.parse(JSON.stringify(x));
const store = () => D.create(path.join(C.HOME, 'mapping-debugger', crypto.createHash('sha256').update(A.current().principalId).digest('hex')), 8 * 1048576);
const index = () => D.create(path.join(store().root, 'index'), 8192);
function write(s, r) {
  s.write(r.id, r);
  index().write(r.id, { id:r.id,kind:r.kind,notebook:r.notebook,title:r.definition.title,service:r.definition.service,env:r.definition.env,envs:[...new Set([r.definition.env,...r.definition.probes.map(p=>p.env||r.definition.env)])],at:r.at,revision:r.revision,bytes:Buffer.byteLength(JSON.stringify(r)) });
  return r;
}
const key = id => { if (!/^[a-z][a-z0-9-]{0,79}$/.test(id || '') || ['constructor','prototype'].includes(id)) throw D.invalid('Choose a lowercase name separated by hyphens (up to 80 characters)'); return id; };
const text = (v, max = 20000) => typeof v === 'string' && v.length <= max;
function pointer(value, pointer) {
  if (pointer === '') return { found: true, value };
  if (!text(pointer, 1000) || !pointer.startsWith('/') || /~[^01]|~$/.test(pointer)) throw D.invalid('Use a JSON pointer such as /items/0/name; empty selects the whole result');
  for (const part of pointer.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return { found: false };
    value = value[part];
  }
  return { found: true, value };
}
function definition(input) {
  if (!input || input.version !== 1 || !text(input.title, 160) || !input.title.trim() || (!text(input.service, 256) || !input.service.trim())) throw D.invalid('Definition needs version:1, title and service');
  if (Buffer.byteLength(JSON.stringify(input)) > 512 * 1024) throw D.invalid('Definition exceeds 512 KiB');
  if (!text(input.env, 100) || !input.env.trim() || input.follow_service !== undefined && typeof input.follow_service !== 'boolean') throw D.invalid('Choose an environment and a boolean follow_service');
  C.getEnv(input.env);
  const d = clone(input); d.probes ||= []; d.comparisons ||= []; d.assumptions ||= [];
  if (!Array.isArray(d.probes) || d.probes.length > 30 || !Array.isArray(d.comparisons) || d.comparisons.length > 100 || !Array.isArray(d.assumptions) || d.assumptions.length > 100 || d.assumptions.some(s => !text(s, 2000))) throw D.invalid('Limit to 30 probes, 100 comparisons and 100 short assumptions');
  const ids = new Set();
  for (const p of d.probes) {
    key(p.id); if (ids.has(p.id) || p.id === 'api') throw D.invalid('Probe names must be unique; api is reserved for explicitly sending the request'); ids.add(p.id);
    if (!text(p.label, 160) || !['pg', 'es', 'kafka'].includes(p.kind)) throw D.invalid('Each probe needs label and kind: pg, es or kafka');
    C.getEnv(p.env || d.env);
    if (p.kind === 'pg' && (!text(p.sql) || !p.sql.trim() || !text(p.db, 100) || !Object.hasOwn(C.getEnv(p.env || d.env).pg, p.db) || (p.params !== undefined && !Array.isArray(p.params)))) throw D.invalid('PG probes need a configured db, SQL and optional params array');
    if (p.kind === 'es' && (!text(p.index, 300) || !p.index || (p.query !== undefined && !text(p.query)))) throw D.invalid('ES probes need an index and optional query string');
    if (p.kind === 'kafka' && (!text(p.topic, 300) || !p.topic)) throw D.invalid('Kafka probes need a topic');
    if (p.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 100)) throw D.invalid('Probe limit must be 1..100');
  }
  if (d.request) {
    d.request = require('./api-client').prepare({ request: d.request }).request;
    if (Object.keys(d.request.headers).some(h => /authorization|cookie|token|key|secret/i.test(h))) throw D.invalid('Use a runtime auth_profile rather than credentials in a saved definition');
    if (require('./redact').values(d.request).some(v => !/^\{\{[a-z_]\w*\}\}$/i.test(v))) throw D.invalid('Keep request secrets in runtime params, using {{parameter}} placeholders');
  }
  for (const c of d.comparisons) {
    if (!ids.has(c.probe) || !text(c.label, 160)) throw D.invalid('Comparisons need a label and an existing probe name');
    pointer({}, c.response_path); pointer({}, c.source_path);
  }
  return d;
}
function allowed(r) { return [r.definition.env, ...r.definition.probes.map(p => p.env || r.definition.env)].every(A.allowsEnv); }
function load(id) { const r = store().read(key(id)); if (!r || !allowed(r)) throw Object.assign(Error('Debug notebook or recording not found for this user'), { statusCode: 404 }); return r; }
function url(id) { return C.getServer().publicUrl + '/mapping-debugger?' + new URLSearchParams({ id, story: A.current().storyId }); }
function save({ id, definition: input, expected_revision }) {
  key(id); const d = definition(input), s = store();
  return s.update(id, old => {
    if (old && old.kind !== 'definition') throw D.invalid('This name belongs to a recording');
    if ((old?.revision || null) !== expected_revision) throw D.invalid('Notebook changed; reload its revision before saving', 'STATE_CONFLICT', 409);
    if (!old && index().list().filter(r => r.kind === 'definition').length >= 200) throw D.invalid('Notebook budget reached (200)');
    const r = { id, kind: 'definition', definition: d, revision: D.hash(JSON.stringify(d)), previous: old?.revision || null, at: new Date().toISOString() };
    // Immutable definition copies also live in every recording; edits cannot reinterpret old evidence.
    write(s, r); return { ...r, url: url(id) };
  });
}
function discover({ service, env = C.envNames()[0] }) {
  if (!text(service, 256) || !service) throw D.invalid('Select an exact service');
  C.getEnv(env);
  const p = require('./passport').load(service), e = p?.effective || {}, probes = [], references = [];
  const dbReferences = [...(e.tables || []), ...(e.dbCalls || [])];
  for (const r of dbReferences.slice(0, 500)) {
    if (!r.sql && !r.table && !r.name) continue;
    references.push({ kind: 'pg', object: r.table || r.name, sql: r.sql, file: r.file, line: r.line, via: r.via });
  }
  for (const r of (p?.es || []).slice(0, 100)) if (r.index && probes.length < 30) probes.push({ id: 'index-' + probes.length, label: r.index, kind: 'es', index: r.index, limit: 20, evidence: [r.file,r.line,r.via].filter(Boolean).join(':') });
  for (const r of [...(e.consumes || []), ...(e.produces || [])].slice(0, 100)) {
    const topic = typeof r === 'string' ? r : r.topic;
    if (topic && !probes.some(p => p.topic === topic) && probes.length < 30) probes.push({ id: 'topic-' + probes.length, label: topic, kind: 'kafka', topic, limit: 5 });
  }
  return { service, env, source: p?.repo || null, references, probes, referenceCount: dbReferences.length, referencesTruncated: dbReferences.length > 500, routes: require('./api-catalog').catalog({ env, group: 'service:' + service, limit: 100 }),
    next: 'Review source SQL and choose its exact database before adding a PG probe. Use api_database_inspect for function bodies; field_trace for mapper/model references. Save a notebook, then explicitly run selected probes.',
    gaps: ['Indexed source candidates, not observed SQL executions. Dynamic SQL, generated mappers and internal libraries may be incomplete.', 'Independent reads are not a transactional snapshot of the service request.'] };
}
function comparisons(r) {
  return r.definition.comparisons.map(c => {
    const left = r.receipts.api, right = r.receipts[c.probe];
    const a = pointer(left?.data, c.response_path), b = pointer(right?.data, c.source_path);
    const status = !left || !right ? 'not-run' : left.state !== 'done' || right.state !== 'done' ? 'error' : !a.found || !b.found ? 'missing' : require('node:util').isDeepStrictEqual(a.value, b.value) ? 'equal' : 'different';
    return { ...c, status, response: a.found ? a.value : undefined, source: b.found ? b.value : undefined, responseAt: left?.at, sourceAt: right?.at, notice: 'Equality is an observation, not proof that this query produced the response.' };
  });
}
function exposed(r, full = false) {
  const base = { ...r, url: url(r.id) };
  if (r.kind === 'recording') {
    base.comparisons = comparisons(r);
    if (!full) { delete base.definition; delete base.history; base.receipts = Object.fromEntries(Object.entries(r.receipts).map(([k, v]) => [k, { state: v.state, at: v.at, ms: v.ms, error: v.error, total: v.total, truncated: v.truncated, exchange: v.exchange, executionId: v.executionId }])); base.comparisons = compactComparisons(base.comparisons); }
  }
  return base;
}
function compactComparisons(rows) { return rows.map(c => Object.fromEntries(Object.entries(c).map(([k,v]) => ['response','source'].includes(k) && JSON.stringify(v)?.length > 500 ? [k, { preview: JSON.stringify(v).slice(0,500), truncated:true }] : [k,v]))); }
async function run({ id, recording, steps, params = {}, auth_profile }) {
  const d = load(id); if (d.kind !== 'definition') throw D.invalid('Select a saved notebook definition');
  if (!Array.isArray(steps) || !steps.length || steps.length > 31 || new Set(steps).size !== steps.length || steps.some(s => s !== 'api' && !d.definition.probes.some(p => p.id === s)) || steps.includes('api') && !d.definition.request) throw D.invalid('Select unique probe ids or api (which explicitly sends the saved request)');
  const s = store(), rid = recording ? key(recording) : 'run-' + crypto.randomBytes(12).toString('hex'), release = s.lock(rid);
  let r;
  try {
    r = recording ? load(rid) : { id: rid, kind: 'recording', notebook: id, revision: d.revision, definition: d.definition, at: new Date().toISOString(), receipts: {} };
    if (r.kind !== 'recording' || r.notebook !== id || r.revision !== d.revision) throw D.invalid('Recording belongs to a different definition revision; start a new recording');
    { const all = index().list(); if (!recording && all.filter(r => r.kind === 'recording').length >= 200 || all.reduce((n, r) => n + r.bytes, 0) > 256 * 1048576) throw D.invalid('Recording budget reached; delete old recordings before running'); }
    r.history ||= [];
    if (r.history.length + steps.length > 100 || Buffer.byteLength(JSON.stringify(r)) > 5 * 1048576) throw D.invalid('This recording is full; start a new recording');
    for (const step of steps) {
      require('./execution').check();
      const p = step === 'api' ? null : d.definition.probes.find(p => p.id === step), env = p?.env || d.definition.env;
      C.getEnv(env);
      const at = new Date().toISOString(), started = Date.now();
      if (r.receipts[step]) r.history.push({ step, ...r.receipts[step] });
      r.receipts[step] = require('./state-machine').bind({ state: 'running', at, env, executionId: require('./execution').current()?.id || null, request: p || d.definition.request }, require('./lifecycles').mappingRead);
      write(s, r); require('./tool-events').progress('debug-probe', { step, recording: rid, state: 'running' });
      try {
        const T = require('./tools'); let value, data, total, truncated = false, exchange;
        if (step === 'api') {
          value = await T.call('api_request_replay', { request: d.definition.request, params, auth_profile, ...(d.definition.follow_service ? { service_target: { env, service: d.definition.service } } : {}) }, { source: 'mapping-debugger' });
          data = value.response.body.value; exchange = value.id;
          r.receipts[step].httpStatus = value.response.status; r.receipts[step].resolvedTarget = value.resolvedTarget; r.receipts[step].gaps = value.gaps;
        } else {
          const args = p.kind === 'pg' ? { sql: p.sql, db: p.db, params: p.params || [], max_rows:p.limit||50, limit: p.limit || 50 } : p.kind === 'es' ? { index: p.index, query: p.query || '', size: p.limit || 20 } : { topic: p.topic, n: p.limit || 5 };
          value = await T.call({ pg: 'pg_query', es: 'es_search', kafka: 'kafka_last' }[p.kind], { ...args, env }, { source: 'mapping-debugger' });
          const retained = value.view && require('./results').load(new URL(value.view).pathname.split('/').pop());
          data = (retained?.rows || value.rows || []).slice(0, p.limit || 50); total = value.totalHits ?? value.total; truncated = value.truncated === true || total > data.length;
        }
        if (Buffer.byteLength(JSON.stringify(data) || '') > 1048576 || Buffer.byteLength(JSON.stringify(r)) + Buffer.byteLength(JSON.stringify(data) || '') > 6 * 1048576) throw Error('Probe exceeds the 1 MiB result or 6 MiB recording evidence limit; narrow the query or start a new recording');
        Object.assign(r.receipts[step], { state: 'done', data: require('./redact').clean(data), total, truncated, exchange });
      } catch (error) {
        Object.assign(r.receipts[step], { state: require('./execution').signal()?.aborted ? 'cancelled' : 'error', error: require('./redact').clean(error.message), ...(error.exchange ? { exchange: error.exchange.id, failure: error.exchange.failure } : {}) });
      } finally { r.receipts[step].ms = Date.now() - started; write(s, r); }
      require('./tool-events').progress('debug-probe', { step, recording: rid, state: r.receipts[step].state });
    }
    return exposed(r);
  } finally { release(); }
}
function open(r) {
  const data = exposed(r, true), view = require('./results').saveView('mapping-debugger', data, { title: r.definition.title });
  return { id: r.id, revision: r.revision, url: url(r.id), view, ...(r.kind === 'recording' ? { comparisons: compactComparisons(comparisons(r)), receipts: exposed(r).receipts } : {}) };
}
function tool(a) {
  switch (a.action) {
    case 'discover': return discover(a);
    case 'save': return save(a);
    case 'list': return { notebooks: index().list().filter(r=>r.envs.every(A.allowsEnv)).filter(r => !a.q || (r.id + ' ' + r.title + ' ' + r.service).toLowerCase().includes(a.q.toLowerCase())).map(({bytes,envs,...r}) => ({...r,url:url(r.id)})).sort((a,b)=>b.at.localeCompare(a.at)) };
    case 'get': return exposed(load(a.id), a.include_data === true);
    case 'open': return open(load(a.id));
    case 'run': return run(a).then(r => ({ ...r, ...open(load(r.id)) }));
    case 'delete': { const s = store(); load(a.id); return s.update(key(a.id), r => { if (!r || r.revision !== a.expected_revision) throw D.invalid('Reload the current revision before deleting', 'STATE_CONFLICT', 409); require('node:fs').unlinkSync(s.safe(key(a.id) + '.json')); require('node:fs').rmSync(index().safe(key(a.id)+'.json'),{force:true}); return { id: a.id, deleted: true }; }); }
    default: throw D.invalid('Choose discover, save, list, get, open, run or delete');
  }
}
module.exports = { tool, definition, pointer, comparisons };
