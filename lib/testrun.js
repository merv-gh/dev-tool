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

function command(root, p, tests, cfg) {
  const javaBin = cfg.javaHome ? [path.join(cfg.javaHome, 'bin')] : [];
  const sel = tests.map(t => t.replace(/\.(java|kt)$/, '').split('/').pop());
  if (p.tool === 'maven') {
    // the wrapper runs through sh: on some mounts the execute bit is lost
    const wrapper = fs.existsSync(path.join(root, 'mvnw')) ? ['sh', ['mvnw']] : null;
    const mvn = wrapper || [cfg.maven || which('mvn', [...javaBin, ...(process.env.MAVEN_HOME ? [path.join(process.env.MAVEN_HOME, 'bin')] : [])]), []];
    if (!mvn[0]) throw new Error('no Maven: the repo has no mvnw, and mvn is not on PATH (set tests.maven in config.json, or run with the compose jdk profile)');
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
    const wrapper = fs.existsSync(path.join(root, 'gradlew')) ? ['sh', ['gradlew']] : null;
    const gr = wrapper || [cfg.gradle || which('gradle', javaBin), []];
    if (!gr[0]) throw new Error('no Gradle: the repo has no gradlew, and gradle is not on PATH (set tests.gradle in config.json)');
    const task = p.module === '.' ? 'test' : `:${p.module.split('/').join(':')}:test`;
    const args = [...gr[1], '--console=plain', task, ...sel.flatMap(t => ['--tests', t.includes('#') ? t.replace('#', '.') : t.includes('.') ? t : `*${t}`])];
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
  for (const m of String(stack || '').matchAll(/at ([\w$.]+)\.([\w$<>]+)\(([\w$]+\.(?:java|kt)):(\d+)\)/g)) {
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

function snippet(root, file, line, around = 4) {
  try {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    const from = Math.max(1, line - around), to = Math.min(lines.length, line + around);
    return { from, to, text: lines.slice(from - 1, to).map((l, i) => `${from + i === line ? '>' : ' '}${String(from + i).padStart(4)}  ${l}`).join('\n') };
  } catch { return null; }
}

function exec(cmd, args, { cwd, env, timeoutMs, log }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', killed = false;
    const keep = (b) => { out += b.toString(); if (out.length > 4e6) out = out.slice(-3e6); const last = b.toString().trim().split('\n').pop(); if (last && log) log(last.slice(0, 200)); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    const timer = setTimeout(() => { killed = true; p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: out + `\n${e.message}`, ms: Date.now() - started }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, killed, ms: Date.now() - started }); });
  });
}

