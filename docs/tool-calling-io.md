# Tool output and test selection

All tool schemas accept the same optional boolean: **`all`**. For MCP/OpenAPI chat calls, `all:true` returns the full available response in one call, bypassing the chat byte preview. Tables and reports expand their retained backing data where available. Existing `format:"full"` options remain compatible; `all` is preferred.

This controls presentation, not operational scope. It does not remove SQL limits, source/query safety caps, graph traversal limits, missing data, or result expiry. It never automatically retries actions or starts another query to recover old output.

Chat replies include `modelContext.output`:

| Field | Meaning |
|---|---|
| `status:"all"` | The whole available tool value is returned. This does not assert exhaustive source coverage. |
| `status:"part"` | A known preview or continuation page is returned. |
| `status:"truncated"` | A chat byte limit or declared source/tool truncation applies. |
| `source:"partial"` | Known source gaps, query limits, incomplete analysis or further pages exist; inspect `limits` and native completeness flags. |
| `source:"unknown"` | No exhaustive source-completeness guarantee is available. |
| `omitted` | Known tool-preview omissions such as rows, samples or text. |
| `requestedAll:true` | The caller requested full output. Remaining source/tool limits still apply. |

Small primitive/array chat values are wrapped in `result` to carry this metadata. Direct `/api/tool`, code and script callers retain their native value shapes. They also accept `all:true` to request expansion, but do not receive chat metadata. Check the tools' native source completeness flags there.

Recover an existing result without repeating the original call:

```json
{"id":"RESULT_ID","all":true}
{"id":"RESULT_ID","path":"/cases","all":true}
{"id":"RESULT_ID","path":"/rows/0","max_bytes":1024}
```

These are `result_read` arguments. `id` accepts `modelContext.resultId` or the last segment of a table/report `view` URL. `all:true` returns typed JSON under `value`. Otherwise, the existing JSON-text pages and `nextCursor` contract apply. Do not combine `all:true` with a cursor. Ownership and retention checks apply to both modes. A retained result cannot recover data that an upstream system never supplied or an earlier tool stage did not retain.

## Search discovery

Use **`tool_search`** to discover capabilities and specialized searches. It searches enabled tool names/descriptions, not the underlying code, catalog or saved scripts. `search_tools` is accepted as a compatibility alias for `tool_search`, with identical grants and tracing; it is not listed as a second tool.

| Need | Tool and example arguments |
|---|---|
| Discover saved-script search | `tool_search({"query":"search saved scripts"})` |
| Search saved script metadata | `script_search({"query":"unpaid orders"})` |
| Get every matching script | `script_search({"query":"orders","all":true})` |
| Discover a search for another source | `tool_search({"query":"search code"})` |
| Get every matched capability | `tool_search({"query":"search","all":true})` |

`script_search` matches all query words against script ID, description and parameter names, optionally within a collection. It returns exact IDs usable by `script_get`/`script_run` and never executes a script. Script search is included in the everyday/testing profiles and discoverable from the smaller profiles.

For non-exact capability queries, `tool_search` also returns a `searches` directory of authorized content-search tools, filtered by group when supplied. This remains useful when a model searches for business terms rather than a capability name.

## Forgiving `test_run` inputs

| Input | Behavior |
|---|---|
| `{}` | Run all supported tests when exactly one owned workspace exists; otherwise return an actionable workspace-selection error. |
| `{"workspace":"w1"}` or `{"workspace":"w1","tests":[]}` | Run the supported suite in that workspace. |
| `{"workspace":"w1","tests":"OrderTest"}` | Same as `tests:["OrderTest"]`. Comma-separated names are accepted. |
| `{"workspace":"w1","scope":"diff"}` | Select changed tests against the pinned checkout base, including current staged, unstaged and untracked changes. |
| `{"workspace":"w1","tests":"-diff"}` | Same as `scope:"diff"`. `--diff`, `diff`, `changed`, `diff:true` and `"-diff":true` are compatibility aliases. |
| `{"workspace":"w1","tests":"all"}` | Same as omitted tests; `"*"` is also accepted. These tokens are reserved selection aliases. |
| `{"job":"j1"}` | Observe the existing owned test job; no new execution. An optional workspace must match. |
| `{"job":"j1","all":true}` | Retrieve the existing job's full retained test report in one call. |

`mode` continues to mean execution engine (`auto`, `fast`, `build`). Misplaced selection aliases such as `mode:"diff"` are normalized, but canonical examples use `scope`. Conflicting scope/named tests, null/numeric/blank selectors, unknown fields and poll calls mixed with start/edit options are rejected. Never guess a live target or fixture override. `env` is source provenance; reviewed `target` configuration selects execution/dependencies.

JSON-encoded selector arrays such as `tests:'["test/a.test.cjs"]'` are accepted for clients/models that encode a list inside a string. Invalid JSON and non-string array entries receive correction errors. A short Node test filename such as `a.test.cjs` resolves within the reviewed discovered suite only when unique; ambiguous names require an exact path. Arbitrary source/helper basenames and fixture/symlink trees do not participate in this fallback.

