# Conversation-first task desk

This folder records the requested sequence: review the current UI, make a plan,
review a separate interactive demo, then implement the reviewed design in `/tasks`.

## Review of the current screen

Two independent assessments used current source and separate headless browser
sessions at 1440px and 390px. The native in-app browser was unavailable. The
Impeccable detector was attempted once but refused an unverifiable engine download;
there is no deterministic scan or live overlay claim. Review baseline: `c58e451`.

| Problem | Observed evidence | Intended change |
| --- | --- | --- |
| The work has no readable story | Four source tools produced 18 reverse-order lifecycle rows | Chronological conversation; group routine work |
| Status does not explain the current action | Generic working text above a budget counter | Actual active tool, wait or blocker, and a next action |
| The answer is hidden | Completed report starts collapsed under scope metadata | Show the final response in the conversation |
| Correction is detached from evidence | Steering is on Brief; activity is elsewhere | Persistent composer and pending/applied acknowledgement |
| Setup dominates the task | 16 visible data controls; Start below the first desktop viewport | Goal first; optional scope and advanced settings |
| Mobile starts with navigation | Selected task title starts around y403 | A collapsible task picker; conversation first |
| Evidence requires navigation | Raw result is in a UUID-based memory path | Inspect the original tool receipt alongside its conversation row |

Independent design heuristic score: 21/40. Scores in Nielsen order:
2, 2, 3, 3, 3, 1, 2, 1, 2, 2. Keep durable execution, owner isolation,
revision-protected memory, explicit compaction and exact-revision publication gates.

## Confirmed brief and implementation plan

The user confirmed: **conversation first, details alongside**. This is an Operate
surface for developers leaving autonomous work and returning to understand or
correct it. Keep the shared `web/ui.css` color, type and control vocabulary.
Change the task composition rather than the rest of Admin.

Happen is the interaction reference: projects/conversations, grouped tool activity,
inspectable context, a task-local composer and interruption. See its
[repository](https://github.com/meoyawn/happen) and
[conversation implementation](https://github.com/meoyawn/happen/blob/master/packages/desktop/lib/conversation.dart).
This is a native web implementation using our existing task APIs, not a Flutter
dependency or a claim of complete Happen parity.

1. Prove the structure in the offline demo below. Review working, CI wait,
   needs-attention, completed, evidence inspection and mobile navigation.
2. Keep a compact task inbox and one chronological conversation. Group successful
   source/tool work, render actual model text, and surface failures without opening
   hundreds of lifecycle entries. Never invent an agent explanation from a tool name.
3. Put readable current state, Pause/Resume/Stop and the composer next to the work.
   Saved steering must be distinguished from worker acknowledgement. A finished run
   continues through an explicit new-run preparation with retained memory.
4. Use an optional side inspector for scope, files, checks, receipts and the exact
   model request. Load large receipts only on request. Preserve unsaved drafts,
   revision checks, focus, disclosures, scroll position and private links.
5. Progressively disclose source and budget setup. Publication and execution
   permissions remain explicit. Deep links and reopening are read-only.
6. Verify real task creation/reconnect, steering, wait/failure/terminal behavior,
   receipt inspection, retained-file conflict handling, keyboard/mobile/dark mode,
   no surprise model calls, and bundled assets. Independently review the result.

### First viewport contract

At desktop size, the inbox takes roughly 230px, the readable conversation fills
the center, and a 340px inspector opens when requested. The task title and actual
state remain above the conversation. The latest finding is text, not a metric.
The composer stays at the bottom; earlier content is not displaced by refreshes.
On a phone, Tasks and Details are explicit views with return controls; the task
conversation remains the initial view. No fixed overlay covers the composer.

Signature interaction: select a compact tool row to inspect its exact retained
receipt beside the finding; close the inspector and continue the same conversation
without losing focus or replaying the tool. Motion is limited to state feedback;
reduced-motion users get the same complete information.

## Run the separate demo

```sh
node demo/task-chat/server.js
# http://127.0.0.1:4089
```

Choose Working, Waiting for CI, Needs attention, or Completed. Expand tool work,
inspect a receipt, switch inspector tabs, send a local correction, pause/resume,
and try the task picker at phone width. All data and actions here are synthetic
and browser-local. It never calls a model, executes tools, publishes knowledge,
or modifies a workspace. Reload resets the scenario.

Run the browser checks against that server:

```sh
node demo/task-chat/check.js
```

## Evidence and outcome

The [review record](review.md) covers the initial independent assessments, the
three resolved prototype findings and the production finish review (**ship**).

| View | Before | Reviewed prototype | Implemented app |
| --- | --- | --- | --- |
| Desktop | [Run inspector](screenshots/before-desktop.png) | [Conversation](screenshots/prototype-desktop.png) | [Actual task conversation](../../docs/screenshots/task-desk.png) |
| Mobile | [Navigation above task](screenshots/before-mobile.png) | [Latest finding](screenshots/prototype-mobile.png) | [Latest saved response](../../docs/screenshots/task-conversation-mobile.png) |
| Evidence | Separate activity and file views | [Receipt alongside](screenshots/prototype-evidence.png) | [Original tool receipt](../../docs/screenshots/task-evidence.png) |

Prototype states: [CI wait](screenshots/prototype-waiting.png),
[attention recovery](screenshots/prototype-attention.png),
[completed](screenshots/prototype-completed.png),
[mobile details](screenshots/prototype-mobile-details.png).
The prototype is frozen design evidence with synthetic local actions; `/tasks`
uses real server APIs. App screenshots also use synthetic upstream services,
but task execution, persistence and revision checks are real.
