# Production readiness: independent developer challenges

Date: 2026-10-29 (Europe/Moscow). Baseline: `4b6dc31ebc085fd0852db986a23ed66840d0632f`.

This extends the [143-item completeness review](developer-tool-completeness-review.md) with executed developer situations. The target is a short, expandable Open WebUI tool list that a smaller tool-calling model can use reliably. Production readiness applies to a named workflow, language, environment and model configuration; neither a large unit-test count nor a scripted discovery benchmark certifies arbitrary architectures or a 27B model.

## Verification protocol

Three independent workstreams author incidents/hidden acceptance tests, solve public incidents using existing tools, and evaluate discovery/model ergonomics. They use separate Git worktrees. The author freezes public inputs and a private oracle hash before handoff; the solver receives symptoms, requirements and buggy projects, without expected patches. Candidate application edits and tests are made through the existing tool registry. Environment provisioning and an independent acceptance grader are recorded separately from tool execution.

Each case must report these distinct results:

- **Fix correctness:** unchanged hidden business assertions pass on the candidate application; protected inputs/contracts are unchanged.
- **Test sensitivity:** submitted tests execute the actual application and reject a relevant defect/mutant. Test counts, skips and compiler/infrastructure failures remain visible.
- **Tool-only completion:** discovery → source/data investigation → write → project test → inspect patch succeeds through supported tools. An external grader cannot turn an unsupported runner into a supported tool path.
- **Production coverage:** dependencies, environments, versions, runtime isolation and protocol guarantees actually exercised, plus explicit remaining gaps.

The process is procedurally blind, not an adversarial secrecy boundary between agents sharing a host. Future model evaluation must use withheld cases and tool-only access to the candidate workspace, without oracle files or solution text in prompts, discovery descriptions or training examples.

## Executed semantic impact probes

Run `node dev/impact-readiness.js` for a diagnostic JSON report. Run `node dev/impact-readiness.js --assert-ready` as an acceptance gate: exit 1 means unmet readiness obligations; exit 2 means a probe/infrastructure error. Inputs are temporary local repositories/passports/catalogs, queried through real `tool_execute` calls. No source network queries are made. [Frozen baseline evidence](evidence/impact-readiness-baseline.json) retains exact calls, outputs, source revision and timings.

All five baseline probes identify gaps. Small fixtures take roughly 6–91 ms per tool call on this host; these are not large-architecture throughput measurements.

| ID | Reproduced observation | Developer consequence | Required repair and acceptance test |
| --- | --- | --- | --- |
| IMP-01 / P0 | `public.orders` in alpha and beta resolves to one `table:public.orders` and returns both readers without ambiguity. `table:alpha:public.orders` resolves syntactically but returns no users. | A developer can select an unrelated service or miss a database-specific regression. | Canonical environment/database/schema/table identity; preserve database on edges, expose exact scoped input, reject ambiguous legacy names. Two databases with identical schema/table/function names must remain distinct through impact, test context and visualization. |
| IMP-02 / P0 | Four methods (two overloads in two library versions) yield one public ID and one impact node; signature-specific lookup returns nothing. | A library patch can appear to affect the wrong revision or overload; a same-named method can overwrite another. | Repository/revision/FQN/signature identity, explicit deployment/version resolution and disambiguation. Probe different arities/types and identical FQNs across service/workspace/library versions; preserve every node and correct callers. |
| IMP-03 / P0 | Stored `effective.consumes` and `effective.calls` do not contribute expected unindexed-service edges; a staging-only endpoint appears in a dev query. | Missing consumers/callers or wrong-environment services can be treated as an impact answer. | Normalize the actual passport contract into one versioned edge adapter. Filter or explicitly label environment/revision evidence; stale/unknown deployments remain gaps. Positive/negative tests must exercise normal stored passports, not alternate test-only shapes. |
| IMP-04 / P0 | Replacing an existing passport leaves old endpoint impact cached; the new endpoint appears only after touching the parent directory. | Investigation after a refresh can use obsolete behavior. | Invalidate from leaf artifact revision/file identity, not only directory mtime; include provider/config/revision in the cache key. Atomic replacement, equal-size edits, deletion and failure-retaining-last-good tests must distinguish stale evidence explicitly. |
| IMP-05 / P0 | A depth-2 traversal returns two callers while depth-8 finds seven; the shallow response has no incomplete-frontier/gap indicator. | A bounded search can be mistaken for an exhaustive affected-test set. | Track frontier, depth/node/time/output cut reasons separately. Return `complete:false`, bounded continuation and coverage metadata when any cut leaves unexplored edges. Test exact boundary, cycle, high fanout and unknown-node cases. |

These are current `impact` projection defects, not proof that every related tool fails. Scoped PG usage, textual code search and source-neutral knowledge identities can provide evidence or workarounds, but do not silently repair the impact answer. Avoid choosing a reduced regression set solely from impact until these gates pass.

## Planned implementation sequence

