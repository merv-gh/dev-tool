const test=require('node:test'),assert=require('node:assert/strict'),{parse}=require('../dev/eval-answer.cjs');
const types={entry:'string',count:'number',mapComplete:'boolean',mapView:'string'},fence=String.fromCharCode(96).repeat(3);
test('explicit final facts supplement JSON without inventing missing values',()=>{
 const p=parse(fence+'json\n{"entry":"submit","count":6,"mapView":"http://localhost/show/x"}\n'+fence+'\n- **mapComplete**: false (retained map is partial)',types);
 assert.equal(p.answer.mapComplete,false);assert.deepEqual(p.supplemented,['mapComplete']);assert.equal(p.formatCompliant,false);
 assert.equal(parse('{"entry":"submit"}',types).answer.mapComplete,undefined);
});
test('contradictory explicit facts fail even when one representation looks correct',()=>{
 const p=parse(fence+'json\n{"count":6,"mapComplete":false}\n'+fence+'\n- **count**: 9\n- **mapComplete**: true',types);
 assert.deepEqual(p.conflicts,['count','mapComplete']);
 assert.ok(parse(fence+'json\n{"count":6}\n'+fence+'\n'+fence+'json\n{"count":9}\n'+fence,types).conflicts.includes('count'));
});
test('strict JSON, explicit scalar spellings and link targets remain distinguishable',()=>{
 assert.equal(parse('{"count":6,"mapComplete":false}',types).formatCompliant,true);
 const b=parse('{"count":"6","mapComplete":"false","mapView":"[map](http://localhost/show/x)"}',types);
 assert.equal(b.answer.count,6);assert.equal(b.answer.mapComplete,false);assert.equal(b.answer.mapView,'http://localhost/show/x');assert.equal(b.formatCompliant,false);
 assert.deepEqual(parse('No complete source evidence was supplied.',types).answer,{});
 assert.equal(parse('count: 1,703',types).answer.count,undefined,'never read a partial numeric token');
});
