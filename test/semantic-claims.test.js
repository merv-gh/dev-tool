const test=require('node:test'),assert=require('node:assert/strict'),C=require('../lib/semantic-claims');
const map={flowMap:{complete:false},truncated:true,gaps:[{},{}],proof:{kind:'entry-exit-state-map',status:'partial-static-map',runtime:'unknown',feasibility:'unknown',behaviorVerified:false}};
const trace={truncated:false,gaps:[],proof:{kind:'selected-path-comparison',status:'inconclusive',runtime:'unknown',feasibility:'unknown',behaviorVerified:false}};
test('static summaries must not invent runtime/feasibility/verification or coverage facts',()=>{
 const valid={proofLimits:{entryMap:C.limits(map),valueTrace:C.limits(trace)}};
 assert.equal(C.verify(valid,{map,trace}).valid,true);
 const bad=structuredClone(valid);bad.proofLimits.entryMap.proof.runtime='partial';bad.proofLimits.valueTrace.proof.feasibility='static-feasible';bad.proofLimits.entryMap.sourceCoverage.complete=true;
 const checked=C.verify(bad,{map,trace});assert.equal(checked.valid,false);assert.equal(checked.issues.length,3);
 assert.equal(checked.observed.entryMap.proof.runtime,'unknown');
 assert.equal(map.proof.runtime,'unknown','validation never changes retained evidence');
 assert.equal(C.verify({proofLimits:{runtime:'verified'}},{map}).valid,false);
 assert.equal(C.verify({proofLimits:{runtime:'unknown'}},{map}).valid,true);
});
test('map and trace proof scopes stay independent, including unknown completeness',()=>{
 assert.equal(C.verify({proofLimits:{entryMap:{sourceCoverage:{complete:null}}}},{map,trace}).valid,false);
 assert.equal(C.verify({proofLimits:{valueTrace:{sourceCoverage:{complete:null}}}},{map,trace}).valid,true);
 assert.equal(C.verify({summary:{behaviorVerified:true}},{map,trace}).valid,false);
 assert.equal(C.verify({unrelated:{kind:'business'}},{map,trace}).valid,true);
});

test('direct proof-limit kinds and statuses are evidence-scoped',()=>{
 assert.equal(C.verify({proofLimits:{entryMap:{status:'inconclusive'}}},{map,trace}).valid,false);
 assert.equal(C.verify({proofLimits:{valueTrace:{status:'inconclusive',kind:'selected-path-comparison'}}},{map,trace}).valid,true);
});
