// Compile checks right after an edit, and the fixes that come with them.
//   A warm compiler: dt's own small Java program, one per JDK, kept running; it compiles through the JDK's
//   compiler API (javax.tools), in memory, and answers structured diagnostics (code, file, line, message)
//   in about a tenth of a second instead of a new javac's second or two. On the runner when there is one.
//   The classpath: the one the fast run prepares per workspace module (Maven), or Gradle's through a small
//   init script; prepared in the background when a workspace is opened.
//   Fixes: missing types from a class index (the workspace, its libraries, the classpath's jars), static
//   imports of test helpers, throws Exception, Boot-version annotations, javax -> jakarta. One candidate:
//   applied at once; more: offered as ready edits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const COMPILER = `
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.tools.*;

// dt compile checks: one request per line on stdin ("id\\toptions\\u0001...\\tfiles\\u0001..."),
// one JSON answer per line on stdout. File managers are kept per classpath (their jars stay open).
public class DtCompiler {
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
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(new PrintStream(OutputStream.nullOutputStream()));
        if (javac == null) { out.println("{\\"fatal\\":\\"no compiler: this is a JRE, not a JDK\\"}"); return; }
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        Map<String, StandardJavaFileManager> managers = new LinkedHashMap<>(8, 0.75f, true);
        String line;
        while ((line = in.readLine()) != null) {
            String[] p = line.split("\\t", -1);
            String id = p[0];
            List<String> opts = p[1].isEmpty() ? List.of() : Arrays.asList(p[1].split("\\u0001"));
            List<String> files = Arrays.asList(p[2].split("\\u0001"));
            long t0 = System.nanoTime();
            StringBuilder b = new StringBuilder();
            try {
                String key = String.valueOf(opts.indexOf("-cp") >= 0 ? opts.get(opts.indexOf("-cp") + 1).hashCode() : 0);
                StandardJavaFileManager fm = managers.get(key);
                if (fm == null) {
                    fm = javac.getStandardFileManager(null, Locale.ROOT, StandardCharsets.UTF_8);
                    managers.put(key, fm);
                    if (managers.size() > 4) { String old = managers.keySet().iterator().next(); managers.remove(old).close(); }
                }
                DiagnosticCollector<JavaFileObject> dc = new DiagnosticCollector<>();
                boolean ok = javac.getTask(new StringWriter(), fm, dc, opts, null, fm.getJavaFileObjectsFromStrings(files)).call();
                List<String> ds = new ArrayList<>();
                for (Diagnostic<? extends JavaFileObject> d : dc.getDiagnostics()) {
                    if (d.getKind() != Diagnostic.Kind.ERROR && d.getKind() != Diagnostic.Kind.WARNING) continue;
                    ds.add("{\\"kind\\":" + q(d.getKind().name()) + ",\\"code\\":" + q(d.getCode()) + ",\\"file\\":" + q(d.getSource() == null ? null : d.getSource().getName())
                        + ",\\"line\\":" + d.getLineNumber() + ",\\"col\\":" + d.getColumnNumber() + ",\\"message\\":" + q(d.getMessage(Locale.ROOT)) + "}");
                }
                b.append("{\\"id\\":").append(q(id)).append(",\\"ok\\":").append(ok).append(",\\"ms\\":").append((System.nanoTime() - t0) / 1000000).append(",\\"diagnostics\\":[").append(String.join(",", ds)).append("]}");
            } catch (Throwable e) {
                b.setLength(0);
                b.append("{\\"id\\":").append(q(id)).append(",\\"ok\\":false,\\"error\\":").append(q(String.valueOf(e))).append("}");
            }
            out.println(b);
        }
    }
}
`;

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// ── the warm compiler, here (dt without a runner, or the runner itself) ──
const daemons = new Map(); // javaHome -> { proc, waiting: Map(id -> resolve), buf }
function javaBin(javaHome, t) { return javaHome ? path.join(javaHome, 'bin', t) : t; }

async function compilerDir(javaHome) {
  const { PATHS } = require('./config');
  const dir = path.join(PATHS.build, 'javacheck', `compiler-${hash(COMPILER)}-${hash(javaHome || 'PATH')}`);
  if (fs.existsSync(path.join(dir, 'DtCompiler.class'))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'DtCompiler.java'), COMPILER);
  await new Promise((resolve, reject) => {
    const p = spawn(javaBin(javaHome, 'javac'), ['-d', dir, path.join(dir, 'DtCompiler.java')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, JAVA_TOOL_OPTIONS: '' } });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`compiling dt's compiler failed: ${err.slice(0, 300)}`))));
  });
  return dir;
}

async function daemon(javaHome) {
  const key = javaHome || 'PATH';
  const d = daemons.get(key);
  if (d && d.proc.exitCode === null) return d;
  const dir = await compilerDir(javaHome);
  const proc = spawn(javaBin(javaHome, 'java'), ['-Xss4m', '-XX:+UseSerialGC', '-Xshare:auto', '-cp', dir, 'DtCompiler'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JAVA_TOOL_OPTIONS: '' } });
  const nd = { proc, waiting: new Map(), buf: '' };
  // a kept JVM does not keep dt (or a test) alive: held only while a check waits for its answer
  proc.unref(); proc.stdin.unref?.(); proc.stderr.unref?.(); proc.stdout.unref?.();
  nd.hold = (on) => { if (on) proc.stdout.ref?.(); else if (!nd.waiting.size) proc.stdout.unref?.(); };
  proc.stdout.on('data', (c) => {
    nd.buf += c;
    let i;
    while ((i = nd.buf.indexOf('\n')) >= 0) {
      const line = nd.buf.slice(0, i); nd.buf = nd.buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.fatal) { for (const [, w] of nd.waiting) w(m); nd.waiting.clear(); continue; }
      const w = nd.waiting.get(m.id);
      if (w) { nd.waiting.delete(m.id); nd.hold(false); w(m); }
    }
  });
  proc.on('exit', () => { for (const [, w] of nd.waiting) w({ ok: false, error: 'the compiler stopped' }); nd.waiting.clear(); });
  proc.stdin.on('error', () => {});
  daemons.set(key, nd);
  return nd;
}

// One check: { ok, ms, diagnostics: [{ kind, code, file, line, col, message }] }
async function compileHere({ javaHome, options, files, timeoutMs = 120000 }) {
  const d = await daemon(javaHome);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { d.waiting.delete(id); d.hold(false); try { d.proc.kill(); } catch {} resolve({ ok: false, error: `compile check took over ${timeoutMs} ms` }); }, timeoutMs);
    d.waiting.set(id, (m) => { clearTimeout(timer); resolve(m); });
    d.hold(true);
    d.proc.stdin.write(`${id}\t${options.join('\u0001')}\t${files.join('\u0001')}\n`);
  });
}

