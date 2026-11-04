const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-archive-'));
process.env.DT_HOME = home; process.env.DT_RATE_PER_SEC = '0';
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[k];
const C = require('../lib/context'), F = require('../lib/files'), T = require('../lib/tools');
const root = path.join(home, 'local'), remote = path.join(home, 'remote');
fs.mkdirSync(root); fs.mkdirSync(path.join(remote, 'upload'), { recursive: true });
let server;
let blockedRead;
test.before(async () => {
  server = await require('./sftp-server').start({ root: remote, onRead: ({ path }) => { if (path.endsWith('/blocked.txt')) { blockedRead?.(); return false; } } });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { test: {} }, files: {
    local: { type: 'local', path: 'local', write: true }, readonly: { type: 'local', path: 'local' },
    remote: { type: 'sftp', host: '127.0.0.1', port: server.port, user: 'dt', password: 'pw', root: '/upload', write: true },
    remote_shared: { type: 'sftp', host: '127.0.0.1', port: server.port, user: 'dt', password: 'pw', root: '/upload/shared', write: true, shared: true },
  } })); require('../lib/config').reload();
});
test.after(async () => { server.close(); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });
const args = (c, store, file, revision) => ({ store, path: file, context: c.id, expected_revision: revision });

test('SFTP writes create private roots, isolate principals/chats, and archive only the selected story', async () => {
  const A = require('../lib/access');
  const scope = (principalId, storyId = 'one') => A.normalize({ principalId, storyId, role: 'user', multiUser: true });
  // Concurrent first writes exercise creation of their shared _stories parent.
  await Promise.all(['alice', 'bob'].map(user => A.run(scope(user), () => F.write('remote', 'nested/value.txt', `${user}-one`))));
  await A.run(scope('alice', 'two'), () => F.write('remote', 'nested/value.txt', 'alice-two'));
  for (const [user, chat] of [['alice', 'one'], ['bob', 'one'], ['alice', 'two']]) {
    await A.run(scope(user, chat), async () => {
      assert.equal((await F.read('remote', 'nested/value.txt')).text, `${user}-${chat}`);
      assert.equal(fs.readFileSync(path.join(remote, 'upload', '_stories', A.current().scopeKey, 'nested/value.txt'), 'utf8'), `${user}-${chat}`);
    });
  }
  const archived = await A.run(scope('alice'), async () => {
    const context = C.open({ id: 'sftp-private-archive', title: 'Private SFTP findings' });
    const file = await F.read('remote', 'nested/value.txt');
    const result = await F.archive(args(context, 'remote', file.path, file.revision));
    assert.equal(result.sourceRemoved, true);
    assert.equal(C.read({ id: context.id, path: result.to.path }).content, 'alice-one');
    await assert.rejects(F.read('remote', file.path), /No such file/);
    return { context: context.id, path: result.to.path };
  });
  await A.run(scope('bob'), async () => {
    assert.equal((await F.read('remote', 'nested/value.txt')).text, 'bob-one');
    assert.throws(() => C.read({ id: archived.context, path: archived.path }), /not found/);
  });
});

test('SFTP rejects symlink escapes on read/write/archive and shared stores report read-only to users', async () => {
  const A = require('../lib/access'), alice = A.normalize({ principalId: 'sftp-alice', storyId: 'one', role: 'user', multiUser: true });
  const bob = A.normalize({ principalId: 'sftp-bob', storyId: 'one', role: 'user', multiUser: true });
  await A.run(bob, () => F.write('remote', 'private.txt', 'bob private'));
  await A.run(alice, () => F.write('remote', 'own.txt', 'alice own'));
  const aliceRoot = path.join(remote, 'upload', '_stories', alice.scopeKey), bobRoot = path.join(remote, 'upload', '_stories', bob.scopeKey);
  fs.symlinkSync(bobRoot, path.join(aliceRoot, 'escape'));
  fs.mkdirSync(path.join(remote, 'upload', 'shared'), { recursive: true }); fs.writeFileSync(path.join(remote, 'upload', 'shared', 'seed.txt'), 'shared seed');
  await A.run(alice, async () => {
    assert.equal(F.stores().find(s => s.store === 'remote_shared').write, false);
    await assert.rejects(F.write('remote_shared', 'seed.txt', 'changed', { overwrite: true }), /read.only/i);
    await assert.rejects(F.read('remote', 'escape/private.txt'), /symbolic links/);
    await assert.rejects(F.write('remote', 'escape/private.txt', 'changed', { overwrite: true }), /symbolic links/);
    assert.ok(!(await F.list('remote')).some(item => item.path === 'escape'), 'listing does not follow or expose target metadata');
    const context = C.open({ title: 'Reject symlink archive' });
    await assert.rejects(F.archive({ store: 'remote', path: 'escape/private.txt', context: context.id, expected_revision: require('crypto').createHash('sha256').update('bob private').digest('hex') }), /symbolic links/);
  });
  assert.equal(fs.readFileSync(path.join(bobRoot, 'private.txt'), 'utf8'), 'bob private');
});

