const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-task-results-'));Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_STATE_BACKEND:'legacy'});delete process.env.DT_CACHE_DIR;delete process.env.DT_CONFIG_DIR;
const A=require('../lib/access'),R=require('../lib/results'),P=require('../lib/task-results');
const run={id:'run-renderer-test',task:'task-renderer-test',owner:A.normalize({principalId:'alice',storyId:'original-chat',multiUser:true,storyBound:true,role:'user'})};
const id=url=>new URL(url,'http://fixture').pathname.split('/').pop();
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('native test, diff and graph renderers are retained under the owner and survive original-view pruning',()=>{
 const links=A.run({...run.owner,storyId:'task:'+run.task},()=>Object.fromEntries([['view','tests'],['diagram','semantic-flow-map'],['changesView','patch']].map(([key,view])=>[key,R.saveView(view,{marker:view,counts:{passed:1,failed:0}},{title:'Synthetic renderer contract'})])));
 const output=P.capture(run,'test_run',links);assert.equal(output.visualizations.length,3);
 for(const [index,name]of ['tests','semantic-flow-map','patch'].entries())A.run(run.owner,()=>{const v=output.visualizations[index],stored=R.load(id(v.url));assert.equal(v.view,name);assert.equal(stored.view,name);assert.equal(stored.data.marker,name);assert.equal(stored.owner.storyId,run.owner.storyId);assert.ok(fs.existsSync(path.join(home,'cache/results/_retained',id(v.url)+'.json')));});
 A.run({...run.owner,principalId:'bob'},()=>{for(const v of output.visualizations)assert.equal(R.load(id(v.url)),null);});
 const prior=process.env.DT_RESULTS_MAX_MB;try{process.env.DT_RESULTS_MAX_MB='0.0001';A.run({...run.owner,storyId:'task:'+run.task},()=>R.saveView('json',{large:'x'.repeat(1000)}));assert.equal(R.raw(id(links.view)),null);A.run(run.owner,()=>assert.ok(R.load(id(output.visualizations[0].url))));}finally{if(prior===undefined)delete process.env.DT_RESULTS_MAX_MB;else process.env.DT_RESULTS_MAX_MB=prior;}
});
test('rows use the native table and structured objects use the JSON tree without remote requests',()=>{
 A.run(run.owner,()=>{const rows=[{order_id:42,total:0}],table=P.capture(run,'pg_query',{rows});assert.equal(table.visualizations[0].view,'table');assert.deepEqual(R.load(id(table.visualizations[0].url)).data,rows);const tree=P.capture(run,'confluence_page',{title:'Requirements',version:7});assert.equal(tree.visualizations[0].view,'json');assert.equal(R.load(id(tree.visualizations[0].url)).data.version,7);});
});
test('completed jobs keep their native renderer with final evidence rather than the running snapshot',()=>{
 const initial=A.run({...run.owner,multiUser:true,storyId:'task:'+run.task},()=>({job:'semantic-job',state:'running',view:R.saveView('semantic-flow-map',{state:'running'})}));
 const final={job:'semantic-job',state:'completed',flowMap:{nodes:[{id:'entry'},{id:'exit'}]}};
 const value=P.complete(run,initial,final),output=P.capture(run,'semantic_query',value);
 A.run(run.owner,()=>{const saved=R.load(id(output.visualizations[0].url));assert.equal(saved.view,'semantic-flow-map');assert.deepEqual(saved.data,final);assert.equal(saved.data.state,'completed');});
 const ready={...final,view:initial.view};assert.equal(P.complete(run,initial,ready),ready);
});
test('foreign view ids cannot be copied across owners; arbitrary URLs are never embedded',()=>{
 const foreign=A.run({...run.owner,principalId:'bob'},()=>R.saveView('tests',{secret:'private'}));const output=P.capture(run,'find',{view:foreign});assert.match(output.presentationError,/unavailable/);assert.equal(output.visualizations[0].view,'json');A.run(run.owner,()=>assert.equal(R.load(id(foreign)),null));assert.ok(P.capture(run,'find',{view:'https://external.invalid/payload',diagram:'javascript:alert(1)'}).visualizations.every(v=>v.url.startsWith('/show/')));
});
