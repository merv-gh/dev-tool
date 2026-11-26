const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-semantic-navigation-'));
process.env.DT_HOME=home;process.env.DT_STATE_BACKEND='legacy';process.env.DT_LOG='quiet';
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const S=require('../lib/semantic-code'),T=require('../lib/tools'),originalQuery=S.query,originalIndex=S.index;
const raw=()=>({operation:'trace',assumptions:[{expression:'discount < 0',holds:false}],truncated:true,proof:{status:'inconclusive',runtime:'unknown',behaviorVerified:false},sides:[{side:'selected',data:{paths:[{assumptionEvaluation:{status:'unresolved'}}],selectedValues:{to:[{name:'store',argument:2,value:'net',call:'ledger.store(account, net)',file:'Service.java',line:12}]}},control:{paths:[{assumptionEvaluation:{status:'matches-assumptions'}}]}}],gaps:[{kind:'bounded-paths'}]});
test.after(async()=>{S.query=originalQuery;S.index=originalIndex;await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});

test('production trace contract rejects missing argument instead of selecting another value',async()=>{
  let called=false;S.query=async()=>{called=true;return raw();};
  await assert.rejects(T.call('where_value_flows',{analysis:'retained',entry:'charge',parameter:'discount',sink:'store'}),/argument.*required/);
  assert.equal(called,false);
  let selected;S.query=async args=>{selected=args;return raw();};
  const r=await T.call('where_value_flows',{analysis:'retained',entry:'charge',parameter:'discount',sink:'store',argument:'2',assumptions:{'discount < 0':false}});
  assert.equal(selected.to.argument,2);
  assert.deepEqual(selected.assumptions,[{expression:'discount < 0',holds:false}]);
  assert.equal(r.selectedSinks[0].argumentExpression,'net');
  assert.equal(r.selectedSinks[0].traceSinkCall,'store');
  assert.equal(r.controlAssumptionStatus,'matches-assumptions');
  assert.equal(r.dataAssumptionStatus,'unresolved');
  assert.equal(r.proof.behaviorVerified,false);
  assert.equal(r.sourceCoverage.truncated,true);
  assert.equal(r.output.status,'part');
  assert.deepEqual(require('../lib/results').load(r.read.arguments.id).data,raw());
});

test('owned job polling observes the existing job without repeating source selectors',async()=>{
  const calls=[];S.query=async args=>{calls.push(args);return calls.length===1?{job:'owned-query',state:'running'}:raw();};
  const r=await T.call('where_value_flows',{analysis:'retained',entry:'charge',parameter:'discount',sink:'store',argument:2,waitMs:0});
  assert.deepEqual(r.next,{tool:'where_value_flows',arguments:{job:'owned-query',waitMs:30000}});
  const done=await T.call(r.next.tool,r.next.arguments);
  assert.deepEqual(calls[1],{job:'owned-query',waitMs:30000});
  assert.equal(done.selectedSinks[0].argumentExpression,'net');
});

test('list is read-only and includes workspace and revision identity; all preserves raw traces',async()=>{
  let args;S.index=async a=>{args=a;return {analyses:[{id:'pin',repo:'SHOP/charge',workspace:'fix-discount',sha:'abc',language:'java'}]};};
  const listed=await T.call('which_analyses_exist',{});
  assert.equal(args.repo,undefined);
  assert.equal(listed.analyses[0].workspace,'fix-discount');
  S.query=async()=>raw();
  const result=await T.call('where_value_flows',{analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2,all:true});
  assert.deepEqual(result.sides,raw().sides);
  assert.equal(result.selectedSinks[0].argumentExpression,'net','all expands evidence without removing compact answer fields');
  assert.equal(result.dataAssumptionStatus,'unresolved');
});

test('maps separate actual selected entries, method exits and external boundaries',()=>{
  const r=require('../lib/semantic-navigation').summarize({view:'/show/evidence',proof:{behaviorVerified:false},flowMap:{complete:false,counts:{methods:2},entries:['entry'],methods:[{entry:'entry',name:'charge'},{entry:'callee',name:'helper'}],nodes:[{kind:'return',code:'net'},{kind:'call',code:'store(account, net)',exit:'external'}]}});
  assert.deepEqual(r.entries.map(x=>x.name),['charge']);
  assert.equal(r.methodExits[0].code,'net');
  assert.equal(r.externalCallBoundaries[0].code,'store(account, net)');
  assert.equal(r.mapComplete,false);
  assert.equal(r.summary.methodExitCount,1);assert.equal(r.summary.externalCallBoundaryCount,1);
  assert.equal(r.counts.methodExits,1);assert.equal(r.counts.externalCallBoundaries,1);
});

test('different per-path evaluations remain mixed rather than claiming a universal match',()=>{
  const value=raw();value.sides[0].control.paths.push({assumptionEvaluation:{status:'contradicts-assumptions'}});
  const r=require('../lib/semantic-navigation').summarize(value);
  assert.equal(r.controlAssumptionStatus,'mixed');
  assert.deepEqual(r.assumptionChecks.control.map(x=>x.status),['matches-assumptions','contradicts-assumptions']);
});