Node suite discovery finds `.test`/`.spec.js/.cjs/.mjs` files and excludes symlinks, hidden/generated/vendor directories and fixture trees. Explicit paths continue to use the reviewed Node runner. Maven/Gradle all-suite execution runs the root project build without class filters and collects fresh reports across discovered modules. Mixed Node/JVM suites require explicit tests. Unsupported profiles return an error.

Diff selection directly runs changed Node test files when all relevant changes are to those runnable tests. Production/build changes, deletions, and any case without proven dependency coverage conservatively run the full supported suite. The `selection` receipt records the resolved base, changed count, profile/modules, completeness and `fallback:"all"` with its reason. JVM source-file counts are reported separately; runnable test counts come from the build's fresh reports. An empty/docs-only diff returns `outcome:"not-run", reason:"no-affected-tests"`, never a passing test proof. Invalid bases fail before applying `files` edits.

CLI equivalents:

```sh
node cli.js tool test_run '{"workspace":"w1"}'
node cli.js tool test_run -diff
node cli.js tool test_run '{"workspace":"w1"}' --diff --all
node cli.js tool result_read '{"id":"RESULT_ID"}' --all
```

Exact tool names in `tool_search` return only that capability, including with `all:true`; non-exact requests include the specialized content-search directory.

## Discovery handoff and retained-data calculations

Exact-name `tool_search` matches include the complete `inputSchema` and direct `tool_execute` guidance. The optional `tool_describe` route remains available. Discovery never runs the returned capability. For a search with only a required `query`, a mistaken input such as `tool_search({query:"script_search invoice"})` returns the explicit proposed call `tool_execute({name:"script_search",arguments:{query:"invoice"}})`; it does not search script data itself. This interpretation applies only to enabled tools in the requested group. No repeat-detection history or cross-session state is involved.

Use `result_read` to compute over retained rows instead of doing arithmetic over a preview:

```json
{"id":"RESULT_ID","aggregate":"sum","field":"value"}
```

`aggregate` accepts `count`, `sum`, `avg`, `min`, or `max`. `count` counts rows and takes no `field`; other operations require an exact top-level numeric field. `path` selects an array and defaults to `/rows` when the retained root has a rows array. Every retained row is processed in one call; `all:true` remains accepted but is unnecessary for the small aggregate response. The result includes the operation, numeric value, processed row count, source coverage, and a raw-data read reference.

For inspection or model reasoning, project only relevant fields:

```json
{"id":"RESULT_ID","fields":["id","value"],"all":true}
```

Projection includes every retained row and fails if a requested field is absent. Ordinary chat output limits still apply without `all:true`; the exact projected result remains recoverable. Projection and aggregation cannot be combined, and neither accepts a pagination cursor. Existing raw reads and JSON-text pagination remain available.

`retainedComplete:true` in projection/aggregation receipts means the selected retained data was fully processed. Legacy raw reads keep `complete` and now include `completeScope` to distinguish retained values or JSON bytes from source coverage. `sourceCoverage.provenComplete` remains false when source completeness is unproven; `sourceCoverage.status` separately reports `partial` or `unknown`; it never certifies that the original query covered the entire source. Source truncation, gaps and omitted retained data remain visible even when selecting only `/rows`. An aggregate over partial source data is a total of retained rows, not a total of the unavailable source.

Numeric operations reject null, missing, nonnumeric, nonfinite and unsafe integer values, plus overflowing intermediate totals, instead of coercing or dropping rows. Arithmetic uses JavaScript numbers, not arbitrary-precision decimal math. Empty-array `sum`/`count` return zero; `avg`/`min`/`max` return null. Use `code` with an explicit precision policy for decimal-sensitive calculations.

When a script-oriented capability query has a clear leading `script_search` match, discovery offers an explicit call using the content words from that query. Generic request words such as “find the saved script for” are removed from the proposed content query; no saved script data is read until that call executes. Exact schemas and enabled-tool/group filtering still apply.

For a numeric single-field projection, `next` offers a sum call with the actual retained id, resolved array path and field. A mistaken path such as `/rows/value` is normalized to `/rows` only when the last component agrees with the single projected field or aggregate field. The response reports `normalizedFrom`. Raw JSON-pointer reads remain strict, and mismatched or nonterminal components still fail.

`script_get` includes a derived `requiredParams` name list beside its exact definition, so parameter-inspection tasks can answer without repeatedly re-reading the same nested schema.

Compacted row previews may also include `modelContext.numericSummary`: sums computed over every retained row, never over the visible sample. It summarizes at most four numeric non-ID columns with names up to 40 characters, and only for arrays of at most 100,000 rows. A column with any missing, nonnumeric, unsafe or overflowing value is excluded. The summary names its scope and row count, does not prove source completeness, and is omitted if it cannot fit the response budget. The same calculation implementation serves explicit aggregate calls. Original rows remain available through the retained result reference.

For small-model script inspection, select the `scripts-read` client profile. It exposes only `script_search` and `script_get` as native tools, avoiding the general discovery dispatcher. It adds no permissions and exposes no script execution tool. The everyday `direct` profile also includes `script_get` beside script search/list/run.

OpenAPI selection: `/openapi/scripts-read.json`, or `tools.profile` / `DT_TOOL_PROFILE` for the default OpenAPI schema. MCP keeps its existing all-tools listing; MCP clients must select the two native tools explicitly when using this focused approach.
