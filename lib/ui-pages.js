const fs=require('node:fs'),path=require('node:path');
const A=require('./access'),C=require('./config'),E=require('./execution'),M=require('./ui-page-model');
const atomic=(file,value)=>require('./atomic-file').atomicFile(file,JSON.stringify(value)+'\n',{mode:0o600});
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const fail=(message,code='DT_NOT_FOUND',statusCode=404)=>{throw Object.assign(Error(message),{code,statusCode});};
function directory(scope='shared'){if(!['private','shared'].includes(scope))throw M.invalid('Page scope must be private or shared');const root=path.join(C.HOME,'pages',scope);return scope==='shared'?root:A.scopedDirectory(root);}
function folder(id,scope){if(!M.id(id))throw M.invalid('Page id must be a lowercase identifier up to 64 characters');return path.join(directory(scope),id);}
function get(id,scope='shared',revision){
 if(revision&&!/^[a-f0-9]{64}$/.test(revision))throw M.invalid('Invalid page revision');const dir=folder(id,scope),head=revision?{revision}:read(path.join(dir,'head.json'));
 if(!head)fail('Page is unavailable in this task');if(!/^[a-f0-9]{64}$/.test(head.revision||''))fail('Page revision pointer is damaged','STATE_CONFLICT',409);const value=read(path.join(dir,'revisions',head.revision+'.json'));
 if(!value||value.id!==id||value.revision!==head.revision)fail('Page revision is missing or damaged','STATE_CONFLICT',409);const {revision:hash,...body}=value;if(M.digest(body)!==hash)fail('Page revision content is damaged','STATE_CONFLICT',409);return value;
}
function save({id,scope='shared',expected_revision,definition}){
 if(scope==='shared')A.requireAdmin();const dir=folder(id,scope),d=M.normalize(definition);
 if(expected_revision!==null&&!/^[a-f0-9]{64}$/.test(expected_revision||''))throw M.invalid('Read the current revision before saving, or use expected_revision=null for a new page');
 if(list().pages.length>=200&&!fs.existsSync(path.join(dir,'head.json')))throw M.invalid('Page budget reached (200); update an existing page');
 fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'.lock');
 try{fs.mkdirSync(lock);}catch(e){if(e.code!=='EEXIST')throw e;const owner=read(path.join(lock,'owner.json'));let alive=Date.now()-fs.statSync(lock).mtimeMs<30000;if(owner?.pid)try{process.kill(owner.pid,0);alive=true;}catch(error){alive=error.code!=='ESRCH';}if(alive)fail('Page is being saved; reload and retry','STATE_CONFLICT',409);fs.rmSync(lock,{recursive:true});try{fs.mkdirSync(lock);}catch{fail('Page is being saved; reload and retry','STATE_CONFLICT',409);}}
 try{
  fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}));
  const previous=read(path.join(dir,'head.json'));if((previous?.revision||null)!==expected_revision)fail('Page changed; reload before saving. Your draft was not saved.','STATE_CONFLICT',409);
  const record={id,scope,parent:previous?.revision||null,definition:d,at:new Date().toISOString(),author:{principalId:A.current().principalId,storyId:A.current().storyId}},revision=M.digest(record),value={...record,revision};
  atomic(path.join(dir,'revisions',revision+'.json'),value);atomic(path.join(dir,'head.json'),{id,scope,revision,title:d.title,description:d.description,at:record.at,author:record.author});return value;
 }finally{fs.rmSync(lock,{recursive:true,force:true});}
}
function list({q=''}={}){
 if(typeof q!=='string'||q.length>300)throw M.invalid('Invalid page search');const pages=[],gaps=[];
 for(const scope of ['private','shared']){let names=[];try{names=fs.readdirSync(directory(scope));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const name of names.filter(M.id).slice(0,200)){try{const h=read(path.join(folder(name,scope),'head.json'));if(h&&[h.id,h.title,h.description].join(' ').toLowerCase().includes(q.toLowerCase()))pages.push(h);}catch{gaps.push('An unreadable page was omitted');}}
 }
 return {pages:pages.sort((a,b)=>a.title.localeCompare(b.title)),gaps,canPublish:A.current().role==='admin',story:A.current().storyId};
}
function history(record){const rows=[];let rev=record.revision;while(rev&&rows.length<20){const r=get(record.id,record.scope,rev);rows.push({revision:r.revision,at:r.at,author:r.author,title:r.definition.title});rev=r.parent;}return rows;}
const runDirectory=record=>A.scopedDirectory(path.join(C.PATHS.cache,'ui-pages',record.scope,record.id));
function runs(record){const rows=read(path.join(runDirectory(record),'runs.json'))||[];return rows.filter(r=>r.revision===record.revision).slice(0,20);}
function url(record,run){const q=new URLSearchParams({id:record.id,scope:record.scope,revision:record.revision,story:A.current().storyId});if(run)q.set('run',run);return require('./results').publicUrl()+'/pages?'+q;}
async function authorize(record,values){
 const tools=new Map((await require('./tools').schemas({metadata:true})).map(t=>[t.name,t]));
 const sources=record.definition.sources.map(s=>({...s,arguments:M.bind(s.arguments||{},values)}));
 for(const s of sources){if(s.rows!==undefined)continue;const t=tools.get(s.tool);A.checkTool(s.tool);if(!t||t.origin!=='built-in')fail('Read source is unavailable: '+s.tool,'DT_ACCESS_DENIED',403);
  if(s.arguments.env)C.getEnv(s.arguments.env);
  // The adapter has an additional dependency, checked before any source starts.
  if(s.tool==='ui_page_data'){const dependency=s.arguments.kind==='service_versions'?'consul_service':'pg_query';if(!tools.has(dependency))fail('Required read tool is unavailable: '+dependency,'DT_ACCESS_DENIED',403);}
  const withDefaults={...s.arguments};for(const [k,p]of Object.entries(t.inputSchema.properties||{}))if(withDefaults[k]===undefined&&p.default!==undefined)withDefaults[k]=p.default;
  require('./schema').assert(withDefaults,t.inputSchema);
 }
 return sources;
}
function snapshot(record,run){
 const R=require('./results');if(!run)return null;const r=R.load(run);
 if(r?.view!=='ui-page'||r.data?.page?.id!==record.id||r.data.page.scope!==record.scope||r.data.page.revision!==record.revision)fail('Saved run is unavailable for this page/revision');return r.data;
}
async function detail({id,scope='shared',revision,run}={}){
 const record=get(id,scope,revision),recent=runs(record),selected=run||recent[0]?.id;
 let saved=null,notice;try{saved=selected?snapshot(record,selected):null;}catch(e){if(e.code!=='DT_NOT_FOUND')throw e;notice='Saved observation is unavailable or expired. The definition is retained; Refresh to collect a new result.';}
 return {record,history:history(record),runs:recent,url:url(record,selected),canEdit:scope!=='shared'||A.current().role==='admin',snapshot:saved,...(notice?{notice}:{})};
}
function summarize(value){return {status:value.status,at:value.at,ms:value.ms,sources:Object.entries(value.sources).map(([id,s])=>({id,tool:s.tool,rows:s.rows.length,complete:s.complete,error:s.error||null})),datasets:Object.fromEntries(Object.entries(value.datasets).map(([id,d])=>[id,{rows:d.rows.length,complete:d.complete,error:d.error||null}])),gaps:value.gaps};}
async function execute(record,values,sources,log){
 const machine=require('./state-machine').create(require('./lifecycles').uiPageRun),started=Date.now(),loaded={};machine.to('reading');
 try{
  // Sequential on purpose: source tools retain rate limiting; no fan-out burst.
  for(const s of sources){E.check();const at=new Date().toISOString(),start=Date.now();log('Reading '+s.id+(s.tool?' · '+s.tool:' · declared rows'));
   try{
    const raw=s.rows!==undefined?{rows:s.rows}:await require('./tools').call(s.tool,s.arguments,{source:'ui-page'});E.check();
    const selected=M.at(raw,s.select??'rows'),array=Array.isArray(selected)?selected:selected&&typeof selected==='object'?[selected]:null;
    if(!array)throw Error('Select an array/object in the source response (for example rows, instances or summary)');
    const partial=raw.complete===false||raw.truncated===true||(s.select??'rows')==='rows'&&typeof raw.total==='number'&&raw.total>array.length;
    loaded[s.id]=M.bounded(require('./redact').clean(array),{complete:!partial,gaps:[...(raw.gaps||[]),...(partial?['Source is incomplete; unmatched comparisons remain unknown']:[])],tool:s.tool||null,kind:s.rows!==undefined?'declared':'tool',arguments:require('./redact').clean(s.arguments),at,ms:Date.now()-start,evidence:raw.view||raw.evidence||null});
   }catch(e){E.check();loaded[s.id]={rows:[],complete:false,error:require('./redact').clean(e.message),gaps:[],tool:s.tool||null,arguments:require('./redact').clean(s.arguments),at,ms:Date.now()-start};log('Unavailable '+s.id+': '+loaded[s.id].error);}
  }
  machine.to('composing');E.check();const datasets=M.derive(record.definition,loaded,values),gaps=[...new Set(Object.entries(datasets).flatMap(([id,d])=>[...(d.gaps||[]).map(g=>id+': '+g),...(d.error?[id+': '+d.error]:[])]))];
  let total=0;for(const [id,d]of Object.entries(datasets)){total+=Buffer.byteLength(JSON.stringify(d));if(total>6*1024*1024)throw Error('Page results exceed the 6 MiB budget; select fewer fields or rows');}
  const value={protocol:'dt.ui-page-run/v1',page:{id:record.id,scope:record.scope,revision:record.revision,title:record.definition.title},definition:record.definition,params:require('./redact').clean(values),at:new Date().toISOString(),ms:Date.now()-started,status:Object.values(datasets).some(d=>d.error)?'partial':Object.values(datasets).some(d=>!d.complete)?'incomplete':'complete',sources:loaded,datasets,gaps,url:url(record)};
  machine.to('retaining');E.check();const view=require('./results').saveView('ui-page',value,{title:record.definition.title}),id=view.split('/').pop(),summary={id,view,revision:record.revision,at:value.at,status:value.status,params:value.params};
  const recent=[summary,...(read(path.join(runDirectory(record),'runs.json'))||[])].slice(0,20);atomic(path.join(runDirectory(record),'runs.json'),recent);machine.to('done');
  return {run:id,view,url:url(record,id),revision:record.revision,...summarize(value)};
 }catch(e){if(!machine.terminal)machine.to(E.signal()?.aborted?'cancelled':'failed');throw e;}
}
async function run({id,scope='shared',revision,params={},job,waitMs=0}={}){
 if(!Number.isInteger(waitMs)||waitMs<0||waitMs>30000)throw M.invalid('waitMs must be 0..30000');const J=require('./jobs');
 let active;
 if(job){active=J.find(job);if(!active||!active.key.startsWith('ui-page:'))fail('Page job is unavailable');}
 else{const record=get(id,scope,revision),values=M.params(record.definition,params),sources=await authorize(record,values);active=J.start('ui-page:'+M.digest([scope,id,record.revision,values]),'Page · '+record.definition.title,log=>execute(record,values,sources,log));}
 if(waitMs&&active.state==='running'){let timer;await Promise.race([active.promise,new Promise(r=>{timer=setTimeout(r,waitMs);})]);clearTimeout(timer);}
 const current=J.get(active.id);return {job:current.id,state:current.state,executionId:current.executionId,log:current.log.slice(-5),...(current.error?{error:current.error}:{}),...(current.result||{})};
}
async function open(args){const d=await detail(args),data=d.snapshot||{protocol:'dt.ui-page-run/v1',page:{id:d.record.id,scope:d.record.scope,revision:d.record.revision,title:d.record.definition.title},definition:d.record.definition,status:'not-run',sources:{},datasets:{},params:{},gaps:[],url:url(d.record)};
 return {url:d.url,view:require('./results').saveView('ui-page',data,{title:d.record.definition.title}),revision:d.record.revision,status:data.status,note:'Opening never executes sources. Open the live page and choose Refresh; shared viewers use their own permissions.'};}
