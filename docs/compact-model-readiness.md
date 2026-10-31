# Compact discovery: measured limits and release gates

Implementation follow-up: [readiness implementation](readiness-implementation.md) and independent review cover the implemented workflow guides, isolated task evaluator, updated capability checks and remaining real-model evidence requirement. The measurements below retain the original discovery experiments.

The discovery surface can start with four or five tools. Production readiness for
a particular small model is **unverified**. Registry retrieval scores, scripted
responses and successful argument validation do not measure model reasoning or
completion of a developer task.

The experimental BM25 ranker remains opt-in: independent short-symptom queries
regressed despite a strong development-corpus score. Default installations keep
the exact historical scoring algorithm. Select the experiment only through
trusted configuration: `tools.discoveryRanker="bm25"`.

## Evidence and reproduction

Baseline: `4b6dc31`, built-in registry, isolated temporary configuration with
`dev`, `staging`, `prod`, and no live connections or remote plugins. The 32-query
development corpus contains explicit, useful-next-tool relevance judgments.
Recall@k is the fraction of each query's relevant set retrieved in k results,
averaged across queries. Hit@k means at least one relevant result. Multi-stage
workflow relevance does not mean one returned tool completes the workflow.

```sh
npm ci --ignore-scripts
node dev/benchmark-discovery.js
node dev/compare-discovery-queries.js dev/eval/challenge-symptoms.queries.json
node dev/compare-discovery-queries.js dev/eval/user-workflows.queries.json
node --test test/tool-discovery.test.js test/tool-contracts.test.js test/model-discovery-eval.test.js
```

| Evidence | Frozen legacy baseline | Experimental BM25 |
| --- | ---: | ---: |
| 32-query mean recall@3 | 0.8854 | 0.9740 |
| 32-query mean recall@5 | 0.9635 | 1.0000 |
| 32-query hit@3 | 0.9375 | 1.0000 |
| 32-query hit@5 | 1.0000 | 1.0000 |
| Four later user questions: mean recall@3 | 0.0500 | 0.1333 |
| Four later user questions: mean recall@5 | 0.2583 | 0.3208 |

The baseline 32-query result used the actual baseline `tool_search`; the current
benchmark explicitly enables BM25 in its temporary configuration and records that
mode. The 24
independent challenge symptom texts and four later user questions were left
untuned: their comparisons replay the original baseline ranking over the original
descriptions and call the actual current registry. These are separate reports,
not a blended success score. The public 24 text-only report intentionally contains
no tool/proof mappings; relevance judgments remain with the independent challenge
author. Requests for unsupported distributed guarantees need explicit refusal of
the guarantee, not a top-k hit metric.

The independent author's frozen mappings for 21 supported/workflow symptom
queries show the opposite top-k trend from the development corpus:

| Independent held-out metric | Legacy baseline | Experimental BM25 |
| --- | ---: | ---: |
| Hit@3 | 0.5714 | 0.5238 |
| Hit@5 | 0.7143 | 0.6667 |
| Macro recall@3 | 0.2111 | 0.1560 |
| Macro recall@5 | 0.2421 | 0.2648 |

Hit@5 regressed for W01 (invoice-cent symptom), W09 (missed scheduled
reconciliation) and W17 (repeat an operational investigation); W06 and W12 gained.
The three expected-gap probes W22–W24 produced zero explicit abstentions in both
rankers. Returned candidates alone do not claim that an operation is supported,
but discovery does not communicate these unsupported boundaries. The later
questions and held-out mappings were not used to retune ranking. These results
block a universal BM25 default and any claim of broad symptom understanding.

Saved reports: [baseline](benchmarks/compact-discovery-baseline.json),
[current](benchmarks/compact-discovery-improved.json),
[untouched symptom rankings](benchmarks/challenge-symptoms-discovery.json),
[user workflow judgments and results](benchmarks/user-workflows-discovery.json).

## What changed

