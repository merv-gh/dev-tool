const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-resource-isolation-'));
process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';process.env.DT_STATE_BACKEND='legacy';
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR'])delete process.env[key];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tests:{}}));
const A=require('../lib/access'),DB=require('../lib/testdb'),T=require('../lib/testdb-templates'),owner=A.normalize({principalId:'alice',storyId:'investigation',multiUser:true}),other=A.normalize({principalId:'bob',storyId:'investigation',multiUser:true});
const row={id:'a'.repeat(32),state:'active',expires_at:new Date(Date.now()+600000),details:{owner,template:'b'.repeat(64),role:{name:'dt_app_owned',password:'private'},databases:{orders:{database:'dt_test_owned',user:'dt_app_owned',password:'private'}}}};
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});

test('guessed durable leases cannot disclose bindings or mutate another principal/story',async()=>{
 const original=DB.withControl,queries=[];
 DB.withControl=async fn=>fn({unsafe:async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('select * from dt_test_control.leases'))return[row];throw Error('mutation reached');}}, {cluster_id:'cluster'});
 try{
  await A.run(owner,async()=>{const result=await T.lease(row.id,{bindings:true});assert.equal(result.databases.orders.password,'private');});
  for(const identity of [other,A.normalize({...owner,storyId:'another'})])await A.run(identity,async()=>{
   for(const call of [()=>T.lease(row.id,{bindings:true}),()=>T.renew(row.id,1000),()=>T.reset(row.id),()=>T.release(row.id)])await assert.rejects(call(),e=>e.code==='DT_ACCESS_DENIED');
  });
  assert.equal(queries.some(q=>/^(update|delete|drop|create)/i.test(q.sql)),false);
 }finally{DB.withControl=original;}
});

test('scratch resource ownership is checked before inspecting or dropping a physical database',async()=>{
 let reached=false;
 const sql=()=>{reached=true;throw Error('physical database reached');};sql.unsafe=async()=>[{name:'dt_test_owned',cluster_id:'cluster',resource_id:'resource',details:{owner}}];
 await A.run(other,()=>assert.rejects(DB.ownedDrop(sql,{cluster_id:'cluster'},'dt_test_owned'),e=>e.code==='DT_ACCESS_DENIED'));
 assert.equal(reached,false);
});

test('lease list queries filter before paging and totals are scoped',async()=>{
 const original=DB.withControl,queries=[];
 DB.withControl=async fn=>fn({unsafe:async(sql,args)=>{queries.push({sql,args});if(sql.includes('as total'))return[{total:0}];if(sql.includes('as templates'))return[{templates:0,leases:0}];return[];}},{cluster_id:'cluster'});
 try{await A.run(owner,async()=>{assert.equal((await T.list({limit:2,offset:1})).totalLeases,0);});
  for(const query of queries.filter(q=>/from dt_test_control\.(resources|leases)/.test(q.sql))) {assert.match(query.sql,/coalesce\(details->'owner'->>'scopeKey','legacy'\)=\$/);assert.ok(query.args.includes(owner.scopeKey));}
 }finally{DB.withControl=original;}
});

test('global template retention/invalidation requires an operator before connecting',async()=>{
 await A.run(owner,async()=>{await assert.rejects(T.pin('b'.repeat(64),true),e=>e.code==='DT_ACCESS_DENIED');await assert.rejects(T.invalidate('b'.repeat(64),'because'),e=>e.code==='DT_ACCESS_DENIED');await assert.rejects(T.gc({dryRun:true}),e=>e.code==='DT_ACCESS_DENIED');});
});

test('test proof/history cannot read a guessed workspace and uses private sidecar paths',async()=>{
 const metadata=path.join(home,'cache','work');fs.mkdirSync(metadata,{recursive:true});const root=path.join(home,'owned');fs.mkdirSync(root);
 
 const storyDir=path.join(A.run(owner,()=>A.scopedDirectory(metadata)));fs.mkdirSync(storyDir,{recursive:true});
 fs.writeFileSync(path.join(storyDir,'owned.json'),JSON.stringify({id:'owned',path:root,owner,project:'P',repo:'repo'}));
 fs.writeFileSync(path.join(storyDir,'owned.runs.json'),JSON.stringify([{test:'Private#secret',status:'passed',at:new Date().toISOString(),fp:'1',mode:'build'}]));
 await A.run(other,()=>assert.throws(()=>require('../lib/testrun').proof('owned'),e=>e.code==='DT_ACCESS_DENIED'||/no workspace/.test(e.message)));
 await A.run(owner,()=>assert.equal(require('../lib/testrun').proof('owned')[0].test,'Private#secret'));
 await A.run(other,()=>{const directory=A.scopedDirectory(metadata);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'owned.json'),JSON.stringify({id:'owned',path:root,owner:other,project:'P',repo:'different'}));assert.deepEqual(require('../lib/testrun').proof('owned'),[]);});
});
