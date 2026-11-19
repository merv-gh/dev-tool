const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{execFileSync}=require('node:child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-passport-deployment-'));process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_LOG='quiet';
let server,app,base,origin,replica='orders-a',mode='ok',requests=[],versionRequests=0,sourceSha;
const source=path.join(home,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'App.java'),'@RestController class App { @GetMapping("/health") public String health() { return "ok"; } }');
const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'}}).trim();
git('init','-q','-b','main');git('add','.');git('commit','-qm','source');sourceSha=git('rev-parse','HEAD');
const config={envs:{dev:{},uat:{}},scripts:{starters:false}};
test.before(async()=>{
 app=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('content-type','application/json');if(req.url==='/version'){versionRequests++;return res.end(JSON.stringify({git:{commit:{id:sourceSha}}}));}if(mode==='fail'){res.writeHead(503);return res.end('{}');}if(mode==='hang')return;
  if(req.url.endsWith('/v1/catalog/services'))return res.end(JSON.stringify({orders:[]}));
  if(req.url.endsWith('/v1/health/service/orders'))return res.end(JSON.stringify(mode==='empty'?[]:[{Node:{Node:'node',Address:'127.0.0.1'},Service:{ID:replica,Address:'127.0.0.1',Port:app.address().port,Meta:{version:'runtime-'+replica}},Checks:[{Status:'passing'}]}]));res.writeHead(404);res.end('{}');
 });await new Promise(r=>app.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.address().port;
 config.envs.dev.consul=origin+'/dev';config.envs.uat.consul=origin+'/uat';fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
 server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;config.server={publicUrl:base};fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));require('../lib/config').reload();
});
test.after(async()=>{for(const s of [server,app]){s?.closeAllConnections();if(s)await new Promise(r=>s.close(r));}await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
const passportFile=()=>path.join(home,'passports/orders/passport.json');
test('an environment build pins source once without persisting deployment, and cached reads never query Consul',async()=>{
 const P=require('../lib/passport'),p=await P.build('orders',{repo:'SHOP/orders',env:'dev',libraries:false,rebuildCatalog:false,gitImpl:{fetchRef:async(project,repo,ref)=>{assert.equal(ref,sourceSha);return {project,repo,ref,sha:sourceSha,path:source};}}});
 assert.equal(p.repo.sha,sourceSha);assert.equal(p.env,'dev');assert.equal(Object.hasOwn(p,'deployed'),false);assert.ok(versionRequests>0);
 assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(passportFile())),'deployed'),false);assert.doesNotMatch(fs.readFileSync(path.join(home,'passports/orders/passport.md'),'utf8'),/deployed in|127\.0\.0\.1/);
 const before=requests.length,result=await require('../lib/tools').call('passport',{service:'orders'});assert.equal(result.cached,true);assert.equal(result.repo.sha,sourceSha);assert.equal(Object.hasOwn(result,'deployed'),false);assert.deepEqual(result.deploymentLookup.args,{name:'orders',env:'dev',exact:true,version:false});assert.equal(requests.length,before);
});
test('legacy cached deployments are omitted from reads, new snapshots, markdown and graph projections without rewriting history',async()=>{
 const P=require('../lib/passport'),raw=JSON.parse(fs.readFileSync(passportFile()));raw.deployed={instance:'old-ip:8080',version:'old-runtime'};fs.writeFileSync(passportFile(),JSON.stringify(raw));const bytes=fs.readFileSync(passportFile()),before=requests.length;
 assert.equal(P.sourceOnly(null),null);assert.equal(P.sourceOnly({service:'plain'}).service,'plain');assert.equal(P.loadDetected('orders').deployed,undefined);assert.equal(P.load('orders').deployed,undefined);assert.equal(require('../lib/passport/edges').snapshot().rows[0].passport.deployed,undefined);assert.doesNotMatch(P.markdown(raw),/old-ip|old-runtime|deployed in/);
 const shown=require('../lib/passport/present')(raw,true),snapshot=new URL(shown.view).searchParams.get('snapshot'),retained=require('../lib/results').load(snapshot);assert.equal(retained.data.deployed,undefined);assert.equal(retained.data.repo.sha,sourceSha);assert.equal(Object.hasOwn(shown,'deployed'),false);
 const response=await fetch(base+'/api/passport/orders?env=dev');assert.equal(response.status,200);assert.equal((await response.json()).deployed,undefined);assert.equal(requests.length,before);assert.deepEqual(fs.readFileSync(passportFile()),bytes);
});
test('exact on-demand tool calls use one health request, observe redeployment, and never mutate the passport',async()=>{
 const T=require('../lib/tools'),before=fs.readFileSync(passportFile()),seen=requests.length,probes=versionRequests;
 const a=await T.call('consul_service',{env:'dev',name:'orders',exact:true,version:false});assert.equal(a.instances[0].id,'orders-a');assert.equal(a.env,'dev');assert.ok(Number.isFinite(Date.parse(a.observedAt)));assert.deepEqual(requests.slice(seen),['/dev/v1/health/service/orders']);assert.equal(versionRequests,probes);
 replica='orders-b';const b=await T.call('consul_service',{env:'uat',name:'orders',exact:true,version:false});assert.equal(b.instances[0].id,'orders-b');assert.equal(b.env,'uat');assert.equal(requests.at(-1),'/uat/v1/health/service/orders');assert.deepEqual(fs.readFileSync(passportFile()),before);assert.equal(require('../lib/passport').load('orders').repo.sha,sourceSha);
 const versioned=await T.call('consul_service',{env:'dev',name:'orders',exact:true,version:true});assert.match(versioned.instances[0].version,new RegExp(sourceSha));assert.equal(versionRequests,probes+1);
 const fuzzy=await T.call('consul_service',{env:'dev',name:'ord',version:false});assert.equal(fuzzy.service,'orders');assert.ok(requests.includes('/dev/v1/catalog/services'));
 const missing=await T.call('consul_service',{env:'dev',name:'missing',version:false});assert.deepEqual(missing.matches,[]);
});
test('empty, failed, timed-out, cancelled and unauthorized lookups preserve static source and stop upstream work',async()=>{
 const T=require('../lib/tools'),P=require('../lib/passport'),before=fs.readFileSync(passportFile());mode='empty';assert.deepEqual((await T.call('consul_service',{env:'dev',name:'orders',exact:true,version:false})).instances,[]);
 mode='fail';await assert.rejects(T.call('consul_service',{env:'dev',name:'orders',exact:true,version:false}));mode='hang';await assert.rejects(require('../lib/consul').service('dev','orders',{exact:true,version:false,timeout:30}));
 const controller=new AbortController(),pending=T.call('consul_service',{env:'dev',name:'orders',exact:true,version:false},{signal:controller.signal});setTimeout(()=>controller.abort(),25);await assert.rejects(pending);
 const count=requests.length;await require('../lib/access').run({principalId:'limited',storyId:'one',multiUser:true,role:'user',envs:['uat']},()=>assert.rejects(T.call('consul_service',{env:'dev',name:'orders',exact:true,version:false})));assert.equal(requests.length,count);mode='ok';assert.equal(P.load('orders').repo.sha,sourceSha);assert.deepEqual(fs.readFileSync(passportFile()),before);
});
