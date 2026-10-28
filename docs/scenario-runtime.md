# Portable scenarios and actual-service proof

The tools are intended to be composed in Open WebUI. Start from the cached passport, bind every declared read, supply action inputs and independently specify expected effects. `scenario_package` then writes one versioned artifact linking those contracts, optional replayable PG/Kafka resources and the hash of a reviewed runtime profile. Its normal output is a small path/hash summary; the default visualization contains the full contract and downloadable evidence.

Every stage is also available through CLI, MCP and `POST /api/tool/<name>` with the same JSON input. None of these stages requires Confluence or a particular knowledge graph. Source provenance, ambiguity and unresolved dependencies remain in the scenario inventory. A package with an unresolved required dependency cannot be exported as complete.

## Workflow

1. Use `scenario_inventory`, `scenario_state_plan`, `scenario_state_capture`, `scenario_actions` and `scenario_expectations` to build the bound contract. Each existing stage remains independently callable.
2. Write and review a workspace runtime profile. It names the existing entrypoint or exact project tests, not a shell command supplied by a tool argument.
3. Call `scenario_package` with `workspace`, `inventory`, `state`, `actions`, `expectations`, `profile` and optional `fixture_path`. The returned `path` is `[module/]src/test/resources/dt-scenarios/<name>/scenario.json`.
4. Use `scenario_verify`, `scenario_explain`, `scenario_diff` and `scenario_preflight` separately. Preflight reports unsupported adapters and missing bindings before resources start.
5. For an isolated Node service, call `scenario_start`, `scenario_act` for each bound action, `scenario_observe`, `scenario_assert`, `scenario_inspect` and `scenario_stop`. `scenario_run` performs those stages and always stops in `finally`.
6. For JVM or other project-supported dependencies, use the `test-run` profile with `scenario_run`. It executes the project's actual Maven/Gradle tests through existing `test_run`, then checks a project-produced observation report against the portable contract.

`scenario_start` and `scenario_run` use the existing background-job system. They wait at most 50 seconds per tool call; a longer operation returns `{job,state:"running"}`. Poll the same tool with just `job` rather than starting it again. Cancellation is checked between runtime stages, known child processes are cancelled through the existing trace/job system, and a one-shot run still cleans up its owned session.

`scenario_import` verifies and imports a transferred artifact. `scenario_package` can return it inline with `include_artifact=true`; the ordinary saved JSON file is already portable and Git friendly. No capture-cache IDs, JavaScript callbacks or runtime class instances are needed. Import writes data only. Runtime profiles must exist outside imported resource directories, so importing a scenario cannot install a command or a runtime profile.

## Isolated Node profile

```json
{
  "version": 1,
  "adapter": "node-container",
  "image": "node:22-alpine",
  "entry": "src/server.js",
  "port": 19080,
  "readyPath": "/health",
  "readyTimeoutMs": 10000,
  "http": { "<http-state-id>": "LIMITS_URL" },
  "config": { "<config-state-id>": "REGION" },
  "files": { "<file-state-id>": { "path": "inbox/input.json", "encoding": "json" } },
  "observations": {
    "<http-expectation-id>": { "kind": "http", "state": "<http-state-id>" },
    "<file-expectation-id>": { "kind": "file", "path": "outbox/receipt.json", "encoding": "json" }
  },
  "temporal": { "deadlineMs": 5000, "quietMs": 500, "intervalMs": 50 }
}
```

The Docker image must already exist; this adapter never pulls one. A stock Node 22+ image is required. The workspace is mounted read-only. The service runs unchanged at its entrypoint with only the explicitly bound config, HTTP stub URLs, `PORT`, `NODE_ENV=test` and `DT_SCENARIO_FILES=/dt-files`. Files are fresh private copies. The child Node permission model allows workspace/file reads and writes only below the private files directory and `/tmp`; child processes, native addons and worker threads are not enabled. Services requiring those capabilities need a project adapter.

