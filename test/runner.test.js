// The build runner: only with its token, only inside its folders, output streamed, processes killed on
// request, its own Docker settings winning over the request's; dt's builds go through it when configured.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-runner-'));
process.env.DT_HOME = home;
process.env.DT_WORK_DIR = path.join(home, 'work');
process.env.DT_BUILD_DIR = path.join(home, 'build');
process.env.DT_LOG = 'quiet';
process.env.DT_RUNNER_TOKEN = 'runner-test-token';
process.env.TESTCONTAINERS_HOST_OVERRIDE = 'host.docker.internal';
fs.mkdirSync(path.join(home, 'work', 'ws'), { recursive: true });
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));

let server, base;
test.before(() => new Promise((r) => { server = require('../lib/runner').serve({ port: 0, host: '127.0.0.1' }); server.on('listening', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });

const post = (p, body, token = 'runner-test-token') => fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('only with the token, only inside its folders', async () => {
  assert.equal((await post('/exec', { cmd: 'echo', args: ['x'], cwd: path.join(home, 'work', 'ws') }, 'wrong')).status, 401);
  const out = await post('/exec', { cmd: 'echo', args: ['x'], cwd: '/' });
  assert.equal(out.status, 403);
  assert.match((await out.json()).error, /outside the runner's folders/);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('dt runs builds on it: output streamed, exit code, the runner\'s Docker settings win, kill', async () => {
  process.env.DT_RUNNER_URL = base;
  require('../lib/config').reload();
  const R = require('../lib/runner');
  const lines = [];
  const r = await R.exec(process.execPath, ['-e', 'console.log("one"); console.error("two"); console.log(process.env.TESTCONTAINERS_HOST_OVERRIDE, process.env.SECRET || "no-secret"); process.exit(3)'], { cwd: path.join(home, 'work', 'ws'), env: { TESTCONTAINERS_HOST_OVERRIDE: 'evil', PATH: process.env.PATH }, log: (l) => lines.push(l) });
  assert.equal(r.code, 3);
  assert.match(r.out, /one[\s\S]*two/);
  assert.match(r.out, /host\.docker\.internal no-secret/, 'the runner keeps its Testcontainers host; it has no dt secrets');
  assert.ok(lines.length >= 1);
  // cancel: the job's process on the runner is stopped
  const J = require('../lib/jobs');
  const job = J.start('long build', 'a long build', () => R.exec(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: path.join(home, 'work', 'ws') }));
  await new Promise(res => setTimeout(res, 500));
  assert.equal(J.cancel(job.id).stopped, 1);
  await job.promise;
  assert.equal(J.get(job.id).state, 'cancelled');
  // the info the doctor shows
  const info = await R.remoteInfo();
  assert.ok(info.roots.includes(path.resolve(home, 'work')));
  assert.ok('docker' in info);
  delete process.env.DT_RUNNER_URL;
});

test('an unreachable runner: builds run in dt, said once', async () => {
  process.env.DT_RUNNER_URL = 'http://127.0.0.1:9';
  require('../lib/config').reload();
  const R = require('../lib/runner');
  const a = await R.exec('echo', ['x'], { cwd: home });
  assert.equal(a.unreachable, true);
  const b = await R.exec('echo', ['x'], { cwd: home });
  assert.equal(b.quiet, true, 'not asked again for a minute');
  delete process.env.DT_RUNNER_URL;
});
