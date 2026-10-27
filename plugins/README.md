# Plugins

Every `plugins/*.js` file in the config folder adds tools, and so does every entry in `tools.plugins` in config.json: a path, an https URL, or `github:owner/repo/path.js@ref`, optionally `{ "url": ..., "sha256": ... }` to pin it. They show up in MCP, OpenAPI
(Open WebUI), `/api/tool/<name>` and `node cli.js tool`, exactly like the built-in ones.

```js
// plugins/pg_activity.js
module.exports = [{
  name: 'pg_activity',                         // unique tool name
  group: 'pg',                                 // for DT_TOOLS filtering (default "plugin")
  description: 'Live: running queries of one Postgres database (longest first).',
  input: { db: { type: 'string', description: 'Database name' }, env: { type: 'string', default: 'dev' } },
  required: ['db'],
  limit: (a) => `pg:${a.env}`,                 // optional rate-limit key (1 request/s per key by default)
  async run(a, ctx) {                          // ctx: tabular, clip, getEnv, pg, http, limit
    const r = await ctx.pg().query(a.env, `select pid, now() - query_start as running, state, left(query, 300) as query
      from pg_stat_activity where state <> 'idle' order by query_start`, { db: a.db });
    return ctx.tabular('pg', r.rows, { env: a.env, db: a.db, query: 'pg_stat_activity' });
  },
}];
```

Return plain JSON. `ctx.tabular(kind, rows, meta)` stores the rows and returns a preview plus a
`view` link; in Open WebUI that link is embedded in the chat as a table.

dt picks up changes without a restart: saving config.json, or adding or changing a file in plugins/, rebuilds the tool list. Use **Reload tools** on /admin, or `node cli.js tools-reload --update` to download remote plugins again. A plugin that fails to load is skipped and its error is shown on /admin.

A plugin must be a single file, because remote plugins are downloaded on their own. Plugins run inside dt with its access, so only load code you trust.
`plugins/examples/` has a working copy of the one above: `cp plugins/examples/pg_activity.js plugins/`.
