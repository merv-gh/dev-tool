# Review → prototype → review → implementation

The user confirmed a conversation-first task view with tool work in the timeline
and files, checks and model context alongside. The implementation preserves the
established shared visual system and existing durable task contracts.

## Initial independent review

Design review and browser/detector assessment ran independently before synthesis.
The design assessment scored the old screen 21/40 across the ten Nielsen
heuristics. Both assessments observed the hidden final answer, reverse-order
lifecycle noise, separated steering, lengthy setup and mobile navigation pushing
the actual task below the first screen. See the [review and plan](README.md).

The detector was attempted once and refused an unverifiable engine download.
No clean automated design scan or injected overlay is claimed. Browser evidence
uses fresh headless Chromium sessions because the native in-app browser was
unavailable. These are synthetic service/model fixtures, not production evidence.

## Prototype review before implementation

A separate static, browser-local demo proved the layout and four states. Its
independent reviewer accepted the composition and requested three corrections:

| Correction | Verification | Outcome |
| --- | --- | --- |
| Returning on mobile must reveal latest findings | Initial latest position and live Jump to latest control | Resolved |
| Context-limit recovery needs an actionable path | Direct Context control, nonempty checkpoint then explicit Resume | Resolved |
| Inspection must preserve its origin | Source button → inspector focus → original source button | Resolved |

The reviewer marked all three resolved before production implementation began.
Run `node demo/task-chat/check.js` against the local prototype server to reproduce
its state, receipt, correction, pause, navigation and overflow checks.

## Production review

The fresh finish reviewer checked actual production source and eight loaded
captures: 1440px and 1280px desktop, 390px conversation and creation, evidence,
memory, budget-stop and dark mode. The initial dark capture was taken during
the shared control transition; a settled capture replaced it. This was capture
timing, not a change to global theme tokens.

The reviewer identified one material defect: live list refresh recreated focused
inbox buttons. Keyed reconciliation now retains the actual button node. The
browser regression focuses a task, performs a read-only status refresh and
verifies the same node remains focused. **Final disposition: ship; 1/1 material
fixes resolved; all eight supplied views valid.**

## Native results and persistent composer

The follow-up keeps tool-specific renderers in expandable saved results and the
receipt inspector. Structured rows use a table; other structured values use a
JSON tree when there is no native view. Owner-scoped retained copies survive
ordinary cache pruning. Asynchronous tools keep their native renderer with the
completed evidence. Raw inputs and results remain available without replay.

The composer stays editable during work and inspection, including on a phone.
After a run ends, **Prepare follow-up** copies the typed goal and retained task
scope into a reviewable next-run form; only Start admits a model request.

A fresh independent finish review initially requested a mobile recapture: the
iframe had not painted after a viewport resize. Waiting for the retained row
and a paint produced valid evidence without a source change. The browser
regression now checks that row after resize and captures both inline and
inspector views. **Final disposition: ship; all required captures valid; no
material fixes requested for this extension.** The original prototype remains
frozen; these additions are demonstrated by the actual application.

## Real application verification

The browser journey uses the actual server, tool registry and persistent storage:

- Create through the form, pause, save a correction, receive acknowledgement,
  resume and finish with actual assistant messages and retained evidence.
- Inspect original receipt inputs/results; return to the invoking control.
- Read older messages, jump to latest, and preserve expanded raw evidence and
  keyboard focus across refreshes.
- Edit task memory, provoke a concurrent revision conflict, manually reconcile
  and reopen the saved note from another page without a model request.
- Inspect the actual outgoing request without credential leakage and verify the
  passive inline snapshot.
- Start a goal-only task, reach its real step budget, preserve literal HTML as
  text, and prepare a new retained-memory run without executing it.

The backend regressions verify bounded actual assistant text with a truncation
flag, retained full messages, paired tool call identities/timing, and explicit
context checkpoint/recovery without a model call. Existing ownership, revocation,
restart, watch and publication tests continue to pass. No production model,
Confluence, Jenkins or Bitbucket success is inferred from the synthetic demo.
