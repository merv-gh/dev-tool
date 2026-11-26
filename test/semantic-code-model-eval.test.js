const test=require('node:test'),assert=require('node:assert/strict');
const {grade}=require('../dev/eval-semantic-code-model.cjs');
function fixture(){return {final:JSON.stringify({entry:'submit',exitCall:'save',sinkExpression:'payable',controlAssumption:'matches-assumptions',dataAssumption:'unresolved',behaviorVerified:false,mapComplete:false,evidenceViews:['/show/map','/show/trace']}),events:[{result:{views:['/show/map','/show/trace']}}],semanticCalls:[{arguments:{operation:'flowmap'},result:{flowMap:{nodes:[{}]}}},{arguments:{operation:'trace',from:{name:'submit',parameter:'rebate'},to:{name:'save',argument:1},assumptions:[{expression:'rebate < 0',holds:false}]},result:{sides:[{data:{paths:[{}]}}]}}]};}
test('semantic model evaluation requires executed evidence, exact endpoints and retained links',()=>{
 assert.equal(grade(fixture()).passed,true);
 for(const change of [r=>r.semanticCalls=[],r=>r.semanticCalls[1].arguments.from.parameter='gross',r=>r.semanticCalls[1].arguments.to.argument=2,r=>r.events=[]]){const r=fixture();change(r);assert.equal(grade(r).passed,false);}
});
test('semantic model evaluation keeps unknown value assumptions, incomplete coverage and runtime proof separate',()=>{
 for(const change of [a=>a.dataAssumption='matches-assumptions',a=>a.controlAssumption='unresolved',a=>a.behaviorVerified=true,a=>a.mapComplete=true,a=>a.evidenceViews=['/show/invented','/show/trace']]){const r=fixture(),a=JSON.parse(r.final);change(a);r.final=JSON.stringify(a);assert.equal(grade(r).passed,false);}
 const invalid=fixture();invalid.final='The analysis probably passes.';assert.equal(grade(invalid).passed,false);
});
