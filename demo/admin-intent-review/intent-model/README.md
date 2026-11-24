# Conversation-first interaction model

This is the replacement direction for the earlier multi-surface proposal: one task conversation, with Files and Background alongside it. Tools prepare actions and return compact receipts inside that conversation. There is no new page or bespoke dashboard for every capability. Entry-to-exit information uses nested vertical lists.

This folder implements the requested **first step**: an executable interaction model and inspectable diagram. It does not change production Admin, fix the six reported production defects, or execute any real tools/providers.

## Review it

From the repository root:

```sh
node demo/admin-intent-review/server.js --port 4100
```

Open [the interactive statechart](http://127.0.0.1:4100/intent-model/index.html?usecase=entry-exit).

- The left list contains **135 use cases**, grouped by user goals. Search by intent, object or tool name.
- Selecting a use case highlights its actual XState route across the relevant actors. Other actors/states collapse or hide. Turn off the focus filter to inspect the remaining states.
- Expand a parent to inspect nested states. Select a state to inspect its exact events, guards and target links. Inspection never advances a simulation.
- Next, Run to end and Reset operate the finite local model. Expected, failed, partial, empty, denied, cancelled and unknown-acknowledgement paths are distinct. Conversation-only interactions have their own applicable path.
- Export/help provides executable XState source, the structural model, the verification report and a review link containing intent/scenario/step. Opening a review link restores only a pure design simulation.
- The source-list specimen appears for investigation intents. Expand one branch at a time. Search a 10,000-service fixture, page 1,500 synthetic fields, and inspect a cycle as a reference instead of duplicating it.

The diagram is a hierarchy, not a full-catalog force graph. Native disclosures and ordinary lists handle navigation; transitions are available on selection. The primary intent’s actor opens first. The conversation, shared execution lifecycle and scope actors remain collapsed until relevant to the review.

## What the model covers

| Contract | Count | What the check establishes |
| --- | ---: | --- |
| Curated user intents | 135 | Each has an outcome, interaction family, explicit capabilities and executable route |
| Built-in capabilities | 316 | Every tool in an isolated current registry has an explicit intent assignment; unknown/unassigned tools fail verification |
| Existing workbench intents | 20 | Every existing starting intent has a replacement use-case binding |
| Prior Admin state obligations | 239 | Every inventory entry is assigned to a proposed intent; this is a design obligation, not a production pass |
| XState actor families | 12 | Nested, executable interaction contracts with stable state IDs |
| Declared atomic states | 290 | Every state is reachable in the bounded actor graphs |
| Declared transition branches | 704 | Every selected transition, including guard fallbacks and intentional no-ops, is exercised |
| Modeled journeys | 897 | All declared use cases and applicable common outcome variants replay to their expected model state |
| Navigation/job interleavings | 495 | Every order-preserving merge of the selected navigation and cancellation sequences preserves the independent workspace |

The independent browser driver also selected and completed all **135** use cases through real controls. Desktop/phone, representative dark mode, keyboard activation, source export, review links, failure variants, collapse and bounded source paging are recorded in `browser-verification.json`.

## Actor boundaries

| Family | Durable identity / proposed responsibility |
| --- | --- |
| Task/scope | Resolve principal, task and environment before restoring a deep-linked form |
| Conversation | Retain user input, stream an answer, accept steering, ask questions and compact explicitly |
| Tool/API action | Validate a pinned target, authorize, admit once, observe, reconcile and retain a receipt |
| File/editor | One selected file/revision; drafts survive reselect, navigation decisions, failures and conflicts |
| Background job | Independent owned execution ID; queue, wait, checkpoint, pause, budget, cancel and cleanup |
| Investigation | Exact source pin; nested calls/conditions/loops/transforms/exits; assumptions and unresolved library paths |
| Workspace | Retained checkout or non-Git folder; patch, branch, compile context, task-branch push and draft PR |
| Verification | Entry-to-exit expectation, profiles/leases, compilation fallback, assertions and changed coverage |
| Memory | Search/attach retained understanding; edit private drafts; admin-only versioned shared publication |
| Handoff | Stable name, source pins, prerequisites, read-only opening and separately authorized private replay |
| Operations | Non-destructive index generations, configuration activation and paged telemetry |
| Connection | One multiplexed owned event stream; resume cursor and reconcile without replaying effects |

These actors run concurrently by identity. Closing a conversation does not destroy its workspace or job. The browser simulator uses one specimen actor per family; it does not instantiate an actor for every service/table/file in the estate. Production should key selected entity actors by principal/task/entity ID and adapt authoritative existing execution states rather than create a second competing job engine.

XState supports nested parent states and graph traversal directly; this model pins stable **5.33.4** and uses its bundled graph utilities. References: [parent states](https://stately.ai/docs/xstate/v5/parent-states), [graph/path generation](https://stately.ai/docs/xstate/v5/graph).

## Test and regenerate

Install the isolated model dependency; the repository’s normal dependencies supply esbuild and Playwright:

```sh
npm ci --prefix demo/admin-intent-review/intent-model
npm --prefix demo/admin-intent-review/intent-model test
node demo/admin-intent-review/intent-model/build.js
node demo/admin-intent-review/intent-model/check-browser.cjs
```

No production build is required for this separate review surface. `app.js`, `model.json`, `summary.json`, `coverage.json` and `machines-source.js` are generated by build.js. The structural JSON omits JavaScript function bodies; the separately exported XState source contains the actual guards/actions and requires the pinned package.

A deliberate capability refresh is separate from mapping it:

```sh
node demo/admin-intent-review/intent-model/inventory.cjs --write
node demo/admin-intent-review/intent-model/build.js
```

The inventory loader uses a temporary empty configuration, loads only the built-in registry, runs no tools, and removes the temporary home. Build and tests compare that snapshot against the actual current registry. A new capability must receive an explicit user-intent assignment before verification passes.

The model tests additionally introduce an unmapped tool and an unreachable state and assert that verification detects both. Safety checks cover file draft retention, fresh-link initialization, reader/admin boundaries, protected pushes, unknown effect outcomes, independent background lifetimes, cancellation cleanup, optional compaction and independent runtime proof.

## Scale contract for implementation

- Query indexed names server-side and return cursors. Render a bounded page; never embed every service, table, field, tool schema or job in the DOM.
- Subscribe once per authenticated scope and multiplex job events. Resume from a cursor; fetch bounded snapshots on gaps. Do not poll every row or resolve every Consul instance at startup.
- Keep only selected source branches expanded. Page wide children, cap traversal depth, and use references for cycles/repeated callees. Never interpret a truncated or missing branch as a removed path.
- Keep the initiating question, active step, failure and latest receipt in the conversation. Files and Background are compact drawers with filters and pinned selected items.
- Keep source/data pins, audience and execution ownership separate. Shared definitions are readable to authorized readers; publication is admin-reviewed; live results remain private.
- A new chat attaches to retained task/workspace/job IDs. Resource release and deletion are explicit operations; disconnection and navigation are not cleanup triggers.

The 10,000-service/1,500-field specimen verifies bounded rendering, not the speed or correctness of a production catalog server. The local static browser timings are fixture observations, not production performance claims.

## Meaning of “exhaustive”

The verifier explores **1,058 bounded actor configurations** across owner/admin and reader profiles and the supplied finite event payloads. It reaches all declared atomic states and selects every declared transition branch. Named cross-actor safety cases include all 495 selected navigation/job sequence interleavings.

This is **compositional model coverage**, not exploration of the unbounded Cartesian product of every actor instance, arbitrary text, external system and interleaving. Boolean expression MC/DC, live authorization enforcement, provider failures, database semantics, runner correctness and actual UI implementation require their own tests. Dynamic plugins/custom collections require a fresh inventory and intent mapping. The prior fixture exposed 318 enabled contracts because it added custom fixture tools; the isolated built-in inventory here has 316.

Hover, focus, scrolling and native disclosure mechanics are browser behavior, not separate backend job states. The real browser checks cover representative controls and keyboard behavior; there is no screen-reader certification, physical-touch test or full production integration sweep.
