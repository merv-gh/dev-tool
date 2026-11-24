# Workbench: component and visual record

Recorded 2026-11-23 from the shared source, production adapters, conversation fixture and all thirteen current [captures](workbench-evidence/verification.json). This is a local implementation record, not a root design system. The [research contract](../production-scale-research.md), [production contracts and limits](../../../docs/code-workbench.md) and [composition notes](design-notes.md) remain complementary sources.

## Overview

The surface is an Operate workspace: ask and steer in conversation, then inspect one path or file in a working area with enough room to use it. The confirmed direction is minimal and Codex-like, with familiar VS Code file behavior. White space, quiet chrome and local evidence labels support the work; no new brand metaphor or global visual identity is inferred.

The real `/editor` and `semantic-path-trace` renderer use shared components. The conversation integration is a browser-local synthetic adapter. Production prepares retained source reads in Admin; complete production conversation/source/workspace continuity remains subsequent work.

| Responsibility | Source |
| --- | --- |
| Monaco models, mobile preview, comparison dialog, Headless Tree Explorer | [web/workbench-entry.js](../../../web/workbench-entry.js) |
| Shared editor/Explorer styles | [web/code-workbench.css](../../../web/code-workbench.css) |
| Pointer and keyboard pane resizing | [web/workbench-layout.js](../../../web/workbench-layout.js) |
| Focused graph model, provenance adapter, history, relationship paging | [web/views/_path-browser.js](../../../web/views/_path-browser.js), [styles](../../../web/views/_path-browser.css) |
| Production editor and retained semantic-path adapters | [web/editor.js](../../../web/editor.js), [semantic-path-trace.html](../../../web/views/semantic-path-trace.html) |
| Owned file access, cursors, search budgets and revision saves | [lib/workspace-editor.js](../../../lib/workspace-editor.js) |
| Synthetic task integration and local visual composition | [workbench.cjs](workbench.cjs), [workbench.css](workbench.css), [client.cjs](client.cjs) |

Monaco Editor 0.57.0 and Headless Tree Core 1.8.0 are pinned and bundled locally. [Vendor provenance](../../../web/vendor/workbench/README.md) records the generated assets. Syntax tokenizers are not a Java language server, semantic completion or a VS Code extension host.

## Colors

The CSS files are the source of truth. The following values describe this local implementation; they do not introduce another token authority.

### Conversation primitives

Extracted from [conversation.css](conversation.css). The same token names have OS-selected light/dark values.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#fff` | `#202321` | Conversation and control surface |
| `--panel` | `#f5f5f4` | `#262a27` | Task list, Explorer and quiet containers |
| `--hover` | `#eeeeec` | `#343b35` | Hover and selected task |
| `--ink` | `#242524` | `#e4e7e2` | Main text |
| `--muted` | `#626560` | `#a9b1a7` | Secondary evidence and metadata |
| `--line` | `#dedfdb` | `#414940` | Region boundaries and controls |
| `--accent` | `#285647` | `#a7d1b6` | Primary action, link and focus |
| `--on-accent` | `#fff` | `#1c3023` | Primary-action text |
| `--tint` | `#eaf2ed` | `#293e2e` | Selected workbench mode |
| `--danger` | `#9c342b` | `#ffaca3` | Error text with an explicit label |
| `--warning` | `#805a16` | `#e6c183` | Warning text with an explicit label |
| `--code` | `#f6f7f4` | `#282d28` | Inline code and receipt snippets |

### Production and shared variations

Production retains [web/ui.css](../../../web/ui.css): blue accent (`#2457c5` light / `#7ea2f0` dark), warm ground (`#fbfbfa` / `#141413`), white/dark panel (`#fff` / `#1b1b1a`) and its existing semantic states. The green proposal palette is not a production token migration.

The shared Explorer/path CSS also contains green focus values (`#456c60`, `#87a89b`) and hover/tint fallbacks (`#ebeeec`, `#e5eeea`); path links hover at `#315d4d`. The conversation supplies its ink and panel tokens around these components. Production may use the shared fallbacks where a proposal token is absent. These are current local variations, not a newly standardized accent family.

Monaco is explicitly configured with the light `vs` theme; the mobile source preview and comparison surface also use white backgrounds. The shell has dark CSS, but the current captures are light. A coordinated dark editor or completed dark-mode accessibility pass is not established by this record.

## Typography

