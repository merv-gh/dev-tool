# Trace a UI state to a database field

Open **Admin → API routes → Trace a UI state to database fields**, or `/ui-trace`.
The vendored ECS Canvas SDK shows a captured screenshot as the UI node, observed
HTTP requests, service groups, retained Joern control/data states, PostgreSQL
objects and individual fields. Select a service and **Expand static path** to
see conditions, transformations, calls and source locations inside its boundary.
Select a field to edit and explicitly run read-only SQL.

## Save and reproduce a state

`ui_trace_save` saves a task-private, versioned recipe. It does not navigate,
send requests or query a database. Start at a login or direct URL, fill controls,
click, select options, check boxes, press keys and wait for visible elements.
Use CSS selectors or an exact accessible role/name. Temporary MCP references are
not replayable locators. The configured Playwright MCP must expose
`browser_run_code`; unsupported endpoints fail explicitly.

Finish asynchronous flows with a `wait` action on the visible outcome you want
to capture. The screenshot follows the last recipe action; it does not imply
that background polling or every outstanding request has finished.

```json
{
  "id": "order-status",
  "expected_revision": null,
  "definition": {
    "title": "Look up an order",
    "recipe": {
      "url": "https://app.example/login",
      "steps": [
        {"action":"fill","selector":"[name=username]","value":"{{username}}"},
        {"action":"fill","selector":"[name=password]","value":"{{password}}"},
        {"action":"click","role":"button","name":"Sign in"},
        {"action":"navigate","url":"https://app.example/orders"},
        {"action":"fill","selector":"[name=orderId]","value":"{{orderId}}"},
        {"action":"click","role":"button","name":"Search"},
        {"action":"wait","selector":"[data-order-status]"}
      ]
    }
  }
}
```

Discover recipes with `ui_trace_list`; pass `id` to read one. Updates require the
current `expected_revision`. Older recipe revisions remain readable. Recipes,
browser sessions, results and jobs follow the authenticated principal/task
boundary; preserve the same task identity when reopening from another chat.

**Replay UI & capture**, or `ui_trace` with `capture:true`, explicitly executes
these actions, including any application mutations caused by forms/buttons.
Runtime `params` supply placeholders. The parameter object is omitted from
tool history and jobs, and cleared from UI inputs after replay. Browser cookies
stay in the isolated session, which is closed after success, failure or cancel.
Request exchanges use the existing credential/body sanitization. Screenshots and
ordinary captured business fields can contain application data; they remain
private task evidence, rather than a secret-redaction guarantee for pixels.

```json
{"id":"order-status","capture":true,"params":{"username":"demo","password":"runtime-only","orderId":42}}
```

The call returns an owned job immediately. Observe with `ui_trace {"job":"…"}`
or cancel with `job_cancel`. A replay never silently repeats after failure.
**Build from saved evidence** uses the previous screenshot/requests with the
current recipe's bindings. Opening a saved diagram does no replay, parse or SQL.
`exchange_ids` can instead select existing sanitized API captures.

## Follow and correct the static path

Browser URLs are matched against cached passport endpoints. Ambiguous candidates
stay separate. Unmatched static assets (scripts, styles, images and fonts) are
omitted before the request budget, with their count reported as a gap; an asset
URL that matches a cached service handler remains included. Each service must
have an exact retained Joern analysis matching
its passport repository and SHA; a missing generation yields a gap and never
starts an implicit parse. Build it with `semantic_index` first. Source paths
include bounded local control/reaching-definition edges, call argument bindings,
conditions, transformations, assumptions and inherited-library coverage supplied
by the retained engine. Partial or unsupported paths remain partial.

Advanced recipe bindings can select an exact retained handler or correct a
missing transport/field connection:

```json
{
  "services": [{
    "service":"orders", "analysis":"exact-retained-analysis-id",
    "entry":{"kind":"method","file":"src/Orders.java","line":20},
    "method":"GET", "path":"/orders/{id}",
    "reason":"Reviewed controller method for this gateway route"
  }],
  "fields": [{
    "service":"orders", "repo":"SHOP/orders",
    "sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "file":"src/OrderRepository.java", "line":41,
    "db":"orders", "object":"sales.orders", "column":"status",
    "reason":"SQL selects this column at the retained call site"
  }],
  "transports": [{
    "service":"orders", "repo":"SHOP/orders",
    "sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "file":"src/AuditClient.java", "line":15,
    "target_service":"audit", "method":"POST", "path":"/audit",
    "reason":"Reviewed explicit HTTP client destination"
  }]
}
```

