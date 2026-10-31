// Paged PostgreSQL cache. The manifest contains page offsets, not catalog objects.
// Scalar headers are tuples with shared field names; large fields live in separate
// records. Both page and detail reads use a bounded cache. Legacy JSON is migrated
// one record at a time, without constructing its full string or object graph.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { fileStamp, writeJson } = require('./util');
const FORMAT = 'dt.pg.catalog/v2';
const LIMIT = 8 * 1024 * 1024;
const PAGE_BYTES = 128 * 1024;
const cache = new Map();
let held = 0;
const opened = new Map();
function failure(message) { return Object.assign(new Error(`Postgres catalog: ${message}`), { code: 'DT_PG_CATALOG' }); }
function remember(key, bytes, read) {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit.value; }
  const value = read(), cost = bytes * 4;
  if (cost <= LIMIT) {
    while (held + cost > LIMIT && cache.size) { const first = cache.keys().next().value; held -= cache.get(first).cost; cache.delete(first); }
    cache.set(key, { value, cost }); held += cost;
  }
  return value;
}

// Reject one pathological record before JSON.stringify can allocate a huge string.
function encode(value) {
  let size = 0, nodes = 0;
  const string = s => { size += Buffer.byteLength(s) + 2; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32) size += 5; else if (c === 34 || c === 92) size++; } };
  const visit = (v, depth) => {
    if (++nodes > 500000) throw failure('one record exceeds 500000 values');
    if (depth > 128) throw failure('record nesting exceeds 128 levels');
    if (typeof v === 'string') string(v);
    else if (v && typeof v === 'object') {
      size += 2;
      for (const k of Object.keys(v)) { if (!Array.isArray(v)) string(k); size += 2; visit(v[k], depth + 1); }
    } else size += 24;
    if (size > LIMIT) throw failure('one record exceeds 8 MiB; narrow the catalog object rather than increasing the process heap');
  };
  visit(value, 0);
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > LIMIT) throw failure('one record exceeds 8 MiB');
  return data;
}

// Synchronous chunk reader used only for migration. Strings are scanned as bytes,
// so escaped quotes and UTF-8 sequences crossing a chunk boundary remain intact.
class Reader {
  constructor(file) { this.fd = fs.openSync(file, 'r'); this.buf = Buffer.alloc(0); this.pos = 0; }
  close() { fs.closeSync(this.fd); }
  peek() {
    if (this.pos === this.buf.length) { const b = Buffer.allocUnsafe(64 * 1024); const n = fs.readSync(this.fd, b, 0, b.length, null); this.buf = b.subarray(0, n); this.pos = 0; }
    return this.buf[this.pos];
  }
  space() { while ([32, 9, 10, 13].includes(this.peek())) this.pos++; }
  expect(b) { this.space(); if (this.peek() !== b) throw failure(`malformed JSON (expected ${String.fromCharCode(b)})`); this.pos++; }
  value() {
    this.space(); this.peek();
    let source = this.buf, start = this.pos, depth = 0, quoted = false, escaped = false, bytes = 0, nodes = 0, values = 0;
    const safeBytes = Math.min(LIMIT, require('v8').getHeapStatistics().heap_size_limit / 32);
    const chunks = [], first = this.peek(), container = first === 123 || first === 91;
    if (first === undefined) throw failure('unexpected end of JSON');
    while (true) {
      const b = this.peek();
      if (this.buf !== source) { chunks.push(source.subarray(start)); source = this.buf; start = this.pos; }
      if (b === undefined) { if (quoted || depth) throw failure('truncated JSON record'); break; }
      if (!quoted && !container && first !== 34 && [44, 93, 125, 32, 9, 10, 13].includes(b)) break;
      this.pos++; bytes++;
      if (bytes > safeBytes) throw failure('one legacy record exceeds the safe read budget (up to 8 MiB); original cache was preserved');
      if (quoted) { if (escaped) escaped = false; else if (b === 92) escaped = true; else if (b === 34) { quoted = false; if (!container && first === 34) break; } }
      else if (b === 34) quoted = true;
      else if (b === 123 || b === 91) { if (++nodes > 50000) throw failure('one record exceeds 50000 containers'); if (++depth > 128) throw failure('record nesting exceeds 128 levels'); }
      else if (b === 125 || b === 93) { if (--depth === 0 && container) break; }
      else if (b === 44 && ++values > 500000) throw failure('one record exceeds 500000 values');
    }
    chunks.push(source.subarray(start, this.pos));
    try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
    catch { throw failure('malformed JSON record; original cache was preserved'); }
  }
  object(each) {
    this.expect(123); this.space();
    if (this.peek() === 125) { this.pos++; return; }
    while (true) { const key = this.value(); if (typeof key !== 'string') throw failure('object key must be a string'); this.expect(58); each(key); this.space(); if (this.peek() === 125) { this.pos++; break; } this.expect(44); }
  }
  array(each) {
    this.expect(91); this.space();
    if (this.peek() === 93) { this.pos++; return; }
    while (true) { each(this.value()); this.space(); if (this.peek() === 93) { this.pos++; break; } this.expect(44); }
  }
}

