# Conversation workbench: local design notes

These notes describe the conversation proposal and its shared file/path components. They do not establish a global brand, design system or token migration. The incumbent task shell in `web/tasks.html`, `web/task-conversation.js`, `web/tasks.css` and `web/ui.css` remains the production starting point. The user's direction is a minimal, Codex-like conversation workspace with familiar VS Code file interactions and readable paths whose depth does not consume width.

The [production-scale research](../production-scale-research.md) is the design contract. The [implementation guide](../../../docs/code-workbench.md) states what shipped and its bounds. The [component and token record](workbench-documentation.md) captures the current code and evidence. Earlier textarea, first-segment file grouping and nested-flow captures are historical comparisons; they no longer describe this workbench.

## Composition

The task remains the unit of work. Its environment, service and source reference sit below the title. A short answer and contextual next steps stay in the conversation; the searchable action finder holds the long tail. The composer remains available beside sustained desktop investigation. Passing fixture receipts collapse, while failures, evidence gaps, stale revisions and missing acknowledgements retain a next action. HTTP success, static evidence, fixture assertions and unrun integration/coverage keep distinct labels.

Opening Files or a path creates one resizable working area. Task navigation yields to a Tasks drawer, leaving conversation and work side by side. **Expand workbench** temporarily hides the conversation; **Show conversation** restores it. Closing the area returns to the task. The work area switches between Path and Files rather than showing task navigation, chat, a complete graph, Explorer and editor simultaneously.

Files use the actual shared Monaco editor and Headless Tree Explorer. Single click opens a replaceable clean preview; double click or an edit keeps the tab. Dirty buffers cannot be replaced by another preview. File search displays relative paths, and **Reveal active file**, **Focus folder**, **Parent folder** and **Workspace root** make deep packages reachable without endless indentation. The illustrative source snapshot is a separate read-only tab; **Edit workspace copy** opens a writable specimen with its own saved revision and draft state.

Paths use a focused step with Callers / previous and Callees / next. Search jumps directly to a method, field, table or source location. Each direction has a call-site filter and pages of at most 25 relationships; repeated targets retain distinct connections. The selected route is a collapsible vertical list. Following step 200 uses the same content width as step 5, and shared/cyclic targets remain navigable references. Back/Forward restore search, result page, relationship filters, selected connection and content scroll. Conditions, changes, source identity and uncertainty remain local to the selected step. Static membership does not establish runtime execution or control feasibility.

## Local visual choices

[conversation.css](conversation.css) owns the proposal shell's values; [workbench.css](workbench.css) owns its working-area composition. White content, quiet neutral panels, fine borders and restrained green actions support reading and operating. The incumbent production shell keeps the blue accent from [web/ui.css](../../../web/ui.css). Shared workbench fallbacks and the light Monaco theme remain local variations, documented rather than promoted into global rules.

The proposal uses a 14px system sans base, 14–16px headings and messages limited to 75ch. Shared path text is 13px; Monaco uses 13px monospace with a 21px line height and no minimap. Metadata is smaller and secondary to the answer, selected source and next step. Long source lines scroll inside the editor.

Without a workbench, the shell retains its 225px task list, 795px conversation content cap and optional 410px detail inspector. With a workbench, the conversation starts at 38% of the working width and the working area takes the rest; the conversation starts at 36% on very wide screens. The file Explorer starts at 220px and can be resized or hidden. These are local starting sizes, not fixed constraints on sustained editing.

At 760px and below, the workbench occupies an explicit full-screen pane with Close; other task details use an overlay. The overlay makes the background inert, moves focus into the pane and restores focus when it closes. At 600px and below, the editor adapter deliberately supplies a labeled read-only text preview because Monaco mobile editing is unsupported. The recorded 720 CSS-pixel view is a zoom proxy, not an actual 200% browser-zoom test.

Controls use modest rounded corners and visible keyboard focus. Regions are flat at rest; shadows distinguish overlays and the production conflict dialog. Transcript scrolling respects reduced motion. The editor, worker and icon font are served locally; the workbench adds no CDN or external editor service.

## Evidence and production boundary

The current [browser record](workbench-evidence/verification.json) reports 18 passing groups, 13 captures and no runtime/worker/CSP errors. It exercises the real `/editor`, owned HTTP file reads/saves, BOM/CRLF preservation, concurrent-save reconciliation, inspection commands and `/show` semantic renderer. Conversation/source correlation and revision-pinned regression in the same record are explicitly synthetic. The [independent verdict](workbench-verdict.md) clears the five findings in the [finish review](workbench-review.md) at this component scope.

Production retained-source access is **Prepare source read**: an explicit `code_read` draft at the admitted revision and exact range, opened in Admin for review and Run. It preserves the original focused result. Missing exact library identity blocks the handoff instead of substituting the app's current branch. This is not the demo's integrated snapshot-to-workspace interaction. Full production conversation, immutable-source and writable-workspace continuity remains rollout work.

The demo retains task drafts only in that browser. The 20,000 generated paths, 50,000-node graph, 1,500 fields, 200-step route, 500-way fan-out, 10,000-service finder and 40-message render window demonstrate interaction bounds. They do not establish bounded graph fetching, memory or production latency. Rich/large-file previews, server draft/history persistence, durable team sharing, full language services, actual browser zoom, screen-reader and physical-phone validation remain outside this delivery. See the [rollout plan](implementation-plan.md).

No root `PRODUCT.md`, `DESIGN.md` or `.impeccable/design.json` was supplied or created. This documentation preserves that absence and the incumbent global UI; it does not repair prior design drift or claim a completed production workflow.
