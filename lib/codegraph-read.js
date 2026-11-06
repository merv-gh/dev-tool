// Impact needs classes and one edge stream, not a second in-memory copy of both
// legacy and precise edges. Keep the original revision cache unchanged.
const fs = require('node:fs');
const { Reader, JSON_MODE } = require('./pgstore');
const { fileStamp } = require('./util');
const memo = new Map();
const failure = message => Object.assign(new Error(`Code graph: ${message}`), { code: 'DT_CODE_GRAPH' });
class Cursor extends Reader {
  constructor(file, offset = 0) { super(file); this.next = offset; }
  peek() {
    if (this.lifecycle.terminal) throw failure('reader is closed');
    if (this.pos === this.buf.length) {
      const buffer = Buffer.allocUnsafe(64 * 1024), n = fs.readSync(this.fd, buffer, 0, buffer.length, this.next);
      this.next += n; this.buf = buffer.subarray(0, n); this.pos = 0;
    }
    return this.buf[this.pos];
  }
  get offset() { return this.next - this.buf.length + this.pos; }
  // Discard a large top-level value without retaining its bytes. Individual
  // class/edge records still go through the bounded JSON parser in Reader.
  skip() {
    this.space(); const first = this.peek(), container = first === 123 || first === 91;
    if (first === undefined) throw failure('unexpected end of JSON');
    let depth = 0, mode = JSON_MODE.VALUE;
    for (;;) {
      const b = this.peek();
      if (b === undefined) { if (mode !== JSON_MODE.VALUE || depth) throw failure('truncated JSON'); return; }
      if (mode === JSON_MODE.VALUE && !container && first !== 34 && [44, 93, 125, 32, 9, 10, 13].includes(b)) return;
      this.pos++;
      if (mode === JSON_MODE.ESCAPE) mode = JSON_MODE.STRING;
      else if (mode === JSON_MODE.STRING) { if (b === 92) mode = JSON_MODE.ESCAPE; else if (b === 34) { mode = JSON_MODE.VALUE; if (!container && first === 34) return; } }
      else if (b === 34) mode = JSON_MODE.STRING;
      else if (b === 123 || b === 91) { if (++depth > 128) throw failure('nesting exceeds 128 levels'); }
      else if (b === 125 || b === 93) { if (--depth === 0 && container) return; if (depth < 0) throw failure('unexpected closing delimiter'); }
    }
  }
}
const graphError = error => error.code === 'DT_CODE_GRAPH' ? error : failure(error.message.replace(/^Postgres catalog:\s*/, ''));
function load(file) {
  const stamp = fileStamp(file), old = memo.get(file);
  if (old?.stamp === stamp) { memo.delete(file); memo.set(file, old); return old.value; }
  const cursor = new Cursor(file), value = {}, offsets = {};
  try {
    cursor.object(key => {
      cursor.space();
      if ((key === 'edges' || key === 'preciseEdges') && cursor.peek() === 91) { offsets[key] = cursor.offset; cursor.skip(); }
      else if (['classes', 'sql', 'errors'].includes(key) && cursor.peek() === 91) { const rows = []; cursor.array(row => rows.push(row)); value[key] = rows; }
      else Object.defineProperty(value, key, { value: cursor.value(), enumerable: true, configurable: true, writable: true });
    });
    cursor.space(); if (cursor.peek() !== undefined) throw failure('trailing JSON data');
    if (fileStamp(file) !== stamp) throw failure('index changed during read; retry the lookup');
  } catch (error) { throw graphError(error); } finally { cursor.close(); }
  for (const [name, offset] of Object.entries(offsets)) value[name] = {
    *[Symbol.iterator]() {
      if (fileStamp(file) !== stamp) throw failure('index changed during edge traversal; retry the lookup');
      const r = new Cursor(file, offset);
      try {
        r.expect(91); r.space(); if (r.peek() === 93) return;
        for (;;) { yield r.value(); r.space(); if (r.peek() === 93) break; r.expect(44); }
        if (fileStamp(file) !== stamp) throw failure('index changed during edge traversal; retry the lookup');
      } catch (error) { throw graphError(error); } finally { r.close(); }
    },
  };
  memo.delete(file); memo.set(file, { stamp, value });
  while (memo.size > 2) memo.delete(memo.keys().next().value);
  return value;
}
module.exports = { load, Cursor };
