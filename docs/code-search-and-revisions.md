# Service code search, revision safety and graph integration

## Tools already available

The shared registry exposes `code_index`, `code_search`, `code_symbols`, `code_read` and `impact` through CLI, MCP, HTTP and OpenAPI. The `develop` profile includes all five. `direct` exposes common searches and reaches other tools through discovery. The optional external code-review-graph server has a separate MCP/OpenAPI surface connected to Open WebUI by Compose; it is not silently added to dt's registry.

```sh
node cli.js tool code_index '{"service":"orders-service","ref":"v1.2.0"}'
node cli.js tool code_search '{"repo":"SHOP/orders-service","pattern":"EventPublisher"}'
node cli.js tool code_symbols '{"repos":"SHOP/orders-service","q":"OrderService place"}'
node cli.js tool impact '{"repos":"SHOP/orders-service","target":"OrderService#place"}'
node cli.js tool code_index '{"versions":true}'
```

Use the returned `revisionKey` as `repos` (or `repo` for `code_read`) to pin searches and impact to that exact retained source/index pair. A plain repository name selects its latest alias. A cached full SHA lookup returns a pinned index without moving that alias. If several extraction/source variants share a SHA, the tool does not silently pick one. Use an exact revision key or rebuild with the intended options.

## Cold checkouts and passport jobs

`code_search` accepts `repo` for one repository, service alias, workspace, or exact retained revision. The existing `repos` selector still supports several repositories and globs. One-source results put the repository name in `repository` once; their preview and saved table omit the repeated `repo` column. Multi-source results retain it.

Indexed sources use the native trigram search, not system grep. When local source is present without an index (including a dirty workspace), search uses `rg` if it is on PATH, or the binary selected by `DT_RG`. No fetch or index build is started. A stock deployment without ripgrep uses the bounded native file scanner and reports `native-scan` in `backends`; it does not invoke ordinary `grep`. Literal searches get ripgrep's content prefilter. JavaScript regexes use native regex matching in the worker after file enumeration, preserving syntax such as lookbehind. Hidden directories, build output, symlinks and files larger than 1 MiB are excluded. Cold scans have file, byte and time limits and report truncation. A missing immutable revision never falls back to the latest checkout.

`passport` returns cached data immediately. A cold build or `refresh: true` returns an owned job ID immediately, with progress and cancellation in Admin. Poll with the same `service` and `job`; repeated matching requests join the active job. Cached reads stay available during a refresh. CPU extraction, indexing and flow analysis run in the bounded worker while network resolution remains asynchronous.

Internal-library resolution lists refs once per repository, tries matching version tags/branches, and then checks module/root `build.gradle`, `build.gradle.kts`, `gradle.properties` and `pom.xml`. Build-file reads and missing-version results are reused within a build. Defaults limit probing to 10 seconds, eight branches and 32 requests per distinct module/version; `passports.libraryVersionTimeoutMs`, `libraryVersionMaxBranches` and `libraryVersionMaxRequests` configure these bounds. Advertised-ref lookup has a 15-second deadline, and library fetch commands use `passports.libraryFetchTimeoutMs` (60 seconds by default). A missing version, timed-out lookup, or stale ref falls back to the latest default branch. `exactVersion: false`, resolution metadata, job trace notes and the passport page make that approximation explicit. Cancelling a job stops resolution rather than starting fallback work.

## Revision behavior

Fetched full-commit indexes retain their indexed source files, binary trigram postings, symbol graph and manifest together. Content, extraction settings and dependency bindings determine the snapshot fingerprint. Different source bytes at the same declared SHA get distinct snapshots and semantic identities. Publication stages the complete snapshot, then atomically replaces a small latest alias. A failed build retains the previous alias. Refresh never deletes historical snapshots. `code_index(versions=true)` exposes them; storage grows with retained revisions, and automatic pruning is deliberately absent.

An unchanged manifest avoids source reads and parsing. Returning to an older checkout hashes its source to verify it, then reuses its postings and graph. Branches and tags are still fetched to resolve their current SHA. Only an unambiguous cached full SHA can skip the fetch. New commits currently receive full native index builds; this is not a per-file incremental parser. Old caches created before snapshots cannot reconstruct already-overwritten source and must be rebuilt from the desired Git ref.

Mutable workspaces keep their existing in-place refresh behavior and content-derived identities. They are not immutable commit archives. Native source indexing covers supported text files up to 1 MiB each and skips hidden directories, build output and configured dependency directories; it does not preserve binaries or provide a build checkout.

Passports pin library module `index` values and their service `codeIndex` to snapshots. Service-scoped impact expands those pinned library indexes, including transitive libraries collected by the passport. Refreshing another service's library version cannot redirect those saved bindings to a newer checkout. Static Java/Kotlin resolution retains ambiguity and coverage gaps; text matches are not proof of a caller relation.

