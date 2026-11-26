# Small-model tool IO evaluation

Local Ollama `qwen3.5:2b` (server-advertised 1.9B, Q8_0) was tested against eight fixed tasks. The original IO changes alone did **not** improve overall task success: both baseline and first implementation passed 4/8. Actual failures then drove selector and discovery corrections. This is an exploratory engineering comparison with one trial per task per revision, not an estimate of production reliability.

## Method and boundaries

Each arm used the same frozen [runner](../dev/eval-tool-io-model.cjs), generic system instruction, task templates, sampling settings and budgets: temperature 0, seed 42, thinking disabled, 32,768-token context, 768 output tokens per request, eight turns, sixteen calls, 90 seconds per model request. The endpoint was local Ollama on CPU. The model digest was identical in every arm: `0689d44085e06d165161a8a9a1731344278cfb5aade63a3c3dbdb48ab54b130a`.

Each case creates a fresh scoped synthetic workspace and saved script. Actual production tool implementations, schemas and chat output formatting run against that fixture; actual Node tests execute. A case-specific allowlist blocks writes, script execution and unrelated actions. No production services were contacted. The script task offers the lean discovery tools; test tasks offer four direct tools; the retained-data case offers only `result_read`. These are controlled task environments, not a full application session or an evaluation of the whole tool catalog.

Test success requires an executed run receipt with the expected test count. Polling must return the original job. Script discovery requires reading the correct saved definition. Completeness tasks require exact JSON booleans. Data success requires recovering all twelve retained rows and returning their sum, 445. A common independent [postgrader](../dev/summarize-tool-io-model.cjs) treats typed arrays, root objects and complete contiguous JSON pages as equivalent recovery evidence. Its grading tests cover those shapes; the runner's embedded data grader is less permissive, so the comparison uses the common postgrader.

Generated workspace/job/result identifiers and elapsed times vary. Temperature zero does not make this a statistical paired experiment; prompt identifiers, caching, order and host load can affect results. Timing is descriptive. No model-specific prompt coaching was added between arms, and all intermediate failures are retained.


## Results

| Revision | Passed | Tool calls | Tool errors | Delivered bytes | Prompt tokens | Output tokens | Seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 4/8 | 36 | 9 | 39,858 | 94,747 | 2,016 | 406.5 |
| after | 4/8 | 29 | 7 | 92,987 | 98,694 | 1,722 | 513.4 |
| patched | 6/8 | 14 | 0 | 78,816 | 48,346 | 1,000 | 414.0 |
| final | 6/8 | 21 | 0 | 46,018 | 65,159 | 1,289 | 316.6 |

`before` is the parent revision; `after` is the first IO implementation; `patched` adds selector tolerance and content-search discovery; `final` also makes exact-name discovery return a single capability. The patched script task hit the fixed 90-second endpoint timeout after a 38 KB exact-name response. It remains a scored failure.

| Task | Baseline: success, calls/errors | Final: success, calls/errors |
| --- | --- | --- |
| all-default | fail, 8/3 | pass, 3/0 |
| single-test | pass, 1/0 | pass, 1/0 |
| diff-tests | pass, 7/2 | pass, 3/0 |
| poll-job | fail, 7/3 | pass, 2/0 |
| saved-script | fail, 8/0 | fail, 8/0 |
| full-result | fail, 5/1 | fail, 4/0 |
| preview-awareness | pass, 0/0 | pass, 0/0 |
| source-awareness | pass, 0/0 | pass, 0/0 |

The final arm passed 6/8 versus 4/8, with 21 versus 36 calls and zero versus nine tool errors. Its prompt tokens fell by 31%, while delivered bytes grew by 15%. Token counts are server-reported totals over every request, including repeated context; they are not unique transcript size. Delivered bytes include the initial snapshot and tool responses, but exclude offered schemas and model text. Tool errors count failed calls, not model endpoint timeouts.

