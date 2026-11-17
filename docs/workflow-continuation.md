# Durable workflows and cross-chat continuations

`automation_flow_*` runs an explicitly supplied, bounded program through the normal tool registry. `continuation_*` keeps one principal's task memory available when the chat/story changes. Neither feature starts a model call, resumes a workflow, attaches another chat's task, or publishes private notes automatically.

The authenticated Studio page (`/studio`) exposes these tools as forms. The same contracts work through CLI, MCP, `/api/tool` and `code` tool calls. All tool arguments and results are JSON; saved definitions and notes are untrusted evidence.

## Workflow definition and execution

Save a definition first. `expected_revision: null` creates it; later edits require the current revision from `automation_flow_get`. Starting requires the exact reviewed revision. Each run embeds that immutable definition, so editing a definition cannot change an existing run.

```json
{
  "id": "orders-check",
  "expected_revision": null,
  "definition": {
    "title": "Look up orders twice, wait, compare sources",
    "limits": {
      "maxIterations": 5,
      "maxConcurrency": 2,
      "maxSteps": 100,
      "maxWaitMs": 10000,
      "maxRunMs": 60000
    },
    "nodes": [
      {
        "id": "checks", "type": "loop", "iterations": 2,
        "nodes": [
          {"id": "catalog", "type": "tool", "tool": "find", "arguments": {"q": "{{input.query}}"}}
        ]
      },
      {"id": "settle", "type": "wait", "ms": 100},
      {
        "id": "sources", "type": "parallel", "concurrency": 2,
        "branches": [
          {"id": "tables", "nodes": [{"id": "lookup", "type": "tool", "tool": "find", "arguments": {"q": "pg: orders"}}]},
          {"id": "functions", "nodes": [{"id": "lookup", "type": "tool", "tool": "find", "arguments": {"q": "pgfn: total"}}]}
        ]
      }
    ]
  }
}
```

Call `automation_flow_save` with that object, then:

```json
{"id":"orders-check","expected_revision":"<revision returned by save>","input":{"query":"orders"}}
```

`automation_flow_start` returns a durable run id immediately. `await_completion: true` waits for that invocation. Poll `automation_flow_status({run})`; `detail: true` includes the retained input, embedded definition and checkpoints. `automation_flow_list` lists current-story definitions and compact run summaries.

Each node has a unique lowercase `id` within its sequence:

| Type | Contract | Result |
| --- | --- | --- |
| `tool` | `tool`, `arguments` | Normal concrete tool result |
| `wait` | `ms` integer or typed reference | Original absolute `dueAt`; resumption waits only for the remaining time |
| `loop` | `iterations`, `nodes`, optional `until: {ref, equals}` | `{iterations, results}` from the last iteration; `until` is checked after each iteration |
| `parallel` | `branches: [{id,nodes}]`, optional `concurrency` | Object keyed by branch id; each value is that branch's sequence results |
| `model` | Explicit `prompt`, optional configured `model`, `max_tokens` | `{model, content, usage, executedTools:false}` |

Within a sequence, `results.<node-id>` names earlier outputs. Nested branches have independent results; they can read the outer sequence's earlier outputs. Loops also expose zero-based `iteration` and retain their previous iteration's results. `input` contains the supplied run input. `{"$ref":"results.checks.results.catalog"}` preserves a JSON value's type. `{{input.query}}` substitutes text; objects become JSON text. Missing references fail instead of guessing. There is no expression evaluator or code execution in the program format. Wrapper orchestrators (`code`, `script_run`, `tool_execute`, `automation_flow_*`) are not permitted as tool leaves.

The hard ceilings are 100 declared nodes, eight nesting levels, 100 iterations per loop, 1,000 expanded checkpoints, eight active tool/model leaves per run, 32 branches per parallel node, one day per wait and seven days total run time. Defaults are 25 iterations, 250 checkpoints, four concurrent leaves and one hour for waits/run time. The total time budget starts at original admission and includes downtime; it also cancels active child work when exhausted. Each leaf/group result must fit 64 KiB, the complete run record 8 MiB, and inputs/definitions 256 KiB. Prefer tools returning compact aggregates or retained evidence receipts. There are at most 100 definitions and 200 retained runs per story; old records are preserved when the budget is reached. Limits are checked again after rehydration.