// tests: class names (FooTest), Class#method, or test file paths. db: { env, db, tables, service } -> throwaway database
async function run(id, { tests = [], db, log = () => {} } = {}) {
  const m = W.checkId(id);
  const root = m.path;
  const idx = W.index(id);
  const g = idx.graph_();
  if (!tests.length) throw new Error('name the tests to run (class names like FooTest, or Class#method)');
  const files = tests.map(t => {
    const cls = t.split('#')[0].replace(/\.(java|kt)$/, '').split('/').pop();
    const c = g.classes.find(x => x.test && (x.name === cls || x.id === cls));
    return c ? c.file : /\//.test(t) ? t : null;
  });
  const missing = tests.filter((t, i) => !files[i]);
  if (missing.length) throw new Error(`no test class ${missing.join(', ')} in ${id} (write it with workspace_write first)`);
  const p = plan(root, files);
  const cfg = getTests();
  const c = command(root, p, tests, cfg);
  const env = { ...process.env, MAVEN_OPTS: process.env.MAVEN_OPTS || '-Xmx1g', CI: 'true' };
  if (cfg.javaHome) { env.JAVA_HOME = cfg.javaHome; env.PATH = `${path.join(cfg.javaHome, 'bin')}${path.delimiter}${env.PATH}`; }
  if (cfg.gradleHome) env.GRADLE_USER_HOME = cfg.gradleHome;
  // a JDK newer than the project's Mockito/Byte Buddy: let Byte Buddy try anyway (forked test JVMs read it)
  if (cfg.javaToolOptions) env.JAVA_TOOL_OPTIONS = [process.env.JAVA_TOOL_OPTIONS, cfg.javaToolOptions].filter(Boolean).join(' ');
  let database = null;
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (db) {
    const opts = { tables: db.tables, service: db.service, functions: db.functions };
    let statements;
    if (db.ddlPath) statements = splitSql(fs.readFileSync(W.resolvePath(m, db.ddlPath).full, 'utf8'));
    else statements = require('./ddl').snapshot(db.env, db.db, opts).statements;
    log(`test db: loading ${statements.length} statements`);
    database = await require('./testdb').create(runId, statements);
    if (database.errors.length) log(`test db: ${database.errors.length} statements failed`);
    Object.assign(env, { SPRING_DATASOURCE_URL: database.jdbcUrl, SPRING_DATASOURCE_USERNAME: database.user, SPRING_DATASOURCE_PASSWORD: database.password, SPRING_JPA_HIBERNATE_DDL_AUTO: 'none', SPRING_SQL_INIT_MODE: 'never', SPRING_FLYWAY_ENABLED: 'false', SPRING_LIQUIBASE_ENABLED: 'false' });
  }
  // reports of this run only
  const reportDirs = [path.join(p.modDir, 'target', 'surefire-reports'), path.join(p.modDir, 'build', 'test-results', 'test')];
  for (const d of reportDirs) fs.rmSync(d, { recursive: true, force: true });
  const started = Date.now();
  log(`${p.tool}: ${path.basename(c.cmd)} ${c.args.filter(a => !/^-Dmaven\.repo\.local|^-s$/.test(a)).join(' ')}`);
  const r = await exec(c.cmd, c.args, { cwd: c.cwd, env, timeoutMs: cfg.timeoutMs, log });
  if (database) { try { await require('./testdb').drop(database.database); } catch (e) { log(`test db: drop failed: ${e.message}`); } }
  const cases = parseReports(reportDirs, started);
  const compile = cases.length ? [] : compileErrors(r.out, root);
  for (const k of cases) if (k.status === 'failed' || k.status === 'error') k.parts = codeParts(root, g, k.stack);
  const counts = { tests: cases.length, passed: cases.filter(k => k.status === 'passed').length, failed: cases.filter(k => k.status === 'failed').length, errors: cases.filter(k => k.status === 'error').length, skipped: cases.filter(k => k.status === 'skipped').length };
  const parts = [];
  for (const e of compile) parts.push({ file: e.file, line: e.line, why: `compile: ${e.message}`, snippet: snippet(root, e.file, e.line) });
  for (const k of cases) for (const pt of k.parts || []) if (!parts.some(x => x.file === pt.file && x.line === pt.line)) parts.push({ file: pt.file, line: pt.line, method: pt.method, test: pt.test, why: `${k.class.split('.').pop()}.${k.name}: ${((k.message || k.type || '').split('\n').find(l => l.trim()) || '').trim().slice(0, 200)}`, snippet: pt.snippet });
  const hints = [];
  if (/Mockito cannot mock this class|Java \d+ \(\d+\) is not supported by the current version of Byte Buddy/.test(r.out + cases.map(k => k.message).join('\n'))) hints.push('Mockito/Byte Buddy of this project does not support the JDK the tests ran on: point tests.javaHome at the JDK the project builds with (17 or 21), or keep tests.javaToolOptions = "-Dnet.bytebuddy.experimental=true".');
  if (/Failed to determine a suitable driver class|Connection to .* refused|password authentication failed/.test(r.out)) hints.push('The tests wanted a database: run with db (env + db) so test_run loads the DDL snapshot into a throwaway database.');
  const ok = r.code === 0 && counts.failed === 0 && counts.errors === 0 && !compile.length && counts.tests > 0;
  const outcome = ok ? 'passed' : r.killed ? 'timeout' : compile.length ? 'compile-error' : counts.tests === 0 ? 'no-tests-ran' : 'failed';
  return {
    workspace: id, tool: p.tool, module: p.module, command: `${path.basename(c.cmd)} ${c.args.filter(a => !/^-Dmaven\.repo\.local/.test(a)).join(' ')}`,
    outcome, exit: r.code, ms: r.ms, counts, cases, compile, parts, hints,
    database: database ? { name: database.database, failedStatements: database.errors } : null,
    tail: r.out.split('\n').filter(l => l.trim()).slice(-60).join('\n'),
  };
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

module.exports = { run, plan, parseReports, compileErrors, codeParts, splitSql };
