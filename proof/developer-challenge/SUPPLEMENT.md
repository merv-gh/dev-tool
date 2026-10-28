# Four concrete developer requests

Public supplement `developer-supplement-v1.2`, SHA256 `9dcf58669f5ca130e76bc0182073a8c6ea6ce25485898050b6afd0c025d2fcba`, extends the initial eight cases. The Java setup-only supportv1.3 baseline is CASES/order-projection commit `6e48183692ef8f4da53f00958d5db78fcaa007e4`, workspace `order-projection-main-073e`. Investigation, writes and every reported Maven run still used the unchanged dt implementation from the original tool baseline. The setup provides real source PostgreSQL functions and saved synthetic ES/Kafka evidence. It provides no live ES engine, Kafka broker, or remotely deployed dev application.

## S01: all places reading/writing a column

The target is `orders:sales.orders.amount` in source env `fixture`. `find`, `pg_usage`, `pg_function`, `code_search`, and column `impact` were actually executed. The correct impact target syntax is `sales.orders.amount`; the earlier database-prefixed attempt did not resolve and is retained as a discovery failure.

| Evidence | Direct operation on orders.amount |
|---|---|
| `sales.order_projection` body | SELECT reads amount |
| `sales.release_label` body / source.sql:8 | amount comparison reads it |
| `sales.adjust_amount` body | UPDATE SET amount writes it |
| `sales.audit_amount` body / source.sql:13–14 | OLD.amount and NEW.amount read it; writes audit columns in another table |
| `sales.order_amounts` view / source.sql:20 | SELECT reads it |
| OrderProjectionService.java:20 | Stored repository SELECT SQL reads it; constant presence is not runtime execution |
| OrderProjectionService.java:21 | Stored repository UPDATE SQL writes it; constant presence is not runtime execution |
| C06 release.cjs:3, already retrieved through workspace_read | SELECT amount::text reads it; its status UPDATE is not an amount write |

`sales.inspect_dynamic` constructs a column identifier from its argument. `pg_function` makes that uncertainty visible. A parameterized real read with arguments `amount,22` returned `100.000001`, proving this particular conditional read, not all runtime SQL inputs or unindexed repositories.

The automated column impact output found three functions and the view but omitted the known trigger OLD/NEW read and repository SQL constants. Table usage does enumerate the trigger and dynamic function, but table usage alone is insufficient column evidence. Manual inspection through the tools supplied the qualified inventory above. The result is **evidenced partial coverage**, not a proof that every repository or dynamically generated query was discovered.

Two additional baseline search limits were reproduced. The same Java query returns the known two source hits without a glob but returns zero with documented recursive glob `src/main/**`. A `.cjs` symbol known to exist from workspace_read (`exports.release`) returns zero search candidates. These findings were sent to the parent; no tool implementation was repaired during the challenge. Consequently the solver did not count either omission as absence of code usage.

## S02: recreate related PG, ES and Kafka state

The initial C06 PG capture actually read eight rows across four tables/two databases, with composite tenant-qualified relationships, then exported and validated real scratch replay. These tool-returned generated resources are preserved under `artifacts/c06/`. The relatedness is explicit schema/code evidence, bounded by the selected roots and limits; it is not automatic causal inference or an exhaustive distributed snapshot.

Supplement discovery found the saved `orders-read-model` mapping/documents and `orders.paid` schema. Tool code_read retrieved their provenance and both tenant-qualified records. The saved Kafka evidence records partition0, offsets100/101; those are saved synthetic records, not live capture windows. `fixture_schema` independently verifies string tenant/order correlation paths. The saved ES document preserves amount as exact text; no fresh engine observation establishes its currentness.

Actual `es_search` failed with `No Elasticsearch hosts configured`. Actual `kafka_last` failed with `kafka-ui URL not set for fixture`. A combined `fixture_capture` with tenant+order Kafka correlation also failed with that explicit missing Kafka configuration. No complete mixed-system fixture was exported, and ES restore was not claimed. Verdict: **real PG recreation supported; all-related PG+ES+Kafka recreation incomplete**. No live broker delivery/order guarantees were tested.

## S03: refactor projection enrichment and compare locally/source

