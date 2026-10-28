#!/usr/bin/env node
// Dedicated scratch only. Counts separately measure fresh loads, one immutable preparation and
// private-copy allocation; no test/JVM timings are mixed in. Removes only its own resources.
const fs = require('fs'), os = require('os'), path = require('path');
const url = process.env.DT_TEST_PG_URL;
if (!url) throw new Error('set DT_TEST_PG_URL to a dedicated scratch PostgreSQL');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const sizes = (arg('rows') || '100,1000').split(',').map(Number), iterations = Number(arg('iterations') || 3);
if (sizes.some(n => !Number.isInteger(n) || n < 1 || n > 50000) || !Number.isInteger(iterations) || iterations < 2 || iterations > 20) throw new Error('rows 1..50000, iterations 2..20');
const home = fs.mkdtempSync(path.join(os.tmpdir(),'dt-template-bench-'));
process.env.DT_HOME = home;
for (const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR']) delete process.env[key];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{scratch:{postgres:{}}},tests:{pgUrl:url}}));
const D=require('../lib/testdb'),T=require('../lib/testdb-templates');
const percentile = (values,p) => [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const summary = ms => ({ n:ms.length, p50:percentile(ms,.5),p95:percentile(ms,.95), samples:ms });
(async()=>{
  await D.initialize({label:'explicit PostgreSQL benchmark scratch'});
  const result={version:1,benchmark:'postgres-fixture-cold-vs-warm',at:new Date().toISOString(),hardware:{platform:process.platform,arch:process.arch,cpus:os.cpus().length,totalMemoryBytes:os.totalmem()},concurrency:1,databasesPerIteration:2,iterations,tiers:[]};
  result.postgresql=await D.withControl(async sql=>{const[v]=await sql`select version() as version,current_setting('server_version_num') as versionNumber,current_setting('shared_buffers') as sharedBuffers,current_setting('fsync') as fsync`;return v;});
  for(const rows of sizes){
    const statements=['create table entity(id bigint primary key, amount numeric(16,6), payload text)',...Array.from({length:rows},(_,i)=>`insert into entity values(${i+1},42.123456,repeat('test-payload-',8))`)];
    const spec={policy:{benchmark:'v1'},databases:{commerce:{statements},risk:{statements}}};
    const cold=[],warm=[],reset=[];let template;
    for(let i=0;i<iterations;i++){
      const created=[],started=Date.now();
      try{for(const name of ['commerce','risk'])created.push(await D.create(`benchmark-${name}`,statements));cold.push(Date.now()-started);}finally{for(const d of created)await D.drop(d.database);}
    }
    try{
      template=await T.build(spec);
      for(let i=0;i<iterations;i++){
        const started=Date.now();let copy=await T.clone({template:template.id});warm.push(Date.now()-started);
        try{const resetStart=Date.now();copy=await T.reset(copy.lease);reset.push(Date.now()-resetStart);}finally{await copy.cleanup();}
      }
      result.tiers.push({rowsPerDatabase:rows,statementsPerDatabase:statements.length,templateBuildMs:template.timings.buildMs,coldLoadMs:summary(cold),warmCloneMs:summary(warm),resetIncludingOldDropMs:summary(reset),bytes:Object.values(template.databases).reduce((n,d)=>n+Number(d.bytes),0)});
    }finally{if(template){await T.invalidate(template.id,'benchmark complete');await T.gc({templateTtlMs:604800000});}}
  }
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(home,{recursive:true,force:true}));
