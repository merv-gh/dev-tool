# Joern navigation through code mode and question-shaped tools

Code mode can call the existing semantic tools and return a small, useful projection of their evidence. The Qwen 3.5 2B pilot could not reliably assemble that workflow from a general code description. Clearer assumption inputs and outputs made two synthetic scenarios pass. On fresh real graphs, the question tools retrieved the right evidence and preserved proof limits, but both final answers still failed endpoint-label and citation requirements. These prototypes are not ready to register for reliable 2B use.

There are two phases. The initial small-model comparison uses **synthetic CPG worker records** with the production Node sandbox, registry, retained-projection navigation, map construction, trace evaluation and compact adapters. Docker was initially unresponsive, so the first live-test invocation skipped. After recovering Docker Desktop, fresh real Joern Java/JavaScript tests exercised actual CPGs and an independently compiled behavioral oracle. The cached image contains Joern **4.0.533**; this does not verify the newer pinned image. Historical evidence in [semantic-code-e2e.json](benchmarks/semantic-code-e2e.json) remains a separate run.

The candidate question tools are **evaluation-only adapters**, not newly registered production tools. No production tool names or descriptions changed. The live run did find and fix one production exporter bug: nested JavaScript function facts were also emitted for the enclosing module, causing duplicate CPG IDs and failed navigation. Facts now retain only their actual owning method; the bundle and live regression test were updated.

## What code mode can do

The existing `code` tool runs Node JavaScript with `tools.NAME(args)`, `tools.call(name,args)`, `tools.list()` and `tools.tool_describe(...)`. Tool calls receive the tool response before chat compaction. Joern parsing/querying runs behind the named semantic API, outside the JavaScript sandbox; this is not arbitrary Joern Scala execution from code mode.

The useful workflow is:

1. `semantic_index({})` lists current retained analyses without starting a parse.
2. `semantic_query({analysis,operation:"flowmap",from:{name:entry},all:true})` returns the whole entry map: changes, decisions, exits, assumptions and coverage.
3. `semantic_trace({analysis,from:{kind:"method",name:entry,parameter},to:{kind:"call",name:sink,argument},assumptions,all:true})` returns independent value/control evidence.
4. Read `sides[].data.paths[].assumptionEvaluation` and the corresponding control paths separately. A matching CFG predicate does not constrain the value-flow query or prove feasibility.
5. Return selected facts and retained `view` links. `all:true` expands retained response fields; it does not remove graph budgets, establish complete source coverage, or prove runtime behavior.

Actual production queries can return owned jobs. Poll the same tool with its returned `job`, rather than restarting it. The initial model experiments bypass the remote job orchestration with a synthetic query worker; they do not test model polling behavior. The live follow-up uses real owned jobs and observes them on the server side of the candidate adapter.

## Measured output sizes and examples

Sizes are serialized UTF-8 JSON bytes, not estimated tokens. This is a deliberately small five-state map and one value/control path, not a large-repository size benchmark.

| Output | Full retained response | Existing 4 KB preview | Candidate selected evidence |
|---|---:|---:|---:|
| Entry-to-exit map | 9,720 | 3,813 | 1,470 |
| Trace with original nested assumption evaluations | 9,552 | 3,462 | 1,786 |
| Trace with explicit declared assumptions and checks | 9,552 | 3,462 | 1,653 |
| Combined map + trace | 19,272 | 7,275 | 2,142 through one hand-written `code` projection |

The combined code response is 89% smaller than the two full responses, including the code tool's response envelope; its selected returned object is 1,779 bytes. Its code also lists the current analysis internally. This hand-written probe establishes that the execution path works; it is not a model success.

| Concern | Before | Candidate after |
|---|---|---|
| Entry and exit | Repeated CPG identities, source metadata and graph records | `entries:[{name:"submit",file,line}]`, `exits:[{code:"save(payable)",kind:"external-or-unexpanded-call",file,line}]` |
| Value reaching the sink | Full path nodes, edges, repeated revision locators | `sinks:[{side:"current",code:"payable",file,line}]` with the full trace at `view` |
| Assumption input versus evaluated result | `assumptions:[{expression,holds}]` beside nested path objects | `declaredAssumptions:[{expression:"rebate < 0",holds:false}]`; `assumptionChecks.data:[{evaluation:"unresolved"}]`; `.control:[{evaluation:"matches-assumptions"}]` |
| Completeness | Several meanings of `status` and `truncated` | `output:{status:"part",scope:"selected-evidence",sourceTruncated:false}` plus `complete:false` for the map and explicit proof fields |
| Raw evidence | Large inline paths | Retained `view`; the same candidate accepts `all:true` to return the full underlying response |

