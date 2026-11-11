// Runtime extension. Keep chat-local trace state separate from global test evidence.
const diagnosticsRequests=new DTState.Revision();
const diagnosticsState=DTState.create(DTState.models.diagnostics);
const diagnosticsMode=()=>diagnosticsState.state;
let diagnosticsEvents=null;
const diagnosticsQuery=()=>typeof location==='undefined'?{}:Object.fromEntries(new URLSearchParams((location.hash||'').split('?')[1]||''));
async function diagnosticsLoad(){
 const scope=runtimeScopeVersion.value,request=diagnosticsRequests.advance(),mode=diagnosticsMode();
 if(mode==='activity')return;
 $('dgAdminRefresh').hidden=mode==='events';
 if(mode==='events'&&diagnosticsEvents)return diagnosticsEvents.refresh();
 const output=$('dgAdminOutput');output.textContent='Loading '+(mode==='traces'?'trace evidence':mode==='events'?'request activity':'test evidence')+'…';
 try{
  if(mode==='events'){
   if(typeof loadRuntime==='function'&&!runtimeState)await loadRuntime();
   const linked=diagnosticsQuery(),keys=['from','to','q','kind','outcome','purpose','name','scope','httpStatus','minMs'],query=Object.fromEntries(keys.filter(k=>linked[k]!==undefined).map(k=>[k,linked[k]]));
   const load=async values=>{const qs=new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([,v])=>v!==undefined&&v!==null&&v!=='')));const result=await api('/api/admin/runtime/events?'+qs);if(scope!==runtimeScopeVersion.value||mode!==diagnosticsMode())throw Error('The selected task changed');return result;};
   const result=await load(query);if(scope!==runtimeScopeVersion.value||!diagnosticsRequests.current(request)||mode!==diagnosticsMode())return;
   $('dgTraceControls').hidden=true;
   diagnosticsEvents=DTRequestEvents.render(output,result,{load,admin:runtimeState?.identity?.role==='admin',fixedWindow:!!linked.from,share:async filters=>{const u=new URL(location.href);u.hash='runtime?'+new URLSearchParams({view:'events',story:runtimeStory,...(runtimePrincipal?{principal:runtimePrincipal}:{}),...Object.fromEntries(Object.entries(filters).filter(([,v])=>v!==undefined&&v!==null&&v!==''))});try{await navigator.clipboard.writeText(u.href);}catch{prompt('Copy filtered request view',u.href);}},execution:id=>{diagnosticsSelect('activity');runtimeSelectExecution(id);},useScope:owner=>{if(!owner)return;$('rtStory').value=owner.storyId;if(runtimeState?.identity?.role==='admin')$('rtPrincipal').value=owner.principalId;$('rtScopeForm').requestSubmit();}});return;
  }
  const result=await api('/api/admin/runtime/'+(mode==='traces'?'observability':'coverage'));
  if(scope!==runtimeScopeVersion.value||!diagnosticsRequests.current(request)||mode!==diagnosticsMode())return;
  $('dgTraceControls').hidden=mode!=='traces';$('dgTraceToggle').textContent=result.enabled?'Disable tracing in this chat':'Enable tracing in this chat';$('dgTraceToggle').disabled=result.available===false;
  if(mode==='traces')DTDiagnostics.traces(output,result,{id:'admin'});
  else DTDiagnostics.coverage(output,result,{id:'admin',readSource:file=>api('/api/admin/runtime/coverage/source?path='+encodeURIComponent(file))});
 }catch(error){if(scope===runtimeScopeVersion.value&&diagnosticsRequests.current(request))output.textContent='Could not load diagnostics: '+error.message+'. Refresh to retry.';}
}
function diagnosticsScopeChanged(){diagnosticsRequests.advance();diagnosticsEvents?.dispose();diagnosticsEvents=null;$('dgAdminOutput').replaceChildren();$('dgTraceControls').hidden=true;if(diagnosticsMode()!=='activity')diagnosticsLoad();}
function diagnosticsSelect(mode){diagnosticsEvents?.dispose();diagnosticsEvents=null;diagnosticsState.to(mode);document.querySelectorAll('[data-diagnostics-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.diagnosticsMode===mode)));$('rtActivityBody').hidden=mode!=='activity';$('rtActivityHeading').hidden=mode!=='activity';$('dgAdminPanel').hidden=mode==='activity';diagnosticsLoad();}
function diagnosticsInit(){
 document.querySelectorAll('[data-diagnostics-mode]').forEach(button=>button.onclick=()=>diagnosticsSelect(button.dataset.diagnosticsMode));
 $('dgAdminRefresh').onclick=diagnosticsLoad;
 $('dgTraceToggle').onclick=async()=>{const scope=runtimeScopeVersion.value,button=$('dgTraceToggle');button.disabled=true;try{const current=await api('/api/admin/runtime/observability');if(scope!==runtimeScopeVersion.value)return;await api('/api/admin/runtime/observability',{enabled:!current.enabled});if(scope===runtimeScopeVersion.value)await diagnosticsLoad();}catch(error){if(scope===runtimeScopeVersion.value)$('dgAdminOutput').textContent=error.message;}finally{button.disabled=false;}};
 if(['events','traces','coverage'].includes(diagnosticsQuery().view))diagnosticsSelect(diagnosticsQuery().view);
}
document.addEventListener('DOMContentLoaded',diagnosticsInit);
