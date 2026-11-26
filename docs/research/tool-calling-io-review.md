# Tool calling inputs and outputs: research and proposed contract

Research date: 2026-11-26. This review and its inventory preserve the pre-implementation baseline. See [the implemented contract](../tool-calling-io.md) for current behavior and limits.

## Recommendation

Keep complete tool values for code, scripts, API clients and views. Give chat clients a small, typed, task-relevant projection: outcome, selection, counts, the most useful evidence, explicit omissions, and a reference to the retained original. Apply the projection before the existing emergency byte cap. Do not make a model recover basic facts through several raw-data calls.

For `test_run`, make omitted selectors mean **all tests in the resolved workspace**, accept a single selector string, and support `-diff` as a forgiving alias for a canonical `scope:"diff"`. Make `{job}` sufficient to poll. Resolve an omitted workspace only from an unambiguous owned context; otherwise return candidates. Separate selection (`all`, `diff`, named tests) from execution (`auto`, `fast`, `build`).

## Scope and evidence

The clean built-in registry contains **326 tools in 25 groups**. The [inventory](tool-io-inventory.json) lists every tool, required fields, input strictness, parameter names, definition bytes, groups and profiles. Inspect the current registry with (the historical inventory remains unchanged):

```sh
node docs/research/tool-io-audit.cjs > /tmp/tool-io-current.json
```

The script uses a disposable config with no custom tools, plugins or starter collections. It now inspects schemas only; the baseline validation observations are preserved in the historical inventory. No environment queries, builds, pushes or external effects are needed. Configured SQL/HTTP tools, JS plugins and exposed collections can add arbitrary result shapes, so a built-in inventory cannot enumerate those deployment-specific schemas. They need the same fallback projection and capability metadata.

Coverage here is an inventory of every built-in tool and a source review of the shared transport, presentation and output families. It is **not** a claim that all 326 actions were executed or that production payload sizes were measured. Before/after examples below are illustrative source-shaped fixtures, with invented names/values. Proposed fields and behavior do not exist yet unless explicitly marked current.

Only two built-ins declare registry-level `adapterSchema` result contracts (`knowledge_search`, `knowledge_graph`). Other subsystems have their own contracts, but there is no universal per-tool output schema to mechanically inventory every response variant. Introduce a versioned chat presentation contract separately from backend result contracts; keep domain-specific evidence fields and compatible native outputs.

Primary source entry points:

| Area | Source | Finding |
|---|---|---|
| Registry, input validation, table helper | [tools.js](../../lib/tools.js) | Shared tool values; defaults inserted before validation; most tools have no general result contract. |
| MCP/OpenAPI/API | [server.js](../../server.js) | MCP/OpenAPI apply chat projection; `/api/tool` returns the complete tool value. MCP success is JSON inside text; errors additionally carry `structuredContent`. |
| Emergency compaction | [chat-context.js](../../lib/chat-context.js), [chat-pressure.js](../../lib/chat-pressure.js) | Default cap 12,288 bytes; exact pre-compaction response retained when possible. |
| Result storage | [results.js](../../lib/results.js), [tools-context.js](../../lib/tools-context.js) | Views, retained JSON and `result_read`; storage has limits and expiry. |
| Tests | [tools-code.js](../../lib/tools-code.js), [testrun.js](../../lib/testrun.js), [testout.js](../../lib/testout.js) | Test result projection is already useful; input requirements and selection are the larger problem. |
| Selection/build boundaries | [node-test.js](../../lib/node-test.js), [test-targets.js](../../lib/test-targets.js), [dev/test.js](../../dev/test.js) | Reviewed Node file execution, target manifests, and a separate dev-tool-only changed-test selector. |
| Existing specialized projections | [semantic-response.js](../../lib/semantic-response.js), [tools-semantic.js](../../lib/tools-semantic.js), [tools-knowledge.js](../../lib/tools-knowledge.js), [tools-data-lineage.js](../../lib/tools-data-lineage.js) | Reuse domain-aware bounds, certainty and provenance instead of flattening everything uniformly. |
| Tool discovery | [tool-profiles.js](../../lib/tool-profiles.js), [tools-discovery.js](../../lib/tools-discovery.js) | Profiles already reduce schema cost; search/describe add calls and can repeat descriptions. |

