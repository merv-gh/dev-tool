# Collection test workflows

Collections are still ordinary `scripts/<collection>/` folders. Scripts keep the existing tool, HTTP, browser, set, transform and JavaScript step language. A collection can now also be an ordered test suite; this does not change its existing public tool, which continues to dispatch one child script.

In Open WebUI, use the independently callable stages:

| Tool | Purpose |
| --- | --- |
| `collection_get` | Inspect metadata, nested script definitions and suite settings. |
| `collection_save` | Change only the supplied metadata fields; preserve omitted vars/hooks/settings. |
| `collection_plan` | Expand ordered cases, tags, datasets and matrix combinations without actions. |
| `collection_validate` | Check exact references/cycles, typed params, template roots, required tool arguments and configured capabilities before running anything. |
| `collection_run` | Execute and retain a report. Returns a background job/run id after `wait_ms`. |
| `collection_cancel` | Stop new work, interrupt HTTP/JS, then execute finally cleanup. |
| `collection_check` | Independently decide whether every selected case and cleanup succeeded. |
| `collection_history` | List runs, or inspect one retained run and its source snapshots. |
| `collection_report` | Open the default interactive view, or obtain JSON/JUnit XML. |

`script_save` now exposes `vars`, `before`, `after`, `finally` and selection `tags`, and preserves omitted settings when updating an exact existing id. `script_collection` also preserves omitted metadata and supports vars/hooks. The existing admin editor and HTTP routes use the same library.

## A working suite

Save `orders/paid.json`:

```json
{
  "description": "Check the paid order total",
  "tags": ["smoke"],
  "params": {"orderId": {"type": "integer", "required": true}},
  "steps": [
    {"tool": "pg_query", "args": {"sql": "select total from sales.orders where id = $1", "params": ["{{orderId}}"]}, "as": "order"},
    {"js": "test('one order', () => expect(vars.order.rows.length).toBe(1));"}
  ]
}
```

Then configure the suite with `collection_save`:

```json
{
  "collection": "orders",
  "suite": {
    "order": [
      {"script": "paid", "datasets": [{"orderId": 42}, {"orderId": 84}], "matrix": {"region": ["north", "south"]}},
      {"collection": "refunds", "tags": ["regression"]}
    ],
    "params": {"env": "dev"},
    "before": "vars.ready = true;",
    "after": "test('all selected cases passed', () => expect(vars.run.counts.failed + vars.run.counts.errors).toBe(0));",
    "finally": "log('suite resources released');"
  }
}
```

The before/after/finally examples show the lifecycle; replace the log with an explicit cleanup tool for any resources your suite creates. The read-only environment tools remain read-only. Writable test/scratch operations keep their existing configured protections.

Call `collection_plan` and `collection_validate` with `{"collection":"orders","tags":["smoke"],"seed":"42"}`; then call `collection_run` with the same inputs. The plan contains the exact order, dataset row, matrix values, revisions, exclusion reasons and seed. There are at most 1000 cases; matrix expansion is bounded before allocation. Relative suite references stay inside their subtree. Nested script references must be exact saved ids; fuzzy names remain available for ordinary interactive `script_run`.

If no `suite.order` is provided, direct scripts run in name order, followed by direct child collections. Include tags match any tag; exclusion tags win; exact `select` ids/basenames further filter the set. An empty selection is invalid. Excluded cases remain in the plan; cases skipped after setup failure/cancellation remain in the run and fail the completion check.

Each case receives fresh JSON vars. Case captures cannot leak into the next dataset or nested collection. Suite setup vars are inherited by selected child scopes and cases. Explicit entry/dataset/matrix values override setup values. Caller shared params override stored suite defaults. `vars.seed` records a reproducible seed for the script's own deterministic generation; UUID/time/random helpers remain nondeterministic and are not silently changed.

## Hooks, cleanup, assertions and deadlines

Existing collection `vars/before/after/finally` apply to each script. New `suite.before/after/finally` run once for each selected collection scope. Setup enters lazily before the first selected child; success hooks and cleanup unwind in reverse scope order. Suite cleanup runs even if setup or a child fails. Successful case cleanup does not erase its primary error, and failed cleanup is retained independently. Script and step `finally` hooks have the same behavior.

The default whole-run deadline is 120 seconds (maximum 15 minutes). Each cleanup has a separate default 10-second budget (maximum one minute), including after cancellation or a killed JavaScript process. `timeoutMs` on an individual step is 1–120000 milliseconds. Cancellation stops new actions; JS is killed and HTTP is aborted. Generic tool APIs do not all support interruption: an already issued call may finish with an unknown outcome, recorded as such, and is never retried after cancellation/deadline.

Named assertions reuse `test/expect/assert`. A step can additionally declare reusable JSON assertion blocks:

```json
{"http":"GET https://example.invalid/orders/42", "assertions":[
  {"name":"paid", "code":"expect(result.json.status).toBe('PAID')"},
  {"name":"safe to continue", "code":"expect(result.status).toBe(200)", "hard":true}
]}
```