The 4 KB trace preview omitted both detailed paths in this fixture while retaining summary/proof fields and explicit omission counts. A model cannot recover endpoint expressions or per-path assumption checks from those summary counts. It needs full retained fields or a more selective projection. The default semantic preview budget is 16 KB; the 4 KB stress case is explicitly requested, not the default behavior.

## Small-model pilot

All arms use the same combined user task, Qwen `qwen3.5:2b` (1.9B, Q8_0), temperature 0, seed 42, thinking disabled, a 32,768-token context, 1,024 generated tokens per response, eight turns, sixteen calls and a 90-second response timeout. [Environment metadata](benchmarks/semantic-model-environment.json) records the model digest and CPU execution. There is one trial per arm, not a statistically powered benchmark. Cache warming and sequential arm order prevent interpreting elapsed times as a fair speed comparison.

| Interface | Schema bytes | Calls | Observed result |
|---|---:|---:|---|
| Existing `code` description | 2,233 | 8 | Repeated SQL attempts for the semantic task; no map or trace |
| Code + semantic recipe | 3,215 | 2 | Submitted `tools.*` as external function names; provider HTTP 500 ended trial |
| Code + explicit external envelope | 3,585 | 2 | Same external-name confusion; provider HTTP 500 |
| Shorter code description, Node only | 2,152 | 3 | Called the index but printed/returned nothing; repeated it and ultimately claimed runtime verification without evidence |
| Five existing semantic tools | 25,164 | 0 | 90-second response timeout; this is not a semantic-quality result |
| Three narrow tools, plain names | 2,093 | 3 | Retrieved map and requested trace; final answer confused predicate expressions with evaluation statuses |
| Same narrow tools, question names | 2,109 | 3 | Retrieved map and a trace but omitted the requested predicate assumptions |
| Question tools + clearer assumption input and output | 2,466 | 3 | Correct requested trace, sink, independent assumption statuses, incomplete map, no runtime proof, and retained links |
| Same clearer interface, contradictory predicate | 2,466 | 3 | Correct `contradicts-assumptions` control result and `unresolved` data result; no runtime proof |

The names-only comparison keeps descriptions, schemas except tool names, adapter mappings and outputs identical:

| Plain name | Question-shaped name |
|---|---|
| `analysis_list` | `which_analyses_exist` |
| `entry_exit_map` | `what_happens_from` |
| `value_trace` | `where_value_flows` |

Both selected the right capabilities. Neither completed the combined task correctly. This pilot supports question-shaped names as intent-oriented vocabulary, but **does not establish that renaming alone improves accuracy**. The successful revision also explains that omitted assumptions mean none, and separates declared inputs from evaluation results. Those changes are tested together, so their individual contribution is not isolated.

The clearer interface passed two scenarios on the same synthetic graph: the displayed CFG predicate matched the declared false polarity, and contradicted the declared true polarity. Both answers retained unknown value-flow feasibility and false runtime verification. This is a useful directional result, not evidence of broad repository or language generalization.

The grader requires actual map/trace receipts with the requested entry parameter, sink argument and predicate polarity, a correct final answer, retained links, and honest proof/coverage. Fetching evidence without answering correctly is not a pass. A call expression such as `save(payable)` is accepted as the exit call, avoiding a formatting-only failure.

## Fresh Joern follow-up

Docker Desktop's engine socket initially timed out despite the UI being open. Restarting the stuck backend recovered it. The isolated test worker used the existing local image `sha256:e02c5bbfb9f8ef92c448a7e8e266e65ec6e3652c1522301ad807d01a8cac6577`, with four CPUs, a 6 GiB container limit, a 3 GiB parse reservation and a 2 GiB query reservation. Its actual CLI banner reports Joern **4.0.533**. The inherited worker defaults initially claimed the newer version/image; those configuration values were explicitly corrected before the model runs, and the repaired source was reparsed for that worker identity.

