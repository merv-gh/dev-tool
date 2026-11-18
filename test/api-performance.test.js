const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-api-scaling-'));for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_PASSPORTS_DIR','DT_API_KEY','DT_SECURITY_PROFILE'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy'});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false}}));const C=require('../lib/config'),B=require('../lib/api-catalog'),A=require('../lib/access'),O=require('../lib/passport/overrides');
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const passport=(service,extra={})=>({service,env:'dev',repo:{project:'SHOP',repo:service,sha:'a'.repeat(40)},effective:{endpoints:[{method:'GET',path:'/'+service+'/health',file:'Handler.java',line:2,handler:'Handler.get'}]},unrelatedGraph:'x'.repeat(10000),...extra});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('200-service serving reads passports once, pages only the requested service and never rereads graphs warm',()=>{
 for(let i=0;i<200;i++)write(path.join(C.PATHS.passports,'service-'+i,'passport.json'),passport('service-'+i));
 const original=fs.readFileSync;let reads=0;fs.readFileSync=function(file,...args){if(String(file).endsWith('/passport.json'))reads++;return original.call(this,file,...args);};
 try{const root=B.catalog({env:'dev'});assert.equal(root.services.length,200);assert.equal(reads,200);reads=0;assert.equal(B.catalog({env:'dev'}).services.length,200);assert.equal(reads,0);const page=B.catalog({env:'dev',group:'service:service-42'});assert.equal(page.services.length,1);assert.equal(page.routes[0].path,'/service-42/health');assert.equal(reads,0);
  const pickers=B.catalog({env:'dev',resources_only:true});assert.equal(pickers.services,undefined);assert.equal(reads,0);
  write(path.join(C.PATHS.passports,'service-42','passport.json'),passport('service-42',{effective:{endpoints:[{method:'GET',path:'/new-path'}]}}));assert.equal(B.catalog({env:'dev',group:'service:service-42'}).routes[0].path,'/new-path');assert.equal(reads,1);
  reads=0;delete require.cache[require.resolve('../lib/route-index')];assert.equal(require('../lib/route-index').passports({manual:false}).length,200);assert.equal(reads,0,'Persisted compact projections survive process cache replacement');
 }finally{fs.readFileSync=original;}
});
test('large passports stream past unrelated graphs and preserve escaped strings, null repo and endpoint evidence',()=>{
 const R=require('../lib/route-index'),file=path.join(C.PATHS.passports,'large','passport.json'),source=passport('large',{unrelatedGraph:{nested:['prefix\\"end','x'.repeat(600000)],number:42,boolean:false,none:null},repo:null});write(file,source);assert.deepEqual(R.readProjection(file),{service:'large',env:'dev',repo:undefined,effective:source.effective});
 assert.equal(R.save(source,file).effective.endpoints[0].handler,'Handler.get');const saved=JSON.parse(fs.readFileSync(path.join(C.PATHS.cache,'api-passports/large.json')));assert.equal(saved.value.unrelatedGraph,undefined);assert.ok(fs.statSync(path.join(C.PATHS.cache,'api-passports/large.json')).size<1000);
 fs.writeFileSync(file,'{"service":"large","junk":"'+'x'.repeat(600000));assert.throws(()=>R.readProjection(file),/truncated/);
 assert.throws(()=>R.project({service:'bad'}),/attribution/);fs.rmSync(path.dirname(file),{recursive:true});
});
test('manual endpoint projections are isolated by story and invalidate immediately on a correction',()=>{
 const p=passport('manual');write(path.join(C.PATHS.passports,'manual','passport.json'),p);
 const scope=storyId=>({principalId:'reader',storyId,multiUser:true,role:'user'});
 A.run(scope('one'),()=>{
  assert.equal(B.catalog({env:'dev',group:'service:manual'}).routes.length,1);
  O.adjust({service:'manual',expected_revision:null,reason:'Verified route from fixture',operations:[{action:'add',port:{type:'http-ingress',handler:{file:'Manual.java',line:3,signature:'Manual.get'},boundary:{host:'manual.internal',method:'GET',path:'/manual-only'}}}]});
  assert.ok(B.catalog({env:'dev',group:'service:manual'}).routes.some(r=>r.path==='/manual-only'));assert.ok(B.catalog({env:'dev',group:'service:manual'}).routes.some(r=>r.path==='/manual-only'));
 });
 A.run(scope('two'),()=>assert.ok(!B.catalog({env:'dev',group:'service:manual'}).routes.some(r=>r.path==='/manual-only')));
});