## Current transport and retention behavior

| Consumer | Current result | Implication |
|---|---|---|
| MCP | One text block containing string/JSON, after `chat-pressure.response` | Bounded chat output; success lacks a declared MCP output schema. |
| OpenAPI `/oapi/*` | Bounded JSON; with a view, `['embed', result]` plus embedding headers | Preserve the existing native viewer path. |
| `/api/tool/*` | `{result: completeToolValue}` | Suitable for programmatic consumers; do not silently change its shape. |
| CLI `tool` | Complete tool value, pretty JSON by default; `--compact` removes whitespace | CLI compactness currently means serialization, not fewer fields. |
| `code`/scripts/internal tools | Complete tool values before chat projection | Best place to aggregate large data; project only the final return to chat. |
| Views/files/diagrams | Table, JSON, graph, report, patch or binary artifact | A human viewer is useful but insufficient as the only machine-readable bridge. |

The generic cap preserves small values exactly, including arrays, strings, `false`, `0` and `null`. Above the cap it retains the response, takes at most 35 object keys, samples arrays at three items near the root and one deeper down, clips strings to about 700 bytes, and limits depth. It prioritizes outcome/job/identity fields. It does **not** explicitly prioritize `complete`, `truncated`, `nextCursor`, gaps or proof. Array shortening has no per-array omitted count. A failure or important caveat after the sampled prefix can disappear; another truncation layer can obscure a domain-aware projection.

The retained generic response is the value handed to chat, **not necessarily the original backend payload**. Earlier tool-level clipping cannot be undone by `result_read`. Examples: `pg_function` clips bodies at 8,000 characters and usage edges; `kafka_topic` keeps one sample; `tabular` previews rows, and its saved table retains at most 10,000. This distinction must appear in completeness metadata.

`result_read` currently reads only `saveTool` records produced by generic oversized-response retention, not every table/view result. It pages JSON **text**, not typed item arrays: default 1,024 bytes, maximum 1,536 at the default response cap. JSON pointer selection is supported; a pointer read loads the retained JSON before selecting the field. Cursors bind to result/path. A machine cannot assume `view` alone implies `result_read` support.

Retention is bounded: `saveTool` rejects responses over 20,000,000 bytes; ordinary unretained results are pruned by count (500) and configured storage budget (default 500 MiB) within scope. Table storage separately caps at 10,000 rows. `tabular` silently catches view-save failures; the generic cap reports `evidenceSaved:false` on retention failure. Improve that inconsistency before describing any bridge as guaranteed. Durable evidence belongs in task memory or explicitly retained artifacts.

## Output families and verbosity review

These families cover the built-ins; a tool can return several, depending on operation or state. The inventory provides the exhaustive name list. Risk means potential context cost or lost meaning, not a measured production failure rate.

