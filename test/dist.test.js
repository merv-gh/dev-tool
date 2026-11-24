// docker-compose runs dist/ (no image build), so dist/ must match the sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

let esbuild = true;
try { require.resolve('esbuild'); } catch { esbuild = false; }

test('dist/ is built from the current sources (npm run build)', { skip: !esbuild && 'esbuild not installed (npm install)' }, () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'build.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('the bundle runs on its own', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'dist', 'dt.js'), 'help'], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
  assert.match(r.stdout + r.stderr, /dt sync/);
});

test('standalone data access index builds cold cached sources and traces an API to a column without the checkout',()=>{
 const fs=require('node:fs'),os=require('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-bundle-data-access-')),bundle=path.join(root,'bundle'),home=path.join(root,'home');
 const put=(name,value)=>{const file=path.join(home,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
 try{
  fs.mkdirSync(bundle);fs.copyFileSync(path.join(__dirname,'../dist/dt.js'),path.join(bundle,'dt.js'));
  put('config.json',{envs:{dev:{postgres:{alpha:'postgres://fixture@127.0.0.1:1/alpha'}}},scripts:{starters:false}});
  put('cache/dev/pg/alpha.json',{db:'alpha',database:'alpha',tables:[{schema:'public',name:'person',columns:[{name:'id',type:'bigint'},{name:'legal_name',type:'text'}]}],functions:[],triggers:[],viewDeps:[]});
  put('repos/DEMO/person/application.properties','spring.application.name=person\nspring.datasource.url=jdbc:postgresql://database:5432/alpha\n');
  put('repos/DEMO/person/PersonController.java',`package demo;
import org.springframework.web.bind.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
@RestController public class PersonController {
 private JdbcTemplate jdbc;
 @GetMapping("/person/{id}")
 public String get(Long id) { return jdbc.queryForObject("select legal_name from public.person where id=?",String.class,id); }
}`);
  const call=(name,args)=>{const r=spawnSync(process.execPath,[path.join(bundle,'dt.js'),'tool',name,JSON.stringify({...args,view:false})],{cwd:root,encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',NODE_PATH:''}});assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);};
  const built=call('data_index',{env:'dev',waitMs:25000});assert.equal(built.state,'ready',JSON.stringify(built));assert.equal(built.stats.cold,1);
  const readers=call('data_readers',{env:'dev',name:'alpha:public.person.legal_name'});assert.ok(readers.rows.some(r=>r.proof==='sql'&&r.user.name==='PersonController#get'),JSON.stringify(readers));
  const trace=call('data_trace',{env:'dev',from:'GET /person/42',service:'person',to:'alpha:public.person.legal_name'});assert.ok(trace.paths.length,JSON.stringify(trace));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('bundled differential checks spawn their shipped worker without source-tree dependencies', () => {
  const fs = require('fs'), os = require('os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bundle-diff-'));
  const put = (name, value) => { const f = path.join(home, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    put('config.json', { envs: { dev: {} }, tests: { differentialProfiles: { projection: { reviewed: true, kind: 'node-module', module: 'src/value.cjs' } } } });
    for (const id of ['before', 'after']) {
      put(`work/${id}/src/value.cjs`, 'module.exports=x=>({id:x,amount:"1.2300"})');
      put(`cache/work/${id}.json`, { id, path: path.join(home, 'work', id), project: 'BUNDLE', repo: id, sha: id, createdAt: new Date().toISOString() });
    }
    const r = spawnSync(process.execPath, [path.join(__dirname, '../dist/dt.js'), 'tool', 'differential_check', JSON.stringify({ profile: 'projection', baseline: 'before', candidate: 'after', inputs: [{ id: 'precision', args: ['9007199254740993'] }] })], { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, DT_HOME: home, DT_LOG: 'quiet', NODE_PATH: '' } });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.equal(JSON.parse(r.stdout).outcome, 'equivalent');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});


test('standalone bundle ships its QuickJS WASM and SQLite metadata workers',()=>{
 const fs=require('fs'),os=require('os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-standalone-runtime-')),bundle=path.join(root,'bundle'),home=path.join(root,'home');
 try{
  fs.mkdirSync(bundle);fs.mkdirSync(home);fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false}}));
  for(const file of ['dt.js','quickjs-worker.js','state-worker.js'])fs.copyFileSync(path.join(__dirname,'../dist',file),path.join(bundle,file));
  const env={PATH:process.env.PATH,DT_HOME:home,DT_LOG:'quiet',NODE_PATH:''};
  const code=spawnSync(process.execPath,[path.join(bundle,'dt.js'),'tool','code',JSON.stringify({engine:'quickjs',code:'text("pure transform"); return [2,3,7].reduce((a,b)=>a*b,1);'})],{cwd:root,env,encoding:'utf8',timeout:15000});
  assert.equal(code.status,0,code.stderr||code.stdout);assert.equal(JSON.parse(code.stdout).returned,42);
  const metadata=spawnSync(process.execPath,[path.join(bundle,'dt.js'),'tool','metadata_list',JSON.stringify({kind:'calls'})],{cwd:root,env,encoding:'utf8',timeout:15000});
  assert.equal(metadata.status,0,metadata.stderr||metadata.stdout);const records=JSON.parse(metadata.stdout).records;if(require('../lib/state-store').sqliteAvailable())assert.ok(records.some(r=>r.value.tool==='code'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('standalone telemetry persists scoped spans and reads its portable coverage artifact',async()=>{
 const fs=require('node:fs'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-bundle-observability-')),bundle=path.join(root,'bundle'),home=path.join(root,'home');
 fs.mkdirSync(bundle);fs.mkdirSync(home);fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},tools:{workerHeapMb:128}}));
 for(const file of ['dt.js','telemetry-worker.js','observation-worker.js'])fs.copyFileSync(path.join(__dirname,'../dist',file),path.join(bundle,file));
 const coverageFile=path.join(__dirname,'../dist/test-coverage.json'),hasCoverage=fs.existsSync(coverageFile);if(hasCoverage)fs.copyFileSync(coverageFile,path.join(bundle,'test-coverage.json'));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',NODE_PATH:''};let child,stderr='';
 const stop=async()=>{if(!child||child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;};
 const start=async()=>{child=spawn(process.execPath,[path.join(bundle,'dt.js'),'serve','--port',String(port)],{cwd:root,env,stdio:['ignore','ignore','pipe']});child.stderr.on('data',x=>stderr+=x);const deadline=Date.now()+10000;while(Date.now()<deadline){try{if((await fetch(base+'/api/admin/runtime/observability',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}if(child.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,100));}throw Error('Standalone server did not become ready: '+stderr);};
 const read=async(story='bundle')=>{const r=await fetch(base+'/api/admin/runtime/observability',{headers:{'x-dt-story':story}});assert.equal(r.status,200);return r.json();};
 try{
  await start();let r=await fetch(base+'/api/admin/runtime/observability',{method:'POST',headers:{'content-type':'application/json','x-dt-story':'bundle'},body:'{"enabled":true}'});assert.equal(r.status,200);await r.json();
  r=await fetch(base+'/api/tool/find',{method:'POST',headers:{'content-type':'application/json','x-dt-story':'bundle'},body:'{"q":"local-fixture","env":"dev"}'});assert.equal(r.status,200);await r.json();
  const traced=await read();assert.ok(traced.spans.some(s=>s.name==='http.server'));assert.equal(traced.storage.persistence,'sqlite');assert.equal((await read('neighbor')).spans.length,0);
  const events=()=>fetch(base+'/api/admin/runtime/events',{headers:{'x-dt-story':'bundle'}}).then(r=>r.json());
  const recorded=await events();assert.equal(recorded.storage.persistence,'sqlite');assert.equal(recorded.summary.tools,1);assert.equal(recorded.records[0].name,'find');
  const coverage=await fetch(base+'/api/admin/runtime/coverage').then(r=>r.json());assert.equal(coverage.available,hasCoverage);if(hasCoverage){const expected=require('../lib/source-version').digest();assert.equal(coverage.currentSourceDigest,expected);assert.equal(coverage.stale,JSON.parse(fs.readFileSync(coverageFile,'utf8')).run.sourceDigest!==expected);}
  await stop();await start();assert.equal((await read()).enabled,true);assert.ok((await read()).spans.length>0);assert.equal((await read('neighbor')).spans.length,0);assert.equal((await events()).summary.tools,1);assert.equal((await fetch(base+'/api/admin/runtime/events',{headers:{'x-dt-story':'neighbor'}}).then(r=>r.json())).summary.total,0);
 }finally{await stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('standalone repository reflection derives and checks source models without the checkout or Joern',()=>{
 const fs=require('node:fs'),os=require('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-bundle-repo-model-')),bundle=path.join(root,'bundle'),home=path.join(root,'home');
 try{fs.mkdirSync(bundle);fs.mkdirSync(home);fs.copyFileSync(path.join(__dirname,'../dist/dt.js'),path.join(bundle,'dt.js'));fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false}}));
 const r=spawnSync(process.execPath,[path.join(bundle,'dt.js'),'tool','repo_model','{"action":"check","machine":"SM37.push"}'],{cwd:root,encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',NODE_PATH:''}});assert.equal(r.status,0,r.stderr||r.stdout);const result=JSON.parse(r.stdout);assert.equal(result.status,'checked');assert.equal(result.machine,'SM37.push');assert.equal(result.sourceDigest,require('../lib/source-version').digest());const id=new URL(result.hierarchy).pathname.split('/').pop(),saved=JSON.parse(fs.readFileSync(path.join(home,'cache/results',id+'.json')));assert.equal(saved.view,'repo-model');assert.equal(saved.data.fresh,true);assert.ok(saved.data.machines.length>=100);assert.ok(saved.data.machines.find(m=>m.id==='SM37.push').consumers.some(c=>c.file==='lib/workspace.js'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('standalone bundle serves the shared UI command transport and authenticated WebSocket tools without node_modules',async()=>{
 const fs=require('node:fs'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dt-bundle-ws-')),bundle=path.join(root,'bundle'),home=path.join(root,'home');fs.mkdirSync(path.join(bundle,'web'),{recursive:true});fs.mkdirSync(home);
 fs.copyFileSync(path.join(__dirname,'../dist/dt.js'),path.join(bundle,'dt.js'));for(const name of ['api-client.html','tool-client.js'])fs.copyFileSync(path.join(__dirname,'../dist/web',name),path.join(bundle,'web',name));
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},server:{accessTokens:[{id:'socket-reader',role:'user',token:'bundle-socket-reader-token'}]}}));
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const base='http://127.0.0.1:'+port,child=spawn(process.execPath,[path.join(bundle,'dt.js'),'serve','--port',String(port)],{cwd:root,env:{PATH:process.env.PATH,DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',NODE_PATH:''},stdio:['ignore','ignore','pipe']});let stderr='',socket;child.stderr.on('data',x=>stderr+=x);
 try{
  const until=Date.now()+10000;let ready=false;while(Date.now()<until){try{if((await fetch(base+'/api/status')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,50));}assert.ok(ready,stderr);
  const page=await fetch(base+'/api-client',{headers:{authorization:'Bearer bundle-socket-reader-token'}}).then(r=>r.text());assert.match(page,/<head><script src="\/static\/tool-client.js">/);assert.equal((await fetch(base+'/static/tool-client.js')).status,200);
  socket=new WebSocket(base.replace('http:','ws:')+'/api/tool-events');const reply=new Promise((resolve,reject)=>{socket.addEventListener('message',event=>{const f=JSON.parse(event.data);if(f.id==='bundle-command'&&['result','error'].includes(f.type))resolve(f);});socket.addEventListener('error',reject,{once:true});});await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});socket.send(JSON.stringify({type:'call',id:'bundle-command',tool:'script_list',headers:{authorization:'Bearer bundle-socket-reader-token','x-dt-story':'bundle-story'},args:{}}));
  const result=await Promise.race([reply,new Promise((_,reject)=>setTimeout(()=>reject(Error('Bundled WS tool did not complete')),5000).unref())]);assert.equal(result.type,'result',JSON.stringify(result));assert.deepEqual(result.result.scripts,[]);
 }finally{socket?.close();if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}fs.rmSync(root,{recursive:true,force:true});}
});
