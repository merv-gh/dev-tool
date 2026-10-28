// What fetching repos and running tests need, checked one by one, each with how to fix it:
//   folders writable (and whether git can chmod there), disk space, git, Bitbucket (token, API, a repo's
//   refs), JDK (java and javac, not just a JRE), Maven / Gradle and the Gradle wrapper's download,
//   Maven repository and Gradle home writable, the company repository (settings / gradle.properties,
//   reached with the credentials), Maven Central, proxies, the test database, stuck jobs.
// repo: also fetch that repo (PROJECT/slug) into a scratch folder, as a workspace would.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const run = (cmd, args, { timeout = 20000, env, cwd } = {}) => new Promise((resolve) => {
  const t0 = Date.now();
  execFile(cmd, args, { timeout, env: env || process.env, cwd, maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, code: err?.code, out: `${stdout || ''}${stderr || ''}`.trim(), ms: Date.now() - t0, error: err?.message }));
});

async function head(url, { auth, timeout = 8000 } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', headers: auth ? { authorization: auth } : {}, signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) { return { error: e.cause?.code || e.cause?.message || e.message, ms: Date.now() - t0 }; }
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `.dt-doctor-${process.pid}`);
    fs.writeFileSync(f, 'x');
    let chmod = true;
    try { fs.chmodSync(f, 0o600); } catch { chmod = false; }
    fs.rmSync(f, { force: true });
    return { ok: true, chmod };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function check({ repo, deep = false } = {}) {
  const cfg = require('./config');
  const t = cfg.getTests();
  const out = [];
  const add = (group, name, status, detail, fix) => out.push({ group, check: name, status, detail: String(detail ?? '').slice(0, 400), ...(fix ? { fix } : {}) });

  // folders
  for (const [name, dir] of [['config folder', cfg.HOME], ['repos', cfg.PATHS.repos], ['workspaces', cfg.PATHS.work], ['cache', cfg.PATHS.cache], ['git data (DT_GIT_DIR)', process.env.DT_GIT_DIR || path.join(os.tmpdir(), 'dt-git')]]) {
    const w = writable(dir);
    if (!w.ok) add('folders', name, 'fail', `${dir}: ${w.error}`, 'run dt as the owner of the folder (run.sh sets DT_UID/DT_GID), or point DT_HOME_DIR at a writable folder');
    else add('folders', name, w.chmod ? 'ok' : 'warn', `${dir}${w.chmod ? '' : ': no chmod here (a Windows drive, SMB, some mounts): git keeps its data in DT_GIT_DIR'}`);
  }
  const gd = process.env.DT_GIT_DIR || path.join(os.tmpdir(), 'dt-git');
  if (path.resolve(gd).startsWith(path.resolve(os.tmpdir()))) add('folders', 'git data lasts', 'warn', `${gd} is in the temporary folder: after a restart every repo is fetched again`, 'set DT_GIT_DIR to a lasting folder git can chmod in (compose: the dt-git volume)');
  try {
    const st = fs.statfsSync(cfg.PATHS.work.replace(/\/work$/, '') || cfg.HOME);
    const free = st.bavail * st.bsize / 1e9;
    add('folders', 'free disk', free < 2 ? 'fail' : free < 10 ? 'warn' : 'ok', `${free.toFixed(1)} GB free`, free < 10 ? 'workspaces, Maven/Gradle caches and indexes need room: workspace_drop old workspaces' : null);
  } catch {}

  // git and Bitbucket
  const g = await run('git', ['--version']);
  add('git', 'git', g.ok ? 'ok' : 'fail', g.ok ? g.out : g.error, g.ok ? null : 'install git in the image (node:22-bookworm has it)');
  const bb = cfg.getPersonal().bitbucket;
  if (!bb.url) add('bitbucket', 'Bitbucket URL', 'fail', 'not set', 'bitbucket.url in config.json');
  else {
    add('bitbucket', 'token', bb.token ? 'ok' : 'fail', bb.token ? `set (${bb.token.length} chars)` : 'missing', bb.token ? null : 'BITBUCKET_HTTP_TOKEN in .env (a personal access token with repository read)');
    const api = await head(`${bb.url}/rest/api/1.0/repos?limit=1`, { auth: bb.token ? `Bearer ${bb.token}` : null });
    add('bitbucket', 'REST API', api.status === 200 ? 'ok' : 'fail', api.error ? `${bb.url}: ${api.error}` : `HTTP ${api.status} in ${api.ms} ms`, api.status === 401 ? 'the token is wrong or expired' : api.error ? 'dt cannot reach Bitbucket: DNS, proxy (HTTPS_PROXY), or the network of the container' : null);
  }
  if (repo) {
    const [project, slug] = String(repo).split('/');
    const G = require('./git');
    const url = `${bb.url}/scm/${String(project).toLowerCase()}/${slug}.git`;
    const ls = await run('git', ['-c', `http.extraHeader=Authorization: Bearer ${bb.token || ''}`, 'ls-remote', url, 'HEAD'], { timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    add('bitbucket', `git ls-remote ${repo}`, ls.ok ? 'ok' : 'fail', ls.ok ? `${ls.out.slice(0, 12)} in ${ls.ms} ms` : ls.out.replace(bb.token || '\u0000', '***').slice(0, 300), ls.ok ? null : /401|403|Authentication/.test(ls.out) ? 'the token cannot read this repo' : /Could not resolve|unable to access|timed out/i.test(ls.out) ? 'git cannot reach Bitbucket from here (proxy: git uses HTTPS_PROXY / http.proxy)' : 'check the project key and repo slug');
    if (ls.ok && deep) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-doctor-'));
      const t0 = Date.now();
      try { const info = await G.fetchRef(project, slug, '', { dir, gitKey: `doctor/${path.basename(dir)}` }); add('bitbucket', `fetch ${repo}`, 'ok', `${info.sha.slice(0, 10)} in ${Date.now() - t0} ms${info.fallback ? `; ${info.fallback}` : ''}`); }
      catch (e) { add('bitbucket', `fetch ${repo}`, 'fail', e.message, 'the fetch itself fails: see the message (disk, permissions, proxy)'); }
      finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  }

  // JDK, Maven, Gradle
  const bin = (tool) => (t.javaHome ? path.join(t.javaHome, 'bin', tool) : tool);
  const java = await run(bin('java'), ['-version']);
  const javac = await run(bin('javac'), ['-version']);
  add('tests', 'java', java.ok ? 'ok' : 'fail', java.ok ? `${java.out.split('\n')[0]}${t.javaHome ? ` (${t.javaHome})` : ' (PATH)'}` : `${bin('java')}: ${java.error}`, java.ok ? null : 'add jdk to COMPOSE_PROFILES (run.sh does by default) or set tests.javaHome');
  add('tests', 'javac (a JDK, not a JRE)', javac.ok ? 'ok' : 'fail', javac.ok ? javac.out : `${bin('javac')}: ${javac.error}`, javac.ok ? null : 'tests need a JDK: the jdk compose profile, or tests.javaHome pointing at a JDK');
  const mvn = t.maven || 'mvn';
  const mv = await run(mvn, ['-v'], { env: { ...process.env, ...(t.javaHome ? { JAVA_HOME: t.javaHome } : {}) } });
  add('tests', 'Maven', mv.ok ? 'ok' : 'warn', mv.ok ? mv.out.split('\n')[0] : `${mvn}: ${mv.error}`, mv.ok ? null : 'Maven projects without mvnw need it: the jdk compose profile, or tests.maven');
  if (t.gradle) { const gr = await run(t.gradle, ['-v'], { timeout: 60000 }); add('tests', 'Gradle', gr.ok ? 'ok' : 'warn', gr.ok ? (gr.out.match(/Gradle [\d.]+/) || [gr.out])[0] : gr.error); }
  for (const [name, dir] of [['Maven repository', t.mavenRepo], ['Gradle home', t.gradleHome]].filter(([, d]) => d)) {
    const w = writable(dir);
    add('tests', name, w.ok ? 'ok' : 'fail', w.ok ? dir : `${dir}: ${w.error}`, w.ok ? null : 'must be writable by dt\'s user');
  }

  // repositories: Maven Central, the company one, proxies
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  add('network', 'proxy', 'ok', proxy ? `${proxy.replace(/\/\/[^@/]*@/, '//***@')} (git, Maven and Gradle read it differently: Maven from settings.xml <proxies>, Gradle from systemProp.https.proxyHost)` : 'none set');
  if (!t.offline) {
    const central = await head('https://repo.maven.apache.org/maven2/');
    add('network', 'Maven Central', central.status && central.status < 400 ? 'ok' : 'warn', central.error ? central.error : `HTTP ${central.status} in ${central.ms} ms`, central.status && central.status < 400 ? null : 'not reachable: builds need your company repository (maven-settings.xml / gradle.properties) or a proxy');
    const wrapper = await head('https://services.gradle.org/distributions/');
    add('network', 'Gradle distributions (gradlew)', wrapper.status && wrapper.status < 400 ? 'ok' : 'warn', wrapper.error || `HTTP ${wrapper.status}`, wrapper.status && wrapper.status < 400 ? null : 'gradlew downloads Gradle from here on first use: point distributionUrl at your mirror');
  }
  if (t.mavenSettings) {
    let text = '';
    try { text = fs.readFileSync(t.mavenSettings, 'utf8'); } catch (e) { add('repository', 'maven settings', 'fail', `${t.mavenSettings}: ${e.message}`); }
    for (const m of text.matchAll(/<url>\s*([^<]+?)\s*<\/url>/g)) { const r = await head(m[1]); add('repository', `Maven repository ${m[1]}`, r.status && r.status < 500 ? 'ok' : 'fail', r.error || `HTTP ${r.status} (401 without credentials is normal)`); }
  }
  const { props, from } = require('./buildenv').gradleProperties(t);
  if (Object.keys(props).length) {
    add('repository', 'gradle.properties', 'ok', `${Object.keys(props).length} properties from ${[...new Set(Object.values(from))].join(', ')}: ${Object.keys(props).map(k => (/pass|secret|token|key/i.test(k) ? `${k}=***` : k)).join(', ')}`);
    const url = Object.entries(props).find(([k, v]) => /url/i.test(k) && /^https?:/.test(v));
    if (url) {
      const user = Object.entries(props).find(([k]) => /user/i.test(k))?.[1], pass = Object.entries(props).find(([k]) => /pass|token/i.test(k))?.[1];
      const r = await head(url[1], { auth: user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : null });
      add('repository', `${url[0]} (${url[1]})`, r.status && r.status < 400 ? 'ok' : r.status === 401 || r.status === 403 ? 'fail' : r.status ? 'ok' : 'fail', r.error || `HTTP ${r.status} with the credentials`, r.status === 401 || r.status === 403 ? 'the user/password in gradle.properties are refused' : r.error ? 'not reachable from here' : null);
    }
  } else add('repository', 'gradle.properties', 'warn', 'none: builds that read nexusUrl/mavenUser/mavenPassword fail', 'put gradle.properties in the config folder (values may be ${VAR} from .env)');

  // test database
  if (t.pgUrl) {
    try {
      const postgres = require('postgres');
      const sql = postgres(t.pgUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
      const t0 = Date.now();
      await sql`select 1`; await sql.end({ timeout: 2 });
      add('tests', 'test database', 'ok', `${new URL(t.pgUrl).host} in ${Date.now() - t0} ms`);
    } catch (e) { add('tests', 'test database', 'warn', `${(() => { try { return new URL(t.pgUrl).host; } catch { return t.pgUrl; } })()}: ${e.code || e.message}`, 'needed only for DB tests: the testdb compose profile, or tests.pgUrl'); }
  } else add('tests', 'test database', 'warn', 'not set', 'needed only for DB tests: the testdb compose profile, or tests.pgUrl');

  // jobs that look stuck
  for (const j of require('./jobs').list(100).filter(x => x.state === 'running')) {
    const ms = Date.now() - Date.parse(j.startedAt);
    if (ms > t.timeoutMs) add('jobs', `job ${j.id}`, 'warn', `${j.title}: running for ${Math.round(ms / 60000)} min`, `job_cancel job="${j.id}"`);
  }
  const counts = { ok: out.filter(x => x.status === 'ok').length, warn: out.filter(x => x.status === 'warn').length, fail: out.filter(x => x.status === 'fail').length };
  return { counts, checks: out };
}

module.exports = { check };
