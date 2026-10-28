# Developer and tester tool: completeness review

Review date: 2026-10-28. Scope: the existing repository plus the in-progress `codex/dev-tooling-reproduction` worktree and the separately implemented `codex/confluence-knowledge` worktree. This is an independent code review and proposed backlog, not a claim that the backlog is implemented. Source line references identify the reviewed implementation and may move as the branches evolve. I did not operate against a customer environment or rerun the implementation team's tests for this review.

The strongest next investment is a **real-service scenario harness backed by reusable, prefilled PostgreSQL templates**. The repository already has most of the discovery, capture, editing, execution and inspection primitives. The remaining work is largely about connecting them into a deterministic, inspectable workflow and making the lifecycle reliable.

“Nothing more needed” is a useful completion target only for an agreed scope. Here that scope is Java/Kotlin Spring services, PostgreSQL, Kafka, HTTP dependencies, Elasticsearch, configuration, files and explicitly modeled cache/queue edges. New infrastructure, protocols and business rules will still create new requirements. The optional extensions below should not delay a complete experience for this stack.

## The ten things I would build next

| Rank | Deliverable | Why it changes daily work | Completion evidence |
| --- | --- | --- | --- |
| 1 | One versioned scenario package and real-service `scenario_run` | Turn a passport plus one failing request/event into a runnable reproduction, rather than requiring users to assemble mocks, containers and observers themselves. | A fresh checkout runs the unchanged application with two PG databases, Kafka and HTTP stubs; an intentional application defect fails independent expectations. |
| 2 | Immutable prefilled PG templates, cheap private clones and lifecycle tools | Repeated runs currently recreate databases and execute the whole schema/data load. Pay preparation once per fixture version. | Cold build, warm clone, invalidation, parallel isolation and crash cleanup pass real PostgreSQL tests; timings show the actual improvement. |
| 3 | A first-class collection test runner | Scripts have useful hooks, nesting and assertions, but collections are currently folders and tool dispatchers, not full data-driven test suites. | Matrix runs, filters, setup/finally cleanup, cancellation, history and JUnit output work through CLI, API, MCP and UI. |
| 4 | Dependency coverage checked against real runtime reads/effects | A static passport cannot prove that reflection, dynamic SQL, startup work and conditional branches have all been modeled. | A deliberately hidden dependency is detected during the real run, linked to source/action, and blocks an “all dependencies covered” result. |
| 5 | A guided arrange → act → observe → assert workbench | Every individual part is exposed now, but users still need to understand large JSON objects and stable IDs to compose the complete workflow. | A tester can resolve a gap, inspect one read, invoke one action, view a diff and rerun only the failed check without writing orchestration code. |
| 6 | Strong fixture semantics and an explicit capture-consistency contract | FK closure and bounded Kafka correlation are useful; point-in-time state, cross-table correlations, serializers and schema evolution need stronger handling. | Tenant mixing, concurrent updates, schema changes, duplicate events, tombstones and bad codec assumptions are caught by end-to-end tests. |
| 7 | Deterministic time, failures and asynchronous assertions | Real bugs often involve retries, transactions, ordering, timeouts and eventual consistency rather than a single synchronous happy path. | The same saved seed reproduces a retry race; polling waits for a condition with a deadline; absence is checked over an explicit quiet window. |
| 8 | Reusable debug sessions and one evidence bundle | Existing compact failures, logs and traces are good; developers also need the exact prepared environment, raw evidence and a way to attach a debugger. | A failed scenario can be retained with a lease, inspected, debugged, exported and cleaned without recapturing live state. |
| 9 | A repeatable CI verification ladder | Fast feedback should lead to full project proof, with explicit live requirements and reportable skips. | Local targeted checks, actual-service integration, full Maven/Gradle and bundle checks run from committed inputs on a clean runner. |
| 10 | Requirement → flow → scenario → test → result traceability | Confluence now supplies quoted rules and architecture evidence, but those rules are not yet structured test obligations. | A changed rule lists affected scenarios/tests, retains the old citation, and requires review of the expected behavior. |

## What is already present

These are foundations to reuse, not missing features to rebuild.

