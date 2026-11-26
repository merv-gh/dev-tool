# Joern navigation through code mode and question-shaped tools

Code mode can call the existing semantic tools and return a small, useful projection of their evidence. The Qwen 3.5 2B pilot could not reliably assemble that workflow from a general code description. Three narrow native tools reached the evidence reliably in this fixture, but question-shaped names alone did not fix omitted assumptions or incorrect interpretation. Clearer assumption inputs and outputs made the combined task pass.

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

## Recommendation

Use one intent per tool, with names that make sense as questions: `who_uses`, `what_happens_from`, `where_value_flows`. Keep Joern as implementation/coverage metadata. Retain compatibility aliases without advertising duplicate names. Question-shaped naming should accompany narrow, forgiving inputs and a short explanation of how to read the result.

For semantic results, prefer explicit `declaredAssumptions` and separate data/control `assumptionChecks`. Keep source locations, proof limits, selected-output scope and a raw-evidence bridge. Avoid asking small models to infer which of several nested `status` fields is the requested answer.

Keep `all` consistent across listing, map, trace and raw reads. Distinguish selected output (`part`), omitted preview content (`truncated`) and a full retained response (`all`) from source/analysis completeness. A production adapter should annotate all three cases explicitly and support owned-job continuation. These evaluation adapters only cover immediate fixture responses; they are not ready to register unchanged.

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

The harness requires local Ollama at `127.0.0.1:11434`. All data lives in a disposable `DT_HOME`. Raw fixture views are removed afterward; their URLs in transcripts no longer resolve. Captured full responses, delivered outputs and transcripts remain in [benchmark reports](benchmarks/semantic-question-brief-2b.json), with the [code projection](benchmarks/semantic-code-projection.json), [plain-name control](benchmarks/semantic-plain-focused-2b.json), [question-name control](benchmarks/semantic-question-focused-2b.json), and [original code trial](benchmarks/semantic-code-mode-2b.json). Failed exploratory runs are retained alongside them.

The [contradictory-assumption transcript](benchmarks/semantic-question-brief-contradiction-2b.json) preserves the second successful scenario. Local validation passed 39 focused tests, `npm run build:check`, and the documentation link checks. The full suite was not rerun locally. The exporter fix and its generated bundle are the production changes; candidate tool registrations remain unchanged.

For actual Joern verification, configure `DT_SEMANTIC_LIVE_URL` and `DT_SEMANTIC_LIVE_TOKEN`, then run `test/semantic-flow-map.live.test.js` and `test/semantic-path-trace.live.test.js`. Those tests use real retained CPGs and an independently compiled behavioral oracle; they do not replace the model-navigation test.