The container has `--network none`, no published ports or Docker socket, a read-only root, dropped capabilities and bounded memory/CPU/process count. HTTP actions are sent through `docker exec` from inside the same network namespace. There is no live URL fallback. PG, Kafka, ES, generic caches and queues are deliberately blocking preflight gaps for this adapter. Their fixture JSON being present does not prove that a native protocol was replayed.

Each HTTP state is an explicit fixture:

```json
{
  "ordered": true,
  "exchanges": [
    {
      "request": { "method": "POST", "path": "/audit?region=EU", "headers": { "x-client": "orders" }, "body": { "orderId": "42" } },
      "times": { "min": 2, "max": 2 },
      "responses": [
        { "status": 429, "headers": { "retry-after": "0" }, "body": { "retry": true } },
        { "status": 202, "body": { "accepted": true }, "delayMs": 100 }
      ]
    }
  ]
}
```

Method, normalized path/query, JSON/text body and explicitly named headers must match. Transport-added headers are ignored. Counts default to exactly one. An exhausted fixture, unknown request, wrong body/header or wrong sequence returns 503, records a violation and never falls through. Response sequences, connection close and bounded delay support retry/failure tests. Actual outgoing calls are collected independently of the service's returned value.

HTTP action bindings use `{ "method":"POST", "path":"/orders/42", "body":{...}, "headers":{...} }`. Method and path must match the declared passport entry; arbitrary target URLs are rejected. Each HTTP dependency gets a separate private loopback port, so ordinary URL resolution from a base URL works without a special path prefix. Status and return observers are automatic for the same expectation kinds. Every observer must retain its expectation's kind, exact target and action; it cannot satisfy a file expectation with a status code or observe another HTTP client's calls under that id. Concrete file targets must name their relative path before packaging. File observers read the private directory, refuse symlinks/oversize/special files and can return JSON, text or base64. They combine snapshots, recursive filesystem events and success traces for ordinary `fs`/`fs.promises` write APIs, including file handles and streams. The traces retain rapid create/delete effects that filesystem events can coalesce. Native/addon syscalls and deliberate instrumentation bypass are outside this adapter; this is trusted-service test instrumentation, not a hostile-code boundary. Undeclared observed file changes and every stub mismatch fail strict observation. HTTP calls are grouped by explicit sequential action windows; this is a temporal attribution boundary, not distributed causal tracing.

Polling waits for explicit checks until `deadlineMs`. Once checks pass, they must remain satisfied throughout `quietMs`. A late forbidden call/write fails. A short deadline cannot silently count as a completed quiet window. Action inputs are immutable during a session, and each action runs once; repeat from a new clean session.

## Actual project test profile

```json
{
  "version": 1,
  "adapter": "test-run",
  "tests": ["com.acme.ReleaseScenarioTest"],
  "mode": "build",
  "report": "target/scenario-observations.json",
  "fixtureBindings": { "orders": "ORDERS_DATASOURCE", "billing": "BILLING_DATASOURCE" },
  "template": true
}
```

The existing runner handles Maven/Gradle, JUnit reports and fast/full modes. Verified SQL resources are replayed into private scratch databases; explicit multi-datasource prefixes become the same `*_URL`, `*_USERNAME`, `*_PASSWORD` environment variables used by `test_run`. `template:true` uses the prefilled-template implementation when available. Saved Kafka envelopes are available below `DT_FIXTURE_PATH` for the project's own test producer. Binary/Avro/Protobuf codecs and real broker lifecycle remain the project's explicit responsibility.

The runner additionally receives:

- `DT_SCENARIO_PACKAGE`: the verified package JSON path.
- `DT_SCENARIO_OUTPUT`: the new report path under the workspace's `target/` or `build/` tree.

The previous report is deleted before execution. Actual application/test code independently collects results and writes:

