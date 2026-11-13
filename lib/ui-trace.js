// UI observations joined to exact static code snapshots and catalog identities.
// Neither an HTTP observation nor a declared field binding proves distributed execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('./access'),E=require('./execution'),C=require('./config');
const {readJson,writeJson}=require('./util');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dir=()=>A.scopedDirectory(path.join(C.PATHS.cache,'ui-traces'));
const validId=id=>{if(!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id||''))throw Error('Invalid UI trace id');return id;};
const arr=x=>Array.isArray(x)?x:[];
const quote=x=>'"'+String(x).replace(/"/g,'""')+'"';
const bindingKeys=['services','fields','transports','databases','database_links'];
const signature=o=>String(o.signature??o.args??'').trim().replace(/\s+/g,' ');
const routine=o=>['function','procedure','aggregate','window'].includes(o.kind);
const error=(message,code='DT_ARGUMENT_INVALID',statusCode=400)=>Object.assign(Error(message),{code,statusCode});
function validate(def) {
  if(!def||typeof def!=='object'||Array.isArray(def)||Buffer.byteLength(JSON.stringify(def))>131072)throw error('definition must be an object up to 128 KiB');
  if(typeof def.title!=='string'||!def.title.trim()||def.title.length>160)throw error('definition.title is required (max 160 characters)');
  const recipe=require('./ui-trace-browser').validate(def.recipe);
  for(const key of bindingKeys)if(def[key]!==undefined&&(!Array.isArray(def[key])||def[key].length>50))throw error(`${key} must be an array of at most 50 bindings`);
  for(const s of arr(def.services))if(!s.service||!s.analysis||!s.entry||typeof s.entry!=='object')throw error('Service bindings require service, exact analysis and entry selector');
  for(const f of arr(def.fields))if(!f.service||!f.repo||!/^[a-f0-9]{40}$/i.test(f.sha||'')||!f.file||!Number.isInteger(f.line)||f.line<1||!f.db||!f.object||!f.column||!f.reason)throw error('Field bindings require service, repo, full sha, exact file/line, db, object, column and reason');
  for(const t of arr(def.transports))if(!t.service||!t.repo||!/^[a-f0-9]{40}$/i.test(t.sha||'')||!t.file||!Number.isInteger(t.line)||t.line<1||!t.target_service||!t.path||!t.method||!t.reason)throw error('Transport bindings require service, repo, full sha, exact file/line, target_service, method, path and reason');
  const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=2000,object=x=>text(x)&&x.includes('.');
  for(const b of arr(def.databases))if(!text(b.service)||!text(b.repo)||!/^[a-f0-9]{40}$/i.test(b.sha||'')||!text(b.file)||!Number.isInteger(b.line)||b.line<1||!text(b.db)||!object(b.object)||!text(b.reason))throw error('Database bindings require service, repo, full sha, exact file/line, db, qualified object and reason');
  for(const b of arr(def.database_links))if(!text(b.db)||!object(b.object)||!text(b.target_db)||!object(b.target_object)||!text(b.reason))throw error('Database links require db, qualified object, target_db, target_object and reason');
  for(const b of [...arr(def.fields),...arr(def.databases),...arr(def.database_links)]){
    for(const key of ['signature','target_signature'])if(b[key]!==undefined&&(typeof b[key]!=='string'||b[key].length>2000))throw error('Routine signatures must be strings up to 2000 characters');
    if(b.columns!==undefined&&(!Array.isArray(b.columns)||b.columns.length>50||b.columns.some(c=>!text(c))))throw error('columns must contain at most 50 field names');
  }
  return {title:def.title,description:String(def.description||'').slice(0,4000),recipe,...Object.fromEntries(bindingKeys.map(k=>[k,arr(def[k])]))};
}
function get(id,revision) {
  validId(id);if(revision&&!/^[a-f0-9]{64}$/.test(revision))throw error('Invalid recipe revision');
  const value=readJson(revision?path.join(dir(),id,'revisions',revision+'.json'):path.join(dir(),id,'current.json'));
  if(!value)throw error('UI trace recipe is unavailable in this task','DT_NOT_FOUND',404);return value;
}
function save({id,definition,expected_revision}) {
  validId(id);definition=validate(definition);let previous;try{previous=get(id);}catch(e){if(e.code!=='DT_NOT_FOUND')throw e;}
  if((previous?.revision||null)!==expected_revision)throw error('Recipe changed; reload it before saving','DT_REVISION_CONFLICT',409);
  const revision=digest(definition),value={id,revision,definition,at:new Date().toISOString()};
  writeJson(path.join(dir(),id,'revisions',revision+'.json'),value);writeJson(path.join(dir(),id,'current.json'),value);return value;
}
function edit({id,expected_revision,patch}) {
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['title','description','recipe',...bindingKeys].includes(k)))throw error('Patch may replace title, description, recipe or reviewed binding arrays only');
  if(!expected_revision)throw error('Editing requires the current expected_revision');
  return save({id,expected_revision,definition:{...get(id).definition,...patch}});
}
function list({q=''}={}) {
  let names=[];try{names=fs.readdirSync(dir());}catch{}
  return {envs:C.envNames().filter(name=>A.allowsEnv(name)),recipes:names.filter(n=>/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(n)).flatMap(id=>{try{const r=get(id);return [{id,title:r.definition.title,revision:r.revision,at:r.at}];}catch{return [];}}).filter(r=>(r.id+' '+r.title).toLowerCase().includes(q.toLowerCase())).slice(0,200)};
}
function retained(result) {const r=require('./results').load(result);if(r?.view!=='ui-trace')throw error('UI trace result is unavailable','DT_NOT_FOUND',404);return r.data;}
function publicExchange(e) {return {id:e.id,at:e.at,request:{method:e.request.method,url:e.request.url},response:{status:e.response.status},route:e.route,gaps:e.gaps};}
function staticAsset(e) {
  if(arr(e.route?.candidates).length||!['GET','HEAD'].includes(e.request.method))return false;
  return /\.(?:css|m?js|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp4|webm)$/i.test(new URL(e.request.url).pathname)||/^(?:image\/|font\/|text\/css|(?:application|text)\/(?:javascript|ecmascript))/i.test(e.response?.headers?.['content-type']||'');
}
async function graph({recipe,env,state={},exchanges=[],gaps=[]},deps={}) {
  const definition=recipe.definition,nodes=[],edges=[],groups=[],all=new Map(),edgeIds=new Set(),expanded=new Set(),queue=[],catalog=new Map();
  gaps=[...gaps];const gap=(kind,detail,extra={})=>{if(gaps.length<250)gaps.push({kind,detail,...extra});};let nodeClipped=false,edgeClipped=false;
  const captured=exchanges.length;exchanges=exchanges.filter(e=>!staticAsset(e));if(exchanges.length<captured)gap('static-assets-omitted',`${captured-exchanges.length} unmatched static assets omitted before applying the request budget; cached handler matches remain included`);
  const node=n=>{if(all.has(n.id))return all.get(n.id);if(nodes.length>=600){if(!nodeClipped)gap('node-budget','Diagram reached 600 nodes; narrow the captured requests');nodeClipped=true;return null;}nodes.push(n);all.set(n.id,n);return n;};
  const edge=(from,to,label,certainty,evidence,extra={})=>{if(!all.has(from)||!all.has(to))return;const id=digest([from,to,label,extra.kind]).slice(0,24);if(edgeIds.has(id))return;if(edges.length>=1500){if(!edgeClipped)gap('edge-budget','Diagram reached 1,500 edges; narrow the captured requests');edgeClipped=true;return;}edgeIds.add(id);edges.push({id,from,to,label,certainty,evidence,...extra});};
  node({id:'ui',kind:'ui',name:definition.title,state,recipe:definition.recipe});
  const enqueue=(service,from,request,certainty,evidence)=>{if(!service)return;queue.push({service,from,request,certainty,evidence});};
  const manualRoutes=require('./routes').resolver(arr(definition.services).filter(s=>s.path&&s.method&&s.reason).map(s=>({service:s.service,effective:{endpoints:[{path:s.path,method:s.method}]}})));
  for(const e of exchanges.slice(0,50)){
    const id='request:'+e.id;node({id,kind:'request',name:e.request.method+' '+(e.route?.path||new URL(e.request.url).pathname),exchange:e.id,url:e.request.url,status:e.response.status,route:e.route});
    edge('ui',id,'HTTP '+(e.response.status||'pending'),'observed',{exchange:e.id,at:e.at},{kind:'browser-request'});
    const corrections=manualRoutes(e.request.url,e.request.method).candidates,candidates=corrections.length?corrections:arr(e.route?.candidates);
    if(corrections.length)gap('declared-route','Handler attribution was supplied by a reviewed recipe binding',{request:id});
    if(!candidates.length)gap('route-unresolved','No cached handler matches this observed request',{request:id});
    if(candidates.length>1)gap('route-ambiguous','Multiple handlers match the URL; candidate branches remain separate',{request:id});
    if(candidates.length>8)gap('route-budget','Only the first eight handler candidates are included; narrow or correct route attribution',{request:id});
    for(const candidate of candidates.slice(0,8))enqueue(candidate.service,id,candidate,corrections.length?'declared':candidates.length===1?'static':'candidate',{kind:corrections.length?'manual-route-binding':'route-pattern',exchange:e.id,candidate,...(corrections.length?{reason:definition.services.find(s=>s.service===candidate.service&&s.path===candidate.path&&s.method===candidate.method)?.reason}:{})});
  }
  if(exchanges.length>50)gap('request-budget','Only the first 50 captured requests are included');
  if(!state.image)gap('screenshot-unavailable','Capture the saved UI recipe to attach its last-state screenshot');
  if(!exchanges.length)gap('requests-missing','Replay the UI recipe or select previously captured exchanges; no traffic was invented');
  const passportCache=new Map(),readPassport=deps.passport||((s)=>require('./passport').load(s,{env}));
  const loadPassport=s=>{if(!passportCache.has(s))passportCache.set(s,readPassport(s));return passportCache.get(s);};
  const analyses=deps.analyses||(()=>require('./semantic-code').list({versions:true}).analyses);
  let retainedAnalyses;
  const describe=deps.describe||((name)=>require('./pgindex').describe(env,name,{body:false}));
  const query=deps.query||((analysis,from)=>require('./semantic-query').query({operation:'flowmap',env,from,maxMethods:16,maxStates:160,maxHops:10,budgetMs:5000},[analysis],{runQuery:require('./semantic-code').runQuery}));
  const dbExpanded=new Set(),dbStack=new Set(),fieldExpanded=new Set(),matchedDbLinks=new Set();
  function dbTarget(from,b,certainty,evidence,fields=[],depth=0) {
    E.check();const name=b.object||(b.table?.includes('.')?b.table:b.schema&&b.table?b.schema+'.'+b.table:b.function);
    if(!name){gap('database-object-unresolved','Database boundary lacks a qualified table/function identity',{node:from});return;}
    const key=(b.db?b.db+':':'')+name;
    if(!catalog.has(key)){try{catalog.set(key,describe(key));}catch{catalog.set(key,[]);}}
    const candidates=catalog.get(key).filter(o=>o.kind!=='unknown'),found=candidates.filter(o=>(!b.function||routine(o))&&(b.signature===undefined||routine(o)&&signature(o)===signature({signature:b.signature})));
    if(found.length!==1){gap('database-identity-unresolved','Catalog object is missing or ambiguous; specify the database alias and exact schema/object',{node:from,object:key});return;}
    const o=found[0],isFn=routine(o),sig=signature(o),id='db:'+o.db+':'+o.object+(isFn?'@'+digest([o.kind,sig]).slice(0,12):'');
    node({id,kind:isFn?(o.kind==='procedure'?'procedure':'function'):'table',objectKind:o.kind,name:o.object+(isFn?'('+sig+')':''),db:o.db,object:o.object,...(isFn?{signature:sig}:{}),columns:arr(o.columns).map(c=>({name:c.name,type:c.type})),arguments:o.arg_list});
    edge(from,id,b.access||'DB boundary',certainty,evidence,{kind:'database-boundary'});
    for(const name of [...new Set(fields)].slice(0,50)){
      const column=arr(o.columns).find(c=>c.name===name)||arr(o.arg_list).find(c=>c.name===name&&['out','table','inout'].includes(c.mode));
      if(!column){gap('column-unresolved','Declared field is absent from the retained catalog',{object:key,column:name});continue;}
      const cid=id+':'+name;node({id:cid,kind:'column',objectKind:o.kind,name,db:o.db,object:o.object,...(isFn?{signature:sig}:{}),column:name,type:column.type});
      edge(id,cid,'catalog field','catalog',{db:o.db,object:o.object,column:name},{kind:'catalog-membership'});
      edge(from,cid,'field binding',certainty,evidence,{kind:'field-binding',assumption:'Field mapping is declared or statically extracted; runtime value equality remains unknown'});
      if(isFn&&!fieldExpanded.has(cid)&&depth<8){fieldExpanded.add(cid);
        try{
          const lineage=(deps.fieldLineage||((name)=>require('./fieldtrace').dbFields(env,name)))(o.db+':'+o.object);
          const field=lineage.fields.find(f=>f.field===name);
          for(const read of arr(field?.reads)){
            const hit=read.match(/^([^.]+\.[^.]+)\.([^.]+)$/);
            if(hit)dbTarget(cid,{db:o.db,table:hit[1],access:'SQL expression reads'},'static',{object:o.object,field:name,expression:field.expression,bodyLine:field.line},[hit[2]],depth+1);
          }
          if(!field?.reads?.length)gap('function-lineage-unresolved','No supported SQL field expression was resolved; dynamic SQL and procedures may require manual inspection',{object:key,column:name});
        }catch{gap('function-lineage-unavailable','Function body lineage could not be read from the retained catalog',{object:key});}
      }
    }
    if(dbStack.has(id)){gap('database-cycle','A retained database dependency cycle was closed without repeating traversal',{object:key});return;}
    if(dbExpanded.has(id))return;
    if(depth>=8||dbExpanded.size>=64){gap('database-budget','Database traversal reached eight hops or 64 objects; narrow the path',{object:key});return;}
    dbExpanded.add(id);dbStack.add(id);
    // The legacy usage index merges overloads. Do not attribute its union to one signature.
    if((isFn||['view','matview'].includes(o.kind))&&candidates.length>1)gap('routine-dependencies-ambiguous','Usage dependencies are merged across overloads; supply reviewed signature-specific database_links',{object:key});
    else if(isFn||['view','matview'].includes(o.kind)){
      for(const dep of arr(o.uses).filter(d=>d.source==='db'&&!d.ambiguous&&['calls','read','write','selects'].includes(d.role)).slice(0,50))dbTarget(id,{db:dep.db||o.db,object:dep.target,access:dep.role},'static',{kind:'catalog-sql-dependency',source:o.object,sourceSignature:sig,detail:dep.detail,where:dep.where},[],depth+1);
      if(arr(o.uses).some(d=>d.ambiguous))gap('database-dependency-ambiguous','Ambiguous SQL references were not followed',{object:key});
      if(arr(o.uses).length>50)gap('database-dependency-budget','Only the first 50 dependencies per database object are followed',{object:key});
      gap('sql-static-coverage','Cached SQL dependencies are static; dynamic SQL, predicates, triggers and field-value equality are not proven',{object:key});
    }
    for(const [index,link] of arr(definition.database_links).entries())if(link.db===o.db&&link.object===o.object&&(link.signature===undefined||signature({signature:link.signature})===sig)){
      matchedDbLinks.add(index);dbTarget(id,{db:link.target_db,object:link.target_object,signature:link.target_signature,access:link.access||'reviewed database link'},'declared',{reason:link.reason,sourceSignature:sig,review:'Recheck this declaration after a catalog refresh'},arr(link.columns),depth+1);
    }
    dbStack.delete(id);
  }
  while(queue.length&&expanded.size<20){
    E.check();const item=queue.shift(),{service,from,request}=item,sid='service:'+service;
    const bound=definition.services.find(s=>s.service===service&&(!s.path||s.path===request.path)&&(!s.method||s.method===request.method));
    const visit=digest([service,bound?.entry||request.handler,request.path,request.method]);
    node({id:sid,kind:'service',name:service});edge(from,sid,request.method+' '+request.path,item.certainty,item.evidence,{kind:'handler-candidate'});
    if(expanded.has(visit))continue;expanded.add(visit);
    let p;try{p=loadPassport(service);}catch{gap('passport-unavailable','Service passport is unavailable',{service});continue;}
    if(p?.env&&p.env!==env){gap('environment-mismatch','Passport environment differs from the diagram; no source path was attached',{service});continue;}
    const repo=typeof p?.repo==='string'?p.repo:p?.repo?.project+'/'+p?.repo?.repo,sha=p?.repo?.sha;
    retainedAnalyses??=analyses();
    let selected=bound?retainedAnalyses.find(a=>a.id===bound.analysis):retainedAnalyses.find(a=>a.repo===repo&&a.sha===sha&&!a.workspace);
    if(!selected||selected.repo!==repo||selected.sha!==sha){gap('analysis-missing','Select an exact retained Joern analysis matching this passport revision; no parse is started',{service,repo,sha});continue;}
    const analysis=deps.loadAnalysis?deps.loadAnalysis(selected.id):require('./semantic-code').load(selected.id);
    let selector=bound?.entry;
    if(!request.handler&&!request.where){
      const candidates=arr(p?.effective?.endpoints).filter(e=>(!e.method||e.method==='ANY'||e.method===request.method)&&e.path===request.path);
      if(candidates.length===1){request.handler=candidates[0].handler;request.where=candidates[0].file?candidates[0].file+':'+candidates[0].line:'';}
      else if(candidates.length>1)gap('downstream-handler-ambiguous','Declared transport matches multiple ingress handlers',{service});
    }
    if(!selector){const at=String(request.where||'').match(/^(.*):(\d+)$/);if(at)selector={kind:'method',file:at[1],line:Number(at[2])};else if(request.handler)selector={kind:'method',signature:request.handler};}
    if(!selector){gap('handler-unresolved','A precise retained entry selector is required',{service});continue;}
    let result;try{result=await query(analysis,selector);}catch{E.check();gap('joern-unavailable','Retained Joern map could not be queried; inspect semantic capabilities or select a compatible worker',{service,analysis:selected.id});continue;}
    const map=result.flowMap;if(!map?.entries?.length){gap('entry-unresolved','No unique Joern entry was resolved; correct the service entry selector',{service,analysis:selected.id});continue;}
    groups.push({id:'group:'+digest(visit).slice(0,12),service,analysis:selected.id,repo,sha,members:[]});const group=groups.at(-1);
    for(const n of map.nodes){const id=service+':'+n.id;if(node({...n,id,kind:n.kind||'state',name:n.code||n.kind,service,group:sid})){group.members.push(id);}}
    for(const entry of map.entries)edge(sid,service+':'+entry,'retained entry',bound?'declared':'static',{analysis:selected.id,selector,...(bound?{reason:bound.reason||'Recipe-selected handler binding; runtime dispatch is unverified'}:{})},{kind:'entry-binding'});
    for(const {id,from,to,...e} of map.edges)edge(service+':'+from,service+':'+to,e.polarity||e.kind,'static',e.evidence,e);
    for(const n of map.nodes){const from=service+':'+n.id;
      for(const call of arr(p?.effective?.dbCalls).filter(c=>c.file===n.file&&c.line===n.line))dbTarget(from,{db:call.db,function:call.function||call.name||call.call,access:'function / procedure call'},'static',{repo,sha,file:n.file,line:n.line});
      for(const portId of arr(n.ports)){
        const port=map.ports.find(p=>p.id===portId);if(!port)continue;const b=port.boundary||{};
        if(['db-read','db-write'].includes(port.portType))dbTarget(from,{...b,access:port.portType},port.certainty||'declared',port.evidence,arr(b.columns));
        if(port.portType==='http-egress'){
          if(b.target_service&&b.path&&b.method)enqueue(b.target_service,from,{path:b.path,method:b.method},'declared',{port:port.id,evidence:port.evidence,mappings:port.mappings});
          else gap('http-target-unresolved','HTTP boundary lacks an explicit target service, verb or path',{service,node:from});
        }
      }
      for(const f of definition.fields.filter(f=>f.service===service&&f.repo===n.repo&&f.sha===n.sha&&f.file===n.file&&f.line===n.line))dbTarget(from,{db:f.db,object:f.object,signature:f.signature,access:'declared binding'},'declared',{reason:f.reason,file:f.file,line:f.line},[f.column]);
      for(const b of arr(definition.databases).filter(b=>b.service===service&&b.repo===n.repo&&b.sha===n.sha&&b.file===n.file&&b.line===n.line))dbTarget(from,{db:b.db,object:b.object,signature:b.signature,access:'declared database binding'},'declared',{reason:b.reason,file:b.file,line:b.line},arr(b.columns));
      for(const t of definition.transports.filter(t=>t.service===service&&t.repo===n.repo&&t.sha===n.sha&&t.file===n.file&&t.line===n.line))enqueue(t.target_service,from,{path:t.path,method:t.method},'declared',{reason:t.reason,file:t.file,line:t.line});
    }
    for(const g of arr(result.gaps).slice(0,30))gap('joern-'+g.kind,g.detail||g.message||'Static analysis gap',{service});
    for(const assumption of arr(map.assumptions))gap('static-assumption',assumption.detail,{service});
  }
  if(queue.length)gap('service-budget','Service traversal reached 20 distinct entries; remaining branches were omitted');
  // Manual downstream identities still need a real ingress match, never a service-wide fan-out.
  const dangling=edges.filter(e=>e.kind==='handler-candidate').length;
  const atSource=(id,b)=>{const n=all.get(id);return n?.service===b.service&&n.repo===b.repo&&n.sha===b.sha&&n.file===b.file&&n.line===b.line;};
  for(const f of definition.fields)if(!edges.some(e=>e.kind==='field-binding'&&atSource(e.from,f)&&all.get(e.to)?.db===f.db&&all.get(e.to)?.object===f.object&&all.get(e.to)?.column===f.column))gap('field-binding-unmatched','Declared field binding did not match a returned state and catalog field',{service:f.service,file:f.file,line:f.line,column:f.column});
  for(const t of definition.transports)if(!edges.some(e=>e.kind==='handler-candidate'&&atSource(e.from,t)&&e.to==='service:'+t.target_service))gap('transport-binding-unmatched','Declared transport binding did not match the exact returned source state',{service:t.service,file:t.file,line:t.line});
  for(const b of arr(definition.databases))if(!edges.some(e=>e.kind==='database-boundary'&&atSource(e.from,b)&&all.get(e.to)?.db===b.db&&all.get(e.to)?.object===b.object))gap('database-binding-unmatched','Declared database binding did not match the exact source state and catalog object',{service:b.service,file:b.file,line:b.line});
  for(const [index,link]of arr(definition.database_links).entries())if(!matchedDbLinks.has(index))gap('database-link-unmatched','Reviewed database link source was not reached or its signature did not match',{object:link.db+':'+link.object});
  return {protocol:'dt.ui-trace/v1',id:recipe.id,revision:recipe.revision,title:definition.title,description:definition.description,env,at:new Date().toISOString(),definition,state,exchanges:exchanges.slice(0,50).map(publicExchange),nodes,edges,groups,gaps,proof:{runtime:'browser-requests-only',distributedExecution:'unknown',feasibility:'unknown',fieldValues:'unverified',complete:false},counts:{requests:exchanges.slice(0,50).length,services:nodes.filter(n=>n.kind==='service').length,states:new Set(groups.flatMap(g=>g.members)).size,tables:nodes.filter(n=>n.kind==='table').length,routines:nodes.filter(n=>['function','procedure'].includes(n.kind)).length,fields:nodes.filter(n=>n.kind==='column').length,connections:edges.length,handlerCandidates:dangling}};
}
function present(model) {
  const view=require('./results').saveView('ui-trace',model,{title:model.title,env:model.env,story:A.owner().storyId});
  const result=view.split('/').pop(),preview={id:model.id,revision:model.revision,counts:model.counts,proof:model.proof,gaps:model.gaps.slice(0,8).map(g=>Object.fromEntries(['kind','detail','service','object','column'].filter(k=>g[k]!==undefined).map(k=>[k,String(g[k]).slice(0,k==='detail'?350:120)]))),gapsTotal:model.gaps.length,view,workbench:require('./results').publicUrl()+'/ui-trace?result='+result+'&story='+encodeURIComponent(A.owner().storyId),next:'Open the UI trace to expand service paths, inspect evidence, edit the replay recipe or run an explicit read-only field query.'};
  while(preview.gaps.length&&Buffer.byteLength(JSON.stringify(preview))>7900)preview.gaps.pop();
  preview.previewTruncated=preview.gaps.length<model.gaps.length||model.gaps.some(g=>String(g.detail||'').length>350);return preview;
}
async function collect(args,{log=()=>{}}={}) {
  const recipe=get(args.id,args.revision),env=args.env||C.envNames()[0];A.checkEnv(env);C.getEnv(env);
  let state={},exchanges=[],gaps=[];
  if(args.previous){const old=retained(args.previous);if(old.id!==recipe.id)throw error('Previous result belongs to a different recipe');state=old.state;exchanges=old.exchanges;gaps.push({kind:'retained-browser-state',detail:'Screenshot and HTTP observations are retained from '+old.at+'; code/catalog evidence is collected again'});}
  if(args.capture){log('Replaying UI recipe in an isolated browser');const r=await require('./ui-trace-browser').capture(recipe.definition.recipe,args.params||{});state=r.state;exchanges=r.exchanges;gaps=r.gaps;}
  if(args.exchange_ids?.length)exchanges=args.exchange_ids.map(id=>require('./api-client').get(id));
  log('Joining requests to retained Joern paths and catalog fields');const model=await graph({recipe,env,state,exchanges,gaps});E.check();return present(model);
}
async function run(args={}) {
  const J=require('./jobs');if(args.job){const job=J.find(args.job);if(!job?.key.startsWith('ui-trace:'))throw error('UI trace job is unavailable','DT_NOT_FOUND',404);return require('./semantic-code').waitJob(job,args.waitMs||0);}
  if(!args.id)throw error('id or job is required');
  const recipe=get(args.id,args.revision);args={...args,revision:recipe.revision};const job=J.start('ui-trace:'+crypto.randomUUID(),'UI trace '+args.id,log=>collect(args,{log}));return require('./semantic-code').waitJob(job,args.waitMs||0);
}
function queryDraft(node,env) {
  if(!node||!['table','column'].includes(node.kind)||['function','procedure','aggregate','window'].includes(node.objectKind))return null;
  const parts=node.object.split('.');if(parts.length!==2)return null;
  const columns=node.column?quote(node.column):arr(node.columns).slice(0,8).map(c=>quote(c.name)).join(', ');if(!columns)return null;
  return {env,db:node.db,sql:`SELECT ${columns} FROM ${parts.map(quote).join('.')} WHERE FALSE LIMIT 20`};
}
module.exports={validate,save,edit,get,list,retained,graph,present,collect,run,queryDraft};
