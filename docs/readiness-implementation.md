# Readiness repair implementation

Updated 2026-10-29. This is the implementation follow-up to the frozen production-readiness findings. Baseline reports remain unchanged. Implementation, independent grading, model completion and deployed-environment verification are separate results.

## Composable workflows

| Developer request | Stages available through tools | Proof and limits |
| --- | --- | --- |
| Find every known reader/writer of a column | `find` → scoped `pg_usage` → `impact` → `pg_function` / `code_search` / `code_read` | Environment/database/revision/signature identities, classified column access and caller evidence. Dynamic SQL, nested/quoted SQL parsing, reflection/generated code and missing indexes remain explicit coverage gaps. “All places” cannot be inferred from text matches. |
| Recreate a cross-system state bug | `scenario_inventory` → `fixture_plan` → `fixture_capture` → `fixture_validate` → `fixture_export` | Typed PG/ES/Kafka obligations, reviewed relation tuples and tenant/seed lineage, per-source snapshots, bounded windows, schema/codec checks, precision guards and hashed test resources. No distributed atomic snapshot is claimed. |
| Exercise native captured dependencies | `fixture_runtime_preflight` → `fixture_runtime_start` → `fixture_runtime_bindings` → `fixture_runtime_arm` → `test_run(fixture_runtime=...)` / `fixture_runtime_publish` → `fixture_runtime_observe` / `fixture_runtime_check` → `fixture_runtime_stop` | Owned disposable PostgreSQL, ES and Kafka-compatible broker; exact effects and protected committed PG write journals. Explicit datasource prefixes bind every captured database. Project execution retains the lease for an independent check; its result alone does not certify effects. Kafka offsets/timestamps are remapped. Source environments receive no replay writes. |
| Refactor function-result enrichment | `impact` / `pg_function` → capture representative inputs → `differential_check` → `test_run` | Separate executable baseline/candidate workspaces, exact declared DTO/error/order/byte comparisons, reviewed normalization and independent file/PG observations. Unsupported opaque values fail closed. Captured-source local equivalence and a deployed-dev observation are different verdicts. |
| Run a test on dev | `test_targets` → `test_run(target=...)` → exact-job polling → `call_history` / `workspace_patch` | Reviewed local/captured-dev/live-dev manifests, actual placement and declared deployment/dependencies/effects. `env=dev` remains source context. Unknown/unavailable live targets fail without local fallback. |
| Turn a UI investigation into reusable requests | `api_browser_open` / `api_browser_action` / `api_browser_capture` → `api_exchange_get` → `api_request_prepare` → intended replay / `api_request_save` → collection suite | Existing browser/API client and pretty JSON views stay enabled. Saved requests remain ordinary parameterized scripts; credentials are runtime placeholders. |
| Evaluate a smaller tool-calling model | `dev/eval-tasks-model.js` with an explicit endpoint/model and independently frozen task pack/private grader → `evaluation_evidence` | Actual tools execute inside disposable network-none containers. Private expectations stay with the parent grader. Exact model/runtime/image/generation/budgets, safe chained transcripts, protected inputs, patch hashes, red/green, mutants and false-success verdicts are retained. Scripted endpoint checks validate the evaluator, not a model. |

Each native fixture lifecycle operation is separately callable. Observer/check results default to compact summaries with full interactive evidence. SQL-only `fixture_replay`, contract `scenario_emulate`, isolated application `scenario_run` and native dependency effects retain different proof scopes.

## Discovery and independent updates

New bundled Open WebUI configurations start with `lean-find`: five definitions. `tool_search` retains the compatible ranker and adds bounded planning-guide suggestions. `workflow_plan` expands a selected guide into prerequisites, exact enabled stage tools, unavailable capabilities and explicit boundaries. A guide routes evidence gathering; it does not diagnose a symptom or imply that a configured runtime is available.

Built-in guide data lives in `lib/workflow-guides.json`. Teams can update one source independently through `DT_HOME/workflows/<name>.json` containing `{version:1,guides:[...]}`. These files contain data, not commands. Tool permissions still apply. Default search JSON is bounded to 4 KiB; oversized results retain a full view, counts and omission metadata. Existing installations keep their configured profiles and historical ranking; BM25 remains opt-in.

The public contract catalog now includes multiple version directories: identity, column lineage, passport edges, `dt.impact/v2`, fixture runtime and evaluation evidence. Exact/prefix HTTP backend adapters remain available for gradual replacement with another language, graph, RAG index or database. A consumer should use canonical identities and versioned DTOs rather than parse display labels.

The independent frozen compound-request review found the intended guide in 22/24 supported requests and all 62 declared stage capabilities after integration. Both unrelated requests abstained; permission checks passed. Two column-lineage paraphrases remain routing misses, with direct `workflow_plan` available as recovery. The independent report and next-corpus plan preserve those misses; the held-out wording was not used to retune ranking.

## Verification commands

