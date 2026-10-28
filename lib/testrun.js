// Run tests in a workspace with its own build (Maven or Gradle, the wrapper when the repo has one) and
// report what failed and where: JUnit XML reports (surefire / Gradle), compile errors from the output,
// and for each failure the code parts to work on (the frames of stack traces that are in the repo,
// with the lines around them). With a db snapshot the run gets a throwaway database loaded with it,
// given to Spring Boot as SPRING_DATASOURCE_* (env vars reach the test JVM under Maven and Gradle).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const W = require('./workspace');
const { getTests } = require('./config');

// Which build, where, how: the module of the tests (nearest build file), run from the build root
function plan(root, testFiles) {
  const near = (file) => {
    let dir = path.dirname(path.join(root, file));
    while (dir.startsWith(root)) {
      if (['pom.xml', 'build.gradle', 'build.gradle.kts'].some(f => fs.existsSync(path.join(dir, f)))) return dir;
      if (dir === root) break;
      dir = path.dirname(dir);
    }
    return root;
  };
  const modDir = testFiles.length ? near(testFiles[0]) : root;
  const mod = path.relative(root, modDir).split(path.sep).join('/') || '.';
  const gradle = fs.existsSync(path.join(root, 'settings.gradle')) || fs.existsSync(path.join(root, 'settings.gradle.kts')) || fs.existsSync(path.join(modDir, 'build.gradle')) || fs.existsSync(path.join(modDir, 'build.gradle.kts'));
  const maven = fs.existsSync(path.join(modDir, 'pom.xml'));
  return { tool: maven ? 'maven' : gradle ? 'gradle' : null, module: mod, modDir };
}

function which(cmd, extra = []) {
  for (const d of [...extra, ...(process.env.PATH || '').split(path.delimiter)]) {
    if (!d) continue;
    const f = path.join(d, cmd);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch {}
  }
  return null;
}

// the wrapper runs through sh: on some mounts the execute bit is lost
function mavenCmd(root, cfg) {
  const javaBin = cfg.javaHome ? [path.join(cfg.javaHome, 'bin')] : [];
  if (fs.existsSync(path.join(root, 'mvnw'))) return ['sh', ['mvnw']];
  const m = cfg.maven || which('mvn', [...javaBin, ...(process.env.MAVEN_HOME ? [path.join(process.env.MAVEN_HOME, 'bin')] : [])]);
  if (!m) throw new Error('no Maven: the repo has no mvnw, and mvn is not on PATH (set tests.maven in config.json, or run with the compose jdk profile)');
  return [m, []];
}

// A test given as FooTest, com.acme.FooTest, FooTest#method or a path -> { file, fqn }
const TEST_EXT = /\.(java|kt|groovy|scala)$/;
function findTest(root, g, t) {
  const name = t.split('#')[0].replace(TEST_EXT, '');
  const simple = name.split('/').pop().split('.').pop();
  const c = g.classes.find(x => x.test && (x.id === name || x.name === name || x.file === t.split('#')[0]));
  if (c) return { file: c.file, fqn: c.id };
  // not in the graph: the file under a src/test folder, its package line gives the full name
  const want = name.includes('.') && !name.includes('/') ? name : null;
  const hits = [];
  (function rec(d, depth) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 12 && !/^(\.|build$|target$|node_modules$|out$)/.test(e.name)) rec(f, depth + 1); continue; }
      if (!TEST_EXT.test(e.name) || e.name.replace(TEST_EXT, '') !== simple) continue;
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (!/(^|\/)src\/(test|it|integrationTest)\//.test(rel)) continue;
      const pkg = (fs.readFileSync(f, 'utf8').match(/^\s*package\s+([\w.]+)/m) || [])[1];
      const fqn = pkg ? `${pkg}.${simple}` : simple;
      if (!want || want === fqn) hits.push({ file: rel, fqn });
    }
  })(root, 0);
  return hits[0] || null;
}

