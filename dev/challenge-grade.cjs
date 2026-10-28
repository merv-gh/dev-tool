// Private executable acceptance grader; never copy into the public pack before solver completion.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('child_process');
const PUBLIC=process.env.DT_CHALLENGE_PUBLIC_PACK||path.resolve(__dirname,'../challenges/developer-v1');
const TOOL=process.env.DT_CHALLENGE_TOOL_ROOT||path.resolve(PUBLIC,'../..');
const revision=require(path.join(PUBLIC,'revision.json'));
const candidate=path.resolve(process.argv[2]||'');
const SUPPORT=path.resolve(PUBLIC,'../developer-support-v1.1');
const overlayRoot=fs.mkdtempSync(path.join(os.tmpdir(),'dt-build-overlay-'));fs.cpSync(path.join(PUBLIC,'C03'),path.join(overlayRoot,'C03'),{recursive:true});require(path.join(SUPPORT,'c03-build.cjs')).overlay(overlayRoot);const buildHashes={};for(const f of ['C03/LIB/common-primitives/pom.xml','C03/FIN/ledger-service/pom.xml'])buildHashes[f]=sha(fs.readFileSync(path.join(overlayRoot,f)));fs.rmSync(overlayRoot,{recursive:true,force:true});
const id=process.argv[3];
function sha(x){return crypto.createHash('sha256').update(x).digest('hex');}
function files(root){return fs.existsSync(root)?fs.readdirSync(root,{recursive:true}).filter(f=>!f.split(path.sep).includes('.git')&&fs.statSync(path.join(root,f)).isFile()):[];}
function allowed(f){return /^C0[124567]\/src\//.test(f)||/^C02\/checkout\/src\//.test(f)||/^C03\/(LIB\/common-primitives\/decimal|FIN\/ledger-service)\/src\/(main|test)\//.test(f)||/^C0[1-8]\/test\//.test(f);}
function scope(caseId){const issues=[];for(const[f,hash]of Object.entries(revision.files)){if(!f.startsWith(caseId+'/')||allowed(f))continue;const full=path.join(candidate,f);if(!fs.existsSync(full)||(sha(fs.readFileSync(full))!==hash&&sha(fs.readFileSync(full))!==buildHashes[f]))issues.push('protected file changed: '+f);}
for(const f of files(path.join(candidate,caseId))){const rel=caseId+'/'+f;if(!(rel in revision.files)&&!allowed(rel)&&!f.startsWith('target/')&&!f.includes('/target/')&&!f.endsWith('.class'))issues.push('unexpected file: '+rel);if(allowed(rel)&&/\.(?:c?js|java)$/.test(f)){const text=fs.readFileSync(path.join(candidate,rel),'utf8');if(/dt-challenge-oracle|oracle\.json|grade\.cjs|revision\.files|publicPackSha256|NODE_TEST_CONTEXT|process\.env\.(?:DT_SCENARIO_OUTPUT|DT_CHALLENGE_GRADER)/.test(text))issues.push('grader-sensitive source: '+rel);}}
return issues;}
function load(rel){const f=path.join(candidate,rel);delete require.cache[require.resolve(f)];return require(f);}
function tests(caseId,base=candidate){if(caseId==='C03'&&files(path.join(base,'C03')).some(f=>f.includes('/src/test/java/')&&f.endsWith('.java')))return javaTests(base);const testRoot=path.join(base,caseId,'test');const list=files(testRoot).filter(f=>/\.test\.(?:c?js|mjs)$/.test(f)).map(f=>path.join(testRoot,f));if(!list.length)return{ok:false,error:'no executable regression tests'};const r=spawnSync(process.execPath,['--test','--test-reporter=tap',...list],{encoding:'utf8',timeout:90000,cwd:path.join(base,caseId),env:{...process.env,DT_CHALLENGE_TOOL_ROOT:TOOL,DT_CHALLENGE_PG_HARNESS:path.join(SUPPORT,'pg-case.cjs')}});const output=(r.stdout||'')+(r.stderr||'');const pass=Number(output.match(/# pass (\d+)/)?.[1]||0),fail=Number(output.match(/# fail (\d+)/)?.[1]||0);return{ok:r.status===0&&pass>0&&fail===0,status:r.status,pass,fail,output:output.slice(-1200)};}

function javaTests(base){
 const root=path.join(base,'C03/LIB/common-primitives');const reports=path.join(root,'decimal/target/surefire-reports');fs.rmSync(reports,{recursive:true,force:true});
 const mvn=process.env.DT_TEST_MAVEN||'mvn';
 const r=spawnSync(mvn,['-B','-q','-ntp','-o','test','-pl','decimal','-am', '-Dmaven.repo.local='+(process.env.DT_CHALLENGE_M2||path.join(os.homedir(),'.m2/repository'))],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,JAVA_HOME:process.env.DT_JAVA_HOME||process.env.JAVA_HOME}});
 let count=0,fail=0,skipped=0;for(const f of files(reports).filter(f=>f.endsWith('.xml'))){const x=fs.readFileSync(path.join(reports,f),'utf8').match(/<testsuite\s[^>]+>/)?.[0]||'';count+=Number(x.match(/tests="(\d+)"/)?.[1]||0);fail+=Number(x.match(/failures="(\d+)"/)?.[1]||0)+Number(x.match(/errors="(\d+)"/)?.[1]||0);skipped+=Number(x.match(/skipped="(\d+)"/)?.[1]||0);}
 return{ok:r.status===0&&count>skipped&&fail===0,status:r.status,tests:count,pass:count-fail-skipped,fail,skipped,runner:'independent actual Maven/JUnit',output:((r.stdout||'')+(r.stderr||'')).slice(-1200)};
}

const checks=[];
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
async function grade(caseId){
 const problems=scope(caseId);if(problems.length)return{case:caseId,passed:false,scope:problems};
 switch(caseId){
 case'C01':{const f=load('C01/src/checkout.cjs').grossCents;
 await check('invoice extension then rounding',()=>{assert.equal(f([{unitCents:99,quantity:3}],2000),356);assert.equal(f([{unitCents:1,quantity:1},{unitCents:1,quantity:1},{unitCents:1,quantity:1}],5000),5);assert.equal(f([{unitCents:1001,quantity:2},{unitCents:55,quantity:3}],725),2324);assert.equal(f([],2000),0);assert.equal(f([{unitCents:250,quantity:0}],2000),0);});
 await check('invalid arithmetic inputs rejected',()=>{for(const x of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>f([{unitCents:x,quantity:1}],2000));assert.throws(()=>f([{unitCents:1,quantity:1}],0.5));assert.throws(()=>f([{unitCents:1,quantity:-1}],0));});break;}
 case'C02':{const f=load('C02/checkout/src/checkout.cjs').place,reserve=load('C02/reservations/src/api.cjs').reserve;
 await check('exact major to minor conversion and contract',async()=>{for(const[value,cents]of [['12.50',1250],['0.01',1],['0',0],['19.9',1990],['90071992547409.90',9007199254740990]]){const seen=[];const v=await f({id:'ord-'+value,total:value,currency:'EUR'},async b=>{seen.push(b);return reserve(b);});assert.equal(v.amountCents,cents);assert.equal(seen.length,1);assert.equal(v.orderId,'ord-'+value);assert.equal(v.currency,'EUR');}});
 await check('invalid decimal cannot reach downstream',async()=>{for(const total of ['',' 2.00','2.00 ','2e2','0x10','-1.00','1.001','NaN','Infinity','90071992547409.92',12.5,null]){let calls=0;await assert.rejects(async()=>f({id:'ord-x',total,currency:'EUR'},()=>{calls++;return{};}));assert.equal(calls,0);}});break;}
 case'C03':{
 const {javaReport}=require(path.join(PUBLIC,'run.cjs'));
 await check('actual compiled library service uses currency scale',async()=>{for(const[amount,currency,want]of [['1.005','KWD','1005'],['1.005','USD','101'],['1.5','JPY','2'],['0.0005','KWD','1'],['9223372036854775.807','KWD','9223372036854775807']])assert.equal(await javaReport(path.join(candidate,'C03'),{amount,currency}),want);});
 await check('long overflow and negative values rejected',async()=>{for(const[amount,currency]of [['9223372036854775.808','KWD'],['-0.01','USD'],['1','XYZ']])await assert.rejects(()=>javaReport(path.join(candidate,'C03'),{amount,currency}));});break;}
 case'C04':{const f=load('C04/src/reservations.cjs');await check('configuration units honored',()=>{for(const[x,want]of [[90000,90000],['90000ms',90000],['90s',90000],['2m',120000],['1ms',1]])assert.equal(f.ttlMillis(x),want);for(const profile of ['staging','production']){const c=load('C04/config/'+profile+'.json');assert.equal(f.isReserved(1000,1100,c),true);assert.equal(f.isReserved(1000,91000,c),false);}});await check('invalid TTL rejected',()=>{for(const x of [undefined,null,0,-1,1.2,NaN,Infinity,'','90seconds','2.5s','-2s','0m','1s junk','1e3',' 90s'])assert.throws(()=>f.ttlMillis(x));});break;}
 case'C05':{const f=load('C05/src/reconcile.cjs').reconcile;await check('lossless composite identity and dedupe',()=>{const s={seen:[]};for(const e of [{tenantId:'11',orderId:'9007199254740992'},{tenantId:'11',orderId:'9007199254740993'},{tenantId:'22',orderId:'9007199254740993'}])assert.equal(f(s,e).applied,true);assert.equal(f(s,{tenantId:'11',orderId:'9007199254740993'}).applied,false);assert.equal(s.seen.length,3);const n={seen:[]};assert.equal(f(n,{tenantId:11,orderId:42}).applied,true);assert.equal(f(n,{tenantId:'11',orderId:'42'}).applied,false);});await check('identity rejection is atomic',()=>{for(const e of [{tenantId:'11',orderId:Number.MAX_SAFE_INTEGER+1},{tenantId:Number.MAX_SAFE_INTEGER+1,orderId:'42'},{tenantId:'11',orderId:'4.2'},{tenantId:'',orderId:'42'},{tenantId:'11',orderId:'-1'},{tenantId:'11',orderId:null}]){const s={seen:[]};assert.throws(()=>f(s,e));assert.deepEqual(s,{seen:[]});}});break;}
 case'C06':{
 if(!process.env.DT_TEST_PG_URL)return{case:caseId,passed:false,gap:'DT_TEST_PG_URL unavailable'};
 const {withDatabases}=require(path.join(PUBLIC,'pg-harness.cjs'));
 const f=load('C06/src/release.cjs').release;
 await withDatabases(candidate,async db=>{
 const snap=async()=>JSON.parse(JSON.stringify({orders:await db.orders.unsafe('select * from sales.orders order by tenant_id,id'),payments:await db.billing.unsafe('select * from pay.payments order by tenant_id,order_id')}));
 const reset=async()=>{await db.orders.unsafe("update sales.orders set status='PAID';update sales.accounts set enabled=true");await db.billing.unsafe("update risk.accounts set status=case when tenant_id=11 then 'BLOCKED' else 'APPROVED' end,credit_limit=150.000001;update pay.payments set status='PENDING',amount=case when tenant_id=11 then 17.000001 else 100.000001 end");};
 await check('tenant-isolated success with blocked neighboring account',async()=>{await reset();const before=await snap();const r=await f(db,'22','420');const after=await snap();assert.equal(r.amount,'100.000001');assert.equal(r.status,'RELEASED');assert.equal(after.orders[1].status,'RELEASED');assert.equal(after.payments[1].status,'CAPTURED');assert.deepEqual(after.orders[0],before.orders[0]);assert.deepEqual(after.payments[0],before.payments[0]);await assert.rejects(()=>f(db,'22','420'));assert.deepEqual(await snap(),after);});
 for(const[name,sql,which]of [['disabled account',"update sales.accounts set enabled=false where tenant_id=22",'orders'],['unpaid order',"update sales.orders set status='NEW' where tenant_id=22",'orders'],['blocked risk',"update risk.accounts set status='BLOCKED' where tenant_id=22",'billing'],['insufficient credit',"update risk.accounts set credit_limit=100.000000 where tenant_id=22",'billing'],['wrong payment amount',"update pay.payments set amount=100.000002 where tenant_id=22",'billing'],['already captured payment',"update pay.payments set status='CAPTURED' where tenant_id=22",'billing'],['missing risk row',"delete from risk.accounts where tenant_id=22",'billing']])await check('atomic rejection: '+name,async()=>{await reset();await db[which].unsafe(sql);const before=await snap();await assert.rejects(()=>f(db,'22','420'));assert.deepEqual(await snap(),before);});
 });break;}
 case'C07':{const f=load('C07/src/cancellation.cjs').quoteCancellation;await check('boundary refund policy with immutable inputs',()=>{for(const[min,refund]of [[2880,1001],[2879.9,500],[1440,500],[1439.9,0],[0,0]]){const b={status:'CONFIRMED',refundable:true,paidCents:1001};const copy=structuredClone(b);assert.deepEqual(f(b,min),{refundCents:refund,retainedCents:1001-refund});assert.deepEqual(b,copy);}assert.deepEqual(f({status:'CONFIRMED',refundable:false,paidCents:1001},5000),{refundCents:0,retainedCents:1001});assert.deepEqual(f({status:'CONFIRMED',refundable:true,paidCents:0},2880),{refundCents:0,retainedCents:0});});await check('invalid booking and time rejected',()=>{for(const b of [null,{status:'CANCELLED',paidCents:100,refundable:true},{status:'CONFIRMED',paidCents:-1,refundable:true},{status:'CONFIRMED',paidCents:1.5,refundable:true},{status:'CONFIRMED',paidCents:2**53,refundable:true}])assert.throws(()=>f(b,2880));for(const min of [-1,NaN,Infinity,'2880',null])assert.throws(()=>f({status:'CONFIRMED',paidCents:100,refundable:true},min));});break;}
 case'C08':{
 const prod=fs.readFileSync(path.join(PUBLIC,'C08/src/inventory.cjs'),'utf8');
 const mutations=[
 ['SKU identity omitted',s=>s.replace('JSON.stringify([event.sku,event.id])','JSON.stringify(event.id)')],
 ['zero stock disallowed',s=>s.replace('stock < 0) throw new Error(\'invalid stock adjustment\')','stock <= 0) throw new Error(\'invalid stock adjustment\')')],
 ['negative stock accepted',s=>s.replace('!Number.isSafeInteger(stock) || stock < 0','!Number.isSafeInteger(stock)')],
 ['stock overflow accepted',s=>s.replace('!Number.isSafeInteger(stock) || stock < 0','stock < 0')],
 ['input seen mutated',s=>s.replace('return {stock,seen:[...state.seen,key]};','state.seen.push(key); return {stock,seen:state.seen};')],
 ['failed event recorded',s=>s.replace("if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('invalid stock adjustment');","if (!Number.isSafeInteger(stock) || stock < 0) { state.seen.push(key); throw new Error('invalid stock adjustment'); }")],
 ['duplicate changes stock',s=>s.replace('return { stock:state.stock, seen:[...state.seen] }','return { stock:state.stock+event.delta, seen:[...state.seen] }')],
 ['fractional event accepted',s=>s.replace('!Number.isSafeInteger(event.delta)','!Number.isFinite(event.delta)').replace('!Number.isSafeInteger(stock) || stock < 0','!Number.isFinite(stock) || stock < 0')],
 ];
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dt-inventory-mutation-'));try{fs.cpSync(path.join(candidate,'C08'),path.join(temp,'C08'),{recursive:true});for(const[name,mutate]of mutations)await check('tests reject mutation: '+name,()=>{const mutated=mutate(prod);assert.notEqual(mutated,prod,'invalid mutation');fs.writeFileSync(path.join(temp,'C08/src/inventory.cjs'),mutated);const r=tests('C08',temp);assert.equal(r.ok,false,'candidate tests survived behavioral mutation');assert.ok(r.fail>0,'failure must be an actual failed test');});}finally{fs.rmSync(temp,{recursive:true,force:true});}break;}
 default:throw new Error('unknown case '+caseId);
 }
 const regression=tests(caseId);
 return{case:caseId,passed:checks.every(x=>x.passed)&&regression.ok,checks,regression};
}
(async()=>{
 if(!id){const results=[];for(const c of require(path.join(PUBLIC,'cases.json'))){const r=spawnSync(process.execPath,[__filename,candidate,c.id],{encoding:'utf8',timeout:300000,env:{...process.env,DT_CHALLENGE_TOOL_ROOT:TOOL,DT_CHALLENGE_PG_HARNESS:path.join(SUPPORT,'pg-case.cjs')}});try{results.push(JSON.parse(r.stdout));}catch{results.push({case:c.id,passed:false,error:(r.stderr||r.error?.message||r.stdout||'invalid grader output').slice(-1800)});}}console.log(JSON.stringify({version:1,publicSha256:revision.sha256,candidate,results,passed:results.every(r=>r.passed)},null,2));}
 else console.log(JSON.stringify(await grade(id)));
})().catch(e=>{console.log(JSON.stringify({case:id,passed:false,error:e.stack}));process.exitCode=1;});
