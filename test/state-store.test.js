const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, LEGACY_OWNER, sqliteAvailable } = require('../lib/state-store');
const { classify } = require('../lib/call-evidence');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');

const owner = (principalId, storyId = 'one') => ({ principalId, storyId, role: 'user', scopeKey: `${principalId}:${storyId}`, multiUser: true });
const call = (id, extra = {}) => ({ id, at: new Date().toISOString(), tool: 'demo', source: 'mcp', args: { sql: `select ${id}` }, ok: true, ...extra });
function fixture(t, options = {}) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-state-'));
  const stores = [];
  const open = extra => { const store = createStore({ cache, ...options, ...extra }); stores.push(store); return store; };
  t.after(async () => { for (const store of stores) await store.close().catch(() => {}); fs.rmSync(cache, { recursive: true, force: true }); });
  return { cache, open };
}

test('SQLite owner isolates principals and stories, pages indexed calls, and persists across restart', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), a = owner('alice'), b = owner('bob'), secondChat = owner('alice', 'two');
  const store = open({ batchSize: 2 });
  store.recordCall(call('a1'), a); store.recordCall(call('b1'), b); store.recordCall(call('a2', { tool: 'other', source: 'script:check' }), a); store.recordCall(call('chat2'), secondChat); store.recordCall(call('a3'), a);
  assert.deepEqual(store.snapshot('calls', a).map(x => x.id), ['a3', 'a2', 'a1']);
  const page = await store.list({ kind: 'calls', limit: 2 }, a);
  assert.deepEqual(page.records.map(x => x.id), ['a3', 'a2']); assert.equal(page.total, 3); assert.ok(page.nextCursor);
  assert.deepEqual((await store.list({ kind: 'calls', before: page.nextCursor, limit: 2 }, a)).records.map(x => x.id), ['a1']);
  assert.deepEqual((await store.list({ kind: 'calls', tool: 'demo', source: 'direct', q: 'a3' }, a)).records.map(x => x.id), ['a3']);
  assert.equal(await store.get('calls', 'a1', b), null);
  assert.equal((await store.list({ kind: 'calls' }, secondChat)).total, 1);
  assert.equal(store.status().durability, 'FULL'); assert.equal(store.status().durable, true);
  await store.close();
  const restarted = open();
  assert.deepEqual(restarted.snapshot('calls', a).map(x => x.id), ['a3', 'a2', 'a1'], 'bounded synchronous compatibility read cache survives restart');
  assert.equal((await restarted.list({ kind: 'calls' }, b)).records[0].id, 'b1');
});

test('metadata edits only annotations, enforce revisions, persist, and cannot cross stories', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), store = open(), a = owner('alice'), b = owner('bob');
  store.putJob({ id: 'j', state: 'done', result: { safe: true } }, a);
  const before = await store.get('jobs', 'j', a);
  const edited = await store.edit('jobs', 'j', { expected_revision: before.revision, patch: { label: 'Check catalog', notes: 'Review index', tags: ['debug'] } }, a);
  assert.equal(edited.revision, before.revision + 1); assert.equal(edited.value.state, 'done'); assert.equal(edited.value.metadata.notes, 'Review index');
  await assert.rejects(store.edit('jobs', 'j', { expectedRevision: before.revision, patch: { notes: 'stale' } }, a), { code: 'STALE_REVISION' });
  await assert.rejects(store.edit('jobs', 'j', { expectedRevision: edited.revision, patch: { state: 'running' } }, a), /only label, notes and tags/);
  await assert.rejects(store.edit('jobs', 'j', { patch: { label: 'missing revision' } }, a), /expected_revision/);
  await assert.rejects(store.edit('jobs', 'j', { expectedRevision: edited.revision, patch: { notes: 'forged' } }, b), { code: 'NOT_FOUND' });
  await store.flush(); assert.equal(store.status().durable, true, 'a stale draft or unavailable record does not mean a storage write failed'); assert.equal(store.status().lastError, null);
  store.putJob({ id: 'j', state: 'done', result: { safe: true, extra: 1 } }, a); await store.flush();
  assert.equal((await store.get('jobs', 'j', a)).value.metadata.notes, 'Review index', 'later operational transitions preserve annotations');
  await store.close();
  assert.equal((await open().get('jobs', 'j', a)).value.metadata.label, 'Check catalog');
});

