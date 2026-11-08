#!/usr/bin/env node
// Opt-in real Joern + real model evaluation. Only a generated service can be read/edited.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const F = require('./branch-flow-fixture');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const ALLOWED = ['semantic_index', 'semantic_search', 'semantic_query', 'code_search', 'code_read', 'workspace_read', 'workspace_write', 'workspace_patch', 'test_run', 'tool_search', 'tool_describe'];
function options(argv) {
  const o = { endpoint: 'http://127.0.0.1:41435', semanticUrl: 'http://127.0.0.1:44110', model: 'qwen3.5:4b', home: 'work/branch-flows/home', output: 'work/branch-flows/evaluation.json', maxTurns: 22, maxCalls: 48, maxTokens: 2200, timeoutMs: 180000, maxDurationMs: 1200000, maxContextBytes: 160000, format: 'default', task: 'bug', profile:'direct',verification:'smoke' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in o) || argv[i + 1] == null) throw Error('Unknown or missing option: ' + argv[i]);
    o[key] = typeof o[key] === 'number' ? Number(argv[i + 1]) : argv[i + 1];
  }
  for (const key of ['endpoint', 'semanticUrl']) {
    const u = new URL(o[key]);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw Error('Use loopback endpoints (SSH tunnels supported)');
    o[key] = u.origin;
  }
  for (const key of ['maxTurns', 'maxCalls', 'maxTokens', 'timeoutMs', 'maxDurationMs', 'maxContextBytes']) if (!Number.isSafeInteger(o[key]) || o[key] < 1 || o[key] > ({ maxTurns: 40, maxCalls: 100, maxTokens: 8192, timeoutMs: 300000, maxDurationMs: 3600000, maxContextBytes: 1000000 })[key]) throw Error('Invalid budget: ' + key);
  if (!['default', 'full', 'compact'].includes(o.format) || !['bug', 'feature'].includes(o.task)) throw Error('Invalid format/task');
  if(!['direct','evidence'].includes(o.profile))throw Error('Invalid profile');
  if(!['smoke','regression'].includes(o.verification))throw Error('Invalid verification mode');
  o.home = path.resolve(o.home); o.output = path.resolve(o.output);
  return o;
}
async function run(o) {
  if (require.cache[require.resolve('../lib/config')]) throw Error('Use a fresh process');
  const token = process.env.DT_SEMANTIC_LIVE_TOKEN;
  if (!token || token.length < 16) throw Error('DT_SEMANTIC_LIVE_TOKEN is required');
  for (const key of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS|SEMANTIC_URL|SEMANTIC_TOKEN)$/.test(key)) delete process.env[key];
  process.env.DT_HOME = o.home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0'; process.env.DT_NO_DOCTOR = '1'; process.env.DT_SEMANTIC_TOKEN = token;
  fs.mkdirSync(o.home, { recursive: true });
  const cfg = { envs: { evaluation: {} }, semantic: { url: o.semanticUrl, token: '${DT_SEMANTIC_TOKEN}' }, scripts: { starters: false }, tools: { enable: ALLOWED }, tests: { waitMs: 30000, timeoutMs: 30000, compileCheck: false, compileFix: false } };
  const saveConfig = () => fs.writeFileSync(path.join(o.home, 'config.json'), JSON.stringify(cfg)); saveConfig();
  const T = require('../lib/tools'), CI = require('../lib/codeindex'), S = require('../lib/semantic-code'), W = require('../lib/workspace');
  cfg.tools.disable = (await T.schemas()).filter(t => !ALLOWED.includes(t.name)).map(t => t.name); saveConfig(); await T.reload();
  const exposed=o.profile==='evidence'?['semantic_query','workspace_read','workspace_write','test_run']:ALLOWED;
  const schemas = (await T.schemas()).filter(t => exposed.includes(t.name));
  const wire = schemas.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const settle = async (name, args) => {
    let v = await T.call(name, args);
    const end = Date.now() + 12 * 60000;
    while (v.state === 'running' && Date.now() < end) { console.error(name + ': observing owned job'); v = await T.call(name, { ...(name === 'semantic_query' ? { operation: args.operation } : {}), job: v.job, waitMs: 30000 }); }
    if (v.state === 'running' || v.error || v.state === 'failed') throw Error(name + ': ' + JSON.stringify(v));
    return v;
  };
  const stateFile = path.join(o.home, 'fixture.json'); let state;
  if (fs.existsSync(stateFile)) { state = JSON.parse(fs.readFileSync(stateFile)); S.load(state.baseAnalysis); S.load(state.featureAnalysis); }
  else {
    const fixture = F.create(path.join(o.home, 'service'));
    const baseRoot = path.join(o.home, 'baseline'); F.git(fixture.root, ['worktree', 'add', '--detach', '--quiet', baseRoot, fixture.baseline]);
    const base = CI.build(baseRoot, fixture.repo, { project: 'DEMO', repo: 'payments', sha: fixture.baseline, ref: 'main', service: 'payments' });
    const feature = CI.build(fixture.root, fixture.repo, { project: 'DEMO', repo: 'payments', sha: fixture.feature, ref: 'feature/rebates', service: 'payments' });
    console.error('Parsing baseline with real Joern'); const a = await settle('semantic_index', { revisionKey: base.revisionKey, language:'java', waitMs: 0 });
    console.error('Parsing feature with real Joern'); const b = await settle('semantic_index', { revisionKey: feature.revisionKey, language:'java', waitMs: 0 });
    state = { ...fixture, baseKey: base.revisionKey, featureKey: feature.revisionKey, baseAnalysis: a.analyses[0].id, featureAnalysis: b.analyses[0].id };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
  const workspace = await W.open({ project: 'DEMO', repo: 'payments', ref: o.task === 'bug' ? 'feature/rebates' : 'main', url: state.root, fresh: true });
  if(o.verification==='regression'&&!fs.existsSync(path.join(W.checkId(workspace.id).path,'test/rebate.test.cjs')))throw Error('Use a fresh --home for the fixture with a public rebate regression');
  const initial = F.grade(W.checkId(workspace.id).path);
  const tags = await (await fetch(o.endpoint + '/api/tags', { signal: AbortSignal.timeout(10000) })).json();
  const advertised = tags.models?.find(m => m.name === o.model);
  if (!advertised) throw Error('Requested model is not advertised by endpoint');
  const sourceFiles = ['lib/semantic-code.js', 'lib/semantic-query.js', 'lib/semantic-query-engine.js', 'lib/semantic-compare.js', 'lib/semantic-response.js', 'lib/tools-semantic.js','lib/tools-code.js','lib/code-search.js','lib/workspace.js', 'vendor/file-projections/joern/query.sc', 'dev/branch-flow-fixture.js', 'dev/eval-branch-flows.js'];
  const report = { kind: 'real-model-joern-branch-evaluation/v1', observedAt: new Date().toISOString(), task: o.task, format: o.format, model: advertised, syntheticService: true, scriptedProvider: false, upstreamRuntimeProof: false, oracleExposedToModel: false, guidance:'Explicit retained-analysis manifest and requested branch-flow review; not an unguided discovery benchmark',
    sourceSha256: hash(sourceFiles.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))), schemaBytes: Buffer.byteLength(JSON.stringify(wire)), schemaSha256: hash(wire), fixture: { repo: state.repo, baseline: state.baseline, feature: state.feature, baseAnalysis: state.baseAnalysis, featureAnalysis: state.featureAnalysis, engine: S.load(state.baseAnalysis).engine }, initialGrade: initial,
    budgets: { maxTurns: o.maxTurns, maxCalls: o.maxCalls, maxContextBytes: o.maxContextBytes, maxTokens: o.maxTokens, timeoutMs: o.timeoutMs, maxDurationMs: o.maxDurationMs }, events: [], usage: { promptTokens: 0, completionTokens: 0 }, finish: 'turn-budget' };
  const persist = () => { fs.mkdirSync(path.dirname(o.output), { recursive: true }); fs.writeFileSync(o.output, JSON.stringify(report, null, 2)); };
  const task = o.task === 'bug'
    ? 'Review the rebate feature against main, diagnose and fix any bug on the feature workspace. The symptom is that a rebated payment is returned and emitted with the expected amount, but support says the ledger disagrees.'
    : 'Develop REBATE-17 on the main workspace. Compare the existing experimental feature branch with main to understand it, but check its correctness before adopting its behavior.';
  const prompt = `You are working only on a synthetic payment service. Use tools to investigate exact revisions and make the requested change in the provided workspace. Compare retained Joern data-flow evidence between the two branches before writing, then use outside-in entry-to-exit checks. Static evidence is not runtime proof, and an absent bounded path is not proof of safety. Do not publish or change tests to hide failures. workspace_write check:false avoids a Maven compile check; test_run can run the supplied Node test that compiles and executes Java. Finish with a brief explanation, exact evidence, tests, remaining uncertainty and one practical improvement to these tools. Tools may return owned jobs: observe the same job rather than resubmitting.\n\n${task}\nRequirement: rebate is integer cents. Accepted payments return, persist and publish gross minus rebate, preserving tenant and exactly one effect per exit. Reject nonpositive gross, null/blank tenant, negative rebate or rebate greater than gross before any effect; a rebate equal to gross is allowed.\nRepository DEMO/payments; main SHA ${state.baseline}; feature/rebates SHA ${state.feature}. Retained Joern analyses are available to discover. Workspace: ${workspace.id}. Public smoke test: test/payment.test.cjs. Independent tests will check all exits and invalid cases. Start by inspecting evidence.`;
  let evidenceManifest=`\nThe public smoke test covers zero rebate and already passes on the buggy feature. Passing it cannot prove the rebate fix. Independent grader results are unavailable until your run ends.\nRetained evidence manifest (Java; analyses are ordered before then after): ${JSON.stringify([{ref:'main',analysis:state.baseAnalysis},{ref:'feature/rebates',analysis:state.featureAnalysis}])}.`;
  report.profile=o.profile;
  report.verification=o.verification;
  if(o.profile==='evidence'){
    const evidence=[];
    for(const name of ['save','publish']){
      const request={operation:'compare',mode:'dataflow',analyses:[state.baseAnalysis,state.featureAnalysis],from:{kind:'method',name:'submit',parameter:'rebate'},to:{kind:'call',name,argument:2},maxHops:30,waitMs:30000};
      const result=await settle('semantic_query',{...request,format:o.format==='default'?'compact':o.format});
      const bytes=Buffer.byteLength(JSON.stringify(result));
      evidence.push(result);report.events.push({name:'semantic_query',args:request,ok:true,result,responseBytes:bytes,origin:'harness-evidence-prefetch'});
    }
    evidenceManifest+='\nThese actual Joern comparison results were prefetched for you (the oracle was not). Interpret them before editing. You can query further if needed:\n'+JSON.stringify(evidence);
  }
  if(o.verification==='regression'){
    const request={workspace:workspace.id,tests:['test/payment.test.cjs','test/rebate.test.cjs']},result=await settle('test_run',request);
    report.events.push({name:'test_run',args:request,ok:true,result,responseBytes:Buffer.byteLength(JSON.stringify(result)),origin:'harness-public-regression'});
    evidenceManifest+='\nA public entry-to-exit regression is available at test/rebate.test.cjs. Run BOTH test/payment.test.cjs and test/rebate.test.cjs after your change. The latter is a nonzero-rebate contract check and must pass; the separate hidden grader checks other inputs. Initial public run:\n'+JSON.stringify(result);
  }
  report.promptSha256 = hash(prompt+evidenceManifest);
  const messages = [{ role: 'system', content: 'Use the available functions to complete the task. Work only in the specified synthetic workspace. Be concise and preserve evidence limitations.' }, { role: 'user', content: prompt+evidenceManifest }];
  const start = Date.now(), deadline = start + o.maxDurationMs; let calls = 0;
  persist();
  for (let turn = 0; turn < o.maxTurns; turn++) {
    if (Date.now() >= deadline) { report.finish = 'wall-clock-budget'; break; }
    const body = { model: o.model, messages, tools: wire, stream: false, think: false, options: { temperature: 0, seed: 42, num_ctx: 32768, num_predict: o.maxTokens } };
    const inputBytes = Buffer.byteLength(JSON.stringify(body));
    report.peakRequestBytes = Math.max(report.peakRequestBytes || 0, inputBytes);
    if (inputBytes > o.maxContextBytes) { report.finish = 'context-budget'; break; }
    console.error(`model turn ${turn + 1}, input ${inputBytes} bytes`);
    let response;
    try {
      const r = await fetch(o.endpoint + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(o.timeoutMs, deadline - Date.now())) });
      if (!r.ok) throw Error('Model HTTP ' + r.status);
      const raw = await r.text(); if (Buffer.byteLength(raw) > 1048576) throw Error('Model response exceeds 1 MiB'); response = JSON.parse(raw);
    } catch (error) { report.finish = 'endpoint-error'; report.error = error.message; break; }
    report.usage.promptTokens += response.prompt_eval_count || 0; report.usage.completionTokens += response.eval_count || 0;
    report.returnedModel = response.model; report.turns = turn + 1;
    const m = response.message;
    if (!m) { report.finish = 'invalid-model-response'; break; }
    messages.push(m);
    if (!m.tool_calls?.length) { report.final = m.content; report.finish = response.done_reason === 'length' ? 'output-token-budget' : 'assistant-finished'; break; }
    for (const call of m.tool_calls) {
      if (++calls > o.maxCalls) { report.finish = 'call-budget'; break; }
      const name = call.function?.name; let args = call.function?.arguments, value, error;
      const calledAt = Date.now();
      try {
        if (typeof args === 'string') args = JSON.parse(args);
        if (!exposed.includes(name)) throw Error('Tool is not available in this evaluation');
        if (args.workspace && args.workspace !== workspace.id) throw Error('Only the assigned workspace is available');
        if (name === 'workspace_write' && args.path !== F.FILE) throw Error('Only the service implementation is editable; tests and adapters are independent checks');
        if (name === 'test_run' && (args.files?.length || args.tests?.some(f => !['test/payment.test.cjs','test/rebate.test.cjs'].includes(f)))) throw Error('Run the existing public smoke/regression tests; independent grading is outside the workspace');
        if (o.format !== 'default' && name.startsWith('semantic_') && name !== 'semantic_capabilities') args = { ...args, format: o.format };
        value = await T.call(name, args, { source: 'model-evaluation', session: 'branch-flow-' + path.basename(o.output) });
      } catch (e) { error = { error: e.message, code: e.code }; value = error; }
      const text = JSON.stringify(value);
      report.events.push({ name, args, ok: !error, ms: Date.now() - calledAt, responseBytes: Buffer.byteLength(text), result: value });
      console.error(`  ${name}: ${error ? error.error : 'ok'} (${Buffer.byteLength(text)} bytes)`);
      messages.push({ role: 'tool', tool_name: name, content: text }); persist();
    }
    if (calls > o.maxCalls) break;
  }
  report.grade = F.grade(W.checkId(workspace.id).path);
  report.finalSourceSha256=hash(sourceFiles.map(f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8')));report.sourceChangedDuringRun=report.finalSourceSha256!==report.sourceSha256;
  const compared=report.events.findIndex(e=>e.name==='semantic_query'&&e.result.comparison&&e.result.mode==='dataflow'&&e.result.analyses?.[0]?.id===state.baseAnalysis&&e.result.analyses?.[1]?.id===state.featureAnalysis&&e.result.proof?.status==='static-comparison');
  const written=report.events.findIndex(e=>e.name==='workspace_write'&&e.ok);
  report.workflow = { semanticDiscovered: report.events.some(e=>e.name.startsWith('semantic_')&&e.ok&&(e.result.analyses?.length||e.result.results?.length)), branchFlowCompared: compared>=0, comparedBeforeWriting: compared>=0&&written>compared, publicTestsRun: report.events.some(e=>e.name==='test_run'&&e.result.outcome==='passed'), wroteFix: written>=0 };
  if(o.verification==='regression')report.workflow.publicRegressionPassed=report.events.some(e=>e.name==='test_run'&&!e.origin&&e.args.tests?.includes('test/rebate.test.cjs')&&e.result.outcome==='passed');
  report.modelDiscoveredComparison=report.events.some(e=>e.name==='semantic_query'&&!e.origin&&e.result.comparison);
  report.passed = report.grade.passed && Object.values(report.workflow).every(Boolean);
  report.patch = await W.patch(workspace.id);
  delete report.patch.apply;
  report.ms = Date.now() - start;
  report.responseBytes = report.events.reduce((n, e) => n + e.responseBytes, 0);
  report.semanticResponseBytes = report.events.filter(e => e.name.startsWith('semantic_')).reduce((n, e) => n + e.responseBytes, 0);
  persist();
  console.error(JSON.stringify({ finish: report.finish, grade: report.grade, turns: report.turns, calls, responseBytes: report.responseBytes, semanticResponseBytes: report.semanticResponseBytes }));
  await require('../lib/isolate').stop(); await require('../lib/state-store').close();
  return report;
}
if (require.main === module) run(options(process.argv.slice(2))).then(r => { process.exitCode = r.passed ? 0 : 1; }).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { options, run };
