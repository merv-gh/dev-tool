const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-revisions-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
for (const name of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[name];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { test: {} } }));
const CI = require('../lib/codeindex'), G = require('../lib/codegraph');
const source = (folder, name, text) => { const root = path.join(home, folder); fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, name), text); return root; };
const meta = (sha, extra = {}) => ({ project: 'P', repo: 'one', sha: sha.repeat(40), ref: 'main', ...extra });
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('commit snapshots retain matching source, postings and symbols after checkout replacement/deletion', () => {
  const root = source('one', 'One.java', 'class One { int before() { return 1; } }');
  const a = CI.build(root, 'P/one', meta('a'));
  source('one', 'One.java', 'class One { int after() { return 2; } }');
  const b = CI.build(root, 'P/one', meta('b'));
  assert.notEqual(a.revisionKey, b.revisionKey);
  assert.match(CI.read(a.revisionKey, 'One.java').text, /before/);
  assert.match(CI.read('P/one', 'One.java').text, /after/);
  assert.equal(CI.grep([a.revisionKey], 'before').hits.length, 1);
  assert.equal(CI.grep([a.revisionKey], 'after').hits.length, 0);
  fs.rmSync(root, { recursive: true });
  assert.match(CI.read(a.revisionKey, 'One.java').text, /before/);
  assert.equal(CI.load(a.revisionKey).graph_().classes[0].methods[0].name, 'before');
  assert.deepEqual(CI.select('P/one'), ['P/one']);
  assert.deepEqual(CI.select(a.revisionKey), [a.revisionKey]);
  assert.equal(CI.list().filter(i => i.baseKey === 'P/one').length, 1);
  assert.equal(CI.list({ versions: true }).filter(i => i.immutable && i.baseKey === 'P/one').length, 2);
});

test('warm manifest refresh and returning to an indexed commit avoid parsing; tags reuse the same snapshot', () => {
  const root = source('warm', 'Warm.java', 'class Warm { int same() { return 1; } }');
  const a = CI.build(root, 'P/warm', meta('c'));
  const build = G.build, read = fs.readFileSync; let sourceReads = 0;
  G.build = () => { throw Error('unexpected parse'); };
  fs.readFileSync = function(file, ...args) { if (String(file).startsWith(root + path.sep)) sourceReads++; return read.call(this, file, ...args); };
  try {
    const warm = CI.build(root, 'P/warm', meta('c', { ref: 'v1.0' }));
    assert.equal(warm.reused, true); assert.equal(warm.revisionKey, a.revisionKey); assert.equal(sourceReads, 0);
    fs.utimesSync(path.join(root, 'Warm.java'), new Date(), new Date());
    const back = CI.build(root, 'P/warm', meta('c'));
    assert.equal(back.reused, true); assert.equal(back.revisionKey, a.revisionKey); assert.ok(sourceReads > 0);
  } finally { G.build = build; fs.readFileSync = read; }
});

test('failed refresh keeps the previous alias and leaves no partial revision', () => {
  const root = source('failure', 'Safe.java', 'class Safe { int before() { return 1; } }');
  const a = CI.build(root, 'P/failure', meta('d'));
  source('failure', 'Safe.java', 'class Safe { int broken() { return 2; } }');
  const build = G.build; G.build = () => { throw Error('parse failed'); };
  try { assert.throws(() => CI.build(root, 'P/failure', meta('e')), /parse failed/); }
  finally { G.build = build; }
  assert.equal(CI.load('P/failure').revisionKey, a.revisionKey);
  assert.match(CI.read('P/failure', 'Safe.java').text, /before/);
  assert.ok(!fs.readdirSync(path.dirname(CI.keyDir(a.revisionKey))).some(n => n.includes('.tmp-')));
});

test('different sources at the same declared SHA remain distinct, including semantic identities', () => {
  const root = source('dirty', 'Dirty.java', 'class Dirty { int value() { return 1; } }');
  const a = CI.build(root, 'P/dirty', meta('f'));
  source('dirty', 'Dirty.java', 'class Dirty { int value() { return 2; } }');
  const b = CI.build(root, 'P/dirty', meta('f'));
  assert.notEqual(a.revisionKey, b.revisionKey);
  assert.notEqual(require('../lib/semantic-identity').revision(a), require('../lib/semantic-identity').revision(b));
  assert.match(CI.read(a.revisionKey, 'Dirty.java').text, /return 1/);
});

