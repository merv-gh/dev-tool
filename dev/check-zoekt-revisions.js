#!/usr/bin/env node
// Actual Zoekt + registered dt tools over isolated, local Git fixtures.
// node dev/check-zoekt-revisions.js --zoekt-bin <folder> [--output-dir <new folder>]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { command } = require('./benchmark-code-search');
async function run() {
  const argv = process.argv.slice(2), option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const root = path.resolve(option('--output-dir', 'work/zoekt-evaluation/revision-probe'));
  assert.ok(!fs.existsSync(root), 'Preserve existing evidence; select a new output folder');
  const binaries = path.resolve(option('--zoekt-bin', 'work/zoekt-evaluation/bin'));
  const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true });
  for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_REPOS_DIR', 'DT_WORK_DIR', 'DT_TOOLS']) delete process.env[k];
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { fixture: {} } }));
  const CI = require('../lib/codeindex'), tools = require('../lib/tools');
  const put = (folder, file, text) => { const f = path.join(folder, file); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const git = (folder, ...args) => command('git', ['-C', folder, ...args]);
  async function repo(name, file, text) {
    const folder = path.join(root, 'repos', name); fs.mkdirSync(folder, { recursive: true });
    await git(folder, 'init', '-q', '-b', 'main'); await git(folder, 'config', 'user.name', 'Fixture'); await git(folder, 'config', 'user.email', 'fixture@example.invalid');
    put(folder, file, text); return folder;
  }
  async function commit(folder) { await git(folder, 'add', '.'); await git(folder, 'commit', '-qm', 'Fixture revision'); return (await git(folder, 'rev-parse', 'HEAD')).stdout.trim(); }
  const build = (folder, key, sha, libs = []) => { const t = performance.now(), indexed = CI.build(folder, key, { project: key.split('/')[0], repo: key.split('/')[1], sha, ref: 'main', libs: libs.map(index => ({ index })) }); return { ...indexed, elapsedMs: +(performance.now() - t).toFixed(3) }; };
  const math = n => `package fixture;\npublic class FeeMath {\n public int fee(int value) { return value + ${n}; }\n public int revision${n}Only() { return ${n}; }\n}\n`;
  let server, serverLog;
  try {
    const lib = await repo('fee', 'src/main/java/fixture/FeeMath.java', math(1));
    // Enough source to make no-op/delta measurements exercise actual indexing.
    for (let i = 0; i < 256; i++) put(lib, `config/module-${i}.properties`, Array.from({ length: 128 }, (_, j) => `setting.${i}.${j}=warehouse timeout retry tenant order correlation ${crypto.createHash('sha256').update(`${i}:${j}`).digest('hex')}`).join('\n'));
    const firstSha = await commit(lib), first = build(lib, 'LIB/fee', firstSha);
    const middleRoot = await repo('middle', 'src/main/java/fixture/Middle.java', 'package fixture;\nimport fixture.FeeMath;\npublic class Middle { FeeMath math; public int adjust(int n) { return math.fee(n); } }\n');
    const middle = build(middleRoot, 'LIB/middle', await commit(middleRoot), [first.revisionKey]);
    const orderRoot = await repo('orders', 'src/main/java/fixture/OrderService.java', 'package fixture;\nimport fixture.Middle;\npublic class OrderService { Middle middle; public int create() { return middle.adjust(1); } }\n');
    const orders = build(orderRoot, 'SHOP/orders', await commit(orderRoot), [middle.revisionKey]);
    put(lib, 'src/main/java/fixture/FeeMath.java', math(2)); const secondSha = await commit(lib), second = build(lib, 'LIB/fee', secondSha);
    const otherRoot = await repo('other', 'src/main/java/fixture/OtherService.java', 'package fixture;\nimport fixture.FeeMath;\npublic class OtherService { FeeMath math; public int create() { return math.fee(1); } }\n');
    const other = build(otherRoot, 'SHOP/other', await commit(otherRoot), [second.revisionKey]);
    const indexes = [first, middle, orders, second, other], scope = indexes.map(i => i.revisionKey).join(',');
    async function impact(index) {
      const symbols = await tools.call('code_symbols', { repos: index.revisionKey, q: 'FeeMath fee', kind: 'method' });
      const fee = symbols.rows.find(row => row.legacyId === 'fixture.FeeMath#fee'); assert.ok(fee, JSON.stringify(symbols)); const target = fee.id;
      return tools.call('impact', { target, repos: scope, depth: 5, max_output_bytes: 32768 });
    }
    const oldImpact = await impact(first), newImpact = await impact(second);
    const serviceScoped = await tools.call('impact', { target: oldImpact.resolved[0], repos: orders.revisionKey, depth: 5, max_output_bytes: 32768 });
    assert.deepEqual(serviceScoped.nearest, oldImpact.nearest, 'A service selector expands its pinned transitive libraries automatically');
    assert.ok(oldImpact.nearest.some(line => line.includes('Middle#adjust')));
    assert.ok(oldImpact.nearest.some(line => line.includes('OrderService#create')));
    assert.ok(!oldImpact.nearest.some(line => line.includes('OtherService#create')));
    assert.ok(newImpact.nearest.some(line => line.includes('OtherService#create')));
    assert.ok(!newImpact.nearest.some(line => line.includes('OrderService#create')));
    assert.equal((await tools.call('code_search', { repo: first.revisionKey, pattern: 'revision1Only' })).total, 1);
    const indexDir = path.join(root, 'published'); fs.mkdirSync(indexDir);
    async function indexSnapshot(index, destination = indexDir) {
      const meta = path.join(root, 'meta.json'); fs.writeFileSync(meta, JSON.stringify({ Name: index.revisionKey, Branches: [{ Name: 'pinned', Version: index.sha }] }));
      return command(path.join(binaries, 'zoekt-index'), ['-index', destination, '-disable_ctags', '-parallelism', '1', '-meta', meta, CI.load(index.revisionKey).root]);
    }
    for (const index of indexes) await indexSnapshot(index);
    const digest = directory => crypto.createHash('sha256').update(fs.readdirSync(directory).sort().filter(n => fs.statSync(path.join(directory, n)).isFile()).map(n => `${n}:${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, n))).digest('hex')}`).join('\n')).digest('hex');
    const beforeFailure = digest(indexDir), staging = path.join(root, 'failed-staging'); fs.mkdirSync(staging);
    await assert.rejects(command(path.join(binaries, 'zoekt-index'), ['-index', staging, '-disable_ctags', path.join(root, 'missing-source')]), /exited/);
    assert.equal(digest(indexDir), beforeFailure);
    const net = require('node:net'), listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
    serverLog = fs.openSync(path.join(root, 'server.log'), 'a'); server = spawn(path.join(binaries, 'zoekt-webserver'), ['-index', indexDir, '-listen', `127.0.0.1:${port}`, '-rpc', '-html=false'], { stdio: ['ignore', serverLog, serverLog] });
    const search = async Q => { const response = await fetch(`http://127.0.0.1:${port}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Q, Opts: { MaxWallTime: 2000000000, TotalMaxMatchCount: 1000, ShardMaxMatchCount: 1000 } }), signal: AbortSignal.timeout(3000) }); const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data.Result; };
    let ready = false; for (let i = 0; i < 100; i++) { try { const health = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1000) }); if (health.ok) { await search('content:revision1Only'); ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 50)); } assert.ok(ready);
    const exact = async (index, pattern) => search(`repo:${JSON.stringify('^' + index.revisionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')} content:${pattern}`);
    const old = await exact(first, 'revision1Only'), current = await exact(second, 'revision2Only');
    assert.equal(old.Files.length, 1); assert.equal(old.Files[0].Version, firstSha);
    assert.equal(current.Files.length, 1); assert.equal(current.Files[0].Version, secondSha);
    assert.equal((await exact(first, 'revision2Only')).Files?.length || 0, 0);
    const broad = await search('content:fee'); assert.ok(new Set(broad.Files.map(file => file.Repository)).size >= 4);
    // A real Git indexer's unchanged and delta refresh paths, separate from pinned shards.
    const mutable = path.join(root, 'mutable'); fs.mkdirSync(mutable);
    const mutableMeta = path.join(root, 'git-meta.json'); fs.writeFileSync(mutableMeta, JSON.stringify({ Name: 'LIB/fee' }));
    const indexGit = extra => command(path.join(binaries, 'zoekt-git-index'), ['-index', mutable, '-disable_ctags', '-submodules=false', '-parallelism', '1', '-meta', mutableMeta, ...(extra || []), lib]);
    const gitCold = await indexGit(), unchangedDigest = digest(mutable), gitWarm = await indexGit(); assert.equal(digest(mutable), unchangedDigest);
    const nativeWarm = build(lib, 'LIB/fee', secondSha); assert.ok(nativeWarm.reused);
    put(lib, 'src/main/java/fixture/FeeMath.java', math(3)); const thirdSha = await commit(lib);
    const shardsBefore = fs.readdirSync(mutable).filter(name => name.endsWith('.zoekt')).length;
    const gitDelta = await indexGit(['-delta']); const shardsAfter = fs.readdirSync(mutable).filter(name => name.endsWith('.zoekt')).length; assert.ok(shardsAfter > shardsBefore, 'A delta shard was actually added, rather than silently falling back to a full rebuild');
    fs.writeFileSync(path.join(root, 'git-delta.log'), gitDelta.stderr);
    const nativeChanged = build(lib, 'LIB/fee', thirdSha); assert.notEqual(nativeChanged.revisionKey, second.revisionKey);
    assert.equal((await exact(first, 'revision1Only')).Files[0].Version, firstSha);
    assert.equal((await exact(second, 'revision2Only')).Files[0].Version, secondSha);
    const after = await impact(first); assert.deepEqual(after.resolved, oldImpact.resolved); assert.deepEqual(after.nearest, oldImpact.nearest);
    const report = { protocol: 'dt.zoekt-revision-probe/v1', observedAt: new Date().toISOString(), fixture: { gitRepositories: 4, indexedRevisions: 5, libraryVersions: 3, transitiveLibraryDepth: 2, libraryBytes: first.bytes }, checks: { tokenlessLocalGit: true, exactIndexedVersions: true, oldVersionRetained: true, failedStagedBuildPreservesPublishedShards: true, unchangedGitIndexContentRetained: true, transitiveCallerReached: true, automaticServiceDependencyExpansion: true, unrelatedLibraryVersionExcluded: true, impactStableAfterLibraryRefresh: true, deltaShardAdded: true }, refresh: { nativeColdMs: first.elapsedMs, nativeUnchangedMs: nativeWarm.elapsedMs, nativeChangedCommitMs: nativeChanged.elapsedMs, zoektGitColdMs: gitCold.ms, zoektGitUnchangedMs: gitWarm.ms, zoektGitDeltaCommitMs: gitDelta.ms, deltaShardsBefore: shardsBefore, deltaShardsAfter: shardsAfter }, impact: { oldNearest: oldImpact.nearest, newNearest: newImpact.nearest }, limitation: 'A local integration probe, not a configured production backend. Text matches remain candidate evidence; semantic caller edges come from dt graphs with pinned dependency bindings.' };
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  } finally { if (server && server.exitCode === null) { const closed = new Promise(resolve => server.once('close', resolve)); server.kill('SIGTERM'); await closed; } if (serverLog !== undefined) fs.closeSync(serverLog); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); }
}
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { run };
