const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-continuation-')), root = path.resolve(__dirname, '..');
Object.assign(process.env, { DT_HOME: home, DT_LOG: 'quiet', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy', DT_REQUEST_EVENTS: '0' });
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[k];
const effects = path.join(home, 'effects.jsonl'), plugin = path.join(home, 'continuation-fixture.js');
fs.writeFileSync(plugin, `const fs=require('node:fs');module.exports=[{name:'fixture_continuation_effect',description:'Local continuation workflow effect',input:{value:{}},run:a=>{fs.appendFileSync(${JSON.stringify(effects)},JSON.stringify(a)+'\\n');return a;}}];`);
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tools: { plugins: [plugin] } }));
const P = require('../lib/continuation'), A = require('../lib/access'), C = require('../lib/context'), T = require('../lib/tools');
const identity = (principalId, storyId, role = 'user') => ({ principalId, storyId, role, multiUser: true });
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); await require('../lib/observations').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('same principal explicitly attaches stable memory across changing stories; other principals cannot read it', async () => {
  let task;
  await A.run(identity('alice', 'chat-one'), async () => {
    assert.equal(P.get().attached, false);
    task = await T.call('continuation_create', { task_id: 'ORDERS-42', title: 'Investigate order totals', summary: 'Compare rounding evidence', repositories: ['SHOP/orders'], workspaces: ['workspace-one'] });
    assert.equal(task.attached, true); assert.equal(task.index.tasks[0], 'ORDERS-42'); assert.ok(task.index.files.some(f => f.path === 'progress.md'));
    const note = P.write({ path: 'notes/rounding.md', content: 'Evidence: total.java:42 uses HALF_UP', summary: 'Rounding source evidence', expected_revision: null }); assert.ok(note.saved);
    let current = P.get();
    const checkpoint = P.checkpoint({ expected_revision: current.revision, expected_progress_revision: current.progress.revision, summary: 'Pinned code shows HALF_UP', progress: '# Progress\n\nVerified total.java:42. Next: compare DB arithmetic.', workspaces: ['workspace-one', 'workspace-two'], status: 'paused' }); assert.equal(checkpoint.status, 'paused');
    assert.throws(() => P.checkpoint({ expected_revision: current.revision, summary: 'stale' }), /changed/);
    assert.throws(() => P.create({ task_id: 'orders-42', title: 'Accidental duplicate' }), /already exists/);
  });
  await A.run(identity('alice', 'chat-two'), async () => {
    assert.equal(P.get().attached, false, 'new story must not automatically load earlier notes');
    assert.throws(() => P.read({ path: 'notes/rounding.md' }), /Select a continuation/);
    const matches = P.find({ task_id: 'ORDERS-42' }); assert.equal(matches.total, 1); assert.equal(matches.continuations[0].id, task.id); assert.equal(matches.selected, null);
    P.attach({ id: task.id }); assert.equal(P.get().status, 'paused'); assert.match(P.read({ path: 'notes/rounding.md' }).content, /HALF_UP/); assert.deepEqual(P.get().workspaces, ['workspace-one', 'workspace-two']);
    assert.equal(C.find().total, 0, 'cross-chat continuation does not merge private story contexts');
    const briefing = P.briefing(); assert.equal(briefing.copyable, true); for (const word of ['ORDERS-42', 'total.java:42', 'workspace-two', 'continuation_attach']) assert.match(briefing.text, new RegExp(word));
    P.attach({ detach: true }); assert.equal(P.get().attached, false); assert.equal(P.get({ id: task.id }).id, task.id, 'an explicit id may still read the selected task');
  });
  for (const role of ['user', 'admin']) await A.run(identity('bob', 'chat-one', role), async () => { assert.equal(P.find().total, 0); assert.equal(P.get().attached, false); assert.throws(() => P.attach({ id: task.id }), /not found/); assert.throws(() => P.get({ id: task.id }), /not found/); assert.throws(() => P.read({ id: task.id, path: 'notes/rounding.md' }), /not found/); });
  await A.run(identity('alice', 'chat-one'), async () => { assert.equal(P.get().id, task.id, 'selection remains local to its original story'); });
});

