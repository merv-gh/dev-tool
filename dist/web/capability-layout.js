/* Shared deterministic geometry for the live graph, sandboxed snapshots and SVG export. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.dtCapabilityLayout=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 function scene(model,{object='',query=''}={}){
  const all=model.nodes,byId=new Map(all.map(n=>[n.id,n])),words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let tools=all.filter(n=>n.kind==='tool');
  if(object){const ids=new Set(model.edges.filter(e=>e.from==='object:'+object&&e.kind==='question').map(e=>e.to));if(object==='task')for(const e of model.edges.filter(e=>e.from==='object:task'&&['object:workspace','object:context','object:memory'].includes(e.to)))for(const q of model.edges.filter(q=>q.from===e.to&&q.kind==='question'))ids.add(q.to);tools=tools.filter(n=>ids.has(n.id));}
  if(words.length)tools=tools.filter(n=>words.every(w=>(n.label+' '+n.description+' '+model.edges.filter(e=>e.to===n.id).map(e=>e.question).join(' ')).toLowerCase().includes(w)));
  const ids=new Set(tools.map(n=>n.id)),groups=all.filter(n=>n.kind==='object'&&model.edges.some(e=>e.from===n.id&&ids.has(e.to))&&(object? n.key===object||tools.some(t=>t.object===n.key):true));
  const nodes=[],edges=[],bounds=[],columns=[0,0,0,0];
  if(object==='task'&&!query){
   nodes.push({...byId.get('object:task'),x:234,y:14,w:190,h:70});
   const starters={workspace:'workspace_open',context:'context_open',memory:'project_context_find'};
   for(const [i,key]of Object.keys(starters).entries()){
    const group=byId.get('object:'+key),x=14+i*220;nodes.push({...group,x,y:225,w:190,h:70});
    edges.push({...model.edges.find(e=>e.from==='object:task'&&e.to===group.id),label:true,vertical:true,labelX:x+8,labelY:145,labelWidth:27});
    const t=byId.get('tool:'+starters[key]);if(t){nodes.push({...t,x,y:465,w:190,h:42});edges.push({...model.edges.find(e=>e.from===group.id&&e.to===t.id),label:true,vertical:true,labelX:x+8,labelY:380,labelWidth:27});}
   }
   return{nodes,edges,bounds:[],width:660,height:560,tools:nodes.filter(n=>n.kind==='tool').length,object,query,byId};
  }
  if(object||query){let y=28;for(const group of groups){const members=tools.filter(t=>model.edges.some(e=>e.from===group.id&&e.to===t.id));if(!members.length)continue;const h=Math.max(100,members.length*58+24);nodes.push({...group,x:16,y:y+12,w:190,h:70});for(let i=0;i<members.length;i++){const t=members[i],node={...t,id:t.id+'@'+group.key,toolId:t.id,x:620,y:y+12+i*58,w:260,h:42};nodes.push(node);const e=model.edges.find(e=>e.from===group.id&&e.to===t.id);edges.push({...e,to:node.id,label:true});}bounds.push({x:0,y,w:900,h});y+=h+30;}}
  else for(const group of groups){const members=tools.filter(n=>n.object===group.key);if(!members.length)continue;const col=columns.indexOf(Math.min(...columns)),x=col*840,y=columns[col]+24,h=Math.max(130,Math.ceil(members.length/2)*48+40);columns[col]=y+h+28;nodes.push({...group,x:x+14,y:y+22,w:190,h:70});members.forEach((t,i)=>{nodes.push({...t,x:x+300+(i%2)*250,y:y+16+Math.floor(i/2)*48,w:230,h:36});edges.push({...model.edges.find(e=>e.from===group.id&&e.to===t.id),label:false});});bounds.push({x,y,w:816,h});}
  const placed=new Set(nodes.map(n=>n.id));for(const e of model.edges.filter(e=>e.kind==='orientation'&&placed.has(e.from)&&placed.has(e.to)))edges.push({...e,label:false});
  return{nodes,edges,bounds,width:Math.max(900,...nodes.map(n=>n.x+n.w+20)),height:Math.max(260,...bounds.map(b=>b.y+b.h+20)),tools:tools.length,object,query,byId};
 }
 return{scene};
});
