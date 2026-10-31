# Reproduce a related-data scenario

Capture a small, coherent slice of a development environment, save it with the service's tests, and replay it on scratch PostgreSQL. PostgreSQL FKs come from cached schemas; cross-database joins and Kafka correlation paths are explicit inputs. The same order id is retained in database rows and event envelopes.

## Run the local example

From the repository root, with dependencies installed:

```sh
node demo/reproduction.js
node demo/reproduction.js --keep
```

The demo always creates a new temporary `DT_HOME` and clears inherited `DT_*_DIR` overrides before loading dt. It builds synthetic schemas for `orders` and `billing`, runs bounded SELECT adapters over synthetic rows, and reads synthetic Kafka envelopes. It never connects to the configured development environment or replaces your existing configuration.

Each stdout line is JSON. The capture reports four rows, four parameterized reads, one deduplicated matching event, a shared order id of `42`, and a consistently masked email. It follows a composite customer FK without fetching a customer from another tenant, follows a payment-status FK, and traverses the explicit order-to-payment relation. A saved sandbox experiment asserts that the payment and Kafka event join the same order.

The `export` result points to a generated fixture:

```text
<temporary home>/work/reproduction-demo/src/test/resources/dt-fixtures/paid-order/
```

A generated synthetic example is also checked into [`test/fixtures/reproduction-service/src/test/resources/dt-fixtures/paid-order`](../test/fixtures/reproduction-service/src/test/resources/dt-fixtures/paid-order/README.txt). It contains SQL, row/schema JSON, Kafka envelopes and a verified manifest; it is a fixture example rather than a complete Java service.

The default run removes the temporary home. `--keep` retains it for inspection; the last JSON line prints the path. Optional real SQL/constraint validation uses only an explicitly supplied scratch database URL:

```sh
DT_TEST_DB_URL='postgres://dt:dt@localhost:5432/postgres' node demo/reproduction.js
```

Use a scratch server on which the account can create/drop databases. Replay creates two `dt_test_*` databases and drops both in `finally`, including when `--keep` retains the local files. No Kafka producer is run. Omit `DT_TEST_DB_URL` for a fully local demo.

## Plan against the cached index

Search first; refresh only missing or stale sources:

```sh
node cli.js find pg: orders --env dev
node cli.js usage sales.orders --env dev
node cli.js find kafka: paid --env dev
node cli.js sync pg --only orders,billing --env dev
node cli.js sync kafka --only order_paid --env dev
```

Pass the following JSON to `fixture_plan` through MCP/OpenAPI, or as the JSON argument to `node cli.js tool fixture_plan`. Replace database/table/topic names with exact cached names:

```json
{
  "env": "dev",
  "service": "order-service",
  "seeds": [
    { "db": "orders", "table": "sales.orders", "where": { "id": 42 } }
  ],
  "relations": [
    {
      "from": { "db": "orders", "table": "sales.orders", "columns": ["id"] },
      "to": { "db": "billing", "table": "pay.payments", "columns": ["order_id"] },
      "required": true,
      "evidence": "PaymentListener.java:14: payment.order_id is copied from order.id"
    }
  ],
  "topics": [
    {
      "topic": "order_paid",
      "matches": [
        { "path": "value.orderId", "from": { "db": "orders", "table": "sales.orders", "column": "id" } }
      ],
      "required": true
    }
  ],
  "limits": {
    "depth": 8,
    "rowsPerTable": 200,
    "totalRows": 2000,
    "messagesPerTopic": 300,
    "totalMessages": 2000,
    "queries": 200
  }
}
```

`fixture_plan` performs no live reads. Inspect `tables`, `relations`, `candidates`, `topicCandidates`, `gaps`, and `limits`. JSON Schema, Avro, flattened fields and cached samples supply Kafka path/type evidence. `topicCandidates` suggests normalized names and semantic ids, preserving ambiguity; it never adds a match automatically. `fixture_schema` independently lists paths for a topic and checks an optional `path` against known evidence. `service` adds usage context. Composite FKs preserve column order. `includeChildren: true` also follows reverse relationships; leave it off when only required parent rows are needed. A same-name column in another database is a candidate to verify in code, not an automatic join.

Kafka matching paths may start with `value`, `key`, or `headers`; nested arrays use `[]`, for example `value.lines[].orderId`. Multiple match rules use `match: "all"` by default; use `"any"` when either rule is sufficient. Optional `offsets` maps partition numbers to decimal-string starting offsets. Store large database ids and Kafka offsets as strings when JSON numbers would lose precision.

## Capture, inspect and export

Call `fixture_capture` with the planned inputs or the returned plan:

```json
{
  "plan": { "env": "dev", "seeds": [{ "db": "orders", "table": "sales.orders", "where": { "id": 42 } }] },
  "mask": true
}
```

This shorter example follows database FKs only; use the full plan above for the two-database/Kafka scenario. Capture runs as a resumable job. If it returns `state: "running"`, poll `fixture_capture` with `{ "job": "<job id>" }`. Completed capture returns a `capture` id, counts, `complete`, `gaps`, and an interactive `view`. `fixture_validate` independently rechecks captured parent relationships and reports all capture gaps without a live read. The view includes relationships, rows/messages, source details, bounds, and capture gaps. Open it before exporting a fixture you intend to commit.

Open the service with `workspace_open`, then use its returned id:

```json
{ "service": "order-service", "ref": "main" }
```

Call `fixture_export`:

