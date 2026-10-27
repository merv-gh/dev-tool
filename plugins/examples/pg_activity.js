// Example plugin: copy to plugins/ to enable. See plugins/README.md.
module.exports = [{
  name: 'pg_activity',
  group: 'pg',
  description: 'Live: running (non-idle) queries of one Postgres database, longest running first.',
  input: {
    db: { type: 'string', description: 'Database name (as in find / pg_table results)' },
    env: { type: 'string', description: 'Environment' },
  },
  required: ['db'],
  limit: (a) => `pg:${a.env || ''}`,
  async run(a, ctx) {
    const r = await ctx.pg().query(a.env, `select pid, usename, application_name, state, now() - query_start as running, left(query, 300) as query
      from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid() order by query_start`, { db: a.db });
    return ctx.tabular('pg', r.rows, { env: a.env, db: a.db, query: 'running queries (pg_stat_activity)' });
  },
}];
