const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-glob-regression-'));
process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const root=path.join(home,'repo'),files=['src/main/Root.java','src/main/java/p/Read.java','src/main/kotlin/p/Write.kt','module/src/main/java/p/Library.java','src/test/java/p/ReadTest.java','src/release.cjs','src/consume.mjs','src/typed.cts','src/typed.mts','config/application-a.yml','config/application-aa.yml','config/application-a.yml.backup'];
for(const f of files){const p=path.join(root,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'// scope_probe exports.release sales.orders.amount\n');}
const CI=require('../lib/codeindex');CI.build(root,'REGRESSION/globs',{project:'REGRESSION',repo:'globs'});
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const hits=glob=>CI.grep(['REGRESSION/globs'],'scope_probe',{glob,limit:100}).hits.map(h=>h.path).sort();
test('recursive path filters include direct and nested files, including module source roots',()=>{
 assert.deepEqual(hits('src/main/**'),files.filter(f=>f.includes('src/main/')).sort());
 assert.deepEqual(hits('src/**/Read.java'),['src/main/java/p/Read.java']);
 assert.deepEqual(hits('**/Root.java'),['src/main/Root.java']);
 assert.deepEqual(hits('src/main/*.java'),['src/main/Root.java']);
});
test('comma alternatives retain both anchors and question marks match exactly one character',()=>{
 assert.deepEqual(hits('*.java,*.kt'),files.filter(f=>/\.(java|kt)$/.test(f)).sort());
 assert.deepEqual(hits('application-?.yml'),['config/application-a.yml']);
 assert.deepEqual(hits('missing/**,application-?.yml'),['config/application-a.yml']);
 assert.deepEqual(hits('src/missing/**'),[]);
});
test('CommonJS and ESM JavaScript/TypeScript files are searchable through the public tool',async()=>{
 const r=await require('../lib/tools').call('code_search',{pattern:'exports.release',repos:'REGRESSION/globs',glob:'*.cjs,*.mjs,*.cts,*.mts'});
 assert.equal(r.total,4);
 assert.deepEqual(hits('*.cjs,*.mjs,*.cts,*.mts'),['src/consume.mjs','src/release.cjs','src/typed.cts','src/typed.mts']);
});
