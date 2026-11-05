// Manual passport evidence is scoped, versioned, and separate from auto-refresh.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = require('./ports');
const ROOT = path.join(require('../config').HOME, 'passport-adjustments');
const MAX_BYTES = 2 * 1048576;
const scopeRoot = () => require('../access').scopedDirectory(ROOT);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = message => { throw Object.assign(new Error(message), { code: 'STATE_CONFLICT' }); };
const read = file => { try { if (fs.statSync(file).size > MAX_BYTES) throw Error('Passport adjustment exceeds byte budget'); return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const directory = identity => path.join(scopeRoot(), identity.service, hash(identity));
function atomic(file, value) {
  const data = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(data) > MAX_BYTES) P.invalid('Passport adjustment exceeds 2 MiB');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function head(identity) {
  const folder = directory(identity), pointer = read(path.join(folder, 'head.json'));
  if (!pointer) return null;
  if (!/^[a-f0-9]{64}$/.test(pointer.revision)) throw Error('Invalid passport adjustment head');
  const value = read(path.join(folder, 'revisions', `${pointer.revision}.json`));
  if (!value || hash(value) !== pointer.revision || JSON.stringify(value.identity) !== JSON.stringify(identity)) throw Error('Passport adjustment integrity check failed');
  return { ...value, revision: pointer.revision };
}
function detectedPassport(a) {
  if (a.passport) return a.passport;
  const base = require('./index').loadDetected(a.service);
  const matches = value => value && (a.env === undefined || (value.env || null) === a.env) && (a.repo === undefined || P.identity(value).repo === P.repo(a.repo)) && (a.revision === undefined || P.identity(value).revision === P.revision(a.revision));
  if (matches(base)) return base;
  // Explicit revisions never borrow detections from a different/latest commit.
  const folder = path.join(require('./index').DIR, String(a.service).replace(/[^\w.@-]/g, '_'), 'history');
  let files = []; try { files = fs.readdirSync(folder).filter(x => x.endsWith('.json')).sort().reverse().slice(0, 200); } catch {}
  for (const file of files) { const value = read(path.join(folder, file)); if (matches(value)) return value; }
  return null;
}
function merge(passport, identity, document) {
  const detected = P.detected(passport), all = new Map(detected.map(port => [port.id, port])), disabled = [];
  for (const operation of document?.operations || []) {
    const previous = all.get(operation.port_id) || operation.port;
    if (operation.action === 'disable') {
      if (previous) { all.delete(previous.id); disabled.push({ ...previous, disabled: true, adjustment: operation.provenance }); }
      else disabled.push({ id: operation.port_id, disabled: true, adjustment: operation.provenance });
    } else {
      all.set(operation.port_id, { ...operation.port, ...(operation.action === 'correct' ? { detected: operation.detected || previous || null } : {}) });
    }
  }
  const ports = [...all.values()];
  const gaps = ports.map(P.gaps).filter(Boolean);
  if (!passport) gaps.unshift({ kind: 'passport-snapshot-unavailable', identity, message: 'No detected passport matches this exact identity; manual declarations remain separately attributed.' });
  const detectedMetadata = Object.fromEntries(['description', 'owners', 'tags', 'notes'].filter(key => passport?.[key] !== undefined).map(key => [key, passport[key]]));
  return { protocol: 'dt.passport-ports/v1', identity, revision: document?.revision || null, detected, ports, disabled, gaps, metadata: { ...detectedMetadata, ...document?.metadata }, detectedMetadata, metadataProvenance: document?.metadataProvenance || {} };
}
function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !['description','owners','tags','notes'].includes(key))) P.invalid('metadata must contain description, owners, tags, or notes');
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (field === null) result[key] = null;
    else if (['owners','tags'].includes(key)) {
      if (!Array.isArray(field) || field.length > 100) P.invalid(`metadata.${key} must contain at most 100 strings`);
      result[key] = [...new Set(field.map(item => P.text(item, `metadata.${key}`, 250, false).trim()))];
      if (result[key].some(item => !item)) P.invalid(`metadata.${key} cannot contain empty strings`);
    } else result[key] = P.text(field, `metadata.${key}`, key === 'notes' ? 20000 : 8000, false);
  }
  return result;
}
function resolve(a) {
  if (!a || !a.service) P.invalid('service is required');
  const passport = detectedPassport(a), fallback = passport || require('./index').loadDetected(a.service);
  const identity = P.identity(fallback, a), document = head(identity);
  return { passport, identity, document, effective: merge(passport, identity, document) };
}
function history(identity, document, limit = 20) {
  const out = []; let current = document;
  while (current && out.length < Math.min(100, limit)) {
    out.push({ revision: current.revision, previousRevision: current.previousRevision, at: current.at, author: current.author, reason: current.reason, changes: current.changes });
    if (!current.previousRevision) break;
    const value = read(path.join(directory(identity), 'revisions', `${current.previousRevision}.json`));
    if (!value || hash(value) !== current.previousRevision) throw Error('Passport adjustment history integrity check failed');
    current = { ...value, revision: current.previousRevision };
  }
  return out;
}
function adjustments(a = {}) {
  const result = resolve(a);
  if (a.at_revision) {
    if (!/^[a-f0-9]{64}$/.test(a.at_revision)) P.invalid('Invalid historical adjustment revision');
    if (!history(result.identity, result.document, 100).some(row => row.revision === a.at_revision)) throw Object.assign(new Error('Adjustment revision not found in this identity'), { code: 'DT_NOT_FOUND' });
    const value = read(path.join(directory(result.identity), 'revisions', `${a.at_revision}.json`));
    result.document = { ...value, revision: a.at_revision }; result.effective = merge(result.passport, result.identity, result.document);
  }
  return { ...result.effective, ports: result.effective.ports.slice(0, 500), detected: result.effective.detected.slice(0, 500), total: result.effective.ports.length, detectedTotal: result.effective.detected.length, truncated: result.effective.ports.length > 500 || result.effective.detected.length > 500, operations: result.document?.operations || [], history: history(result.identity, result.document, a.history_limit || 20), owner: require('../access').owner() };
}
function acquire(folder) {
  fs.mkdirSync(folder, { recursive: true }); const lock = path.join(folder, '.lock');
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = read(path.join(lock, 'owner.json'));
    let alive = false; if (prior?.pid) try { process.kill(prior.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    if (alive || !prior && Date.now() - fs.statSync(lock).mtimeMs < 30000) conflict('Another passport adjustment is being saved; reload and retry');
    fs.rmSync(lock, { recursive: true, force: true });
    try { fs.mkdirSync(lock); } catch { conflict('Another passport adjustment is being saved; reload and retry'); }
  }
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
  return () => fs.rmSync(lock, { recursive: true, force: true });
}
function adjust(a) {
  require('../execution').check();
  const initial = resolve(a), expected = a.expected_revision;
  if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) P.invalid('expected_revision is required; use null for a new adjustment');
  const reason = P.text(a.reason, 'reason', 2000, false).trim(); if (!reason) P.invalid('A reason/source citation is required');
  const inputs = a.operations === undefined ? [] : a.operations;
  if (!Array.isArray(inputs) || inputs.length > 100 || !inputs.length && a.metadata === undefined) P.invalid('Save 1..100 port operations or editable metadata');
  const metadataPatch = a.metadata === undefined ? undefined : normalizeMetadata(a.metadata);
  const release = acquire(directory(initial.identity));
  try {
    const current = head(initial.identity);
    if ((current?.revision || null) !== expected) conflict('Passport adjustments changed; reload before saving');
    const visible = merge(initial.passport, initial.identity, current), known = new Map([...visible.detected, ...visible.ports, ...visible.disabled].map(port => [port.id, port]));
    const operations = new Map((current?.operations || []).map(operation => [operation.port_id, operation]));
    const author = require('../access').owner(), at = new Date().toISOString(), changes = [];
    for (const input of inputs) {
      if (!input || !['add', 'correct', 'disable', 'restore', 'remove'].includes(input.action)) P.invalid('Port action must be add, correct, disable, restore, or remove');
      const provenance = { origin: 'manual', status: 'declared', author: { principalId: author.principalId, storyId: author.storyId }, reason, at };
      const id = input.action === 'add' ? input.port?.id || `manual:${crypto.randomUUID()}` : P.text(input.port_id, 'port_id', 160, false);
      if (input.action === 'add' && known.has(id)) conflict(`Port ${id} exists; use correct`);
      if (input.action !== 'add' && !known.has(id)) P.invalid(`Unknown port ${id}; reload semantic_ports`);
      if (['restore','remove'].includes(input.action)) {
        const detected=visible.detected.find(port=>port.id===id);
        if(input.action==='remove'&&detected)P.invalid('Detected ports must be hidden, not deleted');
        if(input.action==='restore'&&!detected)P.invalid('Only detected ports have an original detection to restore');
        operations.delete(id);if(detected)known.set(id,detected);else known.delete(id);
        changes.push({action:input.action,port_id:id});continue;
      }
      const port = input.action === 'disable' ? undefined : P.normalize({ ...input.port, id }, initial.identity, provenance);
      const operation = { action: input.action, port_id: id, ...(port ? { port } : input.action === 'disable' ? { port: known.get(id) } : {}), ...(input.action === 'correct' ? { detected: known.get(id)?.detected || known.get(id) } : {}), provenance };
      operations.set(id, operation); known.set(id, port || { ...known.get(id), disabled: true }); changes.push({ action: input.action, port_id: id });
    }
    if (operations.size > 500) P.invalid('At most 500 overridden ports per source identity');
    const metadata = { ...current?.metadata, ...metadataPatch }, metadataProvenance = { ...current?.metadataProvenance };
    if (metadataPatch) {
      for (const field of Object.keys(metadataPatch)) metadataProvenance[field] = { origin: 'manual', status: 'declared', author: { principalId: author.principalId, storyId: author.storyId }, at, reason };
      changes.push({ action: 'metadata', fields: Object.keys(metadataPatch) });
    }
    const document = { protocol: 'dt.passport-adjustments/v1', identity: initial.identity, previousRevision: current?.revision || null, at, author: { principalId: author.principalId, storyId: author.storyId }, reason, changes, operations: [...operations.values()], ...(Object.keys(metadata).length ? { metadata, metadataProvenance } : {}) };
    const revision = hash(document), folder = directory(initial.identity);
    require('../execution').check();
    atomic(path.join(folder, 'revisions', `${revision}.json`), document);
    atomic(path.join(folder, 'head.json'), { revision });
    return { ...merge(initial.passport, initial.identity, { ...document, revision }), saved: true, changes, history: history(initial.identity, { ...document, revision }), guidance: 'Manual declarations remain separate from detected evidence. Missing identities/field mappings are gaps, not proven distributed flows.' };
  } finally { release(); }
}
function ports(a = {}) {
  const result = resolve(a).effective, limit = Math.max(1, Math.min(500, Number(a.limit) || 100));
  const offset = a.cursor ? Number(String(a.cursor).split(':').pop()) : 0;
  const binding = hash([result.identity, result.revision, result.detected.map(port => port.id), a.type || null, !!a.include_disabled]).slice(0, 24);
  if (a.cursor && (!String(a.cursor).startsWith(binding + ':') || !Number.isSafeInteger(offset) || offset < 0)) conflict('Ports changed; restart pagination');
  const selected = [...result.ports, ...(a.include_disabled ? result.disabled : [])].filter(port => !a.type || port.type === a.type);
  return { protocol: result.protocol, identity: result.identity, revision: result.revision, ports: selected.slice(offset, offset + limit), total: selected.length, nextCursor: offset + limit < selected.length ? `${binding}:${offset + limit}` : null, gaps: result.gaps };
}
function apply(passport, selectors = {}) {
  passport = passport?._detectedPassport || passport;
  if (!passport?.service || !passport.effective) return passport;
  const identity = P.identity(passport, selectors), document = head(identity), result = merge(passport, identity, document);
  const effective = { ...passport.effective };
  const fields = { 'http-ingress': 'endpoints', 'http-egress': 'calls', 'kafka-consume': 'consumes', 'kafka-produce': 'produces', 'db-read': 'tables', 'db-write': 'tables', scheduled: 'scheduled', 'internal-library': 'internalLibraries' };
  const converted = new Map();
  for (const port of result.ports) {
    const b = port.boundary, loc = port.handler;
    const item = { file: loc.file, line: loc.line, handler: loc.signature, port_id: port.id, ...(port.evidence.origin === 'manual' ? { manual: true, provenance: port.evidence, source: 'manual', via: port.evidence.reason } : {}) };
    if (port.type.startsWith('http')) Object.assign(item, { method: b.method, path: b.path, host: b.host, base_path: b.base_path, client: b.target_service });
    else if (port.type.startsWith('kafka')) Object.assign(item, { topic: b.topic, cluster: b.cluster, schema: b.schema, schemaVersion: b.schema_version });
    else if (port.type.startsWith('db-')) Object.assign(item, { table: [b.schema, b.table].filter(Boolean).join('.'), db: b.db, columns: b.columns, access: port.type === 'db-write' ? 'write' : 'read' });
    else if (port.type === 'scheduled') Object.assign(item, { schedule: b.schedule, registration: b.registration });
    else Object.assign(item, b);
    converted.set(port.id, item);
  }
  // Preserve untouched native rows and extractor-specific metadata. Only rows
  // targeted by an operation are replaced; unsupported candidates stay intact.
  if (document?.operations.length) {
    const changed = new Set(document.operations.map(operation => operation.port_id));
    const detectedIds = new Set(result.detected.map(port => port.id));
    for (const field of new Set(Object.values(fields))) {
      const native = effective[field] || (['consumes', 'produces'].includes(field) ? effective.kafka?.[field] : []) || [];
      const output = [];
      for (const row of native) {
        const associated = result.detected.filter(port => fields[port.type] === field && port._native === row);
        if (!associated.some(port => changed.has(port.id))) output.push(row);
        else for (const port of associated) { const current = result.ports.find(value => value.id === port.id); if (current && fields[current.type] === field) output.push(converted.get(port.id)); }
      }
      for (const port of result.ports) if (fields[port.type] === field && (!detectedIds.has(port.id) || fields[result.detected.find(value => value.id === port.id).type] !== field)) output.push(converted.get(port.id));
      effective[field] = output;
    }
  }
  effective.ports = result.ports;
  const summary = { ...passport.summary };
  if (document?.operations.length) {
    summary.endpoints = new Set((effective.endpoints || []).map(x => `${x.method} ${x.path}`)).size;
    summary.consumes = [...new Set((effective.consumes || []).map(x => x.topic))]; summary.produces = [...new Set((effective.produces || []).map(x => x.topic))];
    summary.calls = [...new Set((effective.calls || []).map(x => x.client).filter(Boolean))];
    const tables = {}; for (const row of effective.tables || []) for (const access of String(row.access || '').split(',').map(x => x.trim()).filter(Boolean)) (tables[row.table] ||= new Set()).add(access);
    summary.tables = Object.fromEntries(Object.entries(tables).map(([name, accesses]) => [name, [...accesses]]));
  }
  const projected = { ...passport, ...result.metadata, metadataProvenance: result.metadataProvenance, effective, ...(document ? { summary } : {}), portAdjustments: { revision: result.revision, identity, disabled: result.disabled, gaps: result.gaps, detected: result.detected, metadata: result.metadata, detectedMetadata: result.detectedMetadata, metadataProvenance: result.metadataProvenance }, detectedEffective: passport.effective };
  Object.defineProperty(projected, '_detectedPassport', { value: passport });
  return projected;
}
function signature(passport, selectors = {}) {
  const identity = P.identity(passport, selectors), pointer = read(path.join(directory(identity), 'head.json'));
  if (!pointer) return ''; if (!/^[a-f0-9]{64}$/.test(pointer.revision)) throw Error('Invalid passport adjustment head'); return pointer.revision;
}
const sourceIdentities = new Map();
function sourceIdentity(file) {
  const stamp = require('../util').fileStamp(file); let entry = sourceIdentities.get(file);
  if (!entry || entry.stamp !== stamp) {
    const passport = JSON.parse(fs.readFileSync(file, 'utf8'));
    entry = { stamp, passport: { service: passport.service, env: passport.env, repo: passport.repo } };
    sourceIdentities.set(file, entry); if (sourceIdentities.size > 512) sourceIdentities.delete(sourceIdentities.keys().next().value);
  }
  return entry;
}
function sourceSignature(file, selectors = {}) { return signature(sourceIdentity(file).passport, selectors); }
const usagePlans = new Map();
function usageProjection(env, rows, accept = () => true) {
  const ID = require('../semantic-identity'), root = scopeRoot(), entries = [];
  let services = []; try { services = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const service of services) {
    if (!/^[a-z0-9][\w.-]{0,159}$/i.test(service)) continue;
    const file = path.join(require('./index').DIR, service.replace(/[^\w.@-]/g, '_'), 'passport.json');
    let source; try { source = sourceIdentity(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (source.passport.env && source.passport.env !== env) continue;
    const identity = P.identity(source.passport, { env }), revision = signature(source.passport, { env });
    if (revision) entries.push({ identity, revision, file, stamp: source.stamp });
  }
  if (!entries.length) return rows;
  if (entries.length > 200) throw Object.assign(new Error('Too many active passport adjustments for one PG usage projection; inspect a narrower service with semantic_ports'), { code: 'DT_LIMIT_EXCEEDED' });
  const key = require('../access').current().scopeKey + ':' + env, fingerprint = hash(entries), previous = usagePlans.get(key);
  let plan = previous?.fingerprint === fingerprint ? previous : null;
  if (!plan) {
    const rules = [], additions = [];
    for (const entry of entries) {
      const passport = require('./index').loadDetected(entry.identity.service), document = head(entry.identity);
      const merged = merge(passport, entry.identity, document), changed = new Set(document.operations.map(x => x.port_id));
      const nativeRows = new Set(merged.detected.filter(port => port.type.startsWith('db-') && changed.has(port.id)).map(port => port._native));
      for (const row of nativeRows) {
        const remaining = merged.detected.filter(port => port._native === row && !changed.has(port.id)).map(port => port.type === 'db-write' ? 'write' : 'read');
        rules.push({ service: passport.service, table: ID.norm(row.table), where: row.file === 'config' ? `config ${row.key || ''}` : row.file ? `${row.file}:${row.line}` : '', remaining });
      }
      for (const port of merged.ports) {
        if (port.evidence.origin !== 'manual' || !port.type.startsWith('db-') || !port.boundary.table) continue;
        const b = port.boundary, h = port.handler;
        additions.push({ target: b.schema ? ID.qualified(b.schema, b.table) : ID.norm(b.table), targetKind: 'table', db: b.db || null, ...(b.db ? {} : { known: false }), user: passport.service, userKind: 'service', role: port.type === 'db-write' ? 'write' : 'read', where: h.file ? `${h.file}:${h.line || 1}` : 'manual declaration', detail: port.evidence.reason, source: 'manual', proof: 'declared', provenance: port.evidence, portId: port.id, columns: b.columns, mappings: port.mappings, verification: 'Manual declaration; catalog existence not established by this edge' });
      }
      if (rules.length + additions.length > 5000) throw Object.assign(new Error('Manual PG usage projection exceeds 5000 ports; inspect a narrower service with semantic_ports'), { code: 'DT_LIMIT_EXCEEDED' });
    }
    const ruleIndex = new Map(); for (const rule of rules) { const key = rule.service + '\0' + rule.where; if (!ruleIndex.has(key)) ruleIndex.set(key, []); ruleIndex.get(key).push(rule); }
    plan = { fingerprint, rules, ruleIndex, additions }; usagePlans.set(key, plan); while (usagePlans.size > 8) usagePlans.delete(usagePlans.keys().next().value);
  }
  const output = [];
  for (const row of rows) {
    if (row.userKind !== 'service') { output.push(row); continue; }
    const rule = (plan.ruleIndex.get(row.user + '\0' + row.where) || []).find(rule => ID.norm(row.target) === rule.table || !rule.table.includes('.') && ID.norm(row.target).split('.').pop() === rule.table);
    if (!rule) output.push(row);
    else if (rule.remaining.length) output.push({ ...row, role: rule.remaining.join(',') });
  }
  for (const row of plan.additions) if (accept(row)) output.push(row);
  return output;
}
module.exports = { ROOT, adjust, adjustments, ports, apply, signature, sourceSignature, usageProjection, detectedPassport };
