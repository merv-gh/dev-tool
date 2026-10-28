# Open WebUI in a large service architecture

Use OpenAPI tool connections for interactive embedded results. Keep `server.publicUrl`
or `DT_PUBLIC_URL` reachable from the chat user's browser; the URL that Open WebUI's
backend uses to call dt can be different. For example, its backend may call
`http://dt:4000`, while the browser opens `http://127.0.0.1:4000/show/<id>`.

## Choose a small starting tool list

The bundled compose sets `DT_TOOL_PROFILE=compact`. Existing standalone installations
remain on their configured profile, or `all` when none is configured. The profile
can also be selected per connection:

| OpenAPI path | Starting workflow |
| --- | --- |
| `openapi/compact.json` | Find capabilities on demand, then execute exact tools |
| `openapi/investigate.json` | Service/data discovery, health, logs, code and evidence |
| `openapi/testing.json` | Fixtures, scenarios, collections, scratch databases and tests |
| `openapi/develop.json` | Code/workspaces, compile checks and focused tests |
| `openapi/knowledge.json` | Source-neutral knowledge and optional cached documentation |
| `openapi/all.json` | Every enabled operation |

Start a compact chat with `find` for system names and `tool_search` for capabilities.
`tool_describe` supplies the exact schema; `tool_execute` calls the same enabled
operation with the same validation, tracing and rate limits. Profiles only control
the definitions initially sent to the model. `tools.enable`/`tools.disable` remain
the capability controls. Custom profiles can list `names`, `groups` and name
`prefixes` in `tools.profiles`.

Register an existing Open WebUI using its normal setup command:

```sh
node cli.js webui-setup --url http://127.0.0.1:3000 \
  --dt-url http://dt-host:4000 --profile compact --model my-model
```

Setup updates dt's delimited instruction section while preserving other model
system instructions and model metadata. Use a model with reliable native tool
calling. Open WebUI's optional Tool Search can defer more schemas when supported
by the installed version; dt profiles do not depend on that experimental feature.
[Open WebUI tool calling and Tool Search](https://docs.openwebui.com/features/extensibility/plugin/tools/).

## Visualizations are on

Tools return compact model context plus a `view` link. OpenAPI responses carry
`Content-Disposition: inline` and `Location`, so Open WebUI can display the view
inside the chat; keep the link in the answer as a fallback. The existing API/MCP
clients still receive ordinary JSON. Rich UI behavior depends on the client:
custom Pipe functions must preserve embeds instead of discarding them.
[Open WebUI rich UI](https://docs.openwebui.com/features/extensibility/plugin/development/rich-ui/).

Knowledge maps, architecture diagrams, reproduction explorers, scenario runs and
collection reports use dt's sandboxed result-view mechanism. A view is an inspectable
snapshot with no live fetch capability. Changing a knowledge backend does not
change the graph presenter or disable its view. Keep interactive execution in an
explicit trusted tool/client workflow rather than hiding API mutations in a chart.

## Knowledge without a required Confluence mirror

Catalogs and passports already establish a useful indexed system graph. Add local
sources individually:

```json
{
  "knowledge": {
    "sources": [
      {"id":"rules","type":"markdown","path":"knowledge/rules"},
      {"id":"domain","type":"json","path":"knowledge/domain.json"},
      {"id":"orders-http","type":"openapi","path":"contracts/orders.openapi.json","service":"orders"},
      {"id":"orders-events","type":"asyncapi","path":"contracts/orders.asyncapi.json","service":"orders","technology":"Kafka"}
    ]
  }
}
```

Contract files are JSON. Convert YAML externally when needed. Normalized JSON uses
the published knowledge-source v1 schema. Arbitrary entity kinds and relation verbs
are supported when their ids and meanings are explicit. AsyncAPI 3 `send`/`receive`
directions are normalized; older versions retain channels and report a direction
gap instead of inventing it.

`knowledge_sync` with a source id refreshes only that source. It retains history
and the last good revision after a failed update, with the failure visible as a
gap. `knowledge_search`, `knowledge_entity`, `knowledge_graph` and `knowledge_verify`
inspect evidence and exact quotes. Cached Confluence text is opt-in via
`includeConfluence:true`; no Confluence credential, mirror or network call is needed
for the default knowledge workflow.

Use exact scoped ids when names collide: two databases' `orders` tables must not
be merged by their display name. Source claims cannot promote themselves to indexed
or runtime proof. These semantics remain the same when retrieval moves to RAG or a
graph/relational/document database; see [the composable architecture contract](composable-architecture.md).

Local queries bound entities, relationship hops, edges, excerpts and result counts.
Truncation and unknown names stay explicit. For a larger independently operated
index, route selected `knowledge_*` tools to a worker using the same versioned
transport instead of embedding its database choices in the client.
