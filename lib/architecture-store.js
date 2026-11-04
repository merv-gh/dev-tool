// Shared, deliberately published architecture. Task state remains in scoped contexts.
// Heads are atomic pointers; immutable revisions and author/reason survive cache refreshes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const C = require('./config'), A = require('./access');
const ROOT = path.join(C.HOME, 'architecture');
const TYPES = ['landscape', 'context', 'container', 'component', 'deployment', 'dynamic', 'dataflow'];
const KINDS = ['person', 'system', 'service', 'component', 'database', 'table', 'topic', 'ui', 'external', 'library'];
const fail = (message, code = 'DT_ARGUMENT_INVALID', statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function id(value) { if (!/^[a-zA-Z0-9][\w.-]{0,99}$/.test(value || '') || ['.', '..'].includes(value)) fail('Architecture id must use letters, digits, dots, _ or -'); return value; }
function text(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || required && !value.trim() || /\u0000/.test(value)) fail(`Invalid architecture ${name} (max ${max} characters)`);
  return value.trim();
}
function array(value, name, max, fn) { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) fail(`Architecture ${name} must contain at most ${max} items`); return value.map(fn); }
const ref = value => text(value, 'entity reference', 500, true);
const evidence = values => array(values, 'evidence', 30, v => text(v, 'evidence citation', 2000, true));
const keys = (value, allowed) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('Unsupported architecture fields; inspect architecture_get/tool_describe'); };
function normalize(input) {
  keys(input, ['title', 'summary', 'body', 'status', 'tags', 'owners', 'evidence', 'nodes', 'relations', 'flows', 'views']);
  const commonEvidence = evidence(input.evidence);
  const node = n => {
    keys(n, ['id', 'kind', 'name', 'description', 'technology', 'parent', 'service', 'repo', 'evidence']);
    if (!KINDS.includes(n.kind)) fail('Unsupported architecture entity kind');
    return { id: ref(n.id), kind: n.kind, name: text(n.name, 'entity name', 250, true), description: text(n.description, 'entity description', 4000), technology: text(n.technology, 'technology', 250), parent: n.parent ? ref(n.parent) : null, service: text(n.service, 'service', 250), repo: text(n.repo, 'repository', 300), evidence: evidence(n.evidence) };
  };
  const relation = r => {
    keys(r, ['from', 'to', 'label', 'technology', 'evidence', 'envs', 'fields']);
    const citations = evidence(r.evidence);
    if (!citations.length && !commonEvidence.length) fail('Every declared relation needs evidence, on the relation or document');
    return { from: ref(r.from), to: ref(r.to), label: text(r.label, 'relation label', 500, true), technology: text(r.technology, 'relation technology', 250), evidence: citations.length ? citations : commonEvidence,
      envs: array(r.envs, 'relation environments', 20, ref), fields: array(r.fields, 'field mappings', 100, f => { keys(f, ['from', 'to']); return { from: ref(f.from), to: ref(f.to) }; }) };
  };
  const nodes = array(input.nodes, 'nodes', 500, node);
  if (new Set(nodes.map(n => n.id)).size !== nodes.length) fail('Duplicate architecture node id');
  const flows = array(input.flows, 'flows', 50, f => { keys(f, ['id', 'title', 'description', 'steps']); return { id: id(f.id), title: text(f.title, 'flow title', 250, true), description: text(f.description, 'flow description', 8000), steps: array(f.steps, 'flow steps', 200, relation) }; });
  const views = array(input.views, 'views', 50, v => {
    keys(v, ['id', 'title', 'type', 'focus', 'nodes', 'description']);
    if (!TYPES.includes(v.type)) fail('Unsupported C4/architecture view type');
    return { id: id(v.id), title: text(v.title, 'view title', 250, true), type: v.type, focus: v.focus ? ref(v.focus) : null, nodes: array(v.nodes, 'view node references', 500, ref), description: text(v.description, 'view description', 4000) };
  });
  for (const list of [flows, views]) if (new Set(list.map(v => v.id)).size !== list.length) fail('Duplicate architecture flow/view id');
  const status = input.status || 'active'; if (!['active', 'archived'].includes(status)) fail('Architecture status must be active or archived');
  const document = { title: text(input.title, 'title', 300, true), summary: text(input.summary, 'summary', 4000), body: text(input.body, 'explanation', 64000), status,
    tags: array(input.tags, 'tags', 50, v => text(v, 'tag', 150, true)), owners: array(input.owners, 'owners', 50, v => text(v, 'owner', 250, true)), evidence: commonEvidence, nodes, relations: array(input.relations, 'relations', 1000, relation), flows, views };
  if (Buffer.byteLength(JSON.stringify(document)) > 512 * 1024) fail('Architecture document exceeds 512 KiB');
  return document;
}
const folder = key => path.join(ROOT, id(key));
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function head(key) { return read(path.join(folder(key), 'head.json')); }
function get(key, revision) {
  const pointer = revision ? { revision } : head(key);
  if (!pointer || !/^[a-f0-9]{64}$/.test(pointer.revision || '')) fail('Architecture document/revision is unavailable', 'DT_NOT_FOUND', 404);
  const value = read(path.join(folder(key), 'revisions', pointer.revision + '.json'));
  if (!value || value.id !== key || value.revision !== pointer.revision) fail('Architecture revision is missing or damaged', 'DT_ARCHITECTURE_DAMAGED', 409);
  return value;
}
function list({ query = '', include_archived = false, limit = 100, offset = 0 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) fail('Architecture pagination is invalid');
  let names = []; try { names = fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean), errors = [];
  const records = names.flatMap(key => { try { const value = head(key); return value ? [value] : []; } catch (e) { errors.push({ id: key, error: e.message }); return []; } })
    .filter(v => (include_archived || v.status !== 'archived') && terms.every(t => `${v.id} ${v.title} ${v.summary} ${(v.tags || []).join(' ')}`.toLowerCase().includes(t)))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { scope: 'global', canPublish: A.current().role === 'admin', total: records.length, documents: records.slice(offset, offset + limit), nextOffset: offset + limit < records.length ? offset + limit : null, errors };
}
function atomic(file, value) { const tmp = file + '.' + crypto.randomUUID() + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); } }
function save({ id: key, expected_revision, reason, document } = {}) {
  A.requireAdmin(); id(key);
  if (expected_revision !== null && !/^[a-f0-9]{64}$/.test(expected_revision || '')) fail('expected_revision is required; read architecture_get, or null for a new document');
  reason = text(reason, 'publication reason', 2000, true); const normalized = normalize(document);
  if (!head(key) && list({ limit: 1000, include_archived: true }).total >= 1000) fail('Shared architecture document budget (1000) reached; update an existing document');
  const dir = folder(key), lock = path.join(dir, '.lock'); fs.mkdirSync(dir, { recursive: true });
  try { fs.mkdirSync(lock); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = read(path.join(lock, 'owner.json')); let alive = true;
    if (owner?.pid) try { process.kill(owner.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
    if (!owner) alive = Date.now() - fs.statSync(lock).mtimeMs < 30000;
    if (alive) fail('Architecture document is being published; reload and retry', 'STATE_CONFLICT', 409);
    fs.rmSync(lock, { recursive: true }); try { fs.mkdirSync(lock); } catch { fail('Architecture document is busy', 'STATE_CONFLICT', 409); }
  }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
    const previous = head(key);
    if ((previous?.revision || null) !== expected_revision) fail('Architecture changed; reload before publishing. Your draft was not saved.', 'STATE_CONFLICT', 409);
    const at = new Date().toISOString(), author = { principalId: A.current().principalId, storyId: A.current().storyId };
    const payload = { id: key, scope: 'global', parent: previous?.revision || null, at, author, reason, document: normalized }, revision = digest(payload);
    fs.mkdirSync(path.join(dir, 'revisions'), { recursive: true }); atomic(path.join(dir, 'revisions', revision + '.json'), { ...payload, revision });
    atomic(path.join(dir, 'head.json'), { id: key, revision, title: normalized.title, summary: normalized.summary, status: normalized.status, tags: normalized.tags, at, author, views: normalized.views.map(v => ({ id: v.id, title: v.title, type: v.type })), flows: normalized.flows.map(f => ({ id: f.id, title: f.title })) });
    return { ...payload, revision, saved: true };
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
function history(key, limit = 20) { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('History limit must be 1..100'); const records = []; let next = head(key)?.revision; while (next && records.length < limit) { const { document, ...value } = get(key, next); records.push({ ...value, title: document.title }); next = value.parent; } return { id: key, history: records, nextRevision: next || null }; }
function signature() { return digest(list({ limit: 1000, include_archived: true }).documents.map(d => [d.id, d.revision])); }
function knowledge() {
  const out = []; let bytes = 0;
  for (const h of list({ limit: 1000 }).documents) {
    const { document: d } = get(h.id, h.revision);
    bytes += Buffer.byteLength(JSON.stringify(d));
    if (bytes > 8 * 1024 * 1024) { out.truncated = true; break; }
    out.push({ id: `architecture:${h.id}`, title: d.title, text: [d.summary, d.body, ...d.flows.map(f => `${f.title}\n${f.description}`)].filter(Boolean).join('\n\n'), entities: d.nodes.map(n => n.id.startsWith('svc:') ? 'service:' + n.id.slice(4) : n.id), provenance: { source: 'architecture', documentId: h.id, revision: h.revision, status: 'declared', scope: 'global' }, url: null });
  }
  return out;
}
module.exports = { ROOT, TYPES, KINDS, normalize, list, get, save, history, signature, knowledge };
