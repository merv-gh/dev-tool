// A dedicated, disposable scratch PostgreSQL only; never point this at an environment database.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-runtime-isolation-live-')),url=process.env.DT_TEST_PG_URL;
process.env.DT_HOME=home;process.env.DT_LOG='quiet';
for(const name of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR'])delete process.env[name];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tests:{pgUrl:url}}));
const DB=require('../lib/testdb'),T=require('../lib/testdb-templates'),A=require('../lib/access'),pg=require('postgres');
const skip=!url&&'set DT_TEST_PG_URL to a dedicated disposable scratch cluster';
const alice={principalId:'alice',storyId:'order-investigation',multiUser:true,role:'user'},bob={principalId:'bob',storyId:'order-investigation',multiUser:true,role:'user'};
async function query(binding,sql){const target=new URL(url);target.pathname='/'+binding.database;target.username=binding.user;target.password=binding.password;const c=pg(target.toString(),{max:1,connect_timeout:2,onnotice:()=>{}});try{return await c.unsafe(sql);}finally{await c.end({timeout:1});}}
test.before(async()=>{if(url)await DB.initialize({label:'multi-user runtime isolation tests'});});
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});

test('real scratch applications get private non-admin credentials and cannot reach another story database',{skip,timeout:30000},async()=>{
 let left,right;
 try{
  left=await A.run(alice,()=>DB.create('alice',['create table orders(id int primary key)','insert into orders values(1)']));
  right=await A.run(bob,()=>DB.create('bob',['create table orders(id int primary key)','insert into orders values(2)']));
  assert.notEqual(left.user,right.user);assert.notEqual(left.user,decodeURIComponent(new URL(url).username));
  const [role]=await query(left,'select rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user');assert.deepEqual({...role},{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
  await query(left,'insert into orders values(3)');assert.equal((await query(left,'select count(*)::int as n from orders'))[0].n,2);
  await assert.rejects(query({...left,database:right.database},'select * from orders'),/permission denied/);
  await assert.rejects(query(left,'create database another_database'),/permission denied/);
  await A.run(alice,()=>assert.rejects(DB.drop(right.database),e=>e.code==='DT_ACCESS_DENIED'));
  assert.equal((await query(right,'select id from orders'))[0].id,2);
  const resources=await A.run(alice,()=>DB.resources());assert.ok(resources.resources.some(r=>r.name===left.database));assert.ok(!resources.resources.some(r=>r.name===right.database));
 }finally{if(left)await A.run(alice,()=>DB.drop(left.database));if(right)await A.run(bob,()=>DB.drop(right.database));}
 if(left)await DB.withControl(async sql=>{const [role]=await sql`select rolname from pg_roles where rolname=${left.user}`;assert.equal(role,undefined);});
});

test('real durable clone credentials, idempotency and release stay scoped by principal plus story',{skip,timeout:30000},async()=>{
 const template=await T.build({policy:{purpose:'runtime-multi-user-v1'},databases:{orders:{statements:['create table orders(id int primary key)','insert into orders values(42)']}}});
 let left,right;
 try{
  left=await A.run(alice,()=>T.clone({template:template.id,idempotencyKey:'same-client-request'}));
  right=await A.run(bob,()=>T.clone({template:template.id,idempotencyKey:'same-client-request'}));assert.notEqual(left.lease,right.lease);
  const joined=await A.run(alice,()=>T.clone({template:template.id,idempotencyKey:'same-client-request'}));assert.equal(joined.lease,left.lease);assert.equal(joined.reused,true);
  for(const identity of [bob,{...alice,storyId:'another-story'}])await A.run(identity,async()=>{for(const action of [()=>T.lease(left.lease,{bindings:true}),()=>T.renew(left.lease,1000),()=>T.reset(left.lease),()=>T.release(left.lease)])await assert.rejects(action(),e=>e.code==='DT_ACCESS_DENIED');});
  const list=await A.run(bob,()=>T.list());assert.ok(list.leases.some(l=>l.lease===right.lease));assert.ok(!list.leases.some(l=>l.lease===left.lease));
  assert.equal((await query(left.databases.orders,'select id from orders'))[0].id,42);
 }finally{if(left)await A.run(alice,()=>T.release(left.lease));if(right)await A.run(bob,()=>T.release(right.lease));}
 await T.invalidate(template.id,'integration test complete');await T.gc({templateTtlMs:0});
});