| Output family | Representative tools | Current verbosity / risk | Recommended chat default | Bridge to details |
|---|---|---|---|---|
| Primitive/text/name lines | `find`, `site_url`, plugin returns | Usually cheap; arrays can reach 50–300 lines | Preserve small values; for large search results return count + 5 exact matches | Retained lines + cursor; exact selected object tool |
| Search/list pages | `catalog_search`, `code_search`, `docs_search`, `files_list`, `metadata_list` | Repeated identifiers, metadata and snippets; varying paging conventions | 5 ranked matches, short snippet, exact ID/location, total semantics | Cursor + retained result; distinguish page total from corpus total |
| Tabular data | `pg_query`, `es_search`, `kafka_last`, `pg_usage` | Row caps do not bound wide fields or nested message bodies | 3–5 rows, relevant columns, field truncation markers | Typed result page / pointer; existing table view |
| Health/status | `health`, `overview`, `consul_service`, `es_health`, `kafka_lag` | Healthy replicas/checks often dominate | Counts and only exceptional services/checks; observation time | Full health table / service detail |
| Definition/schema | `pg_table`, `pg_function`, `kafka_topic`, `fixture_schema` | Full columns, defaults, body, usages, schemas and samples | Identity + concise signature/columns + important dependencies; body opt-in | Definition/body/usage sections from retained result |
| Text/source/logs | `code_read`, `workspace_read`, `files_read`, `docs_page`, `jenkins_log`, `dt_log` | Large text; base64 is particularly expensive | Requested line/window; revision and exact locator; error-focused log excerpt | Line/byte ranges, download, retained text; binary metadata + artifact |
| Dossier/nested entity | `passport`, `feature`, `test_context`, `architecture_service`, `knowledge_entity`, `project_context_get` | Repeated source records, long nested arrays and generated artifacts | Identity/revision, counts, key findings and unresolved gaps | Section pointers + exact source locations + dossier view |
| Graph/path/impact | `impact`, `field_trace`, `semantic_query`, `semantic_trace`, `data_trace`, `map_path`, `repo_model` | Nodes/edges, repeated long IDs and source evidence; meaning lost if caveats clipped | Path/impact summary + 1–3 relevant paths; preserve direction, certainty, pins and gaps | Focused graph view; bounded neighborhood/path pages |
| Change/diff/patch | `diff`, `workspace_patch`, `scenario_diff`, `experiment_compare`, `gradle_bump` | Full objects or hunks can dominate | Changed counts + 1–3 significant differences + validation/freshness | Exact patch/export and hunk/field pages |
| Mutation receipt | `workspace_write`, `context_write`, `script_save`, `kafka_produce`, `workspace_push` | Echoing content/config or operational metadata is costly | Effect, ID/path, revision, changed count, warnings/unknown outcome | Retained receipt; read saved resource separately |
| Job/lifecycle | `catalog_sync`, `test_run`, `collection_run`, `job_get`, `code_wait`, `service_env_status`, `task_run_status` | Polls repeat logs, config, result and prose instructions | Job ID, state, current progress and copyable resume call; terminal result once | Cursor/delta log + retained job/result |
| Test/assertion/build report | `test_run`, `jenkins_tests`, `collection_report`, `scenario_assert`, `differential_check`, `test_coverage` | Failures plus stacks/snippets/execution metadata; passing output still bulky | Outcome, selected/run counts, 3 failures, expected/actual, one relevant location each | Failure/report/log sections; full test view |
| Fixture/data/scratch resources | `test_data`, `fixture_capture`, `fixture_runtime_*`, `testdb_*`, `scenario_state_get` | Embedded rows, SQL, bindings and manifests; handles cannot be clipped | Counts + completeness + resource/lease handles + lifecycle/cleanup state | Captured data/SQL/manifests and binding detail, through existing access checks |
| Discovery/schema/capabilities | `tool_search`, `tool_describe`, `tool_profiles`, `tool_contracts`, `handbook`, `doctor` | Definitions and long descriptions multiply; repeat next-step prose | Short intent + required/conditional inputs + 2–3 examples; focused diagnostics | Full schema/contract/guide on request |
| Presentation/artifact | `show`, `diagram`, `architecture_export`, `map_ui_preview`, `files_show`, `ui_page` | Can repeat both payload and rendered content; screenshot/base64 | Artifact kind, title, dimensions/counts if useful, view/file handle | Native viewer/download; structured backing data when available |
| Arbitrary execution/envelopes/errors | `code`, `js_run`, `script_run`, `tool_execute`, `context_run`, custom/plugin tools | Arbitrary JSON and nested wrappers; errors vary by transport | Domain projection for nested value; execution and persistence outcomes separate; typed actionable error | Exact retained value + trace/call ID; never replay an effect to recover output |

## Proposed compact contract

Use recognizable JSON names. Avoid one-letter keys, positional tuples as the universal format, or a second prose summary duplicating the same fields. Compactness should remove irrelevant/repeated data before shortening identifiers.

Illustrative chat-only projection:

```json
{
  "outcome": "failed",
  "workspace": "w1",
  "selection": {"scope":"diff","selected":8,"complete":true},
  "counts": {"tests":31,"passed":30,"failed":1,"errors":0,"skipped":0},
  "failures": [{"test":"OrderTest#total","expected":"42","actual":"41","file":"src/test/java/OrderTest.java","line":18}],
  "preview": {"shown":1,"total":1},
  "dataComplete": true,
  "evidence": {"id":"r1","sections":["/cases","/compile","/tail","/execution"]},
  "view": "/show/r1"
}
```

`preview.total` refers to that preview's item collection; do not invent a global count for an arbitrary object. Use `total:null`/unknown when the backend cannot know it. `dataComplete` is about the underlying operation/data; `preview` describes deliberate presentation omission. Preserve native domain completeness/traversal/freshness/proof flags rather than guessing them from the existence of a saved result.

Proposed details access: extend `result_read` to all retained result kinds with adapters for their backing data. Keep its JSON-text compatibility mode; add a typed, item-bounded mode for arrays/objects and a `fields` projection. Retain an immutable original **before** domain projection. Return a result ID even for compact small replies that omit details. Suggested calls:

```json
{"id":"r1","path":"/cases","offset":0,"limit":20,"fields":["class","name","status","message"]}
{"id":"r1","path":"/tail","max_bytes":4096}
```

`offset`, `limit`, `fields`, the larger page budget, and cross-kind support above are proposed additions. Existing `result_read` accepts `id`, `path`, `cursor`, `max_bytes` and returns JSON text pages. Do not instruct a deployed model to use proposed fields before shipping them.

Keep `view` for people and `evidence.id`/section selectors for models. Return `evidence:{saved:false,reason:...}` when storage fails, with explicit unrecoverable omissions. Preserve access scope, masking and retention behavior. Do not put secrets in newly retained data; reuse the current redaction boundaries. A view is not proof of a complete backend query or a permanent archive.

Suggested initial budgets, to validate with fixtures: ordinary chat responses 2–4 KiB, diagnostic failures up to 8 KiB, current 12 KiB fallback cap retained. Keep small direct primitive values unchanged. No claim of token reduction is made from these byte targets alone.

Always keep exact actionable IDs, job/lease handles, revisions, status/outcome, primary and cleanup failures, unknown effects, missing coverage, ambiguity, truncation and continuation. Never use generic prefix sampling for these fields. Put repetitive guidance in tool descriptions; use one structured `next` only when a next action is needed. Do not add `ok:true`, empty lists and a sentence saying the same thing to every reply.

## Before/after example outputs

**Examples are abbreviated illustrative values, not measured live responses.** `…` means explanatory omission in this table; `/show/r1` and IDs are placeholders. The right column is a proposal. All omitted details require a retained result; it cannot recover data the backend never fetched.

