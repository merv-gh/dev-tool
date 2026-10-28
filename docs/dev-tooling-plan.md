# Development tooling: investigation to a reproducible test

The repository already has passports, code and database usage graphs, DDL snapshots,
generated Java data, scratch databases, saved scripts and a fast Maven launcher.
The gaps are in joining these capabilities into a repeatable investigation.

## Plan and acceptance criteria

1. **Related data (priority).** Build a capture plan from cached PostgreSQL schemas,
   FK constraints, service usages and Kafka schemas. Traverse declared relationships,
   including composite FKs and explicit relationships across databases. Never infer a
   cross-database join as fact from a column name. Offer candidates with provenance.
   Capture with parameterized read-only queries, batching, depth/row/message limits,
   stable ordering and row deduplication. Report missing parents, missing seeds,
   truncation, unsupported schemas and the absence of a distributed snapshot.
2. **Replay resources.** Export schema, rows, SQL, Kafka envelopes/schemas/offsets,
   hashes and a manifest into `src/test/resources/dt-fixtures/<name>`. Separate FK
   installation from data loading to handle cycles. Preserve keys, headers and
   partition order. Mask sensitive fields deterministically across the whole capture.
   Validate links after masking and make incomplete captures visible. Preserve
   existing resources unless overwrite was requested.
3. **Run experiments.** Save parameterized sandboxed JS experiments, run only explicitly
   allowed read-only tools, retain assertions/results/timing and compare runs. No
   unrestricted shell, environment writes or production replay. Use the existing
   JS permission sandbox and tool rate limits.
4. **Investigate visually.** Extend dt's existing sandboxed views with a fixture
   explorer: relationship graph, per-source counts, selectable row/message detail,
   capture gaps, search and downloadable JSON. Reuse the existing typography,
   colors, table styles and dark theme; all information remains available by keyboard.
5. **Speed.** Measure repeated catalog/index loading and unchanged indexing, avoid
   recomputation with invalidation, and add an explainable changed-test workflow.
   Keep the full suite and project build as final checks. Details and measurements
   belong in `dev-performance-plan.md`.
6. **Passport contracts.** Inventory every statically known read dependency, entry
   action and output obligation, including unknown and ambiguous edges. Expose
   inventory, binding, capture, individual reads, action inputs, predicates,
   observation checks, local emulation and resource export as independent tools.
   Require explicit state and business outcomes; a supplied model is not a substitute
   for executing the application. Test multi-tenant composite identities, multiple
   datasources, Kafka arrays/tombstones/large offsets, HTTP/search/config/cache
   reads, partial failures, missing effects and unknown dependencies.

## Deliberate boundaries

- PostgreSQL databases and Kafka cannot share a transaction. Capture records its
  observation window, offsets and warnings; it does not claim an atomic snapshot.
- Automatic FKs are schema facts. Cross-database relationships and Kafka correlation
  paths are explicit plan inputs; schema/name suggestions are candidates only.
- Kafka capture scans a bounded offset window. No matching messages in that window
  is a reported gap, not proof no event exists. Capture never commits consumer offsets.
- Replay only writes to dt's configured scratch PostgreSQL via throwaway databases.
  Kafka resources can be read by the service's existing test producer; no live
  environment publishing is added.

## Validation

Offline integration tests use two cataloged databases and Kafka messages with a shared
order id, composite FKs, cycles, arrays, generated columns, masking, duplicates and
bounded windows. A gated live scratch-PostgreSQL test loads the exported statements
and checks real FK enforcement. Tool registration and resource path containment are
tested. The final bundle is rebuilt and the repository suite is run.

The implemented passport workflow and adversarial cases are described in
`scenario-testing.md`. JSON Schema/Avro/cached-sample path extraction and capture
validation have independent tools and tests. A separate completeness audit in
`developer-tool-completeness-review.md` records future work requested for review;
it is a roadmap, not a claim those items are implemented.
