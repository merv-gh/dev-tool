const {getShortestPaths}=require('xstate/graph');
const {machines,eventsFor}=require('./machines.cjs');
function nodesOf(machine){const out=[],todo=[machine.root];while(todo.length){const n=todo.shift();out.push(n);todo.push(...Object.values(n.states));}return out;}
function analyzeMachines(models=machines){
 const out=[];
 for(const [id,machine]of Object.entries(models)){
  const started=performance.now(),nodes=nodesOf(machine),atomic=nodes.filter(n=>!Object.keys(n.states).length),edges=[],edgeIds=new Map();
  for(const n of nodes)for(const [event,transitions]of n.transitions)transitions.forEach((t,i)=>{const key=n.id+':'+event+':'+i;edgeIds.set(t,key);edges.push({id:key,source:n.id,event,targets:(t.target||[]).map(n=>n.id),guard:typeof t.guard==='object'?t.guard.type:t.guard||null});});
  const reached=new Set(),covered=new Set(),witnesses={},fixtures=eventsFor(machine);let explored=0;
  for(const profile of [{canRead:true,canWrite:true,admin:true},{canRead:true,canWrite:false,admin:false}]){
   const paths=getShortestPaths(machine,{input:profile,events:s=>fixtures.filter(e=>machine.getTransitionData(s,e).length),limit:10000});explored+=paths.length;
   for(const p of paths){for(const n of p.state._nodes){reached.add(n.id);if(!witnesses[n.id])witnesses[n.id]=p.steps.map(s=>s.event).filter(e=>e.type!=='xstate.init');}
    for(const event of fixtures)for(const t of machine.getTransitionData(p.state,event)){const key=edgeIds.get(t);if(!key)throw Error('Unknown selected transition in '+id);covered.add(key);}
   }
  }
  out.push({id,label:machine.config.meta.label,nodes:nodes.length,atomicStates:atomic.length,transitions:edges.length,exploredConfigurations:explored,reachedAtomic:atomic.filter(n=>reached.has(n.id)).length,coveredTransitions:covered.size,unreachable:atomic.filter(n=>!reached.has(n.id)).map(n=>n.id),uncoveredEdges:edges.filter(e=>!covered.has(e.id)),deadEnds:atomic.filter(n=>n.type!=='final'&&!n.transitions.size).map(n=>n.id),edges,witnesses,durationMs:Math.round((performance.now()-started)*100)/100});
 }
 return out;
}
module.exports={nodesOf,analyzeMachines};
