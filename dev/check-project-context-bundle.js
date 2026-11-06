// Standalone deployment proof: no checkout or node_modules at the bundle location.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
async function run(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-project-bundle-')),bundle=path.join(root,'bundle'),home=path.join(root,'home');let server,stderr='';
 fs.cpSync(path.join(__dirname,'../dist'),bundle,{recursive:true});fs.mkdirSync(home);fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false}}));
 const env={PATH:process.env.PATH,DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',NODE_PATH:''};
 const tool=(name,args,ok=true)=>{const r=spawnSync(process.execPath,[path.join(bundle,'dt.js'),'tool',name,JSON.stringify(args)],{cwd:root,env,encoding:'utf8',timeout:15000});if(!ok){assert.notEqual(r.status,0);return;}assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 try{
  const first=tool('project_context_save',{id:'standalone',expected_revision:null,reason:'Verify standalone publication',document:{title:'Standalone project',summary:'Persistent project understanding'},files:[{path:'notes/finding.md',content:'An independently retained finding.'}]});
  assert.equal(tool('project_context_get',{id:'standalone',view:false}).revision,first.revision);assert.equal(tool('project_context_get',{id:'standalone',revision:first.revision,path:'notes/finding.md',view:false}).file.content,'An independently retained finding.');
  const archived=tool('project_context_save',{id:first.id,expected_revision:first.revision,reason:'Archive retained evidence',files:[{path:'notes/finding.md',archive:true}]});assert.ok(archived.files.some(f=>f.path.startsWith('archived/')));
  tool('project_context_save',{id:first.id,expected_revision:first.revision,reason:'Reject stale writer'},false);
  const restored=tool('project_context_save',{id:first.id,expected_revision:archived.revision,restore_revision:first.revision,reason:'Restore without rewriting history'});assert.equal(restored.parent,archived.revision);assert.equal(restored.history.length,3);
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  server=spawn(process.execPath,[path.join(bundle,'dt.js'),'serve','--port',String(port)],{cwd:root,env,stdio:['ignore','ignore','pipe']});server.stderr.on('data',x=>stderr+=x);const base=`http://127.0.0.1:${port}`,deadline=Date.now()+10000;let ready=false;
  while(Date.now()<deadline){try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,50));}assert.ok(ready,stderr);
  const read=await fetch(base+'/api/tool/project_context_get',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:first.id})}).then(r=>r.json());assert.equal(read.result.revision,restored.revision);
  const html=await fetch(base+new URL(read.result.view).pathname).then(r=>r.text());assert.match(html,/DTProjectContext/);assert.match(html,/Standalone project/);assert.ok(!html.includes('node_modules'));
  const coverage=await fetch(base+'/api/admin/runtime/coverage').then(r=>r.json());assert.equal(coverage.available,true);assert.equal(coverage.stale,false);
  console.log(JSON.stringify({passed:8,checks:['cross-process publication','exact file retention','archive inventory','stale writer rejection','non-destructive restore','HTTP read after restart','standalone inline renderer assets','source-matched bundled coverage']}));
 }finally{if(server?.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done;}fs.rmSync(root,{recursive:true,force:true});}
}
module.exports={run};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
