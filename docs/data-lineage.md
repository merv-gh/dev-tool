# Data access index and cross-service traces

## Delivery plan

1. Build a separate, persistent SQLite projection in owned background jobs. Index cached repositories and their pinned libraries, database procedures/views/triggers, ORM mappings and transport boundaries. Reuse unchanged source segments, publish generations atomically, retain earlier generations and keep the last good result during refresh.
2. Answer **who reads** and **who writes** for exact tables, columns, functions, Kafka topics and Elasticsearch indices. Keep SQL access, generated repository operations, object getter/setter access, reviewed mappings and substring candidates distinct. Add configurable aliases and reviewed links without changing source evidence.
3. Trace a bounded call/access path from an API, method or service through inherited library code and transport boundaries to a column or exit. Preserve repository revision, database, environment and broker identity. Missing identity, ambiguous overloads, dynamic SQL and payload mappings are explicit gaps; static access is not runtime or value-flow proof.
4. Present results in the existing compact inline/show style: status first, searchable access evidence, flat path steps, retained source links and prepared follow-up actions. No deep indentation or unbounded lists.
5. Verify with a disposable multi-repository fixture: inherited API, entity-backed Spring repositories, Lombok accessors, SQL procedures/triggers, two Kafka clusters, an ES sink, ambiguity, stale refresh, failure/cancellation, ownership, pagination and output limits. Exercise the real tools, renderer and release bundle.

## Implemented tools

`data_readers` and `data_writers` answer which cached services, SQL routines and methods access a table/column. `data_trace` follows a bounded API-to-column or cross-service call/access path. `data_index` observes, refreshes and configures the projection. Existing `pg_usage`, `field_trace` and impact tools keep their behavior.

This is **static evidence**, not proof of execution, path feasibility or field-value equivalence across a mapper/message boundary. For precise local Joern data/control-flow investigation, continue with [`semantic_trace`](selected-path-tracing.md); verify important findings with outside-in tests and runtime observations.

## First investigation

Use cached `find` discovery for the exact database/object name. Refresh upstream code/catalog caches when needed; the data projection does not fetch remote repos or refresh live catalogs itself.

```sh
node cli.js tool data_readers '{"env":"dev","name":"alpha:public.person.legal_name"}'
node cli.js tool data_writers '{"env":"dev","name":"alpha:public.person"}'
node cli.js tool data_readers '{"env":"dev","name":"alpha:public.rename_person"}'
```

If missing, the index starts in an owned background job. Observe it and repeat the query:

```sh
node cli.js tool data_index '{"job":"<returned job.id>","waitMs":30000}'
node cli.js tool data_index '{"env":"dev","action":"status"}'
```

Progress includes discovery, each source/database and publication, with timings and reuse counts. Observation waits are bounded; `job_cancel` cancels the owned job. After failure/cancellation, explicitly call `data_index` to retry. Repeated access queries do not loop on a failing build.

Access mode uses exact names. `db:schema.table.column` avoids collisions. Duplicate databases, function overloads, routes, repository revisions and same-name topics on distinct clusters require selection; canonical IDs from results remove ambiguity.

For a name embedded in a class or manually assembled query:

```sh
node cli.js tool data_readers '{"env":"dev","name":"person_document","mode":"mentions","limit":100}'
```

This finds case/punctuation-normalized substrings such as `PersonDocumentRepository`. At least three normalized characters are required. It works for names absent from the catalog and pages all matches with a separate cursor. Name matches have `access=unknown`; they never become readers/writers. Ordinary access results include only a short candidate preview.

## Evidence and column mapping

| Evidence | Meaning |
| --- | --- |
| SQL read / predicate / write | A recognized SQL statement names the object/column; routines, views and triggers retain their own source location. |
| Routine invocation | A caller invokes a routine; body read/write effects remain separate. |
| ORM operation / derived property | Entity/property/repository inference, explicitly labelled as a candidate. |
| Object read / write | Getter, setter, field operation or row mapper. Changing an object does not establish persistence; these records are shown separately. |
| Reviewed link | A user-declared relation with its explanation, never promoted to an observation. |
| Substring candidate | Discovery only; excluded from access facts. |

