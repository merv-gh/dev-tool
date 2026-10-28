// Trusted protocol worker; the parent observes effects independently of module return values.
const fs = require('fs');
(async () => {
  const [request, response] = process.argv.slice(2);
  const input = JSON.parse(fs.readFileSync(request, 'utf8'));
  let observation;
  try {
    const loaded = require(input.module);
    const fn = input.export ? loaded[input.export] : loaded;
    if (typeof fn !== 'function') throw new TypeError(`export ${input.export || 'default'} is not a function`);
    const value = await fn(...input.args);
    observation = { status: 'returned', value: encode(value) };
  } catch (e) { observation = { status: 'threw', error: { name: e.name, message: e.message, ...(e.code !== undefined ? { code: encode(e.code) } : {}) } }; }
  fs.writeFileSync(response, JSON.stringify(observation));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
function encode(v, seen = new Set()) {
  if (v === undefined) return { $dtType: 'undefined' };
  if (typeof v === 'bigint') return { $dtType: 'bigint', value: String(v) };
  if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return { $dtType: 'number', value: Object.is(v, -0) ? '-0' : String(v) };
  if (v instanceof Map) return { $dtType: 'map', entries: [...v].map(([k,x]) => [encode(k, seen), encode(x, seen)]) };
  if (v instanceof Set) return { $dtType: 'set', values: [...v].map(x => encode(x, seen)) };
  if (v instanceof RegExp) return { $dtType: 'regexp', source: v.source, flags: v.flags };
  if (v instanceof Date) return { $dtType: 'date', value: v.toISOString() };
  if (Buffer.isBuffer(v)) return { $dtType: 'bytes', value: v.toString('base64') };
  if (v && typeof v === 'object') {
    if (seen.has(v)) throw new TypeError('cyclic differential result');
    seen.add(v);
    const out = Array.isArray(v) ? v.map(x => encode(x, seen)) : { $dtType: 'object', class: Object.getPrototypeOf(v)?.constructor?.name || null, entries: Object.keys(v).sort().map(k => [k, encode(v[k], seen)]) };
    seen.delete(v); return out;
  }
  if (['function', 'symbol'].includes(typeof v)) throw new TypeError(`unsupported differential value ${typeof v}`);
  return v;
}
