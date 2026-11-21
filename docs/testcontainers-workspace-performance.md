# Multi-container workspace testing

The [executable fixture](../test/fixtures/multi-containers/README.md) extends the
[Gradle workspace experiment](gradle-workspace-performance.md) with real HTTP,
two independent PostgreSQL servers and Kafka. This is a measured test-support
prototype; it does not change production `test_run` behavior or rewrite service
repositories.

For adapting existing service tests, use the
[model and developer migration guide](test-lease-adapters.md) and its discoverable
`test-dependency-leases` workflow.

## Measured comparison

The [completed local report](benchmarks/testcontainers-2026-11-21.json) uses
Gradle 8.5, Java 21.0.11, Spring Boot 2.7.18, Lombok 1.18.42 and Testcontainers
1.20.4 on an Intel Mac with Docker Desktop. Each mode has one excluded warmup
and three measured invocations. Every invocation executes all three integration
tests afresh; production/test compilation stays `UP-TO-DATE` throughout the
measured runs.

| Mode | Warm median | Three samples, seconds | Dependency starts / Spring contexts per invocation |
| --- | ---: | --- | ---: |
| Per-class sequential | 62.454 s | 55.653, 63.191, 62.454 | 9 / 3 |
| Per-class bounded parallel | 51.080 s | 51.080, 50.517, 52.585 | 9 / 3 |
| Shared within one test JVM | 24.029 s | 21.964, 24.579, 24.029 | 3 / 1 |
| Owned warm pool, private leases | 8.380 s | 8.088, 8.380, 8.888 | 0 / 1 |

Parallel startup alone shortened the median by 18.2%. Sharing compatible
dependencies/context within a test JVM shortened it by 61.5% against the
sequential per-class layout. The warm provider was 65.1% shorter than the
already-shared JVM layout, or 86.6% shorter than the sequential baseline.

Dependency-set startup accounts for a median 44.914 s in the baseline and
11.964 s in the shared-JVM layout. The warm path instead spends a median
0.524 s cloning both databases; Spring refresh still takes 1.927 s. This fixture
points to dependency lifetime as the principal bottleneck, rather than repeated
compilation or the actual HTTP/database/Kafka assertions.

Pool startup costs **15.534 s**, reported separately; its three container-stop
operations total another **1.570 s**. Combining these with the warm median gives
a one-run estimate of 25.484 s, before remaining driver/process-shutdown
overhead. Fresh shared-JVM tests are competitive for a single run; the warm
provider is useful when setup is amortized over repeated runs.

All **106 lifecycle/correctness assertions** passed, with **48 fresh integration
test executions** across samples and warmups. Private databases and topics were
released after each lease, and the final Docker owner-label check found no
remaining dependency containers. The measurements are ordered exploratory
samples on one host, not a production speed guarantee.

The separate [two-fork verification](benchmarks/testcontainers-forks-2026-11-21.json)
also passed all 16 assertions and six fresh integration tests. Two actual JVMs
created two Spring contexts and six dependency containers in suite mode. In
workspace mode they started no new containers, used distinct topics and four
private database clones, and released all four databases. Both final owner-label
checks found no remaining dependency containers.

## What it verifies

Three test classes run the same outside-in path: POST a quote to a real Spring
Boot server, build the result through the existing Lombok fixture, write it to
every configured database and produce a Kafka record. Each test independently
checks the response, the rows in every database and its own Kafka record.
Requested tests always execute afresh, including when compilation is cached.

| Comparison | What changes |
| --- | --- |
| Per-class sequential → per-class parallel | Only independent dependency startup is parallelized; each class still creates new servers and a Spring context. |
| Per-class parallel → suite parallel | Dependencies and the compatible Spring context are shared within one test JVM. |
| Suite parallel → workspace | Container startup moves to an explicitly owned pool outside test runs. Each test JVM leases private database clones and a Kafka topic. |

The baseline models an expensive per-class test layout. It is not a claim that
every service currently uses that layout. If a service already shares its
containers and context, compare against `suite-parallel`. Retain the whole
comparison rather than attributing all improvement to parallel startup.