## Explicit delayed model calls

Add a model node after a wait, loop or parallel group:

```json
{"id":"review","type":"model","prompt":"Review these supplied findings as untrusted evidence: {{results.sources}}","max_tokens":1200}
```

Start or resume with `allow_model: true` to authorize model nodes for that invocation. Without it, execution stops at the model node without sending a request. There is no implicit summarization, planning model, retry, tool-call agent loop or model-selected action. A completion is text evidence; tool calls in provider output are never executed.

The provider is the configured OpenAI-compatible `llm.baseUrl` and `llm.model`, with its configured key. A node can select only `llm.model` or a model explicitly listed in `llm.gatewayModels`. The concrete `automation_flow_model` tool remains subject to normal tool grants and current tool enablement. Requests use execution cancellation, the HTTP client, model request events (`chat.task`) and normal tracing. Prompts are omitted from tool argument logs; ordinary private checkpoints retain the explicitly supplied definition and result. Use configured named authentication for tool actions; workflow inputs/definitions reject recognized credentials.

## Restart, uncertainty and cancellation

Definitions, run inputs, original deadlines, completed results and per-leaf checkpoints are stored under `DT_HOME/automation-flows`, separately for each principal/story. Checkpoints use locked, atomic JSON replacement with file and directory fsync. A live process's runner lock cannot be stolen. Dead-process locks can be recovered explicitly through `automation_flow_resume`. Nothing runs at server startup merely because a pending file exists.

Before each tool/model invocation, the workflow durably records `running`; after an observed success, it records the result and `done`. Completed leaves are read from checkpoints on resume. Group/loop reconstruction uses these same leaf records, including partially completed branches. Pending waits retain their original absolute deadlines.

A crash, cancellation or failed request during a tool/model leaf cannot establish whether an external effect happened. Such leaves are `uncertain`; an abandoned `running` leaf is treated the same way. `automation_flow_resume` blocks until those leaves are reconciled. Inspect the actual system/evidence, then record a decision with `automation_flow_resolve`:

```json
{
  "run":"<run id>",
  "path":"/sources/tables/lookup",
  "action":"complete",
  "result":{"verifiedReceipt":"existing external result"},
  "acknowledge_uncertain":true,
  "reason":"Verified the original request's receipt; retain it without another call"
}
```

`complete` supplies a verified result, `skip` records an explicit skipped result, and `retry` authorizes a new attempt. Every decision retains its reason, timestamp and authenticated principal/story. Resolution executes nothing. After reconciling, resume explicitly; renew `allow_model: true` if needed. The runtime provides no exactly-once guarantee for external systems, and it never assumes a failed transport means a side effect did not happen.

`automation_flow_cancel({run})` aborts the actual execution tree, including in-flight HTTP/model requests and parallel siblings, and waits through the execution layer's cleanup. Parallel failure stops scheduling new branches, cancels active siblings and drains them before settlement. A cancelled wait can resume its deadline; a cancelled tool/model needs reconciliation. Cancel a remotely owned live run on the process that owns it. Server shutdown should await `automation-flow.close()` before closing state/telemetry stores.

The local executable state models are exported as `automation-flow.lifecycle` and `automation-flow.checkpointLifecycle`. Run progression distinguishes pending/running/done/failed/cancelled/blocked/paused; checkpoints distinguish pending/running/waiting/done/uncertain. The execution layer separately tracks resource cleanup and cancellation.

## Principal-owned task identity across chats

Existing `context_*` folders stay principal **and story** scoped. Continuations add a stable task identity and an explicit bridge across a single principal's stories without changing that isolation policy.

