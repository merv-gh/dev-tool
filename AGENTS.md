# dev-tool — notes for agents

Read-only access to a microservice environment (Postgres, Elasticsearch, Kafka, Consul, ELK, Bitbucket).
Everything prints JSON to stdout; logs go to stderr. Default env is the first one configured; pass `--env <name>`.

## Look before you query
Search the cached index first. It's cheap and needs no network:

    node cli.js find order_id                 # every table/function/index/topic mentioning it
    node cli.js find pg: orders               # only Postgres tables
    node cli.js find pgfn: total              # only Postgres functions (with arguments)
    node cli.js find pg: order-service        # tables a service touches (from its passport)
    node cli.js usage sales.orders --pretty   # who reads/writes it: services (file:line), functions, triggers, views, FKs
    node cli.js usage sales.close_order --uses
    node cli.js describe sales.order_total    # definition + usages

Catalog line formats (`cache/<env>/catalog.txt`):

    pg <db> <schema>.<table> [kind] ~<est rows>: col type, ... | used by: svc a(read,write); fn s.f(write); view s.v(selects)  # note
    pgfn <db> <schema>.<fn>(<arguments>) -> <returns> [function|procedure lang] | used by: ...
    es <index> [aliases] <docs>: field type, ...
    kafka <topic> <messages> schema:<type>v<n>: field.path, ...
    consul <service> <passing>/<total>: host:port, ...
    svc <service> <PROJECT/repo>@<sha>: consumes ...; produces ...; tables ...; calls ...; endpoints N

Details per object: `cache/<env>/pg/<db>.json` (tables, functions with bodies, view deps, triggers),
`pg/_usage.json` (usage edges), `es/<index>.json`, `kafka/<topic>.json`, `consul.json`, `passports/<service>/passport.json`.

## Live queries
    node cli.js pg "select * from sales.orders where id = 42" --pretty
    node cli.js es orders-v2 "status==open" --size 5
    node cli.js kafka order_created --n 5
    node cli.js tool health '{"only_unhealthy":true}'       # every Consul service in one call
Postgres sessions are read-only with a 60s timeout; the db is picked from the schema in the SQL (or `--db`).
Live calls are rate limited to 1/s per system+env (`DT_RATE_PER_SEC`).

## Refresh
    node cli.js sync                       # all sources of the env, then the index
    node cli.js sync pg --only orders      # one database
    node cli.js sync passports --only order-service
    node cli.js sync index                 # rebuild catalog + usage index from the cache only
Or use http://127.0.0.1:4000/admin.

## Code map
- `lib/tools.js`: the tool registry, shared by MCP, OpenAPI, `/api/tool` and the CLI. Plugins come from `plugins/*.js`.
- `lib/indexer.js`: every refresh, run as a job (`lib/jobs.js`).
- `lib/pgindex.js`: the usage index.
- `lib/passport/`: static analysis of repos.
- `server.js`: HTTP routes and auth.
- `web/`: pages (admin, view, dash, logs, pr, passport).
- `npm test` runs the tests. Use `DT_TEST_PG_URL` for the live Postgres test.
