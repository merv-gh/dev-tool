# Operator guide

This is the operational entry point for a local or internal-team deployment. Use
[known limitations](known-limitations.md) to judge evidence and
[the roadmap](roadmap.md) to distinguish shipped behavior from future work.

## Choose a deployment

| Profile | Authentication | Storage / workers | Intended use |
| --- | --- | --- | --- |
| Local, default | Existing API-key / localhost / trusted-network behavior | Local files, optional SQLite, bounded workers | One trusted operator; existing installations retain their behavior |
| Team, explicit | Every protected request requires a token, including localhost and trusted proxies | One coordinator, local SQLite WAL, isolated read/build/semantic workers | Cooperating internal users with separate principals/tasks |

The target workload is ten environments, one million catalog objects and fifty
active agent sessions. That is an engineering target, not an unmeasured production
guarantee. [Benchmark artifacts](benchmarks/catalog-scale.json) record the actual
host, source digest, workload, latency and limits. A catalog object is a table,
function, index, topic or another named metadata object, not a database row.

The normal update remains:

```sh
git pull
./run.sh up -d
# Or attach the tool server to an existing chat UI:
./run.sh --no-webui up -d
```

Use a local persistent filesystem for SQLite, repository indexes and build state.
Do not point multiple coordinators at one shared network volume. The metadata
worker and read workers are not a distributed scheduler. See
[operational metadata](operational-metadata.md) for WAL durability and backup.

## Enable team access

Run `node cli.js doctor --security` before changing the profile. Configure secrets
through environment references; never commit values:

```json
{
  "server": {
    "securityProfile": "team",
    "publicUrl": "https://tools.example.internal",
    "allowedOrigins": ["https://tools.example.internal"],
    "trustedProxies": ["127.0.0.1"],
    "accessTokens": [
      {"id":"investigator-current","principal":"investigator","token":"${INVESTIGATOR_TOKEN}","role":"user","envs":["dev","uat"],"tools":["find","catalog_search","catalog_usage","pg_*","tool_*"]},
      {"id":"operator","token":"${OPERATOR_TOKEN}","role":"admin"}
    ]
  }
}
```

Only the configured proxy's exact socket IP may supply forwarded transport
headers. Identity always comes from the access credential, never those headers.
Put TLS at a private gateway; [the Nginx example](../dev/deployment/gateway.conf)
keeps the application port private. Team mode ignores `DT_TRUST_NETWORK` as an
authentication shortcut. `DT_SECURITY_PROFILE=team` overrides the config profile.

HTTP/MCP clients send `Authorization: Bearer …` and `X-DT-Story`. Browser operators
open Admin and use its token form; team login uses a POST and a Secure, HttpOnly,
SameSite cookie. Do not use URL query tokens in team mode. Browser origins are
allowlisted; cookie mutations require an allowed Origin. Machine Bearer requests
may omit Origin. Unsupported MCP versions negotiate the tested 2025-03-26 baseline.

For rotation, give the replacement credential a new `id` and the **same principal**.
Both may coexist during a short overlap. Remove/revoke the old entry or set its
`expiresAt` to an ISO timestamp. A revoked/expired credential is rejected on new
requests. Rotation preserves task ownership; changing the principal does not.
Optional `envs` and `tools` lists restrict access; omission preserves existing
access policy. Tool patterns accept an exact name or a trailing `*`. A restricted
principal must also be allowed any discovery/dispatch wrapper it uses.

Environment grants govern environment-bound operations. They do not redact every
shared knowledge document or revoke an already shared read-only result URL.
Shared project understanding remains readable by everyone; admins publish.
Trusted builds and in-process plugins inherit host capabilities. Task ownership
is not an operating-system boundary for hostile tenants.

## Plugin activation and trust

In team mode, remote plugins require HTTPS and a configured SHA-256 digest.
Verify/review the source before approving that digest; an integrity hash alone
does not establish publisher trust. Prefer immutable upstream commit references.

```json
{"tools":{"plugins":[{"url":"github:organization/extensions/tool.js@immutable-commit","sha256":"approved-content-digest"}]}}
```

Downloads have a two-MiB limit, reject redirects and verify content before atomic
installation. Cached bytes are checked again before execution. The adjacent
`cache/plugins/*.js.json` lock record retains source, digest and download time.
An invalid candidate cannot replace a previously verified registry. Admin shows
the rejected reload; fixing/removing the configuration is explicit.

Local mode remains compatible, including unpinned URLs, and the security doctor
reports the migration work. Local plugins remain trusted executable code in both
profiles. Use [external adapters](adapter-contracts.md) when an extension needs a
separate runtime or trust boundary.

## Catalog refresh, search and history

`catalog_sync` refreshes configured sources; `what=index` only derives indexes from
retained metadata. Duplicate refreshes share one producer but keep private job
handles. Cancelling one handle detaches that requester; the last cancellation
stops the producer. Responses include the execution ID and an Admin execution link.

Raw PG catalogs retain the paged format. Derived names and detected usage edges
live in `cache/<env>/catalog.sqlite`. SQLite work runs in bounded workers. A
transaction publishes the whole generation; readers keep their selected version
while a refresh runs. A failed or cancelled write does not publish partial data.
Identical inputs skip the derivation. Changed records retain previous versions;
`catalog.txt` is streamed as the compatible grep surface.

