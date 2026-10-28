const assert = require('assert/strict');
const { performance } = require('perf_hooks');
const { configure, put } = require('./discovery-fixture');
async function checks(T, home, toolSettings = {}) {
  const evidence = {}, K = require('../../lib/semantic-knowledge');
  assert.equal(K.sync('guide').ok, true);
  const discovered = await T.call('tool_search', { query: 'knowledge_entity', limit: 3 });
  assert.equal(discovered.tools[0].name, 'knowledge_entity');
  const described = await T.call('tool_describe', discovered.tools[0].next.args);
  assert.ok(described.inputSchema.required.includes('id'));
  let invalid;
  try { await T.call('tool_execute', { name: described.name, arguments: { id: 42, env: 'staging' } }); }
  catch (e) { invalid = { code: e.code, issues: e.issues }; }
  assert.equal(invalid.code, 'DT_ARGUMENT_INVALID');
  const recovered = await T.call('tool_execute', { name: described.name, arguments: { id: 'table:orders:public.orders', env: 'staging' } });
  assert.equal(recovered.env, 'staging'); assert.equal(recovered.nodes.some(n => n.id === 'table:orders:public.orders'), true);
  evidence.invalidArgumentRecovery = { discovery: described.name, invalid, recovered: true, calls: 4, execution: 'cached local semantic entity only' };
  const ambiguous = await T.call('tool_execute', { name: 'knowledge_entity', arguments: { id: 'public.orders', env: 'staging' } });
  assert.equal(ambiguous.complete, false); assert.equal(ambiguous.candidates.length, 2);
  evidence.ambiguity = { complete: ambiguous.complete, candidates: ambiguous.candidates.map(n => n.id) };
  const old = K.graph('staging').sources.find(x => x.id === 'guide').revision;
  put(home, 'sources/guide.json', '{broken'); assert.equal(K.sync('guide').ok, false);
  const stale = await T.call('tool_execute', { name: 'knowledge_graph', arguments: { env: 'staging' } });
  assert.equal(stale.complete, false); assert.ok(stale.gaps.some(g => g.kind === 'source-update-failed'));
  assert.equal(stale.sources.find(x => x.id === 'guide').revision, old);
  evidence.staleSource = { retainedRevision: old, complete: stale.complete, failedUpdateReported: true, scope: 'configured JSON source; not a code/passport freshness guarantee' };
  const requested = await T.call('find', { q: 'pg: orders', env: 'staging' });
  assert.equal(requested.length, 2);
  evidence.environment = { requested: 'staging', catalogMatches: requested.length };
  configure(home, { ...toolSettings, disable: ['knowledge_entity'] }); await T.reload();
  const permissions = await T.call('tool_search', { query: 'knowledge_entity', limit: 30 });
  assert.ok(!permissions.tools.some(t => t.name === 'knowledge_entity'));
  await assert.rejects(T.call('tool_describe', { name: 'knowledge_entity' }), /disabled/);
  await assert.rejects(T.call('tool_execute', { name: 'knowledge_entity', arguments: { id: 'orders' } }), e => e.code === 'DT_TOOL_UNKNOWN');
  await assert.rejects(T.call('tool_execute', { name: 'tool_execute', arguments: {} }), /directly/);
  evidence.permissions = { hiddenFromDiscovery: true, describeDenied: true, executeDenied: true, recursiveDispatcherDenied: true };
  configure(home, toolSettings); await T.reload();
  const server = require('../../server').start({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, durations = [];
  try {
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      const post = async (name, input) => { const res = await fetch(base + '/api/tool/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(res.status, 200); return (await res.json()).result; };
      const search = await post('tool_search', { query: 'knowledge_entity', limit: 3 });
      const describe = await post('tool_describe', search.tools[0].next.args);
      const executed = await post('tool_execute', { name: describe.name, arguments: { id: 'table:orders:public.orders', env: 'dev' } });
      assert.equal(executed.env, 'dev'); durations.push(performance.now() - start);
    }
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const sorted = [...durations].sort((a, b) => a - b);
  evidence.httpWorkflowLatencyMs = { kind: 'localhost HTTP discovery → describe → execute cached entity; three serial requests; no model inference', samples: durations.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], first: durations[0] };
  return evidence;
}
module.exports = { checks };
