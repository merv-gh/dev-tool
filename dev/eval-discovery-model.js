#!/usr/bin/env node
// Opt-in discovery evaluation against an explicitly chosen OpenAI-compatible endpoint.
// Only synthetic questions/cache and tool schemas leave this process. Task tools
// are schema-checked, never executed; this is not an application-success benchmark.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { performance } = require('perf_hooks');
const corpusText = fs.readFileSync(path.join(__dirname, 'eval/compact-discovery.corpus.json'), 'utf8');
const corpus = JSON.parse(corpusText);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function args(argv) {
  const o = { profile: 'lean', discoveryRanker: 'legacy', maxTurns: 8, maxCalls: 24, maxContextBytes: 65536, maxOutputTokens: 1024, limit: corpus.cases.length, timeoutMs: 30000, maxDurationMs: 600000 };
  const names = { endpoint: 'endpoint', model: 'model', profile: 'profile', ranker: 'discoveryRanker', 'max-turns': 'maxTurns', 'max-calls': 'maxCalls', 'max-context-bytes': 'maxContextBytes', 'max-output-tokens': 'maxOutputTokens', limit: 'limit', 'timeout-ms': 'timeoutMs', 'max-duration-ms': 'maxDurationMs', 'input-usd-per-million': 'inputPrice', 'output-usd-per-million': 'outputPrice' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['use-configured-llm', 'allow-remote', 'scripted-endpoint'].includes(key)) { o[key] = true; continue; }
    if (!names[key] || argv[i + 1] === undefined) throw new Error('Unknown or missing argument ' + argv[i]);
    o[names[key]] = ['endpoint', 'model', 'profile', 'ranker'].includes(key) ? argv[++i] : Number(argv[++i]);
  }
  for (const [key, max] of Object.entries({ maxTurns: 16, maxCalls: 64, maxContextBytes: 262144, maxOutputTokens: 4096, limit: corpus.cases.length, timeoutMs: 60000, maxDurationMs: 3600000 })) if (!Number.isInteger(o[key]) || o[key] < 1 || o[key] > max) throw new Error(`Invalid bounded ${key} (1..${max})`);
  for (const key of ['inputPrice', 'outputPrice']) if (o[key] !== undefined && (!Number.isFinite(o[key]) || o[key] < 0)) throw new Error('Invalid ' + key);
  if (!['legacy', 'bm25'].includes(o.discoveryRanker)) throw new Error('Ranker must be legacy or bm25');
  return o;
}
function validateEndpoint(endpoint, allowRemote) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Endpoint must be an HTTP(S) base URL without credentials, query or fragment');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !allowRemote) throw new Error('Remote endpoint requires explicit --allow-remote; only synthetic evaluation input will be sent');
  return url.toString().replace(/\/$/, '');
}
async function run(options) {
  if (require.cache[require.resolve('../lib/tools')]) throw new Error('Run model evaluation in a fresh process before importing the registry');
  let configured;
  if (options['use-configured-llm']) {
    if (options.endpoint) throw new Error('Choose --endpoint or --use-configured-llm');
    const cfg = require('../lib/config');
    try { configured = cfg.getPersonal().llm; } catch { throw new Error('Could not resolve configured LLM; check local configuration'); }
    // config has no dependent imports; drop it before selecting the temporary home.
    delete require.cache[require.resolve('../lib/config')];
  }
  if (!options.endpoint && !configured?.baseUrl) throw new Error('Choose --endpoint or configure llm.baseUrl with --use-configured-llm');
  const endpoint = validateEndpoint(options.endpoint || configured?.baseUrl, options['allow-remote']);
  const model = options.model || configured?.model;
  if (!model) throw new Error('An explicit model id is required; use --model or configured llm.model');
  const key = process.env.DT_EVAL_API_KEY || configured?.key;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-model-discovery-'));
  for (const k of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS)$/.test(k)) delete process.env[k];
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  require('./eval/discovery-fixture').seed(home, { discoveryRanker: options.discoveryRanker });
  const T = require('../lib/tools'), Schema = require('../lib/schema');
  try {
    const definitions = await T.schemas({ profile: options.profile }), all = await T.schemas({ metadata: true });
    const exposed = new Set(definitions.map(t => t.name));
    const schemas = definitions.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const deadline = performance.now() + options.maxDurationMs;
    async function request(route, body) {
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) throw new Error('Evaluation wall clock budget exhausted');
      const r = await fetch(endpoint + route, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(Math.min(options.timeoutMs, remaining)) });
      if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error('Endpoint HTTP ' + r.status); } // Never echo server errors containing credentials.
      const reader = r.body.getReader(), chunks = []; let total = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 1024 * 1024) throw new Error('Endpoint response exceeds 1 MiB'); chunks.push(Buffer.from(value)); } }
      catch (e) { await reader.cancel().catch(() => {}); throw e; }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    let advertised;
    try { const r = await request('/models'); advertised = { status: 'available', models: (r.data || []).slice(0, 100).map(m => ({ id: m.id, owned_by: m.owned_by })) }; }
    catch (e) { advertised = { status: 'unavailable', reason: e.message }; }
    const usage = { prompt_tokens: 0, completion_tokens: 0, reportedCalls: 0 }, samples = [], returnedModels = new Set();
    for (const item of corpus.cases.slice(0, options.limit)) {
      if (performance.now() >= deadline) break;
      const messages = [{ role: 'system', content: 'Find the correct dev-tool capability for the user task. Start with available discovery tools, inspect exact schemas and choose useful next tools. Keep environment and identities explicit. More profiles are available through tool_profiles. This is an offline discovery evaluation: task operations only validate arguments and return executionPerformed=false. Do not claim application execution or task completion.' }, { role: 'user', content: item.query }];
      const selected = new Set(), calls = [], start = performance.now(); let finish = 'turn-budget', turns = 0;
      for (; turns < options.maxTurns; turns++) {
        if (performance.now() >= deadline) { finish = 'wall-clock-budget'; break; }
        const body = { model, temperature: 0, max_tokens: options.maxOutputTokens, tools: schemas, tool_choice: 'auto', messages };
        if (Buffer.byteLength(JSON.stringify(body)) > options.maxContextBytes) { finish = 'context-budget'; break; }
        let response;
        try { response = await request('/chat/completions', body); } catch (e) { finish = e.name === 'TimeoutError' ? 'timeout' : 'endpoint-error'; break; }
        if (response.model) returnedModels.add(response.model);
        if (response.usage) { usage.reportedCalls++; for (const k of ['prompt_tokens', 'completion_tokens']) if (Number.isSafeInteger(response.usage[k]) && response.usage[k] >= 0) usage[k] += response.usage[k]; }
        const message = response.choices?.[0]?.message;
        if (!message || message.role !== 'assistant') { finish = 'invalid-response'; break; }
        messages.push(message);
        const toolCalls = message.tool_calls || [];
        if (!Array.isArray(toolCalls)) { finish = 'invalid-response'; break; }
        if (!toolCalls.length) { finish = 'assistant-finished'; break; }
        if (calls.length + toolCalls.length > options.maxCalls) { finish = 'call-budget'; break; }
        for (const c of toolCalls) {
          let result, name = c.function?.name, input;
          try {
            if (!c.id || c.type !== 'function' || !exposed.has(name)) throw Object.assign(new Error('Tool is not exposed by the selected profile'), { code: 'DT_EVAL_TOOL_UNAVAILABLE' });
            input = JSON.parse(c.function.arguments);
            const schema = all.find(t => t.name === name); Schema.assert(input, schema.inputSchema);
            if (['tool_search', 'tool_describe', 'tool_profiles', 'find'].includes(name)) {
              result = await T.call(name, input);
              if (name === 'tool_describe') selected.add(input.name);
            } else {
              const target = name === 'tool_execute' ? input.name : name;
              if (['tool_execute', 'tool_search', 'tool_describe', 'tool_profiles'].includes(target)) throw Object.assign(new Error('Call discovery tools directly'), { code: 'DT_ARGUMENT_INVALID' });
              const definition = all.find(t => t.name === target);
              if (!definition) throw Object.assign(new Error('Unknown or disabled tool'), { code: 'DT_TOOL_UNKNOWN' });
              Schema.assert(name === 'tool_execute' ? input.arguments : input, definition.inputSchema);
              selected.add(target); result = { evaluation: 'schema-validation-only', executionPerformed: false, tool: target, validArguments: true };
            }
            calls.push({ tool: name, target: input?.name, ok: true });
          } catch (e) { result = { error: e.message, code: e.code || 'DT_ARGUMENT_INVALID', issues: e.issues }; calls.push({ tool: name, target: input?.name, ok: false, code: result.code }); }
          messages.push({ role: 'tool', tool_call_id: c.id || 'invalid', content: JSON.stringify(result) });
        }
      }
      // Relevance judgments are used only after the model conversation finishes.
      samples.push({ id: item.id, selected: [...selected], relevant: item.relevant, recall: item.relevant.filter(t => selected.has(t)).length / item.relevant.length, finish, turns: Math.min(turns + 1, options.maxTurns), calls, latencyMs: performance.now() - start, lastContextBytes: Buffer.byteLength(JSON.stringify(messages)), applicationExecutionPerformed: false });
    }
    const scripted = options['scripted-endpoint'] || model === 'demo-model';
    return { version: 1, kind: scripted ? 'scripted-endpoint-contract-check' : 'model-discovery-evaluation', observedAt: new Date().toISOString(), provenance: { endpoint, requestedModel: model, returnedModels: [...returnedModels], advertised, modelSizeVerified: false, corpusSha256: hash(corpusText), schemaSha256: hash(JSON.stringify(schemas)), profile: options.profile, ranker: options.discoveryRanker, schemaCount: schemas.length, schemaUtf8Bytes: Buffer.byteLength(JSON.stringify(schemas)), runtime: process.version }, budget: { maxTurns: options.maxTurns, maxCalls: options.maxCalls, maxContextBytes: options.maxContextBytes, maxOutputTokens: options.maxOutputTokens, maxDurationMs: options.maxDurationMs, requestedCases: options.limit, exhausted: performance.now() >= deadline }, usage, estimatedCostUsd: usage.reportedCalls && options.inputPrice !== undefined && options.outputPrice !== undefined ? (usage.prompt_tokens * options.inputPrice + usage.completion_tokens * options.outputPrice) / 1e6 : null, metrics: { cases: samples.length, meanSelectionRecall: samples.length ? samples.reduce((n, c) => n + c.recall, 0) / samples.length : null, invalidCalls: samples.reduce((n, s) => n + s.calls.filter(c => !c.ok).length, 0) }, limits: 'Only discovery/schema selection is measured. No code execution, fixture/task answer, live system access, model size verification or production certification. Token usage is provider-reported; cost is estimated only with explicit prices. Scripted endpoints are never model evidence.', samples };
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
if (require.main === module) Promise.resolve().then(() => run(args(process.argv.slice(2)))).then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { args, validateEndpoint, run };
