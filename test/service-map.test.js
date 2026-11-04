const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-map-'));process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{test:{},other:{}},browser:{sites:{shop:{url:'https://shop.example/',env:'test'}}}}));
const M=require('../lib/service-map'),F=require('../web/map-format'),T=require('../lib/tools');
const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
for(const [service,effective,extra]of [
 ['orders',{produces:[{topic:'orders.created',file:'Order.java',line:5}],tables:[{table:'sales.orders',access:'write',file:'OrderRepository.java',line:12}],endpoints:[{method:'GET',path:'/orders/{id}',file:'Order.java',line:9}]},{libraries:[{repo:'LIB/common',artifactId:'common'}],db:{datasources:[{db:'sales'}]}}],
 ['shipping',{consumes:[{topic:'orders.created',file:'Shipping.java',line:8}],calls:[{client:'orders',method:'GET',path:'/orders/{id}',file:'OrdersClient.java',line:4}]},{}],
 ['shop',{endpoints:[]},{}]])put(path.join(home,'passports',service,'passport.json'),{service,env:'test',repo:{project:'SHOP',repo:service,sha:'abc'},effective,...extra});
put(path.join(home,'cache/test/catalog.txt'),'pg sales sales.orders table ~1: id integer\npg other sales.orders table ~1: id integer\nkafka orders.created 1\nes orders 2\n');
put(path.join(home,'cache/routes.json'),{routes:{a:{host:'shop.example',method:'GET',path:'/orders/<id>',count:3,query:[],sources:[],statuses:{200:3}}}});
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home,{recursive:true,force:true}); });
test('binary format round trips UTF-8 without JSON, validates corruption and fixed column references',()=>{
 const bytes=F.encode([{id:'é',kind:'service',label:'注文'}],[],['test']);assert.equal(Buffer.from(bytes).subarray(0,6).toString(),'DTMAP1');assert.equal(F.decode(bytes).node(0).label,'注文');assert.throws(()=>F.decode(bytes.subarray(0,30)),/Invalid/);assert.throws(()=>F.encode([{id:'a'}],[{from:'a',to:'missing'}]),/Dangling/);
});
test('passports, db disambiguation, observed UI APIs, library visibility and graph direction retain evidence',async()=>{
 const summary=await M.overview({env:'test'});assert.equal(summary.counts.service,3);assert.equal(summary.counts.ui,1);assert.equal(summary.format,'DTMAP1');
 const search=await M.search({env:'test',query:'orders'});assert.match(search.text,/svc:orders/);assert.doesNotMatch((await M.search({env:'test',query:'common'})).text,/lib:/);assert.match((await M.search({env:'test',query:'common',include_libraries:true})).text,/lib:/);
 const edges=await M.neighbors({env:'test',id:'svc:orders'});assert.match(edges.text,/pg:sales:sales.orders/);assert.doesNotMatch(edges.text,/pg:other:sales.orders/);
 const route=await M.route({env:'test',from:'svc:orders',to:'svc:shipping'});assert.equal(route.found,true);assert.match(route.text,/orders.created/);assert.equal((await M.route({env:'test',from:'svc:shipping',to:'kafka:orders.created'})).found,true,'shipping -> orders HTTP -> produced event is a real dependency path');
 assert.match((await M.neighbors({env:'test',id:'ui:shop'})).text,/observed-api.*svc:orders.*observed/);
 for(const id of ['svc:orders','ui:shop','pg:sales:sales.orders','kafka:orders.created','es:orders','elk:orders']){const n=await M.inspect({env:'test',id});assert.ok(n.actions.length,id);assert.ok(n.actions.every(a=>a.valid),JSON.stringify(n));}
 const snapshot=F.decode(await M.snapshot({env:'test',focus:'svc:orders',limit:5}));assert.ok(snapshot.count<=5);assert.ok(Number(snapshot.meta[6])>0);
});
test('saved user flow layers are binary, survive refresh, reject stale updates and never claim to be static proof',async()=>{
 const saved=await T.call('map_save',{env:'test',id:'checkout',title:'Checkout feature',description:'User-requested flow; behavior must be verified',nodes:['ui:shop','svc:orders','kafka:orders.created'],edges:[{from:'ui:shop',to:'svc:orders',relation:'checkout',evidence:'User described checkout'}]});assert.equal(saved.saved,true);
 const file=path.join(M.ROOT,'overlays','test','checkout.dtm');assert.equal(fs.readFileSync(file).subarray(0,6).toString(),'DTMAP1');
 await M.overview({env:'test',refresh:true});const neighbors=await M.neighbors({env:'test',id:'feature:checkout'});assert.match(neighbors.text,/user/);assert.match(neighbors.text,/checkout/);assert.equal(M.layers({env:'test'}).layers[0].revision,saved.revision);
 await assert.rejects(()=>M.save({env:'test',id:'checkout',title:'Changed',description:'x',nodes:[]}),/exists/);
 await assert.rejects(()=>M.save({env:'test',id:'../escape',title:'x',description:'x',nodes:[]}),/Invalid/);
});

