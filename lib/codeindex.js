// Code index of a fetched source tree (repos/<PROJECT>/<repo> or a workspace), in cache/code/<key>/:
//   files.json   every text file (path, size, lines), the ref it was built from
//   tri.bin      trigram index: for each 3-byte sequence (lowercased), the files that contain it
//   graph.json   symbols and dependencies (lib/codegraph.js): classes, methods, fields, calls, tables, topics
// grep() is a trigram grep (the codesearch / zoekt idea): the literal parts of the pattern pick the candidate
// files from tri.bin, only those are read and matched. It needs no ripgrep in the container and stays fast
// over all indexed repos at once.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson, writeJson, fileStamp } = require('./util');

const DIR = path.join(CACHE, 'code');
const SKIP_DIRS = new Set(['.git', 'target', 'build', 'node_modules', '.gradle', '.idea', 'out', '.mvn', 'dist', '.next', 'coverage', '__pycache__']);
const TEXT = /\.(java|kt|kts|groovy|scala|ya?ml|properties|xml|sql|gradle|toml|json|md|txt|conf|ts|js|tsx|jsx|py|go|sh|html|css|proto|avsc|graphql|feature|csv|env|ftl|vm|mustache|j2|tf)$|(^|\/)(Dockerfile|Jenkinsfile|Makefile|mvnw|gradlew)$/i;
const MAX_FILE = 1 << 20;

const keyDir = (key) => path.join(DIR, ...key.split('/').map(s => s.replace(/[^\w.@-]/g, '_')));

function walk(root) {
  const out = [];
  let reusable = true;
  (function rec(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // Passport extraction may follow file symlinks: do not reuse a graph whose inputs
      // could change outside this tree's manifest.
      if (e.isSymbolicLink()) reusable = false;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) rec(full); continue; }
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (!e.isFile() || !TEXT.test(rel)) continue;
      const st = fs.statSync(full);
      if (st.size <= MAX_FILE) out.push({ path: rel, size: st.size, stamp: `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}` });
    }
  })(root);
  Object.defineProperty(out, 'reusable', { value: reusable });
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

// ── trigrams ─────────────────────────────────────────────────────────────
const lower = (b) => (b >= 65 && b <= 90 ? b + 32 : b);

// Unique trigram keys of a buffer (lowercased ASCII; other bytes as they are)
function trigramsOf(buf, seen, fileId, add) {
  if (buf.length < 3) return;
  let a = lower(buf[0]), b = lower(buf[1]);
  for (let i = 2; i < buf.length; i++) {
    const c = lower(buf[i]);
    const k = (a << 16) | (b << 8) | c;
    if (seen.get(k) !== fileId) { seen.set(k, fileId); add(k); }
    a = b; b = c;
  }
}

function varint(out, n) { while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); }

// tri.bin: "DTG1", n, keys[n], offsets[n+1] (u32 LE), then delta-varint file ids
function writeTrigrams(file, postings) {
  const keys = [...postings.keys()].sort((x, y) => x - y);
  const data = [];
  const offsets = new Uint32Array(keys.length + 1);
  keys.forEach((k, i) => {
    offsets[i] = data.length;
    let prev = -1;
    for (const id of postings.get(k)) { varint(data, id - prev); prev = id; }
  });
  offsets[keys.length] = data.length;
  const head = Buffer.alloc(8);
  head.write('DTG1', 0); head.writeUInt32LE(keys.length, 4);
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(new Uint32Array(keys).buffer), Buffer.from(offsets.buffer), Buffer.from(data)]));
}

function readTrigrams(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'DTG1') throw new Error(`${file}: not a trigram index`);
  const n = buf.readUInt32LE(4);
  const copy = (off, len) => new Uint32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + len * 4));
  return { keys: copy(8, n), offsets: copy(8 + n * 4, n + 1), data: buf.subarray(8 + n * 8 + 4) };
}