test('analysisId is accepted as an unambiguous input alias without hiding conflicting identities',async()=>{
  let selected;S.query=async args=>{selected=args;return raw();};
  await T.call('where_value_flows',{analysisId:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2});
  assert.equal(selected.analysis,'pin');
  await assert.rejects(T.call('where_value_flows',{analysisId:'other',analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2}),/disagree/);
});

test('combined questions observe one parent job and retain independent map and trace evidence',async()=>{
  const calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  S.query=async args=>{calls.push(args);if(args.operation==='flowmap'){await gate;return {operation:'flowmap',flowMap:{complete:false,counts:{},entries:['e'],methods:[{name:'charge',entry:'e'}],nodes:[{kind:'exit'}]}};}return raw();};
  const initial=await T.call('what_happens_from',{analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2,assumptions:{'discount < 0':false},waitMs:0});
  assert.equal(initial.state,'running');
  const observed=await T.call('what_happens_from',{job:initial.job,waitMs:0});
  assert.equal(observed.job,initial.job);assert.equal(calls.length,1);
  release();
  const done=await T.call('what_happens_from',{job:initial.job,waitMs:30000});
  assert.equal(done.entryMap.mapComplete,false);
  assert.equal(done.valueTrace.selectedSinks[0].argumentExpression,'net');
  assert.equal(done.valueTrace.controlAssumptionStatus,'matches-assumptions');
  assert.notEqual(done.mapView,done.traceView);
  assert.equal(calls.length,2);
  assert.equal(calls[1].from.parameter,'discount');assert.equal(calls[1].to.argument,2);
  const full=await T.call('what_happens_from',{job:initial.job,all:true});
  assert.ok(full.entryMap.flowMap);assert.ok(full.valueTrace.sides);
});

test('cancelling a combined job cancels its owned query and never starts the trace',async()=>{
  const J=require('../lib/jobs'),E=require('../lib/execution');let child,traceCalls=0;
  S.query=async args=>{
    if(args.operation==='trace'){traceCalls++;return raw();}
    child=J.start('semantic:query:cancel-test','waiting semantic fixture',()=>new Promise((resolve,reject)=>{const signal=E.signal();if(signal.aborted)reject(E.abortError(signal.reason));else signal.addEventListener('abort',()=>reject(E.abortError(signal.reason)),{once:true});}));
    return {job:child.id,state:'running'};
  };
  const r=await T.call('what_happens_from',{analysis:'cancel-pin',entry:'charge',parameter:'discount',sink:'store',argument:2,waitMs:0});
  J.cancel(r.job,'test cancellation');
  await J.find(r.job).promise;
  assert.equal(J.find(r.job).state,'cancelled');
  assert.equal(J.find(child.id).state,'cancelled');
  assert.equal(traceCalls,0);
});

test('literal singleton assumptions normalize, while invented labels remain explicitly unmatched',async()=>{
  let args;S.query=async a=>{args=a;const r=raw();r.assumptions=a.assumptions;r.sides[0].control.paths[0].conditions=[{expression:'discount < 0',polarity:'false'}];return r;};
  await T.call('where_value_flows',{analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2,assumptions:{expression:'discount < 0',holds:false}});
  assert.deepEqual(args.assumptions,[{expression:'discount < 0',holds:false}]);
  const r=raw();r.assumptions=[{expression:'discount_negative',holds:false}];r.sides[0].control.paths[0].conditions=[{expression:'discount < 0',polarity:'false'}];r.sides[0].control.paths[0].assumptionEvaluation={status:'unresolved'};
  const selected=require('../lib/semantic-navigation').summarize(r);
  assert.equal(selected.controlAssumptionStatus,'unresolved');
  assert.deepEqual(selected.observedPredicates,['discount < 0']);
  assert.equal(selected.unmatchedAssumptions[0].expression,'discount_negative','never silently translate a label into a predicate');
});

test('semantic discovery profile exposes question-shaped contracts',async()=>{
 const names=(await T.schemas({profile:'semantic'})).map(t=>t.name);
 for(const name of ['which_analyses_exist','what_happens_from','where_value_flows'])assert.ok(names.includes(name),name);
});

test('analysis discovery filters exact retained identities without initiating indexing',async()=>{
 let request;S.index=async a=>{request=a;return {total:2,analyses:[{id:'wanted',workspace:'branch',repo:'P/service',sha:'abc'},{id:'other',workspace:'branch',repo:'P/service',sha:'def'}]};};
 const r=await T.call('which_analyses_exist',{workspace:'branch',sha:'abc'});
 assert.deepEqual(request,{env:'dev',versions:false});
 assert.deepEqual(r.analyses.map(x=>x.id),['wanted']);assert.equal(r.total,1);assert.equal(r.sourceTotal,2);
 const full=require('../lib/results').load(r.analysisView.split('/').pop()).data;
 assert.deepEqual(full.analyses.map(x=>x.id),['wanted']);
 const blank={workspace:'branch',repo:'  ',sha:null};
 const normalized=await T.call('which_analyses_exist',blank);
 assert.deepEqual(normalized.analyses.map(x=>x.id),['wanted','other']);
 assert.deepEqual(blank,{workspace:'branch',repo:'  ',sha:null},'caller inputs remain unchanged');
 const exact=await T.call('which_analyses_exist',{workspace:'branch',repo:'wrong',sha:'abc'});assert.equal(exact.total,0,'nonempty exact filters are never discarded');
 const empty=await T.call('which_analyses_exist',{workspace:'missing'});
 assert.equal(empty.total,0);assert.match(empty.guidance,/No retained analysis matches/);
 assert.equal(empty.next.insideCodeCall,'tools.which_analyses_exist');
});