Supported patterns include literal/text-block SQL, named parameters, `@Query`/JPQL properties, procedure calls, entity `@Table`/`@Column` mappings, supported getter annotations, mapped superclasses, Spring Data repository entity types, MyBatis namespace/statement bindings, ResultSet labels, accessor bodies and conventional Lombok accessors. Dynamic MyBatis branches/includes remain candidates with a gap. Spring Data inferences follow [property-based query naming](https://docs.spring.io/spring-data/jpa/reference/repositories/query-methods-details.html) and [declared queries](https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html); the framework is not executed to validate them.

An explicit getter body takes precedence over its name: `getIgnored()` returning `displayName` is attributed to the actual field. Generated accessor inference is disabled for detected custom Accessors/access suppression/configuration, with a gap. See Lombok’s [getter/setter rules](https://projectlombok.org/features/GetterSetter) and [Accessors configuration](https://projectlombok.org/features/experimental/Accessors).

Dynamic SQL, unresolved libraries/receivers, runtime bean selection, custom persistence providers, unsupported annotations and incomplete catalog snapshots remain gaps. An empty result means no detected access in this projection, not absence of use.

## API to column, Kafka and ES

```sh
node cli.js tool data_trace '{"env":"dev","from":"GET /person/42","service":"person-api","to":"alpha:public.person.legal_name"}'
node cli.js tool data_trace '{"env":"dev","from":"POST /person/update","to":"es:people-search"}'
```

Starts accept canonical IDs, detected HTTP routes, fully qualified methods/signatures or `service:<name>` (detected HTTP entries). For other starts, select an exact topic/method ID. Targets include columns, tables, routines, `topic:<name>` and `es:<name>`. Routes accept concrete path values for parameters.

Inherited HTTP methods and explicitly pinned internal libraries participate, including supported `this`/`super` calls and abstract dispatch. Library declarations retain their source identity separately from application registration and caller evidence. Missing dependency versions become gaps, never an arbitrary replacement branch.

Kafka joins require the same environment, topic and literal broker identity. ES nodes retain cluster identity too; unknown clusters stay source-local. A matching source environment profile is selected when present, with a warning that runtime activation was not observed. External configuration, aliases, serialization/mapping, consumer groups, retries, transactions and delivery semantics require verification. A topic connection does not prove the same field value reaches the consumer.

Paths report proof labels, assumptions and traversal cuts. Reads do not activate write triggers. Complete Spring routing variants, reflection, arbitrary aliasing and all runtime paths are not exhaustively modeled.

## Freshness, scope and reproducibility

`repos` selects cached repository/index keys or globs; default is all cached repos and their explicitly indexed pinned libraries. There is no small impact-graph repository cap. Cold cached checkouts are indexed in the worker; no remote fetch or model call occurs.

Freshness is relative to **upstream cache/index fingerprints**, not a filesystem/deployment watcher. Code/graph manifests, catalog manifests, passport stamps and rule revisions invalidate the projection. Rebuild code indices after changing a checkout and refresh catalogs after database changes. New source segments hash-check indexed files before publication; input fingerprints are rechecked before generation publication.

Stale queries serve the last complete generation while refreshing. Errors remain visible without losing prior evidence. `generation` selects retained evidence without automatically refreshing; `cursor` continues its original query/generation and rejects another query. Keep repository selectors unchanged when continuing. Model previews default to 16 KiB, overridable with `max_output_bytes` (4–64 KiB); omissions are explicit and the retained view keeps the full bounded page.

Source actions pass exact revision and `expected_source_digest` to `code_read`; changed files/indices are rejected rather than substituted. Library declaration and call-site evidence retain separate source metadata. Escaped/concatenated Java SQL uses the literal start plus SQL-relative line; multiline source SQL uses source lines. Database actions explicitly inspect the **current cached** definition, not a historical routine body.

Native result hosts permit normal-tab handoffs only for same-origin retained `/show` responses; each response CSP still restricts custom overrides. Snapshots gain no network or same-origin access. External hosts such as Open WebUI may impose stricter outer sandbox rules; when they cannot permit popup escape, open the retained URL directly in a normal browser tab.

Immutable SQLite segments are reused and complete generations published atomically. One principal can reuse source segments across chats; generations, private rules and jobs remain task/story scoped. Principals have separate stores and environment authorization still applies. Legacy single-user storage is `cache/<env>/data-lineage.sqlite`; multi-user stores are under `cache/_data-principals/`. No destructive automatic history cleanup occurs. Back up through SQLite or copy a quiescent database with its required WAL state.

## Custom indexing rules

Read `data_index` with `action=status` for `rulesRevision`. Configure a complete replacement rule set using that revision:

```json
{
  "env": "dev",
  "action": "configure",
  "expected_revision": "<rulesRevision>",
  "rules": {
    "aliases": [{"target": "alpha:public.person.legal_name", "names": ["PersonNameRepository"]}],
    "links": []
  }
}
```

Aliases expand name discovery without asserting access. Reviewed links use exact canonical `from`/`to` IDs from evidence, required `evidence`, and optional `relation`/`access` (`read`, `write`, `mapping`). Unresolved IDs become gaps. Changes are revision-checked and private to the current principal/task. Old generations retain their original links. The next query refreshes the changed projection; `data_index` can start it explicitly.

## Performance and bounds

Serving status/retained queries reads lightweight source headers and SQLite adjacency, without parsing full source inventories or PostgreSQL catalogs. Builds process sources sequentially, release loaded graphs and reuse unchanged segments. Job/runtime telemetry includes progress, timings, counts, reuse and failures.

| Bound | Default / override |
| --- | --- |
| Access page | 30 rows; `limit` 1–200; at most 1 MiB retained page |
| Service attribution | `maxNodes=500`, `maxHops=20`, `budgetMs=1000`; schema-bounded overrides |
| Trace | `maxHops=30`, `maxNodes=3000`, `maxPaths=5`, `fanout=200`, `budgetMs=1000`; schema-bounded overrides |
| Inline DOM | 25 direct/object records or path steps at a time, plus server continuation |
| SQL analysis | 256 KiB fragment / 20,000 tokens; clipping is a gap |
| Name candidate text | First 2,048 characters per indexed source line; use `code_search` for longer lines |
| Columns per referenced table | 4,096; `DT_DATA_INDEX_COLUMNS_PER_TABLE` up to 50,000; clipping reported |

Node must provide `node:sqlite` (Node 22.13+ or Node 24). This is a single-host projection, not a distributed catalog or a claim of exhaustive support for millions of objects.

## Verification

`test/data-lineage.test.js` covers SQL/procedures/triggers, ORM/accessor/row mappings, named parameters, MyBatis, inherited/transitive APIs and dispatch, before/after revisions, profiles, Kafka/ES cluster separation, rules, pagination, ownership, background progress, cancellation and failed publication.

Scale cases index 200 synthetic services without a repository cap and serve retained queries in a 64 MiB Node heap with a million-entry source manifest and a legacy PostgreSQL catalog exceeding 200 MiB. This verifies serving memory behavior, not rebuilding a production catalog at that size.

The [disposable demo](../demo/data-lineage/README.md) exercises real HTTP tools, code indexing, workers, SQLite and the production renderer on synthetic sources/catalogs. Browser checks cover desktop/phone, source actions, candidates, ambiguity, missing data, failed refresh preserving evidence and explicit recovery. No live Java service, Joern, database or Kafka cluster is executed by these tests.

The [recorded verification](../demo/data-lineage/evidence/tests.json) passed 248 targeted regressions (26 dedicated lineage cases) and the browser suite passed 13 checks with 17 captures. The independent [finish verdict](../demo/data-lineage/review.md) resolved its three findings: embedded handoff, long identifiers and candidate wording.
