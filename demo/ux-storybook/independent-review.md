# Independent UI/UX assessment

Assessment A: source and live-browser review, independent of detector output. Reviewed 6 November 2026 against the disposable fixture at `http://127.0.0.1:4984`. No production UI edits, saved corrections, task edits or script saves were made. Opening tools generated ordinary read-call history. The fixture's sparse index and empty scripts list limit claims about realistic scale. Mobile, screen-reader and long-running cancellation behavior were not tested.

## Verdict

The UI is capable and often carefully honest about evidence. The main opportunity is to connect the existing capabilities into complete investigations. The interface exposes a registry and several specialized workspaces; a novice must still translate a task into tool names, move evidence between those workspaces, and assemble a handoff manually. This is an interaction problem more than a need for a new visual identity.

The restrained Operate design fits a developer utility. Data density is justified in service boundaries, request/response inspection and source details. It is less justified when a task chooser becomes a tool registry or repeated UUID rows dominate progress.

## Three user goals

| Goal | Assessment | Evidence |
|---|---|---|
| Discover intent and find the right capability | Partial | Useful navigation groups, descriptions and a Field guide exist. The open-ended intent prompt is four decisions deep: Context → select/create task → Tool scratchpad → goal. Its default suggestions are a text list, not a next action. |
| Understand results, progress, immediate feedback and errors | Generally good in specialized views; fragmented during execution | Reproduction view announces gaps and bounds. API exchange gives status, timing and request/response. Port saves preserve drafts on error. Script Run shows only “Running…” locally, with richer execution information elsewhere. |
| Reproduce and share links, queries, screenshots and complete scripts | Partial; highest cross-surface gap | Legacy results retain query/env/time and copy/export. API exchange supports a prepared-client link and sanitized download. Task/file/script selections do not become shareable URLs in the ordinary UI, and there is no visible complete-investigation handoff action. |

## Priority findings

### P1 — An intent prompt produces a registry excerpt instead of a practical next step

**Observed:** In the seeded checkout task, I entered “Find why refunds fail for checkout and inspect the code that writes the refund table” with the default model checkbox off. Suggest tools returned eight lines of tool names and descriptions, including `pg_query`, `pg_table`, `find`, `code_search`, `code_symbols`, `code_read`, `dt_log` and `testdb_template_inspect`. The tool selector remained `find`. Descriptions were cut to 150 characters and appeared in a monospace box with horizontal clipping at a 1280×720 viewport. There were no candidate selection buttons or an explanation of the suggested order. The dropdown itself contained more than 200 tools.

**Implication:** A novice still has to infer “find exact table → inspect usage → open method”, type or remember a tool name, and transfer arguments. This is a material failure of recognition, even though the system does possess the capabilities.

**Source:** `web/admin-context.js:56–61` deliberately renders candidates as text and only prepares a tool when an optional model suggestion is returned. `web/admin-context.js:80` loads the full registry. The structured argument form is a useful existing base.

**Recommendation:** Show two or three task candidates with “why this helps”, expected evidence, required identifiers and a Prepare action. Offer “Find the exact table” as a concrete first move. Keep manual tool filtering and exact JSON accessible.

### P1 — Correcting a finding is supported, but verifying the right correction still requires leaving the finding

**Observed:** Passport → Edit boundary graph → select `?order` opens a real editor for the topic, source file/line, handler, mappings and reason. It offers Save correction, Cancel draft and Hide false detection. The exact repository/revision and distinction between detected evidence and manual declarations are clear. However, the source file and line are editable fields; the actual source is not shown and there is no prepared “inspect this source” action. The provenance disclosure reveals a JSON record with the source method `publisher.send`.

**Implication:** A nearby model miss is editable, but the user cannot resolve it confidently in place. The novice needs to discover `code_read` or navigate to another code workspace and re-enter the revision/path/line.

**Source:** `web/port-editor.js:19–24` builds the inspector; `web/port-editor.js:34` provides strong revision-checked save and preserved-draft error handling.

**Recommendation:** Pair the existing correction form with read-only source lines at the exact revision, a plain-language “detected target / reviewed target” comparison, and one-click source navigation. Preserve the existing provenance, history and scope rules. This is an extension of a good editor, not a replacement.

### P1 — Users can save fragments, but cannot visibly assemble a complete handoff

**Observed:** Opening the seeded context left the URL at `/admin#context`; selecting a file also does not update it. Source supports incoming `?context=&file=` parameters, but the ordinary selection path does not emit them. A new script has Steps, Params, Vars & scripts and JSON, but no Copy link / Export complete script / Import handoff controls. Script collection settings explain inherited vars and before/after hooks, which are separate from a script's JSON. The generic table result has filter, count and visible JSON/CSV downloads but no displayed query/environment/run metadata. Legacy `/view` does show query, environment, time and copying.

**Implication:** Pasting the address bar may point a colleague to the workspace rather than the selected task, file, draft or evidence. Copying a single script JSON may omit inherited behavior. A screenshot can document a result but does not communicate how to reproduce it. This does not mean replay/packaging capabilities are absent from the backend; the UI does not present a clear end-to-end handoff path.

**Source:** `web/admin.html:666–672`, `web/admin-context.js:83–86,110–126`, `web/admin-scripts.js:293–316`, `web/views/table.html:2–11`, and `web/view.html:268–281`.

**Recommendation:** An investigation-level Share / Prepare handoff surface should gather selected evidence, exact tool arguments and environment, query text, retained source revision, correction scope, screenshots and an editable complete script. Clearly distinguish “open saved evidence” from “run again”. A manifest should identify dependencies and missing inputs before export. Do not describe a replay as complete merely because a JSON file downloaded.

