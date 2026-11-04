const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-semantic-query-'));process.env.DT_HOME=home;process.env.DT_STATE_BACKEND='legacy';process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR'])delete process.env[key];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const Q=require('../lib/semantic-query'),A=require('../lib/access');let sequence=0;
const sha=c=>c.repeat(40),symbol=(id,name,fullName=name,extra={})=>({type:'symbol',id:String(id),kind:'method',name,fullName,signature:'void(int)',file:'src/App.java',line:Number(id),endLine:Number(id)+1,parameters:[{id:String(Number(id)+1000),index:1,name:'amount',type:'int'}],returnId:String(Number(id)+2000),...extra});
function analysis(repo,commit,records,extra={}){const id='analysis-'+(++sequence),dir=path.join(home,id);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'projection.jsonl'),[{type:'meta',protocol:'dt.semantic.projection/v1',version:1,overlays:['base','ossdataflow'],capabilities:{calls:true,dataFlow:true,controlFlow:true}},...records,{type:'summary',counts:{},truncated:false,gaps:[]}].map(JSON.stringify).join('\n')+'\n');return{id,repo,sha:commit,sourceDigest:'source-'+id,revisionKey:commit,dir,...extra};}
const call=(id,caller,target,methodFullName)=>({type:'call',id:String(id),caller:String(caller),name:'call',targets:target?[String(target)]:[],methodFullName,file:'src/App.java',line:1,code:'target(amount)',arguments:[{id:'999',index:1,code:'amount'}]});
function port(a,id,type,handler,boundary,extra={}){return{id,type,repo:a.repo,revision:a.sha,service:a.service||a.repo.split('/')[1],env:'dev',handler:{repo:a.repo,revision:a.sha,file:'src/App.java',line:Number(handler),signature:a._symbols?.[handler]||String(handler)},boundary,evidence:{origin:'manual',reason:'Reviewed exact fixture mapping',author:'test',status:'declared'},mappings:[],...extra};}
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});

test('SQLite projection search pages every symbol and binds cursor to immutable revisions',async()=>{
 const a=analysis('P/service',sha('a'),Array.from({length:87},(_,i)=>symbol(i+1,'method'+i,'App.method'+i)));let cursor,ids=[];
 do{const r=await Q.query({operation:'symbols',query:'method',limit:7,cursor},[a]);assert.equal(r.total,87);ids.push(...r.results.map(n=>n.id));cursor=r.nextCursor;}while(cursor);
 assert.equal(new Set(ids).size,87);assert.ok(fs.existsSync(path.join(a.dir,'navigation.sqlite')));
 const first=await Q.query({operation:'symbols',limit:1},[a]),b=analysis('P/service',sha('b'),[symbol(1,'different')]);await assert.rejects(Q.query({operation:'symbols',limit:1,cursor:first.nextCursor},[b]),/another immutable query/);
});

test('exact dependency SHA and full signature select one library version, with reverse callers',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry:void(int)'),call(10,1,null,'Lib.validate:void(int)')]);
 const v1=analysis('P/lib',sha('b'),[symbol(2,'validate','Lib.validate:void(int)')]),v2=analysis('P/lib',sha('c'),[symbol(3,'validate','Lib.validate:void(int)')]);
 a.bindings=[{fromRepo:a.repo,fromSha:a.sha,toRepo:v1.repo,toSha:v1.sha,artifact:'validation',version:'1.0',evidence:'pom.xml:14 + exact passport library SHA'}];
 const r=await Q.query({operation:'callees',target:{name:'entry'}},[a,v1,v2]);assert.equal(r.results.length,1);assert.equal(r.results[0].node.sha,v1.sha);assert.equal(r.results[0].edge.kind,'exact-library-call');
 const reverse=await Q.query({operation:'callers',target:{repo:v1.repo,sha:v1.sha,name:'validate'}},[a,v1,v2]);assert.equal(reverse.results[0].node.repo,a.repo);
 a.bindings=[];assert.equal((await Q.query({operation:'callees',target:{name:'entry'}},[a,v1,v2])).results.length,0);
});

