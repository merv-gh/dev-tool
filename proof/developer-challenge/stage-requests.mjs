// Creates replayable request documents only. Application writes use workspace_write.
import {writeFileSync} from 'node:fs';
const dir=new URL('./',import.meta.url);
const write=(id,workspace,path,content,kind)=>writeFileSync(new URL(`${id}-${kind}.json`,dir),JSON.stringify({workspace,path,content},null,2)+'\n');
const prefix="const {test}=require('node:test');\nconst assert=require('node:assert/strict');\n";
write('c02','c02-main-728a','test/regression.test.cjs',prefix+`const {place}=require('../checkout/src/checkout.cjs');
const {reserve}=require('../reservations/src/api.cjs');
test('real reservation API receives exact cents and identity',async()=>{
 for(const [total,expected] of [['12.50',1250],['0.01',1],['19.99',1999],['12',1200],['0',0],['90071992547409.91',Number.MAX_SAFE_INTEGER]]){
  const body={id:'ord-42',total,currency:'EUR'};const before=structuredClone(body);const calls=[];
  const result=await place(body,p=>{calls.push(p);return reserve(p)});
  assert.deepEqual(calls,[{orderId:'ord-42',amountCents:expected,currency:'EUR'}]);assert.equal(result.status,'RESERVED');assert.deepEqual(body,before);
 }
});
test('malformed totals and identities never call downstream',async()=>{
 for(const total of ['', ' 1.00','1.001','1e2','-1','Infinity','1.','90071992547409.92',null,12.5]){
  let calls=0;await assert.rejects(place({id:'ord',total,currency:'EUR'},()=>{calls++;}));assert.equal(calls,0);
 }
 for(const bad of [{id:'',total:'1',currency:'EUR'},{id:'x',total:'1',currency:'eur'}]){
  let calls=0;await assert.rejects(place(bad,()=>{calls++;}));assert.equal(calls,0);
 }
});
`,'test');
write('c02','c02-main-728a','checkout/src/checkout.cjs',`exports.place = async function(order, reservations) {
  if (!order || typeof order.id !== 'string' || !order.id || typeof order.currency !== 'string' || !/^[A-Z]{3}$/.test(order.currency)) throw new Error('invalid order');
  if (typeof order.total !== 'string' || !/^[0-9]+(?:\\.[0-9]{1,2})?$/.test(order.total)) throw new Error('invalid total');
  const [whole, fraction = ''] = order.total.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid total');
  return reservations({ orderId: order.id, amountCents: Number(cents), currency: order.currency });
};
`,'fix');
write('c04','c04-main-43a5','test/regression.test.cjs',prefix+`const {ttlMillis,isReserved}=require('../src/reservations.cjs');
test('production and staging preserve reservation duration',()=>{
 for(const config of [require('../config/production.json'),require('../config/staging.json')]){
  assert.equal(ttlMillis(config.reservationTtl),90000);assert.equal(isReserved(1000,1100,config),true);
  assert.equal(isReserved(1000,90999,config),true);assert.equal(isReserved(1000,91000,config),false);
 }
 assert.equal(ttlMillis('2m'),120000);assert.equal(ttlMillis('125ms'),125);assert.equal(ttlMillis(1),1);
});
test('invalid or overflowing TTL fails before use',()=>{
 for(const value of [undefined,null,'','90','90s junk','1.5s','0s','-1s','1h',0,-1,1.5,Infinity,NaN,'9007199254740991m'])assert.throws(()=>ttlMillis(value));
});
`,'test');
write('c04','c04-main-43a5','src/reservations.cjs',`exports.ttlMillis = function(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid reservation TTL');
    return value;
  }
  const match = typeof value === 'string' && /^([0-9]+)(ms|s|m)$/.exec(value);
  if (!match) throw new Error('invalid reservation TTL');
  const ttl = BigInt(match[1]) * ({ms:1n,s:1000n,m:60000n}[match[2]]);
  if (ttl <= 0n || ttl > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid reservation TTL');
  return Number(ttl);
};
exports.isReserved = (createdAt, now, config) => now - createdAt < exports.ttlMillis(config.reservationTtl);
`,'fix');
write('c05','c05-main-8261','test/regression.test.cjs',prefix+`const {reconcile}=require('../src/reconcile.cjs');
test('large adjacent IDs and tenants remain independent',()=>{
 const state={seen:[]};const event={tenantId:'11',orderId:'9007199254740992'};const before=structuredClone(event);
 assert.equal(reconcile(state,event).applied,true);assert.deepEqual(event,before);
 assert.equal(reconcile(state,{tenantId:'11',orderId:'9007199254740993'}).applied,true);
 assert.equal(reconcile(state,{tenantId:'12',orderId:'9007199254740992'}).applied,true);
 assert.equal(reconcile(state,event).applied,false);assert.equal(state.seen.length,3);
 const compatible={seen:[]};assert.equal(reconcile(compatible,{tenantId:11,orderId:42}).applied,true);assert.equal(reconcile(compatible,{tenantId:'11',orderId:'42'}).applied,false);
});
test('invalid identities cannot poison deduplication state',()=>{
 for(const value of [9007199254740992,-1,1.5,NaN,Infinity,null,undefined,{},true,'','-1','1.2','1e2',' 42']){
  for(const field of ['tenantId','orderId']){const state={seen:['existing']};const before=structuredClone(state);assert.throws(()=>reconcile(state,{tenantId:'11',orderId:'42',[field]:value}));assert.deepEqual(state,before);}
 }
});
`,'test');
write('c05','c05-main-8261','src/reconcile.cjs',`function identity(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid identity');
    return String(value);
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error('invalid identity');
  return BigInt(value).toString();
}
exports.reconcile = function(state, event) {
  if (!event) throw new Error('invalid identity');
  const key = identity(event.tenantId) + ':' + identity(event.orderId);
  if (!state || !Array.isArray(state.seen)) throw new Error('invalid state');
  if (state.seen.includes(key)) return { applied: false, key };
  state.seen.push(key);
  return { applied: true, key };
};
`,'fix');
write('c07','c07-main-49cc','test/regression.test.cjs',prefix+`const {quoteCancellation}=require('../src/cancellation.cjs');
test('cancellation thresholds and odd cents follow the contract',()=>{
 for(const [minutes,refund] of [[2880,1001],[2880.1,1001],[2879.9,500],[1440,500],[1439.9,0],[0,0]]){
  const booking=Object.freeze({status:'CONFIRMED',refundable:true,paidCents:1001});assert.deepEqual(quoteCancellation(booking,minutes),{refundCents:refund,retainedCents:1001-refund});
 }
 for(const minutes of [0,1440,2880,100000])assert.deepEqual(quoteCancellation({status:'CONFIRMED',refundable:false,paidCents:1001},minutes),{refundCents:0,retainedCents:1001});
 assert.deepEqual(quoteCancellation({status:'CONFIRMED',refundable:true,paidCents:0},2880),{refundCents:0,retainedCents:0});
});
test('invalid inputs fail without changing booking',()=>{
 const good={status:'CONFIRMED',refundable:true,paidCents:1001};
 for(const bad of [null,{...good,status:'CANCELLED'},{...good,refundable:'yes'},...[NaN,Infinity,-1,1.1,Number.MAX_SAFE_INTEGER+1].map(paidCents=>({...good,paidCents}))]){const before=structuredClone(bad);assert.throws(()=>quoteCancellation(bad,2880));assert.deepEqual(bad,before);}
 for(const minutes of [-1,NaN,Infinity,'1440',undefined]){const before=structuredClone(good);assert.throws(()=>quoteCancellation(good,minutes));assert.deepEqual(good,before);}
});
`,'test');
write('c07','c07-main-49cc','src/cancellation.cjs',`exports.quoteCancellation = function(booking, minutesToDeparture) {
  if (!booking || booking.status !== 'CONFIRMED' || typeof booking.refundable !== 'boolean' || !Number.isSafeInteger(booking.paidCents) || booking.paidCents < 0 || typeof minutesToDeparture !== 'number' || !Number.isFinite(minutesToDeparture) || minutesToDeparture < 0) throw new Error('invalid cancellation quotation');
  const refundCents = !booking.refundable ? 0 : minutesToDeparture >= 2880 ? booking.paidCents : minutesToDeparture >= 1440 ? Math.floor(booking.paidCents / 2) : 0;
  return { refundCents, retainedCents: booking.paidCents - refundCents };
};
`,'fix');
write('c08','c08-main-476f','test/regression.test.cjs',prefix+`const {apply}=require('../src/inventory.cjs');
test('new events, duplicate identities, and all inputs are immutable',()=>{
 const state=Object.freeze({stock:3,seen:Object.freeze([])});const event=Object.freeze({id:'e',sku:'a',delta:-1});
 const next=apply(state,event);assert.deepEqual(next,{stock:2,seen:[JSON.stringify(['a','e'])]});assert.notStrictEqual(next,state);assert.notStrictEqual(next.seen,state.seen);assert.deepEqual(state,{stock:3,seen:[]});
 const duplicate=apply(next,{id:'e',sku:'a',delta:100});assert.deepEqual(duplicate,next);assert.notStrictEqual(duplicate,next);assert.notStrictEqual(duplicate.seen,next.seen);
 const otherSku=apply(next,{id:'e',sku:'b',delta:4});assert.equal(otherSku.stock,6);assert.equal(otherSku.seen.length,2);
 assert.equal(apply({stock:0,seen:[]},{id:'z',sku:'a',delta:0}).seen.length,1);
});
test('safe arithmetic and failed event retry remain atomic',()=>{
 const cases=[[{stock:0,seen:[]},{id:'e',sku:'a',delta:-1}],[{stock:Number.MAX_SAFE_INTEGER,seen:[]},{id:'e',sku:'a',delta:1}]];
 for(const [state,event] of cases){const before=structuredClone(state),ev=structuredClone(event);assert.throws(()=>apply(state,event));assert.deepEqual(state,before);assert.deepEqual(event,ev);assert.equal(apply(state,{...event,delta:0}).seen.length,1);}
 assert.equal(apply({stock:1,seen:[]},{id:'e',sku:'a',delta:-1}).stock,0);
 assert.equal(apply({stock:Number.MAX_SAFE_INTEGER-1,seen:[]},{id:'e',sku:'a',delta:1}).stock,Number.MAX_SAFE_INTEGER);
 for(const bad of [{id:'',sku:'a',delta:1},{id:'e',sku:'',delta:1},{id:'e',sku:'a',delta:1.1},{id:'e',sku:'a',delta:NaN},{id:'e',sku:'a',delta:Number.MAX_SAFE_INTEGER+1},null]){const state={stock:3,seen:[]};assert.throws(()=>apply(state,bad));assert.deepEqual(state,{stock:3,seen:[]});}
 for(const state of [null,{stock:-1,seen:[]},{stock:1.5,seen:[]},{stock:Infinity,seen:[]},{stock:3,seen:null}]){const before=structuredClone(state);assert.throws(()=>apply(state,{id:'e',sku:'a',delta:1}));assert.deepEqual(state,before);}
});
`,'test');