The historical search counts arbitrary substrings and repeated common query words.
For example, `in` matched unrelated descriptions, while the exact logging tool
was fifth for a request for service exceptions. Experimental BM25 uses Unicode word
boundaries, deduplicated normalized terms, stop-word removal and local BM25
ranking. Token frequencies are cached by the enabled tool's name/description/
group and invalidated when metadata changes. Exact tool names retain priority;
group and permission filtering happen before ranking. The search result includes
bounded matched/unmatched keywords, with no inferred confidence score.
The default ranker retains the original scoring, including those known lexical
limits; it also returns the bounded diagnostics and its explicit ranker name.
Independent negative verification is the reason BM25 is not the default.

The `consul_service` description now identifies its actual deployed-instance
`/version` payload, including version/commit only when the service reports it.
This fixes the development corpus's deployed-version ranking regression. No
runtime service call, existing argument schema, permission rule or versioned
transport contract changed.

The existing `compact` set remains eleven tools. `lean` is an opt-in four-tool
set (`tool_search`, `tool_describe`, `tool_execute`, `tool_profiles`); `lean-find`
adds `find`. Both can discover all **enabled** capabilities. A profile is not an
authorization boundary. Custom profiles can opt out of the historical core
union with `includeCore:false`.

The integrated bundled compose/example configuration selects `lean-find` for
new installs. Explicit `compact` remains compatible, and an unspecified
standalone profile continues to expose `all`.

## Context and latency

Sizes are exact UTF-8 JSON bytes in this three-environment registry. Token counts
below are **estimates: bytes / 4, rounded up**, not a model tokenizer measurement.
Provider wrappers, prompts, reasoning and output add further context.

| Starting set | Count | dt schema bytes | Estimated tokens | OpenAI function-schema bytes |
| --- | ---: | ---: | ---: | ---: |
| compact | 11 | 7,080 | 1,770 | 7,410 |
| lean | 4 | 1,806 | 452 | 1,926 |
| lean-find | 5 | 2,851 | 713 | 3,001 |
| all | 159 | 115,112 | 28,778 | 119,882 |

The initial list is only one part of context use. Experimental 32-query search
results average 2,473 bytes; describing the top three averages 3,060 bytes. The
flow-test query produces a 3,030-byte shortlist and 5,018 bytes of top-three descriptions.
Prefer describing the chosen candidate once; automatically expanding profiles
or describing every match gives back much of the saved context. Full outputs
must retain explicit completeness, provenance, views and gaps when shortened.

One saved experimental run measured warm in-process search p50 8.22 ms/p95 78.90 ms
and a real localhost HTTP discovery → describe → cached-entity execution p50
25.21 ms/p95 139.57 ms over twelve three-request workflows (first request included). These
are local measurements with tracing/history, not network-service or inference
latencies. The old search baseline was p50 3.79 ms/p95 9.55 ms in a different run;
host load and registry work preclude claiming a speedup. Every discovery chain
also adds model turns, whose latency and price have not been measured here.

## Failures that matter for the requested workflows

| User question | Experimental BM25 top-five evidence | Required next work |
| --- | --- | --- |
| All column reads/writes in functions and repositories | `pg_usage` second; `impact` and `code_search` absent | Decompose into exact database/schema/table/column identity, column impact and source verification. Table-level usage cannot prove column reads/writes or complete dynamic SQL coverage. |
| Related DB/ES/Kafka state to reproduce a bug | Only `scenario_state_capture` appears, fourth | Explain the PG/Kafka fixture plan/capture stages and separate ES read-state bindings. Require explicit cross-system correlation, capture gaps and an actual runnable reproduction. |
| Refactor chained function results, compare locally and in dev | `pg_function`, `impact`; comparison/test tools absent | Capture representative inputs and independent expected outputs/effects, compare old/new behavior, then identify a supported dev execution target. A dev read-only experiment does not run the refactored dev service. |
| Run this test on dev | `test_run` fifth, after unrelated operations | Clarify the test and execution target. `test_run.env` selects source schema/fixture context and optional scratch setup; it does not execute against the deployed dev application. |

Short symptom-only prompts are also unreliable: “Only production reservations
expire” retrieves expiring browser sessions; tenant release symptoms retrieve
scratch-database release operations. BM25 corrects lexical defects; it does not
diagnose incidents. Evidence-first decomposition and task-specific help are
required before relying on this workflow with a smaller model. Do not tune on the
later user questions and then present them as held-out evidence.

