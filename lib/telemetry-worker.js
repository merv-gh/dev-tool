// Diagnostic storage is separate from operational history. Never instrument this worker.
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(workerData.file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=2000;
  CREATE TABLE IF NOT EXISTS spans (seq INTEGER PRIMARY KEY, scope_key TEXT NOT NULL, trace_id TEXT NOT NULL, span_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(trace_id,span_id));
  CREATE INDEX IF NOT EXISTS spans_scope ON spans(scope_key,seq);
  CREATE INDEX IF NOT EXISTS spans_trace ON spans(scope_key,trace_id,seq);`);
const insert = db.prepare('INSERT INTO spans(scope_key,trace_id,span_id,payload) VALUES(?,?,?,?) ON CONFLICT(trace_id,span_id) DO UPDATE SET payload=excluded.payload WHERE spans.scope_key=excluded.scope_key');
parentPort.on('message', ({ id, op, rows, scope, traceId, limit }) => {
  try {
    let result;
    if (op === 'write') {
      db.exec('BEGIN');
      try {
        for (const row of rows) insert.run(row.scope, row.traceId, row.spanId, JSON.stringify(row));
        db.exec(`DELETE FROM spans WHERE seq IN (SELECT seq FROM spans ORDER BY seq DESC LIMIT -1 OFFSET ${workerData.maxRows})`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (op === 'read') {
      result = (traceId ? db.prepare('SELECT payload FROM spans WHERE scope_key=? AND trace_id=? ORDER BY seq DESC LIMIT ?').all(scope, traceId, limit)
        : db.prepare('SELECT payload FROM spans WHERE scope_key=? ORDER BY seq DESC LIMIT ?').all(scope, limit)).reverse().map(r => JSON.parse(r.payload));
    } else if (op === 'close') { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); }
    else throw Error('Unknown diagnostic operation');
    parentPort.postMessage({ id, result });
  } catch { parentPort.postMessage({ id, error: 'Diagnostic storage operation failed' }); }
});
parentPort.postMessage({ ready: true });
