# Tool IO follow-up: discovery and arithmetic

The focused native script profile completed inspection in two tool calls with the correct final answer. Both retained-data arithmetic tasks also passed, versus zero at baseline. The general lean discovery dispatcher still caused repeated definition reads, so the supported small-model path uses the new two-tool `scripts-read` profile. These are exploratory results with one trial per variant, not a general reliability guarantee.

## Changes

- Exact capability searches include the input schema and execution guidance. Script-oriented searches offer a concrete dispatch call using content words; discovery never executes it. An explicit search name followed by words also produces a proposed call. Normal grants, scope isolation and group filtering apply.
- Numeric projections retain only the requested columns. A numeric single-field projection offers a sum call. The mistaken array path `/rows/value` is accepted only when it agrees with the requested projected/aggregate field; raw JSON pointers remain strict.
- `result_read` computes count, sum, average, minimum and maximum over every retained row. Missing, nonnumeric and unsafe values fail rather than disappear from totals. Every receipt names its row count and source coverage, with a reference back to the original rows.
- Compact row previews include bounded numeric totals computed over all retained rows, using the same implementation as explicit aggregates. This lets a model answer a total without doing arithmetic over a sample or fetching irrelevant payloads. Numeric ID columns are excluded. These totals have an explicit retained-row scope and do not prove source completeness.
- Projection/aggregation receipts use `retainedComplete`; legacy raw reads have `completeScope`. The output status and source status remain separate, including paged reads from a partial source. `script_get` exposes a derived `requiredParams` list beside the exact definition.

## Latest arithmetic comparison

Both tasks ask for a sum, included row count, and whether complete source coverage is proven. They differ in source coverage: one is unknown, while the other explicitly has an unavailable partition. Each retains twelve rows but initially shows three. Large irrelevant payloads remain in the raw evidence. Final summary-based answers are grounded in actual server-produced totals, not model claims alone.

| Metric | Baseline at 2b291f5 | Updated compact summaries |
| --- | ---: | ---: |
| Correct sum, count and coverage | 0/2 | 2/2 |
| Extra tool calls | 0 | 0 |
| Delivered bytes | 6,200 | 6,922 |
| Provider-reported prompt tokens | 2,461 | 3,079 |

| Dataset | Expected retained sum | Updated answer | Included rows | Source completeness proven |
| --- | ---: | ---: | ---: | --- |
| all-retained | 445 | 445 | 12 | false |
| partial-source | 234 | 234 | 12 | false |

The zero-call baseline was wrong: it answered from the preview without retrieving evidence. The zero-call updated answers used totals already present in the compact preview, calculated over all twelve retained rows. These summaries increase delivered bytes by about 12% in this pair; their value here is correctness and avoiding a full raw-data fetch, not a reduction relative to the baseline’s erroneous shortcut.

The paired [baseline](benchmarks/result-operations-baseline-summary-2b.json) and [updated](benchmarks/result-operations-summary-2b.json) transcripts share the exact harness, generic instruction, model digest and limits. The updated run’s source digest is `92059198d7114106620b45705e2717550209ee026731844d20b254dbaf55bf36`. Subsequent changes correct partial-page output classification, shorten the lean discovery schema and add the script profile. They leave the arithmetic cases’ input schema and nonpaged payloads unchanged. The native script experiment uses the current source digest.

## Script inspection through native tools

The new `scripts-read` profile exposes `script_search` and `script_get` directly. Its native schemas total 1,150 JSON bytes. The real model searched for `unpaid orders check`, read `orders/unpaid-check` once, and answered with the exact id and required parameter `customerId`. No saved script executed.

| Observed workflow | Recorded lean dispatcher | Focused native profile |
| --- | ---: | ---: |
| Tool definitions offered | 4 | 2 |
| Tool calls | 8 | 2 |
| Correct definition read | yes | yes |
| Final answer emitted | no | yes |
| Delivered result bytes | 11,852 | 774 |
| Provider-reported prompt tokens | 22,520 | 2,373 |

This is a deliberate interface/profile experiment, not a same-schema comparison. The task text, generic system instruction, model weights, sampling and limits match the earlier script task; the native runner omits the unrelated workspace setup. The [native-profile transcript](benchmarks/script-native-profile-2b.json) includes the actual profile-selected schemas and final answer. It requires both an executed definition read and the correct emitted id/parameter names to pass.

