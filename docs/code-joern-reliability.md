# Code mode and Joern: Qwen 4B reliability research

This continues the [tool I/O review](research/tool-calling-io-review.md) and [historical navigation evaluation](joern-code-mode-evaluation.md). The tools query actual retained Joern CPG evidence. Static evidence, source coverage, retained-data coverage and model answer correctness are separate checks.

## Measured results

**The most reliable measured interface is `semantic-read`, the four native question/read tools, on this bounded workload.** Code-only navigation remains sensitive to API-shape mistakes, repeated discovery, excessive code generation and answer finalization. A perfect narrow sample did not transfer to the broader workload.

| Development cohort | Interface / workload | Correct facts + evidence | Strict bare JSON | Outer calls |
| --- | --- | ---: | ---: | ---: |
| native-v6 | Seven tools; original 24 | **22/24** | 12/24 | 52 |
| control-v10-direct | Code; matched 8 before typed API | **7/8** | 7/8 | 25 |
| code-v11-direct | Code; matched 8 after typed API | **8/8** | 8/8 | 10 |
| code-v12-direct | Code; original 24 | **21/24** | 21/24 | 33 |
| code-v13-direct | Code; original 24 | **24/24** | 24/24 | 34 |
| code-v14-direct | Code; transfer 27 | **17/27** | 17/27 | 99 |
| code-v15-direct | Code; six completed cycle trials | **0/6** | 0/6 | 46 |
| code-v16-direct | Code; joint 51 | **33/51** | 32/51 | 126 |
| native-v17-direct | Seven tools; joint 51 | **43/51** | 41/51 | 74 |
| code-v17-direct | Code; matched 8 | **7/8** | 7/8 | 11 |
| native-v18-direct | Seven tools; joint 51 | **48/51** | 46/51 | 64 |
| code-v18-direct | Code; matched 8 | **6/8** | 6/8 | 15 |
| questions-v19-direct | Four tools; joint 51 | **44/51** | 43/51 | 118 |
| questions-v20-direct | Four tools; joint 51 after retry/guidance fixes | **47/51** | 47/51 | 78 |
| questions-v21-direct | Four tools; joint 51, explicit final format and deployed guidance | **51/51** | 51/51 | 80 |
| questions-v21-extra-direct | Four tools; three new aggregation datasets | **3/3** | 3/3 | 3 |

These are development samples, not independent A/B estimates or a production failure-rate estimate. The [summary](benchmarks/code-joern-reliability/summary.json) defines cohorts; the [index](benchmarks/code-joern-reliability/index.json) records source/harness/grader digests, offered schemas and every completed trial, including failures. Earlier histories and explicitly excluded harness errors remain available.

The joint matrix has **51 trials**: 24 original cases and 27 transfer/structural cases. It covers supplied identities, discovery, combined entry-map/value-trace questions, contradictory assumptions, map-only counts, trace-only questions, all-retained graph cycle detection and filtered integer aggregation. Three fresh fixtures add Java allocation, a Java loop and JavaScript billing, alongside core Java, Java dispatch and JavaScript quote. These fixtures were initially held out, then used during development; later repeats are not an unseen test set.

The final four-tool run passed **51/51** facts/evidence checks and **51/51** strict-JSON checks using 80 outer calls. Every tested requested fact and evidence link was correct; this is bounded acceptance, not universal reliability. The preceding four-tool cohort passed 47/51. A failed exact-identity lookup now provides an explicit error and native retry arguments; the profile also states which combined-map/trace inputs are needed and forbids inventing absent facts. Observed operator-in-value mistakes also receive an explicit diagnostic and verified retry without changing literal filter semantics. The last iteration additionally makes counts-only evidence links and requested JSON format explicit, and shares the same profile prompt with MCP, OpenAPI metadata, the prompt endpoint and Open WebUI setup. These changes are measured together. Three additional aggregation datasets (seeds 13, 123 and 1001) passed 3/3 facts/evidence and strict JSON, one call each. The final model cohort ran at `3fa650e`; the subsequent shipping change only connects MCP URL profile selection to the already-tested schemas/prompt. HTTP integration tests verify that connection, with no claim of another model replication after that wiring change.

Important earlier regressions are preserved:

- Typed API shapes improved the matched direct code sample from 7/8 with 25 outer calls to 8/8 with 10. This is a small development comparison, not an isolated causal estimate.
- Code-v13 passed 24/24 original cases, then code-v14 passed only 17/27 transfer cases. Six cycle questions failed. Additional summaries alone did not establish reliable navigation.
- Code-v15 completed six cycle trials, all failed, and stopped between trials; 21 planned trials were never started. It must not be described as a completed 27-case matrix.
- Native-v17 passed 43/51. Seven failures had the requested facts but omitted the required map URL; one repeated the same incorrect revision filter until the turn limit.
- Native-v18 passed 48/51: one mistyped evidence URL and two first-response output-budget failures with no observable query or final answer. Code-v18 passed 6/8 matched cases: one similar output-budget failure, and one correct filtered count/sum but an incorrect total retained-row count.
- The v18 source failed the prompt-size unit check (9,249 characters versus a 9,000 limit). Its model trials remain real results. The shipping prompt was subsequently compressed below that limit; those v18 scores are not scores for the shipping prompt.
- A retrospective [structured proof-claim audit](benchmarks/code-joern-reliability/static-claims-audit.json) flags three previously passing reports with inconsistent optional proof/completeness claims: two code-v9 reports and native-v3 combined seed 42. The retained code-v9 raw files pass 4/8; additionally checking those two reports leaves 2/8. Historical raw grades are unchanged.

Correct facts plus evidence and strict bare JSON are separate grades. Fenced JSON may satisfy the first but fail the second. Some numeric checks are tied to the cited evidence URL: missing the link does not imply the arithmetic itself was wrong. Current navigation grading also checks optional structured proof claims against the linked original evidence; it does not validate arbitrary free-form prose.

## Output sizes and raw-data bridges

These UTF-8 JSON byte counts come from the same owned completed job, first compactly and then with `all:true`, without rerunning the source query.

| Retained fixture | Full available response | Compact navigation | Selected summary |
| --- | ---: | ---: | ---: |
| Java dispatch, sink argument 3 | 200,820 B | 7,793 B (96.1% smaller) | 790 B |
| JavaScript quote, sink argument 1 | 73,641 B | 7,799 B (89.4% smaller) | 791 B |

Paired raw responses: [dispatch](benchmarks/code-joern-reliability/v16-dispatch-output.json.gz), [quote](benchmarks/code-joern-reliability/v16-quote-output.json.gz). They were measured at the graph-summary implementation, before later discovery/input-metadata fixes; the successful query summary shape is unchanged. Fixture localhost URLs identify owned retained objects; they are not hosted public pages. The gzipped reports embed the original retained graphs.

| Situation | Before | Current output / access |
| --- | --- | --- |
| Core exits | `exits:9` mixed termination and external boundaries | `summary:{methodExitCount:6,externalCallBoundaryCount:3,mapComplete:false,behaviorVerified:false,mapView:…}` |
| Dispatch value flow | Interpret nested paths and guard checks | `summary:{entry:"plan",traceSinkCall:"record",argumentExpression:"usable",controlAssumptionStatus:"matches-assumptions",dataAssumptionStatus:"unresolved",mapView:…,traceView:…,proofLimits:…}` |
| Retained graph structure | Model writes its own traversal and can confuse data/control edges | `nodeCount`, `controlEdgeCount`, `hasControlCycle`, `graphStructureComplete` over all retained control edges; raw graph remains linked |
| Unknown entry | Empty selection could resemble a valid zero-count answer | `ready:false`, explicit error, retained candidates, optional suggested retry; no answer summary |
| Wrong revision filter | Empty listing encourages repeating the same query | Exact filters stay exact; separately labelled `filterMismatch` alternatives and a suggested correction |
| Older exact revision | Current-only discovery could hide a retained replaced generation | An explicit SHA searches retained versions by default; explicit `versions:false` still means current-only |
| Full retained rows | Model can aggregate a preview or confuse selected/input row counts | `result_read({id,where:{group:"target"},aggregate:"summary",field:"cents"})` computes all matched retained rows and returns total `retainedRows`, `matchedRows`, `sourceComplete` and `sourceView` |
| Operator copied into a filter value | A literal `=== "wanted"` could produce a plausible zero aggregate | Zero-match diagnostic with a verified literal candidate and explicit retry; the original zero result and legitimate operator-shaped values remain unchanged |
| Incorrect projected metadata | Correct filtered sum but `retainedRows` copied from filtered count | A source-linked code result is checked against the actual read: `contradictory-retained-coverage`, observed metadata and an exact read receipt; original computation is not silently rewritten |
| Nested receipt | A preview could replace read ids or boolean proof leaves with placeholders | Usable `read.arguments.id`, `all:true`, typed proof leaves and failure diagnostics survive recursive previews |
| Failed local projection | Requery source or guess a replacement value | Recover a ready summary from the same owned evidence, with exact source/snapshot bridges; no source-query replay |
| Full snapshot versus full source | Reading an exact response could be mistaken for reading its original graph | `readScope:"tool-response"` for the exact snapshot; separate `sourceView` for original evidence; explicit fallback if snapshot storage fails |
| Oversized `all:true` in chat | Could displace the task from model context | `requestedAllLimited`, `output.status:"truncated"`, retained result id and raw read |

