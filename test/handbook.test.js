const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-handbook-test-'));
process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_NO_DOCTOR='1';process.env.DT_STATE_BACKEND='legacy';
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_SCRIPTS_DIR','DT_WORK_DIR','DT_BUILD_DIR','DT_TOOLS','DT_TOOL_PROFILE'])delete process.env[key];
const secret='handbook-private-credential-DO-NOT-COPY';
fs.writeFileSync(path.join(home,'.env'),'PRIVATE_BEARER='+secret+'\n');fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{orders:'postgres://user:'+secret+'@private.example/orders'},consul:'http://private.example',kafkaUi:'http://private.kafka.example'}},scripts:{starters:false},tools:{custom:[{name:'local_probe',type:'sql',sql:'select 1',description:'A local configured probe'}]}}));
const H=require('../lib/handbook'),T=require('../lib/tools'),A=require('../lib/access'),context=require('../lib/context'),content=require('../lib/handbook-content');
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('live handbook covers the exact enabled registry, native views and every chapter crosslink',async()=>{
 const catalog=await H.catalog(),tools=await T.schemas({metadata:true});assert.deepEqual(catalog.tools.map(t=>t.name),tools.map(t=>t.name));assert.ok(catalog.tools.some(t=>t.name==='local_probe'));assert.equal(catalog.views.filter(v=>v.builtin).length,20);assert.ok(catalog.chapters.length>=20);
 const ids=new Set(catalog.chapters.map(c=>c.id));for(const chapter of catalog.chapters){assert.ok(chapter.sections.length);for(const related of chapter.related)assert.ok(ids.has(related),related);}
 for(const tool of catalog.tools)assert.ok(ids.has(tool.chapter),tool.name);
 for(const view of catalog.views)assert.ok(content.visualHelp[view.name]||!view.builtin);
});
test('all prepared handbook examples conform to actual input schemas',async()=>{
 const tools=await T.schemas({metadata:true}),values={env:'dev',service:'checkout',repo:'DEMO/checkout',db:'orders',context:'handbook-task',ticket:'HANDBOOK-101',revisionKey:'returned-revision-key',analysis:'returned-analysis-id'},fill=a=>JSON.parse(JSON.stringify(a).replace(/\{\{(\w+)\}\}/g,(_,name)=>values[name]));
 const examples=content.chapters.flatMap(c=>c.sections.flatMap(s=>s.examples||[])).concat(content.indexes.map(i=>i.refresh).filter(Boolean));
 for(const example of examples){const schema=tools.find(t=>t.name===example.tool)?.inputSchema;assert.ok(schema,example.tool);assert.deepEqual(require('../lib/schema').validate(fill(example.args),schema),[],example.tool);}
});
test('safe self-context uses local metadata, never parses a large catalog or exposes secrets/paths',async()=>{
 const directory=path.join(home,'cache/dev/pg');fs.mkdirSync(directory,{recursive:true});const heavy=path.join(directory,'orders.json');const fd=fs.openSync(heavy,'w');fs.ftruncateSync(fd,256*1024*1024);fs.closeSync(fd);
 const original=fs.readFileSync;fs.readFileSync=function(file,...args){assert.notEqual(String(file),heavy,'self context must not parse the database catalog');return original.call(this,file,...args);};
 try{const snapshot=await H.selfContext({env:'dev'}),serialized=JSON.stringify(snapshot);assert.ok(snapshot.capabilities.postgres);assert.ok(snapshot.capabilities.kafka);assert.ok(snapshot.indices.find(i=>i.id==='postgres').present);assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes(home));assert.ok(!serialized.includes('private.example'));assert.ok(!fs.existsSync(path.join(home,'contexts/dev-tool-self')));assert.equal(snapshot.activity.meaning.includes('not a model/task success'),true);}finally{fs.readFileSync=original;}
 await assert.rejects(H.selfContext({env:'unknown'}),/configured environment/);
});
test('persistent self-context refresh preserves operator notes and stays isolated by principal/story',async()=>{
 const owner=(principalId,storyId)=>({principalId,storyId,role:'user',multiUser:true});
 await A.run(owner('alice','one'),async()=>{const first=await H.selfContext({env:'dev',save:true});assert.equal(first.saved.id,'dev-tool-self');const note=context.read({id:'dev-tool-self',path:'operator-notes.md'});context.write({id:'dev-tool-self',path:'operator-notes.md',content:'Use reviewed runner profile staging-smoke.',expected_revision:note.revision});await H.selfContext({env:'dev',save:true});assert.equal(context.read({id:'dev-tool-self',path:'operator-notes.md'}).content,'Use reviewed runner profile staging-smoke.');const catalog=await H.catalog();assert.ok(!catalog.tools.some(t=>t.name==='architecture_save'));});
 await A.run(owner('alice','two'),async()=>{assert.throws(()=>context.get('dev-tool-self'),/not found/);await H.selfContext({env:'dev',save:true});assert.doesNotMatch(context.read({id:'dev-tool-self',path:'operator-notes.md'}).content,/staging-smoke/);});
 await A.run(owner('bob','one'),async()=>assert.throws(()=>context.get('dev-tool-self'),/not found/));
});
test('handbook search is bounded, readable by models and cannot execute examples',async()=>{
 const result=await T.call('handbook',{query:'tenant',limit:3});assert.ok(result.chapters.length);assert.ok(result.chapters.length<=3);const chapter=await T.call('handbook',{chapter:'case-tenant'});assert.ok(chapter.sections.some(s=>s.decision));await assert.rejects(T.call('handbook',{chapter:'missing'}),/Unknown handbook/);
});
test('handbook image paths are allowlisted and all bundled examples have actual PNGs',()=>{
 for(const name of H.imageNames()){const file=H.imageFile(name);assert.ok(file,name);assert.equal(fs.readFileSync(file).subarray(1,4).toString(),'PNG');}for(const name of ['../config.json','../../.env','private.png'])assert.equal(H.imageFile(name),null);
});
test('portable tool links target explicit anchors and extension snippets follow the actual registry contract',()=>{
 const reference=fs.readFileSync(path.join(__dirname,'../docs/handbook/tools.md'),'utf8');for(const match of reference.matchAll(/\]\(#(tool-[^)]+)\)/g))assert.ok(reference.includes('<a id="'+match[1]+'"></a>'),match[1]);
 const snippets=content.chapters.find(c=>c.id==='extend').sections.find(s=>s.id==='first-extension').snippets;
 const custom=JSON.parse(snippets[0].code).tools.custom[0],tool=T.declarative(custom);assert.equal(tool.name,'refund_count');assert.ok(tool.required.includes('tenantId'));assert.equal(T.bindSql(custom.sql,{tenantId:'tenant-a'}).values[0],'tenant-a');
 const sandbox={module:{exports:null}};require('node:vm').runInNewContext(snippets[1].code,sandbox);const result=sandbox.module.exports[0].run({label:'refund approved'});assert.equal(result.words,2);assert.equal(result.characters,15);
});
test('the optional boundary exercise really fails then passes the same independent sandbox assertions',async()=>{
 const section=content.chapters.find(c=>c.id==='case-contracts').sections.find(s=>s.id==='local-practice');
 context.open({id:'boundary-practice',title:'Practice'});const records=[];
 for(const example of section.examples.filter(e=>e.tool==='context_run')){
  const result=await T.call(example.tool,{...example.args,id:'boundary-practice'});assert.equal(result.ok,true);assert.ok(result.saved);const record=JSON.parse(context.read({id:'boundary-practice',path:result.saved}).content);assert.equal(record.result.error,undefined);records.push(record.result);
 }
 assert.deepEqual(records[0].tests.map(t=>t.name),records[1].tests.map(t=>t.name));assert.equal(records[0].tests.filter(t=>!t.ok).length,2);assert.equal(records[1].tests.filter(t=>t.ok).length,3);assert.equal(records[0].returned.observed,'1000');assert.equal(records[1].returned.observed,'1001');
});
