# Executable state contracts

This is the implementation map for the [state-machine audit](state-machines.md).
The audit and its source hashes describe commit `5c33058`; its line numbers remain
historical evidence. Paths in this document describe the working implementation.

`web/state-machine.js` is the dependency-free engine used by Node and browser
controllers. `lib/lifecycles.js` owns server transition tables. State restoration
accepts a known state without replaying old effects. Mutations of bound records
validate edges, preserve their JSON shape, and reject terminal-state revival.
Illegal transitions carry `DT_STATE_TRANSITION`; unknown labels carry
`DT_STATE_UNKNOWN`. Reasserting the current state is idempotent.

The [runtime catalog](benchmarks/state-machine-runtime.json) records all 88 audit
families, their runtime owners and the executable charts. Regenerate its charts
with `node dev/state-machines.js`; verify them with `node dev/state-machines.js --check`.
A family can include several related protocols. The charts enforce lifecycle
ordering; ownership, compare-and-swap revisions, locks, deadlines, counters,
physical resource identities and artifact validation remain separate guards.
A label alone never authorizes a write, proves cleanup, or establishes success.

## Runtime ownership

| Family | Runtime owner | Explicit representation |
| --- | --- | --- |
| SM01 · Owned invocation and cleanup | [lib/execution.js](../lib/execution.js) | SM01.* (see charts) |
| SM02 · Background job wrapper and recovery | [lib/jobs.js](../lib/jobs.js) | SM02.* (see charts) |
| SM03 · Trace spans and process-tree termination | [lib/trace.js](../lib/trace.js), [lib/process-tree.js](../lib/process-tree.js) | SM03.* (see charts) |
| SM04 · Fair CPU/code/build admission | [lib/limit.js](../lib/limit.js) | SM04.* (see charts) |
| SM05 · Per-target network admission | [lib/limit.js](../lib/limit.js) | SM05.* (see charts) |
| SM06 · Heap-limited worker pool | [lib/isolate.js](../lib/isolate.js) | SM06.* (see charts) |
| SM07 · Node sandbox session and tool RPC | [lib/js.js](../lib/js.js) | SM07.* (see charts) |
| SM08 · Owned code cell, output cursor and observation | [lib/js.js](../lib/js.js) | SM08.* (see charts) |
| SM09 · QuickJS worker settlement | [lib/quickjs.js](../lib/quickjs.js) | SM09.* (see charts) |
| SM10 · Remote build runner and endpoint circuit | [lib/runner.js](../lib/runner.js) | SM10.* (see charts) |
| SM11 · Operational-store owner worker lifecycle | [lib/state-store.js](../lib/state-store.js) | SM11.* (see charts) |
| SM12 · Metadata acceptance, projection and durability | [lib/state-store.js](../lib/state-store.js) | SM12.* (see charts) |
| SM13 · SQLite migration and restart reconciliation | [lib/state-worker.js](../lib/state-worker.js) | SM13.* (see charts) |
| SM14 · Configuration last-good generation and pinned calls | [lib/config.js](../lib/config.js) | SM14.* (see charts) |
| SM15 · Tool registry and remote plugin activation | [lib/tools.js](../lib/tools.js) | SM15.* (see charts) |
| SM16 · Authenticated request scope and result handoff | [lib/access.js](../lib/access.js) | SM16.* (see charts) |
| SM17 · Server MCP request correlation and disconnect cancellation | [server.js](../server.js) | SM17.* (see charts) |
| SM18 · Playwright MCP session handshake and requests | [lib/browser-mcp.js](../lib/browser-mcp.js) | SM18.* (see charts) |
| SM19 · SFTP connection and stream operation lifetime | [lib/files.js](../lib/files.js) | SM19.* (see charts) |
| SM20 · Read-only PG connection and cancellable transaction | [lib/pg.js](../lib/pg.js) | SM20.* (see charts) |
| SM21 · Scratch-cluster initialization and ownership adoption | [lib/testdb.js](../lib/testdb.js) | SM21.* (see charts) |
| SM22 · Scratch database and application-role lifecycle | [lib/testdb.js](../lib/testdb.js) | SM22.* (see charts) |
| SM23 · Immutable PostgreSQL template lifecycle | [lib/testdb-templates.js](../lib/testdb-templates.js) | SM23.* (see charts) |
| SM24 · Private DB lease and expiry | [lib/testdb-templates.js](../lib/testdb-templates.js) | SM24.* (see charts) |
| SM25 · Lease reset and template/lease garbage collection | [lib/testdb-templates.js](../lib/testdb-templates.js) | SM25.* (see charts) |
| SM26 · Native PG/Kafka/ES fixture runtime | [lib/reproduction-runtime.js](../lib/reproduction-runtime.js) | SM26.* (see charts) |
| SM27 · Native fixture independent-effect contract | [lib/reproduction-runtime.js](../lib/reproduction-runtime.js) | SM27.* (see charts) |
| SM28 · Scenario container session lifecycle | [lib/scenario-runtime.js](../lib/scenario-runtime.js) | SM28.* (see charts) |
| SM29 · Scenario per-action execution and request emulation | [lib/scenario-runtime.js](../lib/scenario-runtime.js) | SM29.* (see charts) |
| SM30 · Temporal assertion quiet-window protocol | [lib/scenario-runtime.js](../lib/scenario-runtime.js) | SM30.* (see charts) |
| SM31 · Capture → validate → export → replay | [lib/reproduction.js](../lib/reproduction.js) | SM31.* (see charts) |
| SM32 · Scenario binding, emulation and portable package | [lib/scenario-state.js](../lib/scenario-state.js) | SM32.* (see charts) |
| SM33 · Script scope/hooks/steps/finally lifecycle | [lib/scripts.js](../lib/scripts.js) | SM33.* (see charts) |
| SM34 · Script retry/poll subprotocol | [lib/scripts.js](../lib/scripts.js) | SM34.* (see charts) |
| SM35 · Collection run, inherited hook scopes and cases | [lib/collections.js](../lib/collections.js) | SM35.* (see charts) |
| SM36 · Git resolution, reuse and fallback | [lib/git.js](../lib/git.js) | SM36.* (see charts) |
| SM37 · Workspace edit/index/patch/push/base/expiry | [lib/workspace.js](../lib/workspace.js) | SM37.* (see charts) |
| SM38 · Test execution and retained red/green/differential proof | [lib/testrun.js](../lib/testrun.js) | SM38.* (see charts) |
| SM39 · Fast Maven preparation and incremental compilation | [lib/fastrun.js](../lib/fastrun.js) | SM39.* (see charts) |
| SM40 · Warm compiler, classpath warmup and compile fixes | [lib/javacheck.js](../lib/javacheck.js), [lib/keyed-work.js](../lib/keyed-work.js) | SM40.* (see charts) |
| SM41 · Immutable code-index publication and lazy cache ownership | [lib/codeindex.js](../lib/codeindex.js) | SM41.* (see charts) |
| SM42 · PG catalog generations, migration and lazy pages | [lib/pgstore.js](../lib/pgstore.js) | SM42.* (see charts) |
| SM43 · Environment sync and derived-index freshness | [lib/indexer.js](../lib/indexer.js) | SM43.* (see charts) |
| SM44 · Passport build and internal-library resolution | [lib/passport/index.js](../lib/passport/index.js) | SM44.* (see charts) |
| SM45 · Remote Joern admission/upload/parse/query job | [lib/semantic-worker.js](../lib/semantic-worker.js) | SM45.* (see charts) |
| SM46 · Local retained analysis and latest-generation publication | [lib/semantic-code.js](../lib/semantic-code.js) | SM46.* (see charts) |
| SM47 · Semantic query, worker budgets and continuation | [lib/semantic-code.js](../lib/semantic-code.js) | SM47.* (see charts) |
| SM48 · Confluence incremental refresh, retries and reconciliation | [lib/docs-cache.js](../lib/docs-cache.js) | SM48.* (see charts) |
| SM49 · Configured knowledge-source revision and evidence cache | [lib/semantic-knowledge.js](../lib/semantic-knowledge.js) | SM49.* (see charts) |
| SM50 · Operational architecture observation freshness | [lib/architecture-observations.js](../lib/architecture-observations.js) | SM50.* (see charts) |
| SM51 · Self-context generated refresh and capture/save split | [lib/context.js](../lib/context.js) | SM51.* (see charts) |
| SM52 · Generated TestData versus manually retained resources | [lib/testdata.js](../lib/testdata.js) | SM52.* (see charts) |
| SM53 · Context creation/reuse/status and revision editing | [lib/context.js](../lib/context.js) | SM53.* (see charts) |
| SM54 · Archive/move with verified copy and compensation | [lib/files.js](../lib/files.js), [lib/context.js](../lib/context.js) | SM54.* (see charts) |
| SM55 · Passport metadata/typed-port overlay revisions | [lib/passport/overrides.js](../lib/passport/overrides.js), [lib/passport/edges.js](../lib/passport/edges.js) | SM55.* (see charts) |
| SM56 · Map-adjustment revision publication | [lib/map-adjustments.js](../lib/map-adjustments.js) | SM56.* (see charts) |
| SM57 · Shared architecture publish/archive/history | [lib/architecture-store.js](../lib/architecture-store.js) | SM57.* (see charts) |
| SM58 · Saved scripts, seeded starters and custom-view activation | [lib/views.js](../lib/views.js), [lib/scripts.js](../lib/scripts.js) | SM58.* (see charts) |
| SM59 · Sanitized exchange → prepared request → explicit send/save | [lib/api-client.js](../lib/api-client.js) | SM59.* (see charts) |
| SM60 · Browser API capture session and pending responses | [lib/api-client.js](../lib/api-client.js) | SM60.* (see charts) |
| SM61 · Retained result expiry and signed/keyed view access | [lib/results.js](../lib/results.js) | SM61.* (see charts) |
| SM62 · Admin identity/environment scope frontier | [web/admin-runtime.js](../web/admin-runtime.js) | Revision (applied scope generation) |
| SM63 · Context editor files/metadata/scratchpad/results | [web/admin-context.js](../web/admin-context.js) | Draft × Pending × Revision |
| SM64 · Runtime polling, selected execution and metadata annotation | [web/admin-runtime.js](../web/admin-runtime.js) | Dirty × Activity × Revision |
| SM65 · Semantic workbench and job observation | [web/admin-semantic.js](../web/admin-semantic.js) | Dirty × Activity × Revision |
| SM66 · Graph/list port CRUD editor | [web/port-editor.js](../web/port-editor.js) | Dirty × Activity × Revision |
| SM67 · Architecture publication and dossier editor | [web/admin-architecture.js](../web/admin-architecture.js), [web/architecture-ui.js](../web/architecture-ui.js) | Dirty × Activity × Revision |
| SM68 · Map host bridge, selection and tool inspector | [web/admin-map.js](../web/admin-map.js), [web/map.js](../web/map.js) | Revision (map/selection/inspection generations) |
| SM69 · API explorer request/auth/send/save draft | [web/api-explorer.js](../web/api-explorer.js) | Dirty × Revision |
| SM70 · Script/collection/view/config editor drafts and runs | [web/admin-scripts.js](../web/admin-scripts.js) | flag / editRevision × Activity × Revision |
| SM71 · Handbook draft, applied scope and persistent briefing | [web/handbook.js](../web/handbook.js) | Dirty × Activity × Revision |
| SM72 · Result selection, folder tree, filters, diff and graph interaction | [web/inline.js](../web/inline.js) | Selection; selected IDs and expanded/filter sets are payload |
| SM73 · Disclosures, overflow menus, keyboard focus and iframe resize | [web/inline.js](../web/inline.js) | UI.disclosure; native details.open mirrored on toggle |
| SM74 · Launcher/install/build/config-layout lifecycle | [run.sh](../run.sh), [install.sh](../install.sh), [build.js](../build.js), [lib/migrate.js](../lib/migrate.js) | POSIX case tables; SM74.bundle; SM74.config-migration |
| SM75 · Elasticsearch point-in-time capture lifetime | [lib/reproduction-es.js](../lib/reproduction-es.js) | SM75.* (see charts) |
| SM76 · Outgoing HTTP, read-host failover and one-shot adapter outcome | [lib/adapter-port.js](../lib/adapter-port.js), [lib/util.js](../lib/util.js) | SM76.* (see charts) |
| SM77 · Search backend availability and indexed/raw fallback | [lib/code-search.js](../lib/code-search.js) | SM77.* (see charts) |
| SM78 · Offline scenario/experiment program realm and RPC budget | [lib/offline-js.js](../lib/offline-js.js) | SM78.* (see charts) |
| P01 · Bounded JSON streaming and deferred-field scanning | [lib/pgstore.js](../lib/pgstore.js), [lib/codegraph-read.js](../lib/codegraph-read.js) | JSON_MODE.VALUE / STRING / ESCAPE × P01.descriptor |
| P02 · Packed map/string-table binary cursor | [web/map-format.js](../web/map-format.js) | P02.binary |
| P03 · Java/Kotlin/source/config lexical scanners | [lib/testdata.js](../lib/testdata.js), [lib/passport/extract.js](../lib/passport/extract.js), [lib/codegraph.js](../lib/codegraph.js) | P03.* (see charts) |
| P04 · SQL statement splitter and DDL dependency walk | [lib/testrun.js](../lib/testrun.js), [lib/ddl.js](../lib/ddl.js) | MODE.SQL / STRING / DOLLAR; dependency sets stay separate |
| P05 · MCP SSE and sandbox newline JSON framing | [web/state-machine.js](../web/state-machine.js), [lib/browser-mcp.js](../lib/browser-mcp.js), [lib/js.js](../lib/js.js), [lib/runner.js](../lib/runner.js), [lib/javacheck.js](../lib/javacheck.js) | P05.framing × request correlation IDs |
| P06 · Node/JUnit report event aggregation | [lib/node-test.js](../lib/node-test.js), [lib/testrun.js](../lib/testrun.js) | P06.* (see charts) |
| P07 · Confluence document tree/headings/block identity | [lib/docs-parse.js](../lib/docs-parse.js) | P07.* (see charts) |
| P08 · Bounded graph traversal, path feasibility and export layout | [lib/service-map.js](../lib/service-map.js) | P08.* (see charts) |
| P09 · Bounded page enumeration and batch-worker cursors | [lib/util.js](../lib/util.js), [lib/atlassian.js](../lib/atlassian.js), [lib/docs-cache.js](../lib/docs-cache.js) | P09.* (see charts) |
| P10 · Stack/log folding and source diagnostic parsing | [lib/testout.js](../lib/testout.js) | SECTION.HEADER / FRAMES × ORIGIN.BEFORE_REPO / AFTER_REPO |

