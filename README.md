# dev-tool (`dt`)

Read-only tools that let an AI agent (or you) investigate a microservice environment without guessing:

- **An index of your databases.** Postgres tables, columns, views, functions and procedures with their arguments, and **who uses what**: which services read or write a table (from their code, with file:line), which functions, triggers and views touch it, and what calls a function. Also Elasticsearch mappings, Kafka topics (schemas and sample messages), and Consul services.
- **Service passports.** Static analysis of a Spring service's repo and its internal libraries: HTTP endpoints, Feign and HTTP calls, Kafka in/out, tables and functions used, datasources, dependencies.
- **Live tools.** Read-only SQL, ES search, the last Kafka messages, health of all services in one call, consumer lag, ELK log search and traces, Bitbucket PRs, Confluence. A headless browser and a code graph are optional.
- **Results you can use.** Tables, dashboards, logs, diffs and passports render as pages; in Open WebUI they appear inside the chat.
- **`/admin`.** Watch what is indexed, refresh all or one source, browse objects and their usages, edit config and notes.

It plugs into **Open WebUI** (bundled, or one you already run) or any **MCP client** (Claude Code, Cursor, ...), and runs as a single Node process with one dependency.

```
client ──(OpenAPI / MCP)──> dt :4000 ──read-only──> Postgres, Elasticsearch, kafka-ui, Consul, ELK, Bitbucket, Confluence
                              │
                              └── cache/<env>/  (index: catalog.txt, pg/<db>.json, pg/_usage.json, ...)   passports/   repos/
```

## Quick start

You need Docker, or Node 22+ to run it without Docker.

```bash
cp .env.example .env.dev                  # one file per environment: DATABASE_URL_<NAME>, ES, kafka-ui, Consul, logs
cp .env.personal.example .env.personal    # Bitbucket/Confluence tokens, which compose parts to run, LLM for Open WebUI
./run.sh up -d --build
./run.sh exec dt node cli.js sync         # build the index (or press "Refresh everything" on /admin)
```

- Admin: http://127.0.0.1:4000/admin
- Chat: http://127.0.0.1:3000 (if the `webui` profile is on)

### What runs
`COMPOSE_PROFILES` in `.env.personal` picks the optional parts. `run.sh` defaults to all of them:

| Service | Profile | What |
| --- | --- | --- |
| `dt` | always | the tool server: OpenAPI `/openapi.json`, MCP `/mcp`, pages, `/admin` |
| `webui` + `setup` | `webui` | Open WebUI, with the agent prompt and tools set on every model |
| `browser` | `browser` | Playwright MCP: open pages, click, type, screenshot; logins come from `.env.browser` |
| `graph` | `graph` | [code-review-graph](https://pypi.org/project/code-review-graph/) over the fetched repos |

Only the tool server: `COMPOSE_PROFILES= ./run.sh up -d`.

### Without Docker
```bash
npm ci
node cli.js sync            # index the first env found
node cli.js serve           # http://127.0.0.1:4000 (add --lan to listen on all interfaces)
```

## Plug it in

### Your own Open WebUI
1. Make dt reachable from Open WebUI. If they run on different hosts, set `DT_API_KEY` in `.env.personal`, and set `DT_BIND=0.0.0.0` and `DT_TRUST_NETWORK=0` in the shell or in `.env.personal`.
2. Register dt as a tool server: Admin Settings → Tools → add an **OpenAPI** connection at `http://<dt-host>:4000` with path `openapi.json`, bearer auth with the key. Or let dt do it, along with the system prompt and tools for each model:
   ```bash
   node cli.js webui-setup --url https://chat.example.com --key <open-webui-admin-api-key> \
     --dt-url http://<dt-host>:4000 --dt-key <DT_API_KEY> [--model qwen3,gpt-oss]
   ```
3. Set `DT_PUBLIC_URL` to the address of dt that users' browsers can reach. Tables and dashboards are embedded from there.

The system prompt is at `GET /api/prompt` ([lib/agent-prompt.md](lib/agent-prompt.md)) if you'd rather paste it yourself.

### MCP clients
```bash
claude mcp add --transport http dt http://127.0.0.1:4000/mcp
```
For other clients, use the Streamable HTTP URL `http://<host>:4000/mcp`, with `Authorization: Bearer <DT_API_KEY>` when a key is set. The server sends the agent prompt as MCP `instructions`.

### Scripts and CI
Call any tool with `POST /api/tool/<name>` (JSON arguments) or `node cli.js tool <name> '<json>'`.

## Configuration

| File | What | In git |
| --- | --- | --- |
| `.env.<env>` | One environment: `DATABASE_URL_<NAME>`, `ELASTICSEARCH_*`, `KAFKA_UI_URL`, `SCHEMA_REGISTRY_URL`, `CONSUL_URL`, `LOGS_*` | no |
| `envs.json` | Optional. Maps databases and endpoints to other variable names, plus defaults ([envs.example.json](envs.example.json)). Editable on /admin | no |
| `.env.personal` | Bitbucket and Confluence tokens, `INTERNAL_GROUPS`, `COMPOSE_PROFILES`, `LLM_*`, `DT_API_KEY` | no |
| `.env.browser` | Sites for the browser: `<NAME>_URL` plus secrets. Only the browser container reads it | no |
| `notes.json` | Notes on objects ("deprecated, use orders_v2"), shown to the agent. Edited on /admin | no |
| `plugins/*.js` | Your own tools ([plugins/README.md](plugins/README.md)) | no |

Without `envs.json`, every `.env.<name>` file is an environment, and every `DATABASE_URL_<NAME>` in it is a database named `<name>`.

| Variable | Default | |
| --- | --- | --- |
| `DT_API_KEY` | unset | If set, required from untrusted clients (`Authorization: Bearer`, or open `/admin?key=` once for a cookie) |
| `DT_TRUST_NETWORK` | `1` in compose | Trust every client that can reach the port. Compose binds it to `DT_BIND` (127.0.0.1) |
| `DT_PUBLIC_URL` | `http://127.0.0.1:4000` | Base URL of result links and embeds, as the user's browser sees it |
| `DT_TOOLS` | `all` | Tool groups or names to offer, e.g. `catalog,pg,passport` or `all,-confluence,-browser` |
| `DT_RATE_PER_SEC` | `1` | Live requests per second per system and env (`pg:dev`, `kafka:uat`, `bitbucket`, ...); `0` turns it off |
| `DT_CONFIG_DIR`, `DT_CACHE_DIR`, `DT_PASSPORTS_DIR`, `DT_REPOS_DIR`, `DT_PLUGINS_DIR` | the repo folder | Where config and data live |

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
| **Config** | Edit `envs.json` (validated, previous version kept as `envs.json.bak`). Shows integrations and which tool groups are on |

Secrets (`.env.*`) are never shown or edited there.

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

Results shaped like tables return a preview plus a `view` link to the full result (`/view/<id>`), which Open WebUI embeds in the chat.

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
```
Layout: `lib/` holds the sources (`pg`, `es`, `kafka`, `consul`, `logs`, `atlassian`, `git`), the index (`catalog`, `pgindex`, `indexer`, `jobs`, `notes`), `passport/`, `tools` (the registry), `admin` and `webui`. `server.js` and `web/` hold the HTTP side, and `cli.js` the CLI. Notes for coding agents are in [AGENTS.md](AGENTS.md).

## License
MIT
