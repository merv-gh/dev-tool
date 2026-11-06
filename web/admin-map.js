// The map frame never runs tools itself. Parent verifies sender + node against the registry.
let adminMapResult=null; let adminMapEnv=null; const adminMapSequence=new DTState.Revision();
function adminMapViewUrl(view,page){
  const supplied=new URL(view,location.href);
  const route=supplied.pathname.match(new RegExp('/'+page+'/[a-z0-9]+$'));
  if(!['http:','https:'].includes(supplied.protocol)||supplied.username||supplied.password||!route)throw new Error('Unexpected '+page+' view URL');
  // Tool embeds use publicUrl, which may name another interface (container DNS,
  // localhost, or a proxy). Admin frames must use the app serving this page.
  return new URL(route[0]+supplied.search,location.origin);
}
async function adminMapOpen(view,selectedEnv){
  const url=adminMapViewUrl(view,'map');
  adminMapResult=url.pathname.split('/').pop();adminMapEnv=selectedEnv;url.searchParams.set('embed','1');$('cxMapFrame').src=url.href;$('cxMapPanel').hidden=false;$('cxMapPanel').open=true;
}
$('cxMapOpen').onclick=async()=>{const b=$('cxMapOpen');b.disabled=true;try{const r=await contextCall('map',{env:env()});await adminMapOpen(r.view,r.env);}catch(e){contextMessage(e.message,true);}finally{b.disabled=false;}};
window.addEventListener('message',async e=>{
  if(e.source!==$('cxMapFrame').contentWindow||!['dt:map-selected','dt:map-action'].includes(e.data?.type)||e.data.map!==adminMapResult)return;
  const sequence=++adminMapSequence.value;
  try{
    const r=await contextCall('map_node',{env:adminMapEnv,id:e.data.node});if(sequence!==adminMapSequence.value)return;
    $('cxMapSelection').textContent=r.node.label+' · '+r.node.kind;$('cxMapActions').replaceChildren();
    for(const link of r.links||[]){const a=document.createElement('a');a.href=link.url;a.textContent=link.label;a.target='_blank';a.rel='noopener';$('cxMapActions').append(a);}
    for(const a of r.actions.filter(a=>a.valid)){
      const b=document.createElement('button');b.textContent='Prepare '+a.tool;b.onclick=()=>{
        if(!contextState){contextMessage('Open or create a context to prepare tools in its scratchpad.',true);return;}
        if(!contextTools.some(t=>t.name===a.tool)){contextMessage('This tool is unavailable in the scratchpad.',true);return;}
        $('cxToolFilter').value='';contextToolList();$('cxTool').value=a.tool;$('cxArgs').value=JSON.stringify(a.arguments,null,2);contextToolSchema(false);$('cxGoal').value='Inspect '+r.node.label+' from the service map';contextMessage('Prepared '+a.tool+'. Review arguments, then Run & save result.');$('cxArgs').focus();
      };$('cxMapActions').append(b);if(e.data.type==='dt:map-action'&&a.tool===e.data.tool)b.click();
    }
    if(r.node.kind==='ui'){
      const b=document.createElement('button');b.textContent='Capture UI screenshot';b.onclick=async()=>{b.disabled=true;try{const shot=await contextCall('map_ui_preview',{env:adminMapEnv,id:r.node.id});const url=adminMapViewUrl(shot.view,'map-preview');$('cxMapPreview').src=url.href;$('cxMapPreview').hidden=false;if(shot.cleanupError)contextMessage('Screenshot captured; browser cleanup failed: '+shot.cleanupError,true);}catch(e){contextMessage(e.message,true);}finally{b.disabled=false;}};$('cxMapActions').append(b);
    }
  }catch(error){contextMessage(error.message,true);}
});

// Only this authenticated Admin parent can run requests from its own keyed frame.
function adminMapCompact(value,depth=0){if(depth>5)return '[nested result]';if(typeof value==='string')return value.slice(0,4000);if(Array.isArray(value))return value.slice(0,40).map(v=>adminMapCompact(v,depth+1));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,60).map(([k,v])=>[k,adminMapCompact(v,depth+1)]));return value;}
window.addEventListener('message',async e=>{
 const frame=$('cxMapFrame');if(e.source!==frame.contentWindow||e.data?.map!==adminMapResult)return;
 const mapId=adminMapResult,target=frame.contentWindow,selectedEnv=adminMapEnv;
 const reply=payload=>{if(adminMapResult===mapId&&frame.contentWindow===target)target.postMessage({...payload,map:mapId},location.origin);};
 if(e.data.type==='dt:map-ready'){reply({type:'dt:map-host',run:true,story:runtimeStory||'default',env:selectedEnv});return;}
 if(e.data.type!=='dt:map-run')return;
 const request=e.data.request;
 try{
  const inspected=await contextCall('map_node',{env:selectedEnv,id:e.data.node});
  if(!['map_adjust','map_adjustments'].includes(e.data.tool)&&!inspected.actions.some(a=>a.valid&&a.tool===e.data.tool))throw new Error('Tool is not an inspection action for this node');
  const args=e.data.arguments;if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Tool arguments must be a JSON object');
  if(['map_adjust','map_adjustments'].includes(e.data.tool))args.env=selectedEnv;
  const result=await contextCall(e.data.tool,args);
  let view=null,visualizationError=null;
  if(typeof result?.view==='string'){const u=new URL(result.view,location.href),match=u.pathname.match(/\/(show|view|logs|pr|map-preview|map)\/[a-z0-9]+$/);if(match&&['http:','https:'].includes(u.protocol))view=match[0]+u.search+(u.search?'&':'?')+'embed=1';else if(/^\/passport\/[^/]+$/.test(u.pathname)&&['http:','https:'].includes(u.protocol)&&u.searchParams.has('t'))view=u.pathname+u.search+'&embed=1';}
  if(!view&&!['map_adjust','map_adjustments'].includes(e.data.tool))try{const data=adminMapCompact(result),shown=await contextCall('show',{view:Array.isArray(data)&&data.every(row=>row&&typeof row==='object'&&!Array.isArray(row))?'table':'json',data,title:e.data.tool+' inspection'});view=adminMapViewUrl(shown.view,'show').pathname+'?embed=1';}catch(error){visualizationError=error.message;}
  reply({type:'dt:map-result',request,tool:e.data.tool,result:e.data.tool==='map_adjustments'?result:adminMapCompact(result),view,visualizationError});
 }catch(error){reply({type:'dt:map-result',request,tool:e.data.tool,error:error.message});}
});
