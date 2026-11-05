# UI and workflow review

Reviewed 2026-11-05 against the current Admin and result renderers. The review separates the user-flow assessment from browser and interaction evidence. Both reviewers inspected source and existing screenshots independently; the live fixture uses indexed Java with synthetic infrastructure, documentation and semantic projections. The optional Impeccable detector could not load its release verification metadata, so findings use source and browser evidence rather than a claimed automated design score.

## Assessment evidence

Independent user-flow assessment: **22/40** across ten Nielsen heuristics. The technical assessment rated the initial interaction coverage **11/20**. The baseline browser batch visited 25 surfaces at desktop and mobile widths without uncaught page errors or document overflow; its failures were behavioral: lost keyboard focus after redraws, missing keyboard entry points, weak contrast in dark primary buttons, disconnected API workflows and JSON-only port editing.

The file-projections UI was inspected at `4e448e6`: its `src/ui/trace.js` supplies project/symbol-first tracing with symbol suggestions, while `src/ui/graph.js` and `src/ui/index.html` separate graph/table lenses and selected-node source/assumption inspection. The rework adapts these interaction patterns while retaining the vendored runtime and exact source generations.

## Direction

Keep the restrained light/dark developer workspace. Make the selected task, environment, source revision and next useful action visible. Use a navigation rail for Admin, focused workspaces for memory and code exploration, and a consistent inspector beside graphs. Prefer structured fields for routine work; keep JSON, export formats, schemas and diagnostics in disclosures. Successful transient chat results stay compact; failures and architectural evidence remain discoverable.

## Priority findings

1. **Routine actions require implementation knowledge.** Port corrections, Joern source/sink selection and scratchpad use frequently start with tool names and JSON. Add task-oriented forms while preserving the exact arguments for advanced users.
2. **Navigation hides the product's main capabilities.** Fourteen peer tabs compete equally; the services map is inside Context. Group navigation by investigation, work and operations, and give the map its own workspace.
3. **Memory has no clear working mode.** Files, metadata, model suggestions and tool execution form one long page. Provide Files, Tool scratchpad and Saved results views; keep the active task and unsaved state visible.
4. **Evidence is visible but difficult to act on.** Passport graphs only scroll to tables; API route rows cannot open requests. Add graph-selected port editing and request preparation from routes, ports and exchanges.
5. **Controls and feedback vary across pages.** Mouse-only selection, long hashes, raw payloads and fleeting toasts add friction. Standardize focus, tab semantics, status regions, compact identities, native previews and disclosure behavior.

## Admin surface inventory

| Current tab | What the user needs to see and do | Baseline friction | Rework |
| --- | --- | --- | --- |
| Index | Know freshness, refresh one source, inspect failed refresh jobs | Refresh actions precede purpose; dense equal-weight controls | Task heading, clear primary refresh, source states and keyboard-accessible job links |
| Explore | Find an object and understand its definition and users | Mouse-only catalog rows; selection and empty states are weak | Labeled search, keyboard selection, clear detail placeholder |
| Passports | Find a service, inspect its boundaries, correct missing/false ports | Build form dominates; graph is navigation-only | Service heading, direct graph editor, source/revision and correction provenance |
| Context & scratchpad | Resume a ticket, read progress, edit files and run tools with saved evidence | Long editor pushes tool use below the fold; generic raw previews | Task memory workspace with Files, Tool scratchpad and Saved results subviews |
| Scripts | Find, edit and run a reusable workflow | JSON-heavy editor; collection purpose is unclear before selection | Task introduction, visible selection and structured tool entry points |
| Sites | Configure URLs, links and secret names for browser tasks | Configuration terms dominate; no bridge to request exploration | Explain browser navigation vs API requests; preserve secret-name-only behavior |
| API routes | Pick a route, fill parameters/auth and explicitly send a request | Inert rows; client exists elsewhere without a bridge | Open in API explorer from every route; no implicit execution |
| Views | Preview and edit result renderers | Product users can confuse templates with saved results | Explain renderer templates; keep preview and source distinct |
| History | Inspect evidence and turn repeated work into scripts | Logs and repeated patterns compete for attention | Investigation heading, grouped workflows, compact arguments |
| Runtime | Debug ownership, running calls, resource use and cancellation | Many diagnostics are visible before selecting an execution | Preserve execution inspector; collapse advanced system metadata |
| Architecture | Read shared knowledge, collect service dossiers, publish reviewed changes | Collection and publication compete; JSON structure is prominent | Clear read/collect/edit paths, publication scope and evidence guidance |
| Semantic & ports | Select retained source, find a symbol, trace callers/value paths and correct ports | Full hashes and JSON-first operations; initial URL scope can diverge from prepared arguments | Joern task workbench, symbol selectors, concise generation identities, graph port forms |
| Jobs | See active/failed work, select a log, cancel and inspect output | Click-only table rows; no task explanation | Keyboard selection, status introduction, clear cancellation/outcome |
| Config | Safely inspect and save configuration | Large document editor without enough save-state context | Explicit configuration purpose, unsaved-draft protection and accessible status |
| Services map (currently inside Context) | Find a service family, inspect evidenced edges, run tools and record corrections | Hidden entry point; dense overview; argument editing and scope are separated | Dedicated workspace, selected-service inspector and guided inspection actions |

