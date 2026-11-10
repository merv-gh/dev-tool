const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-chat-context-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS','LLM_MODEL','LLM_CONTEXT_WINDOW','LLM_COMPACT_AT','LLM_CONTEXT_RESERVE','LLM_COMPACTION_MODE','ENABLE_CONTEXT_COMPACTION'])delete process.env[k];
Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_LOG:'quiet',DT_NO_DOCTOR:'1'});
const config={envs:{dev:{}},scripts:{starters:false},tools:{plugins:['fixture.js']}};
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
fs.writeFileSync(path.join(home,'fixture.js'),`let calls=0;module.exports=[{name:'context_payload',description:'Disposable response fixture',input:{},run:()=>({ok:false,outcome:'failed',job:'owned-job',calls:++calls,rows:Array.from({length:100},(_,id)=>({id,payload:'данные 😀\\n'.repeat(250)}))})},{name:'context_payload_count',description:'Fixture invocation count',input:{},run:()=>calls}];`);
const C=require('../lib/chat-context'),A=require('../lib/access'),R=require('../lib/results'),T=require('../lib/tools');
let server,base;
test.before(async()=>{server=require('../server').start({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(r=>server.close(r));await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
const post=(url,body,story='default')=>fetch(base+url,{method:'POST',headers:{'content-type':'application/json','x-dt-story':story},body:JSON.stringify(body)});
test('small model results preserve their exact type and value',()=>{for(const value of [false,0,null,'text',[1,2],{ok:false}])assert.equal(C.prepare('small',value),value);});
test('OpenAPI bounds model context, retains exact evidence and does not replay the tool',async()=>{
 const before=await T.call('context_payload_count');
 const response=await post('/oapi/context_payload',{}),body=await response.json(),preview=body[1];
 assert.equal(body[0],'embed');assert.match(response.headers.get('location'),/embed=1/);
 assert.ok(Buffer.byteLength(JSON.stringify(preview))<=12288);assert.equal(preview.modelContext.compacted,true);assert.equal(preview.ok,false);assert.equal(preview.outcome,'failed');assert.equal(preview.job,'owned-job');
 const id=preview.modelContext.resultId,retained=R.load(id);assert.equal(retained.data.rows.length,100);assert.equal(await T.call('context_payload_count'),before+1);
 let cursor,text='';do{const part=await T.call('result_read',{id,path:'/rows/0/payload',...(cursor?{cursor}:{}),max_bytes:128});assert.ok(Buffer.byteLength(JSON.stringify(part))<12288);assert.ok(!part.text.includes('\ufffd'));text+=part.text;cursor=part.nextCursor;}while(cursor);
 assert.equal(JSON.parse(text),retained.data.rows[0].payload);assert.equal(await T.call('context_payload_count'),before+1,'retrieval never repeats the original action');
 const forbidden=await post('/api/tool/result_read',{id},'another-story');assert.equal(forbidden.status,404);
 const first=C.read({id,path:'/rows',max_bytes:128});assert.throws(()=>C.read({id,path:'/job',cursor:first.nextCursor}),/Cursor/);
 assert.throws(()=>C.read({id,path:'/__proto__'}),/does not exist/);assert.throws(()=>C.read({id,path:'/bad~2escape'}),/escape/);
 fs.rmSync(path.join(home,'cache/results',id+'.json'));assert.throws(()=>C.read({id}),e=>e.code==='DT_NOT_FOUND');
});
test('MCP uses the same bounded transport while direct/API scripts keep full data',async()=>{
 const api=await(await post('/api/tool/context_payload',{})).json();assert.equal(api.result.rows.length,100);assert.equal(api.result.modelContext,undefined);
 const mcp=await(await post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'context_payload',arguments:{}}})).json();
 const value=JSON.parse(mcp.result.content[0].text);assert.equal(value.modelContext.compacted,true);assert.equal(value.ok,false);assert.equal(R.load(value.modelContext.resultId).data.rows.length,100);
});
test('failed retention reports the successful invocation separately without rerunning it',t=>{
 t.mock.method(R,'saveTool',()=>{throw Error('fixture disk full');});
 const value=C.prepare('write_fixture',{ok:true,job:'job-already-started',text:'x'.repeat(50000)});
 assert.equal(value.ok,true);assert.equal(value.job,'job-already-started');assert.equal(value.modelContext.evidenceSaved,false);assert.match(value.modelContext.saveError,/disk full/);assert.match(value.modelContext.guidance,/already ran/);
});
test('original visualizations survive response compaction and nested data stays unchanged',()=>{
 const original={view:'https://example.test/show/existing',rows:[{text:'x'.repeat(50000)}]},copy=JSON.stringify(original),value=C.prepare('graph',original);
 assert.equal(value.view,original.view);assert.notEqual(value.modelContext.evidenceView,value.view);assert.equal(JSON.stringify(original),copy);
 const id=value.modelContext.resultId;assert.equal(JSON.parse(C.read({id,path:'/view'}).text),original.view);
});
test('policy reserves space, supports exact per-model windows and rejects unsafe thresholds',()=>{
 const cfg=require('../lib/config');assert.equal(C.policy().compactAt,24576);assert.equal(C.policy().mode,'manual');assert.ok(C.policy().automaticThreshold>10000000);
 const qwen=C.policy('qwen3.8:27b');assert.equal(qwen.contextWindow,262144);assert.equal(qwen.reserveTokens,32768);assert.equal(qwen.compactAt,196608);assert.equal(qwen.mode,'manual');
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{contextWindow:32768,contextWindows:{wide:65536,tiny:8192}}}));cfg.reload();assert.equal(C.policy('wide').compactAt,49152);assert.equal(C.policy('tiny').compactAt,6144);
 assert.equal(C.policy('qwen3.8:27b').contextWindow,32768,'explicit serving limits override the model preset');
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{compactionMode:'auto'}}));cfg.reload();assert.equal(C.policy().automaticThreshold,24576);
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{compactionMode:'invalid'}}));cfg.reload();assert.throws(()=>C.policy(),/compactionMode/);
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{contextWindow:32768,contextReserve:12288}}));cfg.reload();assert.equal(C.policy().compactAt,20480,'a larger explicit reserve takes precedence over 75%');
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{contextWindow:32768,compactAt:12000}}));cfg.reload();assert.equal(C.policy().compactAt,12000,'explicit conservative thresholds remain supported');
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{contextWindow:4096,compactAt:4000}}));cfg.reload();assert.throws(()=>C.policy(),/llm.compactAt/);
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,llm:{compaction:'False'}}));cfg.reload();assert.equal(C.policy().enabled,false);
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,tools:{...config.tools,modelResultBytes:0}}));cfg.reload();const raw={text:'x'.repeat(30000)};assert.equal(C.prepare('raw-client',raw),raw,'operators can retain legacy unbounded transport shapes');
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));cfg.reload();
});
test('root pages use byte ranges and small budgets retain late operation identities',t=>{
 const value={payload:'😀'.repeat(200000),job:'late-owned-job',ok:true};
 const preview=C.prepare('large',value);assert.equal(preview.job,value.job);assert.equal(preview.ok,true);
 const id=preview.modelContext.resultId;
 t.mock.method(R,'load',()=>assert.fail('root paging must not parse the full retained result'));
 let cursor,text='';for(let i=0;i<4;i++){const page=C.read({id,cursor,max_bytes:128});assert.ok(!page.text.includes('\ufffd'));assert.ok(page.nextCursor);text+=page.text;cursor=page.nextCursor;}
 assert.ok(text.startsWith('{"payload":"😀'));assert.throws(()=>C.read({id,max_bytes:1}),/max_bytes/);
 assert.throws(()=>C.read({id,cursor:'invalid'}),/Cursor/);
});
test('small retained primitives, damaged files and invalid page arguments fail explicitly',()=>{
 const url=R.saveTool('primitive','null'),id=url.split('/').pop();const page=C.read({id,max_bytes:128});assert.equal(page.text,'null');assert.equal(page.complete,true);assert.equal(page.nextCursor,null);
 for(const path of ['bad','/missing','/bad~2pointer'])assert.throws(()=>C.read({id,path}),/pointer|exist|escape/);
 assert.throws(()=>C.read({id,max_bytes:'invalid'}),/max_bytes/);
 fs.appendFileSync(path.join(home,'cache/results',id+'.json'),'x');assert.throws(()=>C.read({id}),e=>e.code==='DT_NOT_FOUND');fs.rmSync(path.join(home,'cache/results',id+'.json'));
 assert.throws(()=>R.saveTool('oversized','x'.repeat(20000001)),/retention budget/);
});
test('context pressure is advisory, session-scoped and does not compact or alter normal result types',async()=>{
 const P=require('../lib/chat-pressure');assert.equal(P.status('isolated').pressure,'unknown');
 const low=P.response('small',false,{session:'low'});assert.equal(low.value,false);assert.equal(low.meta.reportedUsedTokens,null);
 const high=P.response('small',{ok:true,job:'already-submitted'},{session:'high',usage:{usedTokens:240000,contextWindow:262144,model:'qwen3.8:27b'}});
 assert.equal(high.value.ok,true);assert.equal(high.value.modelContext.pressure.pressure,'high');assert.equal(high.meta.advisory,true);assert.equal(P.status('low').compactionRecommended,false);
 assert.equal(A.run({principalId:'other',storyId:'one'},()=>P.status('high')).pressure,'unknown');
 const invalid=P.response('small',{ok:true},{session:'high',usage:'invalid json'});assert.equal(invalid.value.ok,true);assert.match(invalid.meta.reportError,/ignored/);
 const context=require('../lib/context');context.open({id:'compact-check',title:'Check progress'});const before=P.status().toolResponses,request=P.compactRequest({context:'compact-check',checkpoint:'Goal: preserve exact SHA and failed build #17. Next: fix the identity mapping.'});assert.equal(request.compacted,false);assert.equal(P.status().toolResponses,before);assert.match(context.read({id:'compact-check',path:request.checkpoint.path}).content,/build #17/);
});
test('MCP metadata and OpenAPI headers carry pressure without changing full direct API results',async()=>{
 const usage={usedTokens:250000,contextWindow:262144};const r=await post('/mcp',{jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'context_payload_count',arguments:{},_meta:{'dev-tool/context':usage}}});const m=await r.json();assert.equal(m.result._meta['dev-tool/context'].pressure,'high');assert.equal(JSON.parse(m.result.content[0].text).modelContext.pressure.pressure,'high');
 const o=await fetch(base+'/oapi/context_payload_count',{method:'POST',headers:{'content-type':'application/json','x-dt-context-usage':JSON.stringify(usage)},body:'{}'});assert.equal(JSON.parse(o.headers.get('x-dt-context')).pressure,'high');
 const api=await(await post('/api/tool/context_payload_count',{})).json();assert.equal(typeof api.result,'number');
});
test('high pressure hints respect a small model response budget and retain original evidence once',()=>{
 const cfg=require('../lib/config'),P=require('../lib/chat-pressure');fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,tools:{modelResultBytes:4096}}));cfg.reload();
 try{const value=P.response('big',{ok:true,job:'submitted-once',rows:['😀'.repeat(10000)]},{session:'small-pressure',usage:{usedTokens:4000,contextWindow:4096}}).value;assert.ok(Buffer.byteLength(JSON.stringify(value))<=4096);assert.equal(value.ok,true);assert.equal(value.job,'submitted-once');assert.equal(value.modelContext.pressure.pressure,'high');assert.equal(R.load(value.modelContext.resultId).data.rows.length,1);}finally{fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));cfg.reload();}
});
