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
