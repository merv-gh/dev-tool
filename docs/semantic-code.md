# Semantic code, editable ports and retained commits

The optional Joern worker parses Java and JS/TS outside the tool server. dt ships its worker, query engine, views and analysis scripts together; file-projections is not a runtime service dependency. Native `code_search` continues to work without Joern.

## Enable

`git pull && ./run.sh up -d` enables the worker by default, including installations with older nonempty `COMPOSE_PROFILES` lists. The launcher creates a shared `DT_SEMANTIC_TOKEN` once, supplies `http://semantic:4110`, builds updated worker layers and recreates Node services when the bundle changes. `--no-semantic` or `DT_SEMANTIC_ENABLED=0` disables the local worker; `--tools-only` disables all optional services. Existing tokens and custom endpoints are preserved. Starting the worker does not parse repositories; `semantic_index` or the automatic missing-analysis step in `architecture_service` starts parsing.

For direct Compose use, set `DT_SEMANTIC_TOKEN` to a new secret of at least 16 characters and `DT_SEMANTIC_URL=http://semantic:4110`, then run `docker compose --profile semantic up -d --build semantic dt`. After source edits, run `npm run build` first. The worker has no published port or Docker socket; only dt needs its authenticated API. A separately hosted worker uses the same URL/token settings (disable the local worker with `--no-semantic`).

Use `./run.sh --no-webui up -d` to keep the worker and other configured supporting services while attaching dt to an existing Open WebUI. This skips the bundled chat and its setup job, unlike `--tools-only`, which skips all optional services.

The image pins Joern `4.0.564` by digest. The first build downloads that image and the Node runtime. The main app does not download or install analysis packages. Configuration can alternatively use `semantic.url`, `semantic.token` (an environment reference), `semantic.timeoutMs`, `semantic.waitMs` and `semantic.maxProjectionBytes` in `config.json`.

Default worker reservations are 12 GiB per parse, 6 GiB per query and 24 GiB total, in a 26 GiB container. JVM heap uses about two thirds of the reservation. `DT_SEMANTIC_PARSE_MEMORY_MB`, `DT_SEMANTIC_QUERY_MEMORY_MB`, `DT_SEMANTIC_MEMORY_MB`, the corresponding `*_CONCURRENCY` settings, `DT_SEMANTIC_CONTAINER_MEMORY` and `DT_SEMANTIC_CPUS` tune admission and container limits. Leave headroom for native AST generation and the OS. Two independent slot pools share the memory budget and rotate between waiting owners. Deep queries have a hard deadline including a bounded startup allowance.

## Tools and revisions

For before/after feature work, see [branch data-flow comparison and verification](joern-branch-comparison.md). Comparisons can select a method parameter and a particular sink argument. Model JSON is compact by default; full evidence stays in the inline view.

- `semantic_capabilities`: configured engine, supported operations and last observed worker limits.
- `semantic_index`: build from an existing `revisionKey`, repository index or pinned service passport. A service includes its pinned libraries. `composite:true` parses their Java sources together and preserves each source's repository, SHA and location. Without a target, list analyses; `versions:true` includes retained generations. `reparse:true` creates a new generation.
- `semantic_search`: symbols or ports, with exact analysis/revision-set selectors and paginated compact results.
- `semantic_query`: callers, callees, neighborhoods, paths, slices, guard evidence, revision comparisons and entry-to-exit state maps (`operation:"flowmap"`). Choose `reachability`, `controlflow` or `dataflow`; inspect the returned proof status and gaps.

Indexing and expensive queries return an owned job quickly. Observe with the same tool and `job`, or inspect/cancel through the existing jobs/runtime tools. Cancelling stops queued or running Joern work and waits for process cleanup. Resource exhaustion is a visible failure; it does not start an unbounded retry loop.

Use the returned `revisionSet` or `analysis` ID in subsequent queries. The cache key includes source content, commit, dependency bindings, language, engine image/version and script digest. Composite keys include all origins. Each generation retains its binary CPG on the worker and its streamed projection/manifest in dt. Compact SQLite navigation is built from that projection outside the request thread. A failed or cancelled build leaves previous generations and aliases intact. There is no automatic deletion of pinned semantic history.

Changed commits currently receive a full Joern parse. Unchanged inputs reuse their saved generation. This is not a per-file incremental linker. Published aliases are distinct from exact retained IDs; use exact IDs for reproducible investigations. A missing pinned source never silently selects a newer library version.

## Correct missed or incorrect detections

`semantic_ports` lists typed HTTP ingress/egress, Kafka consume/produce, database read/write, scheduled callbacks and internal-library ports. `passport_adjustments` reads original detections, effective ports, a revision and correction history. `passport_adjust` adds, corrects or disables a port with a reason and `expected_revision`; use null only for a new overlay identity. A concurrent change returns a conflict rather than overwriting someone else's edit.

Corrections are separate from generated passport JSON and survive refresh. They belong to the authenticated principal/story and the exact service/environment/repository/commit identity. Passport description, owners, tags and notes are editable through the same revision/history contract. Missing source or transport locators remain explicit gaps. Shared catalog rebuilds use original detections; private edits are composed at read time. Manual evidence stays labeled `declared` and never becomes observed runtime proof. HTTP `base_path:""` records a known empty prefix; null means unknown. Exact `handler.call` source locators bind egress ports to concrete value arguments.

In Admin, **Semantic & ports** provides editable tool arguments, job progress/cancel, retained analysis selection and guided port operations. The passport page shows effective ports and links to that editor. Open WebUI receives native inline semantic and port views with the normal sandboxed result transport. Routine indexing summaries collapse; paths, evidence, guards and failures remain inspectable without long file listings.

The service showcase includes effective ports, passport metadata/history and retained semantic analyses, with a direct editor link. These are local reads and do not implicitly enqueue a parse. Its sections collapse independently; selecting a step reveals the corresponding section.

## Meaning and limits

Call reachability, control-flow paths and value flow are distinct. Deep value slices execute Joern against the retained enriched graph. Distributed paths use explicit environment-qualified ports, dependency bindings and field mappings. Unknown dispatch, schema/mapping gaps and alternate implementations remain visible. A table read is a data dependency, not proof that a table write triggers a service; scheduled callbacks have separate control edges.

Guards and validation calls are source evidence. A condition's presence does not prove enforcement on every path, feasibility, transaction commit or universal business invariants. Assertions retain their applicable region and status. Manual declarations, static candidates and actual test/trace observations must remain distinguishable.

Scopes are enforced for worker jobs, retained analyses, saved results, cancellations and manual corrections. The worker API accepts only vendored named queries. Raw Scala is not a normal tool, and a Joern interpreter is not used as a security boundary.

For a whole entry investigation, [entry-to-exit state maps](entry-exit-flow-map.md) retain decisions, data changes, callee bindings, exits, boundary evidence and assumptions in one navigable view.

## Verification

`node --test test/semantic-runtime.test.js test/semantic-query.test.js test/passport-overrides.test.js test/semantic-ui.test.js` covers cache/runtime behavior, query semantics, editing and presentation. The exact available test files are discoverable under `test/semantic*`.

Set `DT_SEMANTIC_LIVE_URL` and `DT_SEMANTIC_LIVE_TOKEN` and run `node --test test/semantic.live.test.js` for real Joern parsing, saved-CPG value queries, transitive Java source origins, TypeScript, new Git commits/reparse, manual evidence and Open WebUI's actual inline HTTP response. Without those settings the live test is explicitly skipped. Test reports do not imply a production-sized latency guarantee.
