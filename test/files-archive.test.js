const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-archive-'));
process.env.DT_HOME = home; process.env.DT_RATE_PER_SEC = '0';
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[k];
const C = require('../lib/context'), F = require('../lib/files'), T = require('../lib/tools');
const root = path.join(home, 'local'), remote = path.join(home, 'remote');
fs.mkdirSync(root); fs.mkdirSync(path.join(remote, 'upload'), { recursive: true });
let server;
test.before(async () => {
  server = await require('./sftp-server').start({ root: remote });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { test: {} }, files: {
    local: { type: 'local', path: 'local', write: true }, readonly: { type: 'local', path: 'local' },
    remote: { type: 'sftp', host: '127.0.0.1', port: server.port, user: 'dt', password: 'pw', root: '/upload', write: true },
  } })); require('../lib/config').reload();
});
test.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });
const args = (c, store, file, revision) => ({ store, path: file, context: c.id, expected_revision: revision });

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
