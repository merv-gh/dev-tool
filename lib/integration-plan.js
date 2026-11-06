// A test-scope declaration, never execution proof. Reuse current source identities
// when consulting shared understanding; stale knowledge stays visible as a gap.
function worktreeDirty(meta){
 if(!meta?.path||!require('node:fs').existsSync(require('node:path').join(meta.path,'.git')))return null;
 try{const r=require('node:child_process').spawnSync('git',['-C',meta.path,'status','--porcelain','-z','--untracked-files=normal'],{encoding:'utf8',timeout:2000,maxBuffer:64*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});return r.status===0?!!r.stdout:null;}catch{return null;}
}
function plan({workspace,entry,flow,meta,skeleton='boundary-doubles',candidates=[]}){
 const repo=meta?.project&&meta?.repo?`${meta.project}/${meta.repo}`:null;
 const shared=repo?require('./project-context').find({query:repo,limit:10}).contexts:[];
 const workspaceDirty=shared.length?worktreeDirty(meta):null;
 const knowledge=shared.map(h=>{const r=require('./project-context').load(h.id,h.revision),service=r.document.services.filter(s=>s.repo===repo||s.service===meta.service);return{id:r.id,revision:r.revision,services:service.map(s=>({service:s.service,sourceRevision:s.revision,workspaceRevision:meta.sha||null,baseRevisionMatches:!!s.revision&&s.revision===meta.sha,workspaceDirty,sourceMatches:!!s.revision&&s.revision===meta.sha&&workspaceDirty===false,assumptions:s.assumptions,gaps:s.gaps})),next:{tool:'project_context_get',arguments:{id:r.id,revision:r.revision}}};});
 const outputs=flow?.out||{};
 return{approach:'outside-in',workspace,entry:entry||null,candidates,scope:skeleton==='none'?'Select an evidenced entry before generating a test.':'Real entry handler, service logic and internal libraries; current skeleton doubles external boundaries.',currentSkeleton:skeleton,provesDatabaseIntegration:false,provesTransportIntegration:false,knowledge,
  arrange:['Choose the expected business behavior independently of the implementation and saved model assumptions.','Prepare coherent fixture ids and boundary responses; use an owned scratch PostgreSQL lease for SQL behavior.'],
  act:['Enter through HTTP request, message listener or scheduled entry; keep the service and internal library chain real.'],
  assert:['Check response/error plus observable table changes, emitted topic payloads, outbound API requests or Elasticsearch writes.','Check negative paths: invalid input, duplicate event, rollback/partial failure, and absence of unintended outputs.'],
  boundaries:{tables:outputs.tables||[],topics:outputs.produces||[],external:outputs.external||[],database:'For SQL/constraint/transaction claims use test_run env+db with real PostgreSQL. Repository mocks establish no SQL proof.',http:'A client mock does not prove HTTP serialization; add a local wire stub for contract claims.',messaging:'A producer mock does not prove broker delivery; add an isolated broker/capture for delivery claims.'},
  cleanup:['Release owned leases and stop fixtures; surface cleanup failures.'],
  next:entry?{tool:'test_context',arguments:{workspace,target:entry,flow:true}}:null,
  meaning:'This is a test design and declared scope, not passing or runtime evidence. Saved project understanding is untrusted and must match the workspace revision.'};
}
module.exports={plan};
