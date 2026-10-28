const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-impact-regression-'));
process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_LOG='quiet';
const put=(p,v)=>{const f=path.join(home,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v));return f;};
put('config.json',{envs:{dev:{postgres:{alpha:'postgres://x@127.0.0.1:1/a',beta:'postgres://x@127.0.0.1:1/b'}},staging:{postgres:{alpha:'postgres://x@127.0.0.1:1/a'}}}});
const CI=require('../lib/codeindex'),I=require('../lib/impact'),ID=require('../lib/semantic-identity');
const index=(key,source,meta={})=>{const f=put(`sources/${key}/src/main/java/fixture/Subject.java`,source);CI.build(path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(f))))),key,{repo:key.split('/').pop(),sha:'sha-'+key,...meta});return CI.load(key);};
// Explicit root construction avoids relying on a project package/file name.
const idx=(key,files,meta={})=>{for(const[p,s]of Object.entries(files))put(`sources/${key}/${p}`,s);CI.build(path.join(home,'sources',key),key,{repo:key.split('/').pop(),sha:'sha-'+key,...meta});};
const table=(name,columns)=>({schema:'public',name,kind:'table',columns:columns.map(name=>({name,type:'numeric'})),indexes:[],constraints:[]});
const catalog=db=>({db,database:db,syncedAt:'2026-10-01',tables:[table('orders',['id','amount','subtotal','status','tenant_id']),table('other',['id','amount'])],functions:[],viewDeps:[],triggers:[]});
for(const db of ['alpha','beta'])put(`cache/dev/pg/${db}.json`,catalog(db));
put('cache/dev/pg/_usage.json',{builtAt:'2099-01-01',edges:['alpha','beta'].map(db=>({db,target:'public.orders',targetKind:'table',user:db+'-reader',userKind:'service',role:'read',source:'code',where:'Repository.java:12'}))});
const passport=(service,effective,env='dev')=>({service,env,repo:{project:'FIXTURE',repo:service,sha:'revision-one'},effective});
const savePass=(s,e,env)=>put(`passports/${s}/passport.json`,passport(s,e,env));
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('scoped database identities separate identical tables, functions and columns; aliases require disambiguation',()=>{
 const a=I.impact('public.orders',{env:'dev',grep:false});assert.equal(a.ambiguous,true);assert.deepEqual(a.resolved,[]);assert.deepEqual(a.candidates.sort(),['table:dev:alpha:public.orders','table:dev:beta:public.orders']);
 const b=I.impact('table:alpha:public.orders',{env:'dev',grep:false});assert.deepEqual(b.services,['alpha-reader']);assert.deepEqual(b.resolved,['table:dev:alpha:public.orders']);assert.equal(b.identityVersion,'dt.identity/v1');
 const c=I.impact('public.orders',{env:'dev',db:'beta',grep:false});assert.deepEqual(c.services,['beta-reader']);
 assert.equal(I.impact('column:public.orders.amount',{env:'dev',grep:false}).ambiguous,true);
 assert.equal(I.impact('table:staging:alpha:public.orders',{env:'dev',grep:false}).complete,false);
});
test('quoted catalog objects retain distinct identities and function overload uncertainty is explicit',()=>{
 const cat=catalog('alpha');cat.tables.push({...table('Orders',['Amount'])});cat.functions=[{schema:'public',name:'same_name',kind:'function',lang:'sql',args:'v integer',body:'select amount from public.orders'},{schema:'public',name:'same_name',kind:'function',lang:'sql',args:'v text',body:'select amount from public.orders'}];put('cache/dev/pg/alpha.json',cat);
 const quoted=I.impact('table:alpha:public."Orders"',{env:'dev',grep:false}),lower=I.impact('table:alpha:public.orders',{env:'dev',grep:false});assert.deepEqual(quoted.resolved,['table:dev:alpha:public."Orders"']);assert.notDeepEqual(quoted.resolved,lower.resolved);assert.deepEqual(quoted.services,[]);assert.deepEqual(lower.services,['alpha-reader']);
 assert.ok(require('../lib/pgindex').namesOf(cat).rel.has('public."Orders"'));assert.equal(require('../lib/passport/extract').sqlRefs('select * from public."Orders"')[0].table,'public."Orders"');
 const col=I.impact('column:alpha:public."Orders"."Amount"',{env:'dev',grep:false});assert.ok(col.gaps.some(g=>g.kind==='quoted-identifier-lineage-unsupported'));
 const fn=I.impact('pgfn:alpha:public.same_name',{env:'dev',grep:false});assert.equal(fn.ambiguous,true);assert.equal(fn.candidates.length,2);assert.equal(new Set(fn.candidates).size,2);assert.ok(I.impact(fn.candidates[0],{env:'dev',grep:false}).gaps.some(g=>g.kind==='ambiguous-pg-function-overload'));
});
test('four overloaded/versioned methods retain public identities; typed callers reach only their bound revision',async()=>{
 const math='package fixture;\npublic class MoneyMath {\n public int round(int value) { return value; }\n public long round(long value) { return value; }\n public int intCall() { return round(1); }\n public long longCall() { return round(1L); }\n}\n';
 for(const key of ['LIB/v1','LIB/v2'])idx(key,{'src/main/java/fixture/MoneyMath.java':math});
 for(const[v,name]of[['v1','FirstCaller'],['v2','SecondCaller']])idx(`SERVICE/${v}`,{[`src/main/java/fixture/${name}.java`]:`package fixture;\nimport fixture.MoneyMath;\npublic class ${name} { MoneyMath math; public int invoke() { return math.round(1); } }`},{libs:[{index:`LIB/${v}`}]});
 const g=I.load({env:'dev',repos:'LIB/*'}),methods=[...g.nodes.values()].filter(n=>n.kind==='method'&&n.signature.startsWith('round('));assert.equal(methods.length,4);assert.equal(new Set(methods.map(m=>m.id)).size,4);
 const ambiguous=I.impact('MoneyMath#round(int)',{env:'dev',grep:false});assert.equal(ambiguous.ambiguous,true);assert.equal(ambiguous.candidates.length,2);
 const exact=ID.code('LIB/v1','sha-LIB/v1','fixture.MoneyMath#round(int)'),r=I.impact(exact,{env:'dev',grep:false});
 assert.ok(r.items.some(n=>n.name==='MoneyMath#intCall'));assert.ok(!r.items.some(n=>n.name==='MoneyMath#longCall'));assert.ok(r.items.some(n=>n.name==='FirstCaller#invoke'));assert.ok(!r.items.some(n=>n.name==='SecondCaller#invoke'));
 const symbols=await require('../lib/tools').call('code_symbols',{q:'MoneyMath round',kind:'method',repos:'LIB/*'});assert.equal(new Set(symbols.rows.map(r=>r.id)).size,4);assert.ok(symbols.rows.every(r=>r.revision&&r.legacyId));
 assert.throws(()=>I.loadLegacy({repos:'LIB/*'}),/Ambiguous legacy class/);
});
test('normal stored passport consumes/calls and environment filter; atomic/equal-sized edits invalidate and failed refresh labels last-good',()=>{
 savePass('consumer',{consumes:[{topic:'orders.paid',file:'Listener.java',line:4}],calls:[{method:'GET',path:'/bill/{id}',file:'Client.java',line:6}]});savePass('stage',{endpoints:[{method:'GET',path:'/only-stage'}]},'staging');
 assert.deepEqual(I.impact('topic:orders.paid',{env:'dev',grep:false}).services,['consumer']);assert.deepEqual(I.impact('GET /bill/1',{env:'dev',grep:false}).services,['consumer']);assert.deepEqual(I.impact('GET /only-stage',{env:'dev',grep:false}).resolved,[]);
 const f=savePass('changing',{endpoints:[{method:'GET',path:'/before'}]});I.load({env:'dev'});const parent=fs.statSync(path.join(home,'passports')).mtimeMs;
 const temp=f+'.new';fs.writeFileSync(temp,JSON.stringify(passport('changing',{endpoints:[{method:'GET',path:'/afterx'}]})));fs.renameSync(temp,f);
 assert.equal(fs.statSync(path.join(home,'passports')).mtimeMs,parent);assert.equal(I.impact('GET /afterx',{env:'dev',grep:false}).services[0],'changing');assert.deepEqual(I.impact('GET /before',{env:'dev',grep:false}).resolved,[]);
 fs.writeFileSync(f,'{broken');const stale=I.impact('GET /afterx',{env:'dev',grep:false});assert.equal(stale.complete,false);assert.ok(stale.gaps.some(g=>g.kind==='passport-stale-last-good'&&g.retained));
 fs.unlinkSync(f);assert.deepEqual(I.impact('GET /afterx',{env:'dev',grep:false}).resolved,[]);
});
test('depth/node/output bounds expose separate cuts, cycles terminate, pages do not lose rows, stale cursors reject',()=>{
 let src='package fixture;\npublic class Chain {\n';for(let n=0;n<9;n++)src+=`public int step${n}() { return ${n===0?'1':`step${n-1}()`}; }\n`;src+='}\n';idx('CHAIN/one',{'src/main/java/fixture/Chain.java':src});
 const shallow=I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:2,grep:false}),deep=I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:12,grep:false});assert.equal(shallow.complete,false);assert.ok(shallow.cutReasons.includes('depth'));assert.ok(shallow.frontier.length);assert.equal(deep.traversalComplete,true);assert.equal(deep.counts.method,8);
 const bounded=I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:12,node_limit:3,grep:false});assert.ok(bounded.cutReasons.includes('nodes'));assert.equal(bounded.counts.method,2);
 let cursor,ids=[];do{const r=I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:12,limit:2,cursor,grep:false});ids.push(...r.items.map(i=>i.id));cursor=r.continuation;}while(cursor);assert.equal(ids.length,8);assert.equal(new Set(ids).size,8);
 const page=I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:12,limit:2,grep:false});savePass('new-service',{consumes:[{topic:'unrelated'}]});assert.throws(()=>I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:12,limit:2,cursor:page.continuation,grep:false}),/expired/);
 idx('CYCLE/one',{'src/main/java/fixture/Cycle.java':'package fixture;\npublic class Cycle {\n public int a() { return b(); }\n public int b() { return a(); }\n}\n'});const cycle=I.impact('Cycle#a',{repos:'CYCLE/*',depth:12,grep:false});assert.equal(cycle.traversalComplete,true);assert.equal(cycle.counts.method,1);
 let clock=0;Object.defineProperty(performance,'now',{value:()=>clock+=2,configurable:true});try{const timed=I.impact('Chain#step0',{env:'dev',repos:'CHAIN/*',depth:12,time_ms:1,grep:false});assert.ok(timed.cutReasons.includes('time'));assert.equal(timed.continuation,undefined);assert.ok(timed.next);}finally{delete performance.now;}
 const unknown=I.impact('NoKnownSymbol',{repos:'CHAIN/*',grep:false});assert.equal(unknown.complete,false);assert.ok(unknown.gaps.some(g=>g.kind==='unknown-target'));
});
test('byte budgets trim summaries/gaps as well as items; a huge identity cannot silently overflow',()=>{
 for(let n=0;n<80;n++)savePass(`fan-${String(n).padStart(2,'0')}-${'long-name-'.repeat(12)}`,{consumes:[{topic:'fanout'}]});
 const r=I.impact('topic:fanout',{env:'dev',limit:100,max_output_bytes:4096,grep:false});assert.ok(Buffer.byteLength(JSON.stringify(r))<=4096);assert.equal(r.counts.svc,80);assert.equal(r.complete,false);assert.ok(r.continuation);assert.equal(r.traversalComplete,true);
 const b=I.boundResult({counts:{svc:1000},cutReasons:['output'],gaps:Array.from({length:100},(_,i)=>({kind:'unknown',detail:'x'.repeat(1000),candidates:['x'.repeat(100)]})),services:Array.from({length:100},()=> 'x'.repeat(300)),frontier:Array.from({length:100},()=> 'x'.repeat(300)),view:'/show/example'},4096);assert.ok(Buffer.byteLength(JSON.stringify(b))<=4096);assert.equal(b.counts.svc,1000);assert.equal(b.view,'/show/example');assert.equal(b.metadataTruncated,true);
});
test('SQL column lexer classifies targets/RHS/predicates/stars/returning and ambiguity without counting literal/comment words',()=>{
 const cat=catalog('alpha'),C=require('../lib/column-lineage');
 const r=C.analyze("update public.orders o set amount = subtotal + 1 where o.amount > 0 returning amount; select o.*, x.amount from public.orders o join public.other x on o.id=x.id where x.amount>2; -- amount\n select 'amount' from public.orders",cat);
 assert.ok(r.hits.some(h=>h.table==='public.orders'&&h.column==='amount'&&h.access==='write'&&h.syntax==='set-target'));
 assert.ok(r.hits.some(h=>h.column==='subtotal'&&h.access==='read'));assert.ok(r.hits.some(h=>h.table==='public.orders'&&h.column==='amount'&&h.access==='predicate'));assert.ok(r.hits.some(h=>h.column==='status'&&h.syntax==='star-expansion'));
 assert.ok(r.hits.some(h=>h.table==='public.other'&&h.column==='amount'&&h.access==='read'));assert.ok(r.hits.some(h=>h.table==='public.other'&&h.column==='amount'&&h.access==='predicate'));
 assert.ok(!r.hits.some(h=>h.line===2));
 const ambiguous=C.analyze('select amount from public.orders o join public.other x on o.id=x.id',cat);assert.ok(ambiguous.gaps.some(g=>g.kind==='ambiguous-column'));assert.ok(ambiguous.hits.filter(h=>h.column==='amount').every(h=>h.access==='unknown'));
 const multiply=C.analyze('select amount * 2 from public.orders',cat);assert.deepEqual([...new Set(multiply.hits.map(h=>h.column))],['amount']);assert.ok(!multiply.hits.some(h=>h.syntax==='star-expansion'));
 const rhs=C.analyze('update public.orders set amount = case when subtotal = 3 then amount else subtotal end, status = status where id=1',cat);assert.ok(rhs.hits.filter(h=>h.column==='subtotal').every(h=>h.access==='read'));assert.equal(rhs.hits.filter(h=>h.column==='amount'&&h.access==='write').length,1);
 const insert=C.analyze('insert into public.orders (id, amount) values (1, 5) returning amount',cat);assert.ok(insert.hits.some(h=>h.column==='amount'&&h.access==='write'));assert.ok(insert.hits.some(h=>h.column==='amount'&&h.access==='read'));
});
test('column tool covers view/materialized view, OLD/NEW, source SQL constants and ORM access; caller chains and gaps stay explicit',async()=>{
 const cat=catalog('alpha');cat.tables.push({...table('amount_view',['amount']),kind:'view',definition:'select amount from public.orders'},{...table('amount_mat',['amount']),kind:'matview',definition:'select amount from public.orders'});
 cat.functions=[{schema:'public',name:'change_amount',kind:'procedure',lang:'sql',body:'update public.orders set amount = subtotal where amount > 0 returning amount'}, {schema:'public',name:'audit',kind:'function',lang:'plpgsql',body:'begin\n if OLD.amount <> NEW.amount then NEW.amount := OLD.amount; end if; return NEW;\nend'}, {schema:'public',name:'caller',kind:'function',lang:'sql',body:'call public.change_amount()'}, {schema:'public',name:'dynamic',kind:'function',lang:'plpgsql',body:"execute 'select amount from public.orders where id=' || p_id;"}];
 cat.triggers=[{table:'public.orders',function:'public.audit',name:'audit',def:'BEFORE UPDATE ON public.orders',enabled:true}];cat.viewDeps=cat.tables.filter(t=>t.definition).map(t=>({view:`public.${t.name}`,ref:'public.orders'}));put('cache/dev/pg/alpha.json',cat);require('../lib/pgindex').build('dev');
 idx('SQL/constants',{'src/main/java/fixture/Queries.java':'package fixture;\npublic class Queries {\nstatic final String SQL = "select o.amount from public.orders o where o.tenant_id=?";\n}\n'});
 put('passports/entities/passport.json',{...passport('entities',{}),db:{datasources:[{db:'alpha'}]}});
 idx('ORM/entities',{'src/main/java/fixture/Order.java':'package fixture;\n@Entity\n@Table(name="orders", schema="public")\npublic class Order {\n @Column(name="amount")\n public long amount;\n public long getAmount() { return amount; }\n public void setAmount(long v) { this.amount = v; }\n}\n','src/main/java/fixture/Mutator.java':'package fixture;\npublic class Mutator {\n public void change(Order o) { o.setAmount(5); o.getAmount(); }\n}\n'});
 const r=await require('../lib/tools').call('pg_usage',{name:'alpha:public.orders.amount',env:'dev'});
 assert.ok(r.edges.some(e=>e.user==='public.change_amount'&&e.access==='write'));assert.ok(r.edges.some(e=>e.user==='public.change_amount'&&e.access==='predicate'));assert.ok(r.edges.some(e=>e.user==='public.amount_view'&&e.access==='read'));assert.ok(r.edges.some(e=>e.user==='public.amount_mat'&&e.access==='read'));
 assert.ok(r.edges.some(e=>e.user==='public.audit'&&e.access==='write'&&e.detail==='trigger-new'));assert.ok(r.edges.some(e=>e.user==='public.audit'&&e.access==='read'&&e.detail==='trigger-old'));
 assert.ok(r.edges.some(e=>e.file?.endsWith('Queries.java')&&e.access==='read'&&e.line===3));assert.ok(r.callers.some(e=>e.userId==='pgfn:dev:alpha:public.caller'));
 assert.ok(r.edges.some(e=>e.userKind==='field'&&e.access==='unknown'));assert.ok(r.edges.some(e=>e.detail==='ORM object field access'&&e.access==='write'&&e.persistenceWriteVerified===false));assert.ok(r.edges.some(e=>e.file?.endsWith('Queries.java')&&e.binding==='candidate'));
 assert.equal(r.complete,false);assert.ok(r.gaps.some(g=>g.kind==='dynamic-sql'));assert.ok(r.coverage.unknowns.includes('generated-code'));assert.ok(r.edges.every(e=>e.env==='dev'&&e.db==='alpha'&&e.targetId==='column:dev:alpha:public.orders.amount'));
 // Both databases contain orders: code-only SQL/ORM database binding cannot be guessed.
 const G=I.load({env:'dev'});assert.ok(G.gaps.some(g=>g.kind==='ambiguous-code-database'));
});
