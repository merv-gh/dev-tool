// Compare two independent retained CPG queries. Never connect branches into one graph.
const { digest, error } = require('./semantic-protocol');
function validate(args, analyses) {
  if (analyses.length !== 2 || analyses[0].id === analyses[1].id) throw error('Data-flow compare requires exactly two distinct immutable analyses, ordered before then after');
  if (analyses[0].repo !== analyses[1].repo || (analyses[0].language && analyses[1].language && analyses[0].language !== analyses[1].language)) throw error('Data-flow compare requires two revisions of the same repository and language');
  if (!args.from || !args.to) throw error('Data-flow compare requires both from and to selectors');
  for (const s of [args.from, args.to]) if (s.id || s.sha || s.analysisId) throw error('Use revision-neutral from/to selectors (name, signature, file, parameter or argument); analyses select the two exact revisions');
}
const identity = a => ({ id: a.id, repo: a.repo, sha: a.sha, sourceDigest: a.sourceDigest, revisionKey: a.revisionKey });
function comparable(path) {
  return digest({ kind: path.kind, nodes: (path.nodes || []).map(n => [n.repo, n.file, n.label, n.code,n.kind,n.name,n.signature,n.boundary]), conditions: (path.conditions || []).map(c => [c.expression, c.polarity, c.status]),segments:(path.segments||[]).map(s=>({status:s.status,paths:(s.paths||[]).map(comparable).sort()})),boundaries:(path.boundaries||[]).map(b=>({kind:b.kind,status:b.status,mappings:(b.mappings||[]).map(m=>({from:m.from,to:m.to,transport:m.transport}))})) });
}
const evidence=path=>path.kind==='data-flow'||path.kind==='composed-data-lineage';
function status(result) {
  const failure = result.gaps.some(g => ['endpoint-not-found','endpoint-value-unavailable','deep-query-failed','deep-query-unavailable','dataflow-boundary','local-query-unavailable','local-query-failed','local-dataflow-gap'].includes(g.kind));
  if (failure || result.ambiguity?.length || result.results.some(p=>!evidence(p)||p.proof?.status!==(p.kind==='data-flow'?'static-dataflow':'composed-static-lineage'))) return 'unavailable';
  if (result.truncated || result.results.some(p => p.truncated)) return 'bounded';
  return result.results.length ? result.results.some(p=>p.kind==='composed-data-lineage')?'composed-static-lineage':'static-dataflow' : 'no-supported-path';
}
async function compare(args, analyses, query) {
  validate(args, analyses);
  const sides = [];
  for (const a of analyses) {
    require('./execution').check();
    const { cursor, analysis, analyses: ids, revisionSet, ...request } = args;
    try { sides.push(await query({ ...request, operation: 'paths', mode: 'dataflow', limit: 200 }, a)); }
    catch (e) { if (require('./execution').signal()?.aborted) throw e; sides.push({ results: [], gaps: [{ kind: 'deep-query-failed', analysisId: a.id, detail: e.message }], ambiguity: [], truncated: false, proof: { status: 'unavailable', feasibility: 'unknown' } }); }
  }
  const sideStatus = sides.map(status), inconclusive = sideStatus.some(s => ['unavailable', 'bounded'].includes(s));
  const gapList = sides.flatMap((s, i) => s.gaps.map(g => ({ ...g, side: i ? 'after' : 'before', analysisId: g.analysisId || analyses[i].id })));
  if (sideStatus.includes('no-supported-path')) gapList.push({ kind: 'bounded-absence', detail: 'No supported path means this bounded static query found none; it is not proof that runtime flow is absent or that the change is safe' });
  const maps = sides.map(s => new Map(s.results.filter(evidence).map(p => [comparable(p), p])));
  const results = []; let unchanged = 0;
  for (const key of new Set([...maps[0].keys(), ...maps[1].keys()])) {
    const before = maps[0].get(key), after = maps[1].get(key);
    if (before && after) { unchanged++; continue; }
    results.push({ category: 'data-flow', change: inconclusive ? 'inconclusive' : before ? 'removed' : 'added', ...(before ? { before } : {}), ...(after ? { after } : {}) });
  }
  // A unique changed candidate can be read side by side. Multiple candidates
  // remain separate additions/removals; never guess which paths correspond.
  if(results.length===2&&results.filter(r=>r.before).length===1&&results.filter(r=>r.after).length===1){
    const before=results.find(r=>r.before).before,after=results.find(r=>r.after).after;
    results.splice(0,2,{category:'data-flow',change:inconclusive?'inconclusive':'changed',before,after});
  }
  const key = digest([analyses.map(a => a.id), sides.map(s => s.overlayId), args.from, args.to, args.maxPaths, args.maxHops, args.budgetMs]);
  let offset = 0;
  if (args.cursor) {
    let cursor; try { cursor = JSON.parse(Buffer.from(args.cursor, 'base64url')); } catch {}
    if (!cursor || cursor.key !== key || !Number.isInteger(cursor.offset) || cursor.offset < 0) throw error('Cursor belongs to another immutable query');
    offset = cursor.offset;
  }
  const limit = Math.max(1, Math.min(200, args.limit || 30));
  return { protocol: 'dt.semantic/v1', operation: 'compare', mode: 'dataflow', analyses: analyses.map(identity),
    comparison: { before: { ...identity(analyses[0]), status: sideStatus[0], paths: maps[0].size, selectedValues:sides[0].selectedValues }, after: { ...identity(analyses[1]), status: sideStatus[1], paths: maps[1].size, selectedValues:sides[1].selectedValues }, from: args.from, to: args.to, unchanged, behaviorVerified:false },
    results: results.slice(offset, offset + limit), total: results.length, nextCursor: offset + limit < results.length ? Buffer.from(JSON.stringify({ key, offset: offset + limit })).toString('base64url') : null,
    truncated: sides.some(s => s.truncated), ambiguity: sides.flatMap((s, i) => (s.ambiguity || []).map(a => ({ ...a, side: i ? 'after' : 'before' }))), gaps: gapList,
    coverage: sides.map((s, i) => ({ side: i ? 'after' : 'before', analyses: s.coverage })),
    proof: { kind: 'dataflow-comparison', status: inconclusive ? 'inconclusive' : 'static-comparison', feasibility: 'unknown', runtime: 'unknown', scope: 'Two independent retained CPG queries; paths matched by source expressions, never by generation-local IDs or shifted lines. Static flow membership does not prove value equality: predicates can produce conservative coupling. Confirm behavior with entry-to-exit tests.' } };
}
module.exports = { compare, validate, comparable };