The first live map test passed its Java checks but failed JavaScript navigation with `UNIQUE constraint failed: records.type, records.id`. The same assignment/return fact appeared once for the module and once for its nested function. Filtering exported facts to `n.method.id == m.id` fixed the actual attribution error rather than discarding records during SQLite ingestion. The new live assertion checks fact-ID uniqueness and the assignment's owning function. Both full live tests then passed: [map verification](benchmarks/semantic-live-flow-map-verification.json), [trace verification](benchmarks/semantic-live-path-trace-verification.json). They cover Java, JavaScript, real loop cycles, field mutations, exception boundaries, sink bindings, shifted lines and the independent failing-before/passing-after behavioral oracle.

The exporter change updates the enrichment digest. Refresh/reparse retained analyses with `semantic_index` after deploying the bundle; CPGs from an older enrichment bundle intentionally report incompatible-engine coverage gaps. Their saved raw views remain readable. The live rerun used fresh generations rather than weakening that compatibility check.

The [live harness](../dev/eval-semantic-live-model.cjs) then reindexed the repaired Java workspace against the correctly identified worker. It uses the production registry, real CPG queries, Node sandbox and owned-job observations. The task supplies the exact repaired analysis id, so this is not directly comparable to the earlier revision-discovery task. The two live arms use the same task, source analysis, model settings and tool names; the second changes descriptions and selected-output structure.

| Fresh real evidence | UTF-8 JSON bytes | Scope |
|---|---:|---|
| Saved full map payload | 139,090 | One entry, three reached methods, 28 states, 124 transitions |
| Saved full trace payload | 197,745 | Selected value path and eight retained control paths; bounded coverage |
| Both full saved payloads | 336,835 | Payloads exclude their outer saved-view envelopes |
| Requested 4 KB map preview | 4,084 | Omits 26 states, 123 transitions and other metadata explicitly |
| Requested 4 KB trace preview | 3,655 | Omits all nine detailed paths; retains summary/proof and raw bridge |
| Hand-written code response | 3,120 | Selected facts plus links; includes code response/polling receipts |
| Hand-written typed evidence proposal | 2,655 | Separates exit kinds and groups equal check summaries with retained path indexes |

The code probe completed under the normal 60-second code timeout. The second cached run's envelope was 2,956 bytes because fewer job-observation receipts were needed. The small code responses are selected summaries, not a claim to inline all graph evidence.

The [independent capture](benchmarks/semantic-real-joern-evidence.json) actually calls `result_read({id,all:true})` for both saved views and retains the full payloads. Its receipts show the distinction requested for tool outputs:

```json
{"complete":true,"completeScope":"retained-value","sourceCoverage":{"status":"partial","provenComplete":false}}
```

Thus all retained evidence can be read at once while the underlying static analysis remains bounded. Equal displayed assumption checks can be grouped with `retainedPaths:[0,1,...]`; this does not claim that their complete paths are equivalent or exhaustive.

| Real-model arm | Calls | Selected response bytes | Final answer |
|---|---:|---:|---|
| Question tools + assumption clarity | 3 | Map 4,777; trace 5,326; list 829 | Correct value `payable`, statuses and proof limits; selected `isBlank()` as the requested sink/exit and cited only one view |
| Separate method exits, call boundaries and selected sinks | 2 | Map 4,295; trace 1,271 | Correct statuses and proof limits; selected `Method exit`, put the whole call in the value-expression field, and cited only one view |

Both arms submitted the exact requested parameter, sink argument **2**, and compound predicate polarity. Neither is counted as a final-answer success. Preserve the [first live transcript](benchmarks/semantic-real-joern-question-brief-2b.json) and [refined live transcript](benchmarks/semantic-real-joern-question-typed-2b.json) rather than extrapolating from the synthetic successes.

The live task's own requested field `exitCall` also conflates an external graph boundary with the selected trace sink. That limits the interpretation of these failures: they establish correct retrieval with unreliable final field mapping/citations, not inability to query real dataflow. A better next protocol should request `traceSinkCall`, `argumentExpression`, `methodExits`, `externalCallBoundaries`, `mapView` and `traceView` explicitly. Returned sink fields should use `argumentExpression` and `callExpression` instead of generic `value` and `call`. This refinement is a recommendation, not a verified model improvement.

## Qwen 4B follow-up

The requested `qwen3.5:4b` run uses the SSH box and its existing Ollama 0.40.13 instance. The model advertises 4.2B parameters, Q4_K_M and digest `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`. It runs fully on an RTX 3080 Ti with a 32,768-token context. The earlier 2B runs used Q8_0 on a local CPU and a different runtime; these are comparisons of the tested setups, not a controlled parameter-count or latency study. See [environment metadata](benchmarks/semantic-model-environment-4b.json).