// the major version of the JDK the tests run on (cached)
let jdkSeen = null;
async function jdkMajor(cfg) {
  const key = `${cfg.runnerUrl || ''}|${cfg.javaHome || 'PATH'}`;
  if (jdkSeen && jdkSeen.key === key) return jdkSeen.major;
  // java -version writes to stderr; on the runner when builds run there
  let text = '';
  if (cfg.runnerUrl) { try { text = (await require('./runner').remoteInfo()).java?.out || ''; } catch {} }
  if (!text) { const r = require('child_process').spawnSync(cfg.javaHome ? path.join(cfg.javaHome, 'bin', 'java') : 'java', ['-version'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }); text = `${r.stderr || ''}${r.stdout || ''}`; }
  const major = Number((text.match(/version "(?:1\.)?(\d+)/) || [])[1] || 0);
  jdkSeen = { key, major };
  return major;
}

const KEEP_ENV = /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LANGUAGE|LC_\w+|TZ|TERM|JAVA_HOME|MAVEN_HOME|M2_HOME|MAVEN_OPTS|GRADLE_OPTS|GRADLE_USER_HOME|JAVA_TOOL_OPTIONS|(HTTPS?|NO|ALL)_PROXY|(https?|no|all)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|DOCKER_HOST|TESTCONTAINERS_\w+)$/;
function cleanEnv(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) if (KEEP_ENV.test(k) || cfg.passEnv.includes(k)) out[k] = v;
  return out;
}

function gradleCmd(root, cfg) {
  const javaBin = cfg.javaHome ? [path.join(cfg.javaHome, 'bin')] : [];
  const gr = fs.existsSync(path.join(root, 'gradlew')) ? ['sh', ['gradlew']] : [cfg.gradle || which('gradle', javaBin), []];
  if (!gr[0]) throw new Error('no Gradle: the repo has no gradlew, and gradle is not on PATH (set tests.gradle in config.json)');
  return gr;
}

// What a build gets: a clean environment, the repository credentials (gradle.properties, tests.env), the JDK
async function envFor(p, cfg) {
  const B = require('./buildenv').forBuild(cfg, p.tool);
  // builds run the project's code (build scripts, tests): they get what they need, not dt's secrets
  const env = { ...cleanEnv(cfg), MAVEN_OPTS: process.env.MAVEN_OPTS || '-Xmx1g', CI: 'true', ...B.env };
  if (cfg.javaHome) { env.JAVA_HOME = cfg.javaHome; env.PATH = `${path.join(cfg.javaHome, 'bin')}${path.delimiter}${env.PATH}`; }
  if (cfg.gradleHome) env.GRADLE_USER_HOME = cfg.gradleHome;
  // a JDK newer than the project's Mockito/Byte Buddy (22+): let Byte Buddy try anyway (forked test JVMs
  // read it). Not for Gradle unless asked: every JVM prints "Picked up JAVA_TOOL_OPTIONS", Gradle reads
  // the output of the JVMs it probes, and its daemons are matched by environment.
  const javaMajor = await jdkMajor(cfg);
  if (cfg.javaToolOptions && javaMajor >= 22 && (p.tool !== 'gradle' || cfg.javaToolOptionsGradle)) env.JAVA_TOOL_OPTIONS = [process.env.JAVA_TOOL_OPTIONS, cfg.javaToolOptions].filter(Boolean).join(' ');
  else if (p.tool === 'gradle') delete env.JAVA_TOOL_OPTIONS;
  return { env, B, javaMajor, hide: (t) => require('./buildenv').mask(t, B.secrets) };
}

function command(root, p, tests, cfg) {
  const sel = tests.map(t => t.replace(/\.(java|kt)$/, '').split('/').pop());
  if (p.tool === 'maven') {
    const mvn = mavenCmd(root, cfg);
    const args = [...mvn[1], '-B', '-ntp', 'test',
      `-Dtest=${sel.join(',')}`, '-Dsurefire.failIfNoSpecifiedTests=false', '-DfailIfNoTests=false',
      '-Djacoco.skip=true', '-Dcheckstyle.skip=true', '-Dspotless.check.skip=true', '-Denforcer.skip=true', '-Dpmd.skip=true', '-Dspotbugs.skip=true',
      `-Dmaven.repo.local=${cfg.mavenRepo}`];
    if (p.module !== '.' && fs.existsSync(path.join(root, 'pom.xml'))) args.push('-pl', p.module, '-am');
    if (cfg.offline) args.push('-o');
    if (cfg.mavenSettings) args.push('-s', cfg.mavenSettings);
    return { cmd: mvn[0], args: [...args, ...cfg.args], cwd: p.module !== '.' && fs.existsSync(path.join(root, 'pom.xml')) ? root : p.modDir };
  }
  if (p.tool === 'gradle') {
    const gr = gradleCmd(root, cfg);
    const task = p.module === '.' ? 'test' : `:${p.module.split('/').join(':')}:test`;
    // only these tests (--tests with the class's full name, or Class.method); -q: the console says little,
    // the messages come from the XML reports; the daemon stays warm between runs
    // exactly these tests, by full name (Class or Class.method): no patterns that may match nothing or too much
    const fq = p.selectors || sel;
    const args = [...gr[1], '--console=plain', '-q', '--warning-mode=none', '--no-watch-fs', ...(cfg.gradleBuildCache ? ['--build-cache'] : []), task, ...fq.flatMap(t => ['--tests', t.replace('#', '.')])];
    if (cfg.offline) args.push('--offline');
    return { cmd: gr[0], args: [...args, ...cfg.args], cwd: root };
  }
  throw new Error('no pom.xml or build.gradle for these tests');
}

// <testsuite>/<testcase> from JUnit XML
function parseReports(dirs, since) {
  const cases = [];
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d).filter(f => /^TEST-.*\.xml$/.test(f)).map(f => path.join(d, f)); } catch { continue; }
    for (const f of files) {
      if (fs.statSync(f).mtimeMs < since - 1000) continue;
      const x = fs.readFileSync(f, 'utf8');
      for (const m of x.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
        const attr = (n) => { const a = m[1].match(new RegExp(`\\b${n}="([^"]*)"`)); return a ? unxml(a[1]) : null; };
        const inner = m[3] || '';
        const fail = inner.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
        const skipped = /<skipped\b/.test(inner);
        const msg = fail ? unxml((fail[2].match(/\bmessage="([^"]*)"/) || [])[1] || '') : null;
        const stack = fail ? unxml((fail[3] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '')) : null;
        const out = unxml(((inner.match(/<system-out>([\s\S]*?)<\/system-out>/) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, ''));
        cases.push({ class: attr('classname'), name: attr('name'), ms: Math.round(Number(attr('time') || 0) * 1000), status: fail ? (fail[1] === 'error' ? 'error' : 'failed') : skipped ? 'skipped' : 'passed', message: msg, type: fail ? (fail[2].match(/\btype="([^"]*)"/) || [])[1] || null : null, stack, output: out ? out.slice(-4000) : undefined });
      }
    }
  }
  return cases;
}

const unxml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

// compile errors: Maven "[ERROR] /abs/Foo.java:[12,5] msg", javac "Foo.java:12: error: msg", Kotlin "e: file:///x.kt:12:5 msg"
function compileErrors(output, root) {
  const out = [];
  const rel = (f) => { const p = f.replace(/^file:\/\//, ''); return p.startsWith(root) ? path.relative(root, p).split(path.sep).join('/') : p; };
  for (const m of output.matchAll(/\[ERROR\]\s+(\/[^\s:]+\.(?:java|kt)):\[(\d+),(\d+)\]\s*(.*)/g)) out.push({ file: rel(m[1]), line: +m[2], col: +m[3], message: m[4].trim() });
  for (const m of output.matchAll(/^(\/[^\s:]+\.java):(\d+): error: (.*)$/gm)) out.push({ file: rel(m[1]), line: +m[2], message: m[3].trim() });
  for (const m of output.matchAll(/^e: (?:file:\/\/)?(\/[^\s:]+\.kts?):(\d+):(\d+):? (.*)$/gm)) out.push({ file: rel(m[1]), line: +m[2], col: +m[3], message: m[4].trim() });
  const seen = new Set();
  return out.filter(e => { const k = `${e.file}:${e.line}:${e.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// The repo's frames of a stack trace -> file:line with the code around it
function codeParts(root, g, stack, max = 3) {
  const byClass = new Map(g.classes.map(c => [c.id, c.file]));
  const parts = [];
  for (const m of String(stack || '').matchAll(/at (?:[\w.$-]+(?:@[\w.-]+)?\/\/?)?([\w$.]+)\.([\w$<>]+)\(([\w$]+\.(?:java|kt)):(\d+)\)/g)) {
    const cls = m[1].replace(/\$.*$/, '');
    const file = byClass.get(cls) || byClass.get(m[1].replace(/\$/g, '.'));
    if (!file) continue;
    const line = Number(m[4]);
    if (parts.some(p => p.file === file && p.line === line)) continue;
    parts.push({ file, line, method: `${cls.split('.').pop()}#${m[2]}`, test: /(^|\/)src\/test\//.test(file), snippet: snippet(root, file, line) });
    if (parts.length >= max) break;
  }
  return parts;
}

// Mockito verification failures: the mocked method's own frame says nothing; the test's verify line and
// where the real calls happened ("-> at" after "However" / "Actual invocations") do
function partsOf(root, g, k) {
  if (!/org\.mockito\.exceptions\.verification/.test(k.type || '') && !/^(Wanted but not invoked|Argument\(s\) are different|Never wanted here|Too (many|few) actual invocations)/m.test(k.message || '')) return codeParts(root, g, k.stack);
  const after = String(k.message || '').split(/\n(?=However|Actual invocations?|But (was|invoked))/).slice(1).join('\n');
  const calls = codeParts(root, g, after.replace(/-> at /g, '\tat '));
  const tests = codeParts(root, g, String(k.stack || '').split('\n').filter(l => /^\s*at /.test(l)).join('\n'), 6).filter(p => p.test);
  return [...tests.slice(0, 1), ...calls].slice(0, 3);
}

function snippet(root, file, line, around = 4) {
  try {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    const from = Math.max(1, line - around), to = Math.min(lines.length, line + around);
    return { from, to, text: lines.slice(from - 1, to).map((l, i) => `${from + i === line ? '>' : ' '}${String(from + i).padStart(4)}  ${l}`).join('\n') };
  } catch { return null; }
}

// a build command: on the runner when there is one (compose: Docker for Testcontainers, no dt secrets), else here
async function exec(cmd, args, opts = {}) {
  if (getTests().runnerUrl) {
    // commands without a folder of their own (javac -version, the launcher) run in the shared build folder
    const r = await require('./runner').exec(cmd, args, { ...opts, cwd: opts.cwd || require('./config').PATHS.build });
    if (!r.unreachable) return r;
    if (!r.quiet) require('./trace').note(`${r.out}: running the build in dt itself (Testcontainers has no Docker here)`);
  }
  return execLocal(cmd, args, opts);
}

function execLocal(cmd, args, { cwd, env, timeoutMs, log }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = require('./trace').child(spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }));
    let out = '', killed = false;
    const keep = (b) => { out += b.toString(); if (out.length > 4e6) out = out.slice(-3e6); const last = b.toString().trim().split('\n').pop(); if (last && log) log(last.slice(0, 200)); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    const timer = setTimeout(() => { killed = true; p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: out + `\n${e.message}`, ms: Date.now() - started }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, killed, ms: Date.now() - started }); });
  });
}

