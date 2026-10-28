// Versioned read-side adapter: one stable read-only PostgreSQL snapshot per source database.
// Transactions overlap, but are not a distributed snapshot or a consistency guarantee between systems.
const crypto = require('crypto');
const digest = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function snapshots(env, names, { signal } = {}) {
  const cfg = require('./config').getEnv(env), readers = new Map(), pending = [];
  try {
    for (const db of [...new Set(names)].sort()) {
      signal?.throwIfAborted();
      if (!cfg.pg[db]) throw new Error(`No configured source database ${db}`);
      let release, ready, failed;
      const hold = new Promise(resolve => { release = resolve; });
      const opened = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
      const connection=require('postgres')(cfg.pg[db],{max:1,idle_timeout:0,connect_timeout:10,onnotice:()=>{},connection:{application_name:'dev-tool fixture snapshot',default_transaction_read_only:'on'}});
      const transaction = connection.begin('isolation level repeatable read read only', async sql => {
        await sql.unsafe(`set local statement_timeout = ${Math.max(1000, require('./config').getTimeouts().pgQueryMs)}`);
        const [identity] = await sql`select txid_current_snapshot()::text as snapshot, current_database() as database, transaction_timestamp()::text as started_at, current_setting('transaction_read_only') as read_only`;
        const evidence = { version: 1, adapter: 'postgres-snapshot/v1', database: db, sourceDatabase: identity.database, snapshot: identity.snapshot, isolation: 'repeatable read', readOnly: identity.read_only === 'on', startedAt: identity.started_at };
        readers.set(db, { sql, evidence }); ready();
        await hold; evidence.finishedAt = new Date().toISOString();
      }).finally(()=>connection.end({timeout:2}));
      transaction.catch(failed);
      pending.push({ transaction, release });
      await opened;
    }
    return { version: 1, adapter: 'postgres-snapshot/v1',
      query: async (db, sql, params) => { signal?.throwIfAborted(); const reader = readers.get(db); if (!reader) throw new Error(`snapshot database ${db} was not planned`); const query = reader.sql.unsafe(sql, params || []), cancel=()=>query.cancel(); signal?.addEventListener('abort',cancel,{once:true}); try { return [...await query]; } finally { signal?.removeEventListener('abort',cancel); } },
      evidence: () => Object.fromEntries([...readers].map(([db, reader]) => [db, { ...reader.evidence, identity: digest(reader.evidence) }])),
      close: async () => { pending.forEach(p => p.release()); await Promise.all(pending.map(p => p.transaction)); }
    };
  } catch (error) { pending.forEach(p => p.release()); await Promise.allSettled(pending.map(p => p.transaction)); throw error; }
}
module.exports = { snapshots };
