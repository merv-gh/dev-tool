const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-access-'));process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_NO_DOCTOR='1';
const tokens={alice:'alice-token-0123456789',bob:'bob-token-0123456789',admin:'admin-token-0123456789',bound:'bound-token-0123456789'};
const initial={envs:{dev:{}},server:{accessTokens:Object.entries(tokens).map(([id,token])=>({id,token,role:id==='admin'?'admin':'user',...(id==='bound'?{story:'fixed'}:{})}))},scripts:{starters:false},files:{private:{type:'local',path:'files',write:true},shared:{type:'local',path:'shared',write:true,shared:true}}};
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(initial));fs.mkdirSync(path.join(home,'shared'));fs.writeFileSync(path.join(home,'shared','seed.txt'),'shared seed');
const A=require('../lib/access'),S=require('../lib/state-store'),C=require('../lib/context'),W=require('../lib/workspace');
const scope=(principalId='alice',storyId='one')=>A.normalize({principalId,storyId,role:principalId==='admin'?'admin':'user',multiUser:true});
let server,base;
test.before(async()=>{server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(r=>server.close(r));await require('../lib/isolate').stop();await S.close();fs.rmSync(home,{recursive:true,force:true});});
async function req(url,{user='alice',story='one',body,headers={},method}={}){const r=await fetch(base+url,{method:method||(body===undefined?'GET':'POST'),headers:{...(user?{authorization:'Bearer '+tokens[user]}:{}),...(story?{'x-dt-story':story}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json().catch(()=>null);return {status:r.status,value};}
async function tool(name,args={},options={}){const r=await req('/api/tool/'+name,{...options,body:args});return {...r,result:r.value?.result};}

test('tokens identify principals, explicit chats isolate default paths, and local access cannot bypass tokens',async()=>{
 assert.equal((await req('/api/admin/runtime',{user:null})).status,403);
 assert.equal((await req('/api/admin/runtime',{headers:{authorization:'Bearer wrong'}})).status,403);
 assert.equal((await req('/api/admin/runtime',{headers:{'x-dt-principal':'bob'}})).status,403);
 const fixed=await req('/api/admin/runtime',{user:'bound',story:null});assert.equal(fixed.value.identity.storyId,'fixed');assert.equal(fixed.value.identity.storyBound,true);
 assert.equal((await req('/api/admin/runtime',{user:'bound',story:'other'})).status,403);
 const local=A.normalize({...A.LEGACY,storyId:'named'});assert.notEqual(local.scopeKey,'legacy');
 for(const options of [{},{user:'bob'},{story:'two'}]){const r=await tool('context_open',{id:'same-name',title:'Private '+(options.user||'alice')+(options.story||'one')},options);assert.equal(r.status,200);assert.equal(r.result.created,true);}
 await tool('context_write',{id:'same-name',path:'secret.txt',content:'alice one'});
 for(const options of [{user:'bob'},{story:'two'}]){const r=await tool('context_read',{id:'same-name',path:'secret.txt'},options);assert.notEqual(r.status,200);}
 const selected=await req('/api/admin/runtime',{user:'admin',headers:{'x-dt-principal':'alice'}});assert.equal(selected.value.identity.scopeKey,scope().scopeKey);
 assert.equal((await req('/api/admin/config')).status,403);
});

test('private local stores and indexed workspaces with identical ids stay separate; symlink escapes fail',async()=>{
 const F=require('../lib/files'),CI=require('../lib/codeindex'),G=require('../lib/git');
 for(const repo of ['../escape','foo/bar','foo\\bar','.','..','_STORIES']){await assert.rejects(W.open({project:'P',repo}),/single path segments/);assert.throws(()=>G.repoDir('P',repo),/single path segments/);}
 await assert.rejects(G.fetchRef('../outside','repo',null,{url:'http://127.0.0.1:1'}),/single path segments/);
 await assert.rejects(W.open({project:'P',repo:'repo',ref:'--upload-pack=bad'}),/Invalid Git ref/);
 for(const user of ['alice','bob'])await A.run(scope(user),async()=>{
   await F.write('private','value.txt',user);
   const id='same-workspace',dir=path.join(home,'work','_stories',A.current().scopeKey,id),meta=path.join(A.scopedDirectory(path.join(home,'cache','work')),id+'.json');
   fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'Value.java'),'class '+(user==='alice'?'AliceValue':'BobValue')+' {}');fs.mkdirSync(path.dirname(meta),{recursive:true});fs.writeFileSync(meta,JSON.stringify({id,owner:A.owner(),path:dir,createdAt:new Date().toISOString(),project:'P',repo:'r'}));W.reindex(id);
   assert.match(CI.load('work/'+id).root,new RegExp(A.current().scopeKey));
   assert.equal(CI.list().filter(x=>x.workspace===id).length,1);
 });
 await A.run(scope(),async()=>{
   assert.match(JSON.stringify(await F.read('private','value.txt')),/alice/);
   assert.match(W.read('same-workspace','Value.java').text,/AliceValue/);
   assert.throws(()=>CI.load('_stories/'+scope('bob').scopeKey+'/work/same-workspace'),/Invalid code index/);
   assert.throws(()=>CI.load('_STORIES/'+scope('bob').scopeKey+'/work/same-workspace'),/Invalid code index/);
   assert.throws(()=>CI.load('WORK/same-workspace'),/lowercase work/);
   assert.throws(()=>CI.keyDir('work/../anything'),/Invalid code index/);
   assert.throws(()=>CI.read('work/same-workspace','.git/config'),/off limits/);
   assert.throws(()=>W.checkId('bob-only'),/no workspace/);
   const dir=W.checkId('same-workspace').path;fs.symlinkSync(path.join(home,'shared'),path.join(dir,'escape'));
   assert.throws(()=>W.read('same-workspace','escape/seed.txt'),/symbolic/);
   const root=path.join(home,'files','_stories',A.current().scopeKey);fs.symlinkSync(path.join(home,'shared'),path.join(root,'escape'));
   await assert.rejects(F.read('private','escape/seed.txt'),/symbolic/);
   await assert.rejects(F.write('shared','seed.txt','changed',{overwrite:true}),/read.only/i);
 });
 await A.run(scope('bob'),()=>assert.match(W.read('same-workspace','Value.java').text,/BobValue/));
});

test('detached cells survive observation, keep network fetch, and deny cross-story get/cancel',async()=>{
 const started=await tool('code_start',{code:'console.log("started"); await new Promise(r=>setTimeout(r,200)); return 6*7;'});assert.equal(started.status,200,JSON.stringify(started.value));const id=started.result.id;
 assert.notEqual((await tool('code_wait',{id,waitMs:1},{user:'bob'})).status,200);
 assert.notEqual((await tool('code_cancel',{id},{story:'two'})).status,200);
 let done;for(let cursor=0,i=0;i<8;i++){done=await tool('code_wait',{id,cursor,waitMs:3000});cursor=done.result?.nextCursor||cursor;if(done.result?.state==='done'||done.result?.state==='failed')break;}assert.equal(done.status,200);assert.equal(done.result.state,'done',JSON.stringify(done.result));assert.equal(done.result.result.returned,42);
 const quick=await tool('code_start',{engine:'quickjs',code:'return [2,3,7].reduce((a,b)=>a*b,1)'});assert.equal(quick.status,200);
 const q=await tool('code_wait',{id:quick.result.id,waitMs:3000});assert.equal(q.result.state,'done');assert.equal(q.result.result.returned,42);
 const fetched=await tool('code',{code:'return (await fetch('+JSON.stringify(base+'/health')+')).status;'});assert.equal(fetched.status,200);assert.equal(fetched.result.returned,200);
});

test('owned execution metadata is editable by revision but other stories cannot read or change facts',async()=>{
 const runtime=await req('/api/admin/runtime');assert.equal(runtime.status,200);const e=runtime.value.executions.find(e=>e.tool==='code_start');assert.ok(e);
 const route='/api/admin/execution/'+e.id;assert.equal((await req(route,{user:'bob'})).status,404);assert.notEqual((await req(route+'/cancel',{story:'two',body:{}})).status,200);
 const rows=await req('/api/admin/metadata?kind=executions');assert.equal(rows.status,200);const rec=rows.value.records.find(r=>r.id===e.id);assert.ok(rec);
 const m='/api/admin/metadata/executions/'+rec.id;const changed=await req(m,{body:{expected_revision:rec.revision,patch:{label:'Reviewed',notes:'Scoped',tags:['checked']}}});assert.equal(changed.status,200);assert.equal(changed.value.value.metadata.label,'Reviewed');
 assert.equal((await req(m,{body:{expected_revision:rec.revision,patch:{notes:'stale'}}})).status,409);
 assert.notEqual((await req(m,{user:'bob',body:{expected_revision:changed.value.revision,patch:{notes:'stolen'}}})).status,200);
 assert.notEqual((await req(m,{body:{expected_revision:changed.value.revision,patch:{state:'done',owner:scope('bob')}}})).status,200);
});

test('saved result embeds restore their own principal without leaking through explicit scopes',async()=>{
 const R=require('../lib/results');const link=A.run(scope(),()=>R.saveView('json',{message:'private result'},{owner:scope('bob'),id:'forged'}));const id=link.split('/').pop();
 assert.equal(A.run(scope(),()=>R.load(id)).owner.principalId,'alice');
 assert.equal((await req('/api/result/'+id)).status,200);
 assert.equal((await req('/api/result/'+id,{story:'two'})).status,404);
 assert.equal((await req('/api/result/'+id,{user:'bob'})).status,404);
 assert.equal((await req('/api/result/'+id,{story:null})).status,200,'own browser iframe without story header restores saved scope');
 assert.equal((await req('/api/result/'+id,{user:null,story:null})).status,200,'unguessable read-only embed capability remains usable');
});

test('config edits compare revisions; invalid reloads retain the active generation',async()=>{
 const cfg=await req('/api/admin/config',{user:'admin'});assert.equal(cfg.status,200);assert.ok(cfg.value.revision);
 const next={...initial,server:{...initial.server,publicUrl:base}};
 const saved=await req('/api/admin/config',{user:'admin',body:{text:JSON.stringify(next),expected_revision:cfg.value.revision}});assert.equal(saved.status,200,JSON.stringify(saved));assert.notEqual(saved.value.revision,cfg.value.revision);
 assert.equal((await req('/api/admin/config',{user:'admin',body:{text:JSON.stringify(initial),expected_revision:cfg.value.revision}})).status,409);
 const config=require('../lib/config'),good=config.getEnv('dev');fs.writeFileSync(path.join(home,'config.json'),'{broken');config.reload();assert.deepEqual(config.getEnv('dev'),good);assert.ok(config.generation().lastError);
 assert.equal((await req('/api/admin/runtime')).status,503);assert.equal((await req('/api/admin/runtime',{user:'admin'})).status,200);assert.equal((await tool('find',{q:'x'},{user:'admin'})).status,503);
 const repair=await req('/api/admin/config',{user:'admin'});assert.equal(repair.status,200);assert.equal(repair.value.text,'{broken');
 assert.equal((await req('/api/admin/config',{user:'admin',body:{text:JSON.stringify(next),expected_revision:repair.value.revision}})).status,200);
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(next));config.reload();assert.equal(config.generation().lastError,null);
});

async function until(fn){for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,20));}throw Error('Condition did not settle');}
test('HTTP disconnect and MCP cancellation stop only the owned foreground request',async()=>{
 const E=require('../lib/execution'),T=require('../lib/tools');
 const before=new Set(A.run(scope(),()=>E.list({limit:500})).map(e=>e.id));
 const controller=new AbortController();const pending=fetch(base+'/api/tool/code',{method:'POST',signal:controller.signal,headers:{authorization:'Bearer '+tokens.alice,'x-dt-story':'one','content-type':'application/json'},body:JSON.stringify({code:'while(true){}'})});pending.catch(()=>{});
 const foreground=await until(()=>A.run(scope(),()=>E.list({limit:500}).find(e=>e.tool==='code'&&!before.has(e.id)&&e.state==='running')));
 controller.abort();await assert.rejects(pending,/abort/i);
 await until(()=>A.run(scope(),()=>E.get(foreground.id)?.state==='cancelled'));
 const session='transport-story';const pendingRpc=req('/mcp',{story:null,headers:{'mcp-session-id':session},body:{jsonrpc:'2.0',id:801,method:'tools/call',params:{name:'code',arguments:{code:'while(true){}'}}}});
 const rpc=await until(()=>A.run(scope('alice',session),()=>E.list().find(e=>e.tool==='code'&&e.state==='running')));
 await req('/mcp',{user:'bob',story:null,headers:{'mcp-session-id':session},body:{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:801}}});assert.equal(A.run(scope('alice',session),()=>E.get(rpc.id).state),'running');
 assert.equal((await req('/mcp',{story:null,headers:{'mcp-session-id':session},body:{jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:801}}})).status,202);
 const reply=await pendingRpc;assert.equal(reply.value.result.isError,true);assert.equal(A.run(scope('alice',session),()=>E.get(rpc.id).state),'cancelled');
});

test('saving and listing results never parse another story payload to filter ownership',()=>{
 const R=require('../lib/results'),dir=path.join(home,'cache','results'),foreign=path.join(dir,'s'+scope('bob').scopeKey+'zforeign.json');
 fs.writeFileSync(foreign,'x'.repeat(2*1024*1024));let foreignReads=0;const read=fs.readFileSync;
 fs.readFileSync=function(file,...args){if(String(file)===foreign)foreignReads++;return read.call(this,file,...args);};
 try{A.run(scope(),()=>{R.saveView('json',{hello:'own'});R.list();});assert.equal(foreignReads,0);}finally{fs.readFileSync=read;fs.rmSync(foreign);}
});
