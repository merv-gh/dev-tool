// The runner: a container (compose service "runner") that runs builds for dt: Maven, Gradle, javac and the
// test JVM, with the JDK, the workspaces and build caches, and a Docker engine for Testcontainers (the host's
// socket). It has no config folder and no secrets: dt sends each command with the environment that build
// needs. dt talks to it over HTTP on the compose network, with a token (DT_RUNNER_TOKEN, required: other
// containers there, the browser among them, must not run commands with Docker access).
//   POST /exec  { id, cmd, args, cwd, env, timeoutMs } -> NDJSON: { out } ... { done, code, killed, ms }
//   POST /compile { javaHome, options, files } -> { ok, ms, diagnostics } (the warm compiler: lib/javacheck.js)
//   POST /kill  { id }
//   GET  /info  JDK, Maven, Docker, the filesystems of the work and build folders
// Commands run only inside the workspace and build folders.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const KEEP_ENV = /^(PATH|HOME|USER|LANG|LANGUAGE|LC_\w+|TZ|TMPDIR|JAVA_HOME|DOCKER_HOST|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|TESTCONTAINERS_\w+|(HTTPS?|NO|ALL)_PROXY|(https?|no|all)_proxy|SSL_CERT_FILE|SSL_CERT_DIR)$/;
// the runner's own Docker settings win over what a request says
const OWN = /^(DOCKER_HOST|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|TESTCONTAINERS_\w+)$/;

function roots() {
  const { PATHS } = require('./config');
  return [PATHS.work, PATHS.build, ...String(process.env.DT_RUNNER_ROOTS || '').split(',').filter(Boolean)].map(p => path.resolve(p));
}

const ping = () => new Promise((resolve) => {
  const sock = (process.env.DOCKER_HOST || 'unix:///var/run/docker.sock').replace(/^unix:\/\//, '');
  if (!fs.existsSync(sock)) return resolve({ ok: false, error: `no Docker socket at ${sock}` });
  const req = http.get({ socketPath: sock, path: '/version', timeout: 5000 }, (r) => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { try { const v = JSON.parse(d); resolve({ ok: r.statusCode === 200, version: v.Version, os: v.Os, platform: v.Platform?.Name }); } catch { resolve({ ok: false, error: `HTTP ${r.statusCode}` }); } });
  });
  req.on('error', (e) => resolve({ ok: false, error: e.code === 'EACCES' ? `EACCES on ${sock}: the runner's user is not in the socket's group (DT_DOCKER_GID)` : e.message }));
});

function info() {
  const cfg = require('./config').getTests();
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }); return r.error ? { ok: false, error: r.error.message } : { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n')[0] }; };
  const bin = (t) => (cfg.javaHome ? path.join(cfg.javaHome, 'bin', t) : t);
  return ping().then(docker => ({
    uid: process.getuid?.(), java: run(bin('java'), ['-version']), javac: run(bin('javac'), ['-version']), maven: cfg.maven ? run(cfg.maven, ['-v']) : null,
    docker, roots: roots(), testcontainersHost: process.env.TESTCONTAINERS_HOST_OVERRIDE || null,
  }));
}

