#!/usr/bin/env node
// Fresh Joern artifacts and real production tool/job orchestration. No synthetic query override.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function main(){
 const o={state:'/tmp/dt-joern-code-live-session.json',output:'',model:'qwen3.5:2b',endpoint:'http://127.0.0.1:11434',shape:'brief'};
 for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!(k in o)||!process.argv[i+1])throw Error('Unknown/missing argument');o[k]=process.argv[i+1];}if(!o.output)throw Error('--output required');if(!['brief','typed'].includes(o.shape))throw Error('--shape brief|typed required');
 const state=JSON.parse(fs.readFileSync(o.state)),home=state.traceHome;
 if(!home||!fs.existsSync(path.join(home,'report.json')))throw Error('Complete the live path-trace verification first');
 for(const k of Object.keys(process.env))if(/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|TOOLS|TOOL_PROFILE|SECURITY_PROFILE)$/.test(k))delete process.env[k];
 Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_SEMANTIC_URL:state.url,DT_SEMANTIC_TOKEN:state.token});
 const T=require('../lib/tools'),C=require('./semantic-question-candidates.cjs'),original=JSON.parse(fs.readFileSync(path.join(home,'trace.json'))),predicate='rebate < 0 || rebate > gross';
 let analysis=original.analyses[1].id;
 const report={protocol:'dt.semantic-live-model/v1',shape:o.shape,scope:'Fresh real Java Joern CPGs; production registry, Node code sandbox and owned-job orchestration. Candidate question adapters are evaluation-only. The analysis id is supplied to isolate navigation of real evidence from revision discovery.',model:o.model,endpoint:o.endpoint,sourceDigest:require('../lib/source-version').digest(),harnessDigest:hash(fs.readFileSync(__filename)),adapterDigest:hash(fs.readFileSync(require.resolve('./semantic-question-candidates.cjs'))),startedAt:new Date().toISOString(),analysis,expectedPredicate:predicate,sinkArgument:2,expectedAssumptionHolds:false,semanticCalls:[],backendCalls:[],events:[],usage:{input:0,output:0},settings:{think:false,temperature:0,seed:42,num_ctx:32768,num_predict:1024,maxTurns:8,maxCalls:16,timeoutMs:90000},engine:{containerImage:state.image,actualJoernVersion:state.actualJoernVersion,workerInfo:state.workerInfo,verification:JSON.parse(fs.readFileSync(path.join(home,'report.json')))}};
 const save=()=>{fs.mkdirSync(path.dirname(path.resolve(o.output)),{recursive:true});fs.writeFileSync(o.output,JSON.stringify(report,null,2)+'\n');};
 const live={call:async(name,args)=>{
  const started=Date.now();let r=await T.call(name,{...args,waitMs:30000});const observations=[];
  for(let i=0;r.state==='running'&&i<24;i++){observations.push({job:r.job,state:r.state});r=await T.call(name,{job:r.job,waitMs:30000,all:true});}
  if(r.error||r.state==='running')throw Error(r.error||'Live query observation budget exhausted');
  report.backendCalls.push({tool:name,arguments:args,ms:Date.now()-started,observations,result:r});
  if(name==='semantic_query'||name==='semantic_trace')report.semanticCalls.push({arguments:{...args,...(name==='semantic_trace'?{operation:'trace'}:{})},result:r});save();return r;
 }};
 try{
  const previous=require('../lib/semantic-code').load(analysis);
  if(previous.workspace){const refreshed=await live.call('semantic_index',{repo:'work/'+previous.workspace,language:'java',all:true});analysis=refreshed.analyses.find(a=>a.language==='java').id;report.analysis=analysis;report.reindexedForCurrentWorker=true;}
  const code=`const settle=async(name,args)=>{let r=await tools.call(name,{...args,all:true,waitMs:30000});for(let i=0;r.state==='running'&&i<24;i++)r=await tools.call(name,{job:r.job,all:true,waitMs:1000});if(r.error||r.state==='running')throw Error(r.error||'query still running');return r;};
const m=await settle('semantic_query',{analysis:${JSON.stringify(analysis)},operation:'flowmap',from:{name:'submit'},budgetMs:15000});
const t=await settle('semantic_trace',{analysis:${JSON.stringify(analysis)},from:{kind:'method',name:'submit',parameter:'rebate'},to:{kind:'call',name:'save',argument:2},assumptions:[{expression:${JSON.stringify(predicate)},holds:false}],budgetMs:15000});
const exits=m.flowMap.nodes.filter(n=>n.exit);return {analysis:${JSON.stringify(analysis)},entry:m.flowMap.methods.filter(m=>m.name==='submit').map(m=>({name:m.name,file:m.file,line:m.line})),exits:exits.slice(0,8).map(n=>({code:n.code,file:n.file,line:n.line,kind:n.exit})),exitCount:exits.length,mapComplete:m.flowMap.complete,trace:t.sides.map(s=>({data:s.data.paths.map(p=>({sink:p.nodes.at(-1)?.code,assumption:p.assumptionEvaluation.status})),control:s.control.paths.map(p=>({assumption:p.assumptionEvaluation.status,conditions:p.conditions.map(c=>({expression:c.expression,polarity:c.polarity}))}))})),proof:{behaviorVerified:t.proof.behaviorVerified,feasibility:t.proof.feasibility,runtime:t.proof.runtime},output:{status:'part',scope:'selected-evidence',exitsOmitted:Math.max(0,exits.length-8),sourceTruncated:t.truncated},views:[m.view,t.view]};`;
  report.codeProbe={code,result:await T.call('code',{code,engine:'node',title:'Real Joern entry, exit and assumption evidence'})};report.codeProbe.bytes=Buffer.byteLength(JSON.stringify(report.codeProbe.result));save();
  const schemas=C.schemas(true,true,o.shape==='typed');report.schemas=schemas;const tools=schemas.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));report.schemaBytes=Buffer.byteLength(JSON.stringify(tools));
  const system='Use the offered tools to inspect retained semantic evidence. Discover tools/schemas when needed. Keep entry-to-exit maps separate from value flow and runtime proof. No writes, no network fetch from code. Return only JSON when asked.';
  const prompt=`For retained repaired Java analysis ${analysis}, inspect the submit entry-to-exit map and trace its rebate parameter to argument 2 of save under the assumption that ${predicate} is false. Return JSON {entry,exitCall,sinkExpression,controlAssumption,dataAssumption,behaviorVerified,mapComplete,evidenceViews}. Use exact assumption evaluation statuses from results. Include retained view links. Do not parse a new analysis.`;
  const messages=[{role:'system',content:system},{role:'user',content:prompt}];report.prompt=prompt;report.instructionDigest=hash(system);report.finish='turn-budget';
  for(let turn=0;turn<8;turn++){
   console.error(JSON.stringify({runtime:'real-joern',turn:turn+1}));let response;
   try{const r=await fetch(o.endpoint.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:o.model,stream:false,think:false,messages,tools,options:{temperature:0,seed:42,num_ctx:32768,num_predict:1024}}),signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Ollama HTTP '+r.status+': '+(await r.text()).slice(0,4000));response=await r.json();}catch(e){report.error=e.message;report.finish='endpoint-error';break;}
   report.usage.input+=response.prompt_eval_count||0;report.usage.output+=response.eval_count||0;messages.push(response.message);
   if(!response.message.tool_calls?.length){report.final=response.message.content;report.finish=response.done_reason==='length'?'output-budget':'assistant-finished';break;}
   if(report.events.length+response.message.tool_calls.length>16){report.finish='call-budget';break;}
   for(const c of response.message.tool_calls){let args,result;try{if(!schemas.some(s=>s.name===c.function.name))throw Error('Tool not offered');args=typeof c.function.arguments==='string'?JSON.parse(c.function.arguments):c.function.arguments;result=await C.call(live,c.function.name,args,true,o.shape==='typed');}catch(e){result={error:e.message};}report.events.push({tool:c.function.name,arguments:args,result});messages.push({role:'tool',tool_name:c.function.name,content:JSON.stringify(result)});save();}
  }
  Object.assign(report,require('./eval-semantic-code-model.cjs').grade(report));report.transcript=messages;report.completedAt=new Date().toISOString();report.deliveredBytes=report.events.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.result)),0);save();console.log(JSON.stringify({finish:report.finish,calls:report.events.length,codeProbe:report.codeProbe.result.ok,codeBytes:report.codeProbe.bytes,passed:report.passed,checks:report.checks,final:report.final}));
 }finally{await require('../lib/isolate').stop();await require('../lib/state-store').close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
