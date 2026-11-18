// Disposable mixed-collection showcase. Real Playwright + HTTP/ES/Kafka-UI protocols;
// Postgres uses an explicitly synthetic, scope-aware tool adapter (no database required).
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
async function start(){
 const fixture=await require('./api-client').start(), C=require('../lib/config'), calls=[], orders=new Map(), topics={orders:[],audit:[]},sessions=new Map();
 const browser=await require('playwright').chromium.launch({headless:true});let seq=0;
 const server=http.createServer(async(req,res)=>{
  try{
   let text='';for await(const chunk of req)text+=chunk;const u=new URL(req.url,'http://local'), body=text?JSON.parse(text):{};res.setHeader('content-type','application/json');
   const json=x=>res.end(JSON.stringify(x));
   if(u.pathname==='/checkout'){res.setHeader('content-type','text/html');return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Local checkout fixture</title><h1>Checkout fixture</h1><form><label>Order ID <input name="id" required></label><button>Create order</button></form><p role="status">Ready</p><script>document.querySelector("form").onsubmit=async e=>{e.preventDefault();const id=document.querySelector("input").value;const r=await fetch("/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});document.querySelector("[role=status]").textContent=r.ok?"Created "+id:"Failed";};</script></html>');}
   if(u.pathname==='/orders'){calls.push({kind:'http',method:req.method,id:body.id});const order={id:body.id,status:'ready'};orders.set(body.id,order);topics.orders.push(order);res.statusCode=201;return json(order);}
   if(u.pathname==='/worker'){const a=body.arguments;calls.push({kind:'pg-adapter',...a});if(req.headers.authorization!=='Bearer synthetic-collection-worker'||body.context?.storyId!=='api-demo'){res.statusCode=403;return json({error:'Wrong fixture scope'});}const row=orders.get(a.params?.[0]);return json({protocol:body.protocol,requestId:body.requestId,tool:body.tool,result:{db:a.db,rows:row?[{...row,source:a.env+'/'+a.db}]:[]}});}
   if(u.pathname==='/es/orders/_search'){calls.push({kind:'es',body});return json({hits:{total:{value:orders.size},hits:[...orders.values()].map(row=>({_id:row.id,_index:'orders',_source:row}))}});}
   if(u.pathname==='/api/clusters')return json([{name:'demo',status:'online'}]);
   if(u.pathname.startsWith('/api/clusters/demo/topics/')){
    const topic=decodeURIComponent(u.pathname.split('/')[5]),messages=topics[topic];if(!messages){res.statusCode=404;return json({});}
    if(!u.pathname.endsWith('/messages'))return json({partitions:[{partition:0,offsetMin:0,offsetMax:messages.length}]});
    if(req.method==='POST'){calls.push({kind:'kafka-produce',topic,body});messages.push(body.content==null?null:JSON.parse(body.content));return res.end('');}
    const from=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));calls.push({kind:'kafka-read',topic,from});res.setHeader('content-type','text/event-stream');return res.end(messages.slice(from,from+limit).map((value,i)=>'data: '+JSON.stringify({type:'MESSAGE',message:{partition:0,offset:from+i,key:null,content:JSON.stringify(value)}})).join('\n')+'\ndata: {"type":"DONE"}\n');
   }
   if(u.pathname==='/mcp'){
    const session=req.headers['mcp-session-id'];if(req.method==='DELETE'){await sessions.get(session)?.context.close();sessions.delete(session);return res.end();}
    const msg=body;if(msg.method==='initialize'){const id='ui-'+(++seq),context=await browser.newContext();sessions.set(id,{context,page:await context.newPage()});res.setHeader('mcp-session-id',id);return json({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'local-playwright-fixture',version:'1'}}});}
    if(msg.id===undefined){res.statusCode=202;return res.end();}
    let result={};if(msg.method==='tools/list')result={tools:['navigate','run_code','snapshot','network_requests'].map(name=>({name:'browser_'+name,inputSchema:{type:'object',properties:{},additionalProperties:true}}))};
    else if(msg.method==='tools/call'){const {name,arguments:a}=msg.params,page=sessions.get(session).page;calls.push({kind:'ui',action:name});let value;
     if(name==='browser_navigate'){await page.goto(a.url);value=await page.title();}
     else if(name==='browser_run_code')value=await Function('return ('+a.code+')')()(page);
     else if(name==='browser_snapshot')value=await page.locator('body').innerText();
     else if(name==='browser_network_requests')value='';else throw Error('Unsupported fixture UI action');
     result={content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]};
    }return json({jsonrpc:'2.0',id:msg.id,result});
   }
   res.statusCode=404;json({error:'Unknown fixture route'});
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const file=path.join(C.HOME,'config.json'),config=JSON.parse(fs.readFileSync(file));
 for(const env of ['dev','uat'])config.envs[env]={...config.envs[env],postgres:{orders:'postgres://synthetic/unused',warehouse:'postgres://synthetic/unused'},kafkaUi:origin,elasticsearch:{hosts:[origin+'/es']}};
 config.browser={mcp:origin+'/mcp',sites:{checkout:{url:origin+'/checkout'}}};config.tools={backends:{pg_query:{url:origin+'/worker',scopeAware:true,token:'synthetic-collection-worker'}}};fs.writeFileSync(file,JSON.stringify(config));C.reload();
 const write=(name,value)=>{const file=path.join(C.PATHS.cache,'dev',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};write('es/orders.json',{});write('kafka/_index.json',{cluster:'demo',topics:[{topic:'orders'},{topic:'audit'}]});
 require('../lib/access').run({storyId:'api-demo'},()=>{
  const S=require('../lib/scripts');S.save('journeys/checkout',{description:'Local showcase: UI → Postgres in two environments → Elasticsearch → Kafka → HTTP',params:{orderId:{type:'string',default:'DEMO-42'}},steps:[
   {tool:'kafka_checkpoint',args:{env:'dev',topic:'orders'},as:'checkpoint'},
   {open:origin+'/checkout',as:'checkout'},
   {browser:'run_code',args:{code:'async (page) => { await page.getByLabel("Order ID").fill("{{orderId}}"); await page.getByRole("button",{name:"Create order"}).click(); await page.getByRole("status").filter({hasText:"Created"}).waitFor(); return await page.getByRole("status").innerText(); }'},as:'page'},
   {tool:'pg_query',args:{env:'dev',db:'orders',sql:'select id, status from sales.orders where id = $1 limit 1',params:['{{orderId}}']},as:'order',assertions:[{name:'Order persisted',path:'rows.0.status',op:'equal',value:'ready',hard:true}]},
   {tool:'pg_query',args:{env:'uat',db:'warehouse',sql:'select id, status from reporting.orders where id = $1 limit 1',params:['{{order.rows.0.id}}']},as:'replica',assertions:[{name:'Cross-environment target',path:'rows.0.source',op:'equal',value:'uat/warehouse',hard:true}]},
   {tool:'es_search',args:{env:'dev',index:'orders',query:'id=={{orderId}}'},as:'search'},
   {tool:'kafka_wait',args:{env:'dev',topic:'orders',checkpoint:'{{checkpoint}}',match:{'value.id':'{{orderId}}'},timeout_ms:5000},as:'event'},
   {tool:'kafka_produce',args:{env:'dev',topic:'audit',partition:0,value:{id:'{{event.message.value.id}}',status:'verified'}},as:'receipt'},
   {http:'GET '+fixture.origins[0]+'/orders/{{orderId}}',as:'response',assertions:[{name:'HTTP reachable',path:'status',op:'equal',value:200,hard:true}]},
  ],finally:'log("Checkout resources released");',provenance:{fixture:'Synthetic databases and services; real local browser'}});
  S.save('journeys/cancellable',{description:'Long wait for cancellation demo',steps:[{tool:'kafka_wait',args:{env:'dev',topic:'orders',match:{'value.id':'will-not-arrive'},timeout_ms:30000,poll_ms:100}}],finally:'log("Wait cleaned up");'});
 });
 return {...fixture,calls,orders,topics,sessions,url:fixture.url+'&workflow=journeys/checkout',async close(){server.closeAllConnections();await new Promise(r=>server.close(r));await browser.close();await fixture.close();}};
}
module.exports={start};if(require.main===module)start().then(f=>{console.log(JSON.stringify({url:f.url,fixture:'Local browser and service protocols; synthetic Postgres adapter'}));for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>f.close().then(()=>process.exit()));}).catch(e=>{console.error(e);process.exitCode=1;});
