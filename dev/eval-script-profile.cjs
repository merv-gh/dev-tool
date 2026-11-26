#!/usr/bin/env node
// Compare a focused native script-inspection surface with the recorded lean-discovery trials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function run(){
 const o={root:path.resolve(__dirname,'..'),output:'',model:'qwen3.5:2b',profile:''};
 for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!(k in o)||!process.argv[i+1])throw Error('Unknown/missing argument');o[k]=process.argv[i+1];}if(!o.output)throw Error('--output required');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-script-model-'));
 for(const k of Object.keys(process.env))if(/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS|TOOL_PROFILE|RUNNER_URL|SECURITY_PROFILE)$/.test(k))delete process.env[k];
 Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_LOG:'quiet',DT_NO_DOCTOR:'1'});fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},tools:{plugins:[]}}));
 const load=p=>require(path.join(path.resolve(o.root),p)),T=load('lib/tools'),A=load('lib/access'),P=load('lib/chat-pressure'),S=load('lib/scripts');
 const system='Use the offered dev-tool tools to complete the user task. Inspect schemas or discover capabilities when useful. Do not invent identifiers, execution results or missing data. Do not edit files, publish, or repeat an action just to recover its output. All data belongs to a disposable local demo. Keep the final answer brief; when JSON is requested, return only JSON.';
 const query='Find the saved script for checking unpaid orders. Inspect its definition and report its exact script id and required parameter names. Do not execute it.';
 const report={protocol:'dt.script-profile-model/v1',kind:'real-model-native-profile-experiment',model:o.model,profile:o.profile||'candidate-two-native-tools',sourceDigest:load('lib/source-version').digest(o.root),harnessDigest:hash(fs.readFileSync(__filename)),instructionDigest:hash(system),startedAt:new Date().toISOString(),settings:{temperature:0,seed:42,think:false,num_ctx:32768,num_predict:768,maxTurns:8,maxCalls:16,timeoutMs:90000},events:[],usage:{input:0,output:0},deliveredBytes:0};
 const save=()=>{fs.mkdirSync(path.dirname(path.resolve(o.output)),{recursive:true});fs.writeFileSync(o.output,JSON.stringify(report,null,2)+'\n');};
 async function request(route,body){const r=await fetch('http://127.0.0.1:11434'+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Ollama HTTP '+r.status);return r.json();}
 try{
  report.advertised=(await request('/api/tags')).models.find(m=>m.name===o.model);if(!report.advertised)throw Error('Model unavailable');
  await A.run({principalId:'eval',storyId:'saved-script',role:'admin',multiUser:true},async()=>{
   S.save('orders/unpaid-check',{description:'Inspect unpaid orders without sending requests',params:{customerId:{type:'string',required:true,description:'Customer id'}},steps:[{set:{source:'synthetic'}}]});
   const allowed=['script_search','script_get'],available=await T.schemas(o.profile?{profile:o.profile}:{}),schemas=o.profile?available:available.filter(t=>allowed.includes(t.name));
   if(schemas.length!==2||schemas.some(t=>!allowed.includes(t.name)))throw Error('Profile must offer both script inspection tools');const tools=schemas.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
   report.schemas=schemas;report.wireDigest=hash(JSON.stringify(tools));const messages=[{role:'system',content:system},{role:'user',content:query}];report.finish='turn-budget';save();
   for(let turn=0;turn<8;turn++){
    console.error(JSON.stringify({profile:report.profile,turn:turn+1}));let response;
    try{response=await request('/api/chat',{model:o.model,stream:false,think:false,messages,tools,options:{temperature:0,seed:42,num_ctx:32768,num_predict:768}});}catch(e){report.finish='endpoint-error';report.error=e.message;break;}
    report.usage.input+=response.prompt_eval_count||0;report.usage.output+=response.eval_count||0;const m=response.message;if(!m||m.role!=='assistant'){report.finish='invalid-response';break;}messages.push(m);
    if(!m.tool_calls?.length){report.final=m.content||'';report.finish=response.done_reason==='length'?'output-budget':'assistant-finished';break;}
    if(report.events.length+m.tool_calls.length>16){report.finish='call-budget';break;}
    for(const c of m.tool_calls){let args,result,delivered,error;
     try{if(!allowed.includes(c.function?.name))throw Error('Tool not offered');args=typeof c.function.arguments==='string'?JSON.parse(c.function.arguments):c.function.arguments;result=await T.call(c.function.name,args);delivered=P.response(c.function.name,result,{session:'saved-script',all:args.all===true}).value;}
     catch(e){error=e.message;result=delivered={error,code:e.code};}
     report.events.push({tool:c.function?.name,arguments:args,result,delivered,ok:!error});report.deliveredBytes+=Buffer.byteLength(JSON.stringify(delivered));messages.push({role:'tool',tool_name:c.function?.name,content:JSON.stringify(delivered)});save();
    }
   }
   report.definitionRead=report.events.some(e=>e.ok&&e.tool==='script_get'&&e.result.id==='orders/unpaid-check'&&e.result.params?.customerId?.required===true);
   report.answerCorrect=report.final?.includes('orders/unpaid-check')&&report.final.includes('customerId')||false;report.passed=report.definitionRead&&report.answerCorrect;report.transcript=messages;
  });
  report.sourceChanged=report.sourceDigest!==load('lib/source-version').digest(o.root);report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({passed:report.passed,definitionRead:report.definitionRead,answerCorrect:report.answerCorrect,calls:report.events.length,finish:report.finish}));
 }finally{await load('lib/isolate').stop();await load('lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