test('explicit related-context snapshots retain indexes, progress, notes and source file revisions', () => A.run(identity('snapshot-owner', 'old-chat'), () => {
  const original = C.open({ title: 'Original investigation', tickets: ['ORIGINAL-8'], repositories: ['SHOP/source'], workspaces: ['old-workspace'] });
  C.write({ id: original.id, path: 'notes/finding.md', content: 'Pinned evidence survives workspace deletion', summary: 'Important evidence', expected_revision: null });
  C.write({ id: original.id, path: 'source-index.json', content: 'A user file with a potentially colliding name', expected_revision: null });
  const task = P.create({ task_id: 'SNAPSHOT-8', title: 'Continue original evidence', contexts: [original.id], workspaces: ['new-workspace'] });
  const snapshot = task.relatedContexts[0]; assert.equal(snapshot.id, original.id); assert.equal(snapshot.indexRevision, original.revision); assert.equal(snapshot.storyId, 'old-chat');
  assert.match(P.read({ id: task.id, path: snapshot.snapshotPrefix + '/notes/finding.md' }).content, /survives workspace deletion/);
  assert.match(P.read({ id: task.id, path: snapshot.snapshotPrefix + '/progress.md' }).content, /Original investigation/);
  const index = JSON.parse(P.read({ id: task.id, path: snapshot.indexPath }).content); assert.deepEqual(index.workspaces, ['old-workspace']);
  C.write({ id: original.id, path: 'notes/finding.md', content: 'Original later changed' });
  assert.match(P.read({ id: task.id, path: snapshot.snapshotPrefix + '/notes/finding.md' }).content, /survives workspace deletion/);
  const note = snapshot.files.find(f => f.path === 'notes/finding.md'); assert.equal(P.read({ id: task.id, path: note.savedPath }).revision, note.revision);
}));

test('retained files obey context containment, compare-and-swap and bounded briefings', () => A.run(identity('files-owner', 'chat'), () => {
  const task = P.create({ task_id: 'FILES-9', title: 'Retained files' });
  const saved = P.write({ path: 'notes/a.md', content: 'one', expected_revision: null });
  assert.throws(() => P.write({ path: 'notes/a.md', content: 'stale', expected_revision: null }), /changed/);
  P.write({ path: 'notes/a.md', content: '\ntwo', append: true, expected_revision: saved.revision }); assert.equal(P.read({ path: 'notes/a.md' }).content, 'one\ntwo');
  for (const file of ['../escape', '/absolute', '.secret', 'index.json', 'a\\b']) assert.throws(() => P.write({ path: file, content: 'no', expected_revision: null }));
  const current = P.get(); assert.throws(() => P.checkpoint({ expected_revision: current.revision, progress: 'overwrite without reading' }), /expected_progress_revision/);
  P.write({ path: 'progress.md', content: 'x'.repeat(20000), expected_revision: current.progress.revision }); const brief = P.briefing({ max_chars: 1000 }); assert.equal(brief.text.length, 1000); assert.equal(brief.truncated, true);
  const folder = A.run({ ...A.owner(), multiUser: true, storyId: 'task:' + task.id }, () => C.get(task.id).folder);
  fs.symlinkSync(home, path.join(folder, 'escape')); assert.throws(() => P.write({ path: 'escape/outside.md', content: 'no', expected_revision: null }), /symbolic/);
}));

test('shared global project publishing is separate, explicit and administrator-only', () => {
  let publication;
  A.run(identity('publisher', 'admin-chat', 'admin'), () => { publication = require('../lib/project-context').save({ id: 'shared-orders', expected_revision: null, reason: 'Explicit verified shared understanding', document: { title: 'Orders', summary: 'Public source evidence', services: [] } }); });
  A.run(identity('reader', 'private-chat'), () => {
    const task = P.create({ task_id: 'PRIVATE-10', title: 'Private findings', projects: [{ id: publication.id, revision: publication.revision }] });
    P.write({ path: 'private.md', content: 'Reader private conclusion', expected_revision: null });
    assert.equal(task.projects[0].revision, publication.revision); assert.match(P.briefing().text, new RegExp(publication.revision));
    assert.equal(require('../lib/project-context').get({ id: publication.id }).files.length, 0, 'private continuation does not publish files automatically');
    assert.throws(() => require('../lib/project-context').save({ id: 'must-not-publish', expected_revision: null, reason: 'No admin grant', document: { title: 'Denied', services: [] } }), /Administrator/);
  });
});