test('registered tools search a specific service and reuse a cached full SHA without fetching', async () => {
  const T = require('../lib/tools'), git = require('../lib/git'), fetch = git.fetchRef;
  git.fetchRef = () => { throw Error('network fetch must not run for a cached SHA'); };
  try {
    const indexed = await T.call('code_index', { project: 'P', repo: 'one', ref: 'a'.repeat(40) });
    assert.equal(indexed.reused, true);
    const found = await T.call('code_search', { repos: indexed.revisionKey, pattern: 'before' });
    assert.equal(found.total, 1);
    const symbols = await T.call('code_symbols', { repos: indexed.revisionKey, q: 'One before' });
    assert.equal(symbols.total, 1);
    const impact = await T.call('impact', { repos: indexed.revisionKey, target: symbols.rows[0].id });
    assert.ok(impact.resolved.length);
    const schemas = await T.schemas({ profile: 'develop' });
    for (const name of ['code_index', 'code_search', 'code_symbols', 'impact']) assert.ok(schemas.some(t => t.name === name));
  } finally { git.fetchRef = fetch; }
});

test('optional graph bridge builds per-revision roots and reuses only completed graphs', async () => {
  const http = require('http'), git = require('../lib/git'), original = git.git;
  let sha = '1'.repeat(40), requests = 0, fail = false;
  const server = http.createServer(async (req, res) => {
    try {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); requests++;
    assert.equal(body.full_rebuild, true); assert.equal(body.postprocess, 'minimal');
    assert.match(body.repo_root, /^\/code\/P\/graph@[a-f0-9]{40}-[a-f0-9]{24}\/source$/);
    if (fail) { res.writeHead(500); res.end('synthetic graph failure'); return; }
    fs.writeFileSync(path.join(CI.DIR, body.repo_root.slice('/code/'.length), '.code-review-graph', 'graph.db'), 'synthetic database');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', files_parsed: 1 }));
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const cfg = path.join(home, 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ envs: { test: {} }, graph: { url: `http://127.0.0.1:${server.address().port}` } }));
  require('../lib/config').reload(); git.git = async () => sha;
  const root = source('repos/P/graph', 'Graph.java', 'class Graph { void first() {} }');
  try {
    const P = require('../lib/passport'), a = await P.graphBuild(root);
    assert.equal(a.reused, false); assert.equal((await P.graphBuild(root)).reused, true); assert.equal(requests, 1);
    sha = '2'.repeat(40); source('repos/P/graph', 'Graph.java', 'class Graph { void second() {} }');
    const b = await P.graphBuild(root); assert.notEqual(a.repo_root, b.repo_root); assert.equal(requests, 2);
    sha = '3'.repeat(40); fail = true;
    await assert.rejects(P.graphBuild(root), /500|synthetic graph failure/);
    assert.ok(fs.existsSync(path.join(CI.load(a.revisionKey).root, '.code-review-graph', 'graph.db')));
    assert.match(CI.read(a.revisionKey, 'Graph.java').text, /first/);
  } finally {
    git.git = original; await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(cfg, JSON.stringify({ envs: { test: {} } })); require('../lib/config').reload();
  }
});

test('concurrent builders keep complete snapshots and each returns its own requested revision', async () => {
  const { execFile } = require('child_process'), exec = require('util').promisify(execFile);
  const a = source('concurrent-a', 'Concurrent.java', 'class Concurrent { int a() { return 1; } }');
  const b = source('concurrent-b', 'Concurrent.java', 'class Concurrent { int b() { return 2; } }');
  const script = `const CI=require('./lib/codeindex'); console.log(JSON.stringify(CI.build(process.argv[1],process.argv[2],{project:'P',repo:'concurrent',sha:process.argv[3]})));`;
  const run = async (root, key, sha) => JSON.parse((await exec(process.execPath, ['-e', script, root, key, sha.repeat(40)], { env: { ...process.env, DT_HOME: home } })).stdout);
  const different = await Promise.all([run(a, 'P/concurrent', '7'), run(b, 'P/concurrent', '8')]);
  assert.equal(different[0].sha, '7'.repeat(40)); assert.equal(different[1].sha, '8'.repeat(40));
  assert.match(CI.read(different[0].revisionKey, 'Concurrent.java').text, /int a/);
  assert.match(CI.read(different[1].revisionKey, 'Concurrent.java').text, /int b/);
  const same = await Promise.all([run(a, 'P/concurrent-same', '7'), run(a, 'P/concurrent-same', '7')]);
  assert.equal(same[0].revisionKey, same[1].revisionKey);
  assert.equal(CI.revisions('P/concurrent-same', '7'.repeat(40)).length, 1);
});
