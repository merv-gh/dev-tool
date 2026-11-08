// Model previews are byte-bounded; the saved inline view always retains original evidence.
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
function compact(value, budget = 16384) {
  const out = { ...value, format: 'compact', detail: 'Full evidence is retained at view. Use format:"full" or narrow limit/maxPaths for original JSON.', omitted: {} };
  for(const key of ['gaps','dependencies','ambiguity'])if(Array.isArray(out[key]))out[key]=out[key].slice();
  const shortCode = node => {
    const n = pick(node, ['name', 'signature', 'file', 'line', 'label', 'code', 'inCondition', 'repo', 'sha']);
    if (typeof n.code === 'string' && n.code.length > 400) { n.code = n.code.slice(0, 400); n.codeTruncated = true; out.previewTruncated = true; }
    return n;
  };
  const path = item => {
    const p = pick(item, ['kind', 'analysisId', 'proof', 'truncated', 'caveats', 'conditions', 'gaps', 'boundaries']);
    for(const key of ['conditions','gaps','boundaries'])if(Array.isArray(p[key]))p[key]=p[key].slice();
    if (item.nodes) p.nodes = item.nodes.map(shortCode);
    if (item.edges) p.edges = item.edges.map(e => pick(e, ['kind', 'certainty', 'nature']));
    if (item.segments) p.segments = item.segments.map(s => ({ ...pick(s, ['id', 'analysisId', 'status', 'from', 'to', 'ms']), paths: (s.paths || []).map(path) }));
    return p;
  };
  if (out.analyses) out.analyses = out.analyses.map(a => pick(a, ['id', 'repo', 'sha', 'ref', 'revisionKey', 'sourceDigest', 'workspace', 'state', 'language', 'sources', 'coverage', 'reused']));
  if (out.coverage) out.coverage = out.coverage.map ? out.coverage.map(c => ({ ...pick(c, ['analysisId', 'side']), ...(c.summary ? { counts: c.summary.counts, truncated: c.summary.truncated, gaps: c.summary.gaps } : { analyses: c.analyses?.map(a => ({ analysisId: a.analysisId, truncated: a.summary?.truncated, gaps: a.summary?.gaps })) }) })) : out.coverage;
  if (out.results) out.results = out.results.map(r => {
    if (r.nodes || r.segments) return path(r);
    if (r.category === 'data-flow') return { category: r.category, change: r.change, ...(r.before ? { before: path(r.before) } : {}), ...(r.after ? { after: path(r.after) } : {}) };
    if (r.parameters) return { ...pick(r, ['id', 'kind', 'name', 'signature', 'file', 'line', 'repo', 'sha', 'analysisId']), parameters: r.parameters.filter(p => p.index > 0).map(p => pick(p, ['name', 'index', 'type'])) };
    return r;
  });
  const size = () => Buffer.byteLength(JSON.stringify(out));
  // Preserve summary/proof/continuation before detail arrays. Every omission is explicit.
  const remove = (object, key, label, minimum = 0) => {
    const a = object[key]; if (!Array.isArray(a) || a.length <= minimum) return false;
    a.pop(); out.omitted[label] = (out.omitted[label] || 0) + 1; out.previewTruncated = true; return true;
  };
  while (size() > budget) {
    if (remove(out, 'results', 'results', 1)) continue;
    const shrink = item => {
      for (const key of ['segments', 'boundaries', 'edges', 'conditions']) if (remove(item, key, key)) return true;
      if (item.nodes?.length>2) { item.nodes.splice(item.nodes.length-2,1); item.nodesOmitted = (item.nodesOmitted || 0) + 1; out.omitted.nodes=(out.omitted.nodes||0)+1;out.previewTruncated=true;return true; }
      if (item.before && shrink(item.before)) return true;
      if (item.after && shrink(item.after)) return true;
      return false;
    };
    if (out.results?.some(shrink)) continue;
    if (remove(out, 'coverage', 'coverage') || remove(out, 'dependencies', 'dependencies') || remove(out, 'ambiguity', 'ambiguity') || remove(out, 'gaps', 'gaps', 1) || remove(out, 'analyses', 'analyses', 2)) continue;
    if (remove(out, 'results', 'results')) continue;
    // Rare oversized metadata: keep the immutable selectors, proof and counts;
    // every removed field is listed and available in the retained full result.
    const key = Object.keys(out).find(k => !['protocol', 'operation', 'mode', 'job', 'state', 'revisionSet', 'view', 'proof', 'total', 'truncated', 'nextCursor', 'format', 'detail', 'omitted', 'previewTruncated'].includes(k) && JSON.stringify(out[k]).length > 800);
    if (key) { out.omitted[key] = Array.isArray(out[key]) ? out[key].length : 1; delete out[key]; out.previewTruncated = true; continue; }
    break;
  }
  if (!Object.keys(out.omitted).length) delete out.omitted;
  return out;
}
module.exports = { compact };
