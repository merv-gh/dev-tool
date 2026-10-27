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
curl -fsSL https://raw.githubusercontent.com/<owner>/dev-tool/main/install.sh | sh
```

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/dev-tool/main/install.sh | sh -s -- --home ~/work/dt --tools-only
```

| Option | Default | |
| --- | --- | --- |
| `--home DIR` | `~/dt` | config and data: `config.json`, `.env`, `notes.json`, `plugins/`, `cache/`, `repos/`, `passports/` |
| `--tools-only` | off | only the dt tool server, for an Open WebUI or MCP client you already run |
| `--dir DIR` | `~/.dev-tool` | where the code goes |
| `--ref REF`, `--no-start` | `main` | branch or tag; install without starting |

Run it again to update. The config folder is never overwritten. After the first run, fill in `~/dt/.env` (passwords, tokens) and `~/dt/config.json` (or edit it on `/admin`), then press **Refresh everything** on http://127.0.0.1:4000/admin.

Day to day:
```bash
~/.dev-tool/run.sh --home ~/dt up -d --build      # start or update (add --tools-only for just dt)
~/.dev-tool/run.sh --home ~/dt logs -f dt
~/.dev-tool/run.sh --home ~/dt down
```

### What runs
`COMPOSE_PROFILES` in `.env` picks the optional parts (all three by default; `--tools-only` turns them off):

