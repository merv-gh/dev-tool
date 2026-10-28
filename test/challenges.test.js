const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const root=path.resolve(__dirname,'../challenges');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
for(const pack of ['developer-v1','developer-supplement-v1.2'])test(`${pack} frozen sources match recorded hashes`,()=>{
 const dir=path.join(root,pack),revision=require(path.join(dir,'revision.json'));
 for(const[file,expected]of Object.entries(revision.files))assert.equal(hash(fs.readFileSync(path.join(dir,file))),expected,file);
 assert.equal(hash(JSON.stringify(revision.files,Object.keys(revision.files).sort()).replaceAll(':',': ').replaceAll(',',', ')),revision.sha256);
});
test('public catalog has executable cases, explicit gaps and valid corrected tool names',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-challenge-map-'));const saved=process.env.DT_HOME;process.env.DT_HOME=home;fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
 try{
 const cases=require(path.join(root,'developer-v1/cases.json'));assert.equal(cases.length,8);const ids=new Set(cases.map(c=>c.id));assert.equal(ids.size,8);for(const c of cases){assert.ok(c.request&&c.report);assert.ok(fs.existsSync(path.join(root,'developer-v1',c.id,'INCIDENT.md')));}
 const catalog=require(path.join(root,'developer-v1/catalog.json'));assert.equal(catalog.length,24);assert.equal(catalog.filter(c=>c.status==='executable').length,8);assert.equal(catalog.filter(c=>c.status==='expected-gap').length,3);
 const registry=await require('../lib/tools').ready();const actual=new Set(Object.keys(registry.byName));const correction={testdb_create:['testdb_initialize','testdb_template_build','testdb_clone','fixture_replay','testdb_release'],testdb_drop:['testdb_release']};
 for(const row of [...catalog,...require(path.join(root,'developer-supplement-v1.2/scenarios.json'))])for(const t of row.tools.flatMap(t=>correction[t]||[t]))assert.ok(actual.has(t),`${row.id} references unknown tool ${t}`);
 }finally{if(saved===undefined)delete process.env.DT_HOME;else process.env.DT_HOME=saved;fs.rmSync(home,{recursive:true,force:true});}
});
