(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.dtUiTraceLayout=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  function project(model,expanded=[]){
    const open=new Set(expanded),byId=new Map(model.nodes.map(n=>[n.id,n])),groups=new Map();
    for(const g of model.groups){const id='service:'+g.service;if(!groups.has(id))groups.set(id,{...g,members:[]});groups.get(id).members.push(...g.members);}
    for(const g of groups.values())g.members=[...new Set(g.members)];
    const endpoint=id=>{const n=byId.get(id);return n?.service&&!open.has('service:'+n.service)?'service:'+n.service:id;};
    const nodes=model.nodes.filter(n=>!n.service||open.has('service:'+n.service)),edges=[],seen=new Set();
    for(const e of model.edges){const from=endpoint(e.from),to=endpoint(e.to),key=[from,to,e.kind,e.certainty].join('|');if(from===to||seen.has(key))continue;seen.add(key);edges.push({...e,from,to,original:e.id});}
    let serviceX=860;const placed=[],containers=[];const add=(n,x,y,w=240,h=88)=>placed.push({...n,x,y,w,h});
    const ui=nodes.find(n=>n.kind==='ui');if(ui)add(ui,30,110,340,280);
    nodes.filter(n=>n.kind==='request').forEach((n,i)=>add(n,450,70+i*126,260,92));
    for(const n of nodes.filter(n=>n.kind==='service')){
      const members=(groups.get(n.id)?.members||[]).map(id=>byId.get(id)).filter(Boolean);
      const slot=580;
      add({...n,summary:members.length+' static states'},serviceX+20,130,260,110);
      if(open.has(n.id)&&members.length){
        // Allocate a fixed service lane. Expanding never moves surrounding evidence.
        const start=placed.length-1;
        members.forEach((m,i)=>add(m,serviceX+20+(i%2)*280,300+Math.floor(i/2)*120,250,90));
        const inside=placed.slice(start),h=Math.max(...inside.map(n=>n.y+n.h))-100+24;
        containers.push({id:'group:'+n.id,name:n.name,x:serviceX,y:100,w:slot,h,members:inside.map(n=>n.id)});
      }
      serviceX+=slot+80;
    }
    const db=nodes.filter(n=>['table','function','procedure'].includes(n.kind));db.forEach((n,i)=>add(n,serviceX,70+i*215,260,95));
    const counts=new Map();for(const n of nodes.filter(n=>n.kind==='column')){const parent=model.edges.find(e=>e.to===n.id&&e.kind==='catalog-membership')?.from,index=Math.max(0,db.findIndex(n=>n.id===parent)),row=counts.get(parent)||0;counts.set(parent,row+1);add(n,serviceX+355+Math.floor(row/2)*250,70+index*215+(row%2)*98,220,80);}
    const color=n=>({ui:'green',request:'orange',service:'blue',column:'purple',table:'purple',function:'purple',procedure:'purple',decision:'orange',change:'green',throw:'red'})[n.kind]||'gray';
    return {nodes:placed,edges,containers,canvas:{nodes:placed.map(n=>({id:n.id,Label:{text:n.name?.slice(0,180)||n.kind},Position:{x:n.x+n.w/2,y:n.y+n.h/2},Size:{w:n.w,h:n.h},NodeType:['table','function','procedure','column'].includes(n.kind)?'database':'rounded',Color:color(n),Description:n.summary||[n.kind,n.file&&n.file+':'+n.line,n.type].filter(Boolean).join(' · '),DescriptionPlacement:'inside',...(n.kind==='ui'&&n.state?.image?{ImageSource:'data:'+n.state.image.mimeType+';base64,'+n.state.image.data,ImageAlt:'Last captured UI state'}:{})})),edges:edges.map(e=>({id:e.id,From:e.from,To:e.to,Label:{text:e.label},EdgeKind:['declared','candidate'].includes(e.certainty)?'dashed':'plain',Color:({observed:'green',static:'blue',detected:'blue',declared:'orange',candidate:'orange',catalog:'purple'})[e.certainty]||'gray'})),extensions:{containers:containers.map(c=>({id:c.id,Label:{text:c.name+' · retained static path'},Position:{x:c.x+c.w/2,y:c.y+c.h/2},Size:{w:c.w,h:c.h},ContainerType:'group',Color:'blue',AutoFit:false,Children:c.members.map(id=>({kind:'node',id}))}))}}};
  }
  return {project};
});
