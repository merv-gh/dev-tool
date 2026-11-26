const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-result-ops-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_PASSPORTS_DIR'])delete process.env[k];
Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_LOG:'quiet',DT_NO_DOCTOR:'1'});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},tools:{plugins:[]}}));
const T=require('../lib/tools'),R=require('../lib/results'),A=require('../lib/access'),P=require('../lib/chat-pressure');
const retain=data=>R.saveTool('snapshot',JSON.stringify(data)).split('/').pop();
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('projection and aggregates use all retained rows, never the chat preview, and preserve raw retrieval',async()=>{
 const values=[31,7,83,29,2,41,67,5,19,53,11,97],rows=values.map((value,id)=>({id,value,payload:'large '.repeat(1000)}));
 const preview=P.response('snapshot',{total:12,rows}).value,id=preview.modelContext.resultId;
 assert.ok(preview.rows.length<12);assert.equal(preview.modelContext.numericSummary.fields.value.sum,445);assert.equal(preview.modelContext.numericSummary.rows,12);assert.equal(preview.modelContext.numericSummary.fields.id,undefined);
 const projected=await T.call('result_read',{id,fields:['id','value'],all:true});assert.deepEqual(projected.value,rows.map(({id,value})=>({id,value})));assert.equal(projected.path,'/rows');assert.equal(projected.rows,12);
 const summary=await T.call('result_read',{id,aggregate:'sum',field:'value'});assert.equal(summary.value,445);assert.equal(summary.rows,12);assert.equal(summary.retainedComplete,true);assert.equal(summary.sourceCoverage.status,'unknown');assert.equal(summary.sourceCoverage.provenComplete,false);assert.equal(summary.complete,undefined);assert.ok(Buffer.byteLength(JSON.stringify(summary))<1024);
 assert.deepEqual((await T.call(summary.read.tool,summary.read.arguments)).value,rows);
 for(const [aggregate,expected]of [['count',12],['avg',445/12],['min',2],['max',97]])assert.equal((await T.call('result_read',{id,aggregate,...(aggregate==='count'?{}:{field:'value'})})).value,expected);
 assert.equal(rows[0].payload.length,6000);
 const short=await T.call('result_read',{id,path:'/rows/value',fields:['value'],all:true});assert.equal(short.path,'/rows');assert.equal(short.normalizedFrom,'/rows/value');assert.equal(short.value.length,12);assert.equal((await T.call(short.next.tool,short.next.arguments)).value,445);
 assert.equal((await T.call('result_read',{id,path:'/rows/value',aggregate:'sum',field:'value'})).value,445);
 await assert.rejects(T.call('result_read',{id,path:'/rows/value',all:true}),/pointer/i);
 await assert.rejects(T.call('result_read',{id,path:'/rows/value',fields:['id']}),/pointer/i);
 await assert.rejects(T.call('result_read',{id,path:'/rows/value/value',fields:['value']}),/pointer/i);
});
test('aggregation reports partial source coverage even when every retained row was processed',async()=>{
 for(const data of [{truncated:true,rows:[{n:5},{n:8}]},{complete:false,gaps:['partition unavailable'],rows:[{n:5},{n:8}]}]){
  const id=retain(data),summary=await T.call('result_read',{id,path:'/rows',aggregate:'sum',field:'n'});
  assert.equal(summary.value,13);assert.equal(summary.retainedComplete,true);assert.equal(summary.sourceCoverage.status,'partial');
  assert.equal(P.response('result_read',summary).value.modelContext.output.source,'partial');assert.equal(P.response('result_read',summary).value.modelContext.output.status,'all');
  assert.equal((await T.call('result_read',{id,path:'/rows',all:true})).sourceCoverage.status,'partial');
 }
});
test('numeric aggregation rejects missing, coerced, overflowing and unsafe values instead of silently dropping them',async()=>{
 for(const n of [null,'7',undefined,Number.MAX_SAFE_INTEGER+1]){
  const id=retain({rows:[{n:1},{n}]});await assert.rejects(T.call('result_read',{id,aggregate:'sum',field:'n'}),/every retained row/);
 }
 const overflow=retain({rows:[{n:Number.MAX_SAFE_INTEGER},{n:1}]});await assert.rejects(T.call('result_read',{id:overflow,aggregate:'sum',field:'n'}),/precision/);
 const id=retain({rows:[]});for(const [aggregate,expected]of [['sum',0],['count',0],['avg',null],['min',null],['max',null]])assert.equal((await T.call('result_read',{id,aggregate,...(aggregate==='count'?{}:{field:'n'})})).value,expected);
});
test('operations respect pointers, scope isolation, field presence and unambiguous inputs',async()=>{
 const id=retain({other:[JSON.parse('{"a/b":3,"__proto__":4}')],rows:[{n:1},{n:2}]});
 const special=await T.call('result_read',{id,path:'/other',fields:['__proto__'],all:true});assert.equal(Object.hasOwn(special.value[0],'__proto__'),true);assert.equal(special.value[0].__proto__,4);assert.equal(Object.getPrototypeOf(special.value[0]),Object.prototype);
 assert.equal((await T.call('result_read',{id,path:'/other',aggregate:'sum',field:'a/b'})).value,3);
 await assert.rejects(T.call('result_read',{id,fields:['missing']}),/missing/);
 await assert.rejects(T.call('result_read',{id,fields:['n'],aggregate:'sum',field:'n'}),/Choose/);
 await assert.rejects(T.call('result_read',{id,aggregate:'sum',field:'n',cursor:'x'}),/omit cursor/);
 await assert.rejects(T.call('result_read',{id,field:'n'}),/requires aggregate/);
 await assert.rejects(T.call('result_read',{id,aggregate:'count',field:'n'}),/omit field/);
 await assert.rejects(T.call('result_read',{id,path:'/rows/0',aggregate:'count'}),/requires an array/);
 await assert.rejects(T.call('result_read',{id,path:'/rows/0',fields:['n']}),/requires an array/);
 await assert.rejects(A.run({principalId:'other',storyId:'other'},()=>T.call('result_read',{id,aggregate:'count'})),/unavailable|expired/);
});
test('exact discovery exposes usable schemas and dispatch guidance without authorizing disabled tools',async()=>{
 const profile=await T.schemas({profile:'scripts-read'});assert.deepEqual(profile.map(t=>t.name),['script_search','script_get']);assert.ok(Buffer.byteLength(JSON.stringify(profile))<2048);
 const result=await T.call('tool_search',{query:'script_search',all:true});assert.equal(result.tools.length,1);assert.equal(result.tools[0].inputSchema.properties.query.type,'string');assert.equal(result.next.tool,'tool_execute');assert.equal(result.next.name,'script_search');
 const S=require('../lib/scripts');S.save('orders/unpaid',{description:'Inspect unpaid orders',params:{customerId:{required:true,type:'string'}},steps:[{set:{source:"synthetic"}}]});
 const found=await T.call(result.next.tool,{name:result.next.name,arguments:{query:'unpaid'}});assert.equal(found.scripts[0].id,'orders/unpaid');
 const suggested=await T.call('tool_search',{query:'script_search unpaid orders'});assert.equal(suggested.discoveryOnly,true);assert.deepEqual(suggested.next.arguments,{name:'script_search',arguments:{query:'unpaid orders'}});assert.equal((await T.call(suggested.next.tool,suggested.next.arguments)).scripts.length,1);
 const natural=await T.call('tool_search',{query:'find the saved script for unpaid orders'});assert.deepEqual(natural.next.arguments,{name:'script_search',arguments:{query:'unpaid orders'}});
 const definition=await T.call('script_get',{id:'orders/unpaid'});assert.deepEqual(definition.requiredParams,['customerId']);
 const desc=await T.call('tool_describe',{name:'script_get'});assert.equal(desc.next.name,'script_get');
 const restricted=await A.run({principalId:'limited',storyId:'one',tools:['tool_search']},()=>T.call('tool_search',{query:'script_search'}));assert.equal(restricted.tools.some(t=>t.name==='script_search'),false);
});

test('preview totals omit unsafe or incomplete columns and scoped JSON pages report output coverage separately',async()=>{
 const F=require('../lib/result-operations');assert.equal(F.numericSummary([{n:1},{n:null}]),undefined);assert.equal(F.numericSummary([{n:Number.MAX_SAFE_INTEGER},{n:1}]),undefined);assert.equal(F.numericSummary([{id:1},{id:2}]),undefined);assert.equal(F.numericSummary([{n:1},{n:2}]).fields.n.sum,3);
 const id=retain({rows:[{n:1},{n:2}],payload:'x'.repeat(1000)}),page=await T.call('result_read',{id,max_bytes:128}),chat=P.response('result_read',page).value;assert.equal(page.complete,false);assert.equal(chat.modelContext.output.status,'part');assert.equal(chat.modelContext.output.source,'unknown');
 const limited=retain({truncated:true,rows:[{n:1}],payload:'x'.repeat(1000)}),part=await T.call('result_read',{id:limited,path:'/payload',max_bytes:128}),limitedChat=P.response('result_read',part).value;assert.equal(limitedChat.modelContext.output.status,'part');assert.equal(limitedChat.modelContext.output.source,'partial');
});
