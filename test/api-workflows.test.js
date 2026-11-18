const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-workflows-'));
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_API_KEY','DT_SECURITY_PROFILE'])delete process.env[key];
Object.assign(process.env,{DT_HOME:home,DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{orders:'postgres://private:password@db/orders',warehouse:'postgres://private:password@db/warehouse'},kafkaUi:'http://kafka-private',elasticsearch:{hosts:['http://elastic-private']}},uat:{}},scripts:{starters:false}}));
const S=require('../lib/scripts'),T=require('../lib/tools'),C=require('../lib/collections'),A=require('../lib/access');
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('complete workflow editor saves preserve advanced fields and reject stale or conflicting creation',async()=>{
 const def={description:'Mixed targets',tool:false,params:{id:{type:'integer',required:true}},vars:{ready:false},tags:['orders'],provenance:{kind:'collection'},finally:'log("cleanup");',steps:[{tool:'pg_query',args:{env:'dev',db:'orders',sql:'select id from sales.orders where id = $1 limit 1',params:['{{id}}']},as:'order'},{tool:'pg_query',args:{env:'uat',db:'warehouse',sql:'select id from public.report where id = $1 limit 1',params:['{{order.rows.0.id}}']},as:'warehouse'}]};
 const saved=await T.call('script_save',{id:'orders/mixed',description:def.description,steps:def.steps,definition:def,expected_revision:null});const got=await T.call('script_get',{id:'orders/mixed'});assert.equal(saved.revision,got.revision);assert.deepEqual(got.provenance,def.provenance);assert.equal(got.finally,def.finally);
 await T.call('script_save',{id:got.id,description:got.description,steps:got.steps,definition:{...def,provenance:{updated:true}},expected_revision:got.revision});await assert.rejects(T.call('script_save',{id:got.id,description:'Stale',steps:got.steps,expected_revision:got.revision}),/changed/);await assert.rejects(T.call('script_save',{id:got.id,description:'Overwrite',steps:got.steps,expected_revision:null}),/changed/);
 const current=S.get(got.id);assert.deepEqual(current.provenance,{updated:true});assert.equal(current.id,got.id);assert.ok(!JSON.parse(fs.readFileSync(path.join(S.DIR,got.id+'.json'))).revision);
 const calls=[],schemas=await T.schemas();const r=await C.run('orders',{params:{id:42},visualize:false},{schemas,call:async(name,args,options)=>{calls.push({name,args,options});return {db:args.db,rows:[{id:args.params[0]}]};}});
 assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(calls.map(c=>[c.args.env,c.args.db,c.args.params[0]]),[['dev','orders',42],['uat','warehouse',42]]);assert.ok(calls.every(c=>c.options.signal instanceof AbortSignal));assert.ok(r.cases[0].result.logs.some(l=>l.msg==='cleanup'));assert.equal(r.progress.status,'passed');
 assert.throws(()=>S.save('orders/retry',{description:'No duplicate produce',steps:[{tool:'kafka_produce',args:{topic:'orders',partition:0,value:{}},retry:{attempts:2,idempotent:true}}]}),/idempotent/);
});
test('offline target pickers reveal configured names and cached indices/topics without credentials or network',async()=>{
 const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};const cache=require('../lib/config').PATHS.cache;
 write(path.join(cache,'dev/es/orders-v2.json'),{});write(path.join(cache,'dev/kafka/_index.json'),{cluster:'main',topics:[{topic:'order_created'}]});
 const r=await T.call('api_client_catalog',{env:'dev',resources:true});assert.deepEqual(r.resources.databases,['orders','warehouse']);assert.deepEqual(r.resources.indices,['orders-v2']);assert.deepEqual(r.resources.topics,['order_created']);assert.equal(r.resources.cluster,'main');assert.equal(r.resources.kafka,true);assert.doesNotMatch(JSON.stringify(r),/password|postgres:\/\/|kafka-private|elastic-private/);
 const api=await T.schemas({profile:'api'});for(const name of ['pg_query','es_search','kafka_checkpoint','kafka_wait','kafka_produce'])assert.ok(api.some(t=>t.name===name));
});
test('workflow scripts, revisions and execution reports keep the existing story boundary',async()=>{
 await A.run({storyId:'one'},async()=>{S.save('private/one',{description:'Private',steps:[{set:{id:42}}]});const r=await C.run('private',{visualize:false});await A.run({storyId:'two'},async()=>{assert.equal(S.list().scripts.length,0);assert.throws(()=>S.get('private/one'),/no script/);assert.throws(()=>C.get(r.run),/not found/);});});
});
test('model delete tools guard exact definitions and complete collection subtree revisions',async()=>{
 const created=await T.call('script_save',{id:'delete/child/check',description:'Saved workflow',steps:[{set:{value:1}}],expected_revision:null});
 const old=await T.call('collection_get',{collection:'delete'});
 await T.call('script_save',{id:created.id,description:'Changed workflow',steps:[{set:{value:2}}],expected_revision:created.revision});
 await assert.rejects(T.call('script_delete',{id:created.id,expected_revision:created.revision}),/changed/);await assert.rejects(T.call('collection_delete',{collection:'delete',expected_revision:old.revision,recursive:true}),/changed/);
 const current=await T.call('collection_get',{collection:'delete'});await assert.rejects(T.call('collection_delete',{collection:'delete',expected_revision:current.revision}),/recursive/);
 const updated=await T.call('script_get',{id:created.id});assert.equal((await T.call('script_delete',{id:created.id,expected_revision:updated.revision})).deleted,true);await assert.rejects(T.call('script_delete',{id:created.id,expected_revision:updated.revision}),/no script/);
 const empty=await T.call('collection_get',{collection:'delete'});assert.equal((await T.call('collection_delete',{collection:'delete',expected_revision:empty.revision})).scripts,0);
 await assert.rejects(T.call('collection_delete',{collection:'delete',expected_revision:empty.revision}),/no collection/);
 const fresh=await T.call('collection_save',{collection:'new-collection',description:'Persist metadata',expected_revision:null});await assert.rejects(T.call('collection_save',{collection:'new-collection',expected_revision:null}),/changed/);
 const edited=await T.call('collection_save',{collection:'new-collection',description:'Edited',expected_revision:fresh.revision});assert.notEqual(edited.revision,fresh.revision);assert.equal(S.collectionRevision('absent'),null);
 const api=await T.schemas({profile:'api'});for(const name of ['script_list','script_get','script_save','script_delete','script_run','collection_delete','collection_run'])assert.ok(api.some(t=>t.name===name));
});
test('restart recovery preserves revisions, fails checks and JUnit, and never mislabels a live foreign coordinator',async()=>{
 S.save('recover/check',{description:'Recovery evidence',steps:[{set:{value:1}}]});const passed=await C.run('recover',{visualize:false});const reportFile=path.join(require('../lib/config').PATHS.cache,'collection-runs',passed.run+'.json');const record=JSON.parse(fs.readFileSync(reportFile));
 Object.assign(record,{status:'running',ok:undefined,processId:process.ppid,instanceId:'another-process',cases:[],counts:{...record.counts,passed:0},progress:{case:record.plan.cases[0].id,step:1,do:'tool pg_query',status:'running'}});fs.writeFileSync(reportFile,JSON.stringify(record));assert.equal(C.get(record.run).status,'running');
 record.processId=process.pid;record.instanceId='previous-boot';fs.writeFileSync(reportFile,JSON.stringify(record));const recovered=C.get(record.run);assert.equal(recovered.status,'interrupted');assert.equal(recovered.cleanupIncomplete,true);assert.equal(recovered.counts.errors,1);assert.equal(recovered.definitions['recover/check'].revision,passed.definitions['recover/check'].revision);assert.equal(C.check(record.run).ok,false);assert.match(C.junit(record.run),/<error/);assert.equal(C.cancel(record.run).cancelled,false);
 const skipped=structuredClone(record);skipped.run='f'.repeat(24);skipped.processId=0;delete skipped.progress;fs.writeFileSync(path.join(path.dirname(reportFile),skipped.run+'.json'),JSON.stringify(skipped));assert.equal(C.get(skipped.run).counts.skipped,1);assert.equal(C.history('recover').some(r=>r.status==='interrupted'),true);
});
