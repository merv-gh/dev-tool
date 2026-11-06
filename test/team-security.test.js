const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-team-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PLUGINS_DIR','DT_SCRIPTS_DIR','DT_SECURITY_PROFILE','DT_API_KEY','DT_TRUST_NETWORK'])delete process.env[k];
Object.assign(process.env,{DT_HOME:home,DT_NO_DOCTOR:'1',DT_LOG:'quiet',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy'});
const token='team-user-token-123456789',other='rotated-team-token-123456789',admin='team-admin-token-123456789';
const config={server:{securityProfile:'team',trustNetwork:true,publicUrl:'https://tools.example',accessTokens:[{id:'alice-old',principal:'alice',token,envs:['dev'],tools:['find','catalog_search']},{id:'alice-new',principal:'alice',token:other,envs:['dev'],tools:['find','catalog_search']},{id:'operator',token:admin,role:'admin'}]},envs:{dev:{postgres:{}},uat:{postgres:{}}},tools:{workerHeapMb:0},scripts:{starters:false}};
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
const C=require('../lib/config'),A=require('../lib/access'),S=require('../lib/security');
const req=(secret,headers={})=>({method:'POST',headers:{...(secret?{authorization:'Bearer '+secret}:{}),...headers},socket:{remoteAddress:'127.0.0.1'}});
test('team authentication cannot be bypassed by localhost/network trust; rotation preserves ownership',()=>{
 assert.equal(A.identity(req()),null);const old=A.identity(req(token)),next=A.identity(req(other));assert.equal(old.principalId,'alice');assert.equal(old.scopeKey,next.scopeKey);
 A.run(old,()=>{assert.deepEqual(C.envNames(),['dev']);assert.throws(()=>C.getEnv('uat'),/not available/);assert.throws(()=>A.checkTool('pg_query'),/not available/);A.checkTool('find');});
 const candidate=structuredClone(config);candidate.server.accessTokens[0].expiresAt='2000-01-01T00:00:00Z';candidate.server.accessTokens[1].revoked=true;fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(candidate));C.reload();assert.equal(A.identity(req(token)),null);assert.equal(A.identity(req(other)),null);
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();
});
test('origin, cookie mutation and forwarded-header policy is explicit',()=>{
 assert.throws(()=>S.enforce(req(token,{origin:'https://attacker.example'})),/origin/);
 assert.throws(()=>S.enforce(req(null,{cookie:'dt_key='+token})),/Origin/);
 assert.throws(()=>S.enforce(req(token,{'x-forwarded-proto':'https'})),/trusted proxy/);
 S.enforce(req(token,{origin:'https://tools.example'}));S.enforce(req(token));
});
test('cached remote code is verified before require, and failed verification never executes bytes',async()=>{
 const source="module.exports=[{name:'verified_example',run:()=>42}]",url='https://plugins.example/fixture.js',sha256=crypto.createHash('sha256').update(source).digest('hex');
 const file=path.join(home,'cache/plugins',crypto.createHash('sha1').update(url).digest('hex').slice(0,16)+'.js');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);
 config.tools.plugins=[{url,sha256:sha256.toUpperCase()}];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();const T=require('../lib/tools');assert.equal(await T.call('verified_example',{}),42);
 const marker=path.join(home,'untrusted-executed');fs.writeFileSync(file,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');`+source);
 await T.reload();assert.ok(T.registryStatus().lastError.errors.some(e=>/sha256/.test(e.error)));assert.equal(fs.existsSync(marker),false);assert.equal(await T.call('verified_example',{}),42,'previously verified implementation remains active');
 assert.throws(()=>S.verifyPlugin(file,{remote:true,url}),/approved sha256/);
 config.tools.plugins=[];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();
});
test('team activation cannot retain an unapproved plugin through a rejected reload',async()=>{
 const url='https://plugins.example/legacy.js',file=path.join(home,'cache/plugins',crypto.createHash('sha1').update(url).digest('hex').slice(0,16)+'.js');fs.writeFileSync(file,"module.exports=[{name:'legacy_unsigned',run:()=>7}]");
 config.server.securityProfile='local';config.tools.plugins=[{url}];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();const T=require('../lib/tools');assert.equal(await T.call('legacy_unsigned',{}),7);
 config.server.securityProfile='team';fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();
 try{await assert.rejects(T.call('legacy_unsigned',{}),e=>e.code==='DT_ACCESS_DENIED');assert.ok(!(await T.schemas()).some(t=>t.name==='legacy_unsigned'));}
 finally{config.tools.plugins=[];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();await T.reload();}
});
test('HTTP enforces grants and MCP negotiates a supported version',async()=>{
 const server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base+'/api/find?env=dev&q=x')).status,403);
  assert.equal((await fetch(base+'/api/status')).status,403);
  const login=await fetch(base+'/api/session',{method:'POST',headers:{origin:'https://tools.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),redirect:'manual'});assert.equal(login.status,303);assert.match(login.headers.get('set-cookie'),/Secure/);assert.doesNotMatch(login.headers.get('location'),/token/);
  assert.equal((await fetch(base+'/api/find?env=uat&q=x',{headers:{authorization:'Bearer '+token}})).status,403);
  const response=await fetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'made-up-version'}})});assert.equal((await response.json()).result.protocolVersion,'2025-03-26');
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,origin:'https://bad.example'},body:'{}'})).status,403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await require('../lib/isolate').stop();}
});
test('security preflight reports migration work without exposing credentials',()=>{
 const active=S.report();assert.equal(active.profile,'team');assert.ok(active.checks.some(c=>c.check==='authentication'&&c.status==='ok'));assert.ok(active.checks.some(c=>c.check==='TLS gateway'&&c.status==='ok'));assert.doesNotMatch(JSON.stringify(active),new RegExp(token+'|'+admin));
 const candidate=structuredClone(config);candidate.server={securityProfile:'local',publicUrl:'http://127.0.0.1:4000'};candidate.tools.plugins=['http://plugins.example/unsigned.js'];fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(candidate));C.reload();
 try{const migration=S.report();assert.equal(migration.profile,'local');assert.ok(migration.counts.fail>=2);assert.ok(migration.checks.some(c=>c.check==='remote plugin'&&c.status==='fail'));}finally{fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();}
 assert.throws(()=>S.settings({allowedOrigins:['https://tools.example/path']}),/exact/);assert.throws(()=>S.settings({trustedProxies:['*']}),/exact/);
});
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
