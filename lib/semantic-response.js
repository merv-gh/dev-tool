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
    const p = pick(item, ['kind', 'analysisId', 'side', 'layer', 'assumptionEvaluation', 'proof', 'truncated', 'caveats', 'conditions', 'gaps', 'boundaries']);
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
  if (out.flowMap) {
    const m = out.flowMap;
    const states=new Map(m.nodes.map((n,i)=>[n.id,'s'+i])),methods=new Map(m.methods.map((n,i)=>[n.id,'m'+i]));
    out.flowMap = { ...pick(m, ['protocol', 'counts', 'complete', 'assumptions']), identity:'Local preview aliases; exact CPG/state identities and source locators are retained at view.',entries:m.entries.map(id=>states.get(id)),
      methods: m.methods.map(a => ({...pick(a, ['name','signature','file','line','repo','sha']),id:methods.get(a.id),entry:states.get(a.entry),exit:states.get(a.exit)})),
      nodes: m.nodes.map(n => ({...pick(n, ['kind','code','textTruncated','file','line','changes','arguments','ports','exit','assumptions']),id:states.get(n.id),method:methods.get(n.method)})),
      edges: m.edges.map(e => ({...pick(e, ['kind','polarity','relation','bindings','certainty','proof']),from:states.get(e.from),to:states.get(e.to)})), ports: m.ports.map(p => pick(p, ['id','portType','boundary','mappings','certainty','evidence'])) };
    // Bound whole arrays before repeated byte checks; a multi-MiB map must not
    // serialize once per omitted edge on the request thread.
    const p=out.flowMap,cap=(key,max)=>{if(p[key].length>max){out.omitted['flowMap.'+key]=(out.omitted['flowMap.'+key]||0)+p[key].length-max;p[key]=p[key].slice(0,max);out.previewTruncated=true;}};
    const shorten=(text,max)=>{if(typeof text!=='string'||text.length<=max)return text;out.omitted['flowMap.text']=(out.omitted['flowMap.text']||0)+1;out.previewTruncated=true;return text.slice(0,max);};
    const score=n=>p.entries.includes(n.id)?6:n.kind==='call'&&!n.exit||n.kind==='return'?5:n.kind==='change'?4:n.kind==='decision'?3:1;
    p.nodes.sort((a,b)=>score(b)-score(a));cap('nodes',Math.min(40,Math.max(4,Math.floor(budget/500))));
    const included=new Set(p.nodes.map(n=>n.id)),before=p.edges.length;p.edges=p.edges.filter(e=>included.has(e.from)&&included.has(e.to));
    if(before!==p.edges.length){out.omitted['flowMap.edges']=before-p.edges.length;out.previewTruncated=true;}
    p.edges.sort((a,b)=>(a.kind==='call'?0:a.kind==='control'?1:2)-(b.kind==='call'?0:b.kind==='control'?1:2));cap('edges',Math.min(80,Math.max(4,Math.floor(budget/180))));cap('ports',5);
    for(const n of p.nodes){n.code=shorten(n.code,400);if(n.arguments){if(n.arguments.length>8){out.omitted['flowMap.arguments']=(out.omitted['flowMap.arguments']||0)+n.arguments.length-8;out.previewTruncated=true;}n.arguments=n.arguments.slice(0,8).map(a=>({...a,expression:shorten(a.expression,200)}));}if(n.changes)n.changes=n.changes.map(c=>({...c,target:shorten(c.target,160),expression:shorten(c.expression,400)}));}
    for(const method of p.methods)method.signature=shorten(method.signature,400);
    for(const edge of p.edges)if(edge.bindings){if(edge.bindings.length>8){out.omitted['flowMap.bindings']=(out.omitted['flowMap.bindings']||0)+edge.bindings.length-8;out.previewTruncated=true;}edge.bindings=edge.bindings.slice(0,8).map(b=>({...b,expression:shorten(b.expression,200)}));}
  }
  const size = () => Buffer.byteLength(JSON.stringify(out));
  // Preserve summary/proof/continuation before detail arrays. Every omission is explicit.
  const remove = (object, key, label, minimum = 0) => {
    const a = object[key]; if (!Array.isArray(a) || a.length <= minimum) return false;
    a.pop(); out.omitted[label] = (out.omitted[label] || 0) + 1; out.previewTruncated = true; return true;
  };
  while (size() > budget) {
    if(out.flowMap){
      const m=out.flowMap;
      if(remove(m,'ports','flowMap.ports')||remove(m,'edges','flowMap.edges',4))continue;
      if(m.nodes.length>2){const index=m.nodes.findLastIndex(n=>!m.entries.includes(n.id));if(index>=0){const [node]=m.nodes.splice(index,1),before=m.edges.length;m.edges=m.edges.filter(e=>e.from!==node.id&&e.to!==node.id);out.omitted['flowMap.nodes']=(out.omitted['flowMap.nodes']||0)+1;out.omitted['flowMap.edges']=(out.omitted['flowMap.edges']||0)+before-m.edges.length;out.previewTruncated=true;continue;}}
      if(remove(m,'methods','flowMap.methods',1)||remove(m,'edges','flowMap.edges'))continue;
    }
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
    const key = Object.keys(out).filter(k => !['protocol', 'operation', 'mode', 'job', 'state', 'revisionSet', 'view', 'proof', 'assessment', 'summary', 'total', 'truncated', 'nextCursor', 'format', 'detail', 'omitted', 'previewTruncated'].includes(k) && (JSON.stringify(out[k])?.length || 0) > 0).sort((a,b)=>(JSON.stringify(out[b])?.length||0)-(JSON.stringify(out[a])?.length||0))[0];
    if (key) { out.omitted[key] = Array.isArray(out[key]) ? out[key].length : 1; delete out[key]; out.previewTruncated = true; continue; }
    break;
  }
  if(out.flowMap){const ids=new Set(out.flowMap.nodes.map(n=>n.id));for(const method of out.flowMap.methods)for(const key of ['entry','exit'])if(!ids.has(method[key]))delete method[key];}
  if (!Object.keys(out.omitted).length) delete out.omitted;
  return out;
}
module.exports = { compact };
