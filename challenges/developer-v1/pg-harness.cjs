const fs=require('fs'),os=require('os'),path=require('path');
async function withDatabases(root, fn) {
  if(!process.env.DT_TEST_PG_URL) throw new Error('GAP: C06 requires DT_TEST_PG_URL');
  const dtRoot=process.env.DT_CHALLENGE_TOOL_ROOT || path.resolve(__dirname,'../..');
  // A separate process must set this before importing dt libraries.
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-case-pg-'));
  process.env.DT_HOME=home;
  for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_TEST_DB_URL'])delete process.env[key];
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tests:{pgUrl:process.env.DT_TEST_PG_URL}}));
  const DB=require(path.join(dtRoot,'lib/testdb'));
  const postgres=require(path.join(dtRoot,'node_modules/postgres'));
  const created=[],connections=[];
  try {
    await DB.initialize({label:'developer challenge disposable fixtures'});
    const db={};const fixture=JSON.parse(fs.readFileSync(path.join(root,'C06/fixture.json')));
    for(const [name,statements]of Object.entries(fixture)){
      const info=await DB.create('challenge-'+name,statements);created.push(info.database);
      if(info.errors.length)throw new Error(JSON.stringify(info.errors));
      const url=new URL(process.env.DT_TEST_PG_URL);url.pathname='/'+info.database;
      db[name]=postgres(url.toString(),{max:1,onnotice:()=>{}});connections.push(db[name]);
    }
    return await fn(db);
  }finally{
    for(const c of connections)await c.end({timeout:2});
    for(const name of created.reverse())await DB.drop(name);
    fs.rmSync(home,{recursive:true,force:true});
  }
}
module.exports={withDatabases};
