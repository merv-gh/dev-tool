#!/usr/bin/env node
// Reproducible schedules over the production-profile evaluation harnesses.
// No query adapter, expected answer or automatic retry is added here.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),zlib=require('node:zlib');
function main(){
 const o={state:'',variants:'',transfer:'',output:'',endpoint:'http://127.0.0.1:11435',model:'qwen3.5:4b',profile:'direct',surface:'code',suite:'joint',label:'matrix',max_failures:'0',dry_run:'false'};
 for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!(k in o)||process.argv[i+1]===undefined)throw Error('Unknown/missing argument');o[k]=process.argv[i+1];}
 if(!o.state||!o.variants||!o.output||o.suite==='joint'&&!o.transfer)throw Error('--state, --variants, --output and (joint suite) --transfer required');
 if(!['joint','matched'].includes(o.suite)||!['code','hybrid','semantic'].includes(o.surface)||!/^[-a-z0-9]+$/i.test(o.label)||!/^\d+$/.test(o.max_failures)||!['true','false'].includes(o.dry_run))throw Error('Invalid suite/surface/label/max_failures/dry_run');
 const jobs=[];
 if(o.suite==='joint'){
  for(const fixture of ['allocation','drain','billing'])for(const seed of [7,42])jobs.push([fixture,'cycle',seed]);
  for(const fixture of ['allocation','drain','billing']){
   for(const seed of [7,42,99])jobs.push([fixture,'combined',seed]);
   for(const [kind,seed]of [['contradiction',99],['discover',42],['map',7],['trace',7]])jobs.push([fixture,kind,seed]);
  }
  for(const kind of ['combined','discover','contradiction','map','trace'])for(const seed of [7,42,99])jobs.push(['core',kind,seed]);
  for(const fixture of ['dispatch','quote'])for(const seed of [7,42,99])jobs.push([fixture,'combined',seed]);
 }else jobs.push(['core','combined',7],['core','discover',42],['core','contradiction',99],['dispatch','combined',42],['quote','combined',42]);
 for(const seed of [7,42,99])jobs.push(['core','aggregate',seed]);
 const plan=jobs.map(([fixture,kind,seed])=>{
  const home=['allocation','drain','billing'].includes(fixture)?o.transfer:o.variants;
  return {fixture,kind,seed,state:fixture==='core'?o.state:path.join(home,fixture+'-state.json'),scenario:fixture==='core'?null:path.join(home,fixture+'-scenario.json'),file:path.join(o.output,o.label+'-'+fixture+'-'+kind+'-'+seed+'.json.gz')};
 });
 if(o.dry_run==='true'){console.log(JSON.stringify({planned:plan.length,trials:plan},null,2));return;}
 for(const j of plan)if(fs.existsSync(j.file))throw Error('Refuse to overwrite '+j.file);
 fs.mkdirSync(o.output,{recursive:true});const trials=[];
 for(const j of plan){
  const args=['--endpoint',o.endpoint,'--model',o.model,'--profile',o.profile,'--surface',o.surface,'--state',j.state,'--seed',String(j.seed),'--output',j.file,...(j.scenario?['--scenario',j.scenario]:[]),...(j.kind==='aggregate'?[]:['--case',j.kind])];
  const child=cp.spawnSync(process.execPath,[path.join(__dirname,j.kind==='aggregate'?'eval-code-aggregation.cjs':'eval-code-navigation.cjs'),...args],{stdio:['ignore','ignore','inherit']});
  if(child.status!==0)throw Error('Harness failed for '+j.file+' (exit '+child.status+')');
  const r=JSON.parse(zlib.gunzipSync(fs.readFileSync(j.file)));if(!r.completedAt)throw Error('Trial did not complete');
  const trial={file:path.basename(j.file),passed:r.passed,strictPassed:r.strictPassed,calls:r.events.length,finish:r.finish};trials.push(trial);console.log(JSON.stringify(trial));
  const failures=trials.filter(t=>!t.passed).length;
  fs.writeFileSync(path.join(o.output,o.label+'-matrix.json'),JSON.stringify({planned:plan.length,completed:trials.length,passed:trials.length-failures,stoppedEarly:trials.length<plan.length,trials},null,2)+'\n');
  if(Number(o.max_failures)&&failures>=Number(o.max_failures))break;
 }
 if(trials.some(t=>!t.passed))process.exitCode=2;
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
