const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-catalog-generations-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_SECURITY_PROFILE'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_STATE_BACKEND:'legacy',DT_NO_DOCTOR:'1'});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{}},uat:{postgres:{}}}}));
const S=require('../lib/catalog-store');
const edge={db:'orders',target:'sales.orders',user:'order-service',userKind:'service',role:'write'};
function publish(lines,signature,edges=[edge]){const w=S.writer('dev',signature,'usage-'+signature);try{for(const e of edges)w.edge(e);w.finishEdges();for(const line of lines)w.line(line);return w.commit();}catch(e){w.abort();throw e;}}
test('exact matching, Unicode, direct ranking, cursor isolation and retained generations',()=>{
 const first=publish(['pg orders sales.first ~1: id int | used by: svc refund(read)','pg orders sales.refund ~2: имя text','kafka refund.created 2: id','pg orders sales.other ~1: id int'],'one');
 const page=S.page('dev','refund',{limit:1});assert.match(page.results[0].line,/sales.refund/);assert.ok(page.nextCursor);
 const seen=[page.results[0].line];let cursor=page.nextCursor;while(cursor){const p=S.page('dev','refund',{limit:1,cursor});seen.push(...p.results.map(r=>r.line));cursor=p.nextCursor;}assert.equal(seen.length,3);assert.match(seen.at(-1),/sales.first/);
 assert.equal(S.page('dev','имя').results.length,1);assert.equal(S.page('dev','pg: id').results.length,2);assert.throws(()=>S.page('dev','another',{cursor:page.nextCursor}),/Cursor/);
 S.manage('dev',{action:'pin',generation:first.generation});const second=publish(['pg orders sales.refund ~3: имя text','kafka refund.created 2: id'],'two',[]);assert.notEqual(second.generation,first.generation);
 assert.match(S.page('dev','refund',{generation:first.generation}).results[0].line,/~2/);assert.match(S.page('dev','refund').results.find(r=>r.line.includes('sales.refund')).line,/~3/);assert.equal(S.page('dev','',{object:'sales.orders',generation:first.generation}).results.length,1);assert.equal(S.page('dev','',{object:'sales.orders'}).results.length,0);
 assert.throws(()=>S.manage('dev',{action:'gc',generation:first.generation}),/pinned/);S.manage('dev',{action:'unpin',generation:first.generation});S.manage('dev',{action:'gc',generation:first.generation});assert.throws(()=>S.page('dev','',{generation:first.generation}),/unavailable/);
});
test('unchanged updates write no new records; failure and cancellation roll back staged changes',()=>{
 const before=S.status('dev');const same=publish(['pg orders sales.refund ~3: имя text','kafka refund.created 2: id'],'touch',[]);assert.equal(same.changed,0);assert.equal(S.status('dev').generation,before.generation);assert.ok(S.unchanged('dev','touch'));
 const w=S.writer('dev','failed');w.finishEdges();w.line('pg orders sales.new ~1: id int');w.abort();assert.equal(S.page('dev','sales.new').results.length,0);assert.equal(S.status('dev').generation,before.generation);
 assert.throws(()=>publish(['pg orders sales.x ~1: a int','pg orders sales.x ~2: b int'],'duplicate'),/Duplicate/);assert.equal(S.status('dev').generation,before.generation);
});
test('streaming fallback and worker serving preserve legacy find shape',async()=>{
 const dir=path.join(home,'cache/uat');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'catalog.txt'),'pg db sales.возврат ~1: id int\nkafka abc 1: x\n');
 const initializing=new (require('node:sqlite').DatabaseSync)(S.filename('uat'));initializing.close();assert.equal(S.page('uat','возв'),null,'a first index publication in progress keeps the text fallback available');
 const C=require('../lib/catalog');assert.deepEqual(C.find('uat','возв'),['pg db sales.возврат ~1: id int']);const result=await require('../lib/isolate').exec('catalog','find',['dev','refund']);assert.ok(Array.isArray(result));assert.ok(result.every(v=>typeof v==='string'));await require('../lib/isolate').stop();
});
test('oversized escaped records fail explicitly instead of returning a stuck cursor',()=>{
 publish(['pg orders sales.large ~1: '+String.fromCharCode(0).repeat(400000)],'large-record');
 assert.throws(()=>S.page('dev',''),e=>e.code==='DT_RESULT_TOO_LARGE');
 publish(['pg orders sales.refund ~3: имя text'],'after-large-record');
});
test('saved results, task captures and shared files protect historical catalog evidence',async()=>{
 const first=publish(['pg orders sales.evidence ~1: id int'],'evidence-one'),page=S.page('dev','sales.evidence');
 require('../lib/results').saveView('json',page);
 const context=require('../lib/context');context.open({id:'catalog-evidence',title:'Catalog evidence'});context.write({id:'catalog-evidence',path:'evidence.json',content:JSON.stringify(page)});
 require('../lib/project-context').save({id:'catalog-evidence',expected_revision:null,reason:'Retain source identity',document:{title:'Catalog evidence'},files:[{path:'evidence.json',content:JSON.stringify(page)}]});
 publish(['pg orders sales.evidence ~2: id int'],'evidence-two');assert.throws(()=>S.manage('dev',{action:'gc',generation:first.generation}),/referenced/);
 const refs=S.manage('dev',{action:'references',generation:first.generation});assert.equal(refs.length,3);
 for(const r of refs)S.manage('dev',{action:'release_ref',generation:first.generation,reference:r.reference});S.manage('dev',{action:'gc',generation:first.generation});
 const T=require('../lib/tools'),p=await T.call('catalog_search',{env:'dev',q:'evidence',limit:1});assert.ok(p.generation);assert.equal(p.results.length,1);const usage=await T.call('catalog_usage',{env:'dev',object:'sales.orders'});assert.equal(usage.results.length,1);assert.ok((await T.call('catalog_manage',{env:'dev',action:'list'})).length);
});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