| Role | Current values | Application |
| --- | --- | --- |
| Proposal body | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; 14px / 1.55 | Conversation shell |
| Proposal answer | Inherited 14px; line height 1.75; maximum 75ch | Readable assistant explanation |
| Proposal headings | 16px task title, 15px section, 14px subsection | Restrained hierarchy beside evidence |
| Proposal metadata | Mostly 10–12px | Scope, receipts, state and provenance |
| Production body | `ui-sans-serif, system-ui, sans-serif`; 13px / 1.55 | Incumbent production chrome |
| Shared path | `system-ui`; 13px / 1.5; selected title 16px | Focus, relationships and search |
| Explorer | `system-ui`; 12px / 1.4; search path 10px / 13px | Compact hierarchy with visible disambiguation |
| Monaco source | `Menlo, Consolas, monospace`; 13px / 21px | Line-numbered source and editing |
| Source excerpts | `Menlo, Consolas, monospace`; 12px / 1.6 | Bounded selected-step code peek |

Font sizes narrow in the phone fixture; the shared mobile preview uses 12px / 1.65, locally reduced to 11px in the conversation. No external font is fetched. Keep provenance readable through text and wrapping; its smaller size is not permission to hide identity in a tooltip.

## Layout

The default composition is conversation plus one working area. When work opens, the proposal hides its permanent task list and exposes Tasks as a drawer. The conversation starts at 38% with a 320px minimum; at 1600px and above it starts at 36%. The work area fills the remainder. The separator changes width by pointer or keyboard. Expand temporarily gives the work area the full width without selecting another task.

Files contain Explorer and editor, not an additional full path tree. The proposal Explorer starts at 220px, uses a 140–380px resize range and can be hidden. Production starts at 240px and uses its own layout constraints. Shared tree rows are 30px; search rows are 52px to display both basename and relative path. The virtual viewport mounts visible rows plus overscan. Continuation loads filenames/structure, not every source body. Local-root controls and a focusable, scrollable folder-context label supply ancestry for deep packages.

Path depth changes the selected route, not content indentation. The route disclosure scrolls within 220px; node search results scroll within 330px. Each search page and each incoming/outgoing relationship page contains at most 25 items. Production neighbors use two columns above 700px. The conversation uses one column until 1600px, then two. Long source paths and prose wrap; long editor lines scroll within Monaco.

At 760px and below, the proposal opens the work area full-screen below its demo strip and makes the background inert. Close restores the prior focus. At 600px and below, the editor adapter selects an explicit read-only mobile preview at creation; this is a supported preview policy, not a tested mobile Monaco editor. The 720px capture exercises the narrow/full-area composition as a zoom proxy.

The production editor preserves its constrained inspection terminal and optional dependency inventory. Its fixed bottom terminal is an incumbent difference from the research's optional bottom panel. A fully integrated production task layout remains open work.

## Elevation & Depth

Most regions are flat, separated by a border or tonal change. The proposal adds no decorative card grid or ambient surface shadows. Shadows identify temporary surfaces: task drawer (`4px 0 16px #0002` while the workbench is open), shared phone Explorer (`4px 0 12px #0002`) and the production conflict comparison (`0 10px 40px #0003`, backdrop `#0005`).

Motion is functional. Transcript scrolling is smooth and disabled for reduced motion. Production controls retain their existing background/border transition (0.16s). Resizing changes the working width directly; it does not animate between selected nodes or imply runtime execution.

## Shapes

The proposal uses modest rounding: buttons (6px), fields (5px), receipts (6px), user messages (8px) and composer/dialog (9px). File tabs are square joined surfaces with a separate close control. Selected workbench mode uses a tinted fill and accent border; selected file tabs use a thin bottom accent in the proposal. Production retains its incumbent control rounding and tab styling.

Focus is explicit: the proposal shell uses a 2px accent outline with 3px offset, the focused path uses a 2px shared green outline with 2px offset, and tree rows/resizers use compact 1px outlines. A separator is 5px wide and keyboard focusable. These values record the implementation; the captures do not constitute a full contrast or target-size audit.

## Components

### Conversation, composer and receipts

Keep the task title/scope and persistent composer as the stable frame. Put concise answers and contextual actions beside their evidence. Passing fixture receipts collapse; missing runtime proof, stale source, failures and unrun integration/coverage retain explicit text. The demo's 40-message window and browser storage are local mechanisms, not a production history service.

### File Explorer

Headless Tree provides hierarchy and keyboard navigation; the shared renderer virtualizes visible rows. Arrow keys and Enter operate folders/files. Search matches names and relative paths throughout the owned workspace and displays both; accessible names also include the path. **Reveal active file** finds and focuses the exact file. **Focus folder**, **Parent folder** and **Workspace root** support deep package navigation without requiring compact-folder rendering. Empty/loading/error/count/continuation messages remain visible.

### Source tabs and editor

Monaco provides real models, line numbers, syntax highlighting, find, folding, bracket matching and independent undo/selection/scroll while each model stays open. The minimap is disabled. A clean preview tab is italic and replaceable. Double click or editing pins it; a dirty marker supplements the file state. Production opens at most 50 tabs. Closing a production dirty tab requires an explicit discard decision; open production drafts have an unload guard.

