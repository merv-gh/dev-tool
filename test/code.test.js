// Code mode: JavaScript that calls dt tools from the sandbox (tools.x(...)), prints with text(), and is
// shown with the "code" view; also tool calls from script hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-code-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;
fs.mkdirSync(path.join(home, 'files', 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'files', 'data', 'a.txt'), '3\n1\n2\n');
fs.writeFileSync(path.join(home, 'files', 'data', 'b.txt'), '2\n3\n4\n');
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { consul: 'http://127.0.0.1:9' } }, files: { data: { type: 'local', path: 'files/data' } }, scripts: { codeTimeoutMs: 3000 } }));
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

const T = () => require('../lib/tools');

test('code: calls tools, computes, prints; the user sees code + output', async () => {
  const r = await T().call('code', { title: 'sum and diff', code: `
    const read = async (p) => (await tools.files_read({ store: 'data', path: p })).text.trim().split('\\n').map(Number);
    const [a, b] = await Promise.all([read('a.txt'), read('b.txt')]);
    text('sum', a.reduce((x, y) => x + y, 0), b.reduce((x, y) => x + y, 0));
    const d = await tools.diff({ first: a, last: b, labels: ['a', 'b'] });
    text({ onlyA: d.onlyFirst, onlyB: d.onlyLast });
    return d.counts.common;` });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.output, 'sum 6 9\n{\n  "onlyA": [\n    "1"\n  ],\n  "onlyB": [\n    "4"\n  ]\n}');
  assert.equal(r.returned, 2);
  assert.deepEqual(r.calls.map(c => c.split(' ')[0]), ['files_read', 'files_read', 'diff']);
  assert.equal(r.views.length, 1, 'views made by called tools are listed');
  assert.match(r.view, /\/show\/[a-z0-9]+$/);
  const shown = require('../lib/results').load(r.view.split('/').pop());
  assert.equal(shown.view, 'code');
  assert.equal(shown.data.title, 'sum and diff');
  assert.match(shown.data.code, /tools\.diff/);
  assert.ok(require('../lib/calls').history({ source: 'code' }).some(c => c.tool === 'diff'), 'calls from code are logged as "code"');
});

test('code: tool errors are exceptions; tools.list; no recursion; syntax errors and timeouts reported', async () => {
  const r = await T().call('code', { code: `
    try { await tools.files_read({ store: 'data', path: 'nope.txt' }); } catch (e) { text('caught', e.message.includes('ENOENT') || e.message); }
    try { await tools.code({ code: '1' }); } catch (e) { text(e.message); }
    try { await tools.no_such_tool({}); } catch (e) { text(e.message); }
    const names = (await tools.list()).map(t => t.name);
    text(names.includes('pg_query'), names.includes('code'));` });
  assert.equal(r.output, 'caught true\ncode cannot call itself\nUnknown tool no_such_tool\ntrue false');
  assert.deepEqual(r.calls.map(c => c.split(' ').slice(0, 2).join(' ')), ['files_read (failed)', 'no_such_tool (failed)']);
  const bad = await T().call('code', { code: 'const = 1' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unexpected|SyntaxError|token/);
  const slow = await T().call('code', { code: 'while (true) {}' });
  assert.match(slow.error, /stopped after 3000ms/);
});

test('script hooks and js steps can call tools too', async () => {
  const S = require('../lib/scripts');
  S.save('code/hooks', { description: 'x', steps: [
    { js: 'const r = await tools.files_list({ store: "data" }); return r.rows.map(x => x.path)', as: 'names' },
    { set: { n: 1 }, after: 'vars.text = (await tools.files_read({ store: "data", path: vars.names[0] })).text.trim()' },
  ] });
  const r = await S.run('code/hooks');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.results.names, ['a.txt', 'b.txt']);
  assert.equal(r.results.text, '3\n1\n2');
  assert.ok(require('../lib/calls').history({ source: 'script:code/hooks' }).some(c => c.tool === 'files_list'));
});

