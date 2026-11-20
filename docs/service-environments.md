# Run a service branch in a disposable environment

Open **Admin → Service environments**, or discover `service_env_plan` through
MCP/OpenAPI/CLI. A named definition describes workspace services and their
dependencies. A run is a private, durable lease on actual application containers,
optional scratch database clones and exclusive Kafka/Elasticsearch resources.
Closing the chat or browser does not stop a run. Explicit Stop or lease expiry
does. Existing source environments are never an implicit fallback.

## First run

1. Open the required branch/commit with `workspace_open`. Select its workspace
   in the supervisor. Multiple services can use different workspaces/revisions.
2. Create a definition and choose the module, readiness path and HTTP port.
   Spring builds use the root Maven/Gradle wrapper and the normal `package` or
   `bootJar` path, including annotation processors such as Lombok. An existing
   bootable jar can instead be selected with `build:"none"`.
3. Add only the required dependencies. PostgreSQL uses an initialized dedicated
   scratch cluster and an immutable `testdb_template_build` key. Map each logical
   database to the application's property prefix. Kafka takes explicit topic
   names/partition counts; Elasticsearch takes explicit indices and optional
   mappings/JSON seed documents. Include connections opened during startup and
   background work, not only the selected request path.
4. **Save definition**, then **Check worker & images**. **Prepare images** is an
   explicit administrator job; ordinary starts do not pull images implicitly.
5. **Start services**. The returned run/job is immediate; inspect
   `service_env_status`, progress events, logs and the first readiness failure.
6. Use **Application bindings & properties**, **Inspect with a request or query**,
   and **Java debugger**. Requests go through the backend worker. Save reusable
   `service_env_request` tool steps in a normal named script/collection, passing
   the run ID as a parameter.
7. Renew for a longer investigation, or **Restart with fresh state** after an
   edit. Restart/reset currently stop the previous run and allocate a new clean
   run; they do not hot-swap a JVM while preserving a mutated database. Poll until
   cleanup completes, then retry the reset if it returned `stopping`. Re-read the
   new run's bindings. Stop when finished; retained evidence remains available.

Example definition (replace the workspace ID and template key):

```json
{
  "version": 1,
  "name": "order-retry-investigation",
  "context": "order-retry-task",
  "ttl_ms": 1800000,
  "services": [{
    "name": "orders",
    "workspace": "orders-feature-workspace",
    "adapter": "spring-boot",
    "module": ".",
    "port": 8080,
    "health_path": "/actuator/health",
    "debug": true,
    "datasources": {"orders": "spring.datasource"},
    "properties": {"billing.base-url": "${DT_ENV_SERVICE_BILLING_URL}"}
  }, {
    "name": "billing",
    "workspace": "billing-pinned-workspace",
    "adapter": "spring-boot",
    "module": ".",
    "port": 8080,
    "health_path": "/health"
  }],
  "dependencies": {
    "postgres": {"template": "<64-character immutable template key>"},
    "kafka": {"topics": [{"name": "orders.paid", "partitions": 2}]},
    "elasticsearch": {"indices": [{"name": "order-read"}]}
  },
  "assumptions": ["Schedulers disabled in the reviewed local application profile"]
}
```

Definitions are data, not arbitrary shell command templates. The source branch
is selected by `workspace_open`; builds record its commit and source fingerprint,
and the worker records the exact staged artifact digest. Editing a workspace does
not change an already running JVM. An application can have no Git history; its
source and artifact fingerprints still identify the executed bytes.

## Configuration for the application and model

`service_env_plan` returns source-file templates before startup.
`service_env_bindings` supplies actual allocated bindings once dependencies have
been prepared, including during application startup. It distinguishes the
application-container audience from backend/browser access. For example:

```properties
spring.datasource.url=${DT_ENV_PG_ORDERS_JDBC_URL}
spring.datasource.username=${DT_ENV_PG_ORDERS_USERNAME}
spring.datasource.password=${DT_ENV_PG_ORDERS_PASSWORD}
spring.kafka.bootstrap-servers=${DT_ENV_KAFKA_BOOTSTRAP_SERVERS}
spring.elasticsearch.uris=${DT_ENV_ELASTICSEARCH_URIS}
billing.base-url=${DT_ENV_SERVICE_BILLING_URL}
```

The supervisor injects the corresponding environment variables and generated
Spring JSON configuration. Owned datasource/Kafka/ES bindings take precedence
over conflicting custom properties. Private scratch passwords are omitted from
normal exports; `reveal_secrets:true` explicitly returns them for manual use.
Keep those values out of Git, global knowledge and shared page definitions.