| Tool / state | Before: current shape or tendency | After: proposed chat output |
|---|---|---|
| `find` many matches | `["pg orders sales.orders ...", "pg orders sales.order_items ...", …50 lines]` | `{"total":50,"totalKind":"returned","matches":["pg orders sales.orders ...",…5],"more":45,"evidence":{"id":"r1"}}` — avoid treating the capped 50 as all matches |
| `pg_query` | `{"db":"orders","route":{…},"ms":18,"total":100,"rows":[…10 wide rows],"view":"/view/r1"}` | `{"db":"orders","rows":[{"id":42,"status":"open"},…3],"preview":{"shown":3,"total":100},"evidence":{"id":"r1"},"view":"/view/r1"}` — fetch/query truncation flags retained when applicable |
| `es_search` | `{"totalHits":1200,"ms":22,"total":20,"rows":[…10 nested hits],"view":"/view/r1"}` | `{"matched":1200,"fetched":20,"hits":[{"id":"42","status":"open"},…3],"evidence":{"id":"r1"},"view":"/view/r1"}` — keep hit-count relation/exactness if available |
| `kafka_last` | `{"total":5,"rows":[…3 full message envelopes/bodies],"view":"/view/r1"}` | `{"fetched":5,"messages":[{"partition":0,"offset":81,"key":"42","type":"order_created"}],"preview":{"shown":1,"total":5},"evidence":{"id":"r1"},"view":"/view/r1"}` |
| `health` | Summary plus up to 15 services with replicas/checks | `{"healthy":28,"degraded":1,"down":0,"issues":[{"service":"billing","check":"db timeout"}],"observedAt":"…","evidence":{"id":"r1"},"view":"/view/r1"}` |
| `pg_function` | Arguments, body up to 8,000 chars, many `uses` and `usedBy` edges | `{"name":"sales.total","signature":"(id bigint) -> numeric","reads":["sales.orders"],"callers":7,"evidence":{"id":"r1","sections":["/body","/usedBy"]}}` |
| `code_search` | Match rows plus repeated repository/backends/planner metadata | `{"matches":[{"repo":"SHOP/orders","file":"Order.java","line":18,"text":"return total;"}],"truncated":false,"evidence":{"id":"r1"}}` — retain scanned/unindexed facts if coverage is incomplete |
| `files_read` binary | Metadata plus long base64 `content` | `{"path":"report.zip","encoding":"binary","bytes":64000,"artifact":"…"}` — actual authenticated download/handle must exist |
| `passport` | Nested dependencies/endpoints/tables/source evidence | `{"service":"orders","revision":"sha1","counts":{"endpoints":12,"tables":4},"gaps":[],"evidence":{"id":"r1"},"view":"…"}` |
| `semantic_trace` | Analysis IDs, layers, paths, nodes, edges and caveats | `{"assessment":"static path found","paths":2,"proof":"static","complete":false,"gaps":["dynamic dispatch unresolved"],"path":["Order.create","Repository.save"],"evidence":{"id":"r1"},"view":"…"}` — preserve exact selectors in evidence and any IDs needed for next calls |
| `workspace_patch` | Hunks, test proofs and repeated source/build metadata | `{"files":2,"added":18,"removed":4,"proof":{"currentTree":true,"fullBuild":true},"patch":"…","evidence":{"id":"r1"},"view":"…"}` — computed proof values, never inferred from green counts |
| `workspace_write` | Write receipt plus detailed compile-check/fix records | `{"path":"Order.java","revision":"sha2","check":"passed"}`; include applied fixes or unresolved suggestions when present |
| `test_targets` | Full manifests with host, digests, deployment, effects, attestation and repeated prose | `{"targets":[{"id":"local","kind":"local","placement":"local","dependencies":[],"available":true}],"evidence":{"id":"r1"}}` — preserve configured remote placement and required fixture inputs; manifest-valid is not reachable |
| `test_run` running | `{"job":"j1","state":"running","log":[…5],"note":"Still running… Call test_run with job=…"}` | `{"job":"j1","state":"running","step":"compile","next":{"tool":"test_run","arguments":{"job":"j1"}}}` |
| `test_run` passed | Job/state, execution manifest, counts, mode, command, written files, build rationale, view, prose next | `{"job":"j1","outcome":"passed","scope":"all","counts":{"tests":31,"passed":31,"failed":0,"errors":0,"skipped":0},"mode":"build","ms":1200,"evidence":{"id":"r1"},"view":"…"}` |
| `test_run` failed | Up to 10 failures with stacks, 4 source parts, compile details, command, manifest, suggestions | `{"outcome":"failed","counts":{"tests":31,"passed":30,"failed":1,"errors":0,"skipped":0},"failures":[{"test":"OrderTest#total","expected":"42","actual":"41","file":"OrderTest.java","line":18}],"evidence":{"id":"r1"},"view":"…"}` |
| `collection_report` / scenario | Cases, assertions, outputs, parameters and cleanup records | `{"outcome":"failed","cases":{"passed":7,"failed":1},"failures":[{"case":"create order","assertion":"status","expected":201,"actual":500}],"cleanup":"complete","evidence":{"id":"r1"},"view":"…"}` |
| Fixture/lease | Rows/SQL/manifests/bindings plus resource/cleanup details | `{"lease":"l1","state":"ready","counts":{"databases":2,"topics":1},"complete":false,"gaps":["ES not captured"],"cleanup":"caller-owned","evidence":{"id":"r1"}}` |
| `tool_search` | Up to 8 descriptions (450 chars each), required lists, next calls, lexical/workflow data | `{"tools":[{"name":"test_run","description":"Run all, changed, or named workspace tests."}],"next":{"tool":"tool_describe","arguments":{"name":"test_run"}}}` — keep planning guides only when useful |
| `result_read` | `{"id":"r1","path":"/cases","encoding":"json/utf8","text":"[{\"class\":…","startByte":0,"totalBytes":…,"complete":false,"nextCursor":"…"}` | `{"id":"r1","path":"/cases","items":[{"name":"total","status":"failed"}],"nextCursor":"…"}` — typed paging avoids partial JSON reconstruction |
| Validation error | Plain `Error: …`, sometimes structured code/issues; other tools return an `error` object as a successful value | `{"error":{"code":"DT_ARGUMENT_INVALID","field":"tests","message":"Use a test name, an array of names, or scope=all/diff."},"examples":[{"workspace":"w1"},{"workspace":"w1","scope":"diff"}]}` |
| Generic oversized output | Sampled nested object plus lengthy `modelContext.guidance`, result/read/view fields | Domain summary + `{"preview":{"shown":3,"total":100},"evidence":{"id":"r1"},"view":"/show/r1"}`; fallback stays explicit when there is no domain presenter |

