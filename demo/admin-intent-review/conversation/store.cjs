const {createActor}=require('../intent-model/node_modules/xstate');
const {machines}=require('../intent-model/machines.cjs');
const {usecases}=require('../intent-model/catalog.cjs');
const {journey}=require('../intent-model/journeys.cjs');
const KEY='dt.conversation.proposal.v1';
const source=`public PersonName choose(List<Document> documents, LocalDate asOf) {
  return documents.stream()
    .filter(Document::active)
    .filter(d -> !d.effectiveDate().isAfter(asOf))
    .filter(d -> d.expires() == null || !d.expires().isBefore(asOf))
    .max(comparing(Document::effectiveDate).thenComparing(Document::id))
    .map(Document::wholeName)
    .orElse(registryName);
}`;
const rule='Newest valid, active, non-annulled document supplies the complete ФИО. Fall back to registry ФИО.';
const seeds=[{id:'PERS-218',title:'Why does an annulled name still appear?',env:'dev',service:'person-service',branch:'codex/PERS-218',goal:'GET /person/42 returns an annulled document’s name. Find the mapping error and prepare an independently checked fix.'},{id:'SHOP-142',title:'Gather refund requirements overnight',env:'uat',service:'checkout-service',branch:'codex/SHOP-142',goal:'Collect requirements, entry-to-exit paths and unresolved gaps. Save the findings; do not change source.'}];
function createStore(storage){
 let saved;try{saved=JSON.parse(storage?.getItem(KEY)||'null');}catch{}
 let data=saved?.version===1?saved:{version:1,current:'PERS-218',serial:0,tasks:{}};
 const live=new Map();
 function actor(taskId,name,input={}){const key=taskId+':'+name;if(live.has(key))return live.get(key);const t=data.tasks[taskId];const kind=name.startsWith('file:')?'file':name;const a=createActor(machines[kind],{input,snapshot:t.snapshots[name]}).start();live.set(key,a);return a;}
 function send(taskId,name,type,extra={}){const a=actor(taskId,name),e={type,...extra};if(!machines[name.startsWith('file:')?'file':name].getTransitionData(a.getSnapshot(),e).length)throw Error(name+': unavailable '+type+' from '+JSON.stringify(a.getSnapshot().value));a.send(e);return a.getSnapshot();}
 function state(taskId,name){const s=actor(taskId,name).getSnapshot();function flatten(v){return typeof v==='string'?v:Object.entries(v).map(([k,x])=>k+'.'+flatten(x)).join(',');}return flatten(s.value);}
 function persist(){for(const [key,a]of live){const i=key.indexOf(':'),id=key.slice(0,i),name=key.slice(i+1);data.tasks[id].snapshots[name]=a.getPersistedSnapshot();}try{if(!storage||typeof storage.setItem!=='function')return false;storage.setItem(KEY,JSON.stringify(data));return true;}catch{return false;}}
 function init(spec){if(data.tasks[spec.id])return data.tasks[spec.id];const person=spec.id==='PERS-218';const t=data.tasks[spec.id]={...spec,snapshots:{},messages:[{role:'user',text:spec.goal},{role:'assistant',text:person?'The retained response contains “Анна Смирнова”. The expected rule excludes annulled documents. I have not yet proved where the discrepancy enters the response.':spec.id==='SHOP-142'?'Saved checkpoint: 18 sources collected and cited. The refund-policy page is unavailable. The earlier results and next step are retained.':'This task has its own conversation and retained files. Choose a service or describe the next step.',block:person?'response':spec.id==='SHOP-142'?'overnight':null}],draft:'',files:{'notes/plan.md':{saved:'# '+spec.id+'\n\n'+spec.goal+'\n\nRule: '+rule+'\n\nNext: compare raw candidates, inspect selection, run an outside-in regression.',revision:1},'queries/person-candidates.sql':{saved:'SELECT d.id, d.fio, d.effective_date, s.active, s.annulled\nFROM registry.person_document d\nJOIN registry.document_state s ON s.document_id = d.id\nWHERE d.person_id = 42\nORDER BY d.effective_date DESC;',revision:1},'scripts/reproduce.json':{saved:JSON.stringify({method:'GET',path:'/person/42',assertion:rule},null,2),revision:1},'src/DocumentPolicy.java':{saved:source,revision:1}},selectedFile:null,pane:null,prepared:null,active:null,observedRows:false,flowShown:false,check:null,scopeRevision:1};
 for(const type of ['READY','OPEN','LOADED'])send(t.id,'session',type);send(t.id,'workspace','OPEN');send(t.id,'workspace','LOADED');send(t.id,'connection','CONNECTED');
 if(!person&&spec.id==='SHOP-142'){for(const type of ['PLAN','VALID'])send(t.id,'job',type);send(t.id,'job','START',{explicit:true});for(const type of ['SAVED','STARTED','QUESTION'])send(t.id,'job',type);t.jobInfo={title:'Collect refund requirements',checkpoint:'18 sources retained · checkpoint 7',detail:'Confluence page REFUND-17 is unavailable. Skip it with an explicit gap, or supply another source.',run:'demo-refund-7'};}
 return t;
 }
 seeds.forEach(init);if(!data.tasks[data.current])data.current='PERS-218';
 function current(){return data.tasks[data.current];}
 function addMessage(role,text,extra={}){const t=current();t.messages.push({role,text,...extra});persist();}
 function openFile(path){const t=current(),f=t.files[path];if(!f)throw Error('Unknown fixture file');const name='file:'+path;if(!t.snapshots[name]&&!live.has(t.id+':'+name)){actor(t.id,name,{draft:f.saved,saved:f.saved});send(t.id,name,'OPEN');send(t.id,name,'LOADED');}t.selectedFile=path;t.pane='files';persist();}
 function editFile(text){const t=current();send(t.id,'file:'+t.selectedFile,'EDIT',{text});persist();}
 function fileSnapshot(){const t=current();return t.selectedFile?actor(t.id,'file:'+t.selectedFile).getSnapshot():null;}
 function saveFile(conflict=false){const t=current(),name='file:'+t.selectedFile,s=state(t.id,name);if(s==='open.saveFailed')send(t.id,name,'RETRY');else send(t.id,name,'SAVE');send(t.id,name,conflict?'CONFLICT':'SAVED');if(!conflict){const f=t.files[t.selectedFile];f.saved=fileSnapshot().context.saved;f.revision++;if(t.selectedFile.startsWith('src/')&&state(t.id,'workspace')==='ready.clean')send(t.id,'workspace','EDIT');t.check=null;}persist();}
 function fixDraft(){const t=current();openFile('src/DocumentPolicy.java');const text=fileSnapshot().context.draft;if(!text.includes('!d.annulled()'))editFile(text.replace('.filter(Document::active)','.filter(Document::active)\n    .filter(d -> !d.annulled())'));persist();}
 function prepare(id){const c=usecases.find(x=>x.id===id);if(!c)throw Error('Unknown intent');const t=current();t.prepared={id,service:t.service,env:t.env,params:'{}',outcome:'success'};persist();return c;}
 function startAction(kind,id){const t=current();if(t.active)throw Error('One action already active in this task');const a=createActor(machines.action).start();live.set(t.id+':action',a);for(const type of ['PREPARE','RESOLVED'])send(t.id,'action',type);send(t.id,'action','AUTHORIZE',{allowed:true,effect:true});send(t.id,'action','VALID');send(t.id,'action','RUN',{explicit:true});t.active={kind,id,phase:'queued',target:t.prepared?{...t.prepared}:{env:t.env,service:t.service},outcome:t.prepared?.outcome||'success',sourceSnapshot:{text:t.files['src/DocumentPolicy.java'].saved,revision:t.files['src/DocumentPolicy.java'].revision},started:Date.now()};persist();}
 function actionStarted(){const t=current();if(t.active?.phase!=='queued')return;send(t.id,'action','STARTED');t.active.phase='running';persist();}
 function finishAction(){const t=current(),a=t.active;if(!a)return;if(a.phase==='queued')actionStarted();if(a.outcome==='unknown'){send(t.id,'action','ACK_UNKNOWN');t.active.phase='unknown';persist();return;}
 const type=a.outcome==='failure'?'FAILED':a.outcome==='partial'?'PARTIAL':'SUCCEEDED';send(t.id,'action',type);
 if(a.kind==='test'){
 const f=require('./fixture.cjs'),evaluated=f.replay({version:1,scope:'Offline fixture only. Not a production execution recipe.',source:a.sourceSnapshot.text,fixture:f.fixture});const fixed=evaluated.status==='passed';if(evaluated.status==='inconclusive')a.outcome='partial';t.check={fixed,outcome:a.outcome,revision:a.sourceSnapshot.revision,sourceSnapshot:{...a.sourceSnapshot}};addMessage('assistant',a.outcome==='failure'?'The runner could not connect to the leased database. No assertion ran.':a.outcome==='partial'?'One source is missing. The check is inconclusive.':fixed?'The offline fixture now selects document 103 and returns its complete name. This is a simulated regression, not a real integration run.':'The offline fixture fails: document 104 is annulled but still wins. Inspect the selection policy before changing the mapper.',{block:'check',check:{...t.check}});
 }else if(a.kind==='generic'){const c=usecases.find(x=>x.id===a.id);addMessage('assistant',a.outcome==='failure'?'The simulated action failed. Inputs and scope are retained for retry.':a.outcome==='partial'?'Partial simulated evidence. An unavailable source stays an explicit gap.':'Completed the intent-model journey. This receipt demonstrates the interaction; no backend output was produced.',{block:'generic',caseId:c.id,outcome:a.outcome,target:a.target});}
 t.active=null;t.prepared=null;persist();
 }
 function cancelAction(){const t=current();send(t.id,'action','CANCEL');t.active.phase='cancelling';persist();}
 function ackCancel(){const t=current();send(t.id,'action','ACK');t.active.phase='cleanup';persist();}
 function cleaned(){const t=current();send(t.id,'action','DONE');t.active=null;addMessage('assistant','Stopped. Cancellation and cleanup are confirmed in this simulation; prior evidence and drafts are retained.');persist();}
 function reconcile(){const t=current();send(t.id,'action','FOUND_DONE');const c=t.active;addMessage('assistant','The existing execution was found complete. Attached its retained receipt; no second request was sent.',{block:'generic',caseId:c.id||'test-run',outcome:'reconciled',target:c.target});t.active=null;t.prepared=null;persist();}
 function runModelCase(id){const c=usecases.find(x=>x.id===id);const sim=require('../intent-model/journeys.cjs').createSimulation();try{const j=journey(c);for(const s of j.steps)sim.send(s);return{steps:j.steps.length,actor:c.actor,end:j.expected[c.actor]};}finally{sim.stop();}}
 function switchTask(id){if(!data.tasks[id])throw Error('Unknown task');data.current=id;persist();}
 function createTask(goal,env){const id='TASK-'+(++data.serial);init({id,title:goal.slice(0,80),goal,env,service:'Unselected service',branch:'No repository attached'});switchTask(id);persist();return id;}
 function exportData(){persist();return JSON.parse(JSON.stringify(data));}
 function recovery(){persist();return{kind:'dt.prototype.recovery',version:1,task:JSON.parse(JSON.stringify(current()))};}
 function restoreRecovery(payload){if(payload?.kind!=='dt.prototype.recovery'||payload.version!==1||!payload.task?.files||!Array.isArray(payload.task.messages)||typeof payload.task.draft!=='string')throw Error('Not a prototype recovery file');const t=JSON.parse(JSON.stringify(payload.task));for(const f of Object.values(t.files))if(typeof f.saved!=='string')throw Error('Invalid file contents');const id='RECOVERED-'+(++data.serial);t.id=id;t.title='Recovered: '+t.title;t.pane=null;data.tasks[id]=t;data.current=id;persist();return id;}
 persist();return{data,current,actor,send,state,persist,addMessage,openFile,editFile,fileSnapshot,saveFile,fixDraft,prepare,startAction,actionStarted,finishAction,cancelAction,ackCancel,cleaned,reconcile,runModelCase,switchTask,createTask,exportData,recovery,restoreRecovery};
}
module.exports={createStore,KEY,source,rule};