## Model availability and opt-in runner

The evaluated worktree's config API reported no `llm.baseUrl`, model or API key.
The local Open WebUI container on `127.0.0.1:3480` is configured with
`http://host.docker.internal:4910/v1` and `demo-model`. The localhost `/models`
endpoint advertises only `demo-model`; `demo/mock-llm.js` confirms it is a
scripted demonstration. No real approximately 27B endpoint was identified or
tested; availability of other models is not established by these probes.
The informal name “qwen3.8” is not assumed to identify an existing release.

The optional runner accepts a deliberately selected compatible endpoint/model,
or `--use-configured-llm` to read those through the config API. It then creates a
fresh synthetic home, excludes relevance/answer labels from model messages and
sends only the selected profile, questions and synthetic discovery results.
Task operations validate schemas and report `executionPerformed:false`; they
never query real backends, run code or mutate systems.

```sh
# Supply an existing approved endpoint and its exact advertised model id.
node dev/eval-discovery-model.js --endpoint http://127.0.0.1:8000/v1 \
  --model EXACT_MODEL_ID --profile lean-find --limit 4

# Uses llm.baseUrl/model/key from config; still evaluates synthetic discovery only.
node dev/eval-discovery-model.js --use-configured-llm --profile lean
```

The model runner defaults to `--ranker legacy`; use `--ranker bm25` explicitly
for a controlled comparison. It records both the profile and ranker in provenance.

Non-loopback endpoints require explicit `--allow-remote`. Keys come from config
or `DT_EVAL_API_KEY`, never a command-line key argument. Defaults bound turns (8),
calls (24/case), JSON context (64 KiB), completion tokens (1,024), request timeout
(30 s), response bytes (1 MiB) and whole-run time (10 min). Results record exact
requested/returned/advertised model IDs, timestamp, corpus/schema hashes, profile,
budget exits, validation failures, provider-reported usage and optional estimated
cost from explicitly supplied prices. Model identity is provider-reported; size
and runtime provenance remain unverified. `--scripted-endpoint` and known
`demo-model` results are labeled contract checks separately from model results.
The unit test uses a scripted server to verify transport, label isolation,
invalid-argument recovery, context selection and zero application execution.

## Production gates, in dependency order

1. **Correct identities and proof boundaries first.** Resolve independently
   demonstrated impact/graph scope and freshness defects before accepting “all
   reads/writes” or cross-service change safety. Test duplicate database names,
   overloads, internal-library versions, stale inputs and truncated traversals.
   A compact profile cannot repair a wrong graph.
2. **Make the four workflows discoverable without wording hints.** Preserve these
   four questions as a held-out regression set and add independently authored
   paraphrases. Require every necessary first-stage capability within five
   results after an explicit decomposition step, and an explicit target
   clarification for “on dev.” Current results fail this gate. Any task guide
   must describe supported operations and gaps, not claim unsupported execution.
3. **Evaluate the exact deployed model/tool client.** Record model release,
   quantization/runtime, native tool-call mode, chat template, tokenizer and
   context limit. Compare compact/lean/lean-find under the same bounded harness;
   use held-out queries and then actual isolated multi-step tasks. Require zero
   unauthorized live actions, zero false completion claims, schema recovery and
   environment/identity preservation. Scripted and schema-only scores never
   substitute for end-to-end results.
4. **Exercise asynchronous and cleanup paths with real isolated resources.**
   Validate exact-job polling, cancellation, red-green evidence, multi-database
   fixture bindings, async quiet windows and owned-lease cleanup failures. This
   evaluation checks discovery and guard behavior, not those runtime guarantees.
   Polling/reuse keys must distinguish environment, database and execution inputs;
   a returned failed test outcome must remain distinct from a successful tool
   invocation in retained evidence.
5. **Budget the whole conversation.** Save native tokenizer counts and provider
   usage for discovery, the selected schema and outputs. Record model turns and
   p95 wall time on the deployment hardware and a production-sized custom-tool
   registry. Keep the starting list at four/five when selected, preserve defaults
   and contracts, and expand only for the active task. Retest whenever a model,
   schema, tool permissions or a workflow guide changes.
