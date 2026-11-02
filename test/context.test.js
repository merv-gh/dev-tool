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

test('nearby files list folders, search bounded body excerpts and edit exact text without losing concurrent changes', async () => {
  const c = C.open({ title: 'Nearby files' });
  C.write({ id: c.id, path: 'inputs/orders.txt', content: 'one\nPaid order\nthree\nPaid again\n', summary: 'Order evidence' });
  C.write({ id: c.id, path: 'inputs/binary.bin', content: 'AAEC/w==', encoding: 'base64' });
  const listed = await tools.call('context_list', { id: c.id });
  assert.ok(listed.entries.some(f => f.path === 'inputs' && f.dir)); assert.ok(!listed.entries.some(f => f.path === 'index.json'));
  assert.equal(C.list({ id: c.id, recursive: true, offset: 1, limit: 1 }).truncated, true);
  const found = await tools.call('context_search', { id: c.id, dir: 'inputs', query: 'paid', limit: 1 });
  assert.equal(found.hits[0].path, 'inputs/orders.txt'); assert.equal(found.hits[0].line, 2); assert.equal(found.truncated, true);
  assert.ok(found.skipped.some(f => f.reason === 'binary')); assert.ok(found.hits[0].match.length < 500);
  assert.equal(C.search({ id: c.id, dir: 'inputs', query: 'paid', case_sensitive: true }).hits.length, 0);
  assert.equal(C.search({ id: c.id, query: 'Paid', pattern: '*.bin' }).hits.length, 0);
  const range = await tools.call('context_read', { id: c.id, path: 'inputs/orders.txt', from: 2, to: 2 });
  assert.equal(range.content, 'Paid order'); assert.equal(range.truncated, true); assert.equal(range.lines, 5);
  assert.equal(range.revision, C.read({ id: c.id, path: range.path }).revision);
  assert.throws(() => C.read({ id: c.id, path: range.path, from: 0 }), /integer/);
  assert.throws(() => C.read({ id: c.id, path: 'inputs/binary.bin', from: 1 }), /text/);
  assert.throws(() => C.edit({ id: c.id, path: range.path, edits: [{ find: 'one', replace: '1' }] }), /requires expected_revision/);
  const edit = await tools.call('context_edit', { id: c.id, path: range.path, expected_revision: range.revision, edits: [{ find: 'Paid order', replace: '$& settled' }] });
  assert.equal(C.read({ id: c.id, path: range.path }).content, 'one\n$& settled\nthree\nPaid again\n');
  assert.throws(() => C.edit({ id: c.id, path: range.path, expected_revision: range.revision, edits: [{ find: 'one', replace: 'stale' }] }), /changed/);
  assert.throws(() => C.edit({ id: c.id, path: range.path, expected_revision: edit.revision, edits: [{ find: 'one', replace: 'changed' }, { find: 'absent', replace: 'no' }] }), /exactly once/);
  assert.equal(C.read({ id: c.id, path: range.path }).revision, edit.revision, 'failed edit is atomic');
  C.write({ id: c.id, path: 'duplicate.txt', content: 'aaa' });
  assert.throws(() => C.edit({ id: c.id, path: 'duplicate.txt', expected_revision: C.read({ id: c.id, path: 'duplicate.txt' }).revision, edits: [{ find: 'aa', replace: 'b' }] }), /exactly once/);
  for (const operation of ['list', 'search']) assert.throws(() => C[operation]({ id: c.id, dir: '../escape', query: 'x' }));
  fs.symlinkSync(tmp, path.join(c.folder, 'linked'));
  try { for (const operation of ['list', 'search']) assert.throws(() => C[operation]({ id: c.id, dir: 'linked', query: 'x' }), /symbolic/); }
  finally { fs.unlinkSync(path.join(c.folder, 'linked')); }
});

