// Worker-only serving: indexed SQL lookups and bounded graph walks, no source scans.
const B=require('./data-lineage-build'),S=require('./data-lineage-store'),ID=require('./semantic-identity');
const coverage={exhaustive:false,source:'cached-source-and-catalog',proof:'static-access-and-call-reachability',runtime:'unknown',valueFlow:'not-proven',unknowns:['dynamic SQL','reflection/generated mappers','ORM dirty checking and projections','message payload field equivalence','unfetched repositories']};
async function status(args={}) {
  const input=await B.inputs(args),db=S.open(input.env);
  try {const g=db&&S.latest(db,input.selection,args.generation);return {protocol:'dt.data-index/v1',env:input.env,selection:input.selection,signature:input.signature,generation:g?.id || null,at:g?.at || null,state:!g?'missing':g.signature===input.signature?'ready':'stale',sources:input.sources.length,unindexed:input.raw.map(s=>s.key).slice(0,50),stats:g?.stats || null,coverage};} finally {db?.close();}
}
const brief=n=>n&&Object.fromEntries(['id','kind','name','object','db','env','service','repo','indexKey','revisionKey','revision','sourceDigest','sha','symbol','signature','file','line','cluster','topic','index','inheritedFrom','generated','test'].filter(k=>n[k]!==undefined).map(k=>[k,n[k]]));
function resolve(db,target,{database,service,limit=50}={}) {
  target=String(target || '').trim();if(!target||target.length>2000)throw S.invalid('Supply a bounded exact data object, entrypoint or symbol');
  const exact=S.getNode(db,target);if(exact)return {nodes:[exact]};
  const prefix=target.match(/^(table|column|pgfn|function|fn|topic|kafka|es|endpoint|service|method|class):(.+)$/i);
  let kind=prefix?({function:'pgfn',fn:'pgfn',kafka:'topic'}[prefix[1].toLowerCase()] || prefix[1].toLowerCase()):null,name=prefix?prefix[2].trim():target;
  if(kind==='service') {
    const rows=db.prepare("SELECT DISTINCT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.service=? AND n.kind='endpoint' LIMIT ?").all(name,limit+1).map(r=>JSON.parse(r.payload));
    return {nodes:rows.slice(0,limit),multipleRoots:true,truncated:rows.length>limit};
  }
  let sql,args;
  if(kind==='endpoint'||/^(GET|POST|PUT|DELETE|PATCH|ANY)\s+\//i.test(name)) {
    const route=name.match(/^(\w+)\s+(.*)$/);if(!route)return {nodes:[]};
    const norm=s=>(s.replace(/\{[^}]*\}|:[\w]+/g,'{}').replace(/\/+$/,'')||'/').split('/');
    const rows=db.prepare("SELECT DISTINCT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='endpoint'").iterate();
    const result=[];
    for(const row of rows){const n=JSON.parse(row.payload),method=n.name.slice(0,n.name.indexOf(' ')),have=norm(n.name.slice(n.name.indexOf(' ')+1)),want=norm(route[2]);if((!service||n.service===service)&&(method===route[1].toUpperCase()||method==='ANY')&&have.length===want.length&&have.every((s,i)=>s==='{}'||want[i]==='{}'||s===want[i]))result.push(n);if(result.length>limit)break;}
    return {nodes:result.slice(0,limit),ambiguous:result.length>1,truncated:result.length>limit};
  }
  if(!kind||['table','column','pgfn'].includes(kind)) {
    let dbName=database;const colon=name.indexOf(':');if(colon>=0){dbName=name.slice(0,colon);name=name.slice(colon+1);}
    const object=ID.norm(name),kinds=kind?[kind]:object.split('.').length>=3?['column']:['table','pgfn'];
    sql=`SELECT DISTINCT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind IN (${kinds.map(()=>'?')}) AND ${object.includes('.')?'n.object=?':'n.leaf=?'} ${dbName?'AND n.db=?':''} LIMIT ?`;
    args=[...kinds,object,...(dbName?[dbName]:[]),limit+1];
    const rows=db.prepare(sql).all(...args).map(r=>JSON.parse(r.payload));
    if(rows.length)return {nodes:rows.slice(0,limit),ambiguous:rows.length>1,truncated:rows.length>limit};
  }
  if(['topic','es'].includes(kind)) {
    const field=kind==='topic'?'topic':'index';
    const rows=db.prepare('SELECT DISTINCT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind=? AND n.name=? LIMIT ?').all(kind,name,limit+1).map(r=>JSON.parse(r.payload));
    return {nodes:rows.slice(0,limit),ambiguous:rows.length>1,truncated:rows.length>limit,identity:field};
  }
  const rows=db.prepare('SELECT DISTINCT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE (n.id=? OR n.symbol=? OR n.legacy=? OR n.name=?) LIMIT ?').all(target,name,name,name,limit+1).map(r=>JSON.parse(r.payload));
  return {nodes:rows.slice(0,limit),ambiguous:rows.length>1,truncated:rows.length>limit};
}
const allowed=(edge,args)=>args.includeCandidates!==false||!edge.candidate;
const traversable=e=>!['entity','repository-entity','extends','implements'].includes(e.relation);
function upstream(db,id,args,{maxNodes=args.maxNodes || 500,maxHops=args.maxHops || 20,deadline=Infinity}={}) {
  const queue=[{id,path:[],requiredService:S.getNode(db,id)?.service || null}],seen=new Set([id]),services=new Map(),gaps=[];let at=0;
  while(at<queue.length&&seen.size<=maxNodes) {
    if(performance.now()>deadline){gaps.push({kind:'upstream-time-limit'});break;}
    require('./execution').check();const item=queue[at++],n=S.getNode(db,item.id);
    if(item.requiredService&&n?.service&&item.requiredService!==n.service)continue;
    if(n?.service&&!services.has(n.service))services.set(n.service,{service:n.service,repo:n.repo,revision:n.revision,entry:brief(n),via:item.path.slice(-8)});
    const edges=S.adjacent(db,item.id,true,100);
    if(edges.length>100)gaps.push({kind:'upstream-fanout-limit',at:item.id});
    if(item.path.length>=maxHops){if(edges.length)gaps.push({kind:'upstream-depth-limit',at:item.id});continue;}
    for(const e of edges.slice(0,100)) {
      if(!allowed(e,args)||!traversable(e)||seen.has(e.src)||['read','predicate','mapping'].includes(e.access))continue;
      const requiredService=['http-egress','kafka-produce'].includes(e.relation)?null:e.relation==='dispatch'?e.service || item.requiredService:item.requiredService;
      seen.add(e.src);queue.push({id:e.src,requiredService,path:[...item.path,{from:e.src,to:e.dst,relation:e.relation,proof:e.proof,candidate:!!e.candidate}]});
      if(seen.size>=maxNodes)break;
    }
  }
  if(at<queue.length)gaps.push({kind:'upstream-node-limit'});
  if(services.size>30)gaps.push({kind:'upstream-service-limit',total:services.size,limit:30});
  return {services:[...services.values()].slice(0,30),gaps};
}
function targetTable(db,ns) {
  db.exec('CREATE TEMP TABLE target_nodes(id TEXT PRIMARY KEY) WITHOUT ROWID;');
  const put=db.prepare('INSERT OR IGNORE INTO target_nodes VALUES (?)');
  for(const n of ns){put.run(n.id);if(n.kind==='table')db.prepare("INSERT OR IGNORE INTO target_nodes SELECT n.id FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='column' AND n.parent=?").run(n.id);}
}
function gaps(db) {
  const rows=db.prepare('SELECT g.payload FROM gaps g JOIN active_segments a ON a.id=g.segment LIMIT 31').all();
  return {gaps:rows.slice(0,30).map(r=>JSON.parse(r.payload)),gapTotal:db.prepare('SELECT count(*) n FROM gaps g JOIN active_segments a ON a.id=g.segment').get().n};
}
function decode(cursor,query,generation) {
  if(!cursor)return {phase:0,id:0,map:0};
  try{if(cursor.length>3000)throw Error();const c=JSON.parse(Buffer.from(cursor,'base64url'));if(c.query!==query||c.generation!==generation||![0,1,2].includes(c.phase)||![c.id,c.map].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error();return c;}catch{throw S.invalid('Continuation does not match this retained data query');}
}
function nameWords(target,args,generation) {
  const object=target?.object || target?.name || String(args.name).replace(/^(?:table|column|pgfn|function|fn):/,''),word=object.split('.').at(-1);
  const aliases=(generation.stats?.aliases || []).filter(a=>a.target===target?.id||a.target===args.name||a.target===object).flatMap(a=>a.names || []);
  return [...new Set([...aliases,word].map(S.fold))].filter(w=>w.length>=3).slice(0,20);
}
function mentionPage(db,g,args,r) {
  const words=nameWords(r.nodes[0],args,g),query=S.hash([args.name,args.db,args.operation,'mentions']),cursor=decode(args.cursor,query,g.id),limit=Math.max(1,Math.min(200,args.limit || 30));
  if(!words.length)return {operation:args.operation,mode:'mentions',target:args.name,state:'ready',rows:[],total:0,coverage,...gaps(db),note:'Name candidate indexing requires at least three normalized characters. Use code_search for shorter names.'};
  const match=words.map(w=>'"'+w.replaceAll('"','""')+'"').join(' OR '),join='FROM mention_search f JOIN mentions m ON m.id=f.rowid JOIN active_segments a ON a.id=m.segment WHERE mention_search MATCH ?';
  const rows=db.prepare('SELECT m.* '+join+' AND m.id>? ORDER BY m.id LIMIT ?').all(match,cursor.id,limit+1),total=db.prepare('SELECT count(*) n '+join).get(match).n;
  const selected=rows.slice(0,limit),last=selected.at(-1);
  return {operation:args.operation,mode:'mentions',target:args.name,state:'ready',resolved:r.nodes.map(brief),rows:selected.map(m=>({id:m.id,user:brief(S.getNode(db,m.node)),target:brief(r.nodes[0]) || {name:args.name},access:'unknown',proof:'substring-candidate',candidate:true,scope:'mention',file:m.file,line:m.line,evidence:m.raw,services:[]})),total,nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify({generation:g.id,query,phase:2,id:last.id,map:0})).toString('base64url'):null,coverage,...gaps(db),note:'Substring/name candidates only. Spelling does not prove a read, write, invocation or value flow.'};
}
function usage(db,g,args) {
  const r=resolve(db,args.name,{database:args.db}),base={operation:args.operation,target:args.name,resolved:r.nodes.map(brief),...gaps(db),coverage};
  if(args.mode==='mentions')return mentionPage(db,g,args,r);
  if(!r.nodes.length||r.ambiguous)return {...base,state:r.ambiguous?'ambiguous':'not-found',candidates:r.nodes.map(brief),candidateTotalAtLeast:r.nodes.length+(r.truncated?1:0),candidateMore:!!r.truncated,rows:[],total:0,hint:r.ambiguous?'Select one canonical id, database, service or repository revision.':'No matching object in the retained index. Inspect data_index coverage or add a reviewed alias.'};
  targetTable(db,r.nodes);
  const direction=args.operation==='writers'?'write':'read',access=direction==='read'?['read','predicate','selects','call']:['write','owner','call'];
  if(args.includeObjectAccess!==false)access.push(direction==='read'?'object-read':'object-write');
  const query=S.hash([args.name,args.db,args.operation,args.includeCandidates!==false,args.includeObjectAccess!==false]);
  const cursor=decode(args.cursor,query,g.id),limit=Math.max(1,Math.min(200,args.limit || 30));
  const candidate=args.includeCandidates===false?"AND coalesce(json_extract(e.payload,'$.candidate'),0)=0":'';
  const topicRead=r.nodes[0].kind==='topic'&&direction==='read';
  const select=`FROM edges e JOIN active_segments a ON a.id=e.segment JOIN target_nodes t ON t.id=e.${topicRead?'src':'dst'} WHERE e.access IN (${access.map(()=>'?')}) ${candidate}`;
  const directTotal=db.prepare('SELECT count(*) n '+select).get(...access).n,directObjects=db.prepare('SELECT count(*) n '+select+" AND e.access IN ('object-read','object-write')").get(...access).n;
  const objectAccess=direction==='read'?'object-read':'object-write';
  const objectSql=`FROM edges e JOIN active_segments a ON a.id=e.segment JOIN edges m ON m.src=e.dst JOIN active_segments b ON b.id=m.segment JOIN target_nodes t ON t.id=m.dst WHERE m.relation='maps-column' AND e.access=? ${candidate} ${args.includeCandidates===false?"AND coalesce(json_extract(m.payload,'$.candidate'),0)=0":''}`;
  const objectTotal=args.includeObjectAccess===false?0:db.prepare('SELECT count(*) n '+objectSql).get(objectAccess).n;
  const rows=[],cache=new Map(),extraGaps=[],deadline=performance.now()+Math.max(50,Math.min(5000,args.budgetMs || 1000));let pageBytes=0,pageFull=false;
  const append=(e,target,phase,map=0)=>{
    const n=S.getNode(db,e.src),t=S.getNode(db,target || e.dst);
    if(n?.test)return true;
    if(!cache.has(e.src))cache.set(e.src,upstream(db,e.src,args,{deadline}));const callers=cache.get(e.src);extraGaps.push(...callers.gaps);
    const row={id:e.edgeId,user:brief(n)||{id:e.src,name:e.src},target:brief(t)||{id:e.dst},access:e.access,scope:phase||e.access.startsWith('object-')?'object':e.access==='call'?'invocation':'database-or-boundary',proof:e.proof,candidate:!!e.candidate,file:e.file,line:e.line,evidenceSource:e.evidenceSource,evidence:e.evidence || e.syntax || e.note || e.relation,services:callers.services,persistenceVerified:false,_cursor:{generation:g.id,query,phase,id:e.edgeId,map}};
    const bytes=()=>Buffer.byteLength(JSON.stringify(row));while(bytes()>262144&&row.services.length>1){row.services.pop();row.attributionClipped=true;}if(bytes()>1048576)throw Object.assign(Error('One evidence identity exceeds the page budget; narrow the source/attribution scope'),{code:'DT_RESULT_TOO_LARGE'});
    if(pageBytes+bytes()>1048576&&rows.length){pageFull=true;return false;}pageBytes+=bytes();rows.push(row);return true;
  };
  if(cursor.phase===0)for(const row of db.prepare(`SELECT e.id,e.payload ${select} AND e.id>? ORDER BY e.id LIMIT ?`).iterate(...access,cursor.id,limit+1)){const e=JSON.parse(row.payload);if(!append({...e,...(topicRead?{src:e.dst,dst:e.src}:{}),edgeId:row.id},null,0)||rows.length>limit)break;}
  if(!pageFull&&rows.length<=limit&&args.includeObjectAccess!==false)for(const row of db.prepare(`SELECT e.id,e.payload,m.id mid,m.dst target,m.payload mapping ${objectSql} AND (e.id>? OR (e.id=? AND m.id>?)) ORDER BY e.id,m.id LIMIT ?`).iterate(objectAccess,cursor.phase===1?cursor.id:0,cursor.phase===1?cursor.id:0,cursor.phase===1?cursor.map:0,limit+1-rows.length)){const e=JSON.parse(row.payload),mapping=JSON.parse(row.mapping);if(!append({...e,candidate:!!e.candidate||!!mapping.candidate,edgeId:row.id},row.target,1,row.mid)||rows.length>limit)break;}
  const more=pageFull||rows.length>limit,selected=rows.slice(0,limit),last=selected.at(-1)?._cursor;
  const nextCursor=more&&last?Buffer.from(JSON.stringify(last)).toString('base64url'):null;
  for(const row of selected)delete row._cursor;
  // Substrings and custom aliases remain a separate candidate list, never read/write evidence.
  const words=nameWords(r.nodes[0],args,g),mentions=[];
  for(const word of words.slice(0,20)) {
    const fts='"'+word.replaceAll('"','""')+'"';
    for(const row of db.prepare('SELECT m.* FROM mention_search f JOIN mentions m ON m.id=f.rowid JOIN active_segments a ON a.id=m.segment WHERE mention_search MATCH ? AND instr(m.folded,?)>0 ORDER BY m.id LIMIT 20').iterate(fts,word)) {
      const n=S.getNode(db,row.node);mentions.push({user:brief(n),file:row.file,line:row.line,text:row.raw,proof:'substring-candidate',access:'unknown'});
    }
  }
  const summary=[...new Map(selected.flatMap(r=>r.services.map(s=>[s.service,{service:s.service,repo:s.repo,revision:s.revision}]))).values()];
  return {...base,state:'ready',direction,rows:selected,total:directTotal+objectTotal,directTotal:directTotal-directObjects,objectTotal:objectTotal+directObjects,nextCursor,pageByteLimit:1048576,services:summary,servicesScope:'this-page-and-bounded-upstream-callers',mentions:mentions.slice(0,20),mentionCoverage:'bounded candidates; spelling alone does not prove usage',gaps:[...base.gaps,...extraGaps].slice(0,30),traversalComplete:!extraGaps.length,...(!selected.length?{note:'No detected access in this retained projection. This does not establish absence; inspect gaps and mode=mentions.'}:{})};
}
function trace(db,g,args) {
  const from=resolve(db,args.from,{database:args.db,service:args.service}),to=resolve(db,args.to,{database:args.db});
  const base={operation:'trace',from:args.from,to:args.to,resolved:{from:from.nodes.map(brief),to:to.nodes.map(brief)},coverage,...gaps(db)};
  if(!from.nodes.length||!to.nodes.length||from.ambiguous||to.ambiguous)return {...base,state:from.ambiguous||to.ambiguous?'ambiguous':'not-found',paths:[],candidates:{from:from.nodes.map(brief),to:to.nodes.map(brief)}};
  const maxHops=Math.max(1,Math.min(80,args.maxHops || 30)),maxNodes=Math.max(10,Math.min(20000,args.maxNodes || 3000)),maxPaths=Math.max(1,Math.min(20,args.maxPaths || 5)),timeMs=Math.max(50,Math.min(5000,args.budgetMs || 1000)),fanout=Math.max(10,Math.min(1000,args.fanout || 200));
  const targets=new Set(to.nodes.map(n=>n.id)),queue=from.nodes.map(n=>({id:n.id,nodes:[n.id],edges:[],service:args.service || n.service || null})),paths=[],cut=new Set(),started=performance.now(),expanded=new Map();let at=0,visits=0;
  while(at<queue.length&&paths.length<maxPaths) {
    require('./execution').check();if(performance.now()-started>timeMs){cut.add('time');break;}
    const item=queue[at++];if(targets.has(item.id)){paths.push(item);continue;}
    if(++visits>maxNodes){cut.add('nodes');break;}
    if(item.edges.length>=maxHops){cut.add('depth');continue;}
    // Bound repeated arrivals while retaining a few alternative call sites.
    const seen=expanded.get(item.id)||0;if(seen>=maxPaths)continue;expanded.set(item.id,seen+1);
    const edges=S.adjacent(db,item.id,false,fanout);if(edges.length>fanout)cut.add('fanout');
    for(const e of edges.slice(0,fanout)) {
      if(!allowed(e,args)||!traversable(e)||item.nodes.includes(e.dst))continue;
      if(e.relation==='trigger'&&item.edges.length&&item.edges.at(-1).access!=='write')continue;
      if(e.relation==='dispatch'&&item.service&&e.service&&item.service!==e.service)continue;
      const n=S.getNode(db,e.dst);if(n?.test)continue;
      const service=['http-ingress','inherited-http-ingress','kafka-consume'].includes(e.relation)?n?.service || item.service:item.service;
      queue.push({id:e.dst,nodes:[...item.nodes,e.dst],edges:[...item.edges,e],service});
      if(queue.length>=maxNodes*2){cut.add('queue');break;}
    }
    if(cut.has('queue'))break;
  }
  if(paths.length>=maxPaths&&at<queue.length)cut.add('paths');
  return {...base,state:'ready',paths:paths.map(p=>({nodes:p.nodes.map(id=>brief(S.getNode(db,id))||{id,name:id}),edges:p.edges.map(({edgeId,...e})=>e),proof:p.edges.some(e=>e.candidate)?'candidate-static-path':p.edges.some(e=>e.proof==='declared')?'declared-static-path':p.edges.some(e=>e.access?.startsWith('object-'))?'object-mapping-path':'static-access-path',assumptions:[...new Set(p.edges.flatMap(e=>[e.candidate?e.note || 'Candidate binding requires verification':null,e.access?.startsWith('object-')?'Object accessor/mapping does not establish a persisted database write.':null,e.condition].filter(Boolean)))]})),visited:visits,traversalComplete:!cut.size,cutReasons:[...cut],maxHops,maxNodes,maxPaths,ms:performance.now()-started,note:paths.length?'Call/access topology. This does not prove a value survives every mapping, condition, transaction or message boundary.':'No path found within the selected sources and budgets; this is not proof of no runtime path.'};
}
async function query(args={}) {
  const input=await B.inputs(args),db=S.open(input.env);if(!db){if(args.generation||args.cursor)throw S.invalid('Retained data index generation is unavailable in this scope');return {state:'missing',rows:[],paths:[],coverage};}
  try {
    const g=S.latest(db,input.selection,args.generation || cursorGeneration(args.cursor));if(!g)return {state:'missing',rows:[],paths:[],coverage};
    S.activate(db,g.id);const result=args.operation==='trace'?trace(db,g,args):usage(db,g,{...args,env:input.env});
    return {protocol:'dt.data-lineage/v1',env:input.env,generation:g.id,at:g.at,stale:g.signature!==input.signature,...result};
  } finally {db.close();}
}
function cursorGeneration(value){if(!value)return undefined;try{return JSON.parse(Buffer.from(value,'base64url')).generation;}catch{throw S.invalid('Invalid data query continuation');}}
module.exports={status,build:B.build,query,resolve,brief,coverage};
