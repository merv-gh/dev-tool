# Integrated developer platform: implementation and boundaries

Updated 2026-10-29. The implementation is integrated on `codex/openwebui-dev-platform` in a separate worktree. Confluence, capture/performance, PostgreSQL templates, scenario execution, collection suites, browser/API work and independent reviews were developed in separate worktrees. The original checkout is unchanged.

The [independent completeness review](developer-tool-completeness-review.md) contains 143 acceptance items, including future adapters. This document records actual implementation; it does not mark that entire inventory complete.

## Workflows available now

| Need | Implemented composition | Evidence boundary |
| --- | --- | --- |
| Large Open WebUI tool catalog | Compact discovery, named profiles, exact tool descriptions, validated dispatch and versioned contract catalog | Profiles reduce model context; they do not grant permissions or re-enable disabled tools |
| Replace an engine or storage backend | Per-tool/exact-prefix HTTP adapters, request identity and result validation, local graph presentation | Contract-preserving workers can use other languages/databases; no new RAG engine is supplied |
| Understand architecture without a mandatory mirror | Independently refreshed Markdown, normalized JSON, OpenAPI and AsyncAPI sources joined with cached passports/catalog facts; optional Confluence | Stable scoped identities, directed verbs, source revisions, historical exact quotes, ambiguity/stale-source gaps; static evidence is not runtime proof |
| Reproduce related state | Indexed schema discovery, explicit cross-database relationships, bounded FK traversal/Kafka correlation, consistent masking, hashed SQL/event exports under test resources | Independent source reads and bounded Kafka windows do not establish a distributed point-in-time snapshot |
| Reuse prepared PostgreSQL state | Immutable keyed prefilled bases, private lease-bound clones, fresh-clone reset, renew/release/pin/invalidate/GC, migration setup modes | Only explicitly initialized owned scratch resources are managed; SQL snapshot reconstruction has documented PostgreSQL fidelity limits |
| Check a passport scenario piece by piece | Inventory, each read binding/capture, action inputs, expectations, contract emulation, export, portable package/import/verify/diff/explain/preflight | Static inventories retain unknowns. Local model emulation is a separate proof level |
| Execute the actual application | Isolated Node HTTP/config/file lifecycle; project-test adapter with package-bound independent observations and actual PG/JVM fixture replay | Node container isolation and project build proof remain distinct; broader native protocols require adapters |
| Improve scripts/collections | Typed inputs, structural assertions, exact preflight, nested ordered dataset/matrix suites, bounded retry/poll, true finally cleanup, cancellation, revisioned history, JUnit/CI export | Arbitrary JS hooks cannot be fully resolved statically; collection browser parallel isolation is not supplied |
| Connect UI investigation to reusable APIs | Playwright capture/actions, HAR/network import, route candidates, sanitized exchanges, typed request preparation, explicit replay, normal script/collection save | Credentials are runtime placeholders; capture gaps and ambiguous gateway routes stay visible |
| Inspect results visually | Knowledge map, API client and response explorer, fixture graph, collection report, scenario stages/evidence and architecture diagrams | Snapshot embeds have no live network capability; editable API requests use the separate trusted client URL |
| Faster development loop | Changed/local/watch test selection, cached indexes/manifests/catalog/usage loads, existing fast Maven compiler/JUnit path, prefilled DB clones | Full builds, bundle freshness and explicit live checks remain the verification gate |

See [Open WebUI setup](openwebui-workflows.md), [composable contracts](composable-architecture.md), [browser/API workbench](browser-api-workbench.md), [collection suites](collection-suites.md), [PostgreSQL templates](postgres-templates.md), [portable runtime](scenario-runtime.md), [capture/replay](reproduction.md), and [performance measurements](dev-performance-plan.md).

## Independent review corrections

Review fixes include strict replacement-backend result/error contracts, unsupported-schema assertion rejection, missing-entity completeness gaps, default collection evidence minimization and credential echo redaction. Runtime review prevents a Docker inspection failure from looking like successful cleanup and prevents an HTTP observer from satisfying a file-effect expectation. New regressions exercise these negative cases.

