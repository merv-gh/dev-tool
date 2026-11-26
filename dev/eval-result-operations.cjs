#!/usr/bin/env node
// Focused real-model comparison: arithmetic over retained data, with source coverage.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function run(){
 const o={root:path.resolve(__dirname,'..'),arm:'after',output:'',model:'qwen3.5:2b',repeats:'1'};
 for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!(k in o)||!process.argv[i+1])throw Error('Unknown/missing argument');o[k]=process.argv[i+1];}
 if(!o.output||!['1','2','3'].includes(o.repeats))throw Error('--output required; repeats 1–3');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-result-model-'));
 for(const k of Object.keys(process.env))if(/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS|TOOL_PROFILE|RUNNER_URL|SECURITY_PROFILE)$/.test(k))delete process.env[k];
 Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_NO_DOCTOR:'1',DT_LOG:'quiet'});
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},tools:{plugins:[]}}));
 const load=p=>require(path.join(path.resolve(o.root),p)),T=load('lib/tools'),A=load('lib/access'),P=load('lib/chat-pressure');
 const sourceDigest=load('lib/source-version').digest(o.root),system='Use the offered tools to complete the task. Do not invent missing data or results. The action already ran: do not repeat it. Return only the requested JSON.';
 const report={protocol:'dt.result-operations-model/v1',arm:o.arm,model:o.model,sourceDigest,harnessDigest:hash(fs.readFileSync(__filename)),instructionDigest:hash(system),startedAt:new Date().toISOString(),settings:{temperature:0,think:false,num_ctx:32768,num_predict:768,seed:42,repeats:Number(o.repeats),maxTurns:8,maxCalls:16,timeoutMs:90000},samples:[]};
 const save=()=>{fs.mkdirSync(path.dirname(path.resolve(o.output)),{recursive:true});fs.writeFileSync(o.output,JSON.stringify(report,null,2)+'\n');};
 async function request(route,body){const r=await fetch('http://127.0.0.1:11434'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Ollama HTTP '+r.status);return r.json();}
 try{
 report.advertised=(await request('/api/tags')).models.find(m=>m.name===o.model);if(!report.advertised)throw Error('Model unavailable');
 const schemas=(await T.schemas()).filter(t=>t.name==='result_read'),tools=schemas.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));report.schemas=schemas;
 for(let repeat=0;repeat<Number(o.repeats);repeat++)for(const id of ['all-retained','partial-source'])await A.run({principalId:'eval',storyId:id+'-'+repeat,role:'admin',multiUser:true},async()=>{
  const values=id==='all-retained'?[31,7,83,29,2,41,67,5,19,53,11,97]:[14,-9,23,6,81,-3,45,12,7,38,4,16];
  const rows=values.map((value,id)=>({id,value,payload:'synthetic data '.repeat(100)}));
  const raw={total:rows.length,rows,...(id==='partial-source'?{complete:false,truncated:true,gaps:['Another partition was unavailable']}:{})};
  const initial=P.response('snapshot',raw,{session:id}).value;
  const query='Calculate the sum of every value field across all retained rows. Report how many retained rows you included and whether the response proves complete source coverage. The action already ran; do not rerun it. Return only JSON {"sum":number,"rows":number,"sourceComplete":boolean}. Snapshot: '+JSON.stringify(initial);
  const messages=[{role:'system',content:system},{role:'user',content:query}];
  const sample={id,repeat,initial,wireBytes:Buffer.byteLength(JSON.stringify(tools)),expected:{sum:values.reduce((a,b)=>a+b,0),rows:12,sourceComplete:false},events:[],usage:{input:0,output:0},deliveredBytes:Buffer.byteLength(JSON.stringify(initial)),finish:'turn-budget'},start=Date.now();report.samples.push(sample);save();
  for(let turn=0;turn<8;turn++){
   if(Buffer.byteLength(JSON.stringify(messages))>180000){sample.finish='context-budget';break;}
   console.error(JSON.stringify({arm:o.arm,id,repeat,turn:turn+1}));
   let response;try{response=await request('/api/chat',{model:o.model,stream:false,think:false,messages,tools,options:{temperature:0,seed:42+repeat,num_ctx:32768,num_predict:768}});}catch(e){sample.finish='endpoint-error';sample.error=e.message;break;}
   sample.usage.input+=response.prompt_eval_count||0;sample.usage.output+=response.eval_count||0;const m=response.message;if(!m||m.role!=='assistant'){sample.finish='invalid-response';break;}messages.push(m);
   if(!m.tool_calls?.length){sample.final=m.content||'';sample.finish=response.done_reason==='length'?'output-budget':'assistant-finished';break;}
   if(sample.events.length+m.tool_calls.length>16){sample.finish='call-budget';break;}
   for(const c of m.tool_calls){let args,result,delivered,error;
    try{if(c.function?.name!=='result_read')throw Error('Tool not offered');args=typeof c.function.arguments==='string'?JSON.parse(c.function.arguments):c.function.arguments;result=await T.call('result_read',args);delivered=P.response('result_read',result,{session:id,all:args.all===true}).value;}
    catch(e){error=e.message;result=delivered={error,code:e.code};}
    sample.events.push({tool:c.function?.name,arguments:args,result,delivered,ok:!error});sample.deliveredBytes+=Buffer.byteLength(JSON.stringify(delivered));messages.push({role:'tool',tool_name:c.function?.name,content:JSON.stringify(delivered)});save();
   }
  }
  let final;try{final=JSON.parse((sample.final||'').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{}
  // Require actual full-array evidence, not a lucky answer. Both arms allow typed rows or contiguous pages.
  const evidence=require('./summarize-tool-io-model.cjs').recoveredRows(sample);
  const aggregate=sample.events.some(e=>e.ok&&e.arguments?.aggregate==='sum'&&e.arguments?.field==='value'&&e.result.value===sample.expected.sum&&e.result.rows===12&&(e.result.retainedComplete===true||e.result.complete===true));
  sample.previewSummaryEvidence=initial.modelContext?.numericSummary?.scope==='all-retained-rows'&&initial.modelContext.numericSummary.rows===12&&initial.modelContext.numericSummary.fields?.value?.sum===sample.expected.sum;
  sample.fullRowsRecovered=!!evidence&&JSON.stringify(evidence.map(r=>r.value))===JSON.stringify(values);sample.aggregateEvidence=aggregate;
  sample.arithmeticCorrect=!!(sample.fullRowsRecovered||aggregate||sample.previewSummaryEvidence)&&final?.sum===sample.expected.sum&&final?.rows===12;sample.coverageCorrect=final?.sourceComplete===false;sample.passed=sample.arithmeticCorrect&&sample.coverageCorrect;sample.ms=Date.now()-start;sample.transcript=messages;save();console.error(JSON.stringify({arm:o.arm,id,passed:sample.passed,calls:sample.events.length,finish:sample.finish}));
 });
 report.sourceChanged=sourceDigest!==load('lib/source-version').digest(o.root);report.completedAt=new Date().toISOString();report.summary={cases:report.samples.length,passed:report.samples.filter(s=>s.passed).length,calls:report.samples.reduce((n,s)=>n+s.events.length,0),errors:report.samples.reduce((n,s)=>n+s.events.filter(e=>!e.ok).length,0),deliveredBytes:report.samples.reduce((n,s)=>n+s.deliveredBytes,0),inputTokens:report.samples.reduce((n,s)=>n+s.usage.input,0),outputTokens:report.samples.reduce((n,s)=>n+s.usage.output,0)};save();console.log(JSON.stringify(report.summary));
 }finally{await load('lib/isolate').stop();await load('lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
