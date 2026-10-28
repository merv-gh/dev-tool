// Source-neutral evidence. Confluence is one optional reader, never the graph's storage contract.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');
const { CACHE, readJson, writeJson, fileStamp } = require('./util');
const DIR = path.join(CACHE, 'knowledge');
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const identifier = id => { if (!/^[a-zA-Z0-9][\w.-]{0,79}$/.test(id || '')) throw new Error('Source id must use letters, digits, _, . and -'); return id; };
const sourceFile = id => path.join(DIR, 'sources', identifier(id) + '.json');
const sourceStatus = id => path.join(DIR, 'status', identifier(id) + '.json');
const cfg = () => { const s = C.load(); return C.interpolate(s.raw.knowledge || {}, s.lookup()); };
function configured() {
  const sources = cfg().sources || [];
  if (!Array.isArray(sources) || sources.length > 100) throw new Error('knowledge.sources must be an array of at most 100 sources');
  const ids = new Set();
  return sources.map(s => { identifier(s.id); if (ids.has(s.id)) throw new Error(`Duplicate knowledge source ${s.id}`); ids.add(s.id); return { ...s, type: s.type || 'json' }; });
}
function inputs(source) {
  if (!source.path) throw new Error('Source path is required');
  const root = path.resolve(C.HOME, source.path), files = []; let bytes = 0;
  function walk(p) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) throw new Error('Knowledge sources cannot traverse symlinks');
    if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) if (!f.startsWith('.') && !['node_modules', 'target', 'build'].includes(f)) walk(path.join(p, f)); return; }
    if (!st.isFile() || !/\.(md|markdown|json)$/i.test(p)) return;
    if (st.size > 5 * 1024 * 1024 || (bytes += st.size) > 20 * 1024 * 1024 || files.length >= 500) throw new Error('Knowledge source exceeds file/byte budget (500 files, 5 MiB/file, 20 MiB/source)');
    files.push({ path: p, name: path.relative(stRoot(), p) || path.basename(p), text: fs.readFileSync(p, 'utf8') });
  }
  const stRoot = () => fs.statSync(root).isDirectory() ? root : path.dirname(root);
  walk(root); return files;
}
function normalize(source, files) {
  const entities = [], relations = [], documents = [], gaps = [];
  const revision = digest([{ id: source.id, type: source.type, service: source.service, title: source.title, url: source.url, technology: source.technology }, files.map(f => [f.name, f.text])]);
  const provenance = (file, extra = {}) => ({ ...extra, source: source.id, type: source.type, revision, file, status: 'stated' });
  const entity = (n, file) => {
    if (!n || typeof n.id !== 'string' || !n.id || n.id.length > 500 || typeof n.kind !== 'string' || !n.kind) throw new Error('Every knowledge entity needs an explicit id and kind');
    entities.push({ ...n, name: n.name || n.id, aliases: [...new Set([n.name || n.id, ...(n.aliases || [])])], provenance: provenance(file, n.provenance || {}) });
  };
  const relation = (r, file) => {
    if (!r || !['from', 'to', 'kind'].every(k => typeof r[k] === 'string' && r[k])) throw new Error('Every knowledge relation needs explicit from, to and kind');
    relations.push({ ...r, label: r.label || r.kind, confidence: 'stated', provenance: provenance(file, r.provenance || {}) });
  };
  const document = (text, title, file, extra = {}) => {
    if (!text?.trim()) return;
    documents.push({ id: `document:${source.id}:${digest([file, title, text]).slice(0, 24)}`, title, text, provenance: provenance(file), ...extra });
  };
  for (const f of files) {
    const ext = /\.md(?:own)?$|\.markdown$/i.test(f.name);
    if (source.type === 'markdown' || ext) {
      let section = source.title || f.name, buffer = [], line = 1, start = 1;
      const flush = () => { if (buffer.join('\n').trim()) document(buffer.join('\n').trim(), section, f.name, { line: start, url: source.url }); buffer = []; };
      for (const text of f.text.split(/\r?\n/)) { const h = text.match(/^#{1,6}\s+(.+?)\s*#*$/); if (h) { flush(); section = h[1]; start = line + 1; } else { if (!buffer.length) start = line; buffer.push(text); } line++; }
      flush(); continue;
    }
    const data = JSON.parse(f.text);
    if (source.type === 'openapi' || data.openapi || data.swagger) {
      const service = source.service || data.info?.['x-service'] || source.id, own = `service:${service}`;
      entity({ id: own, kind: 'service', name: service, description: data.info?.description }, f.name);
      document(data.info?.description || '', data.info?.title || service, f.name);
      for (const [route, item] of Object.entries(data.paths || {})) for (const method of ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']) if (item[method]) {
        const op = item[method], id = `endpoint:${service}:${method.toUpperCase()} ${route}`;
        entity({ id, kind: 'endpoint', name: `${method.toUpperCase()} ${route}`, service, operationId: op.operationId, aliases: [route, op.operationId].filter(Boolean) }, f.name);
        relation({ from: own, to: id, kind: 'exposes', technology: 'HTTP' }, f.name);
        document([op.summary, op.description].filter(Boolean).join('\n'), `${method.toUpperCase()} ${route}`, f.name, { entities: [own, id] });
      }
    } else if (source.type === 'asyncapi' || data.asyncapi) {
      const service = source.service || source.id, own = `service:${service}`;
      entity({ id: own, kind: 'service', name: service }, f.name);
      const channelIds = new Map();
      for (const [key, channel] of Object.entries(data.channels || {})) {
        const topic = channel.address || key, id = `topic:${topic}`; channelIds.set(key, id);
        entity({ id, kind: 'topic', name: topic, technology: source.technology || 'Messaging' }, f.name);
        document(channel.description || '', topic, f.name, { entities: [id] });
      }
      if (/^3\./.test(data.asyncapi || '')) for (const [name, op] of Object.entries(data.operations || {})) {
        const key = op.channel?.$ref?.match(/^#\/channels\/(.+)$/)?.[1]?.replace(/~1/g, '/').replace(/~0/g, '~'), id = channelIds.get(key);
        if (!id || !['send', 'receive'].includes(op.action)) { gaps.push({ kind: 'unsupported-operation', source: source.id, operation: name }); continue; }
        relation({ from: op.action === 'send' ? own : id, to: op.action === 'send' ? id : own, kind: op.action === 'send' ? 'produces' : 'consumes', technology: source.technology || 'Messaging' }, f.name);
      } else gaps.push({ kind: 'asyncapi-direction', source: source.id, detail: 'Channels are indexed; operation directions require AsyncAPI 3 send/receive or explicit normalized relations.' });
    } else {
      if (data.version !== 1 || !Array.isArray(data.entities || data.nodes || [])) throw new Error('Normalized knowledge JSON requires version:1, entities and optional relations/documents');
      for (const n of data.entities || data.nodes || []) entity(n, f.name);
      for (const r of data.relations || []) relation(r, f.name);
      for (const d of data.documents || []) document(d.text, d.title || f.name, f.name, { url: d.url, entities: d.entities });
    }
  }
  if (entities.length > 20000 || relations.length > 50000 || documents.length > 20000) throw new Error('Knowledge source exceeds entity/relation/document budget');
  return { version: 1, id: source.id, type: source.type, revision, entities, relations, documents, gaps };
}
function status() {
  const sources = configured().map(source => { const cached = readJson(sourceFile(source.id)); return { id: source.id, type: source.type, configured: true, cached: !!cached, revision: cached?.revision, syncedAt: cached?.syncedAt, update: readJson(sourceStatus(source.id)), entities: cached?.entities?.length || 0, documents: cached?.documents?.length || 0, gaps: cached?.gaps || [] }; });
  const conf = require('./docs-cache').status();
  return { sources, confluence: { optional: true, configured: conf.configured, cachedPages: conf.count }, ontology: { entities: 'Stable explicit ids, type, scope and aliases', relations: 'Directional verb with source and revision; co-occurrence is not an interaction', proof: 'indexed code/catalog evidence and stated documentation; neither is runtime proof' } };
}
function sync(id) {
  const sources = configured().filter(s => !id || s.id === id);
  if (id && !sources.length) throw new Error(`Unknown configured knowledge source ${id}`);
  const results = [];
  for (const source of sources) {
    try {
      const model = normalize(source, inputs(source)), previous = readJson(sourceFile(source.id));
      if (previous?.revision === model.revision && previous.type === model.type) { const result = { id: source.id, state: 'unchanged', revision: model.revision }; writeJson(sourceStatus(source.id), result); results.push(result); continue; }
      const next = { ...model, syncedAt: new Date().toISOString() };
      if (previous) writeJson(path.join(DIR, 'history', source.id, previous.revision + '.json'), previous);
      writeJson(sourceFile(source.id), next);
      const result = { id: source.id, state: 'updated', revision: next.revision, entities: next.entities.length, relations: next.relations.length, documents: next.documents.length, gaps: next.gaps }; writeJson(sourceStatus(source.id), result); results.push(result);
    } catch (e) { const result = { id: source.id, state: 'failed', error: require('./redact').clean(e.message), retainedPrevious: !!readJson(sourceFile(source.id)) }; writeJson(sourceStatus(source.id), result); results.push(result); }
  }
  return { ok: results.every(r => r.state !== 'failed'), sources: results };
}
const memo = new Map();
function graph(env = C.envNames()[0], { includeConfluence = false } = {}) {
  C.getEnv(env);
  const sources = configured(), stamps = [];
  const stampDir = (dir, nested = false) => { let files = []; try { files = fs.readdirSync(dir).sort(); } catch {} for (const name of files) { const file = path.join(dir, name); if (nested) stamps.push(fileStamp(path.join(file, 'passport.json'))); else if (name.endsWith('.json')) stamps.push([name, fileStamp(file)]); } };
  for (const dir of ['pg', 'kafka']) stampDir(path.join(CACHE, env, dir));
  stampDir(C.PATHS.passports, true); stamps.push(fileStamp(path.join(CACHE, env, 'consul.json')));
  for (const s of sources) stamps.push([s.id, fileStamp(sourceFile(s.id)), fileStamp(sourceStatus(s.id))]);
  const pages = includeConfluence ? require('./docs-cache').list() : [];
  const key = digest([env, stamps, pages.map(p => [p.id, p.space, p.version, p.syncedAt])]);
  if (memo.has(key)) return structuredClone(memo.get(key));
  const sys = require('./knowledge').system(env), nodes = new Map(), relations = [], documents = [], gaps = [], sourceVersions = [];
  const addNode = (node, proof) => {
    const old = nodes.get(node.id);
    if (old && old.kind !== node.kind) gaps.push({ kind: 'entity-type-conflict', id: node.id, kinds: [old.kind, node.kind] });
    nodes.set(node.id, { ...node, ...old, aliases: [...new Set([...(old?.aliases || []), ...(node.aliases || []), node.name].filter(Boolean))], evidence: [...(old?.evidence || []), { ...node.provenance, proof }] });
  };
  for (const n of sys.nodes) addNode(n, 'indexed');
  for (const r of sys.relations) relations.push({ ...r, proof: 'indexed' });
  for (const source of sources) {
    const model = readJson(sourceFile(source.id));
    if (!model) { gaps.push({ kind: 'source-not-synced', source: source.id }); continue; }
    if (readJson(sourceStatus(source.id))?.state === 'failed') gaps.push({ kind: 'source-update-failed', source: source.id, detail: 'Using retained previous revision; inspect knowledge_sources' });
    sourceVersions.push({ id: model.id, revision: model.revision, syncedAt: model.syncedAt });
    for (const n of model.entities) addNode(n, 'stated');
    relations.push(...model.relations.map(r => ({ ...r, proof: 'stated' }))); documents.push(...model.documents); gaps.push(...model.gaps);
  }
  if (includeConfluence) for (const p of pages) for (const b of p.blocks || []) documents.push({ id: b.id, title: p.title, text: b.text, url: p.url, provenance: { source: 'confluence', space: p.space, pageId: p.id, revision: p.version, blockId: b.id, status: 'stated' } });
  const match = require('./knowledge').entityMatcher([...nodes.values()]);
  for (const d of documents) {
    const mentions = [...new Set([...(d.entities || []), ...match(d.text).filter(m => m.entity).map(m => m.entity)])];
    d.entities = mentions;
    for (const id of mentions) if (!nodes.has(id)) gaps.push({ kind: 'unresolved-document-entity', document: d.id, id });
    for (const m of match(d.text).filter(m => !m.entity)) gaps.push({ kind: 'ambiguous-mention', document: d.id, name: m.name, candidates: m.candidates });
  }
  for (const r of relations) for (const id of [r.from, r.to]) if (!nodes.has(id)) { addNode({ id, name: id, kind: 'unresolved', provenance: r.provenance }, r.proof); gaps.push({ kind: 'unresolved-endpoint', id, relation: r.kind, source: r.provenance?.source }); }
  const revision = digest([env, [...nodes.values()], relations, sourceVersions.map(s => [s.id, s.revision]), documents, gaps]);
  const result = { version: 1, env, builtAt: new Date().toISOString(), revision, sources: sourceVersions, nodes: [...nodes.values()], relations, documents, gaps, runtimeVerified: false };
  memo.clear(); memo.set(key, result); return structuredClone(result);
}
function query({ env, q = '', entity, hops = 1, kinds, limit = 150, includeConfluence = false } = {}) {
  if (!Number.isInteger(hops) || hops < 0 || hops > 4 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('hops must be 0..4; limit must be 1..500');
  const model = graph(env, { includeConfluence }), words = q.toLowerCase().split(/\s+/).filter(Boolean), matches = model.nodes.filter(n => (!kinds?.length || kinds.includes(n.kind)) && (!entity || n.id === entity || n.name === entity || n.aliases.includes(entity)) && words.every(w => `${n.id} ${n.name} ${n.kind} ${n.aliases.join(' ')}`.toLowerCase().includes(w)));
  if (entity && matches.length > 1 && !matches.some(n => n.id === entity)) return { ...model, total: model.nodes.length, nodes: [], relations: [], documents: [], candidates: matches.slice(0, 100).map(n => ({ id: n.id, name: n.name, kind: n.kind })), gaps: [...model.gaps.slice(0, 499), { kind: 'ambiguous-entity', name: entity }], complete: false };
  const selected = new Set((entity && matches.some(n => n.id === entity) ? matches.filter(n => n.id === entity) : matches).slice(0, limit).map(n => n.id));
  if (entity && !matches.length) model.gaps.push({ kind: 'entity-not-found', id: entity, detail: 'No exact identity or alias in the available cached evidence' });
  let truncated = matches.length > limit;
  for (let i = 0; i < hops; i++) { const before = new Set(selected); for (const r of model.relations) if (before.has(r.from) || before.has(r.to)) for (const id of [r.from, r.to]) if (!selected.has(id)) { if (selected.size >= limit) truncated = true; else selected.add(id); } }
  const relations = model.relations.filter(r => selected.has(r.from) && selected.has(r.to));
  if (relations.length > 2000) truncated = true;
  return { ...model, nodes: model.nodes.filter(n => selected.has(n.id)), relations: relations.slice(0, 2000), relationsTotal: relations.length, documents: model.documents.filter(d => d.entities.some(id => selected.has(id))).slice(0, 50).map(d => ({ ...d, text: d.text.slice(0, 3000), ...(d.text.length > 3000 ? { truncated: true } : {}) })), gaps: model.gaps.slice(0, 500), gapsTotal: model.gaps.length, total: model.nodes.length, truncated, complete: !truncated && !model.gaps.length };
}
function search(queryText, options = {}) {
  const model = graph(options.env, options), terms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
  const records = [...model.nodes.map(n => ({ id: n.id, kind: n.kind, title: n.name, text: `${n.name} ${n.id} ${n.aliases.join(' ')}`, evidence: n.evidence })), ...model.documents.map(d => ({ ...d, kind: 'document' }))];
  const matches = records.map(r => ({ ...r, score: terms.reduce((n, t) => n + (`${r.title} ${r.text}`.toLowerCase().includes(t) ? 1 : 0), 0) })).filter(r => r.score && r.score === terms.length).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { revision: model.revision, total: matches.length, results: matches.slice(0, Math.min(50, options.limit || 15)).map(r => ({ ...r, text: r.text.slice(0, 1200) })), gaps: model.gaps, runtimeVerified: false };
}
function verify(quotes, options = {}) {
  const model = graph(options.env, options);
  return quotes.map(q => {
    let document = model.documents.find(d => d.id === q.document && (!q.source || d.provenance?.source === q.source));
    if (q.source && q.revision && (!document || document.provenance.revision !== q.revision)) {
      const old = /^[a-f0-9]{64}$/.test(q.revision) ? readJson(path.join(DIR, 'history', identifier(q.source), q.revision + '.json')) : null;
      document = old?.documents.find(d => d.id === q.document);
    }
    const parts = q.text.split(/\.{3}|…/).map(s => s.trim()).filter(Boolean);
    let offset = 0, verified = !!document && (!q.revision || document.provenance.revision === q.revision) && parts.length > 0;
    for (const part of parts) { const index = document?.text.indexOf(part, offset) ?? -1; if (index < 0) verified = false; else offset = index + part.length; }
    return { document: q.document, verified, ...(document ? { title: document.title, provenance: document.provenance, url: document.url, text: q.text } : { reason: 'Document/version is not cached' }) };
  });
}
module.exports = { configured, status, sync, graph, query, search, verify, normalize, inputs };
