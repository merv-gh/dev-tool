// Derived SQLite navigation over immutable NDJSON projections. Runs only in its owner worker.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const { DatabaseSync } = require('node:sqlite');
const INDEX_VERSION = 'dt.semantic.navigation/v1';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bounded = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const identity = (a, symbol) => require('./semantic-identity').code(a.repo, a.revisionKey || a.sha, symbol);
const sources = a => a.sources || a.manifest?.sources || [{repo:a.repo,sha:a.sha,revisionKey:a.revisionKey,sourceDigest:a.sourceDigest,prefix:''}];
function origin(a,file='') { const matches=sources(a).filter(s=>!s.prefix||file===s.prefix||file.startsWith(s.prefix.replace(/\/$/,'')+'/')).sort((x,y)=>(y.prefix||'').length-(x.prefix||'').length);const source=matches[0]||a,prefix=(source.prefix||'').replace(/\/$/,'');return {...source,repo:source.repo||a.repo,sha:source.sha||a.sha,revisionKey:source.revisionKey||source.sha||a.revisionKey,file:prefix&&file.startsWith(prefix+'/')?file.slice(prefix.length+1):file};}
const stamp = file => { const s=fs.statSync(file);return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; };
async function index(a) {
  const source=path.join(a.dir,'projection.jsonl'), target=path.join(a.dir,'navigation.sqlite');
  if(fs.lstatSync(source).isSymbolicLink()||fs.statSync(source).size>256*1048576)throw Error('Semantic projection is a symlink or exceeds the 256 MiB reader budget');
  const signature=stamp(source);
  try{const existing=new DatabaseSync(target,{readOnly:true});const meta=existing.prepare('select value from metadata where key=?').get('identity');if(meta?.value===INDEX_VERSION+':'+signature)return existing;existing.close();}catch{}
  const temporary=target+'.'+process.pid+'.'+crypto.randomBytes(6).toString('hex')+'.tmp', db=new DatabaseSync(temporary);
  try{
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; create table records (type text,id text,name text,full_name text,signature text,file text,line integer,method text,raw text); create table targets (call_id text,target_id text); create table metadata (key text primary key,value text); BEGIN');
    const put=db.prepare('insert into records values(?,?,?,?,?,?,?,?,?)'), targetPut=db.prepare('insert into targets values(?,?)');let count=0,meta={},summary={};
    for await(const line of readline.createInterface({input:fs.createReadStream(source,{encoding:'utf8',highWaterMark:65536}),crlfDelay:Infinity})){
      if(!line.trim())continue;if(Buffer.byteLength(line)>262144)throw Error('Semantic projection record exceeds 256 KiB');if(++count>1000000)throw Error('Semantic projection exceeds one million records');
      let r;try{r=JSON.parse(line);}catch{throw Error('Semantic projection contains malformed NDJSON');}
      if(r.type==='meta'){meta=r;continue;}if(r.type==='summary'){summary=r;continue;}if(!['symbol','call','guard','port'].includes(r.type))continue;
      put.run(r.type,String(r.id),r.name||'',r.fullName||r.methodFullName||'',r.signature||'',r.file||'',r.line||0,String(r.caller||r.method||''),line);
      if(r.type==='call')for(const id of (r.targets||[]).slice(0,20))targetPut.run(String(r.id),String(id));
    }
    if(meta.protocol!=='dt.semantic.projection/v1')throw Error('Semantic projection protocol is missing or unsupported');
    if(!Object.keys(summary).length)throw Error('Semantic projection final summary is missing; incomplete artifacts are not queryable');
    db.prepare('insert into metadata values(?,?)').run('identity',INDEX_VERSION+':'+signature);db.prepare('insert into metadata values(?,?)').run('coverage',JSON.stringify({meta,summary}));
    db.exec('create unique index record_identity on records(type,id); create index symbols_fullname on records(type,full_name); create index symbols_name on records(type,name); create index symbols_file on records(type,file,line); create index records_method on records(type,method); create index call_targets on targets(target_id,call_id); create index call_targets_forward on targets(call_id,target_id); COMMIT');db.close();
    if(stamp(source)!==signature)throw Error('Projection changed while indexing');fs.renameSync(temporary,target);return new DatabaseSync(target,{readOnly:true});
  }catch(e){try{db.close();}catch{}fs.rmSync(temporary,{force:true});throw e;}
}
const parse = row => row ? JSON.parse(row.raw) : null;
const rows = (db,sql,args=[]) => db.prepare(sql).all(...args).map(parse);
function createGraph(analyses, databases, options) {
  const byAnalysis=new Map(analyses.map((a,i)=>[a.id,{...a,db:databases[i]}])), nodes=new Map(), adjacency=new Map(), reverse=new Map(), ambiguities=[], gaps=[];
  let edgeCount=0, graphTruncated=false;const deadline=Date.now()+bounded(options.budgetMs,5000,100,30000);
  const bindings=[...new Map(analyses.flatMap(a=>a.bindings||a.manifest?.dependencies||[]).concat(options.bindings||[]).map(b=>[digest(b),b])).values()];
  const link=(from,to,kind,evidence,extra={})=>{if(edgeCount>=40000||Date.now()>deadline){graphTruncated=true;return null;}edgeCount++;const edge={id:digest([from,to,kind,evidence]).slice(0,24),from,to,kind,evidence,...extra};if(!adjacency.has(from))adjacency.set(from,[]);if(!reverse.has(to))reverse.set(to,[]);adjacency.get(from).push(edge);reverse.get(to).push(edge);return edge;};
  function symbol(a,r){const source=origin(a,r.file);if(nodes.size>=20000)throw Object.assign(Error('Semantic navigation reached its 20000-node budget; narrow the selected symbols or revisions'),{code:'DT_SEMANTIC_QUERY_BUDGET'});const key=(r.fullName||`${r.file}:${r.line}:${r.name}:${r.signature}`)+(/<unresolved|<unknown/.test(r.fullName||'')?'#dt-source='+JSON.stringify([source.file,r.line,r.signature]):''),id=identity(source,key);if(nodes.has(id))return nodes.get(id);const n={id,kind:'method',name:r.name,signature:r.fullName||r.signature,methodSignature:r.signature,file:source.file,projectionFile:r.file,line:r.line,endLine:r.endLine,repo:source.repo,sha:source.sha,analysisId:a.id,locator:{analysisId:a.id,generation:a.manifest?.generation||a.id,nodeId:String(r.id)},parameters:r.parameters||[],returnId:r.returnId,coverage:'static-cpg'};nodes.set(id,n);return n;}
  function local(a,id){const r=parse(a.db.prepare('select raw from records where type=? and id=?').get('symbol',String(id)));return r?symbol(a,r):null;}
  function callNode(a,r){const source=origin(a,r.file),id=identity(source,`call:${source.file}:${r.line}:${r.column||0}:${r.name}:${r.id}`);if(nodes.has(id))return nodes.get(id);const node={id,kind:'call',name:r.name,signature:r.methodFullName,file:source.file,projectionFile:r.file,line:r.line,column:r.column,code:r.code,analysisId:a.id,repo:source.repo,sha:source.sha,arguments:r.arguments||[],locator:{analysisId:a.id,generation:a.id,nodeId:String(r.id)}};nodes.set(id,node);const caller=local(a,r.caller);if(caller)link(caller.id,id,'call-site',{origin:'joern',analysisId:a.id,repo:source.repo,sha:source.sha,file:source.file,line:r.line,nodeId:r.id},{certainty:'static',proof:'call-reachability'});return node;}
  const selectSymbols=(a,selector={},limit=201)=>{
    const conditions=["type='symbol'"],params=[];
    if(selector.id){const parsed=require('./semantic-identity').parseCode(selector.id);if(parsed){if(!sources(a).some(source=>source.repo===parsed.repo&&[source.revisionKey,source.sha].includes(parsed.revision)))return[];conditions.push('full_name=?');params.push(parsed.symbol.split('#dt-source=')[0]);}else{conditions.push('id=?');params.push(String(selector.id));}}
    if(selector.name){conditions.push('name=?');params.push(selector.name);}if(selector.signature){conditions.push('(full_name=? or signature=?)');params.push(selector.signature,selector.signature);}if(selector.file){const files=[selector.file,...sources(a).filter(s=>(!selector.repo||s.repo===selector.repo)&&(!selector.sha||s.sha===selector.sha)).map(s=>s.prefix?s.prefix.replace(/\/$/,'')+'/'+selector.file:selector.file)];conditions.push('file in ('+files.map(()=>'?').join(',')+')');params.push(...files);}if(selector.line){conditions.push('line<=?');params.push(selector.line);}
    params.push(limit);return rows(a.db,`select raw from records where ${conditions.join(' and ')} order by file,line,id limit ?`,params).filter(r=>!selector.line||!r.endLine||r.endLine>=selector.line).map(r=>symbol(a,r)).filter(n=>(!selector.repo||selector.repo===n.repo)&&(!selector.sha||selector.sha===n.sha)&&(!selector.id||!selector.id.startsWith('code:')||n.id===selector.id));
  };
  function belongs(a,selector){return(!selector.analysisId||selector.analysisId===a.id)&&sources(a).some(s=>(!selector.repo||selector.repo===s.repo)&&(!selector.sha||selector.sha===s.sha));}
  const portRows=[];
  for(const a of byAnalysis.values()){
    for(const r of rows(a.db,"select raw from records where type='port' limit 2001")){if(portRows.length>=10000){gaps.push({kind:'port-budget',detail:'Port overlay navigation was capped at 10000 records'});break;}portRows.push({analysis:a,raw:r,detected:true});}
    for(const p of (a.ports||[]).concat(options.ports||[]).filter(p=>sources(a).some(s=>(!p.repo||p.repo===s.repo)&&(!p.revision||p.revision===s.sha))))portRows.push({analysis:a,raw:p});
  }
  const ports=[];
  for(const {analysis:a,raw:p,detected}of portRows){
    if(p.disabled||p.enabled===false)continue;
    const type=p.portType||p.type, handler=p.handler||{}, boundary=p.boundary||{};
    const exact=detected||Boolean(handler.signature&&handler.file&&handler.line&&sources(a).some(s=>handler.repo===s.repo&&handler.revision===s.sha));
    const matched=detected?(local(a,p.method)?[local(a,p.method)]:[]):exact?selectSymbols(a,{repo:handler.repo,sha:handler.revision,signature:handler.signature,file:handler.file,line:handler.line},3):[];
    let callId=detected?p.call||null:null;
    if(!callId&&exact&&matched.length===1&&handler.call){const selector=handler.call,files=[selector.file||handler.file,...sources(a).filter(s=>s.repo===handler.repo&&s.sha===handler.revision).map(s=>s.prefix?s.prefix.replace(/\/$/,'')+'/'+(selector.file||handler.file):selector.file||handler.file)],conditions=["type='call'",'line=?','file in ('+files.map(()=>'?').join(',')+')'],values=[selector.line,...files];if(selector.name){conditions.push('name=?');values.push(selector.name);}if(selector.signature){conditions.push('full_name=?');values.push(selector.signature);}const found=rows(a.db,`select raw from records where ${conditions.join(' and ')} limit 101`,values),calls=found.filter(r=>(selector.column==null||r.column===selector.column)&&matched.some(n=>n.locator.nodeId===String(r.caller)));if(calls.length===1&&found.length<=100)callId=String(calls[0].id);else gaps.push({kind:'port-call-binding',port:p.id,detail:'Explicit port call location is missing or ambiguous'});}
    const source=origin(a,p.file),id='port:'+digest([a.id,p.id,type,p.service,p.env,p.repo,p.revision]).slice(0,24), port={id,kind:'port',portType:type,name:p.id,analysisId:a.id,repo:p.repo||matched[0]?.repo||source.repo,sha:p.revision||matched[0]?.sha||source.sha,env:Object.hasOwn(p,'env')?p.env:a.env||a.manifest?.env||null,service:p.service||a.service||a.manifest?.service||null,boundary,evidence:p.evidence||{origin:'detected',code:p.code,repo:source.repo,sha:source.sha,file:source.file,line:p.line},certainty:detected?'candidate':p.evidence?.origin==='manual'?'declared':'detected',file:handler.file||source.file,line:handler.line||p.line,handlerCandidates:matched.map(n=>n.id),callId,mappings:p.mappings||[],gaps:p.gaps||[]};
    nodes.set(id,port);ports.push(port);
    if(!exact||matched.length!==1){gaps.push({kind:'port-handler',port:id,detail:exact?'Handler is missing or ambiguous':'Exact repo/revision/signature/file/line handler binding is incomplete'});if(matched.length>1)ambiguities.push({selector:handler,candidates:matched.map(n=>n.id)});continue;}
    const inbound=['http-ingress','kafka-consume','scheduled','db-read'].includes(type);
    link(inbound?id:matched[0].id,inbound?matched[0].id:id,type==='db-read'?'data-read':type==='db-write'?'data-write':'port-handler',port.evidence,{certainty:port.certainty,proof:detected?'candidate':'declared'});
  }
  const complete=v=>v!==null&&v!==undefined&&v!=='';
  for(const p of ports){
    const b=p.boundary;
    if(['db-read','db-write'].includes(p.portType)&&[p.env,b.db,b.schema,b.table].every(complete)){
      const resourceId=require('./semantic-identity').pg('table',p.env,b.db,require('./semantic-identity').qualified(b.schema,b.table));
      if(!nodes.has(resourceId))nodes.set(resourceId,{id:resourceId,kind:'table',env:p.env,db:b.db,schema:b.schema,name:b.table});
      link(p.portType==='db-read'?resourceId:p.id,p.portType==='db-read'?p.id:resourceId,p.portType,p.evidence,{certainty:p.certainty,nature:'data-dependency',controlTrigger:false,mappings:p.mappings});
    }
    if(p.portType==='kafka-produce')for(const q of ports.filter(q=>q.portType==='kafka-consume')){
      const c=q.boundary;if(![p.env,b.cluster,b.topic,q.env,c.cluster,c.topic].every(complete))continue;
      if(p.env===q.env&&b.cluster===c.cluster&&b.topic===c.topic)link(p.id,q.id,'kafka-transport',{producer:p.evidence,consumer:q.evidence},{certainty:'declared',nature:'asynchronous',mappings:[...p.mappings,...q.mappings],schemaCompatible:complete(b.schema)&&complete(c.schema)&&complete(b.schema_version)&&complete(c.schema_version)&&b.schema===c.schema&&b.schema_version===c.schema_version,proof:'boundary-candidate'});
    }
    if(p.portType==='http-egress')for(const q of ports.filter(q=>q.portType==='http-ingress')){
      const c=q.boundary;if(![p.env,q.env,b.method,c.method,b.path,c.path].every(complete)||p.env!==q.env||b.method.toUpperCase()!==c.method.toUpperCase())continue;
      const target=complete(b.target_service)&&b.target_service===q.service,host=complete(b.host)&&b.host===c.host;
      if(!target&&!host)continue;if(complete(b.host)&&complete(c.host)&&b.host!==c.host)continue;
      if(typeof b.base_path!=='string'||typeof c.base_path!=='string')continue;
      if((b.base_path+b.path).replace(/\/{2,}/g,'/')!==(c.base_path+c.path).replace(/\/{2,}/g,'/'))continue;
      link(p.id,q.id,'http-transport',{client:p.evidence,server:q.evidence},{certainty:'declared',mappings:[...p.mappings,...q.mappings],proof:'boundary-candidate'});
    }
  }
  const loaded=new Set();
  function loadCalls(node){if(loaded.has(node.id))return;loaded.add(node.id);if(node.kind==='call'){const a=byAnalysis.get(node.analysisId),record=parse(a.db.prepare("select raw from records where type='call' and id=?").get(node.locator.nodeId)),caller=record&&local(a,record.caller);if(caller){loadCalls(caller);for(const edge of adjacency.get(caller.id)||[])if(String(edge.evidence?.nodeId)===node.locator.nodeId&&edge.to!==node.id)link(node.id,edge.to,'call-target',edge.evidence,{certainty:edge.certainty,proof:'call-reachability'});}return;}if(node.kind!=='method')return;const a=byAnalysis.get(node.analysisId);if(!a)return;
    const calls=rows(a.db,"select raw from records where type='call' and method=? limit 2001",[node.locator.nodeId]);if(calls.length>2000)gaps.push({kind:'call-budget',symbol:node.id,detail:'At most 2000 call sites per method'});
    for(const call of calls.slice(0,2000)){if(edgeCount>=40000||Date.now()>deadline){graphTruncated=true;break;}
      let targets=(call.targets||[]).map(id=>local(a,id)).filter(Boolean),binding=null,resolution='native-call-edge';
      if(!targets.length&&call.methodFullName&&!/<unresolved|<unknown/.test(call.methodFullName)){targets=rows(a.db,"select raw from records where type='symbol' and full_name=? limit 21",[call.methodFullName]).map(r=>symbol(a,r));resolution='exact-signature-candidate';}
      if(!targets.length&&call.methodFullName)for(const dependency of bindings){
        if(dependency.exact===false||dependency.evidence==='approximate'||/<unresolved|<unknown/.test(call.methodFullName)||dependency.fromRepo!==node.repo||dependency.fromSha!==node.sha||!dependency.toRepo||!/^[a-f0-9]{40}$/i.test(dependency.toSha||''))continue;
        for(const target of byAnalysis.values())if(sources(target).some(s=>s.repo===dependency.toRepo&&s.sha===dependency.toSha)){const matches=rows(target.db,"select raw from records where type='symbol' and full_name=? limit 21",[call.methodFullName]);if(matches.length){targets.push(...matches.map(r=>symbol(target,r)).filter(n=>n.repo===dependency.toRepo&&n.sha===dependency.toSha));binding=dependency;}}
      }
      targets=[...new Map(targets.map(target=>[target.id,target])).values()];
      const callSource=origin(a,call.file);
      if(targets.length>1)ambiguities.push({call:{analysisId:a.id,nodeId:call.id,repo:callSource.repo,sha:callSource.sha,file:callSource.file,line:call.line},candidates:targets.map(t=>t.id)});
      if(!targets.length&&!call.name.startsWith('<operator>'))gaps.push({kind:'unresolved-call',analysisId:a.id,repo:callSource.repo,sha:callSource.sha,file:callSource.file,line:call.line,name:call.name,methodFullName:call.methodFullName});
      for(const target of targets.slice(0,20))link(node.id,target.id,binding?'exact-library-call':resolution==='native-call-edge'?'call':'signature-call',{origin:'joern',resolution,analysisId:a.id,nodeId:call.id,repo:callSource.repo,sha:callSource.sha,file:callSource.file,line:call.line,code:call.code,...(binding?{dependency:binding}:{})},{certainty:targets.length>1?'ambiguous':resolution==='native-call-edge'?'static':'candidate',proof:'call-reachability',arguments:call.arguments});
    }
  }
  function incoming(node){for(const a of byAnalysis.values()){
    let matches=[];
    if(node.analysisId===a.id)matches=rows(a.db,"select r.raw from records r join targets t on t.call_id=r.id where r.type='call' and t.target_id=? limit 2001",[node.locator?.nodeId||'']);
    for(const b of bindings)if(b.exact!==false&&b.evidence!=='approximate'&&sources(a).some(s=>b.fromRepo===s.repo&&b.fromSha===s.sha)&&b.toRepo===node.repo&&b.toSha===node.sha)matches.push(...rows(a.db,"select raw from records where type='call' and full_name=? limit 2001",[node.signature]));
    for(const call of matches.slice(0,2000)){const caller=local(a,call.caller);if(caller)loadCalls(caller);}
  }return reverse.get(node.id)||[];}
  function select(selector={}){
    const selected=[];
    for(const a of byAnalysis.values())if(belongs(a,selector)&&(!selector.kind||['method','symbol','function'].includes(selector.kind))&&!['topic','route','cluster','db','schema','service'].some(k=>selector[k]))selected.push(...selectSymbols(a,selector));
    if(selector.kind==='call')for(const a of byAnalysis.values())if(belongs(a,selector)){const conditions=["type='call'"],values=[];if(selector.id){conditions.push('id=?');values.push(String(selector.id));}if(selector.name){conditions.push('name=?');values.push(selector.name);}if(selector.signature){conditions.push('full_name=?');values.push(selector.signature);}if(selector.file){const files=[selector.file,...sources(a).filter(s=>(!selector.repo||s.repo===selector.repo)&&(!selector.sha||s.sha===selector.sha)).map(s=>s.prefix?s.prefix.replace(/\/$/,'')+'/'+selector.file:selector.file)];conditions.push('file in ('+files.map(()=>'?').join(',')+')');values.push(...files);}if(selector.line){conditions.push('line=?');values.push(selector.line);}for(const call of rows(a.db,`select raw from records where ${conditions.join(' and ')} limit 201`,values)){const source=origin(a,call.file);if((!selector.repo||selector.repo===source.repo)&&(!selector.sha||selector.sha===source.sha)&&(selector.column==null||selector.column===call.column))selected.push(callNode(a,call));}}
    if(selector.id&&nodes.has(selector.id))selected.push(nodes.get(selector.id));
    for(const n of nodes.values())if((selector.id||selector.kind&&!['method','symbol','function'].includes(selector.kind)||['topic','route','cluster','db','schema','service'].some(k=>selector[k]))&&n.kind!=='method'&&(!selector.id||selector.id===n.id)&&(!selector.kind||selector.kind===n.kind||selector.kind===n.portType||selector.kind==='topic'&&n.portType?.startsWith('kafka-'))&&(!selector.name||selector.name===n.name||selector.name===n.boundary?.topic||selector.name===n.boundary?.table)&&(!selector.env||selector.env===n.env)&&(!selector.service||selector.service===n.service)&&(!selector.cluster||selector.cluster===n.boundary?.cluster)&&(!selector.db||selector.db===n.db||selector.db===n.boundary?.db)&&(!selector.schema||selector.schema===n.schema||selector.schema===n.boundary?.schema)&&(!selector.topic||selector.topic===n.boundary?.topic)&&(!selector.route||selector.route===n.boundary?.path)&&(!selector.method||selector.method===n.boundary?.method)&&(!selector.repo||selector.repo===n.repo)&&(!selector.sha||selector.sha===n.sha))selected.push(n);
    return [...new Map(selected.map(n=>[n.id,n])).values()];
  }
  return {byAnalysis,nodes,ports,gaps,ambiguities,bindings,select,loadCalls,incoming,adjacency,reverse,local,symbol,callNode,truncated:()=>graphTruncated};
}
function planComposition(graph,path,args){
  const segments=[],boundaries=[],gaps=[];let source=null;
  const localIds=(node,isSource)=>{
    if(!node)return[];
    if(node.kind==='method')return isSource?(node.parameters||[]).filter(p=>p.index>0&&(node.id!==path.nodes[0]?.id||!args.from?.parameter||p.name===args.from.parameter||p.index===args.from.parameter)).map(p=>String(p.id)):node.returnId?[String(node.returnId)]:[];
    if(node.kind==='call')return isSource?[node.locator.nodeId]:(node.arguments||[]).filter(a=>a.index>0).map(a=>String(a.id));
    if(node.kind==='port'){
      const a=graph.byAnalysis.get(node.analysisId);
      if(node.callId){const c=parse(a.db.prepare("select raw from records where type='call' and id=?").get(String(node.callId)));return c?(isSource?[String(c.id)]:(c.arguments||[]).filter(a=>a.index>0).map(a=>String(a.id))):[];}
      if(isSource&&['http-ingress','kafka-consume'].includes(node.portType))return node.handlerCandidates.flatMap(id=>localIds(graph.nodes.get(id),true));
    }
    return[];
  };
  const append=(start,end,override)=>{
    const fromNodeIds=localIds(start,true),toNodeIds=override||localIds(end,false),analysisId=start?.analysisId;
    const segment={id:'segment:'+digest([analysisId,fromNodeIds,toNodeIds]).slice(0,24),analysisId,from:start?.id,to:end?.id,fromNodeIds,toNodeIds,status:'pending'};
    if(!analysisId||analysisId!==end?.analysisId||!fromNodeIds.length||!toNodeIds.length){segment.status='unresolved';gaps.push({kind:'local-value-endpoint',from:start?.id,to:end?.id,detail:'A precise parameter/call result and sink argument binding is required'});}
    else segment.request={operation:'slice',mode:'dataflow',fromNodeIds,toNodeIds,maxPaths:Math.min(4,args.maxPaths||4),maxHops:Math.min(100,args.maxHops||30),budgetMs:bounded(args.budgetMs,5000,100,30000)};
    if(!segments.some(s=>s.id===segment.id))segments.push(segment);
  };
  for(let i=0;i<path.nodes.length;i++){
    const node=path.nodes[i],edge=path.edges[i];
    if(!source&&node.analysisId&&(node.kind==='method'||node.kind==='call'||node.kind==='port'&&['http-ingress','kafka-consume','db-read'].includes(node.portType)))source=node;
    if(node.kind==='port'&&['http-egress','kafka-produce','db-write'].includes(node.portType)&&source){append(source,node);source=null;}
    if(edge?.kind==='exact-library-call'){
      const target=graph.nodes.get(edge.to);append(source,node,(edge.arguments||[]).filter(a=>a.index>0).map(a=>String(a.id)));const mappings=(edge.arguments||[]).filter(a=>a.index>0).flatMap(argument=>(target.parameters||[]).filter(p=>p.index===argument.index).map(parameter=>({from:`argument:${argument.index}`,to:`parameter:${parameter.name}`,evidence:'exact signature argument position'})));boundaries.push({edge:edge.id,kind:edge.kind,status:mappings.length?'signature-binding':'unresolved',evidence:edge.evidence,mappings});if(!mappings.length)gaps.push({kind:'library-argument-binding',edge:edge.id,detail:'Exact method identity does not establish a value mapping without matching argument/parameter positions'});source=target;
    }
    if(edge&&['kafka-transport','http-transport','db-read','db-write'].includes(edge.kind)){
      const from=graph.nodes.get(edge.from),to=graph.nodes.get(edge.to),producer=from?.mappings||[],consumer=to?.mappings||[];
      let mappings=[],compatible=true;
      if(edge.kind.endsWith('-transport')){mappings=producer.flatMap(p=>consumer.filter(c=>p.to===c.from&&typeof p.to==='string').map(c=>({from:p.from,transport:p.to,to:c.to,evidence:{producer:p.evidence||from.evidence,consumer:c.evidence||to.evidence},status:'declared'})));if(edge.kind==='kafka-transport'&&edge.schemaCompatible!==true){compatible=false;gaps.push({kind:'transport-schema',edge:edge.id,detail:'Matching Kafka payload schema and version are required for composed value lineage'});} }
      else mappings=(edge.kind==='db-write'?producer:consumer).filter(m=>typeof m.from==='string'&&typeof m.to==='string').map(m=>({...m,status:'declared'}));
      if(!mappings.length){compatible=false;gaps.push({kind:'boundary-field-mapping',edge:edge.id,detail:'Explicit compatible field mappings are required; transport/table identity alone is insufficient'});}
      const alternatives=edge.kind.endsWith('-transport')?(graph.reverse.get(edge.to)||[]).filter(other=>other.kind===edge.kind&&other.from!==edge.from).map(other=>({port:other.from,evidence:other.evidence})):[];
      if(alternatives.length&&!graph.ambiguities.some(a=>a.boundary===edge.to))graph.ambiguities.push({boundary:edge.to,candidates:[edge.from,...alternatives.map(a=>a.port)],reason:'The transport has other possible producers; this path does not establish a unique origin'});
      if(edge.kind==='db-read'){
        const write=boundaries.slice().reverse().find(b=>b.kind==='db-write');
        if(write&&!write.mappings.some(w=>mappings.some(r=>w.to===r.from))){compatible=false;gaps.push({kind:'table-field-continuity',edge:edge.id,detail:'The written and read table fields do not have an explicit matching mapping'});}
      }
      boundaries.push({edge:edge.id,kind:edge.kind,mappings,status:compatible?'declared':'unresolved',evidence:edge.evidence,controlTrigger:edge.controlTrigger,...(alternatives.length?{alternatives,originUniqueness:'unknown'}:{})});
      if(edge.kind.endsWith('-transport')||edge.kind==='db-read')source=to;
    }
    if(i===path.nodes.length-1&&source&&node.analysisId)append(source,node);
  }
  if(!segments.length)gaps.push({kind:'missing-local-dataflow',detail:'No supported local value segment was identified'});
  return{...path,kind:'composed-data-lineage',segments,boundaries,gaps,proof:{status:'candidate',feasibility:'unknown',runtime:'unknown',fieldMappings:'declared',fieldSensitivity:'parameter/call-argument CPG paths joined through reviewed field declarations',controlTrigger:path.kind==='data-dependency'?false:undefined}};
}
function comparisonProjection(a,db){
  const entries=new Map(),methods=new Map();let bytes=0,count=0,truncated=false;
  const method=id=>{if(!methods.has(String(id))){const row=parse(db.prepare("select raw from records where type='symbol' and id=?").get(String(id)));methods.set(String(id),row?.fullName||null);}return methods.get(String(id));};
  const add=(key,value)=>{if(!entries.has(key))entries.set(key,[]);entries.get(key).push(value);};
  for(const row of db.prepare("select raw from records order by type,file,line,id").iterate()){
    bytes+=Buffer.byteLength(row.raw);if(++count>20000||bytes>16*1048576){truncated=true;break;}
    const r=JSON.parse(row.raw),source=origin(a,r.file),location={repo:source.repo,sha:source.sha,file:source.file,line:r.line};
    const owner=method(r.method||r.caller),category=r.type;
    let key,value;
    if(category==='symbol'){key=[source.repo,r.fullName];value={...location,name:r.name,signature:r.fullName,methodSignature:r.signature,parameters:(r.parameters||[]).map(({id,...p})=>p),returnType:r.returnType};}
    else if(category==='call'){key=[source.repo,owner,source.file,r.line,r.column,r.name];value={...location,owner,name:r.name,signature:r.methodFullName,code:r.code,dispatch:r.dispatch,arguments:(r.arguments||[]).map(({id,...p})=>p)};}
    else if(category==='guard'){key=[source.repo,owner,source.file,r.line,r.kind];value={...location,owner,expression:r.expression,kind:r.kind,status:r.status==='declared'?'declared':'unknown'};}
    else if(category==='port'){key=[source.repo,owner,source.file,r.line,r.portType];value={...location,owner,type:r.portType,code:r.code,certainty:'candidate'};}
    else continue;
    add(category+':'+JSON.stringify(key),{category,value});
  }
  for(const p of (a.ports||[]).slice(0,10000)){
    const handler=p.handler||{},value={name:p.id,service:p.service,env:p.env,type:p.type||p.portType,repo:p.repo,handler:{repo:handler.repo,file:handler.file,line:handler.line,signature:handler.signature,call:handler.call},boundary:p.boundary,mappings:p.mappings,evidenceOrigin:p.evidence?.origin,disabled:p.disabled||p.enabled===false};
    add('effective-port:'+JSON.stringify([p.service,p.env,p.id]),{category:'effective-port',value});
  }
  // Multisets preserve overload/call multiplicity while omitting generation-local IDs.
  for(const values of entries.values())values.sort((x,y)=>JSON.stringify(x.value).localeCompare(JSON.stringify(y.value)));
  return{entries,truncated};
}
function compare(analyses,databases,base){
  const projections=analyses.map((a,i)=>comparisonProjection(a,databases[i])),[left,right]=projections.map(p=>p.entries);
  for(const key of new Set([...left.keys(),...right.keys()])){
    const before=left.get(key),after=right.get(key),comparable=values=>values?.map(({value})=>{const {sha,...rest}=value;return rest;});
    if(JSON.stringify(comparable(before))===JSON.stringify(comparable(after)))continue;
    base.results.push({change:!before?'added':!after?'removed':'changed',category:(after||before)[0].category,...(before?{before:before.length===1?before[0].value:before.map(v=>v.value)}:{}),...(after?{after:after.length===1?after[0].value:after.map(v=>v.value)}:{})});
  }
  base.truncated ||= projections.some(p=>p.truncated);
  if(projections.some(p=>p.truncated))base.gaps.push({kind:'comparison-budget',detail:'Comparison covers at most 20000 projection records / 16 MiB per analysis; records outside that region were not compared'});
  base.proof={kind:'projection-comparison',status:'structural',feasibility:'not-applicable',scope:'signatures, call sites, guards and effective typed ports; source bodies and runtime behavior are not compared'};
}

