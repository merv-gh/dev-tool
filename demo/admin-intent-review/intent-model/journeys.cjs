const {createActor}=require('xstate');
const {machines,eventLabels}=require('./machines.cjs');
const localLabels={session:{READY:'Initialize task scope',OPEN:'Open retained task',LOADED:'Restore task state',NEW:'Create task',VALID:'Validate task details',SAVED:'Confirm durable task',CHANGE_SCOPE:'Request another scope',SAFE:'Resolve unsaved work'},chat:{EDIT:'Write a message',SEND:'Send message',ACCEPTED:'Accept persisted message',TOOL:'Prepare a tool action',TOOL_DONE:'Return tool receipt',TOOL_FAILED:'Explain failed action',DONE:'Retain the answer',CANCELLED:'Confirm stopped turn'},flow:{SELECT:'Choose entry and revision',FOUND:'Read cached source',RESOLVED:'Pin exact source',EXPAND:'Expand one path',LOADED:'Load nested children',SELECT_NODE:'Inspect source and fields',READY:'Compare pinned paths'}};
const step=(actor,type,data={})=>({actor,event:{type,...data},label:localLabels[actor]?.[type]||eventLabels[type]||type.slice(0,1)+type.slice(1).toLowerCase().replaceAll('_',' ')});
const steps=(actor,names)=>names.split(' ').filter(Boolean).map(type=>step(actor,type));
const task=()=>steps('session','READY OPEN LOADED');
const chatStart=()=>[step('chat','EDIT',{text:'Investigate this task using retained evidence.'}),...steps('chat','SEND ACCEPTED TOOL')];
const admission=(c)=>[...steps('action','PREPARE RESOLVED'),step('action','AUTHORIZE',{allowed:true,effect:!['read','inspect','compare','library','assumptions','telemetry','reconnect'].includes(c.mode)}),...steps('action','VALID'),step('action','RUN',{explicit:true}),step('action','STARTED')];
const fileOpen=()=>steps('file','OPEN LOADED');
const flowOpen=()=>steps('flow','SELECT FOUND RESOLVED');
const jobStart=()=>[...steps('job','PLAN VALID'),step('job','START',{explicit:true}),...steps('job','SAVED STARTED')];
function domain(c){
 const {actor:a,mode:m}=c;
 switch(a){
 case 'file': {
   if(m==='new')return{steps:[...steps(a,'NEW VALID'),step(a,'EDIT',{text:'A new task note'}),...steps(a,'SAVE SAVED')],end:'open.clean'};
   if(m==='archive')return{steps:[...fileOpen(),...steps(a,'ARCHIVE CONFIRM DONE')],end:'archived'};
   if(m==='delete')return{steps:[...fileOpen(),...steps(a,'DELETE CONFIRM DONE')],end:'deleted'};
   const s=fileOpen();
   if(['edit','conflict','navigation'].includes(m)){
     s.push(step(a,'EDIT',{text:'Retained user draft'}));
     if(m==='navigation')s.push(...steps(a,'RESELECT SELECT_OTHER KEEP'));
     s.push(step(a,'SAVE'));
     if(m==='conflict')s.push(...steps(a,'CONFLICT REVIEW_REMOTE REBASE SAVE'));
     s.push(step(a,'SAVED'));
   }
   return{steps:s,end:'open.clean'};
 }
 case 'workspace': {
   if(m==='folder')return{steps:steps(a,'CREATE_FOLDER READY EDIT'),end:'ready.folderDirty'};
   const s=steps(a,'OPEN LOADED');
   if(m==='push')s.push(...steps(a,'EDIT COMMIT VALID DONE'),step(a,'PUSH',{taskBranch:true}),...steps(a,'DONE DRAFT_PR DONE'));
   else if(m==='terminal')s.push(...steps(a,'OPEN_TERMINAL DETACH'));
   else if(m==='branch')s.push(...steps(a,'BRANCH DONE'));
   else if(m==='patch')s.push(...steps(a,'PATCH APPLY DONE'));
   else if(m==='edit')s.push(step(a,'EDIT'));
   return{steps:s,end:m==='push'?'ready.review':['terminal','patch','edit'].includes(m)?'ready.dirty':'ready.clean'};
 }
 case 'flow': {
   const s=m==='library'?steps(a,'SELECT FOUND MISSING_LIBRARY MISSING_VERSION FOUND RESOLVED'):flowOpen();
   if(m==='compare')return{steps:[...s,...steps(a,'COMPARE VALID READY')],end:'comparing.diff'};
   s.push(...steps(a,'EXPAND LOADED'));
   if(m==='assumptions')return{steps:[...s,...steps(a,'ASSUMPTIONS ACCEPT_AS_ASSUMPTION')],end:'exploring.expanded'};
   s.push(step(a,'SELECT_NODE'));
   if(m==='correct')return{steps:[...s,...steps(a,'CORRECT SAVE')],end:'exploring.correctionSaved'};
   return{steps:s,end:'exploring.sourceDetail'};
 }
 case 'verification': {
   const s=steps(a,'PLAN');
   if(m==='read')return{steps:s,end:'preparing.profile'};
   s.push(...steps(a,'LOCAL READY'));
   if(m==='fallback')s.push(step(a,'UNSUPPORTED'));
   s.push(...steps(a,'READY PASSED'));
   if(m==='coverage')s.push(...steps(a,'COVERAGE COMPLETE'));
   else s.push(step(a,'VERIFY'));
   s.push(step(a,'ASSERT',{runtime:true,independentExpectation:true}));
   return{steps:s,end:'proven'};
 }
 case 'memory': {
   const s=steps(a,'FOUND');
   if(m==='publish')return{steps:[...s,...steps(a,'PUBLISH PUBLISH SAVED')],end:'published'};
   if(m==='gather')return{steps:[...s,...steps(a,'RESTORE STALE REFRESH PARTIAL REVIEW SAVE SAVED')],end:'reading'};
   if(m==='edit')s.push(...steps(a,'EDIT SAVE SAVED'));
   return{steps:s,end:'reading'};
 }
 case 'job': {
   const s=jobStart();
   if(m==='wait')s.push(...steps(a,'WAIT EVENT'));
   if(m==='budget')s.push(step(a,'BUDGET'),step(a,'EXTEND',{explicit:true}),...steps(a,'RESUME'));
   if(m==='unknown')s.push(...steps(a,'DISCONNECTED UNKNOWN RECONCILE RUNNING'));
   if(m==='cancel')return{steps:[...s,...steps(a,'CANCEL ACK DONE')],end:'cancelled'};
   s.push(step(a,'SUCCEEDED'));
   if(m==='inspect')return{steps:[...s,step(a,'INSPECT')],end:'finished.inspecting'};
   return{steps:s,end:'finished.success'};
 }
 case 'operations': {
   if(m==='telemetry')return{steps:steps(a,'TELEMETRY FILTER SELECT EXPORT'),end:'telemetry.exported'};
   if(m==='config')return{steps:steps(a,'CONFIGURE VALID ACTIVATE DONE'),end:'overview'};
   if(['edit','refresh'].includes(m))return{steps:steps(a,'REFRESH START STARTED BUILT VALID DONE'),end:'refreshed'};
   return{steps:steps(a,'INSPECT'),end:'inspecting'};
 }
 case 'share': {
   const s=steps(a,'SELECT VALID SAVE SAVED');
   if(m==='review')return{steps:[...s,step(a,'OPEN')],end:'reviewOnly'};
   if(m==='replay')return{steps:[...s,...steps(a,'OPEN PREPARE_REPLAY VALID'),step(a,'RUN',{explicit:true}),step(a,'DONE')],end:'replayResult'};
   return{steps:s,end:'saved'};
 }
 case 'connection':return{steps:steps(a,'CONNECTED DISCONNECTED RECONNECTED GAP READY'),end:'online'};
 case 'action':return{steps:[],end:'result.success'};
 default:throw Error('No recipe for actor '+a);
 }
}
const scenarios=[['happy','Expected path'],['failure','Tool failure'],['partial','Partial evidence'],['empty','No matches'],['denied','Access denied'],['cancel','Cancel and cleanup'],['unknown','Unknown acknowledgement']].map(([id,label])=>({id,label}));
function journey(c,scenario='happy'){
 if(!scenarios.some(s=>s.id===scenario))throw Error('Unknown scenario');
 if(c.actor==='session'){
   const s=steps('session',c.id==='new-task'?'READY NEW VALID SAVED':'READY OPEN LOADED');
   if(c.mode==='scope')s.push(...steps('session','CHANGE_SCOPE SAFE LOADED'));
   return{steps:s,expected:{session:'active.conversation'},scenario:'happy'};
 }
 if(c.actor==='chat'){
   let s=task();
   if(c.mode==='compact')s.push(step('chat','COMPACT'),step('chat','CONFIRM',{explicit:true}),step('chat','DONE'));
   else{
     s.push(step('chat','EDIT',{text:'A message that must survive errors'}),...steps('chat','SEND ACCEPTED'));
     if(c.mode==='steer')s.push(step('chat','STEER',{text:'Inspect raw data before changing code.'}));
     if(c.mode==='cancel')s.push(...steps('chat','CANCEL CANCELLED'));
     else s.push(step('chat','DONE'));
   }
   return{steps:s,expected:{chat:c.mode==='cancel'?'cancelled':c.mode==='compact'?'ready':'complete'},scenario:'happy'};
 }
 const prefix=[...task(),...chatStart()];
 if(scenario==='denied')return{steps:[...prefix,...steps('action','PREPARE RESOLVED'),step('action','AUTHORIZE',{allowed:false}),...steps('chat','TOOL_FAILED DONE')],expected:{action:'preflight.denied',chat:'complete'},scenario};
 const s=[...prefix,...admission(c)];
 if(scenario==='failure')return{steps:[...s,step('action','FAILED'),...steps('chat','TOOL_FAILED DONE')],expected:{action:'failed',chat:'complete'},scenario};
 if(scenario==='cancel')return{steps:[...s,...steps('action','CANCEL ACK DONE'),...steps('chat','CANCEL CANCELLED')],expected:{action:'cancelled',chat:'cancelled'},scenario};
 if(scenario==='unknown')return{steps:[...s,...steps('action','ACK_UNKNOWN STILL_UNKNOWN RECONCILE FOUND_DONE'),...steps('chat','TOOL_DONE DONE')],expected:{action:'result.success',chat:'complete'},scenario};
 if(scenario==='partial'||scenario==='empty')return{steps:[...s,step('action',scenario==='partial'?'PARTIAL':'EMPTY'),...steps('chat','TOOL_DONE DONE')],expected:{action:'result.'+scenario,chat:'complete'},scenario};
 const d=domain(c);s.push(...d.steps,step('action','SUCCEEDED'),...steps('chat','TOOL_DONE DONE'));
 return{steps:s,expected:{[c.actor]:d.end,action:'result.success',chat:'complete'},scenario};
}
function createSimulation(input={}){
 const actors=Object.fromEntries(Object.entries(machines).map(([id,m])=>[id,createActor(m,{input}).start()]));
 const records=[];
 return{
  actors,records,
  send(s){const a=actors[s.actor];if(!a)throw Error('Unknown actor '+s.actor);const before=a.getSnapshot();if(!machines[s.actor].getTransitionData(before,s.event).length)throw Error(s.actor+': '+s.event.type+' is unavailable from '+JSON.stringify(before.value));a.send(s.event);const after=a.getSnapshot();const r={...s,before:before.value,after:after.value};records.push(r);return r;},
  stop(){for(const a of Object.values(actors))a.stop();}
 };
}
module.exports={journey,createSimulation,scenarios,domain};