// tests: class names (FooTest), Class#method, or test file paths. db: { env, db, tables, service } -> throwaway database
// mode: "fast" (Maven modules: javac + dt's JUnit launcher after one Maven prepare), "build" (the
// project's Maven/Gradle), "auto" (fast where it fits). files: written first [{ path, content | edits }].
async function run(id, { tests = [], db, log = () => {}, mode = 'auto', files: writes = [] } = {}) {
  const m = W.checkId(id);
  const root = m.path;
  const written = writes.map(f => W.write(id, f.path, { content: f.content, edits: f.edits }));
  // what was written compiles? (clear fixes applied); errors left: no run, they are the answer
  const check = written.length ? await require('./javacheck').check(id, written.map(w => w.path)).catch(e => ({ skipped: e.message })) : null;
  if (check?.errors?.length) {
    const compile = check.errors.map(e => ({ file: e.file, line: e.line, message: e.message }));
    return {
      workspace: id, tool: null, mode: 'check', written: written.map(w => w.path), module: null, command: `compile check (${check.compileMs} ms)`, outcome: 'compile-error', exit: 1, ms: check.ms,
      counts: { tests: 0, passed: 0, failed: 0, errors: 0, skipped: 0 }, cases: [], compile, check,
      parts: compile.map(e => ({ file: e.file, line: e.line, why: `compile: ${e.message}`, snippet: snippet(root, e.file, e.line) })), hints: [], database: null, tail: '', history: [],
    };
  }
  const idx = W.index(id);
  const g = idx.graph_();
  if (!tests.length) throw new Error('name the tests to run (class names like FooTest, or Class#method)');
  // each test by its full name: from the code graph, else from its file (Groovy/Spock, Scala are not in it)
  const found = tests.map(t => findTest(root, g, t));
  const missing = tests.filter((t, i) => !found[i]);
  if (missing.length) throw new Error(`no test class ${missing.join(', ')} in ${id} (write it with workspace_write first, or give the full name com.acme.FooTest)`);
  const files = found.map(f => f.file);
  const p = plan(root, files);
  const cfg = getTests();
  const fast = require('./fastrun');
  const why = mode === 'build' ? 'mode=build' : fast.supported(root, p, files);
  if (mode === 'fast' && why && p.tool !== 'gradle') throw new Error(`no fast run here: ${why} (use mode="build")`);
  // the tests by their full names
  p.selectors = found.map((f, i) => { const meth = tests[i].split('#')[1]; return meth ? `${f.fqn}#${meth}` : f.fqn; });
  const c = why ? command(root, p, tests, cfg) : null;
  const { env, B, hide } = await envFor(p, cfg);
  if (c) c.args.splice(c.args.indexOf('--console=plain') + 1 || 0, 0, ...(p.tool === 'gradle' ? B.args : []));
  let database = null;
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (db) {
    const opts = { tables: db.tables, service: db.service, functions: db.functions };
    let statements;
    if (db.ddlPath) statements = splitSql(fs.readFileSync(W.resolvePath(m, db.ddlPath).full, 'utf8'));
    else statements = require('./ddl').snapshot(db.env, db.db, opts).statements;
    log(`test db: loading ${statements.length} statements`);
    database = await require('./trace').step('test database', () => require('./testdb').create(runId, statements), `${statements.length} statements`);
    if (database.errors.length) log(`test db: ${database.errors.length} statements failed`);
    Object.assign(env, { SPRING_DATASOURCE_URL: database.jdbcUrl, SPRING_DATASOURCE_USERNAME: database.user, SPRING_DATASOURCE_PASSWORD: database.password, SPRING_JPA_HIBERNATE_DDL_AUTO: 'none', SPRING_SQL_INIT_MODE: 'never', SPRING_FLYWAY_ENABLED: 'false', SPRING_LIQUIBASE_ENABLED: 'false' });
  }
  // reports of this run only
  const reportDirs = [path.join(p.modDir, 'target', 'surefire-reports'), path.join(p.modDir, 'build', 'test-results', 'test')];
  // a classpath preparation for compile checks builds in the same folder: after it
  await require('./javacheck').idle(id);
  const started = Date.now();
  let r, cases, fastInfo = null;
  if (!why) {
    const selectors = p.selectors;
    log(`fast: ${selectors.join(' ')}`);
    r = await fast.run({ id, root, plan: p, cfg, env, mvn: { cmd: mavenCmd(root, cfg)[0], args: mavenCmd(root, cfg)[1] }, selectors, graph: g, log: (l) => log(hide(l)) });
    cases = r.cases;
    fastInfo = { compiled: r.compiled, prepared: !!r.prepared, prepareMs: r.prepareMs, phase: r.phase };
  } else {
    for (const d of reportDirs) fs.rmSync(d, { recursive: true, force: true });
    log(`${p.tool}: ${path.basename(c.cmd)} ${c.args.filter(a => !/^-Dmaven\.repo\.local|^-s$/.test(a)).join(' ')}`);
    r = await require('./trace').step(`${p.tool} test`, () => exec(c.cmd, c.args, { cwd: c.cwd, env, timeoutMs: cfg.timeoutMs, log: (l) => log(hide(l)) }), `${p.module} ${tests.join(',')}`);
    // a Gradle run that was stopped (timeout, cancel) leaves its daemon holding locks: stop it too
    if (p.tool === 'gradle' && (r.killed || r.code === null)) {
      require('./trace').note('the Gradle run was stopped: stopping its daemon (gradle --stop)');
      await exec(c.cmd, [...c.args.filter((a, i) => i < c.args.indexOf('--console=plain') && !/^-D/.test(a)), '--stop'], { cwd: c.cwd, env, timeoutMs: 60000 }).catch(() => {});
    }
    if (r.code !== 0 && !r.out.trim()) require('./trace').note(`${p.tool} exited ${r.code} with no output: is ${c.cmd} runnable here?`);
    cases = parseReports(reportDirs, started);
  }
  if (database) { try { await require('./testdb').drop(database.database); } catch (e) { log(`test db: drop failed: ${e.message}`); } }
  // one name per test in both kinds of run: "fee(String, String)[1]" (surefire) and "fee [1] amount=…" (launcher) -> "fee[1]"
  for (const k of cases) k.name = testName(k.name);
  // short stacks (repo frames, the frames that threw), expected/actual, output kept for the view only
  const O = require('./testout');
  const pkgs = new Set(), ids = new Set();
  for (const key of (() => { try { return W.keys(id); } catch { return [`work/${id}`]; } })()) {
    for (const c of require('./codeindex').load(key)?.graph_().classes || []) { ids.add(c.id); pkgs.add(c.id.slice(0, c.id.length - c.name.length - 1)); }
  }
  const repo = (cls) => ids.has(cls) || ids.has(cls.replace(/\$/g, '.')) || pkgs.has(cls.slice(0, cls.lastIndexOf('.')));
  for (const k of cases) {
    if (k.status !== 'failed' && k.status !== 'error') continue;
    const ea = k.expected != null || k.actual != null ? { expected: k.expected, actual: k.actual } : O.expectedActual(k.message);
    if (ea) Object.assign(k, ea);
    k.stackShort = O.compactStack(k.stack, repo);
    if (k.stack && k.stack.length > 30000) k.stack = `${k.stack.slice(0, 30000)}\n... (cut)`;
  }
  const compile = cases.length ? [] : compileErrors(r.out, root);
  for (const k of cases) if (k.status === 'failed' || k.status === 'error') k.parts = partsOf(root, g, k);
  const counts = { tests: cases.length, passed: cases.filter(k => k.status === 'passed').length, failed: cases.filter(k => k.status === 'failed').length, errors: cases.filter(k => k.status === 'error').length, skipped: cases.filter(k => k.status === 'skipped').length };
  const parts = [];
  for (const e of compile) parts.push({ file: e.file, line: e.line, why: `compile: ${e.message}`, snippet: snippet(root, e.file, e.line) });
  for (const k of cases) for (const pt of k.parts || []) if (!parts.some(x => x.file === pt.file && x.line === pt.line)) parts.push({ file: pt.file, line: pt.line, method: pt.method, test: pt.test, why: `${k.class.split('.').pop()}.${k.name}: ${((k.message || k.type || '').split('\n').find(l => l.trim()) || '').trim().slice(0, 200)}`, snippet: pt.snippet });
  const hints = [];
  if (/Mockito cannot mock this class|Java \d+ \(\d+\) is not supported by the current version of Byte Buddy/.test(r.out + cases.map(k => k.message).join('\n'))) hints.push('Mockito/Byte Buddy of this project does not support the JDK the tests ran on: point tests.javaHome at the JDK the project builds with (17 or 21), or keep tests.javaToolOptions = "-Dnet.bytebuddy.experimental=true".');
  if (/registry\.bin|Timeout waiting to lock|Could not (write|read) cache value|could not acquire lock|Gradle could not start your build|Unable to lock|DaemonRegistry/i.test(r.out)) hints.push(`Gradle cannot lock its files in ${cfg.gradleHome || '~/.gradle'} or the workspace: that folder is on a mount without working file locks (a Windows drive, SMB, some Docker Desktop mounts). Keep the Gradle home and the workspaces on a local disk or a Docker volume (compose: DT_GRADLE_USER_HOME=/var/dt-build/gradle, DT_WORK_DIR=/var/dt-work); doctor shows which folders are on such mounts.`);
  if (/Picked up JAVA_TOOL_OPTIONS/.test(r.out) && p.tool === 'gradle' && r.code !== 0) hints.push('JAVA_TOOL_OPTIONS is set in dt\'s environment and every JVM prints it; Gradle may choke on that: unset it for dt, or set tests.javaToolOptions to "".');
  if (/Could not get unknown property '(\w+)'|Could not resolve all (files|dependencies)|Received status code 401|status code 401|Unauthorized/.test(r.out)) hints.push(`The build needs settings of this machine (a private repository and its credentials): put them in gradle.properties in dt's config folder (or tests.gradleProperties; values may be \${VAR} from .env), or tests.env for environment variables${p.tool === 'maven' ? '; for Maven, maven-settings.xml in the config folder (or tests.mavenSettings)' : ''}.`);
  if (/Could not find a valid Docker environment|DockerClientProviderStrategy|Previous attempts to find a Docker environment failed/.test(r.out)) hints.push(getTests().runnerUrl ? 'Testcontainers found no Docker on the runner: doctor shows its Docker check (the socket mount, DT_DOCKER_GID).' : 'Testcontainers needs Docker: run builds on the runner (compose: the jdk profile starts it with the host\'s Docker socket), or give dt a DOCKER_HOST.');
  if (/Failed to determine a suitable driver class|Connection to .* refused|password authentication failed/.test(r.out)) hints.push('The tests wanted a database: run with db (env + db) so test_run loads the DDL snapshot into a throwaway database.');
  const ok = r.code === 0 && counts.failed === 0 && counts.errors === 0 && !compile.length && counts.tests > 0;
  const outcome = ok ? 'passed' : r.killed ? 'timeout' : compile.length ? 'compile-error' : counts.tests === 0 ? 'no-tests-ran' : 'failed';
  record(id, root, cases, why ? 'build' : 'fast');
  // what the failures ask for, as ready edits (strict stubs, a missing property or bean)
  const suggestions = (() => { try { return require('./javacheck').runHints(id, root, cases); } catch { return []; } })();
  return {
    workspace: id, tool: p.tool, mode: why ? (p.tool === 'gradle' ? 'gradle' : 'build') : 'fast', ...(why && mode !== 'build' && p.tool !== 'gradle' ? { buildBecause: why } : {}), ...(fastInfo ? { fast: fastInfo } : {}),
    written: written.length ? written.map(w => w.path) : undefined, module: p.module,
    command: hide(c ? `${path.basename(c.cmd)} ${c.args.filter(a => !/^-Dmaven\.repo\.local/.test(a)).join(' ')}` : `javac (${fastInfo.compiled ?? 0} changed) + JUnit launcher${fastInfo.prepared ? ' (prepared with Maven first)' : ''}`),
    ...(B.sources.length ? { gradleProperties: B.sources.map(f => path.basename(path.dirname(f)) + '/' + path.basename(f)) } : {}),
    outcome, exit: r.code, ms: r.ms, counts, cases, compile, parts, hints, ...(check ? { check } : {}), ...(suggestions.length ? { suggestions } : {}),
    database: database ? { name: database.database, failedStatements: database.errors } : null,
    tail: hide(require('./testout').compactLog(r.out)),
    history: history(id, cases),
  };
}

