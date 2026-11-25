const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-workspace-program-'));
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_TOOLS','DT_RUNNER_URL','DT_RUNNER_TOKEN'])delete process.env[key];
Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy',DT_REQUEST_EVENTS:'0',DT_RUNNER_TOKEN:'program-fixture-token'});
const configuration={envs:{dev:{}},scripts:{starters:false},tools:{workerHeapMb:0},tests:{compileCheck:false},workspaceEditor:{programs:true}};
const save=()=>{fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(configuration));require('../lib/config').reload();};save();
const A=require('../lib/access'),T=require('../lib/tools'),W=require('../lib/workspace'),J=require('../lib/jobs'),G=require('../lib/global-context');let server,workspace;
const actor=(story='chat-one',role='admin')=>({principalId:'operator',storyId:story,role,multiUser:true});
test.before(async()=>{server=require('../lib/runner').serve({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));process.env.DT_RUNNER_URL='http://127.0.0.1:'+server.address().port;save();await A.run(actor(),async()=>{G.open({id:'programs'});workspace=await G.within('programs',()=>W.create({name:'fixture-program'}));G.within('programs',()=>W.write(workspace.id,'main.js',{content:'console.log(JSON.stringify({arg:process.argv[2]}));',check:false}));});});
test.after(async()=>{await require('../lib/telemetry').shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));await require('../lib/isolate').stop();await require('../lib/state-store').close();await require('../lib/observations').close();fs.rmSync(home,{recursive:true,force:true});});
test('reviewed local source runs only on authenticated runner; durable job can be observed in another chat',async()=>{
 let job;
 await A.run(actor(),async()=>{job=await T.call('global_context_call',{id:'programs',tool:'workspace_program',arguments:{workspace:workspace.id,path:'main.js',args:['literal; $(no-shell)'],allow_execute:true}});const done=await G.within('programs',()=>J.find(job.job).promise);assert.equal(done.state,'done');assert.equal(done.result.ok,true);assert.match(done.result.out,/literal; \$\(no-shell\)/);assert.equal(done.result.runner.placement,'remote');});
 await A.run(actor('chat-two'),async()=>{const result=await T.call('global_context_call',{id:'programs',tool:'job_get',arguments:{job:job.job}});assert.equal(result.result.outcome,'completed');assert.equal(result.result.sourceRevision,job.sourceRevision);});
});
test('program execution rejects users, absent opt-in, escapes and disabled policy',async()=>{
 const args={workspace:workspace.id,path:'main.js',allow_execute:true};
 await A.run(actor('chat','user'),async()=>assert.rejects(T.call('global_context_call',{id:'programs',tool:'workspace_program',arguments:args}),/Administrator/));
 await A.run(actor(),async()=>{
  await assert.rejects(T.call('global_context_call',{id:'programs',tool:'workspace_program',arguments:{...args,allow_execute:false}}),/requires/);
  await assert.rejects(T.call('global_context_call',{id:'programs',tool:'workspace_program',arguments:{...args,path:'../escape.js'}}),/relative/);
  configuration.workspaceEditor.programs=false;save();await assert.rejects(T.call('global_context_call',{id:'programs',tool:'workspace_program',arguments:args}),/requires/);configuration.workspaceEditor.programs=true;save();
 });
});
