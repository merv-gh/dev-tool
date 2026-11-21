# Adapting integration tests to dependency leases

Use `tool_search` for “Testcontainers warm dependency leases”, then
`workflow_plan {"id":"test-dependency-leases"}`. The guide is also discoverable
with `group:"code"`. `test_context` links it from `integrationPlan.dependencies`.
It is planning guidance, not a new test runner profile or proof that a test ran.
For a small model doing the edits, `tools.profile:"workspace-tests"` exposes eleven
focused discovery, reading, writing and testing functions without the full menu.

## Preserve the test, change its dependency provider

Keep the same HTTP/listener/job entry and independent database/broker assertions.
Change the test support that acquires dependencies and binds application
properties. Do not replace PostgreSQL/Kafka with mocks to make tests faster.
Read the actual repository helper, build file and datasource properties first.

| Concern | Container-backed CI | Owned warm workspace |
| --- | --- | --- |
| Selection | Default repository provider; fresh owned servers, preferably once per test JVM | Explicit provider configuration and validated bindings, selected before any container construction |
| Database | Private server/database with the required schema | Private database clones from the compatible template, one per logical datasource |
| Kafka | Actual bootstrap address and isolated topic/group names | Caller-owned warm broker; private topics/groups/transactional IDs |
| Spring | Bind properties before context creation; share compatible context within the JVM | Same ordering; keep that context's bindings stable until it closes |
| Cleanup | Close clients/context, then release owned resources | Close clients/context, release owned child leases, retain the caller's parent pool |

Missing or mismatched workspace bindings must fail before Docker/network work.
Do not silently fall back to containers or infer the provider solely from `CI`:
the current runner also sets `CI=true` for local builds. A Spring profile alone
does not disable unconditional static containers, `@Container` fields or
`jdbc:tc:` URLs.

## Runnable reference in this repository

The [reference test](../test/fixtures/multi-containers/src/test/java/demo/FlowTest.java)
and [provider helper](../test/fixtures/multi-containers/src/test/java/demo/MultiContainerSupport.java)
demonstrate Java 21 / Spring Boot 2.7-compatible wiring. These are fixture APIs,
not methods to assume exist in another service:

- `MultiContainerSupport.acquire(testClass)` already selects the configured
  provider, validates workspace ownership and allocates private children, or
  starts CI dependencies. Call it before Spring dynamic properties in either
  mode. Do not parse the private pool JSON again or create a second allocator.
- `current` holds the resulting `Binding`. `Binding.pg` is `List<Pg>`; every
  `Pg` has `url()`, `user()` and `password()` accessors. `bootstrap` and `topic`
  are the actual leased Kafka values. Bind every datasource under the property
  prefix the application reads; do not assume the primary datasource is enough.
- `Config` is a Java record: use accessors such as `mode()` and `classes()`;
  `perClass()` describes its lifecycle. Do not overwrite the supplied mode.
- Register `closeContext` so the existing shutdown hook closes Spring clients
  before `release()`. Increment `completed` after each class; release immediately
  for per-class mode or at the last selected class. Keep the shutdown hook:
  additional test JVMs may each execute fewer than the globally selected classes.
- `release()` releases the helper's child databases/topics and CI containers.
  The external warm pool remains owned by its caller. Propagate cleanup errors.

In `@DynamicPropertySource`, capture a stable local datasource/property prefix
for each loop iteration; Java lambdas cannot capture a changing loop counter.
The broker topic must come from the binding, rather than a shared literal such
as `quotes` or a name reconstructed from the owner ID.

## Existing production tool contracts

Keep these handoffs distinct:

1. `testdb_clone` returns a Postgres template lease and its logical datasource
   bindings. Its caller owns `testdb_release`. See
   [Postgres templates](postgres-templates.md).
2. `fixture_runtime_start` creates an owned native fixture runtime.
   `test_run` accepts its ID as `fixture_runtime`, plus an exact map such as
   `fixture_bindings:{orders:"ORDERS_DATASOURCE",billing:"BILLING_DATASOURCE"}`.
   The runner supplies each prefix's `_URL`, `_USERNAME`, `_PASSWORD`, Kafka's
   `SPRING_KAFKA_BOOTSTRAP_SERVERS`, and the validated
   `DT_NATIVE_FIXTURE_BINDINGS` JSON. The caller retains arm/check/stop ownership.
   The current bridge requires local execution; a controller's localhost is not
   a remote runner's localhost.