test('legacy migration is non-destructive, incremental, bounded, and local-only', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t), file = path.join(cache, '_calls.jsonl'), jobs = path.join(cache, '_jobs.json');
  const first = `${JSON.stringify(call('old-one'))}\nnot-json\n${JSON.stringify(call('old-two'))}\n`;
  fs.writeFileSync(file, first); fs.writeFileSync(jobs, JSON.stringify([{ id: 'old-job', state: 'running', startedAt: new Date().toISOString(), log: [] }]));
  let store = open(); await store.ready();
  assert.equal((await store.list({ kind: 'calls' }, LEGACY_OWNER)).total, 2);
  assert.equal((await store.get('jobs', 'old-job', LEGACY_OWNER)).value.state, 'interrupted');
  assert.equal((await store.list({ kind: 'calls' }, owner('alice'))).total, 0);
  assert.equal(store.status().malformedImports, 1); assert.equal(fs.readFileSync(file, 'utf8'), first);
  await store.close();
  fs.appendFileSync(file, `${JSON.stringify(call('new-tail'))}\n`);
  store = open(); await store.ready();
  assert.equal((await store.list({ kind: 'calls' }, LEGACY_OWNER)).total, 3, 'source cursor imports only newly appended lines');
  await store.close(); store = open(); await store.ready();
  assert.equal((await store.list({ kind: 'calls' }, LEGACY_OWNER)).total, 3, 'a repeated migration does not duplicate calls');
  assert.equal(JSON.parse(fs.readFileSync(jobs, 'utf8'))[0].state, 'running', 'legacy backup is retained unchanged');
});

test('job outcomes reconcile invocation success before indexed failed/status/kind filters', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), store = open(), a = owner('alice');
  const evidence = classify('test_run', { job: 'job1', state: 'running' });
  store.recordCall(call('run1', { tool: 'test_run', evidence }), a);
  store.putJob({ id: 'job1', state: 'done', result: { outcome: 'failed', counts: { tests: 2, failed: 1 } } }, a);
  const failed = await store.list({ kind: 'calls', failed: true, category: 'tests', status: 'failed', limit: 1 }, a);
  assert.equal(failed.total, 1); assert.equal(failed.records[0].value.ok, true);
  assert.equal(failed.records[0].value.evidence.invocation, 'succeeded');
  assert.equal(failed.records[0].value.evidence.execution.counts.failed, 1);
  assert.equal((await store.list({ kind: 'calls', status: 'running' }, a)).total, 0);
  // Same job id in a different story must not overwrite the verdict.
  store.putJob({ id: 'job1', state: 'done', result: { outcome: 'passed' } }, owner('bob'));
  assert.equal((await store.list({ kind: 'calls', failed: true }, a)).total, 1);
  store.recordCall(call('artifact-call', { tool: 'test_run', evidence: classify('test_run', { job: 'artifact-job', state: 'running' }) }), a);
  store.putJob({ id: 'artifact-job', state: 'done', resultReference: { id: 'artifact-job', bytes: 1000000 }, resultSummary: { outcome: 'failed', counts: { tests: 3, failed: 2 } } }, a);
  assert.equal((await store.list({ kind: 'calls', failed: true, category: 'tests' }, a)).total, 2, 'large output artifacts retain the application verdict in indexed metadata');
});

test('bounded queues reject visibly; per-story retention cannot evict another user', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), store = open({ maxQueue: 3, maxRecordBytes: 512, retention: { calls: 2 } }), a = owner('alice'), b = owner('bob');
  assert.equal(store.recordCall(call('b1'), b), true);
  assert.equal(store.recordCall(call('a1'), a), true); assert.equal(store.recordCall(call('a2'), a), true);
  assert.equal(store.recordCall(call('a3'), a), false); assert.equal(store.status().rejected, 1); assert.equal(store.status().lastError.code, 'STATE_QUEUE_FULL');
  await store.flush();
  assert.equal(store.recordCall(call('huge', { args: { x: 'x'.repeat(1000) } }), a), false); assert.equal(store.status().lastError.code, 'STATE_RECORD_TOO_LARGE');
  store.recordCall(call('a3'), a); await store.flush();
  assert.deepEqual((await store.list({ kind: 'calls' }, a)).records.map(x => x.id), ['a3', 'a2']);
  assert.equal((await store.list({ kind: 'calls' }, b)).total, 1);
});

