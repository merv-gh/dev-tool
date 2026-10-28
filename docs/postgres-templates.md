# Prefilled PostgreSQL templates and private run databases

Pay fixture preparation once, then create a clean database copy for each run. Keep the hashed SQL resources in Git: native bases are cluster-local acceleration artifacts and can always be rebuilt. The default `fixture_replay` / `test_run` path still loads a fresh database. Opt into templates with `fixture_template:true` on `test_run`, or `reproduction.replay(workspace,directory,{template:true})` in an adapter.

## Open WebUI tool workflow

All operations use the shared tool registry (OpenAPI, MCP, CLI and HTTP); no browser plugin or Confluence mirror is needed. Discovery, preparation, execution and cleanup remain separate calls.

1. `testdb_capabilities {}` explains the protocol and unsupported fidelity.
2. `testdb_initialize {"label":"team integration scratch"}` labels the configured scratch control database.
3. `testdb_template_plan {"workspace":"...","directory":"src/test/resources/dt-fixtures/release"}` verifies portable input hashes offline and reports SQL sizes, logical databases and prerequisites.
4. `testdb_template_build` with the same inputs prepares, validates, analyzes and freezes the base. Repeating identical inputs reuses it. Each changed fixture, masking/seed policy, migration input or compatible PostgreSQL platform produces another key.
5. `testdb_template_inspect {"template":"<key>"}` shows source identities, table counts, content fingerprints, installed extensions and size. `testdb_template_verify {"template":"<key>","deep":true}` validates actual data through a disposable private copy.
6. `testdb_clone {"template":"<key>","runId":"release-regression","idempotencyKey":"unique-request-id","ttlMs":3600000,"settings":{"timezone":"UTC"}}` returns a lease and datasource bindings by original logical database name. Bind them to the application rather than guessing a default database. The clone credentials are private, ephemeral scratch credentials.
7. `testdb_reset {"lease":"..."}` creates another clean copy and removes the old one. Reconnect the application to the returned bindings. A fresh database resets committed and asynchronous writes; rollback of one transaction cannot provide that guarantee.
8. `testdb_release {"lease":"..."}` removes the private databases and their application role. Release is idempotent. `testdb_lease_renew` retains a failed environment for a bounded debugging period.
9. `testdb_gc {"dryRun":true}` previews expiry/age/LRU/size/count cleanup; remove `dryRun` to execute it. `testdb_resources` and `testdb_template_list` expose retained leases, ownership errors and the retry queue.

Build and clone tools return a resumable `job` when they exceed the HTTP wait window; poll the same tool with `{"job":"..."}`. Cancellation reaches the adapter and compensates partial setup. Clone jobs persist only lease IDs, never credentials.

`testdb_template_invalidate {"template":"...","reason":"reference data is obsolete"}` blocks future clones while preserving existing leases. Use `testdb_template_pin` to change retention independently from content. GC removes an invalid unleased base, after which the same input can be built again. Input changes normally create a new immutable base without invalidating the previous one.

Inspection and allocation tools provide an interactive JSON view. Passwords are removed before saving any visualization artifact; only allocation/reset responses contain the usable scratch credentials. Lists are paginated with `limit`/`offset`; exact template detail is a separate operation. The results are compact descriptors and IDs rather than complete SQL or all captured rows. Fixture inspection remains available through the separate fixture explorer.

## Scratch configuration and ownership

Configure `tests.pgUrl` or `DT_TEST_DB_URL` to a dedicated PostgreSQL scratch control database. Never point it at a configured environment database. A different scratch database on the same disposable server is supported; a separate cluster is recommended for team use. URL checks normalize loopback aliases but cannot establish that arbitrary DNS aliases name the same server. The durable registry and per-database ownership checks are the deletion authority.

Initialization creates a private `dt_test_control` schema with a random cluster-registry UUID. The physical PostgreSQL system identifier is recorded and compared when `pg_control_system()` is permitted. If that permission is unavailable, capabilities report the registry UUID identity explicitly. A copied registry with a different available physical identifier is rejected. An unrelated preexisting schema with the same name is never adopted.

