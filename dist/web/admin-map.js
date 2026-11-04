// The map frame never runs tools itself. Parent verifies sender + node against the registry.
let adminMapResult=null,adminMapEnv=null,adminMapSequence=0;
async function adminMapOpen(view,selectedEnv){
  const url=new URL(view,location.href);if(url.origin!==location.origin||!/^\/map\/[a-z0-9]+$/.test(url.pathname))throw new Error('Unexpected map view URL');
  adminMapResult=url.pathname.split('/').pop();adminMapEnv=selectedEnv;url.searchParams.set('embed','1');$('cxMapFrame').src=url.href;$('cxMapPanel').hidden=false;$('cxMapPanel').open=true;
}
$('cxMapOpen').onclick=async()=>{const b=$('cxMapOpen');b.disabled=true;try{const r=await contextCall('map',{env:env()});await adminMapOpen(r.view,r.env);}catch(e){contextMessage(e.message,true);}finally{b.disabled=false;}};
window.addEventListener('message',async e=>{
  if(e.source!==$('cxMapFrame').contentWindow||!['dt:map-selected','dt:map-action'].includes(e.data?.type)||e.data.map!==adminMapResult)return;
  const sequence=++adminMapSequence;
  try{
    const r=await contextCall('map_node',{env:adminMapEnv,id:e.data.node});if(sequence!==adminMapSequence)return;
    $('cxMapSelection').textContent=r.node.label+' · '+r.node.kind;$('cxMapActions').replaceChildren();
    for(const link of r.links||[]){const a=document.createElement('a');a.href=link.url;a.textContent=link.label;a.target='_blank';a.rel='noopener';$('cxMapActions').append(a);}
    for(const a of r.actions.filter(a=>a.valid)){
      const b=document.createElement('button');b.textContent='Prepare '+a.tool;b.onclick=()=>{
        if(!contextState){contextMessage('Open or create a context to prepare tools in its scratchpad.',true);return;}
        if(!contextTools.some(t=>t.name===a.tool)){contextMessage('This tool is unavailable in the scratchpad.',true);return;}
        $('cxToolFilter').value='';contextToolList();$('cxTool').value=a.tool;contextToolSchema(false);$('cxArgs').value=JSON.stringify(a.arguments,null,2);$('cxGoal').value='Inspect '+r.node.label+' from the service map';contextMessage('Prepared '+a.tool+'. Review arguments, then Run & save result.');$('cxArgs').focus();
      };$('cxMapActions').append(b);if(e.data.type==='dt:map-action'&&a.tool===e.data.tool)b.click();
    }
    if(r.node.kind==='ui'){
      const b=document.createElement('button');b.textContent='Capture UI screenshot';b.onclick=async()=>{b.disabled=true;try{const shot=await contextCall('map_ui_preview',{env:adminMapEnv,id:r.node.id});const url=new URL(shot.view,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/map-preview/'))throw new Error('Unexpected screenshot URL');$('cxMapPreview').src=url.href;$('cxMapPreview').hidden=false;if(shot.cleanupError)contextMessage('Screenshot captured; browser cleanup failed: '+shot.cleanupError,true);}catch(e){contextMessage(e.message,true);}finally{b.disabled=false;}};$('cxMapActions').append(b);
    }
  }catch(error){contextMessage(error.message,true);}
});
