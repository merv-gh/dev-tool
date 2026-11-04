// DT_SEMANTIC_LIVE_URL + TOKEN opt into real Java/TS Joern, retained commits and Open WebUI transport.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const enabled = !!(process.env.DT_SEMANTIC_LIVE_URL && process.env.DT_SEMANTIC_LIVE_TOKEN);
test('real Joern service/library/TS flows, editable evidence, retained commits and inline Open WebUI results', { skip: !enabled, timeout: 15 * 60000 }, async t => {
  const home = process.env.DT_SEMANTIC_E2E_HOME || fs.mkdtempSync(path.join(os.tmpdir(),'dt-semantic-live-'));
  fs.mkdirSync(home,{recursive:true});process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';process.env.DT_NO_DOCTOR='1';
  for(const n of ['DT_CACHE_DIR','DT_CONFIG_DIR','DT_PASSPORTS_DIR','DT_SEMANTIC_URL','DT_SEMANTIC_TOKEN'])delete process.env[n];
  const configuration={envs:{dev:{}},semantic:{url:process.env.DT_SEMANTIC_LIVE_URL,token:process.env.DT_SEMANTIC_LIVE_TOKEN,waitMs:0},server:{publicUrl:'http://127.0.0.1:4000'}};
  const saveConfig=()=>fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(configuration));saveConfig();
  const C=require('../lib/config'),CI=require('../lib/codeindex'),S=require('../lib/semantic-code'),T=require('../lib/tools'),A=require('../lib/access');
  const fixture=path.join(__dirname,'fixtures','semantic-e2e');
  const git=(folder,args)=>execFileSync('git',['-C',folder,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  function repository(name){const dir=path.join(home,'sources',name);fs.cpSync(path.join(fixture,name),dir,{recursive:true});git(dir,['init','--quiet']);git(dir,['add','.']);git(dir,['-c','user.name=Semantic Test','-c','user.email=semantic@example.invalid','commit','--quiet','-m','fixture']);return{dir,sha:git(dir,['rev-parse','HEAD'])};}
  const storage=repository('storage'),ledger=repository('ledger'),orders=repository('orders'),web=repository('web');
  const leaf=CI.build(storage.dir,'P/storage',{project:'P',repo:'storage',sha:storage.sha});
  const middle=CI.build(ledger.dir,'P/ledger',{project:'P',repo:'ledger',sha:ledger.sha,libs:[{index:leaf.revisionKey,artifactId:'storage',version:'1.0.0',exactVersion:true}]});
  const app=CI.build(orders.dir,'P/orders',{project:'P',repo:'orders',sha:orders.sha,service:'orders',libs:[{index:middle.revisionKey,artifactId:'ledger',version:'1.0.0',exactVersion:true}]});
  const js=CI.build(web.dir,'P/web',{project:'P',repo:'web',sha:web.sha});
  const passport={service:'orders',env:'dev',repo:{project:'P',repo:'orders',sha:orders.sha},codeIndex:app.revisionKey,libraries:[{index:middle.revisionKey,artifactId:'ledger',version:'1.0.0',exactVersion:true},{index:leaf.revisionKey,artifactId:'storage',version:'1.0.0',exactVersion:true}],effective:{endpoints:[],calls:[],consumes:[],produces:[],tables:[]},dependencies:{internal:[],external:[]}};
  const passportFile=path.join(C.PATHS.passports,'orders','passport.json');fs.mkdirSync(path.dirname(passportFile),{recursive:true});fs.writeFileSync(passportFile,JSON.stringify(passport));
  let server;
  t.after(async()=>{if(server)await new Promise(r=>server.close(r));await require('../lib/isolate').stop();await require('../lib/state-store').close();if(!process.env.DT_SEMANTIC_E2E_HOME)fs.rmSync(home,{recursive:true,force:true});});
  const settle=async(tool,args)=>{let value=await T.call(tool,args);for(let i=0;i<40&&value.state==='running';i++)value=await T.call(tool,{...(tool==='semantic_query'?{operation:args.operation}:{}),job:value.job,waitMs:30000});assert.notEqual(value.state,'failed',JSON.stringify(value));assert.notEqual(value.state,'running','job failed to settle');return value;};
  let java,typescript,javaSymbols;
  await t.test('service and two pinned internal libraries parse as one origin-preserving Java CPG',async()=>{
    const start=Date.now(),pending=await T.call('semantic_index',{service:'orders',env:'dev',composite:true,waitMs:0});assert.equal(pending.state,'running');assert.ok(Date.now()-start<1500);
    java=await settle('semantic_index',{job:pending.job,waitMs:30000});assert.equal(java.ready,true,JSON.stringify(java));assert.equal(java.analyses.length,1);assert.equal(java.analyses[0].sources.length,3);
    javaSymbols=await T.call('semantic_search',{revisionSet:java.revisionSet,limit:100});for(const repo of ['P/orders','P/ledger','P/storage'])assert.ok(javaSymbols.results.some(n=>n.repo===repo),JSON.stringify(javaSymbols));
    const chain=await settle('semantic_query',{revisionSet:java.revisionSet,operation:'paths',from:{name:'onOrder',kind:'method'},to:{name:'write',kind:'method'},mode:'reachability',maxHops:12,waitMs:30000});assert.ok(chain.results.some(p=>p.nodes?.some(n=>n.repo==='P/ledger')&&p.nodes?.some(n=>n.repo==='P/storage')),JSON.stringify(chain));
  });
  await t.test('real Java value reaches transitive library call argument after CPG reopening',async()=>{
    const flow=await settle('semantic_query',{revisionSet:java.revisionSet,operation:'slice',mode:'dataflow',from:{kind:'method',name:'onOrder'},to:{kind:'call',name:'write'},waitMs:30000});assert.ok(flow.results.some(p=>p.kind==='data-flow'&&p.nodes.length>=2),JSON.stringify(flow));assert.equal(flow.proof.feasibility,'unknown');
    const guards=await settle('semantic_query',{revisionSet:java.revisionSet,operation:'assertions',target:{kind:'method',name:'onOrder'},waitMs:30000});assert.ok(guards.results.some(g=>g.expression?.includes('id <= 0')));assert.ok(guards.results.every(g=>g.status!=='must_hold'));
    const control=await settle('semantic_query',{revisionSet:java.revisionSet,operation:'paths',mode:'controlflow',from:{kind:'method',name:'onOrder'},to:{kind:'call',name:'persist'},waitMs:30000});assert.ok(control.results.some(p=>p.kind==='control-flow'),JSON.stringify(control));assert.ok(control.results.some(p=>p.conditions?.some(c=>c.expression?.includes('id <= 0')&&c.polarity==='false'&&c.status==='path_condition')),JSON.stringify(control));
  });
  await t.test('TypeScript gets actual value-flow evidence despite unresolved dynamic call targets',async()=>{
    typescript=await settle('semantic_index',{revisionKey:js.revisionKey,waitMs:30000});assert.equal(typescript.ready,true,JSON.stringify(typescript));
    const flow=await settle('semantic_query',{revisionSet:typescript.revisionSet,operation:'slice',mode:'dataflow',from:{kind:'method',name:'submit'},to:{kind:'call',name:'fetch'},waitMs:30000});assert.ok(flow.results.some(p=>p.kind==='data-flow'&&p.nodes.length>=2),JSON.stringify(flow));
  });
  await t.test('manual topic/table ports are queryable, versioned, survive refresh and remain declared',async()=>{
    const find=name=>javaSymbols.results.find(n=>n.name===name&&n.kind==='method');const consume=find('onOrder'),write=find('persist');assert.ok(consume&&write);
    const saved=await T.call('passport_adjust',{service:'orders',env:'dev',expected_revision:null,reason:'E2E explicitly declares missed adapters',operations:[
      {action:'add',port:{id:'manual-consume',type:'kafka-consume',handler:{repo:consume.repo,revision:consume.sha,file:consume.file,line:consume.line,signature:consume.signature},boundary:{cluster:'events',topic:'order.created'},mappings:[{from:'payload.id',to:'id',direction:'argument'}]}},
      {action:'add',port:{id:'manual-write',type:'db-write',handler:{repo:write.repo,revision:write.sha,file:write.file,line:write.line,signature:write.signature,call:{file:write.file,line:5,name:'write'}},boundary:{db:'orders',schema:'sales',table:'orders',columns:['id']},mappings:[{from:'id',to:'sales.orders.id',direction:'write'}]}}
    ]});assert.ok(saved.revision||saved.adjustment?.revision||saved.current?.revision,JSON.stringify(saved));
    fs.writeFileSync(passportFile,JSON.stringify({...passport,builtAt:new Date().toISOString()}));
    const ports=await T.call('semantic_ports',{service:'orders',env:'dev'});assert.ok(ports.ports.some(p=>p.id==='manual-consume'));assert.ok(ports.ports.some(p=>p.id==='manual-write'&&p.status==='declared'));
    const path=await settle('semantic_query',{revisionSet:java.revisionSet,operation:'paths',mode:'reachability',from:{kind:'topic',topic:'order.created',env:'dev',cluster:'events'},to:{kind:'db-write',name:'orders',env:'dev',db:'orders',schema:'sales'},maxHops:20,waitMs:30000});assert.ok(path.results.length,JSON.stringify(path));assert.ok(path.results.every(p=>p.proof?.status!=='verified'));
  });
  await t.test('HTTP boundary composition retains actual local value segments and declared field mappings',async()=>{
    const webPassport={service:'web',env:'dev',repo:{project:'P',repo:'web',sha:web.sha},codeIndex:js.revisionKey,libraries:[],effective:{endpoints:[],calls:[],consumes:[],produces:[],tables:[]},dependencies:{internal:[],external:[]}};
    const webFile=path.join(C.PATHS.passports,'web','passport.json');fs.mkdirSync(path.dirname(webFile),{recursive:true});fs.writeFileSync(webFile,JSON.stringify(webPassport));
    const submit=(await T.call('semantic_search',{revisionSet:typescript.revisionSet,query:'submit'})).results.find(n=>n.kind==='method'&&n.name==='submit');assert.ok(submit);
    await T.call('passport_adjust',{service:'web',env:'dev',expected_revision:null,reason:'E2E binds the explicit fetch target and body mapping',operations:[{action:'add',port:{id:'manual-http-out',type:'http-egress',handler:{repo:'P/web',revision:web.sha,file:submit.file,line:submit.line,signature:submit.signature,call:{file:submit.file,line:3,name:'fetch'}},boundary:{host:'orders.dev',base_path:'',method:'POST',path:'/orders',target_service:'orders'},mappings:[{from:'id',to:'request.body',direction:'request'}]}}]});
    const state=await T.call('passport_adjustments',{service:'orders',env:'dev'}),consume=javaSymbols.results.find(n=>n.name==='onOrder'&&n.kind==='method');
    await T.call('passport_adjust',{service:'orders',env:'dev',expected_revision:state.revision,reason:'E2E binds the service HTTP handler and request field',operations:[{action:'add',port:{id:'manual-http-in',type:'http-ingress',handler:{repo:consume.repo,revision:consume.sha,file:consume.file,line:consume.line,signature:consume.signature},boundary:{host:'orders.dev',base_path:'',method:'POST',path:'/orders'},mappings:[{from:'request.body',to:'id',direction:'argument'}]}}]});
    const flow=await settle('semantic_query',{operation:'paths',mode:'dataflow',analyses:[java.analyses[0].id,typescript.analyses[0].id],from:{kind:'method',name:'submit'},to:{kind:'db-write',name:'orders',env:'dev',db:'orders',schema:'sales'},maxHops:20,maxPaths:4,waitMs:30000});
    assert.ok(flow.results.length,JSON.stringify(flow));assert.ok(flow.results.some(p=>p.segments?.some(s=>s.paths?.some(path=>path.kind==='data-flow'))),JSON.stringify(flow));assert.ok(flow.results.every(p=>p.proof?.feasibility==='unknown'));
    const completed=flow.results.filter(p=>p.proof?.status==='composed-static-lineage');assert.ok(completed.length,JSON.stringify(flow));
  });
  await t.test('unchanged cache reuse, new Git commit and forced generations preserve older exact results',async()=>{
    const reused=await settle('semantic_index',{service:'orders',env:'dev',composite:true,waitMs:30000});assert.equal(reused.reused,true);assert.equal(reused.analyses[0].id,java.analyses[0].id);
    const code=path.join(storage.dir,'src/main/java/example/Storage.java');fs.writeFileSync(code,fs.readFileSync(code,'utf8').replace('write(int','writeV2(int'));git(storage.dir,['add','.']);git(storage.dir,['-c','user.name=Semantic Test','-c','user.email=semantic@example.invalid','commit','--quiet','-m','second version']);const sha=git(storage.dir,['rev-parse','HEAD']);
    const v2=CI.build(storage.dir,'P/storage',{project:'P',repo:'storage',sha});const next=await settle('semantic_index',{revisionKey:v2.revisionKey,waitMs:30000});const newer=await T.call('semantic_search',{revisionSet:next.revisionSet,query:'writeV2'});assert.ok(newer.results.length);
    const old=await T.call('semantic_search',{revisionSet:java.revisionSet,query:'writeV2'});assert.equal(old.results.length,0);
    const again=await settle('semantic_index',{revisionKey:js.revisionKey,reparse:true,waitMs:30000});assert.notEqual(again.analyses[0].id,typescript.analyses[0].id);assert.equal(S.load(typescript.analyses[0].id).sha,web.sha);
    const privateOwner=A.normalize({principalId:'separate',storyId:'another',multiUser:true});await A.run(privateOwner,async()=>{assert.equal(S.list({versions:true}).total,0);assert.throws(()=>S.resolve({revisionSet:java.revisionSet}),/not available/);});
  });
  await t.test('actual OpenAPI response gives Open WebUI an inline sandboxed view and usable model data',async()=>{
    server=require('../server').start({port:0,host:'127.0.0.1'});await new Promise(r=>server.on('listening',r));const base=`http://127.0.0.1:${server.address().port}`;configuration.server.publicUrl=base;saveConfig();C.reload();
    const response=await fetch(base+'/oapi/semantic_search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revisionSet:java.revisionSet,query:'onOrder'})});assert.equal(response.status,200);assert.equal(response.headers.get('content-disposition'),'inline');assert.match(response.headers.get('location'),/\/show\/.+embed=1/);
    const value=await response.json();assert.equal(value[0],'embed');assert.ok(value[1].results.length);const view=await fetch(response.headers.get('location'));assert.equal(view.status,200);assert.match(view.headers.get('content-security-policy'),/sandbox/);assert.match(await view.text(),/Semantic|semantic/);
    fs.writeFileSync(path.join(home,'live-report.json'),JSON.stringify({ok:true,java:java.analyses.map(a=>({id:a.id,repo:a.repo,sha:a.sha,sources:a.sources})),typescript:typescript.analyses.map(a=>({id:a.id,sha:a.sha})),revisions:S.list({versions:true}).total,inline:true},null,2));
  });
});
