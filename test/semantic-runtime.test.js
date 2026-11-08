const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-semantic-runtime-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
for (const name of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_SEMANTIC_URL','DT_SEMANTIC_TOKEN']) delete process.env[name];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const P = require('../lib/semantic-protocol'), A = require('../lib/access'), E = require('../lib/execution');
const { createWorker, Admission } = require('../lib/semantic-worker');
const token = 'test-semantic-worker-token-12345', workerData = path.join(home, 'worker');
const executable = path.join(home, 'fake-frontend');
// Real subprocesses exercise streaming, process-group cancellation and artifacts. Semantic correctness
// is tested against the real Joern image in semantic.live.test.js, not inferred from this fixture.
fs.writeFileSync(path.join(home, 'frontend.js'), `
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const args=process.argv.slice(2),get=k=>(args.find(a=>a.startsWith(k+'='))||'').slice(k.length+1);
if(args.includes('--script')){
 const out=get('out');
 if(get('enrichedPath')){
  fs.copyFileSync(get('cpgPath'),get('enrichedPath'));
  fs.writeFileSync(out,[{type:'meta',protocol:'dt.semantic.projection/v1',version:1,language:'JAVASRC',overlays:['ossdataflow'],capabilities:{calls:true,dataFlow:true}},{type:'symbol',id:'1',kind:'method',name:'create',fullName:'Orders.create:java.lang.String(java.lang.String)',signature:'java.lang.String(java.lang.String)',file:'Orders.java',line:1,endLine:5,parameters:[{id:'2',name:'id',type:'java.lang.String',index:1}],returnId:'3'},{type:'summary',counts:{symbol:1},truncated:false,gaps:[]}].map(JSON.stringify).join('\\n')+'\\n');
 }else fs.writeFileSync(out,JSON.stringify({type:'summary',truncated:false,gaps:[]})+'\\n');
}else{
 const out=args[args.indexOf('--output')+1],source=args.find(a=>!a.startsWith('-')&&fs.existsSync(a)&&fs.statSync(a).isDirectory());
 const text=fs.readFileSync(path.join(source,'Orders.java'),'utf8');
 if(text.includes('FAIL_PARSE'))process.exit(2);
 if(text.includes('WAIT_PARSE')){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync(path.join(process.cwd(),'child.pid'),String(child.pid));setInterval(()=>{},1000);}
 else if(text.includes('SLOW_PARSE'))setTimeout(()=>fs.writeFileSync(out,'retained-cpg:'+text),2000);
 else fs.writeFileSync(out,'retained-cpg:'+text);
}
`);
fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${path.join(home,'frontend.js').replace(/'/g, "'\\''")}' "$@"\n`, { mode: 0o755 });
let worker, url;
const options = { data: workerData, token, java: executable, js: executable, joern: executable, parseMemoryMb: 128, queryMemoryMb: 128, totalMemoryMb: 256, parseConcurrency: 1, queryConcurrency: 1, timeoutMs: 30000 };
const owner = A.owner();
const headers = (scope = owner) => ({ authorization: `Bearer ${token}`, 'x-dt-owner': Buffer.from(JSON.stringify(scope)).toString('base64url') });
async function call(route, options = {}) { const r = await fetch(url + route, { ...options, headers: { ...headers(), ...options.headers } }); return { status: r.status, body: await r.json() }; }
function upload(text, { id = `${'a'.repeat(64)}-${crypto.randomBytes(16).toString('hex')}`, filename = 'Orders.java' } = {}) {
  const digest = crypto.createHash('sha256').update(filename).update('\0').update(text).update('\0').digest('hex');
  return { id, body: [{ type:'request', protocol:P.VERSION, id, key:'a'.repeat(64), sourceDigest:digest, language:'java' }, { type:'file', path:filename, content:Buffer.from(text).toString('base64') }, {type:'end'}].map(JSON.stringify).join('\n')+'\n' };
}
async function ready(id, states = ['ready','failed','cancelled','interrupted']) { const deadline=Date.now()+20000;while(Date.now()<deadline) { const r=await call(`/v1/jobs/${id}`); if(states.includes(r.body.state))return r.body; await new Promise(r=>setTimeout(r,30)); } throw Error('worker job did not settle'); }
test.before(async () => { worker=createWorker(options); await new Promise(r=>worker.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${worker.server.address().port}`; });
test.after(async () => { await worker.close();await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true}); });

test('worker requires service authentication and trusted owner identity on every data endpoint', async () => {
  assert.equal((await fetch(url+'/v1/info')).status,401);
  const bad={...owner,scopeKey:'wrong'};assert.equal((await call('/v1/info',{headers:headers(bad)})).status,401);
  const info=await call('/v1/info');assert.equal(info.status,200);assert.equal(info.body.protocol,P.VERSION);assert.equal(info.body.limits.totalMemoryMb,256);
});
test('source transfer rejects traversal, bad digests and truncated uploads', async () => {
  const bad=upload('class Orders {}',{filename:'../escaped.java'});assert.equal((await call('/v1/jobs',{method:'POST',body:bad.body})).status,400);assert.equal(fs.existsSync(path.join(workerData,'legacy','escaped.java')),false);
  const incomplete=upload('class Orders {}');assert.equal((await call('/v1/jobs',{method:'POST',body:incomplete.body.replace(/\{"type":"end"\}\n$/,'')})).status,400);
  const wrong=upload('class Orders {}');assert.equal((await call('/v1/jobs',{method:'POST',body:wrong.body.replace(/"sourceDigest":"[a-f0-9]+"/,'"sourceDigest":"'+'0'.repeat(64)+'"')})).status,400);
});
test('ready CPG and projection survive a failed build of another generation, and are private', async () => {
  const one=upload('class Orders {}');assert.equal((await call('/v1/jobs',{method:'POST',body:one.body})).status,202);assert.equal((await ready(one.id)).state,'ready');
  const file=path.join(workerData,'legacy',one.id,'cpg.bin'),before=fs.readFileSync(file);
  const failure=upload('FAIL_PARSE');await call('/v1/jobs',{method:'POST',body:failure.body});assert.equal((await ready(failure.id)).state,'failed');assert.deepEqual(fs.readFileSync(file),before);
  const other=A.normalize({principalId:'other',storyId:'story',multiUser:true});assert.equal((await call(`/v1/jobs/${one.id}`,{headers:headers(other)})).status,404);
  const result=await fetch(url+`/v1/jobs/${one.id}/projection`,{headers:headers()});assert.match(await result.text(),/"type":"summary"/);
});
test('cancellation drains the actual running process tree and prevents a queued parse from starting', async () => {
  const running=upload('WAIT_PARSE'),queued=upload('class Orders {}');await call('/v1/jobs',{method:'POST',body:running.body});await ready(running.id,['parsing']);
  const childFile=path.join(workerData,'legacy',running.id,'child.pid');for(let i=0;i<500&&!fs.existsSync(childFile);i++)await new Promise(r=>setTimeout(r,20));assert.ok(fs.existsSync(childFile));
  await call('/v1/jobs',{method:'POST',body:queued.body});assert.equal((await call(`/v1/jobs/${queued.id}`)).body.state,'queued');
  await call(`/v1/jobs/${queued.id}/cancel`,{method:'POST'});assert.equal((await ready(queued.id)).state,'cancelled');assert.equal(fs.existsSync(path.join(workerData,'legacy',queued.id,'raw.cpg.bin')),false);
  await call(`/v1/jobs/${running.id}/cancel`,{method:'POST'});assert.equal((await ready(running.id)).state,'cancelled');assert.equal(fs.existsSync(path.join(workerData,'legacy',running.id,'cpg.bin')),false);
  const pid=Number(fs.readFileSync(childFile));for(let i=0;i<50;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,20));}catch{return;}}assert.fail('cancelled descendant process is still running');
});
test('client publishes immutable revisions, reuses matching cache and retains old generation after failed reparse', async () => {
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},semantic:{url,token,waitMs:30000}}));require('../lib/config').reload();
  const CI=require('../lib/codeindex'),S=require('../lib/semantic-code'),source=path.join(home,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'Orders.java'),'class Orders { String create(String id) { return id; } }');
  const one=CI.build(source,'P/orders',{project:'P',repo:'orders',sha:'1'.repeat(40)});
  const built=await S.index({revisionKey:one.revisionKey,waitMs:30000});assert.equal(built.ready,true,JSON.stringify(built));assert.equal(built.analyses.length,1);
  const reused=await S.index({revisionKey:one.revisionKey,waitMs:30000});assert.equal(reused.reused,true);assert.equal(reused.analyses[0].id,built.analyses[0].id);
  fs.writeFileSync(path.join(source,'Orders.java'),'class Orders { String updated(String id) { return id; } }');const two=CI.build(source,'P/orders',{project:'P',repo:'orders',sha:'2'.repeat(40)});
  const next=await S.index({revisionKey:two.revisionKey,waitMs:30000});assert.equal(next.ready,true,JSON.stringify(next));assert.notEqual(next.analyses[0].id,built.analyses[0].id);assert.equal(S.list({versions:true}).total,2);
  fs.writeFileSync(path.join(source,'Orders.java'),'FAIL_PARSE');const bad=CI.build(source,'P/orders',{project:'P',repo:'orders',sha:'3'.repeat(40)});
  const failure=await S.index({revisionKey:bad.revisionKey,waitMs:30000});assert.equal(failure.state,'failed');assert.equal(S.list().analyses[0].id,next.analyses[0].id);assert.equal(S.load(built.analyses[0].id).sha,'1'.repeat(40));
  const other=A.normalize({principalId:'other',storyId:'story',multiUser:true});await A.run(other,async()=>{assert.equal(S.list({versions:true}).total,0);assert.throws(()=>S.resolve({revisionSet:built.revisionSet}),/not available/);});
});
test('weighted admission keeps independent slots within the total budget and cancels waiting tasks', async () => {
  const scheduler=new Admission({parseMemoryMb:150,queryMemoryMb:100,totalMemoryMb:200,parseConcurrency:2,queryConcurrency:2});
  let release;const gate=new Promise(r=>release=r),a=new AbortController(),b=new AbortController();
  const first=scheduler.run('parse','one',a.signal,()=>gate),second=scheduler.run('query','two',b.signal,()=>assert.fail('cancelled queued query started'));
  assert.equal(scheduler.status().reservedMemoryMb,150);assert.equal(scheduler.status().queued,1);b.abort(Error('cancelled'));await assert.rejects(second,/cancelled/);release();await first;
});
test('identical deep queries reuse their scoped saved result instead of starting another JVM', async () => {
  const S=require('../lib/semantic-code'),analysis=S.load(S.list().analyses[0].id),request={operation:'slice',mode:'dataflow',fromNodeIds:['2'],toNodeIds:['3'],budgetMs:5000};
  const count=()=>fs.readdirSync(path.join(workerData,'legacy')).filter(id=>P.ID.test(id)&&JSON.parse(fs.readFileSync(path.join(workerData,'legacy',id,'job.json'))).kind==='query').length;
  const before=count(),first=await S.runQuery(analysis,request),second=await S.runQuery(analysis,request);
  assert.equal(second.reused,true);assert.deepEqual(first.records,second.records);assert.equal(count(),before+1);
  const other=A.normalize({principalId:'other',storyId:'cache',multiUser:true});await A.run(other,async()=>assert.equal(S.list().total,0));
});
test('a restarted client rejoins an accepted remote parse without reparsing or losing its generation', async () => {
  const CI=require('../lib/codeindex'),S=require('../lib/semantic-code'),source=path.join(home,'resume-source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'Orders.java'),'// SLOW_PARSE\nclass Orders {}');
  const idx=CI.build(source,'P/resume',{project:'P',repo:'resume',sha:'4'.repeat(40)});
  const code=`require('./lib/semantic-code').index({revisionKey:process.argv[1],waitMs:0}).then(()=>setInterval(()=>{},1000))`;
  const child=require('node:child_process').spawn(process.execPath,['-e',code,idx.revisionKey],{cwd:path.join(__dirname,'..'),env:process.env,stdio:'ignore'});
  let attempt;
  for(let i=0;i<750;i++){for(const name of fs.readdirSync(path.join(S.base(),'analyses')).filter(n=>n.endsWith('.tmp'))){const file=path.join(S.base(),'analyses',name,'attempt.json');if(fs.existsSync(file)){const candidate=JSON.parse(fs.readFileSync(file));if(candidate.processId===child.pid&&candidate.accepted)attempt=candidate;}}if(attempt)break;await new Promise(r=>setTimeout(r,20));}
  child.kill('SIGKILL');await new Promise(r=>child.once('close',r));assert.ok(attempt,'child did not journal its accepted attempt');
  const result=await S.index({revisionKey:idx.revisionKey,waitMs:30000});assert.equal(result.ready,true,JSON.stringify(result));assert.equal(result.analyses[0].id,attempt.id);
});
test('an approximate passport version overrides older index metadata that claimed an exact binding', async () => {
  const CI=require('../lib/codeindex'),S=require('../lib/semantic-code'),dir=path.join(home,'approx-source');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'Orders.java'),'class Orders {}');
  const lib=CI.build(dir,'P/approx-lib',{project:'P',repo:'approx-lib',sha:'5'.repeat(40)}),app=CI.build(dir,'P/approx-app',{project:'P',repo:'approx-app',sha:'6'.repeat(40),libs:[{index:lib.revisionKey,version:'missing-version',artifactId:'approx-lib',exactVersion:true}]});
  const passport={service:'approx',env:'dev',repo:{project:'P',repo:'approx-app',sha:'6'.repeat(40)},codeIndex:app.revisionKey,libraries:[{index:lib.revisionKey,version:'missing-version',artifactId:'approx-lib',exactVersion:false}],effective:{endpoints:[],calls:[],consumes:[],produces:[],tables:[]}};
  const file=path.join(home,'passports','approx','passport.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(passport));
  const resolved=await S.inputs({service:'approx'});assert.ok(resolved.dependencies.length);assert.ok(resolved.dependencies.every(d=>d.exact===false&&d.evidence==='approximate'));
});
test('dirty workspace snapshots keep their logical repository but cannot replace the committed default',async()=>{
 const CI=require('../lib/codeindex'),S=require('../lib/semantic-code'),W=require('../lib/workspace'),id='branch-draft',root=path.join(home,'work',id),sha='7'.repeat(40);
 fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'Orders.java'),'class Orders {}');
 const committed=CI.build(root,'P/branch-source',{project:'P',repo:'branch-source',sha});
 const main=await S.index({revisionKey:committed.revisionKey,waitMs:30000});assert.equal(main.ready,true);
 require('../lib/util').writeJson(path.join(home,'cache/work',id+'.json'),{id,path:root,project:'P',repo:'branch-source',sha,owner:A.owner(),createdAt:new Date().toISOString(),dirty:true});
 W.write(id,'Orders.java',{content:'class Orders { int draft; }'});
 W.index(id);
 const one=await S.index({repo:'work/'+id,waitMs:30000});assert.equal(one.analyses[0].repo,'P/branch-source');assert.equal(one.analyses[0].workspace,id);
 const first=await S.query({analysis:one.analyses[0].id});
 W.write(id,'Orders.java',{content:'class Orders { int revisedDraft; }'});
 const two=await S.index({repo:'work/'+id,waitMs:30000}),second=await S.query({analysis:two.analyses[0].id});
 assert.notEqual(two.analyses[0].id,one.analyses[0].id);assert.notEqual(first.results[0].id,second.results[0].id);
 assert.equal(S.resolve({repo:'P/branch-source'})[0].id,main.analyses[0].id);
 assert.equal((await S.query({analysis:one.analyses[0].id})).results[0].id,first.results[0].id);
 assert.equal((await S.index({repo:'P/branch-source',language:'java',versions:true})).analyses.every(a=>a.language==='java'),true);
});