All four test-execution tasks passed in the final arm. For all-tests, the model listed the workspace and passed only `workspace`, omitting selectors. For named/changed tests it used the JSON-encoded string `tests:'["a.test.cjs"]'`; for polling it passed only `job`. The changed-test task supplied the changed filename, so its pass demonstrates correct selection and execution, not that the model independently chose `scope:"diff"` or `-diff`. Those aliases and completely empty inputs are covered by deterministic regression tests, not demonstrated by this model trial. The final saved-script task still failed: it repeated the now-647-byte exact-name lookup and never described/executed `script_search` to read the script definition. It used all eight allowed turns. The exact lookup is substantially smaller, but that did not resolve this model’s discovery loop.

The baseline did not recover the complete retained dataset; all subsequent arms did. Nevertheless, every arm returned the three-row preview sum (121) instead of the twelve-row sum (445), so the data task failed throughout. Both completeness-awareness controls already passed at baseline; this sample shows no improvement for them.

The machine-readable [comparison](benchmarks/tool-io-model-comparison-2b.json) links the scores to the sanitized [baseline](benchmarks/tool-io-model-before-2b.json), [first implementation](benchmarks/tool-io-model-after-2b.json), [intermediate patch](benchmarks/tool-io-model-patched-2b.json) and [final](benchmarks/tool-io-model-final-2b.json) transcripts. Every completed arm has a stable source digest and identical harness/instruction/model/settings metadata.

## What the model exposed

| Actual input or behavior | First implementation | Follow-up behavior |
| --- | --- | --- |
| `tests:'["a.test.cjs"]'` | Treated the encoded array as a literal selector; repeated failures. | Decode JSON arrays before normalizing; uniquely resolve reviewed Node test filenames. |
| Ambiguous short test filename | Could not use a short filename. | Require the exact path when multiple reviewed tests share a filename. |
| `tool_search("unpaid orders")` | Searched capability descriptions; model never reached saved scripts. | Return a directory of authorized specialized content searches. |
| `tool_search("script_search", all:true)` | Weak lexical matches inflated the response to about 38 KB and the next request timed out. | Exact tool names return one capability, also with `all:true`. |
| `result_read(path:"/rows", all:true)` | Successfully recovered all twelve rows, but the model still summed only the three-row preview. | Raw-data access alone does not establish correct reasoning over that data. |

Malformed JSON arrays, non-string entries and ambiguous selectors still receive actionable errors. Short-filename resolution excludes fixtures, generated trees and symlinks; explicit paths retain their existing behavior. Bracketed filenames such as `[id].test.cjs` remain literal filenames.

## Reproduction

Baseline is commit `446bff8`; the first implementation is `73fb511`. Each transcript records the actual source digest, advertised model metadata, source stability, harness digest, prompts, raw tool results, delivered results, token usage and call receipts. The final arm records the sources containing the evaluation-led fixes. Hostnames in retained reports are redacted; byte/token metrics were measured before redaction. Fixture result links expire when the run cleans up its temporary directory.

Run each revision in a separate process with its dependencies available:

```sh
node dev/eval-tool-io-model.cjs --root /path/to/revision --arm before --repeats 1 --output /tmp/before.json
node dev/eval-tool-io-model.cjs --arm final --repeats 1 --output /tmp/final.json
node dev/summarize-tool-io-model.cjs /tmp/before.json /tmp/final.json
```

The harness default is two repeats; these reported runs explicitly use one. Repeated trials and a broader task set are needed before claiming general reliability. The data case deliberately includes large irrelevant payload fields and no code/calculator tool, so it stresses retrieval and reasoning together. Structured projection and tool-side aggregation are useful future cases; they were not added to inflate this comparison's score.

## Validation

The follow-up changes passed all 23 targeted checks. The full suite completed with 1,443 tests: 1,377 passed, 66 skipped and zero failures. `npm run build`, `npm run build:check`, `node dev/build-handbook.js --check` and the staged whitespace check passed. The common postgrader produced identical scores before and after transcript hostname redaction.

The [follow-up evaluation](tool-io-follow-up-evaluation.md) investigates the remaining failures, adds retained numeric totals and a focused native script profile, and records the successful small-model paths plus the lean dispatcher's remaining limitations.