test('silent code cells expose tool receipts without claiming a computed return', async () => {
  const r = await T().call('code', { code: "const r = await tools.files_read({store:'data',path:'a.txt'}); const n = r.text.length;" });
  assert.equal(r.ok, true);
  assert.equal(Object.hasOwn(r, 'returned'), false);
  assert.equal(r.toolResults.length, 1);
  assert.equal(r.toolResults[0].tool, 'files_read');
  assert.equal(r.toolResults[0].result.text, '3\n1\n2\n');
  assert.equal(r.toolResults[0].read.arguments.all, true);
  assert.match(r.guidance, /not a computed answer/);
});

test('caught internal failures remain visible even when the cell finishes successfully', async () => {
  const r = await T().call('code', { code: "try { await tools.files_read({store:'data',path:'missing.txt'}); } catch {}" });
  assert.equal(r.ok, true, 'JavaScript caught the error');
  assert.equal(r.toolErrors[0].tool, 'files_read');
  assert.match(r.toolErrors[0].error, /ENOENT|not found/);
  assert.match(r.guidance, /Internal tool calls failed/);
});

test('unreturned tool previews are bounded and retain a complete raw read bridge', () => {
  const value = { rows: Array.from({length: 40}, (_, id) => ({id, text:'large'.repeat(1000)})) };
  const receipt = require('../lib/code-result').receipt('example_rows', value);
  assert.equal(receipt.output.status, 'part');
  assert.ok(Buffer.byteLength(JSON.stringify(receipt.result)) <= 4096);
  assert.deepEqual(require('../lib/results').load(receipt.read.arguments.id).data, value);
});

