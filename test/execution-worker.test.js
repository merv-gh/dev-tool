const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-worker-cancel-'));process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';process.env.DT_STATE_BACKEND='legacy';
for(const name of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS'])delete process.env[name];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{db0:'postgres://test:test@127.0.0.1:1/db0'}}},tools:{workerHeapMb:256}}));
const folder=path.join(home,'cache','dev','pg');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'db0.json'),JSON.stringify({db:'db0',database:'db0',syncedAt:new Date().toISOString(),tables:Array.from({length:4000},(_,i)=>({schema:'s',name:'table'+i,kind:'table',columns:Array.from({length:30},(_,j)=>({name:'column'+j,type:'text'}))})),functions:[],viewDeps:[],triggers:[],types:[],sequences:[],extensions:[]}));
const E=require('../lib/execution'),A=require('../lib/access'),S=require('../lib/state-store');
test.after(async()=>{await require('../lib/isolate').stop();await S.close();fs.rmSync(home,{recursive:true,force:true});});
test('Admin can cancel an actual worker child through its owning execution and other stories cannot',async()=>{
 await A.run({principalId:'alice',storyId:'one',multiUser:true},async()=>{
  const operation=E.start({tool:'worker-probe'},()=>require('../lib/tools').call('pg_usage',{name:'s.table1',env:'dev'}));
  let child;
  for(let i=0;i<500;i++){child=S.snapshot('executions').find(r=>r.kind==='worker'&&!E.TERMINAL.has(r.state));if(child)break;await new Promise(r=>setTimeout(r,10));}
  assert.ok(child,'worker registered a scoped live execution');
  assert.equal(E.get(child.id).canCancel,true);assert.ok(E.list({limit:500}).some(r=>r.id===child.id));
  await A.run({principalId:'bob',storyId:'one',multiUser:true},()=>assert.throws(()=>E.cancel(child.id),e=>e.code==='DT_NOT_FOUND'));
  assert.equal(E.cancel(child.id).state,'cancelling');await assert.rejects(operation.promise,e=>e.code==='DT_CANCELLED');
  assert.equal(S.snapshot('executions').find(r=>r.id===child.id).state,'cancelled');assert.equal(E.get(child.id).canCancel,false);
  assert.equal(require('../lib/isolate').status().busy,0);
 });
});
