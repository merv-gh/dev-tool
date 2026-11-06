# Extending dev-tool without a JavaScript plugin

The existing `dt.tool/v1` HTTP request/response envelope is the replacement seam.
An adapter can be written in any language. The coordinator retains input/role
validation, admission, execution ownership, tracing and local presentation.
[Composable contracts](composable-architecture.md) describe the existing schemas.

`adapter_capabilities` reports declared languages, operations, evidence levels,
source identity and limits without contacting external systems. Configured
backends may include a manifest conforming to
[adapter-capabilities v1](../contracts/v1/adapter-capabilities.schema.json).
Missing manifests remain explicit gaps; existing backends remain compatible.

```json
{"tools":{"backends":{"find":{"url":"http://adapter:7090/execute","token":"${ADAPTER_SERVICE_TOKEN}","scopeAware":true,"capabilities":{"protocol":"dt.adapter-capabilities/v1","id":"example","scopeAware":true,"capabilities":[{"operation":"find","languages":["text"],"evidence":"fixture","sourceIdentity":"example-v1","gaps":["Illustrative data, no semantic analysis"]}]}}}}}
```

Exact routes beat trailing-prefix routes. Disabled or unauthorized tools cannot
be resurrected by a backend. Scoped requests require service authentication and
trusted principal/story context. The adapter must enforce resource ownership;
accepting `scopeAware:true` alone does not implement it. W3C trace context is
forwarded separately from tool arguments and credentials.

The request/result identity must match, response JSON is bounded, cancellation
propagates, and unknown outcomes are not retried or replaced with another engine.
The [wire schemas](../contracts/v1/tool-request.schema.json) and
[response schema](../contracts/v1/tool-response.schema.json) are bundled and served
through the existing contract catalog.

## Run a complete reference example

Set `DT_ADAPTER_TOKEN` to a temporary value of at least sixteen characters, then:

```sh
node demo/adapter/server.js 7090
# In another terminal with the same temporary service token:
node dev/adapter-conformance.js http://127.0.0.1:7090
```

This example requires only Node's standard library. It exposes a synthetic `find`
operation and in-memory fixture operations for testing private notes/cancellation.
They are not automatically added to dev-tool's tool registry. The conformance
runner checks actual HTTP authentication, manifest validation, request identity,
principal/story separation, forged scope rejection, unsupported operations and
disconnect behavior. No remote network or production credentials are needed.

Run `node --test test/adapter-conformance.test.js` to exercise that service as a
regression. To validate a different adapter, implement its own meaningful
conformance fixtures and positive/negative domain tests. Passing the reference
service does not certify another service or establish semantic language support.

New language engines, storage systems and database connectors are deliberately
deferred. Start by preserving evidence semantics and bounded JSON, not by making
an embedding hit or a guessed edge look like a proven dependency.
