#!/usr/bin/env node
// Diagnostic gates for semantic impact analysis. All inputs are disposable local fixtures.
// Default: report observed gaps. --assert-ready: fail when any required gate is unmet.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const cases = ['database-scope', 'symbol-identity', 'passport-edges', 'passport-refresh', 'traversal-boundary'];
async function probe(id) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-impact-probe-'));
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  for (const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_REPOS_DIR','DT_TOOLS']) delete process.env[k];
  const put = (p, v) => { const f=path.join(home,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v)); };
  put('config.json',{envs:{dev:{postgres:{alpha:'postgres://fixture@127.0.0.1:1/alpha',beta:'postgres://fixture@127.0.0.1:1/beta'}}}});
  const passport=(service,effective,env='dev')=>({service,env,repo:{project:'FIXTURE',repo:service,sha:'fixture-v1',ref:'main'},summary:{endpoints:(effective.endpoints||[]).length,consumes:(effective.consumes||[]).map(x=>x.topic),produces:[],tables:{},calls:[],libraries:[]},effective});
  const tools = require('../lib/tools'), callLog=[];
  async function call(name,args) { const t=performance.now();const result=await tools.call('tool_execute',{name,arguments:args});callLog.push({name,arguments:args,ms:+(performance.now()-t).toFixed(3),outputBytes:Buffer.byteLength(JSON.stringify(result))});return result; }
  const indexed=(key,source,meta={})=>{put(`sources/${key}/src/main/java/fixture/Subject.java`,source);return require('../lib/codeindex').build(path.join(home,'sources',key),key,{project:'FIXTURE',repo:key,sha:meta.sha||'fixture-sha',...meta});};
  try {
    let required, observed, gap;
    if(id==='database-scope') {
      for(const db of ['alpha','beta'])put(`cache/dev/pg/${db}.json`,{db,database:db,syncedAt:'2026-01-01',tables:[{schema:'public',name:'orders',kind:'table',columns:[{name:'id',type:'bigint'}],constraints:[]}],functions:[]});
      put('cache/dev/pg/_usage.json',{builtAt:'2099-01-01',edges:['alpha','beta'].map(db=>({db,target:'public.orders',targetKind:'table',user:db+'-reader',userKind:'service',role:'read',source:'code',where:db+'/OrderRepository.java:12'}))});
      const a=await call('impact',{target:'public.orders',env:'dev'}),b=await call('impact',{target:'table:alpha:public.orders',env:'dev'});
      required='Identical schema.table names in different logical databases remain separate; an unscoped request reports ambiguity and an exact database-scoped request selects only its users.';
      observed={unscoped:{resolved:a.resolved,services:a.services,hasAmbiguity:(a.candidates?.length||0)>1||a.ambiguous===true||(a.gaps||[]).some(g=>String(g.kind).includes('ambigu'))},scoped:{resolved:b.resolved,services:b.services,nearest:b.nearest},inputHasDb:Object.hasOwn((await tools.call('tool_describe',{name:'impact'})).inputSchema.properties,'db')};
      gap=!observed.unscoped.hasAmbiguity&&a.services?.includes('alpha-reader')&&a.services?.includes('beta-reader');
    } else if(id==='symbol-identity') {
      const source=`package fixture;\npublic class MoneyMath {\n public int round(int value) { return value; }\n public long round(long value) { return value; }\n}\n`;
      indexed('LIB/v1',source,{sha:'version-one'});indexed('LIB/v2',source,{sha:'version-two'});
      const g=require('../lib/impact').load({env:'dev'}),a=await call('code_symbols',{q:'MoneyMath round',kind:'method'}),b=await call('impact',{target:'MoneyMath#round(int)',env:'dev'});
      const symbols=(a.preview||a.rows||[]); // The compact facade may use a preview; graph count remains direct fixture evidence.
      const methods=['LIB/v1','LIB/v2'].flatMap(k=>require('../lib/codeindex').load(k).graph_().classes.flatMap(c=>c.methods.filter(m=>m.name==='round').map(m=>({repo:k,id:c.id+'#'+m.name,signature:m.params.map(p=>p.type).join(',')}))));
      required='Repository/revision and overload parameter signatures distinguish method identities; selecting one version/overload cannot silently overwrite another.';
      observed={declaredMethods:methods,uniquePublicIds:new Set(methods.map(m=>m.id)).size,impactMethodNodes:[...g.nodes.values()].filter(n=>n.id==='fixture.MoneyMath#round').map(n=>({id:n.id,repo:n.repo})),signatureSelection:b.resolved,facadeRows:symbols.length};
      gap=methods.length===4&&observed.uniquePublicIds===1&&observed.impactMethodNodes.length===1;
    } else if(id==='passport-edges') {
      put('passports/orders/passport.json',passport('orders',{endpoints:[],consumes:[{topic:'orders.paid',file:'Listener.java',line:12}],produces:[],tables:[],calls:[{client:'BillingClient',method:'GET',path:'/billing/{id}',file:'BillingClient.java',line:9}]}));
      put('passports/staging-only/passport.json',passport('staging-only',{endpoints:[{method:'GET',path:'/stage-only',handler:'Controller.get',file:'Controller.java',line:4}],consumes:[],produces:[],tables:[],calls:[]},'staging'));
      const a=await call('impact',{target:'topic:orders.paid',env:'dev'}),b=await call('impact',{target:'GET /billing/42',env:'dev'}),c=await call('impact',{target:'GET /stage-only',env:'dev'});
      required='The stored effective.consumes/calls passport contract contributes edges for unindexed services; a passport from staging is not presented as a dev deployment.';
      observed={kafkaServices:a.services||[],httpServices:b.services||[],otherEnvironmentServices:c.services||[],otherEnvironmentLabel:c.env||null};
      gap=!observed.kafkaServices.includes('orders')||!observed.httpServices.includes('orders')||observed.otherEnvironmentServices.includes('staging-only');
    } else if(id==='passport-refresh') {
      const endpoint=p=>({endpoints:[{method:'GET',path:p,handler:'Controller.get',file:'Controller.java',line:4}],consumes:[],produces:[],tables:[],calls:[]});
      put('passports/changing/passport.json',passport('changing',endpoint('/before')));
      await call('impact',{target:'GET /before',env:'dev'});
      const directory=fs.statSync(path.join(home,'passports')).mtimeMs;
      put('passports/changing/passport.json',passport('changing',endpoint('/after')));
      const a=await call('impact',{target:'GET /after',env:'dev'}),b=await call('impact',{target:'GET /before',env:'dev'});
      const unchanged=directory===fs.statSync(path.join(home,'passports')).mtimeMs;
      fs.utimesSync(path.join(home,'passports'),new Date(),new Date(Date.now()+1000));
      const control=await call('impact',{target:'GET /after',env:'dev'});
      required='Updating an existing passport invalidates impact cache even when the top-level passports directory mtime is unchanged.';
      observed={parentDirectoryUnchanged:unchanged,newEndpoint:a.resolved,oldEndpoint:b.resolved,afterExplicitParentRefresh:control.resolved};
      gap=observed.parentDirectoryUnchanged&&!a.resolved?.length&&!!b.resolved?.length;
    } else if(id==='traversal-boundary') {
      let source='package fixture;\npublic class Chain {\n';for(let i=0;i<8;i++)source+=` public int step${i}() { return ${i===0?'1':`step${i-1}()`}; }\n`;source+='}\n';indexed('SERVICE/chain',source);
      const shallow=await call('impact',{target:'Chain#step0',env:'dev',depth:2}),deep=await call('impact',{target:'Chain#step0',env:'dev',depth:8});
      required='A depth- or work-budget cut reports an incomplete frontier, independently from returned-item truncation; a bounded result cannot imply no more callers.';
      observed={shallowNearest:shallow.nearest,deepNearest:deep.nearest,shallowCounts:shallow.counts,deepCounts:deep.counts,shallowTruncated:shallow.truncated??null,complete:shallow.complete??null,gaps:shallow.gaps??null};
      gap=(deep.counts?.method||0)>(shallow.counts?.method||0)&&!shallow.truncated&&!shallow.gaps&&!Object.hasOwn(shallow,'complete');
    }
    return {id,required,observed,gap,proof:'executed-tool-probe',calls:callLog};
  } finally {fs.rmSync(home,{recursive:true,force:true});}
}
(async()=>{
  const which=process.argv.indexOf('--case');if(which>=0){console.log(JSON.stringify(await probe(process.argv[which+1])));return;}
  const results=cases.map(id=>{const r=spawnSync(process.execPath,[__filename,'--case',id],{encoding:'utf8',timeout:30000});if(r.status!==0)throw new Error(`${id}: ${r.stderr||r.stdout}`);return JSON.parse(r.stdout);});
  let revision='unknown';try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'..'),encoding:'utf8'}).trim();}catch{}
  console.log(JSON.stringify({protocol:'dt.impact-readiness/v1',revision,generatedAt:new Date().toISOString(),isolatedLocalFixtures:true,networkUsed:false,ready:results.every(r=>!r.gap),gaps:results.filter(r=>r.gap).length,results},null,2));
  if(process.argv.includes('--assert-ready')&&results.some(r=>r.gap))process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=2;});
