// Disposable API-client showcase: real local HTTP, synthetic Consul/passports.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
async function start() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-api-client-demo-')), requests = [];
  for (const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_TOOL_PROFILE','DT_SECURITY_PROFILE','DT_API_KEY','DT_PUBLIC_URL']) delete process.env[key];
  Object.assign(process.env, { DT_HOME: home, DT_NO_DOCTOR: '1', DT_LOG: 'quiet', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy', DT_API_DEMO_BEARER: 'synthetic-api-demo-token' });
  const serve = replica => http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      requests.push({ replica, method: req.method, url: req.url });
      if (req.url.startsWith('/slow')) { const timer = setTimeout(() => res.end('{}'), 30000); res.on('close', () => clearTimeout(timer)); return; }
      res.setHeader('x-demo-replica', replica);
      if (req.url.startsWith('/html')) { res.setHeader('content-type', 'text/plain'); return res.end('<img src=x onerror="window.injected=true">'); }
      res.setHeader('content-type','application/json'); res.statusCode = req.url.startsWith('/missing') ? 404 : req.method === 'POST' ? 201 : 200;
      let received = body; try { received = JSON.parse(body); } catch {}
      res.end(JSON.stringify({ id: 42, status: res.statusCode === 404 ? 'missing' : 'ready', replica, method: req.method, path: req.url, authorized: req.headers.authorization === 'Bearer synthetic-api-demo-token', received, items: [{ sku: 'KEYBOARD', quantity: 2 }, { sku: 'MOUSE', quantity: 1 }], headers: { 'x-demo': req.headers['x-demo'] || '' } }));
    });
  });
  const apis = [serve('orders-a'), serve('orders-b')];
  for (const api of apis) await new Promise(r => api.listen(0, '127.0.0.1', r));
  const origins = apis.map(api => 'http://127.0.0.1:' + api.address().port);
  const config = { envs: { dev: {}, uat: {} }, scripts: { starters: false, http: { allow: origins } }, api: { authProfiles: { demo: { label: 'Demo API', url: origins[0], bearerToken: '${DT_API_DEMO_BEARER}', autoPrefill: true } } } };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  const C = require('../lib/config'), write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
  const passport = (name, endpoints) => write(path.join(C.PATHS.passports,name,'passport.json'), { service: name, effective: { endpoints }, summary: { endpoints: endpoints.length } });
  passport('shop-orders', [{ method:'GET',path:'/orders/{orderId}',handler:'OrdersController.get',file:'OrdersController.java',line:42 },{ method:'POST',path:'/orders',handler:'OrdersController.create' },{ method:'GET',path:'/missing' },{ method:'GET',path:'/slow' },{ method:'GET',path:'/html' }]);
  passport('shop-inventory', Array.from({length:105}, (_,i)=>({method:'GET',path:'/stock/item-'+i,handler:'InventoryController.item'+i})));
  const instance = (i, status = 'passing') => ({id: 'orders-' + (i ? 'b' : 'a'), address:'127.0.0.1',port:apis[i].address().port,status});
  write(path.join(C.PATHS.cache,'dev','consul.json'), {syncedAt:'2026-01-02T10:00:00Z',services:{'shop-orders':{instances:[instance(0),instance(1)]},'shop-inventory':{instances:[instance(0)]},'shop-worker':{instances:[]}}});
  write(path.join(C.PATHS.cache,'uat','consul.json'), {syncedAt:'2026-01-02T11:00:00Z',services:{'shop-orders':{instances:[instance(1)]},'shop-inventory':{instances:[]}}});
  require('../lib/access').run({ storyId:'api-demo' }, () => { const S = require('../lib/scripts'); S.save('orders/lookups/get-order',{description:'Retrieve an order',params:{orderId:{type:'string',required:true}},steps:[{http:'GET '+origins[0]+'/orders/{{orderId}}',urlEncodeParams:['orderId']}]}); S.save('orders/create',{description:'Create an order',steps:[{http:'POST '+origins[0]+'/orders',body:{sku:'KEYBOARD',quantity:2}}]}); S.save('maintenance/two-steps',{description:'Example multi-step workflow',steps:[{http:'GET '+origins[0]+'/orders/42'},{http:'GET '+origins[0]+'/orders/43'}]}); });
  const server = require('../server').start({port:0}); await new Promise(r => server.once('listening',r));
  const base = 'http://127.0.0.1:' + server.address().port; config.server = {publicUrl:base}; write(path.join(home,'config.json'),config); C.reload();
  return {base,origins,requests,url:base+'/api-client?story=api-demo',admin:base+'/admin#api',async close(){server.closeAllConnections();await new Promise(r=>server.close(r));for(const api of apis){api.closeAllConnections();await new Promise(r=>api.close(r));}await require('../lib/automation-flow').close();await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});}};
}
module.exports={start};
if(require.main===module)start().then(f=>{console.log(JSON.stringify({client:f.url,admin:f.admin,fixture:'Synthetic service catalog; requests execute against local HTTP only'}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>f.close().then(()=>process.exit()));}).catch(e=>{console.error(e);process.exitCode=1;});
