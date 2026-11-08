# Retained semantic analyses and editable passport ports

Start with `semantic_capabilities` to read configuration, engine identity and named operations. Existing `code_search`, `code_symbols` and `code_read` remain available while semantic parsing is unavailable or a job is queued. A missing analysis reports the gap; searching never starts a hidden parse.

`semantic_index` without a build target lists retained analyses. With a service, repository or revision key it schedules an owned job and returns a job ID. A source ref is resolved once; results report the full commit and retained generation. `reparse:true` builds another generation while preserving readers of the previous generation. `composite:true` requests a service's exact Java dependency closure. Inspect or cancel through the existing job tools and Admin Jobs/Runtime surfaces.

```json
{"tool":"semantic_index","arguments":{"service":"order-service","env":"dev","ref":"<full-source-sha>","composite":true}}
{"tool":"semantic_index","arguments":{"job":"<returned-job-id>","waitMs":1000}}
{"tool":"semantic_query","arguments":{"operation":"paths","analysis":"<retained-analysis-id>","from":{"name":"createOrder"},"to":{"name":"save"},"mode":"reachability","maxPaths":8,"maxHops":20,"waitMs":1000}}
```

Select an exact `analysis`, `analyses` list or `revisionSet` for reproducible queries and comparisons. Continue cursors against the same retained selection. Reachability, control-flow and data-flow queries have distinct meanings: a call chain does not establish that a value reaches its sink. Conditions retain their recorded status, origin, branch evidence and source. Missing dispatch, field mappings, environment identities and feasibility stay visible as gaps.

For branch work, use `semantic_query` with `operation:"compare"`, `mode:"dataflow"`, `analyses:[beforeId,afterId]` and revision-neutral `from`/`to` selectors. Select a method `parameter` and a sink call `argument` to avoid mixing tenant and amount flows. Each CPG is queried independently. Compare the selected expressions, then verify behavior with entry-to-exit tests: predicate operands can create conservative paths without equal values. [Complete workflow and reproducible model exercise](joern-branch-comparison.md).

Open **Admin → Semantic & ports** to select a source, choose a named tool, inspect its exact typed schema, edit arguments and run it. Retained analyses can populate the query selection. Paths provide source hierarchy navigation and collapsible guard/evidence details. Open WebUI receives the same native saved-view embeds. Successful transient index jobs stay collapsed; query paths and failures expose the relevant detail.

For a whole entry investigation, use `semantic_query operation:"flowmap"` with a whole-method `from` selector and no `to`. Inspect the call overview, state graphs, input dependencies, changes, exits and assumptions, then verify the fix at all affected exits. [Map workflow, exports and limits](entry-exit-flow-map.md).

## Passport boundary adjustments

`semantic_ports` lists effective typed ports. `passport_adjustments` also returns detected findings, disabled ports, immutable history and the current adjustment revision. Read that revision before changing a port. `passport_adjust` saves add/correct/disable deltas in a separate story-scoped overlay; it does not replace automatic source findings. A new identity uses `expected_revision:null`. Existing identities require the hash returned by the read.

In Admin, **Read passport ports** lists detected/manual origin and prepares corrections or disabling without executing them. Supply the reason/source evidence, check the handler and boundary fields, then run the prepared tool. Stale saves reject and preserve the argument draft. Missing repository, source revision, environment, handler or field mapping is permitted as a declared discovery gap and must not be presented as executable flow proof.

**Edit passport metadata** prepares description, owners, tags and notes using the same revision and reason. Metadata edits preserve port operations and keep per-field manual provenance. Omit a field to preserve it; use `null` to clear it explicitly. Distributed flow results show local CPG segments separately from transport/library boundary mappings, including unresolved segments and declared mappings.

The passport page includes typed ports and adjustment gaps, plus a link that opens Admin with the same service/repository/revision selection. Rebuilding a passport preserves the manual overlay. Changing to another exact commit selects that commit's own overlay; it does not copy corrections or detections from a newer source.

All tool calls, background jobs, corrections and saved results use the authenticated principal and selected chat/task scope. Scope is supplied by the transport, never by model-editable tool arguments.
