# Developer scenarios and tool workflows

Date: 2026-10-29. Start with the compact discovery tools: `tool_search` for a capability, `tool_describe` for its exact schema, then `tool_execute`. The opt-in lean profile can make that starting list smaller. These workflow maps describe how to assemble evidence; a map alone is not a passing end-to-end test.

## Four requested challenge questions

| Exact request | Existing tool workflow | What must be proven / current boundary |
| --- | --- | --- |
| “find all places across functions and repositories, where this column gets read and gets written” | `find` → exact env/db/schema/table/column; `pg_table` + `pg_usage` for table/function callers; `pg_function` for definitions; `impact` on the column; `code_search`/`code_symbols` for SQL/ORM/config/library paths; inspect `view` and source evidence | Classify reads, writes and read-write uses separately, with function/caller/repo/revision and file:line. Include indirect triggers/views, predicate-only reads and dynamic/unindexed gaps. Current column impact does not provide exhaustive typed read/write lineage; REQ-01 and IMP gates block an “all places” claim. |
| “recreate bug locally - find all related entities in databases,es,kafka messages to recreate state that would recreate bug” | `passport`/`scenario_inventory` → `find` + `pg_usage` + `find("es:")`/`es_search` + `kafka_topic`; `fixture_schema`/`fixture_plan`; explicit tenant-aware relations and event paths; `fixture_capture`/`fixture_validate`/`fixture_export`; ES via separate `scenario_state_plan`/`scenario_state_capture`/`scenario_export`; `fixture_replay`/`testdb_clone`; supported actual project/runtime test | Matching IDs alone do not establish relatedness. Bind every required state; retain schemas, offsets, observation windows, revisions and masking policy. Prove the original failure on the recreated state before fixing. C06 exercises real two-PG capture; automatic complete PG+ES+Kafka reconstruction and native ES/broker replay remain unproven. |
| “refactor method that takes postgres function results, but fills some fields from other functions, check it still same locally and on dev environment” | `workspace_open` at exact revision; `code_symbols`/`code_read` + `pg_function`/`pg_usage` + `impact`; capture a matrix of contributing function results; `test_context`, `workspace_write`, `test_run` old/new with identical resources; readonly `experiment_save`/`experiment_run`/`experiment_compare` and `diff` for approved dev observations; `workspace_patch` | Compare all output fields, override precedence, nulls/types/order, failure paths and effects. Use independent clones and explicit normalization; preserve old and new evidence. Local refactor proof, actual deployed-dev observations and deployment permission are separate. S03 now has actual before/after JVM tests over read-only fixture-source function results and local scratch replay. Actual remote-dev process equivalence remains an explicit gap; it is separate from the original arithmetic/library case. |
| “run this test on dev environment” | `tool_describe(test_run)` + `doctor`; establish test, workspace, deployed revision and actual target intent; `workspace_open(env="dev")` selects deployed code, `test_run(env="dev",db=...)` copies dev DDL to scratch. A live-dev integration needs reviewed project target configuration and explicit allowed effects; inspect result/view, target evidence, jobs and cleanup | Env on `test_run` is a source-DDL selector, not a live deployment selector. A successful local/scratch run cannot be called a dev-environment run. Resolve local-on-dev-revision vs captured-dev-state vs live-dev target before execution. REQ-04 records the missing per-call target manifest and conflicting job identity. |

## Representative working-day situations

The frozen author catalog has 24 workflows and eight executable incident projects. The remaining entries are mapped/expected-gap scenarios, not invented successful fixes. Tool-name errata replace two obsolete lifecycle names without changing the frozen challenge pack.