Use `read_path` to inspect a properties file's revision through the selected
run, including from another chat. Supplying `write_path` and `expected_revision`
explicitly saves a managed configuration block, preserving unrelated contents.
`expected_revision:null` creates a file. Stale edits are rejected. Nothing is
written to a workspace merely by planning, starting or reading bindings.

Container URLs such as `http://billing:8080` are for the application network.
Use `service_env_request` for browser/backend HTTP, SQL, ES and Kafka access;
do not paste container DNS into a browser URL. The worker uses a private PG
gateway to its scratch cluster. Host-worker loopback databases use a worker TCP
forwarder, re-established on reconciliation; those connections can reconnect
after worker restart. Docker-container workers join each owned bridge and use
unique container DNS names for observations. The application gets no Docker
socket and no broad attachment to dt's control network.

Snapshot replay disables Flyway/Liquibase, SQL initialization and Hibernate DDL
updates. To test a schema change, prepare and verify an upgraded immutable
template with the existing template workflow. This release does not claim a
general application-driven Flyway/Liquibase migration adapter. Consul discovery
and config are disabled in the generated local configuration; explicitly map
inter-service URLs. Other external providers, custom datasource properties,
secrets and bootstrap behavior need a reviewed profile. Outbound network access
is permitted; these containers are not an untrusted-code egress sandbox.

## What survives and who can resume it

Definitions and run records live in `DT_HOME/service-environments`, scoped by
authenticated principal rather than transient chat ID. Selecting a definition,
run or evidence ID is explicit resume; another user cannot enumerate or operate
it. The definition remembers the original workspace/context scope without
restoring old administrator permissions. A stable `continuation` may also be
linked. Copyable resume links require the same user's access; they are not bearer
links granting another person the run.

Definition updates require the previous revision. Immutable versions and each
run's frozen definition remain available. Optional context/continuation JSON
exports have independent revision checks: a manually changed export is preserved,
and the definition receipt reports its export conflict separately. Read a saved
version with `service_env_plan(id)` and deliberately save its definition as a new
current revision to restore it. Running containers retain their own immutable
artifact volumes even if a workspace expires; rebuilding/editing later still
requires its workspace or an explicit checkout of that revision.

Each request/query reserves private evidence storage before being sent, then
retains redacted arguments, result/failure, time and run ID. Read an evidence ID
with `service_env_status` without replaying the action. Evidence is available in
the supervisor after Stop and in another chat owned by the same principal.
Pending evidence after interruption is not proof that the request did nothing;
inspect the application before repeating an operation with effects.

The worker journal lives under its durable `DT_HOME/service-runtime`. Standard
Compose now places the runner home in the existing build volume. Named services,
artifact volumes, bridge networks, labels, lease capability, generation and expiry
are persisted before allocation. A tool connection is an observer, not a process
owner. A ready environment is reconciled after worker restart; interrupted
preparation is compensated rather than automatically replayed. When startup
fails, retain logs/outcome and release owned resources. Ownership mismatches and
cleanup failures remain visible and retryable. Databases are released only after
container cleanup succeeds.

The runtime worker checks leases every 15 seconds while running; the coordinator
reconciles and releases database leases every 30 seconds. If **both are stopped**,
no in-process janitor can enforce time-based cleanup; reconciliation resumes when
one returns, and the coordinator handles its PG leases on return. Stopped evidence
has no automatic expiry. SQLite/JSON are local to one coordinator; this does not
add horizontal failover or distributed worker placement.

## Warm capacity, limits and observability

**Warm dependencies** prestarts an exclusive, clean Kafka/Elasticsearch slot for
a later matching definition owned by the same user and worker. Starting services
claims it once with a new generation and adds fresh PostgreSQL clones/application
artifacts. A used slot is never recycled as clean. Stop removes its resources.
This implementation uses explicit prewarming; automatic spare replenishment,
shared broker namespaces and ES copy-on-write base indices remain future
optimizations. PostgreSQL native template copies still have size-dependent costs.

Defaults are four worker leases and a 6,144 MiB aggregate reservation budget,
including application limits, dependency limits and helper headroom. Configure
`DT_SERVICE_ENV_CAPACITY` and `DT_SERVICE_ENV_MEMORY_MB` for the actual host.
`DT_SERVICE_ENV_NODE_IMAGE` and `DT_SERVICE_ENV_JAVA_IMAGE` choose compatible
preloaded runtime images; Compose follows its existing Node/Maven image settings.
If a worker has multiple upstream networks, set
`DT_SERVICE_ENV_UPSTREAM_NETWORK` to the scratch database's reachable network.
The worker uses Docker Engine HTTP directly and needs no Docker CLI.