const testName = (n) => String(n || '').replace(/\s*\[(\d+)\].*$/, '[$1]').replace(/\([^)]*\)(?=\[|$)/, '');

// ── red first ────────────────────────────────────────────────────────────
// Every result of every test is kept with a fingerprint of the code under test (non-test sources), so a
// patch can say which tests were seen failing before the code changed and passing after: proof that
// they catch the bug.
const runsFile = (id) => path.join(require('./util').CACHE, 'work', `${id}.runs.json`);
function fingerprint(root) {
  const parts = [];
  (function rec(d) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name), rel = path.relative(root, f).split(path.sep).join('/');
      if (e.isDirectory()) { if (!/^(\.git|target|build|node_modules|\.gradle)$/.test(e.name) && !/(^|\/)src\/(test|it)$/.test(rel)) rec(f); }
      else if (/\.(java|kt|groovy|ya?ml|properties|xml|sql)$/.test(e.name)) { const st = fs.statSync(f); parts.push(`${rel}:${st.size}:${Math.round(st.mtimeMs)}`); }
    }
  })(root);
  return require('crypto').createHash('sha1').update(parts.sort().join('\n')).digest('hex').slice(0, 12);
}

function record(id, root, cases, mode) {
  const { readJson, writeJson } = require('./util');
  const runs = readJson(runsFile(id), []);
  const fp = fingerprint(root), at = new Date().toISOString();
  for (const k of cases) runs.push({ test: `${k.class}#${k.name}`, status: k.status, fp, at, mode });
  writeJson(runsFile(id), runs.slice(-2000));
}

