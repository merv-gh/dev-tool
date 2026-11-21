# Fast Gradle workspaces: research and integration design

Research date: 2026-11-21. Scope: Java 21, Spring Boot 2.7-era services,
Lombok, short edit/test loops, branch reuse, and observable performance.
This document proposes integration; the production runner is unchanged.

## Measured comparison

The [retained report](benchmarks/gradle-workspace-2026-11-21.json) is a real
Java 21.0.11 / Gradle 8.5 run using the existing Lombok 1.18.42 Quote/QuoteTest,
expanded into two modules with 200 additional Lombok classes and Spring Boot
2.7.18 context tests. Every test invocation executes three tests afresh.

| Scenario | Wall time | Evidence |
| --- | --- | --- |
| Current-style clean/check + separate test, warm median | 9.362 s | Three samples: 9.381, 9.362, 7.703 s |
| Preserved incremental state + one selected test invocation, warm median | 5.681 s | Three samples: 5.596, 5.736, 5.681 s; 1.65× speedup / 39.3% shorter |
| No source changes, tests still execute | 4.851 s | All compilation tasks UP-TO-DATE |
| Fresh checkout, shared local task cache | 5.745 s | Production and test compilation FROM-CACHE |
| Return to baseline source content | 5.044 s | Production compilation FROM-CACHE |
| First build with empty dedicated dependency cache | 60.250 s | Includes downloads, daemon startup and script compilation; excluded from warm comparison |

In the incremental samples, domain compilation took 0.510–0.602 s and consumer
production compilation was avoided. The test task took 3.159–3.291 s, which
includes more than test assertion execution. Thus reducing repeated invocation
and context/dependency startup is at least as important as further compiler
tuning. These measurements do not establish individual JVM/context/GC timings.

All 13 experiment assertions passed. This small, ordered comparison establishes
feasibility and correctness checks; it does not establish a production P95,
cross-platform speedup or improvement against real PostgreSQL/Kafka fixtures.

## Decision

Use the repository's Gradle build and annotation processors as the compiler.
Preserve its warm daemon, incremental state and content-addressed task cache.
Run the selected test set in one Gradle invocation after a batch of edits. Keep
PostgreSQL and Kafka warm outside individual workspace test runs, with private
database/topic leases. Retain fresh test execution and changed-code coverage as
separate requirements from successful compilation or restored cached outputs.

Do not replace this with per-file javac, delombok, a new compilation engine, or
a bespoke cache of arbitrary `.class` chunks. Those would duplicate Gradle's
dependency invalidation and processor lifecycle, including the generated-builder
problem already covered by our regressions. A long-lived custom test JVM might
save more startup time later, but class-loader, Spring-context and state-reset
correctness make it a separate measured experiment.

## Compatibility baseline

| Component | Baseline and policy |
| --- | --- |
| Java | Select a real JDK 21 toolchain for compilation **and tests**; record the daemon JVM separately. Keep UTF-8. |
| Spring Boot | 2.7.18 explicitly supports Java 21 and Gradle 8.x. Earlier 2.7 patches need their own compatibility check. |
| Gradle | Keep a compatible repository wrapper. 8.5 is the first version able to run its daemon on Java 21; 8.4 can use a Java 21 toolchain while its daemon uses an older supported JDK. Do not silently upgrade wrappers or assume Gradle 9 support. |
| Lombok | Java 21 support starts at 1.18.30. Preserve the project's compatible resolved version; the existing fixture uses 1.18.42. Declare processor dependencies explicitly. |
| Spring testing | Use Framework 5.3 APIs such as `@DynamicPropertySource`; no Boot 3 `@ServiceConnection` requirement. |

