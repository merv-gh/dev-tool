# Test execution and differential checks

`test_run` accepts explicit Node `.js`, `.cjs` and `.mjs` file paths using the built-in reviewed `node:test` profile, in addition to the existing JVM selectors. Request arguments cannot select shell commands or Node flags. Results come from a reviewed structured node:test event reporter with source-file identity on Node 22 and later. Console formatting cannot turn a run green. Empty file wrappers, suites, and skip-only nested parents cannot pass. Raw assertion provenance is retained separately from abbreviated display text. JVM skip-only runs also fail. Processes own a process group so deadlines and job cancellation stop descendants. The test view and per-test red/green history work for both runners; source fingerprints hash contents, including Node sources, rather than trusting mtimes.

This profile executes project code with a cleaned environment. It does not restrict host filesystem or network access. Use the isolated scenario/container profile or an isolated runner host when that isolation is needed.

`test_targets {}` lists reviewed execution targets. `test_run {workspace, tests, target:"..."}` selects the actual runner/dependency target. `env` remains source-catalog provenance for DDL capture; it never means that tests execute against a deployed service. Every result carries actual runner placement, target kind, manifest digest, declared dependency environment/access, revision and effects. The manifest describes deployment intent; it is not a runtime deployment/read attestation.

Operator `config.json` example:

```json
{
  "tests": {
    "targets": {
      "captured": {"reviewed":true,"kind":"captured-dev","environment":"dev","effects":"scratch"},
      "dev-readonly": {
        "reviewed":true,"kind":"live-dev","allowLive":true,
        "runnerUrl":"https://reviewed-runner.example","runnerToken":"${DEV_RUNNER_TOKEN}",
        "environment":"dev","deployment":{"service":"orders","revision":"deployed-sha"},
        "dependencies":[{"id":"orders","kind":"postgres","environment":"dev","access":"read-only"}],
        "effects":"read-only","env":{"ORDERS_URL":"${DEV_TEST_READONLY_URL}"}
      }
    }
  }
}
```

Captured targets require `fixture_path`. Live targets require all declarations, cannot substitute scratch fixtures/DDL and never fall back to local execution if their configured runner is down. Dependency bindings are operator-reviewed environment values, never model-provided shell arguments. Configure the runner's Node executable path as `tests.node` when it differs from the host. Concurrent requests hash all arguments, configuration and exact workspace file contents. Different requests cannot join the same job; simultaneous executions that would mutate the same workspace fail with a clear conflict, so parallel runs use separate workspaces.

`differential_check` executes identical declared `{id,args}` cases against separate baseline/candidate workspace snapshots. It requires an operator-reviewed `tests.differentialProfiles` entry:

```json
{"projection":{"reviewed":true,"kind":"node-module","module":"src/projection.cjs","export":"load","observeFiles":["result.json"],"observers":[{"id":"orders","kind":"postgres","db":"orders","query":"select tenant_id::text,id::text,status,amount::text from sales.orders order by tenant_id,id"}]}}
```

Call with `profile`, `baseline`, `candidate`, and `inputs`. Optional `baseline_target`/`candidate_target` select separate reviewed local dependency bindings; the database observer uses each target's environment unless its query explicitly names an environment. Restore equivalent isolated dependencies before comparing stateful cases. The parent observes configured files and executes database observations in read-only transactions, independently of application return values. This adapter is local-only and fails closed for remote target profiles.

The worker preserves string decimals/large IDs, undefined, bigint, negative zero/nonfinite numbers, dates, maps, sets, bytes, object prototypes, nulls and array order. Errors compare name/message/code. No implicit sorting, rounding or null coercion occurs. A normalizer such as `{"kind":"omit","path":["generatedAt"],"reason":"reviewed clock field"}` may omit only declared return-value fields; errors and effects remain exact. Configured normalizers are included in the profile digest and result. Results include source/module/profile/input digests, case observations and an interactive baseline/candidate JSON view.

Proof covers declared inputs and independently configured file/database snapshots. It does not prove exhaustive runtime reads, distributed snapshot atomicity, network effects or universal semantic equivalence. No actual customer dev runner or 27B model endpoint was available for verification. `dev/verify-node-challenges.js` reruns all seven frozen Node challenge submissions through `tool_execute → test_run`, using `DT_TEST_PG_URL` for C06's owned disposable two-database fixture. Recorded rerun evidence is in `docs/evidence/node-challenge-rerun.json`.

`test_run.fixture_runtime` binds an existing owned native dependency lease directly to project tests. Choose it instead of `db`, `ddl_path`, `fixture_path` or `fixture_template`. Only `local` or `captured-dev` targets executing on this host are accepted; remote runners and live targets fail before file writes. The native adapter revalidates lease/workspace ownership, fixture/profile digests and pinned container images. Every PG datasource uses the same explicit `fixture_bindings` contract as SQL replay. ES and Kafka set `SPRING_ELASTICSEARCH_URIS` and `SPRING_KAFKA_BOOTSTRAP_SERVERS`. Node projects receive the versioned `DT_NATIVE_FIXTURE_BINDINGS` JSON with all datasource credentials, endpoints and Kafka offset mappings. These values come from the owned adapter, never arbitrary request environment fields, and credentials are included in report/history/log masking.

The caller owns the complete lifecycle: start, arm exact expectations, `test_run {fixture_runtime:id,...}`, independent `fixture_runtime_check`, then stop. Test execution retains the lease for those separate checks. Execution evidence records native fixture/profile digests, pinned image proof, source-to-replay offset mappings and `effectsVerified:false`; a green project test does not certify application actions or effects. `failureKinds:{assertions,testErrors}` counts all failed cases before redaction and compact failure previews, so truncated output cannot disguise a runtime error as a behavioral regression.

`DT_TEST_NATIVE_BRIDGE=1 node --test test/fixture-runtime-bridge.test.js` verifies an actual owned PostgreSQL replay → project Node test → independent expected SQL effect → retained lease → cleanup sequence. Its other cases execute real Node tests using an injected native binding provider to verify PG/ES/Kafka environment mapping, identity rejection, masking and authoritative assertion/error counts without native startup.
