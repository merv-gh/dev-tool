const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const enabled=!!(process.env.DT_SERVICE_ARCHITECTURE_LIVE_URL&&process.env.DT_SERVICE_ARCHITECTURE_LIVE_TOKEN);
test('real Joern cold-start dossier builds missing CPGs, queries value flow and reuses generations',{skip:!enabled,timeout:600000},async()=>{
 const home=process.env.DT_SERVICE_ARCHITECTURE_LIVE_HOME||fs.mkdtempSync(path.join(os.tmpdir(),'dt-service-live-'));process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';process.env.DT_NO_DOCTOR='1';for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR'])delete process.env[key];
 await require('../demo/service-architecture').seed(home);const file=path.join(home,'config.json'),config=JSON.parse(fs.readFileSync(file));config.semantic={url:process.env.DT_SERVICE_ARCHITECTURE_LIVE_URL,token:process.env.DT_SERVICE_ARCHITECTURE_LIVE_TOKEN,waitMs:0};fs.writeFileSync(file,JSON.stringify(config));require('../lib/config').reload();const T=require('../lib/tools'),J=require('../lib/jobs'),S=require('../lib/semantic-code');
 const settle=async(name,args)=>{let r=await T.call(name,{...args,waitMs:30000});for(let i=0;i<20&&r.state==='running';i++)r=await T.call(name,{job:r.job,waitMs:30000});assert.ok(r.state==='done'||r.ready,JSON.stringify(r));return r;};
 try{
  assert.equal(S.list({versions:true}).total,0);
  const result=await settle('architecture_service',{service:'checkout',env:'dev',semantic_queries:8});
  assert.ok(result.coverage.requirements);assert.ok(result.coverage.semanticQueries);
  const saved=require('../lib/results').load(result.view.split('/').pop()),d=saved.data.dossier,values=d.semantic.queries.flatMap(q=>q.paths);
  assert.equal(d.semantic.indexing.state,'ready');assert.equal(d.semantic.indexing.automatic,true);assert.equal(J.get(d.semantic.indexing.job).state,'done');
  assert.ok(d.semantic.analyses.length);assert.equal(result.identity.revision,d.semantic.analyses[0].sha);
  assert.ok(values.length,JSON.stringify(d.semantic));assert.ok(values.every(p=>p.proof.status==='static-dataflow'));assert.ok(d.code.flows.every(f=>f.proof.runtime==='unknown'));assert.equal(require('../lib/architecture-store').list().total,0);
  const ids=S.list({versions:true}).analyses.map(a=>a.id).sort(),parseJobs=()=>J.list(100).filter(j=>j.key.startsWith('semantic:index:')).length,before=parseJobs();
  const reused=await settle('architecture_service',{service:'checkout',env:'dev',semantic_queries:1}),again=require('../lib/results').load(reused.view.split('/').pop()).data.dossier;
  assert.equal(again.semantic.indexing.state,'reused');assert.deepEqual(S.list({versions:true}).analyses.map(a=>a.id).sort(),ids);assert.equal(parseJobs(),before);
  fs.writeFileSync(path.join(home,'service-live-report.json'),JSON.stringify({passed:true,identity:result.identity,coverage:result.coverage,supportedValuePaths:values.length,analyses:d.semantic.analyses,indexing:d.semantic.indexing,reuseVerified:true,result:saved.id,gaps:d.gaps},null,2));
 }finally{await require('../lib/isolate').stop();await require('../lib/state-store').close();}
});
