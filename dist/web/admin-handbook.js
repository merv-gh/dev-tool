let adminHandbook=null,adminHandbookScope=null;
async function loadHandbook(){
 const selected=new URLSearchParams(location.hash.split('?')[1]||'').get('chapter')||'start';
 if(!adminHandbook)adminHandbook=dtHandbook.mount($('adminHandbook'),{request:api,call:async(name,args)=>(await api('/api/tool/'+name,args)).result,scope:adminRequestScope,env,navigate:id=>history.replaceState(null,'','#handbook?chapter='+encodeURIComponent(id)),scopeCaption:()=>env()+' · '+(runtimeStory||'default')});
 const scope=adminRequestScope()+'|'+env();if(adminHandbookScope!==scope){adminHandbook.clear();adminHandbookScope=scope;await adminHandbook.load(selected);}else adminHandbook.go(selected,false);
}
function clearHandbook(){adminHandbookScope=null;adminHandbook?.clear();}
document.addEventListener('DOMContentLoaded',()=>{$('env').addEventListener('change',()=>{clearHandbook();if(tab==='handbook')loadHandbook();});window.addEventListener('beforeunload',event=>{if(adminHandbook?.dirty()||adminHandbook?.pending()){event.preventDefault();event.returnValue='';}});});