## Inline renderer inventory

All twenty built-in templates are included, together with standalone passports, maps, architecture, logs, PR/diffs, table results and the API explorer. Saved inline results remain read-only snapshots; editing and request execution open an authenticated workspace.

| Renderer | User's question or action | Required presentation and interaction |
| --- | --- | --- |
| api-exchange | What was sent, what returned, and how do I try it? | Status/timing first; request/response tabs, redactions and gaps; Open API explorer |
| architecture | What connects, why, and in which environment? | Interactive graph, evidence inspector and focused service/flow view; exports under More |
| code | Where is the relevant code? | Source hierarchy, line locations, readable excerpt and bounded search |
| code-cell | What did the computation return? | Useful output summary when collapsed; errors remain prominent; full logs optional |
| collection-report | Which checks passed or failed? | Compact successful summary, failed checks first, inspect evidence per check |
| diagram | What structure or flow does this diagram explain? | Diagram-led layout, visible labels, zoom/export without toolbar clutter |
| differential | What changed between two executions? | Expected/actual or before/after focus; inspect only differing cases first |
| impact | What could this change affect? | Typed relationships, source evidence and uncertainty; searchable affected objects |
| json | Which fields matter in this structured result? | Expandable tree, copy/download secondary, clear empty/null values |
| knowledge-map | Which claims and sources connect these entities? | Graph/table views, source and confidence inspector, no inferred runtime proof |
| list-diff | What was added, removed or retained? | Counts first, filters secondary, manageable long lists |
| passport-ports | Which typed boundaries are detected or declared? | Type/source filters, graph overview and authenticated edit link; disabled/history separate |
| patch | Which file and lines changed? | Folder tree, single selected diff, search; no full-file wall in chat |
| reproduction | What evidence supports the reproduction? | Scenario, steps, assertion outcomes and source gaps; distinguish execution from planning |
| scenario-run | Where did this scenario fail? | Current state and failing step first, expandable successful steps |
| semantic-analysis | How does this value or call travel through code? | Source/path navigation, selected-node inspector, guards and proof labels; no runtime claim |
| table | Which rows answer the question? | Readable headers, sorting/filtering, responsive scroll; exports under More |
| tests | What failed, and where should I fix it? | Summary on success, first failure expanded, expected/actual and focused stack |
| text-diff | Which text lines changed? | Before/after identity, line numbers, controlled expansion and copy |
| xml | Which document element matters? | Source/tree view, readable nesting, copy/download secondary |

## Requested feature contracts

- **Port CRUD in the graph:** select a typed port, edit its boundary/source/mappings in the adjacent form, add missing ports, hide false detections, restore detections and remove manual declarations. Require a reason and the current adjustment revision. Retain source detections and immutable correction history; show conflicts without discarding the draft.
- **Joern interaction:** use file-projections' project/symbol-first trace pattern, graph/table choice and source/assumption inspector. Reuse dev-tool's retained exact-generation queries; no external UI dependency or unrestricted Scala execution. Readiness, parse jobs, cancellation, proof and gaps remain visible.
- **Interactive APIs:** route, HTTP port and exchange links open a prepared editable request. Sending is explicit. Optional named bearer profiles resolve `.env` references on the server, are bound to configured URL scopes, and expose labels/readiness rather than token values. No-auth remains available; automatic selection is an explicit configuration choice.
- **Memory/tool use:** keep the active ticket and saved files discoverable, provide schema-based inputs plus advanced JSON, render native tool results, and retain run arguments/results in the selected context.

## Validation plan

Exercise every tab and renderer at desktop and mobile widths in one batched inspection, fix the observed defects in one batch, then confirm once. Cover keyboard selection, accessible labels, empty/error/loading states, draft preservation, source revision conflicts, read-only embeds, port CRUD and API authentication scope. Run the build, focused behavior tests and complete test suite. Capture representative demonstration screenshots and record fixture limitations with the results.