Source-range URLs support `path`, `line` and `endLine`. The demo separates its immutable illustrative snapshot from its writable workspace copy and labels unsaved/browser-local state. Production file reads/saves use the owned checkout and SHA-256 expected revisions. The BOM/CRLF verifier covers the exercised UTF-8 fixture; this is not a claim of arbitrary encoding or rich-file support.

### Save conflict comparison

Production **Compare latest** opens a read-only Monaco diff of the latest saved content and preserved draft. **Use latest revision as save base** changes the expected save revision without writing. A separate **Save** writes; another intervening change still conflicts. The demo's conflict controls remain a simulation and do not substitute for the real backend proof.

### Focused path and relationships

The selected node shows its kind, expression, own repository/revision, evidence, source locator and runtime/uncertainty labels. Source code peek is a bounded excerpt, not another editing buffer. Changes and assumptions use a disclosure. Callers / previous and Callees / next keep call-site identity visible; each list filters targets, paths, relationship labels and call sites with counts and replaced pages of 25. Shared/cyclic targets navigate through identity rather than cloned nested subtrees.

Back/Forward capture query, search page, content scroll and relationship filters. Route clicks restore that step's own connection through the same history path. History is capped at 200 entries; the route retains the latest 1,000 steps with a visible limit label. The production path adapter retains repeated source occurrences as separate steps and uses analysis metadata only as defaults. Library nodes preserve their own admitted identity and do not inherit another repository's revision key.

### Source access and resizing

Production **Prepare source read** opens a separate Admin tab containing `code_read` with the retained revision key and exact file/range. It performs no read until the operator reviews and Runs the draft. The original path stays selected. If the exact source index is unresolved, explanatory text replaces the action. This explicit handoff is the delivered production access path; integrated source/workspace tabs remain rollout work.

Resizable separators expose `role=separator`, orientation and current/min/max values. Left/Right change width by 20px; Home/End choose the bounds. The demo uses the same behavior between conversation/work area and Explorer/editor. Hiding Explorer leaves the editor available.

## Do's and Don'ts

- **Do** preserve conversation as the default task entry and give sustained investigation enough width.
- **Do** retain per-object provenance, static/runtime distinctions, unknown identity and admitted source revisions locally.
- **Do** keep dirty drafts independent of clean previews and separate save-base reconciliation from writing.
- **Do** use direct field, path and call-site search with bounded mounted lists and visible counts.
- **Do** preserve the incumbent production UI and record proposal/shared variations as local.
- **Don't** restore an indefinitely indented call tree, use a long horizontal breadcrumb as the only route, or force a useful editor into the old 410px inspector.
- **Don't** substitute current-branch app source for an unresolved library revision or describe static membership as runtime proof.
- **Don't** equate Monaco syntax support with a complete VS Code IDE, the command runner with a PTY, or the phone preview with mobile editing.
- **Don't** claim production-scale readiness from the synthetic fixture or bounded DOM alone.

The refreshed [manifest](workbench-evidence/verification.json) records **18 passing browser groups, 13 captures, zero errors**, with matching viewport/document widths. Checks of production code use a disposable local checkout and server: owned reads/saves, BOM/CRLF, concurrent-save reconciliation, late file retrieval, keyboard Explorer/Save/resizing, inspection output and the semantic renderer/prepared source handoff. Synthetic checks cover 20,000 paths, 50,000 nodes, 1,500 fields, 200 steps, 500-way repeated-target fan-out, browser-local draft recovery and the illustrative regression. All thirteen captures were visually inspected for this documentation. Final validation also passed 91 focused production tests, 30 intent/conversation tests, `build:check` and `git diff --check`. The [scored verdict](workbench-verdict.md) clears the five [review findings](workbench-review.md) at this component scope.

Outstanding evidence includes response bytes, lookup time, first useful paint, heap/model pressure and bounded large-graph fetching. The synthetic graph is constructed in full in the browser. Rich Markdown/image/structured previews and bounded large-log/JSON search/export are not demonstrated; editing remains valid UTF-8 text up to 2 MiB. No live Joern, Java service regression, screen-reader session, actual 200% browser zoom, physical phone or dark editor validation is implied. The design detector remained unavailable after launcher download-verification failure; no clean detector result is claimed. Production task integration, server persistence/recovery and durable team sharing remain in the [rollout plan](implementation-plan.md).

No root `PRODUCT.md`, `DESIGN.md` or `.impeccable/design.json` was supplied or created. The documentation preserves that absence, existing global UI and unrelated prior drift. It is a local component record with explicit rollout caveats, not whole-workflow completion.