test('cancelling a stalled SFTP read closes its connection while a sibling story stays usable', async () => {
  const A = require('../lib/access'), E = require('../lib/execution');
  const scope = user => A.normalize({ principalId: user, storyId: 'sftp-cancel', role: 'user', multiUser: true });
  await A.run(scope('alice'), () => F.write('remote', 'blocked.txt', 'stalled body'));
  await A.run(scope('bob'), () => F.write('remote', 'alive.txt', 'sibling body'));
  let timer;
  const observed = new Promise((resolve, reject) => { blockedRead = resolve; timer = setTimeout(() => reject(new Error('SFTP did not reach its controlled blocked read')), 3000); });
  const execution = A.run(scope('alice'), () => E.start({ tool: 'stalled-sftp-read' }, () => F.read('remote', 'blocked.txt')));
  execution.promise.catch(() => {});
  try {
    await observed; clearTimeout(timer);
    assert.equal((await A.run(scope('bob'), () => F.read('remote', 'alive.txt'))).text, 'sibling body');
    const started = Date.now();
    A.run(scope('alice'), () => E.cancel(execution.id, 'cancel stalled SFTP'));
    await assert.rejects(execution.promise, { code: 'DT_CANCELLED' });
    assert.ok(Date.now() - started < 1500, 'cancellation does not wait for the 20s SFTP timeout');
    const state = A.run(scope('alice'), () => E.get(execution.id));
    assert.equal(state.resources, 0); assert.equal(state.state, 'cancelled'); assert.ok(!state.cleanupIncomplete);
    assert.equal((await A.run(scope('bob'), () => F.read('remote', 'alive.txt'))).text, 'sibling body');
  } finally { clearTimeout(timer); blockedRead = null; }
});

test('registered archive moves a local file into discoverable context storage without overwrite', async () => {
  const c = C.open({ title: 'Local archive' });
  await F.write('local', 'nested/result.bin', Buffer.from([0, 255, 1]).toString('base64'), { base64: true });
  const read = await F.read('local', 'nested/result.bin');
  const moved = await T.call('files_archive', args(c, 'local', read.path, read.revision));
  assert.equal(moved.sourceRemoved, true); assert.match(moved.to.path, /^archived\/[^/]+\/nested\/result.bin$/);
  assert.equal(fs.existsSync(path.join(root, read.path)), false);
  assert.deepEqual(Buffer.from(C.read({ id: c.id, path: moved.to.path, encoding: 'base64' }).content, 'base64'), Buffer.from([0, 255, 1]));
  assert.match(C.get(c.id).files.find(f => f.path === moved.to.path).summary, /local:nested/);
  assert.ok((await T.schemas({ profile: 'direct' })).some(t => t.name === 'files_archive'));
});

test('same-context rename preserves metadata and stale revisions cannot move a newer file', async () => {
  const c = C.open({ title: 'Context archive' });
  const old = C.write({ id: c.id, path: 'notes/findings.md', content: 'saved finding', summary: 'Useful findings' });
  C.write({ id: c.id, path: old.path, content: 'newer finding' });
  await assert.rejects(F.archive(args(c, c.store, old.path, old.revision)), /changed/);
  const read = C.read({ id: c.id, path: old.path });
  const before = C.get(c.id).files.length, moved = await F.archive(args(c, c.store, old.path, read.revision));
  assert.equal(moved.sourceRemoved, true); assert.equal(moved.revision, read.revision);
  assert.equal(C.get(c.id).files.length, before);
  assert.ok(!C.get(c.id).files.some(f => f.path === old.path));
  assert.match(C.get(c.id).files.find(f => f.path === moved.to.path).summary, /Useful findings/);
  assert.equal(C.read({ id: c.id, path: moved.to.path }).content, 'newer finding');
});

