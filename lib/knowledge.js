// Deterministic documentation <-> system graph. A missing edge is a gap in the available evidence,
// never proof that a production interaction cannot happen.
const fs = require('fs');
const path = require('path');
const { CACHE, readJson, writeJson } = require('./util');
const docs = require('./docs-cache');
const { hash } = require('./docs-parse');
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const variants = (name) => [...new Set([name, name.replace(/-/g, '_'), name.replace(/_/g, '-')])].filter(Boolean);
const provenance = (p, b, source = 'docs:prose') => ({ source, status: 'stated', space: p.space, pageId: p.id, version: p.version, blockId: b?.id, url: p.url });
function entityMatcher(entities) {
  // Bucket exact token sequences once. Matching is proportional to the block text, rather than
  // compiling one regular expression per catalog entity for every block.
  const words = text => [...String(text).toLowerCase().matchAll(/[\p{L}\p{N}_./{}:-]+/gu)].map(m => m[0].replace(/^[.:]+|[.:]+$/g, '')).filter(Boolean);
  const buckets = new Map();
  for (const n of entities) for (const alias of n.aliases || [n.name]) {
    if (alias.length < 2) continue;
    const sequence = words(alias); if (!sequence.length) continue;
    const key = sequence.join('\0'), bucket = buckets.get(sequence[0]) || new Map();
    const entry = bucket.get(key) || { name: alias.toLowerCase(), sequence, candidates: [] };
    if (!entry.candidates.includes(n.id)) entry.candidates.push(n.id);
    bucket.set(key, entry); buckets.set(sequence[0], bucket);
  }
  return text => {
    const tokens = words(text), found = new Map();
    for (let i = 0; i < tokens.length; i++) for (const [key, m] of buckets.get(tokens[i]) || []) if (m.sequence.every((t, n) => tokens[i + n] === t)) found.set(key, { name: m.name, candidates: [...m.candidates], ...(m.candidates.length === 1 ? { entity: m.candidates[0] } : {}) });
    return [...found.values()];
  };
}

