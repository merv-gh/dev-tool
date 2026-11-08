const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-state-map-'));process.env.DT_HOME=home;process.env.DT_STATE_BACKEND='legacy';process.env.DT_LOG='quiet';
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR'])delete process.env[key];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const Q=require('../lib/semantic-query'),compact=require('../lib/semantic-response').compact;let sequence=0;
const method=(id,name,extra={})=>({type:'symbol',id:String(id),name,fullName:'App.'+name,signature:'long(long)',file:'src/App.java',line:1,parameters:[{id:'p'+id,name:'amount',index:1}],returnId:'r'+id,...extra});
function analysis(records,extra={}){const id='map-'+(++sequence),dir=path.join(home,id);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'projection.jsonl'),[{type:'meta',protocol:'dt.semantic.projection/v1'},...records,{type:'summary',truncated:false}].map(JSON.stringify).join('\n')+'\n');return{id,dir,repo:'P/app',sha:'1'.repeat(40),sourceDigest:'source',ports:[],...extra};}
const records=[method(1,'submit'),method(2,'save'),{type:'call',id:'10',caller:'1',name:'save',targets:['2'],methodFullName:'App.save',file:'src/App.java',line:5,arguments:[{index:1,code:'payable'}]}];
const worker=async(a,request)=>({records:[...request.methodNodeIds.flatMap(id=>[{type:'method',nodeId:id,entryState:id,exitState:'return'+id,parameters:[{index:1,name:'amount'}]},
 {type:'state',nodeId:id,methodId:id,kind:'entry',file:'src/App.java',line:1,code:id==='1'?'submit':'save'},
 {type:'state',nodeId:'change'+id,methodId:id,kind:'change',file:'src/App.java',line:3,code:'payable = gross - rebate',changes:[{target:'payable',expression:'gross - rebate'}]},
 {type:'state',nodeId:'return'+id,methodId:id,kind:'exit',file:'src/App.java',line:7,code:'Method exit'},
 {type:'edge',from:id,to:'change'+id,kind:'control',relation:'CFG'},
 {type:'edge',from:'change'+id,to:'return'+id,kind:'data',relation:'REACHING_DEF'}]),
 {type:'state',nodeId:'10',methodId:'1',kind:'call',file:'src/App.java',line:5,code:'save(payable)',arguments:[{index:1,expression:'payable'}]},
 {type:'summary',truncated:false,gaps:[]} ]});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('whole entry map retains actual state changes, CPG dependencies, callee bindings and exact origins',async()=>{
 const a=analysis(records),r=await Q.query({operation:'flowmap',from:{name:'submit'}},[a],{runQuery:worker}),m=r.flowMap;
 assert.equal(m.entries.length,1);assert.equal(m.methods.length,2);assert.equal(m.counts.changes,2);assert.equal(m.complete,false);assert.equal(r.proof.behaviorVerified,false);
 const call=m.edges.find(e=>e.kind==='call');assert.deepEqual(call.bindings,[{argument:1,expression:'payable',parameter:'amount',status:'positional-static-binding'}]);assert.equal(m.nodes.find(n=>n.id===call.from).exit,undefined);
 assert.ok(m.edges.some(e=>e.evidence.relation==='REACHING_DEF'));assert.ok(m.nodes.every(n=>n.repo===a.repo&&n.sha===a.sha&&n.locator.analysisId===a.id));assert.ok(!r.flowPlan);assert.deepEqual(r.mapRequest.from,{name:'submit'});
});
test('map discovery uses uniquely bound ingress ports, never orphan methods or an overloaded guess',async()=>{
 const a=analysis(records);let calls=0;const empty=await Q.query({operation:'flowmap'},[a],{runQuery:()=>{calls++;}});assert.equal(empty.flowMap.nodes.length,0);assert.equal(calls,0);assert.ok(empty.gaps.some(g=>g.kind==='entry-not-found'));
 a.ports=[{id:'ingress',type:'http-ingress',repo:a.repo,revision:a.sha,handler:{repo:a.repo,revision:a.sha,file:'src/App.java',line:1,signature:'App.submit'},evidence:{origin:'manual'},boundary:{method:'POST',path:'/submit'}}];
 const found=await Q.query({operation:'flowmap'},[a],{runQuery:worker});assert.equal(found.flowMap.entries.length,1);assert.ok(found.flowMap.nodes.find(n=>n.id===found.flowMap.entries[0]).ports.length);
 a.ports[0].handler.signature='long(long)';const unbound=await Q.query({operation:'flowmap'},[a],{runQuery:()=>assert.fail('an ambiguous ingress cannot become an entry')});assert.equal(unbound.flowMap.entries.length,0);assert.ok(unbound.gaps.some(g=>g.kind==='entry-not-found'));assert.ok(unbound.ambiguity.length);
 const b=analysis([method(1,'submit'),method(2,'submit',{fullName:'App.submit-overload'})]);const ambiguous=await Q.query({operation:'flowmap',from:{name:'submit'}},[b],{runQuery:()=>assert.fail('ambiguous entries must not execute')});assert.ok(ambiguous.gaps.some(g=>g.kind==='entry-ambiguous'));assert.equal(ambiguous.flowMap.nodes.length,0);
});
test('maps reject mixed branches and value-path arguments instead of drawing a merged graph',async()=>{
 const a=analysis(records),b=analysis(records,{sha:'2'.repeat(40)});
 await assert.rejects(Q.query({operation:'flowmap',from:{name:'submit'}},[a,b]),/one retained source snapshot/);
 for(const args of [{from:{name:'submit',parameter:'amount'}},{to:{name:'save'}},{cursor:'abc'}])await assert.rejects(Q.query({operation:'flowmap',...args},[a]),/whole entry methods/);
});
test('unavailable CPGs, clipped states and exact method budgets retain explicit coverage gaps',async()=>{
 const a=analysis(records),missing=await Q.query({operation:'flowmap',from:{name:'submit'}},[a]);assert.equal(missing.proof.status,'unavailable');assert.ok(missing.gaps.some(g=>g.kind==='flowmap-runtime-unavailable'));
 const failed=await Q.query({operation:'flowmap',from:{name:'submit'}},[a],{runQuery:async()=>{throw Error('CPG offline');}});assert.ok(failed.gaps.some(g=>g.kind==='flowmap-query-failed'));assert.equal(failed.flowMap.nodes.length,0);
 const bounded=await Q.query({operation:'flowmap',from:{name:'submit'},maxMethods:1},[a],{runQuery:async(a,request)=>{const r=await worker(a,request);r.records.push({type:'edge',from:'1',to:'omitted',kind:'control'},{type:'summary',truncated:true,gaps:['scan bounded']});return r;}});
 assert.equal(bounded.flowMap.methods.length,1);assert.ok(bounded.gaps.some(g=>g.kind==='method-budget'));assert.ok(bounded.gaps.some(g=>g.kind==='edge-endpoint-budget'));assert.equal(bounded.truncated,true);assert.ok(bounded.flowMap.edges.every(e=>bounded.flowMap.nodes.some(n=>n.id===e.from)&&bounded.flowMap.nodes.some(n=>n.id===e.to)));
});
test('compound source origins and compact model previews preserve proof and referential integrity',async()=>{
 const a=analysis(records.map(r=>({...r,file:'repos/app/src/App.java'})),{sources:[{prefix:'repos/app',repo:'P/app',sha:'1'.repeat(40)}]});
 const r=await Q.query({operation:'flowmap',from:{name:'submit'}},[a],{runQuery:async(a,q)=>{const r=await worker(a,q);for(const n of r.records)if(n.file)n.file='repos/app/'+n.file;return r;}});
 assert.ok(r.flowMap.nodes.every(n=>n.file==='src/App.java'));const copy=JSON.stringify(r);r.view='/show/example';
 const preview=compact(r,4096);assert.ok(Buffer.byteLength(JSON.stringify(preview))<=4096);assert.deepEqual(preview.proof,r.proof);assert.equal(preview.view,r.view);assert.match(preview.flowMap.identity,/Local preview aliases/);assert.ok(preview.flowMap.edges.every(e=>preview.flowMap.nodes.some(n=>n.id===e.from)&&preview.flowMap.nodes.some(n=>n.id===e.to)));delete r.view;assert.equal(JSON.stringify(r),copy);
});
test('large map previews bound arrays and expressions before byte budgeting and report every omission',()=>{
 const nodes=Array.from({length:400},(_,i)=>({id:'native-state-'+i,method:'method',kind:i?'call':'entry',code:'save('+('long-expression'.repeat(100))+')',arguments:Array.from({length:32},(_,index)=>({index,expression:'amount'.repeat(200)}))})),edges=nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id,kind:'control'}));
 const result={operation:'flowmap',view:'/show/retained',proof:{behaviorVerified:false},flowMap:{nodes,edges,entries:[nodes[0].id],methods:[{id:'method',entry:nodes[0].id,exit:nodes.at(-1).id}],ports:[],assumptions:[],complete:false}};
 const original=JSON.stringify(result),preview=compact(result,16384);assert.ok(Buffer.byteLength(JSON.stringify(preview))<=16384);assert.ok(preview.omitted['flowMap.nodes']>300);assert.ok(preview.omitted['flowMap.arguments']>0);assert.ok(preview.omitted['flowMap.text']>0);assert.equal(preview.previewTruncated,true);assert.equal(JSON.stringify(result),original);
 assert.ok(preview.flowMap.edges.every(e=>preview.flowMap.nodes.some(n=>n.id===e.from)&&preview.flowMap.nodes.some(n=>n.id===e.to)));
});
