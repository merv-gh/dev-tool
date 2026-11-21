# Multiple dependencies, one real integration path

This disposable research fixture compares four dependency lifetimes. It is not
installed into real service repositories or the production workspace runner.

The same three Spring Boot 2.7.18 / Java 21 tests send HTTP to a real random-port
server. The handler uses the existing Lombok `Quote` builder, writes the result
to **every configured Postgres database**, and produces a Kafka record. Tests
independently query each database and read that specific record. Kafka is real;
the observer assigns the single topic partition directly, avoiding a consumer
group rebalance unrelated to the handler being tested.

| Mode | Dependencies | Spring context |
| --- | --- | --- |
| `per-class-sequential` | Fresh servers for every class, sequential startup | Fresh per class |
| `per-class-parallel` | Fresh servers for every class, bounded parallel startup | Fresh per class |
| `suite-parallel` | Fresh servers once per test JVM, bounded parallel startup | Shared within that JVM |
| `workspace` | An explicitly owned warm pool outside Gradle; private database clones and Kafka topics per test JVM | Shared within that JVM |

Run through the [benchmark driver](../../../dev/benchmark-testcontainers.js),
which copies this fixture and its sibling Lombok fixture into temporary storage:

```sh
node dev/benchmark-testcontainers.js --plan
node dev/benchmark-testcontainers.js --help
node dev/benchmark-testcontainers.js \
  --gradle "$DT_TEST_GRADLE" --java-home "$JAVA_HOME" \
  --iterations 3 --warmups 1 --databases 2 --parallelism 3 \
  --out work/bench/testcontainers.json
```

The driver accepts explicit toolchains, image/library versions, Docker endpoint,
dependency counts, startup parallelism, selected classes, Gradle workers, test
forks, timeouts, warmups, repetitions, image-pull policy and cache location.
`--compile-only` compiles and runs the policy regressions without Docker;
`--preflight-only` checks the engine without starting dependencies. `--keep`
retains the disposable fixture for inspection.

Every requested integration run executes fresh tests. Image pulls, initial
compilation, warmups and warm-pool startup are retained separately. The report
contains Gradle task events and versioned dependency events, including startup
wall time, individual container times, template/clone/topic operations, Spring
refresh, actual effects and cleanup. Parallel duration sums are labeled as sums.

Each pool and container has an owner label. The workspace provider rejects
missing or mismatched bindings; it never silently falls back to starting
containers. It creates databases from an untouched template using a separate
maintenance connection, and deletes only its exact databases/topics. Credentials
live in an ignored, mode-0600 binding file, outside the retained report. Startup
jobs drain before compensation, and telemetry uses a separate lifecycle lock
and a process-safe append lock. These rules have Docker-free policy regressions.

The fixture's writes across several databases and Kafka are a performance and
binding check, not an atomic distributed transaction. It does not test arbitrary
migrations, production Kafka consumer-group semantics, database extensions or
network topology. A service adapter must retain its own assertions and property
names. Remote runners need endpoints reachable from the runner.