| Order | Work item | Stable interface | Completion gate |
| --- | --- | --- | --- |
| 1 | Repair IMP-03/04 with ordinary stored-passport fixtures, then IMP-01/02 identities and IMP-05 bounded traversal. | Versioned identity/edge DTO shared with code, usage and knowledge projections; backward-compatible queries report ambiguity. | Five readiness probes pass their obligations, negative controls remain effective, existing tool/bundle tests pass. Add cross-version migration tests before changing saved IDs. |
| 2 | Add an explicit language/build capability and runner adapter for supported Node projects, alongside Maven/Gradle. | Reviewed workspace run profile + structured tests, assertions, logs, timing and cleanup result; no arbitrary shell command from model arguments. | The current Node cases execute through tools with real red/green evidence; malformed profiles, timeout/cancel, leaked child processes, no-tests and skipped-tests cannot report pass. |
| 3 | Strengthen multi-database fixture semantics and independently observed effects. | Scoped capture plan, relation tuples/lineage, consistency/window metadata, hashed SQL/events and observation report. | Tenant-ID collisions, adversarial unrelated tuples, concurrent updates, precision boundaries, rejected-action no-write assertions and successful-action exact-write assertions. A two-database harness still does not establish distributed commit under partitions. |
| 4 | Separate evidence generation, diagnosis and grading for developer tasks. | Machine-readable case report: immutable input revision, exact tool transcript, candidate patch digest, baseline failure, post-change execution, hidden grade, mutation score and proof boundaries. | The grader rejects expectation weakening, edited harness/contracts, zero/skip-only tests and a plausible but non-generalizing patch. Cases never receive tool-complete status from an external shell runner alone. |
| 5 | Make discovery small and recoverable without semantic guessing. | Opt-in lean profiles + `tool_search` → `tool_describe` → validated `tool_execute`; exact enabled names, bounded output and default views. | Frozen relevance corpus and withheld wording; disabled tools/ambiguous identities/unknown environments remain explicit. Measure schema UTF-8 bytes, response sizes, call counts and p50/p95 latency rather than tool count alone. |
| 6 | Evaluate a real configured smaller model, then scaled production fixtures. | Opt-in OpenAI-compatible evaluator, exact model/server revision and generation settings, bounded context/turns/time/tool allowlist; no oracle access. | Actual model completes supported held-out workflows, avoids false success on expected gaps, recovers schema errors and preserves environment/cleanup boundaries. Scripted/mock-provider runs prove runner mechanics only. |

## Release gates and performance budgets

These are proposed acceptance budgets, not measured guarantees:

1. **Correctness:** zero false-success verdicts on the adversarial corpus; all supported hidden assertions pass; every expected unsupported scenario is reported accurately. Full native broker/runtime coverage is required before claims about real Kafka delivery/order or unknown runtime dependencies.
2. **Evidence:** each fix has an executable regression and an independently checked effect. Each test-writing task rejects relevant mutants. A changed expectation requires explicit business review, not automatic rewriting to match an implementation.
3. **Discovery/context:** start with at most five definitions in the opt-in small-model profile; expand one schema at a time. Target starting schemas ≤4 KiB UTF-8 and default search results ≤4 KiB; larger contracts/results need explicit retrieval or a view. Track exact tokenizer counts when that model's tokenizer is available; byte/4 is only an estimate.
4. **Reliability:** long operations return resumable job IDs, model retries do not duplicate actions, cancellation retains primary/cleanup failures, and source environment writes remain prohibited except explicitly intended API/UI actions. Leases must recover after process death.
5. **Scale:** benchmark 1,000+ service passports, multiple library revisions, at least 100,000 graph edges and representative real catalogs; warm cached discovery/impact target p95 ≤250 ms on a specified host. Include cold index time, memory peak, high fanout and output caps. Small local probe timings cannot substitute for this run.
6. **Model:** report completion by task/language/protocol and false-success rate with confidence intervals, not a single blended score. Use multiple seeds and withheld incidents. A proposed first gate is ≥90% supported-task completion and zero false-success claims across at least 30 independent tasks; zero observed failures is not proof of zero real-world risk.

The configured local Open WebUI presently identifies a scripted demo model. There is no verified 27B inference endpoint in the evaluated configuration. Keep any model-specific readiness claim pending until actual inference is run with the recorded endpoint/model version. The evaluation interface is model-agnostic; a model name alone does not establish its size, context behavior or tool-call accuracy.

## Additional user requests: mandatory acceptance gates

The four exact requests are mapped in [developer scenarios](developer-scenarios.md). Run `node dev/request-readiness.js` for [the frozen supplemental report](evidence/user-request-readiness-baseline.json). It uses real cached-index/planning tools and a deliberately stubbed project runner to inspect argument routing; it does **not** execute an application against a dev environment.

