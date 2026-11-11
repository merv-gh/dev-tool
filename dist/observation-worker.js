// Bounded, content-free request journal. Queries run off the tool event loop.
const {parentPort,workerData}=require('node:worker_threads');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(workerData.file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=2000;
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,scope TEXT NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,purpose TEXT NOT NULL,state TEXT NOT NULL,status INTEGER,ms REAL,application TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_scope_time ON events(scope,at DESC,seq DESC);
 CREATE INDEX IF NOT EXISTS events_time ON events(at DESC,seq DESC);
 CREATE INDEX IF NOT EXISTS events_kind_time ON events(kind,at DESC);
 CREATE INDEX IF NOT EXISTS events_state_time ON events(state,at DESC);`);
const insert=db.prepare(`INSERT INTO events(id,scope,at,kind,name,purpose,state,status,ms,application,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,status=excluded.status,ms=excluded.ms,application=excluded.application,payload=excluded.payload WHERE events.scope=excluded.scope AND events.at=excluded.at`);
function where(scope,q){
 const parts=['at>=?','at<=?'],params=[q.from,q.to];
 if(scope){parts.push('scope=?');params.push(scope);}
 for(const key of ['kind','name','purpose'])if(q[key]){parts.push(key+'=?');params.push(q[key]);}
 if(q.outcome==='capacity')parts.push('status IN (429,503,529)');
 else if(q.outcome==='failed')parts.push("(state='error' OR application='failed')");
 else if(q.outcome==='open')parts.push("state='running'");
 else if(q.outcome){parts.push('state=?');params.push(q.outcome);}
 if(q.httpStatus){parts.push('status=?');params.push(q.httpStatus);}
 if(q.minMs){parts.push('ms>=?');params.push(q.minMs);}
 for(const term of q.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,8)){parts.push('instr(lower(payload),?)>0');params.push(term);}
 return {sql:parts.join(' AND '),params};
}
function query(scope,q){
 const {sql,params}=where(scope,q),all=db.prepare(`SELECT COUNT(*) total,SUM(kind='tool') tools,SUM(json_extract(payload,'$.wrapper')=1) dispatchers,SUM(kind='model') models,SUM(state='error' OR application='failed') failed,SUM(state='error') errors,SUM(state='cancelled') cancelled,SUM(state='running') open,SUM(application='failed') applicationFailed,SUM(status IN (429,503,529)) capacityResponses,AVG(ms) avgMs,MAX(ms) maxMs,SUM(json_extract(payload,'$.inputTokens')) inputTokens,SUM(json_extract(payload,'$.outputTokens')) outputTokens,SUM(kind='model' AND json_extract(payload,'$.usageKnown')=1) usageReported,MAX(json_extract(payload,'$.inFlightAtStart')) peakObservedConcurrency FROM events WHERE ${sql}`).get(...params);
 const latency=db.prepare(`WITH ordered AS (SELECT ms,ROW_NUMBER() OVER(ORDER BY ms) rn,COUNT(*) OVER() n FROM events WHERE ${sql} AND ms IS NOT NULL) SELECT MAX(CASE WHEN rn=(n*50+99)/100 THEN ms END) p50Ms,MAX(CASE WHEN rn=(n*95+99)/100 THEN ms END) p95Ms FROM ordered`).get(...params);
 const bucket=Math.max(1,Math.ceil((q.to-q.from+1)/24));
 const timeline=db.prepare(`SELECT CAST((at-?)/? AS INTEGER) bucket,COUNT(*) total,SUM(kind='model') models,SUM(state='error' OR application='failed') failed FROM events WHERE ${sql} GROUP BY bucket ORDER BY bucket`).all(q.from,bucket,...params);
 const groups=db.prepare(`SELECT kind,name,purpose,COUNT(*) total,SUM(state='error' OR application='failed') failed,AVG(ms) avgMs,MAX(ms) maxMs FROM events WHERE ${sql} GROUP BY kind,name,purpose ORDER BY total DESC,kind,name LIMIT 30`).all(...params);
 const cursor=q.cursor?' AND seq<?':'',values=q.cursor?[...params,q.cursor]:params;
 const rows=db.prepare(`SELECT seq,payload FROM events WHERE ${sql}${cursor} ORDER BY seq DESC LIMIT ?`).all(...values,q.limit+1),more=rows.length>q.limit,records=rows.slice(0,q.limit).map(r=>({...JSON.parse(r.payload),sequence:r.seq}));
 return {records,nextCursor:more?String(rows[q.limit-1].seq):null,summary:{...all,...latency},timeline:{from:q.from,to:q.to,bucketMs:bucket,points:timeline},groups};
}
parentPort.on('message',({id,op,rows,scope,query:q,eventId})=>{try{let result;
 if(op==='write'){
  db.exec('BEGIN');try{for(const r of rows)insert.run(r.id,r.scope,r.startedAt,r.kind,r.name,r.purpose,r.state,r.httpStatus??null,r.durationMs??null,r.application??null,JSON.stringify(r));
   db.prepare('DELETE FROM events WHERE at<?').run(Date.now()-7*86400000);
   db.exec(`DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq DESC LIMIT -1 OFFSET ${workerData.maxRows})`);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }else if(op==='query')result=query(scope,q);
 else if(op==='event'){const r=(scope?db.prepare('SELECT payload FROM events WHERE id=? AND scope=?').get(eventId,scope):db.prepare('SELECT payload FROM events WHERE id=?').get(eventId));result=r?JSON.parse(r.payload):null;}
 else if(op==='close'){db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();}
 else throw Error('Unknown request journal operation');
 parentPort.postMessage({id,result});
 }catch{parentPort.postMessage({id,error:'Request journal operation failed'});}});
parentPort.postMessage({ready:true});