test('Context file-store adapter supports browsing, exact binary copies and budgets without enabling other stores for writing', async () => {
  const F = require('../lib/files'), c = C.open({ title: 'Context mount' }), other = C.open({ title: 'Other mount' });
  assert.equal(C.get(c.id).store, `context:${c.id}`);
  await F.write(`context:${c.id}`, 'artifacts/bytes.bin', 'AP+A/w==', { base64: true });
  await F.copy(`context:${c.id}`, 'artifacts/bytes.bin', `context:${other.id}`, 'copied.bin');
  assert.equal(C.read({ id: other.id, path: 'copied.bin', encoding: 'base64' }).content, 'AP+A/w==');
  await assert.rejects(() => F.copy(`context:${c.id}`, 'artifacts/bytes.bin', `context:${other.id}`, 'copied.bin'), /changed/);
  await F.copy(`context:${c.id}`, 'artifacts/bytes.bin', `context:${other.id}`, 'copied.bin', { overwrite: true });
  const listing = await F.list(`context:${c.id}`, '', { recursive: true });
  assert.ok(listing.some(f => f.path === 'artifacts/bytes.bin')); assert.ok(!listing.some(f => f.path === 'index.json'));
  const browse = await tools.call('files_browse', { store: `context:${c.id}` }); assert.match(browse.view, /\/files\//);
  const browseData = require('../lib/results').load(browse.view.split('/').pop()); assert.equal(browseData.data.store, `context:${c.id}`);
  await F.mkdir(`context:${c.id}`, 'empty/folder'); assert.ok((await F.list(`context:${c.id}`, 'empty')).some(f => f.dir));
  for (const file of ['index.json', '.env', '../escape']) await assert.rejects(() => F.write(`context:${c.id}`, file, 'no'));
  await assert.rejects(() => F.write(`context:${c.id}`, 'oversized', 'x'.repeat(2 * 1024 * 1024 + 1)), /exceeds/);
  fs.symlinkSync(tmp, path.join(c.folder, 'escape'));
  try { await assert.rejects(() => F.read(`context:${c.id}`, 'escape/file'), /symbolic/); } finally { fs.unlinkSync(path.join(c.folder, 'escape')); }
  const cfg = path.join(tmp, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ envs: { test: {} }, files: { readonly: { type: 'local', path: 'read-only' } } })); require('../lib/config').reload();
  try { await assert.rejects(() => F.copy(`context:${c.id}`, 'progress.md', 'readonly', 'notes.md'), /read-only/); }
  finally { fs.unlinkSync(cfg); require('../lib/config').reload(); }
});

