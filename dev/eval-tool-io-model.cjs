#!/usr/bin/env node
// Real Ollama tool calls against disposable fixtures. Run in a fresh process per revision.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const CASES=['all-default','single-test','diff-tests','poll-job','saved-script','full-result','preview-awareness','source-awareness'];
function options(argv){
  const o={root:path.resolve(__dirname,'..'),model:'qwen3.5:2b',endpoint:'http://127.0.0.1:11434',arm:'after',repeats:2,maxTurns:8,maxCalls:16,maxTokens:768,timeoutMs:90000,maxDurationMs:1800000,cases:CASES.join(',')};
  for(let i=0;i<argv.length;i++){const k=argv[i].replace(/^--/,'').replace(/-([a-z])/g,(_,x)=>x.toUpperCase());if(!(k in o)&&k!=='output')throw Error('Unknown option '+argv[i]);const v=argv[++i];if(v===undefined)throw Error('Missing option value');o[k]=typeof o[k]==='number'?Number(v):v;}
  const u=new URL(o.endpoint);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('Use a local Ollama endpoint');
  for(const [k,max]of Object.entries({repeats:5,maxTurns:12,maxCalls:32,maxTokens:2048,timeoutMs:120000,maxDurationMs:3600000}))if(!Number.isSafeInteger(o[k])||o[k]<1||o[k]>max)throw Error('Invalid bounded '+k);
  if(o.cases.split(',').some(x=>!CASES.includes(x)))throw Error('Unknown case');if(!o.output)throw Error('--output required');o.root=path.resolve(o.root);o.output=path.resolve(o.output);return o;
}
async function run(o){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-tool-io-model-'));
  for(const k of Object.keys(process.env))if(/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS|TOOL_PROFILE|RUNNER_URL|SECURITY_PROFILE)$/.test(k))delete process.env[k];
  Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',DT_RATE_PER_SEC:'0'});
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},tests:{waitMs:30000,compileCheck:false},tools:{plugins:[]}}));
  const load=p=>require(path.join(o.root,p)),T=load('lib/tools'),A=load('lib/access'),W=load('lib/workspace'),R=load('lib/results'),P=load('lib/chat-pressure');
  const digest=load('lib/source-version').digest(o.root),deadline=Date.now()+o.maxDurationMs;
  const report={protocol:'dt.tool-io-model/v1',kind:'real-model-fixture-evaluation',arm:o.arm,model:o.model,sourceDigest:digest,harnessDigest:hash(fs.readFileSync(__filename,'utf8')),startedAt:new Date().toISOString(),settings:{temperature:0,think:false,contextWindow:32768,seedBase:42,repeats:o.repeats,maxTurns:o.maxTurns,maxCalls:o.maxCalls,maxTokens:o.maxTokens},limits:['Local synthetic fixtures only; actual Node tests and saved-script tools execute, without production access.','Same tasks, harness, budgets and sampling settings on both revisions; schemas and chat presentation come from each revision.','Small exploratory sample, not a statistical reliability claim. No test checks model weights; digest/size are server-advertised.','Task success is independently graded from executed tool receipts or exact JSON answers, not prose claims.'],samples:[]};
  const persist=()=>{fs.mkdirSync(path.dirname(o.output),{recursive:true});fs.writeFileSync(o.output,JSON.stringify(report,null,2)+'\n');};
  async function request(route,body){const remaining=deadline-Date.now();if(remaining<=0)throw Error('Evaluation deadline');const res=await fetch(o.endpoint+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.min(o.timeoutMs,remaining))});if(!res.ok)throw Error('Model endpoint HTTP '+res.status);const text=await res.text();if(Buffer.byteLength(text)>2*1024*1024)throw Error('Model reply too large');return JSON.parse(text);}
  const advertised=(await request('/api/tags')).models?.find(m=>m.name===o.model);if(!advertised)throw Error('Model not advertised');report.advertised={name:advertised.name,digest:advertised.digest,details:advertised.details};
  const system='Use the offered dev-tool tools to complete the user task. Inspect schemas or discover capabilities when useful. Do not invent identifiers, execution results or missing data. Do not edit files, publish, or repeat an action just to recover its output. All data belongs to a disposable local demo. Keep the final answer brief; when JSON is requested, return only JSON.';
  report.instructionDigest=hash(system);persist();
  try{for(let repeat=0;repeat<o.repeats;repeat++)for(const id of o.cases.split(',')){
    if(Date.now()>deadline)throw Error('Evaluation deadline');
    await A.run({principalId:'eval',storyId:id+'-'+repeat,role:'admin',multiUser:true},async()=>{
      const w=await W.create({name:'demo'}),root=W.checkId(w.id).path;
      W.write(w.id,'src/value.cjs',{content:'module.exports=42'});
      W.write(w.id,'test/a.test.cjs',{content:"require('node:test')('answer',()=>require('node:assert/strict').equal(require('../src/value.cjs'),42));"});
      W.write(w.id,'test/b.test.cjs',{content:"require('node:test')('other',()=>require('node:assert/strict').equal(2+2,4));"});
      const git=args=>execFileSync('git',['-c','user.name=eval','-c','user.email=eval@localhost',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['add','.']);git(['commit','-qm','Fixture tests']);const pin=git(['rev-parse','HEAD']);
      const metadata=W.checkId(w.id);metadata.sha=pin;fs.writeFileSync(path.join(A.scopedDirectory(path.join(home,'cache','work')),w.id+'.json'),JSON.stringify(metadata));
      const script=load('lib/scripts');script.save('orders/unpaid-check',{description:'Inspect unpaid orders without sending requests',params:{customerId:{type:'string',required:true,description:'Customer id'}},steps:[{set:{source:'synthetic'}}]});
      const names=['tool_search','tool_describe','tool_execute','tool_profiles'],direct=['test_run','workspace_list','workspace_read','test_targets'];
      let user,job,initial,expected,allowed;
      if(id==='all-default'){user='Run every supported test in the only open workspace. Do not edit anything. Report the observed outcome and number of tests.';allowed=direct;}
      if(id==='single-test'){user=`Run test/a.test.cjs in workspace ${w.id}. Do not edit anything. Report the observed result.`;allowed=direct;}
      if(id==='diff-tests'){W.write(w.id,'test/a.test.cjs',{content:fs.readFileSync(path.join(root,'test/a.test.cjs'),'utf8')+'\n// changed test\n'});user=`Only test/a.test.cjs changed since checkout ${pin}. Run the changed tests in workspace ${w.id}; do not run b.test.cjs or edit files.`;allowed=direct;}
      if(id==='poll-job'){const started=await T.call('test_run',{workspace:w.id,tests:['test/a.test.cjs']});job=started.job;user=`Observe existing test job ${job}. Do not start another test run or edit files. Report its result.`;allowed=direct;}
      if(id==='saved-script'){user='Find the saved script for checking unpaid orders. Inspect its definition and report its exact script id and required parameter names. Do not execute it.';allowed=names;}
      if(id==='full-result'){
        const values=[31,7,83,29,2,41,67,5,19,53,11,97],rows=values.map((value,i)=>({id:i,value,payload:'synthetic data '.repeat(100)}));expected=values.reduce((a,b)=>a+b,0);
        initial=P.response('snapshot',{total:rows.length,rows},{session:id+'-'+repeat}).value;
        user='The action producing this snapshot already ran. Retrieve its exact complete retained rows without rerunning it; calculate the sum of every value field. Return JSON {"sum":number}. Snapshot: '+JSON.stringify(initial);allowed=['result_read'];
      }
      if(id==='preview-awareness'){const rows=Array.from({length:12},(_,i)=>({id:i})),view=R.save('pg',rows,{});initial=P.response('snapshot',{total:12,rows:rows.slice(0,3),view},{session:id+'-'+repeat}).value;user='Does this returned response include all 12 rows inline? Do not fetch more data. Return JSON {"completeOutput":boolean}. Response: '+JSON.stringify(initial);allowed=[];}
      if(id==='source-awareness'){initial=P.response('snapshot',{complete:false,rows:[{id:1}],gaps:['Partition 2 was unavailable']},{session:id+'-'+repeat}).value;user='Does this response establish complete source coverage? Do not fetch more data. Return JSON {"completeSource":boolean}. Response: '+JSON.stringify(initial);allowed=[];}
      const all=await T.schemas(),exposed=all.filter(t=>allowed.includes(t.name)),wire=exposed.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
      const sample={id,repeat,query:user,wireBytes:Buffer.byteLength(JSON.stringify(wire)),wireNames:exposed.map(t=>t.name),events:[],usage:{input:0,output:0},deliveredBytes:initial?Buffer.byteLength(JSON.stringify(initial)):0,finish:'turn-budget'};report.samples.push(sample);persist();
      const messages=[{role:'system',content:system},{role:'user',content:user}],start=Date.now();
      const safe=new Set([...names,...direct,'script_list','script_search','script_get','result_read']);
      for(let turn=0;turn<o.maxTurns;turn++){
        sample.turns=turn+1;const body={model:o.model,stream:false,think:false,messages,...(wire.length?{tools:wire}:{}),options:{temperature:0,seed:42+repeat,num_ctx:32768,num_predict:o.maxTokens}};
        if(Buffer.byteLength(JSON.stringify(body))>180000){sample.finish='context-budget';break;}
        console.error(JSON.stringify({arm:o.arm,case:id,repeat,turn:turn+1}));
        let response;try{response=await request('/api/chat',body);}catch(e){sample.finish='endpoint-error';sample.error=e.message;break;}
        sample.returnedModel=response.model;sample.usage.input+=response.prompt_eval_count||0;sample.usage.output+=response.eval_count||0;const message=response.message;
        if(!message||message.role!=='assistant'){sample.finish='invalid-response';break;}messages.push(message);
        if(!message.tool_calls?.length){sample.final=message.content||'';sample.finish=response.done_reason==='length'?'output-budget':'assistant-finished';break;}
        if(sample.events.length+message.tool_calls.length>o.maxCalls){sample.finish='call-budget';break;}
        for(const c of message.tool_calls){
          let input,raw,error,value,target=c.function?.name;
          try{
            if(!allowed.includes(target))throw Object.assign(Error('Tool is not offered in this task'),{code:'DT_EVAL_TOOL_UNAVAILABLE'});
            input=typeof c.function.arguments==='string'?JSON.parse(c.function.arguments):c.function.arguments;
            target=c.function.name==='tool_execute'?input.name:c.function.name;
            const effective=c.function.name==='tool_execute'?input.arguments:input;
            const taskTools=id==='saved-script'?[...names,'script_list','script_search','script_get']:id==='full-result'?['result_read']:direct;
            if(!safe.has(target)||!taskTools.includes(target)||target==='test_run'&&(effective?.files?.length||id==='poll-job'&&effective?.job!==job))throw Object.assign(Error('Action is not authorized by this task'),{code:'DT_EVAL_ACTION_NOT_AUTHORIZED'});
            raw=await T.call(c.function.name,input,{source:'tool-io-model-eval',session:id+'-'+repeat});
            value=P.response(target,raw,{session:id+'-'+repeat,all:input?.all===true||input?.arguments?.all===true}).value;
          }catch(e){error={error:e.message,code:e.code||'DT_EVAL_ARGUMENT',...(e.candidates?{candidates:e.candidates}:{}),...(e.issues?{issues:e.issues}:{})};raw=error;value=error;}
          const event={tool:target,wireTool:c.function?.name,arguments:input,ok:!error&&!raw?.error,...(error?{error}:{}),result:raw,delivered:value};sample.events.push(event);sample.deliveredBytes+=Buffer.byteLength(JSON.stringify(value));messages.push({role:'tool',tool_name:c.function?.name,content:JSON.stringify(value)});persist();
        }
      }
      const successes=sample.events.filter(e=>e.ok),runs=successes.filter(e=>e.tool==='test_run');let passed=false;
      if(id==='all-default')passed=runs.some(e=>e.result.outcome==='passed'&&e.result.counts?.tests===2);
      if(['single-test','diff-tests'].includes(id))passed=runs.some(e=>e.result.outcome==='passed'&&e.result.counts?.tests===1)&&!runs.some(e=>e.result.counts?.tests>1);
      if(id==='poll-job')passed=runs.some(e=>e.result.job===job&&e.result.outcome==='passed')&&!runs.some(e=>e.result.job!==job);
      if(id==='saved-script')passed=successes.some(e=>e.tool==='script_get'&&e.result.id==='orders/unpaid-check'&&e.result.params?.customerId?.required===true);
      let final;try{final=JSON.parse((sample.final||'').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{}
      if(id==='preview-awareness')passed=final?.completeOutput===false;
      if(id==='source-awareness')passed=final?.completeSource===false;
      if(id==='full-result'){
        let rows=successes.map(e=>e.result?.value?.rows).find(Array.isArray);
        if(!rows){try{const pages=successes.filter(e=>e.tool==='result_read'&&e.result.path==='/rows').map(e=>e.result).sort((a,b)=>a.startByte-b.startByte);if(pages.at(-1)?.complete)rows=JSON.parse(pages.map(p=>p.text).join(''));}catch{}}
        passed=final?.sum===expected&&rows?.length===12;
      }
      sample.passed=!!passed&&!sample.events.some(e=>e.error?.code==='DT_EVAL_ACTION_NOT_AUTHORIZED');sample.argumentErrors=sample.events.filter(e=>!e.ok).length;sample.toolCalls=sample.events.length;sample.ms=Date.now()-start;sample.transcript=messages;persist();console.error(JSON.stringify({arm:o.arm,case:id,repeat,passed:sample.passed,calls:sample.toolCalls,errors:sample.argumentErrors,finish:sample.finish}));
    });
  }
  report.finalSourceDigest=load('lib/source-version').digest(o.root);report.sourceChanged=report.finalSourceDigest!==digest;report.completedAt=new Date().toISOString();report.summary={cases:report.samples.length,passed:report.samples.filter(s=>s.passed).length,failed:report.samples.filter(s=>!s.passed).length,argumentErrors:report.samples.reduce((n,s)=>n+s.argumentErrors,0),toolCalls:report.samples.reduce((n,s)=>n+s.toolCalls,0),deliveredBytes:report.samples.reduce((n,s)=>n+s.deliveredBytes,0),inputTokens:report.samples.reduce((n,s)=>n+s.usage.input,0),outputTokens:report.samples.reduce((n,s)=>n+s.usage.output,0),ms:report.samples.reduce((n,s)=>n+s.ms,0)};persist();return report;
  }finally{await load('lib/isolate').stop();await load('lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});}
}
module.exports={options,run,CASES};
if(require.main===module)run(options(process.argv.slice(2))).then(r=>console.log(JSON.stringify(r.summary))).catch(e=>{console.error(e.message);process.exitCode=1;});
