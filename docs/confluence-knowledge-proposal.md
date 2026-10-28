# Confluence knowledge: cache, index, graph, diagrams (proposal)

**Goal:** ask about a feature in chat and get an answer you can check: exact quotes from the Confluence pages, plus C4 and sequence diagrams rendered in the chat. The answer joins what the docs say with what dt already knows from code, databases and Kafka.

## Where dt stands

- `confluence_search` (live CQL) and `confluence_page` (one page as plain text) are all there is: no cache, attachments, index or graph.
- dt already knows the real system:
  - passports: services with their endpoints, topics, tables and libraries;
  - the pg catalog and its usage index;
  - the Kafka catalog: topics, schemas, last messages;
  - code graphs, and flows (entry → chain → what leaves the service).

  That is the half most "doc RAG" setups lack.
- Results show in chat as sandboxed views. Scripts may come from jsdelivr/cdnjs/unpkg; there is no network, and data is written into the page.
- Open WebUI renders `mermaid` code blocks natively.

## What the research says, and what we take

| Finding | Use here |
|---|---|
| Contextual retrieval: prefixing each chunk with its context before indexing cuts top-20 retrieval failures by ~35% (embeddings), ~49% (plus BM25) and ~67% (plus rerank). These are vendor numbers. | Every block is indexed with its page title and heading path in front of it. That prefix comes from the page's structure, so it costs no LLM call. BM25 (trigram, as dt has) plus optional embeddings, fused with reciprocal rank fusion (RRF). |
| Extractive compression keeps the source's words; abstractive summaries cut more tokens but can invent (EXIT, ACL 2025). | Evidence is always extractive: whole blocks or sentences, never summaries. dt checks every quote the model writes against the cached page. |
| Structure-aware chunking with parent-child retrieval: tables row by row, keeping column/value pairs. | Pages become blocks (heading, paragraph, list item, table row, code, diagram), each with an id. A small block is what matches; its section is fetched on demand. |
| GraphRAG and LightRAG are costly to index and query (GraphRAG-Bench: 1,430–1,797 s to index, 14–45 s per query; LightRAG prompts around 100k tokens). RAPTOR is fast. | No LLM-built graph. dt links pages to entities it already knows, deterministically: services, topics, tables, endpoints, from passports and catalogs. LLM extraction of relations from prose is optional, and marked as "inferred from docs". |

## 1. Cache and update

- `catalog_sync what=confluence spaces=SHOP,PAY`:
  - **The first run** lists every page of a space with `body.storage`, version, ancestors, labels and attachments.
  - **Later runs** are incremental: CQL `space in (...) and lastmodified > <last sync>`, and only changed versions are fetched. A full id listing once a day finds deleted and moved pages.
- Supported: Server/DC (`/rest/api/content`, a token) and Cloud (v2 API, email and token).
- Rate limits use dt's `limit` like Bitbucket's.
- **Storage:**

  ```
  cache/confluence/<SPACE>/pages/<id>.json      storage XHTML, version, title, path, labels, links, attachments
  cache/confluence/<SPACE>/blocks/<id>.json     parsed blocks: id, kind, heading path, text, char offsets
  cache/confluence/attachments/<sha256>         content-addressed (diagrams, images), fetched once per version
  cache/confluence/index/                       trigram index of the blocks (+ vectors when an embedding endpoint is set)
  cache/confluence/graph.json                   pages, entities, relations with their source blocks
  ```

## 2. Parse: pages to blocks, pictures to structure

**Storage-format XHTML** becomes blocks, each with a stable id (`p<pageId>.b<n>` plus a hash of its text, so a quote survives edits elsewhere on the page):
- headings make the path (`Refunds › API › Errors`);
- paragraphs and list items are split into sentences for quoting;
- tables become one block per row as `column: value` pairs, so a quote of a row keeps its headers;
- code macros keep their language;
- `ri:page` links become graph edges;
- Jira macros keep the issue key.