function serve({ port = 4100, host = '0.0.0.0' } = {}) {
  const token = process.env.DT_RUNNER_TOKEN;
  const procs = new Map();
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') return send(res, 200, { ok: true });
    if (!token) return send(res, 503, { error: 'DT_RUNNER_TOKEN is not set: the runner refuses commands' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'bad token' });
    const body = await new Promise((r) => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
    if (req.method === 'GET' && req.url === '/info') return send(res, 200, await info());
    if (req.method === 'POST' && req.url === '/kill') {
      const p = procs.get(body.id);
      if (p) { p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 5000).unref(); }
      return send(res, 200, { killed: !!p });
    }
    // a compile check with the warm compiler: { javaHome, options, files } -> { ok, ms, diagnostics }
    if (req.method === 'POST' && req.url === '/compile') {
      const bad = (body.files || []).map(f => path.resolve(f)).find(f => !roots().some(r => f.startsWith(r + path.sep)));
      if (bad) return send(res, 403, { error: `${bad} is outside the runner's folders` });
      return send(res, 200, await require('./javacheck').compileHere({ javaHome: body.javaHome, options: body.options || [], files: body.files || [] }));
    }
    if (req.method !== 'POST' || req.url !== '/exec') return send(res, 404, { error: 'not found' });
    const cwd = path.resolve(body.cwd || '');
    if (!roots().some(r => cwd === r || cwd.startsWith(r + path.sep))) return send(res, 403, { error: `cwd ${cwd} is outside the runner's folders (${roots().join(', ')})` });
    const own = Object.fromEntries(Object.entries(process.env).filter(([k]) => KEEP_ENV.test(k)));
    const env = { ...own, ...(body.env || {}), ...Object.fromEntries(Object.entries(own).filter(([k]) => OWN.test(k))) };
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const started = Date.now();
    let killed = false;
    const p = require('./process-tree').spawnTree(body.cmd, body.args || [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const id = body.id || String(p.pid);
    procs.set(id, p);
    const timer = setTimeout(() => { killed = true; p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 5000).unref(); }, Number(body.timeoutMs) || 900000);
    const out = (b) => res.write(JSON.stringify({ out: b.toString() }) + '\n');
    p.stdout.on('data', out); p.stderr.on('data', out);
    // the client went away (dt restarted, the job cancelled): stop the build
    res.on('close', () => { if (p.exitCode === null && !res.writableEnded) { try { p.kill('SIGTERM'); } catch {} } });
    p.on('error', (e) => { clearTimeout(timer); procs.delete(id); res.end(JSON.stringify({ done: true, code: -1, error: e.message, ms: Date.now() - started }) + '\n'); });
    p.on('close', (code) => { clearTimeout(timer); procs.delete(id); res.end(JSON.stringify({ done: true, code, killed, ms: Date.now() - started }) + '\n'); });
  });
  server.listen(port, host, () => console.error(`dt runner: ${host}:${port}${token ? '' : ' (DT_RUNNER_TOKEN not set: refusing commands)'}; folders ${roots().join(', ')}`));
  return server;
}

// ── the client, in dt ──
const url = () => require('./config').getTests().runnerUrl;
const auth = () => ({ authorization: `Bearer ${require('./config').getTests().runnerToken || ''}` });

// Like a local spawn: { code, out, killed, ms }; registered as a child of the current call (cancel kills it)
// not reachable a moment ago (the jdk profile is off): do not ask again for a minute
let downUntil = 0, downWhy = '', downEndpoint = '';
function exec(cmd, args, { cwd, env, timeoutMs = 900000, log, runnerUrl, runnerToken } = {}) {
  const endpoint = runnerUrl || url();
  const headers = runnerToken ? { authorization: `Bearer ${runnerToken}` } : auth();
  const T = require('./trace');
  if (endpoint === downEndpoint && Date.now() < downUntil) return Promise.resolve({ code: -1, out: downWhy, ms: 0, runnerError: true, unreachable: true, quiet: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const handle = new EventEmitter();
  handle.kill = () => { fetch(`${endpoint}/kill`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {}); return true; };
  T.child(handle);
  return new Promise((resolve) => {
    const started = Date.now();
    const u = new URL('/exec', endpoint);
    let out = '', buf = '', done = null;
    const req = (u.protocol === 'https:' ? require('https') : http).request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { ...headers, 'content-type': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => { handle.emit('exit'); resolve({ code: -1, out: `runner: HTTP ${res.statusCode} ${d.slice(0, 300)}`, ms: Date.now() - started, runnerError: true }); }); return; }
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.out) { out += m.out; if (out.length > 4e6) out = out.slice(-3e6); const last = m.out.trim().split('\n').pop(); if (last && log) log(last.slice(0, 200)); }
          if (m.done) done = m;
        }
      });
      res.on('end', () => { handle.emit('exit'); resolve({ code: done ? done.code : -1, out: out + (done?.error ? `\n${done.error}` : ''), runner: { placement: 'remote', origin: new URL(endpoint).origin }, killed: done?.killed, ms: Date.now() - started, ...(done ? {} : { runnerError: true }) }); });
    });
    req.on('error', (e) => { handle.emit('exit'); downEndpoint = endpoint; downUntil = Date.now() + 60000; downWhy = `runner ${endpoint}: ${e.code || e.message}`; resolve({ code: -1, out: downWhy, ms: Date.now() - started, runnerError: true, unreachable: true }); });
    req.end(JSON.stringify({ id, cmd, args, cwd, env, timeoutMs }));
  });
}

async function remoteInfo() {
  const res = await fetch(`${url()}/info`, { headers: auth(), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`runner ${url()}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = { serve, exec, remoteInfo, info, url };
