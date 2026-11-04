// Capability links are read-only and restore the result owner's scope in server.js.
async function handle(req, res, url) {
 const R=require('./results'), parts=url.pathname.split('/').filter(Boolean), result=R.load(parts[2]), action=parts[3]||'model';
 const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'});res.end(JSON.stringify(data));};
 if(result?.view!=='architecture')return send(404,{error:'Architecture result not found'});
 try {
  if(!['model','export'].includes(action))return send(404,{error:'Unknown architecture action'});
  const original=result.data, a={env:original.env,envs:original.envs,document:original.document?.id,revision:original.document?.revision,sourceDocuments:original.sourceDocuments,type:original.type,focus:original.focus,flow:original.flow?.id}, allowed=['env','type','focus','q','flow','saved_view','limit','format'];
  for(const [key,value]of url.searchParams){if(!allowed.includes(key)||value.length>500)throw Error('Unsupported architecture parameter'); if(key!=='format')a[key]=key==='limit'?Number(value):value;}
  if(!original.envs.includes(a.env))throw Error('Environment is outside this saved comparison');
  if(a.saved_view&&!original.document?.views.some(v=>v.id===a.saved_view))throw Error('Named view is unavailable');
  if(a.saved_view&&!url.searchParams.has('type'))delete a.type;
  if(a.saved_view&&!url.searchParams.has('focus'))delete a.focus;
  const changed=[...url.searchParams.keys()].some(k=>k!=='format'), model=changed ? original.dossier ? require('./service-architecture').projection(original,a) : await require('./architecture').project(a) : original;
  if (changed && original.semantic && model.env === original.env && model.flow?.id === original.flow?.id && model.document?.revision === original.document?.revision && ['dataflow','dynamic'].includes(model.type)) model.semantic = original.semantic;
  if(action==='model')return send(200,model);
  const out=require('./architecture-export').render(model,url.searchParams.get('format')||'svg');
  res.writeHead(200,{'content-type':out.type,'content-disposition':`attachment; filename="architecture-${model.type}.${out.extension}"`,'cache-control':'no-store','access-control-allow-origin':'*','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(out.body);
 }catch(e){send(e.statusCode||400,{error:e.message,code:e.code});}
}
module.exports={handle};