test('restart interrupts abandoned executions, leaves live process owners running, never replays work', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), a = owner('alice'), store = open();
  store.putExecution({ id: 'abandoned', state: 'running', processId: 2147483647 }, a);
  store.putJob({ id: 'live', state: 'running', processId: process.pid }, a);
  await store.close();
  const restarted = open(); await restarted.ready();
  assert.equal((await restarted.get('executions', 'abandoned', a)).value.state, 'interrupted');
  assert.equal((await restarted.get('jobs', 'live', a)).value.state, 'running');
  assert.match((await restarted.get('executions', 'abandoned', a)).value.error, /not replayed/);
});

test('read/write failure is visible and rejects flush rather than reporting durability', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t), blocked = path.join(cache, 'not-a-directory'); fs.writeFileSync(blocked, 'x');
  const store = open({ directory: blocked }); store.recordCall(call('will-not-persist'));
  await assert.rejects(store.flush(), /EEXIST|ENOTDIR/);
  assert.equal(store.status().durable, false); assert.ok(store.status().lastError); assert.equal(store.status().queued, 1);
  fs.rmSync(blocked); fs.mkdirSync(blocked);
  await store.flush(); assert.equal(store.status().durable, true); assert.equal((await store.list({ kind: 'calls' })).total, 1);
  assert.ok(store.status().lastInitializationError, 'successful recovery retains the diagnostic failure history');
});

test('explicit legacy backend remains usable without SQLite and reports its capabilities', async t => {
  const { open } = fixture(t), store = open({ backend: 'legacy' }), a = owner('alice');
  assert.equal(store.enabled(), false); store.recordCall(call('legacy'), a);
  assert.equal(store.snapshot('calls', a)[0].id, 'legacy'); assert.equal(store.snapshot('calls', owner('bob')).length, 0);
  assert.equal((await store.ready()).backend, 'legacy');
  await assert.rejects(store.edit('calls', 'legacy', { expectedRevision: 1, patch: { notes: 'x' } }, a), { code: 'STATE_BACKEND_REQUIRED' });
});

test('journal initialization waits for a competing database creator', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t), directory = path.join(cache, 'state');
  fs.mkdirSync(directory);
  const db = new (require('node:sqlite').DatabaseSync)(path.join(directory, 'operational.sqlite'));
  db.exec('BEGIN EXCLUSIVE; CREATE TABLE bootstrap_lock(id INTEGER);');
  const store = open(), ready = store.ready();
  // Leave enough time for the other worker to encounter the journal-mode lock.
  await new Promise(resolve => setTimeout(resolve, 150));
  db.exec('COMMIT'); db.close();
  await ready;
  store.recordCall(call('after-bootstrap')); await store.flush();
  assert.equal((await store.list({ kind: 'calls' })).total, 1);
});

test('independent CLI/server owners safely commit concurrently to the same WAL database', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t);
  const source = `const {createStore}=require(${JSON.stringify(require.resolve('../lib/state-store'))});
    const s=createStore({cache:process.argv[1]}); const name=process.argv[2];
    const owner={principalId:name,storyId:'one',scopeKey:name+':one',role:'user',multiUser:true};
    for(let i=0;i<40;i++)s.recordCall({id:name+i,tool:'parallel',source:'mcp',ok:true},owner);
    s.close().catch(e=>{console.error(e);process.exitCode=1});`;
  const run = name => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source, cache, name], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; child.stderr.on('data', chunk => { error += chunk; }); child.on('error', reject); child.on('close', code => code ? reject(new Error(error)) : resolve());
  });
  await Promise.all([run('alice'), run('bob')]);
  const store = open();
  assert.equal((await store.list({ kind: 'calls' }, owner('alice'))).total, 40);
  assert.equal((await store.list({ kind: 'calls' }, owner('bob'))).total, 40);
});

test('oversized corrupt legacy lines and partial tails remain bounded and resumable', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t), file = path.join(cache, '_calls.jsonl');
  const partial = JSON.stringify(call('later')).slice(0, -1);
  fs.writeFileSync(file, `${'x'.repeat(2 * 1048576)}\n${JSON.stringify(call('valid'))}\n${partial}`);
  let store = open({ maxRecordBytes: 1024 }); await store.ready();
  assert.equal(store.status().oversizedImports, 1); assert.equal(store.status().imported.calls.complete, false);
  assert.equal((await store.list({ kind: 'calls' }, LEGACY_OWNER)).total, 1); await store.close();
  fs.appendFileSync(file, '}\n'); store = open({ maxRecordBytes: 1024 }); await store.ready();
  assert.equal((await store.list({ kind: 'calls' }, LEGACY_OWNER)).total, 2);
  assert.equal(store.status().imported.calls.complete, true);
});