test('overloaded selections and CPG dispatch retain ambiguity rather than selecting the first method',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry'),symbol(2,'save','Repo.save:void(int)'),symbol(3,'save','Repo.save:void(String)'),{...call(10,1,2),targets:['2','3']}]);
 const r=await Q.query({operation:'callees',target:{name:'entry'}},[a]);assert.equal(r.results.length,2);assert.ok(r.ambiguity.length);assert.ok(r.results.every(x=>x.edge.certainty==='ambiguous'));
 const selected=await Q.query({operation:'paths',from:{name:'entry'},to:{name:'save'},maxHops:4},[a]);assert.equal(selected.results.length,2);assert.equal(selected.proof.feasibility,'unknown');
});

test('Kafka-to-database paths use exact environment/cluster identity and retain boundary gaps',async()=>{
 const a=analysis('P/producer',sha('a'),[symbol(1,'entry','Producer.entry'),symbol(2,'publish','Producer.publish'),call(10,1,2)],{service:'producer',_symbols:{2:'Producer.publish'}}),b=analysis('P/consumer',sha('b'),[symbol(3,'consume','Consumer.consume'),symbol(4,'save','Consumer.save'),call(11,3,4)],{service:'consumer',_symbols:{3:'Consumer.consume',4:'Consumer.save'}});
 a.ports=[port(a,'produce','kafka-produce',2,{cluster:'events',topic:'orders'})];b.ports=[port(b,'consume','kafka-consume',3,{cluster:'events',topic:'orders'}),port(b,'write','db-write',4,{db:'orders-db',schema:'sales',table:'orders'})];
 const args={operation:'paths',from:{name:'entry'},to:{kind:'table',env:'dev',db:'orders-db',schema:'sales',name:'orders'},maxHops:20};
 const good=await Q.query(args,[a,b]);assert.equal(good.results.length,1);assert.ok(good.results[0].edges.some(e=>e.kind==='kafka-transport'));assert.equal(good.results[0].proof.feasibility,'unknown');assert.equal(good.results[0].kind,'data-dependency');
 b.ports[0].boundary.cluster='another-cluster';assert.equal((await Q.query(args,[a,b])).results.length,0);b.ports[0].boundary.cluster='events';b.ports[0].env='uat';assert.equal((await Q.query(args,[a,b])).results.length,0);
});

test('a shared table yields a data dependency, never an insert-to-scheduler trigger',async()=>{
 const a=analysis('P/writer',sha('a'),[symbol(1,'write','Writer.write')],{_symbols:{1:'Writer.write'}}),b=analysis('P/poller',sha('b'),[symbol(2,'poll','Poller.poll')],{_symbols:{2:'Poller.poll'}}),boundary={db:'db',schema:'sales',table:'orders'};
 a.ports=[port(a,'write','db-write',1,boundary)];b.ports=[port(b,'read','db-read',2,boundary),port(b,'timer','scheduled',2,{schedule:'0 * * * *',registration:'@Scheduled'})];
 const r=await Q.query({operation:'paths',from:{name:'write'},to:{name:'poll'},maxHops:12},[a,b]);assert.equal(r.results.length,1);assert.equal(r.results[0].kind,'data-dependency');assert.equal(r.results[0].proof.controlTrigger,false);assert.ok(!r.results[0].edges.some(e=>e.kind==='scheduled-trigger'));
});

test('HTTP boundary route names alone cannot join mismatched hosts or missing base paths',async()=>{
 const a=analysis('P/ui',sha('a'),[symbol(1,'load','UI.load')],{service:'ui',_symbols:{1:'UI.load'}}),b=analysis('P/api',sha('b'),[symbol(2,'orders','API.orders')],{service:'api',_symbols:{2:'API.orders'}});
 a.ports=[port(a,'fetch','http-egress',1,{host:'api.internal',target_service:'api',method:'GET',path:'/orders',base_path:''})];b.ports=[port(b,'http','http-ingress',2,{host:'other.internal',method:'GET',path:'/orders',base_path:''})];
 const args={operation:'paths',from:{name:'load'},to:{name:'orders'},maxHops:8};assert.equal((await Q.query(args,[a,b])).results.length,0);b.ports[0].boundary.host='api.internal';assert.equal((await Q.query(args,[a,b])).results.length,1);delete b.ports[0].boundary.base_path;assert.equal((await Q.query(args,[a,b])).results.length,0);
});

