// Seeing what happens: calls with their steps, notes and errors in the log; logs, call history and results
// capped by size; jobs cancelled with their processes; workspaces from local copies (also when Bitbucket
// does not answer) and reused within a chat; the doctor; builds without dt's secrets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-trace-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
process.env.DT_LOG = 'quiet';
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, bitbucket: { url: 'http://127.0.0.1:9', token: 't0ken-value' } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const T = require('../lib/trace');

test('a call: start, steps with times, notes, the failed step with its error; in the log and the history', async () => {
  await T.call('demo_tool', { x: 1 }, { source: 'test' }, async () => {
    await T.step('fast step', async () => 1);
    T.note('took a fallback');
  });
  await assert.rejects(T.call('demo_tool', { x: 2 }, { source: 'test' }, async () => {
    await T.step('outer', async () => { await T.step('git fetch', async () => { throw new Error('fatal: could not read Username'); }); });
  }), /could not read Username/);
  const events = T.tail({ tool: 'demo_tool' });
  assert.deepEqual(events.map(e => e.event), ['start', 'step', 'note', 'ok', 'start', 'step', 'step', 'failed']);
  const failed = events.pop();
  assert.deepEqual(failed.steps.map(s => `${s.name}:${s.ok}:${s.depth}`), ['git fetch:false:1', 'outer:false:0']);
  assert.match(failed.error, /could not read Username/);
  assert.equal(T.tail({ failed: true }).filter(e => e.event === 'failed').length, 1);
  // through the registry: the history has the steps; running calls are listed while they run
  const tools = require('../lib/tools');
  const r = await tools.call('dt_log', { failed: true }, { source: 'test' });
  assert.ok(r.some(l => /failed demo_tool#\w+ \d+ms: fatal: could not read Username/.test(l)), r.join('\n'));
  let seen;
  await T.call('slow_tool', {}, {}, async () => { await T.step('maven prepare', async () => { seen = T.list(); }); });
  assert.equal(seen.find(c => c.tool === 'slow_tool').step, 'maven prepare');
});

test('the log rotates by size; the call history stays under its size', () => {
  const f = path.join(home, 'rot', 'dt.log');
  for (let i = 0; i < 700; i++) T.append(f, 'x'.repeat(5000), { maxBytes: 200000, files: 3 });
  const files = fs.readdirSync(path.dirname(f)).sort();
  assert.deepEqual(files, ['dt.log', 'dt.log.1', 'dt.log.2']);
  for (const x of files) assert.ok(fs.statSync(path.join(path.dirname(f), x)).size < 1500000);
  process.env.DT_LOG_MAX_MB = '0.05';
  const calls = require('../lib/calls');
  for (let i = 0; i < 450; i++) calls.record({ tool: 'big', args: { q: 'y'.repeat(500) }, ok: true, ms: 1 });
  // trimmed to the cap at every check (every 200 calls or megabyte): never more than the cap and those 200
  assert.ok(fs.statSync(path.join(home, 'cache', '_calls.jsonl')).size < 0.05 * 1048576 + 200 * 600);
  delete process.env.DT_LOG_MAX_MB;
});

test('results stay under results.maxMb', () => {
  process.env.DT_RESULTS_MAX_MB = '1';
  const R = require('../lib/results');
  for (let i = 0; i < 12; i++) R.saveView('json', { blob: 'z'.repeat(200000) });
  const dir = path.join(home, 'cache', 'results');
  const total = fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total <= 1048576, `${total} bytes`);
  delete process.env.DT_RESULTS_MAX_MB;
});

test('a cancelled job stops its processes and stays cancelled', async () => {
  const J = require('../lib/jobs');
  let proc;
  const job = J.start('stuck', 'a stuck build', async () => {
    proc = T.child(spawn('sleep', ['30']));
    await new Promise(r => proc.on('exit', r));
    return 'finished anyway';
  });
  await new Promise(r => setTimeout(r, 300));
  const c = J.cancel(job.id, 'cancelled by request');
  assert.equal(c.state, 'cancelled');
  assert.equal(c.stopped, 1);
  await job.promise;
  assert.equal(J.get(job.id).state, 'cancelled');
  assert.equal(proc.killed, true);
  assert.equal(J.cancel(job.id).note, 'already cancelled');
});

test('workspaces: the commit from a local copy (no download), the local copy when Bitbucket is down, the same one within a chat', async () => {
  const src = path.join(home, 'remote', 'svc');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'A.java'), 'class A {}\n');
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  const W = require('../lib/workspace');
  const url = `file://${src}`;
  const a = await W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false });
  assert.equal(a.reusedFrom, undefined);
  let notes;
  const b = await T.call('workspace_open', {}, {}, async () => { const w = await W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false }); notes = T.current().notes; return w; });
  assert.equal(b.sha, a.sha);
  assert.match(b.reusedFrom, /work\//);
  assert.match(notes.join(' '), /nothing downloaded/);
  // the remote moves on: the local copy is not that commit, so it is fetched
  fs.writeFileSync(path.join(src, 'B.java'), 'class B {}\n'); g('add', '.'); g('commit', '-qm', 'y');
  const c = await W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false });
  assert.notEqual(c.sha, a.sha);
  assert.equal(c.reusedFrom, undefined);
  // Bitbucket gone: the newest local copy, said so
  fs.renameSync(src, `${src}-gone`);
  const d = await T.call('workspace_open', {}, {}, async () => { const w = await W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false }); notes = T.current().notes; return w; });
  assert.ok(d.reusedFrom);
  assert.match(notes.join(' '), /did not answer.*may be behind/);
  fs.renameSync(`${src}-gone`, src);
  // within one chat: the same workspace again
  const s1 = await T.call('workspace_open', {}, { session: 'chat-1' }, () => W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false }));
  const s2 = await T.call('workspace_open', {}, { session: 'chat-1' }, () => W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false }));
  assert.equal(s2.id, s1.id);
  assert.equal(s2.reused, true);
  const s3 = await T.call('workspace_open', {}, { session: 'chat-2' }, () => W.open({ project: 'P', repo: 'svc', ref: 'main', url, libraries: false }));
  assert.notEqual(s3.id, s1.id);
  // the run history and fast-run state kept next to workspaces are not workspaces (this broke workspace_list)
  fs.writeFileSync(path.join(home, 'cache', 'work', `${a.id}.runs.json`), '[]');
  fs.writeFileSync(path.join(home, 'cache', 'work', `${a.id}.fast.json`), '{}');
  assert.ok(W.list().every(w => w.id && w.repo));
  // unused for longer than tests.workspaceDays: removed
  const meta = path.join(home, 'cache', 'work', `${a.id}.json`);
  const m = JSON.parse(fs.readFileSync(meta, 'utf8')); m.usedAt = new Date(Date.now() - 30 * 864e5).toISOString(); fs.writeFileSync(meta, JSON.stringify(m));
  assert.deepEqual(await W.sweep(), [a.id]);
});

