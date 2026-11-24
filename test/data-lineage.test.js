const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-data-lineage-'));
process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_LOG='quiet';process.env.DT_NO_DOCTOR='1';
const put=(p,v)=>{const f=path.join(home,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v));return f;};
put('config.json',{envs:{dev:{postgres:{alpha:'postgres://x@127.0.0.1:1/alpha',beta:'postgres://x@127.0.0.1:1/beta'}},uat:{postgres:{alpha:'postgres://x@127.0.0.1:1/alpha'}}}});
const fixtures=path.join(__dirname,'fixtures/data-lineage'),CI=require('../lib/codeindex'),Engine=require('../lib/data-lineage-engine'),L=require('../lib/data-lineage'),Access=require('../lib/access');
const table=(name,columns)=>({schema:'public',name,kind:'table',columns:columns.map(name=>({name,type:'text'})),constraints:[],indexes:[]});
const catalog=db=>({db,database:db,syncedAt:'2026-11-24T00:00:00Z',tables:[table('person',['id','legal_name'])],functions:[{schema:'public',name:'rename_person',args:'v_id bigint',kind:'procedure',lang:'plpgsql',body:"begin update public.person set legal_name = 'Anna' where id=v_id; end;"},{schema:'public',name:'normalize_name',args:'',kind:'function',lang:'plpgsql',body:'begin NEW.legal_name := upper(NEW.legal_name); return NEW; end;'}],triggers:[{name:'normalize',table:'public.person',function:'public.normalize_name',enabled:true,def:'BEFORE UPDATE ON public.person'}],viewDeps:[]});
for(const db of ['alpha','beta'])put(`cache/dev/pg/${db}.json`,catalog(db));
for(const repo of ['person-core','person-api','person-search','other-cluster']) {
 const root=path.join(home,'repos/DEMO',repo);fs.mkdirSync(root,{recursive:true});fs.cpSync(path.join(fixtures,repo),root,{recursive:true});
 CI.build(root,`DEMO/${repo}`,{project:'DEMO',repo,sha:'sha-'+repo,...(repo==='person-api'?{libs:[{index:'DEMO/person-core'}]}:{})});
}
let initial;
test.before(async()=>{initial=await Engine.build({env:'dev'});});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('SQL procedure/trigger reads and writes retain database identity, lines and mutation distinction',async()=>{
 const writers=await Engine.query({env:'dev',operation:'writers',name:'alpha:public.person.legal_name'});
 assert.equal(writers.state,'ready');assert.ok(writers.rows.some(r=>r.user.object==='public.rename_person'&&r.access==='write'&&r.proof==='sql'));
 assert.ok(writers.rows.some(r=>r.user.object==='public.normalize_name'&&r.access==='write'));
 assert.ok(writers.rows.every(r=>r.target.db==='alpha'));
 assert.ok(writers.rows.some(r=>r.scope==='object'&&r.access==='object-write'));
 assert.ok(writers.rows.filter(r=>r.scope==='object').every(r=>r.persistenceVerified===false));
 assert.ok(!writers.rows.some(r=>r.proof==='orm-mapping'));
 const readers=await Engine.query({env:'dev',operation:'readers',name:'alpha:public.person.legal_name'});
 assert.ok(readers.rows.some(r=>r.user.name==='PersonRepository#selectName'&&r.proof==='sql'));
 assert.ok(readers.rows.some(r=>r.proof==='orm-operation'&&r.candidate));
 assert.ok(readers.rows.some(r=>r.scope==='object'&&r.access==='object-read'));
});
test('inherited library API reaches entity-derived repository and column; setters alone are not persistence',async()=>{
 const trace=await Engine.query({env:'dev',operation:'trace',from:'GET /person/{id}',service:'person-api',to:'alpha:public.person.legal_name',maxPaths:10});
 assert.equal(trace.state,'ready');assert.ok(trace.paths.length,JSON.stringify(trace));
 assert.ok(trace.paths.some(p=>p.edges.some(e=>e.relation==='inherited-http-ingress')));
 assert.ok(trace.paths.some(p=>p.nodes.some(n=>n.name==='PersonRepository#findByLegalName')));
 assert.ok(trace.paths.some(p=>p.nodes.some(n=>n.repo==='DEMO/person-core')));
 assert.ok(trace.paths.every(p=>p.proof!=='runtime-proof'));
 const writers=await Engine.query({env:'dev',operation:'writers',name:'alpha:public.person.legal_name',includeCandidates:false,includeObjectAccess:false});
 assert.ok(!writers.rows.some(r=>/setLegalName/.test(r.user.name)));
});
test('API calls a procedure and follows it down to its changed column',async()=>{
 const trace=await Engine.query({env:'dev',operation:'trace',from:'POST /person/update',to:'alpha:public.person.legal_name'});
 assert.ok(trace.paths.some(p=>p.nodes.some(n=>n.kind==='pgfn'&&n.object==='public.rename_person')),JSON.stringify(trace));
 assert.ok(trace.paths.every(p=>p.nodes.at(-1).db==='alpha'));
});
test('Kafka crosses services into ES but never connects an identical topic on a different cluster',async()=>{
 const trace=await Engine.query({env:'dev',operation:'trace',from:'POST /person/update',to:'es:people-search'});
 assert.ok(trace.paths.length,JSON.stringify(trace));
 assert.ok(trace.paths.some(p=>p.edges.some(e=>e.relation==='kafka-produce')&&p.edges.some(e=>e.relation==='kafka-consume')));
 assert.ok(trace.paths.every(p=>!p.nodes.some(n=>n.service==='other-cluster')));
 const topics=await Engine.query({env:'dev',operation:'readers',name:'topic:person.changed'});assert.equal(topics.state,'ambiguous');assert.equal(topics.candidates.length,2);
});
test('unqualified duplicate database objects require selection and explicit unknowns are not empty success',async()=>{
 const ambiguous=await Engine.query({env:'dev',operation:'readers',name:'public.person.legal_name'});assert.equal(ambiguous.state,'ambiguous');assert.equal(ambiguous.candidates.length,2);
 const missing=await Engine.query({env:'dev',operation:'writers',name:'alpha:public.missing.unknown'});assert.equal(missing.state,'not-found');assert.equal(missing.coverage.exhaustive,false);
});
test('unchanged source segments are reused; failed publication leaves earlier generation and source evidence intact',async()=>{
 const again=await Engine.build({env:'dev'});assert.equal(again.generation,initial.generation);assert.ok(again.stats.reused>=7);
 const idx=CI.load('DEMO/person-api'),file=path.join(idx.root,'PersonController.java'),text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text+'\n// source drift\n');
 // Force a fresh segment to inspect the mismatching source, without changing its indexed digest.
 const info=JSON.parse(fs.readFileSync(path.join(idx.dir,'files.json')));info.builtAt=new Date().toISOString();fs.writeFileSync(path.join(idx.dir,'files.json'),JSON.stringify(info));
 await assert.rejects(Engine.build({env:'dev'}),/Source differs/);
 const kept=await Engine.query({env:'dev',generation:initial.generation,operation:'writers',name:'alpha:public.person.legal_name'});assert.equal(kept.generation,initial.generation);assert.ok(kept.rows.length);assert.equal(kept.stale,true);
 fs.writeFileSync(file,text);CI.build(idx.root,'DEMO/person-api',{project:'DEMO',repo:'person-api',sha:'sha-person-api',libs:[{index:'DEMO/person-core'}]},{force:true});
});
test('private custom aliases need the current revision and substring candidates never become read/write evidence',async()=>{
 const status=await L.index({env:'dev',action:'status'});
 await assert.rejects(L.index({env:'dev',action:'configure',expected_revision:'wrong',rules:{aliases:[]}}),/rules changed/);
 const changed=await L.index({env:'dev',action:'configure',expected_revision:status.rulesRevision,rules:{aliases:[{target:'alpha:public.person.legal_name',names:['PersonMapper']}],links:[]}});assert.ok(changed.rulesRevision);
 await Engine.build({env:'dev'});
 const r=await Engine.query({env:'dev',operation:'readers',name:'alpha:public.person.legal_name'});assert.ok(r.mentions.some(m=>m.text.includes('PersonMapper')));assert.ok(r.mentions.every(m=>m.access==='unknown'));
});
test('pagination keeps evidence exact and cursors cannot cross queries; retained generations remain usable after refresh',async()=>{
 let cursor,seen=[];do{const r=await Engine.query({env:'dev',operation:'writers',name:'alpha:public.person.legal_name',limit:2,cursor});seen.push(...r.rows.map(row=>`${row.id}|${row.target.id}`));cursor=r.nextCursor;}while(cursor);
 assert.ok(seen.length>=3);assert.equal(new Set(seen).size,seen.length);
 const page=await Engine.query({env:'dev',operation:'writers',name:'alpha:public.person.legal_name',limit:1});assert.ok(page.nextCursor);
 await assert.rejects(Engine.query({env:'dev',operation:'readers',name:'alpha:public.person.legal_name',cursor:page.nextCursor}),/Continuation/);
 const old=await Engine.query({env:'dev',operation:'writers',name:'alpha:public.person.legal_name',generation:initial.generation});assert.ok(old.rows.length);
});
test('index generations and private rules are isolated by principal/story and denied environments are enforced',async()=>{
 await Access.run({principalId:'reader',storyId:'other',multiUser:true,role:'user',envs:['dev']},async()=>{
  const status=await Engine.status({env:'dev'});assert.equal(status.state,'missing');
  await assert.rejects(Engine.query({env:'dev',generation:initial.generation,operation:'readers',name:'alpha:public.person'}),/generation|unavailable/i);
  await assert.rejects(Engine.status({env:'uat'}),/Environment is not available/);
 });
});
test('real tools start one owned background job, forward progress, and leave the event loop responsive',async()=>{
 const T=require('../lib/tools');
 await Access.run({principalId:'worker-reader',storyId:'background',multiUser:true,role:'user',envs:['dev']},async()=>{
  const [a,b]=await Promise.all(['data_readers','data_writers'].map(name=>T.call(name,{env:'dev',name:'alpha:public.person.legal_name'})));
  assert.equal(a.job.id,b.job.id);assert.equal(a.state,'running');assert.ok(a.view.includes('/show/'));
  let beats=0;const timer=setInterval(()=>beats++,1);let done;
  try{done=await T.call('data_index',{job:a.job.id,waitMs:30000,view:false});}finally{clearInterval(timer);}
  assert.equal(done.state,'ready');assert.ok(beats>1);assert.ok(done.job.log.some(l=>l.includes('source:')));
  const ready=await T.call('data_writers',{env:'dev',name:'alpha:public.person.legal_name',max_output_bytes:4096});
  assert.equal(ready.state,'ready');assert.ok(Buffer.byteLength(JSON.stringify(ready))<=4096);
  await Access.run({principalId:'worker-reader',storyId:'different',multiUser:true,role:'user'},async()=>{await assert.rejects(T.call('data_index',{job:a.job.id}),/unavailable/);});
 });
});
test('cancelling an owned build prevents a partial generation from becoming visible',async()=>{
 await Access.run({principalId:'worker-reader',storyId:'cancel-build',multiUser:true,role:'user'},async()=>{
  const started=await L.index({env:'dev'});assert.equal(started.job.state,'running');
  const stopped=require('../lib/jobs').cancel(started.job.id);assert.equal(stopped.state,'cancelled');
  await require('../lib/jobs').find(started.job.id).promise;
  assert.equal((await Engine.status({env:'dev'})).state,'missing');
  const queried=await L.query({env:'dev',operation:'readers',name:'alpha:public.person'});
  assert.equal(queried.state,'cancelled');assert.equal(queried.job.id,started.job.id);
  assert.match(queried.note,/explicitly call data_index to retry/);assert.doesNotMatch(queried.note,/Indexing cached sources/);
 });
});
test('JPQL properties, explicit accessor bodies and ResultSet labels do not invent persistence effects',async()=>{
 const root=path.join(home,'repos/EXTRA/explicit');
 put('repos/EXTRA/explicit/application.properties','spring.application.name=explicit\nspring.datasource.url=jdbc:postgresql://database:5432/alpha\n');
 put('repos/EXTRA/explicit/ExplicitPerson.java',`package explicit;
import javax.persistence.*;
@Entity @Table(name="person",schema="public")
public class ExplicitPerson {
 private String displayName;
 private String ignored;
 @Column(name="legal_name")
 public String getDisplayName() { return displayName; }
 public String getIgnored() { return displayName; }
 public void setIgnored(String value) { this.displayName = value; }
}`);
 put('repos/EXTRA/explicit/ExplicitRepository.java',`package explicit;
import org.springframework.data.jpa.repository.*;
public interface ExplicitRepository extends JpaRepository<ExplicitPerson, Long> {
 @Query("select p.displayName from ExplicitPerson p where p.displayName = :name")
 String findName(String name);
}`);
 CI.build(root,'EXTRA/explicit',{project:'EXTRA',repo:'explicit',sha:'explicit-sha'});await Engine.build({env:'dev',repos:'EXTRA/explicit'});
 const r=await Engine.query({env:'dev',repos:'EXTRA/explicit',operation:'readers',name:'alpha:public.person.legal_name'});
 assert.ok(r.rows.some(r=>r.user.name==='ExplicitRepository#findName'&&r.proof==='jpql-mapping'),JSON.stringify(r));
 assert.ok(r.rows.some(r=>r.user.name==='ExplicitPerson#getIgnored'&&r.scope==='object'));
 const writes=await Engine.query({env:'dev',repos:'EXTRA/explicit',operation:'writers',name:'alpha:public.person.legal_name'});assert.ok(writes.rows.some(r=>r.user.name==='ExplicitPerson#setIgnored'&&r.scope==='object'));assert.equal(writes.rows.filter(r=>r.user.repo==='EXTRA/explicit'&&r.scope!=='object').length,0);
 const mapper=await Engine.query({env:'dev',generation:initial.generation,operation:'readers',name:'alpha:public.person.legal_name'});assert.ok(mapper.rows.some(r=>r.proof==='row-mapper-label'&&r.candidate&&r.scope==='object'));
});
test('reviewed links are versioned evidence and cannot silently replace a missing Kafka cluster',async()=>{
 const scope={env:'dev',repos:'DEMO/*'},status=await L.index({...scope,action:'status'}),before=await Engine.build(scope);
 const ambiguous=await Engine.query({...scope,operation:'readers',name:'topic:person.changed'});const [a,b]=ambiguous.candidates;
 const configured=await L.index({...scope,action:'configure',expected_revision:status.rulesRevision,rules:{aliases:[],links:[{from:a.id,to:b.id,relation:'reviewed-broker-bridge',evidence:'Operator supplied bridge contract for fixture'}]}});assert.ok(configured.rulesRevision);
 const after=await Engine.build(scope);assert.notEqual(after.generation,before.generation);
 const old=await Engine.query({...scope,generation:before.generation,operation:'trace',from:a.id,to:b.id});assert.equal(old.paths.length,0);
 const current=await Engine.query({...scope,operation:'trace',from:a.id,to:b.id});assert.ok(current.paths.some(p=>p.edges.some(e=>e.proof==='declared')));
});
test('all 200 cached services participate; no impact-graph repository cap is reused',async()=>{
 for(let i=0;i<200;i++) {
  const key=`SCALE/service-${String(i).padStart(3,'0')}`,root=path.join(home,'repos',key);
  put(`repos/${key}/Reader.java`,`package scale; public class Reader { public String name() { return jdbc.queryForObject("select legal_name from public.person where id=1", String.class); } }`);
  CI.build(root,key,{project:'SCALE',repo:key.split('/')[1],service:'service-'+i,sha:'scale-'+i});
 }
 const result=await Engine.build({env:'dev',repos:'SCALE/*'});assert.equal(result.stats.sources.length,200);
 let cursor,services=new Set(),rows=0;
 do{const page=await Engine.query({env:'dev',repos:'SCALE/*',operation:'readers',name:'alpha:public.person.legal_name',limit:50,cursor});for(const r of page.rows){rows++;for(const s of r.services)services.add(s.service);}cursor=page.nextCursor;}while(cursor);
 assert.ok(rows>=200);assert.equal(services.size,200);
 let mentionCursor,mentions=0;do{const page=await Engine.query({env:'dev',repos:'SCALE/*',operation:'readers',mode:'mentions',name:'alpha:public.person.legal_name',limit:47,cursor:mentionCursor});mentions+=page.rows.length;assert.ok(page.rows.every(r=>r.access==='unknown'&&r.proof==='substring-candidate'));mentionCursor=page.nextCursor;}while(mentionCursor);assert.equal(mentions,200);
 const again=await Engine.build({env:'dev',repos:'SCALE/*'});assert.equal(again.generation,result.generation);assert.ok(again.stats.reused>=203);
});
test('discovery explains the new tools and routine inline evidence stays collapsed',async()=>{
 const tools=await require('../lib/tools').schemas({profile:'direct',metadata:true});for(const name of ['data_readers','data_writers','data_trace','data_index'])assert.ok(tools.some(t=>t.name===name),name);
 const map=await require('../lib/capability-map').graph({env:'dev'});assert.ok(map.edges.some(e=>e.to==='tool:data_writers'&&e.question.includes('write')));
 const vm=require('node:vm'),ctx=vm.createContext({DTState:require('../lib/state-machine')});vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/inline.js'),'utf8')+';this.inline=dtInline',ctx);
 assert.equal(ctx.inline.describe('data-lineage',{state:'ready',total:3}).open,false);assert.equal(ctx.inline.describe('data-lineage',{state:'failed',error:'bad'}).open,true);
});
test('guarded source reads reject a rebuilt index or changed live file instead of substituting current code',async()=>{
 const idx=CI.load('DEMO/person-api'),file=path.join(idx.root,'PersonMapper.java'),old=fs.readFileSync(file,'utf8');
 assert.match(CI.read('DEMO/person-api','PersonMapper.java',{expected_source_digest:idx.sourceDigest}).text,/class PersonMapper/);
 fs.writeFileSync(file,old+'\n// edited after retained result\n');
 assert.throws(()=>CI.read('DEMO/person-api','PersonMapper.java',{expected_source_digest:idx.sourceDigest}),e=>e.code==='DT_SOURCE_CHANGED');
 fs.writeFileSync(file,old);assert.throws(()=>CI.read('DEMO/person-api','PersonMapper.java',{expected_source_digest:'not-the-same-source'}),e=>e.code==='DT_SOURCE_CHANGED');
 CI.build(idx.root,'DEMO/person-api',{project:'DEMO',repo:'person-api',sha:'sha-person-api',libs:[{index:'DEMO/person-core'}]},{force:true});
});
test('a repository operation retains the caller source identity separately from the library declaration',async()=>{
 const idx=CI.load('DEMO/person-api');put('repos/DEMO/person-api/RepoCaller.java',`package fixture;\nimport fixture.PersonRepository;\npublic class RepoCaller { PersonRepository repository; public Person read() { return repository.findByLegalName("Anna"); } }`);
 CI.build(idx.root,'DEMO/person-api',{project:'DEMO',repo:'person-api',sha:'sha-person-api',libs:[{index:'DEMO/person-core'}]},{force:true});await Engine.build({env:'dev',repos:'DEMO/*'});
 const r=await Engine.query({env:'dev',repos:'DEMO/*',operation:'readers',name:'alpha:public.person.legal_name',limit:100});
 const cross=r.rows.find(r=>r.user.name==='PersonRepository#findByLegalName'&&r.file==='RepoCaller.java');assert.ok(cross);assert.equal(cross.user.repo,'DEMO/person-core');assert.equal(cross.evidenceSource.revisionKey,'DEMO/person-api');assert.ok(cross.evidenceSource.sourceDigest);
});
test('mapped-superclass fields and transitive inherited controllers remain reachable without a fictional base table',async()=>{
 const root=path.join(home,'repos/INHERIT/model');
 put('repos/INHERIT/model/application.properties','spring.application.name=inherited-model\nspring.datasource.url=jdbc:postgresql://database:5432/alpha');
 put('repos/INHERIT/model/BaseName.java',`package inherited;\nimport javax.persistence.*;\n@MappedSuperclass\npublic class BaseName { @Column(name="legal_name") protected String name; public String getName(){ return name; } }`);
 put('repos/INHERIT/model/InheritedPerson.java',`package inherited;\nimport javax.persistence.*;\n@Entity @Table(name="person",schema="public")\npublic class InheritedPerson extends BaseName { @Id private Long id; }`);
 put('repos/INHERIT/model/BaseController.java',`package inherited;\nimport org.springframework.web.bind.annotation.*;\npublic abstract class BaseController { protected InheritedPerson person; @GetMapping("/name/{id}") public String name(Long id){ return person.getName(); } }`);
 put('repos/INHERIT/model/MidController.java',`package inherited; public abstract class MidController extends BaseController { }`);
 put('repos/INHERIT/model/ActualController.java',`package inherited;\nimport org.springframework.web.bind.annotation.*;\n@RestController @RequestMapping("/v2")\npublic class ActualController extends MidController { }`);
 CI.build(root,'INHERIT/model',{project:'INHERIT',repo:'model',sha:'inherited-model'});await Engine.build({env:'dev',repos:'INHERIT/model'});
 const r=await Engine.query({env:'dev',repos:'INHERIT/model',operation:'readers',name:'alpha:public.person.legal_name'});assert.ok(r.rows.some(r=>r.user.name==='BaseName#getName'&&r.scope==='object'));
 assert.ok(!r.gaps.some(g=>g.name==='base_name'));
 const trace=await Engine.query({env:'dev',repos:'INHERIT/model',operation:'trace',from:'GET /v2/name/42',to:'alpha:public.person.legal_name'});assert.ok(trace.paths.some(p=>p.nodes.some(n=>n.name==='BaseName#getName')),JSON.stringify(trace));assert.ok(trace.paths.every(p=>p.assumptions.some(a=>a.includes('persisted'))));
});
test('unqualified inherited helpers, this.field calls and abstract dispatch reach only the selected service implementation',async()=>{
 const core=CI.load('DEMO/person-core'),api=CI.load('DEMO/person-api'),other=CI.load('DEMO/other-cluster');
 put('repos/DEMO/person-core/AbstractNameHandler.java',`package fixture; public abstract class AbstractNameHandler { protected PersonRepository repository; public String handle(Long id) { return fetchName(id); } protected abstract String fetchName(Long id); }`);
 put('repos/DEMO/person-api/NameController.java',`package fixture;\nimport org.springframework.web.bind.annotation.*;\n@RestController\npublic class NameController extends AbstractNameHandler {\n @GetMapping("/name/{id}") public String name(Long id) { return handle(id); }\n protected String fetchName(Long id) { return this.repository.selectName(id); }\n}`);
 put('repos/DEMO/other-cluster/OtherController.java',`package fixture;\nimport org.springframework.web.bind.annotation.*;\n@RestController\npublic class OtherController extends AbstractNameHandler {\n @GetMapping("/other/{id}") public String other(Long id) { return handle(id); }\n protected String fetchName(Long id) { return jdbc.queryForObject("select secret from public.other where id=1",String.class); }\n}`);
 const cat=catalog('alpha');cat.tables.push(table('other',['id','secret']));put('cache/dev/pg/alpha.json',cat);
 CI.build(core.root,'DEMO/person-core',{project:'DEMO',repo:'person-core',sha:'sha-person-core'},{force:true});
 for(const [idx,key]of[[api,'person-api'],[other,'other-cluster']])CI.build(idx.root,'DEMO/'+key,{project:'DEMO',repo:key,sha:'sha-'+key,libs:[{index:'DEMO/person-core'}]},{force:true});
 await Engine.build({env:'dev',repos:'DEMO/*'});
 const yes=await Engine.query({env:'dev',repos:'DEMO/*',operation:'trace',from:'GET /name/42',to:'alpha:public.person.legal_name'});assert.ok(yes.paths.some(p=>p.edges.some(e=>e.relation==='dispatch')&&p.nodes.some(n=>n.name==='PersonRepository#selectName')),JSON.stringify(yes));
 const no=await Engine.query({env:'dev',repos:'DEMO/*',operation:'trace',from:'GET /name/42',to:'alpha:public.other.secret'});assert.equal(no.paths.length,0,JSON.stringify(no));
});
test('commit/revision indices and retained generations keep before/after column changes separate',async()=>{
 const root=path.join(home,'repos/VERS/reader');put('repos/VERS/reader/application.properties','spring.application.name=versioned-reader\nspring.datasource.url=jdbc:postgresql://database:5432/alpha');
 const source=column=>`package versioned; public class Reader { public String read(){return jdbc.queryForObject("select ${column} from public.person where id=1",String.class);} }`;
 put('repos/VERS/reader/Reader.java',source('legal_name'));const before=CI.build(root,'VERS/reader',{project:'VERS',repo:'reader',sha:'1'.repeat(40)});
 const old=await Engine.build({env:'dev',repos:before.revisionKey});
 put('repos/VERS/reader/Reader.java',source('id'));const after=CI.build(root,'VERS/reader',{project:'VERS',repo:'reader',sha:'2'.repeat(40)});await Engine.build({env:'dev',repos:after.revisionKey});
 const a=await Engine.query({env:'dev',repos:before.revisionKey,generation:old.generation,operation:'readers',name:'alpha:public.person.legal_name'}),b=await Engine.query({env:'dev',repos:after.revisionKey,operation:'readers',name:'alpha:public.person.legal_name'});
 assert.ok(a.rows.some(r=>r.user.repo==='VERS/reader'));assert.ok(!b.rows.some(r=>r.user.repo==='VERS/reader'));assert.match(CI.read(before.revisionKey,'Reader.java',{expected_source_digest:CI.metadata(before.revisionKey).sourceDigest}).text,/select legal_name/);
});
test('environment profiles do not borrow another profile’s topic or broker and remain unverified runtime configuration',async()=>{
 const root=path.join(home,'repos/PROFILE/publisher');put('repos/PROFILE/publisher/application.properties','spring.application.name=profile-publisher');
 for(const env of ['dev','uat'])put(`repos/PROFILE/publisher/application-${env}.properties`,`spring.kafka.bootstrap-servers=broker-${env}:9092\nevent.topic=profile.${env}`);
 put('repos/PROFILE/publisher/Publisher.java','package profiles; public class Publisher { KafkaTemplate<String, Long> kafkaTemplate; public void publish(){kafkaTemplate.send("${event.topic}",1L);} }');
 CI.build(root,'PROFILE/publisher',{project:'PROFILE',repo:'publisher',sha:'profile-source'});
 for(const env of ['dev','uat']){await Engine.build({env,repos:'PROFILE/publisher'});const r=await Engine.query({env,repos:'PROFILE/publisher',operation:'writers',name:`topic:profile.${env}`});assert.equal(r.state,'ready');assert.ok(r.rows.some(row=>row.target.cluster===`broker-${env}:9092`&&row.candidate));assert.ok(r.gaps.some(g=>g.kind==='spring-profile-unverified'));const wrong=await Engine.query({env,repos:'PROFILE/publisher',operation:'writers',name:`topic:profile.${env==='dev'?'uat':'dev'}`});assert.equal(wrong.state,'not-found');}
});
test('named SQL parameters are values, and MyBatis namespace/method bindings connect an API to a column',async()=>{
 const r=require('../lib/column-lineage').analyze('update public.person set legal_name=:legal_name where id=:id',catalog('alpha'));assert.equal(r.hits.filter(h=>h.column==='legal_name'&&h.access==='read').length,0);assert.ok(r.hits.some(h=>h.column==='legal_name'&&h.access==='write'));
 const root=path.join(home,'repos/MYBATIS/people');put('repos/MYBATIS/people/application.properties','spring.application.name=mybatis-people\nspring.datasource.url=jdbc:postgresql://database:5432/alpha');
 put('repos/MYBATIS/people/PeopleMapper.java','package mapper; public interface PeopleMapper { String name(Long id); }');put('repos/MYBATIS/people/PeopleController.java','package mapper;\nimport org.springframework.web.bind.annotation.*;\n@RestController public class PeopleController { PeopleMapper mapper; @GetMapping("/mapped/{id}") public String name(Long id){ return mapper.name(id); } }');
 put('repos/MYBATIS/people/PeopleMapper.xml','<mapper namespace="mapper.PeopleMapper">\n<select id="name">select legal_name from public.person where id=#{id}</select>\n</mapper>');CI.build(root,'MYBATIS/people',{project:'MYBATIS',repo:'people',sha:'mybatis-fixture'});await Engine.build({env:'dev',repos:'MYBATIS/people'});
 const trace=await Engine.query({env:'dev',repos:'MYBATIS/people',operation:'trace',from:'GET /mapped/42',to:'alpha:public.person.legal_name'});assert.ok(trace.paths.some(p=>p.nodes.some(n=>n.name==='PeopleMapper#name')),JSON.stringify(trace));
});
test('serving retained queries does not deserialize huge filename inventories or legacy database catalogs',async()=>{
 const dir=CI.keyDir('FAT/metadata-only');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'graph.json'),'{"classes":[],"edges":[]}');
 const sourceFile=path.join(dir,'files.json'),fd=fs.openSync(sourceFile,'w');fs.writeSync(fd,JSON.stringify({key:'FAT/metadata-only',repo:'metadata-only',sha:'fat',root:home}).slice(0,-1)+',"list":[');const block='{"path":"unused.java","size":1,"stamp":"unused"},'.repeat(10000);for(let i=0;i<100;i++)fs.writeSync(fd,block);fs.writeSync(fd,'{"path":"last.java"}]}');fs.closeSync(fd);
 const pgFile=path.join(home,'cache/dev/pg/beta.json'),original=fs.readFileSync(pgFile),dbfd=fs.openSync(pgFile,'w');let dbBytes=fs.writeSync(dbfd,'{"db":"beta","tables":[');const cols=Array.from({length:64},(_,i)=>({name:'column_'+i,type:'text'}));for(let i=0;i<100;i++){const block=Array.from({length:1000},(_,n)=>JSON.stringify({schema:'public',name:'table_'+(i*1000+n),kind:'table',columns:cols})).join(',')+',';dbBytes+=fs.writeSync(dbfd,block);}dbBytes+=fs.writeSync(dbfd,'{"schema":"public","name":"last","columns":[]}],"functions":[]}');fs.closeSync(dbfd);assert.ok(dbBytes>200*1024*1024);
 try{const script=`(async()=>{const E=require('./lib/data-lineage-engine');const s=await E.status({env:'dev'});const r=await E.query({env:'dev',generation:${JSON.stringify(initial.generation)},operation:'readers',name:'alpha:public.person.legal_name'});if(!r.rows.length)throw Error('lost retained readers');process.stdout.write(JSON.stringify({state:s.state,rows:r.rows.length}));})().catch(e=>{console.error(e);process.exitCode=1;});`;const child=require('node:child_process').spawnSync(process.execPath,['--max-old-space-size=64','-e',script],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).state,'stale');assert.equal(fs.statSync(pgFile).size,dbBytes);}finally{fs.writeFileSync(pgFile,original);fs.rmSync(dir,{recursive:true,force:true});}
});