```json
{
  "workspace": "<workspace id>",
  "capture": "<capture id>",
  "name": "paid-order"
}
```

For a multi-module service, add `directory: "orders-module/src/test/resources/dt-fixtures/paid-order"`. Existing fixtures are preserved unless `overwrite: true` is supplied. Export rejects paths outside a workspace and paths passing through symlinks. If cached catalog metadata changed after capture, capture again before exporting.

Each database has `schema.sql`, `data.sql`, `constraints.sql`, `schema.json`, and `rows.json`. Database/topic directory names are hex-encoded; use the manifest mapping rather than guessing paths. Kafka resources include `messages.jsonl`, `schema.json`, and `offsets.json`. `manifest.json` records capture inputs, observed windows, correlation evidence, provenance, gaps, and file hashes. The SQL separates FK/trigger installation from inserts so cyclic FKs can be restored after all rows exist.

## Replay in a test

Configure `tests.pgUrl` or `DT_TEST_DB_URL` with scratch PostgreSQL. To validate hashes, SQL and constraints without retaining databases, call `fixture_replay`:

```json
{
  "workspace": "<workspace id>",
  "directory": "src/test/resources/dt-fixtures/paid-order"
}
```

For an actual service test, call `test_run`:

```json
{
  "workspace": "<workspace id>",
  "tests": ["PaidOrderIntegrationTest"],
  "fixture_path": "src/test/resources/dt-fixtures/paid-order",
  "fixture_bindings": {
    "orders": "SPRING_DATASOURCE",
    "billing": "BILLING_DATASOURCE"
  },
  "mode": "auto"
}
```

Each binding supplies `<PREFIX>_URL`, `<PREFIX>_USERNAME`, and `<PREFIX>_PASSWORD` to the test process. Configure the service's second datasource to read the corresponding prefix. One captured database defaults to `SPRING_DATASOURCE`; multiple databases require explicit, unique bindings. `DT_FIXTURE_PATH` contains the absolute fixture directory. Read the Kafka JSONL envelopes from there and publish them through the service's existing test producer into its test Kafka, or pass them directly to a listener test. Saved source offsets document capture; they are not consumer offsets to commit during replay.

`test_run` drops replay databases when the run finishes or fails. If it returns `state: "running"`, poll the same tool with `workspace` and its `job` id. Use `mode: "build"` for final Maven/Gradle verification. Local test helpers and measured index speedups are described in dev-performance-plan.md.

## Save a repeatable investigation

`experiment_save` accepts an explicit read-only tool allowlist, parameter defaults, and sandbox JavaScript:

```json
{
  "id": "paid-order-consistency",
  "description": "Does the captured payment reference the captured order?",
  "tools": [],
  "defaults": {},
  "code": "const f = vars.fixture; const order = f.rows['orders:sales.orders'][0]; const payment = f.rows['billing:pay.payments'][0]; test('same order', () => expect(payment.order_id).toBe(order.id)); return {orderId:order.id, amount:payment.amount};"
}
```

Run it with `experiment_run`:

```json
{ "id": "paid-order-consistency", "capture": "<capture id>", "params": {}, "timeout_ms": 30000 }
```

An empty `tools` array keeps the experiment entirely on the saved capture. To query current read-only evidence, allow only the needed tool names and use `await tools.<name>(args)` or `await tools.call(name, args)`. For example, allow `["pg_query"]` and call `tools.pg_query({env:"dev", db:"orders", sql:"select id from sales.orders where id = $1", params:[vars.orderId]})`. The default allowlist is `["find"]`. The current allowed names are:

```text
find pg_query pg_table pg_function pg_usage who_uses
es_search kafka_last kafka_topic health logs_search logs_trace
passports api_routes code_search code_symbols impact fixture_plan
```

The constrained interpreter supports `vars`, `test`, `expect`, `assert`, `return`, and log/text output. It exposes no filesystem, subprocess, direct network, process or inherited-environment capability; use the explicit tool allowlist for live evidence. `import` syntax is unsupported (the token is rejected even in strings/comments); write trusted project investigations, rather than untrusted third-party programs. Tool calls retain their normal query guards and rate limits. The experiment timeout is at most 120 seconds. `experiment_list` shows definitions and run summaries; `experiment_compare` compares the latest two runs or explicit `before`/`after` run ids, including assertions, values, code identity, and timing. Histories retain the latest 100 runs, including failures.

## Interpret completeness and masking

`complete: true` means the declared capture requirements succeeded within the reported schema and observation window. PostgreSQL databases and Kafka do not share a transaction: concurrent updates can cross that window. A bounded Kafka scan cannot establish that older matching events do not exist. Review partition windows, required relations, missing seeds/parents, expired offsets, and truncation gaps before treating a fixture as sufficient.

Masking is enabled by default and uses consistent replacement values across rows, event bodies/keys/headers, and recorded filters. Keys retain their relationships. Review the generated resources before committing them: application-specific private fields may need additional handling, and masking can conflict with domain CHECK/length constraints. Keep `mask: true` for shareable fixtures. Replay rejects incomplete fixtures unless `allow_incomplete: true` is explicitly supplied after inspecting the gaps.

For a whole passport's state, actions and expected effects, use the independently callable stages in [scenario-testing.md](scenario-testing.md). The fixture tools supply related database and Kafka state; scenario tools also bind HTTP, search, configuration, cache and other explicit read fixtures. A local emulation validates the supplied behavioral model. An application's own integration tests validate the application.