### P2 — Progress and recovery details are rich but disconnected from the action that started them

**Observed/source-backed:** Runtime exposes explicit states, scope, durations, child executions, traces and cancellation semantics. In the fixture it also showed many identically named `show` rows and long UUIDs. In contrast, `runScript` updates its local output to only “Running…” and awaits a single response. It does not offer a local execution link, elapsed time, current step or cancellation control (`web/admin-scripts.js:477–488`). Context disables its entire panel and changes the clicked button to “Working…” (`web/admin-context.js:89–93`), while its output panel is inside a disclosure created by `web/admin-ux.js:16`.

**Implication:** A slow call creates an emotional valley: “is it doing anything, can I leave, where is the error?” The richer Runtime view helps an expert who knows where to look, but its raw call list adds translation work.

**Recommendation:** Place a compact persistent execution strip next to the initiating control: current step, elapsed time, saved evidence status and Open execution. Show Cancel only where actually supported. Show the failed step and a prepared retry retaining arguments; do not require rerunning a successful call just to recover a save failure.

### P2 — The default entry screen is maintenance-oriented

**Observed:** A new `/admin` opens Index under Operate, with Refresh everything as its primary action, despite Investigate being the first navigation group. There are sixteen peer workspace destinations. The fixture's index is empty and accurately says what is unconfigured. It does not propose a task-oriented starting point from retained passports/context.

**Implication/inference:** A first-time tester can infer that configuring or refreshing infrastructure is required before investigating, even when retained evidence is available. Existing administrators may appropriately prefer Index.

**Recommendation:** Offer a modest “What are you trying to understand?” start/resume entry, recent task and service shortcuts, and retain Index for administration. Do not add a forced wizard or replace the useful catalog.

## Strengths to preserve

- The passport editor already supports adding missed connections, correcting targets, hiding false findings and preserving detected evidence. Scope and revision provenance are unusually explicit.
- Reproduction capture says “Capture has gaps”, names the bounded Kafka scan and shows independent observation timestamps. This communicates uncertainty more usefully than a generic success badge.
- API exchange presents method/URL, status, time, handler and request/response; it offers Open API explorer, Copy API client URL and Download sanitized exchange. This is a strong pattern for other result types.
- The simple table has understandable shown/matching/total counts, filtering, sorting and visible-data exports. The legacy result viewer's query and environment metadata should be retained.
- Scripts expose real editable steps, parameters, collection defaults, hooks and exact JSON. Users are not trapped in an opaque model output.
- Navigation descriptions, explicit environment/scope and keyboard tab behavior are credible incremental improvements; a visual redesign is not the first priority.

## Heuristic score (A only, qualitative)

| Heuristic | Score / 4 | Reason |
|---|---:|---|
| Visibility of system status | 2 | Strong execution model; local initiating screens expose less. |
| Match to the user's world | 2 | Concrete services/tables/requests, alongside registry and engine terminology. |
| User control and freedom | 3 | Real editable drafts, cancel draft, overlays, history; cross-screen replay still fragmented. |
| Consistency and standards | 3 | Restrained product UI, some share/provenance/action inconsistencies. |
| Error prevention | 3 | Explicit send, required citation, revision checks, draft protection. |
| Recognition rather than recall | 1 | Many tools and workspaces; intent suggestions do not prepare default candidates. |
| Flexibility and efficiency | 3 | Manual forms, JSON, scripts and exact tool access. |
| Aesthetic/minimalist design | 3 | Appropriate restraint; registry excerpts and UUID lists create local overload. |
| Error recovery | 2 | Good editor preservation; raw messages/indirect progress in other paths. |
| Help and documentation | 3 | Field guide and contextual copy exist; starting from intent remains hard. |
| Total | 25/40 | Significant workflow improvements; solid components. |

No timing claim or score is a usability study. No detector results informed this assessment.

## Two recommended prototypes

### 1. Investigate and correct one uncertain finding

Use the checkout `?order` Kafka boundary as the concrete case. Start with a short user goal, offer prepared “Inspect detected boundary” and “Read source at this revision”, then present the finding graph/list beside evidence and correction. Include a brief execution strip and save outcome. Show detected fact, unresolved assumption and reviewed correction as distinct states. Let a user edit the topic manually, provide a reason and compare before saving.

Why: This tests the largest gap between possessing analysis tools and helping a novice use them. It exercises discovery, explainability and human correction in one bounded story. Success means a first-time tester can locate the source, identify the near miss and prepare a justified correction without knowing tool names. It should reuse the incumbent editor and typography.

### 2. Prepare a reproducible investigation handoff

Start from a completed or partially completed investigation. Select evidence and add a note; preview exactly what the colleague receives. Provide separate actions for saved-result link, query copy, screenshot, complete editable script and a bundle with a manifest. Show environment, source revision, parameters, inherited collection hooks, auth references and unresolved dependencies. Let the recipient inspect saved evidence without executing, and open the script to edit inputs before an explicit run.

Why: This tests whether the investigation survives leaving its current chat/browser. Existing copy/download mechanisms are useful fragments; a cohesive handoff makes them reliable. Success means another person can understand the conclusion, inspect its evidence and prepare the same run without reconstructing hidden context. Screenshot export should include a concise evidence caption, not substitute for machine-readable context.

Questions skipped: This is a delegated independent assessment for parent synthesis; prototype direction and user follow-up belong to the parent.