Soft blocks collect independent failures; a hard block stops dependent steps. `assert(...)` or a thrown error also stops execution. The ordinary `after` hook still runs only on success; cleanup belongs in `finally`. Structural assertion blocks need no JavaScript engine: `{"name":"paid","path":"json.status","op":"equal","value":"PAID"}`. Supported operations are deep typed `equal`, `exists` (value false asserts absence), `contains` (string or array element), and `count` (array/string length). Values may use the same typed templates as steps.

Retries and polling are opt-in and bounded to 20 attempts. HTTP GET/HEAD may repeat; POST/PUT/PATCH/DELETE cannot be repeated automatically. A tool step may repeat only with `retry.idempotent:true`, which is the author's explicit declaration about that tool; do not assert this for a mutation with uncertain outcome. Polling uses a structural equality comparison on a result path:

```json
{"http":"GET https://example.invalid/jobs/42", "retry":{"attempts":5,"delayMs":200}, "poll":{"path":"json.state","equals":"done","attempts":5,"intervalMs":200}}
```

Every attempt remains in the step evidence, including failures before an eventual success. Redirects are refused so HTTP allowlists cannot be bypassed by a redirect.

## Evidence, reporting and CI

Reports are independent JSON files under `cache/collection-runs/<run>.json`, written atomically after cases/hooks. They retain selection metadata, exact script/collection revisions, definition summaries, assertion outcomes, outputs, retries, skipped cases and independent cleanup errors. Executable definition/hook snapshots stay in memory during execution. Expanded case/scoped inputs, overrides and matrix values are omitted by default. `evidence:true` retains expanded inputs and matrix values with credential fields redacted. Returned reports, history, JSON/JUnit and visualizations share this retention boundary. Credential-key values and configured credentials are also scrubbed from their echoes in logs/errors/results; arbitrary business output can still contain environment data. These files are not automatically exported or sent elsewhere. Runs do not currently resume after a process restart.

Views are on by default. `collection_report` opens an interactive status/search/case inspector with steps, attempts, assertions, hooks, revisions, JSON and JUnit downloads. JSON/JUnit remain available separately for automation. Use `collection_check.ok` for CI success; a successful HTTP tool response only means the report was obtained. JUnit includes setup/finally failures as error cases, so a failed aggregate hook cannot produce a green XML report. Example:

```sh
node cli.js tool collection_run '{"collection":"orders","tags":["smoke"],"wait_ms":50000}'
node cli.js tool collection_check '{"run":"<returned run id>"}'
node cli.js tool collection_report '{"run":"<returned run id>","format":"junit"}'
node dev/collection-test.js orders --tags smoke --seed 42 --junit reports/collection.xml
```

The CI entry point exits 0 on pass, 1 on an executed failure, 2 on invalid configuration/preflight or runner errors, and 130 on cancellation. It prints one JSON summary to stdout and keeps diagnostics on stderr.

Preflight checks declarative references, templates, tool availability and known required arguments. JavaScript is trusted project code and may call dynamically selected tools, so static validation explicitly reports that limitation. Declare hook-produced template vars in `vars`; preflight cannot infer arbitrary JavaScript assignments. Browser cookies/session behavior is unchanged; parallel browser isolation is not implemented here.

## Review coverage

This implements G01–G08 and G14 foundations from the completeness review: tool parity, suites, true finally, datasets/matrix, preflight, deadlines/cancellation/repetition, named hard/soft assertions, durable evidence and JSON/JUnit. G08's selected rerun uses the existing `select`/dataset inputs; automatic resumption and rerunning an immutable historical package are future work. G07 reuses assertion blocks in the existing step language; a separately named assertion library is future work.

G09 versioned portable packages, G10 reference-refactoring, G11 managed secret/environment overlays, G12 isolated authenticated browser sessions, G13 bounded parallel/conditional flow syntax, G15 third-party import and G16 curated domain/demo packs remain separate roadmap items. They are not implied by a passing suite. Existing JS steps handle custom loops/conditions without adding another scripting language.

## Portable stage boundaries

The checked-in `schemas/collection-contract.schema.json` specifies v1 suite, structural assertion, plan, validation and run JSON contracts. Every portable artifact is ordinary JSON, including exact nested definition snapshots, source revisions, inputs, case results and observations. In-memory cancellation controllers, callbacks, tool registries, filesystem handles and child processes are runtime adapters and are never serialized into these contracts. Unsupported suite versions fail before actions.

The independent boundaries are definition storage → offline selection/expansion → validation/capability report → execution observations → completion checking → JSON/JUnit/view rendering. A future executor in another language can consume the same suite/plan, dispatch registered tool/HTTP adapters, implement typed template substitution and structural assertions, and emit the same run contract. It can refuse `javascript` explicitly or delegate that optional capability to a JS engine. Neither JavaScript snippets nor a particular knowledge graph, database, RAG index or Confluence implementation are required to compose ordinary tool/set/HTTP cases with structural assertions.

The current Node runner rebuilds and validates a fresh plan on each run, freezes nested script and inherited collection snapshots, and records the final validated plan hash. A planning hash before deep reference resolution can differ from the validated hash because the latter includes nested definitions and inherited hooks. Export/import execution of a historical package is deliberately a separate future feature, not a hidden dependence on current process state.