## Independent dimensions

- Cancellation requests, process termination and cleanup completion remain separate.
  A late result cannot turn a cancelled execution or stopped worker back into success.
- Database resource, template and lease states use conditional SQL updates under the
  existing control lock. An expired active lease still requires ownership checks.
- Immutable index publication and updating the latest alias have different outcomes.
  Alias failure preserves the completed revision. Staging failure preserves prior indices.
- Runner connection failure permits fallback only before a connection is established.
  A reset after sending the command has an unknown outcome and cannot authorize a second run.
- Scenario actions reserve their one-use slot on disk before sending an HTTP effect.
  An unknown outcome retains that reservation. Assertions and invocation success differ.
- Atomic file installation means rename completed. It does not promise fsync durability.
  Metadata-store readiness, accepted writes, durable flush and close/retry have separate charts.
- Editor draft state, applied scope, pending count and response generation are independent.
  File and metadata drafts cannot clear each other; late saves cannot clear newer input.
- Parser modes and cursors use compact enums, stacks and visited sets. They do not allocate
  a machine for every byte, graph edge or catalog row. Library-owned parsers and third-party
  canvas internals retain their own protocols outside the first-party audit scope.

## UTF-8 at process boundaries

`lib/utf8.js` normalizes the runner environment at spawn time, after request/build
options have been merged. Linux containers use `LANG`, `LC_ALL` and `LC_CTYPE` set
to `C.UTF-8`; native macOS uses `en_US.UTF-8`. Java receives
`-Dfile.encoding=UTF-8`, and the compiler receives `-encoding UTF-8`. Other Java
options remain intact. The native locale controls filenames when the JVM starts;
changing only an HTTP charset cannot repair filenames decoded in the C locale.