const DEFER = new Set(['body', 'definition', 'def', 'comment']);
function writer(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prefix = `${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}`;
  const dataFile = path.join(path.dirname(file), prefix + '.data'), headerFile = path.join(path.dirname(file), prefix + '.headers');
  let dataFd = fs.openSync(dataFile, 'wx'), headerFd = fs.openSync(headerFile, 'wx'), dataAt = 0, headerAt = 0;
  const sections = Object.create(null), pending = new Map();
  const flush = name => {
    const p = pending.get(name); if (!p?.rows.length) return;
    const s = sections[name], buf = encode(p.rows);
    fs.writeFileSync(headerFd, buf); fs.writeSync(headerFd, '\n');
    s.pages.push([s.count - p.rows.length, p.rows.length, headerAt, buf.length]); headerAt += buf.length + 1;
    p.rows = []; p.bytes = 0;
  };
  const ensure = name => { sections[name] ||= { keys: [], count: 0, pages: [] }; };
  const add = (name, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(`${name} must contain objects`);
    const s = sections[name] ||= { keys: [], count: 0, pages: [] };
    let p = pending.get(name); if (!p) pending.set(name, p = { rows: [], bytes: 0, keys: new Map() });
    const head = [], lazy = [];
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (!p.keys.has(key)) { p.keys.set(key, s.keys.length); s.keys.push(key); }
      const k = p.keys.get(key);
      if (DEFER.has(key) || v && typeof v === 'object' || typeof v === 'string' && v.length > 512) {
        const raw = encode(v), packed = raw.length >= 1024 ? zlib.deflateRawSync(raw, { level: 1 }) : raw;
        const b = packed.length < raw.length * 0.9 ? packed : raw;
        lazy.push(k, dataAt, b.length, raw.length);
        fs.writeFileSync(dataFd, b); fs.writeSync(dataFd, '\n'); dataAt += b.length + 1;
      } else head.push(k, v);
    }
    const row = [head, lazy], size = encode(row).length;
    if (p.bytes + size > PAGE_BYTES) flush(name);
    p.rows.push(row); p.bytes += size; s.count++;
    if (p.rows.length >= 128) flush(name);
  };
  const abort = () => { if (dataFd !== null) fs.closeSync(dataFd); if (headerFd !== null) fs.closeSync(headerFd); dataFd = headerFd = null; fs.rmSync(dataFile, { force: true }); fs.rmSync(headerFile, { force: true }); };
  return { add, ensure, abort, commit(metadata, expectedStamp) {
    for (const name of pending.keys()) flush(name);
    fs.fsyncSync(dataFd); fs.fsyncSync(headerFd); fs.closeSync(dataFd); fs.closeSync(headerFd); dataFd = headerFd = null;
    if (expectedStamp && fileStamp(file) !== expectedStamp) throw failure('catalog changed during migration; retry the lookup');
    const manifest = { format: FORMAT, data: path.basename(dataFile), headers: path.basename(headerFile), metadata, sections };
    let previous;
    try { if (fs.statSync(file).size <= LIMIT) { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(128); let n; try { n = fs.readSync(fd, b, 0, b.length, 0); } finally { fs.closeSync(fd); } if (b.toString('utf8', 0, n).includes(FORMAT)) previous = JSON.parse(fs.readFileSync(file, 'utf8')); } } catch {}
    writeJson(file, manifest);
    // Readers opened both descriptors with their manifest. On POSIX an unlinked
    // old generation remains readable through those descriptors until collected.
    for (const name of [previous?.data, previous?.headers]) if (typeof name === 'string' && path.basename(name) === name && name.startsWith(path.basename(file) + '.') && /\.(data|headers)$/.test(name)) {
      try { fs.unlinkSync(path.join(path.dirname(file), name)); } catch {} // Windows may defer deletion while open.
    }
    return manifest;
  } };
}

