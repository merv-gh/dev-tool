const test=require('node:test'),assert=require('node:assert/strict');
const {grade}=require('../dev/eval-semantic-code-model.cjs');
function fixture(){return {final:JSON.stringify({entry:'submit',exitCall:'save',sinkExpression:'payable',controlAssumption:'matches-assumptions',dataAssumption:'unresolved',behaviorVerified:false,mapComplete:false,evidenceViews:['/show/map','/show/trace']}),events:[{result:{views:['/show/map','/show/trace']}}],semanticCalls:[{arguments:{operation:'flowmap'},result:{flowMap:{nodes:[{}]}}},{arguments:{operation:'trace',from:{name:'submit',parameter:'rebate'},to:{name:'save',argument:1},assumptions:[{expression:'rebate < 0',holds:false}]},result:{sides:[{data:{paths:[{}]}}]}}]};}
test('semantic model evaluation requires executed evidence, exact endpoints and retained links',()=>{
 assert.equal(grade(fixture()).passed,true);
 for(const change of [r=>r.semanticCalls=[],r=>r.semanticCalls[1].arguments.from.parameter='gross',r=>r.semanticCalls[1].arguments.to.argument=2,r=>r.events=[]]){const r=fixture();change(r);assert.equal(grade(r).passed,false);}
});
test('semantic model evaluation keeps unknown value assumptions, incomplete coverage and runtime proof separate',()=>{
 for(const change of [a=>a.dataAssumption='matches-assumptions',a=>a.controlAssumption='unresolved',a=>a.behaviorVerified=true,a=>a.mapComplete=true,a=>a.evidenceViews=['/show/invented','/show/trace'],a=>a.evidenceViews=['',''],a=>a.evidenceViews=['/show/map','/show/map']]){const r=fixture(),a=JSON.parse(r.final);change(a);r.final=JSON.stringify(a);assert.equal(grade(r).passed,false);}
 const invalid=fixture();invalid.final='The analysis probably passes.';assert.equal(grade(invalid).passed,false);
 const contradiction=fixture();contradiction.expectedAssumptionHolds=true;contradiction.semanticCalls[1].arguments.assumptions[0].holds=true;
 const answer=JSON.parse(contradiction.final);answer.controlAssumption='contradicts-assumptions';contradiction.final=JSON.stringify(answer);assert.equal(grade(contradiction).passed,true);
 contradiction.semanticCalls[1].arguments.assumptions[0].holds=false;assert.equal(grade(contradiction).passed,false);
});
test('question-name experiment changes names only and keeps the same all contract',()=>{
 const C=require('../dev/semantic-question-candidates.cjs'),plain=C.schemas(),questions=C.schemas(true);
 assert.deepEqual(plain.map(({name,...s})=>s),questions.map(({name,...s})=>s));
 assert.deepEqual(questions.map(s=>s.name),['which_analyses_exist','what_happens_from','where_value_flows']);
 assert.ok(plain.every(s=>s.inputSchema.properties.all.type==='boolean'));
});
test('candidate adapters call the production semantic tools and preserve raw evidence with all',async()=>{
 const C=require('../dev/semantic-question-candidates.cjs'),calls=[];
 const raw={truncated:false,proof:{status:'single-revision',behaviorVerified:false},assumptions:[{expression:'x < 0',holds:false}],sides:[{side:'current',data:{status:'static-candidates',paths:[{nodes:[{code:'payable',file:'Payment.java',line:12}],assumptionEvaluation:{status:'unresolved'}}]},control:{status:'static-candidates',paths:[{conditions:[{expression:'x < 0',polarity:'false'}],assumptionEvaluation:{status:'matches-assumptions'}}]}}],gaps:[{kind:'not-a-runtime-proof'}],view:'/show/retained'};
 const T={call:async(name,args)=>{calls.push({name,args});return raw;}};
 const args={analysis:'retained-id',entry:'submit',parameter:'rebate',sink:'save',assumptions:[{expression:'x < 0',holds:false}]};
 const result=await C.call(T,'where_value_flows',args);
 assert.deepEqual(calls[0],{name:'semantic_trace',args:{analysis:'retained-id',from:{kind:'method',name:'submit',parameter:'rebate'},to:{kind:'call',name:'save',argument:1},assumptions:args.assumptions,all:true}});
 assert.equal(result.sides[0].data.paths[0].assumptionEvaluation.status,'unresolved');assert.equal(result.sides[0].control.paths[0].assumptionEvaluation.status,'matches-assumptions');
 assert.equal(result.proof.behaviorVerified,false);assert.deepEqual(result.gaps,raw.gaps);assert.equal(result.view,raw.view);assert.equal(result.output.status,'part');
 assert.equal(await C.call(T,'value_trace',{...args,all:true}),raw);
 const brief=await C.call(T,'where_value_flows',args,true);
 assert.deepEqual(brief.declaredAssumptions,raw.assumptions);
 assert.equal(brief.assumptionChecks.data[0].evaluation,'unresolved');assert.equal(brief.assumptionChecks.control[0].evaluation,'matches-assumptions');
 assert.equal(brief.sinks[0].code,'payable');assert.equal(brief.proof.behaviorVerified,false);
 assert.match(C.schemas(true,true)[2].inputSchema.properties.assumptions.description,/Omitted or \[\] means none/);
 await assert.rejects(C.call(T,'value_trace',{...args,unexpected:true}),/Invalid argument/);
});
test('entry summaries exclude reached callees that are not selected entries',async()=>{
 const C=require('../dev/semantic-question-candidates.cjs');
 const raw={flowMap:{complete:false,entries:['entry:submit'],methods:[{name:'submit',entry:'entry:submit'},{name:'save',entry:'entry:save'}],nodes:[],assumptions:[]},proof:{behaviorVerified:false},view:'/show/map'};
 const r=await C.call({call:async()=>raw},'what_happens_from',{analysis:'id',entry:'submit'});
 assert.deepEqual(r.entries.map(m=>m.name),['submit']);
});
test('typed summaries separate returns, call boundaries and selected sink arguments',async()=>{
 const C=require('../dev/semantic-question-candidates.cjs');
 const map={flowMap:{complete:false,entries:['submit'],methods:[{name:'submit',entry:'submit'}],nodes:[{kind:'return',code:'return payable;'}, {kind:'throw',code:'throw invalid;'}, {kind:'call',code:'isBlank()',exit:'external-or-unexpanded-call'}],assumptions:[]},proof:{behaviorVerified:false},gaps:[{kind:'unresolved',detail:'external effect'},{kind:'unresolved',detail:'external effect'}],view:'/show/map'};
 const m=await C.call({call:async()=>map},'what_happens_from',{analysis:'id',entry:'submit'},true,true);
 assert.deepEqual(m.methodExits.map(n=>n.kind),['return','throw']);assert.equal(m.externalCallBoundaries[0].code,'isBlank()');assert.equal(m.coverage.gaps[0].occurrences,2);
 const path={assumptionEvaluation:{status:'matches-assumptions',unresolved:[],conflicts:[]},conditions:[{expression:'x < 0',polarity:'false'}]},trace={proof:{behaviorVerified:false},sides:[{side:'current',data:{paths:[],selectedValues:{to:[{name:'save',argument:2,value:'payable'}]}},control:{paths:[path,path]}}],view:'/show/trace'};
 const t=await C.call({call:async()=>trace},'where_value_flows',{analysis:'id',entry:'submit',parameter:'rebate',sink:'save',argument:2},true,true);
 assert.equal(t.selectedSinks[0].name,'save');assert.equal(t.selectedSinks[0].argument,2);assert.equal(t.assumptionChecks.control.length,1);assert.deepEqual(t.assumptionChecks.control[0].retainedPaths,[0,1]);
 assert.match(C.schemas(true,true,true)[1].description,/Keep both map and trace view links/);
});
