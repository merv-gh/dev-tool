# Inspecting execution and task state

Open Admin and select **Runtime**. The scope bar above the tabs applies to tool calls, contexts, jobs, metadata and execution details throughout Admin. Use the same chat / task ID to resume work from another client. IDs accept up to 160 letters, digits, dots, colons, underscores or hyphens and must start with a letter or digit.

The existing single-user `default` scope preserves earlier local work. Selecting another chat / task separates its state. Configured access tokens identify different principals; Admin shows the authenticated principal and role. A story-bound token has a fixed chat / task. Administrators can explicitly select another principal and chat / task to inspect their work. The server authorizes each request; changing a selector does not grant access.

## Executions, jobs and cancellation

The activity list shows parent and child executions with a shared timeline. Select an execution for its principal, chat / task, runtime, configuration revision, resources, outcome and trace. Filters affect the list, not the recorded history. **Live** polls while the Runtime tab is visible.

**Cancel execution** requests cancellation of owned child calls and processes. `cancelling` and `draining` remain active states. An incomplete cleanup count or unknown outcome is shown explicitly. Inspect the trace and resource details before repeating an operation that may already have affected an external system. The Jobs tab links to the same execution inspector and retains the job's log and result.

## Metadata and configuration

Stored executions, tool calls and jobs can be paged and read. Labels, notes and tags are editable annotations; operational state and ownership remain read-only. Saving submits the revision that was read. If another client changed the record, the draft stays visible and the server rejects the stale save. Reload the record to read its current revision.

Runtime also shows storage durability, queue/drop/error counters, scheduler limits, code engine capabilities, and the active configuration generation with its last reload error. The configuration editor submits its loaded revision. Invalid configuration retains the last valid generation for existing work. New work and ordinary token access stop until an administrator repairs it; the last valid administrator credential retains access to the config editor and runtime diagnostics. A stale edit must be reloaded before saving.

## Code cells

Expand **Code cells & tool scratchpad** to select an enabled code tool, inspect its exact schema, edit arguments and run it. Native tool visualizations appear inline; structured lists use a compact table, with the complete result available in a disclosure. Pending cell results provide buttons to prepare a status, resume or cancel call when those tools are enabled. Preparing a call never executes it. Calls use the currently selected principal and chat / task. Network `fetch` is permitted by the code runtime.

Switching scope clears displayed results and ignores late replies from the previous scope. Unsaved metadata notes and pending scratchpad calls prevent accidental scope changes. Authorization, revision checks and cancellation remain server-side guarantees.

## Token and chat configuration

Configure stable principal IDs and secret references in `config.json`:

```json
{
  "server": {
    "accessTokens": [
      {"id": "alice", "token": "${ALICE_DT_TOKEN}", "role": "user"},
      {"id": "operator", "token": "${OPERATOR_DT_TOKEN}", "role": "admin"}
    ]
  }
}
```

Put random tokens of at least 16 characters in `.env`. Each request sends `Authorization: Bearer <token>` and `X-DT-Story: <chat-or-task-id>`. Open WebUI chat headers and MCP session IDs are accepted as story fallbacks. A token can include `"story": "TASK-42"` to bind it to one story. With access tokens configured, localhost and `trustNetwork` do not bypass authentication. The existing global API key remains an administrator credential. Never send a client-supplied principal ID as proof of identity; only an administrator may use `X-DT-Principal` to inspect another principal's selected story.

Contexts, workspaces, workspace indexes and compiler/run sidecars, scripts, custom views, API captures, browser handles, map corrections, code cells, jobs, executions, metadata and configured private file stores are scoped by principal and story. Their folder namespace uses a stable hash; supplied identifiers cannot select another namespace. Cached infrastructure catalogs, repository/library indexes and immutable test templates remain shared. A configured file store with `"shared": true` is readable across scopes and writable only by administrators. Existing unscoped work remains in the single-user `default` namespace; introducing tokens does not silently adopt it into a user's story.

Result URLs are unguessable read-only capabilities for chat embeds. Anyone holding a result URL can view its saved result. Browser embeds restore the saved story for the same principal; explicit story headers and other authenticated principals remain checked. Treat result links as sensitive evidence. Scope isolation protects application state and handles; executing trusted workspace builds on a shared host is **not** an operating-system sandbox for hostile users. Use separate isolated deployments/runners when users must not share host or network capabilities. Direct `fetch` remains enabled for the Node code engine.

## Remote tool adapters

A backend used in any private story (including an explicit single-user chat) must explicitly declare `scopeAware: true` and use an authenticated service token. For example:

```json
{
  "tools": {
    "backends": {
      "testdb_*": {
        "url": "http://scope-aware-adapter:8080/tools",
        "token": "${ADAPTER_SERVICE_TOKEN}",
        "scopeAware": true
      }
    }
  }
}
```

The trusted server adds an optional `context` to the `dt.tool/v1` request with `principalId`, `storyId`, `scopeKey`, execution ID and configuration revision. Matching `X-DT-Principal`, `X-DT-Story` and `X-DT-Scope` headers aid transport inspection. The adapter must authenticate the service token before accepting this identity, enforce both principal and story ownership for resource reads and mutations, and cancel/drain work when the request disconnects. Tool arguments cannot replace the trusted context. The flag acknowledges the adapter contract; it does not implement isolation inside an external backend.

Adapters without this declaration or service authentication are rejected before a multi-user request is sent. Single-user request envelopes remain compatible. A lost backend response can leave its effect unknown; the harness does not retry or switch to an in-process implementation.

## Runtime and storage limits

The default Node engine starts a fresh permission-constrained child for each cell, with an empty environment, 128 MiB heap and bounded output. `code_start` returns a cell ID immediately; `code_wait` observes new output using `nextCursor` and may return while the cell is still running. Keep polling the same ID rather than repeating side effects. `code_cancel` stops the cell and unfinished nested work. Active cells are limited to 32; completed in-memory observations retain at most 100 cells and 32 MiB. Cell handles do not survive a server restart; persisted executions report interrupted work rather than replaying it.

The optional pinned QuickJS engine is a prototype for pure JSON transforms with a 64 MiB runtime limit and interrupt handling. It explicitly refuses tools, files and network effects. Choose Node for those capabilities; an unsupported QuickJS operation is never retried automatically on another engine.

`tools.workerConcurrency` defaults to 1 (maximum 8), `tools.workerMemoryMb` sets the aggregate worker heap budget, `tools.codeConcurrency` defaults to 2 for top-level code calls, and `tools.buildConcurrency` defaults to 2. Trusted nested script hooks inherit code admission to avoid deadlocks; all Node calls, including nested hooks, share a hard limit of 32 active children. Queues are bounded and scheduled fairly between stories. Cancellation removes queued work before execution, aborts HTTP and PostgreSQL query handles, and terminates owned processes/workers. A timeout while observing a cell is separate from its execution deadline. See [operational metadata](operational-metadata.md) for SQLite WAL storage, legacy migration, backup and fallback capabilities.

Run `npm test` for unit/integration checks and the invocation at the top of `dev/check-runtime-browser.js` for the optional browser workflow. Live database/build checks require the documented test environment; skipped checks are not release evidence.
