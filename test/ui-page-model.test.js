const test=require('node:test'),assert=require('node:assert/strict'),M=require('../lib/ui-page-model');
const base=()=>({version:1,title:'A page',inputs:{target:{type:'string',label:'Target',default:'orders'}},sources:[{id:'declared',rows:[{id:1,name:'A',value:2},{id:2,name:'B',value:3}]}],datasets:[],widgets:[{id:'rows',type:'table',title:'Records',data:'declared'}]});
test('page language rejects code, arbitrary tool side effects, unsafe paths, cycles and invalid references',()=>{
 for(const change of [d=>d.html='<script>bad()</script>',d=>d.sources=[{id:'read',tool:'workspace_push',arguments:{}}],d=>d.sources[0].select='constructor.name',d=>d.widgets[0].data='missing',d=>d.inputs.token={type:'string',label:'Token',default:'secret-value'},d=>d.sources.push({...d.sources[0]}),d=>d.datasets=[{id:'cycle',op:'concat',from:['cycle']}],d=>d.widgets[0].type='html']){const d=base();change(d);assert.throws(()=>M.normalize(d));}
 assert.throws(()=>M.bind({$param:'missing'},{}),/Unknown/);assert.throws(()=>M.bind(JSON.parse('{"__proto__":{"polluted":true}}'),{}),/Unsafe/);assert.equal({}.polluted,undefined);
});
test('typed inputs use exact references; SQL values are never interpolated',()=>{
 const d=M.normalize(base());assert.deepEqual(M.params(d,{}),{target:'orders'});const attack="x'; drop table x; --";assert.deepEqual(M.bind({sql:'select $1',params:[{$param:'target'}]},M.params(d,{target:attack})),{sql:'select $1',params:[attack]});assert.throws(()=>M.params(d,{unexpected:'x'}));assert.throws(()=>M.params(d,{target:42}));
 d.inputs.optional={type:'string',label:'Optional filter',required:false};assert.equal(M.bind({query:{$param:'optional'}},M.params(d,{})).query,undefined);
});
test('selection, concatenation and filters propagate incomplete evidence without evaluating expressions',()=>{
 const d=base();d.datasets=[{id:'selected',op:'select',from:'declared',fields:{key:'id',value:'value',env:{value:'dev'}}},{id:'kept',op:'filter',from:'selected',where:{field:'value',op:'gt',value:2}},{id:'combined',op:'concat',from:['selected','kept']}];M.normalize(d);const source=M.bounded(d.sources[0].rows,{complete:false,gaps:['truncated']}),r=M.derive(d,{declared:source},{});assert.deepEqual(r.kept.rows,[{key:2,value:3,env:'dev'}]);assert.equal(r.combined.rows.length,3);assert.equal(r.combined.complete,false);assert.deepEqual(r.combined.gaps,['truncated']);
 for(const [op,value,expected]of [['eq','A',true],['ne','A',false],['contains','a',true],['lt',3,false],['exists',null,true]])assert.equal(M.matches({name:'A'},{field:'name',op,value}),expected);
});
test('comparisons reject ambiguous keys, canonicalize object values and propagate upstream failures',()=>{
 const d={datasets:[{id:'diff',op:'compare',left:'a',right:'b',key:['id'],fields:['value']}]};let r=M.derive(d,{a:M.bounded([{id:1,value:{a:1,b:2}}]),b:M.bounded([{id:1,value:{b:2,a:1}},{id:2,value:0}])},{});assert.equal(r.diff.rows[0].status,'same');assert.equal(r.diff.rows[1].status,'only-right');
 r=M.derive(d,{a:M.bounded([{id:1},{id:1}]),b:M.bounded([])},{});assert.match(r.diff.error,/Duplicate/);r=M.derive(d,{a:M.bounded([{value:1}]),b:M.bounded([])},{});assert.match(r.diff.error,/key is missing/);r=M.derive(d,{a:{rows:[],error:'denied'},b:M.bounded([])},{});assert.equal(r.diff.error,'Upstream source unavailable');
});
test('row and byte limits explicitly mark clipping; incomplete comparisons leave missing sides unknown',()=>{
 const rows=Array.from({length:2002},(_,id)=>({id}));assert.equal(M.bounded(rows).rows.length,2000);assert.equal(M.bounded(rows).complete,false);assert.equal(M.bounded([{body:'x'.repeat(2200000)}]).rows.length,0);
 const d={datasets:[{id:'diff',op:'compare',left:'a',right:'b',key:['id'],fields:[]}]},r=M.derive(d,{a:M.bounded([{id:1}],{complete:false}),b:M.bounded([{id:2}],{complete:false})},{});assert.ok(r.diff.rows.every(r=>r.status==='unknown'));
});
test('a missing required value is unknown even when both rows were observed',()=>{
 const definition={datasets:[{id:'diff',op:'compare',left:'a',right:'b',key:['service'],fields:['version'],required:['version']}]};const r=M.derive(definition,{a:M.bounded([{service:'orders',version:null}]),b:M.bounded([{service:'orders',version:null}])},{});assert.equal(r.diff.rows[0].status,'unknown');
 const {version}=require('../lib/ui-page-data');assert.deepEqual(version({version:'{"build":{"version":"2.1"},"git":{"commit":{"id":"abc"}}}'}),{version:'2.1',commit:'abc'});assert.deepEqual(version({version:'2.0'}),{version:'2.0',commit:null});assert.deepEqual(version({meta:{version:'1.0',commit:'def'}}),{version:'1.0',commit:'def'});
});