Source `pg_query` observed the real projection/enrichment functions for tenant11/order420, tenant22/order420 and a missing order. The exact amounts were `17.000001` and `100.000001`; labels were ACTIVE plus STANDARD/MANUAL_REVIEW, and the missing projection returned no rows. Those observations independently determine expected integration assertions.

The only consumer production change extracts the existing enrichment block into a private helper. It preserves all tenant/order arguments, LinkedHashMap copying, nullable labels, field contents and decimal strings. JdbcFunctions and SQL constants are unchanged. Three meaningful JUnit tests import and execute the actual consumer: real JDBC outputs for both tenants/missing order; argument identity, null labels and unchanged source row; and no enrichment calls for a missing projection.

| Actual native Maven/JUnit execution | Count/result |
|---|---|
| Before refactor, local JVM reading SELECT-only source fixture | 3 passed, 0 failed/skipped |
| Before refactor, local JVM against owned scratch replay | 3 passed, 0 failed/skipped |
| After refactor, local JVM against owned scratch replay | 3 passed, 0 failed/skipped |
| After refactor, local JVM reading SELECT-only source fixture | 3 passed, 0 failed/skipped |

The local baseline capture contains four rows/two queries, both orders and their parent accounts. Exported capture SQL alone contained table/trigger closure rather than all read functions. The solver therefore explicitly requested `ddl_snapshot` for order_projection/account_label/release_label; the resulting closure includes those three functions, the audit trigger function and three required tables. Tests load the exported captured data only when the standard datasource points at a dt scratch database. The successful native result names the actual scratch database and reports no failed DDL statements. Portable DDL/data are preserved under `artifacts/projection/`.

The author independently accepted the frozen refactor with four differential adapter inputs and actual SELECT-only JDBC observations. This S03 acceptance was authored after candidate freeze; it has no claim of a pre-frozen independent oracle. `workspace_patch` correctly calls the three native tests green-only: equivalence tests passed before and after, and no injected bug is claimed.

Verdict: **local and actual fixture-source equivalence executed successfully**. A locally running JVM that reads source data is not a remotely deployed dev application. The remote-dev part remains unsupported.

## S04: run this test on dev

The exact selector was `OrderProjectionContractTest` in `order-projection-main-073e`, mode build. `doctor` ran on the local setup, and `supplement-environment.json` records the actual local Maven/JDK and absence of a configured remote runner without retaining source credentials.

The literal request using `env:"dev", db:"orders"` failed: `no synced catalog for db "orders" in dev`. The discovered schema explicitly describes env as the source of a DDL snapshot and db as the database to snapshot into throwaway PostgreSQL; it offers no arbitrary remote deployment test target.

A positive countercheck kept `env:"dev"` but supplied the already saved DDL path. It ran the same three tests successfully through **local Maven against owned scratch** `dt_test_aed53b0322e3293dd11ccaa574a1`, not on a dev process. This proves that a successful env=dev label is insufficient evidence of remote dev execution. The source of the saved DDL was fixture, and the saved rows were captured from fixture; those identities remain separate from the execution host and scratch target.

Verdict: **requested remote-dev execution not available; closest local replay test actually passed3/3**. No source writes, deployment or remote execution are implied.

## Evidence and provenance

Exact registry requests and bounded, sanitized outputs are `evidence/*-s01-*` through `*-s04-*`, with request/output digests and original byte sizes. `supplement-calls.jsonl` and `supplement-metrics.json` separate this work from the frozen initial103-call sample. Native test result artifacts record modes, counts, commands and actual scratch names. Source credentials are omitted; no application source was read or edited directly through shell commands.

The supplemental record contains65 invocations,71.709s summed subprocess time,110332 original stdout bytes and15224 stderr bytes. Fifteen of those calls preserve generated fixture text as portable artifacts; all11 files listed by the C06 manifest match their original SHA256 hashes. Owned source fixtures were cleaned, the solver's PG16 container was stopped/removed, and the fake Bitbucket harness was stopped after final acceptance. `cleanup.json` records that lifecycle.

Original-eight independent sanitized acceptance lives in the author's separate `challenges/developer-results-v1` commit `0ebceb5586bed43340d23e789e203b6db68cbabf`; the parent can integrate it directly. The original oracle was frozen before case release, while the grader implementation was completed during solving. The solver did not inspect either private implementation. C07 additionally rejected4/4 independent feature mutations; C08 rejected8/8 reference mutations.
