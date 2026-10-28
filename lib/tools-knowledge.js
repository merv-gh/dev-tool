module.exports = ({ str, int, env }) => {
  const K = () => require('./semantic-knowledge');
  const options = { env, includeConfluence: { type: 'boolean', default: false, description: 'Include already cached Confluence text; no mirror/API required' } };
  const searchSchema = {
    type: 'object', required: ['revision', 'total', 'results', 'runtimeVerified'],
    properties: {
      revision: { type: 'string' }, total: { type: 'integer', minimum: 0 }, runtimeVerified: { const: false },
      results: { type: 'array', maxItems: 50, items: {
        type: 'object', required: ['id', 'text'], anyOf: [{ required: ['evidence'] }, { required: ['provenance'] }],
        properties: { id: { type: 'string' }, text: { type: 'string', maxLength: 1200 }, evidence: { type: 'array' }, provenance: { type: 'object' } },
      } },
    },
  };
  return [
    { name: 'knowledge_sources', group: 'knowledge', description: 'Inspect independent knowledge providers, cached revisions, update failures and semantic conventions. Works without Confluence. Configured local JSON, Markdown, OpenAPI and AsyncAPI sources update individually; system passports/catalogs are included automatically.', input: {}, run: () => K().status() },
    { name: 'knowledge_sync', group: 'knowledge', description: 'Update one configured local knowledge source, or all configured sources. Content-addressed revisions preserve history; errors retain the last good revision and remain explicit gaps. Reads configured paths only; does not query live systems or require a Confluence mirror.', input: { source: str('Configured source id; omit for all') }, run: a => K().sync(a.source) },
    { name: 'knowledge_search', group: 'knowledge', description: 'Search cached semantic entities, contracts and documentation across independently updated sources. Returns exact excerpts, stable ids and source revisions. Documentation claims are stated evidence; indexed code/catalog facts are separate from runtime proof.', input: { query: str('Technical name or question keywords'), ...options, limit: { ...int('Max matches', 15), minimum: 1, maximum: 50 } }, required: ['query'], adapterSchema: searchSchema, run: a => K().search(a.query, a) },
    { name: 'knowledge_verify', group: 'knowledge', description: 'Verify exact quoted text against a cached source revision independently of graph/search. Ellipsis-separated pieces must occur in order. Historical normalized/Markdown/contract revisions remain checkable by source and revision; retrieved text never establishes runtime proof.', input: { ...options, quotes: { type: 'array', maxItems: 50, items: { type: 'object', properties: { document: str('Stable document id'), text: str('Exact quotation'), source: str('Source id for historical revision'), revision: str('Exact source revision') }, required: ['document', 'text'] } } }, required: ['quotes'], run: a => K().verify(a.quotes, a) },
    { name: 'knowledge_graph', group: 'knowledge', description: 'Visualize a bounded semantic neighborhood across services, endpoints, data, events and documentation. Select an exact entity id or search, then inspect directional verbs and source/version evidence. View is on by default, works offline without Confluence, and preserves ambiguity instead of guessing. Indexed evidence is not runtime proof.', input: { ...options, q: str('Entity words, optional'), entity: str('Exact entity id or unambiguous alias'), hops: { ...int('Relationship hops', 1), minimum: 0, maximum: 4 }, limit: { ...int('Max entities', 150), minimum: 1, maximum: 500 }, kinds: { type: 'array', items: { type: 'string' }, description: 'Optional seed entity kinds' } }, adapterSchema: require('../contracts/v1/knowledge-graph.schema.json'), run: a => K().query(a), present: (r, a) => {
      const view = require('./results').saveView('knowledge-map', r, { title: a.entity || a.q || 'System knowledge', env: r.env });
      return { env: r.env, revision: r.revision, total: r.total, shown: r.nodes.length, relations: r.relations.length, truncated: r.truncated, complete: r.complete, runtimeVerified: false, sources: r.sources, nodes: r.nodes.slice(0, 20).map(n => ({ id: n.id, name: n.name, kind: n.kind })), candidates: r.candidates, gaps: r.gaps.slice(0, 40), gapsTotal: r.gapsTotal ?? r.gaps.length, view, next: 'Use knowledge_entity for exact evidence or knowledge_graph entity=<id> to focus.' };
    } },
    { name: 'knowledge_entity', group: 'knowledge', description: 'Inspect one exact semantic entity and every directly connected indexed/stated relation with provenance. Ambiguous aliases return candidates; no match is fabricated. Use knowledge_graph to view its neighborhood.', input: { ...options, id: str('Exact entity id or unambiguous alias') }, required: ['id'], run: a => { const r = K().query({ ...a, entity: a.id, hops: 1, limit: 100 }); return { ...r, documents: r.documents.map(d => ({ ...d, text: d.text.slice(0, 3000) })) }; } },
  ];
};
