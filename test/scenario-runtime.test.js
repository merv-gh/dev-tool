const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-runtime-'));
process.env.DT_HOME = home;
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_WORK_DIR', 'DT_PASSPORTS_DIR', 'DT_BUILD_DIR']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const { CACHE, writeJson } = require('../lib/util');
const W = require('../lib/workspace'), S = require('../lib/scenario'), State = require('../lib/scenario-state'), P = require('../lib/scenario-package'), Runtime = require('../lib/scenario-runtime');
const root = path.join(home, 'work', 'app'); fs.mkdirSync(root, { recursive: true });
writeJson(path.join(CACHE, 'work/app.json'), { id: 'app', project: 'DEMO', repo: 'app', path: root, createdAt: new Date().toISOString() });
const inventory = { version: 1, service: 'orders', env: 'dev', gaps: [], states: [
  { id: 'limits', kind: 'http', target: { service: 'limits' }, required: true, actions: ['pay'], provenance: [{ source: 'passport', file: 'orders.js', line: 12 }], resolution: { status: 'resolved' } },
  { id: 'region', kind: 'config', target: { key: 'region' }, required: true, actions: ['pay'], provenance: [], resolution: { status: 'resolved' } },
  { id: 'account', kind: 'file', target: { path: 'input.json' }, required: true, actions: ['pay'], provenance: [], resolution: { status: 'resolved' } },
], actions: [{ id: 'pay', kind: 'http', target: 'POST /orders/{}', entry: 'POST /orders/{}', required: true, input: { known: true }, dependencies: ['limits', 'region', 'account'], expectations: ['status', 'receipt', 'calls', 'file'] }], expectations: [
  { id: 'status', kind: 'status', target: 'POST /orders/{}', action: 'pay', required: true },
  { id: 'receipt', kind: 'return', target: 'POST /orders/{}', action: 'pay', required: true },
  { id: 'calls', kind: 'http', target: { service: 'limits' }, action: 'pay', required: true },
  { id: 'file', kind: 'file', target: { path: 'receipt.json' }, action: 'pay', required: true },
] };
const profile = { version: 1, adapter: 'node-container', image: 'node:22-alpine', entry: 'orders.js', port: 19080, readyPath: '/health', readyTimeoutMs: 10000,
  http: { limits: 'LIMITS_URL' }, config: { region: 'REGION' }, files: { account: { path: 'input.json', encoding: 'json' } },
  observations: { calls: { kind: 'http', state: 'limits' }, file: { kind: 'file', path: 'receipt.json' } }, report: 'target/scenario-observations.json', temporal: { deadlineMs: 1200, intervalMs: 30, quietMs: 80 } };
