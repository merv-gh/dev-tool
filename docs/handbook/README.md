# The dev-tool field guide

Generated from `lib/handbook-content.js` and the clean built-in registry by `node dev/build-handbook.js`. The interactive version lives at **Admin → Field guide** or `/handbook`. It adds current authorized tool schemas, editable examples, local index metadata and persistent self-context.

Examples use illustrative `checkout`, `DEMO/checkout`, `orders`, `HANDBOOK-101` and `handbook-task` identities. Replace `{{env}}`, `{{service}}`, `{{repo}}`, `{{db}}`, `{{context}}`, `{{ticket}}`, `{{revisionKey}}` and `{{analysis}}` with discovered/returned values. Returned IDs/revisions must come from an actual preceding read. Examples do not execute automatically. Screenshots are demo/sample evidence, with captions describing their limits.

## Contents

- [Your first investigation](#start)
- [Dev-tool’s own operating context](#self-context)
- [Contexts, nearby files and handoffs](#task-memory)
- [Indices, freshness and exact versions](#indices)
- [Explore a service and its surroundings](#services)
- [Discover requirements and publish explanations](#requirements)
- [Code search, impact and Joern](#joern)
- [Logs, SQL, Kafka and Elasticsearch](#live-evidence)
- [Case: the cent lost between services](#case-contracts)
- [Case: an event succeeds for the wrong tenant](#case-tenant)
- [Case: a cancellation looks undone in search](#case-stale)
- [Case: the bug hides in a shared library version](#case-library)
- [Capture and replay a minimal failing state](#reproduce)
- [Workspaces, regressions, patches and push](#verify-changes)
- [From a browser action to an API check](#api-browser)
- [Scripts, collections and long calculations](#automation)
- [Extend tools and result views](#extend)
- [Monitor work and effectiveness](#operations)
- [Every visualization: what to read and do](#visualizations)
- [Complete live tool reference](#tool-reference)
- [Glossary and common mistakes](#glossary)
- [Trace work and inspect test coverage](#observability)
- [Build shared project understanding](#project-knowledge)
- [Build and review a draft change](#ci-review)

[Complete built-in tool reference](tools.md) · [Source and verification](../benchmarks/handbook-verification.json) · [Task-based novice review](novice-task-review.md)

<a id="start"></a>

## Your first investigation

Get from an unfamiliar symptom to a bounded, reviewable answer.

**Outcome:** Find a real service/object, keep a task record and identify the next evidence gap.

**Before you start:** Open Admin and choose the environment. A configured connection is not proof that its data is indexed.

### Choose a surface and a scope

Open WebUI is the conversation surface. Admin is the operational workbench: Explore searches evidence, Passports/Services map/Architecture show relationships, Task memory keeps work, and Runtime/Jobs explain execution. This handbook is also available at /handbook and as a portable manual in the repository.

Choose the environment in Admin and a stable Chat / task ID before starting. A token identifies the user; the story separates investigations. Profiles such as direct, tester and semantic change which tools are sent to a model; they do not grant permissions. Source env=dev does not mean a test will execute on a deployed dev application.

In the examples, replace the selected service, repository and database with discovered names. checkout and DEMO/checkout belong to the disposable UI playground, not your company environment. Examples are prepared drafts. Nothing runs until you press Run tool.

1. Read Self-context to see which tools and caches are available here.
2. Search previous task memory by ticket. Open an exact context, then read progress.md.
3. Use find for names; inspect a passport or definition before querying live data.
4. Record what is known, the source identity, the next question and what would disprove the current hypothesis.

**Find the service in cached evidence** · `find`

```json
{
  "env": "{{env}}",
  "q": "{{service}}"
}
```

Expected: Catalog lines or an explicit empty-catalog hint. If empty, see Indices; repeated identical searches do not create coverage.

**Discover a compound workflow** · `tool_search`

```json
{
  "query": "investigate service error and reproduce related state"
}
```

Expected: Enabled tools and planning guides, not an automatic diagnosis.

### Keep these identities separate

Chat / task is a stable investigation label you choose, such as REFUND-142. It need not be an existing Open WebUI chat ID. Reuse that label under the same authenticated user to reopen private work; a different story starts a separate investigation. Example names below are illustrative.

Before executing application tests, inspect test_targets and the selected target/runtime bindings. The source environment identifies where captured evidence came from; it does not choose where a test runs. The reproduction chapter shows target, fixture and cleanup lifecycles.

| Identity | Meaning | Where to choose or inspect |
| --- | --- | --- |
| User / role | Authenticated principal and allowed actions | Your configured token/session; Self-context shows the active identity |
| Chat / task · REFUND-142 | Private investigation and memory boundary | Admin Chat / task → Apply scope; standalone handbook has the same control |
| Environment · dev | Source provenance for catalogs/live reads | Environment selector and each tool’s env argument |
| Profile · semantic | Tools offered to the model; grants no extra permissions | Model integration/profile configuration; tool_profiles lists discovery sets |
| Repository revision | Exact source reviewed, independent of deployment | code_index revisionKey and SHA; semantic_index retained analysis ID |
| Execution target / runner | Where application tests execute and which dependencies they use | test_targets; reviewed target/profile and returned runtime bindings |

**Inspect available execution targets** · `test_targets`

```json
{}
```

Expected: Configured execution placement and prerequisites; listing does not start a test.

### Browse the work before choosing a tool

Admin → Workbench and /workbench show a vertical folder navigator. Switch Contexts, Services or Tasks. Tasks group exact ticket/task metadata with related contexts and explicitly linked workspaces; these are separate from running jobs. Services group by common prefix, with declared context links, scripts, saved recipes and attributed API exchanges. Browsing retained names does not query live infrastructure.

Choose a service or file to see relevant actions. Select an evidence context; prepare tests, Consul status, SQL, scripts or API requests, review editable arguments, then Run. Branch navigation explicitly refreshes remote refs and opens a separate owned checkout. Attach it to the evidence context to rediscover it under the ticket. Dirty sources in the original workspace stay there.

The text editor keeps up to 12 dirty drafts in the current user/task scope and supports UTF-8 files up to 64 KiB. Saves reject stale revisions. Reload preserves the draft and shows the saved version for reconciliation. Large, binary and non-UTF8 files remain read-only. Save prepared action retains a redacted recipe in the selected context; reopening prepares it without running. Verify naming-only script candidates before reuse.

Copy view link shares a live selection requiring the recipient’s normal authentication and tool grants. Copy run link retains the invocation/result rather than replaying it. Optional model suggestions remain editable. A successful invocation does not prove passing tests or a successful HTTP response.

**Open the interactive service workbench** · `workbench_open`

```json
{
  "mode": "services",
  "service": "{{service}}",
  "env": "{{env}}"
}
```

Expected: An authenticated live page; no action executes when opened.

**Browse a ticket and related work** · `workbench_open`

```json
{
  "mode": "tasks",
  "task": "{{ticket}}"
}
```

Expected: Contexts and explicitly linked workspaces in the current story.

**Retain a prepared service check** · `workbench_save`

```json
{
  "context": "{{context}}",
  "title": "Service status",
  "tool": "consul_service",
  "arguments": {
    "env": "{{env}}",
    "name": "{{service}}"
  },
  "service": "{{service}}"
}
```

Expected: A revision-checked context recipe, with credentials redacted; does not execute.

![Interactive service/task navigator; disposable Git/Node demo with local Consul/HTTP fixtures.](../screenshots/workbench-explorer-desktop.png)

Interactive service/task navigator; disposable Git/Node demo with local Consul/HTTP fixtures.

### Build an answer someone can audit

A useful first answer names the symptom, environment, deployed/source identity, observed evidence and uncertainty. Link the native view, cite exact file:line or documentation blocks, and distinguish an observation from a proposed cause. A service-name match, green health badge or path through a graph is a starting point.

| Question | Start with | Check before concluding |
| --- | --- | --- |
| What is this service? | passport / showcase | Source SHA, library resolution and missing evidence |
| Who writes this field? | find → pg_usage / field_trace | Column classification, dynamic SQL and missing passports |
| What failed around this request? | logs_search → logs_trace | Time window, trace/tenant/entity identity and instance |
| Can I reproduce it? | scenario_inventory → fixture_plan | Required reads, scope, execution target and independent expectations |

![Admin groups investigation, work and operations; synthetic demo environment.](../screenshots/ux-admin-navigation.png)

Admin groups investigation, work and operations; synthetic demo environment.

**Related chapters:** [Dev-tool’s own operating context](#self-context) · [Contexts, nearby files and handoffs](#task-memory) · [Indices, freshness and exact versions](#indices) · [Case: the cent lost between services](#case-contracts)

<a id="self-context"></a>

## Dev-tool’s own operating context

Understand this installation and keep a durable briefing without copying credentials.

**Outcome:** Refresh a scoped app briefing and preserve operator knowledge across chats.

**Before you start:** Open the Self-context view in this handbook.

### What the live briefing knows

Self-context reports this installation’s version, enabled tool names/groups, profile availability, selected environment and authenticated story. It checks cache file/directory timestamps and configured-capability flags without contacting infrastructure or parsing large PG catalogs. A cache timestamp is a filesystem observation, not a claim that every object is fresh.

The recent-call summary is a bounded operational sample in the current story. Invocation errors and latency help find slow or wasteful workflows. They cannot grade the model, prove a fix or tell whether the user’s question was answered. Use the effectiveness chapter for stronger evidence.

Copy model briefing produces a compact operating context. It excludes raw configuration, token values, connection URLs, file bodies and absolute machine paths. Tool descriptions and schemas are inspected separately when needed.

**Read this installation’s briefing** · `self_context`

```json
{
  "env": "{{env}}"
}
```

Expected: A safe capability/cache summary and a compact model briefing; no network refresh or memory write.

### Keep a persistent self-context

Save self-context creates or reopens the current story’s dev-tool-self context. operating-context.md and capabilities.json are generated snapshots. operator-notes.md is created once and then preserved: record your naming conventions, approved runner profiles, useful script IDs and known limitations there. Never paste credentials.

Open the saved folder from Task memory. A new chat in the same authorized scope can consult it with context_find, context_get and context_read. Another story has its own self-context; this does not publish private notes globally. Refresh generated snapshots when tools/configuration or the selected environment changes. Old captures keep their original timestamps.

If another editor changes a generated file during refresh, revision checks reject the stale write. Read the current file and refresh intentionally; do not erase operator notes to resolve a conflict. This persistent memory complements the live briefing rather than silently replacing it.

**Save a scoped self-context** · `self_context`

```json
{
  "env": "{{env}}",
  "save": true
}
```

Expected: The context ID, written file paths, snapshot time and a link to Task memory.

**Inspect persistent self-context** · `context_get`

```json
{
  "id": "dev-tool-self"
}
```

Expected: A file inventory. Read operator-notes.md for local operating knowledge.

**Related chapters:** [Contexts, nearby files and handoffs](#task-memory) · [Monitor work and effectiveness](#operations) · [Complete live tool reference](#tool-reference)

<a id="task-memory"></a>

## Contexts, nearby files and handoffs

Keep notes and results outside disposable Git checkouts.

**Outcome:** Resume work without re-fetching everything or trusting stale conclusions.

**Before you start:** Choose a ticket/task identity and current story.

### Search before creating

A context is a durable folder with a discovery index. It is useful even when the task has no repository: log investigations, data comparisons, requirement research and scripts can all live there. Contexts and writable code workspaces solve different problems.

context_find searches metadata, discovery links, file names and summaries; it does not read every file body. Search exact tickets/tasks first. If ambiguous candidates are returned, inspect them and select an explicit ID. indexedContexts=0 means no readable saved memory; stop repeating the same search and create a task context.

Open progress.md first, then use context_search to find relevant saved evidence. Save a short plan, current findings, source environment/revisions, unresolved questions and the next action. Update the context summary so another chat can discover it. Supplied discovery-link arrays replace existing arrays: include old links you intend to keep.

**Find prior work** · `context_find`

```json
{
  "query": "{{ticket}}"
}
```

Expected: Exact matches or candidates; inspect identity before attaching.

**Open a task context** · `context_open`

```json
{
  "id": "{{context}}",
  "title": "{{ticket}} · service investigation",
  "tickets": [
    "{{ticket}}"
  ],
  "repositories": [
    "{{repo}}"
  ],
  "summary": "Symptom, evidence, attempted hypotheses and next steps"
}
```

Expected: A reusable folder and progress.md, without requiring Git.

**Search saved evidence** · `context_search`

```json
{
  "id": "{{context}}",
  "query": "revision"
}
```

Expected: Bounded matching lines and file revisions. Use context_read for the exact content.

### Run and retain evidence

Task memory has Files & progress, Tool scratchpad and Saved results modes. Choose a tool, inspect its contract, edit the structured fields or exact JSON, then Run & save result. A model hint proposes arguments; it never executes them.

context_run uses normal tool authorization and effects. Inspect ok and saved/saveError separately: a request can succeed while capture fails. If saving failed after a state-changing call, recover the existing execution/result rather than repeating the action. Keep compact summaries and relevant excerpts; do not flood model context with large saved outputs.

Nearby context_list/read/search/write/edit helpers are available to code cells when context is supplied. A saved script file is not registered or executed until script_save/script_run is used. Copying a result into notes does not upgrade its proof or freshness.

**Run a cached lookup and preserve it** · `context_run`

```json
{
  "id": "{{context}}",
  "tool": "find",
  "arguments": {
    "env": "{{env}}",
    "q": "{{service}}"
  },
  "summary": "Resolve the service before live queries"
}
```

Expected: A saved calls/...json record plus the original native visualization when available.

![Structured arguments and native previews in a task context; actual local show call in the synthetic playground.](../screenshots/ux-context-scratchpad.png)

Structured arguments and native previews in a task context; actual local show call in the synthetic playground.

### Edit, import and archive safely

Use context_read to obtain the current revision before context_edit or a guarded context_write. Configured local/SFTP stores can be browsed and copied with files_* tools. files_archive moves a source from a context or configured writable store into archived/ in a destination context. Supply the observed source revision and inspect sourceRemoved plus destination details; a retained source after partial failure is not a completed move.

1. Read the source and preserve its revision.
2. Archive with an explicit destination context and a useful summary.
3. Inspect both destination and sourceRemoved; resolve partial outcomes without deleting the only good copy.
4. Prefer archival to context_delete_file when the evidence may be useful later.

### Continue long investigations

Compaction is manual by default: use Open WebUI’s Compact action after the current reply finishes. Chat and tool rounds do not automatically summarize. Qwen3.8-27B defaults to a 262144-token window with a 32768-token reserve; other models default to 32768. Set LLM_CONTEXT_WINDOW to the actual serving limit. LLM_COMPACTION_MODE=auto opts into rolling summaries at 75% of the window. Smaller models benefit from the lean-find connection profile.

Open WebUI shows compaction progress and a readable checkpoint, preserving chat history and inline views. Its context status and manual Compact action help recover an old long chat. An invalid request alone does not prove overflow: inspect the provider error for context length versus unsupported parameters or malformed arguments.

A modelContext.compacted tool response is a bounded preview. result_read retrieves exact retained JSON with a pointer such as /rows/0 and continuation cursors; use code to aggregate pages. Do not rerun an action to retrieve output. Important evidence belongs in task memory because result references expire under normal retention.

Keep progress.md updated before large investigations: goal, user constraints, branch/SHA/environment, current findings, tests and actual verdicts, running resources, actions already performed and next steps. After compaction, read that checkpoint and only the relevant evidence. Saved task context is private to the authorized story; publishing shared understanding remains an explicit admin action.

**Related chapters:** [Dev-tool’s own operating context](#self-context) · [Scripts, collections and long calculations](#automation) · [Monitor work and effectiveness](#operations) · [Workspaces, regressions, patches and push](#verify-changes)

<a id="indices"></a>

## Indices, freshness and exact versions

Know which search can answer a question and when to refresh.

**Outcome:** Choose the cheapest adequate source without overwriting the evidence under review.

**Before you start:** Know the selected environment; discover exact names with find.

### Three kinds of evidence

Cached metadata answers what exists and what code appears to touch. Live queries answer what was observed at a particular time. Executed tests answer what happened on a declared target with specific inputs and assertions. Keep these categories separate in notes and final answers.

The index atlas below explains each retained layer, where it comes from, its identity and its refresh tool. Paths are relative to DT_HOME/configured cache roots; they are explanatory, not instructions to copy another user’s absolute directory. File timestamps in Self-context show cache presence/change, not a distributed consistency guarantee.

A source refresh and a derived-index rebuild are different operations. catalog_sync what=index rebuilds catalog/usage from existing caches; it cannot fetch a missing database table definition or a new Confluence page. Refresh the relevant source first, then rebuild derived views.

#### Shared project understanding

Reuse versioned project understanding across users and tasks; private task progress remains separate.

- Source: Admin-published service contracts, assumptions and retained evidence files
- Relative location: `project-contexts/{project}/head.json`
- Identity: Immutable publication and file hashes, exact service source SHAs, author and reason.
- Query tools: `project_context_find`, `project_context_get`, `knowledge_search`
- Limit: Declared knowledge is untrusted. Static/Joern paths are not runtime proof; publication limits preserve old history.

Prepared action: `project_context_find`

```json
{
  "query": "{{service}}"
}
```

#### Environment catalog

Cheap name discovery with find. A hit identifies an object; it does not execute a query.

- Source: Cached PG, ES, Kafka, Consul, passports and API routes
- Relative location: `cache/{env}/catalog.txt`
- Identity: Environment + cached source generations. index rebuilds from cache; it does not contact the sources.
- Query tools: `find`, `pg_table`, `kafka_topic`
- Limit: Catalog absence means unknown coverage, not that the object does not exist.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "index"
}
```

#### Postgres catalog

Tables, columns, functions/bodies, constraints, views and triggers.

- Source: Read-only database metadata refresh
- Relative location: `cache/{env}/pg/`
- Identity: Database snapshot timestamp; deployed code has a separate SHA.
- Query tools: `pg_table`, `pg_function`, `ddl_snapshot`
- Limit: Catalog rows are metadata, not current business rows. Use bounded pg_query for actual values.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "pg",
  "only": "{{db}}"
}
```

#### Postgres usage graph

Readers/writers, functions, views, triggers and supported column lineage.

- Source: Database dependencies plus passport code findings
- Relative location: `cache/{env}/pg/_usage.json`
- Identity: Built from the available catalog/passport generations.
- Query tools: `pg_usage`, `field_trace`, `impact`
- Limit: Missing passports, dynamic SQL and unqualified names can leave ambiguity or gaps.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "index"
}
```

#### Elasticsearch metadata

Resolve an index and its fields before es_search.

- Source: Mappings, aliases and index metadata
- Relative location: `cache/{env}/es/_index.json`
- Identity: Environment + metadata refresh time; documents change separately.
- Query tools: `find`, `es_search`, `es_health`
- Limit: A mapping or alias says nothing about whether a particular document is current.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "es"
}
```

#### Kafka metadata

Resolve topics and schemas before bounded message inspection.

- Source: Topic/config/schema metadata
- Relative location: `cache/{env}/kafka/_index.json`
- Identity: Cluster/environment + cached metadata time; retain partition/offset for observations.
- Query tools: `kafka_topic`, `kafka_last`, `kafka_lag`
- Limit: Samples and lag cannot prove exactly-once delivery or global ordering.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "kafka"
}
```

#### Consul observations

Relate services to replicas, deployed versions/SHAs and observed health.

- Source: Service registrations, health and instance metadata
- Relative location: `cache/{env}/consul.json`
- Identity: Environment + observation time. A version is useful only if actually reported.
- Query tools: `consul_service`, `health`, `overview`
- Limit: Registration is not proof of a dependency. Missing commit metadata remains unknown.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "consul"
}
```

#### Service passports

Endpoints, topics, database accesses, HTTP clients, source locations and resolution gaps.

- Source: Static analysis of service and resolved internal-library source
- Relative location: `passports/{service}/passport.json`
- Identity: Repository + source SHA; retained revisions and correction overlays remain distinct.
- Query tools: `passport`, `semantic_ports`, `who_uses`, `architecture_service`
- Limit: Default-branch library fallback is useful exploration, not exact-version proof.

Prepared action: `passport`

```json
{
  "service": "{{service}}",
  "env": "{{env}}",
  "refresh": true
}
```

#### Repository/module lookup

Resolve internal artifacts to repositories and modules.

- Source: Bitbucket repository folders and Maven/Gradle modules
- Relative location: `cache/bitbucket/_index.json`
- Identity: Repository/module metadata refresh; exact source ref still needs resolving.
- Query tools: `bitbucket_repos`, `repo_fetch`, `passport`
- Limit: A matching artifact name alone cannot choose between multiple versions or owners.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "bitbucket"
}
```

#### Native code index

Scoped text/regex/symbol search and bounded impact without requiring Joern.

- Source: Fetched source files, trigrams, symbols and Java/Kotlin call graph
- Relative location: `cache/code/`
- Identity: Repository SHA plus source digest/revisionKey; workspace changes have their own content identity.
- Query tools: `code_index`, `code_search`, `code_symbols`, `code_read`, `impact`
- Limit: Text hits are candidates. Fast grep fallback and optional Zoekt are search paths, not value-flow proof.

Prepared action: `code_index`

```json
{
  "service": "{{service}}"
}
```

#### Retained Joern projections

Exact-generation symbols, callers, paths, guards and supported value-flow evidence.

- Source: Optional Joern worker code property graph (CPG) and bounded local projections
- Relative location: `cache/semantic/`
- Identity: Exact source/dependency set + analysis/generation IDs; a reparse preserves the last good generation.
- Query tools: `semantic_index`, `semantic_search`, `semantic_query`
- Limit: Select exact analyses; reachability, control flow, local data flow and declared transport maps are different claims.

Prepared action: `semantic_index`

```json
{
  "service": "{{service}}",
  "env": "{{env}}"
}
```

#### Documentation blocks and knowledge

Searchable requirement passages with block/page identities and verifiable quotes.

- Source: Versioned Confluence mirror and configured knowledge sources
- Relative location: `cache/confluence/index/blocks.json`
- Identity: Source revision/page version and indexed block identity; published architecture has a separate revision.
- Query tools: `docs_search`, `docs_page`, `docs_verify`, `knowledge_search`, `knowledge_verify`
- Limit: Embeddings rank candidates; they do not establish that a requirement was implemented.

Prepared action: `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "confluence"
}
```

#### Observed and static routes

Match method/path/host to candidate handlers and prepare API requests.

- Source: Passport endpoints and browser/network observations
- Relative location: `cache/routes.json`
- Identity: Source SHA for static routes; observation timestamp and method/host/path for traffic.
- Query tools: `api_routes`, `routes_discover`, `routes_learn`, `api_exchange_get`
- Limit: api_routes reads the inventory. Capture traffic or rebuild a passport to add evidence; names alone do not prove runtime routing.

Prepared action: `api_routes`

```json
{
  "service": "{{service}}"
}
```

#### Operational history

Inspect work, errors, duration, cancellation and investigation provenance.

- Source: Owned executions, jobs, calls and edited metadata; legacy JSONL remains supported
- Relative location: `cache/state/operational.sqlite`
- Identity: Principal + chat/task scope, call/execution IDs and captured config/registry revisions.
- Query tools: `execution_list`, `execution_get`, `metadata_list`, `call_history`, `dt_log`
- Limit: A successful invocation or low latency is not a successful investigation or a behavioral test pass.

#### Task memory discovery index

Rediscover prior work and read only the evidence relevant to this task.

- Source: Context title, summary, links, file names and per-file summaries
- Relative location: `contexts/{context}/index.json`
- Identity: Context/file revisions; stories isolate private memory. Read content separately.
- Query tools: `context_find`, `context_get`, `context_search`, `context_read`
- Limit: Saved findings can be stale or untrusted; verify environment, SHA and timestamps before reusing them.

Prepared action: `context_find`

```json
{
  "query": "{{ticket}}"
}
```

### Refresh the missing layer, preserve the old identity

Repository aliases can advance as new commits are fetched. For a review, keep the returned SHA, sourceDigest/revisionKey and semantic analysis IDs instead of assuming a branch still means the same source. Listing versions with code_index and semantic_index exposes retained generations. A mutable workspace gets a distinct content identity after edits.

Semantic reparsing is a job and preserves a last good generation. Do not delete an old index simply to make a progress indicator disappear. Observe the returned job, inspect its error/gaps and query the intended retained generation. Concurrent stories do not share owned jobs or private correction overlays.

If an internal library’s exact version cannot be resolved, passport reports its bounded search/fallback. Default-branch source helps exploration, but cannot prove behavior of the deployed artifact. Record the fallback, inspect build.gradle/pom.xml and select the exact source before making a compatibility claim.

**Rebuild derived catalog from cache** · `catalog_sync`

```json
{
  "env": "{{env}}",
  "what": "index"
}
```

Expected: A job or completed refresh; source systems are not refreshed by index-only work.

**List retained code revisions** · `code_index`

```json
{
  "versions": true
}
```

Expected: Source identities usable for scoped searches.

**List retained semantic analyses** · `semantic_index`

```json
{
  "versions": true
}
```

Expected: Generation IDs and exact source identities; no target means listing, not parsing.

### Carry a returned identity into the next call

First run List retained code revisions above. Expand Complete tool result: the tabular result contains rows. Choose a row for the intended repository/source; copy that row’s revisionKey, and retain its SHA. Paste the returned revisionKey into Example variables → revisionKey. The pinned search below sets repo to that exact key. Do not substitute the mutable PROJECT/repo alias.

Then run List retained semantic analyses. Choose a ready analysis matching the intended repository, SHA and language; copy analyses[n].id into Example variables → analysis. The pinned semantic search below passes analysis directly. Verify the returned analyses identities match your selection before interpreting hits. An empty list means no retained analysis in this scope; it is not a fabricated ID or permission to query an unrelated generation.

When an index job is needed, observe its returned job ID until ready, then list again. Preserve sourceDigest/revisionKey and full SHA from the indexed result/manifest when the listing abbreviates SHA. For multi-repository work, use an actual returned revisionSet or explicit analyses array. A text match is still only a candidate even when the source selection is exact.

| Observed response field | Next argument | Check |
| --- | --- | --- |
| code_index listing rows[n].revisionKey | code_search.repo | Same retained code source; keep the row’s SHA |
| semantic_index analyses[n].id | semantic_search.analysis / semantic_query.analysis | Returned analyses[].id and SHA match the selected source |
| Composite semantic_index revisionSet | semantic_query.revisionSet | All selected service/library revisions belong to the intended closure |

**Search the selected immutable code revision** · `code_search`

```json
{
  "repo": "{{revisionKey}}",
  "pattern": "BigDecimal",
  "limit": 30
}
```

Expected: Paste the returned revisionKey above first; inspect the repo argument before Run. Required returned variables: revisionKey.

**Search the selected retained analysis** · `semantic_search`

```json
{
  "analysis": "{{analysis}}",
  "query": "refund",
  "limit": 20
}
```

Expected: Paste the returned analysis ID above first; confirm result analyses identities and proof/gaps. Required returned variables: analysis.

**Related chapters:** [Explore a service and its surroundings](#services) · [Code search, impact and Joern](#joern) · [Case: the bug hides in a shared library version](#case-library) · [Monitor work and effectiveness](#operations)

<a id="services"></a>

## Explore a service and its surroundings

Move from a name to endpoints, storage, topics, libraries and environment replicas.

**Outcome:** Explain a service’s boundary and know which connections are evidenced.

**Before you start:** A service name or repository; environment access only for live observations.

### Read the passport before expanding the ocean

Search find or passports, then request passport for one service and selected environment. The response may return cached evidence or an asynchronous build. Observe job=<returned ID> instead of repeatedly requesting refresh=true. The passport source SHA and library-resolution notes are part of the answer.

Read endpoints, scheduled entries, consumed/produced topics, tables/functions, external HTTP clients, internal libraries and source locations. A missing section can mean incomplete analysis; inspect gaps before concluding there are no dependencies. who_uses and pg_usage reveal consumers and writers outside the selected service.

The Services map groups many services by name prefix. Prefix containment is an inventory convenience, not ownership or an inferred dependency. Expand a prefix, inspect a service and read connection evidence. Candidate edges are optional and explicitly weaker. UI deployments, UI repositories and backend services keep separate identities.

**Inspect the service passport** · `passport`

```json
{
  "service": "{{service}}",
  "env": "{{env}}"
}
```

Expected: Pinned source, boundary summary, job state if needed and a native passport view.

**Open a bounded service neighborhood** · `map`

```json
{
  "env": "{{env}}",
  "focus": "svc:{{service}}",
  "depth": 1
}
```

Expected: Evidenced entities/relations and gaps; no invented aggregate arrows.

**Find related services** · `who_uses`

```json
{
  "name": "{{service}}",
  "env": "{{env}}"
}
```

Expected: Cross-service evidence; inspect the actual matched resource and direction.

![A dedicated map workspace; service-prefix grouping is inventory, not proof of dependency.](../screenshots/ux-services-map.png)

A dedicated map workspace; service-prefix grouping is inventory, not proof of dependency.

### Correct ports where you see them

Open Edit boundary graph on an authenticated passport or Edit service ports in Joern & ports. Select a graph node/list item to inspect type, source, target and mappings. Edit HTTP host/method/path, topic/cluster, database/schema/table, schedule or library identity. Add a missing boundary when evidence exists.

Every correction needs a reason/source citation and the adjustment revision read with that exact source identity. Hide false detections and restore them later. Delete only manually declared ports; source detections remain intact. A revision conflict preserves the draft. Reload and reconcile rather than silently overriding another editor.

Corrections are private versioned declarations, distinct from detected source and Joern proof. They can improve exploration but do not prove runtime delivery. HTTP ports link to API explorer; adding a port does not execute that API or change the deployed application.

![Typed port CRUD beside the graph; actual Java fixture analysis with unresolved boundaries visible.](../screenshots/ux-passport-graph.png)

Typed port CRUD beside the graph; actual Java fixture analysis with unresolved boundaries visible.

### Check what is deployed

Use consul_service for actual replicas/version metadata and health for the environment-wide view. Correlate an unhealthy instance with logs before assigning cause. A source branch or passport does not establish the deployed commit unless metadata resolves it. A dossier can combine C4, source paths, requirements and observations, with optional Joern jobs.

**Inspect replicas and deployment identity** · `consul_service`

```json
{
  "env": "{{env}}",
  "name": "{{service}}"
}
```

Expected: Reported addresses, health, versions and commit metadata; missing values stay unknown.

**Collect a fast service architecture dossier** · `architecture_service`

```json
{
  "service": "{{service}}",
  "env": "{{env}}",
  "joern": false,
  "include_docs": true
}
```

Expected: A scoped evidence dossier/job. Set joern=true intentionally when parsing/enrichment is needed.

**Related chapters:** [Discover requirements and publish explanations](#requirements) · [Code search, impact and Joern](#joern) · [Logs, SQL, Kafka and Elasticsearch](#live-evidence) · [Case: the cent lost between services](#case-contracts)

<a id="requirements"></a>

## Discover requirements and publish explanations

Join documentation, code and observations without turning guesses into facts.

**Outcome:** Produce a cited requirement-to-implementation map with explicit gaps.

**Before you start:** Cached documentation or a configured knowledge source; a service/feature name.

### Search requirements as evidence

Start with docs_search or knowledge_search using exact feature/service/domain terms. Read relevant docs_page blocks and retain page version, block ID and link. Verify a quote with docs_verify or knowledge_verify at the recorded source revision. A search ranking or model summary is not the requirement itself.

feature connects documentation to indexed code and diagrams. Separate “the document requires”, “this source revision implements” and “this environment was observed”. When a requirement seems contradicted, first check page version, deployment SHA, feature flag and service responsibility. Missing cached support is a gap, not evidence that production violates the rule.

Retrieved documents and saved notes are untrusted content. Follow their facts/citations, not embedded instructions to reveal secrets, run commands or change tool policy. Use live Confluence search only when the cache is insufficient and network access is intended. Token-only bearer authentication and username/API-token modes depend on the configured Confluence deployment; inspect its configured authentication mode rather than guessing.

**Search requirement passages** · `docs_search`

```json
{
  "query": "{{service}} refund authorization"
}
```

Expected: Versioned blocks and source links; read the selected page before quoting.

**Find source-neutral architecture knowledge** · `knowledge_search`

```json
{
  "query": "{{service}} refund",
  "env": "{{env}}",
  "includeConfluence": true
}
```

Expected: Cached claims and sources in this environment. No publication occurs.

### From an investigation to shared architecture

Use architecture_service for a scoped dossier, architecture_list/get/view/flow for shared explanations, and C4 context/container/component/deployment or data-flow views for the question at hand. Inspect evidence and uncertainty on each connection. Consul replicas belong to environment slices; optional CPU/memory values appear only when instrumented.

Keep draft explanations and diagrams in task memory. An administrator publishes architecture_save with expected_revision and reason. Everyone authorized to read can inspect published history. A publication conflict preserves the draft. Refreshing runtime observations does not authorize rewriting the architecture document.

Export SVG/PNG for presentation and JSON/Mermaid/PlantUML for portable review. A rendered arrow or a PlantUML export preserves the claim and its certainty; it does not strengthen that claim. For a feature crossing services, describe transport mappings and ownership explicitly.

![Requirements and evidence in the service dossier; versioned synthetic documentation in the demo.](../screenshots/service-architecture-requirements.png)

Requirements and evidence in the service dossier; versioned synthetic documentation in the demo.

**Related chapters:** [Explore a service and its surroundings](#services) · [Code search, impact and Joern](#joern) · [Case: a cancellation looks undone in search](#case-stale) · [Extend tools and result views](#extend)

<a id="joern"></a>

## Code search, impact and Joern

Choose text search, symbol graph or value-flow evidence for the actual question.

**Outcome:** Pin the source and trace a bounded entry-to-exit path with honest proof labels.

**Before you start:** Fetched/indexed source; optional semantic worker for Joern queries.

### Start with cheap source discovery

code_search accepts a single repo argument so one-repository results do not repeat a redundant repo column. Use scoped text, regex and source globs; code_read fetches exact lines and code_symbols resolves symbols. The native index/fast grep path works without Joern. Optional Zoekt can broaden text impact across internal repositories; it does not replace evidence about the exact deployed library revision.

Use impact for candidate affected endpoints, resources and tests. Read returned depth/budget/ambiguity and source identities. An impact candidate is not a guarantee that a test executes the affected behavior. Check internal library versions in build files and passport resolution before traversing across module boundaries.

**Search one repository** · `code_search`

```json
{
  "repo": "{{repo}}",
  "pattern": "refund",
  "limit": 30
}
```

Expected: Source hits with bounded context; select exact revisions for historical analysis.

**Inspect semantic readiness** · `semantic_capabilities`

```json
{}
```

Expected: Configured/retained capabilities and limits; no implicit CPG build.

### Use the guided Joern workbench

In Joern & ports, select a retained analysis or enter service/repository/source revision. Build missing analysis starts an owned parse job; cancel or inspect it with the returned ID. Symbol search does not silently start a parse. If parsing is unavailable, continue with native code search and record the missing semantic evidence.

Choose Trace calls or Trace values. Search/select the source entry and target exit symbols, review their source identity and exact arguments, then Run investigation. The UI follows the project/symbol-first interaction used by file-projections. Raw arguments remain available for callers, slices, guards, comparisons and cross-analysis selectors.

Call reachability answers whether a supported call chain exists. Dataflow/controlflow modes answer narrower supported questions over recorded generations. A local CPG segment, a declared Kafka/HTTP mapping and a database usage edge have different proof. No chain through all three proves an end-to-end value arrived in production.

Inspect source hierarchy, path cards, guards, bypasses, coverage, ambiguity and feasibility. A guard’s presence does not prove dominance on every path. “No path” can mean unsupported analysis or a budget limit; consult gaps before declaring impossibility. Keep exact analysis IDs in task memory for repeatable review.

**Select retained analyses** · `semantic_index`

```json
{
  "versions": true
}
```

Expected: Exact generation IDs; select one before searching symbols.

**Search retained methods and boundaries** · `semantic_search`

```json
{
  "service": "{{service}}",
  "env": "{{env}}",
  "query": "refund",
  "limit": 12
}
```

Expected: Source locations or a missing-analysis/build suggestion.

![Entry/exit selection with a synthetic retained projection; this screenshot is not evidence of a fresh Joern parse.](../screenshots/ux-joern-symbols.png)

Entry/exit selection with a synthetic retained projection; this screenshot is not evidence of a fresh Joern parse.

### Map entry decisions, data changes and exits

Choose Map entries to exits in Joern & service ports, select an exact retained entry symbol and Run investigation. No target symbol is needed. Without an explicit entry, only uniquely bound ingress passport ports become entries; a method with no callers is not assumed to be public.

Call overview shows positional argument bindings across retained bodies. Select a method for its control states, assignment/compound expressions, field writes, calls, returns and explicit failure exits. Trace inputs highlights recorded dependencies. Branch polarity stays unknown where evidence is insufficient; raw throw continuations are unresolved exception evidence and are excluded from normal control paths.

Select a suspect state, inspect its source, copy fix context and export the full JSON/SVG/Mermaid before editing. Read source in Workbench prepares an exact code_read draft without executing it. Verify values at all affected effects and returns with a sensitive failing entry-to-exit regression, then retain a separate fixed snapshot. Model previews may omit detail explicitly; the full view retains the original bounded evidence.

**Map the selected retained ingress points** · `semantic_query`

```json
{
  "operation": "flowmap",
  "analysis": "{{analysis}}",
  "maxMethods": 20,
  "maxStates": 180
}
```

Expected: Select a returned analysis ID first. If no bound ingress exists, select a precise whole-method from selector in Joern & ports. Required returned variables: analysis.

![Real retained Joern fixture: the ledger argument is gross while the transformed value is payable; static evidence still requires executable regression assertions.](../screenshots/entry-exit-flow-map-1440.png)

Real retained Joern fixture: the ledger argument is gross while the transformed value is payable; static evidence still requires executable regression assertions.

**Related chapters:** [Indices, freshness and exact versions](#indices) · [Explore a service and its surroundings](#services) · [Case: the bug hides in a shared library version](#case-library) · [Workspaces, regressions, patches and push](#verify-changes)

<a id="live-evidence"></a>

## Logs, SQL, Kafka and Elasticsearch

Observe the same entity across systems without confusing clocks, tenants or stale projections.

**Outcome:** Create a correlated evidence timeline and identify the first unexplained boundary.

**Before you start:** Environment, bounded time window and trace/entity/tenant identity.

### Write down the correlation tuple

Use an investigation tuple: environment, tenant, entity ID, time window, trace ID, deployed SHA and topic partition/offset where available. Retain IDs as strings when precision matters. The same order ID can belong to multiple tenants; a log line from a different replica/version may describe a different implementation.

Start with a bounded logs_search and expand one trace with logs_trace. Check instance/version and timestamps. Lack of an ERROR log is not evidence of correct behavior; absence can reflect retention, sampling or an incorrect query. Record the exact query/window with the result.

Discover schema/table/function names before SQL. pg_query is read-only and time-bounded. Select the necessary columns and filter by tenant plus entity; avoid unbounded SELECT *. Parameterize reusable scripts and never copy connection credentials into saved evidence. Database functions can hide enrichment, normalization and transaction semantics that are absent from the Java handler.

**Collect a bounded service window** · `logs_search`

```json
{
  "env": "{{env}}",
  "service": "{{service}}",
  "from": "30m",
  "size": 50
}
```

Expected: Timestamped observations with source links; narrow by actual trace/entity after inspection.

**Inspect the refund table’s users** · `pg_usage`

```json
{
  "env": "{{env}}",
  "name": "sales.refunds"
}
```

Expected: Readers/writers/functions/triggers with source references; substitute a discovered table.

### Read each system’s semantics

kafka_topic describes schemas/configuration; kafka_last samples bounded messages; kafka_lag shows consumer progress. Retain key, schema, partition/offset and event time. A sampled message may be old, duplicated or from another tenant. Never infer exactly-once processing from a few messages or zero lag.

For Elasticsearch, inspect mappings/aliases before es_search. Compare indexed version/update time to the authoritative database/event. A missing search hit can be projection lag, alias routing, refresh timing or tenant filtering. A successful write API response does not imply the document is immediately searchable.

Join compact results with code when needed: one bounded computation can combine SQL, Kafka and ES evidence. Print a small comparison and preserve the full relevant inputs in task memory. Do not load a hundred-megabyte catalog into a model or construct an unbounded JSON aggregation just to count matches.

**Inspect the event contract** · `kafka_topic`

```json
{
  "env": "{{env}}",
  "topic": "refund.approved"
}
```

Expected: Schema/config and bounded topic metadata; discover the actual topic first.

**Inspect a few event envelopes** · `kafka_last`

```json
{
  "env": "{{env}}",
  "topic": "refund.approved",
  "n": 5
}
```

Expected: Read-only samples, not delivery or ordering proof.

**Related chapters:** [Case: the cent lost between services](#case-contracts) · [Case: an event succeeds for the wrong tenant](#case-tenant) · [Case: a cancellation looks undone in search](#case-stale) · [Capture and replay a minimal failing state](#reproduce)

<a id="case-contracts"></a>

## Case: the cent lost between services

A correct-looking UI total diverges only after a shared library, API and SQL function.

**Outcome:** Find the first contract violation and design a regression across the boundary.

**Before you start:** Illustrative case: checkout, reservations and payments; replace names with real evidence.

### The symptom and the misleading easy answer

A customer sees 10.01 in checkout. The accepted reservation stores 1000 cents and the refund event later carries 10.00. Unit tests for checkout’s formatter pass. Possible causes include floating-point rounding, a major/minor-unit mismatch, stale deployed library code, a database normalization function or an old event—not simply “the UI is wrong”. This is a teaching case, not a claim about the bundled fixture.

Open a ticket context and record the expected contract independently: currency, scale, rounding rule, authoritative amount, tax/quantity handling and whether conversions happen once. Search requirements and read the relevant document blocks. Pin the request’s actual deployment and shared library version; latest-main source alone cannot explain a previous release.

1. Find the checkout endpoint and shared amount-library call in passport/code.
2. Read the observed outgoing HTTP request in API explorer, with credentials redacted.
3. Read the receiving handler, mapper and any SQL function/trigger that touches the amount.
4. Compare the persisted row, produced event and Elasticsearch projection using the same tenant/order/version.

### Construct a boundary ledger

Record raw representation and units at each boundary. Inspect the exact source producing and consuming each value. The first difference from the independently stated contract narrows the investigation; downstream symptoms may be consequences.

| Boundary | Observation to preserve | Competing explanations |
| --- | --- | --- |
| UI → checkout | Request body, currency and displayed total | UI rounding versus server recomputation |
| Checkout → internal library | DTO values and exact artifact/version | Wrong import/version or decimal-scale policy |
| Checkout → reservations API | Raw JSON value, type and contract units | 10.01 major units versus 1001 minor units |
| Mapper → SQL function | Bound values, function definition, trigger chain | Integer cast, scale truncation or enrichment override |
| DB → Kafka → ES | Entity version, event ID, tenant and offsets | Corrected DB with stale/duplicate projection |

**Locate the boundary API** · `api_routes`

```json
{
  "service": "{{service}}"
}
```

Expected: Candidate method/path/handler; open the observed request rather than inventing a host.

**Find conversion and rounding sites** · `code_search`

```json
{
  "repo": "{{repo}}",
  "pattern": "BigDecimal",
  "limit": 30
}
```

Expected: Read both caller and callee; a class name alone does not settle the units.

**Follow database-side enrichment** · `pg_usage`

```json
{
  "env": "{{env}}",
  "name": "sales.refunds"
}
```

Expected: Inspect functions/triggers and exact definitions before changing Java code.

### Choose the next discriminating check

Use the interactive checkpoints to practice evidence selection. Each answer states what would narrow the case, rather than presenting a precomputed production diagnosis.

**Checkpoint:** The outgoing request contains 10.01, but the receiver contract says integer cents. Which next step best tests the boundary?

<details><summary>Change the UI formatter to show 10.00</summary>

This can hide the symptom while leaving the contract violation. First verify the receiving handler/schema and observe its parsed value.

</details>

<details><summary>Verify the request/receiver units and test 10.01 → 1001 cents</summary>

Correct direction. Inspect both contracts and actual parsed input, then reproduce the conversion with independent expected values. Also cover zero, negatives, tax/quantity and malformed input.

</details>

<details><summary>Declare the Kafka consumer broken because the event is 10.00</summary>

The event may faithfully reflect the already wrong database value. Walk upstream and compare entity versions before blaming delivery.

</details>

### Prove the repair at the actual seam

Capture the minimal input and related rows. Execute the real caller/library/receiver path with edge dependencies controlled at the intended level. A test that mocks the conversion function and asserts its own mock cannot expose the unit mismatch.

Show a failing assertion on the original version and a passing assertion after the fix. Include adjacent rounding values, precision-preserving IDs, invalid inputs with no downstream calls, and relevant tenant isolation. Compare before/after values with differential_check when a reviewed profile exists. Record build target, deployed/source SHA and any untested transport seam.

Save the boundary ledger and test evidence in context, link the patch, then inspect downstream projections separately. A green conversion test does not establish that a live Kafka/ES pipeline has caught up. The same ledger can be reused in the stale-projection case.

### Optional local practice: execute the same boundary checks

This small executable teaching exercise needs only the built-in js_run sandbox. It makes no business API/database calls and installs nothing. It tests the amount-conversion seam, not the full checkout service or a live pipeline. The original source is shown in the prepared code argument; the independent receiver contract is exact integer cents encoded as a string.

Open the practice context first. Run the broken version: invocation/capture may be successful while two named assertions fail (10.01 and the large value). Expand Complete tool result and inspect preview → result.tests, observed/expected values, and the saved calls record. Then run the repaired version with the identical three assertions. All three must pass. The fix changes the converter only; it avoids Number precision loss by parsing decimal digits with BigInt.

Both context_run results give a saved calls/...json path. Read those records with context_read to retain the actual code, test names and values. The same test selectors must occur in both records. No remote resource is allocated; the sandbox computation finishes locally. Archive these practice records when no longer useful. For a real service, repeat the checks through its actual caller/library/receiver path with a declared test target and independent side-effect assertions.

**Open the local practice context** · `context_open`

```json
{
  "id": "{{context}}",
  "title": "{{ticket}} · boundary practice",
  "tickets": [
    "{{ticket}}"
  ],
  "summary": "Local amount-conversion red/green exercise; no application integration proof"
}
```

Expected: A private folder for the two actual sandbox results.

**Run the broken converter** · `context_run`

```json
{
  "id": "{{context}}",
  "tool": "js_run",
  "arguments": {
    "code": "const toMinor = major => String(Math.trunc(Number(major)) * 100);\n// The receiving contract requires exact integer cents, represented as a string.\nfor (const [input, expected] of [['10.01', '1001'], ['0.00', '0'], ['90071992547409.93', '9007199254740993']]) {\n  test('major-to-minor ' + input, () => expect(toMinor(input)).toBe(expected));\n}\nreturn { observed: toMinor('10.01'), expected: '1001' };"
  },
  "summary": "Original converter: same independent amount assertions; inspect failing tests"
}
```

Expected: Two failed assertions and one passing assertion; expected 1001, observed 1000 for 10.01. Invocation success is not test success.

**Run the repaired converter** · `context_run`

```json
{
  "id": "{{context}}",
  "tool": "js_run",
  "arguments": {
    "code": "const toMinor = major => {\n  if (!/^\\d+\\.\\d{2}$/.test(major)) throw Error('Expected non-negative decimal with two fractional digits');\n  const [whole, fraction] = major.split('.');\n  return String(BigInt(whole) * 100n + BigInt(fraction));\n};\n// The receiving contract requires exact integer cents, represented as a string.\nfor (const [input, expected] of [['10.01', '1001'], ['0.00', '0'], ['90071992547409.93', '9007199254740993']]) {\n  test('major-to-minor ' + input, () => expect(toMinor(input)).toBe(expected));\n}\nreturn { observed: toMinor('10.01'), expected: '1001' };"
  },
  "summary": "Repaired converter: identical independent assertions; inspect all three passes"
}
```

Expected: The same three assertion names pass. Keep both saved records; this is local teaching evidence, not workspace red-green certification.

**Related chapters:** [Discover requirements and publish explanations](#requirements) · [Case: the bug hides in a shared library version](#case-library) · [Case: a cancellation looks undone in search](#case-stale) · [Workspaces, regressions, patches and push](#verify-changes)

<a id="case-tenant"></a>

## Case: an event succeeds for the wrong tenant

Two databases, a shared publisher and an unsafe large identifier produce misleading green signals.

**Outcome:** Preserve identity through capture, replay and independent write checks.

**Before you start:** Illustrative case; never run these business mutations against a source environment.

### A duplicate-looking order disappears

Tenant A and tenant B both have order 42. Two other orders have IDs 9007199254740992 and 9007199254740993. A consumer reports success, lag is zero, but one refund is missing and another tenant’s state changed. A JavaScript Number can collapse adjacent large IDs; a SQL join can drop tenant_id; an idempotency key can omit tenant; a shared publisher can encode a string ID as a number.

Before diagnosing, inspect schema types and event bytes, mapper code, SQL predicates, idempotency-key construction and the exact shared-library artifact. “Same orderId” is not a safe correlation relation. Zero lag says offsets advanced, not that the correct business entity was updated.

| Candidate defect | Evidence to inspect | Independent counterexample |
| --- | --- | --- |
| Precision loss | Raw event, decoded type, JS/JSON conversion | Two adjacent large IDs remain distinct strings |
| Tenant omitted from join | SQL predicates and composite FK tuples | Same ID in two tenants; only intended tenant changes |
| Dedup key too broad | Publisher/consumer key construction | Same entity ID in separate tenants processes independently |
| Cross-DB relation guessed | Business relation evidence and fixture plan | Unrelated same-number rows are excluded |

### Capture related tuples, not a bag of IDs

fixture_plan binds explicit roots, foreign-key closure, cross-database relations, Kafka matches and Elasticsearch reads. Use tenant-qualified tuples and explicit relation evidence. Inspect the plan before capture; a field named id in two databases is not enough to infer a relationship.

1. Validate the schema and FK closure with fixture_schema/fixture_validate.
2. Capture bounded source reads; keep schema/source hashes, time windows and declared consistency limits.
3. Review Kafka codecs and ES mappings. Missing or truncated reads remain incomplete.
4. Export/replay only into reviewed owned resources; bind every application datasource explicitly.

**Prepare a bounded identity-sensitive capture** · `fixture_plan`

```json
{
  "env": "{{env}}",
  "service": "{{service}}",
  "seeds": [
    {
      "db": "{{db}}",
      "table": "sales.refunds",
      "where": {
        "tenant_id": "tenant-a",
        "order_id": "9007199254740993"
      }
    }
  ],
  "limits": {
    "totalRows": 100,
    "queries": 20,
    "durationMs": 30000
  }
}
```

Expected: A plan to inspect, not a capture or replay. Supply actual required reads and evidenced cross-system relations before execution.

### Assertions must watch the uninvolved tenant too

A useful regression asserts both the intended update and the absence of unrelated writes. Freeze independent expectations before executing the application: tenant A’s target row changes, tenant B’s row stays byte-for-byte equivalent, adjacent large IDs remain distinct, and rejected inputs leave state untouched.

For native fixture replay, preflight supported adapters, start the owned runtime, inspect bindings, arm expected effects, run the actual application test, observe outputs and check them independently. Record rejected/unbound reads. Stop the lease and inspect cleanup; a JSON fixture export is not a running Kafka broker or ES replay.

A success response from scenario_run, collection_run or test_run is only useful with actual executed assertions and correct target/identity. No-test and skip-only outcomes cannot prove the fix. Distinguish external acceptance evidence from the tool’s own execution transcript.

**Checkpoint:** The target refund row is correct after replay. What else is essential before calling the tenant bug fixed?

<details><summary>Check that the consumer lag is zero</summary>

Useful operational context, but it does not check which tenant was written.

</details>

<details><summary>Verify no writes to the other tenant and preserve both large IDs</summary>

Yes. Independently observe the negative effects and identity-sensitive cases, using the actual application path and declared datasource bindings.

</details>

<details><summary>Compare only the count of rows</summary>

Equal counts can conceal swapped identities, wrong amounts or cross-tenant updates.

</details>

**Related chapters:** [Logs, SQL, Kafka and Elasticsearch](#live-evidence) · [Capture and replay a minimal failing state](#reproduce) · [Workspaces, regressions, patches and push](#verify-changes) · [Case: the bug hides in a shared library version](#case-library)

<a id="case-stale"></a>

## Case: a cancellation looks undone in search

HTTP acceptance, an outbox, a retrying consumer and a stale index disagree.

**Outcome:** Distinguish expected eventual consistency from a lost, duplicated or misrouted update.

**Before you start:** Illustrative asynchronous workflow; agree on the documented consistency window.

### Build a versioned timeline

A cancellation endpoint returns 202. Postgres says cancelled, the UI search still says active, and one retry log appears in UAT but not dev. Possible explanations include an accepted asynchronous command, an outbox transaction that did not publish, a consumer retry, wrong tenant routing, a stale ES alias or an old UI bundle/API endpoint.

Do not treat HTTP 202 as proof of completed cancellation. Read the requirement’s consistency guarantee, then construct a timeline: request/trace, database entity version and outbox row, event ID and partition/offset, consumer attempt/version, ES document version/update time, alias and the UI’s actual network request.

Compare Consul’s replica SHAs and environment configuration. A UI deployment is not the same node as its React repository; a discovered browser host is not automatically a Kafka consumer. Correct identity/edge declarations only with a requirement, property, source file or observed request as evidence.

| Observed divergence | Next discriminating check | Do not conclude |
| --- | --- | --- |
| DB updated, no event found | Outbox row/state, publishing logs and bounded offsets | “No sampled event” proves no event was ever sent |
| Event exists, ES old | Consumer version, retry/DLQ, target alias and tenant | Zero lag proves successful projection |
| ES current, UI old | Actual API response, cache headers, UI deployment/repo binding | The backend is wrong because the screen is stale |
| Only one replica fails | Consul SHA/config and that replica’s trace | The whole environment runs one source version |

### Test retry and ordering behavior explicitly

Create deterministic scenarios for duplicate delivery, delayed older events, authorization failure, unavailable downstream and retry-after-success. Assert the business rule: monotonic entity versions or idempotent effects, not an assumed global ordering of all Kafka topics.

Use scenario_inventory/state planning to identify dependencies, then reviewed scenario/fixture runtime bindings to exercise the relevant seams. A declaration of an HTTP/Kafka boundary is useful for a test plan but not a proof that transport occurred. Include time/clock assumptions and independent expectations.

If all evidence agrees that the documented window has not expired, report the observation and when to re-check; do not patch a correct asynchronous pipeline. If a stale event overwrites a newer version, reproduce the ordering defect and retain both events/version checks in the regression.

**Checkpoint:** DB version 8 is cancelled, but ES version 7 is active immediately after a 202. Which conclusion is justified?

<details><summary>The cancellation failed</summary>

Too early. The database changed, and the API accepted asynchronous work. Check the documented consistency window and projection timeline.

</details>

<details><summary>The system is definitely healthy</summary>

Also too strong. Publication/processing could be stuck. Inspect outbox, offsets, consumer evidence and the deadline.

</details>

<details><summary>The search projection is behind; investigate whether it catches up within the contract</summary>

Correct bounded observation. Preserve versions and timestamps, then locate the first missing or contradictory stage.

</details>

**Related chapters:** [Discover requirements and publish explanations](#requirements) · [Logs, SQL, Kafka and Elasticsearch](#live-evidence) · [From a browser action to an API check](#api-browser) · [Capture and replay a minimal failing state](#reproduce) · [Case: the cent lost between services](#case-contracts)

<a id="case-library"></a>

## Case: the bug hides in a shared library version

Two services import the same class name while a passport falls back to default-branch source.

**Outcome:** Resolve actual dependency identity before changing an import or claiming cross-service impact.

**Before you start:** Build files/artifact metadata and exact service source or deployment identity.

### Separate the names that look the same

A service compiles with a new import suggested by a model, but an endpoint disappears or rounding changes only on UAT. Two libraries export the same short class name. The passport could not find the requested artifact version and used the default branch. The fallback is not the deployed artifact, even if the repository name matches.

Read build.gradle/pom.xml dependency declarations, dependency management, module paths, resolved classpath and jar ownership. Search internal library repositories/modules with the Bitbucket index; inspect the exact version’s source/tag/SHA when available. Record both the requested artifact version and the resolution confidence.

A compile fix may be syntactically valid and semantically wrong. Inspect workspace_write compile.errors/fixed/suggestions and imports. Prefer the project’s intended internal class only when source/classpath evidence supports that ownership; “internal” is not an unconditional correctness rule. Use fix=false when you want to review suggestions before applying them.

**Inspect Gradle dependency declarations** · `code_search`

```json
{
  "repo": "{{repo}}",
  "pattern": "implementation",
  "glob": "**/build.gradle*",
  "limit": 30
}
```

Expected: Exact source hits; also inspect version catalogs/dependency management when used.

**Compare existing import conventions** · `code_search`

```json
{
  "repo": "{{repo}}",
  "pattern": "import ",
  "limit": 30
}
```

Expected: Conventions are hints. Check class owner, API and resolved classpath before editing.

### Trace and test the dependency closure

Resolve the actual shared method and affected callers with native code graph/impact. Joern may enrich supported Java/Kotlin slices over the exact dependency closure. Do not merge two generations merely because method names match. Keep analysis IDs and library-resolution gaps with the path evidence.

A library unit test alone cannot prove both services use the repaired artifact. Execute a sensitive service-level test against the intended library version and inspect runtime classpath/source identity. Test the old failure first, then the candidate, and check consumers for changed DTO/topic/API contracts.

If source for the deployed library version remains unavailable, state that limitation, use artifact-level behavior tests where supported, and avoid an exact source-level diagnosis. Keep a useful default-branch hypothesis in context while clearly separating it from confirmed evidence.

**Related chapters:** [Indices, freshness and exact versions](#indices) · [Code search, impact and Joern](#joern) · [Workspaces, regressions, patches and push](#verify-changes) · [Case: the cent lost between services](#case-contracts)

<a id="reproduce"></a>

## Capture and replay a minimal failing state

Turn cross-system observations into owned, reproducible inputs and effects.

**Outcome:** Execute a bounded application regression and clean up its resources.

**Before you start:** Known behavior contract, roots/tenant/window, supported adapters and reviewed execution target.

### Choose the right reproduction layer

scenario_inventory identifies known application reads/actions. fixture_plan/capture/validate/export preserve related source state. scenario_state_plan/capture/get preserve cross-source scenario evidence. These are not all interchangeable, and none by itself executes the application.

A simple JVM regression may use test_data factories and mocked edges. A SQL-dependent regression may use a dedicated scratch Postgres database or a verified template clone. A cross-system test may require fixture_runtime adapters and explicit bindings. A portable scenario package declares the workload and expectations; scenario_verify/preflight checks support before execution.

Do not replay source writes into a production database. Source PG/ES/Kafka reads stay read-only; scratch resources have their own connection bindings and owner leases. env chooses source context, while target and runtime bindings determine execution. Inspect execution metadata before claiming “tested on dev”.

| Need | Tools | Evidence to retain |
| --- | --- | --- |
| Related source rows/events | fixture_plan/capture/validate/export | Roots, relation evidence, scope, gaps and hashes |
| A running owned PG/ES/Kafka fixture | fixture_runtime_preflight/start/bindings | Adapter support, lease ID and application datasource mapping |
| Independent effects | fixture_runtime_arm/observe/check | Frozen expectations and observed writes/no-writes |
| Portable declared workload | scenario_package/verify/preflight/run | Package revision, action bindings, assertions and target |
| Controlled template DB | testdb_* lifecycle | Dedicated scratch server, base/template/lease identity and cleanup |

### Scratch databases and runtime ownership

testdb_capabilities and testdb_initialize describe/prepare the dedicated scratch cluster. Template plan/build/inspect/verify preserve an immutable base; clone allocates a private leased database. Inspect/renew/reset/release operate on owned resources. Pin/invalidate/gc have explicit lifecycle effects; inspect their exact contracts in the tool reference.

test_run may allocate scratch databases internally. Zero explicit testdb calls is not evidence that no test database was used. Preserve the returned database/runtime metadata and inspect cleanup. Unsupported replay adapters, incomplete fixtures and unbound application reads are gaps rather than green test results.

Always stop what you start: fixture_runtime_stop, scenario_stop and testdb_release. Use the corresponding cleanup/resource inspection tools after an interruption. Cancellation requests do not mean cleanup already finished; inspect execution state and unknown outcomes before considering the environment released.

1. Plan/validate before capturing or starting resources.
2. Freeze expectations before executing the application.
3. Observe and independently check effects.
4. Stop owned leases, record cleanup, and keep the reproducer in task memory or the workspace fixture.

![Reproduction explorer sample: declarations, captures and execution proof remain distinguishable.](../screenshots/sample-reproduction.png)

Reproduction explorer sample: declarations, captures and execution proof remain distinguishable.

**Related chapters:** [Case: an event succeeds for the wrong tenant](#case-tenant) · [Workspaces, regressions, patches and push](#verify-changes) · [Monitor work and effectiveness](#operations) · [Scripts, collections and long calculations](#automation)

<a id="verify-changes"></a>

## Workspaces, regressions, patches and push

Make the smallest change and prove the behavior on an explicit target.

**Outcome:** Produce a reviewable patch with actual red/green evidence.

**Before you start:** A writable checkout or context-only workspace, build capability and independent expectations.

### Choose memory or a checkout

Use contexts for notes/results when no code checkout is needed. workspace_open reuses the matching repo/ref in the current authenticated task across reconnects/restarts; fresh=true creates a separate checkout. Different task/principal scopes have separate lists; a stable X-DT-Story or story-bound token continues one task across chats. Reuse never pulls/resets. Inspect returned identity; workspace_list shows retained checkouts and last use. Idle cleanup preserves edits, local commits, context links and active builds; workspace_drop explicitly removes owned work.

Before writing tests, test_context reads the real target, chain, dependencies, style and edge mocks. test_data builds valid objects/dictionaries with agreeing IDs; generated skeletons are a starting point, not execution proof. Current test_run supports declared JVM selectors and explicit Node .test.js/.cjs/.mjs paths; old benchmark reports may describe earlier runner gaps.

workspace_write can perform compile checks and clear fixes. Review changes and suggestions before proceeding; fix=false requests reviewable suggestions rather than automatic fixes where supported. Do not confuse compilation success with business correctness.

**Inspect supported test targets** · `test_targets`

```json
{}
```

Expected: Reviewed placement, dependency/effect rules and capability gaps.

**Open the selected service source** · `workspace_open`

```json
{
  "service": "{{service}}",
  "env": "{{env}}"
}
```

Expected: A workspace/job and exact source identity; this creates local writable state.

### Make the regression sensitive

State independent expected values before copying observed output. Run against the original code and preserve the failing assertion. Implement the repair and rerun that same behavior. Include edge/negative cases that reject a relevant wrong implementation. Assertions that mirror a helper’s current output are weak evidence.

Choose mode=fast for supported short iterations and run mode=build for the final project build before review/push. Inspect counts, errors, skipped tests, logs, target placement and cleanup. No tests, all-skipped, unsupported target, timeout and cleanup-unknown are not passes. Differential checks compare exact types, ordering, errors and independently observed effects; normalization must not erase a business difference.

Keep the test selector, source identity, fixture hash and execution ID in context. test_run red/green proof belongs to the actual workspace/behavior history, not a screenshot of a green badge.

![Native test summary sample: first failure details, expected/actual and focused stack evidence.](../screenshots/sample-tests.png)

Native test summary sample: first failure details, expected/actual and focused stack evidence.

### Cover executable changes

workspace_coverage_plan identifies added/modified production lines against the workspace base or a selected base. No earlier project coverage is required. test_run coverage=true collects JaCoCo evidence for selected Maven/Gradle tests; workspace_coverage reopens missed lines, partial branches and source pins.

In the native coverage view, choose a file, toggle uncovered/all changed lines, prepare an editable source read, copy a regression briefing or download the complete JSON. Unknown mappings remain unknown. Editing production code, tests or build inputs makes the old result stale. Covered means executed; add assertions of observable entry-to-exit effects.

Lombok and annotation-processed modules use the project compiler for checks and fast iterations, so builders and generated sources are refreshed together. Generated-symbol diagnostics never cause speculative import auto-fixes. Coverage is opt-in; standard JVM production roots are supported, Node/custom roots remain a documented gap.

**Plan changed production lines** · `workspace_coverage_plan`

```json
{
  "workspace": "{{workspace}}"
}
```

Expected: Exact base SHA and candidate changed-line ranges; no test execution.

**Measure the selected regression** · `test_run`

```json
{
  "workspace": "{{workspace}}",
  "tests": [
    "QuoteTest"
  ],
  "coverage": true
}
```

Expected: Actual test outcome and changed-line/branch coverage, or an explicit unavailable reason.

**Inspect retained coverage gaps** · `workspace_coverage`

```json
{
  "workspace": "{{workspace}}"
}
```

Expected: Source freshness, missed changed lines/branches and an interactive file view.

### Patch versus push

workspace_patch exports the current diff and reports retained test proof without committing or publishing. Inspect the folder tree and selected file diff; remove unrelated files and review generated/compile-fix edits. A patch is useful even when pushing is not authorized.

workspace_push commits/pushes only when requested, to an allowed unprotected feature branch. It advances the workspace base and reports proof; it does not run or enforce tests. Protected main/master/release/default destinations are refused by this tool. A model should not infer push authorization from “investigate”. Direct repository maintenance by an operator is a separate workflow.

A clean commit does not establish deployment success. Report what changed, which tests actually ran, the target and material gaps. Retain the final patch/result links instead of pasting all changed files into chat.

![Patch renderer sample: folder hierarchy and one selected diff keep chat readable.](../screenshots/sample-patch.png)

Patch renderer sample: folder hierarchy and one selected diff keep chat readable.

**Related chapters:** [Contexts, nearby files and handoffs](#task-memory) · [Capture and replay a minimal failing state](#reproduce) · [Case: the bug hides in a shared library version](#case-library) · [Scripts, collections and long calculations](#automation)

<a id="api-browser"></a>

## From a browser action to an API check

Inspect requests, edit arguments/authentication and save reusable checks.

**Outcome:** Capture or prepare one request, explicitly send it and inspect the sanitized response.

**Before you start:** Configured HTTP allowlist; optional Playwright MCP and a reviewed browser interaction.

### Prepare a request without sending it

Open API explorer from Admin routes, an HTTP passport port or an API exchange. Select a route, fill the service base URL and typed path/query parameters, then inspect body/headers. A route without a known host needs an explicit base URL; the UI does not invent a live destination.

Optional named bearer profiles reference .env values and are bound to an exact origin/path scope plus the existing HTTP allowlist. The browser/model sees labels and readiness, not the token. autoPrefill=true explicitly enables automatic profile selection. No authentication remains selectable. A conflicting manually supplied Authorization header must be reconciled before using a profile.

Send executes the request, including mutations for non-read methods. Preparation and route selection do not send. Redirects are not followed, browser cookies are not transferred and saved exchanges are sanitized. Review status, timing, headers, body, route candidates, redactions and capture gaps.

**Find endpoints to prepare** · `api_routes`

```json
{
  "service": "{{service}}"
}
```

Expected: A route inventory with Open request links.

**Inspect optional bearer references** · `api_auth_profiles`

```json
{}
```

Expected: Labels/scopes/readiness only; no secret values.

![Interactive API explorer with a populated route inventory; request selection does not execute it.](../screenshots/ux-api-explorer.png)

Interactive API explorer with a populated route inventory; request selection does not execute it.

### Observe UI traffic, then reuse it

browser_sites/site_url discover configured pages. api_browser_open starts an isolated Playwright session and installs capture before navigation; api_browser_action inspects or interacts with it; api_browser_capture drains bounded exchanges. UI actions can mutate the application, so keep their scope intentional. api_browser_close releases the session.

Import HAR/network text with api_exchange_import when appropriate. Network listings can lack bodies/headers and retain metadata-only gaps. Static and observed API routes can have several candidate handlers; inspect ambiguity rather than selecting a convenient one. routes_learn/discover add evidence but do not prove a handler implementation was exercised.

api_request_prepare binds named path/query/header/JSON-body parameters. api_request_replay explicitly executes; api_request_save stores a normal script with parameter names and assertions. Named bearer references apply to explicit explorer replays; saved scripts retain the parameter-based credential contract. Never save cookies or captured credential defaults. Add independent assertions before promoting the request into a collection.

**Reopen captured traffic** · `api_exchange_list`

```json
{
  "limit": 10
}
```

Expected: Saved sanitized exchanges in the current story, not another user’s browser session.

**Related chapters:** [Explore a service and its surroundings](#services) · [Case: a cancellation looks undone in search](#case-stale) · [Scripts, collections and long calculations](#automation) · [Contexts, nearby files and handoffs](#task-memory)

<a id="automation"></a>

## Scripts, collections and long calculations

Turn a verified manual chain into a reusable bounded workflow.

**Outcome:** Reuse known checks while preserving parameters, assertions and cleanup.

**Before you start:** Working manual steps and intentional side effects; optional runner/browser dependencies.

### Reuse before authoring

script_list/script_get find existing workflows; checks exposes ready-made environment/service/table/trace/data-capture checks. Inspect what a script does before script_run. A failed or unavailable dependency must fail its check rather than masquerade as a successful assertion.

script_save stores ordered tool/script/browser/http/set/transform/js steps with parameters, variables and hooks. A context file containing JSON is not automatically a registered script. Expose a saved script/collection as a tool only when that interface is useful. Keep credentials as runtime parameters or configured secret references.

For several result transformations or long calculations, use code/code_start and nearby context files. Save compact intermediate results and a resumable plan rather than forcing every raw payload through the model. Inspect code runtime capabilities before choosing Node/QuickJS; arbitrary imported libraries or host access are not universal across engines.

**Find a reusable workflow** · `script_list`

```json
{}
```

Expected: Configured scripts and collections; inspect the selected script’s contract.

**First, create the calculation context** · `context_open`

```json
{
  "id": "{{context}}",
  "title": "{{ticket}} · handbook practice",
  "tickets": [
    "{{ticket}}"
  ],
  "summary": "Local handbook examples and saved calculations"
}
```

Expected: Run this once before the code example below. The default context ID is illustrative and private to this story.

**Run a small calculation beside task memory** · `code`

```json
{
  "code": "const xs = [2, 3, 7]; text({inputs: xs, product: xs.reduce((a,b) => a*b, 1)});",
  "context": "{{context}}"
}
```

Expected: A code/result view. This example calculates locally and does not call infrastructure.

### Plan a suite and read the failing case

collection_get/save configure a collection; collection_validate checks definitions; collection_plan expands selection/tags/datasets/matrices before running. Keep data rows bounded and record a deterministic seed when useful. Hooks and finally blocks must preserve cleanup even when an assertion fails.

collection_run executes the declared suite; collection_report/history/check explain per-case results, assertion failures, hook failures and cleanup. collection_cancel requests cancellation; inspect terminal execution/resource state afterward. Scenario-run and reproduction views answer different questions from a collection report—open the view that preserves the relevant evidence.

call_patterns can turn repeated investigation chains into draft scripts. Review generalized parameters and steps; accidental repetition is not a trustworthy business contract. Run scripts against representative inputs and independent expectations before relying on them for recurring checks.

![Collection report sample: select a case to inspect assertions, execution and cleanup separately.](../screenshots/sample-collection-report.png)

Collection report sample: select a case to inspect assertions, execution and cleanup separately.

**Related chapters:** [Contexts, nearby files and handoffs](#task-memory) · [From a browser action to an API check](#api-browser) · [Monitor work and effectiveness](#operations) · [Extend tools and result views](#extend)

<a id="extend"></a>

## Extend tools and result views

Add useful capabilities through supported contracts instead of hiding behavior in prompts.

**Outcome:** Create a scoped extension whose inputs, effects and output can be inspected.

**Before you start:** Administrator access for global configuration; reviewed code/configuration for extensions.

### Choose the smallest extension

Use a script for a repeatable composition of existing tools. Use tools.custom for a declarative SQL/HTTP capability with explicit arguments. Use a plugin when a new implementation is required. Add a result renderer when the output needs a clearer view, not a new tool that repeats existing behavior.

Config lives in config.json with ${VAR} references; secret values live in .env. Avoid absolute/user-specific paths in portable examples. Global configuration saves validate and activate a generation; existing calls finish on their captured snapshot. Reload tools after changes when required, then inspect the enabled registry and error list.

tool_profiles changes discovery sets, not permissions. Disabled tools should disappear from executable discovery. Keep descriptions concise: purpose, required identity and effects; put longer procedures in the handbook/workflow guides. Custom tools appear in this handbook’s live reference automatically, including their actual schema and origin.

**Inspect portable contracts** · `tool_contracts`

```json
{}
```

Expected: Versioned schemas and public contract URLs.

**Inspect one exact tool contract** · `tool_describe`

```json
{
  "name": "pg_query"
}
```

Expected: Required arguments/defaults and enabled implementation metadata.

### Add your first custom capability

For a declarative read-only SQL tool, merge the following tools.custom entry into your existing config.json. Keep the existing envs and connection references. Replace orders and sales.refunds with discovered database/table names. The :tenantId binding becomes a database parameter; do not concatenate SQL strings.

Save the configuration in Admin → Config, inspect validation/tool errors, then use Admin → Config → Tools → Reload tools if needed. Find refund_count in the live tool reference, inspect its schema and prepare a call with a real tenant. Availability does not prove the source table exists or that a live query succeeded.

For local code without a new dependency, create plugins/label-stats.js under DT_HOME with the second snippet. The plugin exports an array of tool definitions. Reload tools, describe label_stats and run the third example. Plugins execute trusted server-side code: review their effects and dependencies before installation. Use .env references for credentials rather than literal values.

After trying label_stats, remove its plugin file and reload tools; verify it disappears from tool_search and the live handbook. For refund_count, remove only that custom entry and save/reload configuration. These installation changes are global server configuration and require administrator access. view_save is the separate story-scoped renderer path described below.

**A tools.custom entry to merge into config.json**

```json
{
  "tools": {
    "custom": [
      {
        "name": "refund_count",
        "type": "sql",
        "description": "Count refund records for one tenant in the configured orders database.",
        "db": "orders",
        "sql": "select count(*)::text as count from sales.refunds where tenant_id = :tenantId",
        "params": {
          "tenantId": {
            "type": "string",
            "required": true,
            "description": "Exact tenant identity"
          }
        }
      }
    ]
  }
}
```

**plugins/label-stats.js · local plugin with no network or dependencies**

```javascript
module.exports = [{
  name: 'label_stats',
  description: 'Count characters and words in a supplied label; no network or writes.',
  input: { label: { type: 'string', description: 'Text to inspect' } },
  required: ['label'],
  run: ({ label }) => ({
    characters: Array.from(label).length,
    words: label.trim() ? label.trim().split(/\s+/).length : 0
  })
}];
```

**Describe the installed plugin, then run it**

```shell
node cli.js tool tool_describe '{"name":"label_stats"}'
node cli.js tool label_stats '{"label":"refund approved"}'
```

### Build a renderer that preserves evidence

view_list/get inspect built-ins and overrides; view_save creates a story-scoped custom renderer. A view is a sandboxed HTML fragment with a JSON metadata comment and optional sample. Its script receives DATA/META and dt helpers. Saved view pages cannot call tools or fetch arbitrary network data under their CSP.

Routine successful outputs should summarize compactly; failures should expose the first actionable detail. Use tables for rows, a folder tree for patches, source/path hierarchy for code and a selected-entity inspector for graphs. Keep raw output/export controls secondary and make all important selections keyboard-accessible.

Create a small synthetic sample that includes empty/error/long-value cases. Test the view in Admin and inline/mobile before replacing an established renderer. Label samples as presentation fixtures. A chart or screenshot does not certify backend behavior.

**Inspect native and configured renderers** · `view_list`

```json
{}
```

Expected: Descriptions and sample availability; actual templates may have story overrides.

**Save a practice renderer in this story** · `view_save`

```json
{
  "name": "handbook-label",
  "description": "Local practice label card; DATA is {label:string}.",
  "html": "<article class=\"card\"><h2 id=\"practice-label\"></h2><p class=\"muted\">Synthetic handbook practice</p></article><script>document.getElementById(\"practice-label\").textContent = String(DATA.label ?? \"No label supplied\");</script>",
  "sample": {
    "label": "Refund approved"
  }
}
```

Expected: Creates handbook-label in the current story. It renders supplied data and makes no API requests.

**Render the saved practice view** · `show`

```json
{
  "view": "handbook-label",
  "data": {
    "label": "Refund approved"
  },
  "title": "Local renderer practice"
}
```

Expected: Run Save a practice renderer first. Inspect the native card; remove the practice view from Admin → Views when finished.

### Use adapters and source integrations deliberately

tool_contracts and tool_describe expose transport/result schemas for optional adapters. Preserve versioned request/result identities, bounded execution, current authorization, cancellation and proof/gap semantics when swapping backends. Optional Joern Docker and Zoekt should improve a declared operation, with native search still available where supported. A new source needs an update strategy, version identity and observability, not just a successful first fetch.

**Related chapters:** [Complete live tool reference](#tool-reference) · [Every visualization: what to read and do](#visualizations) · [Monitor work and effectiveness](#operations) · [Discover requirements and publish explanations](#requirements)

<a id="operations"></a>

## Monitor work and effectiveness

Tell whether the tool chain is helping and debug slow, failed or stuck work.

**Outcome:** Use owned execution evidence and outcome-based checks instead of vanity metrics.

**Before you start:** A stable story and some actual tool/test history.

### Follow a call without starting it again

Runtime shows owned calls/executions, scheduler/resource state, metadata and active configuration. Jobs shows background parse/refresh/build/collection work. A returned job or cell ID is the handle to observe; use its inspect/wait tool rather than launching another copy. Admission, running, cancelling, draining and terminal states answer different questions.

execution_list/get and call_history reveal current steps, invocation errors and links; dt_log gives bounded operational logs; doctor checks local prerequisites. Cancel the specific owned job/execution/cell and observe cleanup. A cancelled request can have an unknown external outcome, and a successful call can still have failed assertions in its result.

metadata_list/get/edit lets you annotate owned records with labels/notes/tags and revision checks. An annotation is not permission to rewrite execution state. Config views distinguish the active generation from invalid candidates; do not assume an edited file is already active.

**Inspect owned execution activity** · `execution_list`

```json
{
  "limit": 20
}
```

Expected: Only visible executions in this story, with current states.

**Find failing work** · `call_history`

```json
{
  "failed": true,
  "limit": 20
}
```

Expected: Invocation/execution evidence; inspect actual tests and cleanup too.

**Check installation prerequisites** · `doctor`

```json
{}
```

Expected: Local capability findings and recovery suggestions; this does not fix remote business data.

![Runtime inspection with ownership, jobs and resources; earlier demo capture of the same operational surface.](../screenshots/admin-runtime.png)

Runtime inspection with ownership, jobs and resources; earlier demo capture of the same operational surface.

### Measure outcomes, cost and reuse

Start with a concrete effectiveness question: can a novice resolve a service boundary, can a model resume an investigation without re-querying, or does a regression reject the actual defect? Define success before the run and keep environment/source/input identities. Count completed tasks with verifiable evidence, not just successful tool calls.

The Self-context sample reports recent invocation count, error count and latency percentiles. Use these as local operational hints. Look for repeated identical searches, unnecessary all-source refreshes, large raw responses, repeated builds, missing indices and duplicated jobs. Prefer cached discovery, targeted refresh, retained generations, compact views and context reuse.

For model comparisons, keep the same tool/config profile, tasks, fixture revisions and budgets. evaluation_evidence inspects parent-recorded transcripts, signatures, artifact hashes, independent grades and mutation evidence. Do not paste a model’s self-grade into that evidence. Separate tool execution from external grading and synthetic fixtures from live runs.

Monitor assertion counts, red/green sensitivity, independently observed effects, unsupported operations, incomplete captures and cleanup failures. Review saved call patterns to automate repeated work. Keep a short effectiveness note in context: objective, baseline, observed change, cost, limitations and next experiment.

| Signal | Useful interpretation | Common misuse |
| --- | --- | --- |
| Invocation error rate | Which calls need diagnosis | Treating every ok=true as a solved user task |
| p50/p95 call latency | Where time is spent in this bounded sample | Claiming a representative production benchmark |
| Reuse of context/index generation | Avoided repeated investigation/fetch | Trusting stale findings without checking identity |
| Red/green + mutation sensitivity | Regression detects the relevant defect | Counting generated or skipped tests as passing |
| Cleanup and independent effects | The run left a known outcome | Calling a cancellation request a completed rollback |

**Inspect retained independent evaluation evidence** · `evaluation_evidence`

```json
{
  "limit": 10
}
```

Expected: Available parent-recorded runs or an empty inventory; no grade is invented.

**Related chapters:** [Dev-tool’s own operating context](#self-context) · [Indices, freshness and exact versions](#indices) · [Capture and replay a minimal failing state](#reproduce) · [Scripts, collections and long calculations](#automation)

<a id="visualizations"></a>

## Every visualization: what to read and do

A visual index of native results and standalone workbenches.

**Outcome:** Select the right view, find the first useful detail and preserve its evidence.

**Before you start:** All examples below are labeled built-in presentation fixtures.

### Read the summary, then the evidence

Successful transient chat results normally start collapsed. Open a result to inspect the relevant table, file, case or source path; failed tests/calls expose actionable detail. Editing and tool execution happen in authenticated workspaces, not saved snapshots. Use Open full view for more room, and More/Export for secondary formats.

#### workbench

Which contexts, services and tickets relate to this work? Switch retained navigator lenses, inspect selected identity and related items, then open the authenticated live workbench to edit files or explicitly run actions. The chat snapshot cannot query infrastructure or grant execution.

<details><summary>View labeled presentation example</summary>

![Built-in workbench presentation sample](../screenshots/sample-workbench.png)

</details>

#### workspace-coverage

Which changed lines and branches need a regression? Select a production file, inspect missed/unknown lines and source freshness, prepare an editable source read or coverage run, copy a regression briefing or export JSON. Covered lines prove execution, not assertions.

<details><summary>View labeled presentation example</summary>

![Built-in workspace-coverage presentation sample](../screenshots/sample-workspace-coverage.png)

</details>

#### ci

What happened to this exact build or PR commit? Inspect revision proof, checks, review comments, JUnit failures and gaps; resume the pinned wait or prepare an editable follow-up in Workbench.

<details><summary>View labeled presentation example</summary>

![Built-in ci presentation sample](../screenshots/sample-ci.png)

</details>

#### capabilities

What can I do with this object? Select a task, service, component or database; follow a question to a tool, inspect inputs and prepare an editable Workbench draft. The graph covers the current authorized registry; saved snapshots can age.

<details><summary>View labeled presentation example</summary>

![Built-in capabilities presentation sample](../screenshots/sample-capabilities.png)

</details>

#### project-context

What is already understood about this project? Choose a service and flow, inspect assumptions and exact source revisions, then read retained evidence files. Admins publish immutable changes.

<details><summary>View labeled presentation example</summary>

![Built-in project-context presentation sample](../screenshots/sample-project-context.png)

</details>

#### observability

Where did this operation wait or fail? Select a span, inspect its parent and lifecycle events, and export a content-free Perfetto snapshot.

<details><summary>View labeled presentation example</summary>

![Built-in observability presentation sample](../screenshots/sample-observability.png)

</details>

#### test-coverage

What was exercised and what is still missing? Choose a lifecycle edge or source file; inspect actual test-file provenance, missing lines, run scope and freshness.

<details><summary>View labeled presentation example</summary>

![Built-in test-coverage presentation sample](../screenshots/sample-test-coverage.png)

</details>

#### api-exchange

What was sent and returned? Read status/timing, request/response JSON and headers; open API explorer to prepare a new send.

<details><summary>View labeled presentation example</summary>

![Built-in api-exchange presentation sample](../screenshots/sample-api-exchange.png)

</details>

#### architecture

What connects, why and in which environment? Select an entity/edge, compare environment replicas and inspect source certainty before exporting.

<details><summary>View labeled presentation example</summary>

![Built-in architecture presentation sample](../screenshots/sample-architecture.png)

</details>

#### code

Where is the code? Navigate source hierarchy and bounded line excerpts; retain repository/revision and file:line.

<details><summary>View labeled presentation example</summary>

![Built-in code presentation sample](../screenshots/sample-code.png)

</details>

#### code-cell

What did the computation return? Read output/return/errors; inspect tests and owned calls, then resume the same cell ID if running.

<details><summary>View labeled presentation example</summary>

![Built-in code-cell presentation sample](../screenshots/sample-code-cell.png)

</details>

#### collection-report

Which case/check failed? Select a case and inspect assertions, hooks and cleanup; filter without losing selected evidence.

<details><summary>View labeled presentation example</summary>

![Built-in collection-report presentation sample](../screenshots/sample-collection-report.png)

</details>

#### diagram

What structure does this explain? Inspect labels/legend, zoom or open full view; rendered structure is still a declared claim.

<details><summary>View labeled presentation example</summary>

![Built-in diagram presentation sample](../screenshots/sample-diagram.png)

</details>

#### differential

What behavior changed? Inspect differing cases, exact types/ordering/errors and independently observed effects.

<details><summary>View labeled presentation example</summary>

![Built-in differential presentation sample](../screenshots/sample-differential.png)

</details>

#### impact

What might be affected? Inspect typed edges, source identities, bounded traversal and candidate tests; relevance is not execution.

<details><summary>View labeled presentation example</summary>

![Built-in impact presentation sample](../screenshots/sample-impact.png)

</details>

#### json

Which fields matter? Expand/collapse the tree, inspect null/empty values and copy only the needed subtree/result.

<details><summary>View labeled presentation example</summary>

![Built-in json presentation sample](../screenshots/sample-json.png)

</details>

#### knowledge-map

Which claims and sources are connected? Select entities, inspect provenance/confidence and reconcile filters before summarizing.

<details><summary>View labeled presentation example</summary>

![Built-in knowledge-map presentation sample](../screenshots/sample-knowledge-map.png)

</details>

#### list-diff

What was added, removed or retained? Read counts and filtered lists; inspect matching keys and retained value changes.

<details><summary>View labeled presentation example</summary>

![Built-in list-diff presentation sample](../screenshots/sample-list-diff.png)

</details>

#### passport-ports

Which service boundaries exist? Select graph/list evidence and follow authenticated editing links; detected, disabled and manual ports stay separate.

<details><summary>View labeled presentation example</summary>

![Built-in passport-ports presentation sample](../screenshots/sample-passport-ports.png)

</details>

#### patch

Which file/lines changed? Choose a folder/file, inspect one diff and preserve base/head, binary/deleted/renamed status.

<details><summary>View labeled presentation example</summary>

![Built-in patch presentation sample](../screenshots/sample-patch.png)

</details>

#### reproduction

What supports this reproduction? Inspect inputs, scope, versions, required reads, capture gaps and independent execution proof.

<details><summary>View labeled presentation example</summary>

![Built-in reproduction presentation sample](../screenshots/sample-reproduction.png)

</details>

#### scenario-run

Where did the scenario fail? Read outcome/target, select actions/assertions, inspect actual versus expected and cleanup.

<details><summary>View labeled presentation example</summary>

![Built-in scenario-run presentation sample](../screenshots/sample-scenario-run.png)

</details>

#### semantic-path-trace

Did the change alter the required path? Select value or local control evidence, inspect paired expressions and exact source, review explicit path assumptions, copy a regression briefing or export JSON/SVG/Mermaid. Static differences are not execution or behavior proof.

<details><summary>View labeled presentation example</summary>

![Built-in semantic-path-trace presentation sample](../screenshots/sample-semantic-path-trace.png)

</details>

#### semantic-flow-map

Where do control and data change from entry to exits? Select the call overview or a retained method, inspect decisions, assignments, argument bindings and source, trace inputs and export JSON/SVG/Mermaid. Static dependencies and unresolved exceptions are not runtime proof.

<details><summary>View labeled presentation example</summary>

![Built-in semantic-flow-map presentation sample](../screenshots/sample-semantic-flow-map.png)

</details>

#### semantic-analysis

How can this call/value travel? Navigate source paths/guards, filter/select results and read mode, coverage, proof and feasibility.

<details><summary>View labeled presentation example</summary>

![Built-in semantic-analysis presentation sample](../screenshots/sample-semantic-analysis.png)

</details>

#### table

Which rows answer the question? Filter/sort rows, inspect matching/total counts and use More for CSV/JSON exports.

<details><summary>View labeled presentation example</summary>

![Built-in table presentation sample](../screenshots/sample-table.png)

</details>

#### tests

What failed and where? Summary first; inspect first failing test, expected/actual, focused stack and executed/skipped counts.

<details><summary>View labeled presentation example</summary>

![Built-in tests presentation sample](../screenshots/sample-tests.png)

</details>

#### text-diff

Which lines changed? Navigate previous/next change and compare before/after identities and line numbers.

<details><summary>View labeled presentation example</summary>

![Built-in text-diff presentation sample](../screenshots/sample-text-diff.png)

</details>

#### xml

Which element matters? Read formatted hierarchy/source, wrap long lines and copy/download only what is needed.

<details><summary>View labeled presentation example</summary>

![Built-in xml presentation sample](../screenshots/sample-xml.png)

</details>

### Standalone workbenches

Passports combine service boundary graphs and detected/manual evidence; API explorer prepares and sends reviewed requests; Services map explores bounded relationships and editable tool inspections; architecture/dossiers add C4/environment/requirement views and exports. Logs/trace, PR, files, dashboard and showcase have their own explorers. Use the selected inspector before exporting or summarizing a large graph.

| Surface | Useful interaction | Keep in the answer |
| --- | --- | --- |
| Passport / port graph | Select a node; correct/add/hide/restore with source/reason | Exact source and correction provenance |
| Map / architecture | Expand prefix/environment, select entity/edge, inspect sources | Certainty, scope and unknowns |
| Logs / trace | Narrow time/service/trace, inspect selected line | Query/window and instance identity |
| PR / patch | Select file in folder tree; inspect line changes/comments | Base/head and actual test proof |
| Files | Browse, search, preview/download, archive to context | Store/path/revision and source-removal outcome |
| Showcase | One-service versions, impact, tests and evidence | Which sections were actually executed |
| API explorer | Edit parameters/auth/body; explicitly Send | Sanitized request/response and capture gaps |

**Related chapters:** [Complete live tool reference](#tool-reference) · [Extend tools and result views](#extend) · [Explore a service and its surroundings](#services) · [From a browser action to an API check](#api-browser)

<a id="tool-reference"></a>

## Complete live tool reference

Every enabled tool, its schema, origin, chapter links and editable examples.

**Outcome:** Find an exact capability and prepare valid arguments without memorizing names.

**Before you start:** Select the current profile/scope; unavailable tools remain an explicit capability gap.

### Search by task or exact name

The live reference is generated from the same enabled registry used by CLI, MCP, OpenAPI and the Admin scratchpad. It includes custom/plugin/script tools visible to the current user and exposes their exact input schema. Disabled/admin-only tools are not presented as executable to an unauthorized reader.

Search a task term, tool name or group. Select a tool to read its contract, required fields, defaults and operational effect label. Prepare an editable form, copy exact JSON/CLI, or run intentionally in this story. The handbook does not bypass normal authorization, validation, rate limits or configured HTTP scopes.

The portable repository reference records built-in tools at generation time. The running registry remains authoritative for extensions and permissions. A required field can still need a real returned ID; blank values or an invented analysis/lease/workspace ID are not useful arguments.

The [complete built-in reference](tools.md) contains 252 tools with exact schemas. In the app, the reference uses the current authorized registry and includes configured extensions.

### When a tool is missing

Use tool_search/tool_describe/tool_profiles to discover alternatives. Check Config’s enabled/disabled groups and Runtime’s registry generation. Ask an administrator to configure a missing dependency rather than retrying a forbidden capability. Consult workflow_plan for staged prerequisites; a guide proposes work and never authorizes it.

**Related chapters:** [Your first investigation](#start) · [Extend tools and result views](#extend) · [Monitor work and effectiveness](#operations)

<a id="glossary"></a>

## Glossary and common mistakes

Decode the identities and proof terms used across the workbench.

**Outcome:** Resolve terminology without losing the investigation thread.

**Before you start:** No prerequisites.

### Working vocabulary

These terms have operational consequences; record exact identities when handing work to another person or model.

| Term | Meaning |
| --- | --- |
| Context / memory | Durable indexed task folder, independent of Git checkouts |
| Workspace | Writable source/task working directory with its own change/test history |
| Story / chat/task scope | Private investigation boundary within an authenticated principal |
| Passport / port | Static service description / typed boundary; manual overlays stay declared |
| Revision / SHA / revisionKey | Document/file compare-and-swap (CAS) identity, Git source identity, and exact retained source index key |
| Analysis / generation / revisionSet | Retained semantic projection and exact selected source/dependency identities |
| Cache / live observation | Prior metadata/result versus a query made at a recorded time |
| Declaration / static / observed / proved | Different evidence strengths; never silently convert one into another |
| Job / execution / code cell | Background handle / owned invocation lifecycle / resumable computation |
| Fixture / template / lease | Captured inputs / immutable scratch base / owned temporary runtime allocation |
| Red-green / green-only | The same behavior failed before and passed after / only a passing candidate run is known |
| Unknown outcome | The system cannot establish completion/effects/cleanup, even if a request ended |
| CAS · compare-and-swap | Write only when the observed revision still matches; a conflict preserves the current data |
| CPG · code property graph | Joern’s combined source/AST/control/data-flow representation; coverage and proof limits still apply |
| Profile | Model tool-discovery set; distinct from an authorization role |
| Execution target / runner | Declared placement and dependencies for a test / the worker that executes it |

### Short recovery paths

Empty find → check environment/cache presence, then refresh the missing source. Missing Joern → inspect capabilities and retained analyses; use native code search while preserving the gap. Stale edit → reread revision and reconcile the draft. Wrong import → inspect internal class ownership and resolved artifact/version.

API cannot send → check base URL, placeholders, optional bearer selection and HTTP allowlist; do not paste secrets into notes. Job appears stuck → inspect the same handle, step and prerequisites before cancelling. Test looks green → verify executed assertions, target, skips, cleanup and independent effects.

Huge output → narrow the query, use summaries/search/views and save bounded evidence in context. A beautiful graph with missing sources → inspect certainty/gaps and add only evidence-backed declarations. “Latest” source with an old deployment → resolve and pin the actual version first.

**Related chapters:** [Your first investigation](#start) · [Indices, freshness and exact versions](#indices) · [Monitor work and effectiveness](#operations)

<a id="observability"></a>

## Trace work and inspect test coverage

Follow owned work across tools, workers and runners, then inspect exact coverage gaps.

**Outcome:** A content-free trace and source-matched coverage evidence with explicit limits.

**Before you start:** Choose the intended chat/task in Admin Runtime.

### Find model traffic and failed responses

Open Admin → Runtime → Requests & models. Filter the retained journal by time, task, tool/model or outcome, then inspect a row for purpose, latency, HTTP status, reported usage and execution/result links. Counts and p95 cover the matching window, independently of paging. An application/test failure is distinct from an invocation failure. Missing usage is unknown.

Model helpers include context hints, Admin suggestions/interpretations and documentation processing. Direct Open WebUI → GPUStack traffic is invisible unless that connection uses the explicitly enabled /model/v1 gateway; see docs/observability.md for setup. The journal stores metadata without prompts, SQL or response text. Diagnostic traces remain a separate opt-in. Inline event views are snapshots whose filters apply only to displayed rows.

**Inspect model capacity responses** · `observability`

```json
{
  "mode": "events",
  "kind": "model",
  "outcome": "capacity"
}
```

Expected: Retained observed HTTP 429/503/529 responses, not a diagnosis of provider overload.

### Trace this chat

In Admin → Runtime → Traces & observability, enable tracing explicitly, run a tool and refresh. Other chats remain unchanged. Inspect a span’s parent, execution ID, outcome and lifecycle events. Open spans and interrupted producers keep their unknown end; durations include waits.

The observability tool embeds the same explorer in Open WebUI. Export Perfetto JSON without stopping work. Local SQLite capture needs no collector; optional OTLP/HTTP JSON export is configured by the operator. Arguments, outputs, SQL, credentials and error messages are excluded.

**Inspect this chat trace** · `observability`

```json
{}
```

Expected: A bounded content-free diagnostic snapshot; tracing must already be enabled.

### Inspect executed coverage

Run npm run build, npm run test:coverage, then npm run build. Open Runtime → Test coverage or call test_coverage. Check source freshness, full-suite versus selected-file scope, and test failures first.

Select a lifecycle edge for actual test-file provenance and rejected-transition observations. Green means an edge executed in a passing test file; it does not prove every guard or assertion. Select Source files for missed executable lines and source inspection. Never-loaded files are explicitly unmeasured; browser evidence is separate.

**Read test coverage** · `test_coverage`

```json
{}
```

Expected: A source-digested report or an explicit missing-report state.

**Related chapters:** [Monitor work and effectiveness](#operations) · [Workspaces, regressions, patches and push](#verify-changes)

<a id="project-knowledge"></a>

## Build shared project understanding

Reuse versioned service maps and evidence across tasks without losing assumptions.

**Outcome:** A source-pinned project index and an outside-in regression design.

**Before you start:** A readable service passport or reviewed findings.

### Read before investigating

Use project_context_find by project, repository, service or finding. Read project_context_get at the returned revision and compare each source SHA with your workspace. Global knowledge is declared, untrusted evidence; task progress remains private in context_* folders.

knowledge_search and knowledge_graph include published project understanding. Historical quotes remain verifiable with source=project-context and the exact publication revision.

**Find shared understanding** · `project_context_find`

```json
{
  "query": "{{service}}"
}
```

Expected: Shared publications, authors and source identities.

**Inspect the document template** · `project_context_get`

```json
{}
```

Expected: Typed service entry/exit/flow structure, publication policy and storage limits.

### Preserve a useful finding

Admins publish with project_context_save: id, expected_revision from the last read, reason, and a complete document or file changes. New projects use expected_revision=null. Everyone can read. Readers can keep a proposed change in private task memory.

Import an owned architecture_service result using dossier= to retain its full JSON and PlantUML paths. Its compact index keeps source pins, assumptions and gaps. Joern paths remain specific local evidence, not end-to-end runtime proof. Save screenshots as base64 and scripts/queries as inert files, or promote a reviewed context file with from_context and its exact revision.

Each revision pins a file inventory. Archive moves only the current inventory path; historical files survive. Restore publishes an old inventory as a new revision with a new reason and current expected_revision. Storage limits reject new publication while preserving retained history.

### Test from the entry to observable exits

Start from the independently expected business outcome. test_context defaults to public callers of a requested class; choose a relevant entry when several candidates exist. Keep the real service and internal-library chain. Inspect integrationPlan and its proof limits.

Assert responses and externally meaningful table, topic, API or Elasticsearch effects, including negative paths and duplicate/failure behavior. Current flow skeletons use boundary doubles. For real SQL/transaction claims use an owned scratch PostgreSQL lease; for wire/broker claims use isolated transport fixtures. flow=false or strategy=unit explicitly selects narrow unit isolation. Never equate mocked repository/producer calls with database or delivery proof.

**Related chapters:** [Contexts, nearby files and handoffs](#task-memory) · [Workspaces, regressions, patches and push](#verify-changes) · [Explore a service and its surroundings](#services)

<a id="ci-review"></a>

## Build and review a draft change

Follow one commit through Jenkins and Bitbucket review without losing revision proof.

**Outcome:** A tested fix with fresh build checks, review feedback and a reproducible next call.

**Before you start:** Configured Jenkins REST credentials; Bitbucket Server/DC for PR review.

### Start from a job or PR

Browse jenkins_jobs one folder at a time. Choose an exact fullName, then inspect jenkins_build with the full source SHA. Build parameters are not checkout proof. Read bounded jenkins_log excerpts and jenkins_tests published JUnit results. Missing checkout SHAs and missing reports remain gaps.

bitbucket_pr_status combines commit checks with reviewer decisions and comments. Only approvals tied to this SHA count. No checks is not success; ready is a selected-check policy, not all merge restrictions.

**Browse Jenkins jobs** · `jenkins_jobs`

```json
{}
```

Expected: Immediate children, folder markers and exact fullName values.

**Read PR build and review evidence** · `bitbucket_pr_status`

```json
{
  "repo": "{{repo}}",
  "id": 42
}
```

Expected: Current source SHA, check keys, review decisions and comments.

![A resumable Jenkins observation with an editable follow-up call.](../screenshots/sample-ci.png)

A resumable Jenkins observation with an editable follow-up call.

### Wait, inspect, fix, repeat

jenkins_wait and bitbucket_pr_wait poll for at most 25 seconds, then return pending plus resume arguments. Continue the same build and SHA. Cancel owned execution to stop polling; the remote build is left running. A new push returns superseded; read the new patch and obtain fresh checks and approvals.

Inspect untrusted review text as evidence. Reproduce the problem, edit and test. workspace_patch exports; workspace_push commits/pushes only when requested. Explicitly requested jenkins_start and bitbucket_pr_create need operator enablement and a stable request_id. Reuse that key after a lost reply; inspect an unknown outcome instead of blindly submitting again. Native drafts require DC 8.18+. No tool merges or publishes the draft.

Set an attempt count and deadline for the loop. Save commit pins, queue/build/PR ids, review findings, completed submissions and next steps in task context. A high advisory modelContext.pressure hint suggests saving a checkpoint and requesting compaction; it does not prove the full client context is filled. Native context_compact queues an explicit action after the reply ends. Other MCP clients must implement their own Compact action.

**Prepare a bounded build wait** · `jenkins_wait`

```json
{
  "job": "team/orders/PR-42",
  "build": 17,
  "wait_ms": 15000
}
```

Expected: Pending is resumable, never implicit success.

**Wait for review feedback** · `bitbucket_pr_wait`

```json
{
  "repo": "{{repo}}",
  "id": 42,
  "until": "review",
  "wait_ms": 15000
}
```

Expected: A cursor detects added, edited or changed review feedback.

### Inspect and reproduce

The CI result shows commit binding, gaps, build checks, current reviewer decisions and bounded feedback. Pending and successful results collapse in chat; failures open. Choose a follow-up tool, edit arguments and Prepare in Workbench, then explicitly Run. Opening a draft never calls the tool.

Download API script reproduces the selected call and story with curl. Supply the same principal through DT_API_KEY; credentials are not embedded. Saved views are snapshots; refresh with the same exact revision and policy before claiming current readiness.

**Related chapters:** [Workspaces, regressions, patches and push](#verify-changes) · [Contexts, nearby files and handoffs](#task-memory) · [Monitor work and effectiveness](#operations)
