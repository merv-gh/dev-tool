// Hydrates a retained state map in the owning cancellable job.
const { digest }=require('./semantic-protocol');
const bound=(n,fallback,min,max)=>Number.isInteger(n)?Math.max(min,Math.min(max,n)):fallback;
const INGRESS=['http-ingress','kafka-consume','scheduled'];
function location(analysis, value) {
  const source = (analysis.sources || analysis.manifest?.sources || []).filter(s => s.prefix && value.file?.startsWith(s.prefix + '/')).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return { ...value, analysisId: analysis.id, repo: source?.repo || analysis.repo, sha: source?.sha || analysis.sha, file: source ? value.file.slice(source.prefix.length + 1) : value.file, revisionKey: source?.revisionKey || analysis.revisionKey, locator: { analysisId: analysis.id, generation: analysis.id, nodeId: value.nodeId } };
}
async function hydrate(result, args, analyses, runQuery) {
  const plan = result.flowPlan; delete result.flowPlan;
  const map = { protocol: 'dt.flow-map/v1', entries: [], methods: [], nodes: [], edges: [], ports: plan.ports, assumptions: [
    { id: 'static', status: 'unknown', detail: 'Static control and reaching-definition edges are candidates. They do not prove feasibility, equal values, runtime order, or every-path enforcement.' },
    { id: 'effects', status: 'unknown', detail: 'External calls may change data or throw. Unresolved dispatch, aliasing, reflection, async execution, and implicit exceptions are not exhaustively modeled.' },
    { id: 'scope', status: 'bounded', detail: 'Bodies cover the selected entries and bounded reachable methods in exact retained CPGs. Transport boundaries are shown with their evidence; no distributed execution or field mapping is inferred.' }
  ], complete: false };
  const stateId = (a, id) => `state:${a}:${id}`, methodByNative = new Map(plan.methods.map(m => [m.analysisId + ':' + m.locator.nodeId, m]));
  const groups = [...new Set(plan.methods.map(m => m.analysisId))]; let remaining = plan.maxStates;
  for (const analysisId of groups) {
    require('./execution').check();
    const a = analyses.find(a => a.id === analysisId), methods = plan.methods.filter(m => m.analysisId === analysisId);
    if (!runQuery || remaining < 2) { result.gaps.push({ kind: !runQuery ? 'flowmap-runtime-unavailable' : 'state-budget', analysisId, detail: !runQuery ? 'Retained CPG runtime is unavailable. No state/control/data edges were fabricated from source order.' : 'The global state budget was exhausted; callee bodies remain outside the map' }); continue; }
    let response;
    try { response = await runQuery(a, { operation: 'flowmap', mode: 'dataflow', methodNodeIds: methods.map(m => m.locator.nodeId), maxStates: remaining, budgetMs: bound(args.budgetMs, 5000, 100, 30000) }); }
    catch (error) { require('./execution').check(); result.gaps.push({ kind: 'flowmap-query-failed', analysisId, detail: error.message }); continue; }
    let summarized = false;
    for (const record of response.records || []) {
      if (record.type === 'summary') { summarized = true; result.truncated ||= !!record.truncated; for (const detail of record.gaps || []) result.gaps.push({ kind: 'flowmap-coverage', analysisId, detail }); if(record.truncated)result.gaps.push({kind:'state-budget',analysisId,detail:'CPG state/edge/AST/time budget reached; some transitions or bodies are omitted'}); }
      else if (record.type === 'method') {
        const original = methodByNative.get(analysisId + ':' + record.nodeId); if (!original) continue;
        map.methods.push({ ...original, parameters: record.parameters || original.parameters, entry: stateId(analysisId, record.entryState), exit: stateId(analysisId, record.exitState) });
      } else if (record.type === 'state' && remaining > 0) {
        const original = methodByNative.get(analysisId + ':' + record.methodId); if (!original) continue;
        map.nodes.push({ ...location(a, record), id: stateId(analysisId, record.nodeId), method: original.id }); remaining--;
      } else if (record.type === 'edge') map.edges.push({ ...record, from: stateId(analysisId, record.from), to: stateId(analysisId, record.to), evidence: { origin: 'joern', relation: record.relation, analysisId, queryBundle: record.queryBundle }, proof: 'static-candidate' });
    }
    if (!summarized) result.gaps.push({ kind: 'flowmap-incomplete', analysisId, detail: 'Worker did not return a final summary; treat this map as incomplete' });
  }
  for(const node of map.nodes.filter(n=>n.kind==='throw'))(node.assumptions||=[]).push('Explicit failure exit. Raw CPG continuations remain unresolved exception evidence and are excluded from normal control edges; exception handlers are not proven.');
  const byId = new Map(map.nodes.map(n => [n.id, n])), methods = new Map(map.methods.map(m => [m.id, m]));
  map.entries = plan.entries.map(id => methods.get(id)?.entry).filter(id => byId.has(id));
  for (const call of plan.calls) {
    const from = stateId(call.evidence.analysisId, call.evidence.nodeId), target = methods.get(call.to);
    if (!byId.has(from)) continue;
    if (!target || !byId.has(target.entry)) { result.gaps.push({ kind: 'callee-body-unavailable', state: from, detail: 'Resolved callee body was not returned within the map budgets' }); continue; }
    const bindings = (call.arguments || []).filter(p => p.index > 0).flatMap(arg => (target.parameters || []).filter(p => p.index === arg.index).map(p => ({ argument: arg.index, expression: arg.code, parameter: p.name, status: 'positional-static-binding' })));
    map.edges.push({ from, to: target.entry, kind: 'call', certainty: call.certainty, bindings, evidence: call.evidence, proof: call.proof, assumption: 'Candidate call dispatch with positional bindings; local CFG continuation remains separate. No exhaustive exception or context-sensitive return proof.' });
  }
  for (const port of plan.ports) {
    const targets = port.callId ? [stateId(port.analysisId, port.callId)] : port.handlerCandidates.map(id => methods.get(id)?.entry);
    for (const id of targets.filter(id => byId.has(id))) {
      const node = byId.get(id); (node.ports ||= []).push(port.id);
      if (!port.callId && !INGRESS.includes(port.portType)) (node.assumptions ||= []).push('This boundary is bound at method scope; its exact call site is not recorded.');
    }
  }
  for (const node of map.nodes.filter(n => n.kind === 'call')) {
    node.callTargets = map.edges.filter(e => e.kind === 'call' && e.from === node.id).map(e => e.to);
    if (!node.callTargets.length) { node.exit = 'external-or-unexpanded-call'; (node.assumptions ||= []).push('Call effects, result semantics and exceptions are not established by a retained callee body in this map.'); }
  }
  const filtered = map.edges.filter(e => byId.has(e.from) && byId.has(e.to));
  if (filtered.length !== map.edges.length) result.gaps.push({ kind: 'edge-endpoint-budget', detail: 'Edges to omitted states are excluded from the rendered graph' });
  map.edges = [...new Map(filtered.map(e => { const id = 'transition:' + digest([e.from, e.to, e.kind, e.polarity, e.relation]).slice(0, 24); return [id, { ...e, id }]; })).values()];
  map.counts = { entries: map.entries.length, methods: map.methods.length, states: map.nodes.length, transitions: map.edges.length, decisions: map.nodes.filter(n => n.kind === 'decision').length, changes: map.nodes.filter(n => n.changes?.length).length, exits: map.nodes.filter(n => ['return', 'throw', 'exit'].includes(n.kind) || n.exit).length };
  result.mapRequest = { ...(args.env?{env:args.env}:{}), ...(args.service?{service:args.service}:{}), ...(args.from ? { from:args.from } : args.target ? { target:args.target } : {}), maxMethods:bound(args.maxMethods,20,1,40), maxStates:plan.maxStates, maxHops:bound(args.maxHops,8,1,30), budgetMs:bound(args.budgetMs,5000,100,30000) };
  result.counts=map.counts;result.flowMap = map; result.results = []; result.total = map.nodes.length; result.nextCursor = null;
  result.proof = { kind: 'entry-exit-state-map', status: map.nodes.length ? 'partial-static-map' : 'unavailable', feasibility: 'unknown', runtime: 'unknown', behaviorVerified: false };
  return result;
}
module.exports = { hydrate, location };