function posting(t, key) {
  let lo = 0, hi = t.keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, k = t.keys[mid];
    if (k === key) {
      const out = [];
      let p = t.offsets[mid], prev = -1;
      const end = t.offsets[mid + 1];
      while (p < end) { let n = 0, shift = 0, b; do { b = t.data[p++]; n |= (b & 127) << shift; shift += 7; } while (b & 128); prev += n; out.push(prev); }
      return out;
    }
    if (k < key) lo = mid + 1; else hi = mid - 1;
  }
  return [];
}

// ── build / load ─────────────────────────────────────────────────────────
// key: "PROJECT/repo" or "work/<id>"; meta: { project, repo, ref, sha, workspace }; extracted: the
// passport extraction of the same tree, when the caller has it
function build(root, key, meta = {}, opts = {}) {
  const T = require('./trace');
  const c = T.current();
  // synchronous; timed as one step of the current call
  const t0 = Date.now();
  try { const r = buildIndex(root, key, meta, opts); if (c) c.steps.push({ name: 'code index', ms: Date.now() - t0, ok: true, depth: c.depth, detail: `${key}: ${r.files} files, ${r.classes} classes` }); if (Date.now() - t0 > 1000 && c) T.note(`code index of ${key}: ${r.files} files in ${T.secs(Date.now() - t0)}`); return r; }
  catch (e) { if (c) c.steps.push({ name: 'code index', ms: Date.now() - t0, ok: false, depth: c.depth, error: e.message }); throw e; }
}

function buildIndex(root, key, meta = {}, { extracted, force = false } = {}) {
  const started = Date.now();
  const files = walk(root);
  const dir = keyDir(key);
  const input = crypto.createHash('sha256').update(JSON.stringify([1, path.resolve(root), meta, extracted ?? null])).digest('hex');
  const prev = !force && files.reusable ? load(key) : null;
  if (prev?.input === input && prev.list.length === files.length && files.every((f, i) => f.path === prev.list[i].path && f.stamp === prev.list[i].stamp)
      && fs.existsSync(path.join(dir, 'tri.bin')) && fs.existsSync(path.join(dir, 'graph.json'))) {
    const { list: _, dir: _dir, tri: _tri, graph: _graph, ...info } = prev;
    return { ...info, reused: true, ms: Date.now() - started };
  }
  const postings = new Map(), seen = new Map();
  let bytes = 0;
  const texts = new Map();
  files.forEach((f, id) => {
    const buf = fs.readFileSync(path.join(root, f.path));
    if (buf.includes(0)) { f.binary = true; return; }
    bytes += buf.length;
    let lines = 1; for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
    f.lines = lines;
    trigramsOf(buf, seen, id, (k) => { const p = postings.get(k); if (p) p.push(id); else postings.set(k, [id]); });
    if (/\.(java|kt|groovy)$/.test(f.path)) texts.set(f.path, buf.toString('utf8'));
  });
  fs.mkdirSync(dir, { recursive: true });
  writeTrigrams(path.join(dir, 'tri.bin'), postings);
  const graph = require('./codegraph').build(root, texts, meta, extracted);
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(graph)); // compact: it is the big one
  const info = { key, root, ...meta, input, builtAt: new Date().toISOString(), files: files.length, bytes, trigrams: postings.size, classes: graph.classes.length, edges: graph.edges.length, ms: Date.now() - started };
  writeJson(path.join(dir, 'files.json'), { ...info, list: files });
  memo.delete(key);
  return info;
}

const memo = new Map();
function load(key) {
  const dir = keyDir(key);
  const file = path.join(dir, 'files.json');
  const stamp = fileStamp(file);
  if (!stamp) { memo.delete(key); return null; }
  const m = memo.get(key);
  if (m && m.stamp === stamp) return m.value;
  const files = readJson(file);
  if (!files) { memo.delete(key); return null; }
  const v = { ...files, dir, tri: null, graph: null };
  Object.defineProperty(v, 'trigrams_', { value: () => (v.tri ||= readTrigrams(path.join(dir, 'tri.bin'))) });
  Object.defineProperty(v, 'graph_', { value: () => (v.graph ||= readJson(path.join(dir, 'graph.json'), { classes: [], edges: [] })) });
  memo.set(key, { stamp, value: v });
  return v;
}

