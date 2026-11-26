#!/usr/bin/env node
// Real held-out source fixtures and independent behavioral oracles. Expected
// answers stay in verifier files; model prompts receive only query selectors.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
async function main(){
  const o={state:'',home:'',output:''};
  for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'');if(!(k in o)||!process.argv[i+1])throw Error('Unknown/missing argument');o[k]=process.argv[i+1];}
  if(!o.state||!o.home||!o.output)throw Error('--state worker-private.json --home fresh-directory --output cases.json required');
  const worker=JSON.parse(fs.readFileSync(o.state));fs.mkdirSync(o.home,{recursive:true,mode:0o700});
  if(fs.existsSync(path.join(o.home,'fixture-cases.json')))throw Error('Prepared cases already exist; use their recorded state and scenario files');
  Object.assign(process.env,{DT_HOME:path.resolve(o.home),DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0'});
  for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_TOOLS','DT_SEMANTIC_URL','DT_SEMANTIC_TOKEN'])delete process.env[k];
  fs.writeFileSync(path.join(o.home,'config.json'),JSON.stringify({envs:{dev:{}},semantic:{url:worker.url,token:worker.token},tests:{compileCheck:false}}),{mode:0o600});
  const T=require('../lib/tools'),CI=require('../lib/codeindex'),cases=[];
  const git=(dir,...args)=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const settle=async(name,args)=>{let r=await T.call(name,{...args,all:true,waitMs:30000});while(r.state==='running')r=await T.call(name,{job:r.job,waitMs:30000,all:true});if(r.error)throw Error(JSON.stringify(r.error));return r;};
  const specs=[
    {key:'dispatch',language:'java',repo:'DEMO/dispatch-holdout',file:'DispatchService.java',entry:'plan',parameter:'lost',sink:'record',argument:3,predicate:'lost < 0 || lost > requested',expectedExpression:'usable',source:
'public class DispatchService {\n  public static class Store { int recorded; public void record(String warehouse, String unit, int units) { this.recorded = units; } }\n  private final Store store;\n  public DispatchService(Store store) { this.store = store; }\n  public int plan(String warehouse, int requested, int lost) {\n    if (warehouse == null || requested <= 0) throw new IllegalArgumentException("invalid request");\n    if (lost < 0 || lost > requested) throw new IllegalArgumentException("invalid loss");\n    int usable = requested - lost;\n    store.record(warehouse, "items", requested);\n    return usable;\n  }\n}\n',
     before:'store.record(warehouse, "items", requested)',after:'store.record(warehouse, "items", usable)'},
    {key:'quote',language:'js',repo:'DEMO/quote-holdout',file:'quote.js',entry:'quote',parameter:'discount',sink:'send',argument:1,predicate:'discount < 0',expectedExpression:'subtotal',source:
'let captured;\nconst store = { send(amount, recipient) { captured = {amount, recipient}; return amount; } };\nfunction quote(customer, total, discount) {\n  if (discount < 0) throw new Error("invalid discount");\n  const subtotal = total - discount;\n  return store.send(total, customer);\n}\nmodule.exports = {quote, last: () => captured};\n',
     before:'store.send(total, customer)',after:'store.send(subtotal, customer)'}
  ];
  try{
    for(const spec of specs){
      const sourceRoot=path.join(o.home,'source',spec.key);fs.mkdirSync(sourceRoot,{recursive:true});
      const file=path.join(sourceRoot,spec.file);
      if(fs.existsSync(path.join(sourceRoot,'.git')))throw Error('Source fixture already exists; inspect its state before preparing another run');
      fs.writeFileSync(file,spec.source);git(sourceRoot,'init','-q');git(sourceRoot,'config','user.name','DT fixture');git(sourceRoot,'config','user.email','dt-fixture@example.invalid');git(sourceRoot,'add','.');git(sourceRoot,'commit','-qm','before fix');
      const probeDir=path.join(o.home,'oracles',spec.key);fs.mkdirSync(probeDir,{recursive:true});
      const runOracle=()=>{
        if(spec.language==='java'){
          const probe=path.join(probeDir,'DispatchProbe.java'),classes=path.join(probeDir,'classes');fs.mkdirSync(classes,{recursive:true});
          fs.writeFileSync(probe,'public class DispatchProbe { public static void main(String[] args) { DispatchService.Store s = new DispatchService.Store(); int value = new DispatchService(s).plan("W", 11, 3); if(value != 8 || s.recorded != 8) throw new AssertionError("wrong persisted amount"); System.out.println("OK dispatch"); } }');
          cp.execFileSync('javac',['-d',classes,file,probe],{encoding:'utf8'});
          return cp.spawnSync('java',['-cp',classes,'DispatchProbe'],{encoding:'utf8'});
        }
        return cp.spawnSync(process.execPath,['-e','const assert=require("node:assert/strict"),m=require('+JSON.stringify(file)+'); assert.equal(m.quote("C",25,4),21);assert.equal(m.last().amount,21);console.log("OK quote");'],{encoding:'utf8'});
      };
      const before=runOracle();
      if(before.status!==1||!before.stderr.includes('AssertionError'))throw Error('Before oracle must fail an actual assertion, not compilation or setup: '+before.stderr);
      fs.writeFileSync(file,spec.source.replace(spec.before,spec.after));git(sourceRoot,'add','.');git(sourceRoot,'commit','-qm','persist transformed amount');
      const after=runOracle();if(after.status!==0)throw Error('Fixed oracle failed: '+after.stderr);
      const sha=git(sourceRoot,'rev-parse','HEAD'),index=CI.build(sourceRoot,spec.repo,{project:'DEMO',repo:spec.repo.split('/')[1],sha});
      const indexed=await settle('semantic_index',{revisionKey:index.revisionKey,language:spec.language}),analysis=indexed.analyses[0].id;
      const probe=await settle('what_happens_from',{analysis,entry:spec.entry,parameter:spec.parameter,sink:spec.sink,argument:spec.argument,assumptions:[{expression:spec.predicate,holds:false}]});
      const checks={oracleBeforeFails:before.status===1,oracleAfterPasses:after.status===0,mapRead:!!probe.entryMap?.flowMap?.nodes.length,dataPaths:probe.valueTrace?.sides?.some(s=>s.data.paths.length>0)===true,selectedArgument:probe.summary?.argumentExpression===spec.expectedExpression,guardMatched:probe.summary?.controlAssumptionStatus==='matches-assumptions',dataUnresolved:probe.summary?.dataAssumptionStatus==='unresolved',staticProofOnly:probe.summary?.behaviorVerified===false};
      const scenario={key:spec.key,entry:spec.entry,parameter:spec.parameter,sink:spec.sink,argument:spec.argument,predicate:spec.predicate,expectedExpression:spec.expectedExpression,repo:spec.repo,sha,language:spec.language,oracle:{beforeFailed:true,afterPassed:true,assertion:'persisted transformed amount',beforeStderr:before.stderr,afterStdout:after.stdout}};
      const stateFile=path.join(o.home,spec.key+'-state.json'),scenarioFile=path.join(o.home,spec.key+'-scenario.json'),probeFile=path.join(o.home,spec.key+'-probe.json');
      fs.writeFileSync(stateFile,JSON.stringify({...worker,traceHome:path.resolve(o.home),analysis},null,2),{mode:0o600});
      fs.writeFileSync(scenarioFile,JSON.stringify(scenario,null,2));fs.writeFileSync(probeFile,JSON.stringify(probe,null,2));
      cases.push({key:spec.key,analysis,stateFile,scenarioFile,probeFile,checks,ready:Object.values(checks).every(Boolean)});
      fs.writeFileSync(path.join(o.home,'fixture-cases.json'),JSON.stringify(cases,null,2));fs.writeFileSync(o.output,JSON.stringify(cases,null,2));
      console.log(JSON.stringify({key:spec.key,analysis,checks,ready:cases.at(-1).ready}));
    }
    if(cases.some(c=>!c.ready))process.exitCode=1;
  }finally{await require('../lib/isolate').stop();await require('../lib/state-store').close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