test('context index write failure restores the original file', async () => {
  const c = C.open({ title: 'Rollback archive' }), read = C.read({ id: c.id, path: 'progress.md' });
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (String(to) === path.join(c.folder, 'index.json')) throw Error('index write failed'); return rename(from, to); };
  try { await assert.rejects(F.archive(args(c, c.store, read.path, read.revision)), /index write failed/); }
  finally { fs.renameSync = rename; }
  assert.equal(C.read({ id: c.id, path: read.path }).content, read.content);
  assert.ok(!C.get(c.id).files.some(f => f.path.startsWith('archived/')));
});

test('read-only stores, symlink sources and context capacity failures retain source bytes', async () => {
  const c = C.open({ title: 'Archive limits' });
  await F.write('local', 'keep.txt', 'keep'); const read = await F.read('local', 'keep.txt');
  await assert.rejects(F.archive(args(c, 'readonly', read.path, read.revision)), /read-only/);
  fs.symlinkSync(path.join(root, 'keep.txt'), path.join(root, 'link.txt'));
  await assert.rejects(F.archive(args(c, 'local', 'link.txt', read.revision)), /symbolic/);
  fs.writeFileSync(path.join(root, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  const large = await F.read('local', 'large.txt');
  await assert.rejects(F.archive(args(c, 'local', large.path, large.revision)), /exceeds/);
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(path.join(root, 'large.txt')));
  assert.equal(C.get(c.id).files.length, 1);
});

test('source changes during cross-store archival keep the newer source and report both copies', async () => {
  const c = C.open({ title: 'Concurrent source' });
  await F.write('local', 'changing.txt', 'before'); const read = await F.read('local', 'changing.txt');
  const write = C.write;
  C.write = a => { const result = write(a); fs.writeFileSync(path.join(root, 'changing.txt'), 'after'); return result; };
  let result; try { result = await F.archive(args(c, 'local', read.path, read.revision)); } finally { C.write = write; }
  assert.equal(result.archived, true); assert.equal(result.sourceRemoved, false); assert.match(result.error, /changed/);
  assert.equal(fs.readFileSync(path.join(root, read.path), 'utf8'), 'after');
  assert.equal(C.read({ id: c.id, path: result.to.path }).content, 'before');
});

test('SFTP archive verifies bytes, moves the remote source and rejects remote symlinks', async () => {
  const c = C.open({ title: 'Remote archive' });
  await F.write('remote', 'inbox/report.txt', 'remote result'); const read = await F.read('remote', 'inbox/report.txt');
  const result = await F.archive(args(c, 'remote', read.path, read.revision));
  assert.equal(result.sourceRemoved, true);
  assert.equal(fs.existsSync(path.join(remote, 'upload', read.path)), false);
  assert.equal(C.read({ id: c.id, path: result.to.path }).content, 'remote result');
  fs.writeFileSync(path.join(remote, 'upload', 'keep.txt'), 'keep');
  fs.symlinkSync(path.join(remote, 'upload', 'keep.txt'), path.join(remote, 'upload', 'link.txt'));
  const local = await F.read('remote', 'keep.txt');
  await assert.rejects(F.archive(args(c, 'remote', 'link.txt', local.revision)), /symbolic/);
});

test('a removal failure never overwrites a replacement source and reports its recovery file', async () => {
  const c = C.open({ title: 'Recovery archive' });
  await F.write('local', 'replaced.txt', 'original'); const read = await F.read('local', 'replaced.txt');
  const unlink = fs.unlinkSync; let interrupted = false;
  fs.unlinkSync = file => {
    if (!interrupted && String(file).includes('.dt-archive-')) { interrupted = true; fs.writeFileSync(path.join(root, 'replaced.txt'), 'replacement'); throw Error('synthetic unlink failure'); }
    return unlink(file);
  };
  let result; try { result = await F.archive(args(c, 'local', read.path, read.revision)); } finally { fs.unlinkSync = unlink; }
  assert.equal(result.sourceRemoved, false); assert.ok(result.sourceRecovery);
  assert.equal(fs.readFileSync(path.join(root, 'replaced.txt'), 'utf8'), 'replacement');
  assert.equal(fs.readFileSync(path.join(root, result.sourceRecovery.path), 'utf8'), 'original');
  assert.equal(C.read({ id: c.id, path: result.to.path }).content, 'original');
});
