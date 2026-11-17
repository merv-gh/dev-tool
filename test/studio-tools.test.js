const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-studio-contracts-'));
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_TOOLS', 'DT_TOOL_PROFILE', 'DT_SECURITY_PROFILE']) delete process.env[key];
Object.assign(process.env, { DT_HOME: home, DT_GIT_DIR: path.join(home, 'git'), DT_LOG: 'quiet', DT_NO_DOCTOR: '1', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy' });
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const A = require('../lib/access'), T = require('../lib/tools'), R = require('../lib/results');
const scope = { principalId: 'contract-owner', storyId: 'studio', role: 'admin', multiUser: true };
const owned = fn => A.run(scope, fn);
function retained(result, kind) {
  assert.ok(result.view, 'the ordinary registry provides a passive retained result');
  const record = R.load(new URL(result.view).pathname.split('/').pop());
  assert.equal(record.view, kind); return record;
}
test.after(async () => { await require('../lib/automation-flow').close(); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('formal registry actions keep revisions, native views and source observations distinct', async () => owned(async () => {
  assert.ok((await T.call('logic_model', { action: 'templates' })).templates.includes('diff-lines'));
  const { model } = await T.call('logic_model', { action: 'templates', template: 'workflow-continuation' });
  const saved = await T.call('logic_model', { action: 'save', name: 'release', expected_revision: null, model });
  assert.equal((await T.call('logic_model', { action: 'get', name: 'release' })).revision, saved.revision);
  assert.equal((await T.call('logic_model', { action: 'list' })).models.length, 1);
  await assert.rejects(T.call('logic_model', { action: 'save', name: 'release', expected_revision: null, model }), /changed/);
  const exported = await T.call('logic_model', { action: 'export', name: 'release' });
  assert.match(exported.module, /MODULE LogicModel/); assert.match(exported.config, /INVARIANT Safe/);
  const run = await T.call('logic_model', { action: 'run', name: 'release', mode: 'check', coverage: false });
  assert.equal(run.coverage, null); assert.equal(run.complete, true);
  assert.equal(retained(run, 'logic-model').data.model.title, model.title);
  assert.equal(typeof (await T.call('logic_model', { action: 'diagnostics' })).available, 'boolean');
  await assert.rejects(T.call('logic_model', { action: 'run', principalId: 'another' }), /additional|principalId/);
}));

test('continuation registry preserves file CAS and exact retained request scope across chat attachment', async () => owned(async () => {
  const created = await T.call('continuation_create', { task_id: 'CONTRACT-42', title: 'Retain this investigation' });
  retained(created, 'work-record');
  const written = await T.call('continuation_write', { path: 'notes/evidence.md', content: 'Observed a shared version owner.', expected_revision: null });
  assert.equal((await T.call('continuation_read', { path: 'notes/evidence.md' })).content, 'Observed a shared version owner.');
  const task = await T.call('continuation_get', {});
  const updated = await T.call('continuation_checkpoint', { expected_revision: task.revision, expected_progress_revision: task.progress.revision, progress: 'Next: check affected consumers.', status: 'paused' });
  assert.equal(updated.status, 'paused');
  assert.match((await T.call('continuation_briefing', {})).text, /evidence\.md/);
  await assert.rejects(T.call('continuation_write', { path: 'notes/evidence.md', content: 'Stale replacement', expected_revision: null }), /revision|changed|conflict/i);
  assert.ok(written.view);
  await A.run({ ...scope, storyId: 'next-chat' }, async () => {
    assert.equal((await T.call('continuation_get', {})).attached, false);
    const found = await T.call('continuation_find', { task_id: 'CONTRACT-42' });
    assert.equal(found.continuations[0].id, created.id);
    await T.call('continuation_attach', { id: created.id });
    assert.match((await T.call('continuation_read', { path: 'notes/evidence.md' })).content, /shared version owner/);
    await T.call('continuation_attach', { detach: true });
    assert.equal((await T.call('continuation_get', {})).attached, false);
  });
}));

test('editor, terminal and Gradle registry actions operate on the same source identity', async () => owned(async () => {
  const demo = await require('../demo/seed-editor').seed();
  const workspaces = await T.call('workspace_editor', { action: 'list' });
  assert.equal(workspaces.workspaces[0].id, demo.workspace);
  const tree = await T.call('workspace_editor', { action: 'tree', workspace: demo.workspace });
  assert.ok(tree.entries.some(e => e.path === 'gradle.properties'));
  const before = await T.call('workspace_editor', { action: 'read', workspace: demo.workspace, path: 'README.md' });
  await T.call('workspace_editor', { action: 'save', workspace: demo.workspace, path: before.path, content: before.content + '\nRetained change.\n', expected_revision: before.revision });
  await assert.rejects(T.call('workspace_editor', { action: 'save', workspace: demo.workspace, path: before.path, content: 'stale', expected_revision: before.revision }), /changed/);
  const terminal = await T.call('workspace_terminal', { action: 'run', workspace: demo.workspace, command: 'git status' });
  for (let n = 0; n < 100; n++) {
    const observed = await T.call('workspace_terminal', { action: 'read', workspace: demo.workspace, job: terminal.job });
    if (!['queued', 'running'].includes(observed.state)) { assert.equal(observed.code, 0); break; }
    if (n === 99) assert.fail('Git inspection did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await T.call('workspace_terminal', { action: 'clear', workspace: demo.workspace });
  const list = await T.call('gradle_inventory', { action: 'list' }); assert.equal(list.revisions.length, 1);
  const inventory = await T.call('gradle_inventory', { action: 'read', revision: demo.revision });
  retained(inventory, 'work-record'); assert.equal(inventory.sha, demo.sha);
  const matches = await T.call('gradle_inventory', { action: 'search', dependency: demo.dependency });
  assert.ok(matches.rows.length);
  const plan = await T.call('gradle_bump', { action: 'plan', revision: demo.revision, dependency: demo.dependency, version: '2.17.2' });
  assert.equal(plan.applicable, true); retained(plan, 'work-record');
  const applied = await T.call('gradle_bump', { action: 'apply', plan: plan.id, workspace: demo.workspace });
  assert.equal(applied.written.length, 1);
  const catalog = await T.call('workspace_editor', { action: 'read', workspace: demo.workspace, path: 'gradle/libs.versions.toml' });
  assert.match(catalog.content, /jackson = "2\.17\.2"/);
}));

test('named views and event tools retain private observations without executing a page', async () => owned(async () => {
  const page = await T.call('ui_page', { action: 'save', id: 'contract-page', expected_revision: null, definition: { version: 1, title: 'Retained checks', inputs: {}, sources: [{ id: 'data', rows: [{ ok: true }] }], datasets: [], widgets: [{ id: 'status', type: 'text', title: 'Explicit checks', text: 'Refresh deliberately.' }] } });
  const named = await T.call('named_view', { action: 'save', name: 'Contract checks', expected_revision: null, target: { type: 'page', id: page.id } });
  assert.equal((await T.call('named_view', { action: 'get', slug: named.slug })).revision, named.revision);
  assert.equal((await T.call('named_view', { action: 'list', q: 'Contract' })).views.length, 1);
  const cursor = (await T.call('ui_event', { action: 'read', channel: 'contract:checks' })).cursor;
  const signal = await T.call('ui_event', { action: 'publish', channel: 'contract:checks', type: 'checks.changed', data: { result: 'retained' } });
  assert.ok(signal);
  const replay = await T.call('ui_event', { action: 'read', channel: 'contract:checks', after: cursor });
  assert.equal(replay.events.at(-1).type, 'checks.changed');
  await A.run({ ...scope, storyId: 'other-chat' }, async () => assert.deepEqual((await T.call('ui_event', { action: 'read', channel: 'contract:checks' })).events, []));
}));
