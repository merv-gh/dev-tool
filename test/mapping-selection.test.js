const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/mapping-selection'),{pointer}=require('../lib/mapping-debugger');
const rule={id:'name',label:'Document name',probe:'docs',row_id:'/id',filters:[{field:'/active',op:'eq',value:true},{field:'/annulled',op:'eq',value:false},{field:'/from',op:'lte',value_from:'/asOf'},{field:'/until',op:'gte',value_from:'/asOf',allow_null:true},{field:'/name',op:'nonblank'}],order:[{field:'/from',direction:'desc',type:'date'},{field:'/id',direction:'desc',type:'integer'}],fields:[{source_path:'/name',response_path:'/name'}],fallback:{probe:'registry',source_path:'/0',fields:[{source_path:'/name',response_path:'/name'}]}};
function receipts(){return {api:{state:'done',httpStatus:200,data:{asOf:'2026-11-20',name:'Changed'}},docs:{state:'done',data:[{id:'9',active:true,annulled:false,from:'2026-11-01',until:null,name:'Old'},{id:'10',active:true,annulled:false,from:'2026-11-01',until:'2026-11-20',name:'Changed'},{id:'11',active:true,annulled:true,from:'2026-11-19',until:null,name:'Revoked'}]},registry:{state:'done',data:[{name:'Registry'}]}};}
test('selection explains rejected rows and uses inclusive dates and numeric bigint tie-break',()=>{
  S.validate([rule],new Set(['docs','registry']),pointer);
  const r=S.evaluate(rule,receipts(),pointer);assert.equal(r.status,'equal');assert.equal(r.selected.id,'10');
  assert.equal(r.rows.find(x=>x.id==='11').rejected[0].field,'/annulled');
  assert.equal(r.proof.runtimeLineageVerified,false);assert.equal(r.comparisons[0].source,'Changed');
  const big=receipts();big.docs.data=big.docs.data.slice(0,2).map((r,i)=>({...r,id:i?'9007199254740993':'9007199254740992'}));assert.equal(S.evaluate(rule,big,pointer).selected.id,'9007199254740993');
});
test('selection exposes field mismatch and whole-row fallback',()=>{
  const rs=receipts();rs.api.data.name='Revoked';const r=S.evaluate(rule,rs,pointer);assert.equal(r.status,'different');assert.equal(r.comparisons[0].source,'Changed');
  rs.docs.data=[];rs.api.data.name='Registry';const f=S.evaluate(rule,rs,pointer);assert.equal(f.status,'equal');assert.deepEqual(f.selected,{probe:'registry',fallback:true});
});
test('large matching prefixes do not fabricate equality and repeated values cannot amplify evidence without a bound',()=>{
  const rs=receipts();rs.api.data.name='x'.repeat(100000)+'a';rs.docs.data[1].name='x'.repeat(100000)+'b';
  const r=S.evaluate(rule,rs,pointer);assert.equal(r.status,'different');assert.equal(r.comparisons[0].response.truncated,true);assert.ok(JSON.stringify(r).length<10000);
});
test('missing inputs, truncated rows, failed API and tied winners cannot certify equality',()=>{
  assert.equal(S.evaluate(rule,{},pointer).proof.contractEvaluated,false);
  for(const change of [r=>r.docs.truncated=true,r=>r.api.httpStatus=500,r=>delete r.docs.data[0].active,r=>r.docs.data[1].id='9',r=>r.docs.data[1].from='2026-02-30']){
    const rs=receipts();change(rs);const result=S.evaluate(rule,rs,pointer);assert.equal(result.status,'inconclusive');assert.ok(result.gaps.length);assert.ok(result.comparisons.every(c=>c.status==='inconclusive'));
  }
  const rs=receipts(),tied=structuredClone(rule);tied.order=tied.order.slice(0,1);assert.match(S.evaluate(tied,rs,pointer).gaps.join(' '),/tie/);
  rs.docs.data[0].name=' ';assert.equal(S.evaluate(rule,rs,pointer).rows[0].state,'excluded');
});
test('selection validation rejects missing/ambiguous contract inputs and unsafe structures',()=>{
  for(const change of [r=>r.filters[0].op='eval',r=>r.filters[0].value_from='/x',r=>delete r.filters[0].value,r=>r.order[0].direction='down',r=>r.probe='absent',r=>r.fields[0].source_path='name',r=>r.fallback.probe='absent']){
    const r=structuredClone(rule);change(r);assert.throws(()=>S.validate([r],new Set(['docs','registry']),pointer));
  }
  assert.throws(()=>S.validate([rule,rule],new Set(['docs','registry']),pointer));
});
test('compact decisions remain under 8 KiB even with many multibyte rows and large values; omissions are explicit',()=>{
  const original=S.evaluate(rule,receipts(),pointer),rows=Array.from({length:10},(_,i)=>({...original,id:'rule-'+i,label:'Правило'.repeat(20),rows:Array.from({length:100},(_,n)=>({id:n,state:'excluded',rejected:[{field:'/name',op:'eq',actual:'значение'.repeat(1000),expected:'Имя'}],unknown:[]}))}));
  const small=require('../lib/mapping-debugger').compactSelections(rows);assert.ok(Buffer.byteLength(JSON.stringify(small))<=8192);assert.equal(small.length,10);assert.ok(small.some(s=>s.rowsOmitted));assert.ok(small.every(s=>s.rowCount===s.rows.length+s.rowsOmitted));assert.equal(rows[0].rows.length,100);
  const extreme=rows.map((s,i)=>({...s,id:'a'.repeat(79)+i,probe:'b'.repeat(80),selected:{probe:'c'.repeat(80),fallback:true,id:'Я'.repeat(10000)}}));assert.ok(Buffer.byteLength(JSON.stringify(require('../lib/mapping-debugger').compactSelections(extreme)))<=8192);
});