test('projection invalidates on source edits, distinguishes API ambiguity and keeps layers scoped to environment',async()=>{
 const before=await M.graph('test');
 put(path.join(home,'passports/duplicate/passport.json'),{service:'duplicate',env:'test',effective:{endpoints:[{method:'GET',path:'/orders/{id}'}]}});
 const after=await M.graph('test');assert.notEqual(after.meta[2],before.meta[2]);
 const edges=await M.neighbors({env:'test',id:'ui:shop',include_candidates:true});assert.match(edges.text,/candidate/);
 await M.save({env:'other',id:'checkout',title:'Other environment',description:'Independent overlay',nodes:[]});
 assert.equal(M.layers({env:'test'}).layers[0].title,'Checkout feature');assert.equal(M.layers({env:'other'}).layers[0].title,'Other environment');
 put(path.join(home,'cache/test/pg/giant.json'),'{invalid JSON; map must never load database bodies}');assert.ok((await M.overview({env:'test',refresh:true})).nodes>0);
});

test('large map columns stay compact and indexed; snapshots never dump the entire estate',async()=>{
 const n=30000,nodes=Array.from({length:n},(_,i)=>({id:'svc:s'+i,kind:'service',label:'Service '+i,scope:'test'})),edges=Array.from({length:n-1},(_,i)=>({from:nodes[i].id,to:nodes[i+1].id,kind:'calls',certainty:'static'}));
 const started=performance.now(),bytes=F.encode(nodes,edges,['test']);assert.ok(bytes.length<4*1024*1024,bytes.length);const decoded=F.decode(bytes);assert.equal(decoded.count,n);assert.equal(decoded.edgeCount,n-1);assert.equal(decoded.node(n-1).id,'svc:s29999');assert.ok(performance.now()-started<10000,'bounded 30k-node binary round trip');
 const g=await M.graph('test');assert.ok(g.offset instanceof Uint32Array);assert.ok(g.adj instanceof Uint32Array);
 const snapshot=F.decode(await M.snapshot({env:'test',limit:3}));assert.ok(snapshot.count<=3);assert.ok(Number(snapshot.meta[6])>0);
});

test('explicit browser-site repository binding connects a differently named UI repo and retains API source certainty',async()=>{
 const file=path.join(home,'config.json'),cfg=JSON.parse(fs.readFileSync(file));cfg.browser.sites.portal={url:'https://portal.example/',repository:'SHOP/shop'};fs.writeFileSync(file,JSON.stringify(cfg));require('../lib/config').reload();
 const r=await M.inspect({env:'test',id:'ui:portal'});assert.equal(r.node.kind,'ui');assert.equal(r.target.site,'portal');assert.equal((await M.inspect({env:'test',id:'svc:shop'})).node.kind,'service');assert.match((await M.neighbors({env:'test',id:'ui:portal'})).text,/deployment-of.*uirepo:SHOP\/shop/);
 const before=M.layers({env:'test'}).layers.length;put(path.join(M.ROOT,'overlays/test/bad.dtm'),'broken');assert.equal(M.layers({env:'test'}).layers.length,before);assert.equal(M.layers({env:'test'}).errors[0].id,'bad');
 const g=await M.overview({env:'test'});assert.ok(g.gaps.some(s=>s.includes('bad.dtm')));
});