Select `/openapi/scripts-read.json`, or set `tools.profile` / `DT_TOOL_PROFILE` to `scripts-read` for the default OpenAPI schema. MCP defaults to its existing all-tools listing; the current server also supports /mcp?profile=scripts-read for the same focused tools. The default `direct` profile now also includes `script_get`. Profiles select exposed schemas and never grant permissions.

### Lean-dispatcher limitation

At the earlier baseline, all eight calls remained in capability discovery and no definition was read. The latest confirmation used three capability searches, one actual script search, and four reads of the correct definition. The receipt criterion therefore passes, but the run ended at the eight-turn budget with no final answer. Treating that receipt grade as a completed user interaction would overstate the result.

The correct definition was reached in two follow-up trials. Another trial timed out at the fixed 90-second model-request limit before reaching it. One earlier run was interrupted by a full disk and is excluded from scores. These outcomes are all retained, including failures; the lean four-tool discovery configuration is still unreliable for this model. The tool handoff is improved, and a model-level stopping/duplicate-read policy remains further work.

The [lean script confirmation](benchmarks/tool-io-model-script-confirm-2b.json) and [iteration summary](benchmarks/tool-io-follow-up-summary.json) separate definition receipts, emitted answers, errors and endpoint failures. The original raw-data task still requires complete raw payload recovery; a correct sum from projected values or an aggregate does not satisfy that stricter task. Its raw-retrieval grades are preserved.

## Method and reproduction

The [native-profile runner](../dev/eval-script-profile.cjs) uses the actual `scripts-read` profile, two authorized native tools and the same script-inspection question. The new [retained-data runner](../dev/eval-result-operations.cjs) offers only the real `result_read` schema and production implementation. It uses disposable synthetic fixtures, actual chat compaction, scoped retained results and receipt-based grading. The existing [frozen IO runner](../dev/eval-tool-io-model.cjs) supplies the script/raw-data cases. No model-specific system prompt coaching was introduced within a paired comparison. The data runner evolved between exploratory pairs to grade both explicit aggregate receipts and authoritative preview summaries; the latest pair was rerun with an identical harness on both revisions.

Runs use the same server-advertised Qwen 3.5 2B / 1.9B Q8_0 weights, temperature zero, seed 42, thinking disabled, a 32,768-token context, 768 output tokens per request, at most eight turns/sixteen calls, and 90 seconds per request. There is one trial per case per code variant. Generated IDs, caching and host load vary. These are exploratory checks, not a general reliability estimate. No production backend was queried and no saved script was executed.

Hostnames are redacted in the retained JSON; byte/token measurements precede redaction. Fixture links expire at cleanup. Source and harness hashes, raw/delivered values, transcripts, expected answers and grades remain available in the [machine-readable summary](benchmarks/tool-io-follow-up-summary.json).

`node dev/eval-result-operations.cjs --root /path/to/revision --arm name --output /tmp/result.json` reruns the arithmetic tasks against a selected revision. The defaults use local Ollama at `127.0.0.1:11434` and `qwen3.5:2b`.

## Validation

[Remote Verify](https://github.com/merv-gh/dev-tool/actions/runs/45825261432) passed for implementation commit `03ff2e2`: full tests on Node 22 and 24, the Node 24 coverage gate, integration/browser checks, build freshness, executable state charts, documentation links and generated tool inventory. Node 22 recorded 1,449 tests: 1,383 passed, 66 skipped, zero failures.

The local serial attempt recorded 1,379 passed, 66 skipped and four failures following an oversized data-lineage fixture exhausting the remaining disk. The earlier parallel attempt had cascading filesystem failures and one stalled test process was terminated. These were not counted as successful local verification; the same full suites passed remotely with sufficient space. The generated inventory was refreshed after its source-reference check detected staleness. A genuine lean-schema size regression was corrected and its existing sub-2 KB regression check passes.

The latest native-profile harness and arithmetic-pair harness hashes match their retained reports. The native-profile source digest and generated inventory match the implementation commit. The report and transcripts are separate documentation artifacts; no production service or saved script ran during the model experiments.