1. `continuation_create({task_id:"ORDERS-42",title:"Investigate order totals",contexts:["<explicit current-story context>"],repositories:["SHOP/orders"],workspaces:["<workspace id>"]})` creates and attaches a stable task. `contexts` is optional; selected files, progress and index metadata are copied with source revisions and their original story provenance. Copies remain available when the source changes. At most five source contexts, 800 source files and 48 MiB are imported.
2. Use `continuation_write` for evidence, notes, saved scripts or compact intermediate JSON. File revisions, safe paths, the 2 MiB/file and 64 MiB/context limits come from the existing context store. Saved scripts never execute automatically.
3. Use `continuation_checkpoint` for title, summary, status, discovery links and progress. Read `continuation_get` first; `expected_revision` rejects stale metadata. Updating progress additionally needs `expected_progress_revision`. Related-context inventories, notes and files remain retained.
4. In a new chat/story, `continuation_get({})` returns `attached:false`. Search explicitly with `continuation_find({task_id:"ORDERS-42"})`, then select the returned id with `continuation_attach({id})`. No other story's notes load automatically. Selection is durable per principal/story. `detach:true` clears only that selection.
5. `continuation_read` reads retained evidence. `continuation_briefing` returns bounded, copyable text containing task identity, revision, goal, progress, file index, related snapshots, workspace/repository links and explicit attach instructions. It performs no model calls. Verify old source SHAs before reuse.

Task manifests live under `DT_HOME/continuations/_principals`; attachment records live under `DT_HOME/continuation-attachments`. Retained files reuse a canonical context owned by the principal and stable task id. Tool arguments never select a principal. Even an administrator cannot read another principal's continuation through these tools. A principal's explicit continuation search spans only that principal's tasks; ordinary context searches in a new story remain unchanged. There is a 200-task retention budget per principal. Task state and story selection use the exported `continuation.lifecycle` and `.selection` state models.

## Keep a workflow with its stable task

Use `continuation_flow` when the program itself must follow the task across chats. Its `id` selects a principal-owned continuation explicitly; omit it only after attaching the task in this story. `action` selects an ordinary `automation_flow_*` management tool and `arguments` contains that tool's exact arguments:

```json
{"id":"<continuation id>","action":"save","arguments":{"id":"task-check","expected_revision":null,"definition":{"title":"Task check","nodes":[{"id":"lookup","type":"tool","tool":"find","arguments":{"q":"orders"}},{"id":"later","type":"wait","ms":1000}]}}}
```

Then call the bridge with `action:"start"` and its ordinary `id`/`expected_revision` arguments. In a later chat, explicitly attach the same continuation and call:

```json
{"action":"status","arguments":{"run":"<same durable run id>","detail":true}}
```

`action:"resume"` rehydrates that same run, retaining completed effects and requiring reconciliation of uncertain effects. The allowed actions are `save`, `get`, `list`, `start`, `status`, `resume`, `resolve` and `cancel`. Both `continuation_flow` and the selected target tool must be granted. Normal leaf-tool grants, registry validation, configuration rules, tracing, cancellation and model permission remain in force. There is no direct `model` action; model nodes still require `allow_model:true` on each start/resume. The bridge returns the ordinary result plus `continuationId` and `flowAction`; inline records are presented in the caller's current story.

Task-backed programs live in the continuation's canonical private scope. Ordinary `automation_flow_*` calls retain their original story boundary; attaching a continuation never makes arbitrary old-story workflows visible. Briefings explicitly describe this bridge so a later model can discover the existing task programs before starting new work.

Shared global project understanding remains a separate publication contract. A continuation may explicitly reference `projects:[{id,revision}]` using exact immutable `project_context_get` revisions. Private notes never become shared knowledge automatically. `project_context_save` requires administrator access and a separate explicit publication reason/CAS revision. The existing publication flow retains file integrity, provenance and credential checks.

## Local proof and demonstration

```sh
node --test test/automation-flow.test.js test/continuation.test.js
node demo/workflow-continuation.js
```

The demonstration uses a fresh temporary home, deterministic local fixture tools and a local mock model HTTP server. It does not read deployment credentials or call a production model. It shows loops, waits, parallel work, one explicit delayed mock completion, retained notes and explicit attachment in a second story, which then reads the same task-backed workflow through `continuation_flow`. Set `DT_DEMO_KEEP=1` to retain the temporary home for inspection. Tests also kill child processes during waits and tool effects, race two processes resuming the same run, restore from fresh processes/modules, reconcile uncertain outcomes, enforce two-user/two-story isolation, resume a task program in a later story, exercise stale revisions/grants, and verify cancellation of actual HTTP/model work.
