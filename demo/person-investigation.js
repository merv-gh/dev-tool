// A real PostgreSQL/Spring before-and-after demo in an isolated DT_HOME.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
async function start(options){
  const F=require('../dev/person-mutations'),R=require('../dev/person-runtime'),E=require('../dev/eval-person-mutations');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-person-demo-'));let runtime,server;
  const mutation=options.mutation||'annulled';
  for(const k of Object.keys(process.env))if(/^DT_(HOME|CONFIG_DIR|CACHE_DIR|WORK_DIR|REPOS_DIR|PASSPORTS_DIR|TOOLS|TOOL_PROFILE|API_KEY|PUBLIC_URL|SEMANTIC_URL|SEMANTIC_TOKEN)$/.test(k))delete process.env[k];
  Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',DT_RATE_PER_SEC:'0'});
  const close=async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}await runtime?.close();await require('../lib/pg').closeAll();await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});};
  try{
    const data=F.dataset();runtime=await R.create({...options,data});
    const config={envs:{fixture:{postgres:{person:runtime.pgUrl}}},scripts:{starters:false},tests:{gradle:options.gradle,javaHome:options.javaHome,gradleUserHome:options.gradleHome,compileCheck:false,compileFix:false,env:runtime.env},...(options.semanticUrl?{semantic:{url:options.semanticUrl,token:options.semanticToken}}:{})};
    fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
    const source=path.join(home,'source');E.seed(source);F.mutate(source,mutation);
    for(const a of [['init','-q','-b','main'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','-qm','Investigate person response']]){const r=spawnSync('git',a,{cwd:source,encoding:'utf8'});if(r.status)throw Error(r.stderr);}
    const W=require('../lib/workspace'),T=require('../lib/tools'),C=require('../lib/config');
    const ws=await W.open({project:'DEMO',repo:'person-service',ref:'main',url:source}),root=W.checkId(ws.id).path;
    const beforeGrade=await runtime.grade(root,data),personId=beforeGrade.failures[0].id;
    server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
    config.server={publicUrl:base};fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();
    const definition=require('../dev/person-notebook').definition(runtime.url,personId);
    await T.call('mapping_debug',{action:'save',id:'person-name',expected_revision:null,definition});
    const before=await T.call('mapping_debug',{action:'run',id:'person-name',steps:['api','person','documents']});
    let author='reference calibration (not a model repair)';
    if(options.evaluation){
      const report=JSON.parse(fs.readFileSync(options.evaluation)),trial=report.cases?.find(c=>c.mutation===mutation&&c.passed&&c.patch);
      if(report.protocol!=='dt.person-mutations/v1'||!trial)throw Error('Evaluation must contain an independently passing patch for '+mutation);
      const applied=spawnSync('git',['apply','--include=src/main/java/person/*.java','-'],{cwd:root,input:trial.patch.replace(/\n?$/,'\n'),encoding:'utf8'});if(applied.status)throw Error('Model patch did not apply: '+applied.stderr);
      W.touch(ws.id,{dirty:true});author=report.model+' evaluated patch';
    }else{
      for(const m of (mutation.includes('+')?mutation.split('+'): [mutation]).map(id=>F.mutations.find(m=>m.id===id))){
        W.write(ws.id,m.file,{content:fs.readFileSync(path.join(__dirname,'../test/fixtures/person-service',m.file),'utf8')});
      }
    }
    const afterGrade=await runtime.grade(root,data);if(!afterGrade.passed)throw Error('Demo repair failed independent HTTP checks');
    const after=await T.call('mapping_debug',{action:'run',id:'person-name',steps:['api','person','documents']});
    let paths;
    if(options.pathReport){const p=JSON.parse(fs.readFileSync(options.pathReport)),match=p.protocol==='dt.person-paths/v1'&&p.cases.find(c=>c.mutation===mutation&&c.behavior.sourceDigest===afterGrade.sourceDigest);if(!match)throw Error('Path report must match this exact graded candidate');paths=require('../lib/results').saveView('semantic-path-trace',match.trace,{title:'Person API · actual model before/after Joern paths'});}
    return {home,base,workspace:ws.id,before:before.view,after:after.view,paths,url:base+'/mapping-debugger?id='+before.id,author,checked:afterGrade.checked,close};
  }catch(e){await close();throw e;}
}
module.exports={start};
if(require.main===module){const argv=process.argv.slice(2),extra={};for(const [flag,key]of [['--mutation','mutation'],['--evaluation','evaluation'],['--path-report','pathReport']]){const n=argv.indexOf(flag);if(n>=0){extra[key]=argv[n+1];argv.splice(n,2);}}const o={...require('../dev/eval-person-mutations').options(argv),...extra};start(o).then(d=>{console.log(JSON.stringify({url:d.url,before:d.before,after:d.after,paths:d.paths,workspace:d.workspace,author:d.author,checked:d.checked}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>d.close().then(()=>process.exit()));}).catch(e=>{console.error(e.message);process.exitCode=1;});}
