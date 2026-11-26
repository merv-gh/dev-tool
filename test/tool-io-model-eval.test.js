const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../dev/summarize-tool-io-model.cjs'),E=require('../dev/eval-tool-io-model.cjs');
const rows=[31,7,83,29,2,41,67,5,19,53,11,97].map((value,id)=>({id,value,payload:'fixture'}));
const sample=(result)=>({id:'full-result',events:[{ok:true,tool:'result_read',result}],final:'{"sum":445}'});
test('real-model grading accepts complete root objects and selected arrays as equivalent evidence',()=>{
  for(const [path,value]of [['',{rows}],['/rows',rows]])assert.deepEqual(G.grade(sample({id:'r',path,value,complete:true})),{passed:true,fullDataRecovered:true,correctSum:true});
  assert.equal(G.grade({...sample({id:'r',path:'/rows',value:rows}),final:'{"sum":121}'}).passed,false);
  assert.equal(G.grade({id:'single-test',events:[],final:'All tests passed.'}).passed,false);
});
test('paged evidence must be contiguous and complete; repeated pages cannot inflate recovery',()=>{
  const text=JSON.stringify(rows),part=(startByte,end,complete)=>({ok:true,tool:'result_read',result:{id:'r',path:'/rows',startByte,text:text.slice(startByte,end),complete}});
  const events=[part(0,20,false),part(20,text.length,true)];
  assert.deepEqual(G.recoveredRows({events}),rows);assert.deepEqual(G.recoveredRows({events:[...events,events[0]]}),rows);
  assert.equal(G.recoveredRows({events:events.slice(1)}),null);assert.equal(G.recoveredRows({events:events.slice(0,1)}),null);
});
test('model evaluation stays local and bounded, with unsupported cases rejected',()=>{
  assert.throws(()=>E.options(['--endpoint','https://example.com','--output','/tmp/report']),/local/);
  assert.throws(()=>E.options(['--max-turns','999','--output','/tmp/report']),/bounded/);
  assert.throws(()=>E.options(['--cases','unknown','--output','/tmp/report']),/Unknown case/);
});