## `test_run`: current input friction

The schema has **18 top-level parameters**, 1,204 description bytes and a 4,186-byte complete tool definition. Only `workspace` is declared required. Actual behavior:

1. `{}` fails `Missing argument: workspace` before it can use context.
2. `{workspace:"w1"}` and `tests:[]` pass schema validation but fail `tests: which test classes to run` in the tool handler. `testrun.runUnlocked` independently rejects empty selection.
3. `tests:"FooTest"` fails schema validation; only arrays are accepted.
4. `{job:"j1"}` fails workspace validation, although the description tells callers to poll with the job ID. The handler also checks the job's workspace prefix.
5. `-diff` has no selection meaning. A string fails the array schema; an array item is treated as a test selector and cannot resolve to a test. An undeclared `diff:true` property is currently allowed and ignored: with named tests it can run those tests rather than a diff selection.
6. `mode` means execution engine, not selection. `mode:"diff"` or `mode:"all"` fails enum validation.
7. Default `check:true` and `fix:true` apply to written files; `files` can mutate sources before a selector-resolution failure inside the runner. Selection validation/planning needs to account for proposed files before committing writes.
8. `env` supplies source provenance; `target` chooses execution/dependencies. Default `local` may still use the configured runner URL. Never simplify the description into a promise that all tests execute on this host.

Other implementation constraints: `plan(root,testFiles)` chooses the module nearest the **first** test file; broad selection must not force a multi-module suite through that single-module plan. Maven command construction always emits `-Dtest=...`, and Node execution takes explicit files. All-tests support is therefore a runner/discovery change, not just removal of the nonempty check. The Node finder accepts in-workspace `.js/.cjs/.mjs` files generally; a default discovery policy should identify actual tests, not every JavaScript file.

## Proposed forgiving input behavior

Canonical selector fields: `scope: "all" | "diff"`, `tests: string | string[]`, optional `base`. `scope` defaults to `all` only when no named selector is supplied; named tests remain valid without a scope. Keep existing advanced execution fields for compatibility, but move their explanations into focused help/examples. Make the common schema short before considering a breaking nesting of fixture settings.

