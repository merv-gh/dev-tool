// The registry's JSON-schema subset. One validation path for CLI, HTTP, MCP and nested tools.
// Unknown annotation keywords are harmless; unsupported assertions fail closed when declared.
const { isDeepStrictEqual } = require('util');
const known = new Set('$schema $id $comment title description default examples deprecated readOnly writeOnly contentMediaType contentEncoding format $defs definitions $ref type enum const allOf anyOf oneOf not if then else minimum maximum exclusiveMinimum exclusiveMaximum multipleOf minLength maxLength pattern items prefixItems contains minContains maxContains minItems maxItems uniqueItems properties patternProperties additionalProperties required dependentRequired dependentSchemas propertyNames minProperties maxProperties'.split(' '));
function validate(value, schema, { maxNodes = 100000 } = {}) {
  const issues = []; let visited = 0;
  const bad = (path, message) => { if (issues.length < 20) issues.push({ path, message }); };
  function visit(v, s, p, depth = 0) {
    if (++visited > maxNodes || depth > 64) { bad(p, 'input exceeds structural budget'); return; }
    if (s === false) { bad(p, 'value is not allowed'); return; }
    if (!s || s === true) return;
    if (typeof s !== 'object' || Array.isArray(s)) { bad(p, 'schema must be an object or boolean'); return; }
    for (const key of Object.keys(s)) if (!known.has(key) && !key.startsWith('x-')) bad(p, `unsupported schema assertion ${key}`);
    if (s.$ref) { bad(p, 'unresolved schema reference'); return; }
    for (const op of ['allOf', 'anyOf', 'oneOf']) if (s[op]) {
      const results = s[op].map(x => validate(v, x, { maxNodes: Math.min(maxNodes, 10000) }).length === 0);
      if (op === 'allOf' ? results.some(x => !x) : op === 'anyOf' ? !results.some(Boolean) : results.filter(Boolean).length !== 1) bad(p, `does not satisfy ${op}`);
    }
    if (s.not && !validate(v, s.not, { maxNodes: 10000 }).length) bad(p, 'matches a forbidden schema');
    if (s.if !== undefined) visit(v, validate(v, s.if, { maxNodes: 10000 }).length ? s.else : s.then, p, depth + 1);
    const type = t => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t;
    if (s.type && ![].concat(s.type).some(type)) { bad(p, `must be ${[].concat(s.type).join(' or ')}`); return; }
    if (s.enum && !s.enum.some(x => isDeepStrictEqual(x, v))) bad(p, 'must be an allowed value');
    if (Object.hasOwn(s, 'const') && !isDeepStrictEqual(s.const, v)) bad(p, 'must equal the declared constant');
    if (typeof v === 'string') {
      if (s.minLength !== undefined && [...v].length < s.minLength) bad(p, `minimum length is ${s.minLength}`);
      if (s.maxLength !== undefined && [...v].length > s.maxLength) bad(p, `maximum length is ${s.maxLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) bad(p, 'does not match the required pattern');
    }
    if (typeof v === 'number') {
      for (const [key, fails] of [['minimum', n => v < n], ['maximum', n => v > n], ['exclusiveMinimum', n => v <= n], ['exclusiveMaximum', n => v >= n]]) if (s[key] !== undefined && fails(s[key])) bad(p, `violates ${key}`);
      if (s.multipleOf !== undefined && (!(s.multipleOf > 0) || Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-10)) bad(p, 'violates multipleOf');
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) bad(p, `minimum items is ${s.minItems}`);
      if (s.maxItems !== undefined && v.length > s.maxItems) bad(p, `maximum items is ${s.maxItems}`);
      const canonical = (x, depth = 0) => depth > 64 ? '"[too deep]"' : x && typeof x === 'object' ? Array.isArray(x) ? `[${x.map(y => canonical(y, depth + 1)).join(',')}]` : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k], depth + 1)}`).join(',')}}` : JSON.stringify(x);
      if (s.uniqueItems && new Set(v.map(x => canonical(x))).size !== v.length) bad(p, 'items must be unique');
      if (s.contains !== undefined) { const count = v.filter(x => !validate(x, s.contains, { maxNodes: 10000 }).length).length; if (count < (s.minContains ?? 1) || s.maxContains !== undefined && count > s.maxContains) bad(p, 'violates contains count'); }
      v.forEach((x, i) => visit(x, s.prefixItems?.[i] ?? s.items, `${p}[${i}]`, depth + 1));
    } else if (v && typeof v === 'object') {
      if (s.minProperties !== undefined && Object.keys(v).length < s.minProperties || s.maxProperties !== undefined && Object.keys(v).length > s.maxProperties) bad(p, 'violates property count');
      for (const k of s.required || []) if (!Object.hasOwn(v, k) || v[k] === undefined) bad(`${p}.${k}`, 'required');
      for (const [key, required] of Object.entries(s.dependentRequired || {})) if (Object.hasOwn(v, key)) for (const dep of required) if (!Object.hasOwn(v, dep)) bad(`${p}.${dep}`, `required with ${key}`);
      for (const [key, schema] of Object.entries(s.dependentSchemas || {})) if (Object.hasOwn(v, key)) visit(v, schema, p, depth + 1);
      for (const [k, x] of Object.entries(v)) {
        if (x === undefined) continue;
        if (s.propertyNames) visit(k, s.propertyNames, `${p}.${k}`, depth + 1);
        let matched = false;
        if (Object.hasOwn(s.properties || {}, k)) { visit(x, s.properties[k], `${p}.${k}`, depth + 1); matched = true; }
        for (const [pattern, schema] of Object.entries(s.patternProperties || {})) if (new RegExp(pattern, 'u').test(k)) { visit(x, schema, `${p}.${k}`, depth + 1); matched = true; }
        if (!matched && s.additionalProperties === false) bad(`${p}.${k}`, 'unknown property');
        else if (!matched && typeof s.additionalProperties === 'object') visit(x, s.additionalProperties, `${p}.${k}`, depth + 1);
      }
    }
  }
  visit(value, schema, '$'); return issues;
}
function assert(value, schema) {
  let text;
  try { text = JSON.stringify(value); } catch { throw Object.assign(new Error('Arguments must be JSON serializable'), { code: 'DT_ARGUMENT_INVALID' }); }
  const maxInputBytes = require('./config').getTools().maxInputBytes;
  if (text === undefined || Buffer.byteLength(text) > maxInputBytes) throw Object.assign(new Error(`Arguments exceed ${maxInputBytes} bytes`), { code: 'DT_ARGUMENT_INVALID' });
  const issues = validate(value, schema);
  if (issues.length) throw Object.assign(new Error(`Invalid argument ${issues[0].path}: ${issues[0].message}`), { code: 'DT_ARGUMENT_INVALID', issues });
  return value;
}
module.exports = { validate, assert };