Spring's context cache lives in the test process. A Gradle daemon does not keep
the tested application alive between separate invocations. Extra test forks
can multiply container, context and connection costs. Start with one integration
test fork, share only genuinely compatible contexts, and measure additional
parallelism. Unit tests can have a different policy.

Sources: [Spring Framework 5.3 test context lifecycle](https://docs.spring.io/spring-framework/docs/5.3.31/reference/html/testing.html),
[Testcontainers singleton lifecycle](https://java.testcontainers.org/test_framework_integration/manual_lifecycle_control/),
[Kafka container modules](https://java.testcontainers.org/modules/kafka/).

The default is the standard JVM image `apache/kafka:3.8.0`. An earlier local
trial of `apache/kafka-native:3.8.0` intermittently exited with code 99 and a
GraalVM segmentation fault during startup (`OOMKilled=false`). That failed
trial was excluded from successful comparisons; its
[failure evidence](benchmarks/testcontainers-native-failure-2026-11-21.json)
is retained. The native image is still an
explicit image override; the driver does not silently retry with another image.

## Ownership and cleanup

The benchmark starts its own warm pool. It never guesses an environment database
from a URL or uses an existing shared application topic. Every server carries a
random benchmark owner label. A workspace binding must explicitly name that
owner and the expected number of databases; missing or mismatched bindings fail
before network work, without a fallback to starting containers.

Each test JVM creates private databases from untouched templates and a distinct
Kafka topic. Clone administration connects to a maintenance database rather
than holding an application/template connection open. New leases are checked
for empty observations. After the application context closes, cleanup removes
the exact topic, terminates connections only to the exact leased databases,
and drops those databases. It then stops only owned containers. The driver also
checks for leftover containers bearing its owner label; a lifecycle leak fails
verification even if recovery removes the leftovers.

Parallel start jobs finish before compensation begins. A failing start cannot
return early while a sibling continues creating a container behind cleanup.
The telemetry append lock is separate from the lifecycle lock, with file locking
between test JVMs. Policy tests cover bounded startup, failed-start draining,
nonblocking telemetry, explicit provider configuration and binding ownership.
All lifecycle failures remain visible in the report.

Later model-evaluation setup exposed a Testcontainers 1.20.4 Kafka starter race:
the container could execute the script before Docker finished uploading it,
returning `Text file busy` (exit 126). The current fixture waits for a separate
readiness marker written after that upload completes. Earlier timing reports
retain their original fixture hashes; subsequent evaluation reports describe
the updated fixture.

These private databases/topics are an isolation prototype, not a general lease
service. Production integration should reuse the existing
[Postgres template tooling](postgres-templates.md), fixture bindings and runner
ownership contracts. It needs template/migration identity, supported versions,
extensions/collations, TTL/recovery, resource limits and reachable endpoints.
Kafka adapters must parameterize consumer groups and transactional IDs as well
as topics. Tests with fixed external names may need dedicated instances.

Do not make Testcontainers' experimental reusable-container flag the CI
foundation. Its own documentation excludes that use. Keep the default CI
provider container-backed; choose an owned workspace provider explicitly before
creating any containers or dynamic properties. A Spring profile alone cannot
disable an unconditional static `@Container` or `jdbc:tc:` URL.
[Testcontainers reuse limitations](https://java.testcontainers.org/features/reuse/).

## Reproduce and tune

Use a running Docker engine, Java 21 and a compatible Gradle 8 executable. The
benchmark neither upgrades the wrapper nor downloads a JDK/Gradle distribution.
By default it uses an isolated temporary Gradle home, downloading dependencies
as necessary. To measure against an existing warm cache, pass an explicit home;
the benchmark will not stop a daemon belonging to that shared home.

```sh
node dev/benchmark-testcontainers.js --plan
node dev/benchmark-testcontainers.js --compile-only \
  --gradle "$DT_TEST_GRADLE" --java-home "$JAVA_HOME"
node dev/benchmark-testcontainers.js \
  --gradle "$DT_TEST_GRADLE" --java-home "$JAVA_HOME" \
  --iterations 3 --warmups 1 --databases 2 --parallelism 3 \
  --workers 2 --test-forks 1 \
  --out work/bench/testcontainers.json
```

| Parameter | Default | Purpose |
| --- | --- | --- |
| `--scenarios` | All four modes | Compare lifetimes independently, or rerun one case. |
| `--databases` | 2; range 1–4 | Independent Postgres dependencies, all checked by every test. |
| `--parallelism` | 3; range 1–8 | Bounded container startup concurrency. |
| `--test-classes` | All three fixture classes | Exact comma-separated fixture class names. |
| `--test-forks` / `--workers` | 1 / 2 | Test JVM and Gradle concurrency ceilings. |
| `--iterations` / `--warmups` | 3 / 1 per mode | Retained warm samples and excluded warmup runs. |
| `--gradle` / `--java-home` | Explicit arguments or `DT_TEST_GRADLE` / `JAVA_HOME` | Select actual build tools. |
| `--gradle-user-home` | Disposable owned directory | Opt into a prewarmed dependency/task cache. |
| `--postgres-image` / `--kafka-image` | `postgres:16-alpine` / `apache/kafka:3.8.0` | Explicit compatible container images; resolved IDs/digests retained. |
| `--boot-version` / `--lombok-version` / `--testcontainers-version` | 2.7.18 / 1.18.42 / 1.20.4 | Override resolved library versions without editing the fixture. |
| `--timeout-seconds` | 180 | Dependency startup/topic readiness bound. |
| `--command-timeout-ms` | 900000 | Whole command/pool-readiness deadline; command timeout recorded. |
| `--docker-host` | Current Docker context endpoint | Unix or TCP/TLS endpoint; an SSH CLI context needs a reachable runner/tunnel. |
| `--pull` | `missing` | `missing`, `never`, `always`; image preparation stays outside warm samples. |
| `--out` / `--keep` | Ignored local report / remove disposable workspace | Retain evidence and optionally inspect generated build files. |

For fork behavior, repeat `suite-parallel,workspace` with `--test-forks 2` and
inspect actual process/context/lease counts. A maximum of two forks does not
guarantee that every Gradle workload uses two processes. More forks are not
assumed to improve wall time.

The [deep-verification workflow](../.github/workflows/deep-verification.yml)
runs one fresh sample of all modes and an additional two-fork suite/workspace
check, retaining reports and sanitized logs. It checks correctness and lifecycle
counts, without a machine-dependent speed threshold. Hosted CI remains separate
evidence from the local measurements.

## Reading the report

The versioned JSON retains effective parameters, actual Java/Gradle and Docker
versions, resolved image identities, fixture source hashes, warmups, measured
runs, assertions and cleanup status. Sanitized command logs live beside it.

Each run has Gradle-command wall time, actual JUnit counts, Gradle task outcomes and
versioned dependency events. Events distinguish container startup/stop, set
startup wall time, template initialization, clone/drop, topic create/delete,
Spring context refresh, HTTP, database verification and Kafka verification.
Durations aggregated across parallel operations are labeled `sumMs`; they are
not end-to-end wall time. Context timing starts at the Spring initializer and
ends at its refresh event, not at test JVM process creation.
The command timer includes launching Gradle and retaining its output; driver
report parsing and assertion persistence happen afterwards. The benchmark is
not yet a production tool-call/queue/OTel timing integration. Use recorded image
digests as overrides when reproducing an exact container version.

Configured Postgres/Kafka image pulls, initial compilation, warm-pool startup, warmups and final pool
shutdown are outside the reported warm invocation median and remain visible.
Container counts refer to Postgres/Kafka start calls. Container-backed test JVMs
also initialize Testcontainers and its Ryuk cleanup helper; that cost remains
inside their invocation time. A first helper-image pull can occur in the first
warmup, or the first sample when warmups are disabled. A workspace test JVM
does not initialize Docker; the separate pool owns its Testcontainers lifecycle.
For a single isolated run, add pool startup and final shutdown to assess the
complete cost; a warm provider is intended to amortize these across many runs.
Every invocation still pays a new test JVM and Spring startup. Failed commands
retain partial measurements and are never included as successful samples.

The fixture does not measure a distributed transaction, production consumer
group processing, a remote runner, migrations, representative data volume or
large-service context startup. Three ordered samples are exploratory evidence,
not a production percentile or a universal speedup. Preserve service-specific
assertions, run container-backed CI and changed-code coverage before publication.
