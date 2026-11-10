const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-ci-'));Object.assign(process.env,{DT_HOME:home,DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_TOOLS','DT_TOOL_PROFILE'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const F=require('./helpers/fake-ci'),J=require('../lib/jenkins'),P=require('../lib/pr-iteration'),C=require('../lib/config'),E=require('../lib/execution'),A=require('../lib/access');let f;
const job='team/orders/PR-42',pr={project:'SHOP',repo:'orders',id:42};
const config=patch=>{fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({...f.config,...patch}));C.reload();};
test.before(async()=>{f=await F.start();config();});
test.after(async()=>{await f.close();await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('Jenkins folder paths encode components once and reject ambiguous targets',async()=>{
 assert.equal(J.jobPath('team/service/feature%2Fwork'),'/job/team/job/service/job/feature%252Fwork/');for(const name of ['../x','/x','a//b','a?b','a\\b'])assert.throws(()=>J.jobPath(name));
 const r=await J.jobs();assert.equal(r.jobs[0].job,'team/orders');assert.equal(r.jobs[0].folder,true);
 const b=await J.build({job,sha:F.SHA});assert.equal(b.state,'failed');assert.equal(b.revision.match,true);assert.equal(b.success,false);
 f.state.result='SUCCESS';assert.equal((await J.build({job,sha:F.NEXT})).success,false);f.state.buildSha=null;const missing=await J.build({job,sha:F.SHA});assert.equal(missing.revision.match,null);assert.equal(missing.success,false);f.state.buildSha=F.SHA;
});
test('bounded waits resume the pinned build; cancellation drains polling',async()=>{
 f.state.building=true;const r=await J.wait({job,sha:F.SHA,wait_ms:140,poll_ms:100});assert.equal(r.wait.state,'pending');assert.equal(r.resume.arguments.build,17);assert.ok(r.cursor);f.state.building=false;
 const done=await J.wait({...r.resume.arguments,cursor:r.cursor,wait_ms:0});assert.equal(done.success,true);assert.equal(done.wait.state,'complete');
 await assert.rejects(A.run({principalId:'other',storyId:'other'},()=>J.wait({job,cursor:r.cursor,wait_ms:0})),/Cursor/);
 f.state.building=true;const signal=new AbortController(),cancel=E.run({kind:'test',signal:signal.signal},()=>J.wait({job,wait_ms:5000,poll_ms:100}));setTimeout(()=>signal.abort(),80);await assert.rejects(cancel);const reads=f.state.reads;await new Promise(r=>setTimeout(r,180));assert.equal(f.state.reads,reads);f.state.building=false;
});
test('submission receipts suppress replay and uncertain outcomes, honoring configured allowlists',async()=>{
 let r=await J.start({job,request_id:'build-1',parameters:{SHA:F.SHA}}),posts=f.state.posts;assert.equal(r.queue_id,7);assert.equal((await J.start({job,request_id:'build-1',parameters:{SHA:F.SHA}})).replayed,true);assert.equal(f.state.posts,posts);
 await assert.rejects(J.start({job,request_id:'build-1',parameters:{SHA:F.NEXT}}),e=>e.code==='DT_CI_ACTION_CONFLICT');assert.equal((await J.queue({job,queue_id:7})).build,17);
 await assert.rejects(J.queue({job:'team/other',queue_id:7}),/different job/);await assert.rejects(J.start({job:'forbidden/x',request_id:'no'}),/allowedJobs/);
 f.state.dropPost=true;await assert.rejects(J.start({job,request_id:'lost'}),e=>e.code==='DT_CI_ACTION_UNKNOWN');posts=f.state.posts;const uncertain=await J.start({job,request_id:'lost'});assert.equal(uncertain.outcome,'unknown');assert.equal(f.state.posts,posts);f.state.dropPost=false;
 config({jenkins:{...f.config.jenkins,allowBuild:false}});await assert.rejects(J.start({job,request_id:'disabled'}),/disabled/);config();
});
test('console excerpts and JUnit failures are bounded and scrub credentials',async()=>{
 const tail=await J.log({job,max_bytes:512});assert.ok(Buffer.byteLength(tail.text)<=512);assert.match(tail.text,/FAILED OrderTest/);assert.doesNotMatch(tail.text,/secret-jenkins-token/);
 const part=await J.log({job,max_bytes:256,tail:false});assert.equal(part.truncated,true);assert.equal(part.next_start,null);
 f.state.result='FAILURE';const report=await J.tests({job});assert.equal(report.counts.failed,1);assert.equal(report.failuresComplete,true);assert.doesNotMatch(report.failures[0].error,/secret-jenkins-token/);f.state.report=false;assert.equal((await J.tests({job})).available,false);f.state.report=true;
});
test('native draft creation verifies capability, reuses branches and never repeats a POST',async()=>{
 const args={...pr,from:'feature/order-id',to:'main',title:'Preserve order identity',request_id:'draft-1'};f.state.version='8.17.0';await assert.rejects(P.create(args),/8.18/);f.state.version='8.19.0';
 let r=await P.create(args);assert.equal(r.draft,true);assert.equal(r.created,true);let posts=f.state.posts;r=await P.create(args);assert.equal(r.replayed,true);assert.equal(f.state.posts,posts);r=await P.create({...args,request_id:'draft-2'});assert.equal(r.reused,true);assert.equal(f.state.posts,posts);
 f.state.created=false;f.state.incomplete=true;await assert.rejects(P.create({...args,request_id:'draft-incomplete'}),/incomplete/);assert.equal(f.state.posts,posts);f.state.incomplete=false;f.state.created=true;
});
test('review iteration binds failures, comments, approvals and green checks to each push',async()=>{
 f.state.sha=F.SHA;f.state.reviewed=F.SHA;f.state.approval='NEEDS_WORK';f.state.result='FAILURE';f.state.activities=[{user:{name:'reviewer'},commentAnchor:{path:'App.java',line:8,fromHash:F.SHA},comment:{id:1,version:0,text:'Keep the order id',comments:[{id:2,text:'Add entry-to-exit test'}]}}];
 let r=await P.snapshot(pr);assert.equal(r.state,'build_failed');assert.equal(r.review.comments.length,2);assert.equal(r.review.comments[1].parent,1);const old=r;
 f.state.result='SUCCESS';r=await P.snapshot({...pr,cursor:old.cursor});assert.equal(r.state,'changes_requested');assert.equal(r.changes.any,true);
 f.state.sha=F.NEXT;f.state.buildSha=F.NEXT;r=await P.wait({...pr,sha:F.SHA,cursor:r.cursor,until:'ready',wait_ms:0});assert.equal(r.state,'superseded');assert.equal(r.ready,false);
 f.state.approval='APPROVED';r=await P.snapshot({...pr,sha:F.NEXT});assert.equal(r.state,'awaiting_review');assert.equal(r.review.approvals,0,'an old approval cannot bless a new push');
 f.state.checks=[];f.state.reviewed=F.NEXT;r=await P.snapshot({...pr,sha:F.NEXT});assert.equal(r.state,'awaiting_build');assert.equal(r.ready,false,'zero checks is not green');
 f.state.checks=null;r=await P.wait({...pr,sha:F.NEXT,required_builds:['orders-ci'],until:'ready',wait_ms:0});assert.equal(r.ready,true);assert.equal(r.draft,true);
 let n=0;f.state.onPrRead=s=>{if(++n===1)s.sha=F.SHA;};r=await P.snapshot({...pr,sha:F.NEXT});assert.equal(r.state,'superseded');assert.equal(r.ready,false,'concurrent head movement invalidates green ancillary reads');delete f.state.onPrRead;f.state.sha=F.NEXT;
});
test('review wait detects edited feedback and response views preserve raw evidence',async()=>{
 const r=await P.snapshot(pr);f.state.activities[0].comment.version++;f.state.activities[0].comment.text='Also preserve correlation';const changed=await P.wait({...pr,cursor:r.cursor,until:'review',wait_ms:0});assert.equal(changed.wait.state,'changed');
 const tools=require('../lib/tools'),schema=(await tools.schemas()).find(t=>t.name==='jenkins_start');assert.ok(schema);assert.deepEqual(require('../lib/schema').validate({job,request_id:'x',parameters:{SHA:F.SHA}},schema.inputSchema),[]);
 const result=await tools.call('bitbucket_pr_status',pr);assert.ok(result.view);assert.equal(result.sha,F.NEXT);assert.equal(result.ready,true);
});
test('an actual local workspace fix/push requires fresh CI proof for its returned commit',async()=>{
 const {execFileSync}=require('node:child_process'),seed=path.join(home,'seed'),bare=path.join(home,'remote.git'),env={...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.test'};
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,env,stdio:'pipe'}).toString().trim();fs.mkdirSync(seed);git(seed,'init','-q','-b','main');fs.writeFileSync(path.join(seed,'handler.js'),'module.exports = order => null;\n');git(seed,'add','.');git(seed,'commit','-qm','initial bug');git(seed,'checkout','-qb','feature/order-id');git(seed,'clone','-q','--bare',seed,bare);git(bare,'symbolic-ref','HEAD','refs/heads/main');
 config({push:{enabled:true,author:'Fixture <fixture@example.test>'}});
 const W=require('../lib/workspace'),T=require('../lib/tools'),ws=await W.open({project:'SHOP',repo:'orders',ref:'feature/order-id',url:'file://'+bare,fresh:true}),dir=W.checkId(ws.id).path;
 const run=()=>execFileSync(process.execPath,['-e',"require('node:assert/strict').equal(require('./handler')({id:42}),42)"],{cwd:dir,stdio:'pipe'});
 assert.throws(run);f.state.sha=ws.sha;f.state.reviewed=ws.sha;f.state.approval='APPROVED';f.state.result='FAILURE';const old=await T.call('bitbucket_pr_status',pr);assert.equal(old.ready,false);
 W.write(ws.id,'handler.js',{content:'module.exports = order => order.id;\n'});run();assert.equal((await W.patch(ws.id)).files.length,1);
 const push=await T.call('workspace_push',{workspace:ws.id,branch:'feature/order-id',message:'Preserve order identity'});assert.equal(git(bare,'rev-parse','feature/order-id'),push.commit);assert.notEqual(push.commit,ws.sha);
 f.state.sha=push.commit;f.state.buildSha=push.commit;f.state.result='SUCCESS';assert.equal((await T.call('bitbucket_pr_wait',{...pr,sha:ws.sha,cursor:old.cursor,wait_ms:0})).state,'superseded');
 assert.equal((await T.call('bitbucket_pr_status',{...pr,sha:push.commit})).ready,false);f.state.reviewed=push.commit;assert.equal((await T.call('bitbucket_pr_status',{...pr,sha:push.commit})).ready,true);config();
});
test('Workbench job choices come from Jenkins observations, not internal execution ids',async()=>{
 const W=require('../lib/workbench');assert.equal(W.sourceFor('jenkins_build','job',{}),'jenkins-job');await J.jobs();const r=await W.choices({tool:'jenkins_build',field:'job'});assert.equal(r.choices[0].value,'team/orders');assert.match(r.choices[0].detail,/Cached/);
 const isolated=await A.run({principalId:'someone',storyId:'elsewhere'},()=>W.choices({tool:'jenkins_build',field:'job'}));assert.equal(isolated.choices.length,0);assert.ok(isolated.gaps.length);
 const T=require('../lib/tools');for(const [query,name]of [['wait for Jenkins build','jenkins_jobs'],['wait for review feedback','bitbucket_pr_status'],['context pressure','chat_context_status']])assert.equal((await T.call('tool_search',{query})).tools[0].name,name);
 const profile=(await T.schemas({profile:'ci'})).map(t=>t.name);for(const name of ['jenkins_wait','bitbucket_pr_create','chat_compaction_request'])assert.ok(profile.includes(name));
});
test('MCP cancellation ends a CI wait without another remote poll or resubmission',async()=>{
 const server=require('../server').start({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const post=body=>fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json','mcp-session-id':'ci-cancel'},body:JSON.stringify(body)});
 f.state.building=true;
 try{
  const before=f.state.reads,posts=f.state.posts,pending=post({jsonrpc:'2.0',id:998,method:'tools/call',params:{name:'jenkins_wait',arguments:{job,wait_ms:5000,poll_ms:100}}});
  for(let n=0;n<100&&f.state.reads===before;n++)await new Promise(r=>setTimeout(r,10));assert.ok(f.state.reads>before);
  assert.equal((await post({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:998}})).status,202);const result=await(await pending).json();assert.equal(result.result.isError,true);assert.equal(result.result.structuredContent.code,'DT_CANCELLED');
  const reads=f.state.reads;await new Promise(r=>setTimeout(r,180));assert.equal(f.state.reads,reads);assert.equal(f.state.posts,posts);
 }finally{f.state.building=false;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('REST transport rejects redirects, oversized JSON and malformed replies without exposing credentials',async()=>{
 const H=require('../lib/ci-http');for(const value of ['file:///tmp/x','https://u:pass@example.test','https://example.test?token=x','not-url'])assert.throws(()=>H.base(value));
 await assert.rejects(H.request(f.state.base,'//outside.test'),/inside/);
 f.state.respond=(req,res,u)=>{if(!u.pathname.startsWith('/fixture/'))return false;const name=u.pathname.split('/').at(-1);if(name==='redirect'){res.writeHead(302,{location:'https://outside.test/'});res.end('secret-jenkins-token');}else if(name==='large'){res.end('x'.repeat(4096));}else if(name==='bad'){res.end('not json');}else{res.end();}return true;};
 try{
  await assert.rejects(H.request(f.state.base,'/fixture/redirect'),e=>e.statusCode===302&&!e.message.includes('secret-jenkins-token'));
  await assert.rejects(H.request(f.state.base,'/fixture/large',{maxBytes:128}),e=>e.code==='DT_CI_RESPONSE_LIMIT');
  const partial=await H.request(f.state.base,'/fixture/large',{maxBytes:128,partial:true});assert.equal(partial.buffer.length,128);assert.equal(partial.truncated,true);
 const malformed=await H.request(f.state.base,'/fixture/bad');assert.throws(()=>malformed.json(),e=>e.code==='DT_CI_RESPONSE');assert.equal((await H.request(f.state.base,'/fixture/empty')).json(),null);
 }finally{delete f.state.respond;}
});
test('invalid build arguments never submit; queue affinity and malformed tests remain gaps',async()=>{
 let posts=f.state.posts;for(const args of [{job,parameters:[]},{job,parameters:{x:{bad:true}}},{job,parameters:{x:'x'.repeat(4001)}}])await assert.rejects(J.start({...args,request_id:'invalid'}));assert.equal(f.state.posts,posts);
 for(const build of [0,'main',-1])await assert.rejects(J.build({job,build}));await assert.rejects(J.queue({job,queue_id:0}));await assert.rejects(J.wait({job,wait_ms:25001}));await assert.rejects(J.wait({job,poll_ms:10}));await assert.rejects(J.log({job,max_bytes:20}));
 const cfg=f.config.jenkins;config({jenkins:{url:cfg.url}});assert.throws(()=>J.config(),e=>e.code==='DT_JENKINS_CONFIG');config();
 f.state.respond=(req,res,u)=>{
  let data;if(u.pathname.endsWith('/queue/item/7/api/json'))data={id:7,executable:{number:17}};else if(u.pathname.endsWith('/testReport/api/json'))data={};else return false;res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return true;
 };
 try{const q=await J.queue({job,queue_id:7});assert.equal(q.state,'unknown');assert.match(q.gaps[0],/affinity/);await assert.rejects(J.tests({job}),/valid totals/);}finally{delete f.state.respond;}
 f.state.respond=(req,res,u)=>{if(!u.pathname.endsWith('/queue/item/7/api/json'))return false;res.end(JSON.stringify({id:8}));return true;};try{await assert.rejects(J.queue({job,queue_id:7}),/different queue/);}finally{delete f.state.respond;}
 const evidence=require('../lib/call-evidence').classify('jenkins_build',{job,state:'failed'});assert.equal(evidence.failed,true);assert.equal(evidence.job,undefined);
});
test('PR policies fail closed on unavailable/incomplete checks and require exact review identity',async()=>{
 const saved={...f.state};f.state.sha=F.SHA;f.state.reviewed=undefined;f.state.approval='APPROVED';f.state.checks=[{key:'orders-ci',state:'SUCCESSFUL'}];
 let r=await P.snapshot({...pr,required_builds:['missing']});assert.equal(r.ready,false);assert.deepEqual(r.builds.missing,['missing']);assert.ok(r.gaps.some(g=>g.includes('reviewed SHA')));
 await assert.rejects(P.snapshot({...pr,cursor:'bad'}),/Cursor/);
 f.state.respond=(req,res,u)=>{if(u.pathname.startsWith('/rest/build-status/')){res.statusCode=503;res.end('{}');return true;}if(u.pathname.endsWith('/activities')){res.statusCode=403;res.end('{}');return true;}return false;};
 try{r=await P.wait({...pr,until:'ready',min_approvals:0,wait_ms:0});assert.equal(r.ready,false);assert.equal(r.builds.complete,false);assert.ok(r.gaps.length>=2);}finally{delete f.state.respond;}
 f.state.respond=(req,res,u)=>{if(u.pathname.startsWith('/rest/build-status/')){res.end(JSON.stringify({values:[{key:'orders-ci',state:'SUCCESSFUL'}],isLastPage:false,nextPageStart:100}));return true;}return false;};
 try{assert.equal((await P.snapshot({...pr,min_approvals:0})).ready,false);assert.equal((await P.snapshot({...pr,min_approvals:0,required_builds:['orders-ci']})).ready,true);}finally{delete f.state.respond;}
 f.state.sha=saved.sha;f.state.reviewed=saved.reviewed;f.state.approval=saved.approval;f.state.checks=saved.checks;
});
