// Retained, permission-filtered discovery. A library result never executes its action.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('./context'),W=require('./workspace'),S=require('./scripts');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
const kinds=['contexts','files','workspaces','scripts','apis'];
module.exports=({check,contexts,services,node,related})=>{
 function allowed(name){try{check(name);return true;}catch(e){if(e.code==='DT_ACCESS_DENIED')return false;throw e;}}
 function serviceApis(env,service,sourceServices){
  check('api_routes');const rows=[];
  for(const s of (sourceServices||services(env)).filter(s=>!service||s.service===service)){
   let p;try{p=require('./passport').load(s.service,{env});}catch{continue;}
   if(p.env&&p.env!==env)continue;
   for(const e of p.effective?.endpoints||[]){const method=String(e.method||'ANY').toUpperCase(),route=hash([method,e.path,e.handler,e.file,e.line]);
    rows.push(node(method+' '+e.path,{kind:'api-route',service:s.service,route},{category:'apis',detail:s.service+(e.handler?' · '+e.handler:''),api:{method,path:e.path,handler:e.handler,where:e.file?e.file+':'+e.line:'',repo:s.repo,sha:p.repo?.sha}}));
   }
  }
  return rows;
 }
 function apiDetail(ref,env){
  const n=serviceApis(env,ref.service).find(n=>n.ref.route===ref.route);if(!n)throw Error('Indexed endpoint changed or is unavailable; refresh the service API list');
  const bases=[];
  if(allowed('api_exchange_list'))for(const e of require('./api-client').list({limit:500})){
   if(e.route?.candidates?.length===1&&e.route.candidates[0].service===ref.service){try{const url=new URL(e.url);if(!bases.some(b=>b.url===url.origin))bases.push({url:url.origin,source:'Observed exchange '+e.id});}catch{}}
  }
  return {...n.api,service:ref.service,bases,guidance:'Choose the deployment or gateway base URL. Indexed paths describe code, not a deployment address. Preparing never sends a request.'};
 }
 function collections(){check('script_list');return S.list().collections.map(c=>{const m=S.getCollection(c.collection);return node(c.collection,{kind:'script-collection',collection:c.collection},{category:'scripts',expandable:true,detail:[m.description,c.scripts+' scripts'].filter(Boolean).join(' · ')});});}
 async function search({env,query='',kind='all',context,workspace,service,content=false,offset=0,limit=40}={}){
  env=env||require('./config').envNames()[0];require('./config').getEnv(env);
  if(typeof query!=='string'||query.length>300||!['all',...kinds].includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>10000||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof content!=='boolean')throw Error('Invalid library query or page');
  const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean),matches=v=>words.every(w=>v.toLowerCase().includes(w)),rows=[],gaps=[];let scanned=0;
  const add=(n,text='')=>{scanned++;if(matches([n.label,n.detail,text].filter(Boolean).join(' ')))rows.push(n);};
  let cs=[],selectedWorkspace;if(allowed('context_find')){const meta=contexts();cs=meta.rows;if(meta.errors)gaps.push(meta.errors+' unreadable context indexes omitted');}
  if(context){check('context_get');const c=M.get(context);cs=[c];}
  if(workspace){check('workspace_read');selectedWorkspace=W.checkId(workspace);if(!context)cs=[];}
  const ss=allowed('passport')?services(env):[];
  if(service){const s=ss.find(s=>s.service===service);if(!s)throw Error('Service is unavailable in this environment');cs=cs.filter(c=>related(c,s));}
  const relatedServices=(context?ss.filter(s=>cs.some(c=>related(c,s))):workspace?ss.filter(s=>s.service===selectedWorkspace.service||s.repo===selectedWorkspace.project+'/'+selectedWorkspace.repo):ss).filter(s=>!service||s.service===service);
  if(['all','contexts'].includes(kind))for(const c of cs)add(node(c.title,{kind:'context',context:c.id},{category:'contexts',expandable:true,detail:[c.summary,c.status,...c.tickets||[],...c.tasks||[]].filter(Boolean).join(' · ')}),[c.id,...c.repositories||[],...c.tags||[]].join(' '));
  if(['all','files'].includes(kind)&&allowed('context_list'))for(const c of cs)for(const f of c.files||[]){if(scanned>=10000){gaps.push('Metadata scan reached 10,000 entries; select a context or narrower category');break;}add(node(f.path,{kind:'context-file',context:c.id,path:f.path},{category:'files',detail:c.title+' · '+(f.summary||f.bytes+' B')}));}
  if(['all','workspaces'].includes(kind)&&allowed('workspace_list'))for(const w of W.list().filter(w=>w.exists&&(!context||cs.some(c=>c.workspaces?.includes(w.id)))&&(!workspace||w.id===workspace)&&(!service||w.service===service||ss.some(s=>s.service===service&&s.repo===w.repo))))add(node(w.repo+' · '+(w.ref||w.id),{kind:'workspace',workspace:w.id},{category:'workspaces',expandable:true,detail:w.id+' · '+w.sha}));
  if(['all','scripts'].includes(kind)&&allowed('script_list')){
   const selected=relatedServices.map(s=>s.service),filter=s=>!context&&!service&&!workspace||selected.some(name=>s.startsWith(name+'/')||s===name);
   for(const c of collections().filter(n=>filter(n.ref.collection)))add(c);
   for(const s of S.list().scripts.filter(s=>filter(s.id)))add(node(s.id,{kind:'script',script:s.id},{category:'scripts',detail:s.description||'Saved script'}),s.params?.join(' ')||'');
   if(context||service||workspace)gaps.push('Script associations use the service-named collection prefix; choose All work to discover other collections');
  }
  if(['all','apis'].includes(kind)&&allowed('api_routes')&&allowed('passport'))for(const n of serviceApis(env,service,relatedServices))add(n,n.api.where||'');
  if(['all','apis'].includes(kind)&&allowed('api_exchange_list'))for(const e of require('./api-client').list({limit:500})){
   const candidates=e.route?.candidates||[],names=candidates.map(c=>c.service);if((context||service||workspace)&&!names.some(n=>relatedServices.some(s=>s.service===n)&&(!service||service===n)))continue;
   add(node(e.method+' '+new URL(e.url).pathname,{kind:'api-exchange',exchange:e.id},{category:'apis',detail:'Captured HTTP '+e.status+' · '+names.join(', ')+(candidates.length>1?' · ambiguous service':'')}),e.url);
  }
  if(content&&words.length&&['all','files'].includes(kind)){
   if(!context&&!workspace)gaps.push('Select a context or workspace to search file contents');
   if(context){check('context_search');const r=M.search({id:context,query,limit:100});for(const m of r.hits){const existing=rows.find(n=>n.ref.context===context&&n.ref.path===m.path);if(existing){existing.match=m;continue;}rows.push(node(m.path,{kind:'context-file',context,path:m.path},{category:'files',detail:'Content match · line '+m.line,match:m}));}if(r.truncated)gaps.push('Context content search reached its scan budget');}
   if(workspace){check('workspace_read');const meta=W.checkId(workspace),queue=[''];let files=0,bytes=0,dirs=0;
    while(queue.length&&files<1000&&dirs++<1000&&bytes<16*1024*1024){const dir=queue.shift();for(const name of W.read(workspace,dir||'.').entries||[]){if(name.startsWith('.')||['node_modules/','target/','build/'].includes(name))continue;const p=[dir,name.replace(/\/$/,'')].filter(Boolean).join('/');if(name.endsWith('/')){if(queue.length<1000)queue.push(p);continue;}files++;if(files>1000||bytes>=16*1024*1024)break;try{const full=W.resolvePath(meta,p).full,st=fs.statSync(full);if(!st.isFile()||st.size>65536)continue;bytes+=st.size;const raw=fs.readFileSync(full);if(raw.includes(0)||!Buffer.from(raw.toString('utf8')).equals(raw))continue;const lines=raw.toString('utf8').split('\n'),index=lines.findIndex(matches);if(index>=0)rows.push(node(p,{kind:'workspace-file',workspace,path:p},{category:'files',detail:'Workspace content · line '+(index+1),match:{line:index+1,text:lines[index].slice(0,300)}}));}catch{gaps.push('An unreadable workspace file was omitted');}}
    }
    if(queue.length||files>=1000||bytes>=16*1024*1024)gaps.push('Workspace content search reached 1,000 files or 16 MiB; use a narrower source search');
   }
  }
  const unique=[...new Map(rows.map(n=>[n.id,n])).values()].sort((a,b)=>Number(b.label.toLowerCase()===query.toLowerCase())-Number(a.label.toLowerCase()===query.toLowerCase())||a.category.localeCompare(b.category)||a.label.localeCompare(b.label));
  return {query,kind,context:context||null,workspace:workspace||null,env,nodes:unique.slice(offset,offset+limit),total:unique.length,nextOffset:offset+limit<unique.length?offset+limit:null,gaps:[...new Set(gaps)].slice(0,10),source:'Retained task metadata, owned files/scripts and indexed service APIs; no network calls'};
 }
 return {search,serviceApis,apiDetail,collections};
};
