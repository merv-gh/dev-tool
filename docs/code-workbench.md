# Files and focused paths

Open `/editor?workspace=<id>&story=<task>` from Studio or Admin. The workspace editor now uses locally bundled Monaco Editor 0.57.0 and Headless Tree Core 1.8.0. Assets, fonts and the editor worker are served from this app. There is no CDN, extension host, Java language server or external editor service.

Single-click a file to preview it. Another clean preview replaces that tab. Double-click a file or its tab to keep it; editing also keeps the tab. Each file keeps its own model, undo history, selection and scroll position while open. The Explorer and editor can be resized by dragging the separator or focusing it and pressing the arrow keys. Folder navigation supports arrow keys and Enter.

Search finds file names and relative paths across the owned workspace and shows paths alongside duplicate basenames. **Reveal active file** focuses its exact path, including unopened directories. **Focus folder**, **Parent folder** and **Workspace root** provide a local-root alternative to deeply indented package trees. Folders and search results have continuation pages; the visible tree rows are virtualized. A changed folder generation invalidates an old continuation explicitly instead of silently skipping files. Refresh reloads folder contents. Search indices expire after ten seconds; the tool's `refresh:true` rebuilds immediately.

Source links can include `&path=src/Person.java&line=42&endLine=46`. Ctrl+S/⌘S saves and Ctrl+F/⌘F finds text. Saves use the revision from the last read. On a conflict, **Compare latest** opens a read-only Monaco comparison. **Use latest revision as save base** preserves the draft and updates its expected revision; a separate **Save** writes it. A newer intervening edit still causes a conflict.

The existing inspection terminal and Gradle inventory remain available. The terminal accepts its fixed commands and configured runner builds; it is not a PTY or arbitrary shell. See [editor and Gradle contracts](editor-gradle.md).

## Model tools

```json
{"action":"tree","workspace":"<id>","path":"src","limit":150}
{"action":"search","workspace":"<id>","query":"Person","limit":150,"refresh":true}
```

Call `workspace_editor` with the returned `next_cursor` as `cursor` to continue the same folder or query. `read` returns complete UTF-8 text and its SHA-256 revision; `save` requires `expected_revision`. Authentication and task ownership are enforced before accessing files or cached path indices.

## Entry-to-exit investigation

The `semantic-path-trace` visualization defaults to focused steps in both `/show` and inline results. Search for a method, field, table or source location. Selecting a match works without expanding its ancestors. Inspect the selected expression, retained revision, static evidence and its **Callers / previous** and **Callees / next** connections. Back/Forward restore the previous selection and search. The selected navigation route is a collapsible vertical list; it does not indent the content further at every call.

Connections retain distinct call-site identities. Filter each connection list by its target, source path, label or call site; each page mounts at most 25 relationships. Shared callees and cycle targets remain references to the same graph node. The production semantic path adapter preserves repeated occurrences in a retained path as separate steps and uses analysis identity only as a default for missing node identity. A library node never inherits a different repository's revision key. This view adds no new Joern edges or inferred runtime evidence. Value-flow and control-flow layers remain independent; conditions and declared boundary mappings retain their existing uncertainty.

**Prepare source read** opens the existing Admin Workbench with `code_read`, the retained `revisionKey` and exact file/range. It makes no read until the operator reviews the arguments and chooses Run. The original focused result stays open. Unresolved library source indices are explained instead of falling back to the app's current branch. This is a source-access handoff; a fully integrated production task conversation with immutable source and writable workspace tabs remains separate rollout work. The conversation demo illustrates that interaction but does not implement the production task backend.

**Export → Copy focused link** includes the selected layer, comparison and node in the retained result URL. The visual graph, SVG, Mermaid, evidence JSON and briefing exports remain available. A result's lifetime and ownership still apply to a copied link.

## Bounds and evidence

- Text editing remains limited to 2 MiB and valid UTF-8. Binary files, symlinks, parent traversal and Git/runtime internals remain blocked. Up to 50 production file tabs may be open; close a tab before opening more.
- The path index is bounded by 250,000 paths, 16 MiB of filename output and a 15-second scan deadline. It uses `rg --files` when available and an asynchronous directory walk otherwise; it reads no file contents. Budget failures are explicit.
- Monaco is unsupported on mobile. At phone widths, this implementation offers an explicitly read-only text preview. Use a desktop for editing. Production drafts stay in the open page and have an unload guard; this is not a new server draft-persistence system.
- The focused browser shows 25 search matches or neighbors at a time. It retains up to 200 navigation history entries and the latest 1,000 route steps, with the route limit labelled.

The [conversation demo](../demo/admin-intent-review/conversation/README.md) exercises the same components with synthetic fixtures: 20,000 file paths, a 5,000-entry folder, 50,000 graph nodes, 1,500 fields, a 200-step path, 500-way fan-out, shared callees and cycles. Its task drafts persist only in that browser. Its source/data correlation and regression remain simulations.

Verification:

```sh
node --test test/editor-ui.test.js test/editor-gradle.test.js test/workbench-scale.test.js test/views.test.js
node demo/admin-intent-review/server.js --port 4100
# In another terminal:
node demo/admin-intent-review/conversation/verify-workbench.cjs
npm run build
```

The browser verifier creates a disposable real Git checkout, starts the real HTTP server, reads and saves files through the production API, tests concurrent-save reconciliation and runs an inspection command. It also exercises the synthetic conversation and the real `/show` renderer. The [capture manifest](../demo/admin-intent-review/conversation/workbench-evidence/verification.json) records widths, document overflow and scope. No live Joern analysis, Java build, screen-reader session or physical phone test is implied.
