# Requests, tracing and test evidence

[Verification record](benchmarks/observability-verification.json) ·
[Desktop, mobile and inline examples](screenshots/README.md#tracing-and-test-evidence)

## Requests and model activity

[Request-journal verification](benchmarks/request-events-verification.json).

Open **Admin → Runtime → Requests & models**. This searchable journal records
tool invocations and instrumented model helper calls without requiring diagnostic
tracing. Filter by time, task, tool/model, purpose or outcome; select a request
for elapsed time, HTTP status, response size, reported tokens, execution/trace
links and an existing result view when available. Expand the traffic histogram
or initiator groups to narrow the same query. **More** exports the displayed
evidence with window totals or copies a filtered Admin link. Shared links retain
normal authentication and scope checks; they do not grant access.

```sh
node cli.js tool observability '{"mode":"events","kind":"model","outcome":"capacity"}'
```

The same view embeds in Open WebUI. Inline results are snapshots: their filters
apply to displayed rows, while window statistics retain the original server
query. Admin refresh queries retained events again. Request inspection never
replays work or calls the model. HTTP readers are also available at
`/api/admin/runtime/events` and `/api/admin/runtime/events/<id>`.

Model purposes distinguish Admin suggestions/interpretations, context hints,
documentation reranking, vision, relation extraction and embeddings. Calls made
by an external client appear only when routed through the optional gateway
below. A direct **Open WebUI → GPUStack** connection is outside this journal;
an empty model count does not prove that client made no requests.

Counts and median/p95 use all retained matching events, independently of paging.
Time filters select request starts. Dispatcher wrappers remain visible but are
excluded from **Tool targets**. An invocation completing does not mean its test
assertions passed: application verdicts are recorded separately. Background jobs
are pending at invocation return; follow the execution in Activity/Jobs for the
later job outcome. Request duration is wall time, including waits. Response
headers and first observed streaming content/tool delta are distinct timings;
nonstreaming responses have no first-content measurement. Token usage is
provider-reported; missing usage is **unknown**, never inferred as zero. Peak
concurrency is what this process observed at request start, not GPUStack's total
load. HTTP 429/503/529 are investigation signals, not a diagnosis of GPU overload.

The journal retains safe metadata, including owner/task, model, endpoint origin,
purpose, status and byte/token counts. It excludes arguments, prompts, SQL,
response bodies, credentials and exception messages. Existing result links use
their own retention/access rules. Search covers metadata only. Readers see their
authenticated chat/task; installation-wide queries require an administrator.
Retention is bounded to seven days and 25,000 events across the installation,
with a 2,048-record/8 MiB writer queue and at most 1,024 active requests. A SQLite
worker writes `cache/telemetry/requests.sqlite`; storage failures/dropped writes
are visible and never fail or retry business requests. A process interrupted
before recording an end leaves **End unobserved**. This is operational evidence,
not a complete audit log. Disable capture with `DT_REQUEST_EVENTS=0` or
`telemetry.requestEvents=false`; retained evidence remains readable. Aggregate
model call counters join existing optional operational metrics, while sampled
OpenTelemetry model spans require the existing per-task tracing opt-in.

### Observe Open WebUI requests through the optional gateway

The gateway is off by default. Keep the operator's `llm.baseUrl` pointing at the
real upstream API, for example:

```json
{"llm":{"baseUrl":"https://gpu.example/v1","key":"${LLM_API_KEY}","model":"qwen3.8-27b","gatewayEnabled":true,"gatewayModels":["qwen3.8-27b"],"requestTimeoutMs":300000}}
```

Alternatively set `DT_MODEL_GATEWAY=1`; Compose forwards that setting. For the
Open WebUI connection you want to observe, use `https://dt.example/model/v1` as
its OpenAI-compatible API base and an existing **dev-tool access token** as its
key. Keep the GPUStack key only in dev-tool's upstream configuration. The gateway
uses normal server authentication and requires the `context_hint` tool permission
for scoped tokens. Models are restricted to `gatewayModels`, or `llm.model` when
the allowlist is omitted. `/model/v1/models` lists that configuration locally.
Do not point `llm.baseUrl` at the gateway itself. Configure these explicitly;
installing this feature does not rewrite any client connection.

Each completion forwards one JSON payload once, including the caller's stream
and usage options. It preserves upstream status/body, SSE bytes and Retry-After,
applies stream backpressure and aborts on client disconnect or the configured
deadline. It adds no retries, admission control or automatic compaction. Metadata
parsing is bounded (64 KiB SSE lines, 2 MiB nonstreaming JSON); larger payloads
still pass through, with unavailable usage left unknown. An SSE stream ending
without `[DONE]` is marked incomplete. The raw response still reaches the client;
it is not copied into the journal.

Chat attribution uses the authenticated scope and existing supported chat/task
headers (`X-OpenWebUI-Chat-Id`, `X-Chat-Id`, `X-DT-Story`) or a story-bound token.
Without a chat identity the purpose is **Unattributed client call**. A shared
token without per-chat identity aggregates calls in its default scope; it cannot
provide per-person attribution. Open WebUI title/tag/follow-up calls passing
through this connection count too, but are not guessed from prompt text. Direct
calls through other connections stay invisible. Validate your client's headers
and chosen connection with a small task before using counts to assess load.

Run `node demo/request-events.js` for disposable local fixture traffic, a
synthetic 503 response and the native inline explorer; no model is contacted.

## Diagnostic traces

Open **Admin → Runtime → Traces & observability**, choose the intended chat/task,
and enable tracing. Run a tool, then refresh the trace explorer. Each chat starts
with tracing off. A saved preference applies only to its authenticated scope;
an incoming `traceparent` never enables tracing by itself. Trace IDs are correlation
IDs, not authorization. Existing diagnostic history remains readable after tracing
is disabled. Arguments, outputs, SQL, request headers, query strings, source text
and exception messages are excluded from this telemetry stream.

The `observability` tool produces the same interactive view in Open WebUI. Select
a span to inspect its parent, execution ID, outcome and state transitions. Export
the snapshot as Chrome Trace Event JSON for Perfetto. Running spans remain open;
exporting does not stop work or fabricate a completion time. Producer interruption
and process restart leave an end-unobserved marker. Durations include waits and
are not CPU measurements. Child-process tracing covers runner command wall time,
not JVM bytecode or subprocess CPU profiling.

## Aggregate operational monitoring

Aggregate monitoring is separate from task trace consent. Set
`DT_OPERATIONAL_METRICS=1` or `telemetry.operationalMetrics=true` to export bounded
operation counts/durations, scheduler queues, process memory, event-loop delay,
catalog freshness, incomplete cleanup and telemetry health. Labels use fixed
operation/resource categories and configured environment names, not task IDs,
SQL, URLs or result payloads. Disabling a task's tracing does not disable these
operator-approved aggregate metrics. Restart after exporter configuration changes.

`./run.sh --observability up -d` enables the optional local Collector/Prometheus/
Grafana profile. It is off by default and adds no required runtime dependency.
[Operator setup, privacy boundaries and recovery](operator-guide.md#monitoring-and-recovery).
The sample Collector logs trace summaries; local retained traces remain in Admin.
Configure the Collector's trace exporter to use your existing external backend.

`DT_LOG_FORMAT=json` selects structured correlated tool/job events on stderr;
startup diagnostics can still be text. Operational logs keep their existing
redaction/payload rules, separately from content-free OTLP traces and metrics.

## Instrumented boundaries

| Boundary | Evidence |
| --- | --- |
| Authenticated tool/MCP HTTP request | W3C context, method and route template |
| Owned execution and job | Execution ID, parent, final lifecycle state, cancellation and incomplete cleanup |
| Tool and known preparation step | Bounded operation name and parent span; dynamic step contents are omitted |
| Worker mailbox | Explicit context carrier; child spans are forwarded to the owning process |
| Build runner HTTP | Explicit authenticated carrier and return stream; metadata is kept out of the build environment |
| Read-only Postgres transaction | Transaction duration and safe failure category; SQL and bindings are omitted |
| Shared HTTP adapter | Request duration and method; URLs, headers and response bodies are omitted |
| Lifecycle transition | Model, source/target state and accepted/rejected outcome; at most 32 events per span |

Existing operational logs also carry trace/span correlation IDs when tracing is
active. Their existing retention and redaction rules remain separate from the
content-free OpenTelemetry stream. Tracing does not install blanket HTTP/database
auto-instrumentation that might record application payloads or instrument its own
storage/export requests.

Local traces use `cache/telemetry/traces.sqlite`, independently of operational
history. A dedicated worker writes batches of at most 128 records with WAL.
The producer queue is capped at 2,048 records and 8 MiB; retention is 25,000 spans
across the installation. Limits bound retained diagnostic data, not business
operations. Diagnostic drops and storage/export failures are visible to operators;
telemetry failures do not fail or repeat tools. Local active spans and read caches
are bounded too. Trace readers filter by authenticated scope, including retained
records after restart. Operator-wide health counters are shown only to admins.

## Optional OTLP export

Local capture works without a collector. To export, set these environment values
before starting the app (Compose passes them from `.env`):

```dotenv
OTEL_SERVICE_NAME=dev-tool
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
OTEL_EXPORTER_OTLP_HEADERS=
```

The implementation uses the official OpenTelemetry JavaScript API and SDK with
batched **OTLP/HTTP JSON** exports to `/v1/traces` and `/v1/metrics`. It does not
accept a gRPC endpoint. Signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` values are complete endpoint URLs. Standard
exporter authentication headers belong in the environment, not a chat or trace.
No export is configured by default. Exporter configuration is captured lazily at
first traced use; restart after changing it. Admin reports when a restart is needed.

The equivalent `config.json` group is:

```json
{"telemetry":{"enabled":true,"endpoint":"${OTEL_EXPORTER_OTLP_ENDPOINT:-}","sampleRatio":1}}
```

`enabled` permits per-chat opt-in; it does not switch tracing on for every chat.
Set it to `false`, `DT_TELEMETRY_ENABLED=0`, or `OTEL_SDK_DISABLED=true` to disable
the capability. Sampling is parent-based; `sampleRatio` controls new root traces.
Unsampled parents remain unsampled. Metrics use operation category and outcome,
without chat IDs, repository names, URLs or tool arguments as metric labels.

## Test coverage you can inspect

Run these commands from the repository checkout:

```sh
node dev/state-machines.js --check
npm run build
npm run test:coverage
npm run build
npm run build:check
```

Then open **Admin → Runtime → Test coverage**, or call `test_coverage` to embed
the report in Open WebUI. The generated report is portable and ships inside the
standalone bundle. A local report at `cache/diagnostics/coverage/latest.json` takes
precedence. The report includes a digest of runtime sources, test command, Node
version, test counts and run scope. The source digest is embedded in the bundle;
reports for other source content are visibly stale. The post-coverage build ships
the newly generated artifact and keeps `dist/` current.

Select a lifecycle and a transition to see the files that actually exercised it.
Solid green edges were observed in passing files; dashed amber edges lack that
evidence. Rejected transitions are shown separately. Model-vocabulary checks do
not count as exercised behavior. Transition attribution is **per test file**;
listed case names describe that file and do not prove which assertion covered an
edge. Files with failures do not establish verified coverage. Self assignments
and pure `next()` validation calls do not inflate the edge count.

Select **Source files** for line/function/branch coverage, exact missed executable
lines, and source inspection when a checkout is available. Unloaded files are
listed as **not measured** and are not silently discarded. V8 percentages describe
measured sources only. Browser-only execution is outside Node's source-coverage
run; real browser checks are separate evidence. Fixed-heap stress subprocesses
disable inherited V8 profiling so profiling overhead does not change their memory
measurement or deadline; their behavioral assertions still run. A loaded line, observed edge or
passing invocation does not prove all inputs, races, assertions or cleanup paths.

For a focused investigation:

```sh
npm run test:coverage -- test/telemetry.test.js test/runner.test.js
```

This produces an explicitly labeled selected-files report. Run the full command
again before using the report to assess release coverage. Failed runs retain their
observations and a failure banner; they are never relabeled as passing.

## Design references

[Happen's tracing design](https://github.com/meoyawn/happen/blob/d13a5de54d1137e1d966c41a1560dcab254e97ec/packages/telemetry/README.md)
informed per-session opt-in, explicit worker carriers, separate bounded diagnostic
storage, content exclusion and collector-independent trace export. Its
[verification procedure](https://github.com/meoyawn/happen/blob/d13a5de54d1137e1d966c41a1560dcab254e97ec/docs/verification.md)
informed tests at real transport/storage boundaries and reproducible evidence
that states its limits. These are adapted design principles; no Dart runtime or
Happen dependency is required. SDK setup and batching follow the official
[OpenTelemetry instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)
and [exporter guidance](https://opentelemetry.io/docs/languages/js/exporters/).
