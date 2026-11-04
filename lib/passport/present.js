// The cached and asynchronous passport paths share one bounded tool response.
module.exports=function present(p,cached=false){
  const R=require('../results');
  return {service:p.service,cached,builtAt:p.builtAt,repo:p.repo,deployed:p.deployed,app:p.app,summary:p.summary,changes:p.changes,graph:p.graph,
    libraries:(p.libraries||[]).map(({artifactId,version,repo,ref,sha,exactVersion,resolution,note,error})=>({artifactId,version,repo,ref,sha,exactVersion,resolution,note,error})),
    flows:Array.isArray(p.flows)?p.flows.map(f=>({entry:f.entry,via:(f.via||[]).map(v=>v.split(' ')[0]).join(' -> '),out:Object.fromEntries(Object.entries(f.out||{}).map(([k,v])=>[k,v.map(x=>x.type?`${x.kind} ${x.type}.${x.call}`:x.topic||x.call||x.table&&`${x.table} ${x.access}`||x.function||x.index)])),mocks:(f.mocks||[]).map(m=>m.split(':')[0])})):p.flows,
    view:`${R.publicUrl()}/passport/${encodeURIComponent(p.service)}?t=${R.sign(`passport:${p.service}`)}`};
};
