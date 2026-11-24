// Immutable source segments and atomic generations. Serving reads never parse source.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const invalid = message => Object.assign(Error(message), { code: 'DT_LINEAGE_INDEX', statusCode: 409 });
function filename(env) {
  require('./access').checkEnv(env);
  if (!/^[\w-]+$/.test(env || '')) throw invalid('Invalid environment');
  const owner=require('./access').owner(),cache=require('./util').CACHE;
  // Reuse immutable public source segments between one principal's chats. Rules,
  // selected generations, workspaces and jobs retain their story boundaries.
  const root=owner.scopeKey==='legacy'?cache:path.join(cache,'_data-principals',hash(owner.principalId).slice(0,32));
  return path.join(root, env, 'data-lineage.sqlite');
}
function open(env, create = false) {
  const file = filename(env);
  if (!create && !fs.existsSync(file)) return null;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { throw invalid('Data indexing requires a Node runtime with node:sqlite (Node 22.13+ or Node 24).'); }
  if (create) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { readOnly: !create, timeout: 2000 });
  try {
    db.exec('PRAGMA cache_size=-4096; PRAGMA temp_store=FILE; PRAGMA busy_timeout=2000;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw invalid('Data index schema is newer than this build');
    if(!create&&!version){db.close();return null;}
    if (create) db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY, kind TEXT, source TEXT, at TEXT, stats TEXT);
      CREATE TABLE IF NOT EXISTS nodes(segment TEXT, id TEXT, kind TEXT, name TEXT, object TEXT, db TEXT, repo TEXT, service TEXT, symbol TEXT, legacy TEXT, parent TEXT, leaf TEXT, payload TEXT, PRIMARY KEY(segment,id));
      CREATE INDEX IF NOT EXISTS node_id ON nodes(id,segment);
      CREATE INDEX IF NOT EXISTS node_symbol ON nodes(legacy,segment);
      CREATE INDEX IF NOT EXISTS node_exact ON nodes(symbol,segment);
      CREATE INDEX IF NOT EXISTS node_parent ON nodes(parent,segment);
      CREATE INDEX IF NOT EXISTS node_leaf ON nodes(kind,leaf,db,segment);
      CREATE INDEX IF NOT EXISTS node_object ON nodes(kind,object,db,segment);
      CREATE TABLE IF NOT EXISTS edges(id INTEGER PRIMARY KEY, segment TEXT, key TEXT, src TEXT, dst TEXT, relation TEXT, access TEXT, proof TEXT, payload TEXT, UNIQUE(segment,key));
      CREATE INDEX IF NOT EXISTS edge_src ON edges(src,segment);
      CREATE INDEX IF NOT EXISTS edge_dst ON edges(dst,segment);
      CREATE TABLE IF NOT EXISTS raw_edges(segment TEXT, payload TEXT);
      CREATE INDEX IF NOT EXISTS raw_segment ON raw_edges(segment);
      CREATE TABLE IF NOT EXISTS gaps(segment TEXT, payload TEXT);
      CREATE INDEX IF NOT EXISTS gap_segment ON gaps(segment);
      CREATE TABLE IF NOT EXISTS mentions(id INTEGER PRIMARY KEY,segment TEXT,node TEXT,file TEXT,line INTEGER,raw TEXT,folded TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS mention_search USING fts5(folded,content='mentions',content_rowid='id',tokenize='trigram');
      CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,selection TEXT,signature TEXT,at TEXT,stats TEXT);
      CREATE INDEX IF NOT EXISTS generation_selection ON generations(selection,at);
      CREATE TABLE IF NOT EXISTS generation_segments(generation TEXT,segment TEXT,PRIMARY KEY(generation,segment));
      CREATE TABLE IF NOT EXISTS index_rules(id TEXT PRIMARY KEY,payload TEXT);
      PRAGMA user_version=1;`);
    return db;
  } catch (e) { db.close(); throw e; }
}
function writer(db, segment) {
  const node = db.prepare('INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const edge = db.prepare('INSERT OR IGNORE INTO edges(segment,key,src,dst,relation,access,proof,payload) VALUES (?,?,?,?,?,?,?,?)');
  const raw = db.prepare('INSERT INTO raw_edges VALUES (?,?)'), gap = db.prepare('INSERT INTO gaps VALUES (?,?)');
  const mention = db.prepare('INSERT INTO mentions(segment,node,file,line,raw,folded) VALUES (?,?,?,?,?,?)');
  const fts = db.prepare('INSERT INTO mention_search(rowid,folded) VALUES (?,?)');
  let nodes = 0, edges = 0, mentions = 0, gaps = 0;
  return {
    node(n) { node.run(segment,n.id,n.kind,n.name || n.id,n.object || '',n.db || '',n.repo || '',n.service || '',n.symbol || '',n.legacy || n.symbol || '',n.table || n.classSymbol || '',String(n.object || n.name || '').split('.').at(-1),JSON.stringify(n)); nodes++; return n.id; },
    edge(e) { if (e.src === e.dst && e.relation !== 'calls') return; edges += Number(edge.run(segment,hash(e),e.src,e.dst,e.relation,e.access || '',e.proof || 'static',JSON.stringify(e)).changes); },
    raw(e) { raw.run(segment,JSON.stringify(e)); },
    gap(g) { if (gaps++ < 10000) gap.run(segment,JSON.stringify(g)); },
    mention(n,file,line,text) { text = text.slice(0,2048); const folded = fold(text); if (folded.length < 3) return; const r = mention.run(segment,n,file,line,text,folded); fts.run(r.lastInsertRowid,folded); mentions++; },
    stats() { return { nodes,edges,mentions,gaps }; }
  };
}
function fold(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''); }
function activate(db, generation) {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS active_segments(id TEXT PRIMARY KEY) WITHOUT ROWID; DELETE FROM active_segments;');
  db.prepare('INSERT INTO active_segments SELECT segment FROM generation_segments WHERE generation=?').run(generation);
}
function latest(db, selection, id) {
  const row = id ? db.prepare('SELECT * FROM generations WHERE id=? AND selection=?').get(id,selection) : db.prepare('SELECT * FROM generations WHERE selection=? ORDER BY at DESC,rowid DESC LIMIT 1').get(selection);
  if (id && !row) throw invalid('Retained data index generation is unavailable in this scope');
  return row ? { ...row, stats: JSON.parse(row.stats) } : null;
}
function getNode(db, id) { const row = db.prepare('SELECT n.payload FROM nodes n JOIN active_segments a ON a.id=n.segment WHERE n.id=? LIMIT 1').get(id); return row ? JSON.parse(row.payload) : null; }
function adjacent(db,id,reverse=false,limit=200) {
  return db.prepare(`SELECT e.id,e.payload FROM edges e JOIN active_segments a ON a.id=e.segment WHERE e.${reverse?'dst':'src'}=? ORDER BY e.id LIMIT ?`).all(id,limit+1).map(r=>({...JSON.parse(r.payload),edgeId:r.id}));
}
module.exports = { open,filename,writer,hash,fold,invalid,activate,latest,getNode,adjacent };