async function catalog(){
 const envs=C.envNames().filter(A.allowsEnv),databases=Object.fromEntries(envs.map(env=>[env,require('./pg').databases(env).map(d=>d.name)])),services=new Set();
 for(const env of envs){const cache=read(path.join(C.PATHS.cache,env,'consul.json'));for(const name of Object.keys(cache?.services||{}))services.add(name);}
 try{for(const s of require('./passport').list())if(!s.env||envs.includes(s.env))services.add(s.service);}catch{}
 const tools=(await require('./tools').schemas()).map(t=>t.name);
 return {envs,databases,services:[...services].sort().slice(0,2000),sourceTools:M.READ_TOOLS.filter(n=>tools.includes(n)),canPublish:A.current().role==='admin',story:A.current().storyId,templates:require('./ui-page-templates').list(),primitives:['text','table','metric','comparison'],operations:['select','concat','filter','compare']};
}
async function tool(a){switch(a.action){case 'save':{const r=save(a);return {id:r.id,scope:r.scope,revision:r.revision,title:r.definition.title,url:url(r),saved:true};}case 'get':{const r=get(a.id,a.scope,a.revision);return {...r,history:history(r),runs:runs(r),url:url(r)};}case 'list':return list(a);case 'templates':return a.template?{template:a.template,definition:require('./ui-page-templates').get(a.template)}:catalog();case 'open':return open(a);case 'run':return run(a);default:throw M.invalid('Choose templates, save, get, list, open or run');}}
module.exports={save,get,list,detail,run,open,catalog,tool,authorize,snapshot,execute};
