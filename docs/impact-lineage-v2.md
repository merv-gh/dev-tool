# Scoped impact and column lineage

Impact returns `dt.impact/v2` with `dt.identity/v1` identifiers. Cached observations and static analysis are evidence within a selected scope; they do not prove that every runtime dependency has been observed.

- Postgres: `table:<env>:<database>:<schema>.<table>`, `column:<env>:<database>:<schema>.<table>.<column>`, `pgfn:<env>:<database>:<schema>.<function>`. Logical database names remain distinct even when the underlying schema/table names match. Quoted case-sensitive catalog names retain their quotes/case. Overloaded PG functions have separate signature-bearing candidate IDs; legacy function usage edges cannot select an overload and remain an explicit gap.
- Code: `code:<encoded-repository>@<encoded-revision>:<FQN>#<method>(<parameter-types>)`. Indexed working checkouts include the content digest in the revision. Classes and fields use the same repository/revision prefix. `code_symbols` returns canonical `id`, `legacyId` and revision. Old saved names continue to resolve when unique; duplicate revisions or overloads return candidates.
- Query examples: `impact(target="table:alpha:public.orders", env="dev")`, `impact(target="public.orders", db="alpha", env="dev")`, `pg_usage(name="alpha:public.orders.amount", env="dev")`. Use one exact candidate ID after an ambiguous result.

Canonical IDs are transport-neutral strings. `lib/semantic-identity.js`, the passport edge DTO (`dt.passport-edges/v1`) and column report (`dt.column-lineage/v1`) can be consumed by another graph/index implementation. No backing graph database or Confluence mirror is required.

Stored passport `effective.consumes`, `produces`, `calls`, `endpoints` and ES observations feed the graph through one adapter. A known different passport environment is excluded. Missing environments/revisions remain gaps. File identity, size, modification/change times and content digests detect leaf replacements, equal-size changes, deletion and malformed refreshes. A malformed replacement retains last-good evidence with a stale label. Indexed code is a checkout revision; an environment filter alone does not prove that revision is deployed.

`depth`, `node_limit`, `time_ms` and `max_output_bytes` are separate bounds. Results expose `complete`, `traversalComplete`, `cutReasons`, bounded frontier, counts, omitted metadata counts and a graph revision. An output cursor is available only after a complete traversal, and rejects a changed graph/query or a later traversal that cannot complete in the same budget. An incomplete traversal returns an expanded `next` query; it does not offer unstable offset pagination. The view displays scope, revision, cut reasons and gaps. The compact facade also honors the byte budget and retains its view link.

Column evidence classifies SELECT/RETURNING reads, UPDATE/INSERT targets, SET right-hand expressions, WHERE/JOIN predicates, star expansion, DELETE row effects and trigger OLD/NEW reads/assignments. It includes SQL constants outside methods, view/materialized-view definitions, function/procedure bodies, ORM mappings/field accesses and reverse caller chains, with database/environment/revision and line locations. Ambiguous code-to-database bindings are candidates. An ORM object mutation is not independently verified persistence.

The bounded SQL lexer deliberately reports dynamic SQL, nested alias scopes, complex SET targets, implicit INSERT column effects, unsupported languages and case-sensitive quoted column parsing as gaps. A parser/runtime adapter is required to close them. Reflection, generated code and unindexed repositories are outside exhaustive static coverage. Existing flow generation uses an explicit legacy projection: duplicate class revisions and reached overloaded methods fail with canonical candidates instead of silently selecting one. A signature-aware flow adapter can replace that projection separately.

Verification:

```sh
node dev/impact-readiness.js --assert-ready
node --test test/impact-readiness.test.js test/code.index.test.js test/pgindex.test.js test/flows.test.js test/testdata.test.js test/performance.test.js
node dev/benchmark-impact.js --assert-ready --output docs/benchmarks/impact-scale.json
```

The scale fixture uses 1,000 passports, at least 100,000 edges, four library revisions and 200 cached synthetic tables/2,000 columns. The committed report records the host, cold/warm timings, memory and byte limits. It is a reproducible synthetic benchmark, not an external production catalog or live deployment measurement. Frozen baseline evidence remains unchanged.
