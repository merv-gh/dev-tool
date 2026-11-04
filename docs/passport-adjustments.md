# Typed passport ports and manual corrections

`semantic_ports` lists typed HTTP ingress/egress, Kafka consumers/producers, database reads/writes, scheduled callbacks, and internal-library ports. A port includes its service/environment/repository/commit, source handler, transport identity, parameter/field mappings, and evidence origin. Missing identities or mappings stay explicit gaps. A scheduled table reader is not an insert trigger, and a route/topic/table name alone does not establish a distributed data-flow path.

Automatic detections remain in the refreshed passport. Manual statements live in a separate private `passport-adjustments/` directory, scoped to the authenticated principal and chat/story. They do not modify `passport.json`, its generated Markdown, or automatic history. User-authored corrections remain `declared`; source detections remain distinguishable from them.

## Read, then edit

Read `passport_adjustments` with a service name to obtain the current identity, revision, original detections, effective ports, disabled ports and edit history. Optional `env`, `repo` and full `revision` selectors choose one exact source identity. An omitted selector uses the cached passport's value; an explicit null records unknown provenance. No detection from a different commit is substituted when the requested snapshot is missing.

```json
{"tool":"passport_adjustments","arguments":{"service":"order-service","env":"dev"}}
```

`passport_adjust` accepts 1–100 operations, a reason/source citation, and `expected_revision`. Use null to require a new overlay; updates require the hash returned by the read. Operations are deltas merged into the current overlay. `correct` replaces the selected port, `disable` suppresses it, and `add` introduces a separate declaration. Correcting a disabled port enables its replacement. A type correction moves the connection to the correct category instead of leaving an old consumer/producer link behind.

The same save may include `metadata` with `description`, `owners`, `tags` and `notes`; metadata-only saves are supported. Each supplied field replaces its previous declaration, omitted fields stay unchanged, and null explicitly clears that field. Description and notes are bounded text; owners and tags are lists of at most 100 strings. Reads expose original `detectedMetadata`, effective `metadata` and per-field `metadataProvenance`. These statements remain `declared`, even when they describe ownership or intended runtime behavior.

```json
{
  "tool":"passport_adjust",
  "arguments":{
    "service":"order-service",
    "env":"dev",
    "expected_revision":null,
    "reason":"ORD-42: publisher registration and deployment configuration reviewed",
    "operations":[{
      "action":"add",
      "port":{
        "type":"kafka-produce",
        "handler":{"file":"src/main/java/shop/OrderPublisher.java","line":42,"signature":"shop.OrderPublisher#publish(shop.Order)"},
        "boundary":{"cluster":"events-dev","topic":"order.created","schema":"OrderCreated","schema_version":"2"},
        "mappings":[{"from":"argument.order.id","to":"payload.orderId","direction":"request","evidence":"OrderPublisher.java:42"}]
      }
    }]
  }
}
```

A handler can additionally name its own repository and full source SHA, for example when a port is implemented in an internal library. To compose a local slice through an outbound or database call, supply `handler.call` with its relative `file`, source `line`, and optional `column`, `name` and `signature`. Call locators use source positions; CPG node IDs are generation-local and are rejected. Missing or ambiguous call sites remain explicit semantic-query gaps. Unknown handlers are editable but cannot become exact semantic method links. Boundary fields depend on the port type:

| Type | Boundary identity |
| --- | --- |
| HTTP | Host authority, method, route, optional base path and target service |
| Kafka | Cluster, topic, optional payload schema/version |
| DB | Database, schema, table, optional columns |
| Scheduled | Schedule and callback registration evidence |
| Internal library | Artifact/module/version, target repository/SHA/signature |

Field mappings use source/target paths with `request`, `response`, `read`, `write`, `argument`, `return`, or `control` direction. They are attributed evidence, not automatically proven serialization behavior.

## Persistence and consumers

Each service/environment/repository/commit identity has an atomic head pointing at immutable, checksummed edit revisions. A filesystem lock plus compare-and-swap prevents concurrent writers from losing changes. Every revision records author, time, reason, predecessor and changed ports. `at_revision` reads retained manual history. Invalid/stale writes leave the current head intact. There is no implicit deletion or cross-version replay.

Refreshes at the same source identity preserve corrections. A different SHA gets a different overlay; older corrections remain queryable with exact selectors and retained passport history. Port pagination binds to its source projection and overlay revision, so edits invalidate old cursors. Reads return bounded previews; `semantic_ports` supplies continuation pages. Limits are 500 overridden ports per identity, 2 MiB per edit revision, and at most 100 mappings/parameters per port.

Passport loading, route discovery, service usage, map projections and impact consume effective scoped ports. Map links carry manual evidence and keep explicit Kafka clusters separate. PostgreSQL usage applies DB corrections as a bounded read projection; its shared cached catalog remains automatic detections, including when a private owner rebuilds it. Another principal/chat sees its own corrections. PG projection currently permits 200 active adjusted services and 5,000 changed DB ports per scope/environment; larger projections fail visibly and direct inspection remains available through `semantic_ports`.

Typed method/boundary edges require exact handler repository/SHA/signature/location and environment-qualified transport identities. DB reads point from table to method; writes point from method to table. Scheduled edges point from schedule to callback. Missing fields remain gaps, and manual edges retain `declared` proof status. The legacy service-level graph remains available for compatibility and must not be presented as an exact distributed value-flow proof.
