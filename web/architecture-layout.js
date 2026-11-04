/* Deterministic, bounded layout shared by the native canvas and standalone exports. */
(function(root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.dtArchitectureLayout = factory(); })(typeof globalThis === 'object' ? globalThis : this, function() {
  const colors = { service:'blue', ui:'green', person:'green', system:'blue', topic:'orange', database:'purple', table:'purple', component:'blue', replica:'gray', library:'gray', external:'gray', group:'blue' };
  function layout(model) {
    const nodes = [], containers = [], placed = new Set(), all = new Map(model.nodes.map(n => [n.id,n])); let cursorY = 70;
    const add = (n,x,y,w=220,h=88) => { if (placed.has(n.id)) return; placed.add(n.id); nodes.push({ ...n, x,y,w,h }); };
    if (model.type === 'landscape') {
      model.nodes.forEach((n,i) => add(n,40+(i%4)*300,70+Math.floor(i/4)*160,272,132));
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
