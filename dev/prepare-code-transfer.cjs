#!/usr/bin/env node
// Additional transfer fixtures, written before their model trials.
// Oracles execute ordinary Java/JS; no model answer is supplied in a prompt.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repo=process.env.DT_EVAL_REPO||path.resolve(__dirname,'..');
async function main(){
 const o={state:'',home:'',output:''};
 for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!(k in o)||!process.argv[i+1])throw Error('Unknown/missing argument');o[k]=process.argv[i+1];}
 if(!o.state||!o.home||!o.output)throw Error('--state worker.json --home NEW_DIRECTORY --output cases.json required');
 const worker=JSON.parse(fs.readFileSync(o.state));fs.mkdirSync(o.home,{recursive:true,mode:0o700});
 if(fs.existsSync(path.join(o.home,'fixture-cases.json')))throw Error('Prepared fixtures already exist; do not overwrite');
 for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_TOOLS','DT_TOOL_PROFILE','DT_SEMANTIC_URL','DT_SEMANTIC_TOKEN'])delete process.env[k];
 Object.assign(process.env,{DT_HOME:path.resolve(o.home),DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0'});
 fs.writeFileSync(path.join(o.home,'config.json'),JSON.stringify({envs:{dev:{}},semantic:{url:worker.url,token:worker.token},tests:{compileCheck:false}}),{mode:0o600});
 const T=require(path.join(repo,'lib/tools')),CI=require(path.join(repo,'lib/codeindex'));
 const specs=[
 {key:'allocation',language:'java',repo:'DEMO/allocation-transfer',file:'AllocationService.java',entry:'allocate',parameter:'rejected',sink:'append',argument:4,predicate:'rejected < 0 || rejected > capacity',expectedExpression:'remaining',
 source:'public class AllocationService {\n public static class Store { int recorded; public void append(String batch, String warehouse, String unit, int units) { recorded=units; } }\n private final Store store;\n public AllocationService(Store store) { this.store=store; }\n public int allocate(String warehouse, int capacity, int rejected) {\n  if (rejected < 0 || rejected > capacity) throw new IllegalArgumentException("bad rejection");\n  int remaining=capacity;\n  remaining-=rejected;\n  store.append("batch", warehouse, "units", capacity);\n  return remaining;\n }\n}\n',
 before:'store.append("batch", warehouse, "units", capacity)',after:'store.append("batch", warehouse, "units", remaining)',
 oracleClass:'AllocationProbe',oracleJava:'public class AllocationProbe { public static void main(String[] args) { AllocationService.Store s=new AllocationService.Store(); int n=new AllocationService(s).allocate("WH",17,5); if(n!=12 || s.recorded!=12)throw new AssertionError("wrong allocation"); System.out.println("OK allocation"); } }'},
{"key":"drain","language":"java","repo":"DEMO/drain-transfer","file":"DrainService.java","entry":"drain","parameter":"amount","sink":"commit","argument":1,"predicate":"amount < 0","expectedExpression":"rest","source":"public class DrainService {\n public static class Store { int recorded=-1; public void commit(int value) { recorded=value; } }\n private final Store store;\n public DrainService(Store store) { this.store=store; }\n public int drain(int amount) {\n  if (amount < 0) throw new IllegalArgumentException(\"negative amount\");\n  int rest=amount;\n  while (rest > 0) { rest--; }\n  store.commit(amount);\n  return rest;\n }\n}\n","before":"store.commit(amount)","after":"store.commit(rest)","oracleClass":"DrainProbe","oracleJava":"public class DrainProbe { public static void main(String[] args) { DrainService.Store s=new DrainService.Store(); int value=new DrainService(s).drain(3); if(value!=0 || s.recorded!=0)throw new AssertionError(\"wrong drained value\"); System.out.println(\"OK drain\"); } }"},
 {key:'billing',language:'js',repo:'DEMO/billing-transfer',file:'billing.js',entry:'invoice',parameter:'fee',sink:'publish',argument:2,predicate:'fee > total',expectedExpression:'net',
 source:'let captured;\nconst transport={publish(recipient,amount,event){captured={recipient,amount,event};return amount;}};\nfunction invoice(customer,total,fee){\n if(fee > total) throw new Error("fee exceeds total");\n let net=total;\n net-=fee;\n return transport.publish(customer,total,"invoice");\n}\nmodule.exports={invoice,last:()=>captured};\n',
 before:'transport.publish(customer,total,"invoice")',after:'transport.publish(customer,net,"invoice")',
 oracleJS:'const assert=require("node:assert/strict"),m=require(FILE);assert.equal(m.invoice("acct",37,6),31);assert.equal(m.last().amount,31);assert.equal(m.last().event,"invoice");console.log("OK billing");'}
 ];
 const git=(dir,...args)=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),cases=[];
 const settle=async(name,args)=>{let r=await T.call(name,{...args,all:true,waitMs:30000});for(let n=0;r.state==='running'&&n<30;n++)r=await T.call(name,{job:r.job,all:true,waitMs:30000});if(r.error||r.state==='running')throw Error('Fixture query failed');return r;};
 try{
 for(const spec of specs){
  const dir=path.join(o.home,'source',spec.key);fs.mkdirSync(dir,{recursive:true});if(fs.existsSync(path.join(dir,'.git')))throw Error('Source already exists');
  const file=path.join(dir,spec.file);fs.writeFileSync(file,spec.source);git(dir,'init','-q');git(dir,'config','user.name','DT transfer fixture');git(dir,'config','user.email','dt-fixture@example.invalid');git(dir,'add','.');git(dir,'commit','-qm','before fix');
  const oracleDir=path.join(o.home,'oracles',spec.key);fs.mkdirSync(oracleDir,{recursive:true});
  const oracle=()=>{if(spec.language==='js')return cp.spawnSync(process.execPath,['-e',spec.oracleJS.replace('FILE',JSON.stringify(file))],{encoding:'utf8'});
   const probe=path.join(oracleDir,spec.oracleClass+'.java'),classes=path.join(oracleDir,'classes');fs.mkdirSync(classes,{recursive:true});fs.writeFileSync(probe,spec.oracleJava);cp.execFileSync('javac',['-d',classes,file,probe],{encoding:'utf8'});return cp.spawnSync('java',['-cp',classes,spec.oracleClass],{encoding:'utf8'});};
  const before=oracle();if(before.status!==1||!before.stderr.includes('AssertionError'))throw Error('Before must fail an assertion');
  if(spec.source.split(spec.before).length!==2)throw Error('Patch anchor not unique');fs.writeFileSync(file,spec.source.replace(spec.before,spec.after));git(dir,'add','.');git(dir,'commit','-qm','persist computed value');const after=oracle();if(after.status!==0)throw Error('After oracle failed');
  const sha=git(dir,'rev-parse','HEAD'),index=CI.build(dir,spec.repo,{project:'DEMO',repo:spec.key+'-transfer',sha}),indexed=await settle('semantic_index',{revisionKey:index.revisionKey,language:spec.language}),analysis=indexed.analyses[0].id;
  const probe=await settle('what_happens_from',{analysis,entry:spec.entry,parameter:spec.parameter,sink:spec.sink,argument:spec.argument,assumptions:[{expression:spec.predicate,holds:false}]});
  const checks={beforeAssertionFailed:before.status===1,afterPassed:after.status===0,mapRead:!!probe.entryMap?.flowMap?.nodes.length,dataPaths:probe.valueTrace?.sides?.some(s=>s.data.paths.length>0)===true,expression:probe.summary?.argumentExpression===spec.expectedExpression,control:probe.summary?.controlAssumptionStatus==='matches-assumptions',data:probe.summary?.dataAssumptionStatus==='unresolved',staticOnly:probe.summary?.behaviorVerified===false};
  const scenario={key:spec.key,entry:spec.entry,parameter:spec.parameter,sink:spec.sink,argument:spec.argument,predicate:spec.predicate,expectedExpression:spec.expectedExpression,repo:spec.repo,sha,language:spec.language,oracle:{beforeFailed:true,afterPassed:true,beforeStderr:before.stderr,afterStdout:after.stdout}};
  const stateFile=path.join(o.home,spec.key+'-state.json'),scenarioFile=path.join(o.home,spec.key+'-scenario.json'),probeFile=path.join(o.home,spec.key+'-probe.json');
  fs.writeFileSync(stateFile,JSON.stringify({...worker,traceHome:path.resolve(o.home),analysis},null,2),{mode:0o600});fs.writeFileSync(scenarioFile,JSON.stringify(scenario,null,2));fs.writeFileSync(probeFile,JSON.stringify(probe,null,2));
  cases.push({key:spec.key,analysis,stateFile,scenarioFile,probeFile,checks,ready:Object.values(checks).every(Boolean)});fs.writeFileSync(path.join(o.home,'fixture-cases.json'),JSON.stringify(cases,null,2));fs.writeFileSync(o.output,JSON.stringify(cases,null,2));console.log(JSON.stringify({key:spec.key,checks,ready:cases.at(-1).ready}));
 }
 if(cases.some(c=>!c.ready))process.exitCode=1;
 }finally{await require(path.join(repo,'lib/isolate')).stop();await require(path.join(repo,'lib/state-store')).close();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
