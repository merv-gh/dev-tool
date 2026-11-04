const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-pg-cancel-'));process.env.DT_HOME=home;
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{orders:'postgres://fake/orders'}}}}));
let admitted,cancelled=0,poolClosed=0;
const begun=new Promise(r=>admitted=r);
const sql={begin:async(_,fn)=>fn({unsafe:(text)=>{
 if(text.startsWith('set local'))return Promise.resolve([]);
 if(text.includes('slow')){let reject;const p=new Promise((_,r)=>reject=r);p.cancel=()=>{cancelled++;reject(Object.assign(Error('cancelled query'),{code:'57014'}));};admitted();return p;}
 return Promise.resolve([{answer:42}]);
}}),end:async()=>{poolClosed++;}};
require.cache[require.resolve('postgres')]={id:require.resolve('postgres'),filename:require.resolve('postgres'),loaded:true,exports:()=>sql};
const PG=require('../lib/pg'),E=require('../lib/execution');
test.after(async()=>{await PG.closeAll();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('Postgres cancellation targets the owned query and keeps the shared pool available',async()=>{
 const e=E.start({kind:'query'},()=>PG.query('dev','select slow'));
 await begun;
 const other=await PG.query('dev','select 42');assert.deepEqual(other.rows,[{answer:42}]);
 E.cancel(e.id,'test request cancelled');await assert.rejects(e.promise,e=>e.code==='DT_CANCELLED');
 assert.equal(cancelled,1);assert.equal(poolClosed,0);
 assert.deepEqual((await PG.query('dev','select 42')).rows,[{answer:42}]);assert.equal(E.get(e.id).resources,0);
});