test('a fresh child process restores principal-owned task, attached selection and saved evidence', () => {
  const child = spawnSync(process.execPath, ['-e', `const A=require('./lib/access'),P=require('./lib/continuation');A.run({principalId:'restart-owner',storyId:'original-chat',multiUser:true,role:'user'},()=>{const r=P.create({task_id:'RESTART-11',title:'Survive restart',workspaces:['stable-workspace']});P.write({path:'notes/evidence.md',content:'Retained in another process',expected_revision:null});const c=P.get();P.checkpoint({expected_revision:c.revision,expected_progress_revision:c.progress.revision,progress:'Next: inspect retained evidence'});process.stdout.write(JSON.stringify({id:r.id}));});`], { cwd: root, env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const { id } = JSON.parse(child.stdout);
  const reader = spawnSync(process.execPath, ['-e', `const A=require('./lib/access'),P=require('./lib/continuation');A.run({principalId:'restart-owner',storyId:'original-chat',multiUser:true,role:'user'},()=>{const task=P.get();process.stdout.write(JSON.stringify({id:task.id,progress:task.progress.content,note:P.read({path:'notes/evidence.md'}).content}));});`], { cwd: root, env: { ...process.env }, encoding: 'utf8' });
  assert.equal(reader.status, 0, reader.stderr); assert.deepEqual(JSON.parse(reader.stdout), { id, progress: 'Next: inspect retained evidence', note: 'Retained in another process' });
  A.run(identity('restart-owner', 'new-chat'), () => { assert.equal(P.get().attached, false); assert.equal(P.find({ task_id: 'RESTART-11' }).continuations[0].id, id); P.attach({ id }); assert.match(P.read({ path: 'notes/evidence.md' }).content, /another process/); });
  delete require.cache[require.resolve('../lib/continuation')]; A.run(identity('restart-owner', 'new-chat'), () => assert.equal(require('../lib/continuation').get().id, id));
});

test('registry schemas are strict and a denied continuation tool cannot read owned memory', async () => {
  await A.run(identity('registry-owner', 'chat'), async () => {
    const task = await T.call('continuation_create', { task_id: 'REGISTRY-12', title: 'Registry' });
    const read = await T.call('continuation_get', {}); assert.equal(read.id, task.id);
    await assert.rejects(T.call('continuation_get', { id: task.id, principalId: 'someone-else' }), /additional|principalId/);
    await A.run({ ...A.owner(), tools: ['find'] }, async () => assert.rejects(T.call('continuation_get', { id: task.id }), e => e.code === 'DT_ACCESS_DENIED'));
  });
});

test('an explicitly attached stable task resumes the same workflow in another story without repeating completed effects', async () => {
  let task, run;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  await A.run(identity('program-owner', 'program-first'), async () => {
    task = await T.call('continuation_create', { task_id: 'PROGRAM-13', title: 'Program across changing chats' });
    const def = await T.call('continuation_flow', { action: 'save', arguments: { id: 'shared-task-program', expected_revision: null, definition: { title: 'Durable task program', nodes: [{ id: 'once', type: 'tool', tool: 'fixture_continuation_effect', arguments: { value: 'once' } }, { id: 'pause', type: 'wait', ms: 300 }, { id: 'later', type: 'tool', tool: 'fixture_continuation_effect', arguments: { value: 'later' } }] } } });
    run = await T.call('continuation_flow', { action: 'start', arguments: { id: def.id, expected_revision: def.revision } });
    assert.equal(run.continuationId, task.id);
    for (let i = 0; i < 500; i++) { const state = await P.flow({ action: 'status', arguments: { run: run.id, detail: true } }); if (state.checkpoints['/pause']?.state === 'waiting') break; if (i === 499) assert.fail('Task workflow never reached wait'); await pause(5); }
    await T.call('continuation_flow', { action: 'cancel', arguments: { run: run.id } });
  });
  await A.run(identity('program-owner', 'program-second'), async () => {
    assert.equal(P.get().attached, false); await assert.rejects(T.call('continuation_flow', { action: 'status', arguments: { run: run.id } }), /Select a continuation/);
    P.attach({ id: task.id });
    const before = await T.call('continuation_flow', { action: 'status', arguments: { run: run.id, detail: true } }); assert.equal(before.state, 'cancelled'); assert.equal(before.checkpoints['/once'].state, 'done');
    const resumed = await T.call('continuation_flow', { action: 'resume', arguments: { run: run.id, await_completion: true } }); assert.equal(resumed.state, 'done'); assert.equal(resumed.output.later.value, 'later');
    assert.match(P.briefing().text, /continuation_flow/);
    const rows = fs.readFileSync(effects, 'utf8').trim().split('\n').map(JSON.parse); assert.equal(rows.filter(r => r.value === 'once').length, 1); assert.equal(rows.filter(r => r.value === 'later').length, 1);
    await assert.rejects(T.call('automation_flow_status', { run: run.id }), /not found/, 'ordinary workflow tools do not implicitly cross the task boundary');
    await A.run({ ...A.owner(), tools: ['continuation_flow'] }, async () => assert.rejects(T.call('continuation_flow', { id: task.id, action: 'status', arguments: { run: run.id } }), e => e.code === 'DT_ACCESS_DENIED'));
    await A.run({ ...A.owner(), tools: ['automation_flow_status'] }, async () => assert.rejects(T.call('continuation_flow', { id: task.id, action: 'status', arguments: { run: run.id } }), e => e.code === 'DT_ACCESS_DENIED'));
  });
  await A.run(identity('other-program-owner', 'program-second'), async () => assert.rejects(T.call('continuation_flow', { id: task.id, action: 'status', arguments: { run: run.id } }), /not found/));
});
