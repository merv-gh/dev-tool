# Architecture observatory

`architecture_view` opens the vendored ECS canvas as an interactive page or an Open WebUI inline result. The Admin **Architecture** tab edits the shared knowledge base and previews the same page. The service showcase includes an architecture section. No additional service is required for browsing or exporting; Joern is optional.

## Shared knowledge and access

Everyone with read access can discover documents with `architecture_list`, read exact revisions with `architecture_get`, and find their explanations through `knowledge_search`. Only administrators can publish with `architecture_save` or refresh operational observations with `architecture_refresh`. The tools obey existing token roles on HTTP, OpenAPI and MCP. A read-only result link cannot publish.

Published state lives under `architecture/<id>/` in `DT_HOME`, outside cache and private chat contexts. Back up this folder with the installation configuration. It is gitignored. Refreshing catalogs, passports or environment observations does not replace it. Store private drafts and task progress in contexts; publication is explicit and global.

Each publication requires a reason and `expected_revision`: `null` creates a new document; an exact revision updates it. The atomic head points to an immutable revision with author, timestamp, reason and previous revision. Concurrent edits return `STATE_CONFLICT`; the Admin editor preserves the draft. Older revisions remain readable and quoted findings remain verifiable through `knowledge_verify`. Archive a document by publishing `status: "archived"`; history remains available.

## Views and evidence

The [C4 diagram types](https://c4model.com/diagrams) distinguish software-system context, containers and components from supporting deployment and dynamic views. A C4 container means a deployable application or datastore, not necessarily a Docker container.

| View | Meaning |
| --- | --- |
| Landscape | Prefix families or explicitly declared software systems, with environment replica counts. Prefix names are navigation groups; no dependency arrows are rolled up from naming. |
| Context | People, external systems and explicitly declared software-system ownership. Cross-system arrows retain the underlying relation evidence. Services without known system ownership stay a coverage gap. |
| Container | Bounded applications, datastores and topics inside declared boundaries; neighboring entities are included only through recorded relations. |
| Component | Declared components inside a selected service, plus detected HTTP handlers with source locations. No guessed handler-to-handler edges. |
| Deployment | Selected applications and their recorded Consul instances, health checks, ports, datacenter and version/commit metadata. A registration edge is not proof of runtime traffic. |
| Dynamic / data flow | Ordered named feature interactions, with explicit field mappings when supplied. Declared transport mappings are not end-to-end value-flow proof. |

Node identity uses the existing map IDs, for example `svc:orders`, `db:ledger`, `kafka:refund.authorized`, or an explicit `system:commerce`. Set a node's `parent` to declare ownership. Named views retain their type, focus or entity selection. Relations require a citation on the relation or document, and can be restricted to particular environments. Publish source paths, application properties, design decisions or ticket references; do not invent an edge because service names look related.

`architecture_flow` can explicitly join a named feature flow to a retained `semantic_query` data-flow job. Supply exact `analyses` and source/sink selectors. It never starts a parser implicitly. Local Joern segments and declared boundary mappings retain separate proof and gaps. Semantic jobs retain their existing principal/chat ownership and cancellation behavior.

## Operational observations

Browsing reads the current cache without live queries or indexing. Admins can explicitly start an `architecture_refresh` job; observe it with its returned job ID or cancel it with `job_cancel`. Refreshes use read-only source calls and configured rate limits. Failed sources retain their last successful measurement with a stale marker. Each resource panel shows its source and observation timestamp.

- Consul supplies service registrations, addresses, replica health and check output. Deployment versions come from recorded service metadata, never from assuming a passport SHA is deployed.
- PostgreSQL supplies database size, active/total connections, configured connection limit, cache-hit ratio, commits, rollbacks and other `pg_stat_database` counters. These are database statistics, not host CPU/RAM.
- Kafka UI supplies cluster and broker stats through its [official API contract](https://github.com/provectus/kafka-ui/blob/master/kafka-ui-contract/src/main/resources/swagger/kafka-ui-api.yaml): broker and partition counts, under-replication, throughput and optional broker JMX metrics. CPU/JVM memory appear only for recognized metrics with known units.
- Optional administrator-configured JSON endpoints can map actual process CPU and memory. URLs and headers come from configuration, not from model arguments. Missing measurements remain unknown.

Example configuration (secret values can use `${VAR}` references):

```json
{
  "architecture": {
    "staleAfterMs": 300000,
    "maxMetricBrokers": 12,
    "telemetry": [{
      "id": "orders-process",
      "env": "dev",
      "target": "svc:orders",
      "url": "https://metrics.example.com/orders.json",
      "headers": { "Authorization": "Bearer ${METRICS_TOKEN}" },
      "fields": {
        "cpuPercent": { "path": "process.cpuRatio", "scale": 100 },
        "memoryUsedBytes": "process.heapUsedBytes",
        "memoryLimitBytes": "process.heapMaxBytes"
      }
    }]
  }
}
```

Configured telemetry reads are limited to 50 endpoints per environment, Kafka to 10 clusters and at most 50 metric brokers per cluster, and PostgreSQL to 30 configured databases. HTTP telemetry responses are capped at 2 MiB with a 10-second timeout. A view renders at most 250 nodes and 500 relations over a 10,000-node source estate. Shared projection inputs are limited to 16 MiB; architecture search inputs to 8 MiB. Budget gaps are explicit, and selecting a document prioritizes it. Large estates should start at the landscape and drill down. CPU and memory values must be finite, nonnegative and use the specified units.

## Exports and demonstration

The export menu downloads SVG, PNG, JSON, Mermaid or PlantUML. SVG is standalone and contains no external resources or scripts. PNG is rasterized locally with a bounded pixel budget. JSON preserves evidence, source document revisions, field mappings and observations. Mermaid and PlantUML retain certainty labels; PlantUML C4 source uses the standard C4 library when rendered by an external renderer.

Run the synthetic 600-service demo without Docker:

```sh
node demo/architecture.js 4046
```

The command prints an architecture URL and an Admin URL for a fresh temporary demo home. It seeds ten service domains, a refund workflow, dev/UAT replicas, version differences and explicitly synthetic resource measurements. These are fixtures, not observations of a real environment. Stop with Ctrl-C. The demo tokens are printed/embedded test credentials and must never be copied to a real deployment.

`test/architecture.test.js` exercises publication, shared reads, historical projections, searchable knowledge, evidence, exports, role boundaries, network metrics and failed-source retention. `dev/check-architecture-browser.js` drives the running demo with Playwright, checks all views and downloads, switches environments, tests publication/conflicts/read-only access, and captures desktop/mobile screenshots. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if your local browser is installed outside Playwright's default location.
