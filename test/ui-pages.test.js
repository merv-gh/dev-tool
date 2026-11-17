const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-ui-pages-'));for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_TOOL_PROFILE','DT_SECURITY_PROFILE'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_STATE_BACKEND:'legacy'});
let fixture,server,base;const A=require('../lib/access'),U=require('../lib/ui-pages'),M=require('../lib/ui-page-model'),T=require('../lib/tools'),templates=require('../lib/ui-page-templates');
const scope=(principalId='admin',storyId='case-one',role='admin',extra={})=>({principalId,storyId,role,multiUser:true,...extra}),owned=fn=>A.run(scope(),fn);
async function post(url,args,token='pages-admin-token-0123456',story='case-one'){const r=await fetch(base+url,{method:'POST',headers:{authorization:'Bearer '+token,'x-dt-story':story,'content-type':'application/json'},body:JSON.stringify(args)});return {status:r.status,body:await r.json()};}
const run=async(id,extra={})=>{const r=await T.call('ui_page',{action:'run',id,waitMs:30000,...extra});assert.equal(r.state,'done',JSON.stringify(r));return r;};
test.before(async()=>{fixture=await require('./helpers/ui-page-fixture').seed(home,{auth:true});require('../lib/config').reload();server=require('../server').start({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fixture.close();await require('../lib/isolate').stop();await require('../lib/pg').closeAll();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('templates and source catalog are discoverable; saving/opening never runs sources',async()=>owned(async()=>{
 const before=fixture.calls.length,catalog=await T.call('ui_page',{action:'templates'});assert.equal(catalog.templates.length,3);assert.ok(catalog.sourceTools.includes('pg_query'));assert.deepEqual(catalog.primitives,['text','table','metric','comparison','collection','panel','action']);
 for(const template of catalog.templates){const {definition}=await T.call('ui_page',{action:'templates',template:template.id});M.normalize(definition);const saved=await T.call('ui_page',{action:'save',id:template.id,expected_revision:null,definition});assert.equal(saved.scope,'shared');const opened=await T.call('ui_page',{action:'open',id:saved.id});assert.equal(opened.status,'not-run');assert.equal(new URL(opened.url).pathname,'/pages');const data=require('../lib/results').load(opened.view.split('/').pop());assert.equal(data.view,'ui-page');assert.equal(data.data.status,'not-run');}
 assert.equal(fixture.calls.length,before);
}));
test('live version reads retain per-environment observations and exact service identities',async()=>owned(async()=>{
 const r=await run('service-versions'),d=await U.detail({id:'service-versions',run:r.run});assert.equal(d.snapshot.sources.baseline.rows.find(r=>r.service==='orders-api').version,'2.8.1');assert.equal(d.snapshot.sources.candidate.rows.find(r=>r.service==='orders-api').version,'2.8.0');assert.equal(d.snapshot.datasets.version_changes.rows.find(r=>r.key.service==='billing-api').status,'same');assert.equal(d.snapshot.datasets.version_changes.rows.find(r=>r.key.service==='orders-api').status,'changed');assert.equal(d.runs[0].id,r.run);assert.ok(fixture.calls.some(c=>c.kind==='consul'));assert.ok(r.view);
 const before=fixture.calls.length;await U.detail({id:'service-versions'});await T.call('ui_page',{action:'get',id:'service-versions'});await T.call('ui_page',{action:'open',id:'service-versions'});assert.equal(fixture.calls.length,before);
}));
test('routine comparison keeps overloads, missing procedures and definition changes distinct',async()=>owned(async()=>{
 const r=await run('procedure-parity',{params:{schemas:['sales']}}),d=U.snapshot(U.get('procedure-parity'),r.run),rows=d.datasets.routine_changes.rows;
 assert.equal(rows.find(r=>r.key.name==='close_order').status,'only-left');assert.equal(rows.find(r=>r.key.name==='audit_order').status,'only-right');assert.equal(rows.find(r=>r.key.arguments==='id text').status,'same');assert.deepEqual(rows.find(r=>r.key.name==='price'&&r.key.arguments==='id bigint').changes,['definition_hash']);
 const calls=fixture.calls.filter(c=>c.tool==='pg_query');assert.ok(calls.every(c=>c.arguments.sql.includes('pg_catalog.pg_get_function_identity_arguments')));assert.deepEqual(calls.at(-1).arguments.params,[['sales']]);assert.ok(calls.every(c=>c.arguments.all));
}));
test('failed and incomplete reads cannot become confirmed routine absence',async()=>owned(async()=>{
 try{fixture.state.failUat=true;let r=await run('procedure-parity'),d=U.snapshot(U.get('procedure-parity'),r.run);assert.equal(d.status,'partial');assert.equal(d.datasets.routine_changes.error,'Upstream source unavailable');assert.equal(d.datasets.routine_changes.rows.length,0);
 fixture.state.failUat=false;fixture.state.partial=true;r=await run('procedure-parity');d=U.snapshot(U.get('procedure-parity'),r.run);assert.equal(d.status,'incomplete');assert.equal(d.datasets.routine_changes.rows.find(r=>r.key.name==='close_order').status,'unknown');assert.ok(d.gaps.length);
 }finally{fixture.state.failUat=false;fixture.state.partial=false;}
}));
test('definition revisions reject lost updates and old runs stay pinned to their definition',async()=>owned(async()=>{
 const first=U.get('service-versions'),oldRun=(await U.detail({id:first.id})).runs[0].id,changed=U.save({id:first.id,expected_revision:first.revision,definition:{...first.definition,title:'Reviewed service versions'}});assert.notEqual(changed.revision,first.revision);
 assert.throws(()=>U.save({id:first.id,expected_revision:first.revision,definition:first.definition}),/changed/);assert.equal(U.get(first.id,undefined,first.revision).definition.title,first.definition.title);assert.equal((await U.detail({id:first.id})).runs.length,0);assert.equal((await U.detail({id:first.id,revision:first.revision,run:oldRun})).snapshot.definition.title,first.definition.title);
 const missing=await U.detail({id:'procedure-parity',run:oldRun});assert.equal(missing.snapshot,null);assert.match(missing.notice,/unavailable or expired/);
}));
test('shared definitions are readable but publication and runs respect principal, story, tool and environment access',async()=>{
 const definition=templates.get('procedure-parity'),before=fixture.calls.length;
 const published=await post('/api/tool/ui_page',{action:'get',id:'procedure-parity'},'pages-reader-token-012345');assert.equal(published.status,200);
 assert.equal((await post('/api/tool/ui_page',{action:'save',id:'reader-shared',expected_revision:null,definition},'pages-reader-token-012345')).status,403);
 const saved=await post('/api/tool/ui_page',{action:'save',id:'reader-draft',scope:'private',expected_revision:null,definition},'pages-reader-token-012345');assert.equal(saved.status,200);
 for(const [token,story]of [['pages-admin-token-0123456','case-one'],['pages-reader-token-012345','other-case']])assert.notEqual((await post('/api/tool/ui_page',{action:'get',id:'reader-draft',scope:'private'},token,story)).status,200);
 assert.equal((await post('/api/tool/ui_page',{action:'run',id:'procedure-parity'},'pages-limited-token-01234')).status,403);assert.equal(fixture.calls.length,before);
 await A.run(scope('reader','case-one','user'),async()=>{const r=await run('procedure-parity');assert.ok(r.run);});
 const admin=await owned(()=>U.detail({id:'procedure-parity'})),reader=await A.run(scope('reader','case-one','user'),()=>U.detail({id:'procedure-parity'}));assert.notEqual(admin.runs[0].id,reader.runs[0].id);
 const r=await fetch(base+'/api/pages/catalog',{headers:{authorization:'Bearer pages-limited-token-01234'}});assert.deepEqual((await r.json()).envs,['dev']);
});
test('refresh deduplicates active work, cancellation stops the read and leaves last observation intact',async()=>owned(async()=>{
 fixture.state.delay=500;try{const before=(await U.detail({id:'procedure-parity'})).runs[0].id,a=await T.call('ui_page',{action:'run',id:'procedure-parity'}),b=await T.call('ui_page',{action:'run',id:'procedure-parity'});assert.equal(a.job,b.job);
 await new Promise(r=>setTimeout(r,40));require('../lib/jobs').cancel(a.job);await require('../lib/jobs').find(a.job).promise;const ended=await T.call('ui_page',{action:'run',job:a.job});assert.equal(ended.state,'cancelled');assert.equal((await U.detail({id:'procedure-parity'})).runs[0].id,before);
 }finally{fixture.state.delay=0;}
}));
test('page host sign-in preserves safe page destinations and snapshot policy never enables network execution',async()=>{
 let r=await fetch(base+'/pages?id=procedure-parity');assert.equal(r.status,401);assert.match(await r.text(),/Sign in to Pages/);
 r=await fetch(base+'/api/session',{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify({token:'pages-reader-token-012345',next:'/pages?id=procedure-parity'})});assert.equal(r.headers.get('location'),'/pages?id=procedure-parity');
 const V=require('../lib/views');assert.match(V.policy(V.get('ui-page')),/connect-src 'none'/);assert.match(V.policy(V.get('ui-page')),/allow-popups-to-escape-sandbox/);
});
test('invalid target bindings and resource-heavy compositions fail without publishing a misleading result',async()=>owned(async()=>{
 const before=fixture.calls.length;await assert.rejects(U.run({id:'procedure-parity',params:{right_env:'dev',right_db:'archive'}}),/not configured/);assert.equal(fixture.calls.length,before);
 const definition={version:1,title:'Bounded report',sources:[{id:'s',rows:Array.from({length:200},(_,id)=>({id,body:'x'.repeat(200)}))}],datasets:Array.from({length:20},(_,n)=>({id:'set_'+n,op:'concat',from:Array(12).fill('s')})),widgets:[{id:'table',type:'table',title:'Rows',data:'s'}]};U.save({id:'bounded-report',expected_revision:null,definition});const r=await U.run({id:'bounded-report',waitMs:30000});assert.equal(r.state,'failed');assert.match(r.error,/6 MiB budget/);assert.equal((await U.detail({id:'bounded-report'})).snapshot,null);
}));
test('expired observations leave the definition refreshable and damaged revisions never masquerade as pinned content',async()=>owned(async()=>{
 const r=await run('procedure-parity'),record=U.get('procedure-parity');fs.unlinkSync(path.join(require('../lib/config').PATHS.cache,'results',r.run+'.json'));const d=await U.detail({id:record.id,run:r.run});assert.equal(d.snapshot,null);assert.match(d.notice,/definition is retained/);
 const file=path.join(home,'pages','shared',record.id,'revisions',record.revision+'.json'),bytes=fs.readFileSync(file);try{fs.writeFileSync(file,JSON.stringify({...record,definition:{...record.definition,title:'Unexpected edit'}}));assert.throws(()=>U.get(record.id),/damaged/);}finally{fs.writeFileSync(file,bytes);}
}));