test('large metadata reads and exports stop at byte budgets without skipping their continuation', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), store = open(), a = owner('alice');
  for (let n = 0; n < 40; n++) store.recordCall(call(String(n), { args: { value: 'x'.repeat(150000) } }), a);
  const first = await store.export({ kind: 'calls', limit: 500 }, a);
  assert.ok(first.records.length < 40); assert.ok(first.nextCursor); assert.ok(Buffer.byteLength(JSON.stringify(first)) < 4.2 * 1048576);
  const second = await store.export({ kind: 'calls', before: first.nextCursor }, a);
  assert.equal(first.records.length + second.records.length, 40);
  assert.equal(new Set([...first.records, ...second.records].map(row => row.id)).size, 40);
});

test('large job results remain compact while preserving state and application verdicts', { skip: !sqliteAvailable() }, async t => {
  const { open } = fixture(t), store = open(), a = owner('alice');
  const result = { rows: Array.from({ length: 1000 }, () => ({ body: 'x'.repeat(100000) })), outcome: 'failed', counts: { tests: 2, failed: 1 } };
  assert.equal(store.putJob({ id: 'big-result', state: 'done', result, log: Array.from({ length: 1000 }, () => 'x'.repeat(10000)) }, a), true);
  const saved = await store.get('jobs', 'big-result', a);
  assert.equal(saved.value.state, 'done'); assert.equal(saved.value.result.outcome, 'failed'); assert.equal(saved.value.result.counts.failed, 1);
  assert.equal(saved.value.metadataProjection.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(saved.value)) < 110 * 1024);
});

test('legacy fallback chat histories remain isolated and import into the same explicit local scope', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t), home = path.dirname(cache), localStory = { principalId: 'local', storyId: 'explicit-chat', multiUser: false, role: 'admin' };
  const script = `const A=require(${JSON.stringify(require.resolve('../lib/access'))}), C=require(${JSON.stringify(require.resolve('../lib/calls'))});
    C.record({tool:'default-call',ok:true});
    A.run(${JSON.stringify(localStory)},()=>{ C.record({tool:'private-call',ok:true}); if(C.history().some(x=>x.tool==='default-call'))throw Error('default leaked'); });
    if(C.history().some(x=>x.tool==='private-call'))throw Error('story leaked');
    process.stdout.write(JSON.stringify(A.normalize(${JSON.stringify(localStory)})));`;
  const isolatedCache = path.join(cache, 'fallback');
  const selected = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, DT_STATE_BACKEND: 'legacy', DT_HOME: home, DT_CACHE_DIR: isolatedCache }, encoding: 'utf8' }));
  assert.notEqual(selected.scopeKey, 'legacy');
  const store = open({ cache: isolatedCache }); await store.ready();
  assert.equal((await store.list({ kind: 'calls' }, selected)).records[0].value.tool, 'private-call');
  assert.equal((await store.list({ kind: 'calls' }, LEGACY_OWNER)).records[0].value.tool, 'default-call');
});

test('a busy SQLite writer fails visibly, retains the bounded batch, and recovers without duplicates', { skip: !sqliteAvailable() }, async t => {
  const { cache, open } = fixture(t), store = open(); await store.ready();
  const file = path.join(cache, 'state', 'operational.sqlite');
  const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE'); process.stdout.write('locked\\n');
    process.stdin.once('data',()=>{db.exec('COMMIT');db.close();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref();`;
  const child = spawn(process.execPath, ['-e', script, file], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('lock holder exited early')); }); });
  store.recordCall(call('locked-call'));
  await assert.rejects(store.flush(), /locked|busy/i);
  assert.equal(store.status().durable, false); assert.equal(store.status().queued, 1); assert.equal(store.status().failedWrites, 1);
  child.stdin.write('release'); await new Promise(resolve => child.once('close', resolve));
  await store.flush(); assert.equal(store.status().durable, true); assert.ok(store.status().lastWriteError);
  assert.equal((await store.list({ kind: 'calls' })).total, 1);
});