`find` keeps its array-of-lines response and matching rules. `catalog_search`
returns an explicit generation, results, completeness and continuation cursor.
`catalog_usage` pages detected relationships in either direction. Private manual
corrections are still composed by `pg_usage`. Very large legacy usage responses
ask the caller to page instead of pretending a truncated answer is complete.

```sh
node cli.js tool catalog_search '{"env":"dev","q":"pg: refund","limit":50}'
node cli.js tool catalog_usage '{"env":"dev","object":"orders:sales.refunds","limit":50}'
node cli.js tool catalog_manage '{"env":"dev","action":"list"}'
```

Pass the returned cursor unchanged to continue the same query. A cursor cannot
be reused with another query/environment or conflicting generation. Missing
historical generations fail explicitly. Older Node installations without
`node:sqlite` retain bounded streaming `find`; stable pagination requires SQLite.

There is **no automatic generation deletion**. Use `catalog_manage pin` before
keeping an external generation reference. Serialized catalog-page results saved
as result views, task JSON evidence or shared project JSON files register
conservative references automatically. These survive moving/archiving the file.
The reference registry is bounded to 10,000 entries per environment. Release an
obsolete reference explicitly with `references` / `release_ref` while selecting
its owner/task, then unpin and collect the exact generation with `gc`. Current,
pinned and referenced generations cannot be collected. Failed saves can leave a
conservative reference; release it only after checking the artifact.

These generations retain discovery lines and usage evidence. They are not full
database snapshots; copy required function bodies, schemas and observations into
reproduction resources before relying on them after a source refresh.

## Capacity and live-system protection

Cached reads use a separate four-worker pool, 64 MiB heap per reader by default.
`tools.catalogReadConcurrency` and `tools.catalogReaderHeapMb` configure it. The
existing CPU/build budgets remain separate; aggregate heap limits are not RSS.

Live calls retain the conservative default rate. Per-target budgets also limit
in-flight operations, rotate queued tasks fairly and reject excess waiting work
with a typed error and HTTP `Retry-After`. Rate limiting protects upstream systems;
it does not serialize cached search.

```json
{"server":{"networkBudgets":{"pg:dev":{"ratePerSec":2,"concurrency":4,"maxQueued":100,"maxWaitMs":30000}}}}
```

An exact key takes precedence over a source wildcard such as `pg:*`. Targets are
source/environment keys used by the registered tool; custom HTTP tools use their
configured host key. Timeout, cancellation and overload do not automatically
repeat a side effect whose outcome may be unknown.

## Monitoring and recovery

Admin Runtime shows process RSS, event-loop delay, worker/queue budgets, exporter
failures and indexed generation/freshness. Select the execution linked by a job
to inspect progress and cancellation. Local diagnostics work without a collector.

```sh
./run.sh --no-webui --observability up -d
```

This adds a bounded Collector, Prometheus and a provisioned Grafana dashboard.
Prometheus is on localhost:9090 and Grafana on localhost:3300. Grafana is an
anonymous read-only local viewer with initial admin creation disabled. Keep these
ports private. Existing profiles stay unchanged without `--observability`.
Container versions are pinned to release tags; production operators can use
registry-verified image digests. Upstream release references:
[Collector](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.164.0),
[Prometheus](https://github.com/prometheus/prometheus/releases/tag/v3.16.0),
[Grafana](https://github.com/grafana/grafana/releases/tag/v13.3.0).

The flag enables aggregate metrics and defaults OTLP to the local Collector.
Alternatively set `telemetry.operationalMetrics=true` or
`DT_OPERATIONAL_METRICS=1` and your existing OTLP endpoint. Metrics exclude mutable
payloads and task identifiers. Traces remain separately opt-in per task. The sample
Collector exports metrics to Prometheus and trace summaries to its log; Admin
retains local traces. Configure its trace exporter for your external backend.
Restart after changing exporter configuration.

`DT_LOG_FORMAT=json` sends correlated redacted tool/job events to stderr; CLI
results remain JSON on stdout. Startup diagnostics can still be text. Operational
logs retain their existing payload/redaction policy; content-free tracing has a
separate policy. See [tracing and coverage](observability.md).

Back up configuration/secrets separately from operational state. Flush/stop SQLite
writers before copying databases, or use a proper SQLite backup. Copy paged raw
manifests with their referenced data/header files. Keep immutable index history,
catalog references, task contexts and shared project publications together. Restore
to one stopped coordinator, validate the security profile, then start readers.

## Release evidence

The retained [implementation verification](benchmarks/team-readiness.json) records
the local test, browser, coverage and capacity results, their source identities
and the integrations that still require hosted execution. Admin examples:
[desktop](screenshots/team-runtime-desktop.png) and
[mobile](screenshots/team-runtime-mobile.png). Both use disposable synthetic data.

Pull requests run Node 22/24, bundle/chart/docs/inventory checks, disposable PG
integration, coverage gates and browser workflows. Nightly/manual deep verification
adds the million-object benchmark, actual native PG/Kafka/ES replay, JVM execution
and Joern. Required integration groups fail if a prerequisite causes a skip.
Tag releases run deep verification before packaging coverage, inventories, an SBOM
and an attested standalone artifact. These workflows must actually pass on the
candidate commit; adding their YAML is not a claim that hosted checks ran.

The [tool verification inventory](benchmarks/tool-verification.json) maps every
built-in tool to schemas and test references. A reference is not proof that every
path executed. Use source/lifecycle coverage, browser reports and live artifacts
together. Historical reports remain dated evidence, not current release gates.
