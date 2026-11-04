// Bounded C4 and operational projections over the existing indexed estate.
// No implicit parser, live query, transport inference or publication happens here.
const crypto = require('node:crypto');
const C = require('./config'), Store = require('./architecture-store'), O = require('./architecture-observations');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const family = name => String(name).split(/[-_.]/)[0] || 'other';
const kind = value => ({ postgres: 'database', kafka: 'topic', elasticsearch: 'database', 'ui-repository': 'ui' })[value] || value;
function deployments(service, snapshots, envs) {
  return Object.fromEntries(envs.map(env => {
    const snapshot = snapshots[env], found = snapshot.consul?.services?.[service], at = found?.observedAt || snapshot.consul?.syncedAt || null;
    const instances = (found?.instances || []).slice(0, 500).map((i, index) => ({ id: String(i.id || `${i.node}:${i.address}:${i.port}:${index}`), node: i.node, address: i.address, port: i.port, datacenter: i.datacenter,
      status: ['passing','warning','critical'].includes(i.status) ? i.status : 'unknown', tags: i.tags || [], meta: i.meta || {}, checks: i.checks || [], version: i.meta?.version || i.meta?.build_version || null, commit: i.meta?.commit || i.meta?.git_commit || null }));
    return [env, { env, at, known: !!found && !found.error, stale: !!(found?.stale || snapshot.consul?.stale) || !at || !Number.isFinite(Date.parse(at)) || Date.now() - Date.parse(at) > Number(O.config().staleAfterMs || 300000), total: found?.instances?.length ?? null,
      passing: (found?.instances || []).filter(i => i.status === 'passing').length, warning: (found?.instances || []).filter(i => i.status === 'warning').length, critical: (found?.instances || []).filter(i => i.status === 'critical').length,
      instances, truncated: (found?.instances?.length || 0) > instances.length, error: found?.error ? 'Consul service refresh failed' : null }];
  }));
}
function ancestors(node, nodes) {
  const seen = new Set(), out = []; let parent = node?.parent;
  while (parent && nodes.has(parent) && !seen.has(parent)) { seen.add(parent); const value = nodes.get(parent); out.push(value); parent = value.parent; }
  return out;
}
function descendants(id, nodes) { return [...nodes.values()].filter(n => n.id === id || ancestors(n, nodes).some(p => p.id === id)); }
async function project(args = {}) {
  const env = args.env || C.envNames()[0]; C.getEnv(env);
  const envs = [...new Set([env, ...(args.envs || C.envNames()).filter(e => e !== env)])].slice(0, 4); envs.forEach(e => C.getEnv(e));
  let heads = args.sourceDocuments || Store.list({ limit: 1000 }).documents.map(d => ({ id: d.id, revision: d.revision }));
  const selected = args.document ? Store.get(args.document, args.revision || heads.find(d => d.id === args.document)?.revision) : null;
  if (selected) heads = [{ id: selected.id, revision: selected.revision }, ...heads.filter(d => d.id !== selected.id)];
  const documents = []; let documentBytes = 0, documentBudget = false;
  for (const h of heads) { const record = selected?.id === h.id ? selected : Store.get(h.id,h.revision); documentBytes += Buffer.byteLength(JSON.stringify(record.document)); if (documentBytes > 16 * 1024 * 1024) { documentBudget = true; break; } documents.push(record); }
  const savedView = selected?.document.views.find(v => v.id === args.saved_view);
  const type = args.type || savedView?.type || 'landscape'; if (!Store.TYPES.includes(type)) throw Error('Unknown architecture view type');
  const focus = args.focus || savedView?.focus || null, limit = Math.max(10, Math.min(250, Number(args.limit) || 100));
  const nodes = new Map(), relations = [], gaps = [], snapshots = Object.fromEntries(envs.map(e => [e, O.snapshot(e)]));
  const add = n => { if (!nodes.has(n.id)) nodes.set(n.id, { ...n, name: n.name || n.label || n.id, description: n.description || n.detail || '', kind: kind(n.kind), evidence: n.evidence || [], parent: n.parent || null }); };
  // Preserve the existing map's exact evidence and environment binding. Prefix
  // hierarchy and suggested log targets are navigation, not architectural calls.
  let omittedSourceNodes = 0;
  for (const current of envs) {
    const graph = await require('./service-map').graph(current);
    for (let i = 0; i < graph.count; i++) {
      const n = graph.node(i); if (['prefix','elk','feature'].includes(n.kind)) continue;
      if (!args.include_libraries && n.kind === 'library' && type !== 'component') continue;
      if (nodes.size >= 10000 && !nodes.has(n.id)) { omittedSourceNodes++; continue; }
      add({ ...n, source: n.source || 'catalog', evidence: n.revision ? [`${n.repo}@${n.revision}`] : [] });
    }
    for (let i = 0; i < graph.edgeCount && relations.length < 40000; i++) {
      const edge = graph.edge(i); if (['contains','inspect-logs','includes'].includes(edge.kind) || edge.certainty === 'suggested') continue;
      const from = graph.node(edge.from).id, to = graph.node(edge.to).id;
      if (!nodes.has(from) || !nodes.has(to)) continue;
      relations.push({ id: 'indexed:' + hash([current, from, to, edge.kind, edge.where]), from, to, label: edge.kind, certainty: edge.certainty, envs: [current], evidence: [edge.where, edge.evidence].filter(Boolean), source: 'indexed', fields: [] });
    }
    for (const service of Object.keys(snapshots[current].consul?.services || {})) {
      if (nodes.size >= 10000 && !nodes.has('svc:' + service)) { omittedSourceNodes++; continue; }
      add({ id: 'svc:' + service, name: service, service, kind: 'service', source: 'consul', description: 'Registered in Consul; code coverage may be unavailable' });
    }
    gaps.push(...(snapshots[current].gaps || []).map(g => ({ ...g, env: current })));
  }
  if (documentBudget) gaps.push({ kind: 'knowledge-budget', message: 'Shared architecture projection reached its 16 MiB input budget; select a document explicitly to prioritize it.' });
  if (omittedSourceNodes) gaps.push({ kind: 'estate-budget', message: `${omittedSourceNodes} source nodes omitted by the 10000-node estate budget` });
  for (const record of documents) {
    const d = record.document;
    for (const n of d.nodes) {
      if (nodes.size >= 10000 && !nodes.has(n.id)) { omittedSourceNodes++; continue; }
      const old = nodes.get(n.id);
      if (old && old.kind !== n.kind && !(old.kind === 'database' && n.kind === 'table')) { gaps.push({ kind: 'declared-type-conflict', node: n.id, document: record.id }); continue; }
      if (old?.parent && n.parent && old.parent !== n.parent) { gaps.push({ kind: 'declared-parent-conflict', node: n.id, document: record.id }); continue; }
      add({ ...n, source: 'declared' });
      Object.assign(nodes.get(n.id), { ...n, evidence: [...(old?.evidence || []), ...n.evidence, ...d.evidence], declaration: { document: record.id, revision: record.revision }, source: old?.source || 'declared' });
    }
    d.relations.slice(0,Math.max(0,40000-relations.length)).forEach((r, i) => relations.push({ ...r, id: `declared:${record.id}:${i}`, certainty: 'declared', source: 'global knowledge', document: record.id, revision: record.revision }));
  }
  if (omittedSourceNodes && !gaps.some(g => g.kind === 'estate-budget')) gaps.push({ kind: 'estate-budget', message: 'Source estate reached the 10000-node projection budget; focus a shared document to prioritize its declarations.' });
  for (const n of nodes.values()) {
    if (n.kind === 'service' || n.service) { n.service ||= n.id.replace(/^svc:/, ''); n.deployments = deployments(n.service, snapshots, envs); }
    if (n.parent && !nodes.has(n.parent)) gaps.push({ kind: 'parent-unresolved', node: n.id, parent: n.parent });
    if (ancestors(n, nodes).some(p => p.id === n.id)) gaps.push({ kind: 'parent-cycle', node: n.id });
    n.metrics = envs.flatMap(e => snapshots[e].resources.filter(r => r.target === n.id || r.id === n.id).map(r => ({ ...r, env: e, stale: r.stale || snapshots[e].stale })));
  }
  const visibleEdges = relations.filter(r => (!r.envs?.length || r.envs.includes(env)) && (args.include_candidates || !['candidate','unresolved-target'].includes(r.certainty)));
  let picked = [], edges = [], flow = null, groups = [], selectionTotal = 0;
  const ensure = (id, record) => { if (!nodes.has(id)) { add({ id, name: id, kind: 'external', source: 'unresolved', description: 'Referenced by a declared flow; entity identity is unresolved', evidence: record?.evidence || [] }); gaps.push({ kind: 'flow-entity-unresolved', node: id }); } return nodes.get(id); };
  if (type === 'dynamic' || type === 'dataflow') {
    const owner = selected || documents.find(d => d.document.flows.some(f => !args.flow || f.id === args.flow));
    flow = owner?.document.flows.find(f => !args.flow || f.id === args.flow) || null;
    if (flow) {
      const steps = flow.steps.filter(r => !r.envs.length || r.envs.includes(env));
      edges = steps.map((r, i) => ({ ...r, id: 'step:' + i, order: i + 1, certainty: 'declared', source: 'global knowledge', document: owner.id, revision: owner.revision }));
      picked = [...new Set(steps.flatMap(s => [s.from, s.to]))].map(id => ensure(id, owner.document));
      if (type === 'dataflow' && steps.some(s => !s.fields.length)) gaps.push({ kind: 'field-mappings-missing', message: 'Some declared steps have no field mappings. This view does not establish end-to-end value flow.' });
      flow = { ...flow, document: owner.id, revision: owner.revision };
    } else gaps.push({ kind: 'flow-missing', message: 'Publish a named feature flow to show ordered interactions and data mappings.' });
  } else if (type === 'landscape') {
    const members = new Map();
    for (const n of nodes.values()) if (n.kind === 'service' || n.kind === 'ui') {
      const system = ancestors(n, nodes).find(p => p.kind === 'system'), id = system?.id || 'family:' + family(n.service || n.name);
      if (!members.has(id)) members.set(id, { id, name: system?.name || family(n.service || n.name), kind: 'group', grouping: system ? 'declared system' : 'name prefix, not a system boundary', source: system ? 'global knowledge' : 'navigation', members: [] });
      members.get(id).members.push(n.id);
    }
    picked = [...members.values()].map(group => ({ ...group, memberCount: group.members.length, members: group.members.slice(0, 1000), deployments: Object.fromEntries(envs.map(e => [e, {
      env: e, services: group.members.length, observed: group.members.filter(id => nodes.get(id).deployments?.[e]?.known).length,
      total: group.members.reduce((sum, id) => sum + (nodes.get(id).deployments?.[e]?.total || 0), 0),
      passing: group.members.reduce((sum, id) => sum + (nodes.get(id).deployments?.[e]?.passing || 0), 0),
      critical: group.members.reduce((sum, id) => sum + (nodes.get(id).deployments?.[e]?.critical || 0), 0),
      warning: group.members.reduce((sum, id) => sum + (nodes.get(id).deployments?.[e]?.warning || 0), 0),
    }])) }));
    // No rolled-up dependency arrows based on names. Drill into evidence instead.
  } else if (type === 'context') {
    picked = [...nodes.values()].filter(n => ['system','person','external'].includes(n.kind));
    const toSystem = id => { const n = nodes.get(id); return ['system','person','external'].includes(n?.kind) ? n.id : ancestors(n, nodes).find(p => p.kind === 'system')?.id; };
    const aggregated = new Map();
    for (const edge of visibleEdges) {
      const from = toSystem(edge.from), to = toSystem(edge.to); if (!from || !to || from === to) continue;
      const key = [from, to, edge.label, edge.certainty].join('\0');
      if (!aggregated.has(key)) aggregated.set(key, { ...edge, id: 'context:' + hash(key), from, to, evidence: [], supportingRelations: 0 });
      const value = aggregated.get(key); value.supportingRelations++; value.evidence.push(...edge.evidence.slice(0, 2)); value.evidence = [...new Set(value.evidence)].slice(0, 10);
    }
    edges = [...aggregated.values()];
    if (focus) { const adjacent = new Set([focus, ...edges.filter(e => e.from === focus || e.to === focus).flatMap(e => [e.from,e.to])]); picked = picked.filter(n => adjacent.has(n.id)); }
    const count = [...nodes.values()].filter(n => n.kind === 'service' && !ancestors(n, nodes).some(p => p.kind === 'system')).length;
    if (count) gaps.push({ kind: 'system-boundary-unknown', message: `${count} services have no declared software-system boundary and are omitted at C4 context level.` });
  } else {
    let seeds = focus?.startsWith('family:') ? [...nodes.values()].filter(n => ['service','ui'].includes(n.kind) && family(n.service || n.name) === focus.slice(7)) : focus && nodes.has(focus) ? descendants(focus, nodes) : [...nodes.values()].filter(n => n.kind === 'service');
    if (savedView?.nodes.length) seeds = savedView.nodes.map(id => ensure(id, selected.document));
    if (type === 'component') {
      if (!focus || !nodes.has(focus) || nodes.get(focus).kind !== 'service') seeds = seeds.filter(n => ['component','library'].includes(n.kind));
      else {
        const service = nodes.get(focus), p = require('./passport').loadDetected(service.service, { env });
        for (const endpoint of (p?.effective?.endpoints || []).slice(0, 200)) {
          const id = 'component:' + hash([focus, endpoint.handler, endpoint.file]);
          add({ id, name: endpoint.handler || endpoint.path, kind: 'component', parent: focus, technology: endpoint.method + ' HTTP handler', description: endpoint.path, source: 'passport', evidence: [endpoint.file ? endpoint.file + ':' + (endpoint.line || '?') : 'Source location unavailable', p.repo?.sha].filter(Boolean) });
        }
        seeds = descendants(focus, nodes).filter(n => ['component','library'].includes(n.kind));
      }
    }
    if (type !== 'component') seeds = seeds.filter(n => !['component','system','person'].includes(n.kind));
    const terms = String(args.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) seeds = seeds.filter(n => terms.every(t => `${n.name} ${n.description} ${n.id} ${n.repo || ''}`.toLowerCase().includes(t)));
    selectionTotal = seeds.length; const entityLimit = type === 'deployment' ? Math.max(1,Math.floor(limit/3)) : limit;
    const ids = new Set(seeds.slice(0, entityLimit).map(n => n.id));
    const levelEdges = visibleEdges.filter(e => [e.from,e.to].every(id => type === 'component' ? ['component','library'].includes(nodes.get(id)?.kind) : !['component','system','person'].includes(nodes.get(id)?.kind)));
    for (const edge of levelEdges) if (ids.size < entityLimit && (ids.has(edge.from) || ids.has(edge.to))) { if (nodes.has(edge.from)) ids.add(edge.from); if (ids.size < entityLimit && nodes.has(edge.to)) ids.add(edge.to); }
    picked = [...ids].map(id => nodes.get(id)); edges = levelEdges.filter(e => ids.has(e.from) && ids.has(e.to));
    if (type === 'deployment') {
      const replicas = [];
      for (const n of picked.filter(n => n.deployments)) for (const i of n.deployments[env].instances) {
        if (picked.length + replicas.length >= limit) break;
        const id = 'instance:' + hash([env, n.id, i.id]); replicas.push({ ...i, id, name: i.id, kind: 'replica', parent: n.id, env, source: 'consul', service: n.service, observedAt: n.deployments[env].at, stale: n.deployments[env].stale });
        edges.push({ id: 'registration:' + id, from: n.id, to: id, label: 'registered instance', certainty: 'observed', source: 'consul', evidence: [env, n.deployments[env].at].filter(Boolean), envs: [env], fields: [] });
      }
      picked.push(...replicas);
    }
    const groupMap = new Map();
    for (const n of picked) {
      if (n.kind === 'system') continue;
      const parent = n.parent && nodes.get(n.parent), groupId = parent?.id || (n.kind === 'service' ? 'family:' + family(n.service || n.name) : null);
      if (!groupId || n.kind === 'replica') continue;
      if (!groupMap.has(groupId)) groupMap.set(groupId, { id: groupId, name: parent?.name || family(n.name) + ' · prefix group', kind: parent?.kind || 'family', declared: !!parent, members: [] });
      groupMap.get(groupId).members.push(n.id);
    }
    groups = [...groupMap.values()];
  }
  const total = Math.max(picked.length, selectionTotal);
  if (picked.length > limit) picked = picked.slice(0, limit);
  const pickedIds = new Set(picked.map(n => n.id)); edges = edges.filter(e => pickedIds.has(e.from) && pickedIds.has(e.to));
  const edgeTotal = edges.length; edges = edges.slice(0, 500);
  const services = [...nodes.values()].filter(n => n.kind === 'service');
  const summary = Object.fromEntries(envs.map(e => [e, { services: Object.keys(snapshots[e].consul?.services || {}).length, replicas: services.reduce((sum,n) => sum + (n.deployments?.[e]?.total || 0), 0), passing: services.reduce((sum,n) => sum + (n.deployments?.[e]?.passing || 0), 0), critical: services.reduce((sum,n) => sum + (n.deployments?.[e]?.critical || 0), 0), warning: services.reduce((sum,n) => sum + (n.deployments?.[e]?.warning || 0), 0), staleServices: services.filter(n => n.deployments?.[e]?.total != null && n.deployments[e].stale).length, at: snapshots[e].consul?.syncedAt || null } ]));
  return { protocol: 'dt.architecture/v1', title: selected?.document.title || 'Architecture observatory', type, env, envs, focus, at: new Date().toISOString(),
    document: selected ? { id: selected.id, revision: selected.revision, ...selected.document, author: selected.author, publishedAt: selected.at } : null,
    sourceDocuments: heads, nodes: picked, relations: edges, groups, flow, documents: Store.list({ limit: 1000 }).documents,
    summary, estate: { nodes: nodes.size, services: services.length, relations: relations.length }, total, truncated: total > limit || edgeTotal > 500,
    resources: envs.flatMap(e => snapshots[e].resources.map(r => ({ ...r, env: e, stale: r.stale || snapshots[e].stale }))), gaps: gaps.slice(0, 100),
    guidance: 'Declared explanations and static connections are distinct from observed deployment health and optional Joern value evidence. Name-prefix families are navigation groups, not C4 system boundaries.' };
}
function present(model) { return { protocol: model.protocol, type: model.type, env: model.env, title: model.title, document: model.document ? { id: model.document.id, revision: model.document.revision } : null, nodes: model.nodes.length, relations: model.relations.length, estate: model.estate, gaps: model.gaps, truncated: model.truncated, ...(model.semantic ? { job: model.semantic.job, state: model.semantic.state, semantic: { proof: model.semantic.proof, gaps: model.semantic.gaps } } : {}), view: require('./results').saveView('architecture', model, { title: model.title }, { page: 'architecture' }) }; }
module.exports = { project, present, deployments };
