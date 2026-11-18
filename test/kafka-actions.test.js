const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-kafka-actions-'));
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_SECURITY_PROFILE','DT_API_KEY'])delete process.env[k];
Object.assign(process.env,{DT_HOME:home,DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});
let messages,low,extra,failProduce,brokenStream,gets=0,posts=0,requests=[],server,base;
const start=9007199254740993n;
const reset=()=>{messages=[[],[{offset:String(start),value:{id:'old'}}]];low=[0n,start];extra=false;failProduce=false;brokenStream=false;requests=[];};reset();
const add=(partition,value,key='key')=>{const list=messages[partition],offset=String((list.length?BigInt(list.at(-1).offset)+1n:low[partition]));list.push({offset,value,key});};
test.before(async()=>{
 server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const u=new URL(req.url,'http://local');requests.push({method:req.method,path:u.pathname,q:Object.fromEntries(u.searchParams)});res.setHeader('content-type','application/json');
  if(u.pathname==='/api/clusters')return res.end(JSON.stringify([{name:'offline',status:'offline'},{name:'main',status:'online'}]));
  if(!u.pathname.endsWith('/messages')){gets++;const ps=messages.map((list,i)=>`{"partition":${i},"offsetMin":${low[i]},"offsetMax":${list.length?BigInt(list.at(-1).offset)+1n:low[i]}}`);if(extra)ps.push('{"partition":2,"offsetMin":0,"offsetMax":0}');return res.end('{"partitions":['+ps.join(',')+']}');}
  if(req.method==='POST'){posts++;const b=JSON.parse(text);assert.equal(b.keySerde,'String');assert.equal(typeof b.content==='string'||b.content===null,true);add(b.partition,b.content==null?null:JSON.parse(b.content),b.key);if(failProduce){res.statusCode=503;return res.end('{}');}return res.end('');}
  const p=Number(u.searchParams.get('partition')),from=BigInt(u.searchParams.get('offset'));const found=messages[p].filter(m=>BigInt(m.offset)>=from).slice(0,Number(u.searchParams.get('limit')));
  res.setHeader('content-type','text/event-stream');res.end(found.map(m=>'data: {"type":"MESSAGE","message":{"partition":'+p+',"offset":'+m.offset+',"key":'+JSON.stringify(m.key)+',"headers":{"source":"test"},"content":'+JSON.stringify(JSON.stringify(m.value))+'}}').join('\n')+(brokenStream?'':'\ndata: {"type":"DONE"}\n'));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{kafkaUi:base},uat:{kafkaUi:base},none:{}},scripts:{starters:false}}));
});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
const K=()=>require('../lib/kafka-actions'), T=()=>require('../lib/tools');
test('checkpoints preserve int64 offsets; waits exclude old records and include quiet partitions',async()=>{
 reset();const cp=await T().call('kafka_checkpoint',{env:'dev',topic:'orders'});assert.equal(cp.cluster,'main');assert.equal(cp.offsets[1],String(start+1n));
 add(0,{id:'new',n:42});const result=await T().call('kafka_wait',{env:'dev',topic:'orders',checkpoint:cp,match:{'value.id':'new','value.n':42,'headers.source':'test'},timeout_ms:2000});assert.equal(result.message.partition,0);assert.equal(result.message.value.n,42);assert.equal(result.scanned,1);assert.ok(requests.some(r=>r.q.seekTo==='0::0'));
 add(1,{id:'long'});const long=await K().wait({env:'dev',topic:'orders',checkpoint:cp,match:{'value.id':'long'},timeout_ms:2000});assert.equal(long.message.offset,String(start+1n));
 assert.equal(K().matches({value:{n:42}},{'value.n':'42'}),false);assert.equal(K().matches({value:{n:42}},{'value.missing':null}),false);
});
test('wait starts at current end without checkpoint and sees a later event after polling',async()=>{
 reset();const timer=setTimeout(()=>add(1,{id:'later'}),130);try{const r=await K().wait({env:'dev',topic:'orders',match:{'value.id':'later'},timeout_ms:2000,poll_ms:100});assert.ok(r.polls>1);assert.equal(r.message.value.id,'later');}finally{clearTimeout(timer);}
 await assert.rejects(K().wait({env:'dev',topic:'orders',match:{'value.id':'old'},timeout_ms:150,poll_ms:100}),/timed out/);
});
test('expired, mismatched, recreated and changed-partition checkpoints cannot silently pass',async()=>{
 reset();const cp=await K().checkpoint({env:'dev',topic:'orders'});
 await assert.rejects(K().wait({env:'uat',topic:'orders',checkpoint:cp}),/same environment/);
 await assert.rejects(K().wait({env:'dev',topic:'other',checkpoint:cp}),/same environment/);
 const expired=structuredClone(cp);expired.offsets[1]='0';await assert.rejects(K().wait({env:'dev',topic:'orders',checkpoint:expired}),/expired/);
 const ahead=structuredClone(cp);ahead.offsets[0]='10';await assert.rejects(K().wait({env:'dev',topic:'orders',checkpoint:ahead}),/recreated/);
 extra=true;await assert.rejects(K().wait({env:'dev',topic:'orders',checkpoint:cp}),/partitions changed/);extra=false;
 const missing=structuredClone(cp);delete missing.offsets[0];missing.offsets[9]='0';await assert.rejects(K().wait({env:'dev',topic:'orders',checkpoint:missing}),/partitions changed/);
 add(0,{id:'new'});brokenStream=true;await assert.rejects(K().wait({env:'dev',topic:'orders',checkpoint:cp}),/incomplete/);brokenStream=false;
 await assert.rejects(K().wait({env:'dev',topic:'orders',checkpoint:cp,match:{'value.id':'absent'},max_messages:1}),/scan limit/);
});
test('produce sends exactly once, validates targets, supports tombstones and reports uncertain acknowledgement',async()=>{
 reset();const before=posts;const r=await T().call('kafka_produce',{env:'dev',topic:'orders',partition:0,key:{id:42},value:{id:'sent'},headers:{source:'test'}});assert.equal(r.acknowledged,true);assert.equal(posts,before+1);assert.deepEqual(messages[0][0].value,{id:'sent'});
 await K().produce({env:'dev',cluster:'main',topic:'orders',partition:0,value:null});assert.equal(messages[0].at(-1).value,null);
 const n=posts;failProduce=true;await assert.rejects(K().produce({env:'dev',topic:'orders',partition:0,value:{id:'uncertain'}}),/delivery may be unknown/);assert.equal(posts,n+1);failProduce=false;
 for(const a of [{partition:-1,value:{}},{partition:99,value:{}},{partition:0},{partition:0,value:{},headers:{x:1}}])await assert.rejects(K().produce({env:'dev',topic:'orders',...a}));
 await assert.rejects(K().checkpoint({env:'none',topic:'orders'}),/not configured/);await assert.rejects(K().checkpoint({env:'dev',topic:'orders',cluster:'missing'}),/not found/);await assert.rejects(K().checkpoint({env:'dev'}),/topic required/);
 for(const a of [{timeout_ms:0},{poll_ms:1},{batch_size:0},{max_messages:10001},{match:[]}])await assert.rejects(K().wait({env:'dev',topic:'orders',...a}));
});
test('cancelling a collection interrupts a Kafka wait and executes cleanup without later produce',async()=>{
 reset();const S=require('../lib/scripts'),C=require('../lib/collections');S.save('cancel/wait',{description:'Cancel bounded Kafka wait',steps:[{tool:'kafka_wait',args:{env:'dev',topic:'orders',match:{'value.id':'never'},timeout_ms:30000,poll_ms:100}},{tool:'kafka_produce',args:{env:'dev',topic:'orders',partition:0,value:{id:'should-not-send'}}}],finally:'log("released");'});
 const n=posts;let run;const promise=C.run('cancel',{onStart:id=>{run=id;setTimeout(()=>C.cancel(id),150);}});const r=await promise;assert.equal(r.status,'cancelled');assert.equal(posts,n);assert.ok(r.cases[0].result.logs.some(l=>l.msg==='released'));assert.equal(C.get(run).progress.status,'failed');const after=gets;await new Promise(r=>setTimeout(r,180));assert.equal(gets,after,'no orphan poller after cancellation');
});
test('wait deadline also bounds queued rate admission, leaving no delayed request',async()=>{
 const file=path.join(home,'config.json'),original=fs.readFileSync(file,'utf8'),cfg=JSON.parse(original);cfg.server={networkBudgets:{'kafka:uat':{ratePerSec:1}}};fs.writeFileSync(file,JSON.stringify(cfg));require('../lib/config').reload();
 try{const started=Date.now();await assert.rejects(K().wait({env:'uat',topic:'orders',timeout_ms:100}),/timeout|abort|deadline/i);assert.ok(Date.now()-started<700);const n=gets;await new Promise(r=>setTimeout(r,180));assert.equal(gets,n);}finally{fs.writeFileSync(file,original);require('../lib/config').reload();}
});
