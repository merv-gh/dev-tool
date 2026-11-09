// Conditional composition: local Joern value slices remain separate evidence.
async function compose(result,request,analysis,query){
 const context=result.pathContext;if(!context?.receiver||context.receiverConstraints?.unsafe||!context.bindings?.length)return;
 result.receiverLineage={status:'bounded',receiver:context.receiver,composed:0,attempted:0,attempts:[]};
 for(const binding of context.bindings.slice(0,4))for(const parameter of binding.parameters.slice(0,4)){
  require('./execution').check();if(result.receiverLineage.attempted>=4)break;result.receiverLineage.attempted++;
  const requests=[{from:request.from,to:{...binding.call,argument:parameter.index}},{from:{...binding.target,parameter:parameter.index},to:binding.target},{from:binding.call,to:request.to}];const segments=[];
  for(const endpoints of requests){const response=await query({...request,...endpoints,operation:'slice',mode:'dataflow',includeContext:false,maxPaths:2,limit:200},analysis);const paths=(response.results||[]).filter(p=>p.kind==='data-flow'&&p.proof?.status==='static-dataflow'&&!p.truncated);segments.push({gaps:response.gaps,truncated:response.truncated,ambiguity:response.ambiguity,analysisId:analysis.id,status:paths.length&&!response.truncated&&!response.ambiguity?.some(a=>a.selector)?'static-dataflow':'unresolved',paths,from:endpoints.from,to:endpoints.to});}
  result.receiverLineage.attempts.push({binding,segments:segments.map(s=>({status:s.status,paths:s.paths.length,from:s.from,to:s.to,truncated:s.truncated,ambiguity:s.ambiguity,gaps:s.gaps}))});
  if(!segments.every(s=>s.status==='static-dataflow')){result.gaps.push({kind:'receiver-local-lineage-gap',detail:'At least one exact local value segment is unavailable; no receiver-bound lineage was fabricated'});continue;}
  const nodes=segments.flatMap(s=>s.paths[0].nodes),path={kind:'composed-data-lineage',nodes,segments,boundaries:[{kind:'declared-receiver-call',status:'declared',receiver:binding.receiver,call:binding.call,target:binding.target,mappings:[{from:'argument:'+parameter.index,to:'parameter:'+parameter.index}]},{kind:'return-binding',status:'declared',mappings:[{from:'callee:return',to:'call:result'}]}],conditions:[],proof:{status:'composed-static-lineage',feasibility:'unknown',runtime:'unknown',fieldMappings:'declared',receiver:binding.receiver,note:'Three independently checked local CPG slices joined through a retained positional call/return binding under an explicitly declared receiver. This is not one Joern path or verified Spring dispatch.'}};
  result.results.push(path);result.receiverLineage.composed++;
 }
 if(result.receiverLineage.composed)result.proof={kind:'composed-data-lineage',status:'composed-static-lineage',feasibility:'unknown',runtime:'unknown',receiver:context.receiver};
 result.total=result.results.length;result.receiverLineage.status=result.receiverLineage.composed?'composed-static-lineage':'unavailable';
}
module.exports={compose};