```json
{
  "version": 1,
  "artifact": "<package sha256>",
  "actions": ["<performed-action-id>"],
  "observed": {
    "<return-expectation-id>": { "orderId": "42", "status": "RELEASED" },
    "<pg-expectation-id>": [{ "tenantId": 11, "orderId": "42", "amount": "100.000001" }]
  }
}
```

Do not copy expected values into `observed`: query the replay database, inspect the real HTTP response, consume the scratch output topic or inspect the actual file. Every action must be accounted for once, and every required expected effect is checked by the shared checker. Missing/stale reports, extra observations and wrong values fail the scenario even when JUnit itself passes. The live Java integration test deliberately changes a package expectation while all four project tests pass and proves that the portable scenario still fails.

This adapter reports project build/test proof. Its dependency routing and egress are owned by the reviewed project harness; a green JUnit report is never reported as exhaustive runtime-read coverage. Native PG/HTTP/files are directly observed where the supported adapter defines them. Broader protocols require real project adapters rather than synthetic success claims.

## Language-neutral contracts and replaceable implementation

`schemas/scenario-package-v1.json` defines the structural contract. All values are JSON. IDs identify dependency/action/expectation obligations; display names never silently rebind them. Resource text has SHA-256 fingerprints. The outer digest is SHA-256 over recursively key-sorted UTF-8 JSON without the outer `sha256` field. Keys use UTF-16 lexical order, strings and finite numbers use JSON/ECMAScript serialization, and array order is retained. Numeric-string object keys are sorted lexically too. Metadata timestamps/traces and ephemeral state capture references are removed when packaging; identically named business payload fields are preserved. Source-relative paths, revisions and provenance remain evidence. The nested `inventoryHash` is an existing producer identity; the package normalizes keys before calculating it for compatibility with the original scenario stages. Foreign implementations can preserve that opaque producer identity and independently verify the language-neutral outer/resource hashes.

A Go/Rust/Python implementation can consume this artifact and emit the same version-1 observation report. The current language-neutral integration point is a reviewed project test adapter; it can invoke its own harness and write the report. The existing tool HTTP/CLI boundaries can independently replace discovery, capture, action, observation or assertion stages. No module's internal JavaScript object is part of the portable format. Preserve these invariants in any replacement:

- Bind every required read and retain ambiguity/gaps and source revisions.
- Keep observed results separate from independently supplied expectations.
- Verify digests and exact artifact/action identity before accepting a report.
- Preserve strict unexpected effects and explicit deadline/quiet-window semantics.
- Label proof as discovery, local model, actual process or actual project build; never upgrade model proof into service proof.
- Retain `runtimeReadsVerified:false` unless actual instrumentation establishes coverage.

Unknown future package versions fail explicitly. Handler/dependency changes produce a semantic `scenario_diff` keyed by stable IDs; they require an explicit new binding and package rather than an automatic name-based migration.

## Lifecycle and evidence

Sessions have unique durable IDs, expiry and ownership labels. Cross-process startup reservations and a default capacity of two concurrent sessions bound resource use; `tests.scenarioConcurrency` can choose 1–8 when exposed by the host configuration. Session records are atomic, and simultaneous actions/observations on one session fail with an explicit busy result. `scenario_stop` checks both labels before removing a container and is idempotent. `scenario_cleanup` recovers expired sessions after interruption and stale startup reservations whose owning process died. Failed readiness cleans up immediately and retains logs. Evidence remains inspectable after stop, including actual responses, calls, files, assertion results, timing and network/proof boundaries. The interactive view is on by default; `view:false` disables it per call.

The supported Node path exercises A01/A03/A04/A06/A07/A08, E05 and the HTTP/file portions of F01–F04/F08/F09; it does not complete the entire review's native broker/ES/cache/queue roadmap. `test/scenario-runtime.test.js` has offline contract/adversarial checks plus opt-in real Docker execution with `DT_TEST_DOCKER=1`. `test/reproduction.live.test.js` exercises real capture → portable package → two replay databases → Java code → independent observed report → shared assertion, including the negative case.
