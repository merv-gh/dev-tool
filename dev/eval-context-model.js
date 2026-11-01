#!/usr/bin/env node
// Opt-in real-model evaluation of durable Context. Synthetic data only; real registry/tool execution.
// Expected answers stay in this parent and are never included in model messages or readable stores.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { validateEndpoint } = require('./eval-discovery-model');
const hash = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const ENABLED = ['find', 'tool_search', 'tool_describe', 'tool_execute', 'tool_profiles', 'code', 'files_stores', 'files_list', 'files_search', 'files_read', 'script_list',
  'context_find', 'context_open', 'context_get', 'context_update', 'context_read', 'context_write', 'context_delete_file', 'context_run', 'context_hint'];
function history() { const file = require('../lib/calls').FILE; return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s)) : []; }
function put(root, rel, value) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(value)); }
function fixtures(root) {
  let state = 741093;
  const rand = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 65536) % n; };
  const merchants = ['m-amber', 'm-birch', 'm-coral', 'm-delta', 'm-elm', 'm-flint'];
  const currencies = ['USD', 'EUR', 'GBP'], days = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
  const fx = days.flatMap((day, i) => currencies.map((currency, j) => ({ day, currency, numerator: [10000, 10873 + i * 19, 12917 - i * 23][j], denominator: 10000 })));
  const invoices = [], payments = [], refunds = [];
  for (let i = 0; i < 720; i++) {
    const row = { id: 'inv-' + i, revision: 1, merchant: merchants[rand(6)], currency: currencies[rand(3)], day: days[rand(4)], amount: 500 + rand(95001), status: i % 19 === 0 ? 'void' : 'active' };
    invoices.push(row); if (i % 13 === 0) invoices.push({ ...row, revision: 2, amount: row.amount + 37, status: i % 39 === 0 ? 'void' : 'active' });
    const pay = { id: 'pay-' + i, revision: 1, invoice: row.id, currency: row.currency, day: days[rand(4)], amount: row.amount - rand(100), status: i % 11 === 0 ? 'pending' : 'settled' };
    payments.push(pay); if (i % 17 === 0) payments.push({ ...pay, revision: 2, amount: pay.amount + 41 });
    if (i % 3 === 0) refunds.push({ id: 'ref-' + i, revision: 1, invoice: row.id, currency: row.currency, day: days[rand(4)], amount: 1 + rand(2001), status: i % 15 === 0 ? 'rejected' : 'approved' });
  }
  const policy = { ticket: 'FIN-731', merchants, repositories: ['FIN/ledger', 'FIN/settlements'], source: 'Synthetic audit exports', rules: [
    'Deduplicate each export by id, keeping the highest revision. Input order is not authoritative.',
    'Exclude void invoices and every payment/refund linked to a void invoice. All references exist.',
    'invoice_count and invoiced_cents count active invoices. paid_cents uses only settled payments. refund_cents uses only approved refunds.',
    'Convert EACH record to USD cents using its own currency/day: floor((amount * numerator + denominator/2) / denominator). Round each record before summing. net_cents = paid_cents - refund_cents.',
  ] };
  const shuffle = a => a.slice().sort((x, y) => hash(x).localeCompare(hash(y)));
  for (const [name, rows] of Object.entries({ invoices, payments, refunds })) {
    const values = shuffle(rows); for (let i = 0; i < values.length; i += 200) put(root, `ledger/${name}-${Math.floor(i / 200)}.json`, values.slice(i, i + 200));
  }
  put(root, 'ledger/fx.json', fx); put(root, 'ledger/policy.json', policy);
  // Independent answer calculation: materialized revision maps + integer currency lookup.
  const latest = rows => { const out = new Map(); for (const r of rows) if (!out.has(r.id) || out.get(r.id).revision < r.revision) out.set(r.id, r); return out; };
  const active = new Map([...latest(invoices)].filter(([, r]) => r.status === 'active'));
  const converted = r => { const f = fx.find(f => f.day === r.day && f.currency === r.currency); return Math.floor((r.amount * f.numerator + f.denominator / 2) / f.denominator); };
  const ledger = merchants.map(merchant => {
    const inv = [...active.values()].filter(r => r.merchant === merchant), ids = new Set(inv.map(r => r.id));
    const paid = [...latest(payments).values()].filter(r => ids.has(r.invoice) && r.status === 'settled').reduce((n, r) => n + converted(r), 0);
    const refund = [...latest(refunds).values()].filter(r => ids.has(r.invoice) && r.status === 'approved').reduce((n, r) => n + converted(r), 0);
    return { merchant, invoice_count: inv.length, invoiced_cents: inv.reduce((n, r) => n + converted(r), 0), paid_cents: paid, refund_cents: refund, net_cents: paid - refund };
  });
  const totals = Object.fromEntries(['invoice_count', 'invoiced_cents', 'paid_cents', 'refund_cents', 'net_cents'].map(k => [k, ledger.reduce((n, r) => n + r[k], 0)]));
  const reserve = ledger.map(r => { const reserve_cents = Math.min(125000, Math.floor((Math.max(0, r.net_cents) * 725 + 5000) / 10000)); return { merchant: r.merchant, net_cents: r.net_cents, reserve_cents, available_cents: r.net_cents - reserve_cents }; });
  const regions = ['east', 'west', 'central', 'south'], services = Array.from({ length: 8 }, (_, i) => 'svc-' + i);
  const hours = Array.from({ length: 48 }, (_, i) => i), rows = [];
  for (const region of regions) for (const hour of hours) for (const service of services) rows.push({ region, hour, service, rps: 50 + rand(900) });
  const cp = { ticket: 'OPS-228', failed_region: 'east', surviving_regions: ['west', 'central', 'south'], routing_percent: { west: 50, central: 30, south: 20 }, growth_bps: 13500, utilization_bps: 7000, pod_millicpu: 2000,
    millicpu_per_rps: Object.fromEntries(services.map((s, i) => [s, 1 + i % 4])), available_pods: { west: 5, central: 6, south: 4 }, monthly_pod_cents: { west: 11700, central: 9200, south: 10100 },
    rules: ['For each hour/service, route east RPS independently to each survivor using ceil(east_rps * routing_percent / 100). Add its own RPS.', 'Sum routed RPS * millicpu_per_rps across services. Required pods = ceil(load_millicpu * growth_bps / (pod_millicpu * utilization_bps)).', 'For each survivor take the maximum required pods over all 48 hours. For ties use the earliest hour. extra_pods = max(0, required_pods - available_pods). Costs are monthly cents.'] };
  for (const region of regions) put(root, `capacity/${region}.json`, rows.filter(r => r.region === region));
  put(root, 'capacity/policy.json', cp);
  const capacity = cp.surviving_regions.map(region => {
    const demand = hours.map(hour => {
      const load = services.reduce((n, service) => {
        const own = rows.find(r => r.region === region && r.hour === hour && r.service === service).rps;
        const failed = rows.find(r => r.region === 'east' && r.hour === hour && r.service === service).rps;
        return n + (own + Math.ceil(failed * cp.routing_percent[region] / 100)) * cp.millicpu_per_rps[service];
      }, 0);
      return { hour, pods: Math.ceil(load * cp.growth_bps / (cp.pod_millicpu * cp.utilization_bps)) };
    });
    const peak = demand.reduce((a, b) => b.pods > a.pods ? b : a), extra_pods = Math.max(0, peak.pods - cp.available_pods[region]);
    return { region, peak_hour: peak.hour, required_pods: peak.pods, extra_pods, monthly_extra_cents: extra_pods * cp.monthly_pod_cents[region] };
  });
  const related = ledger.map(r => { const reserve_cents = Math.min(500000, Math.floor((Math.max(0, r.net_cents) * 825 + 5000) / 10000)); return { merchant: r.merchant, net_cents: r.net_cents, reserve_cents, available_cents: r.net_cents - reserve_cents }; });
  return { related: { merchants: related, total_reserve_cents: related.reduce((n, r) => n + r.reserve_cents, 0), total_available_cents: related.reduce((n, r) => n + r.available_cents, 0) }, ledger: { merchants: ledger, totals }, reserve: { merchants: reserve, total_reserve_cents: reserve.reduce((n, r) => n + r.reserve_cents, 0), total_available_cents: reserve.reduce((n, r) => n + r.available_cents, 0) }, capacity: { regions: capacity, total_monthly_extra_cents: capacity.reduce((n, r) => n + r.monthly_extra_cents, 0) }, sizes: { invoices: invoices.length, payments: payments.length, refunds: refunds.length, capacity: rows.length }, corpusSha256: hash({ invoices, payments, refunds, fx, rows, cp }) };
}
const QUESTIONS = [
  { id: 'related', prompt: 'FIN-624 follow-up: find our completed merchant reconciliation for FIN/ledger and FIN/settlements. The original exports are unavailable. Using the saved verified merchant nets, calculate an 8.25% reserve on each positive net, round half-up to cents, cap at 500000 cents per merchant. Give JSON with merchants (merchant, net_cents, reserve_cents, available_cents), total_reserve_cents and total_available_cents. Explain where you found the earlier work and evidence.' },
  { id: 'ledger', prompt: 'FIN-731: Reconcile the October ledger exports in file store audit-exports, directory ledger. Follow its policy.json exactly; corrections and mixed currencies make a manual sum unreliable. Give JSON with merchants (merchant, invoice_count, invoiced_cents, paid_cents, refund_cents, net_cents) and totals for those numeric fields, all exact integer USD cents. Explain the calculation and sources briefly. This audit will continue in another chat.' },
  { id: 'reserve', prompt: 'Continue FIN-731 from the earlier chat. The original ledger exports are now offline. Finance wants a reserve of 7.25% of each merchant’s positive reconciled net, rounded half-up to cents, capped at 125000 cents per merchant. Recompute using our verified reconciliation, without guessing. Give JSON with merchants (merchant, net_cents, reserve_cents, available_cents), total_reserve_cents and total_available_cents, and say where the earlier figures came from.' },
  { id: 'capacity', prompt: 'OPS-228: Plan capacity for the east-region outage using file store audit-exports, directory capacity. Apply every rule in policy.json to all service/hour exports, including growth, routing rounding, utilization and earliest-hour ties. Give JSON with regions (region, peak_hour, required_pods, extra_pods, monthly_extra_cents) and total_monthly_extra_cents. Explain the limiting hours and keep enough evidence that another engineer can audit the decision later.' },
];
function jsonAnswer(text) {
  const candidates = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  candidates.push(text, String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1));
  for (const c of candidates) try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch {}
  return null;
}
function grade(id, actual, expected) {
  const differences = [], rowsKey = id === 'capacity' ? 'regions' : 'merchants', key = id === 'capacity' ? 'region' : 'merchant';
  if (!actual) return { passed: false, differences: ['No parseable JSON answer'] };
  if (!Array.isArray(actual[rowsKey])) return { passed: false, differences: ['Answer requires an array: ' + rowsKey] };
  for (const wanted of expected[rowsKey]) {
    const got = actual[rowsKey]?.find(r => r?.[key] === wanted[key]);
    for (const [field, value] of Object.entries(wanted)) if (got?.[field] !== value) differences.push({ row: wanted[key], field, expected: value, actual: got?.[field] });
  }
  if (actual[rowsKey]?.length !== expected[rowsKey].length) differences.push({ field: rowsKey + '.length', expected: expected[rowsKey].length, actual: actual[rowsKey]?.length });
  for (const [field, value] of Object.entries(expected)) if (field !== rowsKey) {
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) if (actual[field]?.[k] !== v) differences.push({ field: field + '.' + k, expected: v, actual: actual[field]?.[k] });
    } else if (actual[field] !== value) differences.push({ field, expected: value, actual: actual[field] });
  }
  return { passed: !differences.length, differences };
}
function options(argv) {
  const out = { endpoint: 'http://127.0.0.1:41435/v1', profile: 'direct', cases: 'ledger,reserve,capacity', thinking: false, maxTurns: 24, maxCalls: 64, maxTokens: 4096, timeoutMs: 300000, maxContextBytes: 500000, maxDurationMs: 1800000 };
  for (let i = 0; i < argv.length; i += 2) { const k = argv[i].replace(/^--/, ''); if (argv[i + 1] === undefined || !['endpoint', 'profile', 'model', 'output', 'maxTurns', 'maxCalls', 'maxTokens', 'timeoutMs', 'maxDurationMs', 'thinking', 'cases'].includes(k)) throw Error('Unknown/missing option ' + argv[i]); out[k] = ['endpoint', 'profile', 'model', 'output', 'thinking', 'cases'].includes(k) ? argv[i + 1] : Number(argv[i + 1]); }
  if (typeof out.thinking === 'string') { if (!['true', 'false'].includes(out.thinking)) throw Error('thinking must be true or false'); out.thinking = out.thinking === 'true'; }
  if (!out.model || !out.output) throw Error('--model and --output required');
  for (const k of ['maxTurns', 'maxCalls', 'maxTokens', 'timeoutMs', 'maxDurationMs']) if (!Number.isSafeInteger(out[k]) || out[k] < 1 || out[k] > ({ maxTurns: 40, maxCalls: 128, maxTokens: 8192, timeoutMs: 300000, maxDurationMs: 3600000 })[k]) throw Error('Invalid budget ' + k);
  if (out.cases.split(',').some(id => !QUESTIONS.some(q => q.id === id))) throw Error('Unknown case');
  out.endpoint = validateEndpoint(out.endpoint, false); return out;
}
async function run(o) {
  if (require.cache[require.resolve('../lib/tools')]) throw Error('Run in a fresh process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-context-model-')), exportsRoot = path.join(home, 'exports');
  for (const k of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS)$/.test(k)) delete process.env[k];
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  const oracle = fixtures(exportsRoot);
  put(home, 'config.json', { envs: { evaluation: {} }, tools: { enable: ENABLED, profile: o.profile }, scripts: { starters: false }, files: { 'audit-exports': { type: 'local', path: 'exports' } } });
  const T = require('../lib/tools');
  // Tool names can also be group names (notably code). Disable unintended group members explicitly.
  const active = await T.schemas();
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json')));
  cfg.tools.disable = active.filter(t => !ENABLED.includes(t.name)).map(t => t.name);
  put(home, 'config.json', cfg); await T.reload();
  if ((await T.schemas()).some(t => !ENABLED.includes(t.name))) throw Error('Evaluation tool allowlist was not applied');
  const schemas = await T.schemas({ profile: o.profile }), wire = schemas.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const prompt = require('../lib/webui').prompt(), samples = [], deadline = Date.now() + o.maxDurationMs;
  let serverModel;
  try { const tags = await (await fetch(o.endpoint.replace(/\/v1$/, '') + '/api/tags', { signal: AbortSignal.timeout(10000) })).json(); serverModel = tags.models?.find(m => m.name === o.model); } catch {}
  const report = { kind: 'real-model-context-evaluation', model: o.model, serverModel, endpoint: o.endpoint, observedAt: new Date().toISOString(), profile: o.profile, enabledTools: (await T.schemas()).map(t => t.name), exposedTools: schemas.map(t => t.name), promptSha256: hash(prompt), schemaSha256: hash(wire), corpusSha256: oracle.corpusSha256, transport: 'ollama-native', contextTokens: 32768, thinking: o.thinking, sourceSha256: hash(['context.js', 'tools-context.js', 'tools.js'].map(f => fs.readFileSync(path.join(__dirname, '../lib', f), 'utf8'))), sizes: oracle.sizes, home, samples, budgets: o, syntheticOnly: true, oracleExposedToModel: false };
  const persist = () => { fs.mkdirSync(path.dirname(path.resolve(o.output)), { recursive: true }); fs.writeFileSync(o.output, JSON.stringify(report, null, 2)); };
  for (const item of o.cases.split(',').map(id => QUESTIONS.find(q => q.id === id))) {
    if (Date.now() >= deadline) break;
    if (item.id === 'related') {
      const C = require('../lib/context'), c = C.open({ title: 'Completed merchant reconciliation', tickets: ['FIN-624'], repositories: ['FIN/ledger', 'FIN/settlements'], status: 'done', summary: 'Verified synthetic merchant nets; worked example from an earlier task. Evidence is split across three JSON files.' });
      C.write({ id: c.id, path: 'progress.md', content: '# Completed reconciliation FIN-624\nSynthetic archived worked example. Source exports are offline. Verified results are in results/nets-0.json, results/nets-1.json and results/nets-2.json. All amounts are integer USD cents. Source dataset SHA256: ' + oracle.corpusSha256, summary: 'Completed task and provenance; links to saved verified merchant nets' });
      for (let i = 0; i < 3; i++) C.write({ id: c.id, path: `results/nets-${i}.json`, content: JSON.stringify(oracle.ledger.merchants.slice(i * 2, i * 2 + 2).map(({ merchant, net_cents }) => ({ merchant, net_cents }))), summary: 'Verified merchant net amounts, part ' + i });
      report.seededMemory = { ticket: 'FIN-624', context: c.id, scope: 'Pre-existing worked example seeded by evaluator; never credited as model-created checkpoint. New reserve answers remain private.' };
    }
    if (['reserve', 'related'].includes(item.id) && fs.existsSync(path.join(exportsRoot, 'ledger'))) fs.renameSync(path.join(exportsRoot, 'ledger'), path.join(home, 'offline-ledger'));
    const historyOffset = history().length;
    const messages = [{ role: 'system', content: prompt }, { role: 'user', content: item.prompt }], events = [], start = Date.now(), session = `evaluation-${item.id}-${crypto.randomUUID()}`;
    const sample = { id: item.id, question: item.prompt, events, finish: 'turn-budget', turns: 0, modelResponseIds: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }; samples.push(sample);
    let calls = 0;
    for (let turn = 0; turn < o.maxTurns; turn++) {
      sample.turns = turn + 1;
      if (Date.now() >= deadline) { sample.finish = 'wall-clock-budget'; break; }
      const nativeMessages = messages.map(m => ({ ...m, ...(m.tool_calls ? { tool_calls: m.tool_calls.map(c => ({ ...c, function: { ...c.function, arguments: JSON.parse(c.function.arguments) } })) } : {}) }));
      const body = { model: o.model, messages: nativeMessages, tools: wire, options: { temperature: 0, num_predict: o.maxTokens, num_ctx: 32768 }, stream: false, think: o.thinking };
      if (Buffer.byteLength(JSON.stringify(body)) > o.maxContextBytes) { sample.finish = 'context-budget'; break; }
      console.error(`${o.model} ${item.id} turn ${turn + 1} input=${Buffer.byteLength(JSON.stringify(body))}`);
      let response;
      try {
        const r = await fetch(o.endpoint.replace(/\/v1$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(o.timeoutMs, deadline - Date.now())) });
        if (!r.ok) throw Error('Endpoint HTTP ' + r.status);
        response = await r.json();
      } catch (e) { sample.finish = 'endpoint-error'; sample.error = e.message; break; }
      sample.modelResponseIds.push(response.model);
      if (response.message) { response.choices = [{ message: response.message }]; response.usage = { prompt_tokens: response.prompt_eval_count || 0, completion_tokens: response.eval_count || 0 }; }
      for (const k of ['prompt_tokens', 'completion_tokens']) sample.usage[k] += response.usage?.[k] || 0;
      const raw = response.choices?.[0]?.message;
      if (raw?.tool_calls) raw.tool_calls = raw.tool_calls.map((c, i) => ({ ...c, id: c.id || `call-${turn}-${i}`, type: 'function', function: { ...c.function, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments) } }));
      if (!raw) { sample.finish = 'invalid-response'; break; }
      const m = { role: 'assistant', content: raw.content || null, ...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}) }; messages.push(m);
      if (!m.tool_calls?.length) { sample.final = m.content || ''; sample.finish = response.done_reason === 'length' ? 'output-token-budget' : 'assistant-finished'; break; }
      for (const call of m.tool_calls) {
        if (++calls > o.maxCalls) { sample.finish = 'call-budget'; break; }
        const name = call.function?.name; let args, value, error;
        try {
          if (!schemas.some(t => t.name === name)) throw Error('Tool not exposed in this profile; discover and execute using exposed tools');
          args = JSON.parse(call.function.arguments);
          value = await T.call(name, args, { source: 'model-evaluation', session });
        } catch (e) { error = { error: e.message, code: e.code }; value = error; }
        events.push({ name, arguments: args, ok: !error, result: value, ms: Date.now() - start });
        console.error(`  ${name}${name === 'tool_execute' ? ':' + args?.name : ''} ${error ? error.error : 'ok'}`);
        messages.push({ role: 'tool', tool_call_id: call.id, tool_name: name, content: JSON.stringify(value) });
        persist();
      }
      if (calls > o.maxCalls) break;
    }
    sample.grade = grade(item.id, jsonAnswer(sample.final), oracle[item.id]);
    sample.latencyMs = Date.now() - start;
    sample.executedCalls = history().slice(historyOffset).map(c => ({ tool: c.tool, source: c.source, ok: c.ok, args: c.args, ...(c.error ? { error: c.error } : {}) }));
    sample.sourceReads = sample.executedCalls.filter(c => c.tool === 'files_read').length;
    sample.memoryReads = sample.executedCalls.filter(c => c.tool === 'context_read').length;
    sample.memoryWrites = sample.executedCalls.filter(c => ['context_write', 'context_run', 'context_update'].includes(c.tool)).length;
    const contexts = require('../lib/context').find({ limit: 100 }).contexts;
    sample.persistedContexts = contexts.map(c => ({ id: c.id, title: c.title, tickets: c.tickets, files: require('../lib/context').get(c.id).files }));
    sample.contextUsed = events.some(e => (e.name === 'tool_execute' ? e.arguments?.name : e.name)?.startsWith('context_') || (e.result?.calls || []).some(c => c.startsWith('context_')));
    sample.transcript = messages;
    persist(); console.error(`RESULT ${item.id}: ${sample.grade.passed ? 'PASS' : 'FAIL'} contextUsed=${sample.contextUsed} finish=${sample.finish}`);
  }
  report.completedAt = new Date().toISOString(); report.summary = { cases: samples.length, correctAnswers: samples.filter(s => s.grade.passed).length, contextUsed: samples.filter(s => s.contextUsed).length };
  persist(); return report;
}
if (require.main === module) run(options(process.argv.slice(2))).then(r => console.log(JSON.stringify({ output: r.budgets.output, home: r.home, ...r.summary }))).catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { fixtures, grade, jsonAnswer, options, QUESTIONS };
