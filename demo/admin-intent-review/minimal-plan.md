# Revised direction: conversation, files and background work

The [production-scale research revision](production-scale-research.md) now supersedes this plan’s narrow Files inspector and unbounded flow indentation. Keep the lifecycle work; use a resizable editor workbench and depth-independent focused path navigation. This earlier plan superseded the four-destination UI proposal. Keep one task conversation as the main screen. Put Files and Background beside it as optional drawers. Reuse compact result receipts and the editor/terminal; avoid a custom application for each tool. Use the [intent statechart](intent-model/index.html) as the lifecycle contract and the [conversation prototype](conversation/index.html) as the interaction contract. See its [complete-flow rollout plan](conversation/implementation-plan.md).

## First: validate intent and interaction coverage

The separate XState model contains 135 user intents, explicitly maps all 316 built-in tools and 20 existing workbench intents, and assigns all 239 prior Admin states as design obligations. Twelve hierarchical actor families expose the lifecycle without a giant all-object canvas. A selected intent highlights its own states; other branches collapse or hide.

The model checks all 290 declared atomic states, 704 transition branches and 897 modeled journeys. It also checks draft safety, ownership/publication boundaries, independent background lifetimes, unknown acknowledgements, cleanup, explicit compaction and independent proof. The source inventory check fails on unassigned new capabilities. These are design-model checks; production defects remain unfixed at this stage.

## Then: one thin production shell

- Reuse the existing task conversation, persistent composer and retained native result renderers. Keep the next useful action beside the relevant result. Group transient tool receipts and passing checks in collapsed disclosures.
- Files is one searchable/paged task/workspace tree with local file Save, dirty state, conflict recovery and clear location. Terminal/editor belongs to the selected workspace. Metadata save and shared publication remain separate.
- Background shows owned active, waiting, blocked and failed jobs first, with current step, last checkpoint, elapsed time, resource ownership and explicit controls. Navigating away does not stop work.
- Source investigation uses a flat selected entry-to-exit path plus focused callers/callees, precise source/data correlation and searchable ancestry. Limit local indentation; deeper navigation changes focus. Search fields and call sites directly. Keep assumptions and evidence gaps local to the selected item.
- Use a single action lifecycle for indexed selection, optional exact arguments, explicit execution, progress, result, partial/error/unknown outcomes and cleanup. Opening saved evidence never executes it.

Fix Config draft loss, Sites/Views native selection, preview naming and fresh Workbench/Map initialization as part of adapting their flows to this shell. Do not carry their hidden-error or reselect behavior into the new composition.

## Roll out by complete flows

Start with resume task → investigate wrong API field → inspect raw rows → follow nested source path → edit → run independent regression → retain/share evidence. Next add overnight collection and the task-branch/draft-PR/build/review loop. Keep old URLs/tools available until their full interactions are represented and verified.

Acceptance: a fresh link restores the intended owned task and visible action after scope initialization; dirty files survive navigation/reconnect; saved tasks attach across chats; jobs continue independently; failures appear where work started; test success remains separate from coverage/proof; shared review links have no execution effects.

## Production scale gates

Use server-side indexed search/cursors, bounded lists, lazy details and one scoped event stream. Keep workspace/source revisions and result ownership pinned while data refreshes. Do not hydrate every service, expand every path, poll every job or fetch all Consul instances to open a conversation.

The interactive specimen pages through 10,000 services and a 1,500-field result while rendering only selected branches/pages. It is a UI contract specimen, not a production benchmark. Backend load, real reconnect/ownership, large catalogs and real outside-in runner paths need measured integration evidence before rollout.
