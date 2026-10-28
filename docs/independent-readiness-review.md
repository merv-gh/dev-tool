# Independent readiness review

The review used a separate worktree based on `b426e973c116d4f91f384827e4c7bbfec82b7695`. The reviewer did not author the evaluator or workflow guides. This review found and fixed concrete false-success and evidence gaps; it does not establish production certification or smaller-model performance.

## Evaluator findings and fixes

- Harness-generated passing tests were being counted as model completion even when the model never tested its patch. Supported execution and model-observed completion now have separate verdicts and aggregate counts. Final candidate hashes bind the observed model test to the graded revision.
- A private grader exception could disclose its expected values in retained public `grade.error`. Private exception text and arbitrary returned diagnostics are now withheld. The parent counts assertions and retains only public verdict fields. Asynchronous grading has the remaining wall-clock deadline.
- A mutation that crashed with an unrelated runtime error could be counted as a killed behavioral mutant. Kills now require assertion-only failure counts, no skips, and no hidden/truncated test errors. The evaluator consumes full-run authoritative counts when available and otherwise fails closed on incomplete previews.
- The protected-file audit ignored every directory named `build`, `target`, `node_modules`, `.gradle` or `.dt`, including nested executable inputs. It now audits those inputs; only exact root runner report names are excluded. Symlinks outside the excluded Git metadata are rejected. Artifact tampering invalidates all completion verdicts.
- Synthetic target/tool configuration was writable by candidate code. It now lives in the read-only public staging mount. The sandbox has no private grader mount, host configuration, Docker socket, endpoint credential or network. Model attempts to invoke private RPC operations as tools are rejected by the actual registry.
- Cleanup failures were swallowed after evidence was saved. Cleanup is now recorded before signing, failures are retained, and certification requires completion.

Actual Docker checks use a scripted OpenAI-compatible endpoint. The five cases exercise a correct model fix with model-observed tests, an overfit constant answer rejected by hidden inputs, a correct patch tested only by the harness, a private grader exception, and an unrelated runtime mutant crash. These are protocol and evidence checks, not language-model results.

## Frozen discovery review

The reviewer authored 26 compound requests with expected guide and stage capabilities, then froze SHA-256 `5a897b532c550cd2dcfb30056b98c5a2d9d96fda0caf20e7616ee835964d1d61` before executing any of those requests. The reviewer had read current guide definitions first; independence does not imply blindness. [The frozen corpus](../dev/eval/independent-compound-workflows.v1.json) and [first complete report](benchmarks/independent-compound-workflows-v1.json) remain unchanged.

The first real-registry measurement found the expected guide within the two returned candidates on **22/24 supported requests (91.7%)**. Both unrelated requests returned no guide. Search output stayed within **3,780 UTF-8 bytes**. All three disabled-tool checks correctly removed executable candidates and rejected dispatch. Of 62 declared stages, 55 had all expected enabled capabilities on that baseline. Five missing stages depended on native runtime tools being implemented in parallel. Two names were incorrect in both the guide and frozen reviewer labels: CLI `describe` meant `pg_table`, and `fixture_inspect` meant `fixture_validate`. The guide references were corrected without changing vocabulary or ranking. [Explicit errata](../dev/eval/independent-compound-workflows.v1.errata.json) preserve those corrections separately.

Supported boundary cases returned explicit guide limitations for distributed atomicity/exactly-once replay, captured versus deployed dev equivalence, environment labels versus execution targets, symptom diagnosis, and mutation replay scope. That checks availability of limitations; it does not prove a model understands them. A vague “do everything” request cannot establish task identity or execution authority.

## Follow-up plan from held-out failures

1. Column-lineage routing missed two paraphrases: removing a named field while enumerating assignments/predicates/stored routines, and proving absence of ORM/runtime-assembled SQL readers. Preserve this report. Develop any intent-routing improvement against a new development corpus, then independently author a new held-out set. Do not turn these measured failures into a fresh held-out success claim by tuning keywords to them.
2. Keep direct `workflow_plan` listing available when lexical routing abstains. A guide is a plan with prerequisites, not a guarantee of available connections or a proof of exhaustiveness. Dynamic SQL, generated code, missing revisions and bounded traversal must remain explicit limitations in lineage output.
3. Rerun stage availability after native PG/ES/Kafka tools are integrated, applying only the published capability-name errata. Retain the first report and label the new source/guide/registry hashes.
4. Run a verified smaller-model endpoint against at least 30 independently authored tasks with actual tool execution, supported targets, bounded context/calls/time, and false-success checks. No actual 27B inference was available for this review. Scripted endpoint success cannot fill that evidence gap.