test('local dataflow invokes the named retained-CPG runtime; cross-CPG reachability is not flow proof',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry'),symbol(2,'sink','App.sink')]);let called=0;
 const result=await Q.query({operation:'paths',mode:'dataflow',from:{name:'entry'},to:{name:'sink'}},[a],{runQuery:async(analysis,request)=>{called++;assert.equal(analysis.id,a.id);assert.deepEqual(request.fromNodeIds,['1001']);assert.deepEqual(request.toNodeIds,['2002']);return{records:[{type:'path',kind:'data-flow',nodes:[],proof:{status:'static-dataflow',feasibility:'unknown'}},{type:'summary',truncated:false,gaps:[]}],ms:5};}});
 assert.equal(called,1);assert.equal(result.results[0].kind,'data-flow');assert.equal(result.proof.feasibility,'unknown');
 const b=analysis('P/other',sha('b'),[symbol(3,'remote','Remote.sink')]);const unsupported=await Q.query({operation:'paths',mode:'dataflow',from:{name:'entry'},to:{name:'remote'}},[a,b],{runQuery:()=>{throw Error('must not execute');}});assert.equal(unsupported.results.length,0);assert.ok(unsupported.gaps.some(g=>g.kind==='dataflow-boundary'));
});

test('guard listings preserve declarations but never upgrade presence into every-path must_hold',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry'),{type:'guard',id:'2',method:'1',expression:'amount > 0',file:'App.java',line:4,status:'must_hold'},{type:'guard',id:'3',method:'1',expression:'require(amount > 0)',file:'App.java',line:5,status:'declared'}]);
 const r=await Q.query({operation:'assertions',target:{name:'entry'}},[a]);assert.deepEqual(r.results.map(g=>g.status),['unknown','declared']);assert.equal(r.proof.status,'unknown');
});

test('generation-local node IDs do not create false revision comparison changes',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'same','App.same')]),b=analysis('P/service',sha('b'),[symbol(99,'same','App.same',{file:'src/App.java',line:1,endLine:2,parameters:[{id:'99999',index:1,name:'amount',type:'int'}]})]);
 const r=await Q.query({operation:'compare'},[a,b]);assert.equal(r.results.length,0);assert.equal(r.proof.status,'structural');
});

test('a partial projection is rejected instead of published as complete query evidence',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry')]);const f=path.join(a.dir,'projection.jsonl');fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('\n').slice(0,-2).join('\n')+'\n');await assert.rejects(Q.query({operation:'symbols'},[a]),/final summary is missing/);
});

test('composite CPG nodes preserve service and library origins, paths and exact native evidence',async()=>{
 const service={repo:'P/service',sha:sha('a'),prefix:'service'},lib={repo:'P/lib',sha:sha('b'),prefix:'libraries/lib'};
 const a=analysis(service.repo,service.sha,[symbol(1,'entry','App.entry',{file:'service/src/App.java'}),symbol(2,'save','Lib.save',{file:'libraries/lib/src/Store.java'}),{...call(10,1,2),file:'service/src/App.java'},{...call(20,2,null,'<unknownFullName>'),name:'write',file:'libraries/lib/src/Store.java',line:8,arguments:[{id:'400',index:1,code:'amount'}]}],{sources:[service,lib],_symbols:{2:'Lib.save'}});
 a.ports=[port(a,'db-write','db-write',2,{db:'db',schema:'sales',table:'orders'},{repo:lib.repo,revision:lib.sha,handler:{repo:lib.repo,revision:lib.sha,file:'src/Store.java',line:2,signature:'Lib.save',call:{file:'src/Store.java',line:8,name:'write'}}})];
 const found=await Q.query({operation:'symbols'},[a]);assert.deepEqual(found.results.map(n=>[n.repo,n.sha,n.file]),[[lib.repo,lib.sha,'src/Store.java'],[service.repo,service.sha,'src/App.java']]);
 const edge=(await Q.query({operation:'callees',target:{repo:service.repo,name:'entry'}},[a])).results[0];assert.equal(edge.node.repo,lib.repo);assert.equal(edge.edge.kind,'call');assert.equal(edge.edge.evidence.file,'src/App.java');assert.equal(edge.edge.evidence.repo,service.repo);
 const ports=await Q.query({operation:'ports'},[a]);assert.equal(ports.results[0].handlerCandidates.length,1);assert.equal(ports.results[0].callId,'20');
 const deep=await Q.query({operation:'paths',mode:'dataflow',from:{repo:service.repo,name:'entry'},to:{repo:lib.repo,sha:lib.sha,kind:'call',name:'write',file:'src/Store.java',line:8}},[a],{runQuery:async(_,r)=>{assert.deepEqual(r.toNodeIds,['400']);return{records:[{type:'path',kind:'data-flow',nodes:[{nodeId:'400',file:'libraries/lib/src/Store.java',line:8}],proof:{status:'static-dataflow'}}]};}});
 assert.equal(deep.results[0].nodes[0].repo,lib.repo);assert.equal(deep.results[0].nodes[0].file,'src/Store.java');assert.equal(deep.results[0].nodes[0].sha,lib.sha);
});