**Diagrams in pages** are read for their structure, not their pixels:
- **draw.io / diagrams.net:** the attachment's mxGraph XML, deflated as needed. Cells and edges with their labels become nodes and relations.
- **Gliffy:** its JSON.
- **PlantUML and Mermaid macros:** their text; participants, messages and relations are parsed.
- **Images (PNG/JPG/SVG):**
  - SVG text is read directly;
  - raster images are described only when a vision model is configured (`confluence.vision: true`, the `llm` endpoint). The result is cached per attachment hash and marked as from an image.

  This is off by default (cost, privacy). Without a vision model, an image is listed with its caption and its surrounding text.

## 3. Index and graph

**Index.** Each block is indexed with a deterministic context prefix: `<space> / <page title> / <heading path>`.
- Search is trigram BM25.
- Embeddings are optional, through any OpenAI-compatible `/embeddings` endpoint in config. Results are fused with RRF.
- Optional rerank uses the same LLM endpoint, off by default.

**Graph.** Nodes are spaces, pages, blocks, diagrams, and the entities dt already knows:
- services (passports), plus their aliases from `spring.application.name`, repo names and Kubernetes names;
- topics (Kafka catalog);
- tables and functions (pg catalog);
- endpoints (code graphs);
- Feign targets.

Linking is exact (a token match against known names and their variants), never fuzzy guessing; ambiguous mentions are kept as candidates.

Every relation carries where it comes from:

| Source | Example | Weight |
|---|---|---|
| code / passport | order-service produces `order_created` (KafkaTemplate in OrderPublisher) | verified |
| docs: a diagram | draw.io arrow order-service → payment-service "HTTP" | stated |
| docs: prose | "payment-service listens to order_created" (block p812.b14) | stated (linked mention) |
| docs: LLM extraction (optional) | relation read from a paragraph | inferred |

Where docs and code disagree, the graph says so. For example, a page says `payment-service` calls `fraud-service` over HTTP, but no Feign client or URL exists in code. Or a topic is in a diagram but in no passport. That is often the most useful answer.

## 4. Ask about a feature

