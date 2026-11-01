const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-context-'));
process.env.DT_CONFIG_DIR = tmp; process.env.DT_CACHE_DIR = path.join(tmp, 'cache');
const C = require('../lib/context'), tools = require('../lib/tools');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('contexts persist and rediscover by strong identity, related repositories and indexed file summaries', () => {
  const empty = C.find({ query: 'SHOP-42', tickets: ['SHOP-42'] });
  assert.equal(empty.indexedContexts, 0); assert.equal(empty.next.tool, 'context_open'); assert.deepEqual(empty.next.arguments.tickets, ['SHOP-42']);
  const a = C.open({ title: 'Fix order rounding', tickets: ['SHOP-42'], repositories: ['SHOP/orders'], workspaces: ['w1'], chats: ['chat-a'] });
  assert.equal(a.created, true); assert.ok(a.files.some(f => f.path === 'progress.md'));
  const b = C.open({ title: 'Continue in another chat', tickets: ['shop-42'], chats: ['chat-b'], workspaces: ['w2'] });
  assert.equal(b.id, a.id); assert.deepEqual(b.chats, ['chat-a', 'chat-b']); assert.deepEqual(b.workspaces, ['w1', 'w2']);
  C.write({ id: a.id, path: 'findings/rounding.md', content: 'Evidence at orders.java:42', summary: 'banker rounding discrepancy' });
  for (const query of ['SHOP-42', 'SHOP/orders', 'w2', 'chat-b', 'rounding discrepancy']) assert.equal(C.find({ query }).contexts[0].id, a.id);
  const other = C.open({ title: 'Similar repository task', tasks: ['task-b'], repositories: ['SHOP/orders'] });
  assert.notEqual(other.id, a.id); assert.equal(C.find({ repositories: ['SHOP/orders'] }).total, 2);
  const absent = C.find({ query: 'unrelated-unknown-task' }); assert.ok(absent.indexedContexts >= 2); assert.equal(absent.total, 0);
  const ambiguous = C.open({ title: 'merge?', tickets: ['SHOP-42'], tasks: ['task-b'] });
  assert.equal(ambiguous.ambiguous, true); assert.equal(C.find().total, 2);
  delete require.cache[require.resolve('../lib/context')];
  assert.equal(require('../lib/context').get(a.id).title, 'Fix order rounding');
  const index = JSON.parse(fs.readFileSync(path.join(a.folder, 'index.json'))); assert.equal(index.files.length, 2);
});

test('files retain revisions, append, binary round trips and index metadata conflicts', () => {
  const c = C.open({ title: 'Files' });
  const r = C.write({ id: c.id, path: 'nested/note.txt', content: 'one', expected_revision: null });
  assert.throws(() => C.write({ id: c.id, path: r.path, content: 'overwrite', expected_revision: null }), /changed/);
  C.write({ id: c.id, path: r.path, content: '\ntwo', append: true, expected_revision: r.revision });
  assert.equal(C.read({ id: c.id, path: r.path }).content, 'one\ntwo');
  assert.throws(() => C.remove({ id: c.id, path: r.path, expected_revision: r.revision }), /changed/);
  const bytes = Buffer.from([0, 255, 65, 0, 128]); C.write({ id: c.id, path: 'image.bin', content: bytes.toString('base64'), encoding: 'base64' });
  assert.deepEqual(Buffer.from(C.read({ id: c.id, path: 'image.bin', encoding: 'base64' }).content, 'base64'), bytes);
  assert.throws(() => C.write({ id: c.id, path: 'bad.bin', content: '!!!', encoding: 'base64' }), /base64/);
  assert.throws(() => C.write({ id: c.id, path: 'huge.txt', content: 'x'.repeat(2 * 1024 * 1024 + 1) }), /exceeds/);
  C.update({ id: c.id, title: 'Changed by another chat', expected_revision: c.revision });
  assert.throws(() => C.update({ id: c.id, title: 'stale', expected_revision: c.revision }), /changed/);
  const current = C.get(c.id); C.update({ id: c.id, summary: 'complete', status: 'done', expected_revision: current.revision });
  assert.equal(C.get(c.id).status, 'done');
  C.remove({ id: c.id, path: 'image.bin' }); assert.ok(!C.get(c.id).files.some(f => f.path === 'image.bin'));
});