| Input | Current | Proposed |
|---|---|---|
| `{}` | Missing workspace | Resolve owned context workspace, run all supported tests. If none/ambiguous, return a short workspace-selection error with candidates. |
| `{"workspace":"w1"}` | Missing test classes | All tests in w1, using its supported build/test profile. |
| `{"workspace":"w1","tests":[]}` | Missing test classes | Same as omitted tests: all. |
| `{"tests":"FooTest"}` | Wrong type / missing workspace | Normalize to `["FooTest"]`; resolve workspace. |
| `{"tests":"FooTest, BarTest"}` | Wrong type | Trim and split comma-separated selectors; report normalized selection. Do not split ordinary spaces in paths. |
| `{"tests":["FooTest#total"]}` | Works with workspace | Same behavior; context resolution available. |
| `{"scope":"diff"}` | Unknown field; no selection support | All tests affected by current changes against the workspace checkout base. |
| `{"tests":"-diff"}` or `{"tests":["-diff"]}` | Invalid type / unresolved selector | Normalize to `scope:"diff"`. Accept exact `--diff`, `diff`, `changed` aliases in the same position. |
| `{"diff":true}` or `{"-diff":true}` | Ignored extra property | Normalize to `scope:"diff"`; `diff:false` means no diff filter. |
| `{"tests":"all"}` or `{"tests":"*"}` | Unresolved class | Normalize to all only when no exact test has that literal name; avoid a surprising class-name collision. |
| `{"mode":"diff"}` | Invalid enum | Known misplaced selection alias: normalize to `scope:"diff", mode:"auto"`, with a short normalization notice. Reject conflicting scope. |
| `{"job":"j1"}` | Missing workspace | Observe that owned test job; resolve its stored workspace. No writes, discovery or new build. |
| `{"job":"j1","files":[…]}` | Poll branch ignores mutation fields | Reject conflicting start fields; do not silently discard requested writes. |
| `{"tests":"-diff","scope":"all"}` | Unsupported | Actionable conflict error; no execution. |
| `{"tests":42}` / `{"tests":null}` | Invalid | Keep invalid; do not coerce arbitrary values into an all-tests run. Empty/blank strings also get a correction example. |

Literal command shorthand `test_run -diff` is a CLI concern: current `dt tool` expects JSON. If added, explicitly map the alias there; a JSON tool call cannot have a bare flag. Publish canonical JSON examples first. Do not pass selector strings or aliases to a shell.

Workspace resolution order: explicit owned workspace; explicitly attached task/project workspace; unique active workspace in the current execution scope. Multiple candidates produce `DT_WORKSPACE_AMBIGUOUS`, with IDs/repository/ref. No cross-story search, global most-recent checkout, or implicit checkout creation. Job lookup remains access-checked and must verify the tool/job kind before observing it. Explicit workspace on a poll must match.

Normalize recognized inputs **before** defaults/schema validation, then validate the canonical form. Generic `callTool` currently inserts defaults and validates first, so normalization only in `test_run.run` would be too late for strings and misplaced mode aliases. Expose accepted aliases in the input schema too, because clients can validate before calling the server. Reject unknown test-run fields with close-name hints after alias normalization; do not globally loosen validation. In particular, never guess `target`, database credentials, environment, fixture paths or an incomplete-fixture override.

Proposed short description:

> Run all, changed, or named tests in an owned workspace. Omit tests for all; scope="diff" runs tests affected by workspace changes. tests accepts a name or list; "-diff" is an alias. Omit workspace only when context identifies one. Poll with job only. mode chooses auto/fast/build. Advanced fixtures and execution targets are optional; env is source provenance.

## Define “all” and “diff” before implementation

**All:** use the supported project's test suite, not a fabricated `*` class selector. Maven/Gradle use their configured test tasks across applicable modules; Node uses the reviewed test profile's explicit file discovery and reporter. Report profile and module scope. Do not blindly execute an arbitrary `package.json` command to obtain support. Unsupported or mixed ecosystems return the supported profiles/candidates. Existing target/effect/dependency checks still apply; missing dependencies produce a clear failure rather than inferred live bindings.

**Diff:** compare against the pinned workspace checkout base by default; accept an explicit verified `base`. Include committed changes since that base, staged/unstaged changes, untracked test/source files, renames and deletions. Select changed tests plus tests transitively affected by changed production code. For JVM use graph/module dependencies; for Node use bounded dependency analysis, with conservative handling of dynamic imports/assets/config/build files. Existing `dev/test.js` is a useful dev-tool-specific reference, not a universal selector for arbitrary repositories.