fs.writeFileSync(path.join(root, 'orders.js'), `const http=require('http'),fs=require('fs'),path=require('path');
http.createServer(async(req,res)=>{
if(req.url==='/health'){res.end('ok');return;}
let body='';for await(const b of req)body+=b;const input=JSON.parse(body||'{}');
try{const account=JSON.parse(fs.readFileSync(path.join(process.env.DT_SCENARIO_FILES,'input.json'),'utf8'));
if(!account.enabled||process.env.REGION!=='EU')throw new Error('wrong initial state');
const limits=await(await fetch(process.env.LIMITS_URL+(input.mode==='wrong-http'?'/limits/99':'/limits/42'))).json();
if(input.mode==='egress'){try{await fetch('http://198.51.100.1:19082',{signal:AbortSignal.timeout(100)});throw new Error('unexpected egress');}catch(e){if(e.message==='unexpected egress')throw e;}}
if(input.mode==='forge'){try{fs.appendFileSync('/dt-evidence/events.jsonl','{"kind":"http","state":"limits"}\\n');throw new Error('evidence write escaped');}catch(e){if(e.message==='evidence write escaped')throw e;}}
const receipt={orderId:42,total:input.amount+limits.fee+(input.mode==='defect'?1:0)};
if(input.mode==='sequence'){receipt.audit=[];for(let i=0;i<2;i++){const response=await fetch(process.env.LIMITS_URL+'/audit?z=2&a=1',{method:'POST',headers:{'content-type':'application/json','x-client':'orders'},body:JSON.stringify({orderId:42})});receipt.audit.push(response.status);}}
const write=()=>fs.writeFileSync(path.join(process.env.DT_SCENARIO_FILES,'receipt.json'),JSON.stringify(receipt));
if(input.mode==='delayed')setTimeout(write,140);else write();
if(input.mode==='extra')fs.writeFileSync(path.join(process.env.DT_SCENARIO_FILES,'undeclared.txt'),'unexpected');
if(input.mode==='transient'){const transient=path.join(process.env.DT_SCENARIO_FILES,'transient.txt');fs.writeFileSync(transient,'unexpected');fs.unlinkSync(transient);}
if(input.mode==='late-http')setTimeout(()=>fetch(process.env.LIMITS_URL+'/limits/42').catch(()=>{}),140);
res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify(receipt));
}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}).listen(Number(process.env.PORT),'127.0.0.1');\n`);
async function scenario(name = 'happy', mode = '', overrides = {}) {
  const inv = JSON.parse(JSON.stringify(inventory));
  const state = await State.captureState(State.planState(inv, { limits: { value: { ordered: true, exchanges: [{ request: { method: 'GET', path: '/limits/42' }, response: { status: 200, body: { fee: 325 }, delayMs: 10 } }] } }, region: { value: 'EU' }, account: { value: { enabled: true } } }), { mask: false });
  const actions = S.actions(inv, { bindings: { pay: { method: 'POST', path: '/orders/42', body: { amount: 1250, mode } } } });
  const expectations = S.expectations(inv, { bindings: { status: { match: { op: 'exact', value: 201 } }, receipt: { match: { op: 'exact', value: { orderId: 42, total: 1575 } } }, calls: { match: { op: 'exact', value: [{ method: 'GET', path: '/limits/42', body: null }] } }, file: { match: { op: 'exact', value: { orderId: 42, total: 1575 } } } } });
  const profilePath = `${name}.runtime.json`; fs.writeFileSync(path.join(root, profilePath), JSON.stringify({ ...profile, ...overrides }));
  const artifact = P.create({ workspace: 'app', name, inventory: inv, state, actions, expectations, profile: profilePath });
  const imported = P.importPackage('app', artifact);
  return { artifact, ...imported };
}
test.after(async () => { const dirs = fs.existsSync(path.join(CACHE, 'scenario-runs')) ? fs.readdirSync(path.join(CACHE, 'scenario-runs')) : []; for (const id of dirs) await Runtime.stop(id).catch(() => {}); fs.rmSync(home, { recursive: true, force: true }); });