test('context store rejects traversal, symlink escapes, index overwrite and corrupt indexes without hiding healthy results', () => {
  const c = C.open({ title: 'Security' });
  for (const p of ['../escape', '/absolute', 'nested/../../escape', '.env', 'nested/.env', 'index.json', 'a\\b']) assert.throws(() => C.write({ id: c.id, path: p, content: 'no' }));
  assert.throws(() => C.get('../outside'));
  fs.symlinkSync(tmp, path.join(c.folder, 'escape'));
  assert.throws(() => C.write({ id: c.id, path: 'escape/file.txt', content: 'no' }), /symbolic/);
  fs.unlinkSync(path.join(c.folder, 'escape'));
  fs.symlinkSync(path.join(c.folder, 'progress.md'), path.join(c.folder, 'linked.md'));
  assert.throws(() => C.read({ id: c.id, path: 'linked.md' }), /symbolic/);
  fs.unlinkSync(path.join(c.folder, 'linked.md'));
  fs.writeFileSync(path.join(c.folder, 'index.json'), '{invalid');
  assert.ok(C.find().errors.some(e => e.id === c.id)); assert.ok(C.find().total >= 2);
});

test('registry capture uses tool validation, persists success/failure and redacts secrets', async () => {
  const c = await tools.call('context_open', { title: 'Tool capture', tasks: ['capture'] });
  const r = await tools.call('context_run', { id: c.id, tool: 'find', arguments: { q: 'orders', token: 'secret-1234' } });
  assert.equal(r.ok, true); assert.ok(r.saved); assert.ok(!r.preview.includes('secret-1234'));
  const snapshot = JSON.parse(C.read({ id: c.id, path: r.saved }).content);
  assert.equal(snapshot.arguments.token, '[redacted]'); assert.equal(snapshot.tool, 'find'); assert.ok(snapshot.completedAt);
  const bad = await tools.call('context_run', { id: c.id, tool: 'pg_query', arguments: {} });
  assert.equal(bad.ok, false); assert.match(bad.error.message, /Missing argument: sql/); assert.ok(bad.saved);
  await assert.rejects(() => tools.call('context_run', { id: c.id, tool: 'tool_execute', arguments: {} }), /concrete/);
  await assert.rejects(() => tools.call('context_run', { id: c.id, tool: 'context_run', arguments: {} }), /concrete/);
  await assert.rejects(() => tools.call('context_write', { id: c.id, path: 'a', content: 'b', bogus: true }), /bogus|additional/i);
});

test('hints discover exact schemas and validate model suggestions without executing them', async () => {
  const c = C.open({ title: 'Hint', tickets: ['HINT-1'] });
  const offline = await C.hint({ id: c.id, goal: 'pg_query' }); assert.equal(offline.candidates[0].name, 'pg_query');
  let response = { explanation: 'Need SQL', tool: 'pg_query', arguments: {}, missing: ['SQL'] }, requests = 0;
  const provider = http.createServer((req, res) => { requests++; let b = ''; req.on('data', d => b += d).on('end', () => { const body = JSON.parse(b); assert.match(body.messages[1].content, /HINT-1/); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })); }); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const configFile = path.join(tmp, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ envs: { test: {} }, llm: { baseUrl: `http://127.0.0.1:${provider.address().port}`, model: 'fake' } })); require('../lib/config').reload();
  try {
    const invalid = await C.hint({ id: c.id, goal: 'pg_query', use_model: true }); assert.equal(invalid.ready, false); assert.ok(invalid.validation.length);
    response = { explanation: 'Inspect cached names', tool: 'find', arguments: { q: 'orders' }, missing: [] };
    const good = await C.hint({ id: c.id, goal: 'find', use_model: true }); assert.equal(good.ready, true); assert.equal(good.suggestion.tool, 'find');
    response.tool = 'made_up_tool'; await assert.rejects(() => C.hint({ id: c.id, goal: 'find', use_model: true }), /unavailable/);
    assert.equal(C.get(c.id).files.length, 1, 'hint does not run or capture any tool'); assert.equal(requests, 3);
  } finally { await new Promise(r => provider.close(r)); fs.unlinkSync(configFile); require('../lib/config').reload(); }
});