If impact analysis is incomplete, widen to the affected module or all supported tests and return `fallback:"all"` with the reason. If a diff is fully classified as having no runnable test impact, return `outcome:"not-run", reason:"no-affected-tests", selected:0`; **do not** report `passed` or invoke Node with an empty file list (that can discover all tests). Deleted source/test dependencies must inform selection from retained/base evidence; a deleted test alone is not a runnable selector. Do not run old deleted paths. Missing/invalid base is an actionable error, not a silent comparison against another ref.

`files` should participate in planning before discovery: validate edits into a temporary/virtual candidate tree, resolve affected tests/modules against it, then commit writes and execute under the existing workspace lock. Record the resulting tree identity. For initial all/diff support, prefer project build mode when the fast runner cannot faithfully execute the selected module set. Return a selection receipt: requested scope, resolved base, changed/selected counts, selected modules/profile, analysis completeness, fallback and reason. Retain exact selected tests and reasons for inspection.

## Implementation order and acceptance criteria

1. **Input reliability:** normalization hook before validation; accurate alias schema; omitted tests → all; diff selector and selection receipt; job-only polling; scoped workspace resolution; copyable correction errors. Change both the tool wrapper and runner, not only documentation.
2. **Useful compact defaults:** presenters for `test_run`, `test_targets`, health, searches, schema/body and dossiers. Preserve existing useful failure snippets, expected/actual and full build proof. Reuse semantic/impact limits rather than double-sampling them.
3. **One raw-data bridge:** retain before projection; extend `result_read` across result kinds with typed paging/field selection; advertise available sections and storage failure. Keep API/internal values and current raw-read behavior compatible.
4. **Discovery cost:** route testing tasks to `workspace-tests` or an equally focused profile; give short common examples before long advanced explanations. In the current clean registry, full definitions are **298,850 bytes**, `direct` is **106,773**, `workspace-tests` is **11,771**, and `lean` is **1,743** (minified UTF-8 JSON, excluding transport wrappers; not token counts). `lean` requires discovery round trips, so compare whole-task cost and errors, not schema bytes alone. MCP currently lists all tools; evaluate profile support there separately from OpenAPI's existing profile selection.

Validation for an implementation should cover:

- Omitted/empty/named/string/array/comma/all/diff aliases; invalid types; conflicting inputs; unknown fields; aliases accepted by client-visible schema.
- No, one and multiple owned workspace contexts; job-only polling, foreign/wrong-kind jobs, mismatching workspace; polling never starts a build or applies files.
- Node/JVM discovery, multi-module Maven/Gradle, mixed/unsupported profiles, empty diff, changed tests, production changes, renamed/deleted/untracked files, missing base, incomplete graph fallback and staged candidate edits.
- No-run is distinct from success; missing reports, stale evidence, unknown effects and cleanup failures survive compaction. A build with zero tests must not become green test proof.
- Every projection stays within its budget on wide rows, deep objects, long Unicode strings and large failure sets; exact handles/cursors/pins and important gaps remain intact.
- Original retained value matches the pre-projection value; paging reconstructs exact Unicode JSON, scopes stay isolated, expiry/storage failure is explicit, and recovery never repeats a mutation.
- Full API/code/script results remain compatible; native embeds work; nested `tool_execute`/`context_run` apply the correct inner presenter while preserving execution vs evidence-saving outcomes.

For model evaluation, use the same fixed tasks and fixtures on the small model before/after: successful selection on first call, argument corrections, tools called, delivered bytes, selected/run test counts, raw-detail reads and final task correctness. Report actual tokenizer/provider usage separately if available. Byte savings without correct selection or preserved evidence would not be an improvement.

## Verification performed for this research

The inventory generator reproduced the six pre-execution input failures recorded in its JSON output. Existing focused checks passed: **27 tests, 0 failures**, using `node --test test/chat-context.test.js test/tool-discovery.test.js test/node-targets.test.js test/testout.test.js`. These cover current retention/transport behavior, discovery, actual Node test execution and output compaction. They validate the reviewed current behavior, not the proposed API. No production sources or generated `dist/` files were changed, so no bundle rebuild was required.