test('Open WebUI map transport is binary, keyed, CORS-readable and bounded independently of the full download',async()=>{
 const server=require('../server').start({port:0,host:'127.0.0.1'});await new Promise(r=>server.on('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const response=await fetch(base+'/oapi/map',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({env:'test',limit:3})});assert.equal(response.headers.get('content-disposition'),'inline');const view=new URL(response.headers.get('location'));assert.equal(view.searchParams.get('embed'),'1');
  const id=view.pathname.split('/').pop(),binary=await fetch(`${base}/api/map/${id}/graph`);assert.match(binary.headers.get('content-type'),/vnd\.dt\.map/);assert.equal(binary.headers.get('access-control-allow-origin'),'*');const g=F.decode(await binary.arrayBuffer());assert.ok(g.count<=3);
  const focused=await T.call('map',{env:'test',focus:'svc:orders'}),focusedId=focused.view.split('/').pop(),focusedWire=await fetch(`${base}/api/map/${focusedId}/graph`);assert.equal(decodeURIComponent(focusedWire.headers.get('x-dt-map-focus')),'svc:orders');assert.ok(Array.from({length:F.decode(await focusedWire.arrayBuffer()).count},(_,i)=>i).length>0);
  const full=F.decode(await(await fetch(`${base}/api/map/${id}/full`)).arrayBuffer());assert.ok(full.count>g.count);assert.equal((await fetch(`${base}/api/map/not-a-result/graph`)).status,404);
  const assets=await fetch(base+'/static/vendor/ecs-canvas/canvas.js');assert.equal(assets.status,200);assert.equal(assets.headers.get('access-control-allow-origin'),'*');assert.equal((await fetch(base+'/static/vendor/ecs-canvas/../../config.json')).status,404);
  const selection=await(await fetch(`${base}/api/map/${id}/node?id=pg%3Asales%3Asales.orders`)).json();assert.equal(selection.target.database,'sales');assert.ok(selection.actions.every(a=>a.valid));
 }finally{await new Promise(r=>server.close(r));}
});

test('UI preview keeps only safe screenshot bytes, closes sessions after success/failure, and checks permissions before opening',async()=>{
 const sessions=new Set(),http=require('http');let failed=false,badImage=false,opened=0;
 const mcp=http.createServer((req,res)=>{if(req.method==='DELETE'){sessions.delete(req.headers['mcp-session-id']);res.end();return;}let raw='';req.on('data',c=>raw+=c).on('end',()=>{const m=JSON.parse(raw);res.setHeader('content-type','application/json');if(m.id===undefined){res.writeHead(202);return res.end();}let result={};if(m.method==='initialize'){const id='shot-'+(++opened);sessions.add(id);res.setHeader('mcp-session-id',id);}else if(m.method==='tools/list')result={tools:[{name:'browser_navigate',inputSchema:{type:'object'}},{name:'browser_take_screenshot',inputSchema:{type:'object',properties:{type:{type:'string'}}}}]};else if(m.method==='tools/call'){if(m.params.name==='browser_take_screenshot')result=failed?{isError:true,content:[{type:'text',text:'Screenshot failed'}]}:{content:[{type:'image',mimeType:'image/png',data:badImage?'\"><script>bad</script>':'iVBORw0KGgo='}]};else result={content:[{type:'text',text:'Loaded test page'}]};}res.end(JSON.stringify({id:m.id,result}));});});
 await new Promise(r=>mcp.listen(0,'127.0.0.1',r));const config=path.join(home,'config.json'),original=fs.readFileSync(config),cfg=JSON.parse(original);cfg.browser.mcp=`http://127.0.0.1:${mcp.address().port}/mcp`;fs.writeFileSync(config,JSON.stringify(cfg));require('../lib/config').reload();
 try{
  const shot=await M.preview({env:'test',id:'ui:shop'});assert.match(shot.view,/map-preview/);assert.equal(sessions.size,0);
  const result=require('../lib/results').load(shot.view.split('/').pop());assert.equal(result.image.mimeType,'image/png');assert.equal(result.image.data,'iVBORw0KGgo=');
  failed=true;await assert.rejects(()=>M.preview({env:'test',id:'ui:shop'}),/Screenshot failed/);assert.equal(sessions.size,0);
  failed=false;badImage=true;await assert.rejects(()=>M.preview({env:'test',id:'ui:shop'}),/no supported inline image/);assert.equal(sessions.size,0);
  cfg.tools={disable:['api_browser_close','pg_query']};fs.writeFileSync(config,JSON.stringify(cfg));require('../lib/config').reload();await T.reload();const before=opened;
  await assert.rejects(()=>M.preview({env:'test',id:'ui:shop'}),/enabled api_browser_close/);assert.equal(opened,before);assert.ok(!(await M.inspect({env:'test',id:'pg:sales:sales.orders'})).actions.some(a=>a.tool==='pg_query'));
 }finally{fs.writeFileSync(config,original);require('../lib/config').reload();await T.reload();await new Promise(r=>mcp.close(r));}
});

test('saved-layer views include their participants, and map refuses invalid focused views before returning a link',async()=>{
 const bytes=F.decode(await M.snapshot({env:'test',layer:'checkout'})),ids=Array.from({length:bytes.count},(_,i)=>bytes.node(i).id);
 assert.ok(ids.includes('feature:checkout'));assert.ok(ids.includes('svc:orders'));assert.ok(ids.includes('kafka:orders.created'));assert.ok(bytes.edgeCount>0);
 await assert.rejects(()=>T.call('map',{env:'test',focus:'svc:missing'}),/Unknown map node/);
 const r=await T.call('map',{env:'test',focus:'svc:orders'});const result=require('../lib/results').load(r.view.split('/').pop());assert.equal(result.map.focus,'svc:orders');
});

test('prefix inventory never rolls up dependencies or changes a same-named backend into UI',async()=>{
 put(path.join(home,'passports/shop/passport.json'),{service:'shop',env:'test',effective:{produces:[{topic:'shop.events',file:'Events.java',line:7}]}});
 for(const name of ['pay-api','pay-worker'])put(path.join(home,'passports',name,'passport.json'),{service:name,env:'test',repo:{project:'UNRELATED',repo:name},effective:{produces:[{topic:'pay.events',file:'Events.java',line:4}]}});
 assert.equal((await M.inspect({env:'test',id:'svc:shop'})).node.kind,'service');
 assert.doesNotMatch((await M.neighbors({env:'test',id:'ui:shop',include_candidates:true})).text,/shop.events/);
 assert.match((await M.neighbors({env:'test',id:'svc:shop'})).text,/shop.events/);
 const inventory=F.decode(await M.snapshot({env:'test'}));
 for(let i=0;i<inventory.edgeCount;i++)assert.notEqual(inventory.edge(i).certainty,'aggregate');
 assert.ok(Array.from({length:inventory.count},(_,i)=>inventory.node(i)).some(n=>n.id==='prefix:pay'&&n.detail.startsWith('2 services')));
 const expanded=F.decode(await M.snapshot({env:'test',focus:'prefix:pay'}));
 assert.ok(Array.from({length:expanded.count},(_,i)=>expanded.node(i).id).includes('kafka:pay.events'));
 assert.equal((await M.route({env:'test',from:'svc:pay-api',to:'svc:pay-worker'})).found,false,'a shared producer topic does not imply publisher-to-publisher flow');
});

test('unlocated findings and ambiguous observed APIs require explicit candidate opt-in',async()=>{
 put(path.join(home,'passports/unlocated/passport.json'),{service:'unlocated',env:'test',effective:{produces:[{topic:'unlocated.events'}],calls:[{client:'orders'}]}});
 const safe=await M.neighbors({env:'test',id:'svc:unlocated'});assert.doesNotMatch(safe.text,/unlocated.events|calls-http|inspect-logs/);
 assert.match((await M.neighbors({env:'test',id:'svc:unlocated',include_candidates:true})).text,/candidate/);
 assert.doesNotMatch((await M.neighbors({env:'test',id:'ui:shop'})).text,/observed-api/,'two matching backend owners remain ambiguous');
 const n=await M.inspect({env:'test',id:'ui:shop'});assert.ok(n.questions.some(s=>/repository/.test(s)));assert.equal(n.needs_user_input,true);assert.match(n.guidance,/Ask the user/);assert.ok(!n.actions.some(a=>a.tool==='logs_search'),'a browser site name is not proof of a log service');
});

test('manual identity corrections and suppressions are separate binary documents, revision protected and durable',async()=>{
 const request={env:'test',id:'shop-binding',title:'Shop frontend',evidence:'User: SHOP/react-ui serves shop in test; API proxy points at orders',nodes:[{id:'uirepo:SHOP/react-ui',kind:'ui-repository',label:'React shop',repo:'SHOP/react-ui'}],edges:[{from:'ui:shop',to:'uirepo:SHOP/react-ui',relation:'deployment-of'},{from:'uirepo:SHOP/react-ui',to:'svc:orders',relation:'api-call',evidence:'src/api/orders.ts:12 uses the orders proxy'}]};
 const saved=await T.call('map_adjust',request);assert.equal(saved.saved,true);
 const file=path.join(home,'maps/adjustments/test/shop-binding.dtm');assert.equal(fs.readFileSync(file).subarray(0,6).toString(),'DTMAP1');
 await M.overview({env:'test',refresh:true});assert.match((await M.neighbors({env:'test',id:'ui:shop'})).text,/deployment-of.*uirepo:SHOP\/react-ui.*manual/);
 assert.match((await M.neighbors({env:'test',id:'uirepo:SHOP/react-ui'})).text,/src\/api\/orders.ts:12/);
 const full=await M.adjustments({env:'test',id:request.id});assert.equal(full.adjustments[0].revision,saved.revision);assert.ok(full.adjustments[0].nodes.length);
 assert.equal((await M.adjustments({env:'test'})).adjustments[0].nodes,undefined,'default listing returns bounded metadata');
 assert.equal((await M.adjustments({env:'other'})).total,0);
 await assert.rejects(()=>M.adjust(request),/changed/);
 const updated=await M.adjust({...request,expected_revision:saved.revision,title:'Reviewed frontend'});assert.notEqual(updated.revision,saved.revision);
 await M.adjust({env:'test',id:'wrong-edge',evidence:'User: this publisher edge belongs to another environment',nodes:[],edges:[{from:'svc:shop',to:'kafka:shop.events',relation:'produces',suppress:true}]});
 await M.overview({env:'test',refresh:true});assert.doesNotMatch((await M.neighbors({env:'test',id:'svc:shop'})).text,/shop.events/);
 for(const invalid of [
  {...request,id:'blank',evidence:' '},
  {...request,id:'unsafe',edges:[{from:'ui:shop',to:'kafka:shop.events',relation:'produces'}]},
  {...request,id:'reclass',nodes:[{id:'svc:shop',kind:'ui',label:'Shop'}]},
 ])await assert.rejects(()=>M.adjust(invalid));
 assert.ok((await T.schemas({profile:'map'})).some(t=>t.name==='map_adjust'));
});

test('global browser routes cannot establish an environment and explicit site bindings exclude other environments',async()=>{
 const file=path.join(home,'config.json'),original=fs.readFileSync(file),cfg=JSON.parse(original);delete cfg.browser.sites.shop.env;fs.writeFileSync(file,JSON.stringify(cfg));require('../lib/config').reload();
 try{
  fs.rmSync(path.join(home,'passports/duplicate'),{recursive:true,force:true});
  assert.doesNotMatch((await M.neighbors({env:'test',id:'ui:shop'})).text,/observed-api/);
  assert.match((await M.neighbors({env:'test',id:'ui:shop',include_candidates:true})).text,/observed-api.*candidate/);
  assert.ok((await M.overview({env:'test'})).gaps.some(g=>g.includes('.env is unset')));
 }finally{fs.writeFileSync(file,original);require('../lib/config').reload();}
 const other=await M.search({env:'other',query:'ui:shop',kind:'ui'});assert.equal(other.total,0);
});
