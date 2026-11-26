# Code mode and Joern: Qwen 4B reliability research

This continues the [tool I/O review](research/tool-calling-io-review.md) and [historical navigation evaluation](joern-code-mode-evaluation.md). Question-shaped tools are now registered production tools. Results below concern a bounded fixture workload; they do not establish universal reliability or runtime correctness.

## Final Qwen 4B results

Qwen 4B can query real Joern evidence through these tools, but **code-only is still insufficiently reliable for unattended navigation on this workload**. Prefer the `code-semantic` interface and use code for composition/calculations. Descriptions and forgiving inputs help; they do not eliminate model mistakes.

| Cohort / interface | Correct facts + retained evidence | Strict bare JSON | Outer calls |
| --- | ---: | ---: | ---: |
| Earlier code-only, 8 task/seed pairs (code-v4) | 4/8 | 2/8 | 57 |
| Code-only, frozen comparison (code-v6) | 5/8 | 2/8 | 54 |
| Final code-only after output/diagnostic fixes (code-v8) | **6/8** | 3/8 | 56 |
| Direct questions, matched 8 task/seed pairs (native-v6 subset) | **7/8** | 3/8 | 30 |
| Direct questions, broader 24-case matrix (native-v6) | **22/24** | 12/24 | 52 |
| After blank-filter fix: direct discovery follow-up | **3/3** | 0/3 | 9 |
| Same follow-up: supplied analysis / combined query | 1/1 | 1/1 | 1 |
| Same follow-up: code-only discovery | 1/1 | 0/1 | 6 |

These are small development samples, not a production failure-rate estimate. Raw results, hashes and cohort definitions are in the [summary](benchmarks/code-joern-reliability/summary.json) and [index](benchmarks/code-joern-reliability/index.json).

The broader native-v6 matrix covers combined questions, discovery, contradictory assumptions, map-only counts and trace-only questions across three seeds, plus the Java/JavaScript variants and filtered row aggregation. Its two failures were:
- A correct contradiction answer with a mistyped map URL. The map coverage check is tied to that same URL; the reported completeness flag itself was correct.
- Ten repeated listings caused by blank optional filters being rejected, followed by invented non-empty repository filters. Blank/null optional filters now normalize to omission; nonempty identity filters remain exact. The three-seed follow-up passed, including correcting a wrong nonempty filter, but it is not a new 24-case joint acceptance run.

Final code-v8 passed all three aggregation cases. Both remaining failures retrieved real maps and traces but exhausted ten turns without a final assistant answer on the Java/JavaScript variants. Returning correct data from a tool is not enough to pass. Repeated discovery, API-shape mistakes and answer-finalization loops remain observable. The earlier code-v6 aggregation seed 99 had even logged the correct count and sum while still failing to answer; the added diagnostic and completion guidance address that pattern without manufacturing an answer.

The native-v6 and final code-v8 aggregation cohorts each passed **3/3**: exact filtered count/sum, total retained rows, `sourceComplete:false`, and a real evidence bridge. Each source was explicitly incomplete upstream even though all retained matching rows were processed. No model arithmetic is trusted in the backend aggregation operation.

The final executable source digest is `e5db854d83a42d4ef2546217994247066f85a076debfb105ebc0546e82e0aede`. Code-v8 ran at `ac611194cfa901e75b65ff5b43e5ff3c990b5d89`; its raw `git.dirty:true` flags are preserved. The only uncommitted file was generated `lib/self-model-catalog.json`, updating its source digest and a consumer line number. No executable source or harness changed during that cohort; the [exact metadata patch](benchmarks/code-joern-reliability/generated-catalog-at-code-v8.patch) is retained and committed with this report.

Final validation: **1,436 passed / 66 skipped / 0 failed on both Node 24.22.0 and Node 22.23.5** (1,502 tests per suite). The pinned live Joern tests separately passed **2/2, zero skips**, with independent Java/JavaScript runtime oracles. Build, handbook, lifecycle charts, documentation, inventory and whitespace checks passed. [Validation details and log hashes](benchmarks/code-joern-reliability/validation.json).


