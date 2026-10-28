# Real tool task evaluation

`dev/eval-discovery-model.js` measures discovery only. `dev/eval-tasks-model.js` executes actual synthetic tasks through the tool registry and retains independently checked case evidence.

```sh
node dev/eval-tasks-model.js \
  --endpoint http://127.0.0.1:8000/v1 --model exact-model-id \
  --pack /absolute/public-tasks.json --grader /absolute/private-grader.cjs \
  --output /absolute/evaluation-results
```

An API key is read only by the parent HTTP client from `DT_EVAL_API_KEY`. A remote endpoint requires `--allow-remote`. Use `--scripted-endpoint` for scripted protocol checks; those reports are never real-model results. Model generation, limits, exact requested/returned model IDs, provider-reported usage, immutable pack/grader/source hashes and container image tag/ID are recorded. A model name does not verify parameter count. No actual 27B endpoint was available during implementation.

The evaluator requires Docker and an operator-selected runtime image (`--image`, default `node:22-alpine`). Each task gets its own disposable named volume and an unprivileged container: no network, no capabilities, read-only root filesystem, bounded memory/CPU/processes, no Docker socket. Only public tool code, public contracts, synthetic evaluator configuration and runtime dependencies are mounted read-only. The candidate cannot rewrite the operator target/tool configuration. A writable synthetic case volume and temporary filesystem complete the mounts. Tool code staging excludes repository configuration, dev/eval corpora, challenge answers, proof files, docs and private graders. Actual Docker isolation settings are inspected and retained. Cleanup of owned containers/volumes is recorded before evidence is signed; cleanup errors prevent certification.

The model initially receives the selected short profile (default `lean-find`, five tools). It sees only the public prompt, workspace ID, editable paths and required test selectors. Expanded capabilities remain available through the existing discovery facade. Every actual tool call, error and model response is hash-chained. Baseline and post-change `test_run` calls run through the registry. Empty or skip-only tests cannot pass. A structured final response is required: `{"claimedStatus":"complete|blocked|incomplete","summary":"..."}`. A claimed success that lacks passing independent evidence is flagged as `falseSuccess`.

`assessment.toolComplete` records supported tool execution, including the verification harness. `assessment.modelComplete` additionally requires the model to change the candidate, explicitly request and observe a passing `test_run` on the final candidate, claim completion, and leave unchanged inputs during final verification. Merely announcing a correct patch that the harness later tests is not model completion. Calls through `tool_execute` count; opaque nested execution through arbitrary scripts does not establish that the model observed a test. Aggregate `metrics.complete` counts model completion, while `supportedToolComplete` separately counts harness-supported completion. `selectedCases` and `unattemptedCases` preserve tasks omitted by the wall-clock budget: use `supportedSelectedCases` as the supported-completion denominator, including unattempted cases. Expected-gap selection and correct blocking are counted separately. Older records without model-interaction evidence have `modelComplete:false`.

Public pack format:

```json
{"version":1,"tasks":[{
  "id":"double-value","kind":"fix",
  "prompt":"Fix total(n): return n doubled, including negatives and zero.",
  "editable":["src/value.cjs","test/generated/"],
  "tests":["test/value.test.cjs"],
  "files":{
    "src/value.cjs":"exports.total=n=>n+1",
    "test/value.test.cjs":"const t=require('node:test'),a=require('node:assert/strict');t('double',()=>a.equal(require('../src/value.cjs').total(4),8));"
  }
}]}
```

Task kinds are `fix`, `tests` and `expected-gap`. Files outside exact editable paths or declared path prefixes must remain unchanged. Test-only tasks may edit only test paths. Candidate code is never imported into the host grader. The trusted private grader remains exclusively in the host parent and exports an asynchronous function:

```js
module.exports = async context => {
  for (const input of [-7, 0, 2, 99]) {
    const observed = await context.invoke({
      module: 'src/value.cjs', export: 'total', args: [input]
    });
    context.assert(observed.status === 'returned' && observed.value === input * 2);
  }
  return { passed: true };
};
```

`context.invoke` sends only an input to a trusted worker inside the candidate container. Expected values and grader source never enter that container. It returns the exact typed observation protocol used by differential checks, including application errors; it cannot run arbitrary model-provided shell commands. A thrown host assertion fails independent grading. The private grader is trusted operator code and must not execute candidate application code in the host. Hashes are frozen before the first model call and checked again before grading.

For tests-only tasks, `context.mutation({path,content})` temporarily replaces an original public source file, executes the declared tests through `test_run`, then restores the exact candidate bytes. Actual mutation execution, assertion failures and infrastructure failures are counted by the parent. Mutant rejection requires assertion failures with no test errors or skips. Authoritative `failureKinds` counts cover the full run; without those counts, a truncated or mixed failure preview cannot certify a kill. Complete test-writing evidence requires a passing reference and every required behavioral mutant rejected through supported tools. The frozen grader determines which meaningful mutants are required. `context.runTests()` is also available. Expected-gap grading returns `{passed:true,expectedUnsupported:true}` and must execute at least one independent host assertion; a model must claim `blocked` for that case.

Each case retains exact candidate file deltas (`candidate.patch` uses the versioned `dt-exact-files/v1` JSON format), public inputs, a chained transcript and a host-signed report through `lib/evaluation-evidence.js`. Newly created executable inputs under `node_modules`, nested `build`/`target`, and `.dt` are audited too; only exact runner-generated root report filenames are excluded. Private grader errors and arbitrary return diagnostics are withheld, because exception messages can contain expected values. Returned public verdicts are limited to pass/expected-gap status and the independently counted assertions. Results are limited to the measured pack, target and model. This is not a hostile-code verifier inside the container: candidate code and its test runner share a UID, so operator-authored independent input assertions remain essential. A high completion rate on a small synthetic pack does not certify production or model quality; run a separately authored frozen corpus of at least 30 tasks before assessing the proposed production gates.

`DT_TEST_TASK_EVAL_DOCKER=1 node --test test/task-model-evaluation.test.js` runs the actual isolation and false-success contract check with a scripted endpoint. The default suite checks argument/path/budget contracts and skips Docker execution explicitly.
