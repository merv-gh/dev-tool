// Trusted protocol worker; the parent observes effects independently of module return values.
const fs = require('fs');
(async () => {
  const [request, response] = process.argv.slice(2);
  const input = JSON.parse(fs.readFileSync(request, 'utf8'));
  let observation, value;
  try {
    const loaded = require(input.module);
    const fn = input.export ? loaded[input.export] : loaded;
    if (typeof fn !== 'function') throw new TypeError(`export ${input.export || 'default'} is not a function`);
    value = await fn(...input.args);
  } catch (e) { observation = { status: 'threw', error: { name: e.name, message: e.message, ...(e.code !== undefined ? { code: encode(e.code) } : {}) } }; }
  // Encoding is protocol work: unsupported results must fail the worker, never
  // become an application exception that two implementations can "agree" on.
  observation ||= { status: 'returned', value: encode(value) };
  fs.writeFileSync(response, JSON.stringify(observation));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
function encode(v, seen = new Set()) {
  if (v === undefined) return { $dtType: 'undefined' };
  if (typeof v === 'bigint') return { $dtType: 'bigint', value: String(v) };
  if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return { $dtType: 'number', value: Object.is(v, -0) ? '-0' : String(v) };
  if (v && typeof v === 'object') {
    if (seen.has(v)) throw new TypeError('cyclic differential result');
    const keys = Reflect.ownKeys(v);
    if (keys.some(k => typeof k === 'symbol')) throw new TypeError('symbol-keyed differential properties need an explicit adapter');
    if (v instanceof WeakMap || v instanceof WeakSet || typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer) throw new TypeError('opaque/shared differential values need an explicit adapter');
    const numericKeys = keys.filter(k => /^(0|[1-9]\d*)$/.test(k));
    const allowedKeys = v instanceof RegExp ? ['lastIndex'] : ArrayBuffer.isView(v) ? numericKeys : [];
    const special = v instanceof Map || v instanceof Set || v instanceof RegExp || v instanceof Date || v instanceof ArrayBuffer || ArrayBuffer.isView(v);
    const proto = Object.getPrototypeOf(v);
    const builtinPrototypes = [Map.prototype, Set.prototype, RegExp.prototype, Date.prototype, ArrayBuffer.prototype, DataView.prototype, Buffer.prototype, Uint8Array.prototype, Uint8ClampedArray.prototype, Int8Array.prototype, Uint16Array.prototype, Int16Array.prototype, Uint32Array.prototype, Int32Array.prototype, Float32Array.prototype, Float64Array.prototype, BigInt64Array.prototype, BigUint64Array.prototype];
    if (special && !builtinPrototypes.includes(proto) || Array.isArray(v) && proto !== Array.prototype) throw new TypeError('custom differential builtin prototypes need an explicit adapter');
    if (special && keys.some(k => !allowedKeys.includes(k))) throw new TypeError('custom properties on differential builtins need an explicit adapter');
    if (keys.some(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d.get || d.set || !d.enumerable && !(Array.isArray(v) && k === 'length') && !(v instanceof RegExp && k === 'lastIndex'); })) throw new TypeError('nonenumerable/accessor differential properties need an explicit adapter');
    if (v instanceof RegExp) return { $dtType: 'regexp', source: v.source, flags: v.flags, lastIndex: encode(v.lastIndex, seen) };
    if (v instanceof Date) return { $dtType: 'date', value: v.toISOString() };
    if (Buffer.isBuffer(v)) return { $dtType: 'bytes', value: v.toString('base64') };
    if (v instanceof ArrayBuffer) return { $dtType: 'array-buffer', value: Buffer.from(v).toString('base64') };
    if (ArrayBuffer.isView(v)) return { $dtType: 'array-buffer-view', class: Object.getPrototypeOf(v).constructor.name, byteOffset: v.byteOffset, byteLength: v.byteLength, buffer: encode(v.buffer, seen) };
    if (!special && !Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new TypeError('custom differential prototypes need an explicit DTO adapter');
    seen.add(v);
    const out = v instanceof Map ? { $dtType: 'map', entries: [...v].map(([k,x]) => [encode(k, seen), encode(x, seen)]) }
      : v instanceof Set ? { $dtType: 'set', values: [...v].map(x => encode(x, seen)) }
      : Array.isArray(v) ? { $dtType: 'array', length: v.length, entries: Object.keys(v).sort().map(k => [k, encode(v[k], seen)]) }
      : { $dtType: 'object', class: Object.getPrototypeOf(v)?.constructor?.name || null, entries: Object.keys(v).sort().map(k => [k, encode(v[k], seen)]) };
    seen.delete(v); return out;
  }
  if (['function', 'symbol'].includes(typeof v)) throw new TypeError(`unsupported differential value ${typeof v}`);
  return v;
}