3. The benchmark's `.dt/multi-container.json` and pool binding file are a
   **separate test-support prototype**. Production `test_run` does not create
   these automatically or expose a generic `workspace` provider selector.

Never interchange IDs or take parent ownership merely because an endpoint is
reachable. Keep credentials and ephemeral URLs out of source, model context,
retained reports and commits.

## Verify the migration

Run the unchanged selected tests afresh in both configurations. Verify actual
HTTP responses, every database effect and Kafka records. Then inspect dependency
telemetry: workspace mode starts no new dependency containers; repeated runs
receive clean private leases; two JVMs get distinct database/topic identities;
closing a class does not invalidate another class's cached Spring context.
Finally verify that child resources were released and the parent remained alive.

The [multi-container benchmark](testcontainers-workspace-performance.md) performs
these checks and reports pool setup separately from warm test time. Compiler
errors retain missing-symbol/type details and workspace-relative source snippets
so the model can repair actual errors rather than guess imports.

The opt-in [model evaluation](../dev/eval-test-leases-model.js) gives a local
model a deliberately outdated adapter through real discovery/workspace/test
tools. Only the adapter is editable; protected assertions and an independent
live Gradle/Docker comparison grade the candidate. Three additional
[Docker-free lifecycle checks](../test/fixtures/test-lease-model/LeaseLifecycleTest.java)
run beside the three flow tests, so the model sees context-reuse, provider-selection
and fork-shutdown failures in ordinary `test_run` feedback. `--profile workspace` exposes
the shipped `workspace-tests` tool profile directly; `--profile discovery` uses
the shipped `lean` profile. Record these separately: success with one profile
does not establish success with the other. Qwen reasoning is enabled by default;
`--think false` selects a separate non-thinking trial. `--context-window` defaults
to 32768 for this bounded fixture, and `--max-tokens` to 6000. Both are overridable,
alongside turn/call/context-byte budgets and per-request/whole-run deadlines.

```sh
node dev/eval-test-leases-model.js \
  --endpoint "$DT_EVAL_ENDPOINT" --model "$DT_EVAL_MODEL" \
  --profile workspace --gradle "$DT_TEST_GRADLE" --java-home "$JAVA_HOME" \
  --output work/test-leases-model/evaluation.json
```

For an explicitly selected LAN endpoint, add `--allow-remote`. Only synthetic
repository files, tool schemas and fixture results are sent. Model name/digest,
source hashes, actual tool calls, errors, candidate code and independent results
are retained. This is an opt-in evaluation, not background model traffic.

To retry a graded candidate, add `--resume` with its evaluation JSON and choose
a different `--output`. The new workspace starts from the model's candidate and
receives its measured independent verdict. The previous report remains intact;
the retry records its hash. Failed attempts and successful functional tests are
kept distinct from a full lifecycle pass.

## Local model findings, 2026-11-21

The [retained evaluation](benchmarks/test-leases-model-2026-11-21.json) did **not**
establish a successful autonomous migration. The non-thinking 27B candidate
passed all three real HTTP/database/Kafka tests, but its independent run created
three Spring contexts instead of one. It also omitted the shutdown callback.
The [independent failure report](benchmarks/test-leases-model-lifetime-failure-2026-11-21.json)
keeps that functional pass separate from the failed lifetime check.

The 4B candidate still bound only one database and missed cleanup. The new
six-test run exposed those mistakes through normal `test_run` feedback. A
separate 27B discovery trial found the guide, then timed out; a retry stalled
on repeated reads. These were exploratory runs with changing harness revisions,
not a model ranking or a controlled before/after comparison. Early harness
protocol/preflight defects are excluded from model capability conclusions.
An additional CPU-only local 9B trial was stopped for latency after roughly
fourteen minutes; it is inconclusive, with its owned containers cleaned up.

The final compact profile adds direct `code_search` access, and evaluations stop
after three identical tool errors (`--max-repeats` overrides that bound).
Those improvements have schema/regression checks; they have not demonstrated a
successful model migration. The working reference passed all three Docker-free
lifecycle checks, and the separate multi-container benchmarks passed both
providers. Keep both kinds of checks when adapting a real service; a model's
final explanation and passing functional assertions alone are insufficient.
