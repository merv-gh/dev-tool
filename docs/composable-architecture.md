# Composable tool and evidence contracts

The primary interface is a tool list in Open WebUI. Implementations are replaceable;
the tool name, versioned JSON contract, semantic meaning and evidence obligations
are the stable boundary. CLI, MCP and HTTP use the same registry. No client needs
to know whether a particular operation uses JavaScript, Go, Rust, PostgreSQL, a
vector index or a remote service.

## Boundaries

| Stage | Contract | Replaceable implementation | Required invariants |
| --- | --- | --- | --- |
| Discover | OpenAPI input schemas, `tool_search`, `tool_describe` | Tool catalog and ranking | Only enabled tools; exact names and required arguments |
| Execute | `dt.tool/v1` request/response | In-process module or configured HTTP worker | Validation, rate limits, request identity, explicit errors, no silent fallback |
| Ingest knowledge | `contracts/v1/knowledge-source.schema.json` | Markdown/contracts, Confluence, custom exporter | Stable explicit entity ids, directional verbs, revisions, provenance, ambiguity |
| Retrieve | `knowledge_search` adapter result shown by `tool_describe` | Text search, RAG, vector/relational/document database | Exact source excerpts/citations; retrieval is not runtime verification |
| Query graph | `contracts/v1/knowledge-graph.schema.json` | Local cache or independent graph backend | Typed entities, directional relationships and classified evidence |
| Present | Stored result plus `view` | Sandboxed HTML view | Presentation works independently of the query backend; no live network calls from a view |
| Arrange tests | Versioned fixtures and PostgreSQL template descriptors | Fresh SQL loading, immutable bases/clones | Source isolation, integrity, explicit leases and cleanup |
| Act/observe/check | Portable scenario and collection contracts | Project tests or isolated runtime adapters | Observations checked independently; proof levels remain distinct |

Descriptions and schemas are available through `tool_describe`; wire schemas are
also served at `/contracts/v1/<name>.schema.json` and included in the built bundle.
Portable scenario and collection schemas are documented with their implementations.
JSON values use strings for offsets, identifiers or decimals that cannot safely
round-trip through IEEE-754 numbers. Do not encode an opaque JavaScript class,
closure, database handle or process reference in a portable artifact.

## Replace one operation with an HTTP worker

Configure a worker endpoint in `config.json`, with secrets in `.env`:

```json
{
  "tools": {
    "profile": "compact",
    "backends": {
      "knowledge_search": {
        "url": "http://127.0.0.1:7070/execute",
        "token": "${KNOWLEDGE_WORKER_TOKEN}",
        "timeoutMs": 30000
      }
    }
  }
}
```

The worker receives one JSON POST:

```json
{"protocol":"dt.tool/v1","requestId":"opaque-request-id","tool":"knowledge_search","arguments":{"query":"refund","env":"dev","limit":15,"includeConfluence":false}}
```

It replies with the same protocol, request id and tool name, and exactly one of
`result` or `error`. The operation's result must follow the adapter result schema
returned by `tool_describe`. For example:

```json
{"protocol":"dt.tool/v1","requestId":"opaque-request-id","tool":"knowledge_search","result":{"revision":"source-revision","total":1,"results":[{"id":"document:refund-rule","text":"Refunds require approval.","provenance":{"source":"policies","revision":"v7","file":"refunds.md"}}],"gaps":[],"runtimeVerified":false}}
```

An error is explicit:

```json
{"protocol":"dt.tool/v1","requestId":"opaque-request-id","tool":"knowledge_search","error":{"code":"INDEX_UNAVAILABLE","message":"The index has not finished updating.","retryable":true}}
```

An exact route takes precedence over a trailing-prefix route such as
`"knowledge_*"`. Routes cannot resurrect disabled tools. Input validation and rate
limits happen before dispatch; response identity and contract checks happen before
presentation. Endpoint URLs come from trusted configuration, never from a model's
tool argument. Credentials are not forwarded through redirects. Transport failures
are not retried automatically and do not silently run another implementation:
an interrupted response may represent an action that already completed. Use the
returned request id and the worker's idempotency policy to investigate that outcome.

For `knowledge_graph`, the worker returns graph data rather than HTML. dt validates
it and creates the same local interactive view, so migrating storage does not
disable visualization. Start by replacing retrieval only; graph traversal and
ingestion can migrate independently. Confluence synchronization is not required
for any of the source-neutral knowledge tools.

## Keep semantics stable when changing storage

An embedding match is a retrieval candidate. It does not create a factual edge.
A node's identity includes its namespace/scope where needed, for example
`table:billing:pay.payments`, rather than an ambiguous table name. Relations use
explicit verbs (`read`, `write`, `produces`, `consumes`, `calls`, `exposes`,
`implements`) and retain the source version. Documents merely mentioning two
services do not establish a call between them.

Current proof labels are `indexed`, `stated`, and explicitly `inferred` when a
provider supports inference. Indexed code/catalog evidence is static evidence,
not runtime proof. Search and graph results keep `runtimeVerified:false`.
Model emulation, real project execution and a full build have separate scenario
proof levels. Unknown or unsupported dependencies stay visible through every stage.

The built-in input validator implements a documented JSON Schema assertion subset
and rejects unsupported assertion keywords and unresolved references; it does not
silently erase them. A worker may use a complete standards validator. Preserve the
same accepted/rejected corpus and error paths before replacing the validator.
The transport conformance tests include malformed errors, mismatched versions and
request ids, schema violations, timeouts, disabled-tool dispatch and default views.

## Upgrade separately

Keep source configuration, normalized source snapshots, executable adapters,
presentation templates and client profiles separate. Source sync accepts one id,
retains the last good revision on failure and records that failure as a graph gap.
Schema/history migration belongs to the owning adapter. A new major contract gets
a new protocol/schema id; it must not silently reinterpret a v1 resource. A clean
replacement must pass the same fixture and negative-test corpus and preserve
inspection, cancellation and cleanup behavior, not merely return similar text.
