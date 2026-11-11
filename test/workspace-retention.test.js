const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-workspace-retention-'));
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR','DT_TOOLS','DT_SECURITY_PROFILE','DT_WORKSPACE_DAYS','DT_MODEL_GATEWAY','DT_REQUEST_EVENTS'])delete process.env[key];
Object.assign(process.env,{DT_HOME:home,DT_GIT_DIR:path.join(home,'git'),DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',DT_RATE_PER_SEC:'0'});
const config={envs:{dev:{}},tools:{workerHeapMb:0},scripts:{starters:false},tests:{compileCheck:false,workspaceDays:7}},save=()=>{fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();};save();
const A=require('../lib/access'),W=require('../lib/workspace'),T=require('../lib/trace'),G=require('../lib/git');
const owner=(storyId='TASK-42',principalId='alice')=>({principalId,storyId,role:'user',multiUser:true}),owned=fn=>A.run(owner(),fn);
const env={...process.env,GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'fixture@example.test'},git=(dir,...args)=>execFileSync('git',args,{cwd:dir,env,stdio:'pipe'}).toString().trim();
const source=path.join(home,'source');fs.mkdirSync(source);git(source,'init','-q','-b','main');fs.writeFileSync(path.join(source,'App.java'),'class App {}\n');git(source,'add','.');git(source,'commit','-qm','Initial fixture');
const args=repo=>({project:'P',repo,ref:'main',url:'file://'+source}),open=repo=>W.open(args(repo)),meta=id=>path.join(A.scopedDirectory(path.join(home,'cache','work')),id+'.json');
function age(id){const file=meta(id),m=JSON.parse(fs.readFileSync(file));m.usedAt=new Date(Date.now()-30*86400000).toISOString();fs.writeFileSync(file,JSON.stringify(m));return m;}
test.after(async()=>{await require('../lib/observations').close();await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});

test('same authenticated task reuses changes without a session and after transport reconnects',async()=>owned(async()=>{
 const first=await open('reconnect');W.write(first.id,'App.java',{content:'class App { int saved = 42; }\n'});
 const second=await T.call('workspace_open',{}, {session:'reconnected-session'},()=>open('reconnect'));assert.equal(second.id,first.id);assert.equal(second.reused,true);assert.match(W.read(second.id,'App.java',{lineNumbers:false}).text,/saved = 42/);
 const third=await T.call('workspace_open',{}, {session:'another-connection'},()=>open('reconnect'));assert.equal(third.id,first.id);assert.ok(W.list().find(w=>w.id===first.id).usedAt);
}));
test('concurrent opens converge, fresh is explicit, and another remote stays separate',async()=>owned(async()=>{
 const [a,b]=await Promise.all([open('parallel'),open('parallel')]);assert.equal(a.id,b.id);assert.equal(b.reused,true);
 const separate=await W.open({...args('parallel'),fresh:true});assert.notEqual(separate.id,a.id);assert.equal((await open('parallel')).id,separate.id);assert.ok(W.list().some(w=>w.id===a.id));
 const other=await W.open({...args('parallel'),url:source});assert.notEqual(other.id,separate.id);
}));
test('process restart resumes the exact dirty checkout without contacting the unavailable remote',async()=>owned(async()=>{
 const first=await open('restart');W.write(first.id,'notes.txt',{content:'Uncommitted task progress'});fs.renameSync(source,source+'-offline');
 try{const script=`const A=require('./lib/access'),W=require('./lib/workspace');A.run(${JSON.stringify(owner())},async()=>{const w=await W.open(${JSON.stringify(args('restart'))});console.log(JSON.stringify({id:w.id,reused:w.reused,text:W.read(w.id,'notes.txt',{lineNumbers:false}).text}));}).catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const resumed=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8',timeout:15000}));assert.equal(resumed.id,first.id);assert.equal(resumed.reused,true);assert.equal(resumed.text,'Uncommitted task progress');
 }finally{fs.renameSync(source+'-offline',source);}
}));
test('different tasks and principals remain isolated while stable task headers survive MCP reconnects',async()=>{
 const first=await owned(()=>open('isolated'));
 for(const scope of [owner('another-task'),owner('TASK-42','bob')])await A.run(scope,async()=>{assert.equal(W.list().length,0);assert.throws(()=>W.read(first.id,'.'),/no workspace|available/);assert.notEqual((await open('isolated')).id,first.id);});
 const identity=headers=>A.identity({headers,socket:{remoteAddress:'127.0.0.1'}});assert.equal(identity({'x-dt-story':'TASK-42','mcp-session-id':'old'}).scopeKey,identity({'x-dt-story':'TASK-42','mcp-session-id':'new'}).scopeKey);assert.notEqual(identity({'mcp-session-id':'old'}).scopeKey,identity({'mcp-session-id':'new'}).scopeKey);
});
test('failed preparation removes its partial checkout and a later open can retry',async t=>owned(async()=>{
 const original=G.fetchReusing;let attempts=0;t.mock.method(G,'fetchReusing',(...args)=>{if(!attempts++)throw Error('Fixture remote unavailable');return original(...args);});await assert.rejects(open('retry-open'),/Fixture remote unavailable/);assert.equal(W.list().some(w=>w.repo==='P/retry-open'),false);const w=await open('retry-open');assert.ok(w.id);assert.equal(attempts,2);
}));
test('cleanup preserves edits, untracked files, local commits, context links, builds and unknown Git state',async()=>owned(async()=>{
 const tracked=await open('dirty-tracked');fs.writeFileSync(path.join(W.checkId(tracked.id).path,'App.java'),'class Changed {}\n');age(tracked.id);
 const untracked=await open('dirty-untracked');fs.writeFileSync(path.join(W.checkId(untracked.id).path,'progress.txt'),'unsaved findings');age(untracked.id);
 const committed=await open('local-commit'),committedDir=W.checkId(committed.id).path;fs.writeFileSync(path.join(committedDir,'App.java'),'class LocalCommit {}\n');git(committedDir,'add','.');git(committedDir,'commit','-qm','Unpushed work');age(committed.id);
 const linked=await open('context-linked');require('../lib/context').open({id:'saved-task',title:'Keep task checkout',workspaces:[linked.id]});age(linked.id);
 const active=await open('active-build'),release=W.hold(active.id),releaseOther=W.hold(active.id);age(active.id);release();release();age(active.id);
 const broken=await open('missing-git'),brokenDir=W.checkId(broken.id).path;fs.renameSync(path.join(brokenDir,'.git'),path.join(home,'retained-git-backup'));age(broken.id);
 const clean=await open('disposable'),cleanDir=W.checkId(clean.id).path;fs.mkdirSync(path.join(cleanDir,'.dt'));fs.writeFileSync(path.join(cleanDir,'.dt','compiler.json'),'{}');age(clean.id);
 assert.deepEqual(await W.sweep(),[clean.id]);for(const w of [tracked,untracked,committed,linked,active,broken])assert.ok(fs.existsSync(JSON.parse(fs.readFileSync(meta(w.id))).path));
 releaseOther();age(active.id);assert.deepEqual(await W.sweep(),[active.id]);assert.equal(fs.existsSync(cleanDir),false);
}));
test('reads refresh last use, explicit zero disables cleanup, and corrupt context evidence fails closed',async()=>owned(async()=>{
 const w=await open('read-use');const old=age(w.id).usedAt;W.read(w.id,'.');assert.notEqual(JSON.parse(fs.readFileSync(meta(w.id))).usedAt,old);assert.deepEqual(await W.sweep(),[]);
 age(w.id);config.tests.workspaceDays=0;save();assert.equal(require('../lib/config').getTests().workspaceDays,0);assert.deepEqual(await W.sweep(),[]);config.tests.workspaceDays=7;save();process.env.DT_WORKSPACE_DAYS='0';assert.equal(require('../lib/config').getTests().workspaceDays,0);assert.deepEqual(await W.sweep(),[]);delete process.env.DT_WORKSPACE_DAYS;
 const bad=path.join(A.scopedDirectory(path.join(home,'contexts')),'broken-context');fs.mkdirSync(bad);fs.writeFileSync(path.join(bad,'index.json'),'{broken');assert.deepEqual(await W.sweep(),[]);fs.rmSync(bad,{recursive:true});assert.deepEqual(await W.sweep(),[w.id]);
}));
test('activity during Git inspection prevents stale cleanup and patch files stay in the owner scope',async t=>owned(async()=>{
 const w=await open('cleanup-race');age(w.id);const original=G.git;t.mock.method(G,'git',async(...args)=>{const result=await original(...args);if(args[1]===JSON.parse(fs.readFileSync(meta(w.id))).path&&args[0][0]==='status')W.read(w.id,'.');return result;});assert.deepEqual(await W.sweep(),[]);t.mock.restoreAll();
 W.write(w.id,'task.txt',{content:'Keep this patch private'});await W.patch(w.id);assert.ok(fs.existsSync(path.join(A.scopedDirectory(path.join(home,'cache','work')),w.id+'.patch')));assert.equal(fs.existsSync(path.join(home,'cache','work',w.id+'.patch')),false);
}));
test('real HTTP calls with only a stable task header retain changes across tool calls',async t=>{
 const original=G.fetchReusing;t.mock.method(G,'fetchReusing',(project,repo,ref,options)=>original(project,repo,ref,{...options,url:'file://'+source}));const server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const call=async(name,args,session)=>{const response=await fetch(base+'/api/tool/'+name,{method:'POST',headers:{'content-type':'application/json','x-dt-story':'HTTP-TASK',...(session?{'x-openwebui-chat-id':session}:{})},body:JSON.stringify(args)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value.result;};
 try{const a=await call('workspace_open',{project:'P',repo:'http-service',ref:'main'});assert.ok(a.id,JSON.stringify(a));await call('workspace_write',{workspace:a.id,path:'progress.txt',content:'HTTP task work',check:false});const b=await call('workspace_open',{project:'P',repo:'http-service',ref:'main'});assert.equal(b.id,a.id);assert.equal(b.reused,true);assert.equal((await call('workspace_read',{workspace:b.id,path:'progress.txt'})).text,'HTTP task work');for(const session of ['first-chat','next-chat'])assert.equal((await call('workspace_open',{project:'P',repo:'http-service',ref:'main'},session)).id,a.id);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