function migrate(file) {
  const stamp = fileStamp(file), r = new Reader(file), w = writer(file), metadata = Object.create(null);
  try {
    r.object(key => {
      r.space();
      if (r.peek() === 91 && ['tables', 'functions', 'viewDeps', 'triggers', 'types', 'sequences', 'extensions', 'edges', 'columns', 'gaps'].includes(key)) { w.ensure(key); r.array(value => w.add(key, value)); }
      else if (key === 'dictionaries') { w.ensure(key); r.object(name => { const d = r.value(); w.add(key, { ...d, ...(Array.isArray(d.rows) ? { count: d.rows.length } : {}), $key: name }); }); }
      else metadata[key] = r.value();
    });
    r.space(); if (r.peek() !== undefined) throw failure('trailing data in JSON');
    w.commit(metadata, stamp);
  } catch (e) { w.abort(); throw e; } finally { r.close(); }
}

const finalize = new FinalizationRegistry(fds => { for (const fd of fds) try { fs.closeSync(fd); } catch {} });
function open(file, manifest, revision) {
  const resolve = name => { if (typeof name !== 'string' || path.basename(name) !== name || !name.startsWith(path.basename(file) + '.')) throw failure('invalid record file'); return path.join(path.dirname(file), name); };
  const fd = fs.openSync(resolve(manifest.data), 'r'); let hd;
  try { hd = fs.openSync(resolve(manifest.headers), 'r'); } catch (e) { fs.closeSync(fd); throw e; }
  const stampFd = n => { const s = fs.fstatSync(n); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`; };
  const store = { fd, hd, manifest, revision };
  const dataStamp = stampFd(fd), headerStamp = stampFd(hd);
  finalize.register(store, [fd, hd]);
  const read = (which, at, length, rawLength = length) => {
    if (stampFd(which === 'data' ? store.fd : store.hd) !== (which === 'data' ? dataStamp : headerStamp)) throw failure('record file changed without a new manifest; refresh the catalog');
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(length) || length < 0 || length > LIMIT || !Number.isSafeInteger(rawLength) || rawLength < length || rawLength > LIMIT) throw failure('invalid or oversized record span');
    return remember(`${path.dirname(file)}:${manifest.data}:${which}:${at}:${length}:${rawLength}`, rawLength, () => {
      let buf = Buffer.allocUnsafe(length); let n = 0;
      while (n < length) { const got = fs.readSync(which === 'data' ? store.fd : store.hd, buf, n, length - n, at + n); if (!got) throw failure('truncated record file'); n += got; }
      if (rawLength !== length) {
        try { buf = zlib.inflateRawSync(buf, { maxOutputLength: rawLength }); }
        catch { throw failure('invalid or oversized compressed record'); }
        if (buf.length !== rawLength) throw failure('compressed record size mismatch');
      }
      if ((buf[0] === 123 || buf[0] === 91) && buf.length > require('v8').getHeapStatistics().heap_size_limit / 32) throw failure('record exceeds the safe object read budget');
      let quoted = false, escaped = false, values = 0, depth = 0;
      // A bounded JSON string (function body/view SQL) has no object graph to
      // expand. Only containers need the pre-parse complexity scan.
      for (let i = 0; (buf[0] === 123 || buf[0] === 91) && i < buf.length; i++) {
        const b = buf[i];
        if (quoted) { if (escaped) escaped = false; else if (b === 92) escaped = true; else if (b === 34) quoted = false; }
        else if (b === 34) quoted = true;
        else if (b === 123 || b === 91) { if (++depth > 128) throw failure('record nesting exceeds 128 levels'); }
        else if (b === 125 || b === 93) depth--;
        else if (b === 44 && ++values > 500000) throw failure('record contains too many values');
      }
      try { return JSON.parse(buf.toString('utf8')); } catch { throw failure('invalid JSON record'); }
    });
  };
  const array = section => {
    const s = manifest.sections[section]; if (!s) return [];
    const item = i => {
      let lo = 0, hi = s.pages.length - 1, page;
      while (lo <= hi) { const m = (lo + hi) >>> 1, p = s.pages[m]; if (i < p[0]) hi = m - 1; else if (i >= p[0] + p[1]) lo = m + 1; else { page = p; break; } }
      if (!page) throw failure('missing header page');
      const [head, lazy] = read('headers', page[2], page[3])[i - page[0]], out = {};
      for (let j = 0; j < head.length; j += 2) Object.defineProperty(out, s.keys[head[j]], { enumerable: true, configurable: true, writable: true, value: head[j + 1] });
      for (let j = 0; j < lazy.length; j += 4) { const key = s.keys[lazy[j]], at = lazy[j + 1], length = lazy[j + 2], raw = lazy[j + 3]; Object.defineProperty(out, key, { enumerable: key !== 'rows', configurable: true, get: () => read('data', at, length, raw) }); }
      return out;
    };
    const index = k => typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k) && Number(k) < s.count;
    // An empty array target avoids allocating one heap slot per disk row.
    return new Proxy([], {
      get: (target, k, receiver) => k === 'length' ? s.count : index(k) ? item(Number(k)) : Reflect.get(target, k, receiver),
      has: (target, k) => index(k) || Reflect.has(target, k),
      ownKeys: () => [...Array.from({ length: s.count }, (_, i) => String(i)), 'length'],
      getOwnPropertyDescriptor: (target, k) => k === 'length' ? { ...Reflect.getOwnPropertyDescriptor(target, k), value: s.count } : index(k) ? { enumerable: true, configurable: true, writable: false, value: item(Number(k)) } : Reflect.getOwnPropertyDescriptor(target, k),
      set: () => { throw failure('catalog arrays are read-only; refresh the cache to change them'); },
    });
  };
  const out = { ...manifest.metadata };
  for (const section of Object.keys(manifest.sections)) if (section !== 'dictionaries') out[section] = array(section);
  if (manifest.sections.dictionaries) { out.dictionaries = {}; for (const d of array('dictionaries')) { const key = d.$key; delete d.$key; Object.defineProperty(out.dictionaries, key, { enumerable: true, configurable: true, value: d }); } }
  Object.defineProperty(out, '_revision', { value: store.revision });
  return out;
}

function load(file, retries = 0) {
  const sourceStamp = fileStamp(file);
  let stat; try { stat = fs.statSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const fd = fs.openSync(file, 'r'), prefix = Buffer.alloc(128); let n;
  try { n = fs.readSync(fd, prefix, 0, prefix.length, 0); } finally { fs.closeSync(fd); }
  const modern = /^\s*\{\s*"format"\s*:\s*"dt\.pg\.catalog\/v2"/.test(prefix.toString('utf8', 0, n));
  const configured = Number(process.env.DT_PG_SLIM_BYTES || LIMIT);
  const threshold = Math.min(Number.isFinite(configured) && configured > 0 ? configured : LIMIT, require('v8').getHeapStatistics().heap_size_limit / 32);
  if (!modern && stat.size > threshold) { migrate(file); return load(file); }
  if (modern && stat.size > Math.min(LIMIT, require('v8').getHeapStatistics().heap_size_limit / 32)) throw failure('manifest exceeds the safe read budget; rebuild the catalog');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw failure('invalid catalog JSON'); }
  if (modern) {
    const stamp = fileStamp(file);
    if (stamp !== sourceStamp && retries < 2) return load(file, retries + 1);
    const hit = opened.get(file);
    if (hit?.stamp === stamp) return hit.value;
    let catalog;
    try { catalog = open(file, value, sourceStamp); }
    catch (e) { if (fileStamp(file) !== sourceStamp && retries < 2) return load(file, retries + 1); throw e; }
    opened.delete(file); opened.set(file, { stamp: sourceStamp, value: catalog });
    while (opened.size > 8) opened.delete(opened.keys().next().value);
    return catalog;
  }
  Object.defineProperty(value, '_revision', { value: fileStamp(file) });
  return value;
}

function loadDictionary(file) {
  let stat; try { stat = fs.statSync(file); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  const fd = fs.openSync(file, 'r'), prefix = Buffer.alloc(128); let n;
  try { n = fs.readSync(fd, prefix, 0, prefix.length, 0); } finally { fs.closeSync(fd); }
  if (prefix.toString('utf8', 0, n).includes(FORMAT)) return load(file).dictionaries || {};
  if (stat.size > Math.min(LIMIT, require('v8').getHeapStatistics().heap_size_limit / 32)) {
    const stamp = fileStamp(file), r = new Reader(file), w = writer(file);
    try { w.ensure('dictionaries'); r.object(key => w.add('dictionaries', { ...r.value(), $key: key })); r.space(); if (r.peek() !== undefined) throw failure('trailing dictionary data'); w.commit({}, stamp); }
    catch (e) { w.abort(); throw e; } finally { r.close(); }
    return load(file).dictionaries;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { load, loadDictionary, writer, migrate, FORMAT, LIMIT, stats: () => ({ entries: cache.size, bytes: held }) };
