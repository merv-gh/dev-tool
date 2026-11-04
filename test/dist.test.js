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
