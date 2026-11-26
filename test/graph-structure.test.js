const test=require('node:test'),assert=require('node:assert/strict'),G=require('../lib/graph-structure');
const nodes=(...ids)=>ids.map(id=>({id})),edge=(from,to,kind='control')=>({from,to,kind});
test('shared DAG successors do not become cycles; data edges are separate',()=>{
 assert.deepEqual(G.summarize(nodes('a','b','c','d'),[edge('a','b'),edge('a','c'),edge('b','d'),edge('c','d'),edge('d','a','data')]),{nodeCount:4,controlEdgeCount:4,hasControlCycle:false,graphStructureComplete:true});
});
test('self edges and disconnected cycles remain visible',()=>{
 assert.equal(G.summarize(nodes('a'),[edge('a','a')]).hasControlCycle,true);
 assert.equal(G.summarize(nodes('a','b','c'),[edge('b','c'),edge('c','b')]).hasControlCycle,true);
});
test('unknown endpoints and duplicate identities cannot establish acyclicity',()=>{
 assert.equal(G.summarize(nodes('a'),[edge('a','missing')]).hasControlCycle,null);
 assert.equal(G.summarize(nodes('a','a'),[]).graphStructureComplete,false);
 assert.equal(G.summarize(nodes('a'),[edge('a','a'),edge('a','missing')]).hasControlCycle,true);
});
test('long retained paths do not consume the JavaScript call stack',()=>{
 const n=20000,ns=Array.from({length:n},(_,i)=>({id:String(i)})),es=ns.slice(1).map((x,i)=>edge(String(i),x.id));
 assert.equal(G.summarize(ns,es).hasControlCycle,false);
 es.push(edge(String(n-1),'100'));assert.equal(G.summarize(ns,es).hasControlCycle,true);
});