The optional graph bridge also builds against the pinned source snapshot, using the Compose graph service's code-cache mount. It returns `repo_root` for subsequent external graph queries. A cold snapshot receives a full build with minimal postprocessing; a successful graph database is reused on later calls. Different revisions receive different roots/databases. Partial/failed builds are not marked reusable. Restart/recreate the graph service after updating Compose so the new mount is present. Manual external graph calls against mutable repository roots retain that tool's own update semantics; use the root returned by dt for revision-safe queries.

The pinned external graph MCP smoke test found `PaymentService.create` as a candidate caller of `FeeCalculator.fee`, labeled `target_resolution: unresolved`. Its file-impact tool reported zero impacted nodes and one unresolved call site. This is a real coverage limitation: a zero radius is not proof that no callers exist. Native `impact` resolves the tested Java/library chain and remains the primary impact tool.

## Integration points

| Area | Repository files | Contract |
| --- | --- | --- |
| Tool API and profiles | `lib/tools-code.js`, `lib/tools.js`, `lib/tool-profiles.js` | Keep bounded outputs, exact revision selectors and existing tool names. |
| Native search backend | `lib/codeindex.js` | `build`, `load`, `select`, `grep`, `read`, binary `tri.bin`; snapshots and latest aliases. |
| Symbol/caller evidence | `lib/codegraph.js`, `lib/semantic-identity.js`, `lib/impact.js` | Java/Kotlin calls and canonical repo/revision/overload identities. |
| Dependency discovery | `lib/bbindex.js`, `lib/passport/index.js` | Maven/Gradle artifact/module/version lookup, transitive fetching and pinned library keys. |
| Workspaces and flow tests | `lib/workspace.js`, `lib/flows.js`, `lib/testgen.js` | Working-source refresh and library source reuse. |
| Git transport | `lib/git.js` | Ref/SHA resolution, authenticated fetch and local reuse. |
| Optional review graph | `lib/passport/index.js:graphBuild`, `docker-compose.yml` | Per-revision build root; separate external query/review tools. |
| Runtime configuration | `lib/config.js`, `docker-compose.yml`, `.env.example` | An optional backend needs explicit configuration and deployment wiring. |

## Where Zoekt would help

Zoekt is a potential estate-wide text-search backend; it is not currently configured or required for native service/library impact. Start by benchmarking candidate-repository selection and textual mentions across the actual estate. Keep dt's symbol and passport graph for semantic caller traversal.

An adapter would need:

1. An asynchronous search boundary above the tool facade. `CI.grep` and impact's current repository preselection are synchronous; an HTTP client cannot simply be dropped into that function. Prefetch bounded candidate repositories before traversal, or refactor the facade and scoped graph loader together.
2. Exact repository/ref-to-SHA provenance on every result. Zoekt supports repository and branch filters, but a branch name alone is not an immutable revision. Verify indexed branch metadata against the requested SHA, and reject/fall back when it differs. The web API returns branch metadata separately; do not fabricate a commit field on file matches.
3. Bounded normalization into dt's existing repo/path/line/text/context DTO, with truncation, time budget, missing-revision coverage and an offline native fallback. Translate literal, regex, case and glob semantics explicitly; JavaScript regex and Zoekt regex are not interchangeable.
4. Artifact/version dependency bindings from passports and the Bitbucket module index. Search can discover candidate imports/call sites, but matching names must not merge different library revisions or become verified semantic edges.
5. A ref-aware indexing job, isolated output shards and atomic publication. Do not overwrite the last usable shard on a failed refresh or prune revisions still referenced by workspaces/passports. Add configuration, health, Compose and tool-discovery coverage only when the backend is implemented.

Primary upstream references: [Zoekt query syntax](https://github.com/sourcegraph/zoekt/blob/main/doc/query_syntax.md), [web API DTOs](https://github.com/sourcegraph/zoekt/blob/main/web/api.go), [Git indexing](https://github.com/sourcegraph/zoekt/blob/main/gitindex/index.go), [code-review-graph tool contracts](https://github.com/tirth8205/code-review-graph/blob/main/docs/COMMANDS.md).

## Verification

```sh
node --test test/code-revisions.test.js test/code.index.test.js test/flows.test.js test/impact-readiness.test.js
node dev/benchmark-code-revisions.js
uv run --python 3.12 --with code-review-graph==2.3.9 python dev/check-code-review-graph.py
```

The native benchmark generates 300 classes/6,000 methods and measures cold build, unchanged refresh, changed commit and return to an older commit. Tests verify saved reads/search/symbols after source replacement/deletion, rollback after a failed refresh, cached-SHA network avoidance, actual registered tools, and service-scoped impact after a library refresh. The optional MCP smoke test exercises the pinned graph package on the payments-service fixture and checks that another service's query cannot return its callers. These are synthetic checks, not a production-estate latency guarantee.
