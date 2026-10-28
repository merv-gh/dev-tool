// Fast test runs for Maven modules: Maven runs once per workspace module to compile everything and
// write the test classpath; after that each run compiles only the changed sources (and the classes
// that use them, from the code graph) with javac and runs the selected tests in one JVM through a small
// JUnit Platform launcher of dt's own, which writes the results as JSON. A full Maven run (mode="build")
// stays the final check. Kotlin and Gradle modules use the build.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CACHE, readJson, writeJson } = require('./util');

const LAUNCHER = `
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.junit.platform.engine.*;
import org.junit.platform.engine.discovery.DiscoverySelectors;
import org.junit.platform.engine.support.descriptor.MethodSource;
import org.junit.platform.launcher.*;
import org.junit.platform.launcher.core.*;

// dt fast runs: runs the selected tests, writes [{class, name, status, ms, message, type, stack}] as JSON
public class DtLauncher {
    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c < 0x20) b.append(String.format("\\\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    public static void main(String[] args) throws Exception {
        List<DiscoverySelector> sel = new ArrayList<>();
        for (int i = 1; i < args.length; i++) {
            String a = args[i];
            sel.add(a.contains("#") ? DiscoverySelectors.selectMethod(a) : DiscoverySelectors.selectClass(a));
        }
        List<String> out = Collections.synchronizedList(new ArrayList<>());
        Map<String, Long> started = new HashMap<>();
        TestExecutionListener l = new TestExecutionListener() {
            String[] where(TestIdentifier id) {
                Optional<TestSource> s = id.getSource();
                if (s.isPresent() && s.get() instanceof MethodSource m) {
                    String name = m.getMethodName() + (id.getUniqueId().contains("-invocation:") ? " " + id.getDisplayName() : "");
                    return new String[] { m.getClassName(), name };
                }
                return new String[] { id.getLegacyReportingName(), id.getDisplayName() };
            }
            public void executionStarted(TestIdentifier id) { started.put(id.getUniqueId(), System.nanoTime()); }
            public void executionSkipped(TestIdentifier id, String reason) {
                if (!id.isTest()) return;
                String[] w = where(id);
                out.add("{\\"class\\":" + q(w[0]) + ",\\"name\\":" + q(w[1]) + ",\\"status\\":\\"skipped\\",\\"ms\\":0,\\"message\\":" + q(reason) + "}");
            }
            public void executionFinished(TestIdentifier id, TestExecutionResult r) {
                Throwable t = r.getThrowable().orElse(null);
                if (!id.isTest() && t == null) return;
                String[] w = where(id);
                long ms = (System.nanoTime() - started.getOrDefault(id.getUniqueId(), System.nanoTime())) / 1000000;
                String status = r.getStatus() == TestExecutionResult.Status.SUCCESSFUL ? "passed" : (t instanceof AssertionError ? "failed" : "error");
                String stack = null;
                if (t != null) { StringWriter sw = new StringWriter(); t.printStackTrace(new PrintWriter(sw)); stack = sw.toString(); }
                out.add("{\\"class\\":" + q(w[0]) + ",\\"name\\":" + q(id.isTest() ? w[1] : "(" + id.getDisplayName() + ")") + ",\\"status\\":" + q(status) + ",\\"ms\\":" + ms
                    + ",\\"message\\":" + q(t == null ? null : String.valueOf(t.getMessage())) + ",\\"type\\":" + q(t == null ? null : t.getClass().getName()) + ",\\"stack\\":" + q(stack) + "}");
            }
        };
        LauncherDiscoveryRequest req = LauncherDiscoveryRequestBuilder.request().selectors(sel).build();
        LauncherFactory.create().execute(req, l);
        Files.writeString(Path.of(args[0]), "[" + String.join(",", out) + "]", StandardCharsets.UTF_8);
        System.exit(0);
    }
}
`;