New tools:
- **`docs_search`** (query, spaces): hybrid search. Answers blocks with their heading path, page link and score, compressed to the matching sentences, with the section on request.
- **`docs_page`** (id, section): the cached page as blocks; the diagrams on it as structure.
- **`feature`** (text, spaces, env): the one-call answer for "how does refunds work?":
  1. **find:** search the docs and the code index, then pick the pages and the entry points (endpoints, listeners) of the feature;
  2. **expand:** take the entities those pages link, then the real system around them: flows from the entry points (dt's flows, across services through topics), the tables read and written, the topics' schemas;
  3. **evidence:** at most ~20 quotes (exact sentences or table rows, each with its block id and page link), deduplicated across page versions and near-identical pages. This is the compression: a few kB instead of whole pages;
  4. **model:** one diagram model: people, systems, containers (services), databases, topics, external systems, and relations with technology and provenance;
  5. **views:** C4 context, C4 container and a sequence diagram per main flow, rendered in chat;
  6. **gaps:** where the docs and the code disagree.

**Quoting rule** (in the agent prompt):
- The model quotes only from the evidence, with the block id: `"Refunds over 500 EUR need a manual approval" [p812.b14]`.
- dt checks each quoted string against the cached page version and marks it verified or not found. Ellipses are allowed between exact pieces.
- Answers keep the citation links, so a reader can open the page at the section.

## 5. Diagrams: one model, known formats, rendered in chat

One JSON model is the source, and dt writes it out in these formats:
- **C4-PlantUML** (`C4_Context`, `C4_Container`, `C4_Dynamic`): the C4 notation people know.
  - dt renders it to SVG itself with `plantuml.jar` in the JDK it already has, on the runner when there is one. Layout uses ELK (bundled since 1.2024.6) or Smetana, so no Graphviz install is needed. Sequence diagrams need no layout engine.
  - A Kroki container is an optional renderer.
- **Mermaid:**
  - `sequenceDiagram` for flows;
  - a styled `flowchart` for C4 views. Mermaid's own C4 support is experimental and lays out poorly; a flowchart with C4 colours, shapes and legend reads better.
  - It renders in the view from jsdelivr, and also natively in Open WebUI chat as a fenced block, so it works even without the view.
- **Structurizr DSL** as an export: one model, many views, for teams that keep architecture as code.

**Enrichment** from what dt knows:
- **Containers** show the service's version per environment and its owner.
- **Databases** list the tables the service writes and reads.
- **Topics** show their schema name and version, partitions, and last-message age.
- **Sequence steps** come from flows: the endpoint, then the service chain, then the Kafka produce and the consumer in the next service, then the DB writes. Each step links to `file:line`.

Styling:
- solid lines are verified in code;
- dashed lines are only in docs;
- red marks a conflict;
- a legend is on every diagram.

**The `diagram` view** (new, sandboxed like the others):
- tabs per diagram (Context, Container, Sequence: refund);
- pan and zoom;
- light and dark themes;
- each element's provenance on hover;
- download of the SVG or the source (PlantUML, Mermaid, Structurizr).

## 6. Demo with mock data

`demo/mock.js` gets a Confluence API (Server-style REST), consistent with the demo's services, topics and tables:
- a space `SHOP` with ~10 pages:
  - an architecture overview with a draw.io attachment;
  - "Order flow" with a PlantUML macro;
  - "Payments" and "Refunds" feature pages with tables of rules, error codes and limits;
  - a runbook;
  - an ADR;
  - an old page version.
- a PNG with a caption, to show the vision-off path;
- one planted conflict: a page says payment-service calls fraud-service; the code doesn't.
- labels and page links.

A scripted demo question in `mock-llm.js`, "How do refunds work?", calls `feature` and shows quotes with links, C4 container, a sequence diagram of `POST /api/payments/{orderId}/refund`, and the gap.

Tests:
- offline: parsing, blocks, linking, quote checking and the diagram model;
- live: sync against the mock, incremental update, deleted pages, the rendered SVG of each format.

## 7. Steps

1. Cache and incremental sync (mock and real API), storage-format parser to blocks, `docs_page`.
2. Index (contextual BM25 and optional embeddings), `docs_search` with extractive compression and quote checking.
3. Pictures: draw.io / Gliffy / PlantUML / Mermaid structure; vision for raster images, optional.
4. Graph: entity linking to passports and catalogs, provenance, conflicts.
5. Diagram model, PlantUML / Mermaid / Structurizr writers, server-side PlantUML rendering, the `diagram` view.
6. `feature`: evidence, model, views, gaps; agent prompt; demo question and screenshots.

## Decisions for you

- **Confluence flavour:** Server/DC or Cloud? Both are planned; the first one tested against real data matters.
- **PlantUML rendering:** `plantuml.jar` in dt's JDK (recommended, nothing new to run) or a Kroki container?
- **Embeddings:** off by default (BM25 with context is strong on technical docs), or on via your LLM endpoint?
- **Vision for raster images:** off by default; on when you have a vision-capable model you may send page images to.

## Sources

- [Contextual retrieval, hybrid BM25 and rerank figures](https://www.besthub.dev/articles/boost-rag-retrieval-accuracy-with-contextual-embeddings-and-bm25-2391d92ba801)
- [EXIT: context-aware extractive compression (ACL 2025 Findings)](https://aclanthology.org/2025.findings-acl.253.pdf)
- [GraphRAG-Bench (indexing and retrieval times)](https://arxiv.org/pdf/2506.02404)
- [When to use graphs in RAG (prompt sizes)](https://arxiv.org/pdf/2506.05690)
- [Structure-aware chunking for tabular data](https://arxiv.org/pdf/2605.00318)
- [MultiDocFusion: parent-child structure in chunking](https://arxiv.org/pdf/2604.12352)
- [PlantUML layout engines (ELK, Smetana)](https://plantuml.com/layout-engines)
- [Open WebUI: Mermaid rendering in chat](https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/mermaid)