API review additionally fixed bodyless GET/HEAD execution after saving, prepared assertions/captures/hooks and provenance retention, case-insensitive header bindings, repeated form secrets and captured-credential echoes, bounded failed/pending response capture and consistent navigation checks. Native Playwright capabilities and element-reference fields are selected from the endpoint's discovered schemas.

## Verification

The integrated live database/runtime group passed **57 tests with no skips or failures** using disposable PostgreSQL 16, Docker, Java 21 and Maven. It covers actual two-database Java code reading captured rows and saved Kafka envelopes, strict expectation mismatch despite passing project tests, isolated HTTP/file execution, forbidden egress, async effects, readiness compensation, parallel session leases, template clone isolation, cancellation, process-death recovery, domain/constraint verification and GC ownership.

The final rebuilt default suite passed **361 of 405 tests, zero failures, 44 explicit opt-in skips** in 27.57 seconds. Separately, all **four live JVM workflow suites** passed with no skips: fast red/fix/green/full-build proof, library/controller flows, generated test data and database tests, and workspace/impact/fix/patch proof. The measured unchanged Maven rerun was 1.55 seconds versus a 19.66-second full build on the small fixture project; cold preparation and edited runs are separate timings.

The **real Playwright MCP/Chromium workflow passed** with the default v0.0.83 browser image and no extra unsafe capability: UI click → JSON/headers → `OrderController.get` route attribution → explicit HTTP replay → saved GET collection script with two assertions. Cookies remained browser-only; persisted exchanges/scripts excluded the seeded credentials. The API request saved during the separate desktop/mobile UI check also executed successfully through the normal `script_run` tool. These live groups are separate executions and overlap default test definitions; their counts are not a combined count of unique tests.

Performance observations from the committed benchmark: unchanged index rebuilds improved about 13×, manifest loads 57×, catalog searches 4.3× and PG usage-index loads 919× on the measured local dataset. A two-database/1,000-row PostgreSQL template benchmark measured cold preparation p50 4,629 ms versus warm allocation 357 ms and fresh-clone reset 714 ms (three samples). These are local observations, not universal latency guarantees.

Desktop and 390-pixel mobile browser checks exercise the API editor/send/save path and the knowledge, collection and scenario views. The knowledge zoom uses a scrollable full canvas; no-body requests keep the response visible without a large empty editor. All demo traffic and database writes use disposable local environments.

## Remaining acceptance work

The next distinct implementation units are below; each has an acceptance target in the original inventory. They are explicit gaps rather than implied capabilities.

1. **Capture consistency and entity lineage (C01–C04):** per-database transaction snapshots/change detection, explicit relation tuples across tables/databases, tenant scoping policies and full payload codec/schema validation. Test adversarial concurrent mutations and unrelated captured order/customer pairs before claiming complete reproduction.
2. **Native dependency/runtime adapters (B/E/F):** real broker consumer groups/readiness/offsets/transactions and schema registry codecs; native JVM network containment/read instrumentation; Elasticsearch, cache and queue adapters. A real local Kafka broker is not replaced by replaying saved envelopes through a project test listener.
3. **Runtime coverage and deterministic execution (B01–B06):** reconcile dynamic reads against the passport, action-specific dependency sets, injectable clocks/randomness and compiler-backed resolution. The current runtime does not claim all possible microservice dependencies have been discovered.
4. **Retained debugging and guided editing (H/I):** debugger attachment, retained process snapshots, a full graphical binding editor, richer request diff/search and persisted environment-specific client presets. Existing leases, inspect tools and downloadable evidence provide reusable foundations.
5. **Requirement/test traceability and team governance (J–O):** reviewed structured test obligations from cited rules, change approval/ownership, CI capacity policy and representative protocol compatibility matrices. Semantic sources preserve the required identities/provenance but do not automatically decide business expectations.

Implement each adapter behind the existing stage/tool contract, expose its capability and preflight separately, and add a real positive/negative integration test before upgrading a proof or completeness label. The platform can be useful across architectures while reporting unsupported parts honestly.

With the repository's default enabled sources, the measured initial catalog is 159 tools / 114,229 JSON characters versus 11 tools / 6,991 characters for `compact` (about 94% less schema text). Counts vary with configured systems/plugins and future tools. The `api` profile exposes the combined browser, request and collection workflow; compact discovery can still find and execute those same enabled operations.
