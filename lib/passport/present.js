// The cached and asynchronous passport paths share one bounded tool response.
module.exports=function present(p,cached=false){
  const R=require('../results');
  // A sandboxed chat iframe has an opaque origin and cannot send authenticated
  // story headers. Retain the effective, owned passport as a read-only snapshot.
  const snapshot=R.saveView('json',require('../redact').clean({...p,bitbucketUrl:require('../config').getPersonal().bitbucket.url}),{title:p.service+' passport snapshot',env:p.env}).split('/').pop();
  return {service:p.service,cached,builtAt:p.builtAt,repo:p.repo,deployed:p.deployed,app:p.app,summary:p.summary,changes:p.changes,graph:p.graph,
    libraries:(p.libraries||[]).map(({artifactId,version,repo,ref,sha,exactVersion,resolution,note,error})=>({artifactId,version,repo,ref,sha,exactVersion,resolution,note,error})),
    flows:Array.isArray(p.flows)?p.flows.map(f=>({entry:f.entry,via:(f.via||[]).map(v=>v.split(' ')[0]).join(' -> '),out:Object.fromEntries(Object.entries(f.out||{}).map(([k,v])=>[k,v.map(x=>x.type?`${x.kind} ${x.type}.${x.call}`:x.topic||x.call||x.table&&`${x.table} ${x.access}`||x.function||x.index)])),mocks:(f.mocks||[]).map(m=>m.split(':')[0])})):p.flows,
    view:`${R.publicUrl()}/passport/${encodeURIComponent(p.service)}?t=${R.sign(`passport:${p.service}`)}&snapshot=${snapshot}&story=${encodeURIComponent(require('../access').owner().storyId)}`};
};
