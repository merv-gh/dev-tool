// Passport-backed estate graph. Durable layers and wire snapshots are DTMAP1 binary,
// not JSON documents. Adjacency is CSR; exploration materializes bounded rows only.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { HOME, PATHS } = require('./config'), { CACHE } = require('./util');
const F = require('../web/map-format');
const ROOT = path.join(HOME, 'maps'), OVERLAYS = path.join(ROOT, 'overlays');
const loaded = new Map(), pending = new Map();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safe = (value, label='id') => { if(typeof value!=='string'||!value||value.length>160||!/^[\w.-]+$/.test(value)||value==='.'||value==='..')throw new Error(`Invalid map ${label}`);return value; };
const envOf = env => safe(env || require('./config').envNames()[0], 'environment');
const bounded = (n,def,max) => {if(n===undefined)return def;if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`Map limit must be 1..${max}`);return n;};
const stamp = file => {try{const s=fs.statSync(file);return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}catch(e){if(e.code==='ENOENT')return '';throw e;}};
const files = (dir,suffix) => {try{return fs.readdirSync(dir).filter(f=>f.endsWith(suffix)).sort().map(f=>path.join(dir,f));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
function passportFiles(){try{return fs.readdirSync(PATHS.passports,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(PATHS.passports,e.name,'passport.json')).filter(f=>stamp(f)).sort();}catch(e){if(e.code==='ENOENT')return [];throw e;}}
function sites(){return require('./config').getBrowser().sites.map(s=>{try{const u=new URL(s.url);return {site:s.site,host:u.host,url:u.origin+u.pathname,repository:require('./config').load().raw.browser?.sites?.[s.site]?.repository||''};}catch{return {site:s.site,host:'',url:''};}});}
function databaseBindings(env){return Object.entries(require('./config').getEnv(env).pg).flatMap(([alias,value])=>{try{const u=new URL(value);return [{alias,database:decodeURIComponent(u.pathname.slice(1)),host:u.hostname.toLowerCase()+':'+(u.port||'5432')}];}catch{return [];}});}
function source(env){const passports=passportFiles(), overlays=files(path.join(OVERLAYS,env),'.dtm'), catalog=path.join(CACHE,env,'catalog.txt');const deps=[...passports,...overlays,catalog,require('./routes').FILE];return {passports,overlays,catalog,signature:hash('dt-map-projection-v1.2\n'+deps.map(f=>f+':'+stamp(f)).join('\n')+'\n'+sites().map(s=>s.site+' '+s.url+' '+s.repository).join('\n')+'\n'+databaseBindings(env).map(d=>[d.alias,d.database,d.host].join(' ')).join('\n'))};}
function atomic(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}}
function builder(){
  const nodes=new Map(),edges=new Map();
  const node=(id,kind,label,props={})=>{const old=nodes.get(id);if(!old)nodes.set(id,{id,kind,label,...props});else for(const [k,v]of Object.entries(props))if(v&&!old[k])old[k]=v;return id;};
  const edge=(from,to,kind,props={})=>{const key=[from,to,kind,props.layer||'',props.where||''].join('\0');if(!edges.has(key))edges.set(key,{from,to,kind,certainty:'static',...props});};
  return {nodes,edges,node,edge};
}
async function rebuild(env,s){
  const B=builder(),gaps=[],tbl=new Map(),sources=[],bindings=databaseBindings(env);
  const databaseKeys=p=>[...new Set((p.db?.datasources||[]).flatMap(d=>{const candidates=bindings.filter(b=>b.database===d.db),host=String(d.host||'').replace(/:5432$/,'').toLowerCase(),matched=candidates.filter(b=>b.host.replace(/:5432$/,'')===host);return (matched.length?matched:candidates).map(b=>b.alias).concat(candidates.length?[]:d.db?[d.db]:[]);}))];
  const db=name=>B.node(`db:${name}`,'postgres',name,{scope:env});
  const table=(database,name,detail='')=>{const id=B.node(`pg:${database}:${name}`,'table',name,{scope:database,detail,source:'catalog'});B.edge(db(database),id,'contains',{where:'cached catalog'});for(const key of new Set([name.toLowerCase(),name.split('.').pop().toLowerCase()])){const arr=tbl.get(key)||[];if(!arr.includes(id))arr.push(id);tbl.set(key,arr);}return id;};
  // Stream the compact catalog, never load a multi-hundred-MB pg JSON catalog.
  if(stamp(s.catalog)){
    const lines=require('readline').createInterface({input:fs.createReadStream(s.catalog),crlfDelay:Infinity});
    for await(const line of lines){
      const pg=line.match(/^pg (\S+) (\S+) /);if(pg){table(pg[1],pg[2],'Cached table; inspect pg_table for its definition');continue;}
      const k=line.match(/^kafka (\S+)/);if(k)B.node(`kafka:${k[1]}`,'kafka',k[1],{scope:env,detail:'Cached resource; inspect its schema with the corresponding tool',source:'catalog'});
      const es=line.match(/^es (\S+)/);if(es)B.node(`es:${es[1]}`,'elasticsearch',es[1],{scope:env,detail:'Cached resource; inspect its schema with the corresponding tool',source:'catalog'});
    }
  }else gaps.push('No cached catalog: database/topic inventory is limited to passport findings.');
  for(const file of s.passports){
    let p;try{p=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){gaps.push(`Unreadable passport ${path.basename(path.dirname(file))}: ${e.message}`);continue;}
    if(!p.service||!p.effective){gaps.push('Passport missing service/effective: '+file);continue;}if(p.env&&p.env!==env)continue;
    const id=B.node(`svc:${p.service}`,'service',p.service,{scope:env,repo:[p.repo?.project,p.repo?.repo].filter(Boolean).join('/'),revision:p.repo?.sha||'',source:'passport',detail:p.env?'':'Environment not recorded in passport'});
    sources.push({p,id});
  }
  const byName=new Map(sources.flatMap(({p,id})=>[[p.service.toLowerCase(),id],...(p.repo?.repo?[[p.repo.repo.toLowerCase(),id]]:[])]));
  const uiService=site=>byName.get(site.site.toLowerCase())||sources.find(({p})=>site.repository&&`${p.repo?.project}/${p.repo?.repo}`.toLowerCase()===site.repository.toLowerCase())?.id;
  for(const {p,id}of sources){
    const eff=p.effective, where=x=>`${p.service} ${x.source?'library '+x.source+' ':''}${x.file||'passport'}${x.line?':'+x.line:''}`, props=x=>({where:where(x),evidence:x.via||x.handler||'',certainty:p.env?'static':'environment-unknown'});
    for(const x of eff.produces||eff.kafka?.produces||[])if(x.topic&&!/^[?(]/.test(x.topic))B.edge(id,B.node(`kafka:${x.topic}`,'kafka',x.topic,{scope:env,source:'passport'}),'produces',props(x));
    for(const x of eff.consumes||eff.kafka?.consumes||[])if(x.topic&&!/^[?(]/.test(x.topic))B.edge(B.node(`kafka:${x.topic}`,'kafka',x.topic,{scope:env,source:'passport'}),id,'consumed-by',props(x));
    for(const x of eff.tables||[]){
      if(!x.table||/[?$]/.test(x.table))continue;
      let candidates=tbl.get(x.table.toLowerCase())||[];
      const configured=databaseKeys(p);
      const narrowed=candidates.filter(t=>configured.includes(B.nodes.get(t).scope));if(narrowed.length)candidates=narrowed;
      if(!candidates.length&&configured.length===1)candidates=[table(configured[0],x.table)];
      if(!candidates.length)candidates=[B.node(`pg:?:${x.table}`,'table',x.table,{scope:'?',source:'passport',detail:'Database unresolved; verify before querying'})];
      for(const to of candidates)B.edge(id,to,x.access||'uses',{...props(x),certainty:candidates.length===1&&B.nodes.get(to).scope!=='?'&&x.table.includes('.')?'static':'candidate'});
    }
    for(const key of databaseKeys(p))B.edge(id,db(key),'connects-db',{where:p.service+' datasource',evidence:'datasource database name/host matched configured aliases'});
    for(const x of [...(eff.calls||eff.feign||[]),...(p.http||[])]){
      const target=byName.get(String(x.client||x.target||'').toLowerCase());
      if(target)B.edge(id,target,'calls-http',props(x));
      else if(x.client||x.target){const name=x.client||x.target;B.edge(id,B.node(`external:${name}`,'external',name,{scope:env}),'calls-http',{...props(x),certainty:'unresolved-target'});}
    }
    for(const x of [...(p.es||[]),...(eff.es||[])])if(x.index)B.edge(id,B.node(`es:${x.index}`,'elasticsearch',x.index,{scope:env}),'uses-index',props(x));
    B.edge(id,B.node(`elk:${p.service}`,'elk',p.service+' logs',{scope:env,source:'inspection-target',detail:'Log query target; availability is not verified'}),'inspect-logs',{where:'service identity',certainty:'suggested'});
    for(const lib of p.libraries||[]){const name=lib.repo||[lib.groupId,lib.artifactId].filter(Boolean).join(':');if(name)B.edge(id,B.node(`lib:${name}`,'library',lib.artifactId||name,{repo:lib.repo||'',revision:lib.sha||'',detail:lib.version||'',source:'passport'}),'depends-on',{where:p.service+' libraries'});}
  }
  // Observed API matching preserves ambiguity. Never turn a shared route into a certain owner.
  const resolve=require('./routes').resolver(sources.map(s=>s.p)),configuredSites=sites();
  for(const site of configuredSites){
    const id=uiService(site)||B.node(`ui:${site.site}`,'ui',site.site,{scope:site.site,detail:site.url,source:'browser configuration'});
    const n=B.nodes.get(id);n.kind='ui';n.scope=site.site;n.detail=site.url;
  }
  for(const r of Object.values(require('./routes').load().routes||{})){
    const site=configuredSites.find(s=>s.host===r.host);if(!site)continue;
    const from=uiService(site)||`ui:${site.site}`,match=resolve(`https://${r.host}${r.path}`,r.method);
    for(const c of match.candidates||[])if(B.nodes.has(`svc:${c.service}`))B.edge(from,`svc:${c.service}`,'observed-api',{where:`${r.method} ${r.path}`,evidence:`seen ${r.count} times; ${c.where||c.handler||''}`,certainty:match.status==='matched'?'observed':'candidate'});
  }
  // Hierarchy is part of the data, not a visual truncation of thousands of services.
  const pgCluster=B.node('postgres-cluster:'+env,'postgres-cluster','Postgres',{scope:env,source:'cached inventory'}),kafkaCluster=B.node('kafka-cluster:'+env,'kafka-cluster','Kafka',{scope:env,source:'cached inventory'});
  const domainOf=new Map();
  for(const n of [...B.nodes.values()]){
    if(n.kind==='postgres')B.edge(pgCluster,n.id,'contains',{where:'database inventory'});
    if(n.kind==='kafka')B.edge(kafkaCluster,n.id,'contains',{where:'topic inventory'});
    if(n.kind==='service'||n.kind==='ui'){
      const name=n.repo?.split('/')[0]||'UI';const domain=B.node('domain:'+name,'domain',name,{scope:env,source:'repository project grouping',detail:'Repository project grouping, not an ownership claim'});domainOf.set(n.id,domain);B.edge(domain,n.id,'contains',{where:'repository project'});
    }
  }
  const aggregates=new Map();
  for(const e of [...B.edges.values()]){
    const fromNode=B.nodes.get(e.from),toNode=B.nodes.get(e.to),from=domainOf.get(e.from)||(fromNode?.kind==='kafka'?kafkaCluster:null),to=domainOf.get(e.to)||(['postgres','table'].includes(toNode?.kind)?pgCluster:toNode?.kind==='kafka'?kafkaCluster:null);
    if(!from||!to||from===to||e.kind==='contains'||e.kind==='inspect-logs')continue;
    const key=[from,to,e.kind].join('|');const entry=aggregates.get(key)||{from,to,kind:e.kind,count:0};entry.count++;aggregates.set(key,entry);
  }
  for(const e of aggregates.values())B.edge(e.from,e.to,e.kind,{where:'aggregated passport/observed relations',certainty:'aggregate',evidence:e.count+' underlying relations; expand domains and infrastructure to inspect exact sources'});
  for(const file of s.overlays){
    try{const g=F.decode(fs.readFileSync(file));if(g.meta[0]!==env)continue;for(let i=0;i<g.count;i++){const n=g.node(i);if(n.kind==='feature')B.node(n.id,n.kind,n.label,n);else if(!B.nodes.has(n.id))gaps.push(`Overlay ${g.meta[3]} refers to missing node ${n.id}`);}
      for(let i=0;i<g.edgeCount;i++){const e=g.edge(i),from=g.node(e.from).id,to=g.node(e.to).id;if(B.nodes.has(from)&&B.nodes.has(to))B.edge(from,to,e.kind,{...e,from,to});}
    }catch(e){gaps.push(`Invalid saved overlay ${path.basename(file)}: ${e.message}`);}
  }
  const bytes=F.encode([...B.nodes.values()],[...B.edges.values()],[env,new Date().toISOString(),s.signature,'Microservice map',String(B.nodes.size),String(B.edges.size),'0',gaps.join('\n')]);
  atomic(path.join(CACHE,'maps',env+'.dtm'),bytes);return bytes;
}
function index(bytes){
  const g=F.decode(bytes),ids=new Map(),offset=new Uint32Array(g.count+1);
  for(let i=0;i<g.count;i++)ids.set(g.str(g.value(i,0)),i);
  for(let i=0;i<g.edgeCount;i++){const a=g.value(i,0,true),b=g.value(i,1,true);if(a>=g.count||b>=g.count)throw new Error('Invalid map endpoints');offset[a+1]++;offset[b+1]++;}
  for(let i=1;i<offset.length;i++)offset[i]+=offset[i-1];
  const cursor=offset.slice(),adj=new Uint32Array(g.edgeCount*2);
  for(let i=0;i<g.edgeCount;i++){const a=g.value(i,0,true),b=g.value(i,1,true);adj[cursor[a]++]=i;adj[cursor[b]++]=i;}
  return Object.assign(g,{ids,offset,adj});
}
async function graph(env,refresh=false){
  env=envOf(env);if(pending.has(env))return pending.get(env);
  const s=source(env),hit=loaded.get(env);if(!refresh&&hit?.meta[2]===s.signature)return hit;
  const work=(async()=>{let bytes,file=path.join(CACHE,'maps',env+'.dtm');if(!refresh&&stamp(file)){bytes=fs.readFileSync(file);try{if(F.decode(bytes).meta[2]!==s.signature)bytes=null;}catch{bytes=null;}}
    const g=index(bytes||await rebuild(env,s));loaded.set(env,g);while(loaded.size>2)loaded.delete(loaded.keys().next().value);return g;})();
  pending.set(env,work);try{return await work;}finally{pending.delete(env);}
}
const visible=(g,i,a)=>a.include_libraries||g.str(g.value(i,1))!=='library';
const relation=(e,a)=>!a.layer||e.layer===a.layer;
function locate(g,id){if(!g.ids.has(id))throw new Error('Unknown map node; use map_search for exact ids');return g.ids.get(id);}
function* connections(g,i,a={}){for(let k=g.offset[i];k<g.offset[i+1];k++){const n=g.adj[k],e=g.edge(n),other=e.from===i?e.to:e.from;if(relation(e,a)&&visible(g,other,a))yield [n,e,other];}}
const clean=s=>String(s||'').replace(/[\t\r\n]/g,' ').slice(0,400);
function nodeLine(g,i){const n=g.node(i);return [n.id,n.kind,n.label,g.offset[i+1]-g.offset[i]].map(clean).join('\t');}
async function search(a={}){const g=await graph(a.env),limit=bounded(a.limit,30,200),q=String(a.query||'').toLowerCase().split(/\s+/).filter(Boolean),matches=[];let total=0;
  for(let i=0;i<g.count;i++){if(!visible(g,i,a))continue;const n=g.node(i);if(a.kind&&n.kind!==a.kind)continue;if(!q.every(w=>[n.id,n.kind,n.label,n.scope,n.repo,n.detail].join(' ').toLowerCase().includes(w)))continue;total++;if(matches.length<limit)matches.push(nodeLine(g,i));}
  return {format:'tsv',columns:'id\tkind\tlabel\tdegree',text:matches.join('\n'),total,truncated:total>matches.length,guidance:'Use exact id with map_node, map_neighbors or map_path. Static/candidate connections are not live verification.'};
}
async function neighbors(a){const g=await graph(a.env),i=locate(g,a.id),limit=bounded(a.limit,40,200),lines=[];let total=0;for(const [,e]of connections(g,i,a)){total++;if(lines.length<limit)lines.push([g.node(e.from).id,e.kind,g.node(e.to).id,e.certainty,e.where,e.layer].map(clean).join('\t'));}return {id:a.id,format:'tsv',columns:'from\trelation\tto\tcertainty\tsource\tlayer',text:lines.join('\n'),total,truncated:total>lines.length};}
async function route(a){const g=await graph(a.env),start=locate(g,a.from),end=locate(g,a.to),visited=new Map([[start,null]]),queue=[start],max=bounded(a.max_visited,10000,100000);let truncated=false;
  for(let p=0;p<queue.length&&!visited.has(end);p++){for(const [ei,e,to]of connections(g,queue[p],a)){if(a.directed!==false&&e.from!==queue[p])continue;if(!a.include_hierarchy&&(e.kind==='contains'||e.certainty==='aggregate'))continue;if(visited.has(to))continue;if(visited.size>=max){truncated=true;break;}visited.set(to,[queue[p],ei]);queue.push(to);}if(truncated)break;}
  const edges=[];if(visited.has(end)){let i=end;while(i!==start){const [prev,ei]=visited.get(i);edges.unshift(g.edge(ei));i=prev;}}
  return {found:visited.has(end),visited:visited.size,truncated,format:'tsv',columns:'from\trelation\tto\tcertainty',text:edges.map(e=>[g.node(e.from).id,e.kind,g.node(e.to).id,e.certainty].join('\t')).join('\n'),guidance:'A path is static/observed/user evidence, not proof that a user flow executes. Inspect edge certainty and verify with live tools.'};
}
async function inspect(a){const g=await graph(a.env),n=g.node(locate(g,a.id)),actions=[],env=g.meta[0],add=(tool,args,why)=>actions.push({tool,arguments:args,why});
  if(n.kind==='service'||n.kind==='ui'){if(n.id.startsWith('svc:'))add('passport',{service:n.id.slice(4)},'Inspect cached code and dependencies');add('logs_search',{env,service:n.label,query:'*'},'Inspect live application logs');}
  if(n.kind==='ui')add('api_browser_open',{site:n.scope},'Open the UI in an isolated session; use api_browser_action take_screenshot, then api_browser_close');
  if(n.kind==='table'&&n.scope!=='?'){add('pg_table',{env,name:n.scope+':'+n.label},'Inspect definition and usage');const sql=n.label.split('.').map(x=>'"'+x.replace(/"/g,'""')+'"').join('.');add('pg_query',{env,db:n.scope,sql:`SELECT * FROM ${sql} LIMIT 20`},'Sample read-only rows; inspect sensitive columns before sharing');}
  if(n.kind==='postgres')add('pg_query',{env,db:n.label,sql:'SELECT current_database()'},'Verify database connection');
  if(n.kind==='kafka'){add('kafka_topic',{env,topic:n.label},'Inspect cached schema');add('kafka_last',{env,topic:n.label,n:5},'Inspect live messages');}
  if(n.kind==='elasticsearch')add('es_search',{env,index:n.label,query:'',size:5},'Inspect matching documents');
  if(n.kind==='elk')add('logs_search',{env,service:n.label.replace(/ logs$/,''),query:'*'},'Inspect service logs');
  // Suggestions refer only to currently enabled tools and must pass their exact schemas.
  const registry=await require('./tools').schemas(),available=[];for(const action of actions){const t=registry.find(t=>t.name===action.tool);if(!t)continue;const errors=require('./schema').validate(action.arguments,t.inputSchema);available.push({...action,valid:!errors.length,...(errors.length?{validation:errors}: {})});}
  const links=n.id.startsWith('svc:')?[{label:'Open passport',url:`${require('./results').publicUrl()}/passport/${encodeURIComponent(n.id.slice(4))}?t=${require('./results').sign('passport:'+n.id.slice(4))}`}]:[];
  const target={environment:env,...(n.kind==='table'?{system:'postgres',database:n.scope,qualified_name:n.label,schema:n.label.includes('.')?n.label.split('.')[0]:null,table:n.label.includes('.')?n.label.split('.').slice(1).join('.'):n.label}:n.kind==='postgres'?{system:'postgres',database:n.label}:n.kind==='kafka'?{system:'kafka',topic:n.label}:n.kind==='service'||n.kind==='ui'?{system:'service',service:n.label,...(n.kind==='ui'?{site:n.scope}:{})}:{system:n.kind,name:n.label})};
  return {node:n,target,actions:available,links,degree:g.offset[g.ids.get(n.id)+1]-g.offset[g.ids.get(n.id)],guidance:'Actions are suggestions. Inspect arguments before execution. UI sessions must be closed. Library nodes are hidden by default.'};
}
async function snapshot(a={}){const depth=bounded(a.depth,1,4),g=await graph(a.env,a.refresh),limit=bounded(a.limit,70,250),chosen=new Set(),edgeIds=new Set(),focus=a.focus||a.layer?locate(g,a.focus||'feature:'+a.layer):null;
  if(focus!==null){const queue=[[focus,0]];chosen.add(focus);for(let p=0;p<queue.length;p++){const [i,d]=queue[p];if(d>=depth)continue;for(const [ei,,other]of connections(g,i,a)){if(!chosen.has(other)&&chosen.size<limit){chosen.add(other);queue.push([other,d+1]);}if(chosen.has(other)&&edgeIds.size<400)edgeIds.add(ei);}}}
  else{const large=g.count>100,budgets=large?{domain:12,'kafka-cluster':1,'postgres-cluster':1,feature:4,library:4}:{ui:3,service:12,postgres:6,kafka:6,elasticsearch:3,feature:4,library:4};for(const kind of Object.keys(budgets)){let count=0;for(let i=0;i<g.count&&chosen.size<limit&&count<budgets[kind];i++)if(g.str(g.value(i,1))===kind&&visible(g,i,a)){chosen.add(i);count++;}}}
  for(const i of chosen)for(const [ei,e,to]of connections(g,i,a))if(chosen.has(to)&&edgeIds.size<400)edgeIds.add(ei);
  const nodes=[...chosen].map(i=>g.node(i)),edges=[...edgeIds].slice(0,400).map(i=>{const e=g.edge(i);return {...e,from:g.node(e.from).id,to:g.node(e.to).id};});
  return F.encode(nodes,edges,[g.meta[0],g.meta[1],g.meta[2],focus===null?'Microservice map':g.node(focus).label,String(g.count),String(g.edgeCount),String(g.count-nodes.length),String(g.edgeCount-edges.length)]);
}
async function overview(a={}){const g=await graph(a.env,a.refresh),counts={};for(let i=0;i<g.count;i++){const k=g.str(g.value(i,1));counts[k]=(counts[k]||0)+1;}return {env:g.meta[0],nodes:g.count,edges:g.edgeCount,counts,updatedAt:g.meta[1],gaps:g.meta[7]?g.meta[7].split('\n'):[],format:'DTMAP1',guidance:'Map data is binary, libraries hidden by default. Use map_search for ids, map_neighbors/map_path for bounded evidence, map_node for live-tool suggestions. Saved feature layers survive refresh.'};}
async function save(a){const env=envOf(a.env),id=safe(a.id),file=path.join(OVERLAYS,env,id+'.dtm'),g=await graph(env);if(typeof a.title!=='string'||!a.title.trim()||a.title.length>300||typeof a.description!=='string'||a.description.length>12000)throw new Error('Overlay title and bounded description required');
  let previous=null;if(stamp(file))previous=hash(fs.readFileSync(file));if((previous!==null&&a.expected_revision===undefined)||(a.expected_revision!==undefined&&a.expected_revision!==previous))throw new Error('Overlay changed or exists; read map_layers and provide expected_revision');
  if(!Array.isArray(a.nodes)||a.edges!==undefined&&!Array.isArray(a.edges))throw new Error('Overlay nodes and edges must be lists');
  const refs=[...new Set(a.nodes)];if(refs.length>200||(a.edges||[]).length>400)throw new Error('Overlay exceeds 200 nodes / 400 edges');
  const B=builder(),feature=B.node('feature:'+id,'feature',a.title,{scope:env,detail:a.description,source:'user annotation'});
  for(const ref of refs){const n=g.node(locate(g,ref));B.nodes.set(n.id,n);B.edge(feature,n.id,'includes',{layer:id,where:'user request',certainty:'user',evidence:a.description.slice(0,1000)});}
  for(const e of a.edges||[]){if(!refs.includes(e.from)||!refs.includes(e.to)||typeof e.relation!=='string'||!e.relation||e.relation.length>100||typeof e.evidence!=='string'||e.evidence.length>2000)throw new Error('Overlay edges need referenced node ids, relation and bounded evidence');B.edge(e.from,e.to,e.relation,{layer:id,where:'user request',certainty:'user',evidence:e.evidence});}
  const bytes=F.encode([...B.nodes.values()],[...B.edges.values()],[env,new Date().toISOString(),id,a.title,a.description]);atomic(file,bytes);loaded.delete(env);return {id,revision:hash(bytes),saved:true,nodes:B.nodes.size,edges:B.edges.size};
}
function layers(a={}){const env=envOf(a.env),layers=[],errors=[];for(const file of files(path.join(OVERLAYS,env),'.dtm')){try{const bytes=fs.readFileSync(file),g=F.decode(bytes);if(g.meta[0]===env)layers.push({id:path.basename(file,'.dtm'),title:g.meta[3],description:g.meta[4],revision:hash(bytes),updatedAt:g.meta[1],nodes:g.count,edges:g.edgeCount});}catch(e){errors.push({id:path.basename(file,'.dtm'),error:e.message});}}return {layers,errors};}
async function preview(a){
  const g=await graph(a.env),n=g.node(locate(g,a.id));if(n.kind!=='ui')throw new Error('UI preview needs a UI node');
  const T=require('./tools'),schemas=await T.schemas();for(const name of ['api_browser_open','api_browser_action','api_browser_close'])if(!schemas.some(t=>t.name===name))throw new Error('UI preview requires enabled '+name);
  let session,image,cleanupError,failure;
  try{session=(await T.call('api_browser_open',{site:n.scope},{source:'map-preview'})).session;
    const definition=await T.call('api_browser_action',{session,action:'take_screenshot',describe:true},{source:'map-preview'});
    if(!definition.available)throw new Error('Browser endpoint has no screenshot tool');
    const args=definition.inputSchema?.properties?.type?{type:'png'}:{};
    const shot=await T.call('api_browser_action',{session,action:'take_screenshot',args},{source:'map-preview'});image=shot.imageData?.[0];if(!image)throw new Error('Browser returned no supported inline image (PNG/JPEG/WebP, max 3 MiB)');
  }catch(e){failure=e;}finally{if(session)try{await T.call('api_browser_close',{session},{source:'map-preview'});}catch(e){cleanupError=e.message;}}
  if(failure){if(cleanupError)failure.message+='; browser cleanup failed: '+cleanupError+' (session '+session+')';throw failure;}
  const view=require('./results').save('map-preview',[],{title:n.label+' screenshot',image,node:n.id,capturedAt:new Date().toISOString()});return {view,node:n.id,...(cleanupError?{cleanupError,session}:{}),guidance:'Screenshot is a point-in-time UI observation, not proof of complete feature execution.'};
}
module.exports={graph,search,neighbors,route,inspect,snapshot,overview,save,layers,preview,ROOT};
