const fs=require('fs'),path=require('path');
const prepared=path.resolve(process.argv[2]||'');const s=require(path.join(prepared,'setup.json'));const cfg=require(path.join(s.home,'config.json'));
const TOOL=process.env.DT_CHALLENGE_TOOL_ROOT||s.dtRoot;
process.env.DT_HOME=s.home;process.env.DT_RATE_PER_SEC='0';for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_REPOS_DIR','DT_TEST_DB_URL'])delete process.env[key];
(async()=>{
 const state=require(path.join(prepared,'c06-source-state.json'));const DB=require(path.join(TOOL,'lib/testdb'));
 const registered=await DB.resources();const owned=new Set(registered.resources.map(r=>r.name));for(const n of state.databases)if(!owned.has(n))throw new Error('source no longer owned by the challenge setup');
 const source=cfg.envs.fixture.postgres.orders;const database=new URL(source).pathname.slice(1);if(!state.databases.includes(database))throw new Error('fixture source identity mismatch');
 const errors=await DB.runStatements(database,[fs.readFileSync(path.join(__dirname,'source.sql'),'utf8')]);if(errors.length)throw new Error(JSON.stringify(errors));
 await DB.runStatements(database,[`grant select on all tables in schema sales to "${state.role}"`]);
 const PG=require(path.join(TOOL,'lib/pg'));const indexed=await PG.sync('fixture',{log:()=>{}});
 const cache=path.join(s.home,'cache/fixture');for(const sys of ['es','kafka'])fs.mkdirSync(path.join(cache,sys),{recursive:true});
 const evidence=require('./es/orders-read-model.json');fs.writeFileSync(path.join(cache,'es/orders-read-model.json'),JSON.stringify({index:evidence.index,docs:evidence.documents.length,aliases:[],fields:evidence.mapping,provenance:evidence.provenance},null,2));
 fs.writeFileSync(path.join(cache,'kafka/orders.paid.json'),JSON.stringify({topic:'orders.paid',fields:{tenantId:'string',orderId:'string',type:'string',amount:'string'},keySchema:{type:'JSON',schema:{type:'object',properties:{tenantId:{type:'string'},orderId:{type:'string'}}}},valueSchema:{type:'JSON',schema:{type:'object',properties:{tenantId:{type:'string'},orderId:{type:'string'},amount:{type:'string'},type:{type:'string'}}}},provenance:'saved synthetic public evidence; no live broker configured'},null,2));
 require(path.join(TOOL,'lib/codeindex')).build(__dirname,'CASES/order-projection',{project:'CASES',repo:'order-projection',ref:'supplement-v1.2'});
 require(path.join(TOOL,'lib/catalog')).build('fixture');
 console.log(JSON.stringify({provisioned:true,env:'fixture',repositoryIndex:'CASES/order-projection',column:'sales.orders.amount',indexed:indexed.map(x=>({db:x.db,error:x.error})),esKafka:'saved evidence and cached schemas only; no live engines configured'},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
