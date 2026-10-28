# dev-tool (`dt`)

Read-only tools that let an AI agent (or you) investigate a microservice environment without guessing:

- **An index of your databases.** Postgres tables, columns, views, functions and procedures with their arguments, and **who uses what**: which services read or write a table (from their code, with file:line), which functions, triggers and views touch it, and what calls a function. Also Elasticsearch mappings, Kafka topics (schemas and sample messages), and Consul services.
- **Service passports.** Static analysis of a Spring service's repo and its internal libraries: HTTP endpoints, Feign and HTTP calls, Kafka in/out, tables and functions used, datasources, dependencies.
- **Live tools.** Read-only SQL, ES search, the last Kafka messages, health of all services in one call, consumer lag, ELK log search and traces, Bitbucket PRs, Confluence. A headless browser and a code graph are optional.
- **Results you can use.** Tables, dashboards, logs, diffs and passports render as pages; in Open WebUI they appear inside the chat.
- **`/admin`.** Watch what is indexed, refresh all or one source, browse objects and their usages, edit config and notes.

It plugs into **Open WebUI** (bundled, or one you already run) or any **MCP client** (Claude Code, Cursor, ...), and runs as a single Node process with one dependency.

![A question in Open WebUI answered with dt: who writes sales.orders, as an embedded table](docs/screenshots/chat-usage.png)

```
client ──(OpenAPI / MCP)──> dt :4000 ──read-only──> Postgres, Elasticsearch, kafka-ui, Consul, ELK, Bitbucket, Confluence
                              │
                              └── cache/<env>/  (index: catalog.txt, pg/<db>.json, pg/_usage.json, ...)   passports/   repos/
```

## Install

One command clones dt to `~/.dev-tool`, creates a config folder at `~/dt` from the examples, and starts it:

```bash
curl -fsSL https://raw.githubusercontent.com/merv-gh/dev-tool/main/install.sh | sh
```

```bash
curl -fsSL https://raw.githubusercontent.com/merv-gh/dev-tool/main/install.sh | sh -s -- --home ~/work/dt --tools-only
```

| Option | Default | |
| --- | --- | --- |
| `--home DIR` | `~/dt` | config and data: `config.json`, `.env`, `notes.json`, `plugins/`, `scripts/`, `cache/`, `repos/`, `passports/` |
| `--tools-only` | off | only the dt tool server, for an Open WebUI or MCP client you already run |
| `--dir DIR` | `~/.dev-tool` | where the code goes |
| `--ref REF`, `--no-start` | `main` | branch or tag; install without starting |

Run it again to update. The config folder is never overwritten. After the first run, fill in `~/dt/.env` (passwords, tokens) and `~/dt/config.json` (or edit it on `/admin`), then press **Refresh everything** on http://127.0.0.1:4000/admin.

Day to day:
```bash
~/.dev-tool/run.sh --home ~/dt up -d      # start or update (add --tools-only for just dt)
~/.dev-tool/run.sh --home ~/dt logs -f dt
~/.dev-tool/run.sh --home ~/dt down
```

### What runs
Nothing is built: dt runs the bundled `dist/dt.js` (code and its one dependency, checked in) in the stock `node:22-bookworm` image, with `dist/` mounted read-only. Updating is `git pull` plus a restart. Pick another image with `DT_NODE_IMAGE` (it needs `git` for passports).

`COMPOSE_PROFILES` in `.env` picks the optional parts (all three by default; `--tools-only` turns them off):