| Service | Profile | What |
| --- | --- | --- |
| `dt` | always | the tool server: OpenAPI `/openapi.json`, MCP `/mcp`, result pages, `/admin` |
| `webui` + `setup` | `webui` | Open WebUI, with the agent prompt and tools set on every model |
| `browser` | `browser` | Playwright MCP: open pages, click, type, screenshot. Logins come from `browser.sites` |
| `graph` | `graph` | [code-review-graph](https://pypi.org/project/code-review-graph/) over the fetched repos |

### Without Docker
```bash
npm ci
DT_HOME=~/dt node cli.js sync      # index the first env
DT_HOME=~/dt node cli.js serve     # http://127.0.0.1:4000 (add --lan to listen on all interfaces)
```

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
  "browser": { "sites": { "crm": { "url": "https://crm.dev.example.com/login", "secrets": ["CRM_USER", "CRM_PASSWORD"] } } },
  "server": { "publicUrl": "http://127.0.0.1:4000", "apiKey": "${DT_API_KEY}" }
}
```

Saving `config.json` (on `/admin`, or in an editor) applies it without a restart. Each `logs.fields` entry maps a field name, with ECS names as the defaults.

**Browser logins.** List the secret names under `browser.sites`, with their values in `.env`. dt writes only those names and values to `cache/browser.env`, and only the browser container mounts that file. The model types the name (`CRM_PASSWORD`), Playwright fills in the value, and it shows up as `<secret>CRM_PASSWORD</secret>` in everything returned.

**Coming from the older layout** (`envs.json` + `.env.<env>` + `.env.personal` + `.env.browser`)? It still works. `node cli.js migrate-config` writes `config.json` + `.env` from it, with per-env secrets prefixed (`DEV_DATABASE_URL_ORDERS`) and plain values inlined; check both files, then delete the old ones.

| Variable (environment or `.env`) | Default | |
| --- | --- | --- |
| `DT_HOME` | the repo folder | the config folder (`run.sh --home` sets it) |
| `DT_API_KEY` | unset | If set, required from untrusted clients (`Authorization: Bearer`, or open `/admin?key=` once for a cookie) |
| `DT_TRUST_NETWORK` | `1` in compose | Trust every client that can reach the port. Compose binds it to `DT_BIND` (127.0.0.1) |
| `DT_PUBLIC_URL` | `server.publicUrl` | Base URL of result links and embeds, as the user's browser sees it |
| `DT_TOOLS` | `tools.enable`/`disable` | Override as a list, e.g. `all,-confluence,-browser` |
| `DT_RATE_PER_SEC` | `server.ratePerSec` = 1 | Live requests per second per system and env; `0` turns it off |
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

## Admin (`/admin`)

| Tab | What |
| --- | --- |
| **Index** | Every source per env: configured or not, last sync, size, time taken, last error, and a refresh button for each database, ES, Kafka, Consul, the whole env, or just the index |
| **Explore** | Search the catalog; open a table or function to see its columns or arguments, constraints, triggers, body, "used by" and "uses"; attach a note |
| **Passports** | Build one for a service (optionally mapping it to a repo), rebuild one or all |
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
| browser | `browser_sites` (plus the Playwright MCP tools when the `browser` profile runs) |
| custom, plugin | yours: from `tools.custom` and `tools.plugins` |

Results shaped like tables return a preview plus a `view` link to the full result (`/view/<id>`), which Open WebUI embeds in the chat.

## Screenshots

Every picture comes from the bundled demo, a fake environment with real Postgres ([demo/](demo/README.md)).

| | |
| --- | --- |
| ![admin: index status](docs/screenshots/admin-index.png) **/admin** · what is indexed, refresh all or one source | ![admin: table usages](docs/screenshots/admin-explore-table.png) **Explore** · a table: columns, constraints, triggers, who uses it |
| ![admin: function](docs/screenshots/admin-explore-function.png) **Explore** · a function: arguments, callers in code and in the db | ![admin: jobs](docs/screenshots/admin-jobs.png) **Jobs** · every refresh with its log |
| ![chat: overview](docs/screenshots/chat-overview.png) **In the chat** · live environment dashboard | ![chat: logs](docs/screenshots/chat-logs.png) **In the chat** · log search with timeline |
| ![pg usage](docs/screenshots/pg-usage.png) **pg_usage** · who uses `sales.orders` | ![passport](docs/screenshots/passport.png) **Passport** · a service from its code |
| ![logs](docs/screenshots/logs.png) **Logs** · timeline by level, facets, lines | ![trace](docs/screenshots/trace.png) **Trace** · one request across services |
| ![pull request](docs/screenshots/pull-request.png) **Pull request** · files, diff, comments | ![dashboard](docs/screenshots/dashboard.png) **Dashboard** · health, ES, consumer lag |
| ![health](docs/screenshots/health.png) **health** · every Consul service in one call | ![kafka](docs/screenshots/kafka-last.png) **kafka_last** · latest messages |
| ![dark: explore](docs/screenshots/admin-explore-table-dark.png) Dark mode | ![dark: passport](docs/screenshots/passport-dark.png) Dark mode |

## Safety
- Postgres sessions are read-only (`default_transaction_read_only`) with a 60s statement timeout; the other sources are only read.
- Ports are published on 127.0.0.1 unless you change `DT_BIND`. Set `DT_API_KEY` before exposing dt.
- Result pages load their data by unguessable ids or signed tokens, so embeds in a sandboxed chat iframe work. Everything else needs a trusted client.
- The Bitbucket token is passed only as a per-command git header; it is never written to `.git/config`.

## Development
```bash
npm test                                                     # node:test, no network
docker run -d --name dt-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:16-alpine
DT_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/postgres npm test   # also against a real Postgres
sh demo/start.sh                                             # the demo on http://127.0.0.1:4800/admin
```

**Layout:**
- `lib/` holds the sources (`pg`, `es`, `kafka`, `consul`, `logs`, `atlassian`, `git`).
- The index lives in `lib/` too: `catalog`, `pgindex`, `indexer`, `jobs`, `notes`.
- Also in `lib/`: `passport/`, `config` and `migrate`, `tools` (the registry, custom tools and plugins), `browser`, `admin` and `webui`.
- `server.js` and `web/` are the HTTP side, and `cli.js` is the CLI.

Notes for coding agents are in [AGENTS.md](AGENTS.md).

## License
MIT