For the two real Joern arms, prompts, tool schemas, inference settings and grader match the baseline. The typed pair also has identical adapter hashes. The brief baseline predates the gated typed extension (`3cb09da` to `3179125`); review of that diff confirms its brief schemas and output branch are unchanged despite the file hash changing. The harness change only adds `--endpoint` and records it. Each arm is one deterministic trial, not an estimated success rate. The ambiguous requested `exitCall` field is deliberately preserved for comparison.

| Real Joern output variant | 2B result | 4B result |
|---|---|---|
| Assumption clarity | Correct requested trace; wrong exit field; one view | Requested `all:true` map (139,152 bytes), skipped the trace, returned a narrative and exhausted its output budget |
| Typed exits and sinks | Correct requested trace; full call in value field; one view | Omitted sink argument **2**, so the adapter defaulted to **1** and returned `tenant`; returned wrong assumption-field shapes, but included both views |

Neither 4B live arm passes the unchanged grader. The [brief transcript](benchmarks/semantic-real-joern-question-brief-4b.json) shows that merely offering `all` can draw the model toward unnecessary raw graph output. The [typed transcript](benchmarks/semantic-real-joern-question-typed-4b.json) shows a different problem: the system returned the wrong argument for the user's request because the model omitted the selector and the adapter silently defaulted it. This is an input-design failure worth fixing even though the underlying query faithfully honored the adapter's inputs.

The nine synthetic arms were also repeated. Full reports and checks are linked from the [paired comparison](benchmarks/semantic-qwen-4b-comparison.json); prompts, instructions, schemas and settings match in all eleven pairs.

| Synthetic arm | 2B baseline | 4B follow-up |
|---|---|---|
| Original code | Repeated unrelated queries | Invented evidence context; no semantic reads; claimed verification without proof |
| Guided code | Invalid external tool names | Eight calls; variable redeclarations, wrong response shape, incomplete trace selector |
| Wrapped code | Invalid external tool names | Eight retries; empty outer output with failed internal query receipts |
| Minimal code | Retrieved list without returning it | Eight calls; repeatedly listed analyses but still used a repository name as an analysis id |
| Direct semantic tools | Endpoint timeout | Eight repeats of the same `maxPaths` validation error |
| Plain narrow tools | Right retrieval; wrong assumption status fields | Right retrieval; reported `gross - rebate` instead of the selected expression `payable`; status objects |
| Question names only | Omitted requested trace assumption | Right retrieval and values; correct statuses inside objects |
| Question + assumption clarity | Pass | Right retrieval and values; correct statuses inside objects |
| Same, contradictory assumption | Pass | Right retrieval and values; correct contradictory/unresolved statuses inside objects |

The unchanged strict grader records **0/11 for 4B versus 2/11 for 2B**. That number alone misrepresents the narrow-tool results: the prompt lists JSON keys but does not declare scalar types, and three 4B answers preserve the exact correct statuses under `.status` or `.evaluation`. A separately labeled, post-hoc shape-sensitivity check unwraps only those two fields and reruns the same grader: **3/11 versus 2/11**. Neither real Joern arm passes even that check. Original strict grades and raw answers remain unchanged. This small, confounded pilot does not establish a general model ranking.

The useful finding is that 4B can navigate the narrow synthetic tools, including the contradictory condition, but it still needs a clearer answer schema and safer selector inputs for real graphs. The direct-tool validation loop also suggests errors should include the rejected value, allowed range and a valid retry example; `violates maximum` alone did not help this run recover.

For the next adapter revision, explain that `all:true` retrieves raw retained evidence and recommend the compact default for navigation. Require an explicit argument position when the selected call has multiple arguments, or return the candidates and a clear request to select one. Do not silently substitute argument 1. Keep assumption evaluation statuses as dedicated scalar fields. These recommendations have not yet been tested as changes to this paired protocol.

## Recommendation

Use one intent per tool, with names that make sense as questions: `who_uses`, `what_happens_from`, `where_value_flows`. Keep Joern as implementation/coverage metadata. Retain compatibility aliases without advertising duplicate names. Question-shaped naming should accompany narrow, forgiving inputs and a short explanation of how to read the result.

