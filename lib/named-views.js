// Human-readable aliases are locators, never implicit capabilities for private results.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('./access'),C=require('./config'),M=require('./ui-page-model');
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const atomic=(file,value)=>require('./atomic-file').atomicFile(file,JSON.stringify(value)+'\n',{mode:0o600});
const fail=(message='Named view is unavailable',code='DT_NOT_FOUND',statusCode=404)=>{throw Object.assign(Error(message),{code,statusCode});};
const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)&&value.length<=80&&!['constructor','prototype'].includes(value);
const suggest=name=>String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80).replace(/-$/,'');
function directory(scope){if(!['private','shared'].includes(scope))throw M.invalid('Named view scope must be private or shared');const dir=path.join(C.HOME,'named-views',scope);return scope==='shared'?dir:A.scopedDirectory(dir);}
function folder(name,scope){if(!slug(name))throw M.invalid('View slug must be lowercase words separated by hyphens, up to 80 characters');return path.join(directory(scope),name);}
function get(name,{scope='shared',revision}={}){
 if(revision&&!/^[a-f0-9]{64}$/.test(revision))throw M.invalid('Invalid named view revision');const dir=folder(name,scope),head=revision?{revision}:read(path.join(dir,'head.json'));if(!head)fail();
 const r=/^[a-f0-9]{64}$/.test(head.revision||'')&&read(path.join(dir,'revisions',head.revision+'.json'));if(!r)fail('Named view revision is missing','STATE_CONFLICT',409);
 const {revision:hash,...body}=r;if(r.slug!==name||r.scope!==scope||M.digest(body)!==hash)fail('Named view revision is damaged','STATE_CONFLICT',409);return r;
}
function url(record,{pinned=false}={}){const q=new URLSearchParams();if(record.scope==='private'){q.set('scope','private');q.set('story',A.current().storyId);}if(pinned)q.set('revision',record.revision);if(record.capability)q.set('key',record.capability);return require('./results').publicUrl()+'/show/'+record.slug+(q.size?'?'+q:'');}
function exposed(record){const {capability,owner,...r}=record,visible=A.visible(owner);if(!visible&&r.target.type==='result')r.target={type:'result'};return {...r,url:url(visible?record:{...record,capability:undefined}),revisionUrl:url(visible?record:{...record,capability:undefined},{pinned:true})};}
function save({name,slug:specified,scope,expected_revision,target,share=false}={}){
 if(typeof name!=='string'||!name.trim()||name.length>160)throw M.invalid('A view name up to 160 characters is required');const key=specified||suggest(name);scope||=target?.type==='result'?'private':'shared';if(scope==='shared')A.requireAdmin();
 if(share&&scope!=='shared')throw M.invalid('Capability sharing requires scope=shared; private names stay in this principal/chat');if(expected_revision!==null&&!/^[a-f0-9]{64}$/.test(expected_revision||''))throw M.invalid('Read the alias revision before saving, or use expected_revision=null for a new name');
 M.keys(target,['type','id','scope','revision'],'named view target');let normalized;
 if(target.type==='page'){
  if(share)throw M.invalid('Capability sharing applies only to retained results');const page=require('./ui-pages').get(target.id,target.scope||'shared',target.revision);if(scope==='shared'&&page.scope!=='shared')throw M.invalid('A shared alias must reference a shared page definition');normalized={type:'page',id:page.id,scope:page.scope,revision:page.revision};
 }else if(target.type==='result'){
  if(Object.keys(target).some(k=>!['type','id'].includes(k)))throw M.invalid('Result targets accept only type and id');const r=require('./results').load(target.id);if(!r)fail('Result is unavailable in this task');if(scope==='shared'&&!share)throw M.invalid('Publishing retained result data requires share=true explicitly');normalized={type:'result',id:r.id};
 }else throw M.invalid('Named view target type must be page or result');
 if(require('./results').raw(key)||/^(?:s[a-f0-9]{32}z)?[a-z0-9]{6,12}[a-f0-9]{18}$/.test(key))throw M.invalid('This slug is reserved for immutable result links');const dir=folder(key,scope);if(!fs.existsSync(path.join(dir,'head.json'))&&fs.existsSync(directory(scope))&&fs.readdirSync(directory(scope)).filter(slug).length>=500)throw M.invalid('Named view budget reached (500); update an existing name');const release=require('./durable-private-store').create(dir).lock('publish');
 try{
  const head=read(path.join(dir,'head.json'));if((head?.revision||null)!==expected_revision)fail('This name already exists or changed; reload its revision before saving','STATE_CONFLICT',409);
  const body={slug:key,name:name.trim(),scope,target:normalized,parent:head?.revision||null,at:new Date().toISOString(),owner:A.owner(),author:{principalId:A.current().principalId,storyId:A.current().storyId},...(share?{capability:crypto.randomBytes(24).toString('hex')}:{})},record={...body,revision:M.digest(body)};
  if(normalized.type==='result')require('./results').retain(normalized.id,'named-view:'+record.revision);
  atomic(path.join(dir,'revisions',record.revision+'.json'),record);atomic(path.join(dir,'head.json'),{revision:record.revision});return exposed(record);
 }finally{release();}
}
function list({q=''}={}){if(typeof q!=='string'||q.length>300)throw M.invalid('Invalid named view search');const out=[];for(const scope of ['private','shared']){let names=[];try{names=fs.readdirSync(directory(scope));}catch(e){if(e.code!=='ENOENT')throw e;}for(const name of names.filter(slug).slice(0,500)){const r=get(name,{scope});if((r.name+' '+r.slug).toLowerCase().includes(q.toLowerCase()))out.push(exposed(r));}}return {views:out};}
function resolve(name,{scope='shared',revision,capability,authenticated=true}={}){
 const r=get(name,{scope,revision});
 if(r.target.type==='result'){
  const result=require('./results').raw(r.target.id);if(!result)fail('Retained view data is missing');
  if(!(authenticated&&A.visible(result.owner))&&!(r.capability&&A.sameSecret(capability,r.capability)))fail();return {...result,namedView:{slug:r.slug,name:r.name,revision:r.revision}};
 }
 if(!authenticated)fail();const page=require('./ui-pages').get(r.target.id,r.target.scope,r.target.revision);
 const data={protocol:'dt.ui-page-run/v1',page:{id:page.id,scope:page.scope,revision:page.revision,title:page.definition.title},definition:page.definition,status:'not-run',sources:{},datasets:{},params:{},gaps:[],url:require('./ui-pages').url(page)};
 return {id:r.slug,kind:'view',view:'ui-page',title:r.name,at:r.at,data,namedView:{slug:r.slug,name:r.name,revision:r.revision}};
}
function tool(a){switch(a.action){case 'save':return save(a);case 'get':return exposed(get(a.slug,{scope:a.scope,revision:a.revision}));case 'list':return list(a);default:throw M.invalid('Choose save, get or list');}}
module.exports={save,get,list,resolve,tool,url,slug,suggest};
