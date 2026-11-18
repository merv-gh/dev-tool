const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-persistent-collections-'));
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_SCRIPTS_DIR','DT_TOOLS','DT_SECURITY_PROFILE','DT_API_KEY','DT_STATE_DIR'])delete process.env[key];
Object.assign(process.env,{DT_HOME:home,DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_STATE_BACKEND:'legacy'});
const tokens={alice:'collection-alice-token',bob:'collection-bob-token'};
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},tools:{workerHeapMb:0},server:{accessTokens:Object.entries(tokens).map(([id,token])=>({id,token}))}}));
let server,base;
async function start(){
 let log='';const child=spawn(process.execPath,['-e',`const server=require('./server').start({port:0,host:'127.0.0.1'});server.once('listening',()=>process.send({base:'http://127.0.0.1:'+server.address().port}));`],{cwd:path.join(__dirname,'..'),env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 child.stdout.on('data',data=>{log+=data;});child.stderr.on('data',data=>{log+=data;});
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{const ready=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(([code])=>{throw Error('Server exited '+code+' '+log.slice(-1000));})]);base=ready.base;server=child;return child;}finally{clearTimeout(timer);}
}
async function stop(){if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,'exit');server.kill('SIGKILL');await exited;}server=null;}
async function call(name,args,{user='alice',story='TASK-42',session,ok=true}={}){
 const response=await fetch(base+'/api/tool/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokens[user],'x-dt-story':story,...(session?{'mcp-session-id':session}:{})},body:JSON.stringify(args)});const body=await response.json();if(ok)assert.equal(response.status,200,JSON.stringify(body));return ok?body.result:{status:response.status,...body};
}
test.before(start);test.after(async()=>{await stop();fs.rmSync(home,{recursive:true,force:true});});
test('model HTTP CRUD, typed execution and reports survive a real coordinator restart',async()=>{
 const definition={description:'Persisted model workflow',params:{id:{type:'integer',required:true}},steps:[{set:{observed:'{{id}}'}}]};
 const created=await call('script_save',{id:'persist/workflow',...definition,expected_revision:null});const col=await call('collection_get',{collection:'persist'});assert.match(col.revision,/^[a-f0-9]{64}$/);
 await call('collection_save',{collection:'persist',description:'Saved suite',suite:{order:['workflow']},expected_revision:col.revision});
 const scriptRun=await call('script_run',{id:'persist/workflow',params:{id:42}});assert.equal(scriptRun.results.observed,42);
 const run=await call('collection_run',{collection:'persist',params:{id:42},wait_ms:50000});assert.equal(run.ok,true);const report=await call('collection_history',{run:run.run});
 await stop();await start();
 assert.ok((await call('script_list',{}, {session:'new-connection'})).scripts.some(s=>s.id==='persist/workflow'));const read=await call('script_get',{id:'persist/workflow'});assert.equal(read.revision,created.revision);assert.deepEqual(read.steps,definition.steps);
 const retained=await call('collection_history',{run:run.run});assert.equal(retained.status,'passed');assert.equal(retained.definitions['persist/workflow'].revision,report.definitions['persist/workflow'].revision);assert.equal(retained.cases[0].result.results.observed,42);assert.equal((await call('collection_check',{run:run.run})).ok,true);
 const updated=await call('script_save',{id:read.id,description:'Updated',steps:[{set:{observed:43}}],expected_revision:read.revision});assert.notEqual(updated.revision,read.revision);
 assert.notEqual((await call('script_delete',{id:read.id,expected_revision:read.revision},{ok:false})).status,200);assert.equal((await call('script_get',{id:read.id})).revision,updated.revision);
 await call('script_delete',{id:read.id,expected_revision:updated.revision});assert.equal((await call('script_list',{})).scripts.length,0);assert.equal((await call('collection_history',{run:run.run})).status,'passed');
});
test('collection updates/deletion reject stale subtree revisions and require explicit recursion',async()=>{
 const initial=await call('collection_save',{collection:'crud',description:'Empty',expected_revision:null});assert.match(initial.revision,/^[a-f0-9]{64}$/);
 await call('script_save',{id:'crud/nested/check',description:'Nested',steps:[{set:{ok:true}}],expected_revision:null});
 const stale=await call('collection_save',{collection:'crud',description:'Stale',expected_revision:initial.revision},{ok:false});assert.notEqual(stale.status,200);
 assert.notEqual((await call('collection_delete',{collection:'crud',expected_revision:initial.revision,recursive:true},{ok:false})).status,200);
 const current=await call('collection_get',{collection:'crud'});assert.notEqual((await call('collection_delete',{collection:'crud',expected_revision:current.revision},{ok:false})).status,200);
 assert.equal((await call('script_get',{id:'crud/nested/check'})).description,'Nested');const removed=await call('collection_delete',{collection:'crud',expected_revision:current.revision,recursive:true});assert.equal(removed.scripts,1);assert.notEqual((await call('collection_get',{collection:'crud'},{ok:false})).status,200);
 const empty=await call('collection_save',{collection:'empty',description:'Empty',expected_revision:null});assert.equal((await call('collection_delete',{collection:'empty',expected_revision:empty.revision})).deleted,true);
 assert.notEqual((await call('collection_save',{collection:'persist',expected_revision:null},{ok:false})).status,200);
});
test('MCP exposes workflow create/read/update/delete/execute with the same persistent scope',async()=>{
 let seq=0;const rpc=async(name,args)=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokens.alice,'x-dt-story':'MCP-TASK','mcp-session-id':'changing-session-'+(++seq)},body:JSON.stringify({jsonrpc:'2.0',id:seq,method:'tools/call',params:{name,arguments:args}})});const body=await r.json();assert.ok(!body.error,JSON.stringify(body));assert.ok(!body.result.isError,JSON.stringify(body));return body.result.structuredContent||JSON.parse(body.result.content[0].text);};
 await rpc('script_save',{id:'model/check',description:'MCP saved',steps:[{set:{value:1}}],expected_revision:null});const read=await rpc('script_get',{id:'model/check'});assert.match(read.revision,/^[a-f0-9]{64}$/);
 const updated=await rpc('script_save',{id:read.id,description:'MCP updated',steps:[{set:{value:2}}],expected_revision:read.revision});assert.equal((await rpc('script_run',{id:read.id})).results.value,2);
 assert.equal((await rpc('script_delete',{id:read.id,expected_revision:updated.revision})).deleted,true);
});
test('an interrupted background run is retained as interrupted, never replayed or left running',async()=>{
 const marker=path.join(home,'marker');const api=require('node:http').createServer((req,res)=>{fs.appendFileSync(marker,'effect\n');res.end('{}');});await new Promise(r=>api.listen(0,'127.0.0.1',r));
 try{
  await call('script_save',{id:'interrupt/run',description:'Restart in flight',steps:[{http:'POST http://127.0.0.1:'+api.address().port},{js:'await new Promise(resolve=>setTimeout(resolve,30000));'},{http:'POST http://127.0.0.1:'+api.address().port}],finally:'log("cleanup only when alive");'});
  let result=await call('collection_run',{collection:'interrupt',wait_ms:0});for(let i=0;i<100&&(!result.run||!fs.existsSync(marker));i++){await new Promise(r=>setTimeout(r,25));result=await call('collection_run',{job:result.job,wait_ms:0});}
  assert.ok(result.run);assert.equal(fs.readFileSync(marker,'utf8'),'effect\n');const original=await call('collection_history',{run:result.run});assert.equal(original.status,'running');
  await stop();await start();const resumed=await call('collection_run',{job:result.job,wait_ms:0});assert.equal(resumed.status,'interrupted');assert.equal(resumed.ok,false);
  const retained=await call('collection_history',{run:result.run});assert.equal(retained.status,'interrupted');assert.equal(retained.cleanupIncomplete,true);assert.equal(retained.definitions['interrupt/run'].revision,original.definitions['interrupt/run'].revision);assert.equal(retained.cases[0].status,'error');assert.match(retained.error,/effects and cleanup/);assert.equal((await call('collection_check',{run:result.run})).ok,false);assert.match((await call('collection_report',{run:result.run,format:'junit'})).xml,/<error/);
  assert.equal((await call('collection_history',{collection:'interrupt'}))[0].status,'interrupted');assert.equal((await call('collection_cancel',{run:result.run})).cancelled,false);assert.equal(fs.readFileSync(marker,'utf8'),'effect\n');
 }finally{api.closeAllConnections();await new Promise(r=>api.close(r));}
});
test('another principal or task cannot read, delete or execute saved workflows and reports',async()=>{
 const saved=await call('script_save',{id:'private/check',description:'Private',steps:[{set:{ok:true}}]});const c=await call('collection_get',{collection:'private'});
 for(const scope of [{user:'bob'},{story:'OTHER-TASK'}]){assert.equal((await call('script_list',{},scope)).scripts.length,0);for(const [name,args] of [['script_get',{id:saved.id}],['script_delete',{id:saved.id,expected_revision:saved.revision}],['script_run',{id:saved.id}],['collection_delete',{collection:'private',expected_revision:c.revision,recursive:true}]])assert.notEqual((await call(name,args,{...scope,ok:false})).status,200);}
 assert.equal((await call('script_get',{id:saved.id})).revision,saved.revision);
});