test('approximate library bindings never become exact cross-repository call edges',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry'),call(10,1,null,'Lib.save')]),b=analysis('P/lib',sha('b'),[symbol(2,'save','Lib.save')]);
 a.bindings=[{fromRepo:a.repo,fromSha:a.sha,toRepo:b.repo,toSha:b.sha,artifact:'lib',version:'main',exact:false,evidence:'approximate'}];
 const r=await Q.query({operation:'callees',target:{name:'entry'}},[a,b]);assert.equal(r.results.length,0);assert.ok(r.gaps.some(g=>g.kind==='unresolved-call'));
});

function composedFixtures(){
 const a=analysis('P/producer',sha('a'),[symbol(1,'entry','Producer.entry'),symbol(2,'publish','Producer.publish'),call(10,1,2),{...call(20,2,null,'Kafka.send'),name:'send',line:20,column:1}],{service:'producer',_symbols:{2:'Producer.publish'}});
 const b=analysis('P/consumer',sha('b'),[symbol(3,'consume','Consumer.consume'),symbol(4,'save','Consumer.save'),call(11,3,4),{...call(21,4,null,'Storage.execute'),name:'execute',line:21,column:3,arguments:[{id:'998',index:1,code:'amount'}]},{type:'guard',id:'guard',method:'3',expression:'amount > 0',file:'src/App.java',line:6,status:'unknown'}],{service:'consumer',_symbols:{3:'Consumer.consume',4:'Consumer.save'}});
 const transport={cluster:'events',topic:'orders',schema:'Order',schema_version:'1'};
 a.ports=[port(a,'produce','kafka-produce',2,transport,{handler:{repo:a.repo,revision:a.sha,file:'src/App.java',line:2,signature:'Producer.publish',call:{file:'src/App.java',line:20,column:1,name:'send'}},mappings:[{from:'argument:1.amount',to:'payload.amount'}]})];
 b.ports=[port(b,'consume','kafka-consume',3,transport,{mappings:[{from:'payload.amount',to:'parameter:amount'}]}),port(b,'write','db-write',4,{db:'orders-db',schema:'sales',table:'orders'},{handler:{repo:b.repo,revision:b.sha,file:'src/App.java',line:4,signature:'Consumer.save',call:{file:'src/App.java',line:21,column:3,name:'execute'}},mappings:[{from:'argument:1.amount',to:'sales.orders.amount'}]})];
 return{a,b,args:{operation:'paths',mode:'dataflow',from:{repo:a.repo,name:'entry'},to:{kind:'table',env:'dev',db:'orders-db',schema:'sales',name:'orders'},maxHops:20}};
}
const proven=async(_,request)=>({records:[{type:'path',kind:'data-flow',nodes:request.fromNodeIds.concat(request.toNodeIds).map(nodeId=>({nodeId})),proof:{status:'static-dataflow',feasibility:'unknown'}},{type:'summary',truncated:false,gaps:[]}],ms:2});