| ID | Situation | Complexity | Tool composition | Required evidence |
| --- | --- | --- | --- | --- |
| W01 | Invoice total differs by a cent | small | `code_search` → `code_read` → `workspace_open` → `workspace_write` → `workspace_patch` | Reproduce invoice output; regression tests cover quantity, VAT and input validation. |
| W02 | One checkout amount changes across service boundary | medium | `code_search` → `code_read` → `api_routes` → `workspace_patch` | Record outgoing request and downstream accepted cents; malformed totals never call downstream. |
| W03 | Library-owned currency behavior differs from service invoice | medium | `bitbucket_repos` → `repo_fetch` → `passport` → `code_symbols` → `impact` → `workspace_open` | Resolve exact artifact/version to source module; execute compiled service with patched actual library. |
| W04 | Only production reservations expire | small | `code_search` → `consul_service` → `logs_search` → `workspace_patch` | Compare deployed config and duration parsing; regressions exercise both profiles. |
| W05 | Replay loses one large order identifier | medium | `kafka_topic` → `kafka_last` → `code_search` → `test_data` | Distinct large IDs and tenants each process once; invalid identity leaves state untouched. |
| W06 | Tenant release depends on unrelated tenant rows | large | `find` → `pg_usage` → `pg_query` → `fixture_plan` → `fixture_capture` → `fixture_validate` → `fixture_export` → `testdb_initialize` → `fixture_replay` → `workspace_patch` | Two real database snapshots plus successful/denied multi-state runs; no cross-tenant writes. |
| W07 | Implement cancellation business rules and tests | medium | `code_search` → `test_context` → `workspace_write` → `test_run` → `workspace_patch` | Boundary/invalid-input tests execute function and preserve booking; report runner support accurately. |
| W08 | Write inventory replay tests before refactoring | large | `code_read` → `test_context` → `workspace_write` → `workspace_patch` | Tests pass unchanged production and kill independent identity/arithmetic/atomicity mutations. |
| W09 | Scheduled reconciliation missed a settled order | medium | `passport` → `code_symbols` → `impact` → `test_context` → `test_run` | Invoke real scheduled entry on controlled edge mocks; exact paid row changes and unpaid row stays. |
| W10 | Endpoint defined in an internal web starter | large | `passport` → `repo_fetch` → `code_search` → `impact` → `test_context` | Dependency version/source provenance and library-to-service dispatch executed under JUnit. |
| W11 | Shared publisher change might break other services | large | `who_uses` → `impact` → `code_search` → `passport` | List concrete consumers/reachable endpoints and tests for affected topic contract. |
| W12 | Database function change has unknown callers | medium | `find` → `pg_function` → `pg_usage` → `ddl_snapshot` | Definition plus services/functions/triggers/views edges with source evidence. |
| W13 | Foreign key fixture misses a tenant-qualified parent | large | `fixture_schema` → `fixture_plan` → `fixture_capture` → `fixture_validate` | Composite FK closure and negative missing-parent detection on real fixture. |
| W14 | Cross-database correlation needs explicit business relation | large | `fixture_plan` → `fixture_capture` → `fixture_export` | Explicit relation evidence joins matching tenant/ID rows and excludes distractors. |
| W15 | Inspect DLQ event schema without consuming a group | small | `kafka_topic` → `kafka_last` | Read-only sample/offset evidence and schema mismatch; no claim of delivery proof. |
| W16 | Find API used by a browser workflow | medium | `browser_sites` → `site_url` → `routes_discover` → `api_routes` | Observed request mapped to code handler; browser prerequisite reported. |
| W17 | Repeat a known operational investigation | medium | `script_list` → `script_get` → `script_run` → `call_patterns` | Saved parameterized script output with trace provenance and secret masking. |
| W18 | Service unavailable only on one instance | medium | `health` → `consul_service` → `logs_search` → `logs_trace` | Unhealthy instance/version/log correlation; no repair claim from read-only health. |
| W19 | Open isolated fix checkout and inspect final patch | small | `workspace_open` → `workspace_write` → `workspace_patch` | Git patch against recorded SHA; no unrelated source changes. |
| W20 | Run JVM regression and prove red then green | large | `test_context` → `test_run` → `workspace_patch` | Actual compiled test fails before fix, passes after, report captures test count and no skips. |
| W21 | Cancel long build and clean owned database lease | large | `job_cancel` → `testdb_resources` → `testdb_release` → `doctor` | Cancellation observed; registry/ownership checks and release cleanup confirmed. |
| W22 | Run Node tests through the JVM test runner | small | `test_run` → `doctor` | Expected gap probe: explicit unsupported-build result; terminal execution is separate evidence. |
| W23 | Guarantee exactly-once delivery across live Kafka and RPC | large | `kafka_lag` → `kafka_last` → `logs_trace` | Expected gap probe: bounded samples and logs cannot establish delivery or ordering guarantees. |
| W24 | Guarantee atomic commit across independent database servers | large | `fixture_capture` → `test_run` | Expected gap probe: local business fixture cannot prove distributed commit under partition. |

