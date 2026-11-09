// Real Open WebUI regression against demo/context-compaction/compose.yml only.
// node dev/check-chat-context.js [webui URL] [dt URL] [fixture model URL] [report]
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
async function main(){
 const [webui='http://127.0.0.1:44402',dt='http://127.0.0.1:44400',model='http://127.0.0.1:44401',out='work/context-compaction/e2e.json']=process.argv.slice(2);
 for(const url of [webui,dt,model])assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Use the disposable loopback fixture');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-context-e2e-'));let token,story;
 const request=async(base,url,body)=>{const r=await fetch(base+url,{...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'content-type':'application/json',...(base===dt&&story?{'x-dt-story':story}:{}),...(base===webui&&token?{authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(180000)});const text=await r.text();assert.ok(r.ok,`${url}: ${r.status} ${text.slice(0,500)}`);return text?JSON.parse(text):null;};
 try{
  assert.equal((await request(model,'/v1/models')).data[0].id,'context-fixture');
  await request(model,'/reset',{});
  const tools=await request(dt,'/api/tools?profile=context-fixture');assert.ok(tools.some(t=>t.name==='context_payload'),'Not the disposable source fixture');
  token=(await request(webui,'/api/v1/auths/signin',{email:'',password:''})).token;assert.ok(token);
  assert.ok((await request(webui,'/api/models')).data.some(m=>m.id==='context-fixture'),'Not the disposable Open WebUI model');
  Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1'});for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR'])delete process.env[key];
  const window=Number(process.env.CONTEXT_TEST_WINDOW||32768),mode=process.env.CONTEXT_TEST_MODE||'auto',defaultPolicy=process.env.CONTEXT_TEST_THRESHOLD==='default',threshold=defaultPolicy?undefined:Number(process.env.CONTEXT_TEST_THRESHOLD||5000);
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},llm:{contextWindow:window,...(defaultPolicy?{}:{compactAt:threshold,contextReserve:Math.min(8192,Math.floor(window/4))}),compaction:true,compactionMode:mode,compactionModel:''}}));
  const setup=await require('../lib/webui').setup({base:webui,dtUrl:'http://dt:4000',profile:'context-fixture',model:'context-fixture',key:token,log:()=>{}});
  const histories=[],messages={};let parent=null;
  const noise=window<16000?40:200;
  for(let i=0;i<6;i++){const id=crypto.randomUUID(),message={id,role:i%2?'assistant':'user',content:i===0?'CTX-17: do not push. Explore calculation evidence. '+('Synthetic earlier context. '.repeat(noise*2)):('Earlier calculation evidence '+i+'. ').repeat(noise),parentId:parent,childrenIds:[],...(i%2?{model:'context-fixture',done:true}:{})};if(parent)messages[parent].childrenIds=[id];messages[id]=message;histories.push(message);parent=id;}
  const uid=crypto.randomUUID(),aid=crypto.randomUUID(),user={id:uid,role:'user',content:'Continue CTX-17. Use context_payload for steps 1 through 12, then report the sum. Do not push.',parentId:parent,childrenIds:[aid]},assistant={id:aid,role:'assistant',model:'context-fixture',content:'',parentId:uid,childrenIds:[],done:false};messages[parent].childrenIds=[uid];messages[uid]=user;messages[aid]=assistant;
  const chat=await request(webui,'/api/v1/chats/new',{chat:{title:'Context compaction regression · synthetic',models:['context-fixture'],history:{messages,currentId:aid},messages:[...histories,user,assistant],params:{}}});
  story=chat.id;const before=(await request(dt,'/api/tool/context_payload_count',{})).result;
  await request(webui,'/api/chat/completions',{model:'context-fixture',stream:true,messages:[...histories,user].map(({id,role,content})=>({id,role,content})),chat_id:chat.id,id:aid,session_id:'context-fixture-client',user_message:user,tool_ids:setup.toolIds,params:{function_calling:'native'},background_tasks:{title_generation:false,tags_generation:false,follow_up_generation:false}});
  let saved,output=[];const deadline=Date.now()+600000;
  while(Date.now()<deadline){saved=await request(webui,'/api/v1/chats/'+chat.id);const message=saved.chat.history.messages[aid];assert.ok(!message.error,JSON.stringify(message.error));output=message.output||[];if(message.done&&JSON.stringify(output).includes('sum 1 through 12 = 78'))break;await new Promise(r=>setTimeout(r,500));}
  const stats=await request(model,'/stats');
  assert.equal(stats.rounds,12,'all intended tool rounds execute once');
  if(mode==='manual')assert.equal(stats.summaries,0,'manual mode never summarizes between tool rounds');
  else if(defaultPolicy)assert.ok(stats.summaries<=Number(process.env.CONTEXT_TEST_MAX_SUMMARIES||4),`default policy compacted ${stats.summaries}/12 rounds; compaction must leave room for several tool rounds`);
  else assert.ok(stats.summaries>=2,'forced low-threshold compaction must repeat during the tool loop');
  assert.deepEqual(stats.protocolErrors,[],'calls/results remain paired');
  assert.equal((await request(dt,'/api/tool/context_payload_count',{})).result-before,12,'the tool is never replayed by compaction');
  assert.ok(stats.requests.filter(r=>r.stream).every(r=>r.intentPinned),'the actual user task and prohibition stay verbatim in every model request');
  const summaryQuality=stats.summaryTexts.map(summary=>({taskId:/CTX-17/.test(summary),prohibition:/(?:do not|no|never|don't)[^\n]{0,60}push/i.test(summary),compact:summary.length<4000,inventedTools:/pg_usage|es_search|kafka_last|Postgres compaction/.test(summary)}));
  assert.ok(summaryQuality.every(q=>q.compact&&!q.inventedTools),'summaries stay concise and do not invent unrelated tool activity');
  if(process.env.CONTEXT_REQUIRE_SUMMARY_CONSTRAINTS==='1')assert.ok(summaryQuality.every(q=>q.taskId&&q.prohibition),'summary model must retain exact task/prohibition');
  if(stats.summaries){assert.ok(stats.requests.some(r=>r.stream&&r.hasSummary),'summaries reach subsequent model requests');assert.ok(output.some(o=>o.type==='open_webui:context_compaction'),'visible native checkpoint is retained');}
  assert.match(JSON.stringify(output),/sum 1 through 12 = 78/);assert.match(JSON.stringify(output),/embed/,'inline visualizations survive compaction');assert.ok(saved.chat.history.messages[histories[0].id],'full conversation is still stored');
  let manualAction;
  if(mode==='manual'){
   // The same endpoint as the native Compact button; active response cleanup may
   // finish just after its final saved message becomes visible.
   let result;
   for(let i=0;i<30;i++){
    const r=await fetch(webui+'/api/v1/chats/'+chat.id+'/compact',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({model:'context-fixture'}),signal:AbortSignal.timeout(180000)});
    if(r.status===409){await new Promise(r=>setTimeout(r,100));continue;}
    result=await r.json();assert.ok(r.ok,JSON.stringify(result));break;
   }
   assert.equal(result?.compacted,true,'the explicit Compact action still works');
   const after=await request(model,'/stats'),checkpoint=await request(webui,'/api/v1/chats/'+chat.id);
   assert.equal(after.summaries,1,'only the explicit action invokes the summarizer');
   assert.ok(Object.values(checkpoint.chat.history.messages).some(m=>m.contextSummary||m.context_summary),'manual checkpoint is saved');
   assert.ok(checkpoint.chat.history.messages[histories[0].id],'manual compaction keeps full stored history');
   assert.equal((await request(dt,'/api/tool/context_payload_count',{})).result-before,12,'manual compaction never replays tools');
   manualAction={compacted:true,summaries:after.summaries,checkpointSaved:true,historyPreserved:true};
  }
  const report={passed:true,proof:'Real Open WebUI HTTP pipeline; synthetic source tools and deterministic tool selection.',defaultPolicy,summaryModel:stats.summaryModel,setup:setup.contextCompaction,chat:chat.id,rounds:stats.rounds,summaries:stats.summaries,...(manualAction?{manualAction}:{}),summaryAfterRounds:stats.requests.filter(r=>!r.stream).map(r=>r.afterToolRound),requests:stats.requests,maxRequestBytes:stats.maxRequestBytes,maxAgentRequestBytes:Math.max(...stats.requests.filter(r=>r.stream).map(r=>r.bytes)),maxSummaryRequestBytes:Math.max(0,...stats.requests.filter(r=>!r.stream).map(r=>r.bytes)),syntheticRequestCapBytes:stats.requestCapBytes,protocolErrors:stats.protocolErrors,summaryTexts:stats.summaryTexts,summaryQuality,currentIntentPinned:true,markers:output.filter(o=>o.type==='open_webui:context_compaction').length,historyPreserved:true,inlineViewsPreserved:true};
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,summaryTexts:undefined}));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
