Current delivery: [Monaco/Explorer and focused-path components](../../../docs/code-workbench.md) are implemented in the real editor/renderer and this demo. The remaining conversation rollout below is still a plan.

# Implement by complete user journeys

Apply the [production-scale research contract](../production-scale-research.md) first: a resizable Monaco-style file workbench, indexed/continuable Explorer, exact source previews, and flat focused path navigation with callers/callees. The earlier narrow inspector and unbounded nested display are superseded. The existing conversation/ownership/execution lifecycle remains useful.

The intent statechart is the lifecycle contract. This prototype is the composition contract. Keep the existing task conversation and native result renderers, and adapt complete flows into that shell. Do not rebuild every tool as a custom application or replace working URLs at once.

The [prototype guide](README.md) separates 16 interactive synthetic fixtures from 119 generic prepared/model journeys. Its [19-group browser record](browser-verification.json) and [bounded independent verdict](independent-verdict.md) validate the separate proposal and close its five review findings. The production acceptance gates below remain implementation work.

## Start with one investigation

Adapt PERS-218's response → rows → focused source path → file → saved revision → outside-in regression → retained evidence. Reuse `web/tasks.html`, `web/tasks.js` and `web/task-conversation.js` as the shell, and the workspace/file editor and scoped event mechanisms behind it. A receipt contains exact target, input revision, owner, duration, outcome and retained-result reference. Passing transient calls and tests collapse; failures and questions open. Rendering old evidence is read-only and cannot fetch a new result implicitly.

Put an indexed intent finder beside the persistent composer. Use goal names first, exact tools second. The current service, environment, database, entry selector and immutable source ref should prefill a prepared action. Direct actions reuse known scope and one invocation ID. Exact arguments remain editable. Report missing scope inline and retain arguments on validation errors. Only capability-relevant fields are shown.

Acceptance: mouse-only full journey, keyboard equivalents, no top-level navigation, no repeated scope entry, draft survives task switch/reselect/reconnect, and independent assertions remain distinct from HTTP success, static reachability and coverage.

## Carry work across conversations

Use durable task identity, continuation/context links and workspace IDs already available in the harness. Restore rather than recreate them. Keep one scoped event connection with cursor-based catch-up; fetch a bounded snapshot if a cursor gap occurs. Accepted operations use execution IDs; uncertain writes are reconciled, never automatically replayed. Task and file revision protection belongs on the server.

Background can remain a compact side panel. Files and sustained source/data investigation use a resizable working area with coordinated selection; preserve chat and a reliable return path. Their independent states survive when hidden. Each file has its own revision/draft actor so switching visible buffers need not force a discard dialog. Deleting a draft or leaving an unretained scope requires a deliberate choice. File content Save, metadata Save and shared publication are separate operations with distinct labels.

Acceptance: close/reopen browser and chat; attach the same workspace; observe the same owned run; save one file without publishing another; recover from concurrent edits; keep private execution data isolated across users.

## Add unattended and review loops

Show current step, elapsed time, queue/wait cause, next wakeup, last checkpoint and required decision in the conversation. Background exposes owned child runs, policy, leases, source refs, budgets and cleanup. The composer stays active while the model or a tool is running. Steering is persisted and acknowledged at a safe boundary.

Pause is pending until checkpoint acknowledgement. Stop is pending until cancellation and cleanup are acknowledged. A CI/review wait is a retained subscription or bounded scheduled observation, not a model polling loop. Task-branch pushes and draft PRs follow saved authorization; protected pushes and merging remain blocked/manual.

Acceptance: independent navigation/job interleavings, restart reconciliation, no duplicate effects, visible stop/cleanup failures and budget exhaustion, and successful earlier work retained after a failed step.

## Adapt the long tail without multiplying screens

Use the same inline receipt, prepared action, indexed selection, file, nested-path and job patterns for API workflows, Postgres/ES/Kafka, architecture knowledge, semantic/TLA tooling and runtime administration. Keep complex collection/config editors in the side panel or existing full editor when their space demands it. Full-screen editing returns to the same selected message and draft. Admin-only writes are checked by the backend, with an explanation at the attempted action.

Fix the six existing reviewed production defects during those adaptations: Config reselect draft loss, native Sites/Views selection, preview iframe naming, fresh Workbench composer initialization and fresh Map scope/error placement. This prototype does not fix them.

## Gates before rollout

- Expand source and field branches lazily; page task/file/service catalogs; window long timelines. Measure real large-estate backend and rendering latency, not only synthetic DOM size.
- Exercise desktop, narrow screens, keyboard, zoom, dark theme, long names, empty/partial/error/denied/unknown outcomes and slow/offline transport.
- Verify real task persistence, ownership, event catch-up, stale Consul addresses, compiler/Lombok fallback, outside-in test leases and changed-code coverage.
- Keep old tool/API URLs and production capabilities available until their complete interactions have replacements. Add links into the conversation shell incrementally.

The present automated record covers the named prototype gestures and finite model. It is not a production integration or release gate.