test('portable versioned package independently verifies contract and every resource', async () => {
  const item = await scenario('portable'); const verified = P.verify(item.artifact);
  assert.equal(verified.states, 3); assert.equal(verified.actions, 1); assert.equal(verified.expectations, 4);
  assert.equal(P.load('app', item.path).sha256, item.artifact.sha256);
  assert.equal(Runtime.preflight('app', item.path).ok, true);
  assert.equal(P.explain(item.artifact).actions[0].reads.length, 3);
  assert.doesNotMatch(JSON.stringify(item.artifact), new RegExp(home));
  const changed = structuredClone(item.artifact); changed.contract.actions.actions[0].binding.body.amount = 2000;
  assert.throws(() => P.verify(changed), /hash mismatch/);
  changed.sha256 = P.digest(Object.fromEntries(Object.entries(changed).filter(([k]) => k !== 'sha256')));
  assert.equal(P.verify(changed).ok, true);
  const diff = P.diff(item.artifact, changed); assert.equal(diff.equal, false); assert.ok(diff.changes.some(c => c.path.includes('/amount')));
  assert.equal(P.diff(item.artifact, item.artifact).equal, true);
  assert.equal(P.json({ '2': 'two', '10': 'ten', a: 1 }), '{"10":"ten","2":"two","a":1}');
  const reordered = obj => Array.isArray(obj) ? obj.map(reordered) : obj && typeof obj === 'object' ? Object.fromEntries(Object.entries(obj).reverse().map(([k, v]) => [k, reordered(v)])) : obj;
  const equivalent = P.create({ workspace: 'app', name: 'portable', ...reordered(item.artifact.contract), profile: 'portable.runtime.json' });
  assert.equal(equivalent.sha256, item.artifact.sha256, 'source object insertion order does not change portable content identity');
});
test('portable source references discard capture-cache ids and preserve repository provenance', async () => {
  const item = await scenario('provenance');
  item.artifact.contract.state.states.limits.source.capture = '1234567890abcdef12345678';
  const artifact = P.create({ workspace: 'app', name: 'fresh', ...item.artifact.contract, profile: 'provenance.runtime.json' });
  assert.equal(artifact.contract.state.states.limits.source.capture, undefined);
  assert.equal(artifact.contract.inventory.states[0].provenance[0].file, 'orders.js');
  assert.throws(() => P.create({ workspace: 'app', ...artifact.contract, inventory: { ...inventory, states: inventory.states.map((s, i) => i ? s : { ...s, provenance: [{ file: '/outside/private/File.java' }] }) } }), /absolute source/);
  const domain = structuredClone(artifact.contract); domain.actions.actions[0].binding.body.metadata = { capturedAt: 'business-time', builtAt: 'assembly-time', trace: ['domain-event'], source: { capture: 'domain-reference' }, provenance: { path: '/customer-path' } };
  domain.state.states.account.value = { capturedAt: 'business-time', trace: [1, 2], source: { capture: 'domain-state' } };
  const preserved = P.create({ workspace: 'app', name: 'domain-fields', ...domain, profile: 'provenance.runtime.json' });
  assert.deepEqual(preserved.contract.actions.actions[0].binding.body.metadata, domain.actions.actions[0].binding.body.metadata);
  assert.deepEqual(preserved.contract.state.states.account.value, domain.state.states.account.value);
});
test('invalid proofs, shortened state, unknown versions and unsafe resource paths fail integrity', async () => {
  const { artifact } = await scenario('invalid');
  const resigned = value => { delete value.sha256; value.sha256 = P.digest(value); return value; };
  assert.throws(() => P.verify(resigned({ ...artifact, version: 2 })), /format\/version/);
  assert.throws(() => P.verify(resigned({ ...artifact, proof: { level: 'process', applicationExecuted: true } })), /cannot claim execution/);
  const missing = structuredClone(artifact); delete missing.contract.state.states.account;
  assert.throws(() => P.verify(resigned(missing)), /contract invalid/);
  const escaped = structuredClone(artifact); escaped.resources.files['fixture/../../outside'] = { encoding: 'utf8', sha256: P.digest('bad'), data: 'bad' };
  assert.throws(() => P.verify(resigned(escaped)), /relative without traversal/);
  assert.throws(() => P.importPackage('app', artifact, { directory: '../../outside' }), /directory must/);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'linked'));
  assert.throws(() => P.workspacePath('app', 'linked/scenario.json'), /symlinks/);
});
test('reviewed profile updates require a new package and unknown mappings block preflight', async () => {
  const item = await scenario('profile'); fs.appendFileSync(path.join(root, 'profile.runtime.json'), '\n');
  assert.throws(() => Runtime.preflight('app', item.path), /profile changed/);
  const bad = await scenario('bad-mappings', '', { config: { region: 'NODE_OPTIONS', nonexistent: 'SECRET' }, observations: { ...profile.observations, file: { kind: 'file', path: '../../private' } } });
  const report = Runtime.preflight('app', bad.path);
  assert.equal(report.ok, false); assert.ok(report.gaps.some(g => g.kind === 'environment-binding')); assert.ok(report.gaps.some(g => g.id === 'nonexistent')); assert.ok(report.gaps.some(g => g.kind === 'observation-target'));
});
test('independent observers cannot rebind an effect kind, file/HTTP target or action', async () => {
  const cases = [
    ['kind', { file: { kind: 'status', action: 'pay' } }, 'observation-kind'],
    ['file-target', { file: { kind: 'file', path: 'other-receipt.json' } }, 'observation-target'],
    ['action', { file: { kind: 'file', path: 'receipt.json', action: 'other-action' } }, 'observation-action'],
  ];
  for (const [name, changes, kind] of cases) { const item = await scenario(`rebind-${name}`, '', { observations: { ...profile.observations, ...changes } }); const result = Runtime.preflight('app', item.path); assert.equal(result.ok, false); assert.ok(result.gaps.some(g => g.kind === kind), JSON.stringify(result)); }
  const base = await scenario('rebind-http'), contract = structuredClone(base.artifact.contract);
  const second = { ...contract.inventory.states[0], id: 'other-http', target: { service: 'fraud' } }; contract.inventory.states.push(second); contract.inventory.actions[0].dependencies.push(second.id); contract.actions.actions[0].dependencies.push(second.id);
  contract.state.states[second.id] = { ...contract.state.states.limits, id: second.id, target: second.target };
  const profilePath = 'wrong-http-target.runtime.json'; fs.writeFileSync(path.join(root, profilePath), JSON.stringify({ ...profile, http: { ...profile.http, 'other-http': 'FRAUD_URL' }, observations: { ...profile.observations, calls: { kind: 'http', state: 'other-http' } } }));
  const artifact = P.create({ workspace: 'app', name: 'wrong-http-target', ...contract, profile: profilePath }), imported = P.importPackage('app', artifact), result = Runtime.preflight('app', imported.path);
  assert.equal(result.ok, false); assert.ok(result.gaps.some(g => g.kind === 'observation-target' && g.id === 'calls'));
});
test('native Kafka, unknown state and unsupported observer cannot silently pass a runtime preflight', async () => {
  const item = await scenario('unsupported'); const artifact = item.artifact;
  artifact.contract.inventory.states[0].kind = 'kafka'; artifact.contract.state.states.limits.kind = 'kafka'; artifact.contract.state.inventory = artifact.contract.inventory; artifact.contract.state.inventoryHash = State.inventoryHash(artifact.contract.inventory);
  artifact.sha256 = P.digest(Object.fromEntries(Object.entries(artifact).filter(([k]) => k !== 'sha256')));
  const imported = P.importPackage('app', artifact, { directory: 'src/test/resources/dt-scenarios/unsupported-2' });
  const report = Runtime.preflight('app', imported.path);
  assert.equal(report.ok, false); assert.ok(report.gaps.some(g => /project test adapter/.test(g.detail))); assert.deepEqual(report.support.brokerCodecs, []);
});
test('HTTP action paths and methods must match the declared entry', () => {
  assert.equal(Runtime.requestFor({ id: 'a', target: 'POST /orders/{}', binding: { path: '/orders/42' } }).method, 'POST');
  for (const binding of [{ path: '//host/private' }, { path: '/wrong/42' }, { path: '/orders/42', method: 'GET' }, { path: 'http://host/orders/42' }]) assert.throws(() => Runtime.requestFor({ id: 'a', target: 'POST /orders/{}', binding }));
});
test('all package and lifecycle stages are separately exposed and default visualizations render', async () => {
  const tools = require('../lib/tools-scenario-runtime')();
  assert.equal(new Set(tools.map(t => t.name)).size, 14);
  for (const name of ['scenario_package', 'scenario_import', 'scenario_verify', 'scenario_diff', 'scenario_explain', 'scenario_preflight', 'scenario_start', 'scenario_act', 'scenario_observe', 'scenario_assert', 'scenario_inspect', 'scenario_stop', 'scenario_cleanup', 'scenario_run']) assert.ok(tools.some(t => t.name === name), name);
  const { artifact } = await scenario('tool');
  const response = await tools.find(t => t.name === 'scenario_verify').run({ artifact });
  assert.equal(response.ok, true); assert.match(response.view, /\/show\//);
  const rendered = require('../lib/views').render('scenario-run', response);
  assert.match(rendered, /Evidence level/); assert.match(rendered, /scenario-download/); assert.doesNotMatch(rendered, /fetch\(/);
});
test('test-run adapter delegates exact reviewed tests and reports build rather than model/process proof', async t => {
  const item = await scenario('jvm-adapter', '', { adapter: 'test-run', tests: ['example.RealServiceTest'], mode: 'build' });
  let received;
  t.mock.method(require('../lib/testrun'), 'run', async (workspace, options) => { received = { workspace, options }; writeJson(path.join(root, options.scenarioOutput), { version: 1, artifact: item.artifact.sha256, actions: ['pay'], observed: Object.fromEntries(item.artifact.contract.expectations.expectations.map(e => [e.id, e.match.value])) }); return { outcome: 'passed', counts: { tests: 4, passed: 4 } }; });
  const result = await Runtime.run('app', item.path);
  assert.equal(result.ok, true); assert.equal(received.workspace, 'app'); assert.deepEqual(received.options.tests, ['example.RealServiceTest']);
  assert.equal(result.proof.level, 'build'); assert.equal(result.proof.runtimeReadsVerified, false); assert.equal(result.proof.independentObservations, 'collected by reviewed project adapter');
  assert.equal(result.proof.expectationsChecked, true); assert.equal(received.options.scenarioPath, item.path);
  await assert.rejects(Runtime.start('app', item.path), /one-shot/);
});
test('portable PG/Kafka files survive transfer and extracted tampering blocks project execution', async t => {
  const base = await scenario('with-resources', '', { adapter: 'test-run', tests: ['example.RealServiceTest'], mode: 'build', template: true, fixtureBindings: { orders: 'ORDERS_DATASOURCE', billing: 'BILLING_DATASOURCE' } });
  const fixtureDir = 'src/test/resources/dt-fixtures/portable-source'; fs.mkdirSync(path.join(root, fixtureDir), { recursive: true });
  const files = {}, put = (rel, data) => { const full = path.join(root, fixtureDir, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, data); files[rel] = P.digest(data); };
  for (const db of ['orders', 'billing']) for (const phase of ['schema', 'data', 'constraints']) put(`pg/${Buffer.from(db).toString('hex')}/${phase}.sql`, phase === 'schema' ? 'create table example(id bigint);\n' : '');
  put('kafka/6f7264657273/messages.jsonl', JSON.stringify({ partition: 0, offset: '9007199254740993', key: '42', value: { orderId: '42' } }) + '\n');
  put('kafka/6f7264657273/schema.json', JSON.stringify({ type: 'json' }));
  put('kafka/6f7264657273/offsets.json', JSON.stringify([{ partition: 0, from: '9007199254740993', highExclusive: '9007199254740994' }]));
  fs.writeFileSync(path.join(root, fixtureDir, 'manifest.json'), JSON.stringify({ version: 1, complete: true, gaps: [], files, databases: Object.fromEntries(['orders', 'billing'].map(db => [db, { directory: `pg/${Buffer.from(db).toString('hex')}` }])), topics: { orders: { directory: 'kafka/6f7264657273' } } }));
  const artifact = P.create({ workspace: 'app', name: 'full-portable', ...base.artifact.contract, profile: 'with-resources.runtime.json', fixturePath: fixtureDir });
  const imported = P.importPackage('app', artifact); assert.equal(P.verifyExtracted('app', imported.path, artifact).ok, true);
  let options;
  t.mock.method(require('../lib/testrun'), 'run', async (id, opts) => { options = opts; writeJson(path.join(root, opts.scenarioOutput), { version: 1, artifact: artifact.sha256, actions: ['pay'], observed: Object.fromEntries(artifact.contract.expectations.expectations.map(e => [e.id, e.match.value])) }); return { outcome: 'passed', counts: { tests: 2 } }; });
  assert.equal((await Runtime.run('app', imported.path)).ok, true);
  assert.equal(options.fixtureTemplate, true); assert.match(options.fixturePath, /dt-scenarios\/full-portable\/fixture$/); assert.equal(options.fixtureBindings.orders, 'ORDERS_DATASOURCE');
  fs.appendFileSync(path.join(root, path.dirname(imported.path), 'fixture/pg/6f7264657273/data.sql'), 'delete from example;');
  const preflight = Runtime.preflight('app', imported.path); assert.equal(preflight.ok, false); assert.ok(preflight.gaps.some(g => g.kind === 'fixture-integrity'));
  assert.equal((await Runtime.run('app', imported.path)).ok, false);
  const corrupt = structuredClone(artifact); corrupt.resources.files['fixture/pg/6f7264657273/schema.sql'].data += 'broken'; delete corrupt.sha256; corrupt.sha256 = P.digest(corrupt);
  assert.throws(() => P.verify(corrupt), /resource hash mismatch/);
  const forgedProfile = structuredClone(artifact); forgedProfile.runtime.profile = 'src/test/resources/dt-scenarios/full-portable/fixture/runtime.json'; delete forgedProfile.sha256; forgedProfile.sha256 = P.digest(forgedProfile);
  assert.throws(() => P.verify(forgedProfile), /outside imported test resources/);
});
test('project build success cannot hide missing, stale, skipped actions or mismatched observations', async t => {
  const item = await scenario('bad-reports', '', { adapter: 'test-run', tests: ['example.RealServiceTest'] });
  let version = 'missing';
  t.mock.method(require('../lib/testrun'), 'run', async (workspace, options) => {
    if (version !== 'missing') writeJson(path.join(root, options.scenarioOutput), { version: 1, artifact: version === 'stale' ? 'old' : item.artifact.sha256, actions: version === 'unperformed' ? [] : ['pay'], observed: {} });
    return { outcome: 'passed', counts: { tests: 1, passed: 1 } };
  });
  for (version of ['missing', 'stale', 'unperformed', 'wrong-effects']) { const result = await Runtime.run('app', item.path); assert.equal(result.ok, false, version); assert.equal(result.proof.expectationsChecked, false); }
});
test('Open WebUI can start and poll one long scenario job without repeating execution', async t => {
  const item = await scenario('job-poll', '', { adapter: 'test-run', tests: ['example.RealServiceTest'] });
  const prior = process.env.DT_TESTS_WAIT_MS; process.env.DT_TESTS_WAIT_MS = '0'; t.after(() => prior === undefined ? delete process.env.DT_TESTS_WAIT_MS : process.env.DT_TESTS_WAIT_MS = prior);
  let calls = 0;
  t.mock.method(Runtime, 'run', async () => { calls++; await new Promise(resolve => setTimeout(resolve, 80)); return { ok: true, proof: { level: 'build', applicationExecuted: true, runtimeReadsVerified: false } }; });
  const tool = require('../lib/tools-scenario-runtime')().find(t => t.name === 'scenario_run');
  const first = await tool.run({ workspace: 'app', package: item.path, view: false }); assert.equal(first.state, 'running');
  const joined = await tool.run({ workspace: 'app', package: item.path, view: false }); assert.equal(joined.job, first.job);
  await new Promise(resolve => setTimeout(resolve, 100)); const done = await tool.run({ job: first.job });
  assert.equal(done.state, 'done'); assert.equal(done.ok, true); assert.equal(calls, 1); assert.equal(done.view, undefined);
});
test('failed Docker inspection cannot erase a lease or hide a retryable cleanup failure', async t => {
  const directory = path.join(home, 'fake-docker-bin'); fs.mkdirSync(directory, { recursive: true });
  const script = path.join(directory, 'docker'), previous = process.env.PATH; process.env.PATH = `${directory}${path.delimiter}${previous}`;
  t.after(() => { process.env.PATH = previous; });
  const id = 'eeeeeeeeeeeeeeeeeeeeeeee', session = path.join(CACHE, 'scenario-runs', id);
  writeJson(path.join(session, 'session.json'), { id, status: 'ready', startedAt: new Date().toISOString(), expiresAt: Date.now() + 300000, container: 'dt-scenario-test', owner: 'owned-token', actions: [], timings: {} });
  for (const reason of ['Cannot connect to the Docker daemon', 'permission denied while trying to connect']) {
    fs.writeFileSync(script, `#!/bin/sh\necho '${reason}' >&2\nexit 1\n`, { mode: 0o755 });
    await assert.rejects(Runtime.stop(id), /cannot verify scenario container/);
    const retained = JSON.parse(fs.readFileSync(path.join(session, 'session.json'), 'utf8')); assert.equal(retained.status, 'ready'); assert.match(retained.cleanupError, /cannot verify/);
    assert.ok((await Runtime.inspect()).sessions.some(s => s.id === id && s.cleanupError));
  }
  fs.writeFileSync(script, "#!/bin/sh\necho 'Error: No such object: dt-scenario-test' >&2\nexit 1\n", { mode: 0o755 });
  assert.equal((await Runtime.stop(id)).stopped, true); assert.equal(JSON.parse(fs.readFileSync(path.join(session, 'session.json'))).status, 'stopped');
  fs.rmSync(session, { recursive: true, force: true });
});

const docker = process.env.DT_TEST_DOCKER === '1';
test('actual unchanged service: isolated HTTP/config/file arrange-act-observe-assert-stop lifecycle', { skip: !docker, timeout: 45000 }, async () => {
  const item = await scenario('real-happy'), start = await Runtime.start('app', item.path);
  assert.equal(start.ok, true, JSON.stringify(start)); const id = start.session.id;
  try {
    const network = await Runtime.exec('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}} {{json .HostConfig.PortBindings}}', `dt-scenario-${id}`]);
    assert.match(network.out, /^none (?:null|\{\})/);
    const response = await Runtime.act(id, 'pay'); assert.equal(response.action.response.status, 201);
    await assert.rejects(Runtime.act(id, 'pay'), /already performed/);
    const result = await Runtime.observe(id); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.proof.level, 'process'); assert.equal(result.proof.independentObservations, true); assert.equal(result.proof.runtimeReadsVerified, false);
    assert.equal(Runtime.check(id).ok, true); assert.ok((await Runtime.inspect(id)).events.some(e => e.kind === 'http'));
  } finally { await Runtime.stop(id); }
  assert.equal((await Runtime.stop(id)).reused, true);
  assert.equal((await Runtime.inspect(id)).session.status, 'stopped');
});
test('actual service defects and undeclared file effects fail independent observations', { skip: !docker, timeout: 60000 }, async () => {
  for (const mode of ['defect', 'extra', 'transient', 'wrong-http']) {
    const item = await scenario(`real-${mode}`, mode), result = await Runtime.run('app', item.path, { deadlineMs: 300, quietMs: 50 });
    assert.equal(result.ok, false, mode);
    if (mode === 'defect') assert.ok(result.checks.results.some(c => c.id === 'receipt' && !c.ok));
    if (mode === 'extra' || mode === 'transient') assert.ok(result.violations.some(v => v.kind === 'unexpected-file-effect'));
    if (mode === 'wrong-http') assert.ok(result.violations.some(v => v.kind === 'http-mismatch'));
    assert.equal((await Runtime.inspect(result.session)).session.status, 'stopped');
  }
});
test('actual HTTP fixtures enforce ordered exact bodies/headers, retry counts and response sequences', { skip: !docker, timeout: 30000 }, async () => {
  const item = await scenario('real-sequence', 'sequence'), artifact = item.artifact;
  artifact.contract.state.states.limits.value.exchanges.push({ request: { method: 'POST', path: '/audit?a=1&z=2', headers: { 'x-client': 'orders' }, body: { orderId: 42 } }, times: { min: 2, max: 2 }, responses: [{ status: 429, body: { retry: true } }, { status: 202, body: { accepted: true }, delayMs: 20 }] });
  for (const id of ['receipt', 'file']) artifact.contract.expectations.expectations.find(e => e.id === id).match.value.audit = [429, 202];
  artifact.contract.expectations.expectations.find(e => e.id === 'calls').match.value.push(...[1, 2].map(() => ({ method: 'POST', path: '/audit?a=1&z=2', body: { orderId: 42 } })));
  delete artifact.sha256; artifact.sha256 = P.digest(artifact); P.importPackage('app', artifact, { overwrite: true });
  const result = await Runtime.run('app', item.path); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.events.filter(e => e.kind === 'http').length, 3);
});
test('actual async effects poll to deadline and forbidden late calls fail the quiet window', { skip: !docker, timeout: 60000 }, async () => {
  const delayed = await scenario('real-delayed', 'delayed'); const good = await Runtime.run('app', delayed.path, { deadlineMs: 1500, quietMs: 100 });
  assert.equal(good.ok, true, JSON.stringify(good)); assert.ok(good.temporal.elapsedMs >= 100); assert.ok(good.temporal.samples > 1);
  const late = await scenario('real-late', 'late-http'), bad = await Runtime.run('app', late.path, { deadlineMs: 700, quietMs: 300 });
  assert.equal(bad.ok, false); assert.ok(bad.violations.some(v => v.kind === 'http-mismatch'));
});
test('actual container has no live egress and application cannot forge observer evidence', { skip: !docker, timeout: 60000 }, async () => {
  for (const mode of ['egress', 'forge']) {
    const item = await scenario(`real-${mode}`, mode), result = await Runtime.run('app', item.path);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.events.filter(e => e.kind === 'http').length, 1);
  }
});
test('actual readiness failure always compensates owned resources and retains logs', { skip: !docker, timeout: 30000 }, async () => {
  const item = await scenario('real-not-ready', '', { readyPath: '/never-ready', readyTimeoutMs: 200 }), result = await Runtime.start('app', item.path);
  assert.equal(result.ok, false); assert.match(result.error, /readiness deadline/);
  assert.equal((await Runtime.inspect(result.session.id)).session.status, 'stopped');
  const inspected = await Runtime.exec('docker', ['inspect', `dt-scenario-${result.session.id}`]); assert.notEqual(inspected.code, 0);
});
test('actual concurrent leases remain isolated, enforce capacity, reject ownership substitution and recover expiry', { skip: !docker, timeout: 45000 }, async () => {
  const a = await scenario('parallel-a'), b = await scenario('parallel-b');
  const [first, second] = await Promise.all([Runtime.start('app', a.path), Runtime.start('app', b.path)]);
  assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(second.ok, true, JSON.stringify(second));
  const ids = [first.session.id, second.session.id];
  try {
    assert.notEqual(ids[0], ids[1]); await assert.rejects(Runtime.start('app', a.path), /capacity 2 reached/);
    const metadataPath = path.join(CACHE, 'scenario-runs', ids[0], 'session.json'), original = fs.readFileSync(metadataPath, 'utf8');
    const forged = JSON.parse(original); forged.owner = 'some-other-owner'; fs.writeFileSync(metadataPath, JSON.stringify(forged));
    await assert.rejects(Runtime.stop(ids[0]), /ownership does not match/); fs.writeFileSync(metadataPath, original);
    const expired = JSON.parse(original); expired.expiresAt = Date.now() - 1; fs.writeFileSync(metadataPath, JSON.stringify(expired));
    await assert.rejects(Runtime.act(ids[0], 'pay'), /lease expired/);
    assert.equal((await Runtime.cleanup()).ok, true); assert.equal((await Runtime.inspect(ids[0])).session.status, 'stopped');
    assert.equal((await Runtime.inspect(ids[1])).session.status, 'ready');
    await Runtime.act(ids[1], 'pay'); assert.equal((await Runtime.observe(ids[1])).ok, true);
    assert.equal(fs.existsSync(path.join(root, 'receipt.json')), false);
  } finally { for (const id of ids) await Runtime.stop(id); }
});
