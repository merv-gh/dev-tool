// Versioned impact projection. Canonical identities never merge databases, revisions or overloads.
const CI = require('./codeindex'), ID = require('./semantic-identity');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const memo = new Map();
function load({ repos, env } = {}) {
  const keys=CI.select(repos), passports=require('./passport/edges').snapshot();
  const cats=env?require('./pg').loadAll(env):[];
  const usage=env?require('./pgindex').current(env):{edges:[]};
  const info=keys.map(k=>({key:k,idx:CI.load(k)})).filter(x=>x.idx);
  const signature=digest([env,info.map(x=>[x.key,x.idx.sha,x.idx.builtAt]),cats,usage.builtAt,usage.edges,passports.signature,require('./config').getPersonal().libraryRepos]);
  const key=JSON.stringify([keys,env]); if(memo.get(key)?.signature===signature)return memo.get(key);
  const G=build(info,env,cats,usage,passports);G.signature=signature;
  memo.set(key,G);if(memo.size>8)memo.delete(memo.keys().next().value);return G;
}
function build(info,env,cats,usage,passports) {
  const nodes=new Map(),classes=new Map(),fwd=new Map(),rev=new Map(),aliases=new Map(),gaps=[...passports.gaps],sql=[];
  const alias=(a,id)=>{const s=aliases.get(a)||new Set();s.add(id);aliases.set(a,s);};
  const node=(id,n)=>{nodes.set(id,{id,...n});if(n.legacyId)alias(n.legacyId,id);return id;};
  const add=e=>{(fwd.get(e.from)||fwd.set(e.from,[]).get(e.from)).push(e);(rev.get(e.to)||rev.set(e.to,[]).get(e.to)).push(e);};
  const pgid=(kind,db,name)=>ID.pg(kind,env,db,name);
  for(const cat of cats){
    for(const t of cat.tables||[]){const name=ID.qualified(t.schema,t.name);node(pgid('table',cat.db,name),{kind:'table',name:`table:${name}`,legacyId:`table:${name}`,env,db:cat.db,object:name,revision:cat.syncedAt});for(const c of t.columns||[])node(pgid('column',cat.db,`${name}.${ID.identifier(c.name)}`),{kind:'column',legacyId:`column:${name}.${c.name}`,env,db:cat.db,object:`${name}.${ID.identifier(c.name)}`,revision:cat.syncedAt});}
    for(const [ordinal,f] of (cat.functions||[]).entries()){const name=ID.qualified(f.schema,f.name),overloaded=cat.functions.filter(x=>x.schema===f.schema&&x.name===f.name).length>1;const fid=overloaded?pgid('pgfn',cat.db,`${name}(${f.signature||f.args||`overload-${ordinal}`})`):pgid('pgfn',cat.db,name);if(overloaded)gaps.push({kind:'ambiguous-pg-function-overload',env,db:cat.db,target:name,detail:'Legacy usage edges do not preserve argument signatures; select exact catalog overload and verify runtime callers.'});node(fid,{kind:'pgfn',name:`pgfn:${name}`,legacyId:`pgfn:${name}`,env,db:cat.db,object:name,revision:cat.syncedAt});}
  }
  const indexed=new Set(),perRepo=new Map(),byClass=new Map();
  for(const {key,idx} of info){
    const revision=ID.revision(idx);
    const g=idx.graph_(),local=new Map();if(!g.preciseEdges)gaps.push({kind:'legacy-codegraph',repo:key,detail:'Refresh the code index for call-site and overload evidence.'});perRepo.set(key,local);
    const put=(legacy,id)=>{const ns=local.get(legacy)||[];ns.push(id);local.set(legacy,ns);};
    for(const c of g.classes||[]){
      const cid=ID.code(key,ID.revision(idx),c.id),sc={...c,id:cid,legacyId:c.id,repo:key,revision:ID.revision(idx)};
      classes.set(cid,sc);node(cid,{...sc,kind:'class'});put(c.id,cid);
      const cs=byClass.get(c.id)||[];cs.push(sc);byClass.set(c.id,cs);
      for(const m of c.methods){const symbol=`${c.id}#${ID.signature(m)}`,mid=ID.code(key,ID.revision(idx),symbol);node(mid,{kind:'method',classId:cid,legacyId:`${c.id}#${m.name}`,symbol,signature:ID.signature(m),repo:key,revision:ID.revision(idx),file:c.file,line:m.line,endLine:m.endLine,test:c.test,role:c.role,name:`${c.name}#${m.name}`,annos:m.annos,params:m.params});alias(symbol,mid);put(`${c.id}#${m.name}`,mid);put(symbol,mid);}
      for(const f of c.fields){const fid=ID.code(key,ID.revision(idx),`${c.id}.${f.name}`);node(fid,{kind:'field',classId:cid,legacyId:`${c.id}.${f.name}`,repo:key,revision:ID.revision(idx),file:c.file,line:f.line,test:c.test,role:c.role,name:`${c.name}.${f.name}`,column:f.column});put(`${c.id}.${f.name}`,fid);}
    }
    if(g.app?.name)indexed.add(g.app.name);indexed.add(idx.repo||key.split('/').pop());
  }
  const servicePassports=new Map(passports.rows.filter(x=>!env||!x.passport.env||x.passport.env===env).map(x=>[x.passport.service,x.passport]));
  function resolveData(raw,key){
    const m=raw.match(/^(table|column|pgfn):(.+)$/);if(!m)return [raw];
    const kind=m[1],name=ID.norm(m[2]);let ns=[...nodes.values()].filter(n=>n.kind===kind&&(n.object===name||n.object?.endsWith('.'+name)));
    const i=info.find(x=>x.key===key),p=servicePassports.get(i?.idx.graph_().app?.name)||servicePassports.get(i?.idx.repo);
    const dbs=new Set((p?.db?.datasources||[]).map(d=>String(d.db||'').toLowerCase()));
    if(dbs.size)ns=ns.filter(n=>dbs.has(n.db)||dbs.has(cats.find(c=>c.db===n.db)?.database));
    if(ns.length===1)return [ns[0].id];
    if(ns.length>1){gaps.push({kind:'ambiguous-code-database',repo:key,target:raw,candidates:ns.map(n=>n.id)});return [];}
    // Without a catalog retain unknown code evidence, explicitly scoped to this graph's environment.
    node(raw,{kind,legacyId:raw,name:raw,known:false,env});return [raw];
  }
  const versionCandidates=(legacy,key)=>{
    const bare=legacy.replace(/^ext:/,''),className=bare.split('#')[0];
    let candidates=[...(aliases.get(bare)||[])];
    if(!candidates.length)return [];
    const same=candidates.filter(id=>nodes.get(id)?.repo===key);if(same.length)return same;
    const owner=info.find(i=>i.key===key),libs=owner?.idx.libs||[];
    const allowed=new Set(libs.map(l=>l.index).filter(Boolean));
    if(allowed.size){const exact=candidates.filter(id=>allowed.has(nodes.get(id)?.repo));if(exact.length)return exact;}
    const deps=owner?.idx.graph_().app?.dependencies?.internal||[];
    if(deps.length){const matched=candidates.filter(id=>{const item=info.find(i=>i.key===nodes.get(id)?.repo);const a=item?.idx.graph_().app;return a?.artifactId&&deps.some(d=>d.artifactId===a.artifactId&&d.version&&d.version===a.version);});if(matched.length)return matched;}
    if(new Set(candidates.map(id=>nodes.get(id)?.repo)).size>1){gaps.push({kind:'ambiguous-library-revision',repo:key,target:bare,candidates});return [];}
    return candidates;
  };
  function resolveCode(raw,key,{where,source=false,arity,types}={}){
    if(!raw)return[];
    if(/^(table|column|pgfn):/.test(raw))return resolveData(raw,key);
    if(/^(topic|es|endpoint|svc|file):/.test(raw))return[raw];
    let ids=source?(perRepo.get(key)?.get(raw)||[]):versionCandidates(raw,key);
    if(source&&ids.length>1&&where){const line=Number(where.match(/:(\d+)$/)?.[1]);const file=where.replace(/:\d+$/,'');const precise=ids.filter(id=>{const n=nodes.get(id);return n.file===file&&n.line===line;});if(precise.length)ids=precise;else{const ranged=ids.filter(id=>{const n=nodes.get(id);return n.file===file&&n.line<=line&&line<=(n.endLine||n.line);});if(ranged.length)ids=ranged;}}
    if(!source&&ids.length>1&&arity!==undefined){const match=ids.filter(id=>nodes.get(id)?.params?.length===arity);if(match.length)ids=match;}
    if(!source&&ids.length>1&&types?.length&&types.every(Boolean)){const exact=ids.filter(id=>nodes.get(id)?.params?.every((p,i)=>p.type.replace(/\s+/g,'').split('.').pop()===String(types[i]).split('.').pop()));if(exact.length)ids=exact;}
    if(ids.length>1&&raw.includes('#'))gaps.push({kind:'ambiguous-overload-edge',repo:key,target:raw,where,candidates:ids});
    if(ids.length)return ids;
    if(raw.startsWith('ext:'))return[raw];
    // Generated/inherited methods have no declaration: retain an unknown node and a coverage gap.
    gaps.push({kind:'unknown-code-node',repo:key,target:raw,where});const id=ID.code(key,ID.revision(info.find(i=>i.key===key)?.idx),raw);node(id,{kind:raw.includes('#')?'method':'other',repo:key,legacyId:raw,name:raw,known:false});return[id];
  }
  for(const {key,idx} of info){const g=idx.graph_();
    for(const [from,to,kind,where,arity,types,fromSymbol] of g.preciseEdges||g.edges||[]){const src=resolveCode(fromSymbol||from,key,{source:true,where}),dst=resolveCode(to,key,{where,arity,types});for(const a of src)for(const b of dst)add({from:a,to:b,kind,where,repo:key,arity,...(src.length>1||dst.length>1?{ambiguous:true}:{})});}
    // Scan whole source SQL, including static constants and repository annotations outside methods.
    for(const f of idx.list||[]){if(!/\.(java|kt|sql)$/.test(f.path))continue;let text;try{text=fs.readFileSync(path.join(idx.root,f.path),'utf8');}catch{gaps.push({kind:'source-unreadable',repo:key,file:f.path});continue;}
      const literals=/\.sql$/.test(f.path)?[{value:text,index:0}]:require('./passport/extract').stringLiterals(require('./passport/extract').stripComments(text));
      for(const lit of literals)if(/\b(select|insert|update|delete|merge|execute)\b/i.test(lit.value)){
        const line=text.slice(0,lit.index).split('\n').length;
        const enclosing=[...nodes.values()].filter(n=>n.repo===key&&n.file===f.path&&n.kind==='method'&&n.line<=line&&line<=(n.endLine||n.line)).sort((a,b)=>(a.endLine-a.line)-(b.endLine-b.line))[0];
        sql.push({m:enclosing?.id||`file:${key}/${f.path}`,sql:lit.value,repo:key,file:f.path,line,revision:ID.revision(idx)});
      }
    }
    for(const e of g.errors||[])gaps.push({kind:'source-parse-error',repo:key,...e});
  }
  for(const e of usage.edges||[]){
    if(e.targetKind==='column')continue;
    if(['function','procedure'].includes(e.targetKind)&&[...nodes.values()].filter(n=>n.kind==='pgfn'&&n.db===e.db&&n.object===e.target).length>1)continue;
    if(['function','procedure'].includes(e.userKind)&&[...nodes.values()].filter(n=>n.kind==='pgfn'&&n.db===e.db&&n.object===e.user).length>1)continue;
    const kind=['function','procedure'].includes(e.targetKind)?'pgfn':'table',to=e.db?pgid(kind,e.db,e.target):`${kind}:${e.target}`;
    if(e.source==='db'){
      if(e.role==='trigger')continue;
      const uk=['function','procedure'].includes(e.userKind)?'pgfn':'table';add({from:pgid(uk,e.db,e.user),to,kind:e.role,where:e.where||e.detail||'',repo:`db:${e.db}`,env,db:e.db});
    }else if(!indexed.has(e.user)){
      const p=servicePassports.get(e.user),other=passports.rows.find(x=>x.passport.service===e.user)?.passport;
      if(other?.env&&other.env!==env)continue;
      add({from:`svc:${e.user}`,to,kind:e.role,where:e.where,repo:`svc:${e.user}`,env:p?.env||env,db:e.db,revision:p?.repo?.sha||null});
    }
  }
  for(const x of passports.rows){const p=x.passport;if(indexed.has(p.service))continue;const n=require('./passport/edges').normalize(p,{env,...x});gaps.push(...n.gaps);for(const e of n.edges)add(e);}
  // Interface implementations in other repos are only connected when the exact revision resolves.
  for(const [cid,c] of classes)for(const sup of [...(c.impl||[]),...(c.ext||[])]){
    for(const sid of versionCandidates(sup,c.repo)){const base=classes.get(sid);if(!base||base.repo===c.repo)continue;for(const m of c.methods){const match=base.methods.filter(x=>ID.signature(x)===ID.signature(m));for(const x of match)add({from:ID.code(base.repo,base.revision,`${base.legacyId}#${ID.signature(x)}`),to:ID.code(c.repo,c.revision,`${c.legacyId}#${ID.signature(m)}`),kind:'dispatch',where:`${c.file}:${m.line}`,repo:c.repo});}}
  }
  return{keys:info.map(x=>x.key),env,cats,nodes,classes,rev,fwd,aliases,sql,gaps};
}
function unique(G,ids,kind){ids=[...new Set(ids)];return ids.length>1?{start:[],kind,ambiguous:true,candidates:ids}:{start:ids,kind};}
function resolveTarget(G,target,{db}={}){
  const t=String(target||'').trim();if(!t)throw new Error('target is empty');
  if(G.nodes.has(t)||G.rev.has(t)||G.fwd.has(t))return{start:[t],kind:G.nodes.get(t)?.kind||kindOf(t)};
  const pre=t.match(/^(table|column|pgfn|fn|function|topic|kafka|es|endpoint|svc|service|class|method):\s*(.+)$/i);
  let kind=pre?({fn:'pgfn',function:'pgfn',kafka:'topic',service:'svc'}[pre[1].toLowerCase()]||pre[1].toLowerCase()):null,value=pre?pre[2]:t;
  if(kind==='endpoint'||/^(GET|POST|PUT|DELETE|PATCH|ANY)\s+\//i.test(t)){
    const [method,p]=value.split(/\s+/);if(!p)return{start:[],kind:'endpoint'};const want=normPath(p.replace(/\?.*$/,'')).split('/');
    return{start:[...new Set([...G.rev.keys(),...G.fwd.keys()])].filter(id=>{const m=id.match(/^endpoint:(\w+) (.*)$/);const have=m?.[2].split('/');return m&&(m[1]===method.toUpperCase()||m[1]==='ANY')&&have.length===want.length&&have.every((s,i)=>s==='{}'||want[i]==='{}'||s===want[i]);}),kind:'endpoint'};
  }
  if(['topic','es','svc'].includes(kind)){const id=`${kind}:${value}`;return{start:G.rev.has(id)||G.fwd.has(id)?[id]:[],kind};}
  if(['table','column','pgfn'].includes(kind)||(!kind&&!t.includes('#'))){
    let n=ID.norm(value),wantedDb=db,wantedEnv=G.env;const ps=n.split(':');if(ps.length===3){wantedEnv=decodeURIComponent(ps[0]);wantedDb=decodeURIComponent(ps[1]);n=ps[2];}else if(ps.length===2){wantedDb=decodeURIComponent(ps[0]);n=ps[1];}
    const found=[...G.nodes.values()].filter(x=>(!kind||x.kind===kind)&&['table','column','pgfn'].includes(x.kind)&&(!wantedDb||x.db===wantedDb)&&(!wantedEnv||x.env===wantedEnv)&&(x.object===n||x.object?.endsWith('.'+n)));
    if(found.length){const ks=new Set(found.map(x=>x.kind));if(!kind&&ks.has('table')&&ks.has('pgfn'))return{start:[],kind:'database',ambiguous:true,candidates:found.map(x=>x.id)};return unique(G,found.map(x=>x.id),found[0].kind);}
    if(kind)return{start:[],kind};
  }
  if(!kind){const data=['topic','es','svc'].map(k=>`${k}:${value}`).filter(id=>G.rev.has(id)||G.fwd.has(id));if(data.length)return unique(G,data,data.length===1?kindOf(data[0]):'data');}
  const alias=G.aliases.get(value);if(alias?.size)return unique(G,[...alias],kind||G.nodes.get([...alias][0])?.kind);
  const file=value.match(/^([\w./-]+\.(?:java|kt|groovy))(?::(\d+))?$/);if(file){const ns=[...G.nodes.values()].filter(n=>n.file&&(n.file===file[1]||n.file.endsWith('/'+file[1]))&&(!file[2]||n.line<=Number(file[2])&&Number(file[2])<=(n.endLine||n.line)));const ms=ns.filter(n=>n.kind==='method');return file[2]?unique(G,ms.map(n=>n.id),'method'):{start:ns.map(n=>n.id),kind:'file'};}
  const [cls,member]=value.split(/#|::/),all=[...G.classes.values()];
  const cs=all.filter(c=>c.legacyId===cls||c.legacyId.endsWith('.'+cls)||c.name===cls);
  if(cs.length>1){const ms=member?[...G.nodes.values()].filter(n=>cs.some(c=>c.id===n.classId)&&(n.signature===member||n.legacyId?.endsWith('#'+member)||n.legacyId?.endsWith('.'+member))):cs;return{start:[],kind:member?'method':'class',ambiguous:true,candidates:ms.map(c=>c.id)};}
  if(cs.length===1){const c=cs[0],ns=[...G.nodes.values()].filter(n=>n.classId===c.id);
    if(member)return unique(G,ns.filter(n=>n.signature===member||n.legacyId?.endsWith('#'+member)||n.legacyId?.endsWith('.'+member)).map(n=>n.id),'method');
    return{start:[c.id,...ns.map(n=>n.id)],kind:'class'};
  }
  return{start:[],kind:kind||'unknown',candidates:[...G.nodes.values()].filter(n=>value.toLowerCase().split(/[.#\s]+/).every(w=>(n.legacyId||n.id).toLowerCase().includes(w))).slice(0,15).map(n=>n.id)};
}
const kindOf=id=>ID.parseCode(id)?(id.includes('#')?'method':'class'):id.match(/^(\w+):/)?.[1]||'other';
const normPath=p=>String(p||'').replace(/\{[^}]*\}/g,'{}').replace(/\/+$/,'')||'/';
function columnEdges(G,id){
  const p=ID.parsePg(id);if(!p)return{edges:[],facts:[],gaps:[]};if(p.object.includes('"'))return{edges:[],facts:[],gaps:[{kind:'quoted-identifier-lineage-unsupported',targetId:id,detail:'Canonical identity is preserved; a SQL parser adapter is required for column evidence.'}]};
  const col=p.object.split('.').pop(),table=p.object.slice(0,-col.length-1),cat=G.cats.find(c=>c.db===p.db),edges=[],facts=[],gaps=[];
  if(!cat)return{edges,facts,gaps:[{kind:'catalog-missing',db:p.db}]};
  const a=require('./column-lineage').catalog(cat,G.env);
  for(const e of a.edges.filter(e=>e.target===p.object)){if(cat.functions.filter(f=>ID.qualified(f.schema,f.name)===e.user).length>1){gaps.push({kind:'ambiguous-pg-function-overload',db:p.db,target:e.user});continue;}const k=['function','procedure'].includes(e.userKind)?'pgfn':'table';edges.push({from:ID.pg(k,G.env,p.db,e.user),to:id,kind:e.access,where:e.where,repo:`db:${p.db}`,access:e.access,env:G.env,db:p.db,line:e.line,revision:e.revision,syntax:e.syntax});}
  gaps.push(...a.gaps);
  for(const s of G.sql){const r=require('./column-lineage').analyze(s.sql,cat);const possible=G.cats.filter(c=>c.tables.some(t=>ID.qualified(t.schema,t.name)===table));const uncertain=possible.length>1&&G.gaps.some(g=>g.kind==='ambiguous-code-database'&&g.repo===s.repo);if(uncertain)gaps.push({kind:'ambiguous-code-database',repo:s.repo,file:s.file,candidates:possible.map(c=>ID.pg('column',G.env,c.db,p.object))});for(const h of r.hits.filter(h=>h.table===table&&h.column===col))edges.push({binding:uncertain?'candidate':'resolved',ambiguous:uncertain||undefined,from:s.m,to:id,kind:h.access,access:h.access,where:`${s.file}:${s.line+h.line-1}`,repo:s.repo,file:s.file,line:s.line+h.line-1,revision:s.revision,env:G.env,db:p.db,syntax:h.syntax});gaps.push(...r.gaps.map(g=>({...g,repo:s.repo,file:s.file,line:s.line+g.line-1})));}
  const rel=cat.tables.find(t=>ID.qualified(t.schema,t.name)===table),word=new RegExp(`\\b${col.replace(/[^\w$]/g,'')}\\b`,'i');
  for(const x of rel?.indexes||[])if(word.test(x))facts.push({db:p.db,kind:'index',def:x});for(const x of rel?.constraints||[])if(word.test(x.def))facts.push({db:p.db,kind:'constraint',name:x.name,def:x.def});
  return{edges,facts,gaps};
}
function impact(target,{repos,env,db,depth=4,limit=400,node_limit=10000,time_ms=1000,max_output_bytes=32768,cursor,grep=true}={}){
  depth=Math.max(0,Math.min(32,depth));limit=Math.max(1,Math.min(2000,limit));node_limit=Math.max(1,Math.min(100000,node_limit));time_ms=Math.max(1,Math.min(5000,time_ms));max_output_bytes=Math.max(4096,Math.min(262144,max_output_bytes));
  const G=load({repos,env}),r=resolveTarget(G,target,{db}),query=digest([target,repos,env,db,depth,node_limit,time_ms,max_output_bytes]),cuts=[];let offset=0;
  if(cursor){let c;try{c=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw new Error('invalid impact continuation');}if(c.graph!==G.signature||c.query!==query)throw new Error('impact continuation expired: graph or query changed');if(!Number.isSafeInteger(c.offset)||c.offset<0)throw new Error('invalid impact continuation offset');offset=c.offset;}
  const base={protocol:'dt.impact/v2',identityVersion:ID.protocol,target,env:env||null,graphRevision:G.signature,resolved:r.start.slice(0,20),resolvedTotal:r.start.length,kind:r.kind,repos:G.keys.length,coverage:{source:'cached-index',exhaustive:false,codeParser:'java-kotlin-static/v1',unknowns:'Dynamic SQL, generated code, reflection and unindexed/runtime dependencies require observations or parser adapters.'}};
  if(!r.start.length)return boundResult({...base,complete:false,traversalComplete:false,ambiguous:r.ambiguous||undefined,candidates:(r.candidates||[]).slice(0,20),candidateTotal:r.candidates?.length||0,gaps:[{kind:r.ambiguous?'ambiguous-target':'unknown-target'}],note:r.ambiguous?'Select one exact canonical candidate; narrow repos or db to reduce candidates.':`nothing named in the selected cached indexes`},max_output_bytes);
  const extra=new Map(),facts=[],gaps=[...G.gaps];
  for(const s of r.start.filter(x=>x.startsWith('column:'))){const ce=columnEdges(G,s);for(const e of ce.edges)(extra.get(e.to)||extra.set(e.to,[]).get(e.to)).push(e);facts.push(...ce.facts);gaps.push(...ce.gaps);}
  const neighbours=(id,d)=>[...(G.rev.get(id)||[]),...(extra.get(id)||[])].map(e=>({id:e.from,e})).concat(d===0&&/^(table|topic|es|column|endpoint|pgfn):/.test(id)?(G.fwd.get(id)||[]).filter(e=>/produced-by|handler/.test(e.kind)).map(e=>({id:e.to,e})):[]);
  const seeds=r.start.slice(0,node_limit),seen=new Map(seeds.map(id=>[id,{depth:0,via:null}])),queue=[...seeds],started=performance.now();let q=0,frontier=r.start.slice(node_limit);if(frontier.length)cuts.push('nodes');
  outer:while(q<queue.length){const id=queue[q++],s=seen.get(id),next=neighbours(id,s.depth).filter(n=>!seen.has(n.id));
    if(s.depth>=depth){if(next.length){cuts.push('depth');frontier.push(id);}continue;}
    for(const n of next){if(n.id.startsWith('ext:')){gaps.push({kind:'unindexed-external-symbol',id:n.id,where:n.e.where});continue;}if(seen.has(n.id))continue;
      if(seen.size>=node_limit){cuts.push('nodes');frontier.push(id,...queue.slice(q));break outer;}if(performance.now()-started>=time_ms){cuts.push('time');frontier.push(id,...queue.slice(q));break outer;}
      seen.set(n.id,{depth:s.depth+1,via:{...n.e,from:id}});queue.push(n.id);
    }
  }
  const items=[];for(const [id,s]of seen){if(!s.depth)continue;const n=G.nodes.get(id)||{id,kind:kindOf(id),name:id};const {params,methods,fields,ctor,ext,impl,annos,lombok,...display}=n;items.push({...display,depth:s.depth,name:n.name||id,repo:n.repo||s.via.repo,file:n.file||null,line:n.line||s.via.line||null,test:!!n.test,via:`${s.via.kind} ${s.via.from}`,where:s.via.where,access:s.via.access,edge:{kind:s.via.kind,access:s.via.access,ambiguous:s.via.ambiguous,env:s.via.env,db:s.via.db,revision:s.via.revision,syntax:s.via.syntax}});}
  items.sort((a,b)=>a.depth-b.depth||a.test-b.test||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  const more=offset+limit<items.length;if(more)cuts.push('output');const reasons=[...new Set(cuts)],traversalComplete=!reasons.some(x=>x!=='output');
  const resultGaps=[...new Map(gaps.map(g=>[JSON.stringify(g),g])).values()].map(g=>({...g,...(g.candidates?{candidates:g.candidates.slice(0,10),candidateTotal:g.candidates.length}:{}),...(g.detail?{detail:String(g.detail).slice(0,512)}:{})}));
  const pick=k=>items.filter(i=>i.kind===k).map(i=>i.kind==='pgfn'||i.kind==='table'?i.id:i.id.replace(/^\w+:/,'')).slice(0,25);
  if(cursor&&!traversalComplete)throw new Error('impact continuation could not reproduce a complete traversal within its budget; increase time_ms or node_limit and restart');
  const continuation=more&&traversalComplete?Buffer.from(JSON.stringify({v:1,graph:G.signature,query,offset:offset+limit})).toString('base64url'):undefined;
  const next=traversalComplete?undefined:{target,env,repos,db,depth:Math.min(32,Math.max(depth+1,depth*2)),limit,node_limit:Math.min(100000,node_limit*2),time_ms:Math.min(5000,time_ms*2)};
  const out={...base,complete:!reasons.length&&!resultGaps.length,traversalComplete,counts:items.reduce((m,i)=>(m[i.kind]=(m[i.kind]||0)+1,m),{}),endpoints:pick('endpoint'),topics:pick('topic'),tables:pick('table'),functions:pick('pgfn'),services:pick('svc'),es:pick('es'),tests:[...new Set(items.filter(i=>i.test).map(i=>i.classId||i.id.split('#')[0]))].slice(0,25),db:facts,items:items.slice(offset,offset+limit),total:items.length,truncated:reasons.length>0,cutReasons:reasons,frontier:[...new Set(frontier)].slice(0,20),frontierTotal:new Set(frontier).size,continuation,next,gaps:resultGaps.slice(0,20),gapTotal:resultGaps.length,summaryTruncated:items.length>25,maxOutputBytes:max_output_bytes};
  if(grep){const raw=G.nodes.get(r.start[0])?.legacyId||target,name=r.kind==='column'?raw.split('.').pop():raw.split('#').pop().replace(/\(.*$/,'');try{out.mentions=name.length>=3?CI.grep(G.keys,name,{limit:10,perFile:2}).hits.map(h=>({...h,text:String(h.text).slice(0,500)})):[];}catch{out.mentions=[];}}
  while(out.items.length>1&&Buffer.byteLength(JSON.stringify(out))>max_output_bytes)out.items.pop();
  if(offset+out.items.length<items.length){out.complete=false;out.truncated=true;if(!out.cutReasons.includes('output'))out.cutReasons.push('output');if(traversalComplete)out.continuation=Buffer.from(JSON.stringify({v:1,graph:G.signature,query,offset:offset+out.items.length})).toString('base64url');else out.pagination='requires-complete-traversal';}
  return boundResult(out,max_output_bytes);
}
// Keep metadata bounded too: counts and the retrieval/continuation contract survive trimming.
function boundResult(out,max=32768){
  const budget=max-32;
  const bytes=()=>Buffer.byteLength(JSON.stringify(out));
  if(bytes()>budget){out.metadataTruncated=true;for(const k of ['mentions','nearest','gaps','frontier','endpoints','topics','tables','functions','services','tests','es','resolved','candidates']){if(!Array.isArray(out[k]))continue;while(out[k].length>1&&bytes()>budget)out[k].pop();}}
  if(bytes()>budget&&out.gaps?.length)out.gaps=out.gaps.map(g=>({kind:g.kind}));
  if(bytes()>budget){for(const k of ['mentions','nearest','frontier','endpoints','topics','tables','functions','services','tests','es','candidates'])if(Array.isArray(out[k]))out[k]=[];}
  if(bytes()>budget){out.outputBudgetExceeded=true;out.complete=false;out.truncated=true;out.items=[];out.continuation=undefined;out.next={target:out.target,env:out.env,max_output_bytes:Math.min(262144,max*2)};}
  // No successful response silently exceeds a declared budget, even for unusually long identities.
  if(bytes()>budget)throw new Error('impact identity/metadata exceeds max_output_bytes; narrow the target or raise the result budget');
  out.outputBytes=bytes();out.outputBytes=bytes();if(bytes()>max)throw new Error('impact response exceeds its byte budget');return out;
}
// Legacy flow/test generators still consume local FQN edges. Refuse revision collisions rather than
// selecting an arbitrary checkout. Overloaded targets are rejected by their caller before selection.
function loadLegacy(opts={}){
  const G=load(opts),names=new Map(),legacy={...G,nodes:new Map(),classes:new Map(),rev:new Map(),fwd:new Map(),legacyAmbiguities:new Map([...G.aliases].filter(([name,ids])=>name.includes('#')&&!name.includes('(')&&ids.size>1))};
  for(const [id,c] of G.classes){if(names.has(c.legacyId))throw new Error(`Ambiguous legacy class ${c.legacyId}; choose one repo/revision with repos. Candidates: ${names.get(c.legacyId)}, ${id}`);names.set(c.legacyId,id);legacy.classes.set(c.legacyId,{...c,id:c.legacyId});}
  const old=id=>G.nodes.get(id)?.legacyId||id;
  for(const [id,n]of G.nodes){const k=old(id);if(!legacy.nodes.has(k))legacy.nodes.set(k,{...n,id:k});}
  for(const rows of G.fwd.values())for(const e of rows){const x={...e,from:old(e.from),to:old(e.to)};(legacy.fwd.get(x.from)||legacy.fwd.set(x.from,[]).get(x.from)).push(x);(legacy.rev.get(x.to)||legacy.rev.set(x.to,[]).get(x.to)).push(x);}
  return legacy;
}
module.exports={load,loadLegacy,impact,resolveTarget,columnEdges,boundResult};
