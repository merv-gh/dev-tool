const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-path-trace-'));Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_LOG:'quiet'});for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR'])delete process.env[k];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const Q=require('../lib/semantic-query'),Trace=require('../lib/semantic-path-trace');let seq=0;
function analysis(sha){const id='trace-'+(++seq),dir=path.join(home,id);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'projection.jsonl'),[
 {type:'meta',protocol:'dt.semantic.projection/v1'},
 {type:'symbol',id:'10',name:'submit',fullName:'Payment.submit:long(long,long)',file:'src/Payment.java',line:3,endLine:20,parameters:[{id:'11',name:'gross',index:1},{id:'12',name:'rebate',index:2}],returnId:'13'},
 {type:'call',id:'20',name:'save',methodFullName:'Ledger.save:void(long)',caller:'10',file:'src/Payment.java',line:12,arguments:[{id:'21',index:1,code:'payable'}]},
 {type:'summary',truncated:false,gaps:[]}].map(JSON.stringify).join('\n'));return{id,dir,repo:'SHOP/payments',sha:sha.repeat(40),language:'java',ports:[]};}
const args=()=>({operation:'trace',from:{kind:'method',name:'submit',parameter:'rebate'},to:{kind:'call',name:'save',argument:1}});
const response=(mode,code='payable',line=12)=>({records:[{type:'path',kind:mode==='dataflow'?'data-flow':'control-flow',nodes:[{nodeId:'12',file:'src/Payment.java',line:3,code:'long rebate',label:'METHOD_PARAMETER_IN'},{nodeId:'21',file:'src/Payment.java',line,code,label:'IDENTIFIER'}],conditions:mode==='dataflow'?[]:[{expression:'rebate < 0',polarity:'false',status:'path_condition'}],proof:{status:mode==='dataflow'?'static-dataflow':'path_condition',feasibility:'unknown'}},{type:'summary',truncated:false,gaps:[]}]});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('trace keeps revisions and data/control evidence independent, with an honest changed-path briefing',async()=>{
 const a=analysis('a'),b=analysis('b'),calls=[];const value=await Q.query({...args(),assumptions:[{expression:'rebate < 0',holds:false}]},[a,b],{runQuery:async(item,r)=>{calls.push([item.id,r.mode,r.fromNodeIds,r.toNodeIds]);return response(r.mode,item.id===a.id?'gross':'payable');}});
 assert.deepEqual(calls.map(c=>c.slice(0,2)),[[a.id,'dataflow'],[a.id,'controlflow'],[b.id,'dataflow'],[b.id,'controlflow']]);
 assert.deepEqual(calls[0].slice(2),[['12'],['21']]);assert.deepEqual(calls[1].slice(2),[['10'],['20']]);
 assert.equal(value.assessment.status,'static-path-changed');assert.equal(value.assessment.behaviorVerified,false);assert.equal(value.proof.feasibility,'unknown');assert.equal(value.sides[0].data.paths[0].assumptionEvaluation.status,'unresolved');assert.equal(value.sides[0].control.paths[0].assumptionEvaluation.status,'matches-assumptions');assert.ok(value.changes.some(r=>r.change==='changed'&&r.before.nodes.at(-1).code==='gross'&&r.after.nodes.at(-1).code==='payable'));assert.equal(value.request.tool,'semantic_trace');
});
test('arbitrary exact line endpoints reach the CPG without becoming enclosing-method selectors; after lines are independent',async()=>{
 const a=analysis('a'),b=analysis('b'),seen=[];const from={kind:'line',file:'src/Payment.java',line:8,nodeLabel:'IDENTIFIER',code:'gross'},to={kind:'line',file:'src/Payment.java',line:12,code:'payable',column:15};
 const value=await Q.query({operation:'trace',from,to,after_from:{...from,line:18},after_to:{...to,line:22}},[a,b],{runQuery:async(item,r)=>{seen.push([item.id,r.fromLocation,r.toLocation]);return response(r.mode,'payable',item.id===a.id?12:22);}});
 assert.equal(seen.length,4);assert.equal(seen[0][1].line,8);assert.equal(seen[2][1].line,18);assert.equal(seen[2][2].line,22);assert.equal(value.assessment.status,'no-observed-path-change');assert.ok(value.changes.every(r=>r.change==='unchanged'));
});
test('ambiguous line candidates and missing final summaries stay inconclusive, never verified removals',async()=>{
 const a=analysis('a'),b=analysis('b');const value=await Q.query({...args(),from:{kind:'line',file:'src/Payment.java',line:8}},[a,b],{runQuery:async(item,r)=>item.id===a.id?response(r.mode):{records:[{type:'endpoints',status:'ambiguous',from:[{nodeId:'3'},{nodeId:'4'}],to:[]},{type:'summary',truncated:false,gaps:[]}]}});
 assert.equal(value.assessment.status,'inconclusive');assert.equal(value.sides[1].data.status,'unavailable');assert.equal(value.sides[1].data.endpoints[0].from.length,2);assert.ok(value.changes.every(r=>r.change==='inconclusive'));assert.equal(value.sides[1].data.paths.length,0);
 const partial=await Q.query(args(),[a,b],{runQuery:async(item,r)=>({records:response(r.mode).records.slice(0,1)})});assert.equal(partial.assessment.status,'inconclusive');assert.equal(partial.truncated,true);
});
test('assumptions retain contradictions and unknowns without filtering value paths or asserting a solver result',()=>{
 const p={conditions:[{expression:'rebate < 0',polarity:'true',status:'path_condition'}]},a=[{expression:'rebate < 0',holds:false}];
 assert.equal(Trace.underAssumptions(p,a,'control').status,'contradicts-assumptions');assert.equal(Trace.underAssumptions(p,a,'data').status,'unresolved');assert.equal(Trace.underAssumptions(p,[{expression:'different',holds:true}],'control').status,'unresolved');assert.equal(Trace.underAssumptions(p,[],'control').status,'unconditioned');
});
test('trace rejects mismatched snapshots and unsafe line selectors before executing queries',async()=>{
 const a=analysis('a'),b=analysis('b');await assert.rejects(Q.query(args(),[a,a]),/distinct/);await assert.rejects(Q.query(args(),[a,{...b,repo:'OTHER/service'}]),/same repository/);await assert.rejects(Q.query({...args(),from:{kind:'line',file:'../secret',line:1}},[a]),/relative/);await assert.rejects(Q.query({...args(),assumptions:[{expression:'x',holds:'yes'}]},[a]),/boolean/);await assert.rejects(Q.query({...args(),after_to:{name:'save'}},[a]),/two analyses/);
});
test('trace preview retains assessment, summary and reproducible view within the model byte budget',async()=>{
 const a=analysis('a'),b=analysis('b');const full=await Q.query(args(),[a,b],{runQuery:async(item,r)=>response(r.mode,item.id===a.id?'gross':'payable')});const original=JSON.stringify(full),preview=Trace.compact({...full,view:'http://localhost/show/example'},4096);assert.ok(Buffer.byteLength(JSON.stringify(preview))<=4096);assert.equal(preview.assessment.status,'static-path-changed');assert.equal(preview.proof.behaviorVerified,false);assert.equal(preview.summary.length,2);assert.equal(preview.view,'http://localhost/show/example');assert.equal(JSON.stringify(full),original);
});

