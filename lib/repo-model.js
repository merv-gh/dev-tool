// Source-backed finite projections. Declarations, static CFGs and observations
// are separate evidence layers; none establishes source equivalence or liveness.
const path = require('node:path'), crypto = require('node:crypto');
const M = require('./logic-model');
const invalid = message => Object.assign(Error(message), {code:'DT_ARGUMENT_INVALID',statusCode:400});
const store = () => require('./durable-private-store').create(require('./access').scopedDirectory(path.join(require('./config').HOME,'repo-models')), 4*1048576);
function self() {
  const catalog = require('./self-model-catalog.json');
  return {repo:catalog.repo,sourceDigest:catalog.sourceDigest,fresh:catalog.sourceDigest===require('./source-version').digest(),machines:catalog.machines.map(m=>({...m,model:{version:1,title:m.id,initial:m.chart.initial,states:m.chart.states.map(id=>({id,terminal:m.chart.terminal.includes(id),source:{file:m.source.file,line:m.source.line,sha256:m.source.sha256}})),transitions:Object.entries(m.chart.transitions).flatMap(([from,targets])=>targets.map(to=>({id:'e'+crypto.createHash('sha256').update(from+'\0'+to).digest('hex').slice(0,16),from,to,label:from+' → '+to,source:{file:m.source.file,line:m.source.line,sha256:m.source.sha256}}))),assumptions:['Exact executable transition declaration at the retained source digest. Caller guards, payloads, persistence, effects, concurrency and implicit exceptions are not modeled.','Independent lifecycle charts are not a synchronized product; checks do not prove inter-machine behavior or liveness. Idempotent reassertions are omitted.']}})),gaps:[]};
}
function fromJoern(result) {
  if(!result.flowMap)throw invalid('A completed Joern flow map is required; observe the returned job first');
  const f=result.flowMap, machines=[];
  for(const method of f.methods||[]){
    const nodes=(f.nodes||[]).filter(n=>n.method===method.id), ids=new Map(nodes.map((n,i)=>[n.id,'s'+i]));
    if(!ids.has(method.entry))continue;
    // CFG edges alone describe control. Data dependence and inter-method call
    // edges remain evidence, never executable sequence transitions.
    const edges=(f.edges||[]).filter(e=>ids.has(e.from)&&ids.has(e.to)&&(e.kind==='control'||e.relation==='CFG'));
    const model={version:1,title:(method.name||method.id).slice(0,160),initial:ids.get(method.entry),states:nodes.map(n=>({id:ids.get(n.id),label:(n.code||n.kind||n.id).slice(0,160),terminal:n.id===method.exit||n.kind==='throw'&&!edges.some(e=>e.from===n.id),source:{file:n.file,line:n.line,analysisId:n.analysisId,sha:n.sha},data:{kind:n.kind,changes:n.changes||[],assumptions:n.assumptions||[],nativeId:n.id}})),transitions:edges.map((e,i)=>({id:'e'+i,from:ids.get(e.from),to:ids.get(e.to),label:String(e.polarity||e.kind||'CFG').slice(0,300),assumption:String(e.assumption||'Static CFG candidate; branch feasibility, value constraints and exceptions are not established.').slice(0,4000),source:e.evidence})),assumptions:['Nondeterministic method-local CFG abstraction. Guards and data changes are annotations, not executable TLA predicates. Unreachable, missing or non-CFG paths may produce abstraction deadlocks.',...(f.assumptions||[]).map(a=>String(a.detail||a))]};
    M.normalize(model);
    machines.push({id:'m'+crypto.createHash('sha256').update(method.id).digest('hex').slice(0,12),nativeId:method.id,label:method.name||method.id,component:method.file||method.repo||'Retained methods',origin:'joern-cfg',source:{file:method.file,line:method.line,sha:method.sha,analysisId:method.analysisId},consumers:[],model});
  }
  if(!machines.length)throw invalid('Joern returned no method entries; choose an exact entry method or increase the explicit query budget');
  return {repo:result.analyses?.[0]?.repo||'Joern repository',analyses:result.analyses||[],machines,gaps:[...(result.gaps||[]),{kind:'runtime-correlation-unavailable',detail:'Joern method CFGs are not automatically correlated with dt.machine spans or external service telemetry. This repository projection is static-only.'}],flowMap:f,staticOnly:true};
}
function get(id){const r=store().read(id);if(!r)throw Object.assign(Error('Repository model not found in this chat'),{code:'DT_NOT_FOUND',statusCode:404});return r;}
function retain(value){const id='r'+crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32), record={...value,id,at:new Date().toISOString(),protocol:'dt.repo-model/v1'};const s=store();if(!s.read(id)){let count=0;try{count=require('node:fs').readdirSync(s.safe()).filter(f=>f.endsWith('.json')).length;}catch(e){if(e.code!=='ENOENT')throw e;}if(count>=200)throw invalid('Repository model snapshot limit reached for this chat; use an existing projection id');}s.write(id,record);return record;}
function overlay(project,snapshot){
  const machines=new Map(project.machines.map(m=>[m.id,m])),hits={},events=[],unmatched=[];
  for(const span of snapshot.spans||[])for(const event of span.events||[]){
    if(!['state.transition','state.rejected'].includes(event.name))continue;
    const a=event.attributes||{},machine=machines.get(a['dt.machine']);
    if(!machine)continue;
    const edge=machine.model.transitions.find(e=>e.from===a['dt.from']&&e.to===a['dt.to']);
    const version=span.attributes?.['dt.source.digest'],matched=!!project.sourceDigest&&version===project.sourceDigest;
    const row={machine:machine.id,from:a['dt.from'],to:a['dt.to'],accepted:a['dt.accepted']===true,traceId:span.traceId,spanId:span.spanId,name:span.name,durationMs:span.durationMs,startMs:span.startMs,sourceMatched:matched,edge:edge?.id||null};
    events.push(row);
    if(row.accepted&&edge&&matched)(hits[machine.id]||={})[edge.id]=((hits[machine.id]||{})[edge.id]||0)+1;
    else unmatched.push(row);
  }
  return {enabled:snapshot.enabled,sampled:snapshot.sampled,sampleRatio:snapshot.sampleRatio,at:new Date().toISOString(),hits,events,unmatched:unmatched.length,spans:(snapshot.spans||[]).length,meaning:'Sampled, chat-scoped observations. Only accepted declared edges from the same source digest count as hits. Unversioned/stale/rejected events remain visible. A span duration belongs to the whole operation, not an individual transition.'};
}
async function run(a={}){
  if(a.action&&!['derive','get','observe','check','export'].includes(a.action))throw invalid('Unknown repository model action');
  if(a.action==='derive'||!a.action){
    let value;
    if(a.analysis||a.job){
      const r=await require('./semantic-code').query({analysis:a.analysis,job:a.job,operation:'flowmap',from:a.from,maxMethods:20,maxStates:180,waitMs:a.waitMs||0});
      if(!r.flowMap)return {...r,next:r.job?{tool:'repo_model',arguments:{action:'derive',job:r.job,waitMs:1000}}:{tool:'semantic_index',arguments:{}},note:'No model was fabricated while Joern is pending or unavailable.'};
      value=fromJoern(r);
    }else value=self();
    const project=retain(value);return report(project,a);
  }
  const project=a.id?get(a.id):['check','export'].includes(a.action)?retain(self()):(()=>{throw invalid('id is required; derive a repository model first');})();
  if(a.action==='observe'||a.action==='get')return report(project,a);
  const machine=project.machines.find(m=>m.id===a.machine);if(!machine)throw invalid('Select an exact machine id from repo_model derive/get');
  if(a.action==='export')return {id:project.id,machine:machine.id,...M.exportTla(machine.model)};
  const model=structuredClone(machine.model);if(a.forbidden?.length){if(a.forbidden.some(s=>!model.states.some(n=>n.id===s)))throw invalid('Forbidden states must exist in the selected machine');model.forbidden=a.forbidden;}
  const check=a.engine==='tlc'?await require('./logic-tlc').run(model,{mode:a.mode||'check',timeoutMs:30000}):M.explore(model,{mode:a.mode||'check'});
  const hierarchy=!a.id?await report(project,{format:'compact'}):null;
  return {id:project.id,...(hierarchy?{hierarchy:hierarchy.view,observations:hierarchy.telemetry,sourceDigest:project.sourceDigest}:{}),machine:machine.id,status:check.status,complete:check.complete,meaning:'Check applies only to the finite selected declaration/CFG abstraction. Static guards and data changes are annotations.',violations:check.violations,view:require('./results').saveView('logic-model',check,{title:machine.label}),...(a.format==='full'?{check}:{})};
}
async function report(project,a){
  if(project.sourceDigest)project={...project,fresh:project.sourceDigest===require('./source-version').digest()};
  const telemetry=overlay(project,await require('./telemetry').snapshot({traceId:a.trace,limit:1000}));
  const result={...project,telemetry,admin:'/self-reflection?'+new URLSearchParams({id:project.id,story:require('./access').current().storyId}),counts:{machines:project.machines.length,states:project.machines.reduce((n,m)=>n+m.model.states.length,0),transitions:project.machines.reduce((n,m)=>n+m.model.transitions.length,0),observations:telemetry.events.length},next:[{tool:'repo_model',arguments:{action:'check',id:project.id,machine:project.machines.find(m=>m.id==='SM37.push')?.id||project.machines[0]?.id}},{tool:'repo_model',arguments:{action:'export',id:project.id,machine:project.machines.find(m=>m.id==='SM37.push')?.id||project.machines[0]?.id}},{tool:'repo_model',arguments:{action:'observe',id:project.id}}]};
  if(a.view!==false)result.view=require('./results').saveView('repo-model',result,{title:'Repository reflection · '+project.repo});
  if(a.format==='full')return result;
  return {protocol:result.protocol,id:result.id,repo:result.repo,sourceDigest:project.sourceDigest,fresh:project.fresh,counts:result.counts,verification:{status:'not-checked',next:'Derivation does not run a check. If asked to check, execute the returned next check call.'},hierarchy:{meaning:'Containment only. No call/dependency relationships are inferred between components or machines.',components:new Set(project.machines.map(m=>m.component)).size},machines:[...project.machines].sort((x,y)=>Number(y.id==='SM37.push')-Number(x.id==='SM37.push')).slice(0,project.sourceDigest?1:4).map(m=>({id:m.id,label:m.label,component:m.component,origin:m.origin})),omittedMachines:Math.max(0,project.machines.length-(project.sourceDigest?1:4)),gaps:project.gaps.slice(0,4),telemetry:{enabled:telemetry.enabled,observations:telemetry.events.length,unmatched:telemetry.unmatched,meaning:telemetry.meaning},meaning:'Derived source hierarchy only. Return the retained view link; do not invent dependency edges from the preview. Execute next check/export calls when requested. Checks apply only to the finite selected abstraction.',admin:result.admin,view:result.view,next:result.next};
}
module.exports={self,fromJoern,overlay,run,get};
