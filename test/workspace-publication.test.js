const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-checked-publish-'));
Object.assign(process.env,{DT_HOME:home,DT_GIT_DIR:path.join(home,'git'),DT_STATE_BACKEND:'legacy',DT_RATE_PER_SEC:'0',DT_LOG:'quiet'});
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},push:{enabled:true,author:'Fixture <fixture@example.test>'}}));
const W=require('../lib/workspace'),P=require('../lib/workspace-publication');
const env={...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.test'};
const git=(cwd,...args)=>execFileSync('git',args,{cwd,env,stdio:'pipe'}).toString().trim();
const seed=path.join(home,'seed'),bare=path.join(home,'remote.git');fs.mkdirSync(seed);git(seed,'init','-q','-b','main');fs.writeFileSync(path.join(seed,'App.java'),'class App {}\n');git(seed,'add','.');git(seed,'commit','-qm','initial');git(home,'clone','-q','--bare',seed,bare);
const open=()=>W.open({project:'DEMO',repo:'service',url:'file://' + bare,fresh:true});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();await require('../lib/observations').close();fs.rmSync(home,{recursive:true,force:true});});
test('checked tree excludes .dt, publishes once, and reconciles an acknowledgement loss without another commit',async()=>{
 const w=await open();W.write(w.id,'App.java',{content:'class App { int fixed; }\n'});
 fs.mkdirSync(path.join(W.checkId(w.id).path,'.dt'),{recursive:true});fs.writeFileSync(path.join(W.checkId(w.id).path,'.dt','state.json'),'{}');
 const beforeIndex=git(W.checkId(w.id).path,'diff','--cached');const candidate=await P.candidate(w.id);assert.deepEqual(candidate.files,['App.java']);assert.equal(git(W.checkId(w.id).path,'diff','--cached'),beforeIndex);
 const args={workspace:w.id,branch:'codex/BUG-42',message:'Fix BUG-42',tree:candidate.tree,request_id:'publish-once'};
 const first=await P.publish(args);assert.equal(git(bare,'rev-parse','codex/BUG-42'),first.commit);assert.equal(git(bare,'show','codex/BUG-42:App.java'),'class App { int fixed; }');
 assert.throws(()=>git(bare,'show','codex/BUG-42:.dt/state.json'));
 const second=await P.publish(args);assert.equal(second.commit,first.commit);assert.equal(git(bare,'rev-list','--count','codex/BUG-42'),'2');
 assert.equal((await W.patch(w.id)).files.length,0);assert.equal(second.defaultBranch,'main');
});
test('candidate changes and protected/default targets stop before creating a commit',async()=>{
 const w=await open();W.write(w.id,'App.java',{content:'class App { int one; }\n'});const candidate=await P.candidate(w.id),head=git(W.checkId(w.id).path,'rev-parse','HEAD');
 W.write(w.id,'App.java',{content:'class App { int two; }\n'});
 await assert.rejects(P.publish({workspace:w.id,branch:'codex/changed',message:'change',tree:candidate.tree,request_id:'changed'}),/Candidate changed/);
 await assert.rejects(P.publish({workspace:w.id,branch:'main',message:'change',tree:candidate.tree,request_id:'protected'}),/unprotected codex/);
 const file=path.join(home,'config.json'),config=fs.readFileSync(file,'utf8');
 try {fs.writeFileSync(file,JSON.stringify({...JSON.parse(config),tools:{disable:['workspace_push']}}));require('../lib/config').reload();await assert.rejects(P.publish({workspace:w.id,branch:'codex/disabled',message:'change',tree:candidate.tree,request_id:'disabled'}),{code:'DT_ACCESS_DENIED'});}
 finally{fs.writeFileSync(file,config);require('../lib/config').reload();}
 assert.equal(git(W.checkId(w.id).path,'rev-parse','HEAD'),head);
});
test('a moved task branch never triggers an untested replay',async()=>{
 const w=await open();W.write(w.id,'App.java',{content:'class App { int ours; }\n'});const candidate=await P.candidate(w.id);
 fs.writeFileSync(path.join(seed,'Other.java'),'class Other {}\n');git(seed,'add','.');git(seed,'commit','-qm','other');git(seed,'push','-q',bare,'HEAD:refs/heads/codex/moved');const tip=git(bare,'rev-parse','codex/moved');
 await assert.rejects(P.publish({workspace:w.id,branch:'codex/moved',message:'ours',tree:candidate.tree,request_id:'moved'}),/moved/);
 assert.equal(git(bare,'rev-parse','codex/moved'),tip);assert.match((await W.patch(w.id)).patch,/ours/);
});