function system(env) {
  const nodes = new Map(), relations = [], passports = [], gaps = [];
  const consul = readJson(path.join(CACHE, env, 'consul.json'), {});
  const add = (n) => { const old = nodes.get(n.id); nodes.set(n.id, { ...old, ...n, aliases: [...new Set([...(old?.aliases || []), ...(n.aliases || []), n.name])].filter(Boolean) }); return n.id; };
  const relation = (from, to, kind, src = {}, extra = {}) => relations.push({ from, to, kind, label: kind, confidence: 'verified', provenance: { source: 'code', status: 'verified', ...src }, ...extra });
  const cachedPassports = require('./passport/edges').snapshot(); gaps.push(...cachedPassports.gaps);
  for (const { passport: full, stale, digest } of cachedPassports.rows) {
    if (!full || full.env && full.env !== env) continue; passports.push(full);
    const p = { service: full.service, repo: `${full.repo?.project || '?'}/${full.repo?.repo || '?'}` };
    if (!full.env) gaps.push({ kind: 'passport-environment-unknown', service: p.service });
    const aliases = [p.service, full.repo?.repo, full.app?.name, full.config?.values?.['spring.application.name'], full.config?.merged?.['spring.application.name'], full.kubernetes?.name, ...(full.aliases || [])].filter(x => typeof x === 'string');
    add({ id: 'service:' + p.service, name: p.service, kind: 'service', aliases: aliases.flatMap(variants), version: full.deployed?.version || full.app?.version || full.version || full.repo?.sha?.slice(0, 10), owner: full.owner || full.repo?.project, env: full.env, provenance: { source: 'passport', status: 'verified', sha: full.repo?.sha, repo: p.repo, stale, digest } });
    const deployed = consul.services?.[p.service]?.instances || [];
    const versions = [...new Set(deployed.map(i => i.meta?.version || i.version).filter(Boolean))];
    if (versions.length) Object.assign(nodes.get('service:' + p.service), { version: versions.join(', '), versions: { [env]: versions }, env, deploymentProvenance: { source: 'catalog:consul', syncedAt: consul.syncedAt } });
  }
  // Graph discovery is offline: cached databases remain useful when connection credentials
  // are deliberately absent (for example an exported investigation or an air-gapped runner).
  const cachedDbs = new Map(require('./pg').loadAll(env).map(db => [db.db, db]));
  try { for (const f of fs.readdirSync(path.join(CACHE, env, 'pg')).filter(f => f.endsWith('.json') && !f.startsWith('_'))) { const db = readJson(path.join(CACHE, env, 'pg', f)); if (db?.db && Array.isArray(db.tables)) cachedDbs.set(db.db, db); } } catch {}
  for (const db of cachedDbs.values()) {
    add({ id: `database:${db.db}`, name: db.db, kind: 'database', technology: 'PostgreSQL', aliases: [db.db], tables: (db.tables || []).map(t => `${t.schema}.${t.name}`), provenance: { source: 'catalog:pg', status: 'verified', syncedAt: db.syncedAt } });
    for (const t of db.tables || []) {
      const ID = require('./semantic-identity'), object = `${t.schema}.${t.name}`, canonicalId = ID.pg('table', env, db.db, ID.qualified(t.schema, t.name));
      add({ id: `table:${db.db}:${object}`, canonicalId, identityVersion: 'dt.identity/v1', scope: { env, db: db.db, schema: t.schema, name: t.name }, name: object, kind: 'table', db: db.db, aliases: [canonicalId, object, t.name], columns: t.columns, provenance: { source: 'catalog:pg', status: 'verified', syncedAt: db.syncedAt } });
    }
    for (const f of db.functions || []) {
      const object = `${f.schema}.${f.name}`, overloaded = (db.functions || []).filter(x => x.schema === f.schema && x.name === f.name).length > 1;
      const ID = require('./semantic-identity'), name = overloaded ? `${object}(${f.arguments || ''})` : object, scopedObject = ID.qualified(f.schema, f.name) + (overloaded ? `(${f.arguments || ''})` : ''), canonicalId = ID.pg('pgfn', env, db.db, scopedObject);
      add({ id: `function:${db.db}:${name}`, canonicalId, identityVersion: 'dt.identity/v1', scope: { env, db: db.db, schema: f.schema, name: f.name, arguments: f.arguments }, name, kind: 'function', db: db.db, aliases: [canonicalId, `function:${db.db}:${object}`, object, f.name], provenance: { source: 'catalog:pg', status: 'verified', syncedAt: db.syncedAt } });
      if (overloaded) gaps.push({ kind: 'function-overload-resolution', db: db.db, object, detail: 'Unqualified function usage cannot establish the called overload.' });
    }
  }
  let files = []; try { files = fs.readdirSync(path.join(CACHE, env, 'kafka')); } catch {}
  for (const f of files.filter(f => !f.startsWith('_') && f.endsWith('.json'))) {
    const t = readJson(path.join(CACHE, env, 'kafka', f)); if (!t?.topic) continue;
    add({ id: `topic:${t.topic}`, name: t.topic, kind: 'topic', aliases: variants(t.topic), schema: t.valueSchema || null, partitions: t.partitions, messages: t.messages, lastMessageAt: t.lastMessageAt || t.messagesSample?.[0]?.timestamp, fields: t.fields, provenance: { source: 'catalog:kafka', status: 'verified', syncedAt: t.syncedAt } });
  }
  const resolve = (name, kind) => [...nodes.values()].filter(n => (!kind || n.kind === kind) && n.aliases.some(a => a.toLowerCase() === String(name).toLowerCase()));
  for (const p of passports) {
    const own = 'service:' + p.service, effective = p.effective || {}, at = x => ({ service: p.service, file: x.file, line: x.line, where: x.file ? `${x.file}:${x.line || 1}` : undefined, sha: p.repo?.sha });
    for (const x of effective.endpoints || []) { const id = add({ id: `endpoint:${p.service}:${x.method} ${x.path}`, kind: 'endpoint', name: `${x.method} ${x.path}`, aliases: [`${x.method} ${x.path}`, x.path], service: p.service, handler: x.handler, provenance: { source: 'code', status: 'verified', ...at(x) } }); relation(own, id, 'exposes', at(x), { technology: 'HTTP' }); }
    for (const [field, kind] of [['produces', 'produces'], ['consumes', 'consumes']]) for (const x of effective[field] || []) {
      const id = `topic:${x.topic}`;
      if (!nodes.has(id)) add({ id, name: x.topic, kind: 'topic', aliases: variants(x.topic), provenance: { source: 'code', status: 'verified', ...at(x) } });
      relation(kind === 'consumes' ? id : own, kind === 'consumes' ? own : id, kind, at(x), { technology: 'Kafka' });
    }
    for (const x of effective.tables || []) {
      let matches = resolve(x.table, 'table');
      if (!matches.length) { const id = add({ id: `table:unknown:${x.table}`, name: x.table, kind: 'table', aliases: [x.table], provenance: { source: 'code', status: 'verified', ...at(x) } }); matches = [nodes.get(id)]; }
      if (matches.length === 1) {
        relation(own, matches[0].id, x.access || 'uses', at(x), { technology: 'PostgreSQL' });
        if (matches[0].db) relation(own, `database:${matches[0].db}`, x.access || 'uses', at(x), { technology: 'PostgreSQL', label: `${x.access || 'uses'} ${x.table}`, table: x.table });
      }
      else relation(own, `candidate:${hash(x.table).slice(0, 12)}`, 'ambiguous-table', at(x), { candidates: matches.map(n => n.id) });
    }
    for (const x of [...(effective.calls || []), ...(p.http || [])]) {
      const target = x.client || x.target || '', matches = resolve(target, 'service');
      if (matches.length === 1) relation(own, matches[0].id, 'calls', at(x), { technology: 'HTTP', label: `${x.method || 'HTTP'} ${x.path || ''}`.trim() });
      else if (target) { const id = add({ id: `external:${target}`, name: target, kind: 'external', aliases: [target], provenance: { source: 'code', status: 'verified', ...at(x) } }); relation(own, id, 'calls', at(x), { technology: 'HTTP', label: `${x.method || 'HTTP'} ${x.path || ''}`.trim() }); }
    }
    for (const x of effective.dbCalls || []) { const matches = resolve(x.function || x.name, 'function'); if (matches.length === 1) relation(own, matches[0].id, 'calls', at(x), { technology: 'PostgreSQL' }); }
  }
  for (const e of require('./pgindex').load(env).edges || []) {
    const from = e.userKind === 'service' ? `service:${e.user}` : `${['function', 'procedure'].includes(e.userKind) ? 'function' : 'table'}:${e.db}:${e.user}`;
    const to = `${['function', 'procedure'].includes(e.targetKind) ? 'function' : 'table'}:${e.db}:${e.target}`;
    if (nodes.has(from) && nodes.has(to) && e.source === 'db') relation(from, to, e.role, { source: 'catalog:pg-usage', status: 'verified', where: e.where, detail: e.detail }, { technology: 'PostgreSQL' });
  }
  return { nodes: [...nodes.values()], relations, passports, gaps };
}

