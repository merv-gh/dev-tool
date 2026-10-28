const fs = require('fs');
const path = require('path');
const os = require('os');
const {execFileSync} = require('child_process');
const ROOT = __dirname;
const reports = require('./cases.json');
const report = id => reports.find(c=>c.id===id)?.report;
async function javaReport(root, input) {
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'dt-case-java-'));
  const javac=process.env.DT_JAVAC || 'javac', java=process.env.DT_JAVA || 'java';
  const sources=dir => fs.readdirSync(dir,{recursive:true}).filter(x=>x.endsWith('.java')).map(x=>path.join(dir,x));
  try {
    const lib=path.join(root,'LIB/common-primitives/decimal/src/main/java');
    const service=path.join(root,'FIN/ledger-service/src/main/java');
    fs.mkdirSync(path.join(out,'lib')); fs.mkdirSync(path.join(out,'service'));
    execFileSync(javac,['-d',path.join(out,'lib'),...sources(lib)],{stdio:'pipe'});
    execFileSync(javac,['-cp',path.join(out,'lib'),'-d',path.join(out,'service'),...sources(service)],{stdio:'pipe'});
    return execFileSync(java,['-cp',path.join(out,'service')+path.delimiter+path.join(out,'lib'),'com.lumen.ledger.PostingService',input.amount,input.currency],{encoding:'utf8'}).trim();
  } finally { fs.rmSync(out,{recursive:true,force:true}); }
}
async function run(id, root=ROOT, input=report(id)) {
  const dir=path.join(root,id);
  switch(id) {
    case 'C01': return require(path.join(dir,'src/checkout.cjs')).grossCents(input.lines,input.vatBps);
    case 'C02': {
      const http=require('http'); const reserve=require(path.join(dir,'reservations/src/api.cjs')).reserve;
      const server=http.createServer(async(req,res)=>{try {let raw='';for await(const c of req)raw+=c; const result=reserve(JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});
      await new Promise(r=>server.listen(0,'127.0.0.1',r));
      try {return await require(path.join(dir,'checkout/src/checkout.cjs')).place(input,async body=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/reservations`,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});if(!res.ok)throw new Error('reservation rejected');return res.json();});}
      finally {await new Promise(r=>server.close(r));}
    }
    case 'C03': return javaReport(dir,input);
    case 'C04': return {reserved:require(path.join(dir,'src/reservations.cjs')).isReserved(input.createdAt,input.now,require(path.join(dir,'config',input.profile+'.json')))};
    case 'C05': {const state={seen:[]};return {results:input.events.map(e=>require(path.join(dir,'src/reconcile.cjs')).reconcile(state,e)),state};}
    case 'C06': return require('./pg-harness.cjs').withDatabases(root,async db=>{
      let result;try {result=await require(path.join(dir,'src/release.cjs')).release(db,input.tenantId,input.orderId);}catch(e){result={error:e.message};}
      return {result,orders:await db.orders.unsafe('select * from sales.orders order by tenant_id,id'),payments:await db.billing.unsafe('select * from pay.payments order by tenant_id,order_id')};
    });
    case 'C07': return require(path.join(dir,'src/cancellation.cjs')).quoteCancellation(input.booking,input.minutesToDeparture);
    case 'C08': return require(path.join(dir,'src/inventory.cjs')).apply(input.state,input.event);
    default: throw new Error('unknown case '+id);
  }
}
if(require.main===module) run(process.argv[2],process.argv[3]&&path.resolve(process.argv[3])).then(v=>console.log(JSON.stringify({case:process.argv[2],observed:v},null,2))).catch(e=>{console.error(JSON.stringify({case:process.argv[2],error:e.message,details:e.stderr?.toString().slice(0,1500)}));process.exitCode=1;});
module.exports={run,javaReport};
