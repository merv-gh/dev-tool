// cache/<env>/catalog.txt: one line per table / function / index / topic / service.
// It is the cheap search surface: grep it, or use `dt find`.
const fs = require('fs');
const path = require('path');
const { CACHE, readJson, fileStamp } = require('./util');
const notes = require('./notes');

function list(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')); } catch { return []; }
}

function writeLines(env, emit, usedBy) {
  const lines = {push(...rows){for(const line of rows)emit(line);}};
  const root = path.join(CACHE, env),annotations=notes.all();
  const note=(name,db)=>{const n=annotations[String(db?db+':'+name:name).toLowerCase()]||(db?annotations[name.toLowerCase()]:null);return n?'  # '+n.replace(/\s+/g,' '):'';};
  for (const data of require('./pg').loadAll(env)) {
    for (const t of data.tables) {
      const k = `${t.schema}.${t.name}`;
      const kind = t.kind === 'table' ? '' : ` [${t.kind}]`;
      const u = usedBy.get(`${data.db}|${k.toLowerCase()}`);
      lines.push(`pg ${data.db} ${k}${kind} ~${t.est_rows}: ${t.columns.map(c => `${c.name} ${c.type}`).join(', ')}${u ? ` | used by: ${u}` : ''}${note(k, data.db)}`);
    }
    for (const fn of data.functions || []) {
      const k = `${fn.schema}.${fn.name}`;
      const u = usedBy.get(`${data.db}|${k.toLowerCase()}`);
      const ret = fn.returns ? ` -> ${fn.returns}` : '';
      lines.push(`pgfn ${data.db} ${k}(${fn.signature ?? fn.args})${ret} [${fn.kind || 'function'} ${fn.lang}]${u ? ` | used by: ${u}` : ''}${note(k, data.db)}`);
    }
  }

  const esDir = path.join(root, 'es');
  for (const f of list(esDir)) {
    const d = readJson(path.join(esDir, f));
    if (!d) continue;
    const al = d.aliases.length ? ` [${d.aliases.join(',')}]` : '';
    lines.push(`es ${d.index}${al} ${d.docs}: ${Object.entries(d.fields).map(([k, v]) => `${k} ${v}`).join(', ')}${note(d.index)}`);
  }

  const kDir = path.join(root, 'kafka');
  for (const f of list(kDir)) {
    const d = readJson(path.join(kDir, f));
    if (!d) continue;
    const schema = d.valueSchema ? ` schema:${d.valueSchema.type}v${d.valueSchema.version}` : '';
    const fields = d.fields ? Object.keys(d.fields) : require('./fixture-schema').paths(d).map(p => p.path);
    lines.push(`kafka ${d.topic} ${d.messages ?? '?'}${schema}: ${fields.join(', ')}${note(d.topic)}`);
  }

  const consul = readJson(path.join(root, 'consul.json'));
  for (const [name, s] of Object.entries(consul?.services || {})) {
    const inst = s.instances || [];
    lines.push(`consul ${name} ${inst.filter(i => i.status === 'passing').length}/${inst.length}: ${inst.map(i => `${i.address}:${i.port}`).join(', ')}`);
  }

  // Service passports (static code analysis) are env-independent; listed in every env's catalog.
  for (const p of require('./passport').list({manual:false})) {
    const parts = [
      p.consumes.length && `consumes ${p.consumes.join(', ')}`,
      p.produces.length && `produces ${p.produces.join(', ')}`,
      p.tables.length && `tables ${p.tables.join(', ')}`,
      p.calls.length && `calls ${p.calls.join(', ')}`,
      `endpoints ${p.endpoints}`,
    ].filter(Boolean);
    lines.push(`svc ${p.service} ${p.repo}@${(p.sha || '').slice(0, 10)}: ${parts.join('; ')}${note(p.service)}`);
  }

  // Bitbucket repos with their modules and folders (catalog_sync what=bitbucket)
  try { for (const p of require('./docs-cache').list()) lines.push(`docs ${p.space} ${p.id} ${p.title} v${p.version}: ${p.blocks.map(b => b.text).join(' ').replace(/\s+/g, ' ').slice(0, 1200)} | ${p.url}`); } catch (e) { console.error(`documentation index: ${e.message}`); }
  try { lines.push(...require('./bbindex').catalogLines()); } catch (e) { console.error(`bitbucket index: ${e.message}`); }

  // API routes (code endpoints + seen in the browser) and the browser site map; env-independent too.
  try { lines.push(...require('./routes').catalogLines({manual:false})); } catch (e) { console.error(`api routes: ${e.message}`); }
  try {
    for (const s of require('./config').getBrowser().sites) {
      lines.push(`site ${s.site} ${s.url}${s.description ? ` # ${s.description}` : ''}`);
      for (const l of s.links) lines.push(`site ${s.site}.${l.link} ${l.url}${l.description ? ` # ${l.description}` : ''}`);
    }
  } catch (e) { console.error(`site map: ${e.message}`); }

}

function inputSignature(env){
  const C=require('./config'),files=[];
  function walk(dir,depth=0){if(depth>4)return;let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(e.name.startsWith('_stories')||e.name==='history'||e.name==='attachments'||e.name==='index')continue;const f=path.join(dir,e.name);if(e.isDirectory())walk(f,depth+1);else if(e.name.endsWith('.json')&&!e.name.startsWith('_usage')&&!e.name.endsWith('.dictionaries.json'))files.push([f,fileStamp(f)]);}}
  for(const dir of [path.join(CACHE,env,'pg'),path.join(CACHE,env,'es'),path.join(CACHE,env,'kafka'),path.join(CACHE,'confluence'),C.PATHS.passports])walk(dir);
  for(const f of [path.join(CACHE,env,'consul.json'),path.join(CACHE,'bitbucket/_index.json'),path.join(CACHE,'routes.json'),notes.FILE,C.CONFIG_FILE])files.push([f,fileStamp(f)]);
  return require('node:crypto').createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
function build(env,{force=false}={}){
  require('./access').checkEnv(env);const S=require('./catalog-store'),signature=inputSignature(env),root=path.join(CACHE,env),textFile=path.join(root,'catalog.txt');
  if(!force&&fs.existsSync(textFile)&&readJson(path.join(root,'catalog-export.json'))?.signature===signature&&S.unchanged(env,signature))return S.status(env).objects;
  require('./pgindex').build(env);
  const writer=S.available()?S.writer(env,signature,fileStamp(path.join(root,'pg/_usage.json'))):null;
  fs.mkdirSync(root,{recursive:true});const temporary=textFile+'.'+require('node:crypto').randomUUID()+'.tmp',fd=fs.openSync(temporary,'wx');let count=0;
  try{
    if(writer){for(const e of require('./pgindex').load(env).edges)writer.edge(e);writer.finishEdges();}
    const usedBy=writer?{get:key=>writer.summary(key)}:require('./pgindex').usedBySummary(env);
    writeLines(env,line=>{require('./execution').check();if(writer)writer.line(line);fs.writeSync(fd,line+'\n');count++;},usedBy);
    if(inputSignature(env)!==signature)throw Error('Catalog inputs changed during refresh; previous generation retained');
    fs.fsyncSync(fd);fs.closeSync(fd);if(writer)writer.commit();fs.renameSync(temporary,textFile);require('./atomic-file').atomicFile(path.join(root,'catalog-export.json'),JSON.stringify({signature}));return count;
  }catch(error){writer?.abort();try{fs.closeSync(fd);}catch{}fs.rmSync(temporary,{force:true});throw error;}
}
// Streaming compatibility path for older Node or not-yet-indexed caches.
function* textLines(file){const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(65536),decoder=new (require('node:string_decoder').StringDecoder)('utf8');let pending='';try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))){pending+=decoder.write(buffer.subarray(0,n));let i;while((i=pending.indexOf('\n'))>=0){yield pending.slice(0,i);pending=pending.slice(i+1);}if(Buffer.byteLength(pending)>1024*1024)throw Error('Catalog line exceeds streaming budget');}pending+=decoder.end();if(pending)yield pending;}finally{fs.closeSync(fd);}}
function find(env,q,{limit=200}={}){
 require('./access').checkEnv(env);limit=Math.max(1,Math.min(500,Number(limit)||200));const S=require('./catalog-store');
 if(S.available()){const page=S.page(env,q,{limit});if(page)return page.results.map(r=>r.line);}
 const file=path.join(CACHE,env,'catalog.txt');if(!fs.existsSync(file))return [];
 const {words,kind}=S.terms(q),direct=[],related=[];for(const line of textLines(file)){const lower=line.toLowerCase(),cut=lower.indexOf(' | used by: '),main=cut<0?lower:lower.slice(0,cut);if(kind&&!line.startsWith(kind+' '))continue;if(!words.every(w=>lower.includes(w)))continue;if(words.every(w=>main.includes(w)))direct.push(line);else if(related.length<limit)related.push(line);if(direct.length>=limit)break;}return [...direct,...related].slice(0,limit);
}
function search(env,q,options={}){require('./access').checkEnv(env);const S=require('./catalog-store');const page=S.available()?S.page(env,q,options):null;if(page)return page;if(options.cursor||options.generation)throw Object.assign(Error('This cache has no retained index generation; refresh catalog_sync what=index first'),{code:'DT_CATALOG_GENERATION',statusCode:409});return {protocol:'dt.catalog-page/v1',env,generation:null,backend:'stream',results:find(env,q,{limit:options.limit}).map(line=>({line})),nextCursor:null,complete:false,gaps:['Legacy streaming cache; refresh an index for stable pagination.']};}
// Used by coordinator health/Admin polling: never materialize a large text
// catalog to count it. null means a legacy count needs an index refresh.
function count(env) {
  require('./access').checkEnv(env);
  try { const indexed = require('./catalog-store').status(env); if (indexed.generation) return indexed.objects; } catch {}
  const cached = readJson(path.join(CACHE, env, '_sources.json'))?.index?.lines;
  if (Number.isSafeInteger(cached)) return cached;
  const file = path.join(CACHE, env, 'catalog.txt');
  try { if (fs.statSync(file).size <= 1048576) return fs.readFileSync(file, 'utf8').split('\n').length - 1; }
  catch (error) { if (error.code === 'ENOENT') return 0; }
  return null;
}

// Is anything synced for this env? Tools use it to send the model to find/catalog_sync first.
function status(env) {
  require('./access').checkEnv(env);
  const root = path.join(CACHE, env);
  return {
    catalog: fs.existsSync(path.join(root, 'catalog.txt')),
    schemas: readJson(path.join(root, 'pg', '_index.json'))?.schemas || null,
    indices: readJson(path.join(root, 'es', '_index.json'))?.indices || null,
    topics: readJson(path.join(root, 'kafka', '_index.json'))?.topics || null,
  };
}

module.exports = { build, find, search, count, status, inputSignature, textLines };
