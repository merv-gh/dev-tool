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