Each database has a registry resource UUID, its expected owner and a matching PostgreSQL database comment. Deletion requires all three to match the current labeled registry. A similarly named user database, a database on another registry or one with a changed ownership marker is not deleted. A crash in the narrow interval between `CREATE DATABASE` and its ownership comment can leave an unverified database: GC reports that ownership gap for manual inspection instead of guessing from its prefix.

The builder needs `CREATEDB`; private clone roles also need `CREATEROLE`. Initialization reports these capabilities. One private non-owner role is created per lease, with access only to that lease's databases. It receives CONNECT/TEMP, schema USAGE and fixture table/sequence/function privileges; it cannot create databases, alter the frozen base or access another lease's databases. Schema-changing application migrations require a separately designed ownership/grant profile; they are not implied by these DML grants.

Database creation and metadata changes share a PostgreSQL session advisory lock in the control database. The initial copy concurrency is deliberately one, including across independent dt processes. The lock survives asynchronous JavaScript work and releases if the process dies. Metadata uses native PostgreSQL transactions or atomic row statements, not a process-local JSON registry. A unique random database name is allocated each time, including repeated human run IDs.

## Preparation, fidelity and failure behavior

A base is created privately from `template0`, then verified SQL statements run in their exported order. Required statement failure stops preparation immediately and removes the partial database. This also applies to legacy DDL-only `test_run`; partial preparation no longer reaches the application. The programmatic `testdb.create(...,{allowPartial:true})` is an explicit diagnostic mode and reports every failed statement. It is not exposed by the normal test runner.

Constraints are validated; sanity queries are read-only and compared with caller-owned exact expected rows; `ANALYZE` runs; fingerprints cover table data including duplicate multiplicity, columns, constraints, sequences, extensions, function/view/trigger/index definitions and domain/enum types. A ready base has `ALLOW_CONNECTIONS=false` and retains `IS_TEMPLATE=false`. Deep verification clones it to inspect content rather than opening it. Metadata checks are cheap; deep checks detect an administrator unfreezing, mutating and refreezing a base. An administrator remains able to change a scratch cluster and is not inside the application-role isolation boundary.

Compatibility keys include the complete verified PG SQL and its hashes, explicit policy, setup mode, base key for upgrades, PostgreSQL version/encoding/locale/provider/collation version and available extension versions. Kafka window/offset changes and unrelated catalog refresh timestamps do not invalidate an unchanged PG base. Optional `compatibility` can require a PostgreSQL major, collation and exact available extension versions. Native copies preserve the state actually loaded into the base. They cannot recover source objects omitted by a catalog-derived SQL snapshot.

RLS policies, custom SECURITY DEFINER ownership and foreign tables are rejected with named unsupported-feature evidence. Role/database/tablespace administration and COPY PROGRAM are prohibited in portable fixture SQL. This is a database-local fixture contract, not a full PostgreSQL backup format. Ordinary partitions, generated/identity columns, sequences, triggers, composite FKs and decimal/large integer data are covered by real PostgreSQL tests. The verified platform is PostgreSQL 16; other PostgreSQL versions require their own adapter conformance run. Managed services without native clone or role privileges can use the existing verified fresh-load path; no silent fallback conceals a rejected template setup.

Multi-database clone failure or cancellation compensates already-created copies and the private role. Persistent leases record `creating`, `active`, `released` or `cleanup-failed`, so process death remains inspectable. Expired leases, abandoned candidates and failed drops are recovered by explicit `testdb_gc`; this is not an unattended background scheduler. Live leases and pinned bases are never selected for eviction. Template storage/count budgets report `budgetSatisfied:false` when protected resources prevent the requested reclamation; they are not hard allocation quotas for active copies. SQL statements and lock waits have 120-second timeouts; cancellation interrupts current fixture SQL and checks every source/clone stage. A native database copy may finish before cancellation can compensate it. Cleanup failures remain errors with retry metadata; a successful test with failed cleanup is reported as `cleanup-failed`.

## Composable, language-neutral boundary

