# Discover change-path evidence

Use `semantic_trace` to prepare a specific entry/line-to-exit change: inspect one retained analysis, or compare two independent analyses ordered before, after. Its collected context includes conditions, loop bounds, stream callbacks and inherited library bodies. This supplements the selected value/control paths; it does not prove execution.

| Question | Capability |
| --- | --- |
| Did this entry value reach this sink differently after the change? | `semantic_trace` |
| Which parent helper, stream predicate or loop condition could change that path? | `semantic_trace`, with `includeContext:true` (default) |
| Which concrete subclass supplies the inherited template implementation? | `semantic_trace` with `from.receiver`; index the exact Java library closure with `composite:true` |
| Show a whole-entry state overview without a selected sink | `semantic_query` with `operation:"flowmap"` |
| Which other services, callers and tests could be affected? | `impact` |
| Find literal source text / read a file | `code_search` / `code_read` |
| No retained analysis exists | `semantic_index`; inspect readiness and returned source identities |

`tool_search` searches capabilities, not repository contents. Search for an action such as “compare a change path with guards” rather than just a class or service name. Follow its exact `tool_describe` link and inspect the schema. The `selected-change-path` workflow guide explains selection, tracing, interpretation and executable verification. Tool profiles change exposure, not permissions.

A new trace with supplied selection/endpoints needs `from`, `to` and `analysis` or `analyses`. Empty calls still return recovery guidance; `job` observes an existing owned job without repeating the trace. Copy IDs returned by `semantic_index`; do not turn a branch, service or synthetic label into an invented analysis ID. Use `from.parameter` for an entry value and `to.argument` for a call argument. A line endpoint needs its relative file and line. [The tracing guide](selected-path-tracing.md) covers moved lines, assumptions and exports.

## Measured discovery and remaining model gaps

The [retained review](benchmarks/trace-discoverability.json) records all cases, schemas, corpus/instruction hashes, budgets, model metadata and phase-specific source digests. Qwen 3.5 4B was called through an SSH loopback tunnel with native tool calling, thinking disabled and a 16K context. Model size/quantization/digest are provider-reported. No business data or credentials were sent.

The frozen corpus has ten synthetic tasks: five specific trace uses, a whole-entry map, literal search, cross-service impact, a file read and preparation of the library closure. Expected tools/argument judgments are withheld from the model. Discovery and schema-description calls execute against the real local registry; task calls only validate arguments. No Joern query, repository modification or application test is performed by this evaluation.

Before the changes, the intended capability appeared in the default visible results for 3/10 tasks with the legacy ranker and 7/10 with BM25. After routing specific source-path requests ahead of broad review/source keywords, both rankers expose the intended capability for 10/10 tasks, within 4 KiB. Ordinary text/file/impact requests retain their own tools. Lean exposure remains four tools and below 2 KiB.

That ranking result is **not a model task-success score**. In the initial lean trial, the model described the expected trace capability in 0/5 trace cases; after the wording/routing pass it did so in 4/5. Correctly bound dry-run submissions remained 1/10 overall in both trials. A final five-case semantic-profile trial passed 0/5 strict argument checks. Typical errors were repeating object-name capability searches, inventing analysis IDs, and confusing method parameters with sink arguments. These exploratory phases changed schemas/profile and are not a controlled quality comparison.

One file-read control also invented source contents after receiving only a schema-validation acknowledgement. A separate one-tool protocol check consumed the authoritative tool result correctly in both raw-native and normalized message forms; that narrow check does not explain all discovery failures. Never infer execution from model prose.

Use exact returned identities and review/prepopulate the call when a small model fails to bind them. A typed UI draft or client schema deferral can provide the exact selected tool; expanding the entire semantic profile did not solve this trial. Runtime index/endpoint feedback, executable entry-to-exit regressions and larger/repeated evaluations remain separate work. The current changes improve discovery and reject incomplete requests; they do not establish reliable autonomous 4B task execution.

## Reproduce

Run deterministic registry checks without a model:

```sh
node dev/benchmark-trace-discovery.js
node --test test/trace-discovery.test.js test/trace-discovery-eval.test.js test/model-discovery-eval.test.js
```

For an explicitly selected, owned Ollama endpoint (loopback or an existing SSH tunnel):

```sh
node dev/eval-trace-discovery.js --endpoint http://127.0.0.1:11434 --model qwen3.5:4b --profile lean
```

The runner enforces turn/call/context/time budgets, uses a disposable synthetic configuration, and never executes task operations. `--profile semantic --limit 5` measures direct semantic exposure separately. Keep complete phase reports before using `dev/report-trace-discovery.js` to assemble a portable review; do not substitute scripted endpoint tests for real-model evidence.