```sh
npm run build
npm test
node dev/impact-readiness.js --assert-ready
node dev/request-readiness.js --assert-ready
node dev/benchmark-impact.js --assert-ready --output docs/benchmarks/impact-scale.json
node dev/benchmark-discovery-scale.js --assert-ready
DT_TEST_NATIVE_FIXTURE=1 node --test test/reproduction-native.test.js
DT_TEST_NATIVE_BRIDGE=1 node --test test/fixture-runtime-bridge.test.js
DT_TEST_TASK_EVAL_DOCKER=1 node --test test/task-model-evaluation.test.js
node dev/verify-node-challenges.js  # C06 additionally needs an owned disposable DT_TEST_PG_URL
```

The seven previously unsupported Node challenge submissions now execute through `tool_execute → test_run`; C06 includes real two-database red/green verification. Node 22 and 24 use structured test events with stable file identity. Empty/nested skip-only files cannot pass; module-load errors remain distinct from real assertion failures. Full-run assertion/error counters precede preview truncation and credential masking. Cancellation/deadlines kill descendants. Job identities include inputs, target/configuration and workspace content; conflicting mutable workspace executions do not share results. Reviewed placement also governs every fast Maven preparation/compiler/launcher command and JDK probe, independently of a global runner setting.

Retained failure history distinguishes invocation, job, test and assertion outcomes, refreshes asynchronous job results and filters failures before applying limits. An intentionally expected HTTP 404 is not automatically a failed call. Selected execution credentials are masked in parsed failures, reports, views, logs and history after verdicts are computed.

Independent review added adversarial negative controls for identity collisions, stale leaf artifacts, bounded traversal, arithmetic-versus-star SQL, quoted names/overloads, encoding failures, opaque/byte-backed values, credential echoes, hidden grading, mutation sensitivity and protected files. See [impact evidence](evidence/impact-readiness-implemented.json), [Node challenge reruns](evidence/node-challenge-rerun.json), [impact scale](benchmarks/impact-scale.json), and [discovery scale](benchmarks/discovery-scale.json). Counts from overlapping live/default executions are not summed as unique tests.

Final integrated verification is retained in [the machine-readable run record](evidence/readiness-integration.json):

| Execution | Result |
| --- | --- |
| Rebuilt default suite | 442 passed, zero failed, 47 explicit prerequisite-dependent skips; 489 tests in 51.2 seconds |
| Actual owned PG/ES/Kafka native integration | 15 passed, zero skips; 250 seconds; cold startup 149 seconds (prior sample 177 seconds) |
| Actual project/native-lease bridge | 7 passed, zero skips; includes owned PostgreSQL action → independent effect check → retained lease → cleanup |
| Isolated task evaluator | 4 passed, zero skips; five scripted task cases, protected inputs, oracle isolation, crash-sensitive mutation grading and recursive retained-output privacy checks |
| Live Maven/Temurin fixture | Passed red/green, Spring slice, compile error and full build; unchanged rerun 2.65 seconds, full build 33.22 seconds on this run |
| Cached scale gates | 1,000 passports / 100,008 edges: warm impact p95 223 ms; 1,000 extra tools: discovery p95 140 ms; five starting schemas 2,989 bytes |

The final scale measurements ran alongside Maven and the other scale benchmark on the recorded host. These are observations under that load, not latency guarantees. Both readiness probe programs pass; their routing/metadata checks retain explicit limits and do not stand in for application execution. The full distribution passes `npm run build:check`. Desktop/mobile inspection confirmed differential, impact and fixture views; the fixture records and relationship graph scroll within the mobile viewport.

## External verification and explicit unsupported coverage

Actual execution against a customer's deployed dev target requires a reviewed reachable runner/dependency manifest and its intended access. No such customer deployment was available here. Actual approximately 27B evaluation requires a real configured inference endpoint, exact model/runtime/tokenizer provenance and a separately authored frozen multi-task corpus. The available demonstration model is scripted; no model readiness or production certification is inferred from it.

Native capture/replay currently supports the declared SQL, object/scalar ES mappings and JSON/string Kafka payloads. Nested ES query semantics, Avro/protobuf wire codecs/schema registries, broker transaction/consumer-group fidelity and exhaustive runtime read instrumentation require explicit adapters. Unsupported parts fail preflight or remain coverage gaps; they are not silently replaced by an empty fixture. ES deletion/recreation and broker-retention/transient effects have the observer limits stated in their reports. Dependency containers publish only local loopback bindings; their owned bridge is not an egress sandbox for arbitrary project tests. The isolated model evaluator separately disables network and host capabilities.

Broader product ideas from the 143-item completeness inventory—debugger attachment, clocks/randomness, richer graphical binding editors, team approval/ownership and CI policy—remain separately scoped extensions. This repair pass supplies the named readiness contracts, supported implementations and tests; it does not claim that arbitrary future protocols or every possible architecture need no further work.
