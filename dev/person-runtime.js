// Owned, loopback-only runtime for the person mutation practice corpus.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const F = require('./person-mutations');
async function command(cmd, args, { cwd, env, signal, timeoutMs = 180000 } = {}) {
  let out = '';
  const child = spawn(cmd, args, { cwd, env: env || process.env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', c => { out = (out + c).slice(-2e6); });
  child.stderr.on('data', c => { out = (out + c).slice(-2e6); });
  let timer;
  const code = await new Promise((resolve, reject) => {
    timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Command timed out: ' + cmd)); }, timeoutMs);
    child.once('error', reject); child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  if (code !== 0) throw Error('Command failed (' + code + '): ' + cmd + '\n' + out.slice(-5000));
  return out;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(r => server.close(r)); return port;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  let timer; const closed = new Promise(r => child.once('close', r));
  child.kill('SIGTERM');
  try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Service did not stop')), 10000); })]); }
  catch { child.kill('SIGKILL'); await closed; }
  finally { clearTimeout(timer); }
}
function diagnostics(log){return String(log).split('\n').filter(line=>/ERROR|Exception|Caused by:|does not exist|\bat person\./.test(line)).slice(-12).map(line=>line.slice(0,320)).join('\n').slice(-2500);}
async function create(options) {
  const owner = crypto.randomBytes(12).toString('hex'), label = 'dt.person-mutations.owner=' + owner;
  const name = 'dt-person-' + owner, password = crypto.randomBytes(20).toString('hex');
  let container, sql, service, runtimeDigest, runtimeDate, root, port, serviceLog = '';
  const buildEnv = { ...process.env, JAVA_HOME: options.javaHome, GRADLE_USER_HOME: options.gradleHome,
    PATH: path.join(options.javaHome, 'bin') + path.delimiter + process.env.PATH,
    JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8' };
  const api = {
    label, name, logs: () => serviceLog,
    async close() {
      await stop(service); service = null;
      if (sql) await sql.end({ timeout: 2 });
      if (container) {
        const check = await command('docker', ['inspect', '--format', '{{index .Config.Labels "dt.person-mutations.owner"}}', container]);
        if (check.trim() !== owner) throw Error('Owned container label mismatch');
        await command('docker', ['rm', '-f', container]); container = null;
      }
    },
    async build(dir) {
      root = dir;
      return command(options.gradle, ['--console=plain', '--build-cache', '--max-workers=2', 'runtimeClasspath'], { cwd: dir, env: { ...buildEnv, ...api.env },signal:options.signal });
    },
    async start(dir) {
      const current = F.sourceDigest(dir);
      if (service?.exitCode === null && runtimeDigest === current && runtimeDate===api.env.PERSON_AS_OF && dir === root) return;
      await stop(service); service = null;
      await api.build(dir); port ||= await freePort(); serviceLog = '';
      service = spawn(path.join(options.javaHome, 'bin/java'), ['-Xmx384m', '-cp', fs.readFileSync(path.join(dir, '.dt/classpath.txt'), 'utf8'), 'person.PersonApplication', '--server.address=127.0.0.1', '--server.port=' + port, '--spring.main.banner-mode=off', '--logging.level.root=WARN'], { cwd: dir, env: { ...buildEnv, ...api.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      service.stdout.on('data', c => { serviceLog = (serviceLog + c).slice(-1e5); });
      service.stderr.on('data', c => { serviceLog = (serviceLog + c).slice(-1e5); });
      api.url = 'http://127.0.0.1:' + port;
      for (let n = 0; n < 200; n++) {
        options.signal?.throwIfAborted();
        if (service.exitCode !== null) throw Error('Service failed to start: ' + serviceLog.slice(-2000));
        try { const r = await fetch(api.url + '/person/999999', { signal: AbortSignal.timeout(500) }); if (r.status === 404) { runtimeDigest = current;runtimeDate=api.env.PERSON_AS_OF; return; } } catch {}
        await new Promise(r => setTimeout(r, 100));
      }
      throw Error('Service readiness timed out: ' + serviceLog.slice(-2000));
    },
    async grade(dir, data) {
      api.env.PERSON_AS_OF=data.asOf;
      await api.start(dir);
      const failures = [];
      for (const c of data.cases) {
        options.signal?.throwIfAborted();
        const r = await fetch(api.url + '/person/' + c.id, { signal: AbortSignal.timeout(5000) });
        const actual = await r.json();
        if (r.status !== 200) failures.push({ id: c.id, status: r.status, ...(r.status>=500?{applicationLog:diagnostics(serviceLog).replaceAll(password,'<redacted>')}: {}) });
        else { const differences = F.diff(c.expected, actual); if (differences.length) failures.push({ id: c.id, differences }); }
      }
      const missing = await fetch(api.url + '/person/999999', { signal: AbortSignal.timeout(5000) });
      if (missing.status !== 404) failures.push({ id: 999999, status: missing.status });
      return { passed: failures.length === 0, checked: data.cases.length + 1, failures, sourceDigest: runtimeDigest };
    },
  };
  try {
    const image = options.postgresImage || 'postgres:16-alpine';
    container = (await command('docker', ['run', '-d', '--name', name, '--label', label, '--memory', '256m', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_DB=person', image])).trim();
    const port = Number((await command('docker', ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', container])).trim());
    api.pgUrl = 'postgres://postgres:' + password + '@127.0.0.1:' + port + '/person';
    api.env = { PERSON_JDBC_URL: 'jdbc:postgresql://127.0.0.1:' + port + '/person', PERSON_DB_USER: 'postgres', PERSON_DB_PASSWORD: password, PERSON_AS_OF: options.data.asOf };
    sql = require('postgres')(api.pgUrl, { max: 1, connect_timeout: 1, onnotice: () => {} });
    for (let n = 0; ; n++) { try { await sql`select 1`; break; } catch (e) { if (n > 60) throw e; await new Promise(r => setTimeout(r, 200)); } }
    await sql.unsafe(F.sql(options.data));
    api.query = (statement, params = []) => sql.unsafe(statement, params);
    return api;
  } catch (e) { await api.close(); throw e; }
}
module.exports = { create, command, freePort, stop, diagnostics };
