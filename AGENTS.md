# dev-tool — notes for agents

Read-only access to a microservice environment (Postgres, Elasticsearch, Kafka, Consul, ELK, Bitbucket).
Everything prints JSON to stdout; logs go to stderr. Default env is the first one configured; pass `--env <name>`.
Config lives in one folder (`DT_HOME`, default this repo): `config.json` (structure, `${VAR}` references) + `.env` (values).

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
    api <service|site|host> <METHOD> <path>?<query keys> [code | seen N 200×n] <host> -> <handler>
    site <site>[.<link>] <url with <params>>  # description

Details per object: `cache/<env>/pg/<db>.json` (tables, functions with bodies, view deps, triggers),
`pg/_usage.json` (usage edges), `es/<index>.json`, `kafka/<topic>.json`, `consul.json`, `passports/<service>/passport.json`,
`cache/routes.json` (API routes seen in the browser), `scripts/<collection>/<name>.json` (saved scripts).

## Scripts and routes
    node cli.js tool script_list '{}'
    node cli.js tool script_run '{"id":"shop/order-check","params":{"orderId":42}}'
    node cli.js tool routes_discover '{"site":"shop","link":"order","params":{"orderId":1042}}'
    node cli.js tool api_routes '{"q":"orders"}'
    node cli.js tool partner '{"script":"send order","params":{"customerId":"C-42"}}'   # a collection exposed as a tool
    node cli.js tool call_patterns '{}'
Browser steps need the Playwright MCP (`DT_BROWSER_MCP`, set by compose). `test/sftp-server.js` is an in-process SFTP server for tests.

## Live queries
    node cli.js pg "select * from sales.orders where id = 42" --pretty
    node cli.js es orders-v2 "status==open" --size 5
    node cli.js kafka order_created --n 5
    node cli.js tool health '{"only_unhealthy":true}'       # every Consul service in one call
Postgres statements are read-only with a 60s timeout (indexing: 2 min; `timeouts` in config.json); the db is picked from the schema in the SQL (or `--db`).
Live calls are rate limited to 1/s per system+env (`DT_RATE_PER_SEC`).

## Refresh
    node cli.js sync                       # all sources of the env, then the index
    node cli.js sync pg --only orders      # one database
    node cli.js sync passports --only order-service
    node cli.js sync index                 # rebuild catalog + usage index from the cache only
Or use http://127.0.0.1:4000/admin.

## Code map
- `lib/config.js`: config.json + .env (and the older layout); `lib/migrate.js` converts the old one.
- `lib/tools.js`: the tool registry, shared by MCP, OpenAPI, `/api/tool` and the CLI. It also builds custom sql/http tools from `tools.custom` and loads plugins from `plugins/*.js` and `tools.plugins` (paths, URLs, github:). It rebuilds itself when config.json changes.
- `lib/indexer.js`: every refresh, run as a job (`lib/jobs.js`).
- `lib/pgindex.js`: the usage index.
- `lib/passport/`: static analysis of repos.
- `lib/scripts.js`, `lib/browser-mcp.js`, `lib/routes.js`: saved scripts (fuzzy names, scripts/collections as tools, set/transform/http steps), dt's Playwright MCP client, API routes (code + wire).
- `lib/views.js`, `web/views/`: views (built-in `*.html`, `_helpers.js` = `dt`, `_views.css`), rendered sandboxed at `/show/<id>`; custom ones in `views/` of the config folder. `lib/diff.js`: diffLists/diffLines, shared with views and the JS sandbox. `web/files.html`: the file browser (`/files/<id>`).
- `lib/js.js`: the JS sandbox for js steps, hooks and the `code` tool (node --permission child process, empty env); code calls dt tools over its stdin/stdout (Session onTool).
- `lib/codeindex.js` (trigram index + grep), `lib/codegraph.js` (Java/Kotlin symbol graph, passport findings attached to methods), `lib/impact.js` (impact radius over code graphs + pg usage + passports), `lib/ddl.js` (DDL snapshots from the catalog), `lib/workspace.js` (writable checkouts, patches), `lib/testgen.js` (test context, skeletons), `lib/testrun.js` (Maven/Gradle runs, JUnit XML, code parts, run history and red-green proof), `lib/fastrun.js` (fast runs: one Maven prepare, then javac of what changed and dt's JUnit launcher), `lib/testout.js` (compact stacks, logs, expected/actual), `lib/buildenv.js` (gradle.properties and tests.env for builds, masked), `lib/showcase.js` + `web/showcase.html` (everything about one service on one page; `sh demo/showcase.sh`, `test/showcase.live.test.js`), `lib/testdb.js` (throwaway test databases); their tools are in `lib/tools-code.js`. `lib/bbindex.js`: every Bitbucket repo's folders and modules (library lookup); `lib/flows.js`: entry points with their chain through service and libraries, outputs, beans and mocks (passport flows, flow tests). Tests against a fake Bitbucket: `test/fake-bitbucket.js`, `test/flows.test.js`; with Maven: `test/flows.live.test.js`. Stress test: `test/stress/code-and-db.js`.
- `lib/files.js`: file stores (local, SFTP via ssh2); `lib/calls.js`: the call log (`cache/_calls.jsonl`) and repeated-work patterns.
- `server.js`: HTTP routes and auth.
- `web/`: pages (admin, view, dash, logs, pr, passport).
- `demo/`: a fake environment plus the screenshot scripts.
- `build.js` -> `dist/` (bundled dt.js + web pages), which docker compose runs. Run `npm run build` after changing sources; `test/dist.test.js` fails while dist/ is stale.
- `npm test` runs the tests. Use `DT_TEST_PG_URL` for the live Postgres test.
