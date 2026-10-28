// Offline Kafka path discovery and correlation suggestions. All candidates need confirmation;
// a schema/name match is evidence of shape, never proof that two values identify the same entity.
const MAX_DEPTH = 32, MAX_PATHS = 10000, MAX_NODES = 50000;
const validPath = p => typeof p === 'string' && /^(value|key|headers)(\.[\w-]+|\[\])*$/.test(p);
const fieldName = n => typeof n === 'string' && /^[\w-]+$/.test(n);
const normalized = n => String(n || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const scalar = t => ['string', 'integer', 'number', 'boolean'].includes(t);
const PRIMITIVES = new Map(Object.entries({ null: 'null', boolean: 'boolean', int: 'integer', long: 'integer', float: 'number', double: 'number', bytes: 'string', string: 'string' }));
const primitive = t => PRIMITIVES.get(t);
const jsonType = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v;

function decoded(value) {
  if (typeof value !== 'string') return value;
  if (value.length > 1e6) return null;
  try { return JSON.parse(value); } catch { return value; }
}
function schemaOf(definition) {
  if (!definition) return null;
  const envelope = typeof definition === 'object' && Object.hasOwn(definition, 'schema');
  const schema = decoded(envelope ? definition.schema : definition);
  const kind = String(envelope ? definition.type || definition.schemaType || '' : '').toUpperCase();
  if (kind && !['JSON', 'JSONSCHEMA', 'JSON_SCHEMA', 'AVRO'].includes(kind)) return null;
  const looksAvro = s => s && typeof s === 'object' && (['record', 'enum', 'fixed', 'int', 'long', 'float', 'double', 'bytes'].includes(s.type)
    || s.type === 'array' && (typeof s.items === 'string' || Array.isArray(s.items)));
  const avro = kind === 'AVRO' || (!kind && (typeof schema === 'string' || Array.isArray(schema) || looksAvro(schema)));
  return schema && (typeof schema === 'object' || avro) ? { schema, kind: avro ? 'avro-schema' : 'json-schema' } : null;
}

function paths(topic = {}) {
  if (!topic || typeof topic !== 'object') return [];
  const out = new Map();
  let work = 0;
  const add = (p, type, source, detail) => {
    if (!validPath(p) || out.size >= MAX_PATHS && !out.has(p)) return;
    let entry = out.get(p);
    if (!entry) { entry = { path: p, types: new Set(), sources: new Set(), evidence: new Set() }; out.set(p, entry); }
    for (const t of [].concat(type || 'unknown')) entry.types.add(t);
    entry.sources.add(source); entry.evidence.add(detail || `${source}: ${p}`);
  };
  const walkSample = (v, p, source, detail, depth = 0, ancestors = new Set()) => {
    if (depth > MAX_DEPTH || ++work > MAX_NODES || ancestors.has(v)) return;
    if (typeof v === 'string' && /^[\s]*[\[{]/.test(v)) { const parsed = decoded(v); if (parsed !== v) v = parsed; }
    add(p, jsonType(v), source, detail);
    if (!v || typeof v !== 'object') return;
    const next = new Set(ancestors); next.add(v);
    if (Array.isArray(v)) for (const x of v) walkSample(x, `${p}[]`, source, detail, depth + 1, next);
    else for (const [name, x] of Object.entries(v)) if (fieldName(name)) walkSample(x, `${p}.${name}`, source, detail, depth + 1, next);
  };

  function jsonSchema(root, prefix) {
    const resolve = ref => {
      if (ref === '#') return root;
      if (typeof ref !== 'string' || !ref.startsWith('#/')) return null; // never fetch external refs
      let node = root;
      for (const part of ref.slice(2).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if (!node || typeof node !== 'object' || !Object.hasOwn(node, part)) return null;
        node = node[part];
      }
      return node;
    };
    function visit(node, p, depth = 0, ancestors = new Set()) {
      if (node === true) { add(p, 'unknown', 'json-schema'); return; }
      if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_DEPTH || ++work > MAX_NODES || ancestors.has(node)) return;
      const next = new Set(ancestors); next.add(node);
      const types = [].concat(node.type || []).filter(t => ['object', 'array', 'null', 'string', 'number', 'integer', 'boolean'].includes(t));
      if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) types.push('object');
      if (node.items || node.prefixItems) types.push('array');
      if (Array.isArray(node.enum)) types.push(...node.enum.map(jsonType));
      if (Object.hasOwn(node, 'const')) types.push(jsonType(node.const));
      if (node.nullable === true) types.push('null');
      if (types.length) add(p, types, 'json-schema');
      if (node.$ref) visit(resolve(node.$ref), p, depth + 1, next);
      for (const keyword of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(node[keyword])) for (const variant of node[keyword]) visit(variant, p, depth + 1, next);
      if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) for (const [name, definition] of Object.entries(node.properties)) if (fieldName(name)) visit(definition, `${p}.${name}`, depth + 1, next);
      if (Array.isArray(node.items)) for (const item of node.items) visit(item, `${p}[]`, depth + 1, next);
      else if (node.items) visit(node.items, `${p}[]`, depth + 1, next);
      if (Array.isArray(node.prefixItems)) for (const item of node.prefixItems) visit(item, `${p}[]`, depth + 1, next);
      if (!out.has(p)) add(p, 'unknown', 'json-schema');
    }
    visit(root, prefix);
  }

  function avroSchema(root, prefix) {
    const names = new Map(), seen = new Set();
    const fullname = (node, namespace) => node.name?.includes('.') ? node.name : [node.namespace || namespace, node.name].filter(Boolean).join('.');
    function collect(node, namespace = '', depth = 0) {
      if (!node || typeof node !== 'object' || seen.has(node) || depth > MAX_DEPTH || ++work > MAX_NODES) return;
      seen.add(node);
      if (Array.isArray(node)) { for (const branch of node) collect(branch, namespace, depth + 1); return; }
      if (['record', 'enum', 'fixed'].includes(node.type) && typeof node.name === 'string') {
        const full = fullname(node, namespace); names.set(full, node);
        namespace = full.split('.').slice(0, -1).join('.');
      }
      for (const f of Array.isArray(node.fields) ? node.fields : []) collect(f?.type, namespace, depth + 1);
      collect(node.items, namespace, depth + 1); collect(node.values, namespace, depth + 1);
      if (typeof node.type === 'object') collect(node.type, namespace, depth + 1);
    }
    collect(root);
    function visit(node, p, namespace = '', depth = 0, ancestors = new Set()) {
      if (node == null || depth > MAX_DEPTH || ++work > MAX_NODES) return;
      if (typeof node === 'string') {
        const type = primitive(node);
        if (type) add(p, type, 'avro-schema');
        else {
          const target = names.get(node.includes('.') ? node : [namespace, node].filter(Boolean).join('.'));
          if (target) visit(target, p, namespace, depth + 1, ancestors);
          else add(p, 'unknown', 'avro-schema');
        }
        return;
      }
      if (typeof node !== 'object' || ancestors.has(node)) return;
      const next = new Set(ancestors); next.add(node);
      if (Array.isArray(node)) { for (const branch of node) visit(branch, p, namespace, depth + 1, next); return; }
      if (node.type === 'record') {
        add(p, 'object', 'avro-schema');
        const full = fullname(node, namespace), ns = full.split('.').slice(0, -1).join('.');
        for (const f of Array.isArray(node.fields) ? node.fields : []) if (f && fieldName(f.name)) visit(f.type, `${p}.${f.name}`, ns, depth + 1, next);
      } else if (node.type === 'array') { add(p, 'array', 'avro-schema'); visit(node.items, `${p}[]`, namespace, depth + 1, next); }
      else if (node.type === 'map') add(p, 'object', 'avro-schema'); // arbitrary keys have no exact path
      else if (node.type === 'enum' || node.type === 'fixed') add(p, 'string', 'avro-schema');
      else visit(node.type, p, namespace, depth + 1, next);
    }
    visit(root, prefix);
  }

  for (const side of ['key', 'value']) {
    const definition = schemaOf(topic[`${side}Schema`]);
    if (definition) {
      if (definition.kind === 'avro-schema') avroSchema(definition.schema, side);
      else jsonSchema(definition.schema, side);
    }
    const shaped = [...out.values()].some(p => p.path.startsWith(side) && [...p.types].some(scalar));
    if (!shaped) {
      if (side === 'value' && topic.fields && typeof topic.fields === 'object') {
        const fields = Array.isArray(topic.fields) ? topic.fields.map(f => [f?.path || f?.name, f?.type]) : Object.entries(topic.fields);
        for (const [name, raw] of fields) if (typeof name === 'string') {
          const p = /^(value|key|headers)(\.|\[\])/.test(name) ? name : `value.${name}`;
          const t = typeof raw === 'object' && raw ? raw.type : raw;
          add(p, [].concat(t || 'unknown').map(x => primitive(x) || (['object', 'array', 'null', 'integer', 'number', 'boolean', 'string'].includes(x) ? x : 'unknown')), 'cached-fields');
          // Flattened cached fields also establish the existence of their containers.
          const tokens = p.match(/^(?:value|key|headers)|\.[\w-]+|\[\]/g) || [];
          let parent = '';
          for (let i = 0; i < tokens.length - 1; i++) { parent += tokens[i]; add(parent, tokens[i + 1] === '[]' ? 'array' : 'object', 'cached-fields'); }
        }
      }
      for (const [i, sample] of (Array.isArray(topic.samples) ? topic.samples : []).entries()) if (sample && Object.hasOwn(sample, side)) walkSample(sample[side], side, 'cached-sample', `cached sample[${i}]: ${side}`);
    }
  }
  for (const [i, sample] of (Array.isArray(topic.samples) ? topic.samples : []).entries()) if (sample && Object.hasOwn(sample, 'headers')) walkSample(sample.headers, 'headers', 'cached-sample', `cached sample[${i}]: headers`);
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path)).map(e => ({ path: e.path, types: [...e.types].sort(), sources: [...e.sources].sort(), evidence: [...e.evidence].sort() }));
}

