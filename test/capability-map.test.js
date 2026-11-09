const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-capability-test-'));
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_TOOL_PROFILE','DT_SECURITY_PROFILE'])delete process.env[key];
Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_LOG:'quiet',DT_NO_DOCTOR:'1'});
const secret='disposable-capability-reader-token';
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{},uat:{}},scripts:{starters:false},tools:{plugins:['extension.js']},server:{accessTokens:[{id:'limited',token:secret,role:'user',envs:['dev'],tools:['find','context_*','capability_map','extension_probe']}]}}));
fs.writeFileSync(path.join(home,'extension.js'),"module.exports=[{name:'extension_probe',group:'extension',description:'Inspect extension evidence',input:{query:{type:'string'}},run:()=>{throw Error('Browsing must not execute this tool')}}]");
const M=require('../lib/capability-map'),T=require('../lib/tools'),A=require('../lib/access'),L=require('../web/capability-layout');let server,base;
test.before(async()=>{server=require('../server').start({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('one graph covers the exact live registry, every tool has a question and task concepts stay explicit',async()=>{
 const graph=await M.graph(),schemas=await T.schemas({metadata:true}),names=graph.nodes.filter(n=>n.kind==='tool').map(n=>n.name);
 assert.deepEqual(names,schemas.map(t=>t.name));assert.equal(new Set(graph.nodes.map(n=>n.id)).size,graph.nodes.length);assert.equal(graph.coverage.tools,names.length);assert.ok(names.includes('extension_probe'));
 const ids=new Set(graph.nodes.map(n=>n.id));for(const e of graph.edges){assert.ok(ids.has(e.from));assert.ok(ids.has(e.to));assert.match(e.question,/\?$/);}
 for(const name of names)assert.ok(graph.edges.some(e=>e.to==='tool:'+name&&e.kind==='question'),name);
 for(const kind of ['workspace','context','memory'])assert.ok(graph.edges.some(e=>e.from==='object:task'&&e.to==='object:'+kind));
 assert.equal(graph.nodes.find(n=>n.name==='extension_probe').object,'tools');assert.match(graph.guidance,/not observed service dependencies/);
});
test('registry authorization and environment boundaries apply before graph publication',async()=>{
 const scope={principalId:'limited',storyId:'case-one',role:'user',multiUser:true,envs:['dev'],tools:['find','context_*','capability_map','extension_probe']};
 await A.run(scope,async()=>{const model=await M.graph({env:'dev'}),schemas=await T.schemas();assert.deepEqual(model.nodes.filter(n=>n.kind==='tool').map(n=>n.name),schemas.map(n=>n.name));assert.ok(!JSON.stringify(model).includes(secret));assert.ok(!model.nodes.some(n=>n.name==='workspace_push'));assert.equal(model.scope.story,'case-one');await assert.rejects(M.graph({env:'uat'}),e=>e.statusCode===403);});
 const headers={authorization:'Bearer '+secret,'x-dt-story':'case-one'};
 assert.equal((await fetch(base+'/api/capabilities')).status,403);
 const model=await(await fetch(base+'/api/capabilities?env=dev',{headers})).json();assert.equal(model.scope.story,'case-one');assert.ok(!model.nodes.some(n=>n.name==='architecture_save'));
 assert.equal((await fetch(base+'/api/capabilities?env=uat',{headers})).status,403);
});
test('MCP capability view retains a private snapshot and browsing never invokes mapped tools',async()=>{
 const headers={authorization:'Bearer '+secret,'x-dt-story':'case-one','content-type':'application/json'};
 const response=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'capability_map',arguments:{object:'task'}}})});
 const rpc=await response.json();assert.ok(!rpc.result.isError);const result=JSON.parse(rpc.result.content[0].text);assert.ok(result.tools>0);assert.ok(result.view);
 const id=result.view.split('/').pop();await A.run({principalId:'limited',storyId:'case-one',role:'user',multiUser:true},async()=>{const saved=require('../lib/results').load(id);assert.equal(saved.data.initial.object,'task');const html=require('../lib/views').render('capabilities',saved.data);assert.ok(html.includes('dtCapabilityLayout'));assert.ok(html.includes('dtCapabilityMap'));assert.match(require('../lib/views').CSP,/connect-src 'none'/);});
 A.run({principalId:'limited',storyId:'case-two',role:'user',multiUser:true},()=>assert.equal(require('../lib/results').load(id),null));
 const page=await fetch(base+'/show/'+id,{headers});assert.match(page.headers.get('content-security-policy'),/allow-popups-to-escape-sandbox/);assert.match(page.headers.get('content-security-policy'),/connect-src 'none'/);
 A.run({principalId:'limited',storyId:'case-one',role:'user',multiUser:true},()=>{const V=require('../lib/views');V.save('capabilities',{html:'<p>Private override</p>'});assert.doesNotMatch(V.policy(V.get('capabilities')),/allow-popups-to-escape-sandbox/);V.remove('capabilities');assert.doesNotMatch(V.policy(V.get('json')),/allow-popups-to-escape-sandbox/);});
 await assert.rejects(M.show({object:'not-an-object'}),/Unknown capability object/);
});
test('overview geometry contains every tool once; focused questions preserve exact links and empty states',async()=>{
 const graph=await M.graph(),overview=L.scene(graph);assert.equal(overview.nodes.filter(n=>n.kind==='tool').length,graph.coverage.tools);assert.equal(new Set(overview.nodes.map(n=>n.id)).size,overview.nodes.length);
 assert.deepEqual(overview.nodes,L.scene(graph).nodes);
 const focused=L.scene(graph,{object:'table'});assert.ok(focused.edges.some(e=>e.to.startsWith('tool:pg_usage')&&e.question==='Who reads or writes this object?'));assert.ok(focused.nodes.some(n=>n.name==='pg_query'));
 const task=L.scene(graph,{object:'task'});for(const key of ['task','workspace','context','memory'])assert.ok(task.nodes.some(n=>n.id==='object:'+key));
 for(const e of task.edges){assert.ok(task.nodes.some(n=>n.id===e.from));assert.ok(task.nodes.some(n=>n.id===e.to));}
 assert.ok(L.scene(graph,{query:'Who reads or writes'}).nodes.some(n=>n.name==='pg_usage'));const empty=L.scene(graph,{query:'no-such-capability-81723'});assert.equal(empty.tools,0);assert.ok(Number.isFinite(empty.width)&&Number.isFinite(empty.height));
});
