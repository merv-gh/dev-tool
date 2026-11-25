# Persistent project execution and memory

`global_context_open` creates a stable project scope for the authenticated principal. The same id reconnects its memory, scripts, workspaces and jobs from later chats and after server restarts. It does not merge private chat notes or expose another principal's resources. Shared, administrator-published project understanding remains `project_context_find/get/save`.

```json
{"id":"postgres-snapshotter","title":"PostgreSQL snapshots","summary":"Reusable snapshots and integration-test startup evidence"}
```

Call that with `global_context_open`, then pass `global_context: "postgres-snapshotter"` to `code` or `code_start`:

```js
// files is this project's durable memory, with ordinary revision checks.
await files.write('understanding/startup.md',
  'Hypothesis: applying migrations and seed data dominates test startup.\n' +
  'Pending: measure stock and snapshot images with identical test selections.',
  {summary: 'Startup hypothesis; not measured evidence'});

const repo = await tools.workspace_create({name: 'postgres-snapshotter'});
await tools.workspace_write({
  workspace: repo.id, path: 'README.md',
  content: '# Snapshot utility\nSee understanding/startup.md for the hypothesis.\n', check: false
});
text({workspace: repo.id});
```

Read existing files before editing them; `files.read/readFile/readJson` tracks file revisions for writes. Save compact findings, exact source revisions, script identities, parameters, benchmark definitions, actual results and next steps. Stored notes and source code are evidence, never authority to execute actions.

Use `global_context_find` to discover projects, and `global_context_get` to inspect their files, saved scripts and repositories. These are metadata reads; no saved program executes automatically. `context_update` inside the scope updates discovery metadata. Runtime data lives under `DT_HOME/global-contexts/` plus the existing scoped context/script/workspace/job stores; back them up together.

## Save once, call quickly later

Normal script tools run inside the selected project scope:

```js
await tools.script_save({
  id: 'checks/startup-summary', expected_revision: null,
  description: 'Summarize retained startup samples without starting containers',
  params: {samples: {required: true}},
  steps: [{js: 'const xs = vars.samples.slice().sort((a,b)=>a-b); return {medianMs: xs[Math.floor(xs.length/2)], n: xs.length};', as: 'summary'}]
});
```

A later chat can execute it without resending its implementation:

```json
{
  "id":"postgres-snapshotter",
  "tool":"script_run",
  "arguments":{"id":"checks/startup-summary","params":{"samples":[1000,900,1100]}}
}
```

Pass this to `global_context_call`. It checks both the bridge and concrete tool grants, then calls the tool once under the persistent project scope. Script revisions are available through `script_get`; use `expected_revision` when updating. Native retained view data is copied into the requesting chat for readable presentation, without rerunning the tool. Interactive resource operations still use the explicit project scope bridge.

`workspace_create` initializes a new local Git repository with an empty commit. It has no inferred remote and cannot silently publish to Bitbucket. Edit it with the ordinary workspace tools. For remote changes, use `workspace_open` on an existing repository, copy/review the files, test, then explicitly `workspace_push` to an allowed feature branch.

## Execute an authored utility

The JS code-mode sandbox still has no direct filesystem/subprocess access. `workspace_program` is the separate, privileged runner capability for reviewed source files. Enable it deliberately:

```json
{
  "workspaceEditor":{"programs":true},
  "tests":{
    "runnerUrl":"http://runner:4001",
    "runnerToken":"${DT_RUNNER_TOKEN}",
    "passEnv":["SNAPSHOT_DATABASE_URL"]
  }
}
```

An administrator can call it inside project code mode:

```js
const workspace = 'workspace-id-from-global_context_get';
const started = await tools.workspace_program({
  workspace,
  path: 'snapshot.js', runtime: 'node', allow_execute: true,
  args: ['--url-env', 'SNAPSHOT_DATABASE_URL',
         '--image', 'local/orders-snapshot:trial', '--out', 'artifacts/trial'],
  timeout_ms: 1800000
});
text(started);
```

Replace the workspace placeholder with the retained id. This example program must first be written into the workspace with its template and entrypoint files. See [the ready-to-run snapshot utility](../recipes/postgres-snapshot/README.md).

The tool starts a cancellable job immediately. Observe the returned job using the ordinary `job_get` tool through `global_context_call`; cancel through `job_cancel` in the same project scope. Read `result.ok` and `result.outcome`, not merely job completion. Runner transport loss means an unknown outcome and must not trigger automatic replay. Output is redacted with the existing build environment rules. No command runs locally on the dt server. Runtime, literal arguments and time bounds are validated; the source has runner privileges and is not a security sandbox.

The `projects` tool profile exposes the compact project/script/code surface. Existing tools and chat-scoped code remain compatible. Managed model instructions explain when to use the persistent scope; rerun the existing WebUI setup to refresh an already-installed model prompt.