test('code works with nearby JSON and notes through enabled tools, rejects blind or stale writes and keeps scopes separate', async () => {
  const c = C.open({ title: 'File computations' });
  C.write({ id: c.id, path: 'inputs/orders.json', content: JSON.stringify([{ amount: 5 }, { amount: 7 }]) });
  const result = await tools.call('code', { context: c.id, code: `
    const rows = await files.readJson('inputs/orders.json');
    await files.writeJson('results/total.json', {sum:rows.reduce((n,r)=>n+r.amount,0)}, {summary:'Verified aggregate'});
    const progress = await files.read('progress.md');
    await files.write('progress.md', progress + '\\nCalculated total: 12\\n');
    await files.edit('progress.md', [{find:'Investigate and record evidence',replace:'Calculate and save evidence'}]);
    const hits = await files.search('Calculated total');
    return {sum:(await files.readJson('results/total.json')).sum, hits:hits.hits.length, files:(await files.list('results')).total};` });
  assert.equal(result.ok, true, result.error); assert.deepEqual(result.returned, { sum: 12, hits: 1, files: 1 });
  assert.equal(JSON.parse(C.read({ id: c.id, path: 'results/total.json' }).content).sum, 12);
  const blind = await tools.call('code', { context: c.id, code: `await files.write('progress.md','blind overwrite');` });
  assert.equal(blind.ok, false); assert.match(blind.error, /changed/);
  const partial = await tools.call('code', { context: c.id, code: `const r=await files.readFile('progress.md',{from:1,to:1});await files.write('progress.md',r.content);` });
  assert.equal(partial.ok, false); assert.match(partial.error, /changed/);
  const stale = await tools.call('code', { context: c.id, code: `await files.read('progress.md');await tools.context_write({id:files.id,path:'progress.md',content:'Edited by another chat'});await files.write('progress.md','lost update');` });
  assert.equal(stale.ok, false); assert.match(stale.error, /changed/); assert.equal(C.read({ id: c.id, path: 'progress.md' }).content, 'Edited by another chat');
  const noScope = await tools.call('code', { code: `return files.read('progress.md')` }); assert.equal(noScope.ok, false); assert.match(noScope.error, /pass the id/);
  const escape = await tools.call('code', { context: c.id, code: `await files.read('../other/progress.md');` }); assert.equal(escape.ok, false); assert.match(escape.error, /relative/);
  const cfg = path.join(tmp, 'config.json'); fs.writeFileSync(cfg, JSON.stringify({ envs: { test: {} }, tools: { disable: ['context_write'] } })); require('../lib/config').reload(); await tools.reload();
  try {
    const disabled = await tools.call('code', { context: c.id, code: `await files.write('disabled.txt','no');` }); assert.equal(disabled.ok, false); assert.match(disabled.error, /Unknown tool/);
    assert.ok(!C.get(c.id).files.some(f => f.path === 'disabled.txt'));
  } finally { fs.unlinkSync(cfg); require('../lib/config').reload(); await tools.reload(); }
});

test('body search reports scan limits, and binary edits never rewrite bytes as text', () => {
  const c = C.open({ title: 'Search budgets' }), data = 'searchable\n' + 'x'.repeat(2 * 1024 * 1024 - 11);
  for (let i = 0; i < 9; i++) C.write({ id: c.id, path: `evidence/${i}.txt`, content: data });
  const result = C.search({ id: c.id, dir: 'evidence', query: 'searchable' });
  assert.ok(result.scannedBytes <= 16 * 1024 * 1024); assert.equal(result.truncated, true); assert.ok(result.skipped.some(f => f.reason === 'scan budget'));
  C.write({ id: c.id, path: 'binary.bin', content: '/wAB', encoding: 'base64' });
  const before = C.read({ id: c.id, path: 'binary.bin', encoding: 'base64' });
  assert.throws(() => C.edit({ id: c.id, path: 'binary.bin', expected_revision: before.revision, edits: [{ find: 'x', replace: 'y' }] }), /UTF-8/);
  assert.equal(C.read({ id: c.id, path: 'binary.bin', encoding: 'base64' }).content, before.content);
});

test('nearby generated files export through workspace_write and retain its path validation', async () => {
  const c = C.open({ title: 'Workspace export', workspaces: ['context-export'] }), W = require('../lib/config').PATHS;
  const work = path.join(tmp, 'export-workspace'); fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(path.join(W.cache, 'work'), { recursive: true });
  fs.writeFileSync(path.join(W.cache, 'work', 'context-export.json'), JSON.stringify({ id: 'context-export', path: work, createdAt: new Date().toISOString() }));
  C.write({ id: c.id, path: 'scripts/check.js', content: 'module.exports = 42;\n' });
  const result = await tools.call('code', { context: c.id, code: `return await tools.workspace_write({workspace:'context-export',path:'scripts/check.js',content:await files.read('scripts/check.js'),check:false});` });
  assert.equal(result.ok, true, result.error); assert.equal(fs.readFileSync(path.join(work, 'scripts/check.js'), 'utf8'), 'module.exports = 42;\n');
  const bad = await tools.call('code', { context: c.id, code: `await tools.workspace_write({workspace:'context-export',path:'../escape.js',content:await files.read('scripts/check.js'),check:false});` });
  assert.equal(bad.ok, false); assert.match(bad.error, /outside/); assert.equal(fs.existsSync(path.join(tmp, 'escape.js')), false);
});
