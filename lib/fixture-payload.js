// Payload validation is distinct from shape discovery. A discovered path is not a codec proof.
const supportedKinds = new Set(['JSON', 'JSONSCHEMA', 'JSON_SCHEMA']);
function schema(definition) {
  if (!definition) return null;
  const wrapper = typeof definition === 'object' && Object.hasOwn(definition, 'schema');
  const kind = String(wrapper ? definition.type || definition.schemaType || 'JSON' : 'JSON').toUpperCase();
  if (!supportedKinds.has(kind)) return { unsupported: `unsupported ${kind} wire schema; configure a codec worker and recapture exact encoded bytes` };
  let value = wrapper ? definition.schema : definition;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return { unsupported: 'invalid JSON schema' }; } }
  return { value };
}
function validateEnvelope(envelope, definitions = {}, codec = 'auto') {
  const gaps = [];
  const headers=Array.isArray(envelope.headers)?envelope.headers:Object.entries(envelope.headers || {}).map(([key,value])=>({key,value}));
  if(headers.some(header=>typeof header?.key!=='string' || typeof header?.value!=='string'))gaps.push('unsupported Kafka header encoding; native replay needs explicit UTF-8 string key/value pairs');
  if (!Number.isInteger(envelope.partition) || envelope.partition < 0 || !/^\d+$/.test(String(envelope.offset))) gaps.push('invalid partition/offset envelope');
  if (!['json', 'string','auto'].includes(codec)) gaps.push(`unsupported codec ${codec}`);
  for (const side of ['key', 'value']) {
    const definition = schema(definitions[side]);
    if (!definition) continue;
    if (definition.unsupported) { gaps.push(`${side}: ${definition.unsupported}`); continue; }
    // Tombstones and absent keys are Kafka envelopes, not failed non-null business values.
    if (envelope[side] == null) continue;
    const issues = require('./schema').validate(envelope[side], definition.value, { maxNodes: 10000 });
    gaps.push(...issues.map(issue => `${side}${issue.path.slice(1)}: ${issue.message}`));
  }
  return gaps;
}
module.exports = { validateEnvelope, schema };
