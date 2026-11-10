// Object navigation over retained metadata. Every expansion rechecks ownership
// and the tool allowlist; a node identifier is a selector, never a capability.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./config'),A=require('./access'),W=require('./workspace'),M=require('./context');
const fail=message=>Object.assign(Error(message),{code:'DT_ARGUMENT_INVALID',statusCode:400});
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const modes=['contexts','services','tasks'],grants=new(require('node:async_hooks').AsyncLocalStorage)();
function check(name){A.checkTool(name);if(!grants.getStore()?.has(name))throw Object.assign(Error('Tool is unavailable in this scope: '+name),{code:'DT_ACCESS_DENIED',statusCode:403});}
const authorized=fn=>async a=>grants.run(new Set((await require('./tools').schemas()).map(t=>t.name)),()=>fn(a));
const id=ref=>Buffer.from(JSON.stringify(ref)).toString('base64url');
function decode(value){if(typeof value!=='string'||value.length>2500||!/^[\w-]+$/.test(value))throw fail('Invalid navigator node');let ref;try{ref=JSON.parse(Buffer.from(value,'base64url').toString());}catch{throw fail('Invalid navigator node');}if(!ref||Array.isArray(ref)||Object.values(ref).some(v=>typeof v!=='string'||v.length>1000))throw fail('Invalid navigator node');return ref;}
const node=(label,ref,extra={})=>({id:id(ref),label,kind:ref.kind,ref,...extra});
const text=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)throw fail('Invalid navigator text');return v;};
function contexts(){check('context_find');const out=[];let errors=0;for(const row of M.indices()){if(row.context)out.push(row.context);else errors++;}return {rows:out,errors};}
function services(env){
 check('passport');const p=require('./passport'),mapped=require('./util').readJson(path.join(p.DIR,'_repos.json'),{}),rows=p.list().filter(s=>!s.env||s.env===env);for(const [service,r]of Object.entries(mapped))if(!rows.some(s=>s.service===service))rows.push({service,repo:r.project+'/'+r.repo});
 const consul=require('./util').readJson(path.join(C.PATHS.cache,env,'consul.json'));for(const name of Array.isArray(consul?.services)?consul.services.map(s=>s.service||s.name):Object.keys(consul?.services||{}))if(name&&!rows.some(r=>r.service===name))rows.push({service:name});return rows.sort((a,b)=>a.service.localeCompare(b.service));
}
function related(c,s){return c.tags?.includes('service:'+s.service)||c.files?.some(f=>f.summary?.startsWith('[service:'+s.service+'] '))||!!s.repo&&c.repositories?.includes(s.repo);}
function workspaceNodes(rows,reason){return rows.filter(w=>w.exists).map(w=>node(w.ref||w.id,{kind:'workspace',workspace:w.id},{expandable:true,detail:[w.repo,w.sha,reason].filter(Boolean).join(' · ')}));}
function contextNode(c){return node(c.title,{kind:'context',context:c.id},{expandable:true,detail:[c.status,...c.tickets||[]].join(' · ')});}
function taskRows(rows){const out=new Map();for(const c of rows)for(const name of new Set([...(c.tickets||[]),...(c.tasks||[])])){if(!out.has(name))out.set(name,[]);out.get(name).push(c);}return [...out].sort(([a],[b])=>a.localeCompare(b));}
async function tree({env,mode='contexts',parent,q='',cursor=0,limit=60}={}){
 env=env||C.envNames()[0];C.getEnv(env);if(!modes.includes(mode))throw fail('Choose contexts, services or tasks');q=text(q,300).trim().toLowerCase();cursor=Number(cursor);if(!Number.isSafeInteger(cursor)||cursor<0||cursor>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('Invalid navigator page');
 const ref=parent?decode(parent):null,gaps=[];let rows=[];
 if(!ref){
  if(mode==='services'){
   const all=services(env).filter(s=>(s.service+' '+(s.repo||'')).toLowerCase().includes(q)),groups=new Map();for(const s of all){const prefix=s.service.includes('-')?s.service.split('-')[0]:'';if(!groups.has(prefix))groups.set(prefix,[]);groups.get(prefix).push(s);}
   for(const [prefix,ss]of groups)if(prefix&&ss.length>1)rows.push(node(prefix,{kind:'service-group',prefix},{expandable:true,detail:ss.length+' services'}));else rows.push(...ss.map(s=>node(s.service,{kind:'service',service:s.service},{expandable:true,detail:s.repo||'Repository not mapped'})));
  }else {const meta=contexts();if(meta.errors)gaps.push(meta.errors+' unreadable context indexes were omitted.');const all=meta.rows.filter(c=>[c.id,c.title,c.summary,...c.tickets,...c.tasks,...c.repositories,...c.tags,...(c.files||[]).map(f=>f.path+' '+f.summary)].join(' ').toLowerCase().includes(q));rows=mode==='contexts'?all.map(contextNode):taskRows(all).map(([task,cs])=>node(task,{kind:'task',task},{expandable:true,detail:cs.length+' context'+(cs.length===1?'':'s')}));if(mode==='tasks'&&all.some(c=>!c.tickets.length&&!c.tasks.length))gaps.push('Contexts without ticket/task links stay in Contexts. Add metadata links to include them here.');}
 }else if(ref.kind==='service-group')rows=services(env).filter(s=>s.service.startsWith(ref.prefix+'-')&&(!q||(s.service+' '+s.repo).toLowerCase().includes(q))).map(s=>node(s.service,{kind:'service',service:s.service},{expandable:true,detail:s.repo}));
 else if(ref.kind==='service'){
  const s=services(env).find(s=>s.service===ref.service);if(!s)throw fail('Service is absent from this environment');
  rows=[node('Contexts',{kind:'service-contexts',service:s.service},{expandable:true}),node('Workspaces',{kind:'service-workspaces',service:s.service},{expandable:true}),node('API exchanges',{kind:'service-api',service:s.service},{expandable:true}),node('Scripts & saved actions',{kind:'service-recipes',service:s.service},{expandable:true})];
 }else if(['service-contexts','service-workspaces','service-recipes','service-api'].includes(ref.kind)){
  const s=services(env).find(s=>s.service===ref.service);if(!s)throw fail('Service is absent from this environment');
  if(ref.kind==='service-workspaces'){check('workspace_list');rows=workspaceNodes(W.list().filter(w=>w.service===s.service||s.repo&&w.repo===s.repo),'Service/repository link');}
  else if(ref.kind==='service-contexts')rows=contexts().rows.filter(c=>related(c,s)).map(contextNode);
  else if(ref.kind==='service-api'){check('api_exchange_list');rows=require('./api-client').list({limit:500}).filter(e=>e.route.candidates.some(c=>c.service===s.service)).map(e=>node(e.method+' '+new URL(e.url).pathname,{kind:'api-exchange',exchange:e.id},{detail:e.status+' · '+e.url}));}
  else rows=await recipes(s,gaps);
 }else if(ref.kind==='task')rows=contexts().rows.filter(c=>c.tickets.includes(ref.task)||c.tasks.includes(ref.task)).map(contextNode);
 else if(['context','context-dir'].includes(ref.kind)){
  check('context_get');const c=M.get(ref.context);check('context_list');rows=M.directory({id:c.id,dir:ref.path||''}).map(f=>node(path.posix.basename(f.path),{kind:f.dir?'context-dir':'context-file',context:c.id,path:f.path},{expandable:f.dir,detail:f.summary||(!f.dir?f.bytes+' B':'Folder')}));
  if(ref.kind==='context'&&c.workspaces.length)rows.unshift(node('Linked workspaces',{kind:'context-workspaces',context:c.id},{expandable:true}));
 }else if(ref.kind==='context-workspaces'){
  check('context_get');const c=M.get(ref.context);check('workspace_list');rows=workspaceNodes(W.list().filter(w=>c.workspaces.includes(w.id)),'Explicit context link');
 }else if(['workspace','workspace-dir'].includes(ref.kind)){
  check('workspace_read');const r=W.read(ref.workspace,ref.path||'.');rows=(r.entries||[]).filter(n=>!/^\.(git|dt|gradle)\/?$/.test(n)&&!['target/','build/','node_modules/'].includes(n)).map(name=>{const dir=name.endsWith('/'),p=[ref.path,name.replace(/\/$/,'')].filter(Boolean).join('/');return node(name.replace(/\/$/,''),{kind:dir?'workspace-dir':'workspace-file',workspace:ref.workspace,path:p},{expandable:dir});});
 }else throw fail('This node has no folders');
 rows.sort((a,b)=>Number(!!b.expandable)-Number(!!a.expandable)||a.label.localeCompare(b.label));return {mode,env,parent:parent||null,nodes:rows.slice(cursor,cursor+limit),total:rows.length,nextCursor:cursor+limit<rows.length?cursor+limit:null,gaps,source:'Retained metadata · expand to browse; live calls run only on request'};
}
async function recipes(service,gaps){
 const rows=[];let scanned=0,bytes=0;check('context_read');for(const c of contexts().rows){if(!related(c,service))continue;for(const f of c.files||[]){if(!/^recipes\/.+\.json$/.test(f.path))continue;if(++scanned>500||bytes>4*1024*1024){gaps.push('Saved action discovery reached its read budget; browse the exact context to continue.');return rows;}try{const saved=M.read({id:c.id,path:f.path});bytes+=saved.bytes;const r=JSON.parse(saved.content);if(r.protocol==='dt.workbench-recipe/v1'&&(!r.service||r.service===service.service))rows.push(node(r.title||f.path,{kind:'context-file',context:c.id,path:f.path},{detail:'Explicit service/repository context · '+r.tool}));}catch{gaps.push('An unreadable saved action was omitted.');}}}
 try{check('script_list');for(const s of require('./scripts').list().scripts){if(s.id.startsWith(service.service+'/'))rows.push(node(s.id,{kind:'script',script:s.id},{detail:'Collection matches service name · verify relevance'}));}}catch(error){if(error.code!=='DT_ACCESS_DENIED')throw error;}return rows;
}
const action=(label,tool,args)=>({label,tool,arguments:args});
async function detail({env,node:selector}={}){
 env=env||C.envNames()[0];C.getEnv(env);const ref=decode(selector),all=await require('./tools').schemas(),enabled=new Set(all.map(t=>t.name)),actions=[];let d={ref,title:'',summary:'',actions},ws=[];
 if(ref.kind==='service'){
  const s=services(env).find(s=>s.service===ref.service);if(!s)throw fail('Service is absent from this environment');d={...d,title:s.service,summary:s.repo||'Map its repository in Passports.',service:s.service,repo:s.repo,identity:{env,repo:s.repo,sha:s.sha,ref:s.ref,builtAt:s.builtAt}};
  actions.push(action('Consul status','consul_service',{name:s.service,env}),action('Passport','passport',{service:s.service,env}),action('Open workspace','workspace_open',{service:s.service}),action('API routes','api_routes',{service:s.service}),action('New query','pg_query',{env,sql:''}),action('Find scripts','script_list',{}),action('Prepare API request','api_request_prepare',{request:{method:'GET',url:''}}));
  if(enabled.has('workspace_list'))ws=W.list().filter(w=>w.service===s.service||s.repo&&w.repo===s.repo);
 }else if(ref.kind==='task'){
  const cs=contexts().rows.filter(c=>c.tasks.includes(ref.task)||c.tickets.includes(ref.task));if(!cs.length)throw fail('Task is unavailable in this scope');d={...d,title:ref.task,summary:cs.length+' related contexts',contexts:cs.map(c=>({id:c.id,title:c.title,status:c.status,ref:{kind:'context',context:c.id}}))};if(enabled.has('workspace_list'))ws=W.list().filter(w=>cs.some(c=>c.workspaces.includes(w.id)));
  actions.push(action('New task context','context_open',{title:ref.task,tasks:[ref.task]}));
 }else if(ref.context){
  check('context_get');const c=M.get(ref.context);d={...d,title:ref.path||c.title,summary:c.summary,context:c.id,identity:{revision:c.revision,status:c.status,tickets:c.tickets,tasks:c.tasks,repositories:c.repositories},contextMeta:{title:c.title,summary:c.summary,status:c.status,revision:c.revision,tickets:c.tickets,tasks:c.tasks,repositories:c.repositories,workspaces:c.workspaces,tags:c.tags}};
  actions.push(action('Edit task details','context_update',{id:c.id,title:c.title,summary:c.summary,status:c.status,expected_revision:c.revision}),action('New note','context_write',{id:c.id,path:'notes/new-note.md',content:'',expected_revision:null}));
  if(enabled.has('workspace_list'))ws=W.list().filter(w=>c.workspaces.includes(w.id));
  if(ref.kind==='context-file'){actions.push(action('Preview file','files_show',{store:'context:'+c.id,path:ref.path}));check('context_read');const f=M.read({id:c.id,path:ref.path,encoding:'base64'}),raw=Buffer.from(f.content,'base64');d.file=fileData(raw,f.revision,f.bytes,ref.path);if(!d.file.truncated&&!d.file.binary){try{const recipe=JSON.parse(raw.toString('utf8'));if(recipe.protocol==='dt.workbench-recipe/v1'){d.recipe=recipe;d.service=recipe.service;actions.unshift(action('Prepare saved action',recipe.tool,recipe.arguments));}}catch{}}}
 }else if(ref.workspace){
  check('workspace_read');const m=W.checkId(ref.workspace);d={...d,title:ref.path||m.repo,summary:'Workspace · '+m.ref,workspace:m.id,service:m.service,repo:m.project+'/'+m.repo,identity:{workspace:m.id,repo:m.project+'/'+m.repo,ref:m.ref,sha:m.sha}};ws=W.list().filter(w=>w.id===m.id);
  actions.push(action('Run tests','test_run',{workspace:m.id,tests:[]}),action('Changed coverage','workspace_coverage',{workspace:m.id}),action('Review patch','workspace_patch',{workspace:m.id}));
  if(ref.kind==='workspace-file'){const full=W.resolvePath(m,ref.path).full,st=fs.statSync(full);if(!st.isFile())throw fail('Select a regular file');if(st.size>65536)d.file={truncated:true,bytes:st.size,path:ref.path};else{const raw=fs.readFileSync(full);d.file=fileData(raw,hash(raw),raw.length,ref.path);}}
 }else if(ref.kind==='api-exchange'){
  check('api_exchange_get');const e=require('./api-client').get(ref.exchange);d={...d,title:e.request.method+' '+new URL(e.request.url).pathname,summary:e.request.url,identity:{captured:e.at,status:e.response.status},exchange:e.id};actions.push(action('Inspect exchange','api_exchange_get',{exchange:e.id}),action('Prepare request','api_request_prepare',{exchange:e.id}),action('Send request','api_request_replay',{exchange:e.id}),action('Save as script','api_request_save',{exchange:e.id,id:''}));
 }else if(ref.kind==='script'){
  check('script_get');const script=require('./scripts').get(ref.script);d={...d,title:script.id,summary:script.description,script};actions.push(action('Run script','script_run',{id:script.id}),action('Edit script','script_save',{expected_revision:hash(fs.readFileSync(path.join(require('./scripts').DIR,script.id+'.json'))),...Object.fromEntries(Object.entries(script).filter(([k])=>['id','description','params','steps','tool','vars','before','after','finally','tags'].includes(k)))}));
 }else throw fail('Select a context, service, task, workspace or file');
 d.actions=actions.filter(a=>enabled.has(a.tool));d.workspaces=ws.filter(w=>w.exists);return d;
}
function fileData(raw,revision,bytes,p){const content=raw.toString('utf8'),binary=raw.includes(0)||!Buffer.from(content).equals(raw);return {path:p,revision,bytes,binary,truncated:bytes>65536,...(bytes<=65536&&!binary?{content}:{})};}
async function save(a){
 check('context_write');const tool=(await require('./tools').schemas()).find(t=>t.name===a.tool);if(!tool)throw fail('Saved action tool is unavailable');require('./schema').assert(a.arguments,tool.inputSchema);const c=M.get(a.context);text(a.title,300);if(a.service)text(a.service,200);
 const recipe=require('./redact').clean({protocol:'dt.workbench-recipe/v1',title:a.title,service:a.service||null,repository:a.repository||null,tool:a.tool,arguments:a.arguments,createdAt:new Date().toISOString()},{known:require('./redact').values(a.arguments)});
 recipe.redacted=JSON.stringify(recipe.arguments)!==JSON.stringify(a.arguments);
 const p=a.path||'recipes/'+a.title.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,70)+'.json';if(!/^recipes\/.+\.json$/.test(p))throw fail('Saved action paths must be recipes/*.json');
 const r=M.write({id:c.id,path:p,content:JSON.stringify(recipe,null,2),summary:(a.service?'[service:'+a.service+'] ':'')+[a.title,a.tool].filter(Boolean).join(' · '),expected_revision:a.expected_revision===undefined?null:a.expected_revision});return {...r,recipe:{title:recipe.title,tool:recipe.tool,service:recipe.service},next:{tool:'context_get',arguments:{id:c.id}}};
}
async function open(a={}){
 const env=a.env||C.envNames()[0];C.getEnv(env);if(a.mode&&!modes.includes(a.mode))throw fail('Invalid navigator mode');if(['context','service','task'].filter(k=>a[k]).length>1)throw fail('Select one context, service or task; open another view to change the selected object');const mode=a.mode||(a.task?'tasks':a.service?'services':'contexts'),q=new URLSearchParams({env,mode,story:A.owner().storyId||'default'});for(const k of ['context','service','task'])if(a[k])q.set(k,text(a[k],300));
 const url=require('./results').publicUrl()+'/workbench?'+q,snapshot={protocol:'dt.workbench-snapshot/v1',url,env,mode,at:new Date().toISOString(),trees:{},gaps:[]};
 for(const lens of modes)try{snapshot.trees[lens]=await tree({env,mode:lens});}catch(error){snapshot.trees[lens]={nodes:[],total:0,gaps:[error.message]};}
 let retained=0;for(const n of snapshot.trees.services.nodes)if(n.kind==='service-group'&&retained<200)try{const children=await tree({env,mode:'services',parent:n.id,limit:100});n.children=children.nodes.slice(0,200-retained);retained+=n.children.length;if(children.nextCursor!=null||n.children.length<children.nodes.length)snapshot.gaps.push('More service names are available in the live workbench.');}catch(error){snapshot.gaps.push(error.message);}
 const ref=a.service?{kind:'service',service:a.service}:a.context?{kind:'context',context:a.context}:a.task?{kind:'task',task:a.task}:null;
 if(ref)try{const d=await detail({env,node:id(ref)});snapshot.selected={ref,title:d.title,summary:d.summary,identity:d.identity,actions:d.actions.map(a=>a.label),workspaces:d.workspaces.map(w=>({ref:w.ref,id:w.id,repo:w.repo}))};snapshot.children=await tree({env,mode,parent:id(ref)});}catch(error){snapshot.gaps.push(error.message);}
 return {view:require('./results').saveView('workbench',snapshot,{title:'Interactive workbench'}),url,mode,selection:ref?{...ref,found:!!snapshot.selected}:null,gaps:snapshot.gaps,...(ref?.context&&!snapshot.selected&&grants.getStore()?.has('context_find')?{next:{tool:'context_find',arguments:{query:ref.context}}}:{}),note:'Chat shows a retained navigator; the authenticated workbench edits/runs actions with normal permissions. Opening only browses; it neither executes checks nor saves their results. Use context_run to run and retain evidence; verify its saved receipt.'};
}
module.exports={tree:authorized(tree),detail:authorized(detail),save:authorized(save),open:authorized(open),id,decode};
