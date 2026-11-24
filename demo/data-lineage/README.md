# Data access evidence demo

```sh
node demo/data-lineage/serve.cjs --port 4103
```

Open the printed `/show` links. These retained views are produced by real HTTP calls to `data_readers`, `data_writers` and `data_trace`. A temporary config/cache is removed when the server stops. No production configuration or live services are used.

The synthetic example has an API inheriting a controller/repository from an internal library, PostgreSQL procedure writes, getters/setters, a Kafka consumer saving to ES, and the same topic on another broker that must remain separate.

```sh
node demo/data-lineage/verify.cjs
node --test test/data-lineage.test.js
```

The verifier starts a disposable server, records screenshots/assertions in [verification.json](evidence/verification.json), deliberately fails a stale refresh and confirms retained evidence plus explicit recovery. These are source/catalog fixtures, not deployed Java/Joern/database observations.

The [recorded regression run](evidence/tests.json) passed 248 tests, including 26 data-lineage cases, the 200-service/low-heap specimens and standalone bundle checks. The browser run passed 13 checks and retained 17 captures, including actual Workbench source execution and custom-override sandbox isolation.

| Example | Screenshot |
| --- | --- |
| Readers and separate object access | [Desktop](evidence/readers-desktop.png), [phone](evidence/readers-mobile.png) |
| Procedure writes and object setters | [Writers](evidence/writers-desktop.png) |
| Inherited API to column | [Library path](evidence/library-path-desktop.png) |
| API → Kafka → service → ES | [Desktop](evidence/kafka-es-desktop.png), [phone](evidence/kafka-es-mobile.png) |
| Uncertain name matches | [Candidates](evidence/name-candidates-desktop.png) |
| Ambiguous or absent object | [Selection](evidence/ambiguous-desktop.png), [missing](evidence/missing-desktop.png) |
| Background build and failed refresh | [Pending](evidence/index-pending-desktop.png), [failure](evidence/refresh-failed-desktop.png) |
| Long identifiers, without horizontal overflow | [Readers desktop](evidence/readers-long-desktop.png), [phone](evidence/readers-long-mobile.png), [path desktop](evidence/trace-long-desktop.png), [phone](evidence/trace-long-mobile.png) |
| Collapsed candidates and native handoff | [Name candidates](evidence/name-candidates-inline.png), [actual Workbench embed](evidence/workbench-inline-handoff.png) |

Static topology is not runtime/value-flow proof. See [usage, rules and limits](../../docs/data-lineage.md).