The directly offered interface is the production `code-semantic` profile: seven outer tools (`code`, `tool_search`, `tool_describe`, `result_read`, and the three question tools). Code-only has one outer tool. Native-v6 and code-v6 share frozen implementation 64fe83c, model, settings, seed/task pairs and exact read-only backend allowlist. Code-v8 repeats those eight pairs after host-output fixes at ac61119. The history and final table therefore do not isolate one interface or code change as a randomized A/B estimate.

The final grading distinguishes correct facts/evidence from the requested bare-JSON format. Fenced JSON or extra prose can pass the former and fail the latter. All failures remain in the index, including the previous native-v5 cohort: **22/24** facts/evidence, **11/24** strict JSON. Its failures were a rewritten assumption on Java dispatch seed 7 and an empty final answer after reading a large row array on aggregation seed 99. Native-v4 had also passed 22/24, with two missing map links. These are development cohorts, not independent replications of the final implementation.

## Output size and raw-data access

The following are UTF-8 JSON byte counts from the same owned job, first read compactly and then with `all:true`, without rerunning the analysis. This compares projections of the same evidence, not historical model quality.

| Actual retained fixture | Full available response | Compact navigation | Selected summary |
| --- | ---: | ---: | ---: |
| Java dispatch, argument 3 | 199,570 B | 7,180 B (96.4% smaller) | 334 B |
| JavaScript quote, argument 1 | 72,392 B | 6,550 B (91.0% smaller) | 335 B |

Raw paired responses: [dispatch](benchmarks/code-joern-reliability/final-dispatch-output.json.gz), [quote](benchmarks/code-joern-reliability/final-quote-output.json.gz). Both preserve separate map and trace links, exact selected arguments, assumptions and static proof limits. Localhost view URLs in transcripts are fixture-owned identities, not published live pages. The gzipped reports embed the full retained evidence for offline inspection.

| Output example | Previous interpretation burden | Current compact output / access |
| --- | --- | --- |
| Actual core map exits | `exits:9` mixed method termination with external boundaries | `summary:{methodExitCount:6,externalCallBoundaryCount:3,mapComplete:false,behaviorVerified:false,mapView:...}` |
| Actual dispatch trace | Walk retained graph/path arrays and compare predicates manually | `summary:{entry:"plan",traceSinkCall:"record",argumentExpression:"usable",controlAssumptionStatus:"matches-assumptions",dataAssumptionStatus:"unresolved",behaviorVerified:false,mapComplete:false,mapView:...,traceView:...}` |
| Filtered retained rows | Print/read every row, then risk arithmetic over a preview | `result_read({id,where:{group:"target"},aggregate:"summary",field:"cents"})` returns exact `value:{count,sum,avg,min,max}`, `retainedRows`, `matchedRows` and `sourceView` |
| Per-field preview | Omitted array elements were implicit | `modelContext.previewOmissions:[{path:"/rows",reason:"array-preview",shown:3,total:1799}]` (illustrative path/count); full owned result remains readable |
| Oversized `all:true` in chat | One full response could displace the user request from model context | Explicit `requestedAllLimited:{reason:"model-context-budget",...}`, `output.status:"truncated"`, retained result id and raw-data bridge |

`all:true` means all **available retained data**. It never asserts complete upstream data or runtime proof. Every schema uses the same option name. The raw API/CLI and tool calls inside code receive the full value; the model-facing transport limits an oversized result even when all was requested, and labels that limit. For the default 32k serving window its conservative response ceiling is 32,768 bytes, reduced further by reported remaining context. This is a byte heuristic, not tokenization or client-history compaction. An operator can explicitly opt out with `tools.modelResultBytes:0`.

