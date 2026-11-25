const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-global-context-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR','DT_TOOLS','DT_RUNNER_URL','DT_RUNNER_TOKEN'])delete process.env[k];
Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy',DT_REQUEST_EVENTS:'0'});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tools:{workerHeapMb:0},scripts:{starters:false},tests:{compileCheck:false}}));
const T=require('../lib/tools'),A=require('../lib/access'),G=require('../lib/global-context');
const actor=(principalId='alice',storyId='chat-one',role='user',tools)=>({principalId,storyId,role,multiUser:true,...(tools?{tools}:{})});
const call=(name,args)=>T.call(name,args);
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();await require('../lib/observations').close();fs.rmSync(home,{recursive:true,force:true});});
let workspace;
test('code mode persists project memory, reusable scripts and newly created repositories across chats',async()=>{
 await A.run(actor(),async()=>{
  await call('global_context_open',{id:'snapshotter',title:'Postgres snapshotter',repositories:['LOCAL/snapshotter']});
  const result=await call('code',{global_context:'snapshotter',code:`
   await files.write('understanding.md','Schema migrations dominate cold integration startup; verify with repeated runs.',{summary:'Project startup evidence'});
   await tools.script_save({id:'checks/startup',description:'Reusable startup calculation',params:{value:{required:true}},steps:[{js:'return vars.value * 2',as:'calculated'}],expected_revision:null});
   const repo=await tools.workspace_create({name:'snapshotter'});
   await tools.workspace_write({workspace:repo.id,path:'README.md',content:'# Snapshotter\\n',check:false});
   return {workspace:repo.id};`});
  assert.equal(result.ok,true,result.error);workspace=result.returned.workspace;
  assert.equal(require('../lib/results').load(result.view.split('/').pop()).view,'code','outer result readable in requesting chat');
  assert.equal(require('../lib/context').find().total,0,'ordinary story contexts remain separate');
 });
 await A.run(actor('alice','chat-two'),async()=>{
  const found=await call('global_context_find',{query:'Postgres'});assert.equal(found.total,1);
  const project=await call('global_context_get',{id:'snapshotter'});assert.equal(project.workspaces[0].id,workspace);assert.equal(project.scripts.scripts[0].id,'checks/startup');
  const result=await call('code',{global_context:'snapshotter',code:`const note=await files.read('understanding.md');const run=await tools.script_run({id:'checks/startup',params:{value:7}});return {note,run};`});
  assert.equal(result.ok,true,result.error);assert.match(result.returned.note,/Schema migrations/);assert.equal(result.returned.run.ok,true);assert.equal(result.returned.run.results.calculated,14);
  assert.equal((await call('global_context_call',{id:'snapshotter',tool:'workspace_read',arguments:{workspace,path:'README.md'}})).text,'# Snapshotter\n');
 });
});
test('restart restores reusable code and memory; other users and narrower grants stay isolated',async()=>{
 const child=spawnSync(process.execPath,['-e',`const A=require('./lib/access'),G=require('./lib/global-context');A.run(${JSON.stringify(actor('alice','fresh-process'))},()=>{const r=G.get({id:'snapshotter'});process.stdout.write(JSON.stringify({id:r.id,scripts:r.scripts.scripts.length,workspaces:r.workspaces.length}));});`],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{id:'snapshotter',scripts:1,workspaces:1});
 for(const role of ['user','admin'])await A.run(actor('bob','chat',role),async()=>{assert.equal(G.find().total,0);assert.throws(()=>G.get({id:'snapshotter'}),/not found/);});
 await A.run(actor('alice','restricted','user',['global_context_call','code']),async()=>{
  await assert.rejects(call('global_context_call',{id:'snapshotter',tool:'script_run',arguments:{id:'checks/startup',params:{value:2}}}),/not available/);
  const r=await call('code',{global_context:'snapshotter',code:`return await tools.script_run({id:'checks/startup',params:{value:2}});`});assert.equal(r.ok,false);assert.match(r.error,/not available/);
 });
});
test('memory writes use file revisions and reject traversal; legacy local principal also remains stable',async()=>{
 await A.run(actor(),async()=>{
  const r=await call('code',{global_context:'snapshotter',code:`await files.read('understanding.md');await files.write('understanding.md','verified',{summary:'Pinned startup result'});return true;`});assert.equal(r.ok,true,r.error);
  const invalid=await call('code',{global_context:'snapshotter',code:`return await files.write('../escape','no');`});assert.equal(invalid.ok,false);
 });
 G.open({id:'local'});const r=await call('code',{global_context:'local',code:`return await tools.global_context_get({id:'local'});`});assert.equal(r.ok,true,r.error);assert.equal(r.returned.id,'local');
});

test('asynchronous code cells use the same persistent scope and return native views to the requesting chat',async()=>A.run(actor(),async()=>{
 const cell=await call('code_start',{global_context:'snapshotter',code:`return {note:await files.read('understanding.md'),run:await tools.script_run({id:'checks/startup',params:{value:9}})};`});
 const result=await call('code_wait',{id:cell.id,waitMs:30000});assert.equal(result.state,'done',JSON.stringify(result));assert.equal(result.result.returned.run.results.calculated,18);
 const R=require('../lib/results');
 const copied=G.within('snapshotter',()=>G.expose({ok:true,view:R.save('pg',[{id:42}],{env:'dev'})+'?embed=1'},A.normalize(actor())));
 assert.equal(R.load(copied.view.split('/').pop()).rows[0].id,42);
}));
test('a presentation-copy failure preserves the completed tool result instead of inviting effect replay',t=>A.run(actor(),()=>{
 const R=require('../lib/results'),result=G.within('snapshotter',()=>({ok:true,receipt:'already-completed',view:R.saveView('json',{receipt:'already-completed'})}));
 t.mock.method(R,'saveView',()=>{throw Error('presentation storage is full');});
 const copied=G.within('snapshotter',()=>G.expose(result,A.normalize(actor())));
 assert.equal(copied.ok,true);assert.equal(copied.receipt,'already-completed');assert.equal(copied.view,undefined);assert.match(copied.viewError,/storage is full/);
}));

test('new local repositories are retained even when clean and older than checkout retention',async()=>A.run(actor(),()=>G.within('snapshotter',async()=>{
 const W=require('../lib/workspace'),repo=await W.create({name:'retained-empty'}),file=path.join(A.scopedDirectory(path.join(home,'cache','work')),repo.id+'.json'),meta=JSON.parse(fs.readFileSync(file));
 meta.usedAt=new Date(Date.now()-90*86400000).toISOString();fs.writeFileSync(file,JSON.stringify(meta));
 await W.sweep();assert.equal(fs.existsSync(W.checkId(repo.id).path),true);
})));