test('a bounded control layer preserves a complete value-path change without asserting control removals',async()=>{
 const a=analysis('a'),b=analysis('b');const result=await Q.query(args(),[a,b],{runQuery:async(item,r)=>{const v=response(r.mode,item.id===a.id?'gross':'payable');if(r.mode==='controlflow')v.records.at(-1).truncated=true;return v;}});assert.equal(result.assessment.status,'partial-static-path-change');assert.equal(result.assessment.layers.data,'static-path-changed');assert.equal(result.assessment.layers.control,'inconclusive');assert.ok(result.changes.some(c=>c.layer==='data'&&c.change==='changed'));assert.ok(result.changes.filter(c=>c.layer==='control').every(c=>c.change==='inconclusive'));assert.equal(result.assessment.behaviorVerified,false);
});

test('large retained context and many small UTF-8 metadata fields cannot overflow the compact budget',async()=>{
 const a=analysis('a'),b=analysis('b'),full=await Q.query(args(),[a,b],{runQuery:async(item,r)=>response(r.mode)});for(const side of full.sides){side.context={status:'bounded',methods:Array(40).fill({signature:'Library.handle'}),facts:Array(600).fill({expression:'返却額 >= 0'}),complete:false};side.data.receiverLineage={attempts:Array(4).fill({segments:Array(3).fill({gaps:Array(20).fill({detail:'unknown dispatch'})})})};}
 full.optional=undefined;for(let i=0;i<30;i++)full['small'+i]='検証'.repeat(80);full.contextChanges=Array(80).fill({change:'changed',before:[{expression:'返却額 > 0'}],after:[{expression:'返却額 >= 0'}]});const original=JSON.stringify(full),preview=Trace.compact({...full,view:'http://localhost/show/retained'},4096);assert.ok(Buffer.byteLength(JSON.stringify(preview))<=4096);assert.equal(preview.proof.behaviorVerified,false);assert.equal(preview.summary[0].contextFacts,600);assert.equal(preview.view,'http://localhost/show/retained');assert.ok(preview.previewTruncated);assert.equal(JSON.stringify(full),original);
 // Previously retained jobs do not have context metadata.
 for(const side of full.sides)delete side.context;assert.doesNotThrow(()=>Trace.compact(full,4096));
});
