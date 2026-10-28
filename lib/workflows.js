// Versioned planning data, independent of any search engine, language or worker.
// These recipes suggest evidence stages; they never execute actions or diagnose.
const fs = require('fs'), path = require('path');
const builtin = require('./workflow-guides.json');
const { terms } = require('./tool-search');
function definitions() {
  const guides = new Map(builtin.guides.map(g => [g.id, g]));
  const dir = path.join(require('./config').HOME, 'workflows');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => /^[\w-]+\.json$/.test(f)).sort()) {
    const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    require('./schema').assert(v, { type: 'object', additionalProperties: false, required: ['version', 'guides'], properties: { version: { const: 1 }, guides: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'terms', 'required', 'stages', 'boundaries'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' }, title: { type: 'string', maxLength: 160 }, terms: { type: 'string', maxLength: 2000 }, required: { type: 'array', items: { type: 'string' }, maxItems: 20 }, boundaries: { type: 'array', items: { type: 'string' }, maxItems: 20 }, stages: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'goal', 'tools'], additionalProperties: false, properties: { id: { type: 'string' }, goal: { type: 'string', maxLength: 500 }, tools: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' } } } } } } } } } });
    for (const g of v.guides) guides.set(g.id, g);
  }
  return [...guides.values()];
}
function suggest(query, tools, limit = 2) {
  const words = new Set(terms(query)), enabled = new Set(tools.map(t => t.name));
  if (!enabled.has('workflow_plan')) return [];
  return definitions().map(g => { const vocabulary = new Set(terms(g.terms)); return { g, matched: [...words].filter(w => vocabulary.has(w)) }; })
    .filter(x => x.matched.length >= 2 || query.trim() === x.g.id)
    .sort((a, b) => b.matched.length - a.matched.length || a.g.id.localeCompare(b.g.id)).slice(0, limit)
    .map(({ g, matched }) => ({ id: g.id, title: g.title, matchedTerms: matched.slice(0, 8), first: g.stages[0].tools.filter(n => enabled.has(n)), next: { tool: 'tool_describe', args: { name: 'workflow_plan' } }, planArguments: { id: g.id } }));
}
function plan(id, tools) {
  const all = definitions(), guide = all.find(g => g.id === id);
  if (!guide && id) throw Object.assign(new Error(`Unknown workflow ${id}; omit id to list guides`), { code: 'DT_WORKFLOW_UNKNOWN' });
  if (!guide) return { version: 1, kind: 'planning-guides', guides: all.map(({ id, title }) => ({ id, title })), executionPerformed: false };
  const enabled = new Set(tools.map(t => t.name));
  const stages = guide.stages.map(s => ({ ...s, tools: s.tools.filter(n => enabled.has(n)), unavailable: s.tools.filter(n => !enabled.has(n)) }));
  return { version: 1, kind: 'planning-guide', id: guide.id, title: guide.title, required: guide.required, stages, boundaries: guide.boundaries, executionPerformed: false, coverage: 'Named enabled tools are candidates, not a guarantee their configured backend, target or runtime capability is available. Inspect each schema and preflight.' };
}
function bounded(result, maxBytes = 4096) {
  if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result;
  const original = structuredClone(result), r = structuredClone(result);
  try { r.view = require('./results').saveView('json', original, { title: 'Discovery results' }); } catch {}
  r.truncated = true; r.omitted = { tools: 0, workflows: 0 }; r.outputBudgetBytes = maxBytes;
  for (const t of r.tools) if (t.description.length > 180) { t.description = t.description.slice(0, 180); t.descriptionTruncated = true; }
  while (Buffer.byteLength(JSON.stringify(r)) > maxBytes && (r.tools.length || r.workflows?.length)) {
    if ((r.tools.length > 2 || !r.workflows?.length) && r.tools.length) { r.tools.pop(); r.omitted.tools++; }
    else { r.workflows.pop(); r.omitted.workflows++; }
  }
  if (Buffer.byteLength(JSON.stringify(r)) > maxBytes) r.lexical = { mode: r.lexical.mode, ranker: r.lexical.ranker, truncated: true };
  return r;
}
module.exports = { definitions, suggest, plan, bounded };
