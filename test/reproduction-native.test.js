const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-native-fixture-'));
process.env.DT_HOME = home; process.env.DT_RATE_PER_SEC = '0';
for (const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR','DT_TOOLS']) delete process.env[key];
const config = { envs: { dev: { postgres: { orders: 'postgres://u:p@127.0.0.1:1/orders', billing: 'postgres://u:p@127.0.0.1:1/billing' } } } };
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
const { writeJson, CACHE } = require('../lib/util');
const R = require('../lib/reproduction'), Native = require('../lib/reproduction-runtime');
const workspace = path.join(home,'work/app'); fs.mkdirSync(workspace,{recursive:true});
writeJson(path.join(CACHE,'work/app.json'),{id:'app',path:workspace,createdAt:new Date().toISOString()});
const column = (name,type='bigint') => ({name,type,nullable:false});
const table = (name,columns) => ({schema:'public',name,kind:'table',columns, constraints:[{name:`${name}_pk`,type:'p',def:'PRIMARY KEY (tenant_id, id)'}]});
const catalogs = { orders: {db:'orders',syncedAt:'2026-10-29',tables:[table('orders',[column('tenant_id'),column('id'),column('account_id'),column('amount','numeric(30,6)'),column('status','text')])],functions:[]}, billing:{db:'billing',syncedAt:'2026-10-29',tables:[table('accounts',[column('tenant_id'),column('id'),column('label','text')])],functions:[]} };
for (const [db,cat] of Object.entries(catalogs)) writeJson(path.join(CACHE,'dev/pg',`${db}.json`),cat);
const mapping={properties:{tenantId:{type:'keyword'},orderId:{type:'keyword'},amount:{type:'keyword'},status:{type:'keyword'}}};
writeJson(path.join(CACHE,'dev/es/order-read.json'),{index:'order-read',mapping});
const schema={type:'JSON',schema:{type:'object',required:['tenantId','orderId'],properties:{tenantId:{type:'string'},orderId:{type:'string'},status:{type:'string'}}}};
writeJson(path.join(CACHE,'dev/kafka/orders.paid.json'),{topic:'orders.paid',valueSchema:schema});
const input={env:'dev',seeds:[{db:'orders',table:'public.orders',where:{tenant_id:'22',id:'9007199254740993'}}],relations:[{from:{db:'orders',table:'public.orders',columns:['tenant_id','account_id']},to:{db:'billing',table:'public.accounts',columns:['tenant_id','id']},required:true,evidence:'OrderProjection.java:19'}],topics:[{topic:'orders.paid',matches:[{path:'value.tenantId',from:{db:'orders',table:'public.orders',column:'tenant_id'}},{path:'value.orderId',from:{db:'orders',table:'public.orders',column:'id'}}]}],es:[{index:'order-read',matches:[{path:'_source.tenantId',from:{db:'orders',table:'public.orders',column:'tenant_id'}},{path:'_source.orderId',from:{db:'orders',table:'public.orders',column:'id'}}]}]};
const rows={'orders:public.orders':[{tenant_id:'22',id:'9007199254740993',account_id:'77',amount:'12345678901234567890.123456',status:'PAID'}], 'billing:public.accounts':[{tenant_id:'22',id:'77',label:'account22'},{tenant_id:'11',id:'77',label:'unrelated11'}]};
const query=async(db,sql,params)=>{const table=sql.match(/from "([^"]+)"\."([^"]+)"/); const selected=rows[`${db}:${table[1]}.${table[2]}`]||[];const terms=sql.match(/where (.+) order by/)[1].split(' or ').map(term=>[...term.matchAll(/"([^"]+)" = \$(\d+)/g)].map(m=>[m[1],params[Number(m[2])-1]])); return selected.filter(row=>terms.some(group=>group.every(([key,value])=>row[key]===value)));};
const event=(tenantId,orderId,offset='100')=>({partition:0,offset,key:orderId,headers:{trace:'test'},value:{tenantId,orderId,status:'PAID'}});
const messages=async()=>({messages:[event('22','9007199254740993'),event('11','9007199254740993','101'),event('22','42','102')],windows:[{partition:0,low:'100',from:'100',next:'103',highExclusive:'103',truncated:false}],truncated:false});
const documents=async()=>({documents:[{_id:'right',_source:{tenantId:'22',orderId:'9007199254740993',amount:rows['orders:public.orders'][0].amount,status:'PAID'}},{_id:'other-tenant',_source:{tenantId:'11',orderId:'9007199254740993',amount:'10',status:'PAID'}}],mapping,truncated:false});
const capture=()=>R.capture(input,{query,messages,documents,mask:false});
const profileFile='native-profile.json';
fs.writeFileSync(path.join(workspace,profileFile),JSON.stringify({version:1,adapter:'native-containers',kafka:{allowOffsetRemap:true},readyTimeoutMs:180000}));
test.after(async()=>{try{for(const file of fs.existsSync(path.join(CACHE,'fixture-runs'))?fs.readdirSync(path.join(CACHE,'fixture-runs')):[]) await Native.stop(file).catch(()=>{}); await require('../lib/pg').closeAll();} finally{fs.rmSync(home,{recursive:true,force:true});}});

test('strict mixed-source plan rejects unknown fields, codecs and unbound required reads',()=>{
  assert.throws(()=>R.plan({...input,version:999}),/version/);
  assert.throws(()=>R.plan({...input,contract:'dt.fixture.plan/v999'}),/contract/);
  assert.throws(()=>R.plan({...input,elasticSearch:[]}),/unsupported.*elasticSearch/);
  assert.throws(()=>R.plan({...input,es:[{...input.es[0],query:'*'}]}),/unsupported.*query/);
  assert.throws(()=>R.plan({...input,topics:[{...input.topics[0],codec:'avro'}]}),/unsupported Kafka codec/);
  assert.throws(()=>R.plan({...input,limits:{maxRows:200}}),/unsupported.*maxRows/);
  assert.throws(()=>R.plan({...input,seeds:[{...input.seeds[0],where:{id:9007199254740992}}]}),/unsafe numeric/);
  const planned=R.plan({...input,requiredReads:[{kind:'es',id:'missing-read',evidence:'Search.java:9'}]});
  assert.ok(planned.gaps.some(g=>g.kind==='unplanned-source'));
  assert.deepEqual(new Set(planned.obligations.map(o=>o.kind)),new Set(['pg','kafka','es']));
  assert.deepEqual(R.plan(R.plan(input)).obligations,R.plan(input).obligations);
});
test('composite tuple matching rejects cross-tenant messages/documents and preserves exact decimal/ID strings',async()=>{
  const result=await capture(); assert.equal(result.complete,true); assert.equal(result.counts.documents,1); assert.equal(result.counts.messages,1);
  assert.equal(result.rows['billing:public.accounts'].length,1);
  assert.equal(result.indexes['order-read'].documents[0]._id,'right');
  assert.equal(result.rows['orders:public.orders'][0].amount,'12345678901234567890.123456');
  assert.equal(result.events['orders.paid'].messages[0].value.orderId,'9007199254740993');
  assert.equal(result.provenance['billing:public.accounts'][0].parents[0].table,'orders:public.orders');
  assert.equal(result.indexes['order-read'].documents[0].fixtureLineage[0],result.events['orders.paid'].messages[0].fixtureLineage[0]);
  assert.equal(result.consistency.distributedSnapshot,false);
});
test('different-table matches cannot splice unrelated seed entities together',()=>{
  const provenance={a:[{roots:['root1']},{roots:['root2']}],b:[{roots:['root1']},{roots:['root2']}]};
  const data={a:[{tenant:22},{tenant:11}],b:[{id:420},{id:999}]};
  const rules=[{path:'value.tenant',from:{db:'',table:'a',column:'tenant'}},{path:'value.order',from:{db:'',table:'b',column:'id'}}];
  const scopedData=Object.fromEntries(Object.entries(data).map(([k,v])=>[`:${k}`,v])), scopedProvenance=Object.fromEntries(Object.entries(provenance).map(([k,v])=>[`:${k}`,v]));
  assert.equal(R.related({value:{tenant:22,order:999}},rules,'all',scopedData,scopedProvenance).matched,false);
  assert.equal(R.related({value:{tenant:22,order:420}},rules,'all',scopedData,scopedProvenance).matched,true);
});
test('shared related rows retain every seed lineage without another source query',async()=>{
  const second={...rows['orders:public.orders'][0],id:'9007199254740995'}; rows['orders:public.orders'].push(second);
  try {
    const topic={...input.topics[0],matches:[...input.topics[0].matches,{path:'value.accountId',from:{db:'billing',table:'public.accounts',column:'id'}}]};
    const result=await R.capture({...input,es:[],seeds:[...input.seeds,{...input.seeds[0],where:{tenant_id:'22',id:second.id}}],topics:[topic]},{query,mask:false,messages:async()=>({messages:[{...event('22','9007199254740993'),value:{tenantId:'22',orderId:'9007199254740993',accountId:'77'}},{...event('22',second.id,'101'),value:{tenantId:'22',orderId:second.id,accountId:'77'}}],truncated:false})});
    assert.equal(result.counts.messages,2);assert.equal(result.provenance['billing:public.accounts'][0].roots.length,2);assert.equal(result.counts.queries,3);
  }finally{rows['orders:public.orders'].pop();}
});

test('a bounded capture deadline fails before another source read',async()=>{
  let calls=0;await assert.rejects(()=>R.capture({...input,limits:{durationMs:1}},{query:async(...args)=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return query(...args);},messages,documents}),/timeout|aborted/i);assert.ok(calls<=1);
});

test('missing, truncated, conflicting and malformed sources cannot claim completeness',async()=>{
  const missing=await R.capture(input,{query,messages,documents:async()=>({documents:[],truncated:false})}); assert.equal(missing.complete,false); assert.ok(missing.gaps.some(g=>g.kind==='missing-documents'));
  const truncated=await R.capture(input,{query,messages:async()=>({...await messages(),truncated:true}),documents:async()=>({...await documents(),truncated:true})}); assert.ok(truncated.gaps.some(g=>g.kind==='kafka-window')); assert.ok(truncated.gaps.some(g=>g.kind==='es-window'));
  const malformed=await R.capture(input,{query,messages:async()=>({messages:[{...event('22','9007199254740993'),value:{tenantId:'22',orderId:'9007199254740993',status:99}}],windows:[],truncated:false}),documents}); assert.ok(malformed.gaps.some(g=>g.kind==='payload-schema'));
  const conflict=await R.capture(input,{query,messages:async()=>({messages:[event('22','9007199254740993'),{...event('22','9007199254740993'),value:{tenantId:'22',orderId:'9007199254740993',status:'OTHER'}}]}),documents}); assert.ok(conflict.gaps.some(g=>g.kind==='conflicting-event'));
});
test('independent change detection catches updates and missing verification adapters',async()=>{
  const unverified=await R.capture({...input,consistencyMode:'verify'},{query,messages,documents}); assert.ok(unverified.gaps.some(g=>g.kind==='unverified-consistency'));
  const changed=await R.capture({...input,consistencyMode:'verify'},{query,messages,documents,verifyQuery:async(db,sql,params)=>(await query(db,sql,params)).map(r=>({...r,status:'CHANGED'}))}); assert.ok(changed.gaps.some(g=>g.kind==='source-changed')); assert.equal(changed.complete,false);
});
test('hashed export includes verified ES mappings/documents and Kafka schemas/envelopes',async()=>{
  const result=await capture(), saved=R.exportFixture('app',result,{name:'mixed'}), manifest=R.loadFixture('app',saved.path);
  assert.ok(saved.files.includes('es/6f726465722d72656164/mapping.json'));
  assert.equal(manifest.elasticsearch['order-read'].documents.length,1); assert.deepEqual(manifest.elasticsearch['order-read'].mapping,mapping);
  assert.equal(manifest.topics['orders.paid'].envelopes[0].offset,'100');
  const documentFile=path.join(workspace,saved.path,manifest.elasticsearch['order-read'].directory,'documents.jsonl'); fs.appendFileSync(documentFile,'{}\n'); assert.throws(()=>R.loadFixture('app',saved.path),/hash mismatch/);
  R.exportFixture('app',result,{name:'mixed',overwrite:true});
});
test('ES reader binds exact tuple filters, observes PIT and always closes it',async()=>{
  const ES=require('../lib/reproduction-es'), calls=[];
  const client=async(route,opts)=>{calls.push([route,opts]);if(route.endsWith('_mapping'))return{'order-read':{mappings:mapping}};if(route.includes('/_pit?'))return{id:'pit-secret'};if(route==='/_search')return{pit_id:'pit-new',hits:{total:{value:1,relation:'eq'},hits:[{_id:'right',_source:{tenantId:'22',orderId:'9007199254740993'}}]}};return{succeeded:true};};
  const result=await ES.capture('dev','order-read',{maxDocuments:10,matches:input.es[0].matches,rows,mapping,client}); assert.equal(result.observation.pointInTimeVerified,true); assert.equal(calls.at(-1)[1].method,'DELETE'); assert.equal(calls.at(-1)[1].body.id,'pit-new');
  const query=calls.find(([route])=>route==='/_search')[1].body.query; assert.deepEqual(query.bool.must[0].bool.should[0].bool.filter,[{term:{tenantId:'22'}},{term:{orderId:'9007199254740993'}}]);
  const bad=async(route,opts)=>{if(route==='/_search')throw new Error('query failure');return client(route,opts);}; await assert.rejects(()=>ES.capture('dev','order-read',{maxDocuments:10,matches:input.es[0].matches,rows,mapping,client:bad}),/query failure/); assert.equal(calls.at(-1)[1].method,'DELETE');
});
test('wire JSON rejects precision loss before decoding while preserving harmless decimal spellings',()=>{
  const J=require('../lib/fixture-json'); assert.deepEqual(J.parse('{"amount":12.50,"id":"9007199254740993"}'),{amount:12.5,id:'9007199254740993'});
  for(const wire of ['{"id":9007199254740993}','{"amount":1.0000000000000001}','{"amount":0.1234567890123456789}','{"value":1e999}']) assert.throws(()=>J.parse(wire),/precision/);
  assert.equal(J.object('007'),'007'); assert.equal(J.parse('{"text":"1234567890123456789 is text"}').text,'1234567890123456789 is text');
});

test('native effect contracts reject unknown sources and cannot infer transient-write proof',()=>{
  const session={baseline:{sources:{'pg:orders:public.orders':[]}}};
  assert.throws(()=>Native.validateExpectations(session,{version:1,sources:[{id:'pg:other',noWrites:true}]}),/unknown/);
  assert.throws(()=>Native.validateExpectations(session,{version:1,sources:[{id:'pg:orders:public.orders'}]}),/needs/);
  assert.deepEqual(Native.delta([{id:1},{id:1}],[{id:1},{id:2}]),{added:[{id:2}],removed:[{id:1}]});
});
test('each native replay and effect primitive is discoverable independently',async()=>{
  const tools=await require('../lib/tools').schemas(); const names=new Set(tools.map(t=>t.name));
  for(const suffix of ['preflight','start','bindings','arm','observe','check','publish','stop','cleanup']) assert.ok(names.has(`fixture_runtime_${suffix}`));
});

test('native observations/checks return bounded pages and interactive complete evidence',async()=>{
  const T=require('../lib/tools'),oldObserve=Native.observe,oldCheck=Native.check,data=Array.from({length:1000},(_,id)=>({id,status:'PAID'}));let scope;
  Native.observe=async(id,options)=>{scope=options;return{id,complete:true,proof:{independentOfApplicationReport:true},sources:{'pg:orders:public.orders':data},changes:{'pg:orders:public.orders':{added:data,removed:[]}}};};
  Native.check=async id=>({id,ok:false,proof:{level:'native-observed-effects'},checks:Array.from({length:30},(_,i)=>({id:`pg:orders:public.table${i}`,assertion:'rows',ok:false,expected:data,actual:[]}))});
  try{
    const summary=await T.call('fixture_runtime_observe',{id:'test-mechanics'});assert.equal(summary.sources[0].records,1000);assert.ok(summary.view);assert.ok(Buffer.byteLength(JSON.stringify(summary))<4096);
    const page=await T.call('fixture_runtime_observe',{id:'test-mechanics',source:'pg:orders:public.orders',limit:2,offset:10});assert.equal(page.sources[0].rows[0].id,10);assert.equal(page.outputTruncated,true);assert.equal(scope.source,'pg:orders:public.orders');
    const checked=await T.call('fixture_runtime_check',{id:'test-mechanics'});assert.equal(checked.counts.failed,30);assert.equal(checked.failures.length,20);assert.ok(checked.view);assert.equal(checked.outputTruncated,true);assert.ok(Buffer.byteLength(JSON.stringify(checked))<4096);
  }finally{Native.observe=oldObserve;Native.check=oldCheck;}
});

test('long native startup is resumable and polling never starts another replay',async()=>{
  const T=require('../lib/tools'),original=Native.start; let resolve,calls=0;
  const prior=config.tests;config.tests={waitMs:2};fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();
  const pending=new Promise(r=>{resolve=r;});Native.start=()=>{calls++;return pending;};
  try{
    const result=await T.call('fixture_runtime_start',{workspace:'app',directory:'src/test/resources/dt-fixtures/mixed',profile:profileFile});assert.equal(result.state,'running');assert.equal(calls,1);
    resolve({ok:true,session:{id:'mechanics-only'}});
    const polled=await T.call('fixture_runtime_start',{job:result.job});assert.equal(polled.ok,true);assert.equal(polled.session.id,'mechanics-only');assert.equal(calls,1);
  }finally{Native.start=original;if(prior===undefined)delete config.tests;else config.tests=prior;fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();}
});

test('live owned PG + ES + Kafka replay observes exact success/rejection effects and snapshots', {skip:process.env.DT_TEST_NATIVE_FIXTURE!=='1',timeout:600000},async()=>{
  writeJson(path.join(CACHE,'dev/kafka/orders.deleted.json'),{topic:'orders.deleted'});
  writeJson(path.join(CACHE,'dev/kafka/orders.empty.json'),{topic:'orders.empty',valueSchema:{type:'JSON',schema:{type:'string'}}});
  const liveInput={...input,topics:[...input.topics,{topic:'orders.deleted',matches:[{path:'key.tenantId',from:{db:'orders',table:'public.orders',column:'tenant_id'}},{path:'key.orderId',from:{db:'orders',table:'public.orders',column:'id'}}]},{topic:'orders.empty',codec:'string',matches:[{path:'key',from:{db:'orders',table:'public.orders',column:'id'}}]}]};
  const result=await R.capture(liveInput,{query,documents,mask:false,messages:async topic=>topic==='orders.deleted'?{messages:[{partition:1,offset:'9007199254740993',key:{tenantId:'22',orderId:'9007199254740993'},value:null,headers:{reason:'deleted'}}],windows:[{partition:1,low:'9007199254740993',from:'9007199254740993',next:'9007199254740994',highExclusive:'9007199254740994'}],truncated:false}:topic==='orders.empty'?{messages:[{partition:0,offset:'0',key:'9007199254740993',value:''}],windows:[{partition:0,low:'0',from:'0',next:'1',highExclusive:'1'}],truncated:false}:messages()}), saved=R.exportFixture('app',result,{name:'native-live'});
  const report=await Native.preflight('app',saved.path,profileFile); assert.equal(report.ok,true,JSON.stringify(report));
  const evidence={version:1,runAt:new Date().toISOString(),proofType:'real-owned-containers',preflight:report,assertions:['two PostgreSQL databases with tenant collisions','exact bigint and decimal strings','real ES mappings/documents/PIT','real Kafka partitions, tombstone and empty-string distinction','immutable pre-action effects','protected committed-write journal','PG and ES update/revert negative controls','source repeatable-read snapshot under concurrent committed update','source write rejection','TRUNCATE statement audit','exact successful SQL effects','owned Kafka action primitive with raw string key','ES transient create/delete and index recreation evidence','owned cleanup and repeated stop'],applicationExecution:'test harness operations; arbitrary service execution is caller-owned'};
  const started=await Native.start('app',saved.path,profileFile); assert.equal(started.ok,true); evidence.runtime=started.session; const id=started.session.id;
  try{
    const binding=await Native.bindings(id); assert.equal(Object.keys(binding.databases).length,2); assert.ok(binding.es); assert.ok(binding.kafka);
    assert.equal(binding.offsetMappings['orders.paid'][0].sourceOffset,'100'); assert.equal(binding.offsetMappings['orders.paid'][0].offset,'0');
    const baseline=await Native.observe(id); assert.equal(baseline.sources['pg:orders:public.orders'][0].amount,'12345678901234567890.123456'); assert.equal(baseline.sources['kafka:orders.paid'][0].value.orderId,'9007199254740993');assert.equal(baseline.sources['kafka:orders.deleted'][0].value,null);assert.equal(baseline.sources['kafka:orders.deleted'][0].partition,1);assert.equal(baseline.sources['kafka:orders.empty'][0].value,'');
    await Native.arm(id,{version:1,sources:[{id:'pg:orders:public.orders',noWrites:true},{id:'es:order-read',noWrites:true},{id:'kafka:orders.paid',noWrites:true}],quietMs:20});
    assert.equal((await Native.check(id)).ok,true); evidence.initialEffectsPassed=true;
    // Configured source URLs point only at this test-owned runtime; stable snapshot sees the old value after a concurrent committed update.
    const initialConfig=JSON.stringify(config);
    try {
      config.envs.dev.postgres=Object.fromEntries(Object.entries(binding.databases).map(([db,b])=>{const u=new URL(b.url);u.username=b.user;u.password=b.password;return[db,u.toString()];}));
      config.envs.dev.elasticsearch={hosts:[binding.es]}; fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();
      const snapshots=await require('../lib/reproduction-sources').snapshots('dev',['orders','billing']);
      const db=binding.databases.orders, sql=require('postgres')(db.url,{username:db.user,password:db.password});
      try {
        await sql`update public.orders set status='RELEASED' where tenant_id=22 and id=9007199254740993`;
        assert.equal((await snapshots.query('orders','select status from public.orders',[]))[0].status,'PAID');
        assert.equal(snapshots.evidence().orders.readOnly,true);
        await assert.rejects(()=>snapshots.query('orders',"update public.orders set status='NOPE'",[]),/read-only/i);
      } finally{await sql.end();await snapshots.close().catch(error=>assert.match(error.message,/read-only/i));}
      assert.equal((await Native.check(id)).ok,false);
      const appSql=require('postgres')(db.url,{username:db.user,password:db.password});
      try {
        await assert.rejects(()=>appSql`delete from dt_fixture_observation.writes`,/permission denied/i);
        await appSql`update public.orders set status='PAID' where tenant_id=22 and id=9007199254740993`;
      }finally{await appSql.end();}
      const reverted=await Native.check(id); assert.equal(reverted.changes['pg:orders:public.orders'].added.length,0);assert.equal(reverted.checks.find(c=>c.id==='pg:orders:public.orders').ok,false,'committed mutate/revert cannot satisfy no-write');
      const updateDoc=async(source)=>{const response=await fetch(binding.es+'/order-read/_doc/right',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(source)});assert.equal(response.ok,true);};
      const original=(await Native.observe(id)).sources['es:order-read'][0]._source;
      await updateDoc({...original,status:'OTHER'});await updateDoc(original);
      const revertedEs=await Native.check(id);assert.equal(revertedEs.changes['es:order-read'].added.length,0);assert.equal(revertedEs.checks.find(c=>c.id==='es:order-read').ok,false,'ES sequence evidence detects update/revert');

      const liveCapture=await R.capture(input,{messages:async()=>({messages:(await Native.observe(id)).sources['kafka:orders.paid'],windows:[{partition:0,low:'0',from:'0',next:'1',highExclusive:'1',truncated:false}],truncated:false}),mask:false});
      assert.equal(liveCapture.complete,true,JSON.stringify(liveCapture.gaps));assert.equal(liveCapture.consistency.databases.orders.adapter,'postgres-snapshot/v1');assert.equal(liveCapture.indexes['order-read'].observation.pointInTimeVerified,true);evidence.capture={complete:liveCapture.complete,counts:liveCapture.counts,consistency:liveCapture.consistency,es:liveCapture.indexes['order-read'].observation};
    } finally{fs.writeFileSync(path.join(home,'config.json'),initialConfig);require('../lib/config').reload();}
    await assert.rejects(()=>Native.publishAction(id,'not-declared',{partition:0,value:{}}),/declared/);
    const published=await Native.publishAction(id,'orders.paid',{partition:0,key:'9007199254740993',value:{tenantId:'22',orderId:'9007199254740993',status:'RELEASED'},headers:{source:'action'}});assert.equal(published.offset,'1');
    const kafkaOnly=await Native.observe(id,{source:'kafka:orders.paid'});assert.equal(kafkaOnly.sources['kafka:orders.paid'].length,2);assert.equal(kafkaOnly.sources['kafka:orders.paid'][1].key,'9007199254740993');
    assert.equal((await Native.check(id)).checks.find(c=>c.id==='kafka:orders.paid').ok,false);
    const esBefore=await Native.observe(id,{source:'es:order-read'});
    const transient=await fetch(binding.es+'/order-read/_doc/transient',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({tenantId:'22',orderId:'42',status:'TRANSIENT'})});assert.equal(transient.ok,true);assert.equal((await fetch(binding.es+'/order-read/_doc/transient',{method:'DELETE'})).ok,true);
    const esAfter=await Native.observe(id,{source:'es:order-read'});assert.deepEqual(esBefore.sources,esAfter.sources);assert.ok(esAfter.writeEvidence['es:order-read'].deleted>esBefore.writeEvidence['es:order-read'].deleted);
    const oldIndexIdentity=esAfter.writeEvidence['es:order-read'].uuid,originalDocument=esAfter.sources['es:order-read'][0];assert.equal((await fetch(binding.es+'/order-read',{method:'DELETE'})).ok,true);
    assert.equal((await fetch(binding.es+'/order-read',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({mappings:mapping,settings:{number_of_shards:1,number_of_replicas:0}})})).ok,true);
    assert.equal((await fetch(binding.es+'/order-read/_doc/'+originalDocument._id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(originalDocument._source)})).ok,true);
    assert.notEqual((await Native.observe(id,{source:'es:order-read'})).writeEvidence['es:order-read'].uuid,oldIndexIdentity);
    const truncateSql=require('postgres')(binding.databases.orders.url,{username:binding.databases.orders.user,password:binding.databases.orders.password});
    try{await truncateSql`truncate public.orders`;}finally{await truncateSql.end();}
    const truncated=await Native.observe(id);assert.ok(truncated.writeEvidence.orders.some(event=>event.operation==='TRUNCATE'));assert.equal(truncated.sources['pg:orders:public.orders'].length,0);
  }finally{await Native.stop(id);assert.equal((await Native.stop(id)).alreadyStopped,true);}
  const sqlCapture=await R.capture({...input,topics:[],es:[]},{query,mask:false}),sqlSaved=R.exportFixture('app',sqlCapture,{name:'native-success'}),positive=await Native.start('app',sqlSaved.path,profileFile);
  try {
    const sid=positive.session.id,b=await Native.bindings(sid),before=(await Native.observe(sid)).sources['pg:orders:public.orders'],after=before.map(row=>({...row,status:'RELEASED'}));
    await Native.arm(sid,{version:1,sources:[{id:'pg:orders:public.orders',rows:after,removed:before,added:after}],quietMs:20});
    const pg=require('postgres')(b.databases.orders.url,{username:b.databases.orders.user,password:b.databases.orders.password});
    try{await pg`update public.orders set status='RELEASED' where tenant_id=22 and id=9007199254740993`;}finally{await pg.end();}
    const checked=await Native.check(sid);assert.equal(checked.ok,true,JSON.stringify(checked));evidence.successfulEffects=checked;
  }finally{await Native.stop(positive.session.id);}
  evidence.passed=true;evidence.cleanupVerified=true; if(process.env.DT_NATIVE_EVIDENCE)fs.writeFileSync(process.env.DT_NATIVE_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
});
