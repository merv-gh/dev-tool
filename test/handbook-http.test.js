const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-handbook-http-'));process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_NO_DOCTOR='1';process.env.DT_STATE_BACKEND='legacy';
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_SCRIPTS_DIR','DT_WORK_DIR','DT_TOOLS'])delete process.env[key];
const token='handbook-reader-disposable-token';fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},server:{accessTokens:[{id:'reader',role:'user',token}]}}));
const server=require('../server').start({port:0}),headers={authorization:'Bearer '+token,'x-dt-story':'one'};let base;
test.before(()=>new Promise(resolve=>server.on('listening',()=>{base='http://127.0.0.1:'+server.address().port;resolve();})));
test.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('handbook/current context/sample endpoints require authentication while allowlisted demo images are portable',async()=>{
 for(const route of ['/handbook','/api/handbook','/api/handbook/context','/api/handbook/sample?view=json'])assert.equal((await fetch(base+route)).status,403,route);
 assert.equal((await fetch(base+'/handbook',{headers})).status,200);
 const catalog=await(await fetch(base+'/api/handbook',{headers})).json();assert.ok(catalog.tools.some(t=>t.name==='self_context'));assert.ok(!catalog.tools.some(t=>t.name==='architecture_save'));
 const snapshot=await(await fetch(base+'/api/handbook/context?env=dev',{headers})).json();assert.equal(snapshot.identity.storyId,'one');assert.ok(!JSON.stringify(snapshot).includes(token));
 const sample=await(await fetch(base+'/api/handbook/sample?view=json',{headers})).json();assert.equal(sample.view,'json');assert.notEqual(sample.data,undefined);
 const image=await fetch(base+'/handbook-images/sample-json.png');assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);assert.equal((await fetch(base+'/handbook-images/private.png')).status,404);
});
test('persistent self-context through the tool API remains private to its authenticated story',async()=>{
 const response=await fetch(base+'/api/tool/self_context',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({env:'dev',save:true})});assert.equal(response.status,200);const saved=(await response.json()).result.saved;assert.equal(saved.id,'dev-tool-self');const link=new URL(saved.admin,base),params=new URLSearchParams(link.hash.split('?')[1]);assert.equal(params.get('story'),'one');assert.equal(params.get('env'),'dev');assert.equal(params.get('context'),'dev-tool-self');assert.equal(params.get('file'),'operator-notes.md');
 const read=story=>fetch(base+'/api/tool/context_get',{method:'POST',headers:{...headers,'x-dt-story':story,'content-type':'application/json'},body:JSON.stringify({id:'dev-tool-self'})});assert.equal((await read('one')).status,200);assert.notEqual((await read('two')).status,200);
});
