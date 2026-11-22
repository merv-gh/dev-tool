#!/usr/bin/env node
// Reparse actual model edits and compare retained Joern paths. Behavioral proof
// remains the independently rebuilt PostgreSQL/HTTP receipt in the input report.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
async function run({evaluation,url,token,output,cases=['annulled','resultset-column']}={}){
  const model=JSON.parse(fs.readFileSync(evaluation));if(model.protocol!=='dt.person-mutations/v1')throw Error('Expected a person mutation evaluation');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-person-paths-'));output=path.resolve(output||'work/person-mutations/paths.json');fs.mkdirSync(path.dirname(output),{recursive:true});
  for(const k of Object.keys(process.env))if(/^DT_(HOME|CONFIG_DIR|CACHE_DIR|WORK_DIR|REPOS_DIR|PASSPORTS_DIR|TOOLS|TOOL_PROFILE|SEMANTIC_URL|SEMANTIC_TOKEN)$/.test(k))delete process.env[k];
  Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{fixture:{}},semantic:{url,token},tests:{compileCheck:false},scripts:{starters:false}}));
  const F=require('./person-mutations'),E=require('./eval-person-mutations'),W=require('../lib/workspace'),T=require('../lib/tools');
  const report={protocol:'dt.person-paths/v1',model:model.model,cases:[],limits:['Actual Joern retained-CPG comparisons of independently graded model edits.','Static facts, CFG candidates and data paths are not runtime behavior proof; SQL/JDBC/dispatch gaps remain explicit.']};
  const scrub=s=>String(s).replaceAll(home,'<evaluation>').replaceAll(fs.realpathSync(home),'<evaluation>').replaceAll(os.homedir(),'<user-home>');
  const save=()=>fs.writeFileSync(output,scrub(JSON.stringify(report,null,2))+'\n');
  const call=async(name,a)=>{let r=await T.call(name,{...a,format:'full',waitMs:30000});for(let n=0;r.state==='running'&&n<30;n++)r=await T.call(name,{job:r.job,format:'full',waitMs:30000});if(r.state!=='done'||r.error)throw Error(JSON.stringify(r));return r;};
  try{
    if(!cases.length||cases.some(id=>!F.validCase(id)))throw Error('Select known nonempty mutation cases');
    for(const id of cases){
      const trial=model.cases.find(c=>c.mutation===id&&c.passed&&c.patch);if(!trial)throw Error('No independently passing model patch for '+id);
      const source=path.join(home,'source-'+id.replaceAll('+','-'));E.seed(source);F.mutate(source,id);
      for(const a of [['init','-q','-b','main'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','-qm','Person fault']]){const r=spawnSync('git',a,{cwd:source,encoding:'utf8'});if(r.status)throw Error(r.stderr);}
      const ws=await W.open({project:'DEMO',repo:'person-'+id.replaceAll('+','-'),ref:'main',url:source}),root=W.checkId(ws.id).path;
      const before=(await call('semantic_index',{repo:'work/'+ws.id,language:'java'})).analyses[0];
      const patch=spawnSync('git',['apply','--include=src/main/java/person/*.java','-'],{cwd:root,input:trial.patch.replace(/\n?$/,'\n'),encoding:'utf8'});if(patch.status)throw Error(patch.stderr);W.touch(ws.id,{dirty:true});
      if(F.sourceDigest(root)!==trial.after.sourceDigest)throw Error('Model patch source digest differs from the graded candidate');
      const after=(await call('semantic_index',{repo:'work/'+ws.id,language:'java'})).analyses[0];
      const trace=await call('semantic_trace',{analyses:[before.id,after.id],from:{kind:'method',name:'person',file:F.BASE+'PersonController.java',parameter:'id'},to:{kind:'call',name:'response',file:F.BASE+'PersonController.java',argument:2},includeContext:true,maxPaths:3,budgetMs:15000});
      const compact=await T.call('semantic_trace',{job:trace.job,max_output_bytes:8192});
      report.cases.push({mutation:id,before,after,trace,compact,compactBytes:Buffer.byteLength(JSON.stringify(compact)),behavior:{checked:trial.after.checked,sourceDigest:trial.after.sourceDigest,passed:trial.after.passed},contextChanges:trace.contextChanges.length});
      console.error(id+': '+trace.contextChanges.length+' changed source facts, '+Buffer.byteLength(JSON.stringify(compact))+' bytes');save();
    }
    report.passed=report.cases.every(c=>c.contextChanges>0&&c.compactBytes<=8192&&c.trace.proof.behaviorVerified===false);save();return report;
  }finally{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module){const args=process.argv.slice(2),o={};for(let n=0;n<args.length;n+=2){const key={'--evaluation':'evaluation','--semantic-url':'url','--semantic-token':'token','--output':'output','--cases':'cases'}[args[n]];if(!key||!args[n+1])throw Error('Unknown/missing option '+args[n]);o[key]=key==='cases'?args[n+1].split(','):args[n+1];}if(!o.evaluation||!o.url||!o.token)throw Error('Supply evaluation, semantic-url and semantic-token');run(o).then(r=>{console.log(JSON.stringify({passed:r.passed,cases:r.cases.map(c=>({id:c.mutation,changes:c.contextChanges,bytes:c.compactBytes}))}));process.exitCode=r.passed?0:1;}).catch(e=>{console.error(e.message);process.exitCode=1;});}
