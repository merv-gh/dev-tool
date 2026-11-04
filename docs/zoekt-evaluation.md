# Zoekt comparison

Keep native search as the default. Zoekt helps some broad literal and Unicode searches, but was slower for several regex queries. It cannot replace the native semantic graph used by `impact`. An optional backend is worth considering for a search-heavy repository estate; this evaluation does not enable one.

## Measured corpus and search

The local experiment indexed the same 14,769 frozen files (191,341,128 bytes) in both engines: 32 generated service/library repositories plus Spring Framework at `3ebfd02d0ba0fd8df940c35951c726e77f01b3ef`. Zoekt was built from `a5a933bc043e08f092559801cfcc213ac942103d`, with ctags disabled and indexing parallelism 1.

Warm median engine times in milliseconds, limited to 100 returned rows:

| Query | Native | Zoekt |
| --- | ---: | ---: |
| rare-literal | 5.1 | 2.3 |
| missing-literal | 2.1 | 1.5 |
| common-literal | 17.0 | 11.4 |
| alternation | 21.2 | 34.0 |
| character-class | 208.2 | 3681.6 |
| escaped-literal | 20.1 | 3.2 |
| regex-call | 24.4 | 159.4 |
| public-source | 8.9 | 40.2 |
| unicode-fold | 18.6 | 3.2 |

All nine unlimited query results had identical repository/file/line identities. Bounded queries returned the same row counts and every returned Zoekt line matched the requested pattern; their ranking/order need not agree. The Zoekt request allows 1,000 occurrences across 100 files, then takes at most 100 lines, because Zoekt occurrence limits and dt row limits differ. Full retrieval of the common literal was about 6× faster in Zoekt; that advantage narrowed to about 1.5× at the usual 100-row limit.

These are local engine measurements, not production or end-to-end tool latency guarantees. Native calls run in-process; Zoekt includes loopback HTTP and JSON decoding. Seven warm samples follow source creation/indexing with filesystem caches available. There is no concurrent-user or cold-disk claim. The generated repositories contain varied Java/properties text; transitive library semantics are checked separately below.

## Indexing and refresh

Native cold indexing took 145.9 seconds, including 108.5 seconds of graph extraction. An unchanged refresh of all 33 repositories took 2.1 seconds. Native storage was 715.7 MB: 191.3 MB frozen source, 492.9 MB semantic graphs, 28.6 MB trigram postings and 2.8 MB manifests.

Zoekt built its additional text index in 35.5 seconds, using 527.1 MB. This is a different deliverable from the native source snapshot plus semantic graph. Adding it alongside the existing cache increases total storage; it does not remove the dominant graph extraction cost. Compact graph storage and scoped graph construction deserve separate performance work.

The independent refresh probe used four real local Git repositories and a 4.2 MB library:

| Refresh | Native snapshot + graph, ms | Zoekt Git text index, ms |
| --- | ---: | ---: |
| Cold | 861.2 | 1855.6 |
| Unchanged | 8.0 | 161.9 |
| One changed file / commit | 662.2 | 254.5 |

Zoekt's changed-commit run actually added a delta shard (one shard became two), rather than silently falling back to a full rebuild. It used `-submodules=false`; upstream delta indexing has branch-set, submodule, ignore-file and index-option restrictions. This small fixture is not a large-repository delta-speed guarantee.

## Regex and cross-repository impact

Zoekt uses Go/RE2 regex syntax. Its actual API rejected `(?<=billing\.)threshold`, `(order)_\1` and `get(?!Class)`, all valid in our current JavaScript regex engine. Conversely, Go inline flags are not automatically valid JavaScript patterns. Nine matching result sets do not prove general regex translation; retain JavaScript behavior or add an explicit regex dialect before using Zoekt for regex requests.

The real registered `code_symbols`, `code_search` and `impact` tools passed a service → middle library → fee library scenario. A different service bound to another fee-library version stayed outside the old version's impact. Both pinned Zoekt revisions returned the exact expected Git SHA and remained searchable after a third library commit. A failed build in an isolated staging directory left published shard bytes unchanged. Native impact remained stable after the library alias moved.

Text matches identify candidate repositories/files. Caller edges and transitive artifact/version bindings still come from native graphs and passports; a shared method name is not evidence that two library revisions have the same callers.

## Large-graph impact fix

