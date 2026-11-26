# Code mode and Joern: Qwen 4B reliability research

This continues the [historical navigation evaluation](joern-code-mode-evaluation.md). Question-shaped tools are now registered production tools. Results below concern a bounded fixture workload; they do not establish universal reliability or runtime correctness.

## Implemented interface

The `code` profile exposes one outer tool. `code-discovery` adds native search/schema discovery; `code-semantic` also exposes the three question-shaped semantic tools directly. The latter two are separate measured interfaces, not code-only successes. JavaScript calls the same enabled registry through `await tools.NAME(args)`; discovery returns direct inside-code calls. Tool values inside the cell are full typed values. Chat transport can preview printed/returned output, so aggregation belongs inside the cell.

- `which_analyses_exist` lists exact retained identities, with optional exact workspace/repository/SHA filters, without parsing a new CPG. An analysis-list view is explicitly distinct from map/trace views.
- `what_happens_from` maps an entry. Supplying parameter, sink, one-based argument and literal assumptions also returns independent `entryMap` and `valueTrace`, selected `summary`, and both evidence links.
- `where_value_flows` traces an explicitly selected parameter to a sink argument. Missing positions fail rather than selecting another argument.
- `all:true` requests full retained output consistently. It does not repair source truncation, missing dependencies or static proof limits.
- Standalone object/array tool values accept a virtual `.value` alias when no real `value` field exists. This changes neither direct fields nor serialized output; script hooks retain raw semantics.
- Inputs advertise one canonical array/integer shape. JSON-encoded assumption arrays/objects, explicit true/false strings and numeric argument strings normalize before validation. Literal predicate text is preserved. Unambiguous tool-name case/underscore variants inside code normalize before normal permission checks.
- Standalone cells permit local `result`, `args` and `vars`. Forgotten async helpers without an explicit return are drained; explicit return/error still cancels forgotten work promptly. Script hooks keep their existing semantics.
- Silent cells expose bounded host-call receipts and full-data bridges. Console output is output, so it does not trigger an extra raw receipt. Large receipts retain selected summary facts and evidence identities.
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
| Console calculation | Computed logs plus misleading “silent cell” raw receipts | Computed logs without the extra receipt |
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

Two additional holdouts were prepared independently:
- Java dispatch: `plan`, parameter `lost`, `record` argument **3**, selected expression `usable`.
- JavaScript quote: `quote`, parameter `discount`, `send` argument **1**, selected expression `subtotal`.

A source-edit syntax error invalidated the joint-v2 batch; its raw files are retained and explicitly excluded as harness errors. Startup now exercises the code runtime before making model calls.

The early focused thinking cohort passed 4/4 core trials and 6/6 holdout trials. A subsequent broader shared-description change regressed Joern navigation, despite aggregation improving. Both histories are retained; the latest joint cohort is the relevant acceptance check, not the best earlier result.

Aggregation fixtures contain more than 1,700 retained rows, negative/positive integer values, a filtered subset and an explicitly truncated upstream source. Later seeds change the row count and values. The first prompt's “over ALL retained rows” phrasing led some runs to sum all groups; the clarified prompt explicitly applies both operations to the filtered subset. That is a prompt change, so this is not a controlled tool-only A/B estimate. Three clarified pre-joint trials passed 3/3, but final results must use the same shared tool description as navigation.

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
  --endpoint http://127.0.0.1:11435 --profile thinking --seed 42 \
  --output /private/dispatch-42.json.gz

node dev/eval-code-aggregation.cjs \
  --state /private/fresh-fixtures/dispatch-state.json \
  --endpoint http://127.0.0.1:11435 --profile thinking --seed 42 \
  --output /private/aggregate-42.json.gz
```

Repeat the navigation command for `quote` and seeds 7/42/99. The preparer refuses to overwrite prepared source fixtures; reuse their state or choose a fresh directory. Its scenario/oracle files are public fixture data; state/config files contain credentials and must remain private.
