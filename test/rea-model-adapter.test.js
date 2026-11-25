const test=require('node:test'),assert=require('node:assert/strict'),R=require('../dev/rea-model-adapter');
const tools=[{type:'function',function:{name:'save',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'},count:{type:'integer'}}}}}];
test('REA raw alias adapter preserves native call/result pairing and source text',()=>{
 const source='export default {"parts":[]};',call=R.callText('save',{path:'chair.js',content:source,count:2}),message=R.parse(call,{tools});assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments),{path:'chair.js',content:source,count:2});
 const p=R.prompt({tools,messages:[{role:'system',content:'Metric, Y up'},{role:'user',content:'Create chair'},message,{role:'tool',tool_call_id:message.tool_calls[0].id,content:'saved'},{role:'user',content:'Review'}]});assert.match(p,/<tool_response>\nsaved/);assert.match(p,/Metric, Y up/);assert.ok(p.endsWith('<think>\n\n</think>\n\n'));
});
test('malformed, unknown, partial and duplicate native calls are never repaired',()=>{
 for(const text of ['<tool_call>bad</tool_call>','<tool_call><function=other></function></tool_call>','<tool_call><function=save>','<tool_call><function=save><parameter=path>a</parameter><parameter=path>b</parameter></function></tool_call>'])assert.throws(()=>R.parse(text,{tools}));
 assert.deepEqual(R.parse('Done',{tools}),{role:'assistant',content:'Done'});
});
test('native protocol failures retain the provider response and are permanent 422s',async()=>{
 const http=require('node:http'),value={response:'<tool_call><function=save>{"path":"chair.js"}</function></tool_call>',done:true,prompt_eval_count:10,eval_count:8};
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let captured;
 try{const result=await R.generate('http://127.0.0.1:'+server.address().port+'/v1',{model:'fixture',messages:[{role:'user',content:'Save'}],tools,max_tokens:100},{onResponse:r=>captured=r});assert.equal(result.status,422);assert.equal(captured.response,value.response);assert.equal(JSON.parse(result.body).code,'REA_MODEL_PROTOCOL');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
