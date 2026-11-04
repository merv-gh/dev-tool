# Demo

A fake environment for trying dt and for the README screenshots. Everything runs locally; the data is invented.

| Part | What |
| --- | --- |
| Postgres (Docker, port 55433) | database `orders`: tables, a view, a materialized view, functions, a procedure, a trigger ([seed.sql](seed.sql)) |
| [mock.js](mock.js) (port 4900, uat on 4901) | Consul, Elasticsearch, ELK logs, kafka-ui, Schema Registry, and a Bitbucket API with real git repos. The repos are built from `test/fixtures` (including payments-service, a Spring Boot service whose tests compile and run), plus a generated payment-service. The second port is the "uat" environment: other health, older versions |
| dt (port 4800) | config in `demo/.home/` (`config.json` + `.env`), indexed and with two passports built |
| [mock-llm.js](mock-llm.js) (port 4910) | a scripted "model" for Open WebUI. It answers three questions with real tool calls |

```bash
sh demo/start.sh            # Postgres + mock + dt, then sync and passports -> http://127.0.0.1:4800/admin
sh demo/showcase.sh         # (starts the demo if needed) everything for payments-service on one page
sh demo/stop.sh
```

`showcase.sh` runs health, dashboards and versions of demo and uat, the passport, typed ports and metadata/history, retained semantic revisions, the impact of `FeeCalculator#fee`, then a test of it on master (`demo/showcase/FeeCalculatorTest.java`, which finds the rounding bug) and the patch. Missing semantic coverage explains how to build it without starting a parse. Collapsible sections keep the combined page compact. It prints one line per step and the page's link, and exits non-zero if a step fails. Running the test needs Maven and a JDK: `mvn` on PATH, or `DT_MAVEN=/path/to/mvn` before the first start.

Chat in Open WebUI with the scripted model:
```bash
node demo/mock-llm.js 4910 &
docker run -d --name dt-demo-webui -p 127.0.0.1:3480:8080 \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:4910/v1 -e OPENAI_API_KEY=x -e ENABLE_OLLAMA_API=false \
  -e WEBUI_AUTH=false -e ENABLE_PERSISTENT_CONFIG=false -e DEFAULT_MODELS=demo-model \
  -e 'TOOL_SERVER_CONNECTIONS=[{"type":"openapi","url":"http://host.docker.internal:4800","path":"openapi.json","auth_type":"none","key":"","config":{"enable":true},"info":{"id":"dt","name":"dt"}}]' \
  ghcr.io/open-webui/open-webui:v0.12.4
DT_TOOL_PROFILE=all DT_HOME=demo/.home node cli.js webui-setup --url http://127.0.0.1:3480 --model demo-model
```
Then open http://127.0.0.1:3480 and ask "Who writes sales.orders?", "How is demo doing?", "Any errors in the last hour?" or "How do refunds work?". The refund example joins ten mock Confluence pages with the cached service model, exact linked quotes, C4/sequence diagrams and the planted fraud-service documentation gap. See [Confluence knowledge](../docs/confluence-knowledge.md).

The scripted demo uses the `all` profile because its canned scenarios call collection and file tools by name. Normal installations keep the smaller `direct` profile and discover specialized tools as needed.

Screenshots (needs the `playwright` package and its Chromium; `CHROMIUM=<path>` uses another build):
```bash
NODE_PATH=<node_modules with playwright> node demo/screenshots.js          # pages -> docs/screenshots/
NODE_PATH=<node_modules with playwright> node demo/chat-screenshots.js     # Open WebUI chats
NODE_PATH=<node_modules with playwright> node demo/gallery.js              # all native views + new workflows + mobile
```

`gallery.js` writes a browsable [gallery](../docs/screenshots/README.md), contact sheet and coverage manifest to `docs/screenshots/`. Built-in samples are explicitly labeled as presentation fixtures. Use `SHOWCASE_VIEW=<URL>` to include a full showcase already run with tests; otherwise it creates a read-only showcase without a test target. `--semantic-home <retained-test-home>` adds actual saved Joern flow/port results from `test/semantic.live.test.js`; it reads result payloads only, never the test configuration or token. The interactive retained-analysis editor uses whatever analyses are already in the running demo's home. The gallery does not replay imported API requests or submit passport edits.

`ONLY=name,name` recaptures selected workflows; `--catalog-only` rebuilds the gallery/manifest/contact sheet from existing images without calling tools or recapturing the app. The service-map screenshot explicitly includes static candidates because these generic demo passports do not claim an environment binding.

For the optional real semantic chat examples, retain the live test's `P/orders` analyses and `orders` passport in the demo home, add a `dev` environment, and start the scripted model with `DEMO_SEMANTIC_REPO=P/orders`. Pass the same variable to `chat-screenshots.js`; it adds semantic path and port-history questions using `tool_describe` → `tool_execute`, and captures both the collapsed and expanded port result. This demonstrates actual Open WebUI rendering and tool transport with a scripted model, not autonomous model quality.

## Large architecture estate

`node demo/architecture.js 4046` starts a separate synthetic 600-service architecture demonstration with C4 ownership, a refund data flow, dev/UAT replica health and source-labeled resource panels. No Docker or model is required. It prints the public view and Admin URLs; Admins publish and readers browse. See [architecture observability](../docs/architecture-observability.md) for the schema, metrics and exports.
