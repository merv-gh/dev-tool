# Earlier Admin proposal: review and improvement plan

Superseded direction: use the [minimal conversation-first plan](minimal-plan.md) and its [XState intent model](intent-model/index.html). Findings below remain relevant; the four-destination proposal is retained for comparison.

Method: two isolated reviews (design: `/root/admin_design_review`; evidence: `/root/admin_evidence_review`), combined after the design assessment finished. Baseline: `5a8ba08`. Scope is the current Admin and its embedded applications, with a separate proposal. Production UI has not been changed.

The interface exposes capable tools, but asks the user to organize an investigation using the tool's internal structure. The priority is a continuous task with a visible question, evidence, next action and outcome. Shorter navigation alone will not solve this.

## Main findings

| Priority | Finding | Evidence | Consequence | Proposed change |
| --- | --- | --- | --- | --- |
| P1 | Task identity is fragmented across chat/story, context, continuation, workspace and task run | Workbench, Context and Studio captures; source review | A user cannot readily tell what survives a new chat or where new evidence will go | One task header maps the existing identities; show retention and audience without changing backend isolation |
| P1 | A question becomes a generated API schema | Joern screenshot is 6,147px high; selected panel exposes 62 form fields | A user must understand endpoint representations before asking a question | Analysis/revision picker, one question, two typed endpoints; selector alternatives and output limits under Advanced |
| P1 | Wrong-data investigation crosses disconnected applications | API, Context, passport, map, semantic and coverage captures | Users re-enter identifiers and reconstruct evidence relationships | Carry record, environment, source pin and evidence references through request → rows → source → independent check |
| P1 | Invocation status competes with task/application outcomes | Runtime and History screenshots; source-only execution paths | A completed call or HTTP 200 may look like a verified answer | Distinguish call completion, transport status, assertion verdict, coverage and task readiness |
| P1 | Config re-selection can replace an unsaved draft | Actual Playwright edit → selected Config click; draft replaced without a dialog | Reproduced draft loss | Make current-section selection a no-op; reuse one dirty guard for all replacing loads; regression-test the sequence |
| P1 | Fresh shared work URLs can hide the action or its error | Actual fresh Workbench draft and Map URL interactions | A recipient sees a blank area or cannot run a prepared draft | Initialize environment/scope first; restore linked form last; keep progress/error in the active area |
| P1 | Existing Sites and Views rows are click-only | Actual keyboard attempt and DOM semantics; no focusable row | Keyboard users cannot select existing entries through native controls | Real links/buttons with selected state and visible focus |
| P2 | Draft, save, correction and publication targets vary | Context file dirty cue beside Save context; architecture/project editors | Users must infer which object is being saved and who can read it | Local file save bar, separate metadata dirty cue, explicit private draft → reviewed publication |
| P2 | Nested applications repeat scope and headings | Studio, Pages, API and Reflection captures + iframe source | Navigation and scroll/focus cost hide the work | Compose trusted applications within one shell; retain sandboxed frames for untrusted result HTML |

The independent design score is **23/40**, a qualitative heuristic assessment, not measured usability. The deterministic detector could not run: its launcher refused an unverifiable engine download. There is no clean-scan or overlay claim.

## What to retain

Retained results and immutable source pins; read-only opening versus explicit execution; revision checks and preserved drafts; assumptions separate from observations; original detections separate from manual corrections; admin-only shared publication; private per-user execution; explicit compaction; cancellation through cleanup; direct expert tools and exact JSON. Reducing clutter must not erase any of these.

## Proposed navigation and continuity

| Destination | User's question | Existing surfaces retained within it |
| --- | --- | --- |
| Tasks | What am I trying to do, what happened, and what follows? | Conversation, task/context files, continuation, linked workspace, requests, checks, runs and handoff |
| Services | What is this service and how does it connect? | Passport, live discovery, architecture, ports, source paths, usage and deployment observations |
| Library | What can I reuse or share? | Context knowledge, scripts/collections, saved API workflows, executable pages, named recipes and evidence |
| Operations | Is the harness working and how is it configured? | Index freshness, connections, tools/plugins, runtime/model telemetry, jobs, supervisor and renderer customization |

Services and Library can work independently, or attach an item to the active task. Expert search and old URLs remain available. Do not combine different owners' records or silently promote a chat-local result into shared knowledge. The task is a UI composition over the existing durable contracts, not a new global bag of state.

Every work area should show task, evidence destination, environment, selected service/repository, exact source revision where relevant, freshness, and audience. A link to saved evidence must reopen it without running tools. Live re-observation is a separate action.

## Reviewable demo

Open `demo.html` using the local server. All values and executions are explicitly illustrative. No production tools, network services or model calls run from the proposal. The source uses the existing system font, neutral surfaces, accent and status vocabulary.

