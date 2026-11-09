// A change briefing over two independent retained CPGs. No path feasibility is inferred.
const P = require('./semantic-protocol');
const identity = a => ({ id: a.id, repo: a.repo, sha: a.sha, sourceDigest: a.sourceDigest, revisionKey: a.revisionKey, language: a.language });
function validate(args, analyses) {
  if (![1, 2].includes(analyses.length) || new Set(analyses.map(a => a.id)).size !== analyses.length) throw P.error('Trace requires one analysis, or two distinct analyses ordered before, after');
  if (analyses.length === 2 && (analyses[0].repo !== analyses[1].repo || analyses[0].language !== analyses[1].language)) throw P.error('Trace comparison requires the same repository and frontend');
  if (!args.from || !args.to) throw P.error('Trace requires from and to selectors');
  if (analyses.length === 1 && (args.after_from || args.after_to)) throw P.error('After selectors require two analyses');
  for (const selector of [args.from, args.to, args.after_from, args.after_to].filter(Boolean)) {
    if (selector.kind === 'line') {
      P.relative(selector.file);
      if (!Number.isInteger(selector.line) || selector.line < 1) throw P.error('A line endpoint requires a positive line');
      if (selector.parameter !== undefined || selector.argument !== undefined) throw P.error('Line endpoints select expressions; use code, column, nodeLabel or nodeId to disambiguate');
    }
    if (analyses.length === 2 && (selector.id || selector.analysisId || selector.sha)) throw P.error('Select exact revisions through analyses; use separate after_from/after_to for shifted lines');
    if (analyses.length === 2 && selector.nodeId && ((selector===args.from&&!args.after_from)||(selector===args.to&&!args.after_to))) throw P.error('CPG nodeIds are revision-local; provide separate after selectors or use code/column/nodeLabel');
  }
  if (!Array.isArray(args.assumptions || []) || (args.assumptions || []).length > 20) throw P.error('At most 20 explicit assumptions are supported');
  for (const a of args.assumptions || []) if (typeof a.expression !== 'string' || !a.expression.trim() || a.expression.length > 1000 || typeof a.holds !== 'boolean') throw P.error('Each assumption needs an exact expression and boolean holds');
}
const failedKinds = new Set(['endpoint-not-found', 'endpoint-value-unavailable', 'endpoint-resolution', 'line-source-ambiguous', 'deep-query-failed', 'deep-query-unavailable', 'deep-query-incomplete', 'dataflow-boundary', 'local-query-failed', 'local-dataflow-gap']);
function status(r, layer) {
  if(r.receiverLineage?.status==='unavailable'||r.pathContext?.receiverConstraints?.unsafe)return 'unavailable';
  if ((r.ambiguity || []).length || (r.gaps || []).some(g => failedKinds.has(g.kind)||String(g.detail).startsWith('Unsupported cross-method control flow'))) return 'unavailable';
  if ((r.results || []).some(p => layer==='data' ? !['static-dataflow','composed-static-lineage'].includes(p.proof?.status) : p.proof?.status!=='path_condition')) return 'unavailable';
  if (r.truncated || (r.results || []).some(p => p.truncated)) return 'bounded';
  return r.results?.length ? 'static-candidates' : 'no-supported-path';
}
function underAssumptions(path, assumptions, layer) {
  if (!assumptions.length) return { status: 'unconditioned', matches: [], conflicts: [], unresolved: [] };
  const matches = [], conflicts = [], unresolved = [];
  for (const a of assumptions) {
    const conditions = layer === 'control' ? (path.conditions || []).filter(c => c.expression === a.expression && c.status === 'path_condition' && ['true', 'false'].includes(c.polarity)) : [];
    if (!conditions.length) unresolved.push(a);
    else if (conditions.some(c => (c.polarity === 'true') !== a.holds)) conflicts.push(a);
    else matches.push(a);
  }
  return { status: conflicts.length ? 'contradicts-assumptions' : unresolved.length ? 'unresolved' : 'matches-assumptions', matches, conflicts, unresolved };
}
const fingerprint = p => require('./semantic-compare').comparable(p);
function delta(before, after, layer, inconclusive) {
  const maps = [before, after].map(paths => new Map(paths.map(p => [fingerprint(p), p]))), results = [];
  for (const key of new Set([...maps[0].keys(), ...maps[1].keys()])) {
    const a = maps[0].get(key), b = maps[1].get(key);
    results.push({ layer, change: a && b ? 'unchanged' : inconclusive ? 'inconclusive' : a ? 'removed' : 'added', ...(a ? { before: a } : {}), ...(b ? { after: b } : {}) });
  }
  const changed = results.filter(r => r.change !== 'unchanged');
  if (changed.length === 2 && changed.filter(r => r.before).length === 1 && changed.filter(r => r.after).length === 1) {
    const a = changed.find(r => r.before).before, b = changed.find(r => r.after).after;
    return [...results.filter(r => r.change === 'unchanged'), { layer, change: inconclusive ? 'inconclusive' : 'changed', before: a, after: b }];
  }
  return results;
}
async function trace(args, analyses, query) {
  validate(args, analyses);
  const assumptions = args.assumptions || [], sides = [];
  for (const [i, analysis] of analyses.entries()) {
    require('./execution').check();
    const from = i ? args.after_from || args.from : args.from, to = i ? args.after_to || args.to : args.to;
    const request = { operation: 'paths', from, to, maxPaths: args.maxPaths || 8, maxHops: args.maxHops || 60, budgetMs: args.budgetMs || 5000, limit: 200 };
    const run = async mode => {
      try { return await query({ ...request, mode, includeContext: mode==='dataflow'&&args.includeContext!==false }, analysis); }
      catch (e) { require('./execution').check(); return { results: [], gaps: [{ kind: 'deep-query-failed', detail: e.message }], proof: { status: 'unavailable' } }; }
    };
    const data = await run('dataflow');
    if(!data.results?.length&&data.pathContext?.receiver)try{await require('./semantic-receiver-lineage').compose(data,request,analysis,query);}catch(error){require('./execution').check();data.gaps.push({kind:'receiver-local-lineage-gap',detail:error.message});}
    const control = args.includeControl === false ? null : await run('controlflow');
    const decorate = (r, layer) => (r?.results || []).map(p => ({ ...p, assumptionEvaluation: underAssumptions(p, assumptions, layer) }));
    sides.push({ side: analyses.length === 1 ? 'current' : i ? 'after' : 'before', analysis: identity(analysis), from, to,
      data: { status: status(data,'data'), paths: decorate(data, 'data'), selectedValues: data.selectedValues, receiverLineage:data.receiverLineage, endpoints: data.endpointResolution || [], proof: data.proof },
      context: data.pathContext||{status:'unavailable',methods:[],facts:[],gaps:[],complete:false},
      control: control ? { status: status(control,'control'), paths: decorate(control, 'control'), endpoints: control.endpointResolution || [], proof: control.proof } : { status: 'not-requested', paths: [] },
      gaps: [...data.gaps || [], ...control?.gaps || []], ambiguity: [...data.ambiguity || [], ...control?.ambiguity || []], truncated: !!(data.truncated || control?.truncated) });
  }
  const comparison = sides.length === 2;
  const inconclusive = sides.some(s => [s.data.status, s.control.status].some(v => ['unavailable', 'bounded'].includes(v)));
  const layerIncomplete=layer=>sides.some(s=>['unavailable','bounded'].includes(s[layer].status));
  const changes = comparison ? ['data', 'control'].flatMap(layer => delta(sides[0][layer].paths, sides[1][layer].paths, layer, layerIncomplete(layer))) : [];
  const contextChanges=comparison?require('./semantic-path-context').compare(sides[0].context,sides[1].context):[];
  const changed = changes.filter(r => !['unchanged','inconclusive'].includes(r.change));
  const assessment = { status: inconclusive ? changed.length ? 'partial-static-path-change' : 'inconclusive' : !comparison ? 'single-revision' : changed.length ? 'static-path-changed' : contextChanges.length?'source-context-changed':'no-observed-path-change',
    exhaustive:false, contextChanges:contextChanges.length,
    layers: Object.fromEntries(['data','control'].map(layer=>[layer,!comparison?sides[0][layer].status:layerIncomplete(layer)?'inconclusive':changed.some(r=>r.layer===layer)?'static-path-changed':'no-observed-path-change'])),
    inconclusiveCandidates: changes.filter(r=>r.change==='inconclusive').length,
    dataChanges: changed.filter(r => r.layer === 'data').length, controlChanges: changed.filter(r => r.layer === 'control').length, behaviorVerified: false,
    meaning: 'A changed source expression or condition on a selected static path is evidence that this path differs. It does not prove that the changed line executes, the requested behavior is correct, or every affected path is covered.' };
  const reading = sides.map(s => `${s.side}: ${s.data.paths.length} value path(s) (${s.data.status}); ${s.control.paths.length} local control path(s) (${s.control.status}).`);
  reading.push(comparison ? `${assessment.status}: ${assessment.dataChanges} value and ${assessment.controlChanges} control path differences; ${assessment.inconclusiveCandidates} inconclusive candidate(s). Match ignores shifted lines and CPG node IDs, and retains changed expressions.` : 'Select a second retained analysis to compare the change.');
  reading.push(`${contextChanges.length} reachable source-context change(s); ${sides.map(s=>s.side+': '+s.context.facts.length+' collected facts ('+s.context.status+')').join('; ')}. Context facts include loops, callbacks and candidate inherited/library bodies; applicability to the selected paths remains unproven.`);
  reading.push('For a regression, exercise the entry with inputs that satisfy the recorded guards; assert values, identity and effect counts at each selected exit. Also test rejected inputs produce no effects.');
  return { protocol: 'dt.path-trace/v1', operation: 'trace', analyses: analyses.map(identity), request: { tool: 'semantic_trace', arguments: { analyses: analyses.map(a => a.id), from: args.from, to: args.to, ...(args.after_from ? { after_from: args.after_from } : {}), ...(args.after_to ? { after_to: args.after_to } : {}), assumptions, includeControl: args.includeControl !== false, includeContext: args.includeContext !== false, maxPaths: args.maxPaths || 8, maxHops: args.maxHops || 60, budgetMs: args.budgetMs || 5000 } },
    assessment, reading, assumptions, sides, changes, contextChanges, truncated: sides.some(s => s.truncated),
    gaps: sides.flatMap(s => [...s.gaps,...s.context.gaps||[]].map(g => ({ ...g, side: s.side }))),
    proof: { kind: 'selected-path-comparison', status: assessment.status, feasibility: 'unknown', runtime: 'unknown', behaviorVerified: false, assumptions: 'User declarations match exact displayed CFG predicates only. They do not constrain Joern value-flow queries or prove satisfiability. Data and control paths are independent evidence; no correlation is inferred.', scope: 'Value flow is retained-CPG evidence; control paths are local CFG walks with explicit throws stopped. Aliasing, dispatch, loops, exceptions, and external effects can remain unresolved. No solver or runtime coverage is claimed.' } };
}
function compact(value, budget = 16384) {
  if (!value.sides) return require('./semantic-response').compact(value, budget);
  const {changes:originalChanges,...retained}=value;
  const preview = { ...retained, sides: value.sides.map(s => ({ side:s.side, analysisId:s.analysisId, truncated:s.truncated, context:{status:s.context?.status||'unavailable',complete:!!s.context?.complete}, data: { status:s.data.status, composed:s.data.receiverLineage?.composed||0 }, control: { status:s.control.status } })), contextChanges:(value.contextChanges||[]).slice(0,4),
    results: value.sides.flatMap(s => ['data', 'control'].flatMap(layer => s[layer].paths.map(p => ({ ...p, side: s.side, layer })))), total: value.sides.reduce((n, s) => n + s.data.paths.length + s.control.paths.length, 0) };
  preview.summary = value.sides.map(s => ({ side: s.side, dataPaths: s.data.paths.length, controlPaths: s.control.paths.length, dataStatus: s.data.status, controlStatus: s.control.status,contextStatus:s.context?.status||'unavailable',contextFacts:s.context?.facts?.length||0,contextMethods:s.context?.methods?.length||0 }));
  return require('./semantic-response').compact(preview, budget);
}
module.exports = { trace, validate, underAssumptions, delta, compact };
