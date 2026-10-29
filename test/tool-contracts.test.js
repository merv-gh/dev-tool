const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-contracts-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
for (const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS']) delete process.env[key];
const configFile = path.join(home, 'config.json');
const config = tools => { fs.writeFileSync(configFile, JSON.stringify({ envs: { dev: {} }, tools: tools || {} })); require('../lib/config').reload(); };
config();
const T = require('../lib/tools'), Schema = require('../lib/schema');
let backend, server, base, backendUrl, lastRequest, mode = 'success', hits = 0;
test.before(async () => {
  backend = http.createServer(async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    const input = JSON.parse(text); lastRequest = { ...input, authorization: req.headers.authorization }; hits++;
    if (mode === 'timeout') return;
    res.setHeader('content-type', 'application/json');
    const result = input.tool === 'knowledge_graph' ? { version: 1, env: 'dev', revision: 'remote', nodes: [], relations: [], documents: [], gaps: [], sources: [], runtimeVerified: false } : { backend: 'independent-worker', version: 1, input: input.arguments, revision: 'remote', total: 0, results: [], gaps: [], runtimeVerified: false };
    res.end(JSON.stringify({ protocol: mode === 'wrong-version' ? 'dt.tool/v99' : 'dt.tool/v1', requestId: mode === 'wrong-request' ? 'other' : input.requestId, tool: input.tool, ...(mode === 'error' ? { error: { code: 'CUSTOM_FAILURE', message: 'bad backend-private-token' } } : mode === 'null-error' ? { error: null } : { result }) }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve)); backendUrl = `http://127.0.0.1:${backend.address().port}/execute`;
  server = require('../server').start({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.on('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { backend.closeAllConnections(); server.closeAllConnections(); await Promise.all([new Promise(r => backend.close(r)), new Promise(r => server.close(r))]); fs.rmSync(home, { recursive: true, force: true }); });
const post = async (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('compact profile and semantic discovery keep full schemas out of the initial tool list', async () => {
  const all = await T.schemas(), small = await T.schemas({ profile: 'compact' });
  assert.ok(small.length < all.length / 2);
  for (const name of ['tool_search', 'tool_describe', 'tool_execute', 'knowledge_graph']) assert.ok(small.some(t => t.name === name));
  const found = await T.call('tool_search', { query: 'related test data Kafka', limit: 5 });
  assert.ok(found.tools.some(t => t.name.startsWith('fixture_')));
  const description = await T.call('tool_describe', { name: 'fixture_plan' });
  assert.equal(description.inputSchema.properties.seeds.type, 'array');
  assert.equal(description.execution.protocol, 'dt.tool/v1');
  assert.ok((await T.call('tool_profiles', {})).some(p => p.name === 'testing'));
  const spec = await (await fetch(base + '/openapi/compact.json')).json();
  assert.equal(spec['x-dt-profile'], 'compact');
  assert.equal(Object.keys(spec.paths).length, small.length);
  assert.equal((await fetch(base + '/openapi/no-such-profile.json')).status, 400);
});
test('profiles never resurrect disabled tools and dispatcher cannot recurse', async () => {
  config({ disable: ['pg_query'], profiles: { analyst: { groups: ['pg'] } } });
  assert.ok(!(await T.schemas({ profile: 'analyst' })).some(t => t.name === 'pg_query'));
  await assert.rejects(T.call('tool_execute', { name: 'pg_query', arguments: { sql: 'select 1' } }), /Unknown tool/);
  await assert.rejects(T.call('tool_execute', { name: 'tool_execute', arguments: {} }), /directly/);
  config();
});
test('lean profiles expose only selected definitions while preserving permissions and discovery', async () => {
  assert.deepEqual((await T.schemas({ profile: 'lean' })).map(t => t.name).sort(), ['tool_describe', 'tool_execute', 'tool_profiles', 'tool_search']);
  assert.equal((await T.schemas({ profile: 'lean-find' })).length, 5);
  config({ disable: ['tool_describe', 'pg_query'], profiles: { minimal: { includeCore: false, names: ['tool_search', 'pg_query'] } } });
  assert.equal((await T.schemas({ profile: 'lean' })).length, 3);
  assert.deepEqual((await T.schemas({ profile: 'minimal' })).map(t => t.name), ['tool_search']);
  assert.ok(!(await T.call('tool_search', { query: 'pg_query' })).tools.some(t => t.name === 'pg_query'));
  config();
});
test('legacy discovery ranking remains default and BM25 requires trusted configuration', async () => {
  config();
  const legacy = await T.call('tool_search', { query: 'in the', limit: 30, ranker: 'bm25' });
  assert.equal(legacy.lexical.ranker, 'legacy');
  const definitions = await T.schemas({ metadata: true });
  assert.deepEqual(legacy.tools.map(t => t.name), require('../lib/tool-search').legacyRank(definitions, 'in the').slice(0, legacy.tools.length).map(x => x.t.name));
  assert.ok(Buffer.byteLength(JSON.stringify(legacy)) <= 4096);
  assert.equal(legacy.truncated, true);
  config({ discoveryRanker: 'bm25' });
  const experimental = await T.call('tool_search', { query: 'in the' });
  assert.equal(experimental.lexical.ranker, 'bm25'); assert.deepEqual(experimental.tools, []);
  config();
});
test('Open WebUI updates retain user instructions and expose the selected API profile', async () => {
  const W = require('../lib/webui');
  const prior = 'Use the staging environment and cite every claim.';
  const once = W.modelPrompt(prior), twice = W.modelPrompt(once);
  assert.ok(once.startsWith(prior)); assert.equal(twice, once);
  assert.equal((twice.match(/<dt-tools-instructions>/g) || []).length, 1);
  assert.equal(W.dtConnection('http://dt:4000/', 'key', { profile: 'api' }).path, 'openapi/api.json');
  assert.ok((await T.schemas({ profile: 'api' })).some(t => t.name === 'api_request_save'));
  for (const name of ['api-exchange', 'api-request']) {
    const response = await fetch(base + `/contracts/v1/${name}.schema.json`);
    assert.equal(response.status, 200); assert.ok((await response.json()).$id);
  }
});
test('nested JSON constraints fail before network and report the same code through direct/MCP/OpenAPI', async () => {
  const before = hits;
  await assert.rejects(T.call('pg_query', { sql: 17 }), e => e.code === 'DT_ARGUMENT_INVALID' && e.issues[0].path === '$.sql');
  const response = await post('/oapi/pg_query', { sql: 17 });
  assert.equal(response.status, 400); const body = await response.json(); assert.equal(body.code, 'DT_ARGUMENT_INVALID');
  const mcp = await (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pg_query', arguments: { sql: 17 } } })).json();
  assert.equal(mcp.result.isError, true); assert.equal(mcp.result.structuredContent.code, body.code);
  await assert.rejects(T.call('tool_search', { query: 'x', limit: 31 }), /maximum/);
  assert.equal(hits, before);
  assert.ok(Schema.validate({ rows: [{ id: 'wrong' }] }, { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } } }).some(i => i.path === '$.rows[0].id'));
});
test('checked-in transport contracts accept a non-JS backend and preserve exact arguments', async () => {
  config({ backends: { knowledge_search: { url: backendUrl, token: 'backend-private-token' } } });
  const result = await T.call('tool_execute', { name: 'knowledge_search', arguments: { query: 'orders', env: 'dev' } });
  assert.equal(result.backend, 'independent-worker'); assert.equal(result.input.query, 'orders');
  assert.equal(lastRequest.protocol, 'dt.tool/v1'); assert.equal(lastRequest.authorization, 'Bearer backend-private-token');
  const requestSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/v1/tool-request.schema.json')));
  const { authorization, ...wire } = lastRequest;
  assert.deepEqual(Schema.validate(wire, requestSchema), []);
  assert.equal((await (await fetch(base + '/contracts/v1/tool-request.schema.json')).json()).$id, 'urn:dt:tool-request:v1');
  const desc = await T.call('tool_describe', { name: 'knowledge_search' }); assert.equal(desc.execution.transport, 'http');
  assert.doesNotMatch(JSON.stringify(desc), /backend-private-token/);
});
test('backend versions/request identity/errors fail without falling back to local results', async () => {
  for (const value of ['wrong-version', 'wrong-request', 'null-error', 'error']) {
    mode = value;
    await assert.rejects(T.call('knowledge_search', { query: 'orders' }), e => value === 'error' ? e.code === 'CUSTOM_FAILURE' && !e.message.includes('backend-private-token') : e.code === 'DT_BACKEND_CONTRACT');
  }
  mode = 'timeout'; config({ backends: { knowledge_search: { url: backendUrl, timeoutMs: 30 } } });
  await assert.rejects(T.call('knowledge_search', { query: 'orders' }), /timeout|aborted/i);
  mode = 'success'; config();
});
test('schema constraints cannot silently weaken a replacement backend contract', () => {
  for (const [value, schema] of [[3, { type: 'number', multipleOf: 2 }], [[], { type: 'array', contains: { const: 1 }, minContains: 1 }], [{ x: 1 }, { unevaluatedProperties: false }], [{ credit: true }, { dependentRequired: { credit: ['billing'] } }], [[{ a: 1, b: 2 }, { b: 2, a: 1 }], { uniqueItems: true }]]) assert.ok(Schema.validate(value, schema).length, JSON.stringify(schema));
  assert.deepEqual(Schema.validate([1], { type: 'array', contains: { const: 1 }, minContains: 1, maxContains: 1 }), []);
});
test('longest-prefix routes allow gradual replacement while exact routes take precedence', async () => {
  config({ backends: { 'knowledge_*': { url: backendUrl }, knowledge_search: { url: backendUrl, token: 'exact-token' } } });
  await T.call('knowledge_sources', {}); assert.equal(lastRequest.authorization, undefined);
  const graph = await T.call('knowledge_graph', {}); assert.match(graph.view, /\/show\//, 'presentation remains local and enabled when storage/query backend changes');
  await T.call('knowledge_search', { query: 'orders' }); assert.equal(lastRequest.authorization, 'Bearer exact-token');
  config({ disable: ['knowledge_search'], backends: { 'knowledge_*': { url: backendUrl } } });
  const before = hits; await assert.rejects(T.call('knowledge_search', { query: 'orders' }), /Unknown tool/); assert.equal(hits, before); config();
});
test('logs retain structure but redact nested credentials and linked error/note values', async () => {
  const trace = require('../lib/trace'), token = 'one-use-private-token';
  await assert.rejects(trace.call('private_call', { headers: { authorization: token }, url: 'postgres://user:password@localhost/db?token=query-token' }, {}, async () => { trace.note(`upstream rejected ${token}`); await trace.step('read', async () => { throw new Error(`invalid ${token}`); }); }), /invalid/);
  const calls = require('../lib/calls'); calls.record({ tool: 'private_call', args: { apiKey: token, nested: { password: 'db-private' } }, error: `failed ${token} db-private`, ok: false });
  const evidence = JSON.stringify({ trace: trace.tail({ tool: 'private_call' }), history: calls.history({ tool: 'private_call' }) });
  for (const value of [token, 'db-private', 'query-token', 'user:password']) assert.ok(!evidence.includes(value), value);
  assert.match(evidence, /redacted/);
});
test('HTTP input body budget is enforced before parsing or backend execution', async () => {
  config({ maxInputBytes: 100 });
  const before = hits, r = await post('/oapi/tool_search', { query: 'x'.repeat(150) });
  assert.equal(r.status, 413); assert.equal((await r.json()).code, 'DT_ARGUMENT_INVALID'); assert.equal(hits, before); config();
});
test('declared argument evidence policy runs before tracing, including discovery dispatch', async () => {
  fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins/private.js'), `module.exports=[{name:'private_exchange',description:'Test evidence policy',input:{id:{type:'string'},payload:{type:'string'},har:{type:'object'},fail:{type:'boolean'}},logArgs:['id'],run:a=>{if(a.fail)throw new Error('rejected '+a.har.request.headers[0].value+' '+JSON.parse(a.har.request.postData.text).password);return{executionReceivedOriginal:a.payload==='opaque-business-input'}}}];`);
  await T.reload();
  const args = { id: 'exchange-42', payload: 'opaque-business-input', har: { request: { headers: [{ name: 'Cookie', value: 'session=one-use-cookie' }], postData: { text: '{"password":"one-use-post-password"}' } } } };
  assert.equal((await T.call('tool_execute', { name: 'private_exchange', arguments: args })).executionReceivedOriginal, true);
  await assert.rejects(T.call('tool_execute', { name: 'private_exchange', arguments: { ...args, fail: true } }), /rejected/);
  const evidence = JSON.stringify({ trace: require('../lib/trace').tail(), history: require('../lib/calls').history({ limit: 100 }) });
  for (const value of ['opaque-business-input', 'session=one-use-cookie', 'one-use-post-password']) assert.ok(!evidence.includes(value), value);
  assert.match(evidence, /exchange-42/); assert.match(evidence, /argumentsOmitted/);
});

test('direct profile is the chat default: everyday tools by name, discovery only for the rest', async () => {
  config();
  assert.equal(require('../lib/config').getTools().profile, 'direct');
  const all = await T.schemas(), direct = (await T.schemas({ profile: 'direct' })).map(t => t.name);
  for (const name of ['find', 'pg_query', 'pg_table', 'es_search', 'kafka_last', 'logs_search', 'bitbucket_file', 'bitbucket_files', 'bitbucket_pr', 'code_search', 'test_run', 'tool_search', 'tool_execute']) assert.ok(direct.includes(name), name);
  assert.ok(direct.length < all.length / 2, `${direct.length} of ${all.length}`);
  assert.ok(!direct.some(n => n.startsWith('fixture_') || n.startsWith('scenario_')), 'specialised tools are reached through tool_search');
});

test('tool_search lists the direct tool first for everyday words; an exact name stays first', async () => {
  const tools = await T.schemas({ metadata: true }), first = q => require('../lib/tool-search').search(tools, q).matches[0]?.t.name;
  assert.equal(first('query the orders table in postgres'), 'pg_query');
  assert.equal(first('search elasticsearch index for order 42'), 'es_search');
  assert.equal(first('show application.yml in repo payments'), 'bitbucket_file');
  assert.equal(first('open pull request 12'), 'bitbucket_pr');
  assert.equal(first('last messages on order_created'), 'kafka_last');
  assert.equal(first('errors in the logs'), 'logs_search');
  assert.equal(first('kafka_lag'), 'kafka_lag');
});

test('repo tools take a slug alone: PROJECT/repo, or the project from what dt already knows', async () => {
  const A = require('../lib/atlassian');
  assert.deepEqual(await A.projectOf(undefined, 'PAY/payments-service'), { project: 'PAY', repo: 'payments-service' });
  assert.deepEqual(await A.projectOf('PAY', 'payments-service'), { project: 'PAY', repo: 'payments-service' });
  const index = require('../lib/bbindex'), saved = index.load;
  index.load = () => ({ repos: [{ project: 'SHOP', repo: 'orders' }, { project: 'A', repo: 'common' }, { project: 'B', repo: 'common' }] });
  try {
    assert.deepEqual(await A.projectOf(undefined, 'orders'), { project: 'SHOP', repo: 'orders' });
    await assert.rejects(A.projectOf(undefined, 'common'), /several projects \(A, B\)/);
  } finally { index.load = saved; }
  for (const name of ['bitbucket_file', 'bitbucket_files', 'bitbucket_pr', 'bitbucket_prs']) assert.ok(!(await T.schemas()).find(t => t.name === name).inputSchema.required.includes('project'), name);
});

test('agent prompt sends the model to direct tools before discovery', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../lib/agent-prompt.md'), 'utf8'), lines = prompt.split('\n').filter(Boolean);
  assert.match(lines[1], /direct tool/); assert.match(lines[1], /bitbucket_file/); assert.match(lines[1], /pg_query/);
  assert.ok(prompt.indexOf('tool_search') > prompt.indexOf('bitbucket_pr'), 'discovery comes after the direct map');
  assert.ok(prompt.length < 9000, `${prompt.length} chars`);
});

test('tester profile: ready-made checks, test data, scenarios, API capture, scripts and suites by name', async () => {
  config();
  const all = await T.schemas(), tester = (await T.schemas({ profile: 'tester' })).map(t => t.name);
  for (const name of ['checks', 'fixture_plan', 'fixture_capture', 'testdb_template_build', 'scenario_run', 'api_browser_open', 'api_request_save', 'collection_run', 'script_save', 'test_run', 'logs_search', 'tool_search']) assert.ok(tester.includes(name), name);
  assert.ok(tester.length < all.length / 2, `${tester.length} of ${all.length}`);
  assert.ok(!tester.includes('evaluation_evidence') && !tester.includes('differential_check'), 'specialised extras stay behind tool_search');
});

test('starter checks are copied once: edits stay, a deleted collection stays deleted, starters:false turns it off', () => {
  const S = require('../lib/scripts'), dir = path.join(S.DIR, 'checks');
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(S.DIR, '.starters.json'), { force: true });
  config({}); fs.writeFileSync(configFile, JSON.stringify({ envs: { dev: {} }, scripts: { starters: false } })); require('../lib/config').reload();
  assert.deepEqual(S.seedStarters(), []); assert.ok(!fs.existsSync(dir), 'opt-out copies nothing');
  config();
  assert.deepEqual(S.seedStarters(), ['checks']);
  assert.deepEqual(fs.readdirSync(dir).sort(), fs.readdirSync(path.join(S.STARTERS, 'checks')).sort());
  fs.writeFileSync(path.join(dir, 'service.json'), JSON.stringify({ description: 'mine', steps: [] }));
  assert.deepEqual(S.seedStarters(), []); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'service.json'))).description, 'mine', 'an edited check is kept');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(S.seedStarters(), []); assert.ok(!fs.existsSync(dir), 'a deleted collection is not re-created');
  fs.rmSync(path.join(S.DIR, '.starters.json'), { force: true }); S.seedStarters();
});

test('checks/service and checks/table read their sources, test the results and fail on an unavailable source', async () => {
  const S = require('../lib/scripts'), def = name => ({ id: `checks/${name}`, ...JSON.parse(fs.readFileSync(path.join(S.STARTERS, 'checks', `${name}.json`), 'utf8')) });
  const healthy = { consul_service: { instances: [{ node: 'n1', status: 'passing', meta: { version: '1.2.0' } }] }, logs_search: { total: 0, services: [], preview: [] }, kafka_lag: { rows: [{ group: 'pay', lag: 3, state: 'STABLE' }] } };
  const calls = [], call = (tools, fail) => async (name, args) => { calls.push(name); if (fail === name) throw new Error('ECONNREFUSED'); return tools[name]; };
  const ok = await S.run(def('service'), { service: 'pay', env: 'dev' }, { call: call(healthy) });
  assert.equal(ok.ok, true, ok.error); assert.equal(ok.tests.passed, 3); assert.deepEqual(ok.results.check.versions, ['1.2.0']);
  const broken = await S.run(def('service'), { service: 'pay' }, { call: call({ ...healthy, consul_service: { instances: [{ node: 'n1', status: 'critical' }] }, logs_search: { total: 2, services: [{ key: 'pay', count: 2 }], preview: [{ service: 'pay', message: 'boom 1' }, { service: 'pay', message: 'boom 2' }] } }) });
  assert.equal(broken.ok, false); assert.equal(broken.tests.failed, 2); assert.deepEqual(broken.results.check.errors, [{ message: 'boom N', count: 2 }], 'errors are grouped by message');
  const offline = await S.run(def('service'), { service: 'pay' }, { call: call(healthy, 'logs_search') });
  assert.equal(offline.ok, false, 'an unavailable source never passes its test');
  assert.match(offline.tests.list.find(t => !t.ok).error, /logs unavailable: ECONNREFUSED/);
  const table = await S.run(def('table'), { table: 'sales.orders', where: 'id > 0' }, { call: call({ pg_table: [{ columns: [{ name: 'id', type: 'bigint', nullable: false }] }], pg_query: { preview: [{ rows: '7' }], view: 'v' }, pg_usage: { rows: [{ user: 'order-service', role: 'write', where: 'OrderDao.java:10' }] } }) });
  assert.equal(table.ok, true, table.error); assert.equal(table.results.check.rows, 7); assert.deepEqual(table.results.check.columns, ['id bigint not null']); assert.deepEqual(table.results.check.usedBy, ['order-service write OrderDao.java:10']);
  await assert.rejects(Promise.resolve(S.run(def('table'), { table: 'x; drop table y' }, { call: call({}) })).then(r => { if (!r.ok) throw new Error(r.error); }), /schema\.table/);
});
