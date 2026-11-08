// Plans bounded entry-to-exit maps without guessing entrypoints or joining revisions.
const bound = (n, fallback, min, max) => Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
const INGRESS = ['http-ingress', 'kafka-consume', 'scheduled'];
function plan(graph, args, base) {
  if (args.to || args.cursor || args.from?.parameter !== undefined || args.from?.argument !== undefined) throw Error('flowmap maps whole entry methods; use from/target without parameter/argument, to or cursor');
  const revisions = new Map();
  for (const a of graph.byAnalysis.values()) for (const s of a.sources || a.manifest?.sources || [a]) {
    const previous = revisions.get(s.repo), revision = JSON.stringify([s.sha,s.sourceDigest]);
    if (previous && previous !== revision) throw Error('flowmap requires one retained source snapshot per repository; map branches independently');
    revisions.set(s.repo, revision);
  }
  const selector = args.from || args.target, selected = selector ? graph.select(selector) : graph.ports.filter(p => INGRESS.includes(p.portType));
  let entries = [...new Map(selected.flatMap(n => n.kind === 'method' ? [n] : n.kind === 'port' && INGRESS.includes(n.portType) && n.handlerCandidates.length === 1 ? n.handlerCandidates.map(id => graph.nodes.get(id)).filter(Boolean) : []).map(n => [n.id, n])).values()];
  if (selector && entries.length > 1) {
    base.ambiguity.push({ selector, candidates: entries.map(n => ({ id: n.id, signature: n.signature, file: n.file, line: n.line })) });
    base.gaps.push({ kind: 'entry-ambiguous', detail: 'Select one exact method signature or port; overloaded entry methods are not merged' }); entries = [];
  }
  if (!entries.length) base.gaps.push({ kind: 'entry-not-found', detail: 'No uniquely bound entry method. Select from:{kind:"method",signature:…} using semantic_search, or bind an ingress passport port. Methods with no callers are not assumed to be public entries.' });
  const maxMethods = bound(args.maxMethods, 20, 1, 40), maxStates = bound(args.maxStates, 180, 20, 400), maxDepth = bound(args.maxHops, 8, 1, 30), methods = [], calls = [], seen = new Set(), queue = entries.map(n => ({ n, depth: 0 }));
  while (queue.length && methods.length < maxMethods) {
    const { n, depth } = queue.shift(); if (seen.has(n.id)) continue; seen.add(n.id); methods.push(n); graph.loadCalls(n);
    for (const edge of graph.adjacency.get(n.id) || []) {
      const target = graph.nodes.get(edge.to); if (target?.kind !== 'method' || edge.proof !== 'call-reachability') continue;
      calls.push(edge);
      if (depth < maxDepth) queue.push({ n: target, depth: depth + 1 });
      else if (!seen.has(target.id)) base.gaps.push({ kind: 'method-depth-budget', symbol: target.id, detail: 'Callee body lies outside the selected method depth' });
    }
  }
  if (queue.some(item => !seen.has(item.n.id))) base.gaps.push({ kind: 'method-budget', detail: `Map includes at most ${maxMethods} reachable methods; narrow the entry or increase maxMethods` });
  if(base.gaps.some(g=>['method-budget','method-depth-budget'].includes(g.kind)))base.truncated=true;
  const ports = graph.ports.filter(p => p.handlerCandidates.some(id => seen.has(id)));
  base.flowPlan = { methods, entries: entries.filter(n => seen.has(n.id)).map(n => n.id), calls, ports, maxStates };
  base.proof = { kind: 'entry-exit-state-map', status: entries.length ? 'requires-deep-query' : 'unavailable', feasibility: 'unknown', runtime: 'unknown', behaviorVerified: false };
  base.mode = 'dataflow';
}
module.exports={plan};
