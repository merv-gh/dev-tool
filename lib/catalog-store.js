// Rebuildable, versioned catalog/relationship index. All serving calls run in
// read workers; one local SQLite transaction publishes a complete generation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=(message,code='DT_CATALOG_INDEX')=>Object.assign(Error(message),{code,statusCode:409});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function available(){try{return !!require('node:sqlite').DatabaseSync;}catch{return false;}}
function filename(env){require('./access').checkEnv(env);if(!/^[\w-]+$/.test(env||''))throw fail('Invalid environment');return path.join(require('./util').CACHE,env,'catalog.sqlite');}
function open(env,{create=false}={}){
 const file=filename(env);if(!create&&!fs.existsSync(file))return null;
 const {DatabaseSync}=require('node:sqlite');if(create)fs.mkdirSync(path.dirname(file),{recursive:true});
 const db=new DatabaseSync(file,{readOnly:!create,timeout:2000});
 try{db.exec('PRAGMA cache_size=-4096; PRAGMA temp_store=FILE; PRAGMA busy_timeout=2000;');
 if(!create){const version=db.prepare('PRAGMA user_version').get().user_version;if(!version){db.close();return null;}if(version>1)throw fail('Catalog schema is newer than this build');}
 if(create){
  const v=db.prepare('PRAGMA user_version').get().user_version;if(v>1){throw fail('Catalog schema is newer than this build');}
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS generations(id INTEGER PRIMARY KEY,revision TEXT UNIQUE,signature TEXT,at TEXT,count INTEGER,edges INTEGER,pinned INTEGER DEFAULT 0);
   CREATE TABLE IF NOT EXISTS objects(id INTEGER PRIMARY KEY,key TEXT NOT NULL,line TEXT NOT NULL,text TEXT NOT NULL,main TEXT NOT NULL,kind TEXT NOT NULL,start INTEGER NOT NULL,stop INTEGER);
   CREATE UNIQUE INDEX IF NOT EXISTS object_live ON objects(key) WHERE stop IS NULL;
   CREATE INDEX IF NOT EXISTS object_generation ON objects(start,stop);
   CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(text,content='objects',content_rowid='id',tokenize='trigram');
   CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY,key TEXT NOT NULL,db TEXT,target TEXT,base_target TEXT,user TEXT,base_user TEXT,userKind TEXT,role TEXT,payload TEXT,start INTEGER NOT NULL,stop INTEGER);
   CREATE UNIQUE INDEX IF NOT EXISTS edge_live ON edges(key) WHERE stop IS NULL;
   CREATE INDEX IF NOT EXISTS edge_target ON edges(target,db,start,stop);
   CREATE INDEX IF NOT EXISTS edge_base_target ON edges(base_target,db,start,stop);
   CREATE INDEX IF NOT EXISTS edge_user ON edges(user,db,start,stop);
   CREATE INDEX IF NOT EXISTS edge_base_user ON edges(base_user,db,start,stop);
   PRAGMA user_version=1;`);
 }
 return db;}catch(error){db.close();throw error;}
}
function generation(db,revision){const row=revision?db.prepare('SELECT * FROM generations WHERE revision=?').get(revision):db.prepare('SELECT * FROM generations ORDER BY id DESC LIMIT 1').get();if(revision&&!row)throw fail('Catalog generation is unavailable; reopen the current search','DT_CATALOG_GENERATION');return row;}
function status(env){if(!available())return {backend:'stream',reason:'node:sqlite unavailable'};const db=open(env);if(!db)return {backend:'stream',generation:null};try{const g=generation(db);return {backend:'sqlite',generation:g?.revision,at:g?.at,objects:g?.count||0,edges:g?.edges||0,generations:db.prepare('SELECT count(*) AS n FROM generations').get().n};}finally{db.close();}}
function unchanged(env,signature){if(!available())return false;const db=open(env);if(!db)return false;try{return db.prepare("SELECT value FROM meta WHERE key='checked_signature'").get()?.value===signature;}finally{db.close();}}
function objectKey(line){const parts=line.split(/\s+/);const kind=parts[0];if(kind==='pgfn')return digest(line.split(' -> ')[0].split(' [')[0]);return digest(parts.slice(0,kind==='pg'?3:kind==='api'?4:kind==='docs'?3:2).join(' '));}
function writer(env,signature,usageStamp){
 const db=open(env,{create:true}),life=require('./state-machine').create(require('./lifecycles').catalogWriter);
 let closed=false,count=0,edgeCount=0,changed=0;const hash=crypto.createHash('sha256');
 try{db.exec('BEGIN IMMEDIATE; CREATE TEMP TABLE seen(key TEXT PRIMARY KEY) WITHOUT ROWID; CREATE TEMP TABLE edge_seen(key TEXT PRIMARY KEY) WITHOUT ROWID;');}catch(e){db.close();throw e;}
 const previous=generation(db),id=(previous?.id||0)+1;
 const seen=db.prepare('INSERT OR IGNORE INTO seen VALUES (?)'),edgeSeen=db.prepare('INSERT OR IGNORE INTO edge_seen VALUES (?)');
 const old=db.prepare('SELECT id,line FROM objects WHERE key=? AND stop IS NULL'),stop=db.prepare('UPDATE objects SET stop=? WHERE id=?');
 const add=db.prepare('INSERT INTO objects(key,line,text,main,kind,start) VALUES (?,?,?,?,?,?)'),fts=db.prepare('INSERT INTO search(rowid,text) VALUES (?,?)');
 const oldEdge=db.prepare('SELECT id FROM edges WHERE key=? AND stop IS NULL'),addEdge=db.prepare('INSERT INTO edges(key,db,target,base_target,user,base_user,userKind,role,payload,start) VALUES (?,?,?,?,?,?,?,?,?,?)');
 function check(){if(closed)throw fail('Catalog writer is closed');if((count+edgeCount)%256===0)require('./execution').check();}
 function line(value){check();if(Buffer.byteLength(value)>1024*1024)throw fail('Catalog line exceeds 1 MiB; previous generation retained');const key=objectKey(value);if(!seen.run(key).changes)throw fail('Duplicate catalog identity: '+value.slice(0,120));count++;hash.update(value+'\n');const row=old.get(key);if(row?.line===value)return;if(row)stop.run(id,row.id);const text=value.toLowerCase(),cut=text.indexOf(' | used by: '),r=add.run(key,value,text,cut<0?text:text.slice(0,cut),value.split(' ')[0],id);fts.run(r.lastInsertRowid,text);changed++;}
 function edge(e){check();const payload=JSON.stringify(e);if(Buffer.byteLength(payload)>1024*1024)throw fail('Usage edge exceeds 1 MiB');const key=digest(payload);if(!edgeSeen.run(key).changes)return;edgeCount++;hash.update(payload+'\n');if(oldEdge.get(key))return;const target=String(e.target||'').toLowerCase(),user=String(e.user||'').toLowerCase();addEdge.run(key,e.db||'',target,target.split('.').at(-1),user,user.split('.').at(-1),e.userKind||'',e.role||'',payload,id);changed++;}
 const summaryStmt=db.prepare('SELECT user,userKind,group_concat(DISTINCT role) AS roles FROM edges WHERE target=? AND db=? AND start<=? AND (stop IS NULL OR stop>?) GROUP BY user,userKind ORDER BY min(id) LIMIT 9');
 function summary(key){const at=key.indexOf('|'),rows=summaryStmt.all(key.slice(at+1),key.slice(0,at),id,id);const labels={service:'svc',function:'fn',procedure:'proc',table:'fk'};return rows.slice(0,8).map(r=>`${labels[r.userKind]||r.userKind} ${r.user}(${r.roles})`).join('; ')+(rows.length>8?'; +more':'');}
 function finishEdges(){changed+=Number(db.prepare('UPDATE edges SET stop=? WHERE stop IS NULL AND key NOT IN (SELECT key FROM edge_seen)').run(id).changes);}
 function commit(){check();life.to('flushing');changed+=Number(db.prepare('UPDATE objects SET stop=? WHERE stop IS NULL AND key NOT IN (SELECT key FROM seen)').run(id).changes);const revision=digest(env+'\n'+id+'\n'+hash.digest('hex'));if(changed||!previous)db.prepare('INSERT INTO generations(id,revision,signature,at,count,edges) VALUES (?,?,?,?,?,?)').run(id,revision,signature,new Date().toISOString(),count,edgeCount);db.prepare("INSERT OR REPLACE INTO meta VALUES ('checked_signature',?)").run(signature);if(usageStamp)db.prepare("INSERT OR REPLACE INTO meta VALUES ('usage_stamp',?)").run(usageStamp);life.to('synced');db.exec('COMMIT');life.to('published');closed=true;db.close();return {generation:changed||!previous?revision:previous.revision,objects:count,edges:edgeCount,changed,reused:!changed&&!!previous};}
 function abort(){if(closed)return;try{db.exec('ROLLBACK');}finally{closed=true;db.close();if(!life.terminal)life.to('aborted');}}
 return {line,edge,summary,finishEdges,commit,abort};
}
function terms(q){if(typeof q!=='string'||Buffer.byteLength(q)>8192)throw fail('Catalog query must be at most 8 KiB','DT_ARGUMENT_INVALID');let kind=null;const words=q.toLowerCase().split(/\s+/).filter(Boolean).filter(w=>{const m=w.match(/^(pg|pgfn|es|kafka|consul|svc|api|site|repo|docs):$/);if(m)kind=m[1];return !m;});return {words,kind};}
function page(env,q='',options={}){
 if(!available())return null;const db=open(env);if(!db)return null;
 try{
  const limit=Math.max(1,Math.min(500,Number(options.limit)||50)),queryHash=digest(JSON.stringify([env,q,options.object||'',options.direction||'users']));
  let cursor=null;if(options.cursor){try{if(options.cursor.length>2048)throw Error();cursor=JSON.parse(Buffer.from(options.cursor,'base64url'));if(cursor.query!==queryHash||!Number.isSafeInteger(cursor.id)||![0,1].includes(cursor.rank))throw Error();}catch{throw fail('Cursor does not belong to this search','DT_ARGUMENT_INVALID');}}
  if(cursor&&options.generation&&cursor.generation!==options.generation)throw fail('Cursor and generation differ');
  const g=generation(db,options.generation||cursor?.generation);if(!g)return null;
  const result=[],visible='o.start<=? AND (o.stop IS NULL OR o.stop>?)';let more=false,bytes=0,last=cursor;
  const push=(row,rank)=>{const value=options.object?JSON.parse(row.payload):{line:row.line};const size=Buffer.byteLength(JSON.stringify(value));if(size>2*1024*1024)throw fail('Catalog record exceeds the result budget; inspect its source directly','DT_RESULT_TOO_LARGE');if(result.length>=limit||bytes+size>2*1024*1024){more=true;return false;}result.push(value);bytes+=size;last={generation:g.revision,query:queryHash,rank,id:row.id};return true;};
  if(options.object){
   if(typeof options.object!=='string'||options.object.length>1000)throw fail('Invalid usage object');const parts=options.object.toLowerCase().split(':'),name=parts.at(-1),database=parts.length>1?parts[0]:null,side=options.direction==='uses'?'user':'target',column=name.includes('.')?side:'base_'+side;
   const sql=`SELECT o.id,o.payload FROM edges o WHERE ${visible} AND o.${column}=? ${database?'AND o.db=?':''} AND o.id>? ORDER BY o.id LIMIT ?`;
   for(const row of db.prepare(sql).iterate(g.id,g.id,name,...(database?[database]:[]),cursor?.id||0,limit+1))if(!push(row,0))break;
  }else{
   const {words,kind}=terms(q),fts=words.filter(w=>[...w].length>=3).map(w=>'"'+w.replaceAll('"','""')+'"').join(' AND ');
   const exact=words.map(()=>"instr(o.text,?)>0").join(' AND ')||'1',main=words.map(()=>"instr(o.main,?)>0").join(' AND ')||'1';
   for(let rank=cursor?.rank||0;rank<2&&!more;rank++){
    const sql=`SELECT o.id,o.line FROM ${fts?'search JOIN objects o ON o.id=search.rowid':'objects o'} WHERE ${fts?'search MATCH ? AND ':''}${visible} ${kind?'AND o.kind=?':''} AND ${exact} AND ${rank?'NOT ':''}(${main}) AND o.id>? ORDER BY o.id LIMIT ?`;
    const args=[...(fts?[fts]:[]),g.id,g.id,...(kind?[kind]:[]),...words,...words,cursor?.rank===rank?cursor.id:0,limit-result.length+1];
    for(const row of db.prepare(sql).iterate(...args))if(!push(row,rank))break;
   }
  }
  return {protocol:'dt.catalog-page/v1',env,generation:g.revision,at:g.at,results:result,nextCursor:more&&last?Buffer.from(JSON.stringify(last)).toString('base64url'):null,complete:!more,query:q,objects:g.count,usageEdges:g.edges};
 }finally{db.close();}
}
function manage(env,{action='list',generation:revision,reference,_heartbeat}={}){
 if(action==='release_ref')return require('./catalog-references').release(env,revision,reference);
 if(action==='references'){require('./access').requireAdmin();return require('./catalog-references').list(env,revision).filter(r=>r.scope===require('./access').owner().scopeKey);}
 if(action==='gc')return require('./catalog-references').locked(env,(dir,heartbeat)=>manage(env,{action:'collect',generation:revision,_heartbeat:heartbeat}));
 if(!available())throw fail('Catalog generations require node:sqlite');
 require('./access').requireAdmin();const db=open(env,{create:true});try{if(action==='list')return db.prepare('SELECT * FROM generations ORDER BY id DESC LIMIT 1000').all();const g=generation(db,revision);if(!g)throw fail('No catalog generation');if(action==='pin'||action==='unpin'){db.prepare('UPDATE generations SET pinned=? WHERE id=?').run(action==='pin'?1:0,g.id);return {generation:g.revision,pinned:action==='pin'};}if(action!=='collect')throw fail('Unknown retention action');
 db.exec('BEGIN IMMEDIATE');try{const current=generation(db);if(g.id===current.id||g.pinned||require('./catalog-references').list(env,g.revision).length)throw fail('Current, pinned or referenced generations cannot be collected');db.prepare('DELETE FROM generations WHERE id=?').run(g.id);
 const dead=db.prepare('SELECT o.id,o.text FROM objects o WHERE o.stop IS NOT NULL AND NOT EXISTS (SELECT 1 FROM generations g WHERE o.start<=g.id AND o.stop>g.id)');const remove=db.prepare('DELETE FROM objects WHERE id=?'),fts=db.prepare("INSERT INTO search(search,rowid,text) VALUES ('delete',?,?)");let removed=0;for(const row of dead.iterate()){fts.run(row.id,row.text);remove.run(row.id);if(++removed%1000===0&&typeof _heartbeat==='function')_heartbeat();}db.exec('DELETE FROM edges WHERE stop IS NOT NULL AND NOT EXISTS (SELECT 1 FROM generations g WHERE edges.start<=g.id AND edges.stop>g.id)');db.exec('COMMIT');return {collected:g.revision};}catch(e){db.exec('ROLLBACK');throw e;}
 }finally{db.close();}
}
function matchesUsage(env,stamp){if(!available())return false;const db=open(env);if(!db)return false;try{return db.prepare("SELECT value FROM meta WHERE key='usage_stamp'").get()?.value===stamp;}finally{db.close();}}
module.exports={matchesUsage,available,filename,writer,page,status,unchanged,manage,terms};