Manual bindings require exact source identities and a reason. A source change
cannot silently reuse an old file/line mapping. Unmatched bindings remain gaps.
Known HTTP exit ports can follow an explicitly identified downstream service;
no service-name guess creates an edge. Table/column existence is checked against
the configured environment's catalog. Supported function result expressions can
continue to the underlying table columns, with SQL-body provenance. Dynamic SQL
and unresolved database identities remain gaps.

## Multiple services, procedures and model corrections

Each explicit HTTP transport follows one matched downstream ingress, using that
service's own passport repository/SHA and retained analysis. Services stay in
separate expandable groups, including when they share a database or procedure.
Procedure/function nodes follow cached SQL read/write/call dependencies through
other routines and tables. Cycles close in the graph; traversal stops at eight
database hops or 64 objects. These are static dependencies, with no procedure
execution and no claim that every branch or dynamic SQL path was resolved.

Use `ui_trace_edit` to replace selected definition fields while preserving the
replay steps and other bindings. Read the latest recipe with `ui_trace_list`
first, supply its `expected_revision`, and rebuild with the previous result to
retain its screenshot/traffic. Empty arrays remove corrections. The full
replacement `ui_trace_save` remains available. Models cannot use the edit tool
to rewrite observed exchanges or promote a declaration into observed evidence.

```json
{
  "id":"order-status",
  "expected_revision":"<current recipe revision>",
  "patch":{
    "databases":[{
      "service":"audit", "repo":"SHOP/audit",
      "sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "file":"src/AuditRepository.java", "line":18,
      "db":"orders", "object":"sales.record_audit",
      "signature":"p_id bigint",
      "reason":"Reviewed JDBC procedure call"
    }],
    "database_links":[{
      "db":"orders", "object":"sales.persist_audit",
      "signature":"p_id bigint",
      "target_db":"orders", "target_object":"sales.audit_events",
      "columns":["status"], "access":"write",
      "reason":"Reviewed INSERT explicitly writes status"
    }]
  }
}
```

`databases` binds an exact source state to a table or routine without requiring
an output field; `columns` is optional. `database_links` connects exact database
objects, optionally across aliases. Supply `signature`/`target_signature` exactly
as retained in the catalog when a routine is overloaded. The legacy usage index
merges overload dependencies, so the diagram refuses to attribute that union to
one signature; use reviewed links instead. Recheck manual database declarations
after refreshing the catalog, since they pin object/signature rather than body
content. Missing/ambiguous targets remain gaps.

A `services` binding with `path`, `method` and `reason` can correct a missing or
incorrect gateway attribution. Its arrows remain declared; the original captured
route attribution is retained. Source and transport corrections still require
the exact retained repository/SHA and entry or file/line identities.

```json
{"id":"order-status","previous":"<previous result id>","capture":false}
```

## Interpret and share the evidence

- **Observed:** HTTP requests during the saved recipe, with status and exchange ID.
  They are not all necessarily caused by the final screenshot state.
- **Static:** exact retained Joern control/data edges and supported SQL expressions.
- **Declared:** reviewed manual handler, transport or field bindings; dashed arrows.
- **Catalog:** an object owns a field in the retained database schema.

These layers do not establish distributed runtime execution, path feasibility,
equal field values or that the indexed source is deployed. Read the assumptions
and pair an investigation with independent runtime assertions.

Field queries start with `WHERE FALSE LIMIT 20`. Add tenant/entity predicates and
choose **Run read-only query** to send SQL through the existing authenticated,
rate-limited, timeout-guarded `pg_query` tool. Function nodes and their output
fields open the function definition instead of generating an invalid table query;
the diagram does not execute arbitrary functions automatically.

Use **More** to copy the retained diagram link or export full JSON and standalone
SVG with the screenshot. Live actions require normal authentication in the same
task. The Open WebUI inline snapshot is sandboxed and collapsed by default.
Expand it to select nodes, expand each service, follow procedures and inspect
connection evidence in a network-free graph. The selected-node link opens the
authenticated workbench at that node for edits or explicit queries. Stored results follow normal result
retention; save exports to a context for longer-lived task evidence.

## Local demonstration and checks

```sh
node demo/ui-trace.js work/ui-trace-demo
node dev/check-ui-trace-browser.js work/ui-trace-check work/ui-trace-check/screenshots
node --test test/ui-trace.test.js
```

The demo binds only to loopback. It performs actual Playwright login/navigation,
form actions and screenshot/network capture against a disposable application.
Its retained Joern projection/deep-query adapter and PostgreSQL catalog are
synthetic, explicitly labelled fixtures. It does not claim a fresh Joern parser,
live PostgreSQL server or production Open WebUI session was tested.

Limits: 40 replay actions, 50 requests, eight handler candidates per request,
20 service entries, 600 diagram nodes and
1,500 edges. Each local Joern map uses bounded methods/states/depth. Narrow the
recipe or select more specific entry/field bindings when coverage is clipped.
