const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flow-comparison-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_STATE_BACKEND = 'legacy';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_WORK_DIR', 'DT_PASSPORTS_DIR']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const Q = require('../lib/semantic-query'); let seq = 0;
function analysis(sha, extra = {}) {
  const id = 'fixture-' + (++seq), dir = path.join(home, id); fs.mkdirSync(dir);
  const records = [
    { type: 'meta', protocol: 'dt.semantic.projection/v1', version: 1, capabilities: { dataFlow: true } },
    { type: 'symbol', id: '10', name: 'submit', fullName: 'Payments.submit:long(long,long)', signature: 'long(long,long)', file: 'src/Payments.java', line: 5, parameters: [{ id: '11', name: 'gross', index: 1 }, { id: '12', name: 'rebate', index: 2 }], returnId: '13' },
    { type: 'call', id: '20', caller: '10', name: 'save', methodFullName: 'Ledger.save:void(String,long)', file: 'src/Payments.java', line: 9, arguments: [{ id: '21', index: 1, code: 'tenant' }, { id: '22', index: 2, code: 'payable' }] },
    { type: 'summary', truncated: false, gaps: [] },
  ];
  fs.writeFileSync(path.join(dir, 'projection.jsonl'), records.map(JSON.stringify).join('\n'));
  return { id, repo: 'P/payments', sha: sha.repeat(40), dir, ports: [], ...extra };
}
const args = () => ({ operation: 'compare', mode: 'dataflow', from: { kind: 'method', name: 'submit', parameter: 'rebate' }, to: { kind: 'call', name: 'save', argument: 2 } });
const flow = (nodeId = '22', line = 9, code = 'payable') => ({ records: [{ type: 'path', kind: 'data-flow', nodes: [{ nodeId: '12', file: 'src/Payments.java', line: 5, code: 'long rebate', label: 'METHOD_PARAMETER_IN' }, { nodeId, file: 'src/Payments.java', line, code, label: 'IDENTIFIER' }], proof: { status: 'static-dataflow', feasibility: 'unknown', scope: 'single-cpg' } }, { type: 'summary', truncated: false, gaps: [] }] });
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('data-flow comparison runs each branch in isolation with exact parameter and sink argument', async () => {
  const before = analysis('a'), after = analysis('b'), calls = [];
  const result = await Q.query(args(), [before, after], { runQuery: async (a, request) => {
    calls.push(a.id); assert.deepEqual(request.fromNodeIds, ['12']); assert.deepEqual(request.toNodeIds, ['22']);
    return a.id === before.id ? { records: [{ type: 'summary', truncated: false, gaps: [] }] } : flow();
  } });
  assert.deepEqual(calls, [before.id, after.id]);
  assert.equal(result.proof.kind, 'dataflow-comparison'); assert.equal(result.proof.feasibility, 'unknown');
  assert.equal(result.comparison.before.status, 'no-supported-path'); assert.equal(result.comparison.after.status, 'static-dataflow');
  assert.equal(result.results.length, 1); assert.equal(result.results[0].change, 'added'); assert.equal(result.results[0].category, 'data-flow');
  assert.ok(result.gaps.some(g => g.kind === 'bounded-absence'));
  assert.equal(result.results[0].after.analysisId, after.id);
  assert.equal(result.comparison.after.selectedValues.to[0].value,'payable');assert.equal(result.comparison.after.selectedValues.to[0].argument,2);assert.equal(result.comparison.behaviorVerified,false);
});
test('generation-local CPG ids and shifted source lines do not appear as data-flow changes', async () => {
  const before = analysis('a'), after = analysis('b');
  const result = await Q.query(args(), [before, after], { runQuery: async a => a.id === before.id ? flow() : flow('99999', 29) });
  assert.equal(result.results.length, 0); assert.equal(result.comparison.unchanged, 1);
  assert.equal(result.comparison.before.paths, 1); assert.equal(result.comparison.after.paths, 1);
});
test('missing deployment metadata does not hide a supported local flow; one changed path retains both sides',async()=>{
 const a=analysis('a',{portGaps:[{kind:'passport-snapshot-unavailable',message:'No deployment passport'}]}),b=analysis('b');
 const result=await Q.query(args(),[a,b],{runQuery:async item=>item.id===a.id?flow():flow('44',19,'gross - rebate')});
 assert.equal(result.proof.status,'static-comparison');assert.equal(result.results.length,1);assert.equal(result.results[0].change,'changed');
 assert.equal(result.results[0].before.nodes.at(-1).code,'payable');assert.equal(result.results[0].after.nodes.at(-1).code,'gross - rebate');
 assert.ok(result.gaps.some(g=>g.kind==='passport-snapshot-unavailable'));
});
test('cancelling a comparison stops its owned first query without starting the other revision',async()=>{
 const E=require('../lib/execution'),a=analysis('a'),b=analysis('b');let called=0;
 const operation=E.start({kind:'semantic-comparison-test'},()=>Q.query(args(),[a,b],{runQuery:async()=>{called++;return new Promise((resolve,reject)=>{const s=E.signal();s.addEventListener('abort',()=>reject(E.abortError(s.reason)),{once:true});});}}));
 for(let i=0;!called&&i<100;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(called,1);E.cancel(operation.id,'test cancellation');await assert.rejects(operation.promise,e=>e.code==='DT_CANCELLED');assert.equal(called,1);
});
test('table-exit comparisons retain local CPG segments and never turn missing mappings into an empty clean diff',async()=>{
 const a=analysis('a'),b=analysis('b');
 const attach=(item,mappings)=>item.ports=[{id:'write',type:'db-write',repo:item.repo,revision:item.sha,service:'payments',env:'dev',handler:{repo:item.repo,revision:item.sha,file:'src/Payments.java',line:5,signature:'Payments.submit:long(long,long)',call:{file:'src/Payments.java',line:9,name:'save'}},boundary:{db:'ledger',schema:'sales',table:'payments'},mappings}];
 attach(a,[{from:'argument:2',to:'sales.payments.amount'}]);attach(b,[{from:'argument:2',to:'sales.payments.amount'}]);
 const request={...args(),to:{kind:'table',env:'dev',db:'ledger',schema:'sales',name:'payments'}};
 const runQuery=async item=>item.id===a.id?flow():flow('44',19,'gross - rebate');
 const changed=await Q.query(request,[a,b],{runQuery});
 assert.equal(changed.comparison.before.status,'composed-static-lineage');assert.equal(changed.results.length,1);assert.equal(changed.results[0].change,'changed');
 assert.equal(changed.results[0].after.segments[0].paths[0].nodes.at(-1).code,'gross - rebate');
 attach(b,[]);
 const partial=await Q.query(request,[a,b],{runQuery});assert.equal(partial.proof.status,'inconclusive');assert.ok(partial.results.length);assert.ok(partial.results.every(r=>r.change==='inconclusive'));
});
test('failed, truncated, ambiguous and unmatched sides are inconclusive rather than clean removals', async () => {
  const a = analysis('a'), b = analysis('b');
  const failed = await Q.query(args(), [a, b], { runQuery: async item => { if (item.id === b.id) throw Error('Joern unavailable'); return flow(); } });
  assert.equal(failed.proof.status, 'inconclusive'); assert.equal(failed.comparison.after.status, 'unavailable');
  assert.ok(!failed.results.some(r => r.change === 'removed'));
  const truncated = await Q.query(args(), [a, b], { runQuery: async item => item.id === b.id ? { records: [{ type: 'summary', truncated: true, gaps: [] }] } : flow() });
  assert.equal(truncated.proof.status, 'inconclusive'); assert.equal(truncated.truncated, true);
  const missing = await Q.query({ ...args(), from: { name: 'missing', parameter: 'rebate' } }, [a, b], { runQuery: () => { throw Error('must not execute'); } });
  assert.equal(missing.proof.status, 'inconclusive'); assert.ok(missing.gaps.some(g => g.kind === 'endpoint-not-found'));
  const badParameter = await Q.query({ ...args(), from: { name: 'submit', parameter: 'typo' } }, [a, b], { runQuery: () => { throw Error('must not execute'); } });
  assert.equal(badParameter.proof.status, 'inconclusive'); assert.ok(badParameter.gaps.some(g => g.kind === 'endpoint-value-unavailable'));
  const unknown=await Q.query(args(),[a,b],{runQuery:async()=>{const value=flow();value.records[0].proof.status='static-candidate';return value;}});assert.equal(unknown.proof.status,'inconclusive');
});
test('comparison rejects reversed selector identities and unrelated repositories before deep work', async () => {
  const a = analysis('a'), b = analysis('b');
  await assert.rejects(Q.query(args(), [a]), /exactly two/);
  await assert.rejects(Q.query(args(), [a, { ...b, repo: 'P/unrelated' }]), /same repository/);
  await assert.rejects(Q.query({ ...args(), to: undefined }, [a, b]), /from.*to/);
  await assert.rejects(Q.query({ ...args(), from: { ...args().from, analysisId: a.id } }, [a, b]), /revision-neutral/);
  await assert.rejects(Q.query({ ...args(), from: { ...args().from, sha: a.sha } }, [a, b]), /revision-neutral/);
});
test('default structural comparison stays structural; data-flow comparison pages with immutable cursors', async () => {
  const a = analysis('a'), b = analysis('b');
  const structural = await Q.query({ operation: 'compare' }, [a, b]); assert.equal(structural.proof.status, 'structural');
  const result = await Q.query({ ...args(), limit: 1 }, [a, b], { runQuery: async item => item.id === a.id ? { records: [{ type: 'summary', truncated: false }] } : { records: [...flow().records.slice(0, 1), ...flow('23', 10, 'rebate * 2').records] } });
  assert.equal(result.total, 2); assert.equal(result.results.length, 1); assert.ok(result.nextCursor);
  const second = await Q.query({ ...args(), limit: 1, cursor: result.nextCursor }, [a, b], { runQuery: async item => item.id === a.id ? { records: [{ type: 'summary', truncated: false }] } : { records: [...flow().records.slice(0, 1), ...flow('23', 10, 'rebate * 2').records] } });
  assert.equal(second.results.length, 1); assert.notDeepEqual(second.results, result.results);
  await assert.rejects(Q.query({ ...args(), cursor: result.nextCursor }, [b, a]), /another immutable query/);
});

test('compact tool previews preserve proof and source evidence with a hard response budget', () => {
  const { compact } = require('../lib/semantic-response');
  const analysisId = 'a'.repeat(64) + '-' + 'b'.repeat(32);
  const value = { operation: 'paths', mode: 'dataflow', analyses: [{ id: analysisId, repo: 'P/payments', sha: 'a'.repeat(40) }], proof: { kind: 'dataflow', status: 'static-candidate', feasibility: 'unknown' }, results: Array.from({ length: 20 }, (_, i) => ({ id: 'path-' + i, analysisId, kind: 'data-flow', proof: { status: 'static-dataflow', feasibility: 'unknown' }, nodes: Array.from({ length: 25 }, (_, n) => ({ id: 'expensive-id-' + n, analysisId, locator: { analysisId, generation: analysisId, nodeId: String(n) }, repo: 'P/payments', sha: 'a'.repeat(40), file: 'src/Payments.java', line: n + 1, label: 'IDENTIFIER', code: 'x'.repeat(1000) })) })), total: 20, truncated: false, gaps: [{ kind: 'coverage-gap', detail: 'External methods unresolved' }], nextCursor: 'pinned-cursor', view: 'http://localhost/show/retained' };
  const original = JSON.stringify(value), preview = compact(value, 6000);
  assert.ok(Buffer.byteLength(JSON.stringify(preview)) <= 6000);
  assert.equal(JSON.stringify(value), original); assert.equal(preview.total, 20); assert.equal(preview.nextCursor, value.nextCursor);
  assert.deepEqual(preview.proof, value.proof); assert.deepEqual(preview.analyses, value.analyses); assert.deepEqual(preview.gaps, value.gaps);
  assert.equal(preview.truncated, false); assert.equal(preview.previewTruncated, true); assert.ok(preview.omitted.results > 0);
  assert.ok(preview.results[0].nodes.some(n => n.file === 'src/Payments.java')); assert.ok(preview.view);
  assert.match(preview.detail, /format.*full/);
});