| Gate | Observed behavior | Planned change and proof |
| --- | --- | --- |
| REQ-01 / P0 — column read/write lineage | `pg_usage` returns three table-level function usages but zero column usages. Column `impact` finds the two relevant functions, with `body` edges that do not classify column reads versus writes. | A column lineage contract retaining env/db/revision/file/line, read/write/read-write/predicate/unknown access and caller chains. Exercise SET target vs RHS, WHERE/JOIN, SELECT *, aliases, views/materialized views, triggers, procedures, ORM field access and dynamic SQL. Unknown/generated code must be reported as uncovered. No claim of “all places” from table usage plus string matching. |
| REQ-02 / P0 — PG/ES/Kafka recreation | SQL/Kafka `fixture_plan` has no ES argument. An extra `es` field is silently ignored with no plan gap. `scenario_state_plan/capture/export` can separately represent ES state, but this does not supply a native ES replay/runtime adapter or automatic complete relationship discovery. | Explicit unsupported-input rejection, shared dependency/capture plan with typed state obligations, reviewed PG↔ES↔Kafka identity/tenant relationships and complete per-kind coverage. Replay real ES mappings/documents plus PG constraints and Kafka envelopes in the selected supported harness. Missing ES or a truncated event window must prevent a completeness claim. |
| REQ-03 / P0 — behavior-preserving function-result enrichment | S03 now demonstrates actual before/after JVM equivalence against read-only fixture-source function results and an owned local scratch replay. Independent compiled baseline/candidate checks also agree. A genuinely remote deployed-dev process remains untested/unavailable; static impact still has the IMP gaps above. | Add a public enrichment service/PG-function fixture and hidden differential oracle: old/new code with the same captured inputs, exact DTO field precedence/types/nullability/errors/order and side effects; readonly dev baselines, recorded deployed/function/schema versions, explicit normalization for nondeterministic fields. Local equivalence and dev observation are separate verdicts. A proposed code patch alone cannot pass. |
| REQ-04 / P0 — explicit test target | `test_run(env="dev")` alone forwards no target environment. With `db`, it selects the source DDL copied into scratch; the schema already describes this. Separately, simultaneous same-workspace/same-test calls for dev/orders and staging/another-database join the same job, since the job key omits these inputs. | A reviewed target manifest distinguishing local, captured-dev and live-dev modes; report actual runner host, service/deployment revision, sanitized dependency targets and allowed effects. Hash all execution-defining inputs into the job identity (including bindings/files/mode), or reject a conflicting join. Prove two simultaneous target profiles cannot receive one another's results. Env spelling must not imply a live target. |

Also repair operational evidence filtering: a successful tool invocation returning a failed job is currently recorded as a successful call; the solver observed `call_history(failed=true)` omit such failures. Retain transport/invocation status separately from typed job/test/assertion status, link the job and trace, and filter by the requested status. Do not infer failure solely from HTTP status: a valid test may deliberately expect a 404.


## Results of this verification wave

Eight original candidates pass independent acceptance. C03 has actual native Maven/JUnit red/green proof; seven Node cases remain tool-incomplete despite correctly graded fixes/tests. C06 separately proves real read-only multi-database capture/export/replay and business-state rejection/success checks. S03 adds local/JDBC differential refactor proof; remote-dev execution remains separate. The original fixtures/oracle were pre-frozen, while grader implementation was completed during solving; this is not a sealed model benchmark.

The rebuilt integrated default suite passed 376/420 tests, zero failures, with 44 explicit opt-in skips. The challenge acceptance and JVM/PG runs are separate executions, not additions to a unique-test total. Both readiness probe programs intentionally report unmet gates; a passing default suite does not override those results.

New bundled Open WebUI configuration uses `lean-find`: `find`, `tool_search`, `tool_describe`, `tool_execute`, `tool_profiles` (five definitions, measured 2,834 UTF-8 bytes in the temporary default fixture). Four-tool `lean`, eleven-tool `compact` and larger task profiles remain selectable. Existing configured preferences remain effective. Discovery expands enabled capabilities; it does not grant permissions.

Experimental BM25 improves a 32-query development corpus but regresses independent symptom hit@5 from 71.4% to 66.7%; it remains opt-in through trusted configuration, with the historical default preserved. The four exact user workflows also expose poor multi-stage retrieval. See [the complete discovery/model evidence](compact-model-readiness.md). No actual 27B inference was performed: the available demo model is scripted. `dev/eval-discovery-model.js` supplies a bounded, opt-in discovery evaluator; it validates intended operations without executing application tasks and therefore cannot alone certify task completion.

## Source-search defects fixed after the frozen baseline

The solver's S01 evidence found two additional false negatives: `code_search` with `glob:"src/main/**"` omitted known nested Java SQL, and `.cjs` sources readable through `workspace_read` were absent from the text index. These were repaired separately from the frozen solver run:

- Glob conversion now consumes input tokens once, preserving recursive `**`/`**/`, single-component `*`, `?` and correctly anchored comma alternatives.
- Text indexing now includes `.cjs`, `.mjs`, `.cts` and `.mts` source files. Refresh previously cached code indexes to include these newly supported extensions.

`test/code-glob.test.js` exercises nested/direct/module paths, exclusion controls, alternatives and the actual `code_search` tool. The focused code-index/performance group passed 15 tests. These fixes recover text hits; they do not supply complete column read/write semantics, Node dependency graphs or a Node test runner. The original five impact gates and supplemental target/lineage/replay gates remain unmet.
