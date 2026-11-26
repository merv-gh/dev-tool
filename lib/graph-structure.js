// Structural facts over the entire retained graph, independent of source/runtime
// completeness. Iterative DFS avoids overflowing the stack on long methods.
function summarize(nodes=[],edges=[]){
 const control=edges.filter(e=>e.kind==='control'),adj=new Map(),color=new Map();let complete=true;
 for(const n of nodes){if(typeof n.id!=='string'||adj.has(n.id)){complete=false;continue;}adj.set(n.id,[]);}
 for(const e of control){if(!adj.has(e.from)||!adj.has(e.to)){complete=false;continue;}adj.get(e.from).push(e.to);}
 let cycle=false;
 for(const start of adj.keys()){
  if(color.has(start))continue;
  const stack=[[start,0]];color.set(start,1);
  while(stack.length&&!cycle){
   const frame=stack.at(-1),neighbors=adj.get(frame[0]);
   if(frame[1]===neighbors.length){color.set(frame[0],2);stack.pop();continue;}
   const next=neighbors[frame[1]++];
   if(color.get(next)===1){cycle=true;break;}
   if(!color.has(next)){color.set(next,1);stack.push([next,0]);}
  }
  if(cycle)break;
 }
 return {nodeCount:nodes.length,controlEdgeCount:control.length,hasControlCycle:cycle?true:complete?false:null,graphStructureComplete:complete};
}
module.exports={summarize};