function build(env, { pages = docs.list(), systemModel } = {}) {
  const sys = systemModel || system(env), nodes = new Map(sys.nodes.map(n => [n.id, { ...n }])), relations = [...sys.relations], mentions = [], gaps = [...(sys.gaps || [])];
  const entities = [...nodes.values()], match = entityMatcher(entities);
  const byTitle = (title, space) => pages.filter(p => p.title === title && (!space || p.space === space));
  for (const p of pages) {
    const spaceId = `space:${p.space}`, pageId = `page:${p.id}`;
    nodes.set(spaceId, { id: spaceId, name: p.space, kind: 'space' }); nodes.set(pageId, { id: pageId, name: p.title, kind: 'page', space: p.space, url: p.url, version: p.version });
    relations.push({ from: spaceId, to: pageId, kind: 'contains', provenance: provenance(p) });
    for (const b of p.blocks) {
      nodes.set(b.id, { id: b.id, name: b.text.slice(0, 100), kind: 'block', pageId: p.id, provenance: provenance(p, b) });
      relations.push({ from: pageId, to: b.id, kind: 'contains', provenance: provenance(p, b) });
      const found = match(b.text);
      for (const m of found) { mentions.push({ ...m, ...provenance(p, b) }); if (m.entity) relations.push({ from: b.id, to: m.entity, kind: 'mentions', confidence: 'stated', provenance: provenance(p, b) }); }
      for (const explicit of b.text.matchAll(/([\w.-]+-service)\s+(?:calls?|invokes?)\s+([\w.-]+-service)/gi)) {
        const ids = [explicit[1], explicit[2]].map(name => {
          const matches = entities.filter(n => n.kind === 'service' && (n.aliases || [n.name]).some(a => a.toLowerCase() === name.toLowerCase()));
          if (matches.length === 1) return matches[0].id;
          const id = `external:${name}`;
          if (!nodes.has(id)) nodes.set(id, { id, name, kind: 'external', provenance: provenance(p, b), candidates: matches.map(n => n.id) });
          mentions.push({ name, entity: id, candidates: [id], ...provenance(p, b) }); return id;
        });
        relations.push({ from: ids[0], to: ids[1], kind: 'calls', label: 'calls (documented)', technology: 'HTTP', confidence: 'stated', provenance: provenance(p, b) });
      }
      // Only recognize explicit relation verbs between exact service names; plain co-occurrence is not an edge.
      const services = found.filter(m => m.entity && nodes.get(m.entity)?.kind === 'service');
      for (const a of services) for (const z of services) if (a.entity !== z.entity) {
        const re = new RegExp(`${escape(a.name)}\\s+(?:calls?|invokes?|sends?\\s+(?:HTTP\\s+)?requests?\\s+to)\\s+${escape(z.name)}`, 'i');
        if (re.test(b.text)) relations.push({ from: a.entity, to: z.entity, kind: 'calls', label: 'calls (documented)', technology: 'HTTP', confidence: 'stated', provenance: provenance(p, b) });
      }
      for (const a of services) for (const m of found.filter(m => m.entity && nodes.get(m.entity)?.kind === 'topic')) {
        for (const [verb, kind] of [['(?:consumes?|listens?\\s+to|subscribes?\\s+to)', 'consumes'], ['(?:produces?|publishes?\\s+to|emits?)', 'produces']]) if (new RegExp(`${escape(a.name)}\\s+${verb}\\s+${escape(m.name)}`, 'i').test(b.text)) relations.push({ from: kind === 'consumes' ? m.entity : a.entity, to: kind === 'consumes' ? a.entity : m.entity, kind, label: `${kind} (documented)`, technology: 'Kafka', confidence: 'stated', provenance: provenance(p, b) });
      }
    }
    for (const link of p.links || []) {
      const targets = link.id ? pages.filter(x => x.id === link.id) : byTitle(link.title, link.space);
      relations.push({ from: pageId, to: targets.length === 1 ? `page:${targets[0].id}` : `page-link:${link.space}:${link.title}`, kind: 'links', candidates: targets.length !== 1 ? targets.map(x => `page:${x.id}`) : undefined, provenance: provenance(p, p.blocks.find(b => b.id === link.blockId)) });
    }
    for (const inferred of p.inferredRelations || []) {
      const resolveName = name => entities.filter(n => (n.aliases || [n.name]).some(a => a.toLowerCase() === name.toLowerCase()));
      const from = resolveName(inferred.from), to = resolveName(inferred.to), b = p.blocks.find(b => b.id === inferred.blockId);
      if (!b) continue;
      const source = { ...provenance(p, b, 'docs:llm:inferred'), status: 'inferred', model: inferred.model };
      if (from.length === 1 && to.length === 1) relations.push({ from: inferred.kind === 'consumes' ? to[0].id : from[0].id, to: inferred.kind === 'consumes' ? from[0].id : to[0].id, kind: inferred.kind, label: `${inferred.kind} (inferred from docs)`, technology: inferred.technology, confidence: 'inferred', provenance: source });
      else mentions.push({ name: `${inferred.from} ${inferred.kind} ${inferred.to}`, candidates: [...from, ...to].map(n => n.id), ...source });
    }
    for (const [i, diagram] of (p.diagrams || []).entries()) {
      const diagramId = `diagram:${p.id}:${i}`, source = provenance(p, p.blocks.find(b => b.id === diagram.blockId), diagram.provenance || 'docs:diagram');
      if (diagram.attachment) Object.assign(source, { attachment: diagram.attachment, attachmentVersion: diagram.attachmentVersion, hash: diagram.hash });
      if (/inferred/.test(source.source)) source.status = 'inferred';
      nodes.set(diagramId, { id: diagramId, name: diagram.attachment || `Diagram ${i + 1}`, kind: 'diagram', provenance: source });
      relations.push({ from: pageId, to: diagramId, kind: 'contains', provenance: source });
      const mapping = new Map();
      for (const n of diagram.nodes || []) {
        const matches = match(n.label || n.name || n.id).filter(m => m.entity), unique = [...new Set(matches.map(m => m.entity))];
        const id = unique.length === 1 ? unique[0] : `${diagramId}:${n.id}`; mapping.set(n.id, id);
        if (unique.length === 1) mentions.push({ name: n.label || n.id, entity: id, candidates: unique, ...source });
        if (!nodes.has(id)) nodes.set(id, { id, name: n.label || n.name || n.id, kind: n.kind || 'external', candidates: unique, provenance: source });
        if (!unique.length) gaps.push({ kind: 'unlinked-diagram-element', element: n.label || n.id, message: 'Diagram element is absent from the cached system catalog', provenance: source });
        if (unique.length === 1 && nodes.get(id)?.kind === 'topic' && !sys.relations.some(r => ['produces', 'consumes'].includes(r.kind) && (r.from === id || r.to === id))) gaps.push({ kind: 'topic-without-passport-usage', element: n.label || n.id, message: 'Diagram topic has no producer or consumer in the cached service passports', provenance: source });
      }
      for (const e of diagram.relations || []) if (mapping.has(e.from) && mapping.has(e.to)) {
        const from = mapping.get(e.from), to = mapping.get(e.to), fromKind = nodes.get(from)?.kind, toKind = nodes.get(to)?.kind;
        const kind = e.kind || (toKind === 'topic' ? 'produces' : fromKind === 'topic' ? 'consumes' : ['table', 'database'].includes(toKind) ? /write|insert|update|delete/i.test(e.label || '') ? 'write' : /read|select/i.test(e.label || '') ? 'read' : 'uses' : 'calls');
        const technology = e.technology || (toKind === 'topic' || fromKind === 'topic' ? 'Kafka' : ['table', 'database'].includes(toKind) ? 'PostgreSQL' : /https?/i.test(e.label || '') ? 'HTTP' : undefined);
        relations.push({ ...e, from, to, kind, technology, confidence: source.status, provenance: source });
      }
    }
  }
  for (const r of relations.filter(r => r.confidence === 'stated' && !['mentions', 'links', 'contains'].includes(r.kind))) {
    const comparable = sys.relations.some(e => e.from === r.from && e.to === r.to && (e.kind === r.kind || r.kind === 'uses' || r.technology && e.technology === r.technology && !['read', 'write'].includes(r.kind)));
    if (!comparable) { r.conflict = true; gaps.push({ kind: 'not-supported-by-cached-code', from: r.from, to: r.to, relation: r.kind, message: 'Documented interaction has no matching relation in the cached code/passports. Check cache freshness and dynamic configuration before treating it as a contradiction.', provenance: r.provenance }); }
  }
  const unique = new Map(relations.map(r => [`${r.from}|${r.to}|${r.kind}|${r.confidence || ''}|${r.provenance?.blockId || ''}|${r.provenance?.where || ''}`, r]));
  const graph = { env, builtAt: new Date().toISOString(), nodes: [...nodes.values()], relations: [...unique.values()], mentions, gaps: [...new Map(gaps.map(g => [`${g.kind}|${g.from}|${g.to}|${g.element}|${g.provenance?.blockId || ''}`, g])).values()] };
  writeJson(path.join(docs.DIR, 'graph.json'), graph); writeJson(path.join(docs.DIR, `graph-${env}.json`), graph);
  return graph;
}

