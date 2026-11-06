# Roadmap and maturity

The internal-team release keeps one coordinator and optional workers. Its release
gates are versioned catalog/search/usage reads, non-destructive publication,
authenticated team access, approved plugins, operational export, contract
conformance and reproducible automated evidence. Consult
[the operator guide](operator-guide.md) and
[known limitations](known-limitations.md) for exact behavior.

## Next milestones

| Milestone | Required work before claiming support |
| --- | --- |
| OAuth-enabled MCP | External identity provider, protected-resource discovery, audience/issuer validation, token lifecycle and a real client compatibility matrix; do not build an identity provider inside dt |
| Horizontal availability | Shared durable job ownership with leases/fencing, distributed admission, cross-node cancellation, artifact storage, failover and isolation tests; SQLite on a shared volume is insufficient |
| Larger installations | Measured partition/offload thresholds beyond the million-object target; representative sustained update/search tests before choosing a distributed service |
| New semantic stacks | A language-neutral adapter that declares capabilities and source identity, passes conformance, and has a real positive/negative runtime fixture; Python/Go text search is already distinct from semantic support |
| Broader database engines | Connector/schema/capture/replay contracts plus fidelity and read-only enforcement tests for each engine |
| Production UX handoffs | Review the separate UX storybook before implementing intent suggestions, adjacent exact-source inspection and complete investigation handoffs |

No row above is a shipped capability. Existing specialist documents retain their
dated verification records; current test/coverage/inventory artifacts supersede
old headline counts rather than rewriting history.
