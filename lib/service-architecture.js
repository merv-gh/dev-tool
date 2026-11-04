// A scoped, immutable service dossier. Discovery is evidence collection, never publication.
const crypto = require('node:crypto');
const C = require('./config'), E = require('./execution');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const bounded = (n, fallback, max) => Math.max(1, Math.min(max, Number(n) || fallback));
const unresolved = value => /^(?:\?|unresolved\b)|\$\{|<unknown|<unresolved/.test(String(value||''));
const arr = value => Array.isArray(value) ? value : [];
const repository = p => p?.repo?.project && p?.repo?.repo ? `${p.repo.project}/${p.repo.repo}` : typeof p?.repo === 'string' ? p.repo : null;
const clip = (value, max=2000) => String(value ?? '').slice(0,max);
function location(p, row={}) {
  const lib = row.source && arr(p.libraries).find(l=>l.artifactId===row.source);
  return { repo: lib ? repository(lib) || (typeof lib.repo==='string'?lib.repo:null) : repository(p), revision: lib ? lib.sha || null : p.repo?.sha || null,
    file: row.file && row.file !== 'config' ? row.file : null, line: row.line || null, handler: row.handler || row.methodSignature || null, origin: row.manual?'manual':'passport', ...(row.manual?{reason:row.provenance?.reason}:{}), library: lib?.artifactId || null };
}
const citation = source => [source.repo,source.revision,source.file && source.file+':'+(source.line||'?'),source.reason].filter(Boolean).join(' · ');
function inventory(p, env) {
  const entries=[], connections=[], gaps=[], eff=p.effective||{}, seen=new Set();
  function connection(kind,target,row,extra={}) {
    if(!target)return; if(connections.length>=10000){if(!gaps.some(g=>g.kind==='connection-budget'))gaps.push({kind:'connection-budget',message:'Connection inventory capped at 10000 records'});return;}
    const source=location(p,row), certainty=row.manual?'declared':unresolved(target)?'candidate':source.file&&source.line?'static':'candidate';
    const value={kind,unresolvedTarget:unresolved(target),target:clip(target,1000),name:clip(extra.name||target,300),access:extra.access||'unknown',source,certainty,evidence:[citation(source)].filter(Boolean),...extra};
    const id='boundary:'+hash([kind,target,value.access,source]);if(seen.has(id))return;seen.add(id);connections.push({...value,id});
  }
  function entry(kind,name,row,extra={}) { if(entries.length>=500)return;const source=location(p,row),id='entry:'+hash([kind,name,source]);if(entries.some(e=>e.id===id))return;entries.push({id,kind,name:clip(name,500),handler:source.handler,source,...extra}); }
  for(const x of arr(eff.endpoints))entry('http',`${x.method||'ANY'} ${x.path||'unresolved path'}`,x,{boundary:{method:x.method,path:x.path,host:x.host}});
  for(const x of arr(eff.consumes||eff.kafka?.consumes)){entry('kafka','kafka '+(x.topic||'unresolved topic'),x,{topic:x.topic,cluster:x.cluster});connection('topic',x.topic,x,{access:'consume',cluster:x.cluster||null});}
  for(const x of arr(eff.produces||eff.kafka?.produces))connection('topic',x.topic,x,{access:'produce',cluster:x.cluster||null});
  for(const x of arr(eff.tables)){const modes=/write|insert|update|delete|save/i.test(x.access||'')?['write']:[];if(/read|select/i.test(x.access||'')||!modes.length)modes.push('read');for(const access of modes)connection('table',x.table,x,{access,db:x.db||null,columns:arr(x.columns).slice(0,100)});}
  for(const x of arr(eff.dbCalls))connection('function',x.function||x.name||x.call,x,{access:'execute',db:x.db||null});
  for(const x of arr(eff.calls||eff.feign)){const target=x.url||x.host||x.client||x.target||x.path;connection('api',target,x,{name:[x.client||x.target||x.host,x.method,x.path].filter(Boolean).join(' ')||target,access:'call',host:x.host||null,method:x.method||null,path:x.path||null,targetService:x.client||x.target||null});}
  for(const x of [...arr(p.es),...arr(eff.es)])connection('elasticsearch',x.index||x.name,x,{access:/save|write|index|update|delete|bulk/i.test(x.access||x.operation||'')?'write':/read|search|find/i.test(x.access||x.operation||'')?'read':'unknown'});
  for(const x of arr(eff.scheduled||p.scheduled))entry('scheduled',x.handler||x.registration||'Scheduled job',x,{schedule:x.schedule||x.cron||null});
  for(const f of arr(p.flows))if(!arr(p.portAdjustments?.disabled).some(port=>port.handler?.signature===(f.handler||f.method))&&!entries.some(e=>e.kind===f.kind&&(e.name===f.entry||e.handler&&e.handler===(f.handler||f.method))))entry(f.kind||'unknown',f.entry,{handler:f.handler||f.method},{summary:f});
  for(const f of p.portAdjustments?.revision?[]:arr(p.flows)){const out=f.out||{};for(const [field,kind,name,access]of [['tables','table','table',null],['produces','topic','topic','produce'],['http','api','call','call'],['functions','function','function','execute'],['es','elasticsearch','index','unknown']])for(const x of arr(out[field])){const at=arr(x.at).length?x.at[0]:x.at||'',file=String(at).replace(/:\d+$/,''),line=Number(String(at).match(/:(\d+)$/)?.[1])||null;connection(kind,x[name],{file:file||null,line,handler:f.handler||f.method},{access:access||x.access||'unknown',summaryOnly:true});}}
  for(const port of arr(eff.ports))for(const e of entries)if(e.handler===port.handler?.signature&&e.source.file===port.handler?.file)e.portId=port.id;
  if(!p.env)gaps.push({kind:'passport-environment-unknown',message:'Source passport has no deployment environment; code evidence is not an observed deployment.'});
  else if(p.env!==env)gaps.push({kind:'passport-environment-mismatch',message:`Source passport is bound to ${p.env}; deployment observations for ${env} do not establish that this source is deployed.`});
  if(entries.length>=500)gaps.push({kind:'entry-budget',message:'Entry-point inventory capped at 500 records'});
  if(p.portAdjustments?.revision)gaps.push({kind:'manual-passport-overlay',message:'Effective manual ports are retained separately from detected source paths. Stale passport flow summaries are not replayed over manual corrections.'});
  if(!p.repo?.sha)gaps.push({kind:'source-revision-missing',message:'The passport does not identify an exact source commit; deployed identity and Joern coverage remain unresolved.'});
  const incomplete=connections.filter(c=>c.kind==='table'&&!c.db||c.kind==='topic'&&!c.cluster||c.kind==='elasticsearch'&&c.access==='unknown');
  if(incomplete.length)gaps.push({kind:'boundary-identity-incomplete',count:incomplete.length,message:'Some DB aliases, Kafka clusters or Elasticsearch access modes are unresolved; names do not establish global identity or a write.'});
  return {entries,connections,gaps};
}
// Runs in the existing bounded worker. No PostgreSQL catalogs are loaded: only the pinned code closure.
function codeFlows({keys,entries,service,maxDepth=20,maxEntries=100,approximateKeys=[]}) {
  const G=require('./impact').load({repos:keys}), CI=require('./codeindex'), nodes=new Map(), edges=new Map(), flows=[], gaps=arr(G.gaps).slice(0,100), indexMeta=new Map(keys.map(k=>[k,CI.load(k)]));
  const handlerIndex=new Map();for(const n of G.nodes.values())if(n.kind==='method'&&!n.test){for(const key of new Set([n.legacyId,n.symbol,n.name].filter(Boolean))){const values=handlerIndex.get(key)||[];values.push(n);handlerIndex.set(key,values);}}
  const source=n=>{const idx=indexMeta.get(n?.repo)||CI.load(n?.repo);return {repo:idx?.baseKey||n?.repo,revision:idx?.sha||null,file:n?.file||null,line:n?.line||null,signature:n?.symbol||n?.legacyId||null};};
  entries=[...entries];
  const normalized=h=>String(h||'').includes('#')?String(h):String(h||'').replace(/\.([^.(]+)(?=\(|$)/,'#$1');
  const addEntry=(kind,name,n,extra={})=>{if(!n||entries.length>=500||entries.some(e=>e.source.file===n.file&&[n.legacyId,n.symbol,n.name].includes(normalized(e.handler))))return;const loc=source(n);entries.push({id:'entry:'+hash([kind,name,loc]),kind,name,handler:n.symbol||n.legacyId,source:{...loc,handler:n.symbol||n.legacyId,origin:'code'},...extra});};
  const entryAnnotations={Scheduled:'scheduled',EventListener:'event',TransactionalEventListener:'event',RabbitListener:'queue',JmsListener:'queue',SqsListener:'queue'};
  for(const n of G.nodes.values())if(n.kind==='method'&&!n.test)for(const annotation of arr(n.annos))if(entryAnnotations[annotation])addEntry(entryAnnotations[annotation],entryAnnotations[annotation]+' '+n.name,n);
  for(const [from,list]of G.fwd)for(const edge of list){if(edge.kind==='handler'&&from.startsWith('endpoint:'))addEntry('http',from.slice(9),G.nodes.get(edge.to));if(edge.kind==='consumes'&&edge.to.startsWith('topic:'))addEntry('kafka','kafka '+edge.to.slice(6),G.nodes.get(from),{topic:edge.to.slice(6)});}
  const put=n=>{const id='method:'+hash(n.id);if(!nodes.has(id)&&nodes.size<10000)nodes.set(id,{id,name:n.name||n.symbol||n.id,kind:'component',parent:'svc:'+service,technology:'Indexed method',source:'code',evidence:[citation(source(n))],locator:source(n),nativeId:n.id});return id;};
  const edge=(from,to,kind,where,extra={})=>{const id='code-edge:'+hash([from,to,kind,where]);if(!edges.has(id)&&edges.size<20000)edges.set(id,{id,from,to,label:kind,certainty:extra.ambiguous||approximateKeys.includes(G.nodes.get(nodes.get(from)?.nativeId)?.repo)?'candidate':'static',source:'code',evidence:[where].filter(Boolean),fields:[],...extra});return id;};
  function boundary(raw, e, from) {
    const n=G.nodes.get(raw), legacy=n?.legacyId||raw; let kind,target,access=e.kind;
    if(/^(table|pgfn|es|topic|endpoint):/.test(legacy)){const [prefix,...parts]=legacy.split(':');kind=({table:'table',pgfn:'function',es:'elasticsearch',topic:'topic',endpoint:'api'})[prefix];target=parts.join(':');if(prefix==='topic')access='produce';}
    else if(raw.startsWith('ext:')){
      const type=raw.slice(4).split('#')[0],call=raw.split('#')[1]||'';
      kind=/Elasticsearch|RestHighLevelClient/.test(type)?'elasticsearch':/KafkaTemplate|KafkaProducer|StreamBridge/.test(type)?'topic':/Jdbc|EntityManager|DataSource|Repository/.test(type)?'table':/RestTemplate|WebClient|RestClient|HttpClient|Feign/.test(type)?'api':null;
      if(!kind)return null;target='unresolved '+type.split('.').pop()+'.'+call;access=kind==='api'?'call':kind==='topic'?'produce':/save|write|insert|update|delete|index|bulk|persist/i.test(call)?'write':/read|query|select|find|search|get/i.test(call)?'read':'unknown';
    } else return null;
    const id='code-boundary:'+hash([kind,target,from,e.where]), locator=source(G.nodes.get(from));
    if(!nodes.has(id)&&nodes.size<10000)nodes.set(id,{id,name:target,kind:kind==='table'?'table':kind==='topic'?'topic':kind==='api'?'external':'database',source:'code',technology:kind,evidence:[e.where].filter(Boolean),boundary:{kind,target,access,entityLocations:arr(e.types).flatMap(type=>[...G.classes.values()].filter(c=>c.role==='document'&&c.repo===G.nodes.get(from)?.repo&&(c.name===String(type).split('.').pop()||c.legacyId===type)).map(c=>source(c))),source:{...locator,file:e.where?.replace(/:\d+$/,'')||locator.file,line:Number(e.where?.match(/:(\d+)$/)?.[1])||locator.line},resolved:!unresolved(target)}});
    return {id,kind,target,access};
  }
  for(const entry of entries.slice(0,maxEntries)){
    E.check();const handler=String(entry.handler||'').includes('#')?String(entry.handler):String(entry.handler||'').replace(/\.([^.(]+)(?=\(|$)/,'#$1'),candidates=(handlerIndex.get(handler)||[]).filter(n=>!entry.source.file||n.file===entry.source.file);
    let starts=candidates;if(starts.length>1&&entry.source.line){const exact=starts.filter(n=>n.line<=entry.source.line&&entry.source.line<=(n.endLine||n.line));if(exact.length)starts=exact;}
    if(starts.length!==1){flows.push({id:'flow:'+hash(entry.id),entry:entry.id,title:entry.name,status:starts.length?'ambiguous-handler':'missing-handler',nodes:[],edges:[],paths:[],boundaries:[],proof:{status:'unavailable',runtime:'unknown'},gaps:[{kind:starts.length?'ambiguous-handler':'handler-unresolved',handler:entry.handler,candidates:starts.slice(0,20).map(source)}]});continue;}
    const start=starts[0],queue=[start.id],depth=new Map([[start.id,0]]),previous=new Map(),selectedNodes=new Set([put(start)]),selectedEdges=new Set(),paths=[],boundaries=[];let truncated=false;
    for(let cursor=0;cursor<queue.length;cursor++){
      if(queue.length>=1000||selectedEdges.size>=2000||nodes.size>=10000||edges.size>=20000){truncated=true;break;}const current=queue[cursor],from=put(G.nodes.get(current));
      for(const e of G.fwd.get(current)||[]){
        if(['calls','dispatch'].includes(e.kind)&&G.nodes.get(e.to)?.kind==='method'&&G.nodes.get(e.to)?.known!==false){
          const target=G.nodes.get(e.to),to=put(target);selectedNodes.add(to);const id=edge(from,to,e.kind,e.where,{ambiguous:!!e.ambiguous||approximateKeys.includes(e.repo)||approximateKeys.includes(G.nodes.get(e.to)?.repo)});selectedEdges.add(id);
          if(!depth.has(e.to)&&depth.get(current)<maxDepth){depth.set(e.to,depth.get(current)+1);previous.set(e.to,{node:current,edge:id});queue.push(e.to);}else if(!depth.has(e.to))truncated=true;
        }else{
          if(e.kind==='consumes')continue;const b=boundary(e.to,e,current);if(!b)continue;selectedNodes.add(b.id);const id=edge(from,b.id,b.access,e.where,{boundary:true});selectedEdges.add(id);boundaries.push({...b,edge:id,method:from});
          if(paths.length<100){const ns=[from],es=[id];let cursor=current;while(previous.has(cursor)){const p=previous.get(cursor);es.unshift(p.edge);ns.unshift(put(G.nodes.get(p.node)));cursor=p.node;}ns.push(b.id);paths.push({id:'path:'+hash([entry.id,id]),nodes:ns,edges:es,boundary:b.id,role:b.access==='read'?'read-dependency':'exit-or-boundary',proof:{status:es.some(k=>edges.get(k)?.certainty==='candidate')?'static-candidate':'static-call-reachability',valueFlow:'unverified',runtime:'unknown'}});}else truncated=true;
        }
      }
      for(const e of G.rev.get(current)||[])if(e.kind==='produced-by'){
        const b=boundary(e.from,e,current);if(!b)continue;selectedNodes.add(b.id);const id=edge(from,b.id,'produce',e.where,{boundary:true});selectedEdges.add(id);boundaries.push({...b,edge:id,method:from});const ns=[from],es=[id];let cursor=current;while(previous.has(cursor)){const p=previous.get(cursor);es.unshift(p.edge);ns.unshift(put(G.nodes.get(p.node)));cursor=p.node;}ns.push(b.id);if(paths.length<100)paths.push({id:'path:'+hash([entry.id,id]),nodes:ns,edges:es,boundary:b.id,role:'exit',proof:{status:es.some(k=>edges.get(k)?.certainty==='candidate')?'static-candidate':'static-call-reachability',valueFlow:'unverified',runtime:'unknown'}});else truncated=true;
      }
    }
    flows.push({id:'flow:'+hash(entry.id),entry:entry.id,title:entry.name,status:'indexed',nodes:[...selectedNodes],edges:[...selectedEdges],paths,boundaries,handler:put(start),proof:{status:'static-call-reachability',valueFlow:'unverified',runtime:'unknown'},truncated,gaps:truncated?[{kind:'flow-budget',message:'Method/depth/path budget reached; this is a bounded reachable graph, not every possible execution trace.'}]:[]});
  }
  if(entries.length>maxEntries)gaps.push({kind:'flow-entry-budget',message:`Indexed ${maxEntries} of ${entries.length} discovered entries`});
  return {nodes:[...nodes.values()],edges:[...edges.values()],flows,gaps,entries};
}
async function documents(p, inv, args) {
  const records=[],gaps=[], queries=[args.query,p.service,...inv.connections.map(c=>c.target)].filter(Boolean).slice(0,12),seen=new Set(),max=bounded(args.docs_limit,40,100);let bytes=0;
  for(const query of queries){E.check();try{const found=await require('./docs-search').search(query,{spaces:args.spaces,limit:20,hybrid:false,rerank:false});if(found.note&&!gaps.some(g=>g.kind==='documentation-index-missing'))gaps.push({kind:'documentation-index-missing',message:found.note});for(const b of found.blocks||[]){if(records.length>=max||bytes>192*1024)break;if(seen.has(b.id))continue;const verify=require('./docs-search').verify([{blockId:b.id,space:b.space,version:b.version,text:(b.quotes||[b.text]).join(' … ')}])[0];if(!verify?.verified)continue;seen.add(b.id);const text=clip((b.quotes||[b.text]).join(' … '),4000);bytes+=Buffer.byteLength(text);records.push({id:b.id,title:b.title,text,url:b.url,space:b.space,pageId:b.pageId,revision:b.version,kind:/\b(must|shall|required|should)\b|долж|необходимо|требован/i.test(text)?'requirement-candidate':'documentation',provenance:{source:'confluence',status:'stated',blockId:b.id,revision:b.version},query,verifiedQuote:true,implementation:'unverified'});}}catch(error){E.check();gaps.push({kind:'documentation-search-failed',message:clip(error.message)});break;}}
  if(args.live_docs){try{const client=require('./docs-cache').createClient(),q=JSON.stringify(args.query||p.service),spaces=require('./docs-cache').spacesOf(args.spaces),cql=`type=page and text ~ ${q}`+(spaces.length?' and space in ('+spaces.map(s=>JSON.stringify(s)).join(',')+')':''),response=await client.request('/rest/api/content/search?limit=5&expand=body.storage,version,space&cql='+encodeURIComponent(cql));for(const page of arr(response.results).slice(0,5)){if(records.length>=max)break;const raw=page.body?.storage?.value;if(typeof raw!=='string'||raw.length>512*1024){gaps.push({kind:'live-page-body-unavailable',page:page.id});continue;}const fresh={id:String(page.id),space:page.space?.key||spaces[0]||'',title:page.title,version:page.version?.number||null,storage:raw},parsed=require('./docs-parse').parse(fresh);for(const b of parsed.blocks){if(records.length>=max||bytes>192*1024)break;if(seen.has(b.id)||['heading','diagram','issue'].includes(b.kind))continue;const text=clip(b.text,4000);if(!text)continue;seen.add(b.id);bytes+=Buffer.byteLength(text);records.push({id:b.id,title:page.title,text,url:page._links?.webui?new URL(page._links.webui,client.cfg.url).href:null,revision:fresh.version,space:fresh.space,kind:/must|shall|required|долж|необходимо/i.test(text)?'requirement-candidate':'documentation',provenance:{source:'confluence-live',status:'stated',blockId:b.id,revision:fresh.version},verifiedQuote:true,implementation:'unverified'});}}}catch(error){E.check();gaps.push({kind:'live-documentation-unavailable',message:clip(error.message)});}}
  for(const d of require('./architecture-store').knowledge()){if(records.length>=max)break;if(d.entities.includes('service:'+p.service)||d.text.toLowerCase().includes(p.service.toLowerCase()))records.push({...d,text:clip(d.text,4000),kind:'architecture-explanation',revision:d.provenance.revision,implementation:'unverified'});}
  if(records.length>=max)gaps.push({kind:'documentation-budget',message:`Documentation evidence capped at ${max} blocks; search the sources for additional requirements.`});
  return {records,gaps};
}
async function semantics(p, code, args, log) {
  const S=require('./semantic-code'),CI=require('./codeindex'),gaps=[],closure=new Map([[repository(p),p.repo?.sha],...arr(p.libraries).filter(l=>repository(l)&&l.sha).map(l=>[repository(l),l.sha])]);
  const sources=a=>arr(a.sources).length?a.sources:[a];
  const matching=()=>S.list({versions:true}).analyses.filter(a=>(!a.env||a.env===args.env)&&sources(a).every(s=>closure.has(s.repo)&&closure.get(s.repo)===s.sha));
  let matches=matching();
  let selected=args.analyses?.length?args.analyses.map(S.load):[];
  for(const a of selected)if(!matches.some(m=>m.id===a.id))throw Object.assign(Error('Selected Joern analysis does not match the service source revision/environment'),{code:'DT_ARGUMENT_INVALID'});
  const pins=[{key:p.codeIndex,repo:repository(p),sha:p.repo?.sha},...arr(p.libraries).filter(l=>l.index&&repository(l)&&l.sha).map(l=>({key:l.index,repo:repository(l),sha:l.sha,artifactId:l.artifactId,version:l.version,exactVersion:l.exactVersion}))];
  const required=pins.flatMap(pin=>{let idx;try{idx=pin.key&&CI.load(pin.key);}catch{}const languages=new Set(arr(idx?.list).flatMap(f=>/\.java$/i.test(f.path)?['java']:/\.(?:[cm]?js|jsx|ts|tsx)$/i.test(f.path)?['js']:[]));return [...(languages.size?languages:[null])].map(language=>({...pin,language}));});
  const missing=()=>required.filter(pin=>!matches.some(a=>(!pin.language||a.language===pin.language)&&sources(a).some(s=>s.repo===pin.repo&&s.sha===pin.sha)));
  let indexing={state:args.analyses?.length?'selected':args.joern===false?'disabled':'reused'};
  if(args.joern!==false&&!args.analyses?.length&&missing().length){
    if(!S.capabilities().configured){indexing={state:'unconfigured'};gaps.push({kind:'semantic-worker-unconfigured',message:'Configure semantic.url and semantic.token (or enable the bundled semantic worker) to build missing Joern analyses.'});}
    else try{
      E.check();log('Build missing Joern analyses from pinned service/library revisions');
      const r=await S.index({sourceRevisions:pins,env:args.env,service:p.service,composite:true,waitMs:0}),J=require('./jobs'),child=r.job&&J.find(r.job);
      indexing={state:r.state||'running',job:r.job,automatic:true};log('Joern indexing job '+r.job);
      const done=child?await E.track(child.promise,()=>J.cancel(child.id,'Service architecture cancelled')):r;E.check();
      if(done.state!=='done'&&!done.ready)throw Error(done.error||'Joern indexing '+done.state);
      matches=matching();indexing={...indexing,state:'ready',reused:!!(done.result||done).reused};
      if(missing().length)gaps.push({kind:'semantic-index-incomplete',message:'Joern finished without analyses for every pinned source/language. Available exact coverage is retained.'});
    }catch(error){E.check();indexing={...indexing,state:'failed'};gaps.push({kind:'semantic-index-failed',message:clip(error.message)});}
  }
  if(!args.analyses?.length){const covered=new Set();selected=matches.filter(a=>{const keys=sources(a).map(s=>[s.repo,s.sha,a.language].join(':'));if(keys.every(k=>covered.has(k)))return false;keys.forEach(k=>covered.add(k));return true;}).map(a=>S.load(a.id));}
  const result={analyses:selected.map(({id,repo,sha,builtAt,language})=>({id,repo,sha,builtAt,language})),indexing,queries:[],gaps};
  if(!selected.length||!selected.some(a=>sources(a).some(s=>s.repo===repository(p)&&s.sha===p.repo?.sha)))gaps.push({kind:'semantic-index-missing',message:'No selected Joern analysis covers the exact service source. Native static paths remain available.'});
  if(!selected.length)return result;
  if(args.joern===false)return {...result,note:'Retained analyses listed; deep queries disabled'};
  log('Use '+selected.length+' retained Joern analyses at exact source revisions');
  const max=bounded(args.semantic_queries,12,40);let count=0;
  for(const flow of code.flows)for(const path of flow.paths){if(count>=max)break;E.check();const from=code.nodes.find(n=>n.id===path.nodes[0])?.locator,to=code.nodes.find(n=>n.id===path.nodes.at(-2))?.locator,b=code.nodes.find(n=>n.id===path.boundary)?.boundary;
    if(!from?.file||!from.line||!b?.source?.file||!b.source.line){gaps.push({kind:'semantic-locator-missing',flow:flow.id,path:path.id});continue;}
    const local=selected.filter(a=>a.repo===from.repo&&a.sha===from.revision||(a.sources||[]).some(s=>s.repo===from.repo&&s.sha===from.revision));if(!local.length)continue;
    const signature=String(from.signature||'').split('#').pop().replace(/\(.*$/,''),source={repo:from.repo,sha:from.revision,file:from.file,line:from.line,name:signature},sink={kind:'call',repo:b.source.repo,sha:b.source.revision,file:b.source.file,line:b.source.line};
    count++;log('Joern data-flow query '+count+' / '+max);try{const response=await require('./semantic-query').query({operation:'paths',mode:'dataflow',from:source,to:sink,maxHops:30,maxPaths:4,limit:20,budgetMs:Math.min(5000,Number(args.semantic_budget_ms)||3000)},selected,{runQuery:S.runQuery});const view=require('./results').saveView('semantic-analysis',response,{title:flow.title+' · boundary data-flow'});result.queries.push({flow:flow.id,path:path.id,analyses:selected.map(a=>a.id),proof:response.proof,paths:response.results.filter(r=>r.kind==='data-flow'&&r.proof?.status==='static-dataflow').slice(0,4),gaps:response.gaps.slice(0,20),ambiguity:arr(response.ambiguity).slice(0,20),truncated:response.truncated,view});}catch(error){E.check();gaps.push({kind:'semantic-query-failed',flow:flow.id,path:path.id,message:clip(error.message)});}
  }
  if(code.flows.reduce((n,f)=>n+f.paths.length,0)>count)gaps.push({kind:'semantic-query-budget',message:`Executed ${count} bounded Joern queries; remaining paths retain their native static proof.`});
  return result;
}
async function collect(args,{log=()=>{}}={}) {
  const service=args.service;if(!/^[a-zA-Z0-9][\w.-]{0,159}$/.test(service||''))throw Object.assign(Error('Invalid service name'),{code:'DT_ARGUMENT_INVALID'});
  const env=args.env||C.envNames()[0],envs=[...new Set([env,...(args.envs||C.envNames())])].slice(0,4);envs.forEach(e=>C.getEnv(e));args={...args,env};
  const sourceGaps=[];log('Read passport and pinned source revisions');let p=args.revision ? require('./passport/overrides').detectedPassport({service,revision:args.revision}) : require('./passport').loadDetected(service);p=require('./passport/overrides').apply(p,{env});
  if(args.revision&&args.refresh_passport)throw Object.assign(Error('Select an exact retained revision or refresh the current passport, not both'),{code:'DT_ARGUMENT_INVALID'});
  if(args.revision&&!p)throw Object.assign(Error('Exact passport revision is unavailable'),{code:'DT_NOT_FOUND',statusCode:404});
  if(args.refresh_passport||!p){const T=require('./tools'),r=await T.call('passport',{service,env,refresh:!!args.refresh_passport},{source:'architecture-service'});if(r.job){const J=require('./jobs'),job=J.find(r.job);if(job){const done=await E.track(job.promise,()=>J.cancel(job.id,'Service architecture cancelled'));E.check();if(done.state!=='done')sourceGaps.push({kind:'passport-refresh-failed',message:'Passport refresh '+done.state+'; retained source evidence may be older.'});}}else if(r.error)sourceGaps.push({kind:'passport-refresh-failed',message:clip(r.error)});p=require('./passport').load(service,{env});}
  if(!p)throw Error('Passport is unavailable; build the service passport first');
  const inv=inventory(p,env),keys=[typeof p.codeIndex==='string'?p.codeIndex:null,...arr(p.libraries).map(l=>l.index)].filter(Boolean),gaps=[...sourceGaps,...inv.gaps];
  for(const l of arr(p.libraries))if(l.exactVersion===false)gaps.push({kind:'approximate-library-version',repo:repository(l),revision:l.sha,requestedVersion:l.version,message:'Library source came from a fallback revision; paths through it are candidates.'});
  const verifiedKeys=keys.filter(k=>{const idx=require('./codeindex').load(k),expected=k===p.codeIndex?p.repo?.sha:arr(p.libraries).find(l=>l.index===k)?.sha;return idx&&(!expected||idx.sha===expected);});
  let code={nodes:[],edges:[],flows:[],gaps:[]};
  if(verifiedKeys.length){log('Trace entry points through pinned service and library code');try{code=await require('./isolate').exec('serviceArchitecture','codeFlows',[{keys:verifiedKeys,entries:inv.entries,service,maxEntries:bounded(args.max_flows,100,500),maxDepth:bounded(args.depth,20,40),approximateKeys:arr(p.libraries).filter(l=>l.exactVersion===false).map(l=>l.index)}]);}catch(error){E.check();gaps.push({kind:'code-flow-unavailable',message:clip(error.message)});}}
  else gaps.push({kind:'code-index-missing',message:'No pinned code index is available. Passport inventory is retained, without invented entry-to-exit paths.'});
  if(code.entries)inv.entries=code.entries;
  // Attach only unique resource identities; matching a name is not a method-call proof.
  for(const node of code.nodes.filter(n=>n.boundary)){
    const b=node.boundary;let candidates=inv.connections.filter(c=>c.kind===b.kind&&(c.access===b.access||c.access==='unknown'||b.access==='unknown')&&(c.target===b.target||c.kind==='api'&&c.source.file===b.source.file&&c.path&&b.target===`${c.method} ${c.path}`||!c.unresolvedTarget&&unresolved(b.target)&&(c.source.file===b.source.file&&c.source.line===b.source.line||arr(b.entityLocations).some(s=>s.file===c.source.file&&s.repo===c.source.repo&&s.revision===c.source.revision))));
    if(candidates.length>1){const exact=candidates.filter(c=>c.source.file===b.source.file&&c.source.line===b.source.line);if(exact.length)candidates=exact;}
    if(candidates.length===1){b.connection=candidates[0].id;node.name=candidates[0].name;b.target=candidates[0].target;b.resolved=!candidates[0].unresolvedTarget;}
    else if(candidates.length>1)gaps.push({kind:'ambiguous-boundary-identity',node:node.id,candidates:candidates.map(c=>c.id)});
    if(!b.connection||candidates[0]?.access==='unknown'&&b.access!=='unknown'){
      if(inv.connections.length<10000){const source={...b.source,origin:'code'},id='discovered:'+hash([b.kind,b.target,b.access,source]);if(!inv.connections.some(c=>c.id===id))inv.connections.push({id,kind:b.kind,target:b.target,name:b.target,access:b.access,source,certainty:b.resolved?'static':'candidate',evidence:node.evidence,identityComplete:b.resolved,discoveredInCode:true,unresolvedTarget:!b.resolved});b.connection=id;}
      else gaps.push({kind:'connection-budget',message:'Additional code-discovered boundaries exceeded the 10000-connection budget.'});
    }
  }
  for(const f of code.flows){const seen=new Set();f.paths=f.paths.filter(path=>{const b=code.nodes.find(n=>n.id===path.boundary)?.boundary,key=JSON.stringify([path.nodes.slice(0,-1),b?.kind,b?.target,b?.access]);if(seen.has(key))return false;seen.add(key);return true;});}
  const docs=args.include_docs===false?{records:[],gaps:[]}:await documents(p,inv,args);const nodeById=new Map(code.nodes.map(n=>[n.id,n])),flowByConnection=new Map();for(const f of code.flows)for(const path of f.paths){const id=nodeById.get(path.boundary)?.boundary?.connection;if(id){if(!flowByConnection.has(id))flowByConnection.set(id,new Set());flowByConnection.get(id).add(f.id);}}for(const r of docs.records){const text=String(r.text).toLowerCase();r.relatedConnections=inv.connections.filter(c=>!c.unresolvedTarget&&text.includes(String(c.target).toLowerCase())).slice(0,50).map(c=>c.id);r.relatedFlows=[...new Set(r.relatedConnections.flatMap(id=>[...(flowByConnection.get(id)||[])]))];r.binding='literal entity mention, not implementation proof';}
  log('Prepare Joern analyses and collect semantic evidence');const semantic=await semantics(p,code,args,log);
  log('Read environment observations');const O=require('./architecture-observations'),snapshots=Object.fromEntries(envs.map(e=>[e,O.snapshot(e)])),deployments=require('./architecture').deployments(service,snapshots,envs),routes=require('./routes').list({service}).filter(r=>(r.observed||r.count||r.seen)&&(!r.env||r.env===env)).slice(0,200).map(r=>({...r,attribution:'candidate-route-match'}));
  if(routes.length)gaps.push({kind:'runtime-route-attribution',message:'Observed wire routes are matched to source endpoints as candidates; they do not prove an entry-to-exit trace or deployed SHA.'});
  for(const e of envs)gaps.push(...arr(snapshots[e].gaps).map(g=>({...g,env:e})));
  for(const f of code.flows)gaps.push(...f.gaps.map(g=>({...g,flow:f.id})));
  gaps.push(...code.gaps,...docs.gaps,...semantic.gaps);for(const e of inv.entries)if(!code.flows.some(f=>f.entry===e.id))gaps.push({kind:'entry-flow-unavailable',entry:e.id,message:'Entry is inventoried; no path was established.'});
  const dossier={protocol:'dt.service-architecture/v1',service,identity:{env,repo:repository(p),revision:p.repo?.sha||null,passportAt:p.builtAt||null,overlayRevision:p.portAdjustments?.revision||null},at:new Date().toISOString(),envs,entries:inv.entries,connections:inv.connections,code,requirements:docs.records,semantic,observed:{deployments,routes,resources:envs.flatMap(e=>snapshots[e].resources.map(r=>({...r,env:e,stale:r.stale||snapshots[e].stale})))},gaps:gaps.slice(0,500),coverage:{entries:inv.entries.length,tracedEntries:code.flows.filter(f=>f.status==='indexed').length,connections:inv.connections.length,paths:code.flows.reduce((n,f)=>n+f.paths.length,0),requirements:docs.records.length,semanticQueries:semantic.queries.length,complete:false,meaning:'All discovered connections within the stated budgets; static reachability and documentation do not prove every runtime or value flow.'}};
  if(Buffer.byteLength(JSON.stringify(dossier))>12*1024*1024)throw Object.assign(Error('Service dossier exceeds 12 MiB; lower max_flows/depth/docs_limit'),{code:'DT_ARGUMENT_INVALID'});
  E.check();const model=projection({dossier},{type:'container',env,limit:250});return present(model);
}
function projection(original,args={}) {
  const d=original.dossier,env=args.env||d.identity.env,type=args.type||'container',limit=bounded(args.limit,250,250),sid='svc:'+d.service;
  const views=[{id:'service-c4',title:'Service C4 connections',type:'container'},{id:'service-components',title:'All reachable components',type:'component'}],flows=d.code.flows.map(f=>({id:f.id,title:f.title,description:'Indexed entry-to-boundary paths; value flow and runtime feasibility remain separate.',steps:[]}));
  let mode=type,flow=null,nodes=[],relations=[];if(args.saved_view==='service-c4')mode='container';if(args.saved_view==='service-components')mode='component';
  const root={id:sid,name:d.service,kind:'service',service:d.service,repo:d.identity.repo,revision:d.identity.revision,source:'passport',description:'Service source container; deployment identity is observed separately.',deployments:d.observed.deployments,metrics:d.observed.resources.filter(r=>r.target===sid),evidence:[d.identity.repo,d.identity.revision].filter(Boolean)};
  const cnode=c=>({id:c.id,name:c.name,certainty:c.certainty,kind:c.kind==='table'?'table':c.kind==='topic'?'topic':c.kind==='api'||c.unresolvedTarget?'external':'database',source:c.source.origin,technology:({table:'SQL table',topic:'Kafka',api:'HTTP',elasticsearch:'Elasticsearch',function:'SQL function'})[c.kind]||c.kind,description:c.access,evidence:c.evidence,connection:c.id});
  const q=String(args.q||'').toLowerCase();
  if(['dataflow','dynamic'].includes(mode)){
    const f=d.code.flows.find(f=>f.id===args.flow)||d.code.flows[0];if(f){const ids=new Set(f.nodes),es=new Set(f.edges);nodes=d.code.nodes.filter(n=>ids.has(n.id));relations=d.code.edges.filter(e=>es.has(e.id));flow={id:f.id,title:f.title,handler:f.handler,description:'Reachable call graph with separate boundary paths. Branches are not a single execution sequence.',proof:f.proof,paths:f.paths};}
  }else if(mode==='component'){nodes=d.code.nodes.filter(n=>!q||n.name.toLowerCase().includes(q));relations=d.code.edges;}
  else{mode='container';const selected=d.connections.filter(c=>!c.unresolvedTarget&&(!q||`${c.name} ${c.target} ${c.access}`.toLowerCase().includes(q))),resources=new Map(),resourceId=c=>'resource:'+hash([c.kind,c.target,c.db||null,c.cluster||null,c.host||null,c.method||null,c.path||null]);
    for(const c of selected){const id=resourceId(c);if(!resources.has(id))resources.set(id,{...cnode(c),id,connectionIds:[],evidence:[]});const n=resources.get(id);n.connectionIds.push(c.id);n.evidence.push(...c.evidence);}
    const ingress=d.entries.filter(e=>e.kind!=='kafka'||!selected.some(c=>c.kind==='topic'&&c.access==='consume'&&c.target===e.topic));
    nodes=[root,...resources.values(),...ingress.map(e=>({id:e.id,name:e.name,kind:'external',source:'passport',technology:e.kind,evidence:[citation(e.source)]}))];
    relations=[...selected.map(c=>({id:'connection:'+c.id,from:c.access==='consume'?resourceId(c):sid,to:c.access==='consume'?sid:resourceId(c),label:c.access,certainty:c.certainty,source:c.source.origin,evidence:c.evidence,fields:[]})),...ingress.map(e=>({id:'ingress:'+e.id,from:e.id,to:sid,label:e.kind+' entry',certainty:e.source.origin==='manual'?'declared':e.source.file&&e.source.line?'static':'candidate',source:'passport',evidence:[citation(e.source)],fields:[]}))];}

  if(mode==='component'||flow){const canonical=new Map(),merged=new Map();for(const n of nodes){const b=n.boundary,id=b?.resolved&&b.connection?'view-resource:'+hash(b.connection):n.id;canonical.set(n.id,id);if(!merged.has(id))merged.set(id,{...n,id,evidence:[...n.evidence]});else merged.get(id).evidence.push(...n.evidence);}nodes=[...merged.values()];const distinct=new Map();for(const e of relations){const value={...e,from:canonical.get(e.from)||e.from,to:canonical.get(e.to)||e.to},key=JSON.stringify([value.from,value.to,value.label]);if(!distinct.has(key))distinct.set(key,value);else distinct.get(key).evidence=[...new Set([...distinct.get(key).evidence,...value.evidence])];}relations=[...distinct.values()];}
  if(mode==='container'){const combined=new Map();for(const e of relations){const key=e.from+'\0'+e.to;if(!combined.has(key))combined.set(key,{...e});else{const old=combined.get(key);old.label=[...new Set([...old.label.split(', '),e.label])].sort().join(', ');old.evidence=[...new Set([...old.evidence,...e.evidence])];if(old.certainty!==e.certainty)old.certainty='candidate';}}relations=[...combined.values()];}
  const total=nodes.length;nodes=nodes.slice(0,limit);const ids=new Set(nodes.map(n=>n.id));relations=relations.filter(e=>ids.has(e.from)&&ids.has(e.to));const edgeTotal=relations.length;relations=relations.slice(0,500);
  const groups=mode==='component'||flow?[{id:sid,name:d.service,kind:'service',declared:true,members:nodes.filter(n=>n.kind==='component').map(n=>n.id)}]:[];
  const summary=Object.fromEntries(d.envs.map(e=>{const dep=d.observed.deployments[e];return[e,{services:dep.known?1:0,replicas:dep.total||0,passing:dep.passing,warning:dep.warning,critical:dep.critical,at:dep.at,staleServices:dep.stale?1:0}];}));
  return {protocol:'dt.architecture/v1',title:d.service+' · service architecture',at:d.at,env,envs:d.envs,type:mode,focus:sid,dossier:d,document:{id:'service-snapshot',revision:hash(d.identity),title:d.service+' architecture dossier',summary:`${d.coverage.connections} connections · ${d.coverage.entries} entries · ${d.coverage.paths} static boundary paths · ${d.coverage.requirements} documentation blocks`,body:d.coverage.meaning,views,flows},sourceDocuments:[],nodes,relations,groups,flow,documents:[],summary,estate:{nodes:d.code.nodes.length+d.connections.length+1,services:1,relations:d.code.edges.length+d.connections.length},total,truncated:total>limit||edgeTotal>500,resources:d.observed.resources,gaps:d.gaps,guidance:'Collected source snapshots, documentation claims and runtime observations remain separate. Static call paths are not Joern value-flow proof or runtime traces. Branches do not imply an execution order.'};
}
function present(model){const shown=require('./architecture').present(model),d=model.dossier;return {...shown,gaps:model.gaps.slice(0,30),gapsTotal:model.gaps.length,service:d.service,identity:d.identity,coverage:d.coverage,requirements:d.requirements.slice(0,5).map(({id,title,url,kind,revision})=>({id,title,url,kind,revision})),downloads:{plantuml:shown.view.replace('/architecture/','/api/architecture/')+'/export?format=plantuml',json:shown.view.replace('/architecture/','/api/architecture/')+'/export?format=json'},next:'Open the dossier for all discovered connections, entry-point paths, requirements and observations. Use job_cancel to stop an active collection; publish shared knowledge separately as an admin.'};}
async function run(args) {
  const J=require('./jobs');if(!args.job&&!args.service)throw Object.assign(Error('service or job is required'),{code:'DT_ARGUMENT_INVALID'});if(args.job){const job=J.find(args.job);if(!job||!job.key.startsWith('architecture:service:'))throw Object.assign(Error('Service architecture job is unavailable'),{code:'DT_NOT_FOUND',statusCode:404});return require('./semantic-code').waitJob(job,args.waitMs||0);}
  const key='architecture:service:'+hash(args),job=J.start(key,'Service architecture '+args.service,log=>collect(args,{log}));return require('./semantic-code').waitJob(job,args.waitMs||0);
}
module.exports={inventory,codeFlows,documents,semantics,collect,projection,present,run};
