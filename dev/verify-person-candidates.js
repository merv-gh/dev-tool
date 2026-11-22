#!/usr/bin/env node
// Fresh seeds and clock dates, with no additional model calls or repair feedback.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const F=require('./person-mutations'),E=require('./eval-person-mutations'),R=require('./person-runtime');
async function run(o){
  if(!o.replay)throw Error('Supply --replay <model evaluation>');
  const raw=fs.readFileSync(o.replay,'utf8'),model=JSON.parse(raw);if(model.protocol!=='dt.person-mutations/v1')throw Error('Expected a person mutation model report');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-person-holdout-')),data=F.dataset(o.seed,o.copies),out=path.resolve(o.output),controller=new AbortController();
  const cancel=()=>controller.abort(Error('Holdout verification cancelled')),timer=setTimeout(()=>controller.abort(Error('Holdout duration budget reached')),o.maxDurationMs);timer.unref();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  const report={protocol:'dt.person-holdout/v1',parentSha256:crypto.createHash('sha256').update(raw).digest('hex'),model:model.model,seed:o.seed,copies:o.copies,cases:[],noModelCalls:true,limits:['Additional finite data/date checks, not exhaustive production correctness.','Replays exact model Java edits; no oracle, test or build edits and no further repair feedback.']};
  fs.mkdirSync(path.dirname(out),{recursive:true});const scrub=s=>String(s).replaceAll(root,'<holdout>').replaceAll(fs.realpathSync(root),'<holdout>').replaceAll(os.homedir(),'<user-home>');const save=()=>fs.writeFileSync(out,scrub(JSON.stringify(report,null,2))+'\n');let runtime;
  try{
    const selected=o.cases?o.cases.split(','):model.cases.map(c=>c.mutation);if(!selected.length||selected.some(id=>!F.validCase(id)))throw Error('Replay requires known nonempty mutation cases');
    runtime=await R.create({...o,data,signal:controller.signal});
    for(const id of selected){
      controller.signal.throwIfAborted();const original=model.cases.find(c=>c.mutation===id),trial={mutation:id,sweeps:[]};report.cases.push(trial);
      if(!original?.passed||!original.patch){trial.passed=false;trial.error='No independently passing model patch';save();continue;}
      const dir=path.join(root,id.replaceAll('+','-'));E.seed(dir);F.mutate(dir,id);spawnSync('git',['init','-q'],{cwd:dir});
      const patch=spawnSync('git',['apply','--include=src/main/java/person/*.java','-'],{cwd:dir,input:original.patch.replace(/\n?$/,'\n'),encoding:'utf8'});if(patch.status)throw Error(patch.stderr);
      if(F.sourceDigest(dir)!==original.after.sourceDigest)throw Error('Replayed source differs from graded candidate');
      for(const offset of [-2,0,2]){
        const asOf=new Date(Date.parse(data.asOf+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10),sweep={...data,asOf,cases:data.people.map(p=>({id:p.id,expected:F.reference(p,data.documents,asOf)}))};
        const result=await runtime.grade(dir,sweep);trial.sweeps.push({asOf,...result});save();
      }
      trial.passed=trial.sweeps.every(s=>s.passed);trial.checked=trial.sweeps.reduce((n,s)=>n+s.checked,0);console.error(id+': '+trial.passed+' ('+trial.checked+' fresh-date HTTP checks)');save();
    }
    report.passed=report.cases.every(c=>c.passed);return report;
  }catch(e){report.error=scrub(e.message);report.passed=false;throw e;}
  finally{try{await runtime?.close();report.cleanup={verified:true};}catch(e){report.cleanup={verified:false,error:scrub(e.message)};report.passed=false;}save();fs.rmSync(root,{recursive:true,force:true});clearTimeout(timer);process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
module.exports={run};if(require.main===module)run(E.options(process.argv.slice(2))).then(r=>{console.log(JSON.stringify({passed:r.passed,cases:r.cases.length,checks:r.cases.reduce((n,c)=>n+(c.checked||0),0),cleanup:r.cleanup}));process.exitCode=r.passed?0:1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
