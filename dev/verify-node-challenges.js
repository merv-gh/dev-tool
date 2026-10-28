#!/usr/bin/env node
// Re-execute the frozen solver's seven Node cases through the public tool registry.
// Does not modify the frozen case pack. C06 requires an owned disposable DT_TEST_PG_URL.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const repo=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-node-challenges-'));
const pg=process.env.DT_TEST_PG_URL;
process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_BUILD_DIR','DT_RUNNER_URL','DT_TOOLS'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tests:{waitMs:50000,timeoutMs:120000,compileCheck:false,env:{DT_TEST_PG_URL:pg||'',DT_CHALLENGE_PG_HARNESS:path.join(repo,'challenges/developer-support-v1.1/pg-case.cjs'),DT_CHALLENGE_TOOL_ROOT:repo}}}));
const read=rel=>JSON.parse(fs.readFileSync(path.join(repo,rel),'utf8'));
(async()=>{
 const T=require('../lib/tools'),U=require('../lib/util');const cases=[];
 const call=(name,args)=>T.call('tool_execute',{name,arguments:args});
 for(const n of [1,2,4,5,6,7,8]){
  const id=`C${String(n).padStart(2,'0')}`,lower=id.toLowerCase(),root=path.join(home,'work',lower);
  if(n===6&&!pg){cases.push({id,outcome:'external-prerequisite',reason:'DT_TEST_PG_URL must be an owned disposable PostgreSQL'});continue;}
  fs.cpSync(path.join(repo,'challenges/developer-v1',id),root,{recursive:true});
  U.writeJson(path.join(home,'cache','work',`${lower}.json`),{id:lower,path:root,project:'CHALLENGE',repo:lower,sha:read('challenges/developer-v1/revision.json').sha256||'frozen-v1',createdAt:new Date().toISOString(),dirty:true});
  const regression=read(`proof/developer-challenge/${lower}-test.json`);delete regression.workspace;
  await call('workspace_write',{workspace:lower,...regression,check:false});
  const baseline=await call('test_run',{workspace:lower,tests:[regression.path],mode:'build'});
  const fixFile=path.join(repo,`proof/developer-challenge/${lower}-fix.json`);
  if(fs.existsSync(fixFile)){const fix=JSON.parse(fs.readFileSync(fixFile));delete fix.workspace;await call('workspace_write',{workspace:lower,...fix,check:false});}
  const fixed=await call('test_run',{workspace:lower,tests:[regression.path],mode:'build'});
  cases.push({id,baseline:{outcome:baseline.outcome,counts:baseline.counts},fixed:{outcome:fixed.outcome,counts:fixed.counts,execution:fixed.execution},proof:require('../lib/testrun').proof(lower),patchSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,`proof/developer-challenge/${lower}-test.json`))).digest('hex')});
 }
 const result={protocol:'dt.node-challenge-verification/v1',at:new Date().toISOString(),node:process.version,pack:read('challenges/developer-v1/revision.json'),proofType:'actual tool_execute → test_run → node:test',cases};
 console.log(JSON.stringify(result,null,2));if(cases.some(c=>c.fixed&&c.fixed.outcome!=='passed'))process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=2;}).finally(()=>fs.rmSync(home,{recursive:true,force:true}));
