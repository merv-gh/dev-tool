const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-code-fallback-'));process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_LOG='quiet';
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false}}));
const put=(name,text)=>{const file=path.join(home,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
put('repos/SHOP/orders/src/App.java','class App {\n  void publish() { sendOrder(); }\n}\n');put('repos/SHOP/orders/config.yml','order.topic: orders.created\n');
put('repos/SHOP/orders/src/test/Test.java','void check() { sendOrder(); }\n');put('repos/SHOP/orders/target/Generated.java','sendOrder();');put('repos/SHOP/orders/.git/config','sendOrder();');
put('repos/SHOP/billing/App.java','void bill() { sendOrder(); }\n');
const T=require('../lib/tools'),CI=require('../lib/codeindex'),A=require('../lib/access');
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('cold single-repo search uses ripgrep when installed, skips build trees, and omits repo columns',async()=>{
 const r=await T.call('code_search',{repo:'orders',pattern:'sendOrder',tests:false,context:1});assert.equal(r.total,1);assert.equal(r.repository,'SHOP/orders');assert.ok(!('repo' in r.rows[0]));assert.match(r.rows[0].context,/class App/);assert.deepEqual(r.unindexed,['SHOP/orders']);
 assert.deepEqual(r.backends,[require('child_process').spawnSync('rg',['--version']).status===0?'ripgrep':'native-scan']);
 const stored=require('../lib/results').load(r.view.split('/').pop());assert.ok(!('repo' in stored.rows[0]));assert.equal(CI.load('SHOP/orders'),null,'grep does not create an index');
});
test('general search merges indexed and cold repos and retains origin for multiple sources',async()=>{
 CI.build(path.join(home,'repos/SHOP/billing'),'SHOP/billing',{project:'SHOP',repo:'billing'});
 const r=await T.call('code_search',{pattern:'sendOrder',tests:false});assert.equal(r.total,2);assert.deepEqual(new Set(r.rows.map(x=>x.repo)),new Set(['SHOP/billing','SHOP/orders']));assert.ok(r.backends.includes('trigram'));assert.ok(r.unindexed.includes('SHOP/orders'));
 const old=await T.call('code_search',{repos:'SHOP/orders',pattern:'orders.created',glob:'*.yml'});assert.equal(old.total,1);assert.ok(!('repo' in old.rows[0]));
});
test('missing rg uses the bounded native scanner; JavaScript regex keeps lookbehind semantics',async()=>{
 process.env.DT_RG=path.join(home,'missing-rg');try{
  const r=await T.call('code_search',{repo:'orders',pattern:'(?<=void )publish',regex:true,glob:'**/*.java'});assert.equal(r.total,1);assert.deepEqual(r.backends,['native-scan']);assert.match(r.rows[0].file,/App.java:2$/);
 }finally{delete process.env.DT_RG;}
});
test('service alias and private workspaces can be searched before indexing, without cross-story access',async()=>{
 put('passports/order-service/passport.json',JSON.stringify({service:'order-service',repo:{project:'SHOP',repo:'orders'}}));
 assert.equal((await T.call('code_search',{repo:'order-service',pattern:'orders.created'})).total,1);
 const owner=A.normalize({principalId:'alice',storyId:'one',multiUser:true}),id='unindexed-private';
 A.run(owner,()=>{const root=path.join(A.scopedDirectory(path.join(home,'work')),id);fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'private.js'),'const PRIVATE_MARKER = 42;');put(path.relative(home,path.join(A.scopedDirectory(path.join(home,'cache/work')),id+'.json')),JSON.stringify({id,owner:A.owner(),path:root,repo:'private',project:'SHOP',createdAt:new Date().toISOString()}));});
 assert.equal((await A.run(owner,()=>T.call('code_search',{repo:'work/'+id,pattern:'PRIVATE_MARKER'}))).total,1);
 assert.equal((await A.run({...owner,storyId:'two'},()=>T.call('code_search',{repo:'work/'+id,pattern:'PRIVATE_MARKER'}))).total,0);
});
test('missing pinned revisions never grep latest checkout and conflicting selectors are rejected',async()=>{
 assert.equal((await T.call('code_search',{repo:'SHOP/orders@'+'a'.repeat(40)+'-'+'b'.repeat(24),pattern:'orders.created'})).total,0);
 await assert.rejects(T.call('code_search',{repo:'orders',repos:'billing',pattern:'x'}),/repo for one/);
 await assert.rejects(T.call('code_search',{repo:'_STORIES/other/work/private',pattern:'x'}),/Invalid code index/);
});


test('cancelling a cold grep stops its owned ripgrep process',async()=>{
 const executable=path.join(home,'slow-rg'),pidfile=path.join(home,'rg.pid');fs.writeFileSync(executable,'#!'+process.execPath+'\nrequire("fs").writeFileSync('+JSON.stringify(pidfile)+',String(process.pid));setInterval(()=>{},1000);',{mode:0o755});process.env.DT_RG=executable;
 const E=require('../lib/execution');const operation=E.start({kind:'test'},()=>T.call('code_search',{repo:'orders',pattern:'sendOrder'}));
 try{for(let i=0;i<500&&!fs.existsSync(pidfile);i++)await new Promise(r=>setTimeout(r,10));assert.ok(fs.existsSync(pidfile),JSON.stringify(E.get(operation.id)));const pid=Number(fs.readFileSync(pidfile));E.cancel(operation.id,'cancel search');await assert.rejects(operation.promise,e=>e.code==='DT_CANCELLED');assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');}
 finally{delete process.env.DT_RG;E.cancel(operation.id);}
});


test('a single-file match budget is honored in both cold and indexed search',async()=>{
 put('repos/SHOP/many/App.java',Array.from({length:50},()=> 'sendOrder();').join('\n'));
 let r=await T.call('code_search',{repo:'SHOP/many',pattern:'sendOrder',limit:25});assert.equal(r.total,25);assert.equal(r.truncated,true);
 CI.build(path.join(home,'repos/SHOP/many'),'SHOP/many',{project:'SHOP',repo:'many'});
 r=await T.call('code_search',{repo:'SHOP/many',pattern:'sendOrder',limit:25});assert.equal(r.total,25);assert.equal(r.truncated,true);
});

test('cold multiline JavaScript regex searches preserve indexed match semantics',async()=>{
 const r=await T.call('code_search',{repo:'SHOP/orders',pattern:'class App [\\s\\S]*sendOrder',regex:true});assert.equal(r.total,1);assert.match(r.rows[0].text,/spans lines/);assert.match(r.rows[0].file,/App.java:0$/);
});