Definitions support up to eight services, 100 topics, 50 indices, 2,000 seed
documents per index and 2 MiB of definition JSON. Source/artifact staging is
bounded to 256 MiB; Node staging supports at most 10,000 regular files and short
tar paths, with existing dependencies already installed. Models should capture
small coherent data slices instead of copying an environment wholesale.
Retained private runtime requests reserve up to 16 MiB each, with 1,000 records
and a 512 MiB per-user storage budget. Exhausted storage prevents a new action
from being sent. Operational records have bounded counts; long-term archival and
storage policy must be managed before those limits are reached.

API sends, queries and lease commands use the existing WebSocket command channel
with HTTP fallback. The supervisor polls durable state for progress/reconnect;
it never retries Start to obtain progress. Worker events retain stage and time,
service status records exact source/artifact identity, and standard job/runner
telemetry captures build calls. Dependency preparation and application-ready
timings are separate. No model call is needed to provision or observe a lease.

## Debug and prove a change

Enable `debug:true` on the Spring service before starting. `service_debug` supports
attach, class-line/method breakpoint, clear, events, threads, stack/locals, resume
and detach. It runs a JDI helper in an owned JDK container. JDWP stays on the
private bridge; no public debugger port is published. Breakpoints suspend the
event thread and auto-resume after 60 seconds. Locals are bounded values/object
identities; no application method or arbitrary expression is evaluated.

Use Joern/passport paths to choose candidate locations, including methods in
internal libraries. Exact loaded classes and their debug metadata determine
whether a breakpoint resolves; generated sources or stripped local-variable
metadata can remain explicit gaps. A `breakpoint-hit` event is execution evidence;
a static data-flow graph is not. Pausing can change HTTP deadlines, Kafka group
behavior and database lock timing, so record that perturbation.

For a branch comparison, allocate **two runs** at pinned source revisions with
the same immutable template and saved action inputs. Execute HTTP/listener
actions and compare their actual responses, read-only database queries, declared
index searches and topic snapshots. `kafka-read` reads to the current log end;
it does not wait forever for future messages. A passed healthcheck alone does not
prove a business path or all its conditions. Freeze independently expected
outcomes before evaluating the fix.

## Demo and verification boundaries

```sh
node demo/service-environments.js
node dev/check-service-environments.js
node --test test/service-environments.test.js test/service-env-engine.test.js test/service-debugger.test.js
```

The demo runs real local Node applications through a **Docker protocol fixture**;
it creates no Docker containers or customer resources. The browser check exercises
save/start, binding export, backend API send, log inspection, reload/resume, Stop,
WebSocket transport and desktop/mobile layout. The JDI test compiles and runs a
real local JVM and verifies breakpoint → locals/stack → resume → detach. Neither
is a claim that customer Spring builds, Docker topology, PostgreSQL, Kafka and
Elasticsearch were live-verified together on this machine.

The new lifecycle tests also cover idempotency, stale file/control revisions,
principal isolation, supervisor reconstruction, expiry, retryable cleanup,
cancellation during upload, lost start acknowledgement, root-wrapper Maven
module planning and structured PG endpoint conversion. Full native container
validation requires a reachable Docker daemon and compatible preloaded images;
the local Docker probe timed out here. Run the opt-in live regression
before certifying a deployment's complete native stack:

```sh
# Docker: actual artifact staging, HTTP and supervisor reconstruction
DT_TEST_SERVICE_ENV_DOCKER=1 node --test test/service-environments.live.test.js
# Add exclusive Kafka/ES setup, seed/search and bounded topic snapshots
DT_TEST_SERVICE_ENV_DOCKER=1 DT_TEST_SERVICE_ENV_FULL_STACK=1 node --test test/service-environments.live.test.js
# Add real Maven/Spring branch comparison and independent SQL assertions
DT_TEST_SERVICE_ENV_DOCKER=1 DT_TEST_SERVICE_ENV_SPRING=1 DT_TEST_PG_URL="$SCRATCH_PG_URL" node --test test/service-environments.live.test.js
```

These tests require compatible preloaded images; they do not pull implicitly.
The Spring case requires Maven and a dedicated disposable scratch cluster.
Leave these flags unset for the normal offline suite.

See [the research](ephemeral-service-environments.md) for the retained cold-start
measurements, alternatives and remaining optimization gates.