| Story | Before evidence | Proposed interaction | Reason |
| --- | --- | --- | --- |
| Start or resume | Workbench, Context, Studio | A task picker, four outcome-oriented starting intents and one retained task identity | Closer to the user's question; no tool-name recall needed for the first useful action |
| Explain a wrong API name | API explorer + semantic form | Response beside candidate rows, eligibility reasons and whole-name assertion | Puts the actual/expected discrepancy where the data can explain it |
| Inspect and correct a near miss | Joern form + project editors | Click an entry-to-exit node, inspect its source and assumptions, save a reasoned private correction | Narrow question inputs; source and correction in the same view |
| Verify a fix | Runtime + generic test components | Failed assertion first, passing detail collapsed, real coverage explicitly unrun | Reduces transient output without hiding errors or inflating proof |
| Return after overnight work | Runtime/History/Jobs | Latest checkpoint, retained successes, failed source and explicit step retry | Answers “what happened?” before showing raw lifecycle records |
| Share | Context + scripts + results | Named recipe, retained source identity, note, no-execution review link and offline replay | Reproduction is a visible outcome instead of assembling fragments manually |

This is a composition comparison using the same class of workflow. The current checkout fixture and proposed person fixture contain different illustrative data; do not interpret their screenshots as a same-data performance benchmark.

## Implementation sequence

### First: fix clarity and draft hazards in place

- Make fresh Workbench/Map links wait for scope/environment initialization. Keep the prepared form visible and errors in the area that initiated the request.
- Guard reselect/reload/scope changes consistently, including Config. Preserve file and correction drafts on conflicts and failures.
- Add native selection controls to Sites/Views; purposeful labels to filters, Configuration JSON and repeated endpoint groups; a title on renderer previews; live save/error announcements.
- Replace the semantic default with operation-specific endpoint forms. Keep the Run action near the primary inputs. Retain exact JSON and the complete tool schema as optional inspection.
- Put a local progress/result strip beside the initiating action: current step, elapsed time, scope, cancel where supported, original receipt, retry policy and cleanup state.
- Repair empty/misleading showcase fixtures, especially UI-trace counts with no nodes and path-trace samples with no supported path. Include honest populated, empty, partial and failed examples for every result family before using the showcase as release evidence.

Acceptance: fresh shared Workbench/Map URLs open a usable form/result or a visible scoped error; keyboard-only selection works; unsaved Config survives reselecting Config; a novice can prepare a path between two symbols without traversing unrelated selector fields; failure and partial data remain visible without opening Runtime.

### Next: implement one full task journey behind an additive route

- Resolve the task's current story/context/continuation/workspace links once and display them in Details. Keep old routes and storage formats working.
- Open API + database inspection from an identified symptom/record. Reuse existing request and mapping tools, including candidate completeness and coherent-row selection semantics.
- Attach source/Joern evidence to the same investigation, preserving exact revisions, library gaps and assumptions. Read source beside corrections.
- Keep file saves local to the selected file, and tool results titled by the question answered. Persist selected evidence and drafts across navigation/reconnect.

Acceptance: follow person ID from HTTP response to raw rows to selection policy to independent HTTP assertion without copying it between apps. Reopen the task in another chat with the same owned files, worktree, evidence and source pins. Another user must not inherit its private results.

### Then: unify attention, recovery and handoff

- Task activity leads with active step or blocker. Runtime and Jobs become drilldowns with one execution link, trace correlation and cancellation vocabulary.
- Retain successful steps on read failure. Unknown acknowledgements require observation/resolution, not automatic effect replay. Cleanup failure remains a distinct state.
- Build a named handoff from the existing recipe/workflow/result contracts. Include source and index revisions, concrete inputs, environment/binding references, inherited settings, assertions, result hashes, timestamps and unresolved prerequisites. Keep credentials as references.

Acceptance: returning users can distinguish failed/unknown/running/cancelling/cleaning/completed work; opening a handoff has zero execution effects; a recipient can reproduce a pinned case using their own access; shared publication remains admin-reviewed.

### Finally: consolidate the remaining areas

Move the remaining surfaces under the four destinations only after task continuity works. Use the independent 22-area matrix and state ledger for each migration. Keep specialist direct links until equivalence is demonstrated. Adapt phone layouts for monitoring/review; desktop editors need purposeful compact layouts rather than shrinking every control.

## State and component acceptance contract

Every family needs default, selected, empty, loading, validation error, running, cancelling, cleanup, success, failure, partial/unknown, read-only, dirty, revision conflict and saved states where applicable. Not every component needs every state. Each state has a cause, visible explanation, primary recovery action, retained-data rule, accessible announcement and resumable URL.

The [239-scenario ledger](state-inventory.json) explicitly separates captured observations from source-only or backend-dependent states. The [browser follow-up](browser-review.md) adds verified gestures and reproduced defects without rewriting the independent baseline. The current screenshot gallery includes all 22 areas and all 37 built-in renderers (36 samples and one local registry snapshot); that is **not exhaustive all-state coverage**. Missing successful/error/cancellation/permission integrations need deliberate fixtures before production rollout. A gallery image is not a passing interaction test.

Verification for production: developer/tester/power-user task walks, 1440px and 390px layouts, keyboard and focus order, 200% zoom, representative dark/reduced-motion states, real private-owner separation, refresh/reconnect, no hidden model calls, preserved drafts and existing tools/URLs. Measure completion, wrong turns and recovery with actual users before claiming speed or usability improvements.

Questions skipped: the requested separate demo and plan are supplied for review; production implementation remains a subsequent decision.
