# Confluence knowledge

Confluence documentation now joins the cached system model: service passports and flows, PostgreSQL objects and usages, Kafka schemas, and code search. Search and quotes work offline after a sync.

```sh
node cli.js sync confluence --spaces SHOP,PAY
node cli.js tool docs_search '{"query":"refund approval","spaces":"SHOP"}'
node cli.js tool docs_page '{"id":"813","section":"Refunds / Rules"}'
node cli.js tool feature '{"text":"How do refunds work?","spaces":"SHOP","env":"dev"}'
```

The same tools are available through MCP, OpenAPI and `/api/tool`. The admin source table includes a Confluence refresh button. `catalog_sync` accepts `what="confluence"`, `spaces="SHOP,PAY"` and optional `full=true`; CLI `--full` has the same effect. `find "docs: refund"` discovers documentation through the environment catalog. `sync index` rebuilds documentation retrieval and graph data from cached pages.

## Configuration

```json
{
  "confluence": {
    "url": "https://confluence.example.com",
    "type": "server",
    "token": "${CONFLUENCE_TOKEN}",
    "spaces": ["SHOP", "PAY"],
    "timezone": "Europe/Moscow",
    "vision": false,
    "rerank": false,
    "extractRelations": false,
    "embeddings": {
      "enabled": false,
      "baseUrl": "${LLM_BASE_URL}",
      "model": "${EMBEDDING_MODEL}",
      "key": "${LLM_API_KEY}"
    },
    "diagrams": {
      "plantumlJar": "${PLANTUML_JAR}",
      "java": "java",
      "runner": false,
      "krokiUrl": "${KROKI_URL}"
    }
  },
  "llm": {
    "baseUrl": "${LLM_BASE_URL}",
    "key": "${LLM_API_KEY}",
    "model": "${LLM_MODEL}"
  }
}
```

Server/Data Center uses a bearer token. Cloud uses `type: "cloud"`, a site URL ending in `/wiki`, and `user: "email@example.com"` with an API token. Cloud page bodies, spaces, ancestors and attachments use REST v2; incremental discovery uses the read-only CQL search API. Legacy Confluence environment variables still work.

Set `timezone` to the Confluence service account's configured timezone for a precise checkpoint with a two-minute overlap. Without it, a conservative calendar-day CQL window avoids missing changes across timezones. Bodies are fetched only when their version changes; attachment metadata is checked independently because attachments have their own versions. A complete ID listing runs at least daily to remove deleted or moved pages. `full` forces immediate reconciliation and refreshes all current pages. Failed page or attachment requests preserve the previous checkpoint; retries still reuse successful downloads. API calls use dt's Confluence rate-limit queue, with bounded HTTP 429 retries.

The mirror lives under `cache/confluence`: per-space `pages/`, `blocks/`, historical `versions/`, a content-addressed `attachments/` directory, `index/`, and `graph.json` plus environment-specific graphs. A cache is associated with one Confluence URL; use a separate `DT_CACHE_DIR` for a different site. Current search excludes pages removed by reconciliation, while historical page versions remain available for checking earlier citations.

## Evidence and retrieval

Storage XHTML becomes headings, paragraphs, list items, table rows with column names, code with its language, Jira issue keys and diagrams. Each block includes its heading path, canonical text offsets, storage offsets and page version. A block keeps its ID when unrelated text is inserted earlier on a page. Quotes retain the source words; table quotes include their column headings.

`docs_search` indexes `<space> / <page title> / <heading path>` with BM25 token postings and trigram candidates. It returns matching sentences, stable block IDs, versions and citation URLs. `section=true` includes the full parent section. Optional OpenAI-compatible embeddings are cached by contextual text hash and fused with lexical results using reciprocal rank fusion. `rerank=true` takes effect only when `confluence.rerank` is enabled. Remote enrichment failures fall back to lexical search with an explicit warning.

```sh
node cli.js tool docs_verify '{"quotes":[{"blockId":"p813.b3-<hash>","version":1,"text":"Refunds over 500 EUR … manual approval."}]}'
```