`testdb_capabilities` declares `dt.postgres.templates/v1`; [the JSON schema](contracts/postgres-template-v1.schema.json) defines template and lease descriptors. All public descriptors have `version:1`; driver-neutral `endpoint:{host,port,database,parameters}` plus optional JVM convenience URLs, logical database names, SHA-256 template IDs and opaque lease IDs are the handoff between stages. Dates are ISO timestamps, sizes and exact database counts are decimal strings, and SQL retains exact typed literals. No JavaScript classes, closures, Maven types or Confluence structures are persisted in the contract.

`lib/testdb.js` owns scratch SQL connections, cluster identity and resource ownership. `lib/testdb-templates.js` implements the lifecycle over that backend; `lib/tools-testdb.js` is a thin presentation adapter. A Go/Rust implementation can consume the same hashed SQL and implement the same JSON operations. Registry schema/lock/marker names are a backend protocol detail and should not be queried by clients. Keep old protocol readers or explicitly migrate descriptors before changing version semantics. A replacement backend must pass the same process-concurrency, ownership, isolation, expiry and failure-compensation tests before advertising these capabilities.

Programmatic adapter examples:

```js
const T = require('./testdb-templates');
await require('./testdb').initialize({label:'integration scratch'});
const base = await T.build({workspace,directory});
const run = await T.clone({template:base.id,runId,ttlMs:3600000});
try { await executeActualService(run.databases); }
finally { await T.release(run.lease); }
```

The internal convenience `cleanup()` function is never part of a tool response or persisted manifest. Call `release(lease)` across transport/language boundaries.

Preparation also supports explicit SQL modes through the tool inputs and programmatic adapter:

- `snapshot`: load exact verified fixture SQL, the existing test runner's mode.
- `migrations-empty`: run caller-supplied ordered migration SQL (in verified fixture SQL files for the tools) from an empty database; the mode changes the content identity.
- `upgrade`: use a verified immutable `base` key, apply caller-supplied ordered migration SQL (in verified fixture SQL files for the tools) to a private copy, then validate and freeze a new base. The old base remains unchanged.

These modes do not discover or execute Flyway/Liquibase engines. Use the existing full project build for migration-engine proof; source snapshots must not be reported as that proof.

## Tests and timings

Run offline contract checks:

```sh
node --test test/template.test.js
```

Run extensive real tests against a dedicated disposable PostgreSQL:

```sh
DT_TEST_PG_URL=postgres://dt:password@127.0.0.1:5432/postgres node --test --test-concurrency=1 test/template.test.js test/template.live.test.js
```

The suite exercises three independent builder processes, parallel private roles, composite tenant FKs, exact decimal/large IDs, generated/identity columns, trigger/sequence state, committed writes/reset, partial failure/cancellation, SIGKILL recovery, wrong-marker refusal and retry, unrelated user databases, failed SQL/sanity/fidelity/compatibility, content drift, migration upgrades and portable resource tampering.

The committed benchmark measures two logical databases, cold fresh loads, one immutable build, repeated warm private clones and replacement reset including old-database deletion. It records p50/p95, raw samples, PostgreSQL compatibility and hardware; it does not include application/JVM execution:

```sh
DT_TEST_PG_URL=postgres://dt:password@127.0.0.1:5432/postgres node dev/benchmark-testdb.js --rows=100,1000 --iterations=3
```

[Recorded development-machine results](benchmarks/postgres-template-2026-10-28.json), PostgreSQL 16.15 in Docker, fsync on, two logical databases, three samples per tier:

| Rows per database | Fresh load p50 | Warm clone p50 | Replacement reset p50 |
| --- | ---: | ---: | ---: |
| 100 | 867 ms | 294 ms | 1004 ms |
| 1000 | 4629 ms | 357 ms | 714 ms |

The one-time validated builds took 1140 and 6221 ms. These samples show the local loop and are not a service-wide performance guarantee; with three observations the reported p95 is the largest sample. Use representative fixture sizes and your deployment storage before choosing budgets.

PostgreSQL cloning is a physical copy rather than an instant pointer operation. Database-level permissions must be applied after copying, and the source must have no active sessions. These implementation choices follow the [PostgreSQL CREATE DATABASE documentation](https://www.postgresql.org/docs/16/sql-createdatabase.html) and [template database documentation](https://www.postgresql.org/docs/16/manage-ag-templatedbs.html).