test('doctor: each check with ok/warn/fail and a fix', async () => {
  const d = await require('../lib/doctor').check();
  const by = Object.fromEntries(d.checks.map(c => [c.check, c]));
  assert.equal(by.git.status, 'ok');
  assert.equal(by['REST API'].status, 'fail');
  assert.match(by['REST API'].fix, /cannot reach Bitbucket/);
  assert.equal(by.token.status, 'ok');
  assert.ok(!JSON.stringify(d).includes('t0ken-value'), 'the token is not shown');
  assert.ok(by['config folder'] && by['free disk']);
});

test('builds get PATH, proxies and the like, not dt\'s secrets', () => {
  process.env.DT_API_KEY = 'secret-key'; process.env.BITBUCKET_HTTP_TOKEN = 'tok'; process.env.HTTPS_PROXY = 'http://proxy:3128';
  const env = require('../lib/testrun').cleanEnv({ passEnv: ['MY_BUILD_FLAG'] });
  assert.equal(env.DT_API_KEY, undefined);
  assert.equal(env.BITBUCKET_HTTP_TOKEN, undefined);
  assert.equal(env.HTTPS_PROXY, 'http://proxy:3128');
  assert.ok(env.PATH);
  delete process.env.DT_API_KEY; delete process.env.BITBUCKET_HTTP_TOKEN; delete process.env.HTTPS_PROXY;
});
