const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const home = fs.mkdtempSync(path.join(os.tmpdir(),'dt-task-harness-'));
Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy',DT_REQUEST_EVENTS:'0'});
for (const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS']) delete process.env[k];
const H = require('../lib/task-harness'), A = require('../lib/access'), C = require('../lib/config');
let brain, requests = [], docs = 0, endpoint, building = true, ciReads = 0;
const identity = (principalId,storyId='chat-one',role='admin') => ({principalId,storyId,role,multiUser:true});
const alice = fn => A.run(identity('alice'),fn);
const response = content => ({choices:[{finish_reason:'stop',message:typeof content === 'string' ? {role:'assistant',content} : {role:'assistant',content:null,tool_calls:content}}],usage:{total_tokens:100}});
const call = (id,name,args) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
function config(extra={}) { fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},llm:{baseUrl:endpoint + '/v1',model:'fixture-small',contextWindow:262144},confluence:{url:endpoint,token:'fixture-docs'},jenkins:{url:endpoint,user:'fixture',token:'fixture-ci'},...extra})); C.reload(); }
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://fixture'); res.setHeader('content-type','application/json');
  if (url.pathname === '/v1/chat/completions') { let body=''; for await (const chunk of req) body+=chunk; const payload=JSON.parse(body); requests.push(payload); const value=await brain(payload,requests.length); res.end(JSON.stringify(value)); return; }
  if (url.pathname === '/rest/api/content/search') { docs++; res.end(JSON.stringify({results:[{id:'42',title:'Checkout requirements',_expandable:{space:'/rest/api/space/SHOP'},_links:{webui:'/pages/42'}}]})); return; }
  if (url.pathname === '/rest/api/content/42') { docs++; res.end(JSON.stringify({id:'42',title:'Checkout requirements',space:{key:'SHOP'},version:{number:3},body:{storage:{value:'<p>Reject a negative order total. Preserve zero.</p>'}}})); return; }
  if (url.pathname === '/job/service/1/api/json') { ciReads++; res.end(JSON.stringify({number:1,building,result:building?null:'SUCCESS',actions:[{lastBuiltRevision:{SHA1:'a'.repeat(40)}}]})); return; }
  res.writeHead(404); res.end(JSON.stringify({error:'unexpected fixture route ' + url.pathname}));
});
test.before(async () => { await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); endpoint='http://127.0.0.1:' + server.address().port; config(); });
test.after(async () => { await H.close(); await new Promise(resolve => server.close(resolve)); await require('../lib/isolate').stop(); await require('../lib/observations').close(); await require('../lib/state-store').close(); fs.rmSync(home,{recursive:true,force:true}); });
async function until(run,predicate) {
  for (let i=0;i<300;i++) { await H.maintenance(); const value=H.status({run,detail:true}); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve,10)); }
  throw Error('Task did not settle: ' + JSON.stringify(H.status({run,detail:true})));
}
test('persistent agent gathers real REST evidence, writes notes and publishes immutable global memory', async () => alice(async () => {
  requests=[]; docs=0;
  brain=payload => {
    const count=payload.messages.filter(m => m.role==='assistant').length;
    if (!count) return response([call('search','confluence_search',{text:'checkout',space:'SHOP'})]);
    if (count===1) return response([call('page','confluence_page',{id:'42'})]);
    if (count===2) return response([call('note','task_memory_save',{path:'requirements.md',content:'Confluence page 42 version 3: reject negative total; preserve zero. Source /pages/42.',summary:'Checkout validation requirements and provenance'})]);
    return response('Confluence page 42 v3 requires negative totals to be rejected; zero stays valid. Code verification remains a gap.');
  };
  await assert.rejects(H.start({title:'missing permission',goal:'test'}),/allow_model/);
  const run=await H.start({title:'Checkout evidence',goal:'Gather cited checkout requirements',repositories:['SHOP/orders'],spaces:['SHOP'],allow_model:true,publish:true,project_context:'checkout'});
  const final=await until(run.id,r => ['completed','needs_attention'].includes(r.state));
  assert.equal(final.state,'completed',final.reason); assert.equal(docs,2); assert.equal(final.counts.modelCalls,4); assert.equal(final.counts.toolCalls,3);
  assert.equal(final.events.filter(e=>e.type==='model.completed').at(-1).content,final.report);
  assert.ok(final.events.filter(e=>e.type==='tool.completed').every(e=>e.callId&&e.durationMs>=0));
  assert.match(H.memory({run:run.id,path:'runs/' + run.id + '/notes/requirements.md'}).content,/version 3/);
  assert.ok(requests[1].messages.some(m => m.role==='tool' && m.tool_call_id==='search'));
  assert.ok(requests[0].tools.every(t => !['workspace_write','workspace_push','code','script_run','project_context_save'].includes(t.function.name)));
  const shared=require('../lib/project-context').get({id:'checkout'}); assert.equal(shared.files.length,6); assert.equal(shared.author.principalId,'alice');
  assert.match(require('../lib/project-context').get({id:'checkout',path:'research/' + run.id + '/report.md'}).file.content,/page 42/);
  await A.run(identity('alice','another-chat'),async () => { assert.equal(H.list().runs[0].id,run.id); assert.equal(H.status({run:run.id}).state,'completed'); assert.ok(H.memory({run:run.id}).index.files.length); });
  A.run(identity('bob'),() => { assert.throws(() => H.status({run:run.id}),/not found/); assert.equal(H.list().runs.length,0); assert.throws(() => H.memory({run:run.id}),/not found/); });
  const publicRead=A.run(identity('bob','chat','user'),() => require('../lib/project-context').get({id:'checkout'})); assert.equal(publicRead.revision,final.publication.revision);
}));
test('global publication remains admin-only, private results remain available to ordinary users', async () => A.run(identity('reader','chat','user'),async () => {
  await assert.rejects(H.start({title:'Publish',goal:'collect',allow_model:true,publish:true,project_context:'checkout'}),/Administrator/);
  brain=() => response('Read-only investigation complete; no changes made.');
  const run=await H.start({title:'Private investigation',goal:'collect',allow_model:true});
  const final=await until(run.id,r => ['completed','needs_attention'].includes(r.state)); assert.equal(final.state,'completed',final.reason); assert.equal(final.publication,undefined);
}));
test('disabled publication or review tools block autonomous admission before any effect',async()=>alice(async()=>{
  try {
    for(const name of ['workspace_push','bitbucket_pr_create','bitbucket_pr_status']) {
      config({push:{enabled:true},bitbucket:{allowDraftCreate:true},tools:{disable:[name]}});
      await assert.rejects(H.start({title:'Disabled publication',goal:'Prepare change',mode:'change',repositories:['DEMO/service'],allow_model:true,publish_code:true,branch:'codex/disabled'}),{code:'DT_ACCESS_DENIED'});
    }
  }finally{config();}
}));
test('profile enforcement rejects a model-selected write, while retaining observable results', async () => alice(async () => {
  brain=payload => payload.messages.some(m=>m.role==='tool') ? response('The write was rejected; research-only scope respected.') : response([call('bad','workspace_write',{workspace:'foreign',path:'x',content:'x'})]);
  const run=await H.start({title:'Read boundary',goal:'Research',allow_model:true}); const final=await until(run.id,r=>r.state==='completed');
  assert.ok(final.events.some(e=>e.type==='tool.completed' && e.failed)); assert.match(final.messages.find(m=>m.role==='tool').content,/outside the task profile/);
}));
test('pause, durable steering and explicit checkpoint preserve transcripts; closed observers do not own work', async () => alice(async () => {
  let release, entered; const entry=new Promise(resolve=>entered=resolve);
  brain=async()=>{ entered(); return new Promise(resolve=>release=()=>resolve(response([call('note','task_memory_save',{path:'progress.md',content:'First evidence saved',summary:'Progress'})]))); };
  const run=await H.start({title:'Pause test',goal:'Collect evidence',allow_model:true}); await H.maintenance(); await entry;
  H.control({run:run.id,action:'pause'}); release(); const paused=await until(run.id,r=>r.state==='paused'); assert.equal(paused.counts.toolCalls,0);
  H.control({run:run.id,action:'checkpoint',message:'Keep the goal; continue from saved findings.'}); await H.maintenance(); await until(run.id,r=>r.controlPending===null);
  assert.ok(H.memory({run:run.id}).index.files.some(f=>f.path.includes('/transcript-')));
  brain=()=>response('Resumed from the explicit checkpoint.'); H.control({run:run.id,action:'resume'}); const final=await until(run.id,r=>r.state==='completed');
  assert.match(final.messages[0].content,/Explicit owner checkpoint/);
}));
test('hard step budget checkpoints instead of letting a model loop forever', async () => alice(async () => {
  brain=()=>response([call('lookup','find',{q:'nothing'})]);
  const run=await H.start({title:'Bounded loop',goal:'Search',allow_model:true,max_steps:2}); const final=await until(run.id,r=>r.state==='needs_attention');
  assert.equal(final.counts.steps,2); assert.match(final.reason,/budget/); assert.ok(final.events.some(e=>e.type==='tool.completed'));
}));
test('context-full recovery keeps a bounded actual message and requires an explicit checkpoint before resume',async()=>alice(async()=>{
 try{
  config({llm:{baseUrl:endpoint+'/v1',model:'fixture-small',contextWindow:8192}});
  brain=()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Verified evidence. '.repeat(2000),tool_calls:[call('note','task_memory_save',{path:'large.md',content:'Retained findings',summary:'Recovery evidence'})]}}],usage:{total_tokens:100}});
  const run=await H.start({title:'Context recovery',goal:'Retain findings and stop at context limit',allow_model:true});
  const blocked=await until(run.id,r=>r.state==='needs_attention');assert.match(blocked.reason,/context.*byte budget/i);const message=blocked.events.find(e=>e.type==='model.completed');assert.equal(message.content.length,16000);assert.equal(message.contentTruncated,true);assert.ok(blocked.messages.some(m=>m.content?.length>16000));
  const before=requests.length;const command=H.control({run:run.id,action:'checkpoint',message:'Verified findings retained. Next: report the remaining gap.'});assert.equal(command.pendingControl.action,'checkpoint');await until(run.id,r=>!r.controlPending);assert.equal(requests.length,before,'checkpoint is not a model call');assert.equal(H.status({run:run.id}).reason,'Checkpoint saved; resume explicitly');
  brain=()=>response('Retained findings recovered; remaining gap is verification.');H.control({run:run.id,action:'resume'});assert.equal((await until(run.id,r=>r.state==='completed')).counts.modelCalls,2);
 }finally{config();}
}));
test('an overnight budget stop still leaves an authorized global checkpoint', async () => alice(async () => {
  brain=()=>response([call('note','task_memory_save',{path:'early.md',content:'Confluence page 42 v3: preserve zero. Code verification remains open.',summary:'Early cited finding'})]);
  const run=await H.start({title:'Partial research',goal:'Gather evidence',allow_model:true,max_steps:2,publish:true,project_context:'partial-research'});
  const final=await until(run.id,r=>r.state==='needs_attention');assert.match(final.reason,/budget/);
  const shared=require('../lib/project-context').get({id:'partial-research',path:'research/' + run.id + '/report.md'});assert.match(shared.file.content,/in progress/);assert.match(shared.file.content,/page 42/);assert.ok(final.publication.revision);
}));
test('tool discovery stays within the read profile and can consult earlier task memory',async()=>alice(async()=>{
  let original;
  brain=()=>response([call('note','task_memory_save',{path:'carry.md',content:'Retained fact: zero orders are allowed (page 42 v3).',summary:'Stable task finding'})]);
  original=await H.start({title:'Retained task',goal:'Store evidence',allow_model:true,max_steps:2});await until(original.id,r=>r.state==='needs_attention');
  brain=payload=>{
    const n=payload.messages.filter(m=>m.role==='assistant').length;
    if(n===0)return response([call('discover','task_tool_discover',{query:'postgres table'})]);
    if(n===1)return response([call('remember','task_memory_read',{path:'runs/'+original.id+'/notes/carry.md'})]);
    assert.ok(payload.tools.some(t=>t.function.name==='pg_table'));assert.ok(!payload.tools.some(t=>t.function.name==='workspace_push'));return response('Retained page 42 v3 evidence allows zero orders.');
  };
  const run=await H.start({task:original.task,title:'Continue evidence',goal:'Consult previous findings',allow_model:true});const final=await until(run.id,r=>['completed','needs_attention'].includes(r.state));assert.equal(final.state,'completed',final.reason);assert.ok(final.messages.some(m=>m.role==='tool'&&m.content.includes('Retained fact')));
}));
test('revoking the original named credential blocks delayed work without escalating to an admin', async () => {
  config({server:{accessTokens:[{id:'worker',principal:'named',role:'user',token:'fixture-worker-token-0001'}]}});
  let run;
  await A.run({...identity('named','chat','user'),authId:'worker'},async()=> { run=await H.start({title:'Revocable',goal:'Read docs',allow_model:true}); });
  config({server:{accessTokens:[{id:'worker',principal:'named',role:'user',token:'fixture-worker-token-0001',revoked:true}]}});
  await A.run({...identity('named','chat','user'),authId:'worker'},async()=> { const final=await until(run.id,r=>r.state==='needs_attention'); assert.match(final.reason,/revoked|expired/); assert.equal(final.counts.modelCalls,0); });
  config();
});
test('task editor bridge crosses chats but enforces one workspace writer and concrete grants',async()=>alice(async()=>{
  const {execFileSync}=require('node:child_process'),W=require('../lib/workspace'),P=require('../lib/continuation');
  const directory=path.join(home,'editor-seed');fs.mkdirSync(directory);
  const git=(...args)=>execFileSync('git',args,{cwd:directory,env:{...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.test'},stdio:'pipe'});
  git('init','-q','-b','main');fs.writeFileSync(path.join(directory,'README.md'),'Original evidence\n');git('add','.');git('commit','-qm','initial');
  const task=P.create({task_id:'EDIT-42',title:'Task workspace'}),scope={...A.owner(),multiUser:true,storyId:'task:'+task.id};
  const workspace=await A.run(scope,()=>W.open({project:'DEMO',repo:'service',url:'file://'+directory}));
  P.checkpoint({id:task.id,expected_revision:task.revision,workspaces:[workspace.id]});
  let entered,release;const gate=new Promise(resolve=>entered=resolve);brain=()=>{entered();return new Promise(resolve=>release=()=>resolve(response('Workspace inspected.')));};
  const run=await H.start({task:task.id,title:'Workspace worker',goal:'Inspect source',mode:'change',repositories:['DEMO/service'],allow_model:true});await H.maintenance();await gate;
  try {
    await A.run(identity('alice','different-chat'),async()=>{
      const file=await H.action({run:run.id,tool:'workspace_editor',arguments:{workspace:workspace.id,action:'read',path:'README.md'}});assert.match(file.content,/Original/);
      await assert.rejects(H.action({run:run.id,tool:'workspace_editor',arguments:{workspace:workspace.id,action:'save',path:'README.md',content:'Concurrent edit',expected_revision:file.revision}}),/Pause/);
    });
    await A.run({...identity('alice','limited-chat','user'),tools:['task_run_action']},()=>assert.rejects(H.action({run:run.id,tool:'workspace_editor',arguments:{workspace:workspace.id,action:'read',path:'README.md'}}),{code:'DT_ACCESS_DENIED'}));
    await A.run(identity('bob'),()=>assert.rejects(H.action({run:run.id,tool:'workspace_editor',arguments:{workspace:workspace.id,action:'read',path:'README.md'}}),/not found/));
    H.control({run:run.id,action:'pause'});release();await until(run.id,r=>r.state==='paused');
    const file=await H.action({run:run.id,tool:'workspace_editor',arguments:{workspace:workspace.id,action:'read',path:'README.md'}});
    const saved=await H.action({run:run.id,tool:'workspace_editor',arguments:{workspace:workspace.id,action:'save',path:'README.md',content:'Human handover\n',expected_revision:file.revision}});assert.equal(saved.saved,true);
    const branch=await H.action({run:run.id,tool:'workspace_branch',arguments:{workspace:workspace.id,ref:'main'}});assert.ok(H.status({run:run.id}).workspaces.includes(branch.id));
  }finally{release();if(!['cancelled','completed'].includes(H.status({run:run.id}).state)){H.control({run:run.id,action:'stop'});await until(run.id,r=>r.state==='cancelled');}}
}));
test('restart recovery disabled remains visibly blocked until an explicit resume',async()=>{
  const {execFile}=require('node:child_process');brain=()=>response('Explicitly resumed after restart.');
  const source=`const H=require('./lib/task-harness'),A=require('./lib/access');A.run(${JSON.stringify(identity('manual-restart'))},async()=>{const r=await H.start({title:'Manual recovery',goal:'Retain admission',allow_model:true,auto_resume:false});console.log(JSON.stringify({run:r.id}));process.exit(0);}).catch(e=>{console.error(e);process.exit(1)});`;
  const run=await new Promise((resolve,reject)=>execFile(process.execPath,['-e',source],{cwd:path.resolve(__dirname,'..'),env:process.env},(e,out)=>e?reject(e):resolve(JSON.parse(out).run)));
  // Docker commonly reuses the same PID; recovery policy must use a process
  // incarnation rather than mistaking a prior PID 1 for this live admission.
  const recordPath=path.join(home,'task-harness',run+'.json'),record=JSON.parse(fs.readFileSync(recordPath));record.admittedProcess=process.pid;fs.writeFileSync(recordPath,JSON.stringify(record));
  await A.run(identity('manual-restart'),async()=>{const blocked=await until(run,r=>r.state==='needs_attention');assert.equal(blocked.counts.modelCalls,0);assert.match(blocked.reason,/resume.*explicitly/);H.control({run,action:'resume'});const final=await until(run,r=>r.state==='completed');assert.equal(final.counts.modelCalls,1);});
});
test('durable Jenkins waits pin the build, release the worker, and make no model calls while unchanged', async () => alice(async () => {
  building=true;ciReads=0;requests=[];
  brain=payload=>{
    let pending=new Set();for(const m of payload.messages){if(m.tool_calls){assert.equal(pending.size,0);pending=new Set(m.tool_calls.map(t=>t.id));}else if(m.role==='tool')assert.equal(pending.delete(m.tool_call_id),true);else assert.equal(pending.size,0,'all batched tool replies must precede steering/watch messages');}assert.equal(pending.size,0);
    return payload.messages.some(m=>m.role==='tool') ? response('Jenkins build 1 passed for the observed exact SHA. No broader runtime claims.') : response([call('watch','task_watch',{tool:'jenkins_build',arguments:{job:'service',build:'lastBuild',sha:'a'.repeat(40)},poll_seconds:5}),call('wait-note','task_memory_save',{path:'ci-plan.md',content:'Pin build 1 and inspect exact-SHA outcome.',summary:'CI verification plan'})]);
  };
  // The lastBuild response still returns an immutable build number.
  const original=server.listeners('request')[0];
  const alias=(req,res)=>{if(req.url.startsWith('/job/service/lastBuild/'))req.url=req.url.replace('/lastBuild/','/1/');return original(req,res);};
  server.removeListener('request',original);server.on('request',alias);
  try {
    const run=await H.start({title:'CI observation',goal:'Wait for build',allow_model:true});const waiting=await until(run.id,r=>r.state==='waiting');assert.equal(waiting.watch.arguments.build,1);assert.equal(waiting.counts.modelCalls,1);
    H.control({run:run.id,action:'steer',message:'Retain the exact build evidence.'});await H.maintenance();assert.equal(H.status({run:run.id,detail:true}).inbox.length,1);
    for(let i=0;i<3;i++)await H.maintenance();assert.equal(requests.length,1);assert.equal(ciReads,1);
    await new Promise(resolve=>setTimeout(resolve,5100));await H.maintenance();await until(run.id,r=>r.state==='waiting'&&r.events.some(e=>e.type==='watch.checked'));assert.equal(requests.length,1);assert.equal(ciReads,2);
    building=false;await new Promise(resolve=>setTimeout(resolve,5100));const final=await until(run.id,r=>r.state==='completed');assert.equal(final.counts.modelCalls,2);assert.ok(final.messages.some(m=>m.content?.includes('New evidence from the registered watch')));
  } finally {server.removeListener('request',alias);server.on('request',original);}
}));
test('SIGKILL recovery keeps completed notes and resumes a pending model turn without replaying tools', async () => {
  const {spawn}=require('node:child_process');let entered,release;
  const gate=new Promise(resolve=>entered=resolve);
  brain=payload=>{
    if(!payload.messages.some(m=>m.role==='tool'))return response([call('note','task_memory_save',{path:'survives.md',content:'Pinned evidence before process death',summary:'Restart evidence'})]);
    entered();return new Promise(resolve=>release=()=>resolve(response('Interrupted request output')));
  };
  const source=`const H=require('./lib/task-harness'),A=require('./lib/access');A.run(${JSON.stringify(identity('restart-worker'))},async()=>{const r=await H.start({title:'Recover after process death',goal:'Retain evidence',allow_model:true});console.log(JSON.stringify({run:r.id}));}).catch(e=>{console.error(e);process.exit(1)});setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['-e',source],{cwd:path.resolve(__dirname,'..'),env:process.env,stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',b=>errors+=b);const exit=new Promise(resolve=>child.once('exit',resolve));
  try {
    const run=await new Promise((resolve,reject)=>{let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;const line=buffer.split('\n')[0];if(buffer.includes('\n'))try{resolve(JSON.parse(line).run);}catch(e){reject(e);}});child.once('exit',code=>{if(code)reject(Error(errors));});});
    await gate;child.kill('SIGKILL');await exit;release();brain=()=>response('Recovered using the retained evidence.');
    await A.run(identity('restart-worker','new-chat'),async()=>{
      const final=await until(run,r=>['completed','needs_attention'].includes(r.state));assert.equal(final.state,'completed',final.reason);assert.equal(final.counts.toolCalls,1);assert.equal(final.counts.modelCalls,3);
      assert.match(H.memory({run,path:'runs/'+run+'/notes/survives.md'}).content,/before process death/);assert.ok(final.events.some(e=>e.type==='recovered'));
    });
  } finally {if(child.exitCode===null)child.kill('SIGKILL');}
});