test('distributed lineage composes independently checked CPG slices through explicit field mappings',async()=>{
 const {a,b,args}=composedFixtures(),requests=[];
 const result=await Q.query(args,[a,b],{runQuery:async(a,r)=>{requests.push([a.id,r]);return proven(a,r);}});
 assert.equal(requests.length,2);assert.deepEqual(requests[0][1].fromNodeIds,['1001']);assert.deepEqual(requests[0][1].toNodeIds,['999']);assert.deepEqual(requests[1][1].fromNodeIds,['1003']);assert.deepEqual(requests[1][1].toNodeIds,['998']);
 const p=result.results[0];assert.equal(p.proof.status,'composed-static-lineage');assert.equal(p.kind,'composed-data-lineage');assert.ok(p.segments.every(s=>s.status==='static-dataflow'&&s.paths.length));assert.ok(p.boundaries.every(b=>b.status==='declared'));assert.equal(p.proof.feasibility,'unknown');assert.equal(p.proof.runtime,'unknown');assert.equal(p.conditions[0].status,'unknown');assert.equal(p.proof.controlTrigger,false);assert.ok(!result.gaps.some(g=>g.kind==='dataflow-boundary'));
});

test('distributed lineage retains path and local evidence when mappings, schema version or local flow are missing',async()=>{
 const {a,b,args}=composedFixtures();b.ports[0].mappings=[];
 const missing=await Q.query(args,[a,b],{runQuery:proven});assert.equal(missing.results.length,1);assert.equal(missing.results[0].proof.status,'partial-lineage');assert.ok(missing.results[0].gaps.some(g=>g.kind==='boundary-field-mapping'));
 b.ports[0].mappings=[{from:'payload.amount',to:'parameter:amount'}];delete a.ports[0].boundary.schema_version;delete b.ports[0].boundary.schema_version;
 const schema=await Q.query(args,[a,b],{runQuery:proven});assert.equal(schema.results[0].proof.status,'partial-lineage');assert.ok(schema.results[0].gaps.some(g=>g.kind==='transport-schema'));
 a.ports[0].boundary.schema_version=b.ports[0].boundary.schema_version='1';
 const noflow=await Q.query(args,[a,b],{runQuery:async()=>({records:[{type:'summary',truncated:false}]})});assert.equal(noflow.results[0].proof.status,'partial-lineage');assert.ok(noflow.results[0].gaps.some(g=>g.kind==='local-dataflow-gap'));
});

test('lineage exposes alternative Kafka producers without claiming a unique origin',async()=>{
 const {a,b,args}=composedFixtures(),c=analysis('P/other-producer',sha('c'),[symbol(5,'publish','Other.publish')],{_symbols:{5:'Other.publish'}});
 c.ports=[port(c,'produce','kafka-produce',5,{...a.ports[0].boundary},{mappings:[{from:'other.amount',to:'payload.amount'}]})];
 const result=await Q.query(args,[a,b,c],{runQuery:proven}),boundary=result.results[0].boundaries.find(b=>b.kind==='kafka-transport');assert.equal(boundary.alternatives.length,1);assert.equal(boundary.originUniqueness,'unknown');assert.ok(result.ambiguity.some(a=>a.reason?.includes('other possible producers')));
});

test('exact call location includes column and declaring method, and unknown env stays unknown',async()=>{
 const {a,b,args}=composedFixtures();
 const file=path.join(a.dir,'projection.jsonl'),lines=fs.readFileSync(file,'utf8').trimEnd().split('\n');lines.splice(-1,0,JSON.stringify({...call(22,2,null,'Kafka.send'),name:'send',line:20,column:9}));fs.writeFileSync(file,lines.join('\n')+'\n');
 const ports=await Q.query({operation:'ports'},[a]);assert.equal(ports.results[0].callId,'20');
 a.ports[0].env=null;const result=await Q.query(args,[a,b],{runQuery:proven});assert.equal(result.results.length,0);
});

