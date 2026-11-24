# Production-scale files and flow investigation

Evidence: [user-supplied rejected layout](research-evidence/rejected-layout.png).
Implementation update: [shared components, current contracts and tested limits](../../docs/code-workbench.md), [browser evidence](conversation/workbench-evidence/verification.json). The research below remains the design contract; planned gates are not automatically claimed as passed.

Research date: 2026-11-23. This revises the information architecture after the user's screenshot review. It is a researched design decision and implementation contract, not an implemented Monaco integration or a new production-scale test result. The earlier conversation prototype and captures remain comparison evidence. Their bounded five-fix verdict did not approve the representation at production scale.

Keep the stable task, conversation, persistent drafts, pinned revisions and background execution. Replace the narrow Files inspector and indefinitely indented flow tree. A file hierarchy is useful for navigating files; a call/data-flow graph needs other ways to show multiple callers, alternatives and cycles.

## What established interfaces suggest

| Reference | Verified pattern | Application here |
| --- | --- | --- |
| [VS Code interface](https://code.visualstudio.com/docs/editing/getting-started/userinterface) | Explorer next to the editor; a replaceable preview tab becomes a dedicated tab when edited or explicitly opened | Browse without accumulating tabs; pin files used in a change; never replace a dirty buffer |
| [VS Code navigation](https://code.visualstudio.com/docs/editing/editingevolved) | Breadcrumb navigation and an inline Peek surface for source/reference inspection | Inspect the exact source range without losing the selected flow or opening another page |
| [VS Code compact folders](https://code.visualstudio.com/updates/v1_41#_compact-folders-in-explorer) | Single-child folder chains can occupy one row | Collapse long Java package paths; retain individual folder access and full-path search |
| [Speedscope views](https://github.com/jlfwong/speedscope#views) | A selected function can be investigated through its callers and callees | Explore one focus and its relationships, rather than presenting the complete call graph as one ownership tree |
| [Perfetto selections](https://perfetto.dev/docs/visualization/perfetto-ui) | Selection drives an associated details surface; search and filtering support navigation | Keep path selection, source range, raw data and provenance coordinated |
| [Grafana span filters](https://grafana.com/docs/grafana/latest/datasources/tempo/span-filters/) | Search by service, operation and attributes; navigate matches or restrict the display | Find a field, change or unresolved boundary directly; show matches with enough context to interpret them |
| [Headless Tree virtualization](https://headless-tree.lukasbach.com/recipe/virtualization/) | A flat visible-item list can be passed to a virtualizer | Bound DOM work separately from semantic depth and data retrieval |

These are design precedents, not evidence that copying their whole UI is optimal for this tool. Profilers and runtime traces also have timing/aggregation semantics that our static Joern paths do not. Reuse focus, selection and navigation patterns; do not invent durations or imply runtime execution from a static path.

## Recommended task workspace

Conversation remains the default place to ask, steer and read findings. A result shows a short explanation and meaningful boundaries, then opens its investigation in the same task. Sustained investigation gets a resizable working area. It cannot be confined to a fixed 410px inspector.

Two coordinated areas are the default: conversation and working area. Inside the working area, show the representation required by the selected object. A file view has an Explorer and editor. A path view has an ordered path/local steps and selected-item details. Do not keep task navigation, chat, a full path tree, a file explorer and a usable editor all expanded across the same narrow viewport.

The user can enlarge the working area or temporarily collapse chat; the task header, background status and a way to return to the composer stay available. A source Peek opens at the selected step; sustained editing opens the corresponding file tab. Returning restores the exact path selection and scroll position. At phone widths, use explicit full-screen task views with a clear return path and preserved state. Layout changes must not silently select another task or recreate its workspace.

The following is an information layout, not a pixel mock or a new navigation hierarchy:

```text
Task / service / source revision                         Background status

Conversation         Working area
                     Path: HTTP entry → DB candidates → Name policy → HTTP exit
Finding + actions    Selected: Name policy       [Source] [Data] [Evidence]
                     Callers: 18 call sites      [Find a caller]
Active composer      Conditions / data changes / outgoing calls
                     Source Peek at exact file:line, or a pinned editor tab
```

In file view, that working area becomes `Explorer | preview/pinned editors`, with the selected flow retained as a compact return link. Terminal and checks are optional bottom panels, not permanently visible sections that take editor height.

## Files: Monaco plus a real surrounding workbench

**Recommended component direction:** Monaco for desktop code editing and diffs, and an established tree engine for the Explorer. Monaco is the editor component used by VS Code; it is not the Explorer, extension host or complete workbench. Its FAQ also excludes mobile support. Do not promise full VS Code behavior merely by replacing a textarea. [Monaco project documentation](https://github.com/microsoft/monaco-editor)

Headless Tree is a strong candidate for the hierarchy: it exposes a framework-independent `createTree` core as well as React bindings, so our current vanilla frontend need not be rewritten in React just to use it. It provides tree interaction/accessibility behavior; asynchronous loading and virtualization still need explicit integration. Server search and continuation remain our responsibility. [Core integration](https://headless-tree.lukasbach.com/getstarted/), [async loading](https://headless-tree.lukasbach.com/features/async-dataloader/), [accessibility responsibilities](https://headless-tree.lukasbach.com/guides/accessibility/)

The required workbench behavior is:

- Search files by name or full path with a visible Quick Open button; keyboard shortcuts are additional access. Duplicate basenames show repository/workspace and relative path.
- Keep a normal Explorer with compact single-child folders, reveal-active-file, folder focus, breadcrumbs and a virtualized visible list. Extremely deep directories can be focused as a local root; full ancestry remains accessible.
- Single selection previews a clean file in one reusable tab. Editing or explicit Pin retains that tab. Preserve dirty buffers, undo, cursor, selections and scroll when switching views.
- Source references open at a precise range. Immutable analysis sources and the current writable workspace are visibly distinct. Opening an old Joern result must not silently substitute today's file.
- Preview Markdown, images and structured data appropriately, with an explicit Source action. Running a script/query is a separate action. Logs/large JSON need bounded retrieval and search, not a full browser parse followed by a tiny scrollbar.
- Use the existing expected-revision save protection and retained drafts. A save acknowledges the submitted content; edits made during the request remain dirty.

Use separate model identities for immutable source snapshots and writable workspace files. Save editor view state per file; reuse the visible editor, and evict clean inactive models within a configurable budget. Persist dirty drafts before any model eviction. These are our proposed lifecycle rules, not a claim that Monaco persists task files for us.

Bundle only needed languages and workers locally, load the editor on demand, and use its ESM integration rather than beginning with the deprecated AMD loader. Java semantic completion/import resolution is a separate language-service integration, not a consequence of syntax highlighting. Reuse indexed symbols and compiler diagnostics first; evaluate an LSP adapter when full Java IDE behavior is needed. [Monaco ESM integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md), [TypeFox Monaco language client](https://github.com/TypeFox/monaco-languageclient/blob/main/docs/introduction.md)

For phone editing, evaluate a CodeMirror 6 surface or keep read-only previews with an explicit desktop editing route. CodeMirror documents mobile support; that does not mean our existing CodeMirror 5 bundle has already validated this behavior. [CodeMirror](https://codemirror.net/)

If the requirement expands to a complete extensible IDE, evaluate Theia as a separate architectural decision. It supplies a frontend/backend platform and workbench extensions, with more integration obligations. It is excessive as the first step for the present file-preview problem. Avoid importing private VS Code workbench classes piecemeal: Theia's own notes describe their upgrade costs. [Theia architecture](https://theia-ide.org/docs/architecture/), [VS Code reuse notes](https://github.com/eclipse-theia/theia/blob/master/doc/vscode-usage.md)

## Flows: make depth independent of screen width

The default flow representation should answer a selected question, such as “Where does response.fio get its value?” It should not attempt to expose the entire graph at once.

**Overview:** a flat list of meaningful boundaries on the selected entry-to-exit route. A row has the service/operation, important data change, branch/loop summary, evidence state and source location. Selecting a row gives it focus. A depth of 200 should require the same content width as a depth of 5.

**Focused node:** separate lists for incoming call sites and outgoing calls/effects. Following an item changes the focus, not its indentation. A short ancestor header shows the entry and nearest relevant context. “Ancestors (42)” opens a searchable vertical list; it must not turn into a 42-segment horizontal breadcrumb. Back/forward restores focus, filters, selected call site and scroll.

**Local detail:** allow at most two visible indentation levels for a local group. Beyond that, use “Focus here.” Shared callees show all relevant incoming call sites, not just the first parent. Cycles are explicit references that resolve even when their targets were never expanded. Asynchronous handoffs retain their relationship type.

**Data and control:** selected-step details show input fields/records, predicates, transformations and outputs with their source ranges. Keep alternative paths distinguishable. The current semantic tool explicitly treats data and control evidence independently; the UI must not merge them into a fabricated, proven execution. A raw database sample is supporting evidence, not a statement that a deployed request consumed that exact row.

**Aggregation:** collapse only identified transparent calls or repeated equivalent groups. Preserve effects, data changes, branches, exception/async boundaries and unresolved dispatch. A group states how many items it hides and what rule formed it. A loop summary cannot silently imply all iterations took the same path. Unsupported/missing evidence stays visible.

**Finding things:** search across the retained graph/index for a field, table, topic, method or condition. Offer question-oriented views such as Changes, Unresolved, and Affects this field. Results include counts and context; users can jump directly to a matching node or field. Paging alone is insufficient when a person would otherwise inspect 60 pages to find one of 1,500 fields.

Each selected item carries its own evidence kind, immutable source identity, environment/execution when relevant, observation time and limitations. Distinguish static findings, runtime spans, user assertions, database samples and test assertions. Show when current workspace edits have moved beyond the inspected revision. A named share preserves the selected focus, query, revisions and view state, while access checks protect private execution results.

A waterfall belongs in an optional runtime-trace view when timing evidence exists. A graph overview can help orient a small neighborhood. Neither replaces the readable path/local-relationship representation for preparing a change.

## What to reuse and what must change in this repo

| Existing implementation | Useful foundation | Gap before scale |
| --- | --- | --- |
| `web/editor.html`, `web/editor.js` | Real CodeMirror documents, tabs, modes, line numbers, save shortcuts, revision-aware save handling | Integrate the workbench into the task; add preview/pin semantics, exact source-range navigation, workspace-wide search and proper Explorer behavior |
| `web/vendor/codemirror/PROVENANCE.json` | Locally vendored CodeMirror 5.65.16 with no runtime network requirement | This is not Monaco and is not a CodeMirror 6 migration |
| `lib/workspace-editor.js`, `tree()` | Owned workspace/path checks and per-folder retrieval | Sorts and returns only the first 1,000 entries; no continuation cursor. Add indexed search and a continuation contract; never make later files unreachable |
| `lib/workspace-editor.js`, `source()` / `save()` | UTF-8 validation, 2MiB editing limit, binary rejection and expected revisions | Explain file limits before loading; add bounded preview/search/download paths rather than raising limits blindly |
| `lib/semantic-path-trace.js` | Bounded paths, independent data/control evidence, assumptions, retained source identity and explicit incomplete states | Give the UI node/call-site lookup, caller/callee search, field lookup and stable selection references; preserve limits and incomplete evidence in responses |
| `demo/admin-intent-review/conversation/` | Task continuity, explicit execution, revision-pinned checks, recovery and conversation windowing | Its textarea, first-segment file groups, narrow inspector and unbounded display indentation are comparison examples, not the next workbench implementation |

The existing terminal is a constrained command interface, not a general PTY. Calling it a full VS Code terminal would be inaccurate. Decide separately whether a true persistent terminal is required; do not disguise the command runner as one during this editor revision.

## Acceptance before another scale approval

These are proposed fixtures/gates, not passed tests:

| Pressure | Required user outcome / evidence |
| --- | --- |
| 20,000 files; one folder with 5,000 children; repeated filenames | Every file is reachable through indexed search or continuation. Opening a folder does not load all file contents. Active file can be revealed |
| Depth 50, then 200; fan-out 500; shared callee; cycle; 20 services | No horizontal overflow caused by hierarchy. Caller/call-site identity remains clear. Cycle navigation works without pre-expanding its target |
| 1,500 result fields | Find a named field and its mapping directly. Do not require sequential page browsing |
| Two dirty files; clean preview; concurrent save; task switch/reload | Preview never overwrites a dirty buffer. Cursor/scroll and revisions survive. Recovery remains truthful when storage fails |
| 50,000 graph nodes and long evidence history | Fetch and render bounded slices. Record DOM rows, response bytes, lookup time, first useful paint, heap and active models. No claim of exhaustive paths from a bounded query |
| Very long code lines; large/binary file; huge log/JSON | Contain horizontal code scrolling inside the editor. The workbench remains in the viewport. Large content offers bounded preview/search/export |
| Static path + runtime span + old sample + unresolved target + newer edited source | Each object's type and revision is clear locally. Unsupported correlations are marked unresolved |
| 1024/1440/1920px, narrow phone, 200% zoom, keyboard | Inspect selected predicate, source range and relevant rows without losing selection; restore the prior view on return. Validate the chosen mobile editor separately |

Measure completion of real retrieval tasks, not just row counts or an eight-click shallow happy path. The first revised demonstration should be response field → candidate record → predicate → exact source range → edited saved revision → independent regression, including a shared-library call and an explicitly missing runtime link.

The independent screenshot review reached the same structural conclusion and supplied six change areas with testable criteria. See [its retained findings](scale-information-review.md). No production files, editor dependencies or previous capture manifests were changed by this research iteration.