The comparison exposed a separate native limitation: the published implementation exhausted its default 1,024 MB worker heap when the selected service expanded an internal helper dependency into Spring Framework. The retained framework graph alone is about 470 MB and contains both legacy and precise edge arrays.

`lib/codegraph-read.js` now reads class records with a bounded parser and streams edge tuples. `impact` uses that reader above 8 MiB, avoiding a full graph string/object allocation and the duplicate legacy edge array. Existing revision files are read without migration, sidecars or a rebuild. A low-heap regression streams 100,000 precise edges from a large duplicated graph under a 48 MiB heap.

The actual registered tool verified the same service → helper → framework caller chain with automatic dependency expansion and the default 1 GiB worker. It also exposed a response-budget issue: long coverage-gap examples could evict a short caller chain. Metadata now trims before caller rows, with room reserved for continuation state; total gap counts and coverage limits remain visible.

Large graph loading still takes tens of seconds. The worker may recycle its cache at its memory threshold, so repeated impact calls are not guaranteed to be fast. The verified result still reports static-analysis gaps and depth limits; this is evidence of the tested caller paths, not an exhaustive runtime-impact guarantee. The text-search comparison above remains the reason to keep native search as the default and make any future Zoekt integration selective.

## Integration requirements

The concrete modules and contracts remain listed in [code search and revisions](code-search-and-revisions.md#integration-points). A production adapter would need:

- An async boundary in `lib/code-search.js` and before impact's synchronous repository preselection; bounded DTOs, cancellation and a native fallback.
- Exact retained revision keys and SHA checks. The pinned raw JSON `/api/search` endpoint includes `FileMatch.Version`; the HTML-oriented `/search?format=json` DTO is different. The server needs `-rpc` to expose the raw JSON API.
- Per-revision output names, isolated staging and publication only after all shards are ready. Keep old revisions referenced by workspaces/passports. `zoekt-local-sync` treats its roots as the entire desired set and removes absent repositories, so it is unsuitable for refreshing only a subset of a shared index.
- Explicit regex semantics, path/test filters, occurrence-to-row limits, missing-revision coverage, and owner-scoped workspace selection before querying a backend.
- Configuration, deployment, health and discovery wiring only when the optional backend is implemented. Current deployments continue to use native indexes and optional ripgrep for unindexed source.

## Reproduce

Build `zoekt-index`, `zoekt-git-index` and `zoekt-webserver` from the pinned upstream commit above into a chosen tools folder. Check out the pinned Spring Framework revision into a local folder. The harness sends source only to local processes and a loopback server.

```sh
node dev/benchmark-code-search.js --zoekt-bin "$ZOEKT_BIN" --public-source "$SPRING_SOURCE" --public-repo PUBLIC/spring-framework --output-dir work/search-comparison
node dev/check-zoekt-revisions.js --zoekt-bin "$ZOEKT_BIN" --output-dir work/search-revisions
node dev/check-large-code-impact.js work/search-comparison/home work/large-impact.json --once
node --test test/code-revisions.test.js test/code.index.test.js test/code-search-fallback.test.js test/impact-readiness.test.js test/codegraph-read.test.js
```

Use `--resume` to reuse completed frozen indexes for query measurements; `--resume --bounded-only` reruns only bounded searches. Run performance probes serially. A small clean smoke run uses `--repos 2 --files 4 --file-bytes 2048` with a new output folder. Machine-readable observations, fingerprints, query gates and revision/impact checks are in [the benchmark record](benchmarks/code-search-zoekt.json).

Primary sources: [Zoekt query syntax](https://github.com/sourcegraph/zoekt/blob/a5a933bc043e08f092559801cfcc213ac942103d/doc/query_syntax.md), [raw JSON API](https://github.com/sourcegraph/zoekt/blob/a5a933bc043e08f092559801cfcc213ac942103d/internal/json/json.go), [result/version DTOs](https://github.com/sourcegraph/zoekt/blob/a5a933bc043e08f092559801cfcc213ac942103d/api.go), [Git delta indexing](https://github.com/sourcegraph/zoekt/blob/a5a933bc043e08f092559801cfcc213ac942103d/gitindex/index.go), [local-sync deletion semantics](https://github.com/sourcegraph/zoekt/blob/a5a933bc043e08f092559801cfcc213ac942103d/README.md).

Validation: 676 tests, 626 passed and 50 environment-dependent skips; 25 additional tests passed with graph streaming forced. The large service/helper/framework probe and clean small benchmark also passed. No default search-backend change is included.