| Service | Profile | What |
| --- | --- | --- |
| `dt` | always | the tool server: OpenAPI `/openapi.json`, MCP `/mcp`, result pages, `/admin` |
| `webui` + `setup` | `webui` | Open WebUI, with the agent prompt and tools set on every model |
| `browser` | `browser` | Playwright MCP: open pages, click, type, screenshot. Logins come from `browser.sites`. dt also drives it for saved scripts and route discovery |
| `graph` | `graph` | [code-review-graph](https://pypi.org/project/code-review-graph/) over the fetched repos |

### Without Docker
```bash
DT_HOME=~/dt node dist/dt.js sync      # index the first env (Node 22+, nothing to install)
DT_HOME=~/dt node dist/dt.js serve     # http://127.0.0.1:4000 (add --lan to listen on all interfaces)
```
From the sources instead: `npm ci`, then `node cli.js …`. After changing them, `npm run build` rebuilds `dist/` (a test fails while it is stale).

## Plug it in

### Your own Open WebUI
1. Make dt reachable from Open WebUI. If they run on different hosts, set `DT_API_KEY` in `.env`, and set `DT_BIND=0.0.0.0` and `DT_TRUST_NETWORK=0`.
2. Register dt as a tool server: Admin Settings → Tools → add an **OpenAPI** connection at `http://<dt-host>:4000` with path `openapi.json`, bearer auth with the key. Or let dt do it, along with the system prompt and tools for each model:
   ```bash
   node cli.js webui-setup --url https://chat.example.com --key <open-webui-admin-api-key> \
     --dt-url http://<dt-host>:4000 --dt-key <DT_API_KEY> [--model model-a,model-b]
   ```
3. Set `DT_PUBLIC_URL` (or `server.publicUrl`) to the address of dt that users' browsers can reach. Tables and dashboards are embedded from there.

The system prompt is at `GET /api/prompt` ([lib/agent-prompt.md](lib/agent-prompt.md)) if you'd rather paste it yourself.

### MCP clients
```bash
claude mcp add --transport http dt http://127.0.0.1:4000/mcp
```
For other clients, use the Streamable HTTP URL `http://<host>:4000/mcp`, with `Authorization: Bearer <DT_API_KEY>` when a key is set. The server sends the agent prompt as MCP `instructions`.

### Scripts and CI
Call any tool with `POST /api/tool/<name>` (JSON arguments) or `node cli.js tool <name> '<json>'`.

## Configuration

Two files in the config folder:

- **`config.json`**: the structure. It holds environments, integrations, tools and browser sites ([config.example.json](config.example.json)), and is editable on `/admin`. Write `${NAME}` (or `${NAME:-default}`) wherever a value is secret.
- **`.env`**: the values. It holds passwords, tokens and URLs with credentials, plus compose settings ([.env.example](.env.example)).

```json
{
  "envs": {
    "dev": {
      "postgres": { "orders": "${DEV_ORDERS_DB_URL}", "billing": "${DEV_BILLING_DB_URL}" },
      "elasticsearch": { "hosts": ["http://es-dev:9200"], "user": "${DEV_ES_USER}", "password": "${DEV_ES_PASSWORD}" },
      "kafkaUi": "http://kafka-ui-dev:8080", "schemaRegistry": "http://schema-registry-dev:8081", "consul": "http://consul-dev:8500",
      "logs": { "hosts": ["http://elk-dev:9200"], "index": "logs-*", "kibana": "http://kibana-dev:5601" }
    }
  },
  "bitbucket": { "url": "https://bitbucket.example.com", "token": "${BITBUCKET_TOKEN}" },
  "passports": { "internalGroups": ["com.example.libs"] },
  "tools": { "disable": ["confluence"], "plugins": [], "custom": [] },
  "browser": { "sites": { "crm": { "url": "https://crm.dev.example.com/login", "secrets": ["CRM_USER", "CRM_PASSWORD"],
                               "links": { "order": "/orders/<orderId>", "customer": { "path": "/customers/<id>", "description": "profile, orders, tickets" } } } } },
  "server": { "publicUrl": "http://127.0.0.1:4000", "apiKey": "${DT_API_KEY}" }
}
```

Saving `config.json` (on `/admin`, or in an editor) applies it without a restart. Each `logs.fields` entry maps a field name, with ECS names as the defaults.

**Browser logins.** List the secret names under `browser.sites`, with their values in `.env`. dt writes only those names and values to `cache/browser.env`, and only the browser container mounts that file. The model types the name (`CRM_PASSWORD`), Playwright fills in the value, and it shows up as `<secret>CRM_PASSWORD</secret>` in everything returned.

**Site map.** `links` under a site are short direct URLs (relative to the site URL, or absolute), with `<param>` placeholders. The model gets them from `browser_sites` and `find "site:"`, and opens `/orders/<orderId>` straight away instead of clicking through menus; `site_url` fills in the params.

**Coming from the older layout** (`envs.json` + `.env.<env>` + `.env.personal` + `.env.browser`)? It still works. `node cli.js migrate-config` writes `config.json` + `.env` from it, with per-env secrets prefixed (`DEV_DATABASE_URL_ORDERS`) and plain values inlined; check both files, then delete the old ones.

| Variable (environment or `.env`) | Default | |
| --- | --- | --- |
| `DT_HOME` | the repo folder | the config folder (`run.sh --home` sets it) |
| `DT_API_KEY` | unset | If set, required from untrusted clients (`Authorization: Bearer`, or open `/admin?key=` once for a cookie) |
| `DT_TRUST_NETWORK` | `1` in compose | Trust every client that can reach the port. Compose binds it to `DT_BIND` (127.0.0.1) |
| `DT_PUBLIC_URL` | `server.publicUrl` | Base URL of result links and embeds, as the user's browser sees it |
| `DT_TOOLS` | `tools.enable`/`disable` | Override as a list, e.g. `all,-confluence,-browser` |
| `DT_RATE_PER_SEC` | `server.ratePerSec` = 1 | Live requests per second per system and env; `0` turns it off |
| `DT_PG_QUERY_TIMEOUT_MS` | `timeouts.pgQueryMs` = 60000 | Per statement for `pg_query` and SQL tools |
| `DT_PG_INDEX_TIMEOUT_MS` | `timeouts.pgIndexMs` = 120000 | Per catalog query when indexing a database (big databases need minutes) |
| `DT_CATALOG_SYNC_WAIT_MS` | `timeouts.catalogSyncWaitMs` = 50000 | How long `catalog_sync` waits before answering "running" with a job id |
| `DT_BROWSER_MCP` | `browser.mcp` (compose: `http://browser:8931/mcp`) | Playwright MCP that dt drives for scripts and route discovery |
| `COMPOSE_PROFILES`, `DT_BIND`, `DT_PORT`, `WEBUI_PORT`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | | compose settings |

## Add tools at runtime

All of this lives under `tools` in `config.json` and reloads on save (or **Reload tools** on `/admin`), with no restart. Open WebUI picks up new tools the next time it loads the tool list. Definitions that are invalid are shown on `/admin` and skipped, and the other tools keep working.

**From config, no code.**
- An **SQL tool** runs read-only SQL with `:named` parameters bound by the driver.
- An **HTTP tool** calls an API with `{path}` parameters; the remaining parameters become the query string or the JSON body.
- Both return tables (`rows` picks the array inside an HTTP response).

```json
"custom": [
  { "name": "orders_by_status", "type": "sql", "env": "dev", "db": "orders",
    "description": "Latest orders with a given status.",
    "sql": "select id, customer_id, total from sales.orders where status = :status order by created_at desc limit :limit",
    "params": { "status": { "required": true, "enum": ["new", "paid", "shipped"] }, "limit": { "type": "integer", "default": 50 } } },
  { "name": "ci_builds", "type": "http", "description": "Recent CI builds of a service.",
    "url": "https://ci.example.com/api/projects/{service}/builds", "headers": { "authorization": "Bearer ${CI_TOKEN}" },
    "params": { "service": { "required": true }, "branch": {} }, "rows": "builds" }
]
```

**Plugins (JavaScript).** Each plugin is one file exporting tools ([plugins/README.md](plugins/README.md)). They can come from:
- `plugins/*.js` in the config folder, which load automatically;
- a path, a URL, or `github:owner/repo/path.js@ref`, listed in `tools.plugins`.

```json
"plugins": [
  "plugins/pg_activity.js",
  "https://example.com/dt/jira.js",
  { "url": "github:you/dt-plugins/jira.js@v1.2.0", "sha256": "…" }
]
```
Remote plugins are downloaded once into `cache/plugins/`; **Update plugins** on `/admin` downloads them again. A `sha256` pin refuses a file that changed. Plugins run inside dt with its access, so only load code you trust, and pin what you don't control.

## The index

`sync` (or `catalog_sync`, or /admin) reads each source once and caches it in `cache/<env>/`:

- **Postgres, one round trip per query kind per database:**
  - tables, views and materialized views, with columns, constraints (FK targets resolved) and indexes
  - functions and procedures: arguments with name, type and mode, defaults, result, language, volatility, body
  - view dependencies
  - triggers
- **Elasticsearch:** mappings and a few sample documents.
- **Kafka:** topics, Schema Registry schemas and the last messages, with field paths.
- **Consul:** services and their instances.

The **usage index** (`cache/<env>/pg/_usage.json`) is rebuilt after every sync or passport build, with no network. Each edge is "user → role → object", with evidence:

| From | Edges |
| --- | --- |
| database | views → `selects` / `calls`; function bodies → `read` / `write` / `calls`; triggers → `executes` / `trigger`; FKs → `references` |
| code (passports) | services → `read` / `write` / `owner` (migrations) / `entity` / `repository` (JPA) / `calls` (SQL `fn(...)`, `@Procedure`, `SimpleJdbcCall`), with file:line |

Unqualified names resolve the way `search_path` would: the function's own schema, then `public`, then a unique match; anything else is marked `ambiguous`. Code usages only point at the databases a service's datasource connects to. Tables named in code but missing from every synced database are kept, flagged `not_in_db`.

`find` searches `catalog.txt`, one line per object. Postgres lines carry their users, so `find pg: order-service` lists the tables that service touches:

```
pg orders sales.orders ~120000: id bigint, status text, ... | used by: svc order-service(read,write,owner); fn sales.audit(trigger); view sales.open_orders(selects); fk sales.order_items(references)
pgfn orders sales.order_total(p_id bigint, p_tax boolean DEFAULT false) -> numeric [function plpgsql] | used by: svc billing-service(calls); proc sales.close_order(calls)
es orders-v2 [orders] 1200: id keyword, status keyword, ...
kafka order_created 5300 schema:AVROv3: id, status, items[].sku
consul order-service 2/2: 10.0.0.5:8080, 10.0.0.6:8080
svc order-service SHOP/order-service@a1b2c3d4e5: consumes payment_results; produces order_created; tables sales.orders, ...; endpoints 7
```

| Question | Tool |
| --- | --- |
| Exact names, where something lives | `find` |
| Table or view definition, plus who uses it | `pg_table` |
| Function definition (arguments, body), what it touches, what calls it | `pg_function` |
| "Who writes this table?", "what calls this function?", "what does this service touch?" | `pg_usage` (`direction=uses` for the last one) |
| Topics, tables, functions, paths across services and DB objects | `who_uses` |
| A service's full picture | `passport` |

All of this is regex-level analysis of SQL text and code, with evidence for every finding. Dynamic SQL built at runtime is not seen.

## Saved scripts

Repeatable actions, saved as JSON in `scripts/` of the config folder; folders are collections (`scripts/orders/support/refund-check.json` is `orders/support/refund-check`). The agent saves one with `script_save` after doing a task by hand, finds it with `script_list`, and runs it with `script_run`; people organize, edit and run them on `/admin` (**Scripts**).

```json
{
  "description": "Open an order in the back office and check its payment",
  "params": { "orderId": { "required": true }, "env": { "default": "dev" } },
  "steps": [
    { "tool": "pg_query", "args": { "env": "{{env}}", "sql": "select status from sales.orders where id = {{orderId}}" }, "as": "order" },
    { "script": "crm/login" },
    { "open": "crm.order" },
    { "browser": "snapshot", "as": "page" },
    { "browser": "click", "args": { "element": "Payments tab", "ref": "e12" }, "optional": true }
  ]
}
```

A step is one of:

| Step | |
| --- | --- |
| `{"tool": "pg_query", "args": {…}}` | any dt tool |
| `{"script": "crm/login", "params": {…}}` | another script, nested up to 5 deep |
| `{"open": "crm.order"}` | a site link; its `<orderId>` comes from the params |
| `{"browser": "click", "args": {…}}` | any Playwright MCP tool (`click`, `type`, `snapshot`, …) |
| `{"wait": 2}` | seconds, or a text to wait for |
| `{"set": {"folder": "in/{{date:YYYYMMDD}}-{{hex:8}}"}}` | compute values once, use them as `{{folder}}` |
| `{"transform": "{{doc.text}}", "replace": [{"find": "ORD-\\d+", "regex": true, "with": "ORD-{{rand:6}}"}], "json": {"items.*.id": "{{uuid}}"}}` | rewrite a document; each distinct match gets one new value, so an id that appears five times is replaced the same way five times |
| `{"http": "POST https://…/imports", "body": {…}}` | call an API, only under a prefix in `scripts.http.allow` |

`{{name}}` inserts a param or an earlier result (`{{order.rows.0.status}}`), `{{link:crm.order}}` a link URL. Generators: `{{uuid}}`, `{{now}}`, `{{date:YYYYMMDD-HHmmss}}`, `{{rand:6}}` (digits), `{{hex:8}}`. Add `"as": "name"` to keep a result and `"optional": true` to go on after a failure. Browser steps run in dt's own browser session, separate from the chat's.

**JavaScript, Postman/Bruno style.** When the built-in steps are not enough, write a little JS:

| Where | Sees | What it does |
| --- | --- | --- |
| `{"js": "…"}` step | `vars`, `result` (previous step) | anything; its return value is the step's result |
| step `"before"` | `vars`, `args` (the step's input) | change what the step sends (`args.body.requestId = uuid()`), or return new args |
| step `"capture"` | the result | `{"jobId": "json.id", "sku": "json.items[0].sku"}` copies values into `vars` |
| step `"after"` | `vars`, `result` | check it (`test('201', () => expect(result.status).toBe(201))`), keep values, or return a new result |
| script / collection `"vars"`, `"before"`, `"after"` | `vars`, `result` (last step) | defaults and setup for every step; checks at the end. Collections apply to everything below them, outermost first |

Helpers: `uuid()`, `now()`, `date('YYYYMMDD')`, `rand(6)`, `hex(8)`, `log(…)`, `test(name, fn)`, `expect(x).toBe / toEqual / toMatch / toContain / toBeTruthy / toBeGreaterThan / toHaveProperty` (and `.not`), `assert(ok, msg)`. A failing test fails the run; the run shows every test and log line.

```json
{ "http": "POST {{apiBase}}/imports", "body": { "folder": "/upload/{{folder}}" },
  "before": "args.body.lines = JSON.parse(vars.order).items.length;",
  "capture": { "importId": "json.importId" },
  "after": "test('accepted', () => expect(result.status).toBe(202));\nreturn { importId: result.json.importId };" }
```

The code runs in a separate node process with Node's permission model on: no file system, no child processes, an empty environment (no secrets), 128 MB, and 5 seconds per piece (`scripts.jsTimeoutMs`). One process serves one run. Turn it off with `"scripts": { "js": false }`. The agent can try a snippet with `js_run` before saving it. [demo/scripts/partner/send-order-js.json](demo/scripts/partner/send-order-js.json) is the upload example with the document rewritten in JS.

**Calling them.** `script_run` takes the id, the name, or a close name (`"send order"` finds `partner/send-order`; an ambiguous name lists the candidates). `"tool": true` (or a tool name) on a script makes it a tool of its own, with its params as arguments. A collection can be one tool too (⚙ on `/admin`, or `script_collection`): its description lists the scripts with their params, and it runs one by name. Both appear in Open WebUI and MCP clients like any other tool, and update when the scripts change.

**The example, end to end** ([demo/scripts/partner/send-order.json](demo/scripts/partner/send-order.json)): find an order template in a local folder, read it, make a new folder name and order id, rewrite the document (the order id everywhere it appears, a new uuid per line item, the customer from a param, the timestamp), upload it to that folder on SFTP, and POST the folder to the partner's import API. It is one call afterwards: `partner {"script": "send order", "params": {"customerId": "C-42"}}`.

## File stores

Local folders and SFTP servers, under `files` in `config.json`:

```json
"files": {
  "templates": { "type": "local", "path": "files/templates" },
  "partner":   { "type": "sftp", "host": "sftp.dev.example.com", "user": "dt", "password": "${PARTNER_SFTP_PASSWORD}",
                 "root": "/upload", "write": true },
  "archive":   { "type": "sftp", "host": "files.dev.example.com", "user": "dt-reader", "privateKeyFile": "keys/archive_ed25519",
                 "passphrase": "${ARCHIVE_SFTP_KEY_PASSPHRASE:-}", "hostKey": "SHA256:…", "root": "/exports" }
}
```

Tools: `files_stores`, `files_list` (glob, recursive), `files_search` (by name glob and/or text inside, with the matching line), `files_read`, `files_write`, `files_copy` (between stores). Paths are relative to the store root and cannot leave it. Local paths are relative to the config folder (in Docker, `/dt`). SFTP logs in with a `password`, or a key: `privateKeyFile` (a path in the config folder, e.g. `keys/id_ed25519`) or `privateKey` (the key text; `\n` for line breaks), with an optional `passphrase`. `hostKey` (`SHA256:…`, as `ssh-keygen -lf` prints it) pins the server key. [config.example.json](config.example.json) has both kinds.

**Writes are opt-in.** A store is read-only unless it has `"write": true`, and a write never replaces a file unless `overwrite` is set. Script `http` steps only reach URL prefixes listed in `scripts.http.allow`. Everything else in dt stays read-only.

## Code mode

To compute something, the agent can write a little JavaScript instead of making many tool calls: the `code` tool runs it with every dt tool at hand, and the chat shows the code and its output.

```js
const r = await tools.pg_query({ env: 'demo', sql: 'select status, total from sales.orders', all: true });
const by = {};
for (const o of r.rows) (by[o.status] ||= []).push(Number(o.total));
for (const [s, xs] of Object.entries(by)) text(s, xs.length, (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2));
```

- `await tools.<any tool>(args)` (or `tools.call(name, args)`; `await tools.list()` lists them); a failing tool throws, so `try`/`catch` works. `text(...)` prints (objects as pretty JSON); a returned value is shown too. The same helpers as in scripts (`uuid`, `date`, `diffLists`, …).
- It runs in the script sandbox (no files, no network, no secrets), for up to 60 s (`scripts.codeTimeoutMs`). Tool calls go back to dt over the sandbox's pipe and run as normal calls: same rate limits, same read-only rules, logged as source `code`.
- The answer has the output for the model and a `code` view for the user (code, output, the tools it called, links to their views).
- Script `js` steps and hooks can call tools the same way.

## Code: index, impact, tests, patches

Every fetched repo gets a **code index** in `cache/code/<PROJECT>/<repo>/`: passports, `repo_fetch`, `code_index` and workspaces build it with no extra network. It has two parts.

- **Trigram index** (`tri.bin`) over every text file (Java, Kotlin, yml, properties, SQL, XML, …).
  - `code_search` greps all indexed repos at once. It takes text or a regex, and a path glob.
  - The literal parts of the pattern (`jdbc\.update\("update s\d` → `jdbc.update("update s`; `(ledger|coupon)Op1` → `ledgerOp1` or `couponOp1`) pick the files that can match. Only those files are read and matched.
  - It works the way Google's codesearch and zoekt do, and it is built in, so the container needs no ripgrep.
- **Symbol graph** (`graph.json`), regex and brace level like the passport:
  - classes, fields, constructors and methods with line ranges, and Spring roles;
  - injected dependencies, and calls typed through fields, parameters and locals (including `new X(...).m()`);
  - interface-to-implementation dispatch;
  - entity fields mapped to columns (`@Table`, `@Column`, snake case), and the SQL inside methods;
  - plus the passport findings (tables, Kafka topics consumed and produced, endpoints, Feign calls, ES indices, database functions), each attached to the method it is in.

**`impact`** answers "what is affected if this changes". It walks "who uses it" back through:

- the graphs of every indexed repo and workspace;
- the Postgres usage index of an env (functions, views, triggers, FKs);
- the passports of services that are not indexed.

The target can be:

- a method or class (`PaymentService#create`, an FQN, `File.java:42`);
- a table (`pay.payments`);
- a column (`pay.payments.fee`): entity fields mapped to it, getters and setters called on them, SQL naming it, function bodies and views that read the table and mention it, and indexes and constraints on it;
- a database function;
- a topic (`topic:payments.created`): producer, then the consumers in every service;
- an ES index;
- an endpoint (`POST /payments/7/settle`): its handler, plus the Feign clients calling it from other services.

The answer comes in layers by distance, with file:line and the reason for each step. It lists the endpoints, topics, tables and services reached, and the tests that exercise the code (run those). Text mentions in config and SQL files come from the trigram index. The user sees it as the `impact` view.

| Question | Tool |
| --- | --- |
| Which repo and folder holds library X? | `find "repo: X"` (after `catalog_sync what=bitbucket`) |
| What happens when this endpoint/listener/job runs, and what leaves the service? | `passport` (flows) |
| Where is this string, key, SQL, log message? | `code_search` |
| Which class/method is it? | `code_symbols` |
| What breaks if I change it? Which tests cover it? | `impact` |
| Schema for a test database | `ddl_snapshot` |

### Libraries and flows

Internal libraries often live in a repo called `commons` or `starter`, and only the folders inside it carry the real names. Sometimes a folder isn't even named like its artifact: `audit/` builds `acme-audit-core`.

**`catalog_sync what=bitbucket`** indexes every Bitbucket repo once. For each repo it reads:

- the root build files and the first-level folders;
- the Maven `<modules>`, with each module's own `artifactId` (its pom, not a dependency's);
- the Gradle `settings.gradle` includes.

It runs at 8 requests/s (`passports.indexRatePerSec`). Repos indexed in the last 7 days are kept, so later runs only ask Bitbucket for the repo list. The result goes to `cache/bitbucket/_index.json` and to the catalog (`find "repo: acme-audit-core"`).

Passports look libraries up in this order:
1. a mapping, which can name a module (`"acme-audit-core": "LIB/commons/audit"`);
2. the index: a module declaring the artifact, then the repo itself, then a folder with the name (or `<repo>-<folder>`);
3. repos found by searching names, but only as candidates. Each is looked at on Bitbucket (its folders, its root and module poms) and taken only if it declares the artifact or is named like it.

Nothing is fetched on a guess. When no repo declares the artifact, the passport says which repos it looked inside.

For the version, one `git ls-remote` lists the repo's tags and branches. dt fetches the first of `v1.2.0`, `1.2.0`, `<artifact>-1.2.0`, `<repo>-1.2.0`, `release/1.2.0` that exists. A version without a tag, such as a SNAPSHOT or an untagged release, is looked for in the build files at the branch tips:
- files: `gradle.properties`, `build.gradle(.kts)`, `pom.xml`, of the module and the root;
- branch order: default branch, `develop`, `release/*`, then the others, up to 20;
- the branch that declares exactly that version is fetched (`acme-starter-kafka 2.1.0-SNAPSHOT: no tag; branch develop declares it (pom.xml)`).

Only if none declares it does dt take the default branch, and it says so. Several libraries in one repo share one fetch.

**Workspaces don't fetch libraries.** The build takes their jars from your repository (Nexus). For flows through library code, a workspace uses the indexes the service's passport built. `libraries=true` fetches the library sources now, for a service without a passport.

A local checkout whose history no longer matches the remote (after a force-push or rebase) is dropped and fetched fresh, with a note in the log.

Each library module a passport or workspace pulls gets its own code index (`cache/code/LIB/commons/audit`). The service's graph and its libraries' graphs join:

- a type a library declares is that class, not an external one;
- an interface of a library reaches the service's implementations.

So a **controller of a starter** that calls a `ProcessHandler` the service implements leads into the service's code, and from there to what leaves the service.

The passport now has **flows**: every entry point (endpoints, also the ones a library serves; Kafka listeners; `@Scheduled` jobs; event listeners). For each one it shows:

- the chain of classes through service and libraries;
- what leaves: topics produced (a library publisher's `${acme.events.topic}` resolved with the service's config), HTTP (Feign, RestTemplate, WebClient), tables read and written (SQL, JDBC, Spring Data repositories), database functions;
- the beans on the chain;
- the dependencies at its edge.

`impact` crosses the same line. Changing `OrderService#place` reaches `POST /process/{type}` served by the library.

**Flow tests.** `test_context` with an endpoint (`"POST /process/order"`), a listener, a job, a library class or `flow: true` gives the context for one isolated test of the whole flow:

- the **real beans of the chain** in `@Import`, including the library's;
- `@WebMvcTest(controllers = …)` for endpoints (a library controller also needs the `@Import`), or `@SpringJUnitConfig` for listeners and jobs, which are called as the framework would;
- **everything at the edge mocked**: repositories, clients, `KafkaTemplate`, `RestTemplate`, `JdbcTemplate`, and beans not on the flow;
- the `@Value` properties the chain needs, from the service's config (`@TestPropertySource`);
- what to stub, and what to `verify` on what leaves (`send(eq("orders.placed"), …)`).

The libraries must be resolvable by the build (your Nexus). Their sources come from Bitbucket.

### Tests and patches

The flow is `workspace_open` → `test_context` → `workspace_write` → `test_run` → `workspace_write` (fix) → `test_run` → `workspace_patch`.

1. **`workspace_open`** checks out master/main, a branch, a tag, a commit, or what is deployed in an env (`service` + `env`) into `work/<id>`. The checkout is writable and indexed.
2. **`test_context`** collects what the agent needs for an isolated test of a class or method:
   - its source, its Spring role and the style that fits it:
     - plain JUnit for logic;
     - Mockito (`@Mock` each dependency, `@InjectMocks`) for services, components and Kafka listeners (call the listener method directly);
     - `@WebMvcTest` + MockMvc with `@MockBean`, or `@MockitoBean` on Boot 3.4+, for controllers;
     - `@DataJpaTest` / `@JdbcTest` against the real schema for repositories and DAOs;
   - the dependencies with their methods, and what each method calls on them (what to stub);
   - the project's test setup (JUnit 4 or 5, AssertJ, Boot version, Testcontainers), an existing test to copy the style from, and rules;
   - a skeleton that compiles.
   With `env`, it also writes a **DDL snapshot** of the tables the class touches to `src/test/resources/dt-schema/<db>.sql`, and suggests inserts (parents first, only columns that need a value). The snapshot grows as more tests need more tables.
3. **`test_run`** runs the named tests with the repo's own build (Maven or Gradle; the wrapper when there is one) and answers with:
   - each test with its status and time;
   - failures with their messages;
   - **code parts to work on**: the frames of the stack trace that are in the repo, with the lines around them;
   - compile errors with their lines.
   With `env` + `db` (or `ddl_path`), the run gets a throwaway database on the test Postgres, loaded with the snapshot. Spring gets it as `SPRING_DATASOURCE_*` env vars, which reach the test JVM under both Maven and Gradle; Flyway, Liquibase and `spring.sql.init` are off. Long runs answer "running" with a job id, like `catalog_sync`.
   **Fast by default.** On a Maven project, the first run of a workspace module calls Maven once to compile everything and write the test classpath. After that, each run compiles only the changed sources, plus the classes that use a changed class (from the code graph), with `javac`. The selected tests then run in one JVM through a small JUnit Platform launcher of dt's own. A rerun takes about a second, a fix plus run about 5 s, a Spring slice 5–9 s; a full Maven build of the same tests takes 11–14 s (measured on the fixture).
   - `files: [{path, content | edits}]` writes before running, so each try is one call.
   - `mode: "build"` runs the project's own Maven/Gradle: do it once before the patch. Gradle and Kotlin projects always use the build.
   - Every result is kept per test, with a fingerprint of the code under test (not the tests).
4. **`workspace_patch`** lists each test in the patch with its proof:
   - **red-green**: it failed, the code changed, then it passed, so it catches the bug;
   - **green-only**: never seen failing. That's fine for behaviour that already worked, suspicious for a bug fix;
   - **failing**.

   It also says whether the tests passed in a full build. The patch view shows the same.

   **For small bugs:** write one test that reproduces the bug, see it fail (`test_run`), fix with `test_run files=[{path, edits}]`, see it pass, run `mode: "build"` once, then take the patch. For pure logic (rounding, limits, parsing) the skeleton suggests a `@ParameterizedTest` with boundary values. The context also includes the bodies of the methods the target calls, so less reading is needed first.
5. **`workspace_patch`** returns one git patch against the commit the workspace was opened at: new tests, the snapshot, fixes. The user sees it as a colored diff with **Download .patch** (`/patch/<id>.patch`). Apply it with `git apply --index`. **Nothing is committed or pushed.**

`ddl_snapshot` writes the DDL of a synced database: extensions, schemas, enum and domain types, sequences, tables (defaults, identity, generated columns, constraints, indexes, comments), functions and procedures, views in dependency order, and triggers. It can do all of it, or only some tables or functions, or what a service uses, closed over what they need (FK targets, trigger functions, called functions and the tables they touch). A snapshot of a whole database loads into an empty one and reproduces the same catalog. The stress test checks that on 2,000 tables.

**Running tests needs a JDK and a scratch Postgres.** With compose, the `jdk` and `testdb` profiles provide them (on by default in `run.sh`):

- `jdk` copies JDK 21 and Maven from the official `maven` image into a volume that dt mounts at `/opt/jdk`. It's a one-shot, still with no Dockerfile.
- `testdb` is Postgres on tmpfs, reachable only on the compose network.
- The Maven and Gradle caches live in `cache/m2` and `cache/gradle` of the config folder.

Without Docker, dt uses `JAVA_HOME`/PATH and `~/.m2`. The `tests` section of `config.json` overrides any of it:

```json
"tests": {
  "javaHome": "/usr/lib/jvm/temurin-21",
  "maven": "/opt/maven/bin/mvn",
  "mavenSettings": "maven-settings.xml",
  "pgUrl": "postgres://dt:dt@localhost:55432/postgres",
  "offline": false, "timeoutMs": 900000
}
```

- `mavenSettings` is relative to the config folder; use it for your Nexus mirror.
- `pgUrl` is refused when it is one of the environments' databases. That is the only database dt ever writes to, and it only touches `dt_test_*` databases.
- On a JDK newer than the project's Mockito/Byte Buddy (for example, Boot 3.3 on Java 24), runs set `-Dnet.bytebuddy.experimental=true` (`tests.javaToolOptions`).

### Company repositories and build credentials

Real builds read the company repository and its credentials from the machine. `build.gradle` uses `nexusUrl`, `mavenUser` and `mavenPassword` from `~/.gradle/gradle.properties`, and Maven uses `settings.xml`. Without them the build script fails before compiling anything. dt passes them to every test run, never writes them to disk, and masks their values in everything it shows:

- **Gradle:** `gradle.properties` in the config folder (and `tests.gradleProperties` files, and `~/.gradle/gradle.properties` when `GRADLE_USER_HOME` points elsewhere, as in the container). Project properties go to Gradle as `ORG_GRADLE_PROJECT_<name>` env vars, and `systemProp.*`/`org.gradle.*` as `-D`. Values may be `${VAR}` from `.env`:
  ```properties
  nexusUrl=https://nexus.example.com/repository/maven-public
  mavenUser=ci-reader
  mavenPassword=${NEXUS_PASSWORD}
  ```
- **Maven:** `maven-settings.xml` in the config folder (or `tests.mavenSettings`).
- **Env vars for any build:** `"tests": { "env": { "NEXUS_TOKEN": "${NEXUS_TOKEN}" } }`.

When a build fails for a missing property, a 401 or unresolved dependencies, `test_run` says where these settings go. This is tested against a password-protected repository.

## Showcase: everything about one service

```bash
sh demo/showcase.sh                                     # the demo: payments-service, FeeCalculator#fee
dt showcase payments-service FeeCalculator#fee --envs dev,uat [--ref master] [--test-file FooTest.java]
```

In the chat: "show everything for payments-service and test FeeCalculator.fee". It runs these steps and shows them on one page (`/showcase/<id>`), each with its view embedded:

1. For each environment: health of every service, the live dashboard, and this service's instances with the version, commit and branch deployed. A table then says whether the environments run the same build (`dev 1.1.0-SNAPSHOT@c0ffee1 vs uat 1.0.0@ab2ce56`).
2. The passport, with its flows.
3. The impact of the code part.
4. A workspace on master (or `--ref`): `test_context`, the test written (the skeleton, or your file), run (fast on Maven), the results view and the patch.

It doubles as an end-to-end check of dt: every step reports ok or why not, and the CLI exits non-zero when one fails. `test/showcase.live.test.js` runs it against the demo mock (two environments, Bitbucket with real git repos) with Maven. A test that finds a bug is a result, not a failed step: the demo's test finds the fee rounding bug (`expected 0.67, got 0.66`).

### How big, how fast

`node test/stress/code-and-db.js [--repos 40 --files 400] [--pg <url> --tables 2000]` builds synthetic Spring services that call each other (Feign → endpoints) and share topics and tables. It checks every grep against a full scan of the same files and times ripgrep. With `--pg`, it creates, syncs, snapshots and restores a big schema.

On a laptop (M-series, Node 22), with 40 services, 18,200 files (101 MB) and a 2,000-table database:

**Building the index**

| | |
| --- | --- |
| Index build | 36 s in all, 0.9 s per service (median), 2.8 MB/s |
| Index size | 70 MB (trigrams 11 MB, graph 56 MB) |

**Grep**

| | |
| --- | --- |
| Rare literal, class name, config key | 12–46 ms (reads 1–75 of the 18,200 files) |
| Topic name, annotation, regex with a literal | 35–140 ms |
| Full scan in Node, for comparison | 1.2–4.4 s |
| ripgrep, for comparison | 0.42–0.51 s |
| Common word (`return`) or regex without a literal | ~1.3 s: about a full scan. The index can't help, which is where ripgrep wins. |

**Impact**

| | |
| --- | --- |
| Per question | 0.4–0.55 s: hot method, table across 16 services, column, topic through 6 services, endpoint with Feign callers in other services |
| Loading all 40 graphs | 1.2 s, ~370 MB heap. Kept until an index changes. |

**Database**

| | |
| --- | --- |
| `catalog_sync` | 5.9 s (2,200 relations, 501 functions) |
| Usage index | 0.1 s |
| `catalog.txt` | 0.4 s |
| `find` | 2–5 ms |
| DDL of the whole database | 0.4 s (7,500 statements, 2.7 MB) |
| Loading it into an empty database | 71 s, with identical catalogs |
| Snapshot of one function closed over its tables | 0.14 s |

## Views: how results are shown

Every result can be shown in the chat (Open WebUI embeds it) or on its own page. Tables use the result viewer; everything else uses **views**:

| View | Shows | DATA |
| --- | --- | --- |
| `code` | JavaScript that ran, its output, the tools it called | from the `code` tool |
| `json` | a collapsible tree, raw text, copy | any JSON |
| `xml` | re-indented, highlighted | the XML text |
| `table` | rows | an array of objects |
| `list-diff` | only in first · in both · only in last, with counts, filter, copy, duplicates | `{ first, last, labels }` |
| `text-diff` | line diff with context | `{ first, last, labels, format: "json" \| "xml" }` |

- `show(view, data, title)` shows any data with any view; `diff(first, last, labels)` compares two lists (or `mode: "text"`, two texts) and shows the result. Both are plain tools, so scripts use them as steps, and a script run carries the last view a step made: in the chat, running the script shows its diff.
- **Custom views** are added on `/admin` (**Views**: copy a built-in, edit the HTML next to a live preview on sample data) or by the agent with `view_save`. A view is HTML plus a script that reads `DATA`, with helpers: `dt.json`, `dt.table`, `dt.prettyXml`, `dt.highlightXml`, `dt.diffLists`, `dt.diffLines`, `dt.copy`. It may load chart libraries from jsDelivr, cdnjs or unpkg. They live in `views/` in the config folder; one with a built-in's name replaces it.
- **Sandboxed.** View pages are served with a CSP sandbox (no same origin) and `connect-src 'none'`: the data is written into the page, and the page cannot call dt or send anything anywhere. So a view written by the agent can only draw.
- `diffLists` and `diffLines` are also helpers in script JavaScript.

**Files.** `files_browse(store, dir)` shows a store as a tree of nested folders; clicking a file previews it (JSON as a tree, XML highlighted, CSV as a table, text, images, a hex head for binaries). `files_show(store, path)` opens one file with its folder, for "show me the file from that panel". Previews only work for the files of that listing.

**The example** ([demo/scripts/reconcile/shipped-vs-settlement.json](demo/scripts/reconcile/shipped-vs-settlement.json)): the ids of shipped orders from Postgres vs the order ids in the partner's monthly settlement CSV on SFTP. One step queries the column (`pg_query` with `all: true`), one reads the file and keeps the first column (an `after` hook), one runs `diff`. In the chat: "compare our shipped orders with the settlement report" → the `reconcile` collection tool → the three columns, embedded, and the model lists what is missing on each side.

## Call history and shortcuts

Every tool call is logged: MCP, OpenAPI (Open WebUI), the HTTP API, the CLI, and calls made by scripts (marked with their script). The newest ~5000 are kept in `cache/_calls.jsonl`. `call_patterns` (and **History** on `/admin`) finds the repeated work in it:

- **Repeats.** The same tool called 3+ times where only some values change. A number or quoted value inside a text becomes a param named after what it is compared to: three `select … where id = 1001/1002/1003` turn into one step with `{{id}}`.
- **Sequences.** The same tools in the same order, 2+ times: `find → pg_usage` becomes a two-step script.

Each pattern comes as a ready script. **Save as script…** opens it in the editor; the agent can save one with `script_save`. Calls already made by scripts are not suggested again.

## API routes

`api_routes` lists each service's HTTP routes from two sides:
- **from code**: the passports' Spring mappings, with the handler and file:line;
- **from the wire**: requests seen in the browser, with ids folded to `<id>`, how often, the status codes and the query keys.

The wire side fills up by itself: every script with browser steps records what the pages called, `routes_discover` opens a site link (after an optional login script) just to record it, and in the chat the model passes `browser_network_requests` output to `routes_learn`. Observed routes are matched to the code endpoint that serves them, even behind a gateway prefix, so `GET /api/orders/<id>` on the back office is attributed to `order-service` `OrderController.getOrder`. Routes are also in `find` (`api:`). They are kept in `cache/routes.json`.

## Admin (`/admin`)

| Tab | What |
| --- | --- |
| **Index** | Every source per env: configured or not, last sync, size, time taken, last error, and a refresh button for each database, ES, Kafka, Consul, the whole env, or just the index |
| **Explore** | Search the catalog; open a table or function to see its columns or arguments, constraints, triggers, body, "used by" and "uses"; attach a note |
| **Passports** | Build one for a service (optionally mapping it to a repo), rebuild one or all |
| **Scripts** | Collections as nested folders, Postman style: create, rename inline, drag to move, duplicate, delete. Each script has a step editor (kind, target with suggestions, args, "save as", optional, reorder), params, a JSON view, and Run with a field per param showing each step's result. Ctrl/⌘+S saves |
| **Views** | Built-in and custom views; edit HTML and sample data with a live (sandboxed) preview, copy or override built-ins |
| **History** | Repeated calls and sequences from the call log, each with **Save as script…**; the calls themselves, filtered by words and source |
| **Sites** | Edit `browser.sites` one site at a time: start URL (`${VAR}` allowed), description, login secret names (marked when `.env` has no value), and the links with a live preview of the URL each opens |
| **API routes** | API routes from code and from the browser, filtered as you type |
| **Jobs** | Every refresh with a live log. A refresh that is already running is joined, not started twice |
| **Config** | Edit `config.json` (validated, applied at once, previous version kept as `config.json.bak`). Shows integrations, every tool with its origin, plugin hashes, load errors; reload tools or update plugins |

Secrets (`.env`) are never shown or edited there.

## Tools

| Group | Tools |
| --- | --- |
| catalog | `find`, `catalog_sync` |
| pg | `pg_table`, `pg_function`, `pg_usage`, `pg_query` |
| es | `es_search`, `es_health` |
| kafka | `kafka_topic`, `kafka_last`, `kafka_lag` |
| consul | `health` (every service, one call), `consul_service`, `overview` (live dashboard) |
| logs | `logs_search`, `logs_trace` |
| bitbucket | `bitbucket_repos`, `bitbucket_files`, `bitbucket_file`, `bitbucket_prs`, `bitbucket_pr`, `bitbucket_my_prs`, `repo_fetch` |
| confluence | `confluence_search`, `confluence_page` |
| passport | `passport`, `passports`, `who_uses` |
| code | `code_index`, `code_search`, `code_symbols`, `code_read`, `impact`, `ddl_snapshot`, `workspace_open`, `workspace_list`, `workspace_read`, `workspace_write`, `workspace_patch`, `workspace_drop`, `test_context`, `test_run` |
| browser | `browser_sites`, `site_url` (plus the Playwright MCP tools when the `browser` profile runs) |
| api | `api_routes`, `routes_learn`, `routes_discover` |
| scripts | `code`, `script_list`, `script_get`, `script_save`, `script_run`, `script_collection`, `js_run`, plus each script or collection exposed as a tool |
| files | `files_stores`, `files_list`, `files_search`, `files_read`, `files_write`, `files_copy`, `files_browse`, `files_show` |
| views | `show`, `diff`, `view_list`, `view_get`, `view_save` |
| history | `call_history`, `call_patterns` |
| custom, plugin | yours: from `tools.custom` and `tools.plugins` |

Results shaped like tables return a preview plus a `view` link to the full result (`/view/<id>`), which Open WebUI embeds in the chat.

## Screenshots

Every picture comes from the bundled demo, a fake environment with real Postgres ([demo/](demo/README.md)).

| | |
| --- | --- |
| ![admin: index status](docs/screenshots/admin-index.png) **/admin** · what is indexed, refresh all or one source | ![admin: table usages](docs/screenshots/admin-explore-table.png) **Explore** · a table: columns, constraints, triggers, who uses it |
| ![admin: function](docs/screenshots/admin-explore-function.png) **Explore** · a function: arguments, callers in code and in the db | ![admin: jobs](docs/screenshots/admin-jobs.png) **Jobs** · every refresh with its log |
| ![chat: reconcile](docs/screenshots/chat-reconcile.png) **In the chat** · shipped orders vs the partner's settlement file on SFTP | ![chat: file](docs/screenshots/chat-file.png) **In the chat** · "show me the order file from the inbox" |
| ![chat: code](docs/screenshots/chat-code.png) **Code mode** · "compute the average order total per status" in one call | |
| ![chat: files](docs/screenshots/chat-files.png) **In the chat** · the SFTP as a tree | ![files](docs/screenshots/files.png) **Files** · nested folders, JSON preview |
| ![text diff](docs/screenshots/view-text-diff.png) **text-diff** · the template vs what was sent | ![admin: views](docs/screenshots/admin-views.png) **Views** · edit a view next to its live preview |
| ![chat: overview](docs/screenshots/chat-overview.png) **In the chat** · live environment dashboard | ![chat: logs](docs/screenshots/chat-logs.png) **In the chat** · log search with timeline |
| ![pg usage](docs/screenshots/pg-usage.png) **pg_usage** · who uses `sales.orders` | ![passport](docs/screenshots/passport.png) **Passport** · a service from its code |
| ![logs](docs/screenshots/logs.png) **Logs** · timeline by level, facets, lines | ![trace](docs/screenshots/trace.png) **Trace** · one request across services |
| ![pull request](docs/screenshots/pull-request.png) **Pull request** · files, diff, comments | ![dashboard](docs/screenshots/dashboard.png) **Dashboard** · health, ES, consumer lag |
| ![health](docs/screenshots/health.png) **health** · every Consul service in one call | ![kafka](docs/screenshots/kafka-last.png) **kafka_last** · latest messages |
| ![admin: scripts](docs/screenshots/admin-scripts.png) **Scripts** · collections, the step editor, a run | ![admin: sites](docs/screenshots/admin-sites.png) **Sites** · a site, its login secrets and link map |
| ![admin: files script](docs/screenshots/admin-script-files.png) **The example** · template → new ids → SFTP → import API, one run | ![admin: history](docs/screenshots/admin-history.png) **History** · repeated work, each a ready script |
| ![admin: js script](docs/screenshots/admin-script-js.png) **JavaScript** · a js step, before/capture/after hooks, tests and log | |
| ![admin: api](docs/screenshots/admin-api.png) **API routes** · from code and from the browser | |
| ![dark: explore](docs/screenshots/admin-explore-table-dark.png) Dark mode | ![dark: passport](docs/screenshots/passport-dark.png) Dark mode |

## Safety
- Views run in sandboxed pages without network access (`connect-src 'none'`); their data is in the page.
- Script JavaScript runs sandboxed (no files, no secrets, time and memory limits); `scripts.js: false` turns it off.
- Writing is limited to:
  - file stores marked `"write": true` (never overwriting unless asked);
  - script `http` steps to the prefixes in `scripts.http.allow`;
  - workspaces (`work/<id>`, checkouts of their own; their changes leave only as a patch, never committed or pushed);
  - the `dt_test_*` databases of the test Postgres (`tests.pgUrl`, refused when it is an environment's database).
- Postgres statements run in read-only transactions with their own `statement_timeout` (`SET LOCAL`, so it also holds behind PgBouncer): 60 s for queries, 2 min for indexing (`timeouts`); the other sources are only read.
- Ports are published on 127.0.0.1 unless you change `DT_BIND`. Set `DT_API_KEY` before exposing dt.
- Result pages load their data by unguessable ids or signed tokens, so embeds in a sandboxed chat iframe work. Everything else needs a trusted client.
- The Bitbucket token is passed only as a per-command git header; it is never written to `.git/config`.

## What dt is doing: logs, call history, doctor

Every tool call and every job is traced, in `docker logs dt` and in `cache/logs/dt.log`:

```
11:28:38 dt job workspace_open payments-service#axqa start {"job":"mvs16xq79de372"} (job)
11:28:38 dt   workspace_open payments-service#axqa note: reusing 5147f01d64 from …/repos/SHOP/payments-service: nothing downloaded
11:28:39 dt job workspace_open payments-service#axqa ok 732ms  git ls-remote 185ms · git init 68ms · git fetch (local) 220ms · git checkout 43ms · code index 39ms
11:28:47 dt   tests PaymentServiceTest in …#dyb5 maven prepare (test-compile + dependency:build-classpath, once per workspace) 8.5s
11:28:51 dt job tests PaymentServiceTest in …#dyb5 ok 12.4s  maven prepare 8.5s · javac main 0ms · javac tests 0ms · run tests 3.5s
```

- **Each call:** a start line with its arguments, every step that takes a second or fails, notes, and the end: ok with the time per step, or `FAILED in <step>: <error>`.
- **Notes** say when dt took a fallback: a broken `.git` replaced, git unable to chmod (git data moved to `DT_GIT_DIR`), a sha not fetchable, Bitbucket not answering (local copy used), a checkout reused.
- `DT_LOG=calls` leaves out the steps, `DT_LOG=quiet` everything.

In the chat:
- `call_history`: what runs now and in which step, then recent calls with their steps and errors (`failed=true` for failures only).
- `dt_log`: the log's events.
- `job_cancel`: stops a running job and kills its builds and git processes. /admin → Jobs has a Cancel button too.

**`doctor`** (`dt doctor --repo PROJECT/slug [--deep]`, or the tool in the chat) checks what fetching and test runs need, each with a fix:

- folders writable (and whether git can chmod there), and free disk;
- git, and Bitbucket: the token, the API, and `git ls-remote` of the repo (`--deep` also fetches it);
- `java` *and* `javac`, Maven, Gradle, and the Gradle wrapper's download;
- the Maven repository and Gradle home, writable;
- the company repository, reached with the credentials from `maven-settings.xml` / `gradle.properties`;
- Maven Central, the proxy, the test database, and jobs running longer than `tests.timeoutMs`.

dt runs it once at start and prints the problems to the log.

**Sizes:**
- the log rotates at `log.maxMb` (50) MB and keeps `log.files` (3) files;
- the call history keeps 5,000 calls and at most `log.maxMb` (50) MB;
- stored results: the newest 500, at most `results.maxMb` (500) MB;
- workspaces unused for `tests.workspaceDays` (7) days are removed.

**Workspaces and builds:**
- `workspace_open` asks Bitbucket which commit the ref points to. If the passport's checkout or another workspace has that commit, it takes it from there and downloads nothing.
- In the same chat (Open WebUI forwards the chat id, `ENABLE_FORWARD_USER_INFO_HEADERS`, on in compose), the same repo and ref give back that chat's workspace, with its changes and its prepared build. `fresh=true` gets a new checkout.
- It runs as a job, so a big repo answers "running" instead of hitting the chat client's timeout.
- Builds run with a clean environment: PATH, HOME, locale, proxies and JAVA_HOME, plus `tests.passEnv`, `tests.env` and the repository settings. Build scripts and tests can't read dt's API key or tokens.
- Gradle uses its build cache (`--build-cache`), shared by all workspaces through the Gradle home.

## Troubleshooting

**Workspaces or test runs fail and you don't know why.** Run `doctor` (with `repo=PROJECT/slug`), then `call_history failed=true` or `dt_log failed=true`: the failed step and its error are there.

**Passports: `git cannot chmod` / `could not set 'core.filemode' to 'false'` / `not a git repository`.** dt checks once per folder whether git can change file modes there. Where it can't, dt keeps git's data in `DT_GIT_DIR` from the start, notes it once in the log, and checks the files out into `repos/` and `work/` as usual. In compose, `DT_GIT_DIR` is the `dt-git` volume (a one-shot `init` service hands it to dt's user), so the git data survives restarts. Elsewhere, set it to a lasting folder; `doctor` warns when it's in `/tmp`. Background: git cannot manage its files in `repos/`. That happens when the config folder is on a drive that does not allow changing file permissions (a Windows drive under WSL such as `/mnt/c/...`, a network share, some Docker/Colima mounts), or when the containers run as another user. `run.sh` runs them as you (`DT_UID`/`DT_GID` from `id -u`/`id -g`; set them in `.env` to override). Where git still cannot chmod, dt keeps the git data in the container (`DT_GIT_DIR`, default `/tmp/dt-git`) and checks the files out into `repos/` as before; a half-made `.git` from an earlier failure is replaced. Fastest of all: put the config folder on the local disk (in WSL, under `~`, not `/mnt/c`).

**Indexing a big database is cancelled (`canceling statement due to statement timeout`).** Each catalog query may take `timeouts.pgIndexMs` (2 minutes by default); raise it in `config.json` (or `DT_PG_INDEX_TIMEOUT_MS`). In the chat, `catalog_sync` answers "running" with a job id after ~50 s instead of making the client time out; asking again with that id returns the result.

**Kibana (or another link) opened from an embedded view fails: `Failed to read the 'sessionStorage' property … document is sandboxed and lacks the 'allow-same-origin' flag`.** Open WebUI embeds tool results in a sandboxed iframe, and a tab opened from it inherits that sandbox. The link itself is fine. Open it from the chat answer instead (the agent puts Kibana links there) or with **Copy Kibana link** on the logs view. If you want links in embeds to work directly, turn on Open WebUI's *Settings → Interface → iframe Sandbox Allow Same Origin* (as admin, also the default for everyone under *Admin → Settings → Interface*). That is your call: it lets embedded pages use their own origin (dt's, which differs from Open WebUI's), so they can keep storage and open working tabs. dt's custom views stay sandboxed either way (`/show/…` sends its own CSP sandbox).

**`test_run`: `no Maven` / `no Gradle` / `the test database … is not reachable`.** Add `jdk` and `testdb` to `COMPOSE_PROFILES` (run.sh has them by default), or point `tests.maven` / `tests.javaHome` / `tests.pgUrl` at yours. Behind a corporate mirror, put a Maven `settings.xml` in the config folder and set `tests.mavenSettings`. For Gradle wrappers, point `distributionUrl` at your mirror. The first run downloads the project's dependencies (Spring Boot tests: ~100 MB into `cache/m2`), so it may answer "running"; ask again with the job id. `Mockito cannot mock this class` on a JDK newer than the project's Mockito: use the JDK the project builds with (`tests.javaHome`), or keep the default `tests.javaToolOptions`.

**A library of a passport has `error: no Bitbucket repo for …`.** First run `catalog_sync what=bitbucket` once: it indexes every repo's folders and modules, so a library in `commons/audit` is found by its artifactId. Without the index, dt looks for the library's repo by its artifactId, shorter forms of it (`acme-starter-kafka` → `acme-starter`, for a module of a bigger repo), the name without suffixes like `-starter`/`-core`, and the end of its groupId; in the repo it reads only the module that declares the artifact. When the repo is named otherwise, map it: `"passports": { "libraryRepos": { "acme-starter-*": "LIB/platform-starters" } }` (artifactId or `groupId:artifactId` globs). Gradle versions may come from `gradle.properties`, `ext { }` / `ext.x`, `def`/`val`, `extra[...]`, and maps like `$versions.kafka`.

## Development
```bash
npm test                                                     # node:test, no network
docker run -d --name dt-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:16-alpine
DT_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/postgres npm test   # also against a real Postgres
sh demo/start.sh                                             # the demo on http://127.0.0.1:4800/admin (DEMO_BROWSER=1: with a browser); includes an SFTP server
npm run build                                                # rebuild dist/ after changing the sources
```

**Layout:**
- `lib/` holds the sources (`pg`, `es`, `kafka`, `consul`, `logs`, `atlassian`, `git`).
- The index lives in `lib/` too: `catalog`, `pgindex`, `indexer`, `jobs`, `notes`.
- Also in `lib/`: `passport/`, `config` and `migrate`, `tools` (the registry, custom tools and plugins), `browser` and `browser-mcp` (dt's Playwright client), `scripts`, `routes`, `admin` and `webui`.
- `build.js` bundles everything into `dist/` (esbuild), which compose runs. Dependencies: `postgres` and `ssh2` (its optional native add-ons are left out; it runs on plain JS).
- Also: `files` (stores), `calls` (call log and patterns).
- `server.js` and `web/` are the HTTP side, and `cli.js` is the CLI.

Notes for coding agents are in [AGENTS.md](AGENTS.md).

## License
MIT
