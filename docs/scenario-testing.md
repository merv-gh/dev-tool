# Passport-driven scenario testing

A passport gives a useful inventory of a service's entry points, dependencies and effects. It is static evidence: dynamically selected SQL, missing library code, reflection, runtime configuration and external clients can add reads that the passport cannot identify. The scenario tools preserve those gaps and require explicit bindings before a local emulation can pass. An emulation checks a supplied model of behavior; execute the application's own integration tests against the exported resources to establish that the application follows that model.

## Inspect the pieces separately

Use the shared CLI/MCP/OpenAPI tools in this order:

1. `scenario_inventory`: choose a service passport, optionally one entry point. Inspect state dependencies, source locations, actions, output expectations and unresolved edges.
2. `scenario_state_plan`: bind every required read dependency. Use captured PostgreSQL rows and Kafka envelopes, supplied HTTP responses, Elasticsearch documents, configuration and cache values. Record evidence when resolving an ambiguous datasource or a dynamic resource name.
3. `scenario_state_capture`: materialize the planned bindings with the selected read adapters. Missing adapters, failed reads and truncated captures remain gaps.
   Use `scenario_state_get` to inspect one saved dependency, filter a row array, select a cache key or match a provided HTTP exchange without invoking an action.
4. `scenario_actions`: provide an explicit input for each selected endpoint/listener/action. The planner supplies no invented valid request.
5. `scenario_expectations`: bind each required effect to a precise matcher and expected value. Exact/subset comparisons, counts, ordered sequences and forbidden effects address different assertions.
6. `scenario_check`: compare independently obtained observations against those expectations. A missing observation is a failure; an absent write must be asserted explicitly rather than silently omitted.
7. `scenario_emulate`: execute a bounded JavaScript model using only local state reads, action inputs and observation recording. Every required dependency must be read, every action invoked and every expectation observed. Check both the assertion results and coverage.

The registry descriptions and JSON schemas document each tool's current arguments. Inspect them before scripting a workflow. Each component is callable independently, so an upstream inventory gap, capture error, model error or output mismatch can be isolated without rerunning unrelated steps.

## Related data across databases and Kafka

Start with `find` and `pg_usage` against the cached catalog. In `fixture_plan`, name every datasource explicitly and provide equality-filtered seed rows. Cached composite foreign keys preserve column order. Cross-database relationships require explicit column mappings and evidence from the code or a schema contract; similarly named columns are suggestions only.

For a multi-tenant event, match both tenant and business id against the same captured row:

```json
{
  "topic": "orders.paid",
  "matches": [
    { "path": "key.tenantId", "from": { "db": "commerce", "table": "sales.orders", "column": "tenant_id" } },
    { "path": "key.orderId", "from": { "db": "commerce", "table": "sales.orders", "column": "id" } }
  ]
}
```

With the default `match: "all"`, those rules must agree on one row. Array paths such as `value.groups[].items[].tenantId` and `value.groups[].items[].orderId` must agree on the same array element as well. A tenant from one row or item cannot be combined with an order id from another. Rules sourced from different tables are checked independently against each table's captured rows; no arbitrary cross-table tuple join is inferred. Put composite event identity on the same captured table and verify its relational links. Use a key correlation when tombstone values are `null`.

Treat Kafka offsets and database ids beyond JavaScript's safe integer range as decimal strings. Event ordering is by partition and source offset; Kafka supplies no total order across partitions. A tombstone remains an envelope with its key, partition and offset. Identical sightings of a physical partition/offset record are deduplicated.

`fixture_capture` records bounded observation windows, schema fingerprints and provenance. Independent database statements and Kafka reads do not form a distributed snapshot. Missing roots, required parents, expired/truncated Kafka windows or traversal limits prevent a completeness claim. Preserve these limits with the fixture.

Use `fixture_export` to save the capture under `[module/]src/test/resources/dt-fixtures/<name>`. Each datasource receives separate schema/data/constraint SQL and row JSON; Kafka receives envelopes, schemas and partition windows. The manifest maps encoded directories to original names and verifies resource hashes. `scenario_export` saves the inventory, HTTP/search/configuration/cache state and action/expectation plans as separately hashed JSON resources. Give the fixture capture and the scenario contract distinct names/directories so neither replaces the other. Review masking and application constraints before committing resources.

For the application integration run, `test_run` accepts the fixture directory and an explicit datasource-prefix binding for every database. Replay creates throwaway databases and checks actual constraints. Publish the saved envelopes only into the test broker or invoke the listener directly. The source offsets document evidence; they must not be committed as development consumer offsets.

## Adversarial checks

Run the synthetic complex suite without infrastructure:

```sh
node --test test/scenario-complex.test.js
node --test test/reproduction.test.js test/fixture-schema.test.js test/kafka-capture.test.js
```

The complex fixture has two databases with a table named `shared.accounts`, repeated account ids across tenants, composite foreign keys, decimal amounts and ids above `2^53`. Kafka inputs contain several partitions, offsets above `2^53`, duplicates, tombstones, out-of-order arrivals and false cross-tenant correlations. Other reads cover HTTP/Feign, Elasticsearch, configuration and cache state. The suite checks missing bindings, unknown external reads, adapter failures, incomplete capture, omitted observations, incorrect expectations and attempts to bypass the local state interface.

Verified on 2026-10-28: all 23 complex tests passed, including independent calls to all nine scenario tools. The tests also cover conflicting physical Kafka records, fixture source identity, validated schema resolutions, dotted configuration-secret masking, forged completeness flags, state-plan tampering before adapter reads and hashes of all exported state/action/expectation resources. `fixture_schema` and `fixture_validate` have separate registry-call tests in the reproduction suite. Final verification and real JVM timings are recorded in dev-performance-plan.md.

Do not replace an integration run with this synthetic suite. The local tests establish the tooling contract; an actual service test establishes its SQL, serializers, listeners and application behavior. Supply `DT_TEST_PG_URL` to the reproduction suite for the optional real PostgreSQL constraint and replay checks. Existing live tests remain opt-in.

`test/reproduction.live.test.js`, enabled with `DT_TEST_PG_URL` and `DT_TEST_MAVEN`, checks the new resource pipeline against actual Java/JDBC business code: two disposable source databases, guarded read-only capture, hashed exports, two isolated replay databases and `test_run mode=build`. Four JUnit cases independently assert exact-decimal/bigint success and both database writes, then reject wrong tenants, changed event amounts and insufficient credit without writes. It verifies source rows and resource hashes remain unchanged and replay databases are removed. Kafka inputs are saved envelopes loaded through Jackson; this test does not run a broker.