test('named HTTP clients cross services without replacing the target ingress source with a client declaration',async()=>{
 for(const [repo,service]of [['a-target','http-target'],['z-client','http-client']])put(`repos/HTTP/${repo}/application.properties`,`spring.application.name=${service}\nspring.datasource.url=jdbc:postgresql://database:5432/alpha\n`);
 put('repos/HTTP/a-target/LookupController.java',`package lookup;
import org.springframework.web.bind.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
@RestController public class LookupController {
 private JdbcTemplate jdbc;
 @GetMapping("/lookup/{id}")
 public String get(Long id) { return jdbc.queryForObject("select legal_name from public.person where id=?",String.class,id); }
}`);
 put('repos/HTTP/z-client/PeopleClient.java',`package caller;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
@FeignClient(name="http-target") public interface PeopleClient {
 @GetMapping("/lookup/{id}") String get(Long id);
}`);
 put('repos/HTTP/z-client/CallerController.java',`package caller;
import org.springframework.web.bind.annotation.*;
@RestController public class CallerController {
 private PeopleClient client;
 @GetMapping("/caller/{id}")
 public String get(Long id) { return client.get(id); }
}`);
 for(const repo of ['a-target','z-client'])CI.build(path.join(home,'repos/HTTP',repo),`HTTP/${repo}`,{project:'HTTP',repo,sha:'http-'+repo});
 await Engine.build({env:'dev',repos:'HTTP/*'});
 const r=await Engine.query({env:'dev',repos:'HTTP/*',operation:'trace',from:'GET /caller/42',service:'http-client',to:'alpha:public.person.legal_name',maxPaths:10});
 assert.ok(r.paths.some(p=>p.edges.some(e=>e.relation==='http-egress')),JSON.stringify(r));
 const endpoint=r.paths.flatMap(p=>p.nodes).find(n=>n.kind==='endpoint'&&n.service==='http-target');
 assert.equal(endpoint.repo,'HTTP/a-target');assert.ok(endpoint.sourceDigest);assert.equal(endpoint.file,'LookupController.java');
});
test('changing the SQL column budget invalidates derived links without discarding reusable source segments',async()=>{
 const before=await Engine.build({env:'dev',repos:'HTTP/*'}),old=process.env.DT_DATA_INDEX_COLUMNS_PER_TABLE;
 try{
  process.env.DT_DATA_INDEX_COLUMNS_PER_TABLE='8192';
  const status=await Engine.status({env:'dev',repos:'HTTP/*'});assert.equal(status.state,'stale');
  const after=await Engine.build({env:'dev',repos:'HTTP/*'});assert.notEqual(after.generation,before.generation);assert.ok(after.stats.reused>=4);
 }finally{if(old===undefined)delete process.env.DT_DATA_INDEX_COLUMNS_PER_TABLE;else process.env.DT_DATA_INDEX_COLUMNS_PER_TABLE=old;}
});
test('retained name-candidate pages keep their original aliases after rules change',async()=>{
 const scope={env:'dev',repos:'DEMO/*'},status=await L.index({...scope,action:'status'});
 await L.index({...scope,action:'configure',expected_revision:status.rulesRevision,rules:{aliases:[{target:'alpha:public.person.legal_name',names:['PersonMapper']}],links:[]}});
 const before=await Engine.build(scope),args={...scope,operation:'readers',name:'alpha:public.person.legal_name',mode:'mentions',limit:200};
 const original=await Engine.query(args),first=await Engine.query({...args,limit:1});assert.ok(first.nextCursor);assert.ok(original.rows.some(r=>/class PersonMapper/.test(r.evidence)));
 const current=await L.index({...scope,action:'status'});await L.index({...scope,action:'configure',expected_revision:current.rulesRevision,rules:{aliases:[],links:[]}});await Engine.build(scope);
 const retained=await Engine.query({...args,generation:before.generation});assert.deepEqual(retained.rows,original.rows);
 const continuation=await Engine.query({...args,cursor:first.nextCursor});assert.deepEqual(continuation.rows,original.rows.slice(1));
 const latest=await Engine.query(args);assert.ok(!latest.rows.some(r=>/class PersonMapper/.test(r.evidence)));
});
