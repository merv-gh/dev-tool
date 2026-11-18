// Named, immutable definition snapshots. Import never executes and never copies run evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('./access'),S=require('./scripts'),C=require('./config');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const valid=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
const fail=message=>{throw Object.assign(Error(message),{code:'DT_WORKFLOW_CONFLICT',statusCode:409});};
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
function folder(name){if(!valid(name))throw Error('Shared name: use up to 64 lowercase letters, digits, underscores or hyphens');return path.join(C.HOME,'shared-workflows',name);}
function get(name,revision){
 const dir=folder(name),head=read(path.join(dir,'head.json'));revision ||= head?.revision;
 if(!/^[a-f0-9]{64}$/.test(revision || ''))throw Error('Shared workflow not found');
 const record=read(path.join(dir,'revisions',revision+'.json'));if(!record)throw Error('Shared workflow revision not found');
 const {revision:hash,...body}=record;if(hash!==digest(body))fail('Shared workflow revision is damaged');return {...record,url:require('./results').publicUrl()+'/api-client?'+new URLSearchParams({shared:name,revision}),canPublish:A.current().role==='admin'};
}
function list(){
 const root=path.join(C.HOME,'shared-workflows');let names=[];try{names=fs.readdirSync(root);}catch(e){if(e.code!=='ENOENT')throw e;}
 return {canPublish:A.current().role==='admin',workflows:names.filter(valid).slice(0,500).flatMap(n=>{const h=read(path.join(folder(n),'head.json'));return h?[h]:[];})};
}
function snapshot(id){
 if(S.get(id).id!==id)throw Error('Use the exact saved script id for sharing');
 const definitions={},collections={};
 const visit=id=>{
  const def=S.get(id);if(definitions[def.id])return;
  if(Object.keys(definitions).length>=100)throw Error('Share at most 100 referenced scripts');
  const {id:_,revision,savedAt,...body}=def;S.validate(body);definitions[def.id]=body;
  for(const meta of S.chain(def.id)){const {collection,...fields}=meta;collections[collection]=fields;}
  for(const step of def.steps)if(step.script){if(typeof step.script!=='string'||step.script.includes('{{'))throw Error('Resolve dynamic script references before sharing');visit(step.script);step.script=S.get(step.script).id;}
 };
 visit(id);const bundle={entry:S.get(id).id,definitions,collections};
 const text=JSON.stringify(bundle);if(Buffer.byteLength(text)>2*1048576)throw Error('Shared definition exceeds 2 MiB');
 // Publishing code needs human review; reject obvious literal credentials rather than changing behavior.
  const inspect=v=>{if(!v||typeof v!=='object')return;if(v.secret&&v.default!==undefined)throw Error('Remove secret parameter defaults before sharing');for(const [k,x]of Object.entries(v)){if(typeof x==='string'&&/password|secret|authorization|api.?key|token|cookie/i.test(k)&&x&&!x.includes('{{'))throw Error('Replace literal credentials with runtime {{parameters}} before sharing');inspect(x);}};
 inspect(bundle);if(/Bearer\s+(?!\{\{)[a-z\d._~-]{8,}|https?:\/\/[^\s/]+:[^\s/]+@/i.test(text))throw Error('Remove embedded credentials before sharing');
 for(const secret of require('./collection-evidence').configuredSecrets())if(secret.length>=8&&text.includes(secret))throw Error('Remove configured credentials before sharing');
 return bundle;
}
function publish({name,id,expected_revision}){
 A.requireAdmin();const bundle=snapshot(id),dir=folder(name);
 fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'.lock');let fd;
 try{fd=fs.openSync(lock,'wx');}catch(e){
  if(e.code!=='EEXIST')throw e;
  let pid;try{pid=Number(fs.readFileSync(lock,'utf8'));}catch{}
  let alive=Date.now()-fs.statSync(lock).mtimeMs<30000;
  if(pid>0)try{process.kill(pid,0);alive=true;}catch(error){alive=error.code!=='ESRCH';}
  if(alive)fail('Shared workflow is being published; retry after it finishes');
  fs.unlinkSync(lock);try{fd=fs.openSync(lock,'wx');}catch{fail('Shared workflow is being published; retry after it finishes');}
 }
 fs.writeSync(fd,String(process.pid));
 try{
  const head=read(path.join(dir,'head.json'));if((head?.revision||null)!==expected_revision)fail('Shared workflow changed; open its current revision before publishing');
  const body={name,parent:head?.revision||null,at:new Date().toISOString(),author:A.current().principalId,...bundle},record={...body,revision:digest(body)};
  require('./atomic-file').atomicFile(path.join(dir,'revisions',record.revision+'.json'),JSON.stringify(record)+'\n',{mode:0o600});
  require('./atomic-file').atomicFile(path.join(dir,'head.json'),JSON.stringify({name,revision:record.revision,description:bundle.definitions[bundle.entry].description,at:record.at})+'\n',{mode:0o600});
  return get(name,record.revision);
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function importWorkflow({name,revision,prefix}){
 const record=get(name,revision);
 if(typeof prefix!=='string'||!/^([a-z0-9][\w.-]*\/)*[a-z0-9][\w.-]*$/i.test(prefix)||prefix.split('/').some(p=>p.startsWith('.')))throw Error('Use a new collection path for the private copy');
 const dir=path.join(S.DIR,prefix);fs.mkdirSync(path.dirname(dir),{recursive:true});
 try{fs.mkdirSync(dir);}catch(e){if(e.code==='EEXIST')fail('Destination collection already exists; choose a new path');throw e;}
 try{
  for(const [id,body]of Object.entries(record.definitions)){
   const def=structuredClone(body);def.tool=false;
   for(const step of def.steps)if(step.script)step.script=prefix+'/'+step.script;
   S.save(prefix+'/'+id,def,{expected_revision:null});
  }
  for(const [id,meta]of Object.entries(record.collections)){S.mkdir(prefix+'/'+id);S.setCollection(prefix+'/'+id,{...meta,tool:false});}
  return {id:prefix+'/'+record.entry,name,revision:record.revision,imported:true,next:'Review the private copy and supply runtime values before explicitly running it'};
 }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
function transfer({id,to,expected_revision,move=false}){
 const def=S.get(id);if(def.id!==id)throw Error('Use the exact script id');
 if(def.revision!==expected_revision)fail('Script changed; reload before copying or moving');
 if(move)return S.move(id,to);
 return S.copy(id,to);
}
function tool(a){
 const summary=r=>({name:r.name,revision:r.revision,at:r.at,url:r.url,canPublish:r.canPublish,description:r.definitions[r.entry].description,entry:r.entry,scripts:Object.keys(r.definitions),collections:Object.keys(r.collections),notice:'Definitions only. Dynamic JavaScript references and local integrations require review. Import creates a private copy without execution.'});
 if(a.action==='list')return list();if(a.action==='get'){const r=get(a.name,a.revision);return a.include_definitions?r:summary(r);}
 if(a.action==='publish')return summary(publish(a));if(a.action==='import')return importWorkflow(a);
 throw Error('Choose list, get, publish or import');
}
module.exports={get,list,publish,importWorkflow,transfer,tool,snapshot};