function validatePath(topic, path) {
  return validPath(path) && (path === 'headers' || path.startsWith('headers.') || path.startsWith('headers[]') || paths(topic).some(p => p.path === path));
}
function singular(name) {
  if (/ies$/i.test(name)) return name.slice(0, -3) + 'y';
  if (/(?:sses|shes|ches|xes|zes|statuses)$/i.test(name)) return name.slice(0, -2);
  return /s$/i.test(name) && !/(?:ss|us|is)$/i.test(name) ? name.slice(0, -1) : name;
}
function candidates(tables = [], topics = []) {
  const columns = new Map();
  for (const t of tables) {
    if (!t || typeof t !== 'object') continue;
    const table = t.table || (t.schema && t.name ? `${t.schema}.${t.name}` : null);
    if (!table || !t.db) continue;
    for (const c of t.columns || []) {
      if (!c?.name) continue;
      const aliases = new Map([[normalized(c.name), `normalized field name equals column ${c.name}`]]);
      if (normalized(c.name) === 'id') {
        const entity = table.split('.').at(-1);
        aliases.set(normalized(singular(entity) + 'Id'), `table semantic id: ${table}.id → ${singular(entity)}Id`);
        aliases.set(normalized(entity + 'Id'), `table semantic id: ${table}.id → ${entity}Id`);
      }
      for (const [alias, evidence] of aliases) {
        if (!alias) continue;
        if (!columns.has(alias)) columns.set(alias, []);
        columns.get(alias).push({ from: { db: t.db, table, column: c.name }, evidence });
      }
    }
  }
  const out = new Map();
  for (const topic of topics) {
    if (typeof topic?.topic !== 'string' || !topic.topic) continue;
    for (const p of paths(topic)) {
    if (!p.types.some(scalar) || p.types.some(t => t === 'array' || t === 'object')) continue;
    const leaf = p.path.split('.').at(-1).replace(/(?:\[\])+$/, '');
    for (const c of columns.get(normalized(leaf)) || []) {
      const key = JSON.stringify([topic.topic, p.path, c.from]);
      const evidence = [...new Set([c.evidence, ...p.evidence, 'Candidate only; confirm from service code or a schema contract before adding a match.'])];
      if (!out.has(key)) out.set(key, { topic: topic.topic, path: p.path, from: c.from, source: 'candidate', verified: false, evidence });
      else out.get(key).evidence = [...new Set([...out.get(key).evidence, ...evidence])];
    }
    }
  }
  return [...out.values()].sort((a, b) => JSON.stringify([a.topic, a.path, a.from]).localeCompare(JSON.stringify([b.topic, b.path, b.from])));
}

module.exports = { paths, candidates, validatePath };