test('revision comparison includes changed guards, call sites and effective typed ports without native-ID noise',async()=>{
 const old=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry'),{...call(10,1,null,'Store.save'),line:5,code:'save(amount)'},{type:'guard',id:'11',method:'1',expression:'amount > 0',kind:'IF',file:'src/App.java',line:3}]);
 const next=analysis('P/service',sha('b'),[symbol(99,'entry','App.entry',{line:1,endLine:2}),{...call(100,99,null,'Store.save'),line:5,code:'save(normalize(amount))'},{type:'guard',id:'101',method:'99',expression:'amount >= 0',kind:'IF',file:'src/App.java',line:3}]);
 for(const a of [old,next])a.ports=[port(a,'event','kafka-produce',a===old?1:99,{cluster:'events',topic:a===old?'old':'new'},{handler:{repo:a.repo,revision:a.sha,file:'src/App.java',line:1,signature:'App.entry'}})];
 const r=await Q.query({operation:'compare'},[old,next]);assert.deepEqual(r.results.map(x=>x.category).sort(),['call','effective-port','guard']);assert.ok(r.results.every(x=>x.change==='changed'));assert.equal(r.proof.status,'structural');
});

test('repository-only analyses discover all exact passport deployments without merging their ports',async()=>{
 const P=require('../lib/passport'),O=require('../lib/passport/overrides'),oldList=P.list,oldPorts=O.ports,a=analysis('P/web',sha('a'),[symbol(1,'load','Web.load')]);
 P.list=()=>[{service:'site-dev',repo:a.repo,sha:a.sha,env:'dev'},{service:'site-uat',repo:a.repo,sha:a.sha,env:'uat'},{service:'wrong-version',repo:a.repo,sha:sha('b'),env:'dev'}];
 const calls=[];O.ports=args=>{calls.push(args);return{identity:{service:args.service,env:args.env},revision:'overlay-'+args.service,ports:[port(a,'same-id','http-egress',1,{host:'api.internal',method:'GET',path:'/orders',base_path:''},{service:args.service,env:args.env,handler:{repo:a.repo,revision:a.sha,file:'src/App.java',line:1,signature:'Web.load'}})],gaps:[]};};
 try{const r=await Q.query({operation:'ports'},[a]);assert.equal(calls.length,2);assert.deepEqual(r.results.map(p=>p.env),['dev','uat']);assert.equal(new Set(r.results.map(p=>p.id)).size,2);assert.ok(r.gaps.some(g=>g.kind==='multiple-deployments'));calls.length=0;const scoped=await Q.query({operation:'ports',env:'dev'},[a]);assert.equal(scoped.results.length,1);assert.equal(calls[0].service,'site-dev');}finally{P.list=oldList;O.ports=oldPorts;}
});

test('navigation cursors are invalidated by effective port overlay changes',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'one'),symbol(2,'two')]);a.ports=[];
 const first=await Q.query({operation:'symbols',limit:1},[a]);a.overlayRevision='changed';await assert.rejects(Q.query({operation:'symbols',limit:1,cursor:first.nextCursor},[a]),/another immutable query/);
});

test('unresolved overload identities remain distinct and incomplete handlers do not guess candidates',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'save','Store.save:<unresolvedSignature>(1)'),symbol(2,'save','Store.save:<unresolvedSignature>(1)',{signature:'void(String)'})]);
 a.ports=[{id:'incomplete',type:'db-write',env:'dev',boundary:{db:'db',schema:'s',table:'t'},handler:{file:'src/App.java'},evidence:{origin:'manual'}}];
 const r=await Q.query({operation:'symbols'},[a]);assert.equal(new Set(r.results.map(n=>n.id)).size,2);const selected=await Q.query({operation:'callees',target:{id:r.results[0].id}},[a]);assert.equal(selected.ambiguity.length,0);
 const ports=await Q.query({operation:'ports'},[a]);assert.deepEqual(ports.results[0].handlerCandidates,[]);assert.equal(ports.results[0].callId,null);assert.ok(ports.gaps.some(g=>g.kind==='port-handler'));
});

test('qualified signature candidates are distinguished from native CPG CALL edges',async()=>{
 const a=analysis('P/service',sha('a'),[symbol(1,'entry','App.entry'),symbol(2,'save','Store.save:void(int)'),call(10,1,null,'Store.save:void(int)')]);
 const result=await Q.query({operation:'callees',target:{name:'entry'}},[a]);assert.equal(result.results[0].edge.kind,'signature-call');assert.equal(result.results[0].edge.certainty,'candidate');assert.equal(result.results[0].edge.evidence.resolution,'exact-signature-candidate');
});
