let capabilityWorkspace=null,capabilityScope=null;
function capabilityState(){const p=new URLSearchParams(location.hash.split('?')[1]||'');return{object:p.get('object')||'',query:p.get('q')||'',tool:p.get('tool')||null};}
function clearCapabilities(){capabilityScope=null;capabilityWorkspace?.clear();}
async function loadCapabilities(){
 if(!capabilityWorkspace)capabilityWorkspace=dtCapabilityMap.mount($('capabilityRoot'),{request:()=>api('/api/capabilities?'+new URLSearchParams({env:env()})),navigate:state=>history.replaceState(null,'','#capabilities?'+new URLSearchParams({...(state.object?{object:state.object}:{}),...(state.query?{q:state.query}:{}),...(state.tool?{tool:state.tool}:{}),story:runtimeStory||'default',env:env()}))});
 const scope=adminRequestScope()+'|'+env();if(capabilityScope!==scope){clearCapabilities();capabilityScope=scope;await capabilityWorkspace.load(capabilityState());}else if(capabilityWorkspace.model)capabilityWorkspace.set(capabilityWorkspace.model,capabilityState());
}
document.addEventListener('DOMContentLoaded',()=>{$('env').addEventListener('change',()=>{clearCapabilities();if(tab==='capabilities')loadCapabilities();});});
