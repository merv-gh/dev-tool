const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-library-resolution-'));process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_LOG='quiet';
const config={envs:{dev:{}},scripts:{starters:false},passports:{internalGroups:['com.acme'],libraryRepos:{'*':'LIB/libs'},indexRatePerSec:100000,libraryVersionMaxRequests:12,libraryVersionMaxBranches:3,libraryVersionTimeoutMs:1000}};
const setConfig=patch=>{fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...config,...patch}));require('../lib/config').reload();};setConfig();
const root=path.join(home,'source');fs.mkdirSync(root);
const sh=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'}}).trim();
fs.writeFileSync(path.join(root,'build.gradle'),"group = 'com.acme'\nversion = '1.0'\n");fs.writeFileSync(path.join(root,'Lib.java'),'class Lib {}');sh('init','-q','-b','main');sh('add','.');sh('commit','-qm','initial');
sh('checkout','-qb','develop');fs.writeFileSync(path.join(root,'build.gradle'),"allprojects { version = '3.0-SNAPSHOT' }\n");sh('commit','-qam','snapshot');sh('checkout','-q','main');
sh('checkout','-qb','release/kotlin');fs.unlinkSync(path.join(root,'build.gradle'));fs.writeFileSync(path.join(root,'build.gradle.kts'),'project.version = "4.0"\n');sh('add','.');sh('commit','-qm','kotlin');sh('checkout','-q','main');
const P=require('../lib/passport'),G=require('../lib/git'),A=require('../lib/atlassian'),E=require('../lib/execution'),originalFile=A.file;
let reads=[],fetches=[],refCalls=0;
const git={remoteRefs:async()=>{refCalls++;return {tags:new Set(),heads:new Set(['main','develop','release/kotlin'])};},fetchRef:(p,r,ref,opts)=>{fetches.push(ref||'HEAD');return G.fetchRef(p,r,ref,{...opts,url:'file://'+root});}};
const read=async(p,r,file,{at}={})=>{reads.push([at,file]);try{return sh('show',`${at}:${file}`);}catch{throw Error('404');}};
test.beforeEach(()=>{reads=[];fetches=[];refCalls=0;A.file=read;setConfig();});
test.after(async()=>{A.file=originalFile;await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
const dep=version=>({groupId:'com.acme',artifactId:'libs',version});
test('untagged versions resolve from build.gradle and Kotlin project.version',async()=>{
 for(const [version,ref,file] of [['3.0-SNAPSHOT','develop','build.gradle'],['4.0','release/kotlin','build.gradle.kts']]){
  const [lib]=await P.fetchLibraries([dep(version)],git);assert.equal(lib.error,undefined);assert.equal(lib.ref,ref);assert.equal(lib.exactVersion,true);assert.equal(lib.resolution.file,file);assert.ok(reads.some(r=>r[0]==='refs/heads/'+ref&&r[1]===file));
 }
});
test('missing versions have a finite request budget and reuse remote/default fetches across modules',async()=>{
 setConfig({passports:{...config.passports,libraryVersionMaxRequests:4}});
 const many={...git,remoteRefs:async()=>{refCalls++;return {tags:new Set(),heads:new Set(['main',...Array.from({length:100},(_,i)=>'feature/'+i)])};}};
 const libs=await P.fetchLibraries([dep('missing'),{...dep('missing'),artifactId:'libs-two'}],many);
 assert.equal(refCalls,1);assert.deepEqual(fetches,['HEAD']);assert.equal(reads.length,4);assert.equal(libs.length,2);
 for(const lib of libs){assert.equal(lib.exactVersion,false);assert.equal(lib.resolution.kind,'default');assert.match(lib.note,/latest default branch/);assert.equal(lib.ref,'HEAD');}
});
test('remote listing errors and stale advertised tags still attempt the latest default branch',async()=>{
 let libs=await P.fetchLibraries([dep('7.0')],{...git,remoteRefs:async()=>{throw Error('remote listing unavailable');}});
 assert.equal(libs[0].ref,'HEAD');assert.equal(libs[0].exactVersion,false);assert.match(libs[0].note,/lookup failed/);
 fetches=[];libs=await P.fetchLibraries([dep('7.0')],{...git,remoteRefs:async()=>({tags:new Set(['v7.0']),heads:new Set(['main'])}),fetchRef:(p,r,ref,opts)=>{if(ref){fetches.push(ref);throw Error('tag disappeared');}return git.fetchRef(p,r,ref,opts);}});
 assert.deepEqual(fetches,['v7.0','HEAD']);assert.equal(libs[0].ref,'HEAD');assert.equal(libs[0].exactVersion,false);assert.match(libs[0].note,/Cannot fetch v7.0/);
});
test('a stalled Bitbucket build-file read times out and falls back; user cancellation never starts fallback',async()=>{
 let admitted,seen;const server=require('node:http').createServer((req,res)=>{admitted?.();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const configure=timeout=>setConfig({bitbucket:{url:'http://127.0.0.1:'+server.address().port,token:'fixture-token'},passports:{...config.passports,libraryVersionTimeoutMs:timeout}});
 A.file=originalFile;
 try{
  configure(100);const started=Date.now();const [lib]=await P.fetchLibraries([dep('stalled')],git);assert.equal(lib.ref,'HEAD');assert.equal(lib.exactVersion,false);assert.match(lib.note,/time budget/);assert.ok(Date.now()-started<3000);
  configure(10000);seen=new Promise(r=>admitted=r);fetches=[];const operation=E.start({kind:'test'},()=>P.fetchLibraries([dep('cancelled')],git));await seen;E.cancel(operation.id,'cancelled by user');await assert.rejects(operation.promise,e=>e.code==='DT_CANCELLED');assert.deepEqual(fetches,[]);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('passport tool returns a job immediately, joins it, keeps cached reads available, and scopes handles',async()=>{
 const T=require('../lib/tools'),J=require('../lib/jobs'),access=require('../lib/access'),build=P.build,load=P.load;await T.ready();let complete,started;
 const entered=new Promise(r=>started=r),gate=new Promise(r=>complete=r),fake={service:'service',repo:{sha:'a'.repeat(40)},summary:{endpoints:0},flows:[],builtAt:new Date().toISOString()};
 P.load=()=>null;P.build=async()=>{started();await gate;return fake;};
 try{
  const first=await T.call('passport',{service:'service',refresh:true});await entered;assert.equal(first.state,'running');assert.ok(first.job);assert.equal((await T.call('passport',{service:'service',refresh:true})).job,first.job);
  P.load=()=>fake;assert.equal((await T.call('passport',{service:'service'})).cached,true);
  await access.run({principalId:'other',storyId:'one',multiUser:true},()=>assert.rejects(T.call('passport',{service:'service',job:first.job}),/not found/));
  complete();await J.find(first.job).promise;const done=await T.call('passport',{service:'service',job:first.job});assert.equal(done.state,'done');assert.equal(done.repo.sha,fake.repo.sha);assert.match(done.view,/passport\/service/);
 }finally{complete();P.build=build;P.load=load;}
});


test('a real passport build performs graph/index work off the main thread',async()=>{
 const CI=require('../lib/codeindex'),build=CI.build;CI.build=()=>{throw Error('blocking main-thread index build');};
 try{const p=await P.build('background-service',{repo:'LIB/libs',gitImpl:git,libraries:false,rebuildCatalog:false});assert.equal(typeof p.codeIndex,'string');assert.ok(CI.load(p.codeIndex));assert.ok(Array.isArray(p.flows));}
 finally{CI.build=build;}
});
test('showcase waits for the passport job and keeps its complete summary and flows',async()=>{
 const T=require('../lib/tools'),original=T.call,load=P.load;const summary={endpoints:1,consumes:[],produces:[],tables:{}};
 P.load=()=>null;
 T.call=async(name,args)=>{
  if(name==='passport'&&args.job)return {state:'done',summary,repo:{project:'LIB',repo:'libs'},flows:[{entry:'GET /'}],view:'http://example.invalid/passport'};
  if(name==='passport'){const j=require('../lib/jobs').start('passport:showcase-test','passport showcase-test',async()=>({summary}));return {job:j.id,state:'running'};}
  throw Error('Synthetic dependency not configured');
 };
 try{const result=await require('../lib/showcase').run({service:'showcase-test',envs:['dev']});const step=result.steps.find(s=>s.key==='passport');assert.equal(step.ok,true);assert.match(step.summary,/1 endpoints/);assert.equal(step.flows.length,1);}
 finally{T.call=original;P.load=load;}
});

test('a dependency version property is not proof of the library own version',async()=>{
 A.file=async(p,r,file)=>file==='build.gradle'?"version = '1.0'\next { dependencyVersion = '99.0' }\n":null;
 const hit=await P.branchDeclaring({project:'LIB',repo:'libs'},'99.0',new Set(['main']));assert.equal(hit,null);
});