The [recorded overflow](benchmarks/code-joern-reliability/context-truncation.json) captures an earlier 214,596-token prompt shifted to 16,386 tokens, retaining four leading tokens. That number is the post-overflow shift target, **not** an effective 16k serving window: [Ollama 0.40.13 source](https://github.com/ollama/ollama/blob/v0.40.13/llm/llama_server.go) checks the full context limit before shifting. Full raw arrays should stay inside code for calculations or be aggregated through `result_read`.

Exact equality filters accept typed primitive values; `aggregate:"summary"` computes all matching retained rows and refuses missing/null/string/unsafe numeric values. These operations cannot repair an upstream limit. `sourceCoverage` and `sourceView` are metadata on the read response, not columns in stored rows.

## Implemented interface

The `code` profile exposes one outer tool. `code-discovery` adds native search/schema discovery; `code-semantic` also exposes the three question-shaped semantic tools and result_read directly. The latter two are separate measured interfaces, not code-only successes. JavaScript calls the same enabled registry through `await tools.NAME(args)`; discovery returns direct inside-code calls. Tool values inside the cell are full typed values. Chat transport can preview printed/returned output, so aggregate with result_read or compute inside the cell.

- `which_analyses_exist` lists exact retained identities, with optional exact workspace/repository/SHA filters, without parsing a new CPG. Blank/null optional identity filters are omitted; nonempty filters remain exact. An analysis-list view is explicitly distinct from map/trace views.
- `what_happens_from` maps an entry. Supplying parameter, sink, one-based argument and literal assumptions also returns independent `entryMap` and `valueTrace`, selected `summary`, and both evidence links.
- `where_value_flows` traces an explicitly selected parameter to a sink argument. Missing positions fail rather than selecting another argument.
- `all:true` requests full retained output consistently. It does not repair source truncation, missing dependencies or static proof limits.
- Standalone object/array tool values accept a virtual `.value` alias when no real `value` field exists. This changes neither direct fields nor serialized output; script hooks retain raw semantics.
- Inputs advertise one canonical array/integer shape. JSON-encoded assumption arrays/objects, explicit true/false strings and numeric argument strings normalize before validation. Literal predicate text is preserved. Descriptions require copying the user expression verbatim without negating, simplifying or paraphrasing it. Unambiguous tool-name case/underscore variants inside code normalize before normal permission checks.
- Standalone cells permit local `result`, `args` and `vars`. Forgotten async helpers without an explicit return are drained; explicit return/error still cancels forgotten work promptly. Script hooks keep their existing semantics.
- Silent cells expose bounded host-call receipts and full-data bridges. Small console calculations stay uncluttered. Oversized printed output also receives bounded host-call summaries and raw reads, explicitly distinguished from the cell computation. A missing modelContext.compacted access points to sourceCoverage.provenComplete instead of inviting repeated failed reads. Large receipts retain selected summary facts and evidence identities.
- Exceptions, known failed tool results and invented map/trace references are explicit. Discovery metadata alone is labelled discovery.
- Retained reads distinguish complete retained values from unproven upstream completeness. `sourceView` links the original evidence; `view` remains reserved for the tool's own result, so expanding an aggregate cannot replace it with the source rows.
- Project-scoped evidence links and raw reads are copied into the caller's authorized story without granting another principal access.

Example:
```js
return await tools.what_happens_from({
  analysis: "EXACT_RETAINED_ID",
  entry: "entryMethod",
  parameter: "input",
  sink: "persist",
  argument: 2,
  assumptions: [{expression: "input < 0", holds: false}]
});
```

For rows, compute before printing:
```js
const r = await tools.result_read({id: "RETAINED_RESULT_ID", all: true});
const selected = r.value.rows.filter(row => row.kind === "wanted");
return {
  count: selected.length,
  total: selected.reduce((n, row) => n + row.amount, 0),
  retainedRows: r.value.rows.length,
  sourceComplete: r.sourceCoverage.provenComplete,
  view: r.sourceView
};
```

These are generic recipes, not benchmark answers. Cells are fresh, so reuse retained result ids rather than assuming JavaScript variables persist.

## Before / after examples

Schematic excerpts below omit unrelated fields. Full source graphs and model transcripts are linked from the benchmark index.

| Situation | Before | After |
| --- | --- | --- |
| Discover retained CPGs | General semantic index mixed listing and indexing responsibilities | `evidenceType:"analysis-list"`, exact repo/SHA/workspace ids, `analysisView`, `mapView:null`, `traceView:null`; explicit next schema |
| Combined map and value question | Separate low-level query schemas and nested graph/path arrays | One explicit selection; independent `entryMap`/`valueTrace`, `summary`, `mapView` and `traceView` |
| Entry exits | Method exits and external calls required interpreting graph nodes | Separate `methodExits` and `externalCallBoundaries`, with counts and source locations |
| Guard versus value proof | Per-path nested checks could be mistaken for global proof | Separate control/data assumption status, grouped retained path indexes, explicit mixed/unresolved states |
| Wrong argument or predicate | Generic validation failure; descriptive labels could be confused with expressions | Required one-based argument; literal `{expression,holds}`; unmatched assumptions and observed predicates remain visible |
| Part/full output | Full graphs or heterogeneous full-output options | `output.status` identifies all/part/truncated at its stated scope; `all:true` and retained reads recover available raw data |
| Forgotten output | Successful cell with empty output | Bounded host-call receipt with explicit omissions and `read:{tool:"result_read",arguments:{id,all:true}}` |
| Large receipt | Keys-only fallback discarded selected facts | Selected summary and evidence identities survive alongside the raw-data bridge |
| Console calculation | Computed logs plus misleading “silent cell” raw receipts | Small computed logs without receipts; oversized printed JSON retains labelled host summaries and raw reads |
| Aggregate evidence link | No original-view field; naïvely adding `view` hydrated source rows over aggregate output | `sourceView` points to original evidence while aggregate values remain intact |
| Wrong tool name | Unknown-tool exception | Explicit discovery retry; no silent side-effecting rerun |
| Static path | Model could conflate a retained candidate with behavior | `behaviorVerified:false`, feasibility/runtime limits, map coverage and actual retained evidence links |

## Actual engine and model

Live tests used the repository's pinned Joern image:
`ghcr.io/joernio/joern@sha256:54c7f728f813c1cefd4303e7c69c5d35003f0fc9fde1459872230e5bc4e4b7b4`.
The CLI reported **4.0.564**. The disposable worker image was `dt-joern-qwen-reliability:qphvk9`, digest `sha256:811c2cb966c35cc1b9f607996bc452ec54e64884ae7714aa55e8b1c22ec5c7b5`. Host-side tool navigation changed after that image build; the worker's Joern scripts did not.

Inference ran on the user-provided SSH box, using its existing Ollama 0.40.13 service, Qwen `qwen3.5:4b` Q4_K_M (4.2B parameters), and RTX 3080 Ti 12 GB. Model digest:
`d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`.

The working thinking profile uses `think:true`, temperature 0.6, top_p 0.95, top_k 20, min_p 0, presence_penalty 0, repeat_penalty 1, context 32768 and output budget 4096 per turn. Trials have 10 turns / 16 outer calls, with seeds 7, 42 and 99 where stated. Non-thinking greedy and sampled profiles are retained as development failures, not omitted.

These settings follow the model card's precise-coding thinking recommendation. Native Ollama messages retain `message.thinking` and the complete assistant/tool exchange. Sources: [Qwen model card](https://huggingface.co/Qwen/Qwen3.5-4B), [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling), [Ollama thinking](https://docs.ollama.com/capabilities/thinking).

## Evidence and limitations

The [benchmark index](benchmarks/code-joern-reliability/index.json) records completed runs, exact source/harness digests, settings, checks and paths to gzipped raw transcripts. Failed development runs are included. The harness uses actual production profiles and chat-pressure transport; internal calls see native values. The `surface` and `schemas` fields identify code-only, hybrid discovery or directly offered semantic tools. Early scope prose can still say code-only; the explicit surface/schema fields are authoritative. It supplies no candidate adapter, automatic polling, fixture-specific recipe or expected answer. Current runs verify their exact enabled-tool subset and record its names; new parsing is excluded. Earlier `DT_TOOLS=code,...` runs inadvertently enabled the entire code group because configuration tokens can be group names. Their index scope is labelled legacy-group-expanded, so they must not be described as an enforced read-only subset.

Current aggregation grades accept the original source view or an owned calculation view with a successful read of that exact result and an explicit link back to it. They still independently check every numeric answer and source-completeness flag. Earlier strict-original-view grades remain unchanged. Navigation requires the actual map and trace views, not a generic calculation view.

Grades require actual map and trace retrieval from the requested retained analysis, exact entry/parameter/sink/argument/predicate polarity, correct statuses and expression, correct completeness, and both real retained evidence links. Correct-looking strings or discovery-only calls do not pass. JSON formatting is also recorded separately; a human-readable correct answer can still fail the strict JSON protocol. Do not equate such a formatting failure with an incorrect calculation.

Fresh live Java/JavaScript path and map tests passed with independently compiled/executed before-fails/after-passes oracles. These oracles establish the fixture's behavioral change; they do not change the tool's static `behaviorVerified:false`.

Two additional fixture variants were prepared independently. They were held out from initial core development, then used during iteration; final repeats are not an unseen test set:
- Java dispatch: `plan`, parameter `lost`, `record` argument **3**, selected expression `usable`.
- JavaScript quote: `quote`, parameter `discount`, `send` argument **1**, selected expression `subtotal`.

A source-edit syntax error invalidated the joint-v2 batch; its raw files are retained and explicitly excluded as harness errors. Startup now exercises the code runtime before making model calls.

The early focused thinking cohort passed 4/4 core trials and 6/6 holdout trials. A subsequent broader shared-description change regressed Joern navigation, despite aggregation improving. Both histories are retained; the latest joint cohort is the relevant acceptance check, not the best earlier result.

Aggregation fixtures contain more than 1,700 retained rows, negative/positive integer values, a filtered subset and an explicitly truncated upstream source. Later seeds change the row count and values. Each trial creates fresh retained identities; row values are deterministic per seed, so repeated seeds reuse those values. The first prompt's “over ALL retained rows” phrasing led some runs to sum all groups; the clarified prompt explicitly applies both operations to the filtered subset. That is a prompt change, so this is not a controlled tool-only A/B estimate. Three clarified pre-joint trials passed 3/3, but final results must use the same shared tool description as navigation.

Other development findings:
- Feeding raw outer responses bypassed the deployed chat-pressure behavior; current trials use the real transport.
- Small models may omit await/return, print huge arrays, parse already-typed arrays as JSON, reuse analysis ids as context ids, repeat listing, or mistake declared assumptions for verified data constraints.
- Smaller question-shaped contracts help, but the shared code description itself is sensitive to unrelated examples.
- Retained-data completeness and upstream completeness must remain separate even when every retained row was processed.
- This benchmark uses a read-only enabled subset in a disposable fixture environment. It does not measure navigation among all production tools, production service correctness, distributed flows, arbitrary repositories, latency guarantees or adversarial behavior.

## Reproduce

Requirements: Node 22+, npm dependencies, Git, Docker, JDK 17+ on the host for the Java oracle, an accessible semantic worker built from `dev/semantic.Dockerfile`, and an Ollama endpoint with the exact model installed.

Build sources before creating the worker: `npm ci`, `npm run build`, then `docker build -f dev/semantic.Dockerfile -t dt-semantic-eval .`. Run it bound to localhost with a private token and explicit memory/parse/query budgets. Never put credentials in committed fixture files.

Create a mode-0600 private state JSON outside the repository containing `url`, `token`, `actualJoernVersion`, and `image`. Then:
```sh
node dev/prepare-semantic-reliability-fixtures.cjs \
  --state /private/worker.json --home /private/fresh-fixtures \
  --output /private/cases.json

node dev/eval-code-navigation.cjs \
  --state /private/fresh-fixtures/dispatch-state.json \
  --scenario /private/fresh-fixtures/dispatch-scenario.json \
  --endpoint http://127.0.0.1:11435 --profile thinking --surface semantic --seed 42 \
  --output /private/dispatch-42.json.gz

node dev/eval-code-aggregation.cjs \
  --state /private/fresh-fixtures/dispatch-state.json \
  --endpoint http://127.0.0.1:11435 --profile thinking --seed 42 \
  --output /private/aggregate-42.json.gz
```

Repeat the navigation command for `quote` and seeds 7/42/99. The preparer refuses to overwrite prepared source fixtures; reuse their state or choose a fresh directory. Its scenario/oracle files are public fixture data; state/config files contain credentials and must remain private.