async function query(args,analyses,options={}){
  const databases=[];try{
    for(const a of analyses)databases.push(await index(a));
    const graph=createGraph(analyses,databases,{...options,budgetMs:args.budgetMs}),operation=args.operation||'symbols',mode=args.mode||'reachability',limit=bounded(args.limit,30,1,200),maxHops=bounded(args.maxHops,8,1,30),maxPaths=bounded(args.maxPaths,8,1,20),deadline=Date.now()+bounded(args.budgetMs,5000,100,30000);
    const coverage=databases.map((db,i)=>({analysisId:analyses[i].id,...JSON.parse(db.prepare('select value from metadata where key=?').get('coverage').value)}));
    const base={protocol:'dt.semantic/v1',operation,mode,analyses:analyses.map(({id,repo,sha,sourceDigest,revisionKey})=>({id,repo,sha,sourceDigest,revisionKey})),results:[],truncated:coverage.some(c=>c.summary.truncated),gaps:graph.gaps,ambiguity:graph.ambiguities,coverage,proof:{kind:mode==='reachability'?'call-reachability':mode,status:'static-candidate',feasibility:'unknown'},dependencies:graph.bindings};
    const choose=s=>{const out=graph.select(s||{});if(out.length>1)graph.ambiguities.push({selector:s,candidates:out.slice(0,200).map(n=>n.id),truncated:out.length>200});return out.slice(0,200);};
    base.overlayId=digest([analyses.map(a=>[a.id,a.overlayRevision||null,a.ports||[],a.bindings||[]]),options.ports||[],options.bindings||[]]);
    const queryKey=digest([analyses.map(a=>a.id),base.overlayId,args.operation,args.query,args.kind,args.from,args.to,args.target,args.mode]),offset=args.cursor?parseCursor(args.cursor,queryKey):0;let paged=false;
    if(operation==='symbols'||operation==='search'){
      const q=String(args.query||'').slice(0,300).toLowerCase(),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';let skip=offset,total=0;
      for(const a of graph.byAnalysis.values()){
        const filter="type='"+(args.kind==='call'?'call':'symbol')+"' and (lower(name) like ? escape '\\' or lower(full_name) like ? escape '\\')";
        const count=Number(a.db.prepare('select count(*) as n from records where '+filter).get(pattern,pattern).n);total+=count;
        if(skip>=count){skip-=count;continue;}const room=limit-base.results.length;
        if(room>0)for(const r of rows(a.db,`select raw from records where ${filter} order by file,line,id limit ? offset ?`,[pattern,pattern,room,skip]))base.results.push(args.kind==='call'?graph.callNode(a,r):graph.symbol(a,r));skip=0;
      }
      paged=true;base.total=total;base.nextCursor=offset+limit<total?Buffer.from(JSON.stringify({key:queryKey,offset:offset+limit})).toString('base64url'):null;
    }else if(operation==='ports')base.results=graph.ports.filter(p=>!args.kind||p.portType===args.kind);
    else if(operation==='compare'){
      if(analyses.length!==2)throw Error('compare requires exactly two immutable analyses');
      compare(analyses,databases,base);
    }else if(operation==='assertions'){
      const selected=choose(args.target||args.from);for(const n of selected.filter(n=>n.kind==='method')){const a=graph.byAnalysis.get(n.analysisId);for(const r of rows(a.db,"select raw from records where type='guard' and method=? limit ?",[n.locator.nodeId,limit+1]))base.results.push({...r,id:identity(a,'guard:'+r.id),analysisId:a.id,repo:a.repo,sha:a.sha,status:r.status==='declared'?'declared':'unknown',method:n.id,reason:'Presence of a guard or validation call does not establish dominance, feasibility, or every-path enforcement'});}
      base.proof={kind:'guard-evidence',status:'unknown',feasibility:'unknown'};
    }else if(['callers','callees','neighborhood','neighbors'].includes(operation)){
      const selected=choose(args.target||args.from);for(const node of selected){graph.loadCalls(node);const outgoing=graph.adjacency.get(node.id)||[],incoming=operation==='callees'?[]:graph.incoming(node);for(const edge of operation==='callers'?incoming:operation==='callees'?outgoing:[...incoming,...outgoing])base.results.push({edge,node:graph.nodes.get(edge.from===node.id?edge.to:edge.from)});}
    }else if(['paths','slice'].includes(operation)){
      const from=choose(args.from),to=choose(args.to||args.target),targets=new Set(to.map(n=>n.id));
      if(mode!=='reachability'){
        base.deepRequests=[];
        for(const a of graph.byAnalysis.values()){
          const starts=from.filter(n=>n.analysisId===a.id),ends=to.filter(n=>n.analysisId===a.id);if(!starts.length||!ends.length)continue;
          const nodeIds=(ns,source)=>ns.flatMap(n=>{
            if(n.kind==='method')return mode==='controlflow'?[n.locator.nodeId]:source?n.parameters.filter(p=>p.index>0&&(!args.from?.parameter||p.name===args.from.parameter||p.index===args.from.parameter)).map(p=>String(p.id)):n.returnId?[String(n.returnId)]:[];
            if(n.kind==='call')return mode==='controlflow'||source?[n.locator.nodeId]:n.arguments.filter(p=>p.index>0).map(p=>String(p.id));
            if(n.kind==='port'){
              if(n.callId){const record=parse(a.db.prepare("select raw from records where type='call' and id=?").get(String(n.callId)));return record?(mode==='controlflow'||source?[String(record.id)]:(record.arguments||[]).filter(p=>p.index>0).map(p=>String(p.id))):[];}
              if(['http-ingress','kafka-consume','scheduled'].includes(n.portType)){return n.handlerCandidates.flatMap(id=>{const m=graph.nodes.get(id);return mode==='controlflow'?[m.locator.nodeId]:source?m.parameters.filter(p=>p.index>0).map(p=>String(p.id)):[];});}
            }
            return [];
          });
          const fromNodeIds=nodeIds(starts,true),toNodeIds=nodeIds(ends,false);if(fromNodeIds.length&&toNodeIds.length)base.deepRequests.push({analysisId:a.id,request:{operation,mode,fromNodeIds,toNodeIds,maxPaths,maxHops,budgetMs:bounded(args.budgetMs,5000,100,30000)}});
        }
        if(!base.deepRequests.length)base.gaps.push({kind:'dataflow-boundary',detail:'No single CPG contains both resolved value endpoints; call/transport reachability cannot prove distributed value flow'});
        base.proof={kind:mode,status:'requires-deep-query',feasibility:'unknown'};
      }
      {
        const queue=from.map(n=>({node:n,path:[n.id],edges:[]}));let visited=0;
        while(queue.length&&base.results.length<maxPaths&&visited++<20000&&Date.now()<deadline){const item=queue.shift();if(targets.has(item.node.id)){const data=item.edges.some(e=>e.nature==='data-dependency');base.results.push({id:'path:'+digest(item.path).slice(0,24),kind:data?'data-dependency':'call-reachability',nodes:item.path.map(id=>graph.nodes.get(id)),edges:item.edges,conditions:[],proof:{status:'static-candidate',feasibility:'unknown',controlTrigger:data?false:undefined,distributed:item.edges.some(e=>e.kind.endsWith('-transport')),note:'Call and boundary reachability does not establish value flow, path feasibility, or universal assertions'}});continue;}if(item.path.length>=maxHops)continue;graph.loadCalls(item.node);for(const edge of graph.adjacency.get(item.node.id)||[]){if(item.path.includes(edge.to))continue;const next=graph.nodes.get(edge.to);if(next)queue.push({node:next,path:[...item.path,edge.to],edges:[...item.edges,edge]});if(queue.length>20000){base.truncated=true;queue.length=20000;break;}}}
        if(queue.length)base.truncated=true;
      }
      for(const candidate of base.results){const conditions=[];for(const node of candidate.nodes.filter(n=>n.kind==='method')){const a=graph.byAnalysis.get(node.analysisId);for(const guard of rows(a.db,"select raw from records where type='guard' and method=? limit 100",[node.locator.nodeId]))conditions.push({...guard,analysisId:a.id,repo:node.repo,sha:node.sha,status:guard.status==='declared'?'declared':'unknown',scope:'method evidence; applicability to this call path is unproven'});}candidate.conditions=conditions;}
      if(mode==='dataflow'&&base.results.some(path=>path.edges.some(edge=>['kafka-transport','http-transport','db-read','db-write','exact-library-call'].includes(edge.kind)))){
        base.compositions=base.results.map(path=>planComposition(graph,path,args));base.results=[];base.gaps=base.gaps.filter(g=>g.kind!=='dataflow-boundary');
      }else if(mode!=='reachability')base.results=[];
    }else throw Error('Unsupported semantic operation');
    if(!paged){const all=base.results;base.results=all.slice(offset,offset+limit);base.total=all.length;base.nextCursor=offset+limit<all.length?Buffer.from(JSON.stringify({key:queryKey,offset:offset+limit})).toString('base64url'):null;}
    base.truncated ||= graph.truncated();
    base.gaps=base.gaps.slice(0,200);base.ambiguity=base.ambiguity.slice(0,100);base.counts={nodes:graph.nodes.size,edges:[...graph.adjacency.values()].reduce((n,e)=>n+e.length,0)};
    return base;
  }finally{for(const db of databases)db.close();}
}
function parseCursor(cursor,key){let c;try{c=JSON.parse(Buffer.from(cursor,'base64url'));}catch{throw Error('Invalid semantic cursor');}if(c.key!==key||!Number.isInteger(c.offset)||c.offset<0)throw Error('Cursor belongs to another immutable query');return c.offset;}
module.exports={query,index,INDEX_VERSION};
