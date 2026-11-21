// Persist the tool's native presentation in the run owner's scope. Tools execute
// in task scope; the owner may use a story-bound credential in another UI.
const A=require('./access'),R=require('./results');
const taskScope=run=>({...run.owner,multiUser:true,storyId:'task:'+run.task});
const source=url=>{try{const u=new URL(url,'http://saved-result'),m=u.pathname.match(/^\/(show|view|map|map-preview|logs|pr|architecture)\/([a-z0-9]+)$/);return m?{id:m[2],view:u.searchParams.get('view')}:null;}catch{return null;}};
const load=(run,id)=>A.run(taskScope(run),()=>R.load(id))||A.run(run.owner,()=>R.load(id));
// Some asynchronous adapters present their running answer, not the completed
// job payload. Reuse that renderer with the final evidence; never rerun a tool.
function complete(run,initial,value){
 if(value?.view||!initial?.view)return value;
 try{const ref=source(initial.view),record=ref&&load(run,ref.id);if(record?.kind==='view')return A.run(taskScope(run),()=>({...value,view:R.saveView(ref.view||record.view,value,{title:record.title})}));}
 catch(error){console.error('task completed result presentation: '+error.message);}
 return value;
}
function capture(run,tool,value){
 const views=[],seen=new Set();let missing=false;
 const keep=(record,label)=>A.run(run.owner,()=>{
  const {id,owner,kind,data,rows,view,...meta}=record;
  const url=kind==='view'?R.saveView(view,data,{...meta,sourceAt:record.at}):R.save(kind,rows||[],meta);
  const copied=source(url);R.retain(copied.id,'task:'+run.id);
  return {label,url:new URL(url,'http://saved-result').pathname,view:kind==='view'?view:kind};
 });
 try{
  // Only bounded, explicit presentation fields. Never follow arbitrary URLs,
  // source links, HTML or an object graph supplied by a tool/model.
  for(const [key,url]of Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{})){
   if(views.length>=8)break;if(!/^(view|diagram|dashboard|viewer|[a-zA-Z]+View)$/.test(key)||typeof url!=='string')continue;
   const ref=source(url);if(!ref||seen.has(ref.id))continue;seen.add(ref.id);
   const record=load(run,ref.id);
   if(!record){missing=true;continue;}
   views.push(keep(ref.view&&record.kind==='view'?{...record,view:ref.view}:record,key==='view'?'Result':key.replace(/([a-z])([A-Z])/g,'$1 $2')));
  }
  if(!views.length&&value&&typeof value==='object'&&JSON.stringify(value).length<=1500000){
   const rows=Array.isArray(value)?value:Array.isArray(value.rows)?value.rows:null;
   const table=rows&&rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r));
   views.push(A.run(run.owner,()=>{const url=R.saveView(table?'table':'json',table?rows:value,{title:tool.replaceAll('_',' ')});R.retain(source(url).id,'task:'+run.id);return {label:table?'Table':'Structured result',url:new URL(url,'http://saved-result').pathname,view:table?'table':'json'};}));
  }
  return {visualizations:views,...(missing?{presentationError:'An original visualization was unavailable; retained data remains inspectable.'}:{})};
 }catch(error){console.error('task result presentation: '+error.message);return {visualizations:views,presentationError:'Could not retain the visualization. Raw tool evidence remains available.'};}
}
module.exports={capture,complete};