## Proof interpretation

The independent author publishes symptoms/contracts and a hashed buggy pack. The solver records actual registry calls and application patches in its own worktree. A separate hidden acceptance grader executes the candidates, protected-file checks and behavioral mutations. Project-level red/green through `test_run` is distinguished from external grader execution. See the committed challenge evidence and the new production readiness plan for verdicts, performance and uncovered work.

A SQL table usage is not a column lineage proof; an ES query is not an ES replay; a saved Kafka envelope is not a broker delivery guarantee; a library unit test is not cross-environment equivalence; and an `env` parameter is not evidence of where a test actually ran.

## Executed challenge results

The independent solver used the unchanged `4b6dc31` tools. Application source edits and tests went through workspace tools; independent acceptance execution is recorded separately.

| Case | Concrete situation | Observed result | Tool boundary |
| --- | --- | --- | --- |
| C01 | Multi-unit/VAT rounding inside checkout | Original 2 failures → candidate 2 passes; hidden boundary checks pass | Node tests require the external grader |
| C02 | Cents/major-unit mismatch between checkout and reservations | Original 2 failures → candidate 2 passes; malformed input never reaches the downstream module | Actual modules in process; no real network orchestration proof |
| C03 | Currency scale bug in an internal Java library | Real `test_run` Maven/JUnit 2 failures → 2 passes; independently compiled service/library checks pass | Native tool-run regression/build proof |
| C04 | Production TTL configuration differs from staging | Original 2 failures → candidate 2 passes over both configuration profiles | Configuration fixtures, not a deployed production process; Node runner gap |
| C05 | Adjacent large order IDs collapse during event deduplication | Original 2 failures → candidate 2 passes; tenant identity and rejection atomicity pass | Saved/in-memory events, not live Kafka delivery; Node runner gap |
| C06 | Duplicate IDs across tenants and four tables in two databases | Real PG original 1 pass / 3 failures → candidate 4 passes; hidden state/tenant checks pass. Tools captured 8 rows in 4 queries and exported/replayed both DBs | Native capture/replay works; Node application execution requires the grader; no distributed commit proof |
| C07 | Implement a cancellation policy with boundary tests | Original 1 pass / 1 failure → candidate 2 passes; 4 independent feature mutants rejected | Node runner gap |
| C08 | Write behavioral tests for an existing inventory module | Reference 2 passes; all 8 semantic mutants rejected; production bytes unchanged | Node runner gap |

All eight original submissions pass independent acceptance; this is **not eight complete tool-only workflows**. Only C03 has the full native JVM runner path. Original Node smoke placeholders remain explicitly skipped; the submitted regression tests execute. S01–S04 extend the evidence with column-lineage gaps, mixed-source recreation limits, the function-enrichment refactor and explicit test-target semantics. Two S01 text-search defects (recursive source globs and omitted CommonJS/ESM files) were fixed after the frozen solver baseline, with separate regression tests.

Public/oracle inputs were frozen before solving; the executable grader was implemented during solving and pinned afterward. S03's independent differential checks were authored after its candidate froze. This is useful independent engineering evidence, not a formal presealed or statistically representative benchmark.

See [solver transcripts and patches](../proof/developer-challenge/REPORT.md), [author acceptance evidence](../challenges/developer-results-v1/README.md), [small-model evaluation](compact-model-readiness.md), and the repair plan. No actual 27B model was available in this run.