test('canonical schemas stay simple while encoded assumptions and explicit scalar spellings normalize',async()=>{
 const profile=await T.schemas({profile:'code-semantic'}),schema=profile.find(t=>t.name==='where_value_flows').inputSchema;
 assert.equal(schema.properties.assumptions.type,'array');assert.equal(schema.properties.argument.type,'integer');
 assert.equal(profile.length,7);
 let received;S.query=async a=>{received=a;return raw();};
 const input={analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:'02',assumptions:JSON.stringify({expression:'discount < 0',holds:'FALSE'})};
 await T.call('where_value_flows',input);
 assert.equal(received.to.argument,2);assert.deepEqual(received.assumptions,[{expression:'discount < 0',holds:false}]);
 assert.equal(typeof input.assumptions,'string','normalization never mutates caller inputs');
 for(const assumptions of ['not json','true',JSON.stringify([{expression:'discount < 0',holds:'yes'}])]){
  let invoked=false;S.query=async()=>{invoked=true;return raw();};
  await assert.rejects(T.call('where_value_flows',{...input,assumptions}),/assumptions|holds/);
  assert.equal(invoked,false);
 }
});

test('all question summaries carry explicit proof limits and failure recovery reads the completed projection',async()=>{
 let queries=0;S.query=async a=>{queries++;const r=raw();r.request={arguments:{from:{name:'charge',parameter:'discount'}}};return r;};
 const failed=await T.call('code',{code:"const r=await tools.where_value_flows({analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2}); console.log('retrieved'); return r.proof.sourceCoverage.complete;"});
 assert.equal(failed.ok,false);assert.equal(queries,1);
 assert.match(failed.diagnostic.message,/proof and sourceCoverage separate/);
 assert.equal(failed.toolResults[0].readScope,'tool-response');
 const full=require('../lib/chat-context').read(failed.toolResults[0].read.arguments).value;
 assert.equal(full.summary.argumentExpression,'net');
 assert.equal(full.summary.proofLimits.proof.status,'inconclusive');
 assert.equal(full.summary.proofLimits.sourceCoverage.truncated,true);
 const recovered=await T.call('code',failed.diagnostic.retry.arguments);
 assert.equal(recovered.ok,true,JSON.stringify(recovered));
 assert.equal(recovered.returned.argumentExpression,'net');
 assert.equal(recovered.returned.proofLimits.sourceCoverage.truncated,true);
 assert.equal(queries,1,'local formatting recovery must not query the source again');
});

test('list_analyses inside code is an explicit permission-checked alias with canonical provenance',async()=>{
 let reads=0;S.index=async()=>{reads++;return {analyses:[{id:'pin',repo:'P/repo',sha:'abc'}]};};
 const r=await T.call('code',{code:'return await tools.list_analyses({});'});
 assert.equal(r.ok,true);assert.equal(r.returned.analyses[0].id,'pin');
 assert.deepEqual(r.provenance.successfulTools,['which_analyses_exist']);
 assert.equal(reads,1);
 const access=require('../lib/access');
 const denied=await access.run({principalId:'limited',storyId:'limited',multiUser:true,role:'user',tools:['code']},()=>T.call('code',{code:'return await tools.list_analyses({});'}));
 assert.equal(denied.ok,false);assert.equal(reads,1,'alias cannot bypass target grants');
});

test('all question results preserve their protocol, full proof and retained-evidence scope',async()=>{
 S.query=async()=>({...raw(),protocol:'dt.semantic/v1',proof:{...raw().proof,detail:'full-proof-detail'}});
 const r=await T.call('where_value_flows',{analysis:'pin',entry:'charge',parameter:'discount',sink:'store',argument:2,all:true});
 assert.equal(r.protocol,'dt.semantic-navigation/v1');
 assert.equal(r.proof.detail,'full-proof-detail');
 assert.equal(r.truncated,true,'upstream bounds remain explicit');
 assert.equal(r.output.status,'all');
 const delivered=require('../lib/chat-pressure').response('where_value_flows',r,{all:true}).value;
 assert.equal(delivered.protocol,'dt.semantic-navigation/v1');
 assert.equal(delivered.modelContext.output.status,'all','all retained evidence is delivered');
 assert.equal(delivered.modelContext.output.source,'partial','source is separately bounded');
});
