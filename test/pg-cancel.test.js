const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-pg-cancel-'));process.env.DT_HOME=home;
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{postgres:{orders:'postgres://fake/orders'}}}}));
let admitted,cancelled=0,poolClosed=0,cursorBatches=0,cursorClosed=0;
const begun=new Promise(r=>admitted=r);
const sql={begin:async(_,fn)=>fn({unsafe:(text)=>{
 if(text.startsWith('set local'))return Promise.resolve([]);
 if(text.includes('bounded'))return {cursor:async function*(size){try{for(let i=0;i<20;i+=size){cursorBatches++;yield Array.from({length:Math.min(size,20-i)},(_,n)=>({id:i+n,value:text.includes('large')?'x'.repeat(600000):'row'}));}}finally{cursorClosed++;}}};
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

test('bounded reads stop a cursor early, preserve exact-limit completeness, and close it on a byte cap',async()=>{
 cursorBatches=0;const a=await PG.query('dev','select bounded',{maxRows:3});assert.deepEqual(a.rows.map(r=>r.id),[0,1,2]);assert.equal(a.truncated,true);assert.equal(cursorBatches,1);assert.equal(cursorClosed,1);
 const b=await PG.query('dev','select bounded',{maxRows:20});assert.equal(b.rows.length,20);assert.equal(b.truncated,false);
 const c=await PG.query('dev','select bounded_large',{maxRows:10});assert.equal(c.rows.length,1);assert.equal(c.truncated,true);assert.equal(cursorClosed,3);
 await assert.rejects(PG.query('dev','select bounded',{maxRows:0}),/maxRows/);
});
