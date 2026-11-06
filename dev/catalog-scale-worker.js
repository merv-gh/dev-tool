// Builds the real PG usage/catalog path from synthetic paged source metadata.
const {parentPort,workerData:d}=require('node:worker_threads'),path=require('node:path');
Object.assign(process.env,{DT_HOME:d.home,DT_LOG:'quiet',DT_STATE_BACKEND:'legacy',DT_NO_DOCTOR:'1'});
try{
 const store=require('../lib/pgstore'),w=store.writer(path.join(d.home,'cache',d.env,'pg','orders.json'));
 w.ensure('tables');w.ensure('functions');w.ensure('triggers');w.ensure('viewDeps');
 for(let i=0;i<d.count;i++){
  const name='t'+String(i).padStart(8,'0'),ref='public.t'+String((i+1)%d.count).padStart(8,'0');
  w.add('tables',{schema:'public',name,kind:'table',est_rows:d.changed&&i%100===0?2:1,columns:[{name:'id',type:'bigint'},{name:i%1000===0?'имя':'value',type:'text'}],constraints:[{name:name+'_a',type:'f',ref,def:'FOREIGN KEY (id) REFERENCES '+ref+'(id)'},{name:name+'_b',type:'f',ref:'public.t'+String((i+2)%d.count).padStart(8,'0'),def:'FOREIGN KEY (id) REFERENCES '+ref+'(id)'}]});
 }
 w.commit({db:'orders',syncedAt:new Date().toISOString()});
 const C=require('../lib/catalog'),start=performance.now(),count=C.build(d.env),generation=require('../lib/catalog-store').status(d.env);
 const unchangedStart=performance.now();C.build(d.env);const unchangedMs=performance.now()-unchangedStart;
 parentPort.postMessage({ok:true,count,generation,buildMs:performance.now()-start,unchangedMs,heapBytes:process.memoryUsage().heapUsed});
}catch(e){parentPort.postMessage({ok:false,error:e.message,stack:e.stack});}
