#!/usr/bin/env node
// Supplemental user-request probes. Metadata/argument-routing proof only, never a live test verdict.
const fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-request-probe-'));
process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_REPOS_DIR','DT_TOOLS'])delete process.env[k];
const put=(p,v)=>{const f=path.join(home,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v));};
put('config.json',{envs:{dev:{postgres:{orders:'postgres://fixture@127.0.0.1:1/orders'}},staging:{}},tests:{waitMs:1}});
const calls=[];
(async()=>{
 const T=require('../lib/tools');
 const call=async(name,args)=>{const t=performance.now();const r=await T.call('tool_execute',{name,arguments:args});calls.push({name,arguments:args,ms:+(performance.now()-t).toFixed(3),outputBytes:Buffer.byteLength(JSON.stringify(r))});return r;};
 const table={schema:'public',name:'orders',kind:'table',columns:[{name:'id',type:'bigint'},{name:'status',type:'text'},{name:'total',type:'numeric'}],constraints:[]};
 const fn=(name,body)=>({schema:'public',name,kind:'function',lang:'sql',arguments:'',returns:'text',body});
 put('cache/dev/pg/orders.json',{db:'orders',database:'orders',syncedAt:'2026-01-01',tables:[table],functions:[fn('read_status','select status from public.orders'),fn('write_status',"update public.orders set status = 'PAID' returning id"),fn('read_total','select total from public.orders')],viewDeps:[],triggers:[]});
 require('../lib/pgindex').build('dev');
 const byColumn=await call('pg_usage',{name:'orders:public.orders.status',env:'dev'}),byTable=await call('pg_usage',{name:'orders:public.orders',env:'dev'}),impact=await call('impact',{target:'public.orders.status',env:'dev'});
 put('cache/dev/es/orders.json',{index:'orders',mapping:{properties:{id:{type:'keyword'}}}});
 const fixture=await call('fixture_plan',{env:'dev',seeds:[{db:'orders',table:'public.orders',where:{id:42}}],es:[{index:'orders',matches:[{path:'_source.id',from:{db:'orders',table:'public.orders',column:'id'}}]}]});
 let unknownRejected=false;try{await call('fixture_plan',{env:'dev',seeds:[{db:'orders',table:'public.orders',where:{id:42}}],unsupportedSource:[]});}catch(e){unknownRejected=/unknown|unsupported/i.test(e.message);}
 const fixtureDescription=await T.call('tool_describe',{name:'fixture_plan'}),stateDescription=await T.call('tool_describe',{name:'scenario_state_plan'}),testDescription=await T.call('tool_describe',{name:'test_run'});
 const runner=require('../lib/testrun'),original=runner.run,seen=[],finishes=[];
 const result={workspace:'routing-probe',outcome:'routing-probe',counts:{tests:0,passed:0,failed:0,errors:0,skipped:0},mode:'probe',ms:0,cases:[],compile:[],parts:[],hints:[],tail:'Not an application execution.'};
 runner.run=async(workspace,options)=>{seen.push({workspace,options:{...options,log:undefined}});return new Promise(resolve=>{finishes.push(()=>resolve(result));});};
 let first,second,envOnly;
 try {
   first=await call('test_run',{workspace:'routing-probe',tests:['ProbeTest'],env:'dev',db:'orders'});
   second=await call('test_run',{workspace:'routing-probe',tests:['ProbeTest'],env:'staging',db:'another-database'});
   for(const finish of finishes.splice(0))finish();await Promise.all([first.job,second.job].map(id=>require('../lib/jobs').find(id).promise));
   envOnly=await call('test_run',{workspace:'routing-probe',tests:['EnvOnlyTest'],env:'dev'});
   for(const finish of finishes.splice(0))finish();await require('../lib/jobs').find(envOnly.job).promise;
 } finally {runner.run=original;}
 const rows=byTable.preview||byTable.rows||[],columnRows=byColumn.preview||byColumn.rows||[],envOnlyOptions=seen.at(-1)?.options;
 const observations={
  columnAccess:{proof:'executed-cached-index-tools',columnUsageTotal:byColumn.total,tableUsageTotal:byTable.total,tableUsers:rows.map(r=>({user:r.user,role:r.role})),columnUsers:columnRows.map(r=>({user:r.user,access:r.access||r.role})),columnImpact:impact.nearest||[],coverage:byColumn.coverage,exhaustiveStaticClaim:false,gap:!columnRows.some(r=>r.user==='public.read_status'&&(r.access||r.role)==='read')||!columnRows.some(r=>r.user==='public.write_status'&&(r.access||r.role)==='write')||columnRows.some(r=>r.user==='public.read_total')},
  relatedEsState:{proof:'executed-tool-plan-only-not-native-runtime',fixtureInputHasEs:Object.hasOwn(fixtureDescription.inputSchema.properties,'es'),unsupportedInputRejected:unknownRejected,plannedStateKinds:[...new Set((fixture.obligations||[]).map(o=>o.kind))],esPreserved:fixture.es?.[0]?.index==='orders',gaps:fixture.gaps,scenarioStatePlanAvailable:!!stateDescription.inputSchema.properties.inventory,gap:!unknownRejected||fixture.es?.[0]?.index!=='orders'||!(fixture.obligations||[]).some(o=>o.kind==='es'&&o.id==='orders')},
  devTarget:{proof:'argument-routing-with-stubbed-project-runner',realProjectExecuted:false,hasTargetSelector:Object.hasOwn(testDescription.inputSchema.properties,'target'),envSchema:testDescription.inputSchema.properties.env.description,envOnlyForwardedDb:envOnlyOptions?.db,envOnlyForwardedTarget:envOnlyOptions?.target,sourceEnvironment:envOnlyOptions?.sourceEnv,explanation:'env=dev remains source context; the default actual target is explicitly local. Reviewed live-dev manifests are separate and fail closed. Actual Node target execution is verified by test/node-targets.test.js; this probe inspects routing only.',gap:!Object.hasOwn(testDescription.inputSchema.properties,'target')||envOnlyOptions?.db!==null||envOnlyOptions?.target!=='local'||envOnlyOptions?.sourceEnv!=='dev'},
  concurrentTestIdentity:{proof:'argument-routing-with-stubbed-project-runner',realProjectExecuted:false,firstJob:first.job,secondJob:second.job,executionsForDifferentEnvironments:seen.length-1,firstForwardedDb:seen[0]?.options.db,secondForwardedDb:seen[1]?.options.db,gap:first.job===second.job||seen.length!==3||seen[1]?.options.db?.db!=='another-database'}
 };
 console.log(JSON.stringify({protocol:'dt.user-request-readiness/v1',generatedAt:new Date().toISOString(),networkUsed:false,observations,calls},null,2));
 if(process.argv.includes('--assert-ready')&&Object.values(observations).some(x=>x.gap))process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=2;}).finally(()=>fs.rmSync(home,{recursive:true,force:true}));
