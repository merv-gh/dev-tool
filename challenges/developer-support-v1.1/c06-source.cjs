// Environment provisioning only. Application fixture contents are frozen developer-v1 inputs.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dest=path.resolve(process.argv[3]||'');
const setup=require(path.join(dest,'setup.json'));
const TOOL=process.env.DT_CHALLENGE_TOOL_ROOT||setup.dtRoot;
process.env.DT_HOME=setup.home;process.env.DT_RATE_PER_SEC='0';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_REPOS_DIR','DT_TEST_DB_URL'])delete process.env[k];
const stateFile=path.join(dest,'c06-source-state.json');
const configFile=path.join(setup.home,'config.json');
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');
async function main(){
 const cfg=JSON.parse(fs.readFileSync(configFile));
 const control=process.env.DT_TEST_PG_URL||cfg.tests?.pgUrl;
 if(!control)throw new Error('DT_TEST_PG_URL must name an isolated disposable scratch control DB');
 cfg.tests={...cfg.tests,pgUrl:control};write(configFile,cfg);
 const DB=require(path.join(TOOL,'lib/testdb'));
 const postgres=require(path.join(TOOL,'node_modules/postgres'));
 if(process.argv[2]==='create'){
  if(fs.existsSync(stateFile))throw new Error('persistent source already registered; clean it before recreating');
  await DB.initialize({label:'developer challenge solver scratch'});
  const role='challenge_read_'+crypto.randomBytes(5).toString('hex');
  const password=crypto.randomBytes(18).toString('hex');
  const admin=postgres(control,{max:1,onnotice:()=>{}}),owned=[];
  try{
   await admin.unsafe(`create role "${role}" login password '${password}'`);
   const sources={};
   const fixture=require(path.join(dest,'C06/fixture.json'));
   for(const[name,statements]of Object.entries(fixture)){
    const info=await DB.create('challenge-public-source-'+name,statements);owned.push(info.database);
    if(info.errors.length)throw new Error(JSON.stringify(info.errors));
    const u=new URL(control);u.pathname='/'+info.database;
    const a=postgres(u.toString(),{max:1,onnotice:()=>{}});
    try{await a.unsafe(`grant connect on database "${info.database}" to "${role}"`);for(const schema of name==='orders'?['sales']:['risk','pay'])await a.unsafe(`grant usage on schema "${schema}" to "${role}";grant select on all tables in schema "${schema}" to "${role}"`);}
    finally{await a.end({timeout:2});}
    u.username=role;u.password=password;sources[name]=u.toString();
   }
   cfg.envs={...cfg.envs,fixture:{postgres:sources}};write(configFile,cfg);require(path.join(TOOL,'lib/config')).reload();
   const indexed=await require(path.join(TOOL,'lib/pg')).sync('fixture',{log:()=>{}});
   require(path.join(TOOL,'lib/catalog')).build('fixture');
   write(stateFile,{version:1,role,databases:owned,env:'fixture',sourceReadOnly:true,controlDatabase:new URL(control).pathname.slice(1)});
   console.log(JSON.stringify({stateFile,env:'fixture',sourceReadOnly:true,indexed: indexed.map(x=>({db:x.db,error:x.error})),home:setup.home,note:'No source writes: fixture env uses a SELECT-only role; tests.pgUrl is separate scratch control. Use fixture_capture/replay for writable tests.'},null,2));
  }catch(e){for(const name of owned.reverse())await DB.drop(name).catch(()=>{});await admin.unsafe(`drop role if exists "${role}"`).catch(()=>{});throw e;}
  finally{await admin.end({timeout:2});}
 }else if(process.argv[2]==='cleanup'){
  const state=require(stateFile);for(const name of state.databases.reverse())await DB.drop(name);
  const admin=postgres(control,{max:1,onnotice:()=>{}});try{await admin.unsafe(`drop role "${state.role}"`);}finally{await admin.end({timeout:2});}
  delete cfg.envs[state.env];write(configFile,cfg);fs.rmSync(stateFile);console.log(JSON.stringify({cleaned:true}));
 }else throw new Error('use create|cleanup <prepared-directory>');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
