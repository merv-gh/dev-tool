// Disposable integration fixture. Never point this provider at a real chat server.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
if(process.argv[2]==='dt'){
 fs.mkdirSync('/data',{recursive:true});
 const defaultPolicy=process.env.CONTEXT_TEST_THRESHOLD==='default';
 fs.writeFileSync('/data/config.json',JSON.stringify({envs:{dev:{}},scripts:{starters:false},server:{trustNetwork:true},llm:{contextWindow:Number(process.env.CONTEXT_TEST_WINDOW||32768),...(defaultPolicy?{}:{compactAt:Number(process.env.CONTEXT_TEST_THRESHOLD||5000)})},tools:{modelResultBytes:Number(process.env.CONTEXT_TEST_RESULT_BYTES||12288),plugins:['fixture.js'],profiles:{'context-fixture':{includeCore:false,names:['context_payload','result_read','tool_execute'],...(defaultPolicy?{prefixes:['']}: {})}}}}));
 fs.writeFileSync('/data/fixture.js',`let calls=0;module.exports=[{name:'context_payload',description:'Synthetic calculation evidence. Inspect this result before requesting the next step.',input:{step:{type:'integer'}},required:['step'],run:({step})=>({step,calls:++calls,total:step*(step+1)/2,constraint:'CTX-17: do not push',evidence:'synthetic rows; no production effects',rows:Array.from({length:60},(_,i)=>({i,note:'large synthetic tool evidence '.repeat(100)}))})},{name:'context_payload_count',description:'Fixture invocation count',input:{},run:()=>calls}];`);
 const child=spawn(process.execPath,['/app/dt.js','serve','--lan','--port','4000'],{stdio:'inherit'});
 process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGINT'));child.on('close',code=>process.exit(code||0));
}else{
 const fresh=()=>({rounds:0,summaries:0,maxRequestBytes:0,requests:[],protocolErrors:[],summaryTexts:[],summaryModel:process.env.CONTEXT_SUMMARY_URL?(process.env.CONTEXT_SUMMARY_MODEL||'qwen3.5:4b'):'deterministic-fixture'});let stats=fresh();
 const window=Number(process.env.CONTEXT_TEST_WINDOW||32768),requestCap=(window-(process.env.CONTEXT_TEST_THRESHOLD==='default'?512:Math.min(8192,Math.floor(window/4))))*4;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/reset'&&req.method==='POST'){stats=fresh();res.setHeader('content-type','application/json');return res.end('{\"reset\":true}');}
  if(req.url==='/stats'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({...stats,requestCapBytes:requestCap}));}
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({object:'list',data:[{id:'context-fixture',object:'model',owned_by:'disposable-fixture'}]}));}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);return res.end('{}');}
  let text='';for await(const b of req)text+=b;const body=JSON.parse(text),messages=body.messages||[];
  const ids=new Set();for(const m of messages){if(m.role==='assistant')for(const t of m.tool_calls||[])ids.add(t.id);if(m.role==='tool'&&!ids.delete(m.tool_call_id))stats.protocolErrors.push('orphan '+m.tool_call_id);}if(ids.size)stats.protocolErrors.push('missing tool results');
  const n=Buffer.byteLength(text);stats.maxRequestBytes=Math.max(stats.maxRequestBytes,n);stats.requests.push({bytes:n,messages:messages.length,stream:!!body.stream,afterToolRound:stats.rounds,systemBytes:Buffer.byteLength(JSON.stringify(messages.filter(m=>m.role==='system'))),toolSchemaBytes:Buffer.byteLength(JSON.stringify(body.tools||[])),intentPinned:messages.some(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('Continue CTX-17.')&&m.content.includes('Do not push.')),hasSummary:messages.some(m=>typeof m.content==='string'&&m.content.includes('[CONVERSATION SUMMARY]')),toolResults:messages.filter(m=>m.role==='tool').length});
  if(n>requestCap){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:{code:'context_length_exceeded',message:'Synthetic serving limit exceeded'}}));}
  let message,finish='stop';
  if(!body.stream){
   stats.summaries++;
   let summary='CTX-17: do not push. Continue the synthetic calculation, retaining the latest step/total and result IDs. No production effects occurred. Read exact tool evidence with result_read; no action should be replayed.';
   if(process.env.CONTEXT_SUMMARY_URL){const native=process.env.CONTEXT_SUMMARY_NATIVE==='1',prompt=messages.map(m=>m.content||'').join('\n');const r=await fetch(process.env.CONTEXT_SUMMARY_URL+(native?'/chat':'/chat/completions'),{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:process.env.CONTEXT_SUMMARY_MODEL||'qwen3.5:4b',messages:messages.map(m=>({role:m.role,content:m.content})),stream:false,...(native?{think:false,options:{num_ctx:8192,num_predict:512,temperature:0}}:{max_tokens:512,temperature:0})})});const result=await r.json();if(!r.ok)throw Error(JSON.stringify(result));summary=native?result.message?.content:result.choices?.[0]?.message?.content||'';}
   stats.summaryTexts.push(summary);message={role:'assistant',content:summary};
  }else if(stats.rounds<12){
   const tool=(body.tools||[]).find(t=>t.function.name.endsWith('context_payload'))||(body.tools||[]).find(t=>t.function.name.endsWith('tool_execute'));
   if(!tool){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'Fixture tool was not enabled',tools:(body.tools||[]).map(t=>t.function.name)}}));}
   const step=++stats.rounds;message={role:'assistant',content:null,tool_calls:[{id:'fixture-step-'+step,type:'function',function:{name:tool.function.name,arguments:JSON.stringify(tool.function.name.endsWith('tool_execute')?{name:'context_payload',arguments:{step}}:{step})}}]};finish='tool_calls';
  }else message={role:'assistant',content:'CTX-17 complete: sum 1 through 12 = 78. No push performed.'};
  const usage={prompt_tokens:Math.ceil(n/4),completion_tokens:40,total_tokens:Math.ceil(n/4)+40},id='chatcmpl-fixture-'+Date.now();
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{...message,...(message.tool_calls?{tool_calls:message.tool_calls.map((t,i)=>({...t,index:i}))}:{})},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:finish}],usage})+'\n\ndata: [DONE]\n\n');res.end();}
  else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id,object:'chat.completion',model:body.model,choices:[{index:0,message,finish_reason:finish}],usage}));}
 });server.listen(5000,'0.0.0.0');
}
