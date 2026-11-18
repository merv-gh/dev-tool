const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-http-destinations-'));
for (const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_SCRIPTS_DIR','DT_TOOLS','DT_SECURITY_PROFILE','DT_API_KEY']) delete process.env[key];
Object.assign(process.env, { DT_HOME: home, DT_RATE_PER_SEC: '0', DT_NO_DOCTOR: '1', DT_LOG: 'quiet', DT_STATE_BACKEND: 'legacy' });
const config = { envs: { dev: {} }, scripts: { starters: false } }, requests = [], servers = [], origins = [];
const save = () => { fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config)); require('../lib/config').reload(); };
test.before(async () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  for (let index = 0; index < 2; index++) {
    const server = http.createServer((req,res) => { let body = ''; req.on('data',chunk => body += chunk); req.on('end',() => {
      requests.push({ index, path: req.url, method: req.method, body });
      if (req.url === '/redirect') { res.writeHead(302,{location:origins[1]+'/redirected'}); return res.end(); }
      res.writeHead(req.url === '/missing' ? 404 : req.method === 'POST' ? 201 : 200, {'content-type':'application/json'}); res.end(JSON.stringify({ index, path:req.url, method:req.method }));
    }); });
    await new Promise(r => server.listen(0,'127.0.0.1',r)); servers.push(server); origins.push('http://127.0.0.1:'+server.address().port);
  }
});
test.after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise(r=>server.close(r)); } await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home,{recursive:true,force:true}); });

test('API replay and saved scripts reach different services and paths without HTTP configuration',async () => {
  const C = require('../lib/api-client'), S = require('../lib/scripts');
  for (const [index,origin] of origins.entries()) {
    const e = await C.replay({request:{method:'GET',url:origin+'/new-service/orders',body:{kind:'none'}}});
    assert.equal(e.response.status,200); assert.equal(e.response.body.value.index,index);
    S.save('services/post-'+index,{description:'Explicit local API request',steps:[{http:'POST '+origin+'/arbitrary/path',body:{id:42},as:'response'}]});
    const r = await S.run('services/post-'+index); assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.results.response.status,201);
  }
  assert.equal(requests.length,4); assert.equal(require('../lib/config').getScripts().httpAllow,undefined);
});

test('obsolete empty or restrictive allow settings cannot block an intended destination',async () => {
  const S = require('../lib/scripts');
  try {
    for (const allow of [[],['https://unrelated.example/only']]) {
      config.scripts.http = {allow}; save();
      const r = await S.httpRequest({method:'GET',url:origins[1]+'/not-listed'}); assert.equal(r.status,200);
    }
  } finally { delete config.scripts.http; save(); }
});

test('a script reaches the destination and reports its actual HTTP failure without retrying',async () => {
  const S = require('../lib/scripts'), before = requests.length;
  S.save('http-failures/missing',{description:'Observe an upstream HTTP failure',steps:[{http:'GET '+origins[0]+'/missing'}]});
  const result = await S.run('http-failures/missing');
  assert.equal(result.ok,false); assert.match(result.error,/HTTP 404/);
  assert.equal(requests.length,before+1); assert.equal(requests.at(-1).path,'/missing');
});

test('collection validation and execution need no destination configuration',async () => {
  const S = require('../lib/scripts'), C = require('../lib/collections');
  S.save('http-suite/read',{description:'Read an unconfigured service',steps:[{http:'GET '+origins[1]+'/suite',as:'response'}]});
  const checked = await C.validate('http-suite'); assert.equal(checked.ok,true,JSON.stringify(checked));
  const result = await C.run('http-suite'); assert.equal(result.ok,true,JSON.stringify(result));
  S.save('invalid-http/read',{description:'Invalid protocol',steps:[{http:'GET file:///tmp/example'}]});
  const invalid = await C.validate('invalid-http'); assert.equal(invalid.ok,false); assert.match(JSON.stringify(invalid.errors),/http\(s\)/);
});

function httpPlan(url, method = 'GET') {
  const S = require('../lib/scenario-state'), inventory = {version:1,service:'local-fixture',env:'dev',states:[{id:'http-response',kind:'http',target:{method},required:true}],gaps:[]};
  return S.planState(inventory,{'http-response':{mode:'capture',query:{url,method}}});
}
test('live scenario GET/HEAD capture reaches a service without an allow setting',async () => {
  const S = require('../lib/scenario-state');
  for (const method of ['GET','HEAD']) {
    const state = await S.captureState(httpPlan(origins[0]+'/state',method));
    assert.equal(state.complete,true,JSON.stringify(state)); assert.equal(state.states['http-response'].value.status,200);
    if (method === 'GET') assert.equal(state.states['http-response'].value.body.path,'/state');
  }
});

test('URL validation, read-only captures and explicit redirects still behave consistently',async () => {
  const S = require('../lib/scripts'), State = require('../lib/scenario-state'), before = requests.length;
  for (const url of ['file:///tmp/example','ftp://internal.example/file',origins[0].replace('://','://user:password@')+'/orders']) {
    await assert.rejects(S.httpRequest({method:'GET',url}),/http\(s\).*without inline credentials/);
    const captured = await State.captureState(httpPlan(url)); assert.equal(captured.complete,false); assert.match(captured.states['http-response'].error,/http\(s\)/);
  }
  const mutation = await State.captureState(httpPlan(origins[0]+'/state','POST')); assert.equal(mutation.complete,false); assert.match(mutation.states['http-response'].error,/GET\/HEAD/);
  assert.equal(requests.length,before);
  await assert.rejects(S.httpRequest({method:'GET',url:origins[0]+'/redirect'}),/fetch|redirect/i);
  assert.equal(requests.length,before+1); assert.equal(requests.at(-1).path,'/redirect');
});