| Existing capability | Evidence and practical boundary |
| --- | --- |
| One tool registry used by CLI, MCP, OpenAPI and HTTP, custom SQL/HTTP tools and plugins | `lib/tools.js:904–938`; `lib/tools.js:781–875`. Input schemas exist; execution currently applies defaults and checks required fields, rather than centrally validating every schema constraint. |
| Cached cross-system catalog, usages, passports, code search/graphs, impact, routes and library flows | `lib/indexer.js:1–15`, `lib/pgindex.js`, `lib/codegraph.js:1–13`, `lib/flows.js:1–11`. Java/Kotlin analysis is explicitly regex/brace based rather than compiler resolution. |
| Rich saved scripts and nested collections | `lib/scripts.js:1–25`, `lib/scripts.js:159–193`, `lib/scripts.js:348–435`. Tools, scripts, browser steps, HTTP, transforms, variables, captures, inherited hooks and JS assertions already exist. A collection tool runs one named child. |
| Script editor, folder management, request editor and execution UI | `web/admin.html:164–171`; `web/admin-scripts.js:49–145`. This is more than a JSON-only script store. |
| Reusable writable code workspaces, automatic compile checks, patches and red/green history | `lib/workspace.js:24–80`; `lib/javacheck.js`; `lib/testrun.js:243–258`, `lib/testrun.js:388–456`. Pushing is separately controlled. |
| Real Maven/Gradle execution, fast Maven compilation/JUnit, runner with Docker access | `lib/testrun.js:261–368`, `lib/fastrun.js:225–345`, `lib/runner.js:45–86`. The fast path is intentionally narrower than the full project build. |
| Valid Java test data and flow-test skeletons | `lib/testdata.js:1–11`; `lib/testgen.js:115–155`, `lib/testgen.js:532–692`. Valid inputs and a compiling skeleton do not define independent business expectations. |
| Scratch databases and DDL closure | `lib/testdb.js:11–50`; `lib/ddl.js:21–69`, `lib/ddl.js:72–175`. Databases are recreated and statements loaded each run. Snapshot reconstruction includes many useful objects but is not a complete PostgreSQL backup format. |
| Related PG/Kafka capture, resource export, hashes, masking and replay | `lib/reproduction.js:47–101`, `lib/reproduction.js:134–230`, `lib/reproduction.js:291–405`; `lib/kafka.js:122–152`. Explicit cross-DB relationships, composite FK closure, per-partition windows, schema path suggestions, bounded reads and scratch replay are present. |
| Separately callable passport scenario stages | `lib/tools-scenario.js:7–26`: inventory, state plan, capture, get, actions, expectations, check, emulate, export. `lib/scenario-state.js:160–202` correctly labels local-model proof `contract-emulation` and `runtimeVerified:false`. |
| Read-only saved experiments with assertions, timing and comparison | `lib/experiments.js:7–60`. Definitions and up to 100 runs are kept; the allowlist is explicit. |
| Bounded, local scenario interpreter | `lib/offline-js.js:1–10`. It removes ordinary runtime capabilities from the program realm; its own comments correctly avoid calling Node VM an adversarial security boundary. |
| Measured caching and an explainable local/changed test loop | `lib/codeindex.js:111–157`; `dev/test.js:43–63`; `docs/dev-performance-plan.md`. Unchanged-tree reuse, file identity invalidation, deletion cleanup and full-suite fallback are implemented. The test driver also supports Node watch. |
| Jobs, cancellation, call history, repeated-work suggestions, doctor and compact test failures | `lib/jobs.js:20–56`, `lib/trace.js:94–121`, `lib/calls.js:20–55`, `lib/doctor.js:163–177`, `lib/testout.js:1–67`. Cancellation currently centers on known child processes; durable resource leases are a separate need. |
| Existing interactive views and fixture explorer | `lib/views.js:1–23`; `web/views/reproduction.html`; `lib/results.js:40–48`. Views are data snapshots with no data-fetch capability; they are not a live debugger. |
| Local/SFTP file stores and explicit writable destinations | `lib/files.js:1–8`, `lib/files.js:35–78`; relevant `files_*` tools. There is no need to invent a second file-store abstraction for fixture files. |
| Confluence mirror, exact versioned quotes, knowledge graph, architecture/sequence export and diagram viewer | On `codex/confluence-knowledge`: `docs/confluence-knowledge.md:50–78`, `lib/knowledge.js:28–77`, `lib/knowledge.js:215–247`, `lib/diagrams.js`. Evidence distinguishes code-verified, documentation-stated and inferred relations. This branch is separate; the combined workflow still needs integration validation. |

## Priority and dependency model

- **P0:** correctness or a prerequisite for claiming reliable, complete reproduction.
- **P1:** the next high-value implementation wave for the supported stack.
- **P2:** advanced workflows after the core path is reliable.
- **P3:** opt-in extensions justified by actual users; outside the completeness gate.

The order matters: artifact contracts and lifecycle → trusted fixture preparation → isolated real-service runtime → action/observation adapters → collection/CI integration → deeper optimization and optional platforms. Build on the current tools. Do not put another incompatible script language, result store or container runner beside them.

## Prefilled PostgreSQL templates: recommended design

This is a real missing capability. `testdb.create` currently issues `DROP DATABASE`, `CREATE DATABASE`, then executes all statements (`lib/testdb.js:19–44`). `reproduction.replay` does that for every captured database (`lib/reproduction.js:384–399`). Reusing a prefilled base therefore removes work that is repeated today.

PostgreSQL can clone a database within the same cluster using `CREATE DATABASE … TEMPLATE …`. It requires a suitable database-creation role, cannot run inside a transaction block, and the template must have no connected sessions. Database-level permissions and configuration are not copied, so they need explicit application to each clone. This is a physical copy, not a promise of zero-cost creation. Use the deployed PostgreSQL version's behavior and benchmark it. [PostgreSQL 16 CREATE DATABASE](https://www.postgresql.org/docs/16/sql-createdatabase.html), [template databases](https://www.postgresql.org/docs/16/manage-ag-templatedbs.html).

The following is the proposed dt design, not existing behavior:

1. **Plan a base.** Use only a labeled scratch cluster. Select schema-only, schema plus shared reference data, or a fully prefilled scenario base. The key covers verified schema/data hashes, masking policy, migration mode, PostgreSQL/image compatibility, extension versions, locale/collation, required roles and relevant DB settings. Include application code identity only when a seed/migration generator depends on that code; unrelated source edits should not destroy fixture cache hits.
2. **Build privately.** Acquire a cross-process lock for that key. Create an unadvertised `dt_tpl_<digest>` candidate from `template0`, load verified artifacts under controlled ownership, validate all constraints and expected counts, run required sanity queries and `ANALYZE`, then close every builder connection. A failure leaves no ready entry. Do not publish a partially loaded base.
3. **Freeze.** Disable ordinary connections and remove application access. Keep the base owned by the dedicated clone/build role. `IS_TEMPLATE=true` is not required when the cloning role owns the base; enabling it broadens who can clone it. Record ready state and the scratch-cluster identity. Never change system `template0` or `template1`.
4. **Clone for a lease.** Generate unique names; create one private clone per captured DB; reapply DB settings and grants; return exact runner-reachable bindings. Keep the application role separate from the administrative role. A database owner choice does not substitute for checking object ownership and application privileges. Multi-DB creation uses compensation: if the third clone fails, release the first two.
5. **Reset by replacement.** Suite isolation normally means release/reclone. Transaction rollback can be an optional narrower mode, with documented exclusions for cross-connection commits, sequences, asynchronous consumers and DDL. Never reset by modifying the shared base.
6. **Reuse without races.** A durable lease registry records owner run, heartbeat, expiry and resource IDs. Concurrent builds for one key coalesce across processes. Clone concurrency is bounded and measured; start conservatively. A warm clone pool is optional only after isolation and reset proof, and each ready clone is assigned once.
7. **Invalidate predictably.** Build a new immutable base for changed inputs. Existing leases can finish on the previous base. Verify server identity and the registry after a restart; a same-named database or stale file does not prove that a valid base exists. Check extension/collation changes independently of the PostgreSQL major version.
8. **Clean and inspect.** TTL/LRU and disk quotas remove unleased bases and expired clones. Startup recovery cleans abandoned candidates. Retaining a failed clone is explicit and time-limited. A cleanup failure is a visible resource leak with a retry, not just a log line. Never drop a database based only on its prefix.
9. **Retain a portable source.** Native templates are local acceleration artifacts. Keep hashed SQL or a version-compatible logical archive as the portable fixture. A server without cloning privileges falls back to a verified fresh load. Do not attempt to use a live remote database directly as a native template.

