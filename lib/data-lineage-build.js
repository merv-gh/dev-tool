const fs = require('node:fs'), path = require('node:path');
const CI = require('./codeindex'), ID = require('./semantic-identity'), X = require('./passport/extract');
const S = require('./data-lineage-store'), E = require('./execution');
const { fileStamp } = require('./util');
const FORMAT = 2;
const columnLimit=()=>Math.max(128,Math.min(50000,Number(process.env.DT_DATA_INDEX_COLUMNS_PER_TABLE)||4096));
const location = (file,line) => ({file: file || null,line: line || 1});
const evidenceSource=r=>({repo:r.repo,indexKey:r.indexKey,revisionKey:r.revisionKey,revision:r.revision,sourceDigest:r.sourceDigest,...location(r.file,r.line)});
const normRoute = p => String(p).replace(/\{[^}]*\}|:[\w]+/g,'{}').replace(/\/+$/,'') || '/';
const testPath=rel=>/(^|\/)src\/(test|it|integrationTest)\/|(^|\/)tests?\//i.test(rel || '');
function settings(env) {
  const db=S.open(env);
  try{const row=db?.prepare('SELECT payload FROM index_rules WHERE id=?').get(require('./access').owner().scopeKey),value=row?JSON.parse(row.payload):{aliases:[],links:[]};return {...value,revision:S.hash(value)};}finally{db?.close();}
}
async function inputs({env,repos} = {},{materialize=false}={}) {
  env = require('./config').getEnv(env).name;
  const selected = await require('./code-search').sources(repos,{metadataOnly:true});
  const keys = CI.withLibrariesMetadata(selected.indexed);
  const sources = keys.map(key => {
    const idx = CI.metadata(key);
    return {key,canonical:idx.revisionKey || key,sha:idx.sha,stamp:fileStamp(path.join(idx.dir,'files.json')),graph:fileStamp(path.join(idx.dir,'graph.json'))};
  });
  const raw = selected.raw.map(r=>({...r,stamp:S.hash([fileStamp(r.root),fileStamp(path.join(r.root,'.git','HEAD')),fileStamp(path.join(r.root,'.git','index'))])}));
  const cats = materialize?require('./pg').loadAll(env):[];
  const catalog = require('./pg').databases(env).map(d=>[d.name,fileStamp(path.join(require('./util').CACHE,env,'pg',d.name+'.json'))]).filter(r=>r[1]);
  const passportDir=require('./passport').DIR;let passportFiles=[];try{passportFiles=fs.readdirSync(passportDir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>[e.name,fileStamp(path.join(passportDir,e.name,'passport.json'))]).sort((a,b)=>a[0].localeCompare(b[0]));}catch(e){if(e.code!=='ENOENT')throw e;}
  const passports = materialize?require('./passport/edges').snapshot({env,manual:false}):null;
  const rules = settings(env), selection = S.hash([require('./access').owner().scopeKey,env,[].concat(repos || []).map(String).sort()]);
  const signature = S.hash([FORMAT,sources,raw,catalog,passportFiles,rules.revision,{columnsPerTable:columnLimit()}]);
  return {env,repos,selection,signature,sources,raw,cats,catalog,passports,rules};
}
function sourceContext(idx,key,library) {
  const repo = idx.project && idx.repo ? `${idx.project}/${idx.repo}` : key.replace(/@[a-f0-9]{40}-.+$/,'');
  return {indexKey:idx.revisionKey || key,repo,revision:ID.revision(idx),revisionKey:idx.revisionKey || key,sourceDigest:idx.sourceDigest,sha:idx.sha,service:library ? null : idx.service || idx.graph_().app?.name || null};
}
function repoSegment(db, segment, idx, key, library, env) {
  const started = Date.now(), w = S.writer(db,segment), g = idx.graph_(),fileTexts=new Map(),sourceHash=require('node:crypto').createHash('sha256'),root=fs.realpathSync(idx.root);
  for(const f of idx.list || []){E.check();const full=path.resolve(idx.root,f.path);if(!full.startsWith(path.resolve(idx.root)+path.sep)||fs.lstatSync(full).isSymbolicLink()||!fs.realpathSync(full).startsWith(root+path.sep))throw S.invalid('Indexed source path changed or escaped its retained root: '+f.path);const buf=fs.readFileSync(full);if(buf.length>1024*1024)throw S.invalid('Indexed file changed beyond its byte budget: '+f.path);sourceHash.update(f.path).update('\0').update(buf).update('\0');if(!f.binary&&!testPath(f.path))fileTexts.set(f.path,buf.toString('utf8'));}
  if(idx.sourceDigest&&sourceHash.digest('hex')!==idx.sourceDigest)throw S.invalid('Source differs from its code index: '+key+'. Rebuild the code index before publishing lineage.');
  if(g.sourceDigest&&idx.sourceDigest&&g.sourceDigest!==idx.sourceDigest)throw S.invalid('Code graph differs from its source index: '+key);
  const extracted=X.extract(idx.root,{profile:env,files:[...fileTexts].filter(([file])=>/\.(java|kt|kts|groovy|ya?ml|properties|xml|sql|gradle|toml)$/.test(file)).map(([path,text])=>({path,text}))}),ctx={...sourceContext(idx,key,library),service:idx.service || (library?null:extracted.app?.name || null)};
  if(!ctx.service&&!library)w.gap({kind:'source-service-unknown',repo:ctx.repo,note:'Code evidence is retained without asserting a deployed service identity.'});
  const meta = { ...ctx, kind:'method' }, nodes = new Map(), classes = new Map(), parsedFiles=new Map();
  const parsed=file=>{if(!parsedFiles.has(file))parsedFiles.set(file,require('./codegraph').parseFile(file,fileTexts.get(file) || ''));return parsedFiles.get(file);};
  const put = n => { nodes.set(n.symbol,n); w.node(n); return n.id; };
  const id = symbol => ID.code(ctx.indexKey,ctx.revision,symbol);
  const sym = n => ({...meta,...n,id:id(n.symbol)});
  for (const sourceClass of g.classes || []) {
    const c={...sourceClass};
    if(c.test||testPath(c.file))continue;
    E.check(); classes.set(c.id,c);
    const syntax=parsed(c.file),declaration=syntax.classes.find(x=>x.id===c.id);
    const qualify=type=>type.includes('.')?type:syntax.imports[type] || (syntax.pkg?syntax.pkg+'.':'')+type;
    c.ext=[...new Set([...(c.ext || []),...(declaration?.ext || []).map(qualify)])];
    c.impl=[...new Set([...(c.impl || []),...(declaration?.impl || []).map(qualify)])];
    const unsupportedAccessors=/@Accessors\s*\(|AccessLevel\.NONE|lombok\.accessors\./.test(syntax.clean);
    const typeHeader=syntax.clean.split('\n').slice(Math.max(0,c.line-12),c.line).join('\n'),rootMapping=c.annos.includes('RequestMapping')?[...typeHeader.matchAll(/@RequestMapping\s*\(([^)]*)\)/g)].at(-1):null,rootArgs=X.annoArgs(rootMapping?.[1] || ''),routePrefixes=(rootArgs.path || rootArgs.value || ['']).filter(v=>typeof v==='string');
    put(sym({kind:'class',symbol:c.id,legacy:c.id,name:c.name,role:c.role,annos:c.annos,routePrefixes,lombok:c.lombok,unsupportedAccessors,table:c.table,ext:c.ext,impl:c.impl,...location(c.file,c.line),test:!!c.test}));
    if(unsupportedAccessors)w.gap({kind:'custom-accessor-configuration',repo:ctx.repo,file:c.file,note:'Generated accessor inference is disabled for custom Accessors/AccessLevel.NONE configuration.'});
    for (const m of c.methods) {
      const own=declaration?.methods.find(x=>ID.signature(x)===ID.signature(m));
      if(unsupportedAccessors&&own?.implicit)continue;
      const methodId=put(sym({symbol:m.symbol || `${c.id}#${ID.signature(m)}`,legacy:`${c.id}#${m.name}`,name:`${c.name}#${m.name}`,classSymbol:c.id,signature:ID.signature(m),params:m.params,ret:m.ret,annos:m.annos,mods:m.mods,abstract:m.abstract,role:c.role,generated:!!own?.implicit,startLine:m.startLine,endLine:m.endLine,...location(c.file,m.line),test:!!c.test}));
      if(own?.body&&!c.test) {
        const body=syntax.text.slice(own.body[0],own.body[1]+1),shadow=new Set(m.params?.map(p=>p.name));
        const originalBody=syntax.clean.slice(own.body[0],own.body[1]+1);
        for(const call of body.matchAll(/\b(this|super)\s*\.\s*([\w$]+)\s*\.\s*([\w$]+)\s*\(/g)) {
          const args=X.balanced(originalBody,call.index+call[0].lastIndexOf('(')).inner;
          w.raw({type:'receiver-call',from:m.symbol || `${c.id}#${ID.signature(m)}`,owner:call[1]==='super'?c.ext[0]:c.id,receiver:call[2],method:call[3],relation:'calls',arity:args.trim()?X.splitTop(args).length:0,...ctx,...location(c.file,syntax.text.slice(0,own.body[0]+call.index).split('\n').length)});
        }
        // The native graph only sees unqualified calls declared in this class.
        // Resolve inherited this/super calls after pinned library declarations exist.
        for(const call of body.matchAll(/(?<![\w$.])(?:(this|super)\s*\.\s*)?([a-z_$][\w$]*)\s*\(/g)) {
          const name=call[2];if(/^(if|for|while|switch|catch|try|synchronized|assert|new|return|throw|do|else|case|yield|getClass|toString|hashCode|equals)$/.test(name)||!call[1]&&body.slice(0,call.index).trimEnd().endsWith('.')||call[1]!=='super'&&c.methods.some(x=>x.name===name))continue;
          const args=X.balanced(originalBody,call.index+call[0].lastIndexOf('(')).inner;
          const to=(call[1]==='super'?c.ext[0]:c.id);if(!to)continue;
          w.raw({type:'edge',from:m.symbol || `${c.id}#${ID.signature(m)}`,to:`${to}#${name}`,relation:'calls',arity:args.trim()?X.splitTop(args).length:0,...ctx,...location(c.file,syntax.text.slice(0,own.body[0]+call.index).split('\n').length)});
        }
        for(const field of c.fields)for(const hit of body.matchAll(new RegExp(`\\b(this\\s*\\.\\s*)?${field.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g'))) {
          if(!hit[1]&&shadow.has(field.name))continue;
          const suffix=body.slice(hit.index+hit[0].length),write=/^\s*(?:=(?!=)|[+*/%-]=|\+\+|--)/.test(suffix);
          if(/^\s*\(/.test(suffix))continue;
          w.raw({type:'field-access',node:methodId,field:`${c.id}.${field.name}`,access:write?'object-write':'object-read',...ctx,...location(c.file,syntax.text.slice(0,own.body[0]+hit.index).split('\n').length)});
        }
      }
    }
    for (const f of c.fields) put(sym({kind:'field',symbol:`${c.id}.${f.name}`,legacy:`${c.id}.${f.name}`,name:`${c.name}.${f.name}`,field:f.name,type:f.type,resolvedType:f.typeId || qualify(require('./codegraph').baseType(f.type)),annos:f.annos,final:f.final,column:f.column,classSymbol:c.id,...location(c.file,f.line),test:!!c.test}));
  }
  const all = [...nodes.values()], at = (file,line) => all.filter(n=>n.kind==='method'&&n.file===file&&(n.startLine || n.line)<=line&&line<=(n.endLine || n.line)).sort((a,b)=>(a.endLine-a.line)-(b.endLine-b.line))[0] || all.filter(n=>n.kind==='method'&&n.file===file&&n.line>=line&&n.line-line<=8).sort((a,b)=>a.line-b.line)[0] || all.find(n=>n.kind==='class'&&n.file===file) || sym({kind:'file',symbol:`file:${file}`,legacy:`file:${file}`,name:file,...location(file,line)});
  for (const [from,to,relation,where,arity,types,fromSymbol] of g.preciseEdges || g.edges || []) {
    if (['member','uses','injects'].includes(relation)) continue;
    const loc = String(where || '').match(/^(.*):(\d+)$/);
    if(testPath(loc?.[1])||nodes.get(fromSymbol || from)?.test)continue;
    // The legacy graph also guesses field access from accessor names. Actual
    // accessor bodies/generated declarations below replace that name-only guess.
    if(['reads','writes'].includes(relation)) {
      const field=to.split('.').at(-1),line=parsed(loc?.[1]).clean.split('\n')[Number(loc?.[2])-1] || '';
      if(!new RegExp(`\\.\\s*${field}\\b(?!\\s*\\()`).test(line))continue;
    }
    w.raw({type:'edge',from:fromSymbol || from,to,relation,arity,types,...ctx,...location(loc?.[1],Number(loc?.[2]))});
  }
  const readFiles = [];
  for (const f of idx.list || []) {
    E.check();if(!fileTexts.has(f.path))continue;const text=fileTexts.get(f.path);
    if (/\.(java|kt|kts|groovy|sql|xml|properties|ya?ml|gradle|toml)$/.test(f.path)) readFiles.push({path:f.path,text});
    const clean = /\.(java|kt|groovy)$/.test(f.path) ? X.stripComments(text) : text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '));
    let line = 0;
    for (const text of clean.split('\n')) { line++; if (text.trim()) { const n = at(f.path,line); if (!nodes.has(n.symbol)) put(n); w.mention(n.id,f.path,line,text); } }
    if (!/\.(java|kt|groovy|sql|xml)$/.test(f.path)) continue;
    const literals = /\.sql$/.test(f.path) ? [{value:text,index:0}] : /\.xml$/.test(f.path) ? [...text.matchAll(/<(select|update|insert|delete)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m=>({value:m[2].replace(/<!\[CDATA\[|\]\]>/g,s=>s.replace(/[^\n]/g,' ')).replace(/<\/?[A-Za-z][^>]*>/g,s=>s.replace(/[^\n]/g,' ')).replace(/#\{[^}]+\}/g,s=>'?'+s.slice(1).replace(/[^\n]/g,' ')),index:m.index,mybatis:true,namespace:text.match(/<mapper\b[^>]*\bnamespace=["']([^"']+)["']/)?.[1],method:m[0].match(/\bid=["']([^"']+)["']/)?.[1],dynamic:/<(if|foreach|choose|when|otherwise|include|bind)\b|\$\{/.test(m[2])})) : X.stringLiterals(clean);
    for (const lit of literals) {
      const line = clean.slice(0,lit.index).split('\n').length, n = at(f.path,line); if (!nodes.has(n.symbol)) put(n);
      const before = clean.slice(Math.max(0,lit.index-180),lit.index);
      if (/\b(select|insert|update|delete|merge|execute|call)\b/i.test(lit.value)) {if(lit.value.length>256*1024)w.gap({kind:'sql-fragment-budget',repo:ctx.repo,file:f.path,line,characters:lit.value.length,limit:256*1024});if(lit.dynamic)w.gap({kind:'mybatis-dynamic-sql',repo:ctx.repo,file:f.path,line,note:'Dynamic branches/includes are candidates, not an executable query expansion.'});w.raw({type:'sql',node:n.id,sql:lit.value.slice(0,256*1024),...ctx,...location(f.path,line),lineMapping:/\.(sql|xml)$/.test(f.path)||clean.startsWith('"""',lit.index)&&clean.indexOf('"""',lit.index+3)+3===lit.end?'source-lines':'literal-start',mybatis:lit.mybatis,namespace:lit.namespace,mapperMethod:lit.method,dynamic:lit.dynamic});}
      else if(/\.get(?:String|Int|Long|Object|Date|Timestamp|Boolean|BigDecimal|Double|Float|Short|Bytes)\s*\(\s*$/.test(before)&&/^[\w$]+$/.test(lit.value))w.raw({type:'rowmapper',node:n.id,column:lit.value,...ctx,...location(f.path,line)});
      else if (/(?:withProcedureName|withFunctionName)\s*\(\s*$|@(?:Procedure|NamedStoredProcedureQuery)\s*\([^)]*(?:procedureName|procedure|name)\s*=\s*$/.test(before)) w.raw({type:'dbcall',node:n.id,name:lit.value,...ctx,...location(f.path,line)});
    }
  }
  const sourceConfig=X.loadConfig(readFiles,{profile:env}), config = sourceConfig.merged;
  if(sourceConfig.profiled)w.gap({kind:'spring-profile-unverified',repo:ctx.repo,profile:env,note:'The matching source profile was selected; actual runtime profile activation is not observed.'});
  const dbs = extracted.db?.datasources?.map(d=>d.db).filter(Boolean) || [];
  w.raw({type:'context',...ctx,dbs,libs:idx.libs || [],app:extracted.app});
  const broker = config['spring.kafka.bootstrap-servers'] || config['spring.kafka.producer.bootstrap-servers'] || config['spring.cloud.stream.kafka.binder.brokers'];
  const cluster = broker && !/[${}]/.test(broker) ? String(broker).split(',').map(x=>x.trim().toLowerCase()).sort().join(',') : null;
  const esUri=config['spring.elasticsearch.uris'] || config['spring.elasticsearch.rest.uris'] || config['spring.data.elasticsearch.cluster-nodes'];
  const esCluster=esUri&&!/[${}]/.test(esUri)?String(esUri).split(',').map(x=>x.trim().toLowerCase()).sort().join(','):null;
  const httpSeen=new Set();
  const port = (kind,x) => { const n = at(x.file,x.line); if (!nodes.has(n.symbol)) put(n); const node=x.node || n.id,key=JSON.stringify([kind,node,x.method,x.path]);if(kind.startsWith('http')){if(httpSeen.has(key))return;httpSeen.add(key);}w.raw({type:'port',kind,node,...ctx,...x,...(kind.startsWith('kafka')?{cluster}:kind==='es'?{cluster:esCluster}:{}),profiled:!!sourceConfig.profiled,file:x.file,line:x.line || 1}); };
  for (const p of extracted.endpoints || []) port('http-ingress',p);
  // Spring can inherit an annotated base method even when the base itself is
  // not a controller bean. The ordinary passport deliberately omits that case.
  for(const c of g.classes || [])for(const m of c.methods || [])if(nodes.has(c.id)&&m.annos?.some(a=>/^(Get|Post|Put|Patch|Delete|Request)Mapping$/.test(a))) {
    const text=readFiles.find(f=>f.path===c.file)?.text || '',head=text.split('\n').slice(Math.max(0,(m.startLine || m.line)-2),m.line).join('\n');
    const matches=[...head.matchAll(/@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(([^)]*)\))?/g)],annotation=matches.at(-1);if(!annotation)continue;
    const args=X.annoArgs(annotation[2] || ''),paths=args.path || args.value || ['/'];
    const type=nodes.get(c.id);
    for(const prefix of type.routePrefixes || [''])for(const route of paths)if(typeof route==='string')port('http-ingress',{method:annotation[1]==='Request'?'ANY':annotation[1].toUpperCase(),path:('/'+prefix+'/'+route).replace(/\/+/g,'/'),methodPath:route,inheritedOnly:!c.annos.some(a=>['RestController','Controller'].includes(a)),node:nodes.get(m.symbol || `${c.id}#${ID.signature(m)}`)?.id,file:c.file,line:m.line});
  }
  for (const p of extracted.feign || []) port('http-egress',p);
  for (const p of extracted.kafka?.consumes || []) port('kafka-consume',p);
  for (const p of extracted.kafka?.produces || []) port('kafka-produce',p);
  for (const p of extracted.es || []) {
    const n = at(p.file,p.line), text = readFiles.find(f=>f.path===p.file)?.text || '';
    const around = text.split('\n').slice(Math.max(0,(p.line||1)-3),(p.line||1)+3).join('\n');
    const access = /\b(?:save|index|bulkIndex|delete|update)\s*\(/.test(around)?'write':/\b(?:search|get|count|exists)\s*\(/.test(around)?'read':'mapping';
    port('es',{...p,access,node:n.id});
  }
  for (const c of g.classes || []) if (c.table&&nodes.has(c.id)) {
    const persisted=c.annos.includes('Entity');
    if(persisted)w.raw({type:'entity',classSymbol:c.id,table:c.table,...ctx,...location(c.file,c.line)});
    const overrides=new Map(),source=readFiles.find(f=>f.path===c.file)?.text || '';
    for(const m of c.methods || []) {
      const name=m.name.match(/^(get|is)([A-Z][\w$]*)$/);if(!name)continue;
      const head=source.split('\n').slice(Math.max(0,(m.startLine || m.line)-2),m.line).join('\n');
      const a=[...head.matchAll(/@Column\s*\(([^)]*)\)/g)].at(-1),column=a&&X.annoArgs(a[1]).name?.[0];
      if(typeof column==='string')overrides.set(name[2][0].toLowerCase()+name[2].slice(1),column);
    }
    for (const f of c.fields.filter(f=>f.column)) {
      if(f.annos?.some(a=>['Embedded','EmbeddedId'].includes(a))){w.gap({kind:'embedded-column-mapping',repo:ctx.repo,file:c.file,line:f.line,note:'Embedded naming/attribute overrides need reviewed mappings.'});continue;}
      w.raw({type:persisted?'column-map':'inherited-column-map',symbol:`${c.id}.${f.name}`,classSymbol:c.id,table:persisted?c.table:null,column:overrides.get(f.name)||f.column,...ctx,...location(c.file,f.line)});
    }
  }
  // Preserve generic Repository<T> even when the entity lives in a pinned library.
  for (const c of g.classes || []) if (c.role==='repository'&&nodes.has(c.id)) {
    const source = readFiles.find(f=>f.path===c.file)?.text || '';
    const head = X.stripComments(source).slice(0,Math.min(source.length,24000));
    const entity = head.match(/(?:\bextends|:)\s*[\w.]*\w*Repository\s*<\s*([\w$.]+)/)?.[1];
    if(entity||c.kind==='interface'&&c.ext?.some(s=>/Repository$/.test(s)))w.raw({type:'repository',classSymbol:c.id,entity,...ctx,...location(c.file,c.line)});
  }
  for (const error of g.errors || []) w.gap({kind:'source-parse-error',repo:ctx.repo,...error});
  return {...w.stats(),ms:Date.now()-started,files:idx.list.length,...ctx};
}
function dbSegment(db,segment,cat,env) {
  const w = S.writer(db,segment), started = Date.now(), revision = cat.syncedAt || cat._revision || null;
  for (const t of cat.tables || []) {
    E.check(); const object = ID.qualified(t.schema,t.name), tid = ID.pg('table',env,cat.db,object);
    w.node({id:tid,kind:'table',name:object,object,db:cat.db,env,revision});
    for (const c of t.columns || []) { const object = `${ID.qualified(t.schema,t.name)}.${ID.identifier(c.name)}`, cid=ID.pg('column',env,cat.db,object); w.node({id:cid,kind:'column',name:object,object,table:tid,db:cat.db,env,revision}); }
    if (t.definition) w.raw({type:'sql',node:tid,sql:t.definition,db:cat.db,schema:t.schema,file:object,line:1,source:'database'});
  }
  const counts = require('./pg').functionCounts(cat);
  for (const [ordinal,f] of (cat.functions || []).entries()) {
    E.check(); const object = ID.qualified(f.schema,f.name), overloaded = counts.get(`${f.schema}\0${f.name}`)>1;
    const id = ID.pg('pgfn',env,cat.db,overloaded?`${object}(${f.signature || f.args || ordinal})`:object);
    w.node({id,kind:'pgfn',name:object,object,signature:f.signature || f.args,db:cat.db,env,revision,language:f.lang,overloaded});
    if (/^(sql|plpgsql)$/.test(f.lang || '')) {const body=f.body || '';if(body.length>256*1024)w.gap({kind:'sql-fragment-budget',db:cat.db,function:object,characters:body.length,limit:256*1024});w.raw({type:'sql',node:id,sql:body.slice(0,256*1024),db:cat.db,schema:f.schema,file:object,line:1,source:'database',triggerTables:(cat.triggers || []).filter(t=>ID.norm(t.function)===object).map(t=>t.table)});}
    else w.gap({kind:'unsupported-function-language',object,db:cat.db,language:f.lang});
  }
  for (const t of cat.triggers || []) if (t.enabled!==false) w.raw({type:'trigger',db:cat.db,table:t.table,function:t.function,name:t.name,definition:t.def});
  return {...w.stats(),ms:Date.now()-started,db:cat.db};
}
function passportSegment(db,segment,p,env) {
  const w=S.writer(db,segment),revision=p.repo?.sha || null,indexKey=`passport:${p.service}@${revision || 'unknown'}`,id=`service:${encodeURIComponent(env)}:${encodeURIComponent(p.service)}@${encodeURIComponent(revision || 'unknown')}`;
  const repo=p.repo?.project&&p.repo?.repo?`${p.repo.project}/${p.repo.repo}`:null,ctx={indexKey,repo,revision,service:p.service,source:'passport'};
  w.node({id,kind:'service',name:p.service,env,...ctx});
  w.raw({type:'context',...ctx,dbs:(p.db?.datasources || []).map(d=>d.db).filter(Boolean),libs:[]});
  const e=p.effective || {};
  for(const t of e.tables || [])if(t.table)w.raw({type:'access-db',node:id,name:t.table,access:['read','write','function'].includes(t.access)?t.access:'mapping',...ctx,...location(t.file,t.line)});
  for(const c of e.dbCalls || [])if(c.name)w.raw({type:'dbcall',node:id,name:c.name,...ctx,...location(c.file,c.line)});
  for(const [kind,items] of [['http-ingress',e.endpoints],['http-egress',e.calls || e.feign],['kafka-consume',e.consumes || e.kafka?.consumes],['kafka-produce',e.produces || e.kafka?.produces],['es',e.es]])for(const port of items || []) {
    const cluster=(e.ports || []).find(p=>p.env===env&&p.boundary?.topic===port.topic)?.boundary?.cluster;
    w.raw({type:'port',node:id,kind,...ctx,...port,...(cluster?{cluster}:{}),candidate:true,access:'mapping'});
  }
  w.gap({kind:'passport-only-coverage',service:p.service,repo,detail:'Only service-level passport evidence is cached. Fetch/index the pinned source for method/column paths.'});
  return {...w.stats(),service:p.service,repo};
}
function bindSegment(db,segment,input,sourceSegments) {
  const w = S.writer(db,segment), started = Date.now(), contexts = new Map();
  for(const gap of input.passports.gaps || [])w.gap(gap);
  if(!input.sources.length)w.gap({kind:'no-indexed-source',detail:'Fetch repositories or build service passports, then refresh data_index. Only cached database definitions are available.'});
  if(!input.cats.length)w.gap({kind:'no-cached-database',detail:'catalog_sync pg is needed to resolve exact database tables and columns.'});
  const raw = type => db.prepare('SELECT r.payload FROM raw_edges r JOIN active_segments a ON a.id=r.segment').iterate();
  for (const row of raw()) { const r=JSON.parse(row.payload); if(r.type==='context')contexts.set(r.indexKey,r); }
  // A library executes against its callers' datasources, not an arbitrary global
  // database. Keep the union when pinned consumers disagree instead of guessing.
  for(let round=0;round<8;round++)for(const ctx of contexts.values())if(!ctx.dbs?.length) {
    const parents=[...contexts.values()].filter(p=>(p.libs || []).some(l=>l.index===ctx.indexKey||l.index===ctx.repo));
    const dbs=[...new Set(parents.flatMap(p=>p.dbs || []))];
    if(dbs.length)ctx.dbs=dbs;
  }
  const candidates = (legacy,origin,kind) => {
    if(typeof legacy!=='string'||!legacy)return [];
    let rows = db.prepare('SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.symbol=? OR n.legacy=?').all(legacy,legacy).map(x=>JSON.parse(x.payload));
    if (kind) rows=rows.filter(n=>n.kind===kind);
    const local=rows.filter(n=>n.indexKey===origin);if(local.length)return local;
    const allowed=new Set((contexts.get(origin)?.libs || []).map(l=>l.index));
    return rows.filter(n=>allowed.has(n.indexKey)||allowed.has(n.repo));
  };
  const node = id => S.getNode(db,id);
  const data = (kind,name,r={}) => {
    const n=ID.norm(name),qualified=n.includes('.');
    let rows=db.prepare(`SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind=? AND ${qualified?'n.object=?':'n.leaf=?'}`).all(kind,n).map(x=>JSON.parse(x.payload));
    if(!qualified)rows=rows.filter(n=>n.object.split('.').at(-1)===ID.norm(name));
    const dbs=r.db?[r.db]:contexts.get(r.indexKey)?.dbs || [];
    if(dbs.length)rows=rows.filter(n=>dbs.includes(n.db)||dbs.includes(input.cats.find(c=>c.db===n.db)?.database));
    return rows;
  };
  const emitData = (src,kind,name,access,r,extra={}) => {
    const targets=data(kind,name,r),candidate=targets.length!==1;
    if(!targets.length)w.gap({kind:'unresolved-database-object',name,repo:r.repo,db:r.db,file:r.file,line:r.line});
    if(candidate&&targets.length)w.gap({kind:'ambiguous-database-object',name,repo:r.repo,candidates:targets.map(n=>n.id)});
    for(const t of targets)w.edge({src,dst:t.id,relation:extra.relation || 'access',access,proof:extra.proof || 'sql',...location(r.file,r.line),repo:r.repo,revision:r.revision,evidenceSource:evidenceSource(r),source:r.source || 'code',candidate,...extra});
    return targets;
  };
  function inherits(c,base,seen=new Set()) {
    if(c.symbol===base)return true;if(seen.has(c.id)||seen.size>=32)return false;seen.add(c.id);
    return [...(c.ext || []),...(c.impl || [])].some(s=>s===base||candidates(s,c.indexKey,'class').some(parent=>inherits(parent,base,seen)));
  }
  function receiverFields(cls,field,origin,seen=new Set()) {
    const own=candidates(`${cls}.${field}`,origin,'field');if(own.length)return own;if(seen.has(cls)||seen.size>=32)return [];seen.add(cls);
    return candidates(cls,origin,'class').flatMap(c=>[...(c.ext || []),...(c.impl || [])].flatMap(parent=>receiverFields(parent,field,c.indexKey,seen)));
  }
  function method(legacy,r,arity,types,seen=new Set()) {
    let found=candidates(legacy,r.indexKey);
    const [cls,name]=legacy.split('#');
    if(!found.length&&name&&!seen.has(cls)) {
      seen.add(cls);
      for(const c of candidates(cls,r.indexKey,'class'))for(const base of [...(c.ext || []),...(c.impl || [])])found.push(...method(`${base}#${name}`,{...r,indexKey:c.indexKey},arity,types,seen));
    }
    if(arity!==undefined){const exact=found.filter(n=>n.kind==='method'&&n.params?.length===arity);if(exact.length)found=exact;}
    if(types?.length&&types.every(Boolean)){const exact=found.filter(n=>n.params?.every((p,i)=>String(p.type).split('.').at(-1)===String(types[i]).split('.').at(-1)));if(exact.length)found=exact;}
    if(found.length)return found;
    if(name)for(const c of candidates(cls,r.indexKey,'class')) {
      const accessor=name.match(/^(get|set|is)([A-Z][\w$]*)$/),field=accessor&&candidates(`${cls}.${accessor[2][0].toLowerCase()+accessor[2].slice(1)}`,c.indexKey,'field')[0];
      const generated=field&&!c.unsupportedAccessors&&(accessor[1]==='set'?!field.final&&(c.lombok?.some(a=>['Data','Setter'].includes(a))||field.annos?.includes('Setter')):c.lombok?.some(a=>['Data','Getter','Value'].includes(a))||field.annos?.includes('Getter'));
      if(c.role==='repository'||generated) {
        const symbol=`${cls}#${name}(${Array.from({length:arity || 0},()=>'?').join(',')})`,id=ID.code(c.indexKey,c.revision,symbol);
        const n={...c,id,kind:'method',symbol,legacy,signature:symbol.split('#')[1],classSymbol:cls,name:`${c.name}#${name}`,generated:true,params:Array.from({length:arity || 0},()=>({type:'?'}))};w.node(n);found.push(n);
      }
    }
    return found;
  }
  const entities = new Map(), repositories=[];
  for(const row of raw()) {
    E.check();const r=JSON.parse(row.payload);
    if(r.type==='entity') {
      const cs=candidates(r.classSymbol,r.indexKey,'class');
      for(const c of cs){const ts=emitData(c.id,'table',r.table,'mapping',r,{relation:'entity',proof:'orm-mapping'});entities.set(c.id,ts);}
    }
    if(r.type==='repository')repositories.push(r);
    if(r.type==='column-map')for(const f of candidates(r.symbol,r.indexKey,'field'))emitData(f.id,'column',`${r.table}.${r.column}`,'mapping',r,{relation:'maps-column',proof:'orm-mapping'});
  }
  for(const row of raw()) {
    const r=JSON.parse(row.payload);if(r.type!=='inherited-column-map')continue;
    for(const [entityId,tables]of entities) {
      const entity=node(entityId);if(!entity||!inherits(entity,r.classSymbol))continue;
      for(const f of candidates(r.symbol,entity.indexKey,'field'))for(const table of tables)emitData(f.id,'column',`${table.object}.${r.column}`,'mapping',{...r,db:table.db},{relation:'maps-column',proof:'inherited-orm-mapping',candidate:true});
    }
  }
  const repoEntities=new Map();
  for(const r of repositories) {
    const cs=candidates(r.classSymbol,r.indexKey,'class');
    const es=r.entity?db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='class' AND (n.legacy=? OR n.name=?)").all(r.entity,r.entity).map(x=>JSON.parse(x.payload)).filter(n=>n.indexKey===r.indexKey||(contexts.get(r.indexKey)?.libs||[]).some(l=>l.index===n.indexKey||l.index===n.repo)):[];
    for(const c of cs)if(es.length===1&&entities.has(es[0].id)){repoEntities.set(c.id,{entity:es[0],tables:entities.get(es[0].id)});w.edge({src:c.id,dst:es[0].id,relation:'repository-entity',proof:'orm-mapping'});}else w.gap({kind:'unresolved-repository-entity',repo:r.repo,class:r.classSymbol,entity:r.entity});
  }
  // Make the link segment visible while binding generated accessors/repository methods.
  db.prepare('INSERT OR IGNORE INTO active_segments VALUES (?)').run(segment);
  const accessor = (n,r) => {
    const match=n.legacy?.match(/#(get|set|is)([A-Z][\w$]*)$/);if(!match||!n.generated)return;
    const field=match[2][0].toLowerCase()+match[2].slice(1);
    for(const f of candidates(`${n.classSymbol}.${field}`,n.indexKey,'field'))w.edge({src:n.id,dst:f.id,relation:match[1]==='set'?'object-write':'object-read',access:match[1]==='set'?'object-write':'object-read',proof:n.generated?'generated-accessor':'accessor',repo:r.repo || n.repo,evidenceSource:evidenceSource(r),...location(r.file,r.line),persistenceVerified:false});
  };
  const operation = (n,r) => {
    if(n.kind!=='method'||!n.classSymbol)return;
    const c=candidates(n.classSymbol,n.indexKey,'class')[0],entity=c&&repoEntities.get(c.id);if(!entity)return;
    const name=n.legacy.split('#')[1];
    const access=/^(save|delete|remove|insert|update|flush)/.test(name)?'write':/^(find|read|get|query|search|stream|count|exists)/.test(name)?'read':null;
    if(!access)return;
    // @Query/@Procedure bodies have their own SQL evidence and must not acquire contradictory name-based access.
    if(n.annos?.some(a=>['Query','Procedure','Modifying'].includes(a)))return;
    for(const t of entity.tables) {
      w.edge({src:n.id,dst:t.id,relation:'repository-operation',access,proof:'orm-operation',candidate:true,repo:r.repo || n.repo,evidenceSource:evidenceSource(r),...location(r.file,r.line),note:'Generated persistence operation; exact selected/dirty columns require runtime verification.'});
      for(const row of db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='column' AND n.parent=?").iterate(t.id)) {
        const column=JSON.parse(row.payload);
        w.edge({src:n.id,dst:column.id,relation:'repository-operation',access,proof:'orm-operation',candidate:true,repo:r.repo || n.repo,evidenceSource:evidenceSource(r),...location(r.file,r.line),note:'Entity columns are candidates; projections, dirty checking, converters and callbacks are not evaluated.'});
      }
      const criteria=name.split('By')[1]?.split('OrderBy')[0];
      if(criteria)for(const property of criteria.split(/And|Or/).map(p=>p.replace(/(?:IsNotNull|IsNull|NotNull|Null|GreaterThanEqual|LessThanEqual|GreaterThan|LessThan|Between|StartingWith|EndingWith|Containing|IgnoreCase|Equals|Like|NotIn|In|True|False|Not|Is)$/,''))) {
        const field=property[0]?.toLowerCase()+property.slice(1),fs=candidates(`${entity.entity.symbol}.${field}`,entity.entity.indexKey,'field');
        for(const f of fs)for(const row of db.prepare("SELECT e.payload FROM edges e JOIN active_segments a ON a.id=e.segment WHERE e.src=? AND e.relation='maps-column'").iterate(f.id)) {
          const mapping=JSON.parse(row.payload);w.edge({src:n.id,dst:mapping.dst,relation:'derived-query-predicate',access:'predicate',proof:'derived-property',candidate:true,repo:r.repo || n.repo,evidenceSource:evidenceSource(r),...location(r.file,r.line),note:'Spring Data property-name derivation; custom implementations and query lookup configuration require verification.'});
        }
      }
    }
  };
  const ports=[];
  function jpql(r) {
    if(r.source==='database')return;
    const replacements=[],properties=new Map();
    for(const m of r.sql.matchAll(/\b(from|join|update|into)\s+([\w.]+)(?:\s+(?:as\s+)?(\w+))?/gi)) {
      if(!/[A-Z]/.test(m[2]))continue;
      const rows=db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='class' AND (n.symbol=? OR n.name=?)").all(m[2],m[2]).map(x=>JSON.parse(x.payload)).filter(n=>entities.has(n.id)&&(n.indexKey===r.indexKey||(contexts.get(r.indexKey)?.libs || []).some(l=>l.index===n.indexKey||l.index===n.repo)));
      if(rows.length!==1)continue;const c=rows[0],tables=entities.get(c.id);if(tables.length!==1)continue;
      const at=m.index+m[0].indexOf(m[2]);replacements.push({at,end:at+m[2].length,text:tables[0].object});
      for(const row of db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='field' AND json_extract(n.payload,'$.classSymbol')=? AND n.repo=?").iterate(c.symbol,c.repo)) {
        const f=JSON.parse(row.payload),mapping=db.prepare("SELECT e.dst FROM edges e JOIN active_segments a ON a.id=e.segment WHERE e.src=? AND e.relation='maps-column' LIMIT 2").all(f.id);
        if(mapping.length===1){const target=node(mapping[0].dst);if(target)properties.set(f.field,target.object.slice(tables[0].object.length+1));}
      }
    }
    if(!replacements.length)return;
    for(const t of require('./column-lineage').tokens(r.sql))if(!t.literal&&!t.quoted&&properties.has(t.text))replacements.push({at:t.at,end:t.at+t.text.length,text:properties.get(t.text)});
    for(const replacement of replacements.sort((a,b)=>b.at-a.at))r.sql=r.sql.slice(0,replacement.at)+replacement.text+r.sql.slice(replacement.end);
    r.jpql=true;
  }
  for(const row of raw()) {
    E.check(); const r=JSON.parse(row.payload);
    if(r.type==='receiver-call') {
      const fields=receiverFields(r.owner,r.receiver,r.indexKey);
      if(fields.length!==1||!fields[0].resolvedType){w.gap({kind:'unresolved-inherited-receiver',repo:r.repo,file:r.file,line:r.line,receiver:r.receiver});continue;}
      r.type='edge';r.to=fields[0].resolvedType.replace(/^ext:/,'')+'#'+r.method;
    }
    if(r.type==='field-access')for(const f of candidates(r.field,r.indexKey,'field'))w.edge({src:r.node,dst:f.id,relation:r.access,access:r.access,proof:'source-field',repo:r.repo,evidenceSource:evidenceSource(r),...location(r.file,r.line),persistenceVerified:false});
    else if(r.type==='edge') {
      if(/^(endpoint|topic|es|table|column|pgfn):/.test(r.from)||/^(endpoint|topic|es|table|column|pgfn):/.test(r.to))continue; // resolved with full identities below
      if(['entity','column','repository'].includes(r.relation))continue;
      const from=method(r.from,r),to=method(r.to.replace(/^ext:/,''),r,r.arity,r.types);
      if(!from.length||!to.length){if(r.relation==='calls'&&!/^(java\.|javax\.|jakarta\.|org\.springframework\.|org\.apache\.kafka\.|org\.elasticsearch\.)/.test(r.to.replace(/^ext:/,'')))w.gap({kind:'unresolved-call',repo:r.repo,from:r.from,to:r.to,...location(r.file,r.line)});continue;}
      for(const a of from)for(const b of to){const object=['reads','writes'].includes(r.relation);w.edge({src:a.id,dst:b.id,relation:object?(r.relation==='writes'?'object-write':'object-read'):r.relation,access:object?(r.relation==='writes'?'object-write':'object-read'):undefined,proof:'source',candidate:from.length>1||to.length>1,...location(r.file,r.line),repo:r.repo,revision:r.revision,evidenceSource:evidenceSource(r),persistenceVerified:object?false:undefined});accessor(b,r);operation(b,r);}
    } else if(r.type==='sql') {
      if(r.mybatis&&r.namespace&&r.mapperMethod){const bound=method(`${r.namespace}#${r.mapperMethod}`,r);if(bound.length===1)r.node=bound[0].id;else w.gap({kind:'mybatis-method-unresolved',repo:r.repo,file:r.file,line:r.line,namespace:r.namespace,method:r.mapperMethod});}
      jpql(r);
      const wanted=r.db?[r.db]:contexts.get(r.indexKey)?.dbs||[];
      const relations=new Map();
      for(const ref of [...X.sqlRefs(r.sql).filter(x=>x.access!=='function').map(x=>x.table),...(r.triggerTables || [])])for(const table of data('table',ref,r))relations.set(table.id,table);
      const maxColumns=columnLimit();
      const cats=[...new Set([...relations.values()].map(t=>t.db))].filter(db=>!wanted.length||wanted.includes(db)||wanted.includes(input.cats.find(c=>c.db===db)?.database)).map(database=>({db:database,tables:[...relations.values()].filter(t=>t.db===database).map(t=>{const columns=db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='column' AND n.parent=? LIMIT ?").all(t.id,maxColumns+1).map(row=>JSON.parse(row.payload));if(columns.length>maxColumns)w.gap({kind:'sql-column-budget',table:t.id,limit:maxColumns,note:'Raise DT_DATA_INDEX_COLUMNS_PER_TABLE for this estate.'});const parts=t.object.split('.');return {schema:parts[0],name:parts.slice(1).join('.'),columns:columns.slice(0,maxColumns).map(c=>({name:c.object.slice(t.object.length+1)}))};})}));
      if(!cats.length&&/\bexecute\b/i.test(r.sql))w.gap({kind:'dynamic-sql',repo:r.repo,file:r.file,line:r.line});
      for(const ref of X.sqlRefs(r.sql))if(ref.access!=='function')emitData(r.node,'table',ref.table,ref.access,r,r.jpql?{proof:'jpql-mapping',candidate:true}:{});
      for(const name of new Set([...X.sqlCalls(r.sql),...[...r.sql.matchAll(/\bcall\s+([\w.]+)/gi)].map(m=>m[1])]))emitData(r.node,'pgfn',name,'call',r,{relation:'calls-function'});
      for(const cat of cats) {
        const result=require('./column-lineage').analyze(r.sql,cat,{schema:r.schema,triggerTables:r.triggerTables});
        for(const h of result.hits)emitData(r.node,'column',`${h.table}.${h.column}`,h.access,{...r,db:cat.db,line:r.line+(r.lineMapping==='literal-start'?0:h.line-1)},{syntax:h.syntax,sqlLine:h.line,locationKind:r.lineMapping==='literal-start'?'SQL literal start':'SQL body line',candidate:!!r.dynamic||!!r.jpql||!!h.ambiguous||cats.length>1&&data('table',h.table,r).length>1,proof:r.jpql?'jpql-mapping':'sql'});
        for(const gap of result.gaps)w.gap({...gap,repo:r.repo,db:cat.db,file:r.file,line:r.line+gap.line-1});
      }
    } else if(r.type==='rowmapper') {
      const dbs=contexts.get(r.indexKey)?.dbs || [];
      const columns=db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='column' AND n.leaf=? LIMIT 101").all(ID.norm(r.column)).map(row=>JSON.parse(row.payload)).filter(n=>!dbs.length||dbs.includes(n.db)||dbs.includes(input.cats.find(c=>c.db===n.db)?.database));
      for(const c of columns.slice(0,100))w.edge({src:r.node,dst:c.id,relation:'resultset-label',access:'object-read',proof:'row-mapper-label',candidate:true,repo:r.repo,evidenceSource:evidenceSource(r),...location(r.file,r.line),note:'ResultSet column label; relation/projection/alias binding must be verified against the supplying query.'});
      if(columns.length>100)w.gap({kind:'resultset-label-budget',column:r.column,repo:r.repo});
    } else if(r.type==='access-db')emitData(r.node,r.access==='function'?'pgfn':'table',r.name,r.access==='function'?'call':r.access,r,{proof:'passport',candidate:true,note:'Service-level passport finding; method-specific reachability requires indexed source.'});
    else if(r.type==='dbcall')emitData(r.node,'pgfn',r.name,'call',r,{relation:'calls-function'});
    else if(r.type==='trigger')for(const table of data('table',r.table,r))for(const fn of data('pgfn',r.function,r))w.edge({src:table.id,dst:fn.id,relation:'trigger',proof:'database-trigger',candidate:true,access:'write-trigger',note:r.definition,condition:'Only the trigger event, timing and enabled state can activate this path.'});
    else if(r.type==='port')ports.push(r);
  }
  // Accessor declarations are useful even when nobody in this index calls them yet.
  for(const row of db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='method'").iterate()){const n=JSON.parse(row.payload);accessor(n,n);}
  const methods=c=>db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='method' AND n.parent=? AND json_extract(n.payload,'$.indexKey')=?").all(c.symbol,c.indexKey).map(r=>JSON.parse(r.payload));
  for(const row of db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='class'").iterate()) {
    const c=JSON.parse(row.payload);if(!(c.ext?.length||c.impl?.length))continue;
    const own=methods(c);
    for(const parentName of [...(c.ext || []),...(c.impl || [])])for(const parent of candidates(parentName,c.indexKey,'class'))for(const base of methods(parent)) {
      if(base.mods?.some(m=>['static','private','final'].includes(m)))continue;
      const erased=t=>String(t).replace(/<.*>/,'').split('.').at(-1);
      for(const override of own.filter(m=>m.legacy.split('#')[1]===base.legacy.split('#')[1]&&m.params?.length===base.params?.length&&base.params.every((p,i)=>/^[A-Z]$/.test(p.type)||erased(p.type)===erased(m.params[i].type))))w.edge({src:base.id,dst:override.id,relation:'dispatch',proof:'source-override',candidate:true,receiver:c.symbol,service:c.service,repo:c.repo,...location(c.file,override.line),condition:`The concrete receiver must select ${c.symbol}; generic/bean dispatch requires verification.`});
    }
  }
  const httpNodes=new Map();
  for(const p of ports) {
    const owner=contexts.get(p.indexKey),service=p.service || owner?.service;
    if(p.kind.startsWith('http')) {
      if(!p.method||!p.path)continue;
      if(/\$\{|#\{/.test(p.path)){w.gap({kind:'dynamic-http-route',repo:p.repo,file:p.file,line:p.line});continue;}
      const target=p.kind==='http-ingress'?service:p.client;
      if(target&&!/^[?$]/.test(target)&&!p.inheritedOnly) {
        const id=`http:${encodeURIComponent(input.env)}:${encodeURIComponent(target)}:${p.method}:${normRoute(p.path)}`;
        // An outgoing Feign declaration must not overwrite the actual ingress
        // declaration (and its retained source identity) on the target service.
        if(p.kind==='http-ingress'||!httpNodes.has(id)) {
          w.node({id,kind:'endpoint',name:`${p.method} ${p.path}`,service:target,env:input.env,route:p.path,method:p.method,repo:p.repo,revision:p.revision,revisionKey:p.revisionKey,sourceDigest:p.sourceDigest,sha:p.sha,...location(p.file,p.line)});
          httpNodes.set(id,p.kind);
        }
        w.edge({src:p.kind==='http-ingress'?id:p.node,dst:p.kind==='http-ingress'?p.node:id,relation:p.kind,proof:p.source==='passport'?'passport-route':'source-route',candidate:!!p.candidate,...location(p.file,p.line),repo:p.repo});
      } else if(service&&!p.inheritedOnly)w.gap({kind:'http-service-unknown',repo:p.repo,file:p.file,line:p.line});
      // Spring exposes annotated superclass methods on concrete service beans.
      if(p.kind==='http-ingress'&&(!service||p.inheritedOnly)) {
        const methodNode=node(p.node),className=methodNode?.classSymbol;
        for(const row of db.prepare("SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.kind='class'").iterate()) {
          const c=JSON.parse(row.payload);if(!c.service||!c.annos?.some(a=>['RestController','Controller'].includes(a))||!inherits(c,className))continue;
          const route=c.routePrefixes?.some(Boolean)?('/'+c.routePrefixes[0]+'/'+(p.methodPath || p.path)).replace(/\/+/g,'/'):p.path;
          const inherited=`http:${encodeURIComponent(input.env)}:${encodeURIComponent(c.service)}:${p.method}:${normRoute(route)}`;
          w.node({id:inherited,kind:'endpoint',name:`${p.method} ${route}`,service:c.service,env:input.env,repo:p.repo,revision:p.revision,revisionKey:p.revisionKey,sourceDigest:p.sourceDigest,sha:p.sha,inheritedFrom:p.repo,registration:{repo:c.repo,file:c.file,line:c.line,revision:c.revision,revisionKey:c.revisionKey},...location(p.file,p.line)});
          httpNodes.set(inherited,'http-ingress');
          w.edge({src:inherited,dst:p.node,relation:'inherited-http-ingress',proof:'source-inheritance',candidate:true,note:'Spring registration/bean selection requires runtime verification.',repo:c.repo,...location(p.file,p.line)});
        }
      }
    } else if(p.kind.startsWith('kafka')) {
      if(!p.topic||/^[?(]|\$\{|#\{/.test(p.topic)||p.pattern){w.gap({kind:'dynamic-kafka-topic',repo:p.repo,file:p.file,line:p.line});continue;}
      const cluster=p.cluster || `unknown@${p.indexKey}`,id=`topic:${encodeURIComponent(input.env)}:${encodeURIComponent(cluster)}:${encodeURIComponent(p.topic)}`;
      w.node({id,kind:'topic',name:p.topic,topic:p.topic,cluster:p.cluster || null,env:input.env});
      w.edge({src:p.kind==='kafka-consume'?id:p.node,dst:p.kind==='kafka-consume'?p.node:id,relation:p.kind,access:p.kind==='kafka-consume'?'read':'write',proof:'source-topic',candidate:!p.cluster||p.profiled,repo:p.repo,...location(p.file,p.line),note:'Topic routing does not prove payload field equivalence, runtime profile activation or delivery.'});
      if(!p.cluster)w.gap({kind:'kafka-cluster-unknown',repo:p.repo,topic:p.topic,note:'Unknown clusters are kept separate; add a reviewed link to cross them.'});
    } else if(p.kind==='es'&&p.index&&!/^[?(]|\$\{|#\{/.test(p.index)) {
      const id=`es:${encodeURIComponent(input.env)}:${encodeURIComponent(p.cluster || 'unknown@'+p.indexKey)}:${encodeURIComponent(p.index)}`;
      w.node({id,kind:'es',name:p.index,index:p.index,cluster:p.cluster || null,env:input.env});
      w.edge({src:p.node,dst:id,relation:'elasticsearch',access:p.access,proof:'source-index',candidate:p.access==='mapping'||!p.cluster,repo:p.repo,...location(p.file,p.line),note:'Index access; document/field mappings and delivery need verification.'});
      if(!p.cluster)w.gap({kind:'elasticsearch-cluster-unknown',repo:p.repo,index:p.index,note:'Unknown ES clusters are scoped to the source repository.'});
    }
  }
  for(const l of input.rules.links || []) {
    if(!node(l.from)||!node(l.to)){w.gap({kind:'reviewed-link-unresolved',from:l.from,to:l.to,evidence:l.evidence});continue;}
    w.edge({src:l.from,dst:l.to,relation:l.relation || 'reviewed-mapping',access:l.access || 'mapping',proof:'declared',evidence:l.evidence,candidate:false,note:'Reviewed declaration, not observed execution.'});
  }
  return {...w.stats(),ms:Date.now()-started};
}
async function build(args={}) {
  const started=Date.now(),life=require('./state-machine').create(require('./lifecycles').publication);let input=await inputs(args,{materialize:true}),cold=0;
  require('./tool-events').progress('discovered',{sources:input.sources.length,cold:input.raw.length,databases:input.cats.length});
  for(const source of input.raw) {
    E.check();const sha=require('node:child_process').spawnSync('git',['rev-parse','HEAD'],{cwd:source.root,encoding:'utf8',timeout:3000}).stdout?.trim();
    CI.build(source.root,source.key,{repo:source.repo,sha:/^[a-f0-9]{40}$/.test(sha || '')?sha:undefined,workspace:source.workspace});cold++;
  }
  if(cold)input=await inputs(args,{materialize:true});
  const db=S.open(input.env,true),segments=[],stats={sources:[],databases:[],reused:0,cold,aliases:input.rules.aliases,rulesRevision:input.rules.revision};
  life.to('staging');
  const ensure=(id,kind,source,run)=>{
    E.check();segments.push(id);const previous=db.prepare('SELECT stats FROM segments WHERE id=?').get(id);
    if(previous){stats.reused++;return {...JSON.parse(previous.stats),reused:true};}
    db.exec('BEGIN IMMEDIATE');
    try{const result=run();E.check();db.prepare('INSERT INTO segments VALUES (?,?,?,?,?)').run(id,kind,source,new Date().toISOString(),JSON.stringify(result));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  };
  try {
    const keys=input.sources.map(s=>s.canonical),libraryKeys=new Set(keys.flatMap(k=>(CI.metadata(k)?.libs || []).map(l=>l.index)));
    for(const source of input.sources) {
      const segment=S.hash([FORMAT,'source',source]);
      stats.sources.push(ensure(segment,'source',source.canonical,()=>{const idx=CI.load(source.canonical);if(!idx)throw S.invalid('Code index is invalid: '+source.canonical);return repoSegment(db,segment,idx,source.key,libraryKeys.has(source.canonical)||libraryKeys.has(source.key),input.env);}));
      CI.release(source.canonical);
      require('./tool-events').progress('source',{source:source.key,current:stats.sources.length,total:input.sources.length,stats:stats.sources.at(-1)});
    }
    const services=new Set(stats.sources.map(s=>s.service));
    for(const row of input.passports.rows)if((!row.passport.env||row.passport.env===input.env)&&!services.has(row.passport.service)) {
      const segment=S.hash([FORMAT,'passport',row.digest]);ensure(segment,'passport',row.passport.service,()=>passportSegment(db,segment,row.passport,input.env));
    }
    for(const cat of input.cats){const segment=S.hash([FORMAT,'db',input.catalog.find(c=>c[0]===cat.db)]);stats.databases.push(ensure(segment,'database',cat.db,()=>dbSegment(db,segment,cat,input.env)));require('./tool-events').progress('database',{database:cat.db,current:stats.databases.length,total:input.cats.length});}
    db.exec('CREATE TEMP TABLE IF NOT EXISTS active_segments(id TEXT PRIMARY KEY) WITHOUT ROWID; DELETE FROM active_segments;');
    const add=db.prepare('INSERT OR IGNORE INTO active_segments VALUES (?)');for(const s of segments)add.run(s);
    const links=S.hash([FORMAT,'links',input.signature]);stats.links=ensure(links,'links',input.signature,()=>bindSegment(db,links,input,segments));
    const current=await inputs(args);if(current.signature!==input.signature)throw S.invalid('Sources changed during indexing; previous generation retained. Retry after indexing/checkouts settle.');
    E.check();life.to('verified');const generation=S.hash([FORMAT,input.selection,input.signature,segments]);stats.ms=Date.now()-started;
    db.exec('BEGIN IMMEDIATE');
    try{db.prepare('INSERT OR IGNORE INTO generations VALUES (?,?,?,?,?)').run(generation,input.selection,input.signature,new Date().toISOString(),JSON.stringify(stats));const put=db.prepare('INSERT OR IGNORE INTO generation_segments VALUES (?,?)');for(const s of segments)put.run(generation,s);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    life.to('committed');life.to('published');require('./tool-events').progress('published',{generation,ms:stats.ms});
    return {protocol:'dt.data-index/v1',env:input.env,generation,signature:input.signature,state:'ready',stats};
  } catch(error){if(!life.terminal)life.to('aborted');throw error;} finally {db.close();}
}
module.exports={inputs,build,settings,FORMAT};
