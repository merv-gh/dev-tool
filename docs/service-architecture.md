# Service architecture dossier

`architecture_service` collects a service's known boundaries, reachable entry-point paths, requirements and environment observations into one scoped, immutable artifact. The same interactive view is available in Open WebUI, Admin → Architecture → **Collect a service architecture dossier**, and the service showcase. Collection does not publish to the global knowledge base.

```sh
node cli.js tool architecture_service '{"service":"checkout-service","env":"dev"}'
# Observe the returned owned job without starting another collection:
node cli.js tool architecture_service '{"job":"<returned job id>","waitMs":30000}'
```

The model receives counts, coverage, source identity, gaps and links. The viewer contains the full bounded connection inventory, searchable table, per-entry graphs and independent boundary paths, documentation citations, deployment snapshots and optional Joern evidence. Exports include a C4 container diagram in PlantUML, per-entry sequence PlantUML/Mermaid, SVG/PNG, and the complete JSON dossier.

## What it collects

- Passport HTTP endpoints, Kafka consumers/producers, tables and access modes, outbound API calls, database functions and Elasticsearch indices. Effective manual corrections retain their provenance; stale flow summaries do not overwrite those corrections.
- Entry points discovered from pinned code: HTTP handlers, Kafka listeners, scheduled tasks and supported event/queue listener annotations. The native graph follows actual indexed call/dispatch edges through the selected service and its pinned libraries. It retains branches, cycles, source files and line numbers, unresolved handlers, overload ambiguity and library version gaps.
- One representative reachable path per discovered boundary operation, with the reachable graph available for inspection. Database reads are marked as dependencies; writes, publications and outbound calls remain distinguishable. This does not enumerate every possible execution trace or establish runtime feasibility.
- Cached Confluence evidence found by service, feature keywords and boundary names, plus related shared architecture explanations. Blocks retain IDs, source revisions and links. Normative text is labeled as a requirement candidate; implementation satisfaction remains unverified. Literal entity mentions can link requirements to relevant flows without claiming they implement the requirement.
- Recorded Consul replicas, health, version/commit metadata, available resource measurements, and observed HTTP routes. Wire-to-source attribution is a candidate match. Source SHA, deployed SHA and runtime request evidence remain separate.

Source collection uses the current cached passport by default and builds it if absent. `refresh_passport: true` explicitly refreshes it. `revision` selects an exact retained passport commit; an unavailable revision fails instead of silently using the latest source. Refreshed/missing passport work is owned by the collection and cancels with it.

## Joern enrichment

By default, the collector reuses retained analyses matching the exact service/library source closure, language and selected environment. If coverage is missing, it starts the configured Joern worker automatically, waits inside the collection job, then runs enrichment. Java service/library sources are parsed together when building a missing closure. Source revisions are pinned before parsing; a newer passport or default branch cannot silently replace them. Existing generations are retained and no forced reparse is requested.

`joern: false` skips parsing and deep queries while listing compatible retained coverage. `analyses` explicitly selects retained analysis IDs and disables automatic parsing; mismatched commits, environments or unrelated composite sources are rejected. Missing or unavailable workers and failed parses produce explicit gaps, preserving the native dossier. Enable the bundled worker with the standard `run.sh` setup or configure `semantic.url` and `semantic.token` as described in [semantic setup](semantic-code.md#enable). The saved `semantic.indexing` metadata identifies the parser job and its outcome.

For a supported native path, the collector resolves the entry's source parameter location and the boundary call's exact source location, then issues a named retained-CPG `dataflow` query. Supported local value paths, ambiguity, coverage gaps and links to guards/source evidence are stored beside the native path. Native call reachability is never upgraded into Joern value-flow or runtime proof. Cross-CPG support still depends on the existing reviewed bindings and semantic query capabilities. Missing workers, incompatible engines or unsupported paths remain explicit gaps.

The default budget is 12 local semantic queries, configurable with `semantic_queries` (maximum 40). A collection is an owned, nonblocking job: observe through `architecture_service job=...`, inspect it in Admin Jobs, and cancel through `job_cancel` or the Admin button.

## Documentation and live reads

Cached documentation searches are lexical and do not invoke a model, embedding provider or remote mirror. At most 12 cached lexical searches are attempted per collection. `query` adds feature/requirement terms; `spaces` restricts Confluence spaces. `live_docs: true` additionally performs one bounded, read-only Confluence search for up to five pages using configured authentication. Page content is parsed as data, never executed or followed as instructions. It remains private evidence in this result; collection does not alter the shared architecture knowledge base or publish remote content.

Missing or stale sources stay visible in coverage. An empty documentation result is not proof that no requirements exist. A documentation/code mismatch is a coverage gap, not proof of a production contradiction.

## Bounds, snapshots and access

The inventory is capped at 10,000 connections and 500 discovered entries. Native traversal defaults to 100 entry graphs and depth 20 (`max_flows` ≤ 500, `depth` ≤ 40), with per-entry node/edge/path and shared graph budgets. The rendered graph is capped at 250 nodes and 500 edges; the full collected inventory remains in JSON. Documentation defaults to 40 blocks (`docs_limit` ≤ 100), with byte limits. The result has a 12 MiB payload budget; narrow a large collection if that budget is exceeded. Coverage and budget gaps are retained; bounded results do not claim completeness.

Heavy native traversal uses the existing bounded worker. Cancellations abort child source/semantic work. Users and chats retain separate jobs, result links, manual overlays and semantic analyses. Navigating a saved dossier or exporting another view uses its retained snapshot; it does not refetch sources or borrow newer code. Global publication remains a separate admin-only `architecture_save` operation.

## Demonstration and checks

```sh
node demo/service-architecture.js 4050
```

This starts a fresh demo with real static indexing over the bundled Java fixture. Its documentation and environment values are explicitly synthetic. The fixture covers HTTP/Kafka/scheduled entries, SQL reads/writes, Kafka output, Feign HTTP and Elasticsearch saves. The command prints the viewer and Admin URLs. No Docker is needed; Joern remains optional.

`test/service-architecture.test.js` verifies actual native graph paths, branch separation, overload/revision gaps, requirements, named CPG query locators, owned jobs and exports. `dev/check-service-architecture-browser.js` exercises the running demo, including Admin, reader inline sandbox, desktop/mobile behavior and download formats.

For real Joern validation, set `DT_SERVICE_ARCHITECTURE_LIVE_URL` and `DT_SERVICE_ARCHITECTURE_LIVE_TOKEN`, then run `node --test test/service-architecture.live.test.js`. This collects the fixture from an empty analysis cache, checks that the collector itself creates the CPG and queries actual Joern value paths, then verifies that another collection reuses the same analysis generation. A fresh temporary home is used unless `DT_SERVICE_ARCHITECTURE_LIVE_HOME` is set.

The [recorded live validation](benchmarks/service-architecture-e2e.json) collected five entries, 13 native boundary paths, five documentation blocks and six supported local value paths from eight real Joern queries. Consul and requirement inputs in that run were synthetic fixtures; runtime feasibility remains unknown.