## Implemented rework

- **Admin:** fifteen areas grouped into Investigate, Work and Operate, with task headings, environment context, keyboard navigation, consistent focus/contrast and configuration draft protection. Services map has its own area; existing deep links remain usable.
- **Task memory:** Files & progress, Tool scratchpad and Saved results modes. Routine tool arguments have schema-driven fields; JSON and full capture payloads are secondary. Native results reopen from saved evidence through the existing draft-aware/versioned file reader. Reusing a preview keeps its frame loaded; selecting another context clears prior previews.
- **Passport boundaries:** both authenticated passports and Joern & ports provide graph/list selection with an adjacent typed editor. HTTP routes, Kafka topics, database targets, schedules, source handlers and field mappings can be edited. Missing ports can be added, false detections hidden/restored and manual ports removed. Reasons, exact source identity, revision conflict handling and immutable history remain visible.
- **Joern:** task presets, entry/exit symbol search and exact retained-analysis selection replace JSON as the first interaction. Routine arguments use fields; complete identities, schemas and raw responses remain available. Retained path cards include source hierarchy, guards, proof/gaps, search and next-path navigation.
- **APIs:** route inventories, passport HTTP boundaries/endpoints and saved exchanges open editable request drafts. The explorer has typed URL parameters, optional named bearer selection and an explicit Send action. Server-resolved bearer values stay out of browser/model payloads and stored exchange contents. Repeated sends can change authentication without inheriting unused captured credential requirements.
- **Inline results:** tables gain sorting and clear empty/filter counts with exports under More; JSON gains expand/collapse, diffs gain change navigation and differential cases gain search. Keyboard focus survives selection redraws, hidden selections are reconciled, successful transient embeds stay compact and code-cell output remains readable when opened. Mobile graphs keep readable dimensions with bounded scrolling/panning.

## Verification and limits

The confirmation batch made **78 surface/viewport visits**: fifteen Admin areas,
twenty native templates and four standalone surfaces at 1440 and 390 pixels.
It recorded **105/107 passing checks**, zero uncaught page errors, zero document
overflows and zero write attempts from saved snapshot pages. Port CRUD, required
reasons, revision-conflict draft retention, unsaved navigation, exact Joern scope,
symbol selection/rendered paths, keyboard focus, tab/panel relationships, request
links/query strings and dark primary-button contrast passed.

The two recorded failures are retained in the evidence rather than counted as
browser passes:

1. A second API send after bearer authentication inherited an unused captured
   credential parameter. Request preparation now drops parameters absent from
   the edited request. A local HTTP regression verifies bearer → anonymous →
   bearer, with sanitizer and URL-scope checks; the focused API/script suite
   passes all 71 tests.
2. Saved-result expansion raced an iframe navigation after the run and saved
   result selection succeeded. The checker now waits for the loaded disclosure;
   preview reuse/reset and versioned saved reads have unit coverage. The focused
   memory/runtime suite passes all 14 tests. No extra browser polish round was
   performed.

The final `npm test` run passes **734 tests**, with **52 optional live tests
skipped** and zero failures (786 total). `npm run build:check` confirms the
shipped bundle is current; `git diff --check` passes. Full results are recorded
in the [verification manifest](benchmarks/ui-ux-review.json). Parallel testing also
exposed a cancellation cleanup race: removing a closed resource could skip its
pending asynchronous stop promise. Execution draining now waits for those
promises and reports unfinished cleanup as unknown. A focused regression failed
before the fix and passed afterward; all 27 execution/Node-target checks passed.

The playground uses actual indexed Java source, synthetic infrastructure/docs
and a synthetic retained semantic projection. This pass did not run the Joern
parser or an Open WebUI browser session; it exercised the native sandboxed
renderers used by inline results. Existing real Joern and Open WebUI evidence in
the gallery remains separately labeled. Saved scripts keep their existing
parameter-based authentication; named bearer profiles apply to explicit API
replays. Native semantic path cards retain their existing hierarchy/list
presentation rather than adding a new CPG layout engine.

## Demonstration

Run `node demo/ui-ux.js` and open the printed Admin URL. Start with **Passports**
and select **Edit boundary graph**; correct a boundary with a reason, then open
its API request. In **Task memory**, open SHOP-142, inspect progress, run a tool
and reopen its saved evidence. In **Joern & ports**, select the retained
fixture-orders analysis, choose Trace calls, and pick create/save symbols.
The [capture instructions](../demo/README.md#investigation-ui-playground) reproduce
the browser checks and [current screenshots](screenshots/README.md#current-investigation-workspace).