// Every index: [{key, project, repo, ref, sha, builtAt, files, ...}]
function list() {
  const out = [];
  (function rec(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(e => e.name === 'files.json')) {
      const key = path.relative(DIR, dir).split(path.sep).join('/');
      const f = load(key);
      if (f) { const { list: _, dir: _dir, tri: _tri, graph: _graph, ...info } = f; out.push(info); }
      return;
    }
    if (depth < 3) for (const e of entries) if (e.isDirectory()) rec(path.join(dir, e.name), depth + 1);
  })(DIR, 0);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function remove(key) { fs.rmSync(keyDir(key), { recursive: true, force: true }); memo.delete(key); }

// "SHOP/*", "order-service", "work/*" -> keys; empty = all repos (not workspaces, unless asked)
function select(spec) {
  const all = list();
  const pats = [].concat(spec || []).flatMap(s => String(s).split(',')).map(s => s.trim()).filter(Boolean);
  if (!pats.length) return all.filter(i => !i.key.startsWith('work/')).map(i => i.key);
  const re = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return all.filter(i => pats.some(p => re(p).test(i.key) || re(p).test(i.repo || '') || (i.workspace && re(p).test(i.workspace)))).map(i => i.key);
}

// ── query planning: literal pieces a match must contain ───────────────────
// Returns an OR of ANDs: [[piece, piece], [piece]] (any alternative; all pieces of it), or null = no filter.
function required(pattern, regex) {
  if (!regex) return pattern.length >= 3 ? [[pattern]] : null;
  const alts = splitAlternatives(pattern).flatMap(expandGroups);
  const out = [];
  for (const alt of alts) {
    const pieces = literalRuns(alt).filter(p => p.length >= 3);
    if (!pieces.length) return null; // one alternative has no literal: every file is a candidate
    out.push(pieces);
  }
  return out;
}

