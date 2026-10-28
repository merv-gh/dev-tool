// Reusable test setup for one C06 workspace; application assertions belong to caller tests.
const fs=require('fs'),os=require('os'),path=require('path');
let runtime;
function setupRuntime(){
 if(runtime)return runtime;
 if(!process.env.DT_TEST_PG_URL)throw new Error('C06 test setup requires DT_TEST_PG_URL');
 const tool=process.env.DT_CHALLENGE_TOOL_ROOT||path.resolve(__dirname,'../..');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-case-tests-'));
 process.env.DT_HOME=home;
 for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_TEST_DB_URL'])delete process.env[key];
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tests:{pgUrl:process.env.DT_TEST_PG_URL}}));
 const DB=require(path.join(tool,'lib/testdb')),postgres=require(path.join(tool,'node_modules/postgres'));
 process.on('exit',()=>fs.rmSync(home,{recursive:true,force:true}));
 return runtime={DB,postgres};
}
async function withCaseDatabases(caseRoot,fn){
 const {DB,postgres}=setupRuntime();
 const created=[],connections=[],db={};
 try{
  await DB.initialize({label:'developer challenge test replay'});
  const fixture=JSON.parse(fs.readFileSync(path.join(caseRoot,'fixture.json')));
  for(const[name,statements]of Object.entries(fixture)){
   const info=await DB.create('challenge-test-'+name,statements);created.push(info.database);
   if(info.errors.length)throw new Error(JSON.stringify(info.errors));
   const url=new URL(process.env.DT_TEST_PG_URL);url.pathname='/'+info.database;
   db[name]=postgres(url.toString(),{max:1,onnotice:()=>{}});connections.push(db[name]);
  }
  return await fn(db);
 }finally{for(const c of connections)await c.end({timeout:2});for(const name of created.reverse())await DB.drop(name);}
}
module.exports={withCaseDatabases};
