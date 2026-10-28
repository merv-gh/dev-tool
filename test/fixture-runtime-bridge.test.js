const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-native-test-bridge-'));
process.env.DT_HOME=home; process.env.DT_LOG='quiet'; process.env.DT_RATE_PER_SEC='0';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_BUILD_DIR','DT_RUNNER_URL','DT_TOOLS'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{orders:'postgresql://fixture@127.0.0.1:1/orders'}}},tests:{compileCheck:false,timeoutMs:10000,waitMs:10000,targets:{captured:{reviewed:true,kind:'captured-dev',environment:'dev',effects:'scratch'},remote:{reviewed:true,kind:'local',runnerUrl:'http://127.0.0.1:9'}}}}));
const B=require('../lib/fixture-runtime-bridge'),W=require('../lib/workspace'),U=require('../lib/util');
const id='a'.repeat(24), secret='native-password-sentinel-'+ 'x'.repeat(40);
function bindings(){return {id,workspace:'fixture-test',directory:'src/test/resources/dt-fixtures/order',runnerHost:'local',environment:'owned-local-fixture',fixtureDigest:'b'.repeat(64),profileDigest:'c'.repeat(64),databases:{orders:{database:'fixture_orders',url:'postgresql://127.0.0.1:55501/fixture_orders',jdbcUrl:'jdbc:postgresql://127.0.0.1:55501/fixture_orders',user:'dt_fixture_app',password:secret},billing:{database:'fixture_billing',url:'postgresql://127.0.0.1:55501/fixture_billing',jdbcUrl:'jdbc:postgresql://127.0.0.1:55501/fixture_billing',user:'dt_fixture_app',password:secret}},es:'http://127.0.0.1:55502',kafka:'127.0.0.1:55503',offsetMappings:{paid:[{partition:0,sourceOffset:'9007199254740993',offset:'0'}]},proof:{level:'native-dependencies',imageIds:{pg:'sha256:'+'1'.repeat(64),es:'sha256:'+'2'.repeat(64),kafka:'sha256:'+'3'.repeat(64)},applicationExecuted:false,sourceWrites:false}};}
const prefixes={orders:'ORDERS_DATASOURCE',billing:'BILLING_DATASOURCE'};
function target(){return require('../lib/test-targets').resolve('local',{fixtureRuntime:id});}
function put(rel,content){W.write('fixture-test',rel,{content});}
function workspace(){const root=path.join(home,'work','fixture-test');fs.mkdirSync(root,{recursive:true});U.writeJson(path.join(home,'cache','work','fixture-test.json'),{id:'fixture-test',path:root,project:'TEST',repo:'fixture-test',sha:'fixture-base',createdAt:new Date().toISOString(),dirty:true});return root;}
let root;test.before(()=>{root=workspace();});test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('native lease binding only uses validated local metadata and explicit exact PG prefixes',async t=>{
 t.mock.method(B,'bindings',async()=>bindings());
 const r=await B.resolve(id,{workspace:'fixture-test',executionTarget:target(),fixtureBindings:prefixes});
 assert.equal(r.env.ORDERS_DATASOURCE_URL,bindings().databases.orders.jdbcUrl);assert.equal(r.env.BILLING_DATASOURCE_PASSWORD,secret);assert.equal(r.env.SPRING_ELASTICSEARCH_URIS,bindings().es);assert.equal(r.env.SPRING_KAFKA_BOOTSTRAP_SERVERS,bindings().kafka);
 assert.equal(JSON.parse(r.env.DT_NATIVE_FIXTURE_BINDINGS).databases.orders.password,secret);assert.ok(r.secrets.includes(secret));assert.equal(r.metadata.effectsVerified,false);assert.ok(!JSON.stringify(r.metadata).includes(secret));
 await assert.rejects(()=>B.resolve(id,{workspace:'fixture-test',executionTarget:target()}),/explicit fixture_bindings/);
 await assert.rejects(()=>B.resolve(id,{workspace:'fixture-test',executionTarget:target(),fixtureBindings:{orders:'ONE'}}),/every captured database/);
 await assert.rejects(()=>B.resolve(id,{workspace:'different',executionTarget:target(),fixtureBindings:prefixes}),/workspace/);
 assert.throws(()=>require('../lib/test-targets').resolve('remote',{fixtureRuntime:id}),/local.*captured-dev/);
 const captured=require('../lib/test-targets').resolve('captured',{fixtureRuntime:id});assert.equal(captured.metadata.kind,'captured-dev');
});
test('invalid loopback, image, digest, datasource and ownership bindings fail before code writes',async t=>{
 for(const edit of [b=>b.fixtureDigest='old',b=>b.runnerHost='remote',b=>b.id='f'.repeat(24),b=>b.es='http://example.invalid:9200',b=>b.proof.imageIds.pg='latest',b=>b.databases.orders.jdbcUrl+='wrong']){
  const b=bindings();edit(b);const mock=t.mock.method(B,'bindings',async()=>b);await assert.rejects(()=>B.resolve(id,{workspace:'fixture-test',executionTarget:target(),fixtureBindings:prefixes}));mock.mock.restore();
 }
 const R=require('../lib/testrun');await assert.rejects(()=>R.run('fixture-test',{tests:['test/native.test.cjs'],fixtureRuntime:''}),/invalid fixture_runtime/);for(const extra of [{db:{ddlPath:'ddl.sql'}},{fixturePath:'saved'},{fixtureTemplate:true}])await assert.rejects(()=>R.run('fixture-test',{tests:['test/native.test.cjs'],fixtureRuntime:id,...extra,files:[{path:'should-not-exist',content:'bad'}]}),/choose fixture_runtime/);
 assert.equal(fs.existsSync(path.join(root,'should-not-exist')),false);
});
test('applying files revalidates native fixture/profile identity before execution',async t=>{
 let n=0;t.mock.method(B,'bindings',async()=>{const b=bindings();if(n++)b.profileDigest='d'.repeat(64);return b;});
 await assert.rejects(()=>require('../lib/testrun').run('fixture-test',{tests:['test/native.test.cjs'],fixtureRuntime:id,fixtureBindings:prefixes,check:false,files:[{path:'test/attempt.test.cjs',content:'module.exports=1'}]}),/changed while applying/);assert.equal(n,2);
});
test('actual Node test gets PG/ES/Kafka env, credentials never enter returned/persisted proof, lease retained',async t=>{
 let calls=0;t.mock.method(B,'bindings',async()=>{calls++;return bindings();});
 put('test/native.test.cjs',`const t=require('node:test'),a=require('node:assert/strict');t('binding contract',()=>{const b=JSON.parse(process.env.DT_NATIVE_FIXTURE_BINDINGS);a.equal(b.id,'${id}');a.equal(b.databases.orders.password,process.env.ORDERS_DATASOURCE_PASSWORD);a.equal(process.env.ORDERS_DATASOURCE_URL,b.databases.orders.jdbcUrl);a.equal(process.env.BILLING_DATASOURCE_PASSWORD,b.databases.billing.password);a.equal(process.env.SPRING_ELASTICSEARCH_URIS,b.es);a.equal(process.env.SPRING_KAFKA_BOOTSTRAP_SERVERS,b.kafka);a.equal(b.offsetMappings.paid[0].sourceOffset,'9007199254740993');});`);
 const T=require('../lib/tools'),run=args=>T.call('tool_execute',{name:'test_run',arguments:{workspace:'fixture-test',tests:['test/native.test.cjs'],fixture_runtime:id,fixture_bindings:prefixes,target:'captured',...args}});
 const green=await run({});assert.equal(green.outcome,'passed');assert.equal(green.execution.environment,'owned-local-fixture');assert.equal(green.execution.fixtureRuntime.fixtureDigest,'b'.repeat(64));assert.equal(green.fixture.runtime.id,id);assert.equal(green.fixture.runtime.effectsVerified,false);assert.deepEqual(green.failureKinds,{assertions:0,testErrors:0});
 put('test/native.test.cjs',`require('node:test')('leak safety',()=>{const s=JSON.parse(process.env.DT_NATIVE_FIXTURE_BINDINGS).databases.orders.password;console.log(s);throw new Error(s);})`);
 const red=await run({});assert.equal(red.outcome,'failed');assert.deepEqual(red.failureKinds,{assertions:0,testErrors:1});assert.ok(!JSON.stringify(red).includes(secret));
 const reportDir=path.join(root,'.dt','node-reports');for(const file of fs.readdirSync(reportDir).filter(n=>n.endsWith('.jsonl')))assert.ok(!fs.readFileSync(path.join(reportDir,file),'utf8').includes(secret));
 assert.equal(calls,2,'lease is bound once per actual run; bridge never starts/stops or arms/checks it');
});
test('aggregate nested failures do not invent a separate runtime error',async()=>{
 put('test/nested.test.cjs',`const t=require('node:test'),a=require('node:assert/strict');t('outer',t=>t.test('inner',()=>a.equal(1,2)));`);
 const r=await require('../lib/tools').call('test_run',{workspace:'fixture-test',tests:['test/nested.test.cjs']});assert.equal(r.counts.failed,1);assert.deepEqual(r.failureKinds,{assertions:1,testErrors:0});
});
test('failureKinds counts every raw error beyond compact previews, including after credential masking',async t=>{
 t.mock.method(B,'bindings',async()=>bindings());
 put('test/many.test.cjs',`const t=require('node:test'),a=require('node:assert/strict');for(let i=0;i<12;i++)t('assertion '+i,()=>a.equal(1,2));t('runtime error',()=>{throw new TypeError('AssertionError ERR_ASSERTION text in a runtime exception must not count as an assertion')});`);
 const r=await require('../lib/tools').call('test_run',{workspace:'fixture-test',tests:['test/many.test.cjs'],fixture_runtime:id,fixture_bindings:prefixes});assert.equal(r.failures.length,10);assert.equal(r.counts.failed,13);assert.deepEqual(r.failureKinds,{assertions:12,testErrors:1});
});
test('real owned PostgreSQL lease feeds project tests, independent effects remain caller checked', {skip:process.env.DT_TEST_NATIVE_BRIDGE!=='1',timeout:180000},async()=>{
 const R=require('../lib/reproduction'),N=require('../lib/reproduction-runtime');
 U.writeJson(path.join(home,'cache','dev','pg','orders.json'),{db:'orders',syncedAt:new Date().toISOString(),tables:[{schema:'public',name:'orders',kind:'table',columns:[{name:'id',type:'bigint',nullable:false},{name:'status',type:'text',nullable:false}],constraints:[{name:'orders_pk',type:'p',def:'PRIMARY KEY (id)'}]}],functions:[]});
 const captured=await R.capture({env:'dev',seeds:[{db:'orders',table:'public.orders',where:{id:'9007199254740993'}}]},{query:async()=>[{id:'9007199254740993',status:'PAID'}],mask:false});
 assert.equal(captured.complete,true,JSON.stringify(captured.gaps));
 const saved=R.exportFixture('fixture-test',captured,{name:'native-bridge'});
 put('native-profile.json',JSON.stringify({version:1,adapter:'native-containers',readyTimeoutMs:90000}));
 const started=await N.start('fixture-test',saved.path,'native-profile.json');assert.equal(started.ok,true,JSON.stringify(started));
 const lease=started.session.id;
 try{
  const initial=(await N.observe(lease)).sources['pg:orders:public.orders'];
  const expected=initial.map(row=>({...row,status:'RELEASED'}));
  await N.arm(lease,{version:1,sources:[{id:'pg:orders:public.orders',rows:expected,added:expected,removed:initial}],quietMs:20});
  const pgModule=path.resolve(__dirname,'../node_modules/postgres');
  put('test/actual-native.test.cjs',`const t=require('node:test'),a=require('node:assert/strict'),postgres=require(${JSON.stringify(pgModule)});t('release captured order',async()=>{const b=JSON.parse(process.env.DT_NATIVE_FIXTURE_BINDINGS),db=b.databases.orders,sql=postgres(db.url,{username:db.user,password:db.password});try{const rows=await sql\`select id::text,status from public.orders\`;a.equal(rows[0].id,'9007199254740993');a.equal(rows[0].status,'PAID');await sql\`update public.orders set status='RELEASED' where id=9007199254740993\`;}finally{await sql.end();}});`);
  const actual=await require('../lib/tools').call('test_run',{workspace:'fixture-test',tests:['test/actual-native.test.cjs'],fixture_runtime:lease,fixture_bindings:{orders:'SPRING_DATASOURCE'}});
  assert.equal(actual.outcome,'passed',JSON.stringify(actual));assert.equal(actual.execution.fixtureRuntime.effectsVerified,false);assert.equal(actual.execution.fixtureRuntime.id,lease);
  assert.equal((await N.bindings(lease)).id,lease,'test_run retains the caller-owned native lease');
  const checked=await N.check(lease);assert.equal(checked.ok,true,JSON.stringify(checked));assert.equal(checked.proof.level,'native-observed-effects');
 }finally{await N.stop(lease);}
});