function splitAlternatives(p) {
  const out = []; let depth = 0, cls = false, cur = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') { cur += c + (p[i + 1] || ''); i++; continue; }
    if (cls) { if (c === ']') cls = false; cur += c; continue; }
    if (c === '[') cls = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// "(ledger|coupon)Op1" -> ["ledgerOp1", "couponOp1"]: a group of plain alternatives (not optional) is
// spelled out, so the literal around it still filters (at most 16 spellings)
function expandGroups(p) {
  const m = p.match(/\(((?:\?:)?)((?:[\w-]+\|)+[\w-]+)\)(?![?*{])/);
  if (!m) return [p];
  const out = m[2].split('|').map(a => p.slice(0, m.index) + a + p.slice(m.index + m[0].length));
  return out.length > 16 ? [p] : out.flatMap(expandGroups).slice(0, 16);
}

// Literal runs of one alternative; groups, classes, wildcards and optional chars end a run.
function literalRuns(p) {
  const runs = []; let cur = '';
  const end = () => { if (cur) runs.push(cur); cur = ''; };
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const next = p[i + 1];
    const optional = next === '*' || next === '?' || (next === '{' && /^\{0/.test(p.slice(i + 1)));
    if (c === '\\') {
      const e = p[i + 1]; i++;
      if (/[wWdDsSbBnrtfvux0-9pPk]/.test(e)) { end(); continue; }
      if (p[i + 1] === '*' || p[i + 1] === '?') { end(); continue; }
      cur += e; continue;
    }
    if (c === '[') { end(); while (i < p.length && p[i] !== ']') { if (p[i] === '\\') i++; i++; } continue; }
    if (c === '(') { // a group: skip it (it may hold alternatives)
      end(); let d = 0;
      for (; i < p.length; i++) { if (p[i] === '\\') { i++; continue; } if (p[i] === '(') d++; if (p[i] === ')' && --d === 0) break; }
      continue;
    }
    if ('.^$|)'.includes(c)) { end(); continue; }
    if ('*+?'.includes(c)) { end(); continue; }
    if (c === '{') { end(); while (i < p.length && p[i] !== '}') i++; continue; }
    if (optional) { end(); continue; }
    cur += c;
  }
  end();
  return runs;
}

// ignoreCase: non-ASCII letters have case variants of other bytes (Ä/ä), so trigrams with them are skipped
function candidates(idx, plan, ignoreCase = true) {
  const all = idx.list;
  if (!plan) return all.map((_, i) => i).filter(i => !all[i].binary);
  const t = idx.trigrams_();
  const set = new Set();
  for (const pieces of plan) {
    let cur = null;
    for (const piece of pieces) {
      const b = Buffer.from(piece, 'utf8');
      for (let i = 0; i + 2 < b.length; i++) {
        if (ignoreCase && (b[i] > 127 || b[i + 1] > 127 || b[i + 2] > 127)) continue;
        const ids = posting(t, (lower(b[i]) << 16) | (lower(b[i + 1]) << 8) | lower(b[i + 2]));
        cur = cur ? intersect(cur, ids) : ids;
        if (!cur.length) break;
      }
      if (cur && !cur.length) break;
    }
    if (cur === null) return all.map((_, i) => i).filter(i => !all[i].binary); // no usable trigram: every file
    for (const id of cur) set.add(id);
  }
  return [...set].sort((a, b) => a - b);
}

function intersect(a, b) {
  const out = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; }
  return out;
}

const globRe = (g) => new RegExp('(^|/)' + g.split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('|') + '$');

// grep over indexes. pattern: text (regex=false) or a JS regex. glob: path filter ("*.java", "src/main/**").
function grep(keys, pattern, { regex = false, ignoreCase = true, glob, context = 0, limit = 200, perFile = 20, tests = true } = {}) {
  if (!pattern) throw new Error('pattern is empty');
  const flags = ignoreCase ? 'i' : '';
  const re = regex ? new RegExp(pattern, flags) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  const reFile = new RegExp(re.source, flags + 'm'); // ^ and $ at line ends when testing a whole file
  const plan = required(pattern, regex);
  const pathRe = glob ? globRe(glob) : null;
  const hits = [];
  let scanned = 0, candidateCount = 0, filesWithHits = 0, truncated = false;
  const started = Date.now();
  outer:
  for (const key of keys) {
    const idx = load(key);
    if (!idx) continue;
    const ids = candidates(idx, plan, ignoreCase);
    candidateCount += ids.length;
    for (const id of ids) {
      const f = idx.list[id];
      if (f.binary || (pathRe && !pathRe.test(f.path)) || (!tests && /(^|\/)src\/(test|it)\//.test(f.path))) continue;
      let text;
      try { text = fs.readFileSync(path.join(idx.root, f.path), 'utf8'); } catch { continue; }
      scanned++;
      if (!reFile.test(text)) continue;
      const lines = text.split('\n');
      let n = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const h = { repo: key, path: f.path, line: i + 1, text: lines[i].trim().slice(0, 300) };
        if (context) h.context = lines.slice(Math.max(0, i - context), i + context + 1).join('\n');
        hits.push(h);
        if (++n >= perFile) break;
        if (hits.length >= limit) { truncated = true; filesWithHits++; break outer; }
      }
      if (n) filesWithHits++;
      // a pattern spanning lines: the file matches, no single line does
      if (!n && regex && /\\n|\[\\s/.test(pattern)) { hits.push({ repo: key, path: f.path, line: 0, text: '(match spans lines)' }); filesWithHits++; }
    }
  }
  return { hits, files: filesWithHits, candidates: candidateCount, scanned, truncated, ms: Date.now() - started, plan: plan ? plan.map(p => p.join(' & ')).join(' | ') : 'all files' };
}

// A file of an index with line numbers (from..to)
function read(key, rel, { from = 1, to } = {}) {
  const idx = load(key);
  if (!idx) throw new Error(`no index ${key}`);
  const full = path.resolve(idx.root, rel);
  if (!full.startsWith(path.resolve(idx.root) + path.sep)) throw new Error('path outside the repo');
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const end = Math.min(lines.length, to || from + 299);
  return { repo: key, path: rel, from, to: end, lines: lines.length, text: lines.slice(from - 1, end).map((l, i) => `${String(from + i).padStart(5)}  ${l}`).join('\n') };
}

module.exports = { build, load, list, select, remove, grep, read, walk, required, keyDir, DIR };
