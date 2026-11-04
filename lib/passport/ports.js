// Typed, bounded transport ports. A manual declaration never becomes extracted proof.
const crypto = require('crypto');
const TYPES = ['http-ingress', 'http-egress', 'kafka-consume', 'kafka-produce', 'db-read', 'db-write', 'scheduled', 'internal-library'];
const canonical = value => JSON.stringify(value, Object.keys(value || {}).sort());
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = message => { throw Object.assign(new Error(message), { code: 'DT_ARGUMENT_INVALID' }); };
function text(value, name, max = 500, nullable = true) {
  if (value === undefined || value === null || value === '') { if (nullable) return null; invalid(`${name} is required`); }
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) invalid(`${name} must be bounded text`);
  return value;
}
function repo(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = text(value, 'repo', 250).split('/');
  if (result.length !== 2 || result.some(x => !/^[a-z0-9][\w.-]{0,119}$/i.test(x))) invalid('repo must be PROJECT/slug');
  return `${result[0].toUpperCase()}/${result[1]}`;
}
function revision(value) { if (!value) return null; if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) invalid('revision must be a full 40-character commit SHA or null'); return value.toLowerCase(); }
function identity(passport, supplied = {}) {
  const service = text(supplied.service || passport?.service, 'service', 160, false);
  if (!/^[a-z0-9][\w.-]{0,159}$/i.test(service)) invalid('Invalid service name');
  const rawRepo = passport?.repo?.project && passport?.repo?.repo ? `${passport.repo.project}/${passport.repo.repo}` : null;
  let repository;
  if (supplied.repo !== undefined) repository = repo(supplied.repo);
  else try { repository = repo(rawRepo); } catch { repository = null; }
  return { service, env: text(supplied.env === undefined ? passport?.env : supplied.env, 'env', 160), repo: repository, revision: revision(supplied.revision === undefined ? (/^[a-f0-9]{40}$/i.test(passport?.repo?.sha || '') ? passport.repo.sha : null) : supplied.revision) };
}
function relativeFile(value) {
  const result = text(value, 'handler.file', 500);
  if (result && (result.startsWith('/') || /^[A-Za-z]:/.test(result) || /[\\\x00]/.test(result) || result.split('/').some(x => !x || x === '.' || x === '..'))) invalid('handler.file must be a relative source path');
  return result;
}
function handler(value = {}, source = {}) {
  if (value === null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) invalid('handler must be an object');
  const line = value.line ?? null, endLine = value.endLine ?? null;
  if (line !== null && (!Number.isSafeInteger(line) || line < 1) || endLine !== null && (!Number.isSafeInteger(endLine) || endLine < (line || 1))) invalid('Handler lines must be positive source line numbers');
  const result = { repo: repo(value.repo === undefined ? source.repo : value.repo), revision: revision(value.revision === undefined ? source.revision : value.revision), file: relativeFile(value.file), line, ...(endLine ? { endLine } : {}), signature: text(value.signature, 'handler.signature', 1000) };
  if (value.call !== undefined && value.call !== null) {
    const call = value.call;
    if (!call || typeof call !== 'object' || Array.isArray(call) || Object.keys(call).some(key => !['file','line','column','name','signature'].includes(key))) invalid('Invalid exact handler call locator');
    if (call.line != null && (!Number.isSafeInteger(call.line) || call.line < 1) || call.column != null && (!Number.isSafeInteger(call.column) || call.column < 1)) invalid('Call line/column must be positive source positions');
    result.call = { file: relativeFile(call.file === undefined ? result.file : call.file), line: call.line ?? null, ...(call.column != null ? { column: call.column } : {}), ...(call.name ? { name: text(call.name, 'handler.call.name', 500) } : {}), ...(call.signature ? { signature: text(call.signature, 'handler.call.signature', 1000) } : {}) };
  }
  return result;
}
const BOUNDARY_FIELDS = {
  'http-ingress': ['host', 'method', 'path', 'base_path'], 'http-egress': ['host', 'method', 'path', 'base_path', 'target_service'],
  'kafka-consume': ['cluster', 'topic', 'schema', 'schema_version'], 'kafka-produce': ['cluster', 'topic', 'schema', 'schema_version'],
  'db-read': ['db', 'schema', 'table', 'columns'], 'db-write': ['db', 'schema', 'table', 'columns'],
  scheduled: ['schedule', 'registration'], 'internal-library': ['artifact', 'module', 'version', 'target_repo', 'target_revision', 'target_signature'],
};
function boundary(type, value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !BOUNDARY_FIELDS[type].includes(k))) invalid(`Invalid ${type} boundary fields`);
  const out = {};
  for (const key of BOUNDARY_FIELDS[type]) {
    if (key === 'columns') {
      const columns = value.columns || []; if (!Array.isArray(columns) || columns.length > 100) invalid('columns must be a list of at most 100 fields');
      out.columns = columns.map(v => text(v, 'column', 250, false));
    } else if (key === 'target_repo') out[key] = repo(value[key]);
    else if (key === 'target_revision') out[key] = revision(value[key]);
    else if (key === 'base_path' && value[key] === '') out[key] = '';
    else out[key] = text(value[key], key, key === 'schedule' || key === 'registration' ? 1000 : 500);
  }
  if (out.method) { out.method = out.method.toUpperCase(); if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT|ANY)$/.test(out.method)) invalid('Invalid HTTP method'); }
  if (out.path && !out.path.startsWith('/')) invalid('HTTP path must start with /');
  if (out.base_path && !out.base_path.startsWith('/')) invalid('HTTP base_path must be empty or start with /');
  if (out.host) {
    try { const url = new URL('https://' + out.host); if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.host.toLowerCase() !== out.host.toLowerCase()) throw Error(); out.host = url.host.toLowerCase(); }
    catch { invalid('HTTP host is an authority, without scheme/path/credentials'); }
  }
  return out;
}
function normalize(value, source, evidence) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !TYPES.includes(value.type)) invalid(`port.type must be one of ${TYPES.join(', ')}`);
  const loc = handler(value.handler, source), target = boundary(value.type, value.boundary);
  const mappings = value.mappings || [], parameters = value.parameters || [];
  if (!Array.isArray(mappings) || mappings.length > 100 || !Array.isArray(parameters) || parameters.length > 100) invalid('Port mappings/parameters are limited to 100 entries');
  const port = { ...source, type: value.type, handler: loc, boundary: target,
    mappings: mappings.map(x => { if (!x || typeof x !== 'object') invalid('Invalid field mapping'); if (x.direction && !['request','response','read','write','argument','return','control'].includes(x.direction)) invalid('Invalid field mapping direction'); return { from: text(x.from, 'mapping.from', 500, false), to: text(x.to, 'mapping.to', 500, false), ...(x.direction ? { direction: x.direction } : {}), ...(x.evidence ? { evidence: text(x.evidence, 'mapping.evidence', 2000) } : {}) }; }),
    parameters: parameters.map(x => ({ name: text(x?.name, 'parameter.name', 200, false), ...(x.type ? { type: text(x.type, 'parameter.type', 300) } : {}), ...(x.path ? { path: text(x.path, 'parameter.path', 500) } : {}) })),
    evidence, status: evidence.origin === 'manual' ? 'declared' : 'detected',
  };
  port.id = value.id ? text(value.id, 'port.id', 160, false) : `port:${digest([source, port.type, loc.file, loc.signature, target]).slice(0, 32)}`;
  if (!/^[a-z0-9][\w.:-]{0,159}$/i.test(port.id)) invalid('Invalid port id');
  return port;
}
function detected(passport) {
  if (!passport) return [];
  const source = identity(passport), effective = passport.effective || {}, result = [];
  const add = (type, value, b) => {
    try {
      const library = value.source && (passport.libraries || []).find(x => x.artifactId === value.source);
      const loc = { file: value.file === 'config' ? null : value.file, line: value.line || null, signature: value.handler || value.methodSignature || null, ...(value.call ? { call: value.call } : {}),
        ...(library ? { repo: library.repo || null, revision: /^[a-f0-9]{40}$/i.test(library.sha || '') ? library.sha : null } : {}) };
      const port = normalize({ type, boundary: b, handler: loc, mappings: value.mappings || [], parameters: value.parameters || [] }, source,
        { origin: 'detected', source: 'passport', file: value.file || null, line: value.line || null, library: value.source || null, method: value.via || null });
      Object.defineProperty(port, '_native', { value });
      result.push(port);
    } catch (error) { /* An incomplete native candidate remains in the ordinary passport. */ }
  };
  for (const x of effective.endpoints || []) add('http-ingress', x, { method: x.method, path: x.path, host: x.host, base_path: x.base_path });
  for (const x of effective.calls || effective.feign || []) add('http-egress', x, { method: x.method, path: x.path, host: x.host, base_path: x.base_path, target_service: x.client || x.target });
  for (const [field, type] of [['consumes', 'kafka-consume'], ['produces', 'kafka-produce']]) for (const x of effective[field] || effective.kafka?.[field] || []) add(type, x, { cluster: x.cluster, topic: x.topic, schema: typeof x.schema === 'string' ? x.schema : undefined, schema_version: x.schemaVersion && String(x.schemaVersion) });
  for (const x of effective.tables || []) {
    const parts = String(x.table || '').split('.'), schema = parts.length > 1 ? parts.slice(0, -1).join('.') : null, table = parts[parts.length - 1];
    const writes = /write|insert|update|delete|save/i.test(x.access || ''), reads = /read|select/i.test(x.access || '') || !writes;
    for (const kind of [reads && 'db-read', writes && 'db-write'].filter(Boolean)) add(kind, x, { db: x.db, schema, table, columns: x.columns || [] });
  }
  for (const x of effective.scheduled || passport.scheduled || []) add('scheduled', x, { schedule: x.schedule || x.cron, registration: x.registration });
  for (const x of effective.internalLibraries || []) add('internal-library', x, { artifact: x.artifact, module: x.module, version: x.version, target_repo: x.repo, target_revision: x.revision, target_signature: x.signature });
  return [...new Map(result.map(port => [port.id, port])).values()];
}
function gaps(port) {
  const missing = [];
  for (const key of ['env', 'repo', 'revision']) if (!port[key]) missing.push(key);
  for (const key of ['repo', 'revision', 'file', 'line', 'signature']) if (!port.handler[key]) missing.push(`handler.${key}`);
  const required = port.type.startsWith('http') ? ['host', 'method', 'path'] : port.type.startsWith('kafka') ? ['cluster', 'topic'] : port.type.startsWith('db-') ? ['db', 'schema', 'table'] : port.type === 'scheduled' ? ['schedule', 'registration'] : ['artifact', 'target_repo', 'target_revision', 'target_signature'];
  for (const key of required) if (!port.boundary[key]) missing.push(`boundary.${key}`);
  if (port.type !== 'scheduled' && !port.mappings.length) missing.push('mappings');
  return missing.length ? { kind: 'port-identity-incomplete', port: port.id, missing, proof: port.status } : null;
}
module.exports = { TYPES, BOUNDARY_FIELDS, identity, normalize, detected, gaps, digest, text, repo, revision, invalid, canonical };
