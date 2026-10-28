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

`showcase.sh` runs health, dashboards and versions of demo and uat, the passport, the impact of `FeeCalculator#fee`, then a test of it on master (`demo/showcase/FeeCalculatorTest.java`, which finds the rounding bug) and the patch. It prints one line per step and the page's link, and exits non-zero if a step fails. Running the test needs Maven and a JDK: `mvn` on PATH, or `DT_MAVEN=/path/to/mvn` before the first start.

Chat in Open WebUI with the scripted model:
```bash
node demo/mock-llm.js 4910 &
docker run -d --name dt-demo-webui -p 127.0.0.1:3480:8080 \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:4910/v1 -e OPENAI_API_KEY=x -e ENABLE_OLLAMA_API=false \
  -e WEBUI_AUTH=false -e ENABLE_PERSISTENT_CONFIG=false -e DEFAULT_MODELS=demo-model \
  -e 'TOOL_SERVER_CONNECTIONS=[{"type":"openapi","url":"http://host.docker.internal:4800","path":"openapi.json","auth_type":"none","key":"","config":{"enable":true},"info":{"id":"dt","name":"dt"}}]' \
  ghcr.io/open-webui/open-webui:v0.12.4
DT_HOME=demo/.home node cli.js webui-setup --url http://127.0.0.1:3480 --model demo-model
```
Then open http://127.0.0.1:3480 and ask "Who writes sales.orders?", "How is demo doing?" or "Any errors in the last hour?".

Screenshots (needs the `playwright` package and its Chromium; `CHROMIUM=<path>` uses another build):
```bash
NODE_PATH=<node_modules with playwright> node demo/screenshots.js          # pages -> docs/screenshots/
NODE_PATH=<node_modules with playwright> node demo/chat-screenshots.js     # Open WebUI chats
```