`all:true` consistently requests **all available retained output**. `output.status` distinguishes `all`, `part` and `truncated` at a stated scope. `source`/`sourceCoverage` separately describe upstream gaps. Full retained reads and aggregates carry `retainedComplete:true`; `sourceComplete` aliases conservative `sourceCoverage.provenComplete`. None implies complete source data or verified runtime behavior.

The raw API/CLI and calls inside code receive full values. Model-facing transport limits oversized replies even when `all:true` was requested, labels that limit and preserves the raw bridge. The default 32k serving window uses a conservative 32,768-byte response ceiling, reduced by reported remaining context. This is a byte heuristic, not tokenization or client-history compaction; an operator can opt out with `tools.modelResultBytes:0`.

The [historical overflow](benchmarks/code-joern-reliability/context-truncation.json) recorded a 214,596-token prompt shifted to 16,386 tokens while keeping four leading tokens. That was the post-overflow shift target, not an effective 16k serving window: [Ollama 0.40.13 source](https://github.com/ollama/ollama/blob/v0.40.13/llm/llama_server.go) checks the full context limit before shifting. Raw arrays should stay behind retained reads or be aggregated before returning them to the model.

## Interfaces and contracts

Profiles reduce offered definitions; they never grant permissions or approve plugins.

| Profile | Offered outer tools | Intended use |
| --- | --- | --- |
| `semantic-read` | `which_analyses_exist`, `what_happens_from`, `where_value_flows`, `result_read` | Bounded retained-evidence questions and supported aggregates |
| `code-semantic` | Those four plus `code`, `tool_search`, `tool_describe` | Native questions with arbitrary code composition |
| `code-discovery` | `code`, `tool_search`, `tool_describe` | Native discovery, execution inside code |
| `code` | `code` | Discover and invoke enabled tools inside JavaScript |

Select `/openapi/semantic-read.json` for OpenAPI, `/mcp?profile=semantic-read` for MCP, or `DT_TOOL_PROFILE=semantic-read` for default OpenAPI/Open WebUI setup. Bare `/mcp` retains its all-tools listing and matching general instructions.

The `questions` evaluation surface uses the actual `semantic-read` profile and its production guidance. Final-profile trials read that prompt directly from `webui.prompt("semantic-read")`; MCP selects it with `/mcp?profile=semantic-read`, `/api/prompt?profile=semantic-read` exposes it, OpenAPI includes it in profile metadata, and Open WebUI setup installs it while retaining existing user instructions. For that arm only, the cycle task permits the full retained structural summary instead of requiring an implementation inside code. Requested facts, graph/control-edge definition, evidence identity and independent grader remain unchanged. This changes both offered tools and one task implementation instruction; it is not a controlled tool-only A/B comparison and does not demonstrate that Qwen independently implements DFS.

- `which_analyses_exist` discovers retained identities without parsing a CPG. Blank/null optional identity filters normalize to omission; nonempty filters remain exact. Discovery is not source evidence.
- `what_happens_from` maps an entry. Adding parameter, sink, one-based argument and literal assumptions returns separate `entryMap` and `valueTrace`, a selected summary and both evidence links.
- `where_value_flows` is trace-only. Missing/incorrect entry or sink selection fails explicitly. No method is silently substituted.
- API shapes and code hints come from enabled schemas, including `result_read`. A map-only raw graph is `flowMap`, not `entryMap.graph`; a combined result has independent map and trace sections.
- Assumptions advertise an array; encoded arrays/objects, explicit true/false strings and integer argument strings normalize before validation. Literal predicate text is preserved. Descriptions require copying expressions verbatim and storing truth values separately.
- Ready summaries retain map/trace proof limits independently. Static feasibility/runtime remain unknown and `behaviorVerified:false`; an assumption is a declared constraint, not a verified data fact.
- Graph counts/cycles use every retained node and only control edges, with iterative DFS. A witnessed cycle remains meaningful for a partial graph; absent cycles are not asserted when graph structure is incomplete. The model grader independently uses Kahn's algorithm.
- Source-linked code projections are checked against original semantic facts and retained-read metadata when the corresponding canonical claims are present. Mismatches become diagnostics and exact recovery reads, not fabricated success or silently corrected user calculations. Operator-shaped literal filters are never coerced: only a zero-match case with a demonstrably matching scalar alternative receives a suggested retry.
- Result ids may be owned local view URLs. Foreign URLs cannot masquerade as local evidence. Project-scoped reads preserve normal caller ownership.
- Silent/oversized cells expose bounded host-call receipts. Local field errors recover existing evidence; completed source queries are not rerun for formatting. Fresh cells should reuse retained ids rather than assuming variables persist.

Generic composition example:

```js
return await tools.what_happens_from({
  analysis: "EXACT_RETAINED_ID", entry: "entryMethod",
  parameter: "input", sink: "persist", argument: 2,
  assumptions: [{expression: "input < 0", holds: false}]
});
```

For supported row calculations, prefer `result_read` aggregation over asking a small model to print and reduce thousands of rows. Typed equality filters and `aggregate:"summary"` compute `{count,sum,avg,min,max}` over all matched retained rows and reject missing/null/string/unsafe numeric inputs. They cannot repair upstream truncation.

## Engine, inference and validation

The actual worker uses pinned Joern CLI **4.0.564**, based on `ghcr.io/joernio/joern@sha256:54c7f728f813c1cefd4303e7c69c5d35003f0fc9fde1459872230e5bc4e4b7b4`. Disposable image: `dt-joern-qwen-reliability:qphvk9`, digest `sha256:811c2cb966c35cc1b9f607996bc452ec54e64884ae7714aa55e8b1c22ec5c7b5`. Host navigation changed; worker query scripts did not.

Inference ran on the user-provided SSH box, existing Ollama **0.40.13**, RTX 3080 Ti 12 GB, `qwen3.5:4b` Q4_K_M (4.2B parameters), digest `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04`.

Recent `direct` cohorts use `think:false`, temperature 0, top_p 1, top_k 20, min_p 0, presence_penalty 0, repeat_penalty 1, `num_ctx:32768`, `num_predict:4096`, 10 turns and 16 outer calls. This greedy profile is an empirical experiment, not the model card's general recommendation. Thinking/sample profiles and their failures remain in the index. The [Qwen model card](https://huggingface.co/Qwen/Qwen3.5-4B) recommends different settings by task; [Ollama tool-calling](https://docs.ollama.com/capabilities/tool-calling) and [thinking](https://docs.ollama.com/capabilities/thinking) describe the native message protocol. Raw transcripts retain settings, provider usage and any returned thinking. Greedy seeds are not independent stochastic replications; row values and fresh retained evidence identities still differ between trials.

The final frozen executable source passed **1471 tests / 66 skipped / zero failed** on both Node 24.22.0 and Node 22.23.5 (1537 tests per suite). Build freshness, handbook, lifecycle charts, documentation, inventory and whitespace gates passed. Implementation commit: `088cd4c1ab6cfe7e4b3c8080a43782e480e5fdd6`; source digest: `2d489287b84d331554dd0375077baa25d580e778a62857c037206618d6133abf`.

Fresh Java/JavaScript/loop fixtures have independent before-fails/after-passes runtime oracles. These establish fixture changes, not runtime verification by the static tool. [Validation details and log hashes](benchmarks/code-joern-reliability/validation.json).

## Scope and reproduction

Current harnesses use the production registry, profiles, chat-pressure transport and a verified exact 12-tool read-only backend allowlist. They supply no expected answer, fixture-specific adapter, automatic query or automatic polling. Offered native names are enforced. Earlier group-expanded tool scopes and eight harness errors are labelled separately in the index; source syntax failures are not model failures.

The workload does not cover all 330 production tools, arbitrary repositories, overload resolution, distributed flows, adversarial behavior, production service correctness or latency guarantees. Repeated seeds reuse deterministic row values but create fresh result identities. Findings should guide interface selection, not justify unattended universal reliability.

Use Node 22+, dependencies, Git, Docker, JDK 17+, the semantic worker and the exact Ollama model. Keep worker URL/token in a mode-0600 private state file outside Git. Build sources before creating the worker. Prepare fresh original variants with `dev/prepare-semantic-reliability-fixtures.cjs` and transfer fixtures with `dev/prepare-code-transfer.cjs`; both retain public scenarios/oracles separately from credential-bearing state.

```sh
node dev/prepare-code-transfer.cjs \
  --state /private/worker.json --home /private/fresh-transfer \
  --output /private/transfer-cases.json

node dev/eval-code-matrix.cjs \
  --state /private/core-state.json --variants /private/original-variants \
  --transfer /private/fresh-transfer --output /private/reports \
  --surface questions --profile direct --suite joint --label questions-repro
```

Use `--surface semantic` for `code-semantic` or `--surface code` for code-only. `--suite matched` selects eight original task/seed pairs; `--max_failures N` stops only between completed trials. Preparers and evaluation schedules refuse overwrites. The published raw index, not the best earlier cohort, is the record of model behavior.