test('chat session links are inferred from transport metadata and exact ids accept new links', async () => {
  const a = await tools.call('context_open', { title: 'Session context' }, { session: 'transport-chat' });
  assert.deepEqual(a.chats, ['transport-chat']);
  const b = await tools.call('context_open', { title: 'Resume context' }, { session: 'transport-chat' });
  assert.equal(a.id, b.id);
  const c = await tools.call('context_open', { id: a.id, workspaces: ['extra-workspace'] }, { session: 'another-transport-chat' });
  assert.ok(c.chats.includes('another-transport-chat')); assert.ok(c.workspaces.includes('extra-workspace'));
  const other = await tools.call('context_open', { title: 'New ticket in the same chat', tickets: ['NEW-99'] }, { session: 'transport-chat' });
  assert.notEqual(other.id, a.id); assert.deepEqual(other.tickets, ['NEW-99']);
});

test('capture respects disabled tools and distinguishes an oversized save from tool execution', async () => {
  const c = C.open({ title: 'Capture limits' });
  const cfg = path.join(tmp, 'config.json'), plugin = path.join(tmp, 'capture-fixture.js');
  fs.writeFileSync(plugin, `let calls=0; module.exports=[{name:'fixture_large_output',description:'Capture test',input:{large:{type:'boolean'}},run:a=>a.large?{calls:++calls,payload:'x'.repeat(2*1024*1024+1)}:{calls}}];`);
  fs.writeFileSync(cfg, JSON.stringify({ envs: { test: {} }, tools: { plugins: ['capture-fixture.js'], disable: ['find'] } })); require('../lib/config').reload(); await tools.reload();
  try {
    const disabled = await C.run({ id: c.id, tool: 'find', arguments: { q: 'orders' } });
    assert.equal(disabled.ok, false); assert.match(disabled.error.message, /Unknown tool/); assert.ok(disabled.saved);
    assert.ok(!(await C.hint({ id: c.id, goal: 'find' })).candidates.some(t => t.name === 'find'));
    const large = await C.run({ id: c.id, tool: 'fixture_large_output', arguments: { large: true } });
    assert.equal(large.ok, true); assert.equal(large.saved, null); assert.match(large.saveError, /exceeds/); assert.equal(large.truncated, true); assert.ok(large.preview.length <= 24000);
    assert.equal((await tools.call('fixture_large_output', {})).calls, 1, 'capture failures never retry execution');
  } finally { fs.unlinkSync(cfg); fs.unlinkSync(plugin); require('../lib/config').reload(); await tools.reload(); }
});


test('ticket/task/chat classification mistakes discover related memory without implicit merging', () => {
  const original = C.open({ title: 'Completed invoice investigation', tickets: ['FIN-624'], chats: ['prior-chat'] });
  const found = C.find({ tasks: ['FIN-624'] });
  assert.equal(found.contexts[0].id, original.id); assert.equal(found.contexts[0].matchKind, 'related-identity');
  assert.equal(found.contexts[0].next.tool, 'context_get');
  const open = C.open({ title: 'Maybe same work', tasks: ['FIN-624'] });
  assert.equal(open.ambiguous, true); assert.equal(open.candidates[0].id, original.id);
  assert.deepEqual(C.get(original.id).tasks, []);
  const selected = C.open({ id: original.id, tasks: ['FIN-624'] }); assert.deepEqual(selected.tasks, ['FIN-624']);
  assert.equal(C.find({ tasks: ['FIN-624'] }).contexts[0].matchKind, 'linked');
});