Proposed separate tools: `testdb_template_plan`, `testdb_template_build`, `testdb_template_list`, `testdb_template_inspect`, `testdb_template_verify`, `testdb_template_invalidate`, `testdb_clone`, `testdb_lease`, `testdb_release`, `testdb_gc`. They should also compose into `test_run`/the real-service harness. Credentials should be passed through build/runtime bindings rather than included in inspection artifacts.

PostgreSQL's logical dump is a useful higher-fidelity fallback for schema features the hand-built catalog reconstruction cannot represent. A single dump has a consistent database snapshot; separate databases' snapshots still are not synchronized. Roles are cluster-wide and need separate handling. A dump may contain sensitive data and executable SQL, so adopt it only inside the same approved capture/scratch boundary, with explicit scope. [PostgreSQL SQL dump documentation](https://www.postgresql.org/docs/current/backup-dump.html).

## Exhaustive backlog for the agreed stack

Each item below names an observable outcome. Items in a category share the source evidence immediately above its table. Tool names that do not appear in the “already present” section are proposals.

### A. Scenario artifact, contracts and tool consistency

Evidence: `lib/tools-scenario.js:7–26`, `lib/scenario-state.js:205–235`, `lib/reproduction.js:323–381`, `lib/tools.js:904–938`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| A01 | P0 | One versioned scenario manifest linking inventory, state, fixture resources, actions, expectations, runtime adapter and source identities. Currently scenario JSON and PG/Kafka resources are separate exports. | Export, move to a clean machine, verify, import and run without a capture-cache ID or absolute path from the original machine. |
| A02 | P0 | Central schema/type/size validation at every tool boundary, with versioned output contracts and stable error codes. | The same malformed nested binding fails identically through CLI, MCP and HTTP before any live call or resource creation. |
| A03 | P0 | Explicit proof levels: discovery, bound contract, local-model pass, real-process pass and full-build pass. Preserve them through exports and UI. | A passing local model can never be reported as proof that the Java service passed; zero tests and skipped prerequisites remain visible. |
| A04 | P0 | Independently callable import, artifact verify, completeness explain and manifest diff stages. | Corrupt one file, remove one dependency and change one schema version; each dedicated check identifies the exact cause without running actions. |
| A05 | P1 | Stable scenario references and a migration policy when passport IDs or source shapes change. | A renamed handler yields a reviewable mapping; a removed dependency is not silently rebound by display name. |
| A06 | P1 | Typed bindings and validation previews for action payloads, HTTP exchanges and expectation descriptors. | Invalid input, an unknown target and an ambiguous selector are rejected before runtime; valid null/empty state remains expressible. |
| A07 | P1 | One machine-readable plan of prerequisites, capabilities, estimated work and unavailable adapters. | An offline plan identifies exactly which Docker image, schema, credential or binding is missing, with no partial startup. |
| A08 | P1 | Stable content identities and canonical serialization for reproducible reviews. | Re-export unchanged input twice; semantic artifact hashes match despite capture/run timestamps and object-key insertion order. |

### B. Passport coverage and explicit state modeling

Evidence: `lib/scenario.js:49–81`, `lib/scenario.js:111–150`, `lib/scenario.js:203–236`; `lib/codegraph.js:1–13`; `lib/flows.js:28–64`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| B01 | P0 | Runtime dependency discovery/reconciliation for supported adapters; static unknowns remain gaps. | Reflection, dynamic table selection and an unindexed library cause a runtime-vs-passport difference with evidence. |
| B02 | P0 | Distinguish potential reads, branch-required reads, optional reads and startup reads. The current all-reads contract is deliberately conservative. | Both branches of a conditional action pass with their own required-read sets; a branch's missing mandatory read still fails. |
| B03 | P1 | An evidence-bearing override file for unresolved targets and action attribution, separate from generated passports. | A reviewed dynamic datasource mapping survives passport refresh and is invalidated when its supporting code changes. |
| B04 | P1 | Model clocks, randomness, UUIDs, locale, timezone, filesystem environment and feature flags as explicit inputs. | A midnight/DST boundary and a random-ID action replay deterministically from saved inputs. |
| B05 | P1 | Identify actual config reads and secret references, instead of requiring every merged property as if it were used by the selected action. | An unrelated property does not block a selected flow; a required profile/flag does; secret values are not exported. |
| B06 | P1 | Surface analysis depth, unresolved dispatch, generated code, Kotlin-specific constructs and library-version mismatches. | A chain beyond the configured traversal depth is reported as incomplete, rather than having its tail disappear from coverage. |
| B07 | P1 | Expose schema, function/trigger and role requirements as state obligations, distinct from data rows. | A function that reads a second table or relies on a trigger cannot pass setup with only its argument row present. |
| B08 | P2 | Optional compiler-backed resolvers for difficult Java/Kotlin cases, using the fast static index as the first pass. | Overloads, generics, extension functions and generated beans resolve against a representative compiler-checked corpus; fallbacks remain visible. |

### C. Related-data capture and fixture quality

Evidence: `lib/reproduction.js:47–101`, `lib/reproduction.js:134–230`, `lib/reproduction.js:237–280`; `lib/fixture-schema.js:1–26`; `lib/pg.js:28–34`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| C01 | P0 | Stronger per-database snapshot mode or an explicit change-detection/retry mode. Current capture uses independent read-only statements. | Mutate a parent between two capture reads; the snapshot mode is consistent, or the capture records a detected inconsistency and fails completeness. |
| C02 | P0 | Cross-table/cross-DB correlation tuples with entity lineage. Current Kafka AND rules keep one table's fields in one row, but groups from different tables are matched independently. | Two unrelated captured order/customer pairs cannot form a synthetic matching event by combining their fields. |
| C03 | P0 | Explicit identity/tenant scoping in relation candidates and saved plans. Equal column names remain suggestions. | Identical IDs in two tenants and same-named tables in two databases never cross-select rows unless the relationship includes that scope. |
| C04 | P1 | Schema-aware payload validation, not just path discovery; registry references and unsupported codecs must be visible. | A path exists but its type/logical format is wrong; validation fails before replay and names the schema version and field. |
| C05 | P1 | Typed masking policies, reversible only where explicitly configured, with constraints and join consistency checked afterward. | Length-constrained email, enum-like code, numeric FK and shared ID satisfy their real DB/event constraints after masking. |
| C06 | P1 | A redaction preview and artifact-wide secret scan covering plan, provenance, errors, headers, logs and saved experiment arguments. | A seeded secret in each supported artifact location is masked or blocks export; ordinary domain fields remain inspectable. |
| C07 | P1 | Indexed-query planning hints and actual query cost budgets. Bounded result size alone does not guarantee a cheap source scan. | An unindexed seed filter produces an actionable plan warning; capture respects time/scan budgets without issuing DDL on the source. |
| C08 | P1 | Fixture minimization preserving an observed failure and declared referential closure. | A large capture reduces to a smaller reproducer; rerunning the independent assertion still fails for the same reason. |
| C09 | P1 | Deterministic synthetic completion and user-owned fixture overlays, explicitly separated from captured facts. | A missing optional state can be supplied as an annotated synthetic fixture; generated refresh preserves a hand-edited overlay. |
| C10 | P1 | Full type fidelity tests: decimals, long IDs, timestamps/timezones, intervals, ranges, arrays, bytea, JSON null, enums/domains and custom codecs. | Round-trip a typed corpus through live PG, export and replay; compare normalized values and constraint behavior. |
| C11 | P2 | Multiple seed sets, fixture composition and conflict explanations. | Combining two scenarios with the same primary key and different values yields a conflict report instead of last-writer-wins data. |
| C12 | P2 | Capture-attempt resume and per-source checkpoints with explicit revalidation. | Interrupt a multi-source capture; resume does not silently join old rows with a fresh Kafka window under one consistency claim. |

### D. PostgreSQL templates and scratch lifecycle

Evidence: `lib/testdb.js:11–50`, `lib/reproduction.js:384–399`, `lib/testrun.js:276–322`; the proposed template lifecycle above.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| D01 | P0 | Labeled scratch-cluster identity and durable resource ownership, beyond URL comparison and a database-name prefix. | A similarly named user database and a same-named DB on another cluster are never adopted or deleted. |
| D02 | P0 | Fail-closed preparation for every path, including the legacy DDL-only test path, plus readable failed-statement evidence. | One required DDL statement fails; no test starts against a partially prepared DB unless an explicit diagnostic mode was selected. |
| D03 | P1 | Content-addressed schema/reference-data/scenario template builds. | Identical verified input builds once; a changed row, extension, migration or masking policy creates a new template. |
| D04 | P1 | Validate/freeze/inspect/verify template stages as separate tools. | Half-built templates cannot be cloned; ready templates reject ordinary connections; inspection verifies constraints and metadata. |
| D05 | P1 | Fast per-run clones with explicit application roles, grants, settings and datasource bindings. | An app uses the cloned databases with required privileges but cannot mutate the template or another run's databases. |
| D06 | P0 | Cross-process build locks, unique run names and bounded clone concurrency. | Two dt processes request the same base and many clones; there is one base build, no lost records and no cross-run state. |
| D07 | P0 | Multi-DB compensation, cancellation and cleanup after process death. | Kill the owner during the second clone/load/start phase; recovery removes only its leaked resources and the next run succeeds. |
| D08 | P1 | Per-suite/per-test reset modes with explicit guarantees. | Mutation in test A is absent in B; a committed asynchronous write proves why rollback-only reset is insufficient. |
| D09 | P1 | TTL, LRU, disk limits, leases, keep-on-failure and a visible leak/retry queue. | Eviction never touches an active lease; a failed drop is surfaced and later retried; expiry frees retained failures. |
| D10 | P1 | PostgreSQL version/locale/extension compatibility preflight and DDL-fidelity modes. | RLS policies, partitions, grants, extensions and SECURITY DEFINER ownership either reproduce correctly or block setup with an explicit unsupported-feature report. |
| D11 | P1 | Migration-aware setup: exact captured schema, migrations-from-empty and upgrade-from-base are separate modes. | A migration defect fails the migration mode rather than being hidden by the current Flyway/Liquibase-disable defaults. |
| D12 | P1 | Cold-load, warm-clone and repeated-reset benchmarks with separate query/test timings and size tiers. | A committed benchmark reports p50/p95 and counts under specified hardware, PG settings and concurrency; no blanket “instant clone” claim. |
| D13 | P2 | Portable logical-archive fallback and offline transfer of verified bases. | Native cloning unavailable: the same fixture loads through the fallback and produces equivalent assertions. |
| D14 | P2 | Optional prewarmed clone pool after lifecycle correctness. | Concurrent users get unique clean clones; a consumed or dirty clone is never returned to the ready pool. |

### E. Kafka and asynchronous state/effect fidelity

Evidence: `lib/kafka.js:32–46`, `lib/kafka.js:73–103`, `lib/kafka.js:122–152`; `lib/reproduction.js:198–230`, exported README generation in `lib/reproduction.js`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| E01 | P1 | An isolated local Kafka/registry replay adapter integrated with the real-service harness. Exported JSONL currently requires the service's own test producer. | Replay the exported fixture to a scratch broker, start the actual listener and observe its effects; no configured environment broker receives a publish. |
| E02 | P0 | Codec/schema fidelity: binary key/value, headers, schema IDs/references, Avro logical values, Protobuf and JSON Schema with an explicit support matrix. | Real producer/consumer round-trips fixtures under each supported codec; unsupported schema kinds fail preflight. |
| E03 | P1 | Topic configuration and partition/key semantics for scratch replay. Source offsets are provenance, not offsets a new broker can reproduce literally. | Multi-partition fixtures preserve per-partition ordering and key routing expectations; results distinguish source and replay offsets. |
| E04 | P1 | Consumer lifecycle controls: initial position, fresh group, assignment readiness, drain, lag and cleanup. | An action is not sent before its consumer is ready; rerun uses a clean group and never reads leftover events from the preceding run. |
| E05 | P1 | Temporal assertions with deadlines and quiet windows for forbidden effects. | A delayed event passes within its deadline; a forbidden event arriving after the action return still fails the quiet-window assertion. |
| E06 | P1 | Duplicate, out-of-order, tombstone, poison-message, retry and dead-letter scenarios. | Assert idempotent writes, retry bounds and expected DLQ payloads against an actual listener. |
| E07 | P2 | A causal event timeline joining action, transaction/outbox and emitted effects. | A failed transaction produces no committed business event; an outbox retry does not duplicate the business result. |
| E08 | P2 | Better search/window strategies and resumable capture when a bounded tail misses the needed event. | A quiet partition and an older relevant event are discoverable using explicit offsets/time boundaries; retention expiry is reported. |

### F. Real-service harness and other dependency adapters

Evidence: `lib/scenario-state.js:44–97`, `lib/scenario-state.js:160–202`; `lib/testrun.js:288–322`; `lib/testgen.js:139–155`; `docker-compose.yml:103–135`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| F01 | P1 | A real-process/container runtime adapter with build/start/readiness/stop, explicit images/JDK and a durable session. | The unchanged service starts from a clean checkout; readiness failures retain useful logs; stop removes all owned resources. |
| F02 | P1 | Separate real action tools for HTTP, Kafka, schedules and supported method/queue entrypoints. | Inspect or invoke one bound action independently; record the actual response/ack/exception and correlate it to its effects. |
| F03 | P0 | Independently collected effects: DB deltas, Kafka output, HTTP calls, ES writes, file changes and returns. | A model that simply emits the expected value cannot pass application proof; a real unexpected write fails strict observation. |
| F04 | P1 | HTTP mock adapter with exact request matching, sequences, counts, headers, errors, latency and mismatch explanations. | A wrong method/body or a second call fails with expected-vs-actual evidence; stubs do not fall through to live HTTP. |
| F05 | P1 | ES mapping/settings/documents fixture replay and refresh-aware assertions. | A mapping/type error fails on real ES; document checks wait for the configured visibility boundary rather than sleeping arbitrarily. |
| F06 | P1 | Cache adapter covering values, types, TTL and miss behavior; queue adapter covering ack/requeue/DLQ for the chosen technologies. | A stale cache value and an expired key exercise different real-service paths; a requeued message has bounded attempts. |
| F07 | P1 | File/SFTP/object-store fixtures with binary content, filenames, permissions and expected writes. | Actual service reads an isolated inbox, writes the expected artifact once and cannot see the live partner directory. |
| F08 | P0 | Runtime dependency routing and egress policy aligned with the scenario plan. | A missing stub or hidden dependency cannot silently reach a configured environment; evidence names the refused destination. |
| F09 | P1 | Debug lease, attach metadata, optional keep-on-failure and an explicit continue/stop lifecycle. | Attach a Java debugger to the failed real-service session, inspect state, then release resources deterministically. |
| F10 | P2 | Multi-service scenarios where a test explicitly chooses real neighbors versus mocks. | A producer→consumer flow runs two real services with isolated dependencies; the artifact states exactly which boundaries are mocked. |

### G. Scripts, collections and repeatable testing

Evidence: `lib/scripts.js:140–193`, `lib/scripts.js:219–248`, `lib/scripts.js:297–303`, `lib/scripts.js:348–435`, `lib/scripts.js:484–533`; `lib/tools.js:418–444`; `web/admin-scripts.js`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| G01 | P0 | Tool/library/UI parity for script and collection variables and hooks. At review time `script_save` does not pass top-level `vars/before/after`; `script_collection` passes replacement defaults that can erase stored settings. | Create through tools, edit description through UI, run through CLI; inherited hooks/vars survive and execute in the same order. |
| G02 | P1 | A collection suite runner with explicit ordering, tags, selection, nested setup/teardown and aggregate assertions. | Run a nested suite while filtering tags; shared setup executes at the declared scope and every selected script is accounted for. |
| G03 | P0 | True finally/cleanup hooks independent of success hooks. Current after hooks are reached only after successful preceding execution. | Fail, throw, time out and cancel at every step; cleanup runs once and preserves both the original error and any cleanup error. |
| G04 | P1 | Dataset/matrix execution with typed parameters, per-case scope and deterministic seed. | Fifty parameter rows run without leaking a captured variable between cases; results identify the exact failing row and seed. |
| G05 | P0 | Dry-run validation of nested script references, cycles, templates, tools and required capabilities. | Moving a child script or misspelling a captured variable is found before any HTTP/browser action. |
| G06 | P1 | Step/run deadlines, cancellable polling and retries limited to explicitly retryable/idempotent operations. | A transient GET retries with a deadline; a POST with uncertain outcome is not duplicated automatically. |
| G07 | P1 | Named assertions, soft/hard assertion choice and first-class reusable assertion blocks. | Multiple independent soft assertions report all mismatches; a setup assertion stops dependent actions. |
| G08 | P1 | Durable script/collection run records with full opt-in evidence, step status and retry/skip distinctions. Current script results are mainly returned and clipped. | Reopen yesterday's failed run, inspect its exact script revision and step outputs, and rerun a selected case. |
| G09 | P1 | Versioned packages/import/export, Git-friendly metadata, ownership and compatibility requirements. | Import a collection into a clean DT_HOME; dependencies resolve, secrets remain references and unsupported versions are explained. |
| G10 | P1 | Safe rename/refactor of references and collision checks for exposed tool names. | Rename a nested collection; child script calls and public tool aliases are updated or migration errors are listed before save. |
| G11 | P1 | Secret references and environment overlays for HTTP/auth/session data, with consistent masking. | An access token is injected at execution but absent from stored definitions, history, results and exported reports. |
| G12 | P1 | Scoped browser sessions, reusable authentication state and resilient semantic selectors with failure artifacts. | Two parallel cases do not share cookies; an expired login is diagnosed; failure retains screenshot/DOM/network evidence. |
| G13 | P2 | Conditional/parallel/for-each steps only where semantics improve over the existing JS step. | A bounded independent fan-out cancels and aggregates correctly; data dependencies prevent unsafe parallelization. |
| G14 | P1 | JUnit/JSON reports and stable exit semantics for assertion failures, setup failures and infrastructure errors. | CI fails on a failed assertion even when HTTP returned 200; retries/flaky passes do not erase initial failures. |
| G15 | P2 | OpenAPI/cURL and common collection-format import with a loss report. | Import preserves supported requests/assertions and explicitly lists unsupported scripts/auth behaviors. |
| G16 | P1 | Curated working collections for investigate, capture, reproduce, compare, migrate, retry and partner-file flows. | Each shipped example runs against the demo and documents how to replace its environment bindings. |

### H. Test generation, test trust and regression depth

Evidence: `lib/testdata.js:1–11`, `lib/testdata.js:1229–1285`; `lib/testgen.js:115–155`, `lib/testgen.js:515–525`; `lib/testrun.js:340–355`, `lib/testrun.js:388–456`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| H01 | P0 | Keep independent expected business values separate from generated inputs and observed outputs. | Changing the service's calculation makes the generated regression fail; expectations are not refreshed from that changed output. |
| H02 | P1 | Generate actual-service harness wiring from the scenario artifact, not just a generic method/flow skeleton. | Export a scenario, generate its adapter/test code and run it through the project's normal build with minimal user edits. |
| H03 | P1 | Property-based and boundary case generation with seed replay and shrinking. | A randomized failure shrinks to a small reproducible case whose seed/input is committed with the test. |
| H04 | P1 | Explicit matrices for auth/tenant isolation, null/missing/empty, numeric boundaries, locale, retries and duplicates. | Representative services prove negative as well as happy paths; generated tests carry the originating constraint/rule. |
| H05 | P1 | Coverage and mutation evidence where supported by the project's own tools. | A deliberately removed validation or changed comparison is killed by a relevant test; untouched unrelated code is not claimed covered. |
| H06 | P1 | Detect tests that ran with unintended mocks, H2, disabled migrations or a different dependency version. | A runtime report identifies the actual datasource, broker, Spring profile and relevant artifact versions used for proof. |
| H07 | P1 | Generated-code ownership/regeneration policy extending the existing preserve-edited-TestData behavior. | Regeneration updates untouched sections, preserves user assertions, and reports conflicts instead of overwriting them. |
| H08 | P1 | A maintained live verification corpus for supported JDK/Spring/Mockito/Maven/Gradle combinations. | Each supported combination runs actual compile/test flows on CI; an unsupported one fails preflight with the exact limitation. |

### I. Test and index performance

Evidence: `docs/dev-performance-plan.md`; `lib/codeindex.js:111–157`; `lib/fastrun.js:182–225`, `lib/fastrun.js:310–345`; `dev/test.js:43–85`; `lib/indexer.js:95–101`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| I01 | P1 | Per-phase metrics for queue, capture, template, dependency startup, compile, JVM startup, test and cleanup. | The UI identifies the actual dominant phase; warm-cache improvements cannot hide slower startup or leaked cleanup. |
| I02 | P1 | Representative benchmark corpus, size tiers and regression budgets. | Benchmarks run with fixed inputs and report distributions; a sustained regression trips a separately calibrated budget. |
| I03 | P2 | Incremental per-file graph/parser/postings updates after actual edits. Current optimization chiefly reuses unchanged trees. | One-file edit on a large repo touches bounded artifacts and yields the same graph/search result as a forced full rebuild. |
| I04 | P1 | Atomic index generations and cross-process writer coordination. Current index files are written in sequence. | A reader during refresh sees a complete old or complete new generation; killing the writer does not produce an apparently valid mixed index. |
| I05 | P1 | Freshness and cache-key explanations across schema, passport, code, docs and build state. | A stale answer names the input that changed; force refresh is available; replacing/removing inputs invalidates all dependent caches. |
| I06 | P1 | Affected Java tests from graph plus prior coverage, with conservative fallback and reasons. The current changed-test driver targets this Node repository. | Changing a library method selects affected service tests; an unresolved dynamic edge selects the full relevant group. |
| I07 | P2 | Gradle/Kotlin incremental support aligned with the project's compiler and build plugins. | Annotation processing, Kotlin changes and generated resources match a clean Gradle build; unsupported cases fall back. |
| I08 | P2 | Investigate warm test JVM/Spring-context reuse only after isolation benchmarks. | Repeated runs do not retain threads, static state, transactions or containers; dirty cases trigger restart; full build remains the final check. |
| I09 | P1 | Bounded concurrency and per-resource queues for builds, template copies and indexing. | Multiple users cannot oversubscribe memory/disk or starve small interactive requests; cancellation releases queue reservations. |
| I10 | P2 | Verified shared dependency/build caches and prewarming for known services. | A clean runner can build offline after prewarm; poisoned/incompatible artifacts are rejected and credentials never enter cache keys/artifacts. |

### J. Experiments, investigation and debugging

Evidence: `lib/experiments.js:7–60`; `lib/testout.js:11–67`; `lib/logs.js`; `lib/tools.js:260–285`, `lib/tools.js:595–640`; `lib/runner.js:45–86`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| J01 | P1 | Link a saved hypothesis to the exact input snapshot, code/config/schema versions and fixture. Current run comparison records code hash and params but does not pin every live result. | Rerun in offline mode on another machine and get the same assertion results without calling the environment. |
| J02 | P1 | Experiment matrices, repeat counts, confidence/distribution reporting and normalization of volatile fields. | Compare two implementations across the same parameter set; timestamp noise does not conceal a changed business value. |
| J03 | P1 | Trace/request/event ID → related state → minimized fixture → regression handoff. | One known trace identifies its tables/events/HTTP responses and produces a plan with unresolved joins called out for review. |
| J04 | P1 | Correlate application logs, dt calls, SQL, broker activity and test phases under one run/action ID. | Clicking an assertion shows its causally related reads, writes and logs rather than every event in the time range. |
| J05 | P1 | Raw evidence retention and download beside compact summaries. | A clipped stack/log remains downloadable with an explicit truncation marker; analysis never silently relies on omitted lines. |
| J06 | P2 | JVM thread/heap/JFR profiling and slow-query EXPLAIN workflows through explicit scratch/debug adapters. | Capture a deadlock or allocation regression in a retained run; profiles are tied to the same build and fixture. |
| J07 | P1 | Expected-vs-actual structural diff with domain keys, unordered collections, numeric tolerance and approved redactions. | Reordered rows compare equal when declared unordered; duplicate loss and a real money difference remain failures. |
| J08 | P1 | Actionable infrastructure-vs-application failure classification with retry guidance. | Broker unavailable, bad fixture, compile error, assertion failure and timeout have distinct stable outcomes and next steps. |

### K. Workbench, discoverability and visual inspection

Evidence: `web/admin.html:119–125`, `web/admin-scripts.js:49–145`, `lib/views.js:1–23`, `web/views/reproduction.html`, `web/views/tests.html`, `web/showcase.html`, `lib/results.js:40–48`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| K01 | P1 | A single service/scenario workspace linking source, passport, dependencies, fixtures, collection, runs and docs. | Start from a service name and reach its next incomplete step without searching tool descriptions or copying IDs manually. |
| K02 | P1 | A dependency checklist with independently runnable state readers, action controls and expectation checks. | A tester fixes one failed HTTP fixture and reruns only that check, then runs the complete scenario. |
| K03 | P1 | Entity-centered graph navigation across DB rows, Kafka messages, API calls, code and docs. | Selecting one tenant/order highlights only its correlated evidence and shows why each edge exists. |
| K04 | P1 | A causal timeline and state-before/state-after diff for real runs. | Inspect a failed retry and see exact action order, transaction result, outgoing messages and assertion deadline. |
| K05 | P1 | Clear incomplete/stale/inferred/partial/error visual states with accessible text equivalents. | A truncated Kafka window or unknown library cannot look like green complete coverage; screen-reader users receive the same distinction. |
| K06 | P1 | Keyboard, responsive and accessibility regression checks for the main investigation/test workflows. | Complete the supported flow without a pointer at narrow and wide widths; focus and large tables remain usable. |
| K07 | P2 | Virtualized large-data inspection and progressive artifact loading without weakening sandbox boundaries. | Inspect the supported maximum fixture size without freezing the UI; payload limits give a useful alternate download. |
| K08 | P1 | Portable HTML/JSON report and clickable source/evidence links with redaction and expiry controls. | A reviewer can open a saved report without dt running and understand setup, failures, gaps and proof level. |

### L. Knowledge, requirements and change impact

Evidence: `codex/confluence-knowledge:docs/confluence-knowledge.md:56–78`; `codex/confluence-knowledge:lib/knowledge.js:215–247`; tooling `lib/impact.js`, `lib/scenario.js:235–236`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| L01 | P1 | Requirement records with exact quoted rule, page/block/version, owner and linked independent expectation. | An assertion can show its actual quoted rule and source version; inferred prose cannot become an exact quote. |
| L02 | P1 | Coverage/ambiguity matrix from requirement to flow to scenario to executed test. | A documented business branch with no test is shown as uncovered even when a neighboring happy path passed. |
| L03 | P1 | Documentation/code/schema change impact on scenario assumptions. | Change a rule, topic schema or table; affected fixtures/tests become review-required with the specific changed evidence. |
| L04 | P1 | Reviewable discrepancy resolution: outdated docs, incomplete passport, real defect or accepted difference. | A known documentation mismatch has an owner/reason/expiry and does not disappear from the graph silently. |
| L05 | P0 | Combined-branch integration and live deployment verification before treating knowledge and reproduction as one released workflow. | Build one integration branch, exercise requirement→capture→actual-service regression→diagram from a clean DT_HOME and a supported real Confluence account when available. |
| L06 | P2 | ADR/runbook links on test failures and incident-to-regression bundles. | A failure links to its diagnosis procedure and earlier accepted decision, retaining historical citations. |

### M. CI, sharing and review workflow

Evidence: `package.json` test scripts; `dev/test.js`; `test/*.live.test.js`; `lib/testrun.js:388–456`; `lib/workspace.js`; no committed CI pipeline was found in this reviewed tree.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| M01 | P1 | A committed CI workflow with local unit, integration, real JVM/PG/broker and bundle-freshness jobs. | A fresh runner executes the declared matrix; missing required services fail the required lane rather than silently skipping it. |
| M02 | P0 | A machine-readable capability/skip manifest and explicit required-vs-optional test policy. | A release cannot claim “all tests passed” when a required live capability was absent; report counts distinguish executed, skipped and not selected. |
| M03 | P1 | JUnit/SARIF or equivalent standard reports, artifacts and source links for generated/application tests. | A failed case appears directly in CI with its fixture/run IDs and downloadable evidence. |
| M04 | P1 | Hermetic reproduction command with lockfiles/images/toolchains pinned where applicable. | Fresh checkout plus the documented command produces equivalent results on local and runner paths. |
| M05 | P1 | Reviewable fixture/scenario diffs and approval of expected-output updates. | A patch shows which business expectations changed and why; an “accept actual” action cannot silently replace assertions. |
| M06 | P1 | Flake detection, explicit retries/quarantine and historical duration distributions. | A pass-on-retry is reported as flaky; quarantine requires an owner and expiry and does not make the original failure disappear. |
| M07 | P2 | Sharding/scheduling using historical timing and dependency resources. | Parallel CI lanes retain isolated databases/groups and reduce elapsed time without changing case coverage. |
| M08 | P1 | Share a minimized reproducer as a branch/patch/artifact with exact source and red/green evidence. | Another developer applies it to the named revision, observes the same failure, applies the fix and gets passing full-build proof. |

### N. Reliability, privacy and operational ergonomics

Evidence: `lib/jobs.js:11–38`, `lib/util.js:59–65`, `lib/results.js:13–21`, `lib/calls.js:13–29`, `server.js:20–43`, `lib/doctor.js:163–177`, `lib/workspace.js:276–286`, `lib/offline-js.js:1–10`.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| N01 | P0 | Durable atomic metadata updates and cross-process consistency for jobs, histories, template/fixture registries and manifests. | Kill writers and run two processes concurrently; no valid history is silently replaced by fallback empty JSON or lost updates. |
| N02 | P0 | Cancellation propagated through fetches, SQL, interpreters, runner children and acquired resources. | Cancel during each phase; work stops within a measured bound and the leak registry is empty or explicitly reports unresolved cleanup. |
| N03 | P1 | Time/byte/row/message/disk/memory budgets across the whole workflow, not only individual calls. | Many individually valid subcalls cannot exceed the scenario's total budget without an explicit partial result. |
| N04 | P1 | Retention/pin/expiry policies for captures, scenario states, experiment results, logs and debug sessions. | A pinned reproducer survives ordinary pruning; expired sensitive captures are removed from every related store. |
| N05 | P0 | Consistent sensitive-value handling in call history, errors, HTTP headers, saved params and reports. `calls.record` currently clips rather than centrally redacting args. | Token-bearing inputs remain usable but the token is absent from all persisted and user-visible evidence. |
| N06 | P1 | Idempotency and retry semantics for all artifact/resource-creating tools. | Retry after a lost response returns the original export/lease/run where appropriate, without duplicate live actions or resources. |
| N07 | P1 | Task-specific doctor/preflight, including create/clone/drop privilege, extensions, broker codec and runner connectivity. | `select 1` succeeds but CREATEDB is missing; preflight identifies the actual blocker before a test starts. |
| N08 | P1 | A supported configuration schema, migration path and validation UX with actionable errors. | A renamed option or unresolved secret is diagnosed at startup; a migration preserves prior behavior and has an inspectable diff. |
| N09 | P2 | Per-user capability separation and audit attribution when deployed to a shared team server. Current local/API-key trust model suits a local tool. | A read-only tester can inspect/run approved scenarios but cannot change plugin code, push branches or access another user's retained secret state. |
| N10 | P2 | OS/container isolation profile for untrusted project programs or builds, distinct from ordinary local trusted-code mode. | A hostile test cannot access dt credentials or live networks; the selected isolation level is recorded in proof metadata. |
| N11 | P1 | Upgrade/backup/recovery instructions for persistent DT_HOME artifacts and cache format changes. | Restore a backup, invalidate ephemeral caches, recover owned leases and rerun a pinned scenario without exposing secrets. |
| N12 | P1 | Resource overview and cleanup commands with ownership, age, size and the reason an item cannot be deleted. | A user can explain and reclaim disk/containers/databases without manually guessing which resources belong to dt. |

### O. Integration and optional extensions

Evidence: the shared registry/plugins (`lib/tools.js:781–875`), current Java/Kotlin graph (`lib/codegraph.js:1–13`), file backend boundary (`lib/files.js:35–78`), current runner (`lib/runner.js`). These are extension opportunities, not evidence that the present scope requires every platform.

| ID | Priority | Remaining work | Acceptance test |
| --- | --- | --- | --- |
| O01 | P1 | Versioned adapter interfaces with conformance fixtures for state capture, arrange, action, observation and cleanup. | A plugin passes the same limits/provenance/cancellation/error tests as a built-in adapter. |
| O02 | P1 | Pin and inspect plugin/collection dependencies and declare read/write/runtime capabilities. | A package cannot gain a new writable dependency on update without an explicit capability change in its reviewable manifest. |
| O03 | P2 | IDE integration for open source, selected-test run, debugger attach and scenario resource navigation. | An IDE action opens the precise workspace file/test/run from the shared result identifiers. |
| O04 | P3 | Additional languages/build systems through the same contracts. | A non-JVM sample has a declared support level and passes adapter conformance; Java-specific assumptions do not leak into its manifest. |
| O05 | P3 | Additional databases, object stores, messaging protocols and Kubernetes preview environments. | Add only when required by a target service; tests prove that platform's actual isolation and serialization semantics. |
| O06 | P3 | Load/soak/browser visual regression/accessibility/security-testing integrations. | Reuse a trusted scenario setup, then run the chosen specialist tool and retain its native report and scoped claims. |
| O07 | P2 | Air-gapped operation and vendored viewer/renderer assets. | A supported offline bundle completes investigation and report rendering with no implicit CDN or artifact download. |

## Completion gate I would use

Treat the following as the acceptance suite for the product, not as another list of tools:

1. A developer starts from a service passport and one request/event/trace. The tool explains every known state source, action and effect, and makes unknown/dynamic edges visible.
2. A tester independently inspects and validates each state binding, action input and expected effect. The expectation has a business rule or reviewer-owned rationale rather than being copied from the execution under test.
3. A bounded capture yields a tenant-consistent, masked fixture with schema/provenance and a clear observation window. Incomplete capture cannot become green through export or renaming.
4. A fresh machine verifies and arranges that fixture offline. Two PG databases, a multi-partition Kafka input, HTTP stubs and a non-database state source are included in the reference scenario.
5. First run prepares verified PG bases; subsequent runs use clean private clones. Concurrent runs, cancellation and crashes cannot corrupt the base or leak state between tests.
6. The actual service executes two distinct entrypoints. Independent observers collect writes/events/HTTP/file effects and unexpected runtime dependencies. A local model pass remains a different proof level.
7. A business mutation, missing read, wrong tenant, duplicate delivery, delayed forbidden effect, bad schema, partial setup and missing stub each produce the expected failing result with useful evidence.
8. The developer can retain a failing environment briefly, inspect it, attach a debugger, create a small regression patch, see red/green proof and run the full project build.
9. The same committed reproduction and collection run in CI, report executed/skipped counts and export portable evidence with no credential values.
10. The measured warm loop is faster on representative services, with phase timings proving where time was saved. Cleanup, freshness, correctness and full-build behavior are unchanged by the optimization.

Once these gates and the P0/P1 items supporting them pass for representative real services, the tool is practically complete for the declared stack. P2/P3 work should follow observed friction and new service requirements. A larger tool count alone would not establish completeness.