For semantic results, prefer explicit `declaredAssumptions` and separate data/control `assumptionChecks`. Keep source locations, proof limits, selected-output scope and a raw-evidence bridge. Avoid asking small models to infer which of several nested `status` fields is the requested answer.

Keep `all` consistent across listing, map, trace and raw reads. Distinguish selected output (`part`), omitted preview content (`truncated`) and a full retained response (`all`) from source/analysis completeness. A production adapter should annotate all three cases explicitly and support owned-job continuation. The live evaluation harness supplies server-side job observation, but the candidate adapters are not ready to register unchanged.

Code mode remains useful for larger models or supplied recipes that join/filter full graph data. For this 2B model, even a correct internal tool call can lose its result when it omits `text(...)` or `return`. A separate experiment should test a visible receipt for that situation rather than silently encouraging repeated discovery.

## Reproduction and evidence

```sh
node dev/eval-semantic-code-model.cjs --arm probe --output /tmp/semantic-probe.json
node dev/eval-semantic-code-model.cjs --arm plain-focused --output /tmp/semantic-plain.json
node dev/eval-semantic-code-model.cjs --arm question-focused --output /tmp/semantic-question.json
node dev/eval-semantic-code-model.cjs --arm question-brief --output /tmp/semantic-brief.json
node dev/eval-semantic-code-model.cjs --arm question-brief --case contradiction --output /tmp/semantic-contradiction.json
node --test test/semantic-code-model-eval.test.js test/semantic-flow-map.test.js test/semantic-path-trace.test.js test/semantic-query.test.js
```

The harness defaults to local Ollama at `127.0.0.1:11434`; pass `--endpoint http://127.0.0.1:<port>` to use another instance or an SSH tunnel. All data lives in a disposable `DT_HOME`. Raw fixture views are removed afterward; their URLs in transcripts no longer resolve. Captured full responses, delivered outputs and transcripts remain in [benchmark reports](benchmarks/semantic-question-brief-2b.json), with the [code projection](benchmarks/semantic-code-projection.json), [plain-name control](benchmarks/semantic-plain-focused-2b.json), [question-name control](benchmarks/semantic-question-focused-2b.json), and [original code trial](benchmarks/semantic-code-mode-2b.json). Failed exploratory runs are retained alongside them.

The [contradictory-assumption transcript](benchmarks/semantic-question-brief-contradiction-2b.json) preserves the second successful synthetic scenario. The exporter fix and its generated bundle are the production changes; candidate tool registrations remain unchanged. Validation passed **47 focused tests**, **both real Joern tests**, build/handbook/state-machine/inventory checks, and documentation links. [CI on implementation head `3179125`](https://github.com/merv-gh/dev-tool/actions/runs/45840941192) passed the Node 22/24 full suites, Node 24 coverage gate and integration. The full suite was run remotely because this host has little free disk. Final evidence-capture refinements were also executed against the actual retained views.

For actual Joern verification, configure `DT_SEMANTIC_LIVE_URL` and `DT_SEMANTIC_LIVE_TOKEN`, then run `test/semantic-flow-map.live.test.js` and `test/semantic-path-trace.live.test.js`. Those tests use real retained CPGs and an independently compiled behavioral oracle; they do not replace the model-navigation test.

To repeat the remote 4B trials, forward the chosen remote Ollama port and pass its local endpoint (do not expose Ollama publicly):

```sh
ssh -N -L 127.0.0.1:21435:127.0.0.1:11435 marchme@192.168.1.148
# In another terminal:
node dev/eval-semantic-live-model.cjs --model qwen3.5:4b --endpoint http://127.0.0.1:21435 --shape brief --output /tmp/joern-brief-4b.json
node dev/eval-semantic-live-model.cjs --model qwen3.5:4b --endpoint http://127.0.0.1:21435 --shape typed --output /tmp/joern-typed-4b.json
node dev/eval-semantic-code-model.cjs --model qwen3.5:4b --endpoint http://127.0.0.1:21435 --arm question-brief --output /tmp/fixture-brief-4b.json
```

Live trials additionally require the retained verification session supplied by `--state`; its default is `/tmp/dt-joern-code-live-session.json`. That local state contains credentials and is deliberately excluded from the repository. The remote existing service was used after the temporary runtime could not bind its occupied port; no existing service was replaced or stopped. The downloaded runtime was not used for inference. No production tools or grader were changed for the 4B follow-up.
