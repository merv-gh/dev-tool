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
 for(const file of ['dt.js','telemetry-worker.js'])fs.copyFileSync(path.join(__dirname,'../dist',file),path.join(bundle,file));
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
  const coverage=await fetch(base+'/api/admin/runtime/coverage').then(r=>r.json());assert.equal(coverage.available,hasCoverage);if(hasCoverage){const expected=require('../lib/source-version').digest();assert.equal(coverage.currentSourceDigest,expected);assert.equal(coverage.stale,JSON.parse(fs.readFileSync(coverageFile,'utf8')).run.sourceDigest!==expected);}
  await stop();await start();assert.equal((await read()).enabled,true);assert.ok((await read()).spans.length>0);assert.equal((await read('neighbor')).spans.length,0);
 }finally{await stop();fs.rmSync(root,{recursive:true,force:true});}
});
