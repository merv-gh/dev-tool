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
test.after(async () => { await require('../lib/telemetry').shutdown(); server.close(); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

const post = (p, body, token = 'runner-test-token') => fetch(base + p, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('an unresponsive Docker socket probe closes within its timeout', async () => {
  const net = require('net'), socket = path.join(home, 'docker.sock'), connections = new Set();
  const silent = net.createServer(s => { connections.add(s); s.on('close', () => connections.delete(s)); });
  await new Promise(resolve => silent.listen(socket, resolve));
  const previous = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = `unix://${socket}`;
  try {
    const start = Date.now(), result = await require('../lib/runner').info();
    assert.equal(result.docker.ok, false);
    assert.match(result.docker.error, /timed out/);
    assert.ok(Date.now() - start < 15000);
  } finally {
    if (previous === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = previous;
    for (const s of connections) s.destroy();
    await new Promise(resolve => silent.close(resolve));
  }
});

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

test('runner forces UTF-8 locale and preserves Unicode filenames across split output chunks', async () => {
  const name = 'Заказ_客户😀.java', root = path.join(home, 'work', 'ws');
  fs.writeFileSync(path.join(root, name), 'generated source', 'utf8');
  const code = `const fs=require('fs'); const value={names:fs.readdirSync('.'),lang:process.env.LANG,all:process.env.LC_ALL,ctype:process.env.LC_CTYPE,java:process.env.JAVA_TOOL_OPTIONS}; const bytes=Buffer.from(JSON.stringify(value));let i=0;const timer=setInterval(()=>{if(i===bytes.length){clearInterval(timer);return;}process.stdout.write(bytes.subarray(i,i+1));i++;},1);`;
  const r = await require('../lib/runner').exec(process.execPath, ['-e', code], { runnerUrl: base, runnerToken: 'runner-test-token', cwd: root,
    env: { LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C', JAVA_TOOL_OPTIONS: '-Xms16m -Dfile.encoding=US-ASCII' } });
  assert.equal(r.code, 0);
  const value = JSON.parse(r.out);
  assert.ok(value.names.includes(name));
  assert.match(value.all, /UTF-8$/);
  assert.equal(value.lang, value.all);
  assert.equal(value.ctype, value.all);
  assert.equal(value.java, '-Xms16m -Dfile.encoding=UTF-8');
});

test('runner client decodes Unicode split inside an NDJSON response', async () => {
  const http = require('http'), name = 'Заказ_客户😀.java';
  const peer = http.createServer((req, res) => {
    req.resume();res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const bytes = Buffer.from(JSON.stringify({ out: name }) + '\n' + JSON.stringify({ done: true, code: 0 }) + '\n');
    let offset = 0;
    const timer = setInterval(() => { if (offset === bytes.length) { clearInterval(timer);res.end(); } else res.write(bytes.subarray(offset, ++offset)); }, 1);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve));
  try {
    const r = await require('../lib/runner').exec('unused', [], { runnerUrl: `http://127.0.0.1:${peer.address().port}`, cwd: home });
    assert.equal(r.code, 0); assert.equal(r.out, name);
  } finally { await new Promise(resolve => peer.close(resolve)); }
});

test('a lost runner response has unknown outcome and never authorizes local re-execution', async () => {
  const http = require('http'); let requests = 0;
  const peer = http.createServer((req,res) => { requests++;req.resume();res.writeHead(200,{'content-type':'application/x-ndjson'});res.write('{"out":"started"}\n');setImmediate(()=>res.destroy()); });
  await new Promise(resolve=>peer.listen(0,'127.0.0.1',resolve));
  try {
    const result = await require('../lib/runner').exec('unused',[],{runnerUrl:`http://127.0.0.1:${peer.address().port}`,cwd:home});
    assert.equal(result.runnerError,true);assert.equal(result.unreachable,undefined);assert.match(result.out,/unknown/);assert.equal(requests,1);
  } finally { await new Promise(resolve=>peer.close(resolve)); }
});

test('runner execution joins the client trace without passing telemetry or credentials into the build environment',async()=>{
 const O=require('../lib/telemetry');O.setEnabled(true);
 try {
  await O.run('runner.parent',{'dt.kind':'build'},async()=>{
   const result=await require('../lib/runner').exec(process.execPath,['-e','console.log(process.env.traceparent || "no-trace-env")'],{runnerUrl:base,runnerToken:'runner-test-token',cwd:path.join(home,'work/ws')});assert.equal(result.code,0);assert.match(result.out,/no-trace-env/);
  });
  const rows=(await O.snapshot()).spans,parent=rows.find(r=>r.name==='runner.parent'),child=rows.find(r=>r.name==='runner.exec');assert.ok(child);assert.equal(child.traceId,parent.traceId);assert.equal(child.parentSpanId,parent.spanId);assert.equal(child.status,'ok');assert.doesNotMatch(JSON.stringify(rows),/runner-test-token/);
 } finally {O.setEnabled(false);}
});