Sources: [Boot 2.7 system requirements](https://docs.spring.io/spring-boot/docs/2.7.x/reference/html/getting-started.html#before-you-begin-system-requirements),
[Boot 2.7 Gradle plugin](https://docs.spring.io/spring-boot/docs/2.7.18/gradle-plugin/reference/htmlsingle/),
[Gradle 8.5 Java 21 support](https://docs.gradle.org/8.5/release-notes.html),
[Lombok changelog](https://projectlombok.org/changelog).

## Current implementation: concrete costs

| Location | Current behavior | Integration change |
| --- | --- | --- |
| [annotation-build.js](../lib/annotation-build.js), `compile` | A production-source/config/output change schedules module `clean` before `testClasses`. Its Gradle command does not explicitly enable the configured build cache. | Normal edits invoke native incremental compilation without clean. Apply one shared Gradle policy to checks and tests. Explicit clean remains an override/recovery action. |
| [javacheck.js](../lib/javacheck.js), `gradleClasspath` | A separate classpath invocation explicitly disables configuration cache, then processor-aware validation can invoke Gradle again. | Detect the processor-aware path before unnecessary classpath preparation, or retain a compatible typed preparation task. Avoid duplicate invocations. |
| [testrun.js](../lib/testrun.js), `command` | Gradle already stays daemon-backed and defaults to build cache. All Gradle runs force filesystem watching off; no per-task cache/timing report. | Use a common command builder with configurable watching, task events, cache policy and worker limits. |
| [testrun.js](../lib/testrun.js), `runUnlocked` | Writes may trigger compilation before the test task performs its own compilation checks. | Prefer one atomic edit batch followed by a selected Gradle test task. Preserve immediate checks for callers who request them. |
| [workspace-coverage.js](../lib/workspace-coverage.js), `gradleInit` | Coverage already forces fresh tests and one test fork, but writes an init script and output destination inside each coverage session. | Prototype stable coverage integration before enabling configuration cache for that path. Per-run script paths/content can invalidate it. |
| [test-targets.js](../lib/test-targets.js) and [fixture-runtime-bridge.js](../lib/fixture-runtime-bridge.js) | Reviewed targets and owned PG/Kafka bindings exist. The native fixture bridge currently requires local execution. | Reuse these contracts. Remote warm dependencies need runner-reachable bindings and attestation, rather than passing controller localhost to a remote JVM. |

The compile-check identity currently includes a broad source/config/environment
fingerprint. Keep it conservative until Gradle owns invalidation; record why a
check ran. Do not optimize by forgetting `lombok.config`, generated resources,
processor versions, source deletion, toolchain identity or changed internal jars.

## Cache per commit, reuse per task

Commit SHA is provenance and a useful prewarm selector; it is not the sole cache
key. Dirty edits, dependencies, processors, build logic, JDK and relevant inputs
must participate. Gradle already keys cacheable task outputs by their declared
inputs and implementations. Its incremental analysis can also be restored with
compiled task outputs. This provides practical chunks at module/source-set/task
boundaries, with class dependency analysis inside compilation.

| Layer | Reuse boundary | Retention rule |
| --- | --- | --- |
| Dependency artifacts | Runner Gradle home; content/version identity | Durable local volume; avoid repeated downloads or refresh-dependencies on ordinary runs. |
| Daemon/compiler | Compatible Gradle/JDK/JVM settings on a runner | Keep warm; cap aggregate CPU and heap across concurrent workspaces. |
| Incremental state | One workspace's `.gradle/` and `build/` | Preserve across edits and chat continuation. Do not share writable project state between checkouts. |
| Task output cache | Content-addressed outputs across commits/checkouts | Shared runner cache; optionally trusted CI populates a remote read cache. Cache misses remain normal. |
| Commit manifest | Exact repository SHA, dirty-tree/build/toolchain/processor identities | Store preparation/report pointers and observed compatibility. Never use HEAD alone to claim a build is current. |
| PG template / Kafka infrastructure | Compatible versions and fixture/migration identity | Warm servers, immutable templates, private leases and bounded cleanup. |

Prewarm the actual base/default-branch SHA with the same tasks, JDK and profile
used in workspaces. A feature branch can restore unchanged task outputs; an ABI
compatible library body edit can avoid recompiling consumers. A changed library
API still recompiles the necessary consumers. A new checkout should restore
outputs from Gradle's cache rather than copying another checkout's mutable
`.gradle` directory. Pin resolved internal dependencies; a mutable SNAPSHOT or
dynamic version must not be silently treated as immutable.

Important experimental finding: adding `lombok.config` with plain
`inputs.file(...)` makes its path absolute by default and defeats cross-folder
cache hits. The research fixture uses
`inputs.file(...).withPathSensitivity(PathSensitivity.RELATIVE)`. Declare all
processor configuration inputs, then choose the correct normalization. Missing
inputs produce incorrect cache hits; excessive path sensitivity produces misses.

Sources: [Gradle Java compilation and processors](https://docs.gradle.org/current/userguide/java_plugin.html#sec:incremental_annotation_processing),
[task output caching](https://docs.gradle.org/current/userguide/build_cache.html),
[Java cache behavior](https://docs.gradle.org/current/userguide/caching_java_projects.html),
[cache diagnostics](https://docs.gradle.org/current/userguide/build_cache_debugging.html).
The research prototype verifies the selected behavior on Gradle 8.5 itself;
newer-only features from the current manual are not assumed.

## Same integration tests, two dependency providers

Use a small explicit provider contract in each participating project's test
support. Both providers supply JDBC URLs/credentials, Kafka bootstrap servers,
topic names, consumer groups and any additional datasource bindings to the same
test assertions through `@DynamicPropertySource` or the project's existing
initializer. Property names and active profiles must be configurable.

| Provider | Behavior |
| --- | --- |
| `containers` | CI/default: Testcontainers owns fresh dependencies, preferably once per test JVM for the selected suite. Images can be pre-pulled. Keep normal lifecycle cleanup. |
| `workspace` | Explicit local profile: resolve an owned warm lease, clone a private PG database from a compatible immutable template, allocate private Kafka topics/groups, then bind the supplied endpoints. Missing bindings fail clearly. |

A Spring profile alone cannot prevent an unconditional static `@Container` or
`jdbc:tc:` URL from starting Docker. The provider must choose the mode **before**
creating containers or registering dynamic properties. Do not “skip all
Testcontainers tests” and call that equivalent coverage. A project with fixed
external names may need serialized tests or a dedicated dependency instance
until its names are parameterized.

Our `envFor` supplies `CI=true` by default even for workspace builds. Select the
provider using an explicit parameter such as `DT_TEST_INFRA`, not `CI` alone.
Record and allow a reviewed profile to override that CI flag as well: project
build logic may use it to change daemon, cache or test behavior.

For Postgres, reuse [our template/lease tooling](postgres-templates.md), checking
migration/fixture hashes, PG major, collation and extensions. Run migrations on
the private clone, with migration time measured separately. Rebuild the template
when inputs change. For Kafka, isolate topic names, consumer groups and
transactional IDs; handle admin readiness and cleanup. A shared topic with only
a different consumer group is not adequate write isolation. Use additional
bindings for projects with several databases.

Start with one test fork and `forkEvery=0` for Spring integration tests; batch
classes sharing the same context. More forks can increase context and dependency
startup costs. Spring's context cache is process-local: a warm Gradle daemon
does **not** preserve a test application's Spring context across separate test
invocations. Reduce unnecessary `@DirtiesContext` and differing mock/property
configurations only where semantics permit. Independent unit tests can use a
separate, more parallel profile.

Testcontainers' experimental reusable-container mode is not the CI foundation;
its own documentation says it is unsuitable for CI. Prefer an explicit warm
workspace service pool and ordinary container-backed CI tests.

Sources: [Framework 5.3 dynamic properties and context cache](https://docs.spring.io/spring-framework/docs/5.3.31/reference/html/testing.html),
[Testcontainers singleton lifecycle](https://java.testcontainers.org/test_framework_integration/manual_lifecycle_control/),
[experimental reuse limitations](https://java.testcontainers.org/features/reuse/).

## Observable build contract

Each invocation should retain a versioned report linked to the tool call, task,
workspace, source-tree identity, runner, dependency lease and existing OTel trace.
Return a compact summary and report/view link to the model; retain detail outside
the model's working context.

| Evidence | Required report fields |
| --- | --- |
| Effective policy | Values **and their origins**, requested and actual JDK/Gradle/processor versions, tasks/selectors, profile/revision, override/fallback reasons. |
| End-to-end | Queue, preparation, lease/readiness, Gradle invocation, report parsing, coverage, cleanup and total wall time. |
| Gradle tasks | Start/end/duration; executed, incremental, UP-TO-DATE, FROM-CACHE, skipped or failed; bounded execution reasons with a truncation flag. |
| Compilation | Processor identities, generated-output recovery, observed recompile notes, affected count only when measured. A changed-file count is not the compiled-class count. |
| Test runtime | Fresh test count/results, fork count, JVM startup/context/cache diagnostics when instrumented; dependency creation versus reuse. |
| Resource diagnostics | Available CPU/memory and applied budgets; optional sampled process/daemon RSS, CPU, GC/JFR. Unknown is explicit rather than inferred from wall time. |
| Failures | Compiler/test/configuration-cache failures, timeout/cancel, partial task events, cleanup errors, missing evidence and exact fallback. |
| Comparison | Same workload/profile/toolchain identifiers, cold versus warm state, sample count, median and distributions with adequate samples; avoid adding parallel task times as wall time. |

The prototype uses a `BuildService` implementing `OperationCompletionListener`,
registered through `BuildEventsListenerRegistry`, rather than `afterTask` or
`buildFinished` callbacks that interfere with configuration cache. The output
location is stable and run identity is attached by the caller. Trace IDs, report
filenames and changing telemetry scripts must not become compilation inputs or
invalidate configuration on every request.

Public task events provide task times/cache states/execution reasons; they do
not provide an exact configuration/GC/context breakdown. Add lifecycle profiling
or [Gradle Profiler](https://github.com/gradle/gradle-profiler) with JFR for deeper
measurements, recording observer overhead separately. External build-scan upload
is optional. Keep endpoint credentials and SQL payloads out of telemetry.

Sources: [configuration-cache-compatible listeners](https://docs.gradle.org/current/userguide/configuration_cache_requirements.html),
[task execution result API](https://docs.gradle.org/current/javadoc/org/gradle/tooling/events/task/TaskExecutionResult.html).

## Overrides: policy rather than rigid behavior

Resolution order should be: shipped defaults → operator configuration → named
repository/service profile → workspace override → invocation override. Record
the resolved values and sources, not just the selected profile name. Reject
contradictory flags or unsupported settings explicitly. Administrator resource
ceilings, ownership and publication proof requirements remain enforced.

| Parameter | Initial default | Override behavior |
| --- | --- | --- |
| Build strategy | Native Gradle incremental | `native`, `clean`, or inspect/prepare only; immediate/deferred write checks remain explicit. |
| Build cache | On for compilation | On/off; local/shared/remote policy configured per runner; report hits/misses. |
| Configuration cache | Enable after a successful compatibility probe | `auto`, `on`, `off`; auto records and remembers incompatibility by build/profile identity. Do not hide a failed real build behind a fallback. |
| Filesystem watching | Auto for supported local volumes | On/off/auto; no permanent global forced-off policy. |
| JDK / daemon JVM / JVM args | Repository-supported JDK 21 profile | Separate values, checked against wrapper support; no source upgrade. |
| Workers / test forks / forkEvery | Bounded workers; 1 integration fork; no per-class fork | Per profile/call within runner limits; unit and integration settings can differ. |
| Tasks / modules / test selectors | Exact selected task and tests | Custom source-set/task mappings; no assumption that every integration test is named `test`. |
| Test execution | Fresh for requested integration verification | Cached results explicitly labeled; never count as a new external-state check or fresh coverage. |
| Dependencies | Container-backed default, explicit owned workspace leases | Endpoint/property/profile mappings, images, versions, seed/template, several DBs, topic rules, readiness/TTL/cleanup policy. |
| Coverage | Existing requested changed-code mode | Off/on and include/exclude scope; required publication coverage cannot be bypassed by an override. |
| Diagnostics | Compact report + task events | Off/summary/tasks/diagnostic/JFR; report gaps and retention limits. |
| Timeout / retry / fallback | Bounded, no silent mutation replay | Separate prepare/compile/test/dependency deadlines; explicit fallback policy. |

Keep existing `test_run`, `test_targets` and owned fixture/testdb contracts.
Extend `test_run` with a named build/dependency profile and bounded overrides;
return effective settings and a retained build-report link. A small profile
inspect/save/preview operation and report read/compare operation are sufficient;
avoid dozens of one-flag tools. Model guidance should prefer:

1. Inspect the project profile, wrapper/JDK compatibility and available leases.
2. Batch related source/test edits; use deferred checks only when explicitly
   planning the next compiling test run.
3. Run a selected outside-in regression against the owned workspace provider.
4. Inspect the report's bottleneck/failure/cache reason and change an override
   when justified; retain the reproduction/profile in task memory.
5. Run the container-backed CI profile and required coverage before publication.

## Integration order and acceptance

1. **Preserve correctness, remove discarded work.** Consolidate command policy;
   remove automatic Gradle clean on ordinary edits, honor build cache in checks,
   batch edit/check/test work. Verify builder/API edits, deletion, missing output,
   processor-config changes and failures against a clean build.
2. **Add reports and configuration-cache probing.** Introduce stable listener
   integration and named overridable profiles. Make classpath and coverage helpers
   compatible or explicitly opt those paths out. Test both warm reuse and policy
   changes, timeout/cancel and partial reports.
3. **Join warm dependencies to the same tests.** Add the project provider adapter
   and owned local/runner-reachable leases; compare actual PG/Kafka effects
   against CI Testcontainers. Verify concurrent workspace isolation and cleanup.
4. **Prewarm and tune with evidence.** Add commit/profile manifests and optional
   CI-populated remote cache, then benchmark representative services with warmups
   and enough repetitions. Tune resource caps before adding persistent test JVMs.

No speed threshold is claimed for arbitrary services. Required acceptance is
equivalent tests/coverage to a clean container-backed run, correct invalidation,
no stale or cached “fresh” result, stable scope isolation, and an attributable
report for every failure or optimization decision.

## Reproduce the current experiment

The [benchmark](../dev/benchmark-gradle-workspace.js) derives Quote/QuoteTest from
the existing [Lombok fixture](../test/fixtures/lombok-service), adds 200 independent
Lombok classes and a consumer module with three Spring-context tests, and runs
everything in disposable storage. It never edits a real workspace. Gradle and
the JDK are supplied explicitly; it does not download/upgrade either tool.

```sh
node dev/benchmark-gradle-workspace.js --help
node dev/benchmark-gradle-workspace.js \
  --gradle "$DT_TEST_GRADLE" --java-home "$JAVA_HOME" \
  --iterations 3 --classes 200 --workers 2 \
  --out work/bench/gradle-workspace.json
```

The baseline models the current consumer-module `clean testClasses` check plus
a separate selected test invocation with configuration cache disabled. The
incremental candidate uses one native selected test invocation, build cache,
configuration cache and preserved outputs. Library body edits avoid consumer
compilation in the candidate. This is a comparison of complete workflows; it
does not attribute all improvement to compiler speed alone. Earlier setup and
dependency downloads are separate from warm comparisons. Measurements are
sequential exploratory samples, not randomized production benchmarks.

The report contains every task event, bounded miss reasons, actual test counts,
source digests, applied parameters and full sanitized logs beside it. Assertions
exercise context reuse within a test JVM, fresh test execution, generated builder
changes, source deletion, missing generated output, `lombok.config` invalidation,
fresh-checkout task-cache restoration and returning to baseline source content.
This initial compiler experiment did not measure dependency providers. The
follow-up [multi-container benchmark](testcontainers-workspace-performance.md)
compares real HTTP → multiple PostgreSQL databases → Kafka paths across four
dependency lifetimes, with private warm leases and cleanup checks.
