const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {usecases,groups,workbenchBindings,areaBindings}=require('./catalog.cjs');
const {machines,configs}=require('./machines.cjs');
const {journey,createSimulation,scenarios}=require('./journeys.cjs');
const {analyzeMachines}=require('./analysis.cjs');
const inventory=require('./tool-inventory.json');
const oldLedger=require('../state-inventory.json');
const workbench=require('../../../lib/workbench-intents.json');
function catalogGaps(tools=inventory.tools,cases=usecases){
 const actual=new Set(tools.map(t=>t.name)),mapped=new Set(cases.flatMap(c=>c.tools));
 return{unmappedTools:[...actual].filter(n=>!mapped.has(n)),unknownTools:[...mapped].filter(n=>!actual.has(n))};
}
function obligations(){
 return oldLedger.areas.flatMap(a=>a.states.map(s=>({area:a.id,areaLabel:a.label,id:s.id,label:s.label,baselineEvidence:s.status,usecases:areaBindings[a.id]||[],status:'design obligation; not a production behavior pass'})));
}
function verify(){
 const gaps=catalogGaps(),models=analyzeMachines(),issues=[];
 const ids=new Set(usecases.map(c=>c.id)),groupIds=new Set(groups.map(g=>g.id));
 if(ids.size!==usecases.length)issues.push('Duplicate use-case IDs');
 for(const c of usecases){if(!groupIds.has(c.group)||!machines[c.actor]||!c.title||!c.detail||!c.output)issues.push('Incomplete use case '+c.id);}
 issues.push(...gaps.unmappedTools.map(t=>'Unmapped tool '+t),...gaps.unknownTools.map(t=>'Unknown tool '+t));
 const prior=workbench.groups.flatMap(g=>g.intents);
 for(const c of prior)if(!ids.has(workbenchBindings[c.id]))issues.push('Unmapped workbench intent '+c.id);
 for(const o of obligations())if(!o.usecases.length||o.usecases.some(id=>!ids.has(id)))issues.push('Unassigned state obligation '+o.area+'/'+o.id);
 for(const m of models){issues.push(...m.unreachable.map(id=>'Unreachable '+id),...m.uncoveredEdges.map(e=>'Uncovered transition '+e.id),...m.deadEnds.map(id=>'Dead end '+id));}
 let executions=0,events=0;
 for(const c of usecases)for(const variant of ['session','chat'].includes(c.actor)?['happy']:scenarios.map(s=>s.id)){
  const j=journey(c,variant),sim=createSimulation();
  try{for(const s of j.steps){sim.send(s);events++;}for(const [id,expected]of Object.entries(j.expected))if(!sim.actors[id].getSnapshot().matches(expected))issues.push('Wrong journey outcome '+c.id+'/'+variant+'/'+id);executions++;}
  catch(e){issues.push('Invalid journey '+c.id+'/'+variant+': '+e.message);}finally{sim.stop();}
 }
 const totals=models.reduce((a,m)=>({states:a.states+m.atomicStates,transitions:a.transitions+m.transitions,configurations:a.configurations+m.exploredConfigurations}),{states:0,transitions:0,configurations:0});
 return{protocol:'dt.user-intent-model/v1',baseline:inventory.baseline,xstate:require('xstate/package.json').version,passed:issues.length===0,scope:'Finite interaction design model. Model tests and catalog mapping do not establish production implementation or backend correctness.',counts:{usecases:usecases.length,tools:inventory.tools.length,existingWorkbenchIntents:prior.length,legacyStateObligations:obligations().length,machines:models.length,...totals,journeyExecutions:executions,journeyEvents:events},gaps,issues,models,obligations:obligations(),boundaries:[
  '316 built-ins from an isolated config. Dynamic plugins/custom collections require a new inventory and explicit intent mapping.',
  'Every declared atomic state and transition branch is exercised in each actor’s finite graph, using owner/admin and reader profiles plus bounded event payloads.',
  'Actor composition is tested with named interference/safety cases. The unbounded Cartesian product of every actor, job, file and arbitrary input is not exhaustively explored.',
  '239 prior Admin states are assigned design obligations. Assignment is not evidence that their production behavior is tested or fixed.',
  'No real model, tool, repository write, push, database, broker, container or API request is executed by the model simulator.'
 ],sourceHashes:Object.fromEntries(['machines.cjs','catalog.cjs','journeys.cjs','analysis.cjs','tool-inventory.json','model.test.cjs'].filter(f=>fs.existsSync(path.join(__dirname,f))).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,f))).digest('hex')]))};
}
if(require.main===module){const report=verify();fs.writeFileSync(path.join(__dirname,'coverage.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,counts:report.counts,issues:report.issues},null,2));if(!report.passed)process.exitCode=1;}
module.exports={verify,catalogGaps,obligations};