// From dt: on the runner when there is one
async function compile(req) {
  const t = require('./config').getTests();
  if (t.runnerUrl) {
    try {
      const res = await fetch(`${t.runnerUrl}/compile`, { method: 'POST', headers: { authorization: `Bearer ${t.runnerToken || ''}`, 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(180000) });
      if (res.ok) return res.json();
      if (res.status !== 404) return { ok: false, error: `runner: HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    } catch (e) { if (!/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(`${e.cause?.code} ${e.message}`)) return { ok: false, error: `runner: ${e.message}` }; }
  }
  return compileHere(req);
}

// ── the class index: simple name -> full names, from the workspace, its libraries and the classpath's jars ──
// A zip's central directory, read directly (no unzip): the entry names
function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 66000));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return [];
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const names = [];
    for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
    }
    return names;
  } catch { return []; } finally { fs.closeSync(fd); }
}

const SKIP_PKG = /(^|\.)(internal|impl|shaded|shade|repackaged|jdk\.internal|sun|com\.sun)(\.|$)|^META-INF|^module-info$/;
function jarIndex(classpath) {
  const { PATHS } = require('./config');
  const fingerprint = classpath.map(p => { try { const st = fs.statSync(p); return [p, st.size, st.mtimeMs, st.ctimeMs]; } catch { return [p, null]; } });
  const file = path.join(PATHS.build, 'javacheck', `classes-${hash(JSON.stringify(fingerprint))}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const idx = {};
  for (const entry of classpath) {
    let names = [];
    try {
      if (/\.jar$/.test(entry) && fs.existsSync(entry)) names = zipEntries(entry);
      else if (fs.existsSync(entry) && fs.statSync(entry).isDirectory()) continue; // compiled classes of the project: the code graph has them
    } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.class') || n.includes('$') || n.startsWith('META-INF/')) continue;
      const fqn = n.slice(0, -6).replace(/\//g, '.').replace(/^BOOT-INF\.classes\./, '');
      if (SKIP_PKG.test(fqn)) continue;
      const simple = fqn.split('.').pop();
      (idx[simple] ||= []).push(fqn);
    }
  }
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(idx)); } catch {}
  return idx;
}

// The JDK's own classes people import (java.time.Instant, java.util.List...): a short table, not the module image
const JDK = Object.fromEntries(['java.util.List', 'java.util.ArrayList', 'java.util.Map', 'java.util.HashMap', 'java.util.Set', 'java.util.HashSet', 'java.util.Optional', 'java.util.UUID', 'java.util.Collection', 'java.util.Collections', 'java.util.Arrays', 'java.util.Objects', 'java.util.Comparator', 'java.util.LinkedHashMap', 'java.util.stream.Collectors', 'java.util.stream.Stream', 'java.util.stream.IntStream', 'java.util.function.Function', 'java.util.function.Supplier', 'java.util.function.Consumer', 'java.util.function.Predicate', 'java.util.concurrent.TimeUnit', 'java.util.concurrent.CompletableFuture', 'java.math.BigDecimal', 'java.math.BigInteger', 'java.math.RoundingMode', 'java.time.Instant', 'java.time.LocalDate', 'java.time.LocalDateTime', 'java.time.OffsetDateTime', 'java.time.ZonedDateTime', 'java.time.Duration', 'java.time.ZoneOffset', 'java.time.Clock', 'java.nio.charset.StandardCharsets', 'java.nio.file.Files', 'java.nio.file.Path', 'java.io.IOException', 'java.io.UncheckedIOException', 'java.sql.Connection', 'java.sql.Timestamp', 'java.sql.DriverManager', 'java.sql.ResultSet', 'java.sql.SQLException'].map(f => [f.split('.').pop(), [f]]));

// Static imports of test helpers: name -> the class it comes from (the first that is on the classpath)
const STATIC = {
  assertThat: ['org.assertj.core.api.Assertions', 'org.hamcrest.MatcherAssert'], assertThatThrownBy: ['org.assertj.core.api.Assertions'], assertThatCode: ['org.assertj.core.api.Assertions'], assertThatExceptionOfType: ['org.assertj.core.api.Assertions'], within: ['org.assertj.core.api.Assertions'], tuple: ['org.assertj.core.api.Assertions'],
  assertEquals: ['org.junit.jupiter.api.Assertions', 'org.junit.Assert'], assertTrue: ['org.junit.jupiter.api.Assertions', 'org.junit.Assert'], assertFalse: ['org.junit.jupiter.api.Assertions', 'org.junit.Assert'], assertNull: ['org.junit.jupiter.api.Assertions', 'org.junit.Assert'], assertNotNull: ['org.junit.jupiter.api.Assertions', 'org.junit.Assert'], assertThrows: ['org.junit.jupiter.api.Assertions'], assertAll: ['org.junit.jupiter.api.Assertions'], fail: ['org.junit.jupiter.api.Assertions'],
  when: ['org.mockito.Mockito'], verify: ['org.mockito.Mockito'], mock: ['org.mockito.Mockito'], spy: ['org.mockito.Mockito'], times: ['org.mockito.Mockito'], never: ['org.mockito.Mockito'], atLeastOnce: ['org.mockito.Mockito'], doThrow: ['org.mockito.Mockito'], doReturn: ['org.mockito.Mockito'], doNothing: ['org.mockito.Mockito'], doAnswer: ['org.mockito.Mockito'], lenient: ['org.mockito.Mockito'], reset: ['org.mockito.Mockito'], verifyNoInteractions: ['org.mockito.Mockito'], verifyNoMoreInteractions: ['org.mockito.Mockito'], inOrder: ['org.mockito.Mockito'],
  any: ['org.mockito.ArgumentMatchers'], eq: ['org.mockito.ArgumentMatchers'], anyString: ['org.mockito.ArgumentMatchers'], anyLong: ['org.mockito.ArgumentMatchers'], anyInt: ['org.mockito.ArgumentMatchers'], anyList: ['org.mockito.ArgumentMatchers'], anyMap: ['org.mockito.ArgumentMatchers'], argThat: ['org.mockito.ArgumentMatchers'], isNull: ['org.mockito.ArgumentMatchers'], contains: ['org.mockito.ArgumentMatchers'], startsWith: ['org.mockito.ArgumentMatchers'],
  get: ['org.springframework.test.web.servlet.request.MockMvcRequestBuilders'], post: ['org.springframework.test.web.servlet.request.MockMvcRequestBuilders'], put: ['org.springframework.test.web.servlet.request.MockMvcRequestBuilders'], delete: ['org.springframework.test.web.servlet.request.MockMvcRequestBuilders'], patch: ['org.springframework.test.web.servlet.request.MockMvcRequestBuilders'],
  status: ['org.springframework.test.web.servlet.result.MockMvcResultMatchers'], jsonPath: ['org.springframework.test.web.servlet.result.MockMvcResultMatchers'], content: ['org.springframework.test.web.servlet.result.MockMvcResultMatchers'], header: ['org.springframework.test.web.servlet.result.MockMvcResultMatchers'], print: ['org.springframework.test.web.servlet.result.MockMvcResultHandlers'],
};


// Ranking helps a caller choose; it is not evidence that two same-named types
// are interchangeable. Internal prefixes must end at a package boundary.
const inOwn = (f, own) => own.some(p => f.startsWith(`${p.replace(/\.+$/, '')}.`));
const tier = (f, own) => (inOwn(f, own) ? 0 : /^java\./.test(f) ? 1 : /^(jakarta|javax)\./.test(f) ? 2 : /^(org\.springframework|org\.junit|org\.mockito|org\.assertj|org\.testcontainers|com\.fasterxml\.jackson|org\.hamcrest)\./.test(f) ? 3 : 4);
function importAffinity(f, text) {
  const pkg = f.slice(0, f.lastIndexOf('.'));
  const current = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
  if (pkg === current) return 2;
  return [...text.matchAll(/^\s*import\s+(?!static\s)([\w.]+)\.(?:\w+|\*)\s*;/gm)].some(m => m[1] === pkg) ? 1 : 0;
}
function rank(fqns, own = [], text = '') {
  return [...new Set(fqns)].sort((a, b) => tier(a, own) - tier(b, own) || importAffinity(b, text) - importAffinity(a, text) || a.localeCompare(b));
}
function importReason(f, own, text) {
  const reasons = [];
  if (inOwn(f, own)) reasons.push('project or configured internal package');
  const affinity = importAffinity(f, text);
  if (affinity) reasons.push(affinity === 2 ? 'same package as this file' : 'package already imported by this file');
  if (/^java\./.test(f)) reasons.push('JDK');
  return reasons.join('; ') || 'available on the module classpath';
}
// A unique available class can be fixed mechanically. Multiple classes always
// need a choice, even when one is internal, shorter, or from a popular library.
function pick(fqns, own = [], text = '') {
  const r = rank(fqns, own, text);
  return r.length === 1 ? r[0] : null;
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const similar = (name, names, max = 5) => names.filter(n => n !== name && (n.toLowerCase() === name.toLowerCase() || (n[0] === name[0] && lev(n, name) <= 2))).slice(0, max);

// ── fixes ──
// An import, put before the first import (or after the package line): a find that matches once
function importEdit(text, fqn, isStatic) {
  const line = `import ${isStatic ? 'static ' : ''}${fqn};`;
  if (new RegExp(`^\\s*${line.replace(/[.*]/g, '\\$&')}`, 'm').test(text)) return null;
  const first = text.match(/^import\s[^\n]+$/m);
  if (first && text.split(first[0]).length === 2) return { find: first[0], replace: `${line}\n${first[0]}` };
  const pkg = text.match(/^package\s[^\n]+$/m);
  if (pkg) return { find: pkg[0], replace: `${pkg[0]}\n\n${line}` };
  return { find: text.split('\n')[0], replace: `${line}\n${text.split('\n')[0]}` };
}

const symbolOf = (msg) => {
  const m = String(msg).match(/symbol:\s+(class|variable|method|interface)\s+([\w$]+)(?:\(([^)]*)\))?/);
  const loc = String(msg).match(/location:\s+(?:(class|interface|variable)\s+([\w.$<>]+)(?:\s+of type\s+([\w.$<>]+))?)/);
  return m ? { kind: m[1], name: m[2], args: m[3], location: loc ? { kind: loc[1], name: loc[2], type: loc[3] } : null } : null;
};

// The method a line is in: the nearest header above it
function enclosing(text, line) {
  const lines = text.split('\n');
  for (let i = line - 1; i >= 0; i--) {
    const l = lines[i];
    const m = l.match(/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|synchronized|default)\s+)*(?:<[^>]+>\s+)?[\w.<>[\],?\s]+?\s+(\w+)\s*\([^;{}]*\)\s*(throws\s+[\w.,\s]+)?\{\s*$/);
    if (m && !/^\s*(if|for|while|switch|catch|return|new|else)\b/.test(l)) return { line: i + 1, name: m[1], head: l, throws: !!m[2] };
    if (/^\s*(public|protected|private)?\s*(final\s+)?(class|interface|record|enum)\s/.test(l)) return null;
  }
  return null;
}

// Diagnostics of one file -> { text (with the fixes that are clear), fixed: [why], suggestions: [{ line, why, edits | options }] }
function fixesFor(text, diags, { index, known, own, graph }) {
  const fixed = [], suggestions = [];
  const seen = new Set();
  const apply = (e, why) => { if (!e || text.split(e.find).length !== 2) return false; text = text.replace(e.find, () => e.replace); fixed.push(why); return true; };
  const classes = (name) => [...(index[name] || []), ...(JDK[name] || [])];
  const declared = new Set([...text.matchAll(/\b(?:class|interface|record|enum)\s+(\w+)/g)].map(m => m[1]));
  for (const d of diags) {
    if (d.kind !== 'ERROR') continue;
    const sym = symbolOf(d.message);
    const code = d.code || '';
    if (/cant\.resolve/.test(code) && sym) {
      // a type: Foo x, new Foo(), Foo.bar() ("variable Foo"), @Foo
      const asType = sym.kind === 'class' || sym.kind === 'interface' || (sym.kind === 'variable' && /^[A-Z]/.test(sym.name) && !/^[A-Z0-9_]+$/.test(sym.name));
      const key = `${asType ? 'type' : sym.kind}:${sym.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (asType) {
        // Spring Boot decides: @MockBean/@SpyBean (up to 3.x) or @MockitoBean/@MockitoSpyBean (3.4+, the only ones in 4)
        const swap = { MockBean: ['MockitoBean', 'org.springframework.test.context.bean.override.mockito.MockitoBean'], SpyBean: ['MockitoSpyBean', 'org.springframework.test.context.bean.override.mockito.MockitoSpyBean'], MockitoBean: ['MockBean', 'org.springframework.boot.test.mock.mockito.MockBean'], MockitoSpyBean: ['SpyBean', 'org.springframework.boot.test.mock.mockito.SpyBean'] }[sym.name];
        if (swap && !classes(sym.name).length && known.has(swap[1])) {
          const before = text;
          text = text.replace(new RegExp(`@${sym.name}\\b`, 'g'), `@${swap[0]}`).replace(new RegExp(`^import\\s+[\\w.]+\\.${sym.name};\\n`, 'm'), '');
          if (text !== before) { fixed.push(`@${sym.name} -> @${swap[0]} (this Spring Boot has only that one)`); apply(importEdit(text, swap[1], false), `import ${swap[1]}`); }
          continue;
        }
        // An explicit import records intent. Its package error is handled below;
        // adding another same-named import can silently select a different API.
        if ([...text.matchAll(/^\s*import\s+(?!static\s)([\w.]+)\s*;/gm)].some(m => m[1].endsWith(`.${sym.name}`))) continue;
        const cands = classes(sym.name);
        const one = pick(cands, own, text);
        if (one) { apply(importEdit(text, one, false), `import ${one} (${sym.name}, line ${d.line})`); continue; }
        if (cands.length) { suggestions.push({ line: d.line, why: `${sym.name} is in ${new Set(cands).size} packages: import the one meant`, options: rank(cands, own, text).slice(0, 6).map(f => ({ import: f, reason: importReason(f, own, text), edits: [importEdit(text, f, false)].filter(Boolean) })) }); continue; }
        const near = similar(sym.name, Object.keys(index));
        suggestions.push({ line: d.line, why: `no class ${sym.name} in the code or on the classpath${near.length ? `: did you mean ${near.join(', ')}?` : ' (a typo, or a dependency this module lacks)'}` });
        continue;
      }
      // a method or field of this class that is not there: a static import of a test helper?
      const here = !sym.location || (sym.location.kind !== 'variable' && declared.has(String(sym.location.name).split('.').pop().replace(/<.*/, '')));
      if (here && STATIC[sym.name]) {
        const available = STATIC[sym.name].filter(c => known.has(c));
        const from = pick(available, own, text);
        if (from) { apply(importEdit(text, `${from}.${sym.name}`, true), `import static ${from}.${sym.name} (line ${d.line})`); continue; }
        if (available.length) {
          suggestions.push({ line: d.line, why: `${sym.name} is provided by several test libraries: choose a static import`, options: rank(available, own, text).map(f => ({ import: `${f}.${sym.name}`, reason: importReason(f, own, text), edits: [importEdit(text, `${f}.${sym.name}`, true)].filter(Boolean) })) });
          continue;
        }
      }
      // a method of another class: what that class has (from the code graph)
      const owner = sym.location?.type || (sym.location?.kind !== 'variable' ? sym.location?.name : null);
      const cls = owner && graph ? graph.classes.find(c => c.id === owner || c.name === String(owner).split('.').pop().replace(/<.*/, '')) : null;
      if (cls) {
        const names = [...new Set((cls.methods || []).filter(m => !m.ctor).map(m => m.name))];
        const near = similar(sym.name, names);
        const same = (cls.methods || []).filter(m => m.name === sym.name);
        suggestions.push({ line: d.line, why: same.length ? `${cls.name}.${sym.name} takes (${same.map(m => (m.params || []).map(p => p.type).join(', ')).join(') or (')})` : `${cls.name} has no ${sym.name}${near.length ? `: ${near.join(', ')}?` : ''} (it has ${names.slice(0, 12).join(', ')})` });
      }
      continue;
    }
    // import a.b.Foo; where a.b is not there: Foo from where it is (javax -> jakarta among them)
    if (/doesnt\.exist/.test(code)) {
      const line = text.split('\n')[d.line - 1] || '';
      const im = line.match(/^\s*import\s+(static\s+)?([\w.]+)\.(\w+|\*)\s*;/);
      if (!im || seen.has(line)) continue;
      seen.add(line);
      const pkg = im[2];
      if (im[3] === '*') {
        const jk = pkg.replace(/^javax\./, 'jakarta.');
        if (jk !== pkg && [...known].some(c => c.startsWith(`${jk}.`))) apply({ find: line, replace: line.replace(pkg, jk) }, `${pkg} -> ${jk} (line ${d.line})`);
        continue;
      }
      if (im[1]) continue;
      const cands = classes(im[3]).filter(f => f !== `${pkg}.${im[3]}`);
      const jk = `${pkg.replace(/^javax\./, 'jakarta.')}.${im[3]}`;
      const one = pkg.startsWith('javax.') && cands.includes(jk) ? jk : null;
      if (one) apply({ find: line, replace: line.replace(`${pkg}.${im[3]}`, one) }, `import ${one} instead of ${pkg}.${im[3]} (line ${d.line})`);
      else if (cands.length) suggestions.push({ line: d.line, why: `no package ${pkg}: ${im[3]} is in ${rank(cands, own, text).slice(0, 4).join(', ')}`, options: rank(cands, own, text).slice(0, 6).map(f => ({ import: f, reason: importReason(f, own, text), edits: [{ find: line, replace: line.replace(`${pkg}.${im[3]}`, f) }] })) });
      else suggestions.push({ line: d.line, why: `no package ${pkg} on the classpath (a dependency this module lacks?)` });
      continue;
    }
    // any() / null fits several overloads
    if (/ref\.ambiguous/.test(code)) {
      if (!seen.has(`amb:${d.line}`)) { seen.add(`amb:${d.line}`); suggestions.push({ line: d.line, why: `${short(d.message)}: give the type, any(Type.class) or (Type) null` }); }
      continue;
    }
    // a checked exception: tests declare throws Exception
    if (/unreported\.exception/.test(code)) {
      const m = enclosing(text, d.line);
      if (!m || m.throws || seen.has(`throws:${m.line}`)) continue;
      seen.add(`throws:${m.line}`);
      const edit = { find: m.head, replace: m.head.replace(/\)\s*\{\s*$/, ') throws Exception {') };
      const ex = (d.message.match(/exception ([\w.$]+)/) || [])[1] || 'a checked exception';
      const isTest = /(^|\n)\s*@(Test|ParameterizedTest|BeforeEach|AfterEach|BeforeAll|AfterAll|RepeatedTest)\b/.test(text.split('\n').slice(Math.max(0, m.line - 4), m.line).join('\n'));
      if (isTest) apply(edit, `${m.name}() throws Exception (${ex.split('.').pop()} at line ${d.line})`);
      else suggestions.push({ line: m.line, why: `${ex} is thrown in ${m.name}: declare it, or catch it`, edits: [edit] });
    }
  }
  return { text, fixed, suggestions };
}

// ── the classpath of a workspace module ──
const GRADLE_INIT = `
allprojects {
  tasks.register('dtClasspath') {
    def ss = project.extensions.findByName('sourceSets')
    def jx = project.extensions.findByName('java')
    def out = project.findProperty('dtOut')
    doLast {
      def files = { c -> c == null ? [] : c.files.collect { it.absolutePath } }
      def t = ss?.findByName('test'), m = ss?.findByName('main')
      def rel = null
      try { rel = jx?.toolchain?.languageVersion?.getOrNull()?.asInt() } catch (ignored) {}
      if (rel == null) try { rel = jx?.targetCompatibility?.majorVersion } catch (ignored) {}
      // modules this one depends on (project(':core')): their sources, as they may not be compiled yet
      def seen = [] as LinkedHashSet
      def walk
      walk = { p ->
        ['compileClasspath', 'testCompileClasspath'].each { cn ->
          def c = p.configurations.findByName(cn)
          if (c == null) return
          c.allDependencies.withType(org.gradle.api.artifacts.ProjectDependency).each { d ->
            def path = null
            try { path = d.path } catch (ignored) { try { path = d.dependencyProject.path } catch (ignored2) {} }
            if (path != null && path != p.path && seen.add(path)) walk(p.project(path))
          }
        }
      }
      walk(project)
      def deps = seen.collectMany { pp -> project.project(pp).extensions.findByName('sourceSets')?.findByName('main')?.java?.srcDirs ?: [] }
      new File(out).text = groovy.json.JsonOutput.toJson([
        classpath: files(t?.compileClasspath),
        processorpath: (files(t?.annotationProcessorPath) + files(m?.annotationProcessorPath)).unique(),
        sources: ((m?.java?.srcDirs ?: []) + (t?.java?.srcDirs ?: []) + deps).collect { it.absolutePath },
        release: rel == null ? null : rel.toString(),
      ])
    }
  }
}
`;

const { CACHE } = require('./util');
const stateFile = (id) => path.join(CACHE, 'work', `${id}.check.json`);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function buildHash(root) {
  const files = [];
  (function rec(d, depth) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) { if (depth < 6 && !/^(\.|build$|target$|node_modules$|src$|out$)/.test(e.name)) rec(path.join(d, e.name), depth + 1); continue; }
      if (/^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|libs\.versions\.toml)$/.test(e.name)) files.push(path.join(d, e.name));
    }
  })(root, 0);
  return hash(files.sort().map(f => `${f}\n${fs.readFileSync(f, 'utf8')}`).join('\n'));
}

async function gradleClasspath(root, p, cfg, env, B) {
  const TR = require('./testrun');
  const dir = path.join(root, '.dt');
  fs.mkdirSync(dir, { recursive: true });
  const init = path.join(dir, 'dt-classpath.gradle');
  fs.writeFileSync(init, GRADLE_INIT);
  const out = path.join(dir, `check-${hash(p.module)}.json`);
  fs.rmSync(out, { force: true });
  const gr = TR.gradleCmd(root, cfg);
  const task = p.module === '.' ? 'dtClasspath' : `:${p.module.split('/').join(':')}:dtClasspath`;
  const args = [...gr[1], '--console=plain', '-q', '--warning-mode=none', '--no-watch-fs', '--no-configuration-cache', ...B.args, '--init-script', init, task, `-PdtOut=${out}`, ...(cfg.offline ? ['--offline'] : []), ...cfg.args];
  const r = await require('./trace').step('gradle classpath', () => require('./fastrun').exec(gr[0], args, { cwd: root, env, timeoutMs: 600000 }), p.module);
  if (r.code !== 0 || !fs.existsSync(out)) return { error: `Gradle could not give the classpath: ${require('./testout').compactLog(r.out).slice(-1500)}` };
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  return { classpath: j.classpath || [], processorpath: j.processorpath || [], sources: (j.sources || []).filter(d => fs.existsSync(d)), release: j.release ? Number(j.release) : null };
}

// Maven: a fast run's prepare when there is one; else the test classpath without compiling the tests (a test
// just written may not compile yet: that is what the check is for), main code compiled where it compiles
async function mavenClasspath(id, root, p, cfg, env) {
  const sources = ['main', 'test'].map(k => path.join(p.modDir, 'src', k, 'java')).filter(d => fs.existsSync(d));
  const release = (() => { for (const f of [path.join(p.modDir, 'pom.xml'), path.join(root, 'pom.xml')]) { try { const t = fs.readFileSync(f, 'utf8'); const m = t.match(/<maven\.compiler\.release>\s*(\d+)/) || t.match(/<java\.version>\s*(\d+)/) || t.match(/<maven\.compiler\.source>\s*(?:1\.)?(\d+)/); if (m) return Number(m[1]); } catch {} } return null; })();
  const fast = readJson(path.join(CACHE, 'work', `${id}.fast.json`), {})[p.module];
  if (fast && fs.existsSync(fast.classes)) return { classpath: [fast.classes, fast.testClasses, ...fast.classpath], processorpath: [], sources, release };
  const TR = require('./testrun');
  const mvn = TR.mavenCmd(root, cfg);
  fs.mkdirSync(path.join(root, '.dt'), { recursive: true });
  const cpFile = path.join(root, '.dt', `check-classpath-${hash(p.module)}.txt`);
  fs.rmSync(cpFile, { force: true });
  const multi = p.module !== '.' && fs.existsSync(path.join(root, 'pom.xml'));
  const args = [...mvn[1], '-B', '-ntp', '-q', `-Dmaven.repo.local=${cfg.mavenRepo}`, ...(cfg.offline ? ['-o'] : []), ...(cfg.mavenSettings ? ['-s', cfg.mavenSettings] : []), ...cfg.args,
    'compile', 'dependency:build-classpath', `-Dmdep.outputFile=${cpFile}`, '-Dmdep.includeScope=test', '-Dmaven.compiler.failOnError=false',
    '-Djacoco.skip=true', '-Dcheckstyle.skip=true', '-Dspotless.check.skip=true', '-Denforcer.skip=true', '-Dpmd.skip=true', '-Dspotbugs.skip=true', ...(multi ? ['-pl', p.module, '-am'] : [])];
  const r = await require('./trace').step('maven classpath', () => require('./fastrun').exec(mvn[0], args, { cwd: multi ? root : p.modDir, env, timeoutMs: 900000 }), p.module);
  if (!fs.existsSync(cpFile)) return { error: `Maven could not give the classpath: ${require('./testout').compactLog(r.out).slice(-1500)}` };
  const classpath = fs.readFileSync(cpFile, 'utf8').trim().split(path.delimiter).filter(Boolean);
  return { classpath: [path.join(p.modDir, 'target', 'classes'), path.join(p.modDir, 'target', 'test-classes'), ...classpath], processorpath: [], sources, release };
}

async function prepareModule(id, root, p) {
  const cfg = require('./config').getTests();
  const TR = require('./testrun');
  const { env, B, javaMajor } = await TR.envFor(p, cfg);
  const bh = buildHash(root);
  const all = readJson(stateFile(id), {});
  if (all[p.module] && all[p.module].buildHash === bh) return all[p.module];
  let st;
  if (p.tool === 'maven') {
    st = await mavenClasspath(id, root, p, cfg, env);
    if (st.error) return st;
  } else if (p.tool === 'gradle') {
    st = await gradleClasspath(root, p, cfg, env, B);
    if (st.error) return st;
  } else return { error: 'no pom.xml or build.gradle' };
  st = { ...st, buildHash: bh, javaMajor, javaHome: cfg.javaHome || null, at: Date.now() };
  const now = readJson(stateFile(id), {});
  now[p.module] = st;
  fs.mkdirSync(path.dirname(stateFile(id)), { recursive: true });
  fs.writeFileSync(stateFile(id), JSON.stringify(now));
  return st;
}

// One preparation per workspace module at a time; later callers wait for the same one
const preparing = new Map();
function prepared(id, root, p) {
  const key = `${id}:${p.module}`;
  if (!preparing.has(key)) {
    const pr = prepareModule(id, root, p).catch(e => ({ error: e.message })).finally(() => setTimeout(() => preparing.delete(key), 0));
    preparing.set(key, pr);
  }
  return preparing.get(key);
}

// Until the preparations of a workspace are done (a build in the same folder waits for them)
async function idle(id) {
  await Promise.all([...preparing.entries()].filter(([k]) => k.startsWith(`${id}:`)).map(([, pr]) => pr));
}

// After workspace_open: prepare the module with the most tests in the background, so the first write is checked at once
function warm(id) {
  const cfg = require('./config').getTests();
  if (!cfg.compileCheck) return;
  const W = require('./workspace');
  let root;
  try { root = W.checkId(id).path; } catch { return; }
  const counts = new Map();
  (function rec(d, depth) {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 10 && !/^(\.|build$|target$|node_modules$|out$)/.test(e.name)) rec(f, depth + 1); continue; }
      const m = path.relative(root, f).split(path.sep).join('/').match(/^(.*?)src\/(test|main)\/java\//);
      if (m && e.name.endsWith('.java')) counts.set(m[1], (counts.get(m[1]) || 0) + (m[2] === 'test' ? 3 : 1));
    }
  })(root, 0);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return;
  const p = require('./testrun').plan(root, [`${best[0]}src/test/java/X.java`]);
  if (!p.tool) return;
  require('./trace').call('compile_prepare', { workspace: id, module: p.module }, { kind: 'job', source: 'workspace_open' }, () => prepared(id, root, p)).then(st => { if (st?.error) require('./trace').note(`compile checks in ${id}: ${st.error.slice(0, 200)}`); }).catch(() => {});
}

// Class index of a workspace: its code, its libraries' code, the jars of the module's classpath
function classIndex(id, st) {
  const index = {}, known = new Set();
  const add = (fqn) => { if (known.has(fqn)) return; known.add(fqn); (index[fqn.split('.').pop()] ||= []).push(fqn); };
  const own = new Set(require('./config').getPersonal().internalGroups);
  const jars = jarIndex(st.classpath.filter(e => /\.jar$/.test(e)));
  const available = new Set(Object.values(jars).flat());
  const classDirs = st.classpath.filter(e => !/\.jar$/.test(e));
  const compiled = fqn => available.has(fqn) || classDirs.some(dir => fs.existsSync(path.join(dir, `${fqn.replace(/\./g, '/')}.class`)));
  const W = require('./workspace'), root = W.checkId(id).path;
  let graph = null;
  for (const [i, key] of W.keys(id).entries()) {
    const g = require('./codeindex').load(key)?.graph_();
    if (!g) continue;
    if (i === 0) graph = g;
    for (const c of g.classes || []) {
      if (!c.id || c.id.startsWith('ext:')) continue;
      if (i > 0 && !compiled(c.id)) continue;
      if (i === 0 && st.sources?.length && c.file) {
        const file = path.resolve(root, c.file);
        if (!st.sources.some(dir => file.startsWith(path.resolve(dir) + path.sep)) && !compiled(c.id)) continue;
      }
      add(c.id);
      const pkg = c.id.split('.').slice(0, 2).join('.');
      if (i === 0 && pkg.includes('.')) own.add(`${pkg}.`);
    }
  }
  for (const fqns of Object.values(jars)) for (const f of fqns) add(f);
  for (const fqns of Object.values(JDK)) for (const f of fqns) add(f);
  return { index, known, own: [...own].filter(p => !/^(java|javax|jakarta|org\.springframework|org\.junit)\./.test(p)), graph };
}

// before -> after as [{find, replace}] that each match once: changed line runs with enough context around them
function editsBetween(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  // LCS table over lines (test files are small)
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hunks = [];
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; continue; }
    const h = { i, j };
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) { if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) j++; else i++; }
    hunks.push({ ...h, i2: i, j2: j });
  }
  return hunks.map(h => {
    for (let k = 1; ; k++) {
      const s0 = Math.max(0, h.i - k), e0 = Math.min(n, h.i2 + (h.i2 === h.i ? k : 0));
      const find = a.slice(s0, e0).join('\n');
      const replace = [...a.slice(s0, h.i), ...b.slice(h.j, h.j2), ...a.slice(h.i2, e0)].join('\n');
      if ((find && before.split(find).length === 2) || (s0 === 0 && e0 === n)) return { find, replace };
    }
  });
}

const short = (msg) => String(msg).split('\n').map(l => l.trim()).filter(Boolean).join('; ').slice(0, 400);

// Users of the classes in these main files (their callers may break on a signature change)
function usersOf(graph, root, rels, max = 25) {
  if (!graph) return [];
  const ids = new Set(graph.classes.filter(c => rels.includes(c.file) && /src\/main\//.test(c.file)).map(c => c.id));
  if (!ids.size) return [];
  const files = new Set();
  for (const [from, to] of graph.edges || []) {
    const cls = String(to).split('#')[0];
    if (!ids.has(cls)) continue;
    const c = graph.classes.find(x => from === x.id || String(from).startsWith(`${x.id}#`));
    if (c && !rels.includes(c.file) && /\.java$/.test(c.file)) files.add(c.file);
    if (files.size >= max) break;
  }
  return [...files].filter(f => fs.existsSync(path.join(root, f)));
}

// Check written files: compile them against the module's classpath, apply the fixes that are clear, offer the rest.
//   { ok, ms, errors: [{ file, line, message }], fixed: [...], suggestions: [...], alsoBroken, pending, skipped }
// fix: apply the clear fixes to the file (default tests.compileFix, on); false offers them as ready edits
async function check(id, rels, { waitMs, fix } = {}) {
  const cfg = require('./config').getTests();
  if (!cfg.compileCheck) return null;
  const autofix = fix ?? cfg.compileFix;
  const W = require('./workspace');
  const root = W.checkId(id).path;
  const java = [...new Set(rels)].filter(f => /\.java$/.test(f));
  if (!java.length) return rels.some(f => /\.kt$/.test(f)) ? { skipped: 'Kotlin files are checked by test_run (the build compiles them)' } : null;
  const T = require('./trace');
  const started = Date.now();
  const p = require('./testrun').plan(root, java);
  if (!p.tool) return { skipped: 'no pom.xml or build.gradle for these files' };
  const pending = prepared(id, root, p);
  let timer;
  const st = await Promise.race([pending, new Promise(r => { timer = setTimeout(() => r(null), waitMs ?? cfg.compileWaitMs); })]).finally(() => clearTimeout(timer));
  if (!st) return { pending: `preparing the classpath of ${p.module} (${p.tool}, once per workspace): not checked yet; the next write is` };
  if (st.error) return { skipped: st.error };
  const { index, known, own, graph } = classIndex(id, st);
  const out = path.join(root, '.dt', 'check');
  fs.mkdirSync(path.join(out, 'classes'), { recursive: true }); fs.mkdirSync(path.join(out, 'gen'), { recursive: true });
  const options = ['-d', path.join(out, 'classes'), '-s', path.join(out, 'gen'), '-encoding', 'UTF-8', '-nowarn', '-Xlint:none', '-Xmaxerrs', '100', '-implicit:none', '-XDshould-stop.ifNoError=FLOW',
    '-cp', st.classpath.join(path.delimiter), ...(st.sources.length ? ['-sourcepath', st.sources.join(path.delimiter)] : []), ...(st.processorpath.length ? ['-processorpath', st.processorpath.join(path.delimiter)] : [])];
  if (st.release && st.javaMajor && st.release <= st.javaMajor) options.push('--release', String(st.release));
  if (st.javaMajor >= 21) options.push('-proc:full');
  // main files: their users are compiled too (a changed signature breaks them)
  const users = usersOf(graph, root, java);
  const fixed = [], original = new Map();
  let r, errors = [], suggestions = [], alsoBroken = [], firstErrors = null;
  try {
    for (let round = 0; round < 4; round++) {
      r = await T.step('compile check', () => compile({ javaHome: st.javaHome, options, files: [...java, ...users].map(f => path.join(root, f)) }), `${java.length + users.length} files`);
      if (r.error) return { skipped: `the compile check failed: ${r.error}` };
      const relOf = (f) => (f ? path.relative(root, f).split(path.sep).join('/') : null);
      const errs = (r.diagnostics || []).filter(d => d.kind === 'ERROR').map(d => ({ ...d, rel: relOf(d.file) }));
      let changed = false;
      suggestions = [];
      for (const f of java) {
        const mine = errs.filter(d => d.rel === f);
        if (!mine.length) continue;
        const text = fs.readFileSync(path.join(root, f), 'utf8');
        const fx = fixesFor(text, mine, { index, known, own, graph });
        if (fx.fixed.length && fx.text !== text) {
          if (!original.has(f)) original.set(f, text);
          W.write(id, f, { content: fx.text }); fixed.push(...fx.fixed.map(w => `${f}: ${w}`)); changed = true;
        }
        suggestions.push(...fx.suggestions.map(s => ({ file: f, ...s })));
      }
      errors = errs.filter(d => java.includes(d.rel)).map(d => ({ file: d.rel, line: d.line, message: short(d.message) }));
      firstErrors ??= errors;
      alsoBroken = errs.filter(d => !java.includes(d.rel)).map(d => ({ file: d.rel, line: d.line, message: short(d.message) }));
      if (!changed) break;
    }
    // fix=false: the files back as written; the fixes as one edit list per file, the errors of what was written
    if (!autofix && original.size) {
      const offered = [];
      for (const [f, text] of original) {
        const now = fs.readFileSync(path.join(root, f), 'utf8');
        offered.push({ file: f, why: `clear fixes, not applied (fix=false): ${fixed.filter(x => x.startsWith(`${f}: `)).map(x => x.slice(f.length + 2)).join('; ')}`, edits: editsBetween(text, now) });
      }
      return { ok: false, ms: Date.now() - started, compileMs: r.ms, checked: java.length + users.length, errors: firstErrors, suggestions: [...offered, ...suggestions.map(x => ({ ...x, afterFixes: true }))], ...(alsoBroken.length ? { alsoBroken: alsoBroken.slice(0, 10) } : {}) };
    }
    return { ok: !errors.length && !alsoBroken.filter(e => users.includes(e.file)).length, ms: Date.now() - started, compileMs: r.ms, checked: java.length + users.length, errors, ...(fixed.length ? { fixed } : {}), ...(suggestions.length ? { suggestions } : {}), ...(alsoBroken.length ? { alsoBroken: alsoBroken.slice(0, 10) } : {}) };
  } finally {
    // Suggestion-only checks must restore the user's text even when a later
    // compiler round fails, throws, or is cancelled.
    if (!autofix) for (const [f, text] of original) W.write(id, f, { content: text });
  }
}

// ── after a run: what the failures ask for, as ready edits where the fix is mechanical ──
// Mockito strict stubs (an unused stubbing, a stubbing with other arguments), mixed matchers, a @Value
// property the test context lacks, a bean the slice does not have.
function runHints(id, root, cases) {
  const out = [];
  const seen = new Set();
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
  const fileOf = (cls) => {
    for (const base of ['src/test/java', 'src/main/java']) {
      const f = `${base}/${String(cls).split('$')[0].replace(/\./g, '/')}.java`;
      if (fs.existsSync(path.join(root, f))) return f;
    }
    return null;
  };
  let known = null;
  const knows = (fqn) => {
    if (!known) {
      known = new Set();
      try { for (const st of Object.values(readJson(stateFile(id), {}))) for (const fs_ of Object.values(jarIndex((st.classpath || []).filter(e => /\.jar$/.test(e))))) for (const f of fs_) known.add(f); } catch {}
    }
    return known.has(fqn);
  };
  const add = (key, s) => { if (!seen.has(key)) { seen.add(key); out.push(s); } };
  for (const k of cases) {
    if (k.status !== 'failed' && k.status !== 'error') continue;
    const text = `${k.message || ''}\n${k.stack || ''}`;
    const testFile = fileOf(k.class);
    // an unused stubbing: lenient() or away
    if (/UnnecessaryStubbingException|Unnecessary stubbings detected/.test(text)) {
      for (const m of text.matchAll(/->\s+at\s+([\w.$]+)\.[\w$<>]+\(([\w$]+\.java):(\d+)\)/g)) {
        const f = fileOf(m[1]); const t = f && read(f);
        if (!t) continue;
        const line = t.split('\n')[Number(m[3]) - 1] || '';
        if (!/\bwhen\(/.test(line) || /lenient\(\)/.test(line)) continue;
        const edits = [{ find: line, replace: line.replace(/\b(Mockito\.)?when\(/, 'lenient().when(') }, importEdit(t, 'org.mockito.Mockito.lenient', true)].filter(Boolean);
        add(`stub:${f}:${m[3]}`, { file: f, line: Number(m[3]), why: `${k.name}: this stubbing is never used (Mockito strict stubs): remove it, or keep it as lenient() when other tests of the class need it`, edits, remove: [{ find: `${line}\n`, replace: '' }] });
      }
      continue;
    }
    // a stubbing with other arguments than the call
    if (/PotentialStubbingProblem|Strict stubbing argument mismatch/.test(text)) {
      const call = (text.match(/this invocation of '[^']+' method:\s*\n\s*(.+)\n\s*->\s*at\s+[^\n]+\((\w+\.java:\d+)\)/) || []);
      const stub = (text.match(/has following stubbing\(s\) with different arguments:\s*\n\s*1\.\s*(.+)\n\s*->\s*at\s+[^\n]+\((\w+\.java:\d+)\)/) || []);
      add(`mismatch:${k.class}#${k.name}`, { file: testFile, why: `${k.name}: the code calls ${call[1] || 'the method'}${call[2] ? ` (${call[2]})` : ''} but the stubbing is ${stub[1] || 'for other arguments'}${stub[2] ? ` (${stub[2]})` : ''}: stub what the code passes (eq(...) or any(Type.class) for a value built inside), or the code passes the wrong value` });
      continue;
    }
    if (/InvalidUseOfMatchersException|Invalid use of argument matchers/.test(text)) {
      const at = (text.match(/->\s+at\s+[^\n]+\((\w+\.java:\d+)\)/) || [])[1];
      add(`matchers:${k.class}#${k.name}`, { file: testFile, why: `${k.name}: a call mixes matchers and plain values${at ? ` (${at})` : ''}: wrap each plain value in eq(...) once one argument is a matcher` });
      continue;
    }
    // a property the test's context does not have
    const ph = text.match(/Could not resolve placeholder '([^']+)' in value/);
    if (ph && testFile) {
      const t = read(testFile);
      const decl = t && t.match(/^(?:public\s+)?(?:final\s+)?class\s+\w+[^\n]*\{/m);
      const value = propertyValue(root, ph[1]);
      if (decl) {
        const tps = t.match(/@TestPropertySource\(properties\s*=\s*(\{[^)]*\}|"[^"]*")\)/);
        const entry = `"${ph[1]}=${value}"`;
        const edits = tps
          ? [{ find: tps[0], replace: tps[1].startsWith('{') ? tps[0].replace('{', `{ ${entry},`) : `@TestPropertySource(properties = { ${entry}, ${tps[1]} })` }]
          : [{ find: decl[0], replace: `@TestPropertySource(properties = "${ph[1]}=${value}")\n${decl[0]}` }, importEdit(t, 'org.springframework.test.context.TestPropertySource', false)].filter(Boolean);
        add(`prop:${ph[1]}`, { file: testFile, why: `the test's context has no property ${ph[1]} (@Value): give it one${value === 'TODO' ? ' (no value in the application properties: put the one the test needs)' : ` (${value}, from the application properties)`}`, edits });
      }
      continue;
    }
    // a bean the slice does not have: a mock of it (the edge), or @Import (a real bean of the service)
    const nb = text.match(/No qualifying bean of type '([\w.$]+)'/);
    if (nb && testFile) {
      const t = read(testFile);
      const decl = t && t.match(/^(?:public\s+)?(?:final\s+)?class\s+\w+[^\n]*\{/m);
      if (!decl) continue;
      const simple = nb[1].split('.').pop().replace(/\$/g, '.');
      const mockito = /@MockitoBean\b/.test(t) || (!/@MockBean\b/.test(t) && knows('org.springframework.test.context.bean.override.mockito.MockitoBean'));
      const anno = mockito ? 'MockitoBean' : 'MockBean';
      const annoFqn = mockito ? 'org.springframework.test.context.bean.override.mockito.MockitoBean' : 'org.springframework.boot.test.mock.mockito.MockBean';
      const field = `    @${anno} ${simple} ${simple[0].toLowerCase()}${simple.slice(1)};`;
      const own = fs.existsSync(path.join(root, 'src/main/java', `${nb[1].replace(/\./g, '/')}.java`));
      add(`bean:${nb[1]}`, {
        file: testFile,
        why: `the test's context has no bean ${nb[1]}: ${own ? 'a class of the service: @Import it when the test is about it, else mock it' : 'mock it (it is at the edge of what the test covers)'}`,
        edits: [{ find: decl[0], replace: `${decl[0]}\n${field}` }, importEdit(t, annoFqn, false), ...(t.includes(`import ${nb[1]};`) || nb[1].startsWith(`${(t.match(/^package\s+([\w.]+)/m) || [])[1]}.`) ? [] : [importEdit(t, nb[1], false)])].filter(Boolean),
      });
    }
  }
  return out;
}

// A property's value in the module's application properties (yml or properties), else TODO
function propertyValue(root, key) {
  for (const dir of ['src/test/resources', 'src/main/resources']) {
    let es; try { es = fs.readdirSync(path.join(root, dir)); } catch { continue; }
    for (const f of es.filter(n => /^application.*\.(properties|ya?ml)$/.test(n))) {
      const t = fs.readFileSync(path.join(root, dir, f), 'utf8');
      if (f.endsWith('.properties')) { const m = t.match(new RegExp(`^${key.replace(/\./g, '\\.')}\\s*[=:]\\s*(.*)$`, 'm')); if (m && !/\$\{/.test(m[1])) return m[1].trim(); continue; }
      // yml: walk the keys by indentation
      const stack = [];
      for (const l of t.split('\n')) {
        const m = l.match(/^(\s*)([\w.-]+):\s*(.*)$/);
        if (!m) continue;
        const depth = m[1].length;
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        stack.push({ depth, key: m[2] });
        const full = stack.map(x => x.key).join('.');
        if (full === key && m[3] && !/\$\{/.test(m[3])) return m[3].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
  return 'TODO';
}

module.exports = { editsBetween, COMPILER, GRADLE_INIT, buildHash, runHints, propertyValue, compile, compileHere, zipEntries, jarIndex, rank, pick, importEdit, fixesFor, symbolOf, enclosing, similar, check, warm, prepared, idle, classIndex, STATIC, JDK };