Every ellipsis-separated piece must appear in order in that exact block and version. `feature` returns at most 20 verified quotes, within a 12 KB text budget; it does not summarize them into invented quotations. The agent prompt requires exact quotes, block IDs and clickable page citations. Retrieved pages, images and diagram text are treated as untrusted data.

## Graph and feature expansion

Entity linking uses exact known names and aliases, including service/repository/application names, topics, qualified tables/functions and HTTP endpoints. Ambiguous mentions keep all candidates. Code/passport relations carry `verified` provenance and file/line where available. Diagram and explicit prose relations carry `stated` provenance with their source page/block. Optional LLM relation extraction is labelled `inferred`, accepts only names actually present in its source block, and never supplies exact evidence quotes.

`feature` searches documentation and indexed code, expands linked entities through cached system edges, and follows indexed entry-point flows. Sequences use the output edges of the matching flow, cross Kafka topics into matching consumer flows, and retain method/file/line. If a flow is unavailable, the result says so and shows only the known endpoint. A documented interaction without a matching cached code edge is reported as a gap; cache freshness, dynamic routing and incomplete analysis remain relevant.

## Diagrams and images

draw.io XML (including deflated attachments), Gliffy JSON, PlantUML/Mermaid macros and SVG text are parsed without executing their content. Raster attachments retain captions and nearby text by default. `vision=true` sends raster images to the explicitly configured vision-capable LLM and caches its labelled inference by attachment hash. Enable it only for the deployment where that remote processing is intended. Use `--full` after changing enrichment settings to refresh unchanged pages.

One model exports Mermaid flowcharts/sequence diagrams, C4-PlantUML Context/Container/Dynamic and sequence diagrams, and Structurizr DSL. The `diagram` tool accepts a model directly; `feature` supplies all formats. Solid edges have verified code provenance, dashed edges are documentation statements, and red edges flag missing support in cached code. Service version/owner, database tables and topic schema/partitions/message age appear in labels or provenance.

The sandboxed `diagram` view provides diagram tabs, pan/zoom, fit, light/dark themes, provenance tooltips and SVG/source downloads. Mermaid renders using the allowed jsDelivr script CDN; the view makes no data/network requests. Its source also works in a fenced `mermaid` block in Open WebUI chat. Without CDN access the source remains available. PlantUML SVG can be rendered on the server with a configured JAR/JDK or on the configured build runner (`runner: true`, optionally `cwd` in the runner's allowed roots). C4 uses the JAR's bundled standard library and Smetana, with PlantUML's SANDBOX profile and no Graphviz install. A configured Kroki URL is another renderer. No renderer or JAR is downloaded automatically at runtime. Structurizr is a source export. SVG outputs are sanitized before viewing.

## Demo and validation

`demo/start.sh` configures and syncs a mock SHOP space with ten pages, architecture draw.io, PlantUML order flow, refund rules/error tables, a PNG caption, runbook/ADR, labels/links and legacy notes. Ask the scripted `demo/mock-llm.js` model “How do refunds work?” for linked quotes, a container diagram, the refund endpoint sequence and the planted `payment-service → fraud-service` gap.

```sh
node --test test/confluence.test.js test/diagrams.test.js
DT_PLANTUML_JAR=/absolute/path/plantuml.jar node --test test/diagrams.live.test.js
npm run build
npm test
```

The integration tests use real local HTTP mock APIs for Server/DC and Cloud, including pagination, incremental updates, independent attachment versions, failed checkpoints, deletions/moves, optional embeddings and vision. They require no external Confluence instance. The optional live diagram test renders actual SVG with a supplied PlantUML JAR; the ordinary suite covers renderer bounds and the unavailable-renderer path offline.

API contracts: [Atlassian Cloud pages v2](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/), [attachments v2](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/), [CQL lastmodified/timezone](https://developer.atlassian.com/cloud/confluence/cql-fields/#lastmodified), [CQL date functions](https://developer.atlassian.com/cloud/confluence/cql-functions/), [Data Center REST examples](https://developer.atlassian.com/server/confluence/confluence-rest-api-examples/).
