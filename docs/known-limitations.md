# Known limitations

| Area | Current boundary | Operator action |
| --- | --- | --- |
| Availability | One coordinator; scheduler/cancellation ownership is process-local | Do not load-balance multiple writable coordinators; retain persistent local storage |
| Capacity | Million-object/50-session target; measurements are host/workload-specific | Read the benchmark's actual hardware, counts and failing gates before sizing |
| Changed refreshes | Unchanged inputs skip derivation; changed environments rederive metadata before applying record differences | Measure refreshes for representative source partitions; record-level incremental writes are not constant-time refreshes |
| SQLite | Requires local filesystem locking; older Node 22 can fall back to streaming search | Prefer a current Node 22/24 runtime and local volumes; check backend status |
| Source consistency | Independent source observations do not form a distributed snapshot | Preserve timestamps/source identities and capture explicit reproduction resources |
| Historical catalogs | Generations retain discovery lines/usage edges, not every historical source body | Save required bodies/DDL/data as reproduction artifacts; pin generations/references |
| Security | Team tokens and role/task/environment policy; no built-in OAuth provider | Use the team profile behind TLS; see the OAuth follow-up in the roadmap |
| Host isolation | Trusted plugins/builds can use their host capabilities | Use separate isolated runners/deployments for mutually untrusted users |
| Shared evidence | Shared project knowledge is broadly readable; result URLs are read-only capabilities | Review content and links before sharing; environment grants are not document redaction |
| Languages | Broad text search; Java/Kotlin static passports and configured Java/JS/TS Joern | Consult capability manifests; unsupported stacks remain explicit gaps |
| Extensions | HTTP contracts are language-neutral; adapter declarations do not prove implementation quality | Run conformance and real positive/negative integration tests |
| Observability | Aggregate metrics optional; task traces opt-in; exporter outages do not repeat tools | Monitor drop/failure counters; configure an external Collector/backend if needed |
| Verification | Coverage percentages apply to measured sources; live suites require their fixtures | Inspect unmeasured files, skips, transition gaps and source-matched reports |

[Operator guide](operator-guide.md) · [Roadmap](roadmap.md) ·
[Tool verification references](benchmarks/tool-verification.json) ·
[Source and lifecycle coverage](benchmarks/test-coverage.json).