test('an unawaited async helper finishes chained host calls before the cell receipt', async () => {
  const r = await T().call('code', { code: "async function read(){await tools.files_read({store:'data',path:'a.txt'}); await tools.files_read({store:'data',path:'b.txt'});} read();" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.toolResults.length, 2);
  assert.equal(r.toolResults[1].result.text, '2\n3\n4\n');
  const failed = await T().call('code', { code: "async function read(){await tools.files_read({store:'data',path:'missing.txt'});} read();" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Unawaited asynchronous work failed/);
  assert.equal(failed.toolErrors[0].tool, 'files_read');
});

test('code discovery recommends direct calls and flat dispatch still validates target inputs',async()=>{
  const r=await T().call('code',{code:"return await tools.tool_describe({name:'files_read'});"});
  assert.equal(r.returned.next.insideCodeCall,'tools.files_read');
  assert.match(r.returned.next.guidance,/directly inside code/);
  const searched=await T().call('code',{code:"return await tools.tool_search({query:'script_search hooks'});"});
  assert.equal(searched.returned.next.insideCodeCall,'tools.script_search');
  assert.deepEqual(searched.returned.next.arguments,{query:'hooks'});
  const read=await T().call('tool_execute',{name:'files_read',store:'data',path:'a.txt'});
  assert.equal(read.text,'3\n1\n2\n');
  await assert.rejects(T().call('tool_execute',{name:'files_read',store:'data'}),/path/);
  await assert.rejects(T().call('tool_execute',{name:'no_such_tool',ignored:true}),/Unknown tool/);
});

test('a mistaken analysis id as code context fails without executing or silently changing scope',async()=>{
  const code="throw new Error('should not run');";
  const r=await T().call('code',{code,context:'a'.repeat(64)+'-'+'b'.repeat(32)});
  assert.equal(r.ok,false);
  assert.match(r.error,/not semantic analysis ids/);
  assert.deepEqual(r.calls,[]);
  assert.deepEqual(r.diagnostic.retry.arguments,{code,engine:'node'});
});

test('the code view renders the code, output and calls', () => {
  const html = require('../lib/views').render('code', { code: 'text(1)', output: '1', calls: [{ tool: 'pg_query', ms: 3, ok: true }], ms: 5 });
  assert.match(html, /"code":"text\(1\)"/);
  assert.ok(require('../lib/views').list().some(v => v.name === 'code' && v.builtin));
});

test('standalone code permits idiomatic result, args and vars locals',async()=>{const r=await T().call('code',{code:"const result=await tools.files_read({store:'data',path:'a.txt'}); const args={n:result.text.length}; const vars=[args.n]; return vars[0];"});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.returned,6);});

test('the code-only profile exposes one outer tool and marks discovery-only cells',async()=>{assert.deepEqual((await T().schemas({profile:'code'})).map(t=>t.name),['code']);const r=await T().call('code',{code:"return await tools.tool_describe({name:'files_read'});"});assert.equal(r.discoveryOnly,true);const listed=await T().call('code',{code:'return await tools.list();'});assert.equal(listed.discoveryOnly,true);assert.match(listed.guidance,/discovery metadata/);const read=await T().call('code',{code:"return await tools.files_read({store:'data',path:'a.txt'});"});assert.notEqual(read.discoveryOnly,true);});

test('constructed evidence is labelled as code input and fake map references stay unbacked',async()=>{
  const r=await T().call('code',{code:'const result={entry:"submit",mapView:"https://invented.invalid/show/notretained",traceView:"https://invented.invalid/show/notretained"}; return JSON.stringify(result);'});
  assert.equal(r.ok,true);
  assert.equal(r.provenance.kind,'code-inputs');
  assert.equal(r.evidenceCheck.status,'unbacked-references');
  assert.deepEqual(r.evidenceCheck.fields,['mapView','traceView']);
  assert.match(r.evidenceCheck.retry.arguments.code,/tool_describe/);
  const listing=require('../lib/results').saveView('json',{analyses:[]});
  const wrongKind=await T().call('code',{code:'return {mapView:'+JSON.stringify(listing)+'};'});
  assert.equal(wrongKind.evidenceCheck.status,'unbacked-references','a listing URL is not map evidence');
});

test('tool result errors remain distinct from a JavaScript execution failure',async()=>{
  const r=await T().call('code',{code:"const result=await tools.js_run({code:'throw new Error(\\\"inner failure\\\")'}); return result.error;"});
  assert.equal(r.ok,true);
  assert.match(r.toolErrors[0].error,/inner failure/);
  assert.equal(r.toolErrors[0].kind,'tool-result');
});

test('unknown code tools return a concrete discovery retry',async()=>{
 const r=await T().call('code',{code:'return await tools.missing_reader({});'});
 assert.equal(r.ok,false);assert.match(r.toolErrors[0].retry.arguments.code,/tool_search/);
 assert.match(r.toolErrors[0].retry.arguments.code,/missing_reader/);
});
test('host receipts retain full JSON when business data contains an external view',()=>{
 const R=require('../lib/results'),value={view:'https://example.test/order/42',rows:[1,2,3]};
 const receipt=require('../lib/code-result').receipt('business',value);
 assert.notEqual(receipt.view,value.view);
 assert.deepEqual(R.load(receipt.read.arguments.id).data,value);
});

test('console aggregates are output, not silent cells needing raw host receipts',async()=>{
 const r=await T().call('code',{code:"const r=await tools.files_read({store:'data',path:'a.txt'}); console.log(JSON.stringify({n:r.text.trim().split('\\n').length}));"});
 assert.equal(r.ok,true);assert.deepEqual(r.logs,['{"n":3}']);
 assert.equal(r.toolResults,undefined);assert.match(r.guidance,/final answer/);
});

test('large host receipts keep selected summary facts and real evidence bridges',()=>{
 const C=require('../lib/code-result'),value={evidenceType:'entry-map-and-value-trace',mapView:'http://localhost/show/map',traceView:'http://localhost/show/trace',summary:{entry:'calculate',argumentExpression:'net',behaviorVerified:false},entryMap:{states:Array.from({length:12},(_,i)=>({id:i,code:'x'.repeat(2000),a:'a'.repeat(2000),b:'b'.repeat(2000)}))}};
 const receipt=C.receipt('what_happens_from',value);
 assert.equal(receipt.output.status,'part');
 assert.ok(receipt.result.keys);assert.equal(receipt.result.summary.argumentExpression,'net');
 assert.equal(receipt.result.summary.behaviorVerified,false);
 assert.equal(receipt.result.mapView,value.mapView);
 assert.ok(Buffer.byteLength(JSON.stringify(receipt.result))<=4096);
 assert.deepEqual(require('../lib/results').load(receipt.read.arguments.id).data,value);
});

test('code accepts unambiguous name spelling variants without bypassing grants or self-call protection',async()=>{
 const r=await T().call('code',{code:"return await tools.FilesRead({store:'data',path:'a.txt'});"});
 assert.equal(r.ok,true);assert.equal(r.returned.text,fs.readFileSync(path.join(home,'files/data/a.txt'),'utf8'));
 const recursive=await T().call('code',{code:'return await tools.Code({code:"return 1"});'});
 assert.equal(recursive.ok,false);assert.match(recursive.error,/cannot call itself/);
 const denied=await require('../lib/access').run({principalId:'limited',storyId:'alias',multiUser:true,role:'user',tools:['code']},()=>T().call('code',{code:"return await tools.FilesRead({store:'data',path:'a.txt'});"}));
 assert.equal(denied.ok,false);assert.match(denied.error,/not available to this principal/);
 const C=require('../lib/code-result'),defs=[{name:'one_name'},{name:'on_ename'}];
 assert.equal(C.resolveName('oneName',defs),'oneName','ambiguous normalized names are never chosen');
 assert.equal(C.resolveName('one_name',defs),'one_name','exact names retain precedence');
});

test('standalone value compatibility preserves native fields, real values and serialization',async()=>{
 const JS=require('../lib/js'),payload={rows:[{n:3}],complete:false};
 const r=await JS.run("const r=await tools.example(); return {direct:r.rows,alias:r.value.rows,keys:Object.keys(r),json:JSON.stringify(r)};",{}, {standalone:true,onTool:()=>payload});
 assert.deepEqual(r.returned,{direct:payload.rows,alias:payload.rows,keys:Object.keys(payload),json:JSON.stringify(payload)});
 const actual=await JS.run("return (await tools.example()).value;",{}, {standalone:true,onTool:()=>({value:0,extra:1})});
 assert.equal(actual.returned,0);
 const legacy=await JS.run("return (await tools.example()).value;",{}, {onTool:()=>payload});
 assert.equal(legacy.returned,undefined,'script hooks retain raw result semantics');
});
test('calculation views link to the retained source independently of tool-result hydration',async()=>{
 const R=require('../lib/results'),view=R.save('pg',[{amount:2},{amount:5}],{truncated:true}),id=view.split('/').pop();
 const r=await T().call('code',{code:'const r=await tools.result_read({id:'+JSON.stringify(id)+',all:true}); return {sum:r.value.rows.reduce((n,x)=>n+x.amount,0),view:r.sourceView};'});
 assert.equal(r.returned.sum,7);assert.equal(r.returned.view,view);assert.ok(r.views.includes(view));
 const shown=R.load(r.view.split('/').pop()).data;
 assert.ok(shown.views.some(v=>v.tool==='result_read'&&v.view===view));
});

test('dispatching code from code does not bypass the self-call boundary',async()=>{
 const r=await T().call('code',{code:'return await tools.tool_execute({name:"code",arguments:{code:"return 1"}});'});
 assert.equal(r.ok,false);assert.match(r.error,/cannot call itself/);
});

test('large console output retains bounded host results while small calculations remain uncluttered',async()=>{
 const r=await T().call('code',{code:"const r=await tools.files_read({store:'data',path:'a.txt'}); console.log(JSON.stringify(r).repeat(1000));"});
 assert.ok(r.toolResults?.length);
 assert.match(r.guidance,/Printed output exceeds/);
 assert.ok(r.logs[0].length>12288);
 const delivered=require('../lib/chat-pressure').response('code',r).value;
 assert.ok(delivered.toolResults?.length,'host summaries survive clipping of the console string');
 assert.ok(delivered.modelContext.compacted);
 assert.equal(r.toolResults[0].tool,'files_read');
});
test('missing transport metadata has a source completeness diagnostic',async()=>{
 const r=await T().call('code',{code:"const r={}; return r.modelContext.compacted;"});
 assert.equal(r.ok,false);assert.match(r.diagnostic.message,/sourceCoverage.provenComplete/);
 assert.match(r.diagnostic.message,/does not prove upstream completeness/);
});

test('receipt snapshots keep selected fields when the evidence view contains a different raw shape',()=>{
 const R=require('../lib/results'),raw={flowMap:{nodes:[{id:'a'}]}},sourceView=R.saveView('json',raw);
 const response={summary:{entry:'run',proofLimits:{proof:{behaviorVerified:false},sourceCoverage:{complete:false}}},view:sourceView};
 const receipt=require('../lib/code-result').receipt('what_happens_from',response);
 assert.notEqual(receipt.view,sourceView);assert.equal(receipt.sourceView,sourceView);
 assert.equal(receipt.readScope,'tool-response');
 assert.deepEqual(require('../lib/chat-context').read(receipt.read.arguments).value,response);
 assert.deepEqual(R.load(sourceView.split('/').pop()).data,raw);
 const C=require('../lib/code-result');
 assert.equal(C.resolveName('list_analyses',[{name:'list_analyses'},{name:'which_analyses_exist'}]),'list_analyses','exact registered names win');
});

test('full retained reads preserve the exact response instead of interpreting nested business views',async()=>{
 const R=require('../lib/results'),C=require('../lib/code-result'),P=require('../lib/chat-pressure');
 const sourceView=R.saveView('json',{different:'raw-source-only'}),value={summary:{entry:'selected'},view:sourceView,field:'selected-response'};
 const receipt=C.receipt('example',value);
 const read=await T().call('result_read',receipt.read.arguments);
 assert.deepEqual(read.value,value);
 assert.deepEqual(P.response('result_read',read,{all:true}).value.value,value);
 const external={view:'https://external.invalid/show/'+sourceView.split('/').pop(),selected:true};
 assert.deepEqual(require('../lib/tool-output').full(external),external,'foreign origins are business data, not hydration links');
});

test('receipt retention failures keep source bridges explicit instead of claiming an exact snapshot',()=>{
 const R=require('../lib/results'),saved=R.saveTool,sourceView=R.saveView('json',{raw:'evidence'});
 try{R.saveTool=()=>{throw Error('storage quota');};
  const r=require('../lib/code-result').receipt('example',{summary:{entry:'selected'},view:sourceView});
  assert.equal(r.readScope,'source-evidence');assert.equal(r.view,sourceView);
  assert.equal(r.retentionError,'storage quota');
  const unavailable=require('../lib/code-result').receipt('example',{value:1});
  assert.equal(unavailable.read,null);assert.equal(unavailable.retentionError,'storage quota');
 }finally{R.saveTool=saved;}
});

test('code tool metadata respects the same principal grants as native discovery',async()=>{
 const r=await require('../lib/access').run({principalId:'metadata-limited',storyId:'metadata-limited',multiUser:true,role:'user',tools:['code']},()=>T().call('code',{code:'return await tools.list();'}));
 assert.equal(r.ok,true);assert.deepEqual(r.returned,[]);
 assert.equal(r.discoveryOnly,true);
});

test('proof limits in selected summaries stay typed through a large code-result preview',()=>{
 const summary={entry:'run',behaviorVerified:false,proofLimits:{entryMap:{proof:{status:'partial-static-map',runtime:'unknown',behaviorVerified:false},sourceCoverage:{complete:false,truncated:true,gapCount:4}},valueTrace:{proof:{status:'inconclusive',runtime:'unknown',behaviorVerified:false},sourceCoverage:{complete:null,truncated:false,gapCount:2}}}};
 const original={ok:true,returned:{summary,graph:Array.from({length:200},(_,id)=>({id,code:'x'.repeat(1000)}))}};
 const delivered=require('../lib/chat-context').prepare('code',original);
 assert.deepEqual(delivered.returned.summary,summary);
 assert.equal(delivered.modelContext.compacted,true);
 assert.ok(Buffer.byteLength(JSON.stringify(delivered))<=12288);
});

test('constructed static proof claims must agree with the linked retained map and trace',async()=>{
 const R=require('../lib/results');
 const map=R.saveView('semantic-flow-map',{flowMap:{complete:false},proof:{runtime:'unknown',feasibility:'unknown',behaviorVerified:false},truncated:false,gaps:[]});
 const r=await T().call('code',{code:'return '+JSON.stringify({mapView:map,behaviorVerified:false,proofLimits:{entryMap:{runtime:'verified',feasibility:'feasible'}}})+';'});
 assert.equal(r.evidenceCheck.status,'contradictory-static-claims');
 assert.equal(r.evidenceCheck.fields.length,2);
 assert.equal(r.evidenceCheck.observedProofLimits.entryMap.proof.runtime,'unknown');
 assert.match(r.guidance,/without rerunning/);
});

test('semantic projections with wrong counts are checked against the exact linked map',async()=>{
 const R=require('../lib/results');
 const map=R.saveView('semantic-flow-map',{flowMap:{complete:false,entries:['m'],methods:[{entry:'m',name:'run'}],nodes:[{id:'n',kind:'decision',changes:[]}]},proof:{behaviorVerified:false},gaps:[]});
 const r=await T().call('code',{code:'return '+JSON.stringify({mapView:map,entry:'run',decisionCount:0})+';'});
 assert.equal(r.evidenceCheck.status,'contradictory-semantic-facts');
 assert.deepEqual(r.evidenceCheck.fields,[{field:'decisionCount',reported:0,observed:1}]);
 const correct=await T().call('code',{code:'return '+JSON.stringify({mapView:map,entry:'run',decisionCount:1})+';'});
 assert.equal(correct.evidenceCheck,undefined);
});

test('successful semantic projections recover the original summary without replay',()=>{
 const C=require('../lib/code-result'),R=require('../lib/results');
 const summary={entry:'run',decisionCount:3,mapView:'source',proofLimits:{proof:{runtime:'unknown'},sourceCoverage:{complete:false}}};
 const value={...Object.fromEntries(Array.from({length:20},(_,i)=>['field'+i,i])),summary};
 const receipt=C.receipt('what_happens_from',value);
 assert.deepEqual(receipt.result.summary,summary,'summary survives early-key receipt limits');
 const recovery=C.recovery([{tool:'what_happens_from',value}],[receipt]);
 assert.deepEqual(recovery.availableResult.summary,summary);
 assert.match(recovery.message,/Do not rerun/);
 assert.deepEqual(require('../lib/chat-context').read(recovery.availableResult.read.arguments).value,summary);
 assert.equal(R.load(receipt.read.arguments.id).data.field19,19);
});

test('result_read accepts owned local view URLs without accepting a foreign lookalike',async()=>{
 const R=require('../lib/results'),view=R.saveView('json',{flowMap:{nodes:[{id:'n'}]}});
 const r=await T().call('result_read',{id:view+'?embed=1',path:'/flowMap',all:true});
 assert.deepEqual(r.value,{nodes:[{id:'n'}]});
 await assert.rejects(T().call('result_read',{id:'https://foreign.example/show/'+R.referenceId(view),all:true}));
});

test('selected graph recovery derives structural facts from the same owned source',async()=>{
 const R=require('../lib/results'),sourceView=R.saveView('semantic-flow-map',{flowMap:{complete:false,entries:['m'],methods:[{entry:'m',name:'run'}],nodes:[{id:'a',kind:'entry',changes:[]},{id:'b',kind:'return',changes:[]}],edges:[{from:'a',to:'b',kind:'control'},{from:'b',to:'a',kind:'control'}]},proof:{runtime:'unknown',behaviorVerified:false},gaps:[]});
 const failed=await T().call('code',{code:'const r=await tools.result_read({id:'+JSON.stringify(sourceView)+',path:"/flowMap",all:true});return r.value.graph.nodes.length;'});
 assert.equal(failed.ok,false);
 assert.match(failed.diagnostic.message,/result.value itself/);
 assert.equal(failed.diagnostic.availableResult.summary.hasControlCycle,true);
 assert.equal(failed.diagnostic.availableResult.summary.nodeCount,2);
 assert.equal(failed.diagnostic.availableResult.sourceView,sourceView);
 const recovered=await T().call('code',failed.diagnostic.retry.arguments);
 assert.equal(recovered.returned.hasControlCycle,true);
 assert.equal(recovered.returned.behaviorVerified,false);
 const denied=await require('../lib/access').run({principalId:'not-the-owner',storyId:'elsewhere',multiUser:true,role:'user'},()=>T().call('code',{code:'return await tools.result_read({id:'+JSON.stringify(sourceView)+',all:true});'}));
 assert.equal(denied.ok,false);
 assert.equal(denied.diagnostic,undefined,'recovery cannot inspect another actor source');
});

test('the code schema advertises enabled call shapes without granting or leaking hidden capabilities',async()=>{
 const schema=(await T().schemas({profile:'code'}))[0];
 assert.match(schema.description,/tools.what_happens_from/);
 assert.match(schema.description,/assumptions\?:Array<\{expression:string, holds:boolean\}>/);
 assert.match(schema.description,/tools.result_read/);
 const contract=await T().call('tool_describe',{name:'what_happens_from'});
 assert.match(contract.codeUsage,/graph is flowMap/);
 assert.match(schema.description,/traceView is a URL string/);
 const limited=await require('../lib/access').run({principalId:'interface-limited',storyId:'interface-limited',multiUser:true,role:'user',tools:['code']},()=>T().schemas({profile:'code'}));
 assert.doesNotMatch(limited[0].description,/Enabled JavaScript API shapes/);
 assert.equal(limited.length,1,'only the code outer tool is exposed');
});
test('complete retained reads and aggregates expose separate upstream completeness',async()=>{
 const R=require('../lib/results'),view=R.save('pg',[{n:1},{n:2}],{truncated:true}),id=view.split('/').pop();
 for(const args of [{id,all:true},{id,aggregate:'sum',field:'n'},{id,aggregate:'summary',field:'n'}]){
  const r=await T().call('result_read',args);
  assert.equal(r.retainedComplete,true);assert.equal(r.sourceComplete,false);
  assert.equal(r.sourceComplete,r.sourceCoverage.provenComplete);
 }
 const page=await T().call('result_read',{id});assert.equal(page.sourceComplete,false);
});

test('business row flags are data and do not become upstream truncation metadata',async()=>{
 const R=require('../lib/results'),P=require('../lib/chat-pressure'),rows=[{complete:false,truncated:true,status:'pending'}];
 const view=R.save('pg',rows,{truncated:false}),id=view.split('/').pop();
 const r=await T().call('result_read',{id,all:true});
 assert.deepEqual(r.value.rows,rows);
 assert.equal(r.sourceCoverage.status,'unknown');
 assert.equal(r.sourceComplete,false);
 const delivered=P.response('result_read',r,{all:true}).value;
 assert.equal(delivered.modelContext.output.status,'all');
 assert.equal(delivered.modelContext.output.source,'unknown');
 assert.equal(delivered.retainedComplete,true);
});

test('nested selected summaries and evidence URLs survive large code-return previews',()=>{
 const summary={entry:'run',decisionCount:2,methodExitCount:1,mapComplete:false,mapView:'http://127.0.0.1:4000/show/ownedmap',proofLimits:{proof:{runtime:'unknown',behaviorVerified:false},sourceCoverage:{complete:false,truncated:false,gapCount:1}}};
 const returned={job:'query',state:'done',analyses:[{id:'a'.repeat(97)}],flowMap:{nodes:Array.from({length:100},(_,id)=>({id,code:'x'.repeat(1000)})),edges:Array.from({length:100},(_,id)=>({id,from:id,to:id+1}))},gaps:Array.from({length:20},()=>({detail:'g'.repeat(700)})),summary,mapView:summary.mapView};
 const r=require('../lib/chat-context').prepare('code',{ok:true,returned,views:[summary.mapView]});
 assert.deepEqual(r.returned.summary,summary);
 assert.equal(r.returned.mapView,summary.mapView);
 assert.ok(r.views.includes(summary.mapView));
 assert.equal(r.modelContext.compacted,true);
 assert.ok(Buffer.byteLength(JSON.stringify(r))<=12288);
});
test('large previews preserve JSON wire values for native date objects',()=>{
 const date=new Date('2024-04-05T06:07:08.000Z'),value={rows:[{at:date}],large:'x'.repeat(20000)};
 const r=require('../lib/chat-context').prepare('dated-result',value);
 assert.equal(r.rows[0].at,date.toISOString());
 assert.equal(value.rows[0].at,date,'preview must not mutate native caller data');
});