// the last results of each test of this run, oldest first: the view's row of dots
function history(id, cases) {
  const runs = require('./util').readJson(runsFile(id), []);
  const want = new Set(cases.map(k => `${k.class}#${k.name}`));
  const out = {};
  for (const r of runs) if (want.has(r.test)) (out[r.test] ||= []).push({ status: r.status, mode: r.mode, at: r.at });
  for (const k of Object.keys(out)) out[k] = out[k].slice(-12);
  return out;
}

// per test: red-green (failed, then passed after the code changed), green-only, still failing
function proof(id) {
  const runs = require('./util').readJson(runsFile(id), []);
  const by = new Map();
  for (const r of runs) (by.get(r.test) || by.set(r.test, []).get(r.test)).push(r);
  const out = [];
  for (const [test, rs] of by) {
    const last = rs[rs.length - 1];
    const red = rs.find(r => r.status === 'failed' || r.status === 'error');
    const greenAfter = red && rs.some(r => r.status === 'passed' && r.at > red.at && r.fp !== red.fp);
    const verdict = last.status !== 'passed' ? 'failing' : greenAfter ? 'red-green' : red ? 'green (failed only while the test itself changed)' : 'green-only';
    out.push({ test, verdict, runs: rs.length, last: last.status, fullBuild: rs.some(r => r.mode === 'build' && r.status === 'passed' && r.at >= (rs.filter(x => x.status !== 'passed').pop()?.at || '')) });
  }
  return out;
}

// a DDL file -> statements: split on ";" at line ends, outside dollar quotes and strings
function splitSql(text) {
  const out = [];
  let cur = '', dollar = null, q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!q && !dollar && ch === '-' && text[i + 1] === '-') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; cur += '\n'; continue; }
    if (!q && ch === '$') { const m = text.slice(i).match(/^\$[\w]*\$/); if (m) { if (!dollar) dollar = m[0]; else if (dollar === m[0]) dollar = null; cur += m[0]; i += m[0].length - 1; continue; } }
    if (!dollar && ch === "'") q = !q;
    if (!q && !dollar && ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

module.exports = { run, envFor, gradleCmd, mavenCmd, findTest, jdkMajor, cleanEnv, proof, testName, fingerprint, plan, parseReports, compileErrors, codeParts, splitSql };
