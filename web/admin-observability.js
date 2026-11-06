// Runtime extension. Keep chat-local trace state separate from global test evidence.
const diagnosticsRequests=new DTState.Revision();
const diagnosticsState=DTState.create(DTState.models.diagnostics);
const diagnosticsMode=()=>diagnosticsState.state;
async function diagnosticsLoad(){
 const scope=runtimeScopeVersion.value,request=diagnosticsRequests.advance(),mode=diagnosticsMode();
 if(mode==='activity')return;
 const output=$('dgAdminOutput');output.textContent='Loading '+(mode==='traces'?'trace evidence':'test evidence')+'…';
 try{
  const result=await api('/api/admin/runtime/'+(mode==='traces'?'observability':'coverage'));
  if(scope!==runtimeScopeVersion.value||!diagnosticsRequests.current(request)||mode!==diagnosticsMode())return;
  $('dgTraceControls').hidden=mode!=='traces';$('dgTraceToggle').textContent=result.enabled?'Disable tracing in this chat':'Enable tracing in this chat';$('dgTraceToggle').disabled=result.available===false;
  if(mode==='traces')DTDiagnostics.traces(output,result,{id:'admin'});
  else DTDiagnostics.coverage(output,result,{id:'admin',readSource:file=>api('/api/admin/runtime/coverage/source?path='+encodeURIComponent(file))});
 }catch(error){if(scope===runtimeScopeVersion.value&&diagnosticsRequests.current(request))output.textContent='Could not load diagnostics: '+error.message+'. Refresh to retry.';}
}
function diagnosticsScopeChanged(){diagnosticsRequests.advance();$('dgAdminOutput').replaceChildren();$('dgTraceControls').hidden=true;if(diagnosticsMode()!=='activity')diagnosticsLoad();}
function diagnosticsSelect(mode){diagnosticsState.to(mode);document.querySelectorAll('[data-diagnostics-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.diagnosticsMode===mode)));$('rtActivityBody').hidden=mode!=='activity';$('rtActivityHeading').hidden=mode!=='activity';$('dgAdminPanel').hidden=mode==='activity';diagnosticsLoad();}
function diagnosticsInit(){
 document.querySelectorAll('[data-diagnostics-mode]').forEach(button=>button.onclick=()=>diagnosticsSelect(button.dataset.diagnosticsMode));
 $('dgAdminRefresh').onclick=diagnosticsLoad;
 $('dgTraceToggle').onclick=async()=>{const scope=runtimeScopeVersion.value,button=$('dgTraceToggle');button.disabled=true;try{const current=await api('/api/admin/runtime/observability');if(scope!==runtimeScopeVersion.value)return;await api('/api/admin/runtime/observability',{enabled:!current.enabled});if(scope===runtimeScopeVersion.value)await diagnosticsLoad();}catch(error){if(scope===runtimeScopeVersion.value)$('dgAdminOutput').textContent=error.message;}finally{button.disabled=false;}};
}
document.addEventListener('DOMContentLoaded',diagnosticsInit);