const stateFile = (id) => path.join(CACHE, 'work', `${id}.fast.json`);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function exec(cmd, args, { cwd, env, timeoutMs = 900000, log } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', killed = false;
    const keep = (b) => { out += b.toString(); if (out.length > 4e6) out = out.slice(-3e6); const last = b.toString().trim().split('\n').pop(); if (last && log) log(last.slice(0, 200)); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    const timer = setTimeout(() => { killed = true; p.kill('SIGTERM'); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: out + `\n${e.message}`, ms: Date.now() - started }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, killed, ms: Date.now() - started }); });
  });
}

// Fast runs fit Maven modules with Java tests
function supported(root, plan, testFiles) {
  if (plan.tool !== 'maven') return 'the build is not Maven';
  if (testFiles.some(f => /\.kt$/.test(f)) || fs.existsSync(path.join(plan.modDir, 'src', 'main', 'kotlin'))) return 'Kotlin sources';
  return null;
}

const walkJava = (dir, out = []) => {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const f = path.join(dir, e.name); if (e.isDirectory()) walkJava(f, out); else if (/\.java$/.test(e.name)) out.push(f); }
  return out;
};
const walkFiles = (dir, out = []) => {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const f = path.join(dir, e.name); if (e.isDirectory()) walkFiles(f, out); else out.push(f); }
  return out;
};

function tails(cfg) {
  return cfg.args.map(a => (a.match(/^-Dmaven\.repo\.local\.tail=(.+)$/) || [])[1]).filter(Boolean).flatMap(x => x.split(','));
}

