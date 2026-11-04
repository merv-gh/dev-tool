/* Deterministic, bounded layout shared by the native canvas and standalone exports. */
(function(root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.dtArchitectureLayout = factory(); })(typeof globalThis === 'object' ? globalThis : this, function() {
  const colors = { service:'blue', ui:'green', person:'green', system:'blue', topic:'orange', database:'purple', table:'purple', component:'blue', replica:'gray', library:'gray', external:'gray', group:'blue' };
  function layout(model) {
    const nodes = [], containers = [], placed = new Set(), all = new Map(model.nodes.map(n => [n.id,n])); let cursorY = 70;
    const add = (n,x,y,w=220,h=88) => { if (placed.has(n.id)) return; placed.add(n.id); nodes.push({ ...n, x,y,w,h }); };
    if (model.type === 'landscape') {
      model.nodes.forEach((n,i) => add(n,40+(i%4)*300,70+Math.floor(i/4)*160,272,132));
    } else if (model.dossier) {
      if(model.type==='container'){
        const root=model.nodes.find(n=>n.kind==='service'),incoming=new Set(model.relations.filter(e=>e.to===root?.id).map(e=>e.from)),left=model.nodes.filter(n=>n!==root&&incoming.has(n.id)),right=model.nodes.filter(n=>n!==root&&!incoming.has(n.id));
        const rows=Math.max(left.length,Math.min(5,right.length),1),middle=80+(rows-1)*65;
        if(root)add(root,390,middle,240,104);
        left.forEach((n,i)=>add(n,40,80+i*130,235,86));right.forEach((n,i)=>add(n,760+Math.floor(i/5)*290,80+(i%5)*130,240,86));
      }else{
        const adjacency=new Map(),dist=new Map(),roots=model.flow?.handler?[model.flow.handler]:(model.dossier.code.flows||[]).map(f=>f.handler).filter(id=>all.has(id));
        for(const e of model.relations){if(!adjacency.has(e.from))adjacency.set(e.from,[]);adjacency.get(e.from).push(e.to);}
        if(!roots.length&&model.nodes.length)roots.push(model.nodes[0].id);const queue=[...new Set(roots)];queue.forEach(id=>dist.set(id,0));for(let i=0;i<queue.length;i++)for(const id of adjacency.get(queue[i])||[])if(!dist.has(id)){dist.set(id,(dist.get(queue[i])||0)+1);queue.push(id);}
        const methodMax=Math.max(0,...model.nodes.filter(n=>n.kind==='component').map(n=>dist.get(n.id)||0)),ys=new Map(),visiting=new Set();let leaf=0;
        function y(id){if(ys.has(id))return ys.get(id);if(visiting.has(id))return 80;visiting.add(id);const children=[...new Set(adjacency.get(id)||[])].filter(to=>to!==id&&!visiting.has(to)),value=children.length?children.map(y).reduce((a,b)=>a+b,0)/children.length:80+leaf++*125;ys.set(id,value);visiting.delete(id);return value;}
        roots.forEach(y);for(const n of model.nodes){const depth=n.kind==='component'?(dist.get(n.id)||0):methodMax+1;add(n,40+depth*310,y(n.id),240,88);}
        const methods=nodes.filter(n=>n.kind==='component');if(methods.length){const x=Math.min(...methods.map(n=>n.x))-16,y=Math.min(...methods.map(n=>n.y))-38,w=Math.max(...methods.map(n=>n.x+n.w))-x+16,h=Math.max(...methods.map(n=>n.y+n.h))-y+22;containers.push({id:'boundary:service',name:model.dossier.service,declared:true,x,y,w,h,children:methods.map(n=>n.id)});}
      }
    } else if (['dynamic','dataflow'].includes(model.type)) {
      // First occurrence order remains readable even with cycles and repeated interactions.
      model.nodes.forEach((n,i) => add(n,40+(Math.floor(i/3)%2?2-i%3:i%3)*330,100+Math.floor(i/3)*220));
    } else {
      for (const group of model.groups || []) {
        const members = group.members.map(id=>all.get(id)).filter(Boolean).filter(n=>!placed.has(n.id)); if (!members.length) continue;
        const height = 65+Math.ceil(members.length/4)*130;
        containers.push({ ...group, id:'boundary:'+group.id, x:24,y:cursorY-24,w:1160,h:height, children:members.map(n=>n.id) });
        members.forEach((n,i)=>add(n,44+(i%4)*280,cursorY+22+Math.floor(i/4)*130)); cursorY+=height+24;
      }
      const loose = model.nodes.filter(n=>!placed.has(n.id)); loose.forEach((n,i)=>add(n,44+(i%4)*280,cursorY+Math.floor(i/4)*130));
    }
    const byId = new Map(nodes.map(n=>[n.id,n]));
    const edges = model.relations.filter(e=>byId.has(e.from)&&byId.has(e.to)).map(e=>({ ...e, a:byId.get(e.from), b:byId.get(e.to) }));
    const width = Math.max(640,...nodes.map(n=>n.x+n.w+40),...containers.map(n=>n.x+n.w+24)), height = Math.max(260,...nodes.map(n=>n.y+n.h+60),...containers.map(n=>n.y+n.h+30));
    return { nodes, edges, containers, width, height };
  }
  function canvas(model) {
    const l=layout(model);
    return { nodes:l.nodes.map(n=>({ id:n.id,Label:{text:n.name},Position:{x:n.x,y:n.y},Size:{w:n.w,h:n.h},NodeType:['database','table'].includes(n.kind)?'database':n.kind==='topic'?'kafka':'rounded',Color:n.deployments?.[model.env]?.critical>0||n.status==='critical'?'red':colors[n.kind]||'gray',Description:n.kind==='group'?`${n.memberCount} applications · ${n.deployments?.[model.env]?.total ?? '?'} replicas · ${n.deployments?.[model.env]?.critical ?? 0} critical`:`${n.kind} · ${n.technology||n.source||'declared'}`,DescriptionPlacement:'inside' })), edges:l.edges.map((e,i)=>({id:e.id||'e'+i,From:e.from,To:e.to,Label:{text:(e.order?e.order+'. ':'')+e.label},Kind:['declared','candidate'].includes(e.certainty)?'dashed':'plain'})), containers:l.containers.map(c=>({id:c.id,Label:{text:c.name+(c.declared?' · declared boundary':' · prefix group')},Position:{x:c.x,y:c.y},Size:{w:c.w,h:c.h},ContainerType:'group',AutoFit:false,Color:'gray',Children:c.children.map(id=>({kind:'node',id}))})) };
  }
  return { layout, canvas, colors };
});