Each text stream uses its own incremental decoder. Shared NDJSON/SSE framing
handles Unicode split across chunks, individual-record limits and incomplete EOF.
Raw code-search byte streams retain their existing byte decoder. The sterile
sandbox environment remains sterile; normalization never copies parent secrets
into a caller-supplied environment.

Compose applies the same UTF-8 settings to the tool server, build runner, JDK and
semantic worker, including the semantic Docker image. They are deployment defaults
as well as process-boundary enforcement, so caller options cannot accidentally
restore the ASCII locale.

## Regression evidence

The automated suite covers cancellation/draining, store flush failures and retry,
revision publication, context/file isolation, compiler fixes, Unicode protocol
chunks, stale editor reads/saves, one-use scenario actions and immutable indices.
Additional cases exercise competing file publication and migration rollback,
shared compiler preparation, lost runner responses and split-byte framing.

A real local JVM generates, compiles and loads a Cyrillic Java class under an
initial ASCII locale. Concurrent warm-compiler checks also compile Cyrillic and
Chinese filenames. The catalog stress check reads a 209 MiB catalog with a 64 MiB
heap. Chromium checks cover all Admin tabs, inline visualizations, runtime scope,
cancellation and stale drafts against a disposable synthetic environment.

Docker Compose configuration validates locally. Real container and live Postgres
execution require a responsive Docker daemon; the local Docker API timed out during
this verification. Synthetic UI fixtures do not establish real Joern, Kafka or
Postgres integration coverage. See the individual tests' skip conditions.


The [verification record](benchmarks/state-machine-verification.json) records
819 automated tests: 767 passed, 52 skipped and zero failures. The final focused
checks passed all 23 cases. Chromium passed 111 walkthrough checks over 80 page
visits and 14 runtime checks, with zero page errors. The source and generated
bundle are in sync. These checks used local Node 24; the Compose Node 22 image
could not be exercised while Docker was unavailable.
