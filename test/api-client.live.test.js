// Real Playwright MCP integration. Start the repository's browser image, publish its MCP port,
// then DT_TEST_BROWSER_MCP=http://127.0.0.1:<port>/mcp node --test test/api-client.live.test.js.
// The page/API are disposable local fixtures. No customer site or credentials are used.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const http=require('http');
const endpoint=process.env.DT_TEST_BROWSER_MCP;
test('real Playwright UI → network exchange → handler → replay → saved collection script', {skip:!endpoint,timeout:120000},async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-api-browser-live-'));
  process.env.DT_HOME=home;process.env.DT_BROWSER_MCP=endpoint;process.env.DT_RATE_PER_SEC='0';
  for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS'])delete process.env[key];
  const requests=[];let session;
  const server=http.createServer((req,res)=>{
    requests.push({method:req.method,url:req.url,authorization:req.headers.authorization,cookie:req.headers.cookie});
    if(req.url==='/orders'){
      const page=`<!doctype html><html><head><title>Disposable order fixture</title></head><body><h1>Order 42</h1><button id="refresh">Refresh order</button><p id="status">Ready</p><script>document.getElementById('refresh').onclick=async()=>{const r=await fetch('/api/orders/42?expand=items',{headers:{authorization:'Bearer live-browser-fixture-secret'}});const j=await r.json();document.getElementById('status').textContent='Order '+j.orderId+' '+j.status};</script></body></html>`;
      res.setHeader('content-type','text/html');res.setHeader('set-cookie','session=live-browser-cookie; HttpOnly; SameSite=Lax');res.setHeader('content-length',Buffer.byteLength(page));return res.end(page);
    }
    if(req.url.startsWith('/api/orders/')){
      const result=JSON.stringify({orderId:42,status:'paid',total:'12.30',items:[{sku:'KEYBOARD',quantity:2}],customer:{email:'live-customer@example.test'}});
      res.setHeader('content-type','application/json');res.setHeader('content-length',Buffer.byteLength(result));res.setHeader('x-request-id','live-order-42');return res.end(result);
    }
    res.statusCode=404;res.end();
  });
  await new Promise(r=>server.listen(0,'0.0.0.0',r));
  const hostOrigin=`http://127.0.0.1:${server.address().port}`;
  // Docker Desktop resolves host.docker.internal to this test process. Override for another host.
  const browserOrigin=`http://${process.env.DT_TEST_BROWSER_HOST||'host.docker.internal'}:${server.address().port}`;
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},browser:{mcp:endpoint,sites:{shop:{url:browserOrigin+'/orders'}}},scripts:{http:{allow:[hostOrigin+'/api']}}}));
  fs.mkdirSync(path.join(home,'passports','orders'),{recursive:true});
  fs.writeFileSync(path.join(home,'passports','orders','passport.json'),JSON.stringify({service:'orders',repo:{project:'TEST',repo:'orders'},summary:{endpoints:1,consumes:[],produces:[],tables:{},calls:[],libraries:[]},effective:{endpoints:[{method:'GET',path:'/orders/{id}',handler:'OrderController.get',file:'OrderController.java',line:42}]}}));
  const C=require('../lib/api-client');
  try{
    const opened=await C.browserOpen({site:'shop'});session=opened.session;assert.equal(opened.mode,'exchanges');assert.equal(opened.adapter,'native-network');
    const snapshot=await C.browserAction({session,action:'snapshot'});assert.match(snapshot.text,/Refresh order/);
    const ref=snapshot.text.match(/button "Refresh order" \[ref=([^\]]+)\]/)?.[1];assert.ok(ref,snapshot.text);
    await C.browserAction({session,action:'click',args:{element:'Refresh order',ref}});
    await C.browserAction({session,action:'wait_for',args:{text:'Order 42 paid'}});
    const captured=await C.browserCapture({session,source:'Real disposable order page after Refresh order'});
    const e=captured.exchanges.find(e=>e.request.url.includes('/api/orders/42'));
    assert.ok(e,JSON.stringify(captured));assert.equal(e.request.method,'GET');assert.equal(e.response.status,200);
    assert.equal(e.response.body.kind,'json',JSON.stringify(e));assert.equal(e.response.body.value.status,'paid');
    assert.equal(e.response.body.value.customer.email,'[redacted]');assert.equal(e.response.headers['x-request-id'],'live-order-42');
    assert.equal(e.route.status,'matched');assert.equal(e.route.candidates[0].handler,'OrderController.get');assert.equal(e.request.headers.cookie,undefined);
    assert.ok(requests.some(r=>r.authorization==='Bearer live-browser-fixture-secret'&&r.cookie?.includes('live-browser-cookie')));
    const p=C.prepare({exchange:e.id,request:{...e.request,url:e.request.url.replace(browserOrigin,hostOrigin)},bindings:{orderId:{in:'path',index:3}},description:'Lookup order captured from UI'});
    const beforeReplay=requests.length;
    const replay=await C.replay({prepared:p,params:{orderId:"77",authorization:'live-replay-fixture-secret'}});
    assert.equal(replay.response.status,200);assert.equal(requests.length,beforeReplay+1);assert.equal(requests.at(-1).url,'/api/orders/77?expand=items');assert.equal(requests.at(-1).cookie,undefined);
    C.save({id:'orders/lookup',prepared:p,assertions:[{name:'lookup succeeded',path:'status',op:'equal',value:200}],capture:{orderStatus:'json.status'}});
    const S=require('../lib/scripts');S.setCollection('orders',{before:'vars.collectionMarker="live";',after:'test("collection inherited",()=>expect(vars.collectionMarker).toBe("live"));'});
    const saved=await S.run('orders/lookup',{orderId:"88",authorization:'live-script-fixture-secret'});
    assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.results.orderStatus,'paid');assert.ok(saved.tests.list.some(t=>t.name==='collection inherited'&&t.ok));assert.equal(requests.at(-1).url,'/api/orders/88?expand=items');
    const files=fs.readdirSync(C.DIR).map(f=>fs.readFileSync(path.join(C.DIR,f),'utf8')).join('\n')+fs.readFileSync(path.join(home,'scripts/orders/lookup.json'),'utf8');
    assert.doesNotMatch(files,/live-browser-fixture-secret|live-replay-fixture-secret|live-script-fixture-secret|live-browser-cookie|live-customer@example.test/);
    console.log(JSON.stringify({browser:'real Playwright MCP',captured:captured.count,matched:e.route.candidates[0].handler,status:e.response.status,body:e.response.body.kind,replay:replay.response.status,script:saved.ok,assertions:saved.tests.passed,requests:requests.length}));
  }finally{if(session)await C.browserClose({session});await new Promise(r=>server.close(r));fs.rmSync(home,{recursive:true,force:true});}
});