function findJar(cfg, group, artifact, version) {
  for (const repo of [cfg.mavenRepo, ...tails(cfg)]) {
    const f = path.join(repo, ...group.split('.'), artifact, version, `${artifact}-${version}.jar`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function javaBin(cfg, tool) { return cfg.javaHome ? path.join(cfg.javaHome, 'bin', tool) : tool; }

function mavenArgs(cfg) {
  const a = ['-B', '-ntp', `-Dmaven.repo.local=${cfg.mavenRepo}`];
  if (cfg.offline) a.push('-o');
  if (cfg.mavenSettings) a.push('-s', cfg.mavenSettings);
  return [...a, ...cfg.args];
}

// The JDK release a module compiles for (pom properties), and the javac version
function release(modDir, root) {
  for (const f of [path.join(modDir, 'pom.xml'), path.join(root, 'pom.xml')]) {
    try {
      const t = fs.readFileSync(f, 'utf8');
      const m = t.match(/<maven\.compiler\.release>\s*(\d+)/) || t.match(/<java\.version>\s*(\d+)/) || t.match(/<maven\.compiler\.source>\s*(?:1\.)?(\d+)/);
      if (m) return Number(m[1]);
    } catch {}
  }
  return null;
}

// Maven once: compile main + tests, write the test classpath. Again when a pom changes.
async function prepare({ id, root, plan, cfg, env, mvn, log }) {
  const st = readJson(stateFile(id), {});
  const poms = walkFiles(root).filter(f => /(^|\/)pom\.xml$/.test(f) && !/\/target\//.test(f)).sort();
  const pomHash = hash(poms.map(f => fs.readFileSync(f, 'utf8')).join('\n'));
  const key = plan.module;
  const prev = st[key];
  if (prev && prev.pomHash === pomHash && fs.existsSync(prev.classes) && fs.existsSync(prev.testClasses)) return { state: prev, prepared: false };
  const cpFile = path.join(CACHE, 'work', `${id}.${hash(key)}.classpath`);
  const multi = plan.module !== '.' && fs.existsSync(path.join(root, 'pom.xml'));
  const args = [...mvn.args, ...mavenArgs(cfg), 'test-compile', 'dependency:build-classpath', `-Dmdep.outputFile=${cpFile}`, '-Dmdep.includeScope=test', ...(multi ? ['-pl', plan.module, '-am'] : [])];
  log(`fast: preparing ${key} with Maven (compile + classpath, once)`);
  const r = await exec(mvn.cmd, args, { cwd: multi ? root : plan.modDir, env, log });
  if (r.code !== 0) return { error: r };
  const classpath = fs.readFileSync(cpFile, 'utf8').trim().split(path.delimiter).filter(Boolean);
  const engine = classpath.map(j => path.basename(j).match(/^junit-platform-engine-(.+)\.jar$/)).find(Boolean);
  if (!engine) return { error: { code: 1, out: 'no JUnit Platform on the test classpath (JUnit 4 only?): use mode="build"', ms: r.ms } };
  const v = engine[1];
  let launcherJar = classpath.find(j => /junit-platform-launcher-/.test(path.basename(j))) || findJar(cfg, 'org.junit.platform', 'junit-platform-launcher', v);
  if (!launcherJar) {
    await exec(mvn.cmd, [...mvn.args, ...mavenArgs(cfg), 'dependency:get', `-Dartifact=org.junit.platform:junit-platform-launcher:${v}`, '-Dtransitive=false'], { cwd: plan.modDir, env, log });
    launcherJar = findJar(cfg, 'org.junit.platform', 'junit-platform-launcher', v);
    if (!launcherJar) return { error: { code: 1, out: `could not get org.junit.platform:junit-platform-launcher:${v}`, ms: r.ms } };
  }
  // dt's launcher, compiled once per platform version
  const ldir = path.join(CACHE, 'fastrun', `launcher-${v}`);
  if (!fs.existsSync(path.join(ldir, 'DtLauncher.class'))) {
    fs.mkdirSync(ldir, { recursive: true });
    fs.writeFileSync(path.join(ldir, 'DtLauncher.java'), LAUNCHER);
    const c = await exec(javaBin(cfg, 'javac'), ['-d', ldir, '-cp', [launcherJar, ...classpath].join(path.delimiter), path.join(ldir, 'DtLauncher.java')], { env });
    if (c.code !== 0) return { error: c };
  }
  const javacVersion = await exec(javaBin(cfg, 'javac'), ['-version'], { env }).then(x => Number((x.out.match(/javac (\d+)/) || [])[1] || 0));
  const state = {
    pomHash, classpath, launcherJar, launcherDir: ldir, javacVersion, release: release(plan.modDir, root),
    classes: path.join(plan.modDir, 'target', 'classes'), testClasses: path.join(plan.modDir, 'target', 'test-classes'),
    stamp: Date.now(), preparedMs: r.ms,
  };
  st[key] = state;
  writeJson(stateFile(id), st);
  return { state, prepared: true, ms: r.ms };
}

// Changed since the last compile: sources (plus the classes that use changed main classes) and resources
function changed(modDir, stamp, graph, root) {
  const newer = (f) => fs.statSync(f).mtimeMs > stamp;
  const main = walkJava(path.join(modDir, 'src', 'main', 'java')), test = walkJava(path.join(modDir, 'src', 'test', 'java'));
  const mainChanged = main.filter(newer), testChanged = test.filter(newer);
  // users of changed classes (their signatures may have changed): recompile them too
  if (mainChanged.length && graph) {
    const rel = (f) => path.relative(root, f).split(path.sep).join('/');
    const changedIds = new Set(graph.classes.filter(c => mainChanged.some(f => rel(f) === c.file)).map(c => c.id));
    const users = new Set();
    for (const [from, to] of graph.edges) {
      const cls = String(to).split(/[#]/)[0];
      if (changedIds.has(cls) || changedIds.has(to)) { const c = graph.classes.find(x => from === x.id || String(from).startsWith(`${x.id}#`) || String(from).startsWith(`${x.id}.`)); if (c) users.add(c.file); }
    }
    for (const f of main) if (users.has(rel(f)) && !mainChanged.includes(f)) mainChanged.push(f);
    for (const f of test) if (users.has(rel(f)) && !testChanged.includes(f)) testChanged.push(f);
  }
  const res = (kind) => walkFiles(path.join(modDir, 'src', kind, 'resources')).filter(newer).map(f => ({ from: f, rel: path.relative(path.join(modDir, 'src', kind, 'resources'), f) }));
  return { mainChanged, testChanged, mainRes: res('main'), testRes: res('test') };
}

async function javac(state, files, outDir, extraCp, cfg, env) {
  if (!files.length) return { code: 0, out: '', ms: 0 };
  const args = ['-d', outDir, '-encoding', 'UTF-8', '-parameters', '-g', '-nowarn', '-cp', [...extraCp, ...state.classpath].join(path.delimiter)];
  if (state.release && state.javacVersion && state.release <= state.javacVersion) args.push('--release', String(state.release));
  if (state.javacVersion >= 21) args.push('-proc:full'); // annotation processors (Lombok) are off by default from JDK 23
  return exec(javaBin(cfg, 'javac'), [...args, ...files], { env });
}

// One fast run: compile what changed, run the selected tests; returns { cases, out, code, ms, compiled, prepared }
async function run({ id, root, plan, cfg, env, mvn, selectors, graph, log }) {
  const started = Date.now();
  const p = await prepare({ id, root, plan, cfg, env, mvn, log });
  if (p.error) return { code: p.error.code || 1, out: p.error.out, ms: Date.now() - started, cases: [], phase: 'prepare' };
  const st = p.state;
  const ch = changed(plan.modDir, p.prepared ? Date.now() + 1 : st.stamp, graph, root);
  const stampAt = Date.now();
  let out = '';
  fs.mkdirSync(st.classes, { recursive: true }); fs.mkdirSync(st.testClasses, { recursive: true });
  for (const r of ch.mainRes) { fs.mkdirSync(path.dirname(path.join(st.classes, r.rel)), { recursive: true }); fs.copyFileSync(r.from, path.join(st.classes, r.rel)); }
  for (const r of ch.testRes) { fs.mkdirSync(path.dirname(path.join(st.testClasses, r.rel)), { recursive: true }); fs.copyFileSync(r.from, path.join(st.testClasses, r.rel)); }
  const cm = await javac(st, ch.mainChanged, st.classes, [st.classes], cfg, env);
  out += cm.out;
  if (cm.code !== 0) return { code: cm.code, out, ms: Date.now() - started, cases: [], phase: 'compile', compiled: ch.mainChanged.length };
  const ct = await javac(st, ch.testChanged, st.testClasses, [st.testClasses, st.classes], cfg, env);
  out += ct.out;
  if (ct.code !== 0) return { code: ct.code, out, ms: Date.now() - started, cases: [], phase: 'compile', compiled: ch.mainChanged.length + ch.testChanged.length };
  // compiled: later runs only look at what changes after this point
  const all = readJson(stateFile(id), {});
  if (all[plan.module]) { all[plan.module].stamp = stampAt; writeJson(stateFile(id), all); }
  const results = path.join(CACHE, 'work', `${id}.results-${Date.now().toString(36)}.json`);
  const cp = [st.testClasses, st.classes, ...st.classpath, st.launcherJar, st.launcherDir].join(path.delimiter);
  const r = await exec(javaBin(cfg, 'java'), ['-cp', cp, 'DtLauncher', results, ...selectors], { cwd: plan.modDir, env, timeoutMs: cfg.timeoutMs, log });
  out += r.out;
  let cases = [];
  try { cases = JSON.parse(fs.readFileSync(results, 'utf8')); fs.rmSync(results, { force: true }); } catch {}
  return { code: r.code, out, killed: r.killed, ms: Date.now() - started, cases, compiled: ch.mainChanged.length + ch.testChanged.length, prepared: p.prepared, prepareMs: p.ms };
}

module.exports = { run, supported, prepare, changed, LAUNCHER };