async function feature(text, { env = require('./config').envNames()[0], spaces, limit = 20, render = false } = {}) {
  limit = Math.max(1, Math.min(Number(limit) || 20, 20));
  const search = await require('./docs-search').search(text, { spaces, limit: Math.min(60, Math.max(20, limit * 3)) }), pages = docs.list(spaces);
  const sys = system(env), graph = build(env, { pages, systemModel: sys });
  const words = require('./docs-search').tokens(text).filter(w => w.length > 2 && !['how', 'does', 'work', 'the', 'and', 'with', 'what', 'why', 'when', 'where', 'who'].includes(w));
  // Blocks about the question: their context (page title, headings, text) has one of its words.
  const relevant = search.blocks.filter(b => !words.length || words.some(w => require('./docs-search').tokens(`${b.title} ${b.path.join(' ')} ${b.text}`).includes(w)));
  const relevantBlocks = new Set(relevant.map(b => b.id)), selectedPages = new Set(relevant.map(b => b.pageId));
  // Pages kept for history (legacy, archived, deprecated) are quoted after current ones and marked.
  const stale = new Set(pages.filter(p => /\b(legacy|archived?|deprecated|obsolete|superseded)\b/i.test(`${p.title} ${(p.labels || []).join(' ')}`)).map(p => p.id));
  let code = { hits: [] };
  try { if (words.length) code = require('./codeindex').grep(require('./codeindex').select(), words.map(escape).join('|'), { regex: true, tests: false, limit: 40, perFile: 3 }); } catch (e) { code.warning = e.message; }
  // Seeds: what the relevant blocks name, and services with an endpoint matching the question.
  const kindOf = new Map(graph.nodes.map(n => [n.id, n.kind]));
  // Statements seed the model; names that only appear in diagrams join it without bringing their own edges.
  const blockKind = new Map(relevant.map(b => [b.id, b.kind]));
  const mentioned = graph.mentions.filter(m => m.entity && relevantBlocks.has(m.blockId) && kindOf.get(m.entity) !== 'database');
  const seeds = new Set(mentioned.filter(m => blockKind.get(m.blockId) !== 'diagram').map(m => m.entity));
  const diagramOnly = new Set(mentioned.map(m => m.entity).filter(id => !seeds.has(id)));
  const endpointMatches = n => n.kind === 'endpoint' && words.some(w => n.name.toLowerCase().includes(w));
  for (const n of sys.nodes.filter(endpointMatches)) { seeds.add(n.id); seeds.add(`service:${n.service}`); }
  // One hop from each seed service over the edges a reader needs (topics, tables, other services);
  // services met that way show only that edge. Endpoints appear when they match the question.
  const KEEP = new Set(['produces', 'consumes', 'calls', 'read', 'write']);
  const selected = new Set([...seeds, ...diagramOnly]), keep = [];
  const allowed = r => KEEP.has(r.kind) && !['database', 'function'].includes(kindOf.get(r.from)) && !['database', 'function'].includes(kindOf.get(r.to)) || r.kind === 'exposes' && seeds.has(r.to);
  for (const r of sys.relations) if (allowed(r) && (seeds.has(r.from) && kindOf.get(r.from) === 'service' || seeds.has(r.to) && kindOf.get(r.to) === 'service')) { selected.add(r.from); selected.add(r.to); keep.push(r); }
  for (const r of sys.relations) if (allowed(r) && !keep.includes(r) && kindOf.get(r.from) !== kindOf.get(r.to) && (selected.has(r.from) && kindOf.get(r.from) === 'topic' || selected.has(r.to) && kindOf.get(r.to) === 'topic')) { selected.add(r.from); selected.add(r.to); keep.push(r); }
  for (const r of sys.relations) if (allowed(r) && !keep.includes(r) && selected.has(r.from) && selected.has(r.to)) keep.push(r);
  const documented = graph.relations.filter(r => ['stated', 'inferred'].includes(r.confidence) && !['contains', 'mentions', 'links'].includes(r.kind) && selectedPages.has(r.provenance?.pageId) && (selected.has(r.from) || selected.has(r.to)));
  for (const r of documented) { selected.add(r.from); selected.add(r.to); keep.push(r); }
  // One edge per pair, kind and provenance kind; repeated code sites stay in the first edge's provenance.
  const byKey = new Map();
  for (const r of keep) { const k = `${r.from}|${r.to}|${r.kind}|${r.confidence}`; if (!byKey.has(k)) byKey.set(k, r); else if (r.conflict) byKey.get(k).conflict = true; }
  const entryServices = [...new Set(sys.nodes.filter(n => selected.has(n.id) && endpointMatches(n)).map(n => `service:${n.service}`))];
  const client = entryServices.length ? [{ id: 'person:client', name: 'Client', kind: 'person', provenance: { source: 'code', status: 'verified', note: 'caller of the matching endpoints' } }] : [];
  const modelNodes = [...client, ...graph.nodes.filter(n => selected.has(n.id) && !['page', 'space', 'block', 'diagram', 'endpoint'].includes(n.kind))];
  const modelRelations = [...sys.nodes.filter(n => selected.has(n.id) && endpointMatches(n)).map(n => ({ from: 'person:client', to: `service:${n.service}`, kind: 'calls', label: n.name, technology: 'HTTP', confidence: 'verified', provenance: n.provenance })),
    ...[...byKey.values()].filter(r => r.kind !== 'exposes' && selected.has(r.from) && selected.has(r.to))];
  const evidence = [], seen = new Set(); let evidenceBytes = 0;
  // Headings, diagram sources and bare issue keys are context, not statements: they are not quoted.
  const quotable = b => !['heading', 'diagram', 'issue'].includes(b.kind);
  const ranked = [...relevant.filter(b => !stale.has(b.pageId)), ...relevant.filter(b => stale.has(b.pageId))].filter(quotable);
  for (const b of ranked) for (const quote of b.quotes || [b.text]) {
    const norm = quote.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (b.kind !== 'table-row' && quote.split(/\s+/).length < 4) continue; // "See Payments." and similar link lines
    if (!norm || quote.length > 1800 || evidenceBytes + Buffer.byteLength(quote) > 12000 || seen.has(norm) || [...seen].some(s => s.length > 60 && norm.length > 60 && (s.includes(norm) || norm.includes(s)))) continue;
    seen.add(norm); evidenceBytes += Buffer.byteLength(quote); evidence.push({ blockId: b.id, pageId: b.pageId, space: b.space, version: b.version, title: b.title, path: b.path, text: quote, url: b.url, ...(stale.has(b.pageId) ? { stale: true } : {}) });
    if (evidence.length >= Math.min(20, limit)) break;
  }
  evidence.splice(Math.min(20, limit));
  const flows = [];
  const serviceFlows = new Map();
  for (const p of sys.passports.filter(p => selected.has(`service:${p.service}`))) {
    let available = Array.isArray(p.flows) ? p.flows : [];
    // Full indexed flows retain method/file/line and the actual output edges of each entry point.
    if (typeof p.codeIndex === 'string' && require('./codeindex').load(p.codeIndex)) {
      try { const index = require('./codeindex').load(p.codeIndex); available = require('./flows').flows([p.codeIndex, ...(p.libraries || []).filter(l => l.index).map(l => l.index)], { config: require('./flows').serviceConfig(index.root) }); } catch {}
    }
    serviceFlows.set(p.service, available);
  }
  function appendOutputs(service, f, steps, visited = new Set(), depth = 0) {
    if (depth > 5 || visited.has(`${service}:${f.entry}`)) return;
    visited.add(`${service}:${f.entry}`);
    const own = 'service:' + service, out = f.out || {};
    const outputs = modelRelations.filter(r => r.from === own && r.confidence === 'verified' && (
      r.kind === 'produces' && (out.produces || []).some(x => r.to === `topic:${x.topic}`) ||
      ['write', 'read', 'uses'].includes(r.kind) && (out.tables || []).some(x => r.to.endsWith(':' + x.table) && (x.access || 'uses') === r.kind) ||
      r.kind === 'calls' && (out.http || []).some(x => !r.provenance?.where || x.at === r.provenance.where || x.call?.includes(r.label))
    ));
    for (const r of outputs) {
      steps.push(r);
      if (r.kind === 'produces') for (const consumer of modelRelations.filter(c => c.from === r.to && c.kind === 'consumes' && c.confidence === 'verified')) {
        steps.push(consumer);
        const target = consumer.to.slice('service:'.length), listeners = serviceFlows.get(target) || [];
        for (const listener of listeners.filter(l => l.topic === r.to.slice('topic:'.length) || l.entry === `kafka ${r.to.slice('topic:'.length)}`)) appendOutputs(target, listener, steps, visited, depth + 1);
      }
      if (r.kind === 'calls' && r.to.startsWith('service:')) {
        const target = r.to.slice('service:'.length), candidates = serviceFlows.get(target) || [];
        const route = value => String(value).replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '').toLowerCase();
        for (const next of candidates.filter(next => next.kind === 'http' && (route(next.entry) === route(r.label) || (out.http || []).some(call => route(call.call) === route(next.entry))))) appendOutputs(target, next, steps, visited, depth + 1);
      }
    }
  }
  const route = value => String(value).replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '').toLowerCase();
  const candidates = [];
  for (const [service, available] of serviceFlows) for (const f of available) {
    if (!words.some(w => `${f.entry} ${JSON.stringify(f.chain || [])}`.toLowerCase().includes(w))) continue;
    // Flow entries write path variables as {}; match the endpoint by route, then name the flow after it.
    const endpoint = sys.nodes.find(n => n.kind === 'endpoint' && n.service === service && route(n.name) === route(f.entry)), steps = [];
    if (endpoint) steps.push({ from: client.length ? 'person:client' : endpoint.id, to: 'service:' + service, label: endpoint.name, technology: 'HTTP', confidence: 'verified', provenance: endpoint.provenance });
    else if (f.topic) steps.push(...modelRelations.filter(r => r.from === `topic:${f.topic}` && r.to === 'service:' + service && r.kind === 'consumes'));
    appendOutputs(service, f, steps);
    const unique = [...new Map(steps.map(r => [`${r.from}|${r.to}|${r.kind || ''}|${r.label || ''}`, r])).values()];
    candidates.push({ name: endpoint?.name || f.entry, service, http: !!endpoint, chain: f.chain || f.via || [], steps: unique, source: Array.isArray(f.chain) ? 'codegraph' : 'passport-flow' });
  }
  // HTTP entry points first; a flow with nothing after its entry says nothing, and the same flow found twice is shown once.
  const signatures = new Set();
  for (const f of candidates.sort((a, b) => b.http - a.http || b.steps.length - a.steps.length)) {
    const signature = `${f.name}|${f.steps.map(r => `${r.from}>${r.to}`).join(',')}`;
    if (flows.length >= 5 || f.steps.length < 2 || signatures.has(signature)) continue;
    signatures.add(signature); flows.push(f);
  }
  if (!flows.length) for (const n of sys.nodes.filter(n => n.kind === 'endpoint' && selected.has(`service:${n.service}`) && endpointMatches(n)).slice(0, 5)) flows.push({ name: n.name, steps: [{ from: client.length ? 'person:client' : n.id, to: `service:${n.service}`, label: n.name, technology: 'HTTP', confidence: 'verified', provenance: n.provenance }], source: 'endpoint-only', note: 'No indexed flow is available; refresh the service passport for outputs and method chains.' });
  if (!flows.length) for (const p of pages.filter(p => selectedPages.has(p.id))) for (const d of p.diagrams || []) if (/sequenceDiagram|\bparticipant\b/.test(d.source || '') && flows.length < 5) {
    const steps = graph.relations.filter(r => r.provenance?.pageId === p.id && r.provenance?.blockId === d.blockId && r.provenance?.source === 'docs:diagram');
    if (steps.length) flows.push({ name: `Documented: ${p.title}`, steps, source: 'docs:diagram', note: 'Sequence is stated in documentation; no matching indexed code flow is available.' });
  }
  const model = { name: text, env, nodes: modelNodes, relations: modelRelations, flows }, D = require('./diagrams');
  const diagrams = [];
  for (const [view, name] of [['context', 'Context'], ['container', 'Container'], ...flows.map((f, i) => [`sequence:${i}`, `Sequence: ${f.name}`])]) {
    for (const format of ['mermaid', 'plantuml', 'structurizr']) {
      if (format === 'structurizr' && view !== 'container') continue; // one workspace holds every view
      const diagram = { name, view, format, source: D.write(model, { format, view }) };
      if (render && format === 'plantuml') { try { const result = await D.render(model, { ...docs.config().diagrams, format, view }); if (typeof result === 'string') diagram.svg = result; else Object.assign(diagram, { ...result, view }); } catch (e) { diagram.renderError = e.message; } }
      diagrams.push(diagram);
    }
  }
  const checked = require('./docs-search').verify(evidence), gaps = graph.gaps.filter(g => selectedPages.has(g.provenance?.pageId) || selected.has(g.from) || selected.has(g.to));
  const view = require('./results').saveView('diagram', { model, diagrams, evidence: checked, gaps }, { title: text, env });
  return { text, env, pages: [...selectedPages], evidence: checked, code: { hits: code.hits || [], warning: code.warning }, model, diagrams, gaps, view, quoteRule: 'Quote only the exact evidence text with its blockId and page link. Verify additional quotes with docs_verify. Dashed/stated relations come from documentation; missing cached code support is a gap, not proof of absence.', search: { mode: search.mode, total: search.total, warnings: search.warnings } };
}

module.exports = { system, build, feature, variants, entityMatcher };
