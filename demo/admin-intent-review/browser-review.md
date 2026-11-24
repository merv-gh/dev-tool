# Browser follow-up: observed behavior and reproducible checks

This follows the independent A/B review. The user explicitly authorized installed local Playwright after native browser input stalled. All current-app actions use a disposable configuration and synthetic integrations. The proposal is a separate local simulation. Production code is unchanged.

## Current Admin: confirmed defects

The follow-up added **76 distinct screenshots across all 22 areas**, with **42 exact ledger states** referenced. It retained 45 step attempts: 30 verified, seven with reproduced defects, two observations and six historical harness failures with explicit resolutions or reclassifications. The [independent browser findings](browser-findings.md) describe that corpus; failed product behavior is not counted as acceptance success.

| Finding | Actual sequence | Result | Required fix |
| --- | --- | --- | --- |
| Unsaved Config is replaced | Edit Configuration JSON, then click the selected Config navigation tab | Server text replaces the unsaved draft without a discard dialog. No configuration was saved during this check. | Treat reselecting the current section as a no-op; guard every action that replaces a dirty editor. |
| Existing Sites cannot be selected by keyboard | Start from New Site and advance with Tab through the controls | Existing site rows are `div` elements with no button/link role or focus target. | Use native selection controls with meaningful names and a selected state. |
| Existing Views cannot be selected by keyboard | Inspect and try to focus the existing renderer row | The row has neither native interactive semantics nor `tabindex`. | Use a real link/button; retain keyboard focus when details update. |
| Fresh Workbench link hides the prepared form | Open a fresh tool-draft URL | The draft is prepared, then navigator initialization hides its composer. A same-document draft link makes it usable. | Initialize scope/navigation before preparing the linked draft; regression-test fresh and resumed links. |
| Fresh Map link hides an initialization error | Open a fresh `#map` URL | An empty-environment request fails and writes its message into hidden Context. Map remains blank; later navigation can load it. | Await environment initialization and render progress/error in the active Map area. |
| Renderer preview has no accessible name | Select a renderer and inspect its actual preview frame | `vwPrev` has no `title`. | Give the sandboxed preview a descriptive title. |

These are failed product behaviors reproduced by the browser, not passing acceptance checks. Other observations, capture failures, and fixture-only operations are reported separately in [the current-app execution record](admin-browser-verification.json). Baseline source findings remain in the independent report unchanged.

## Separate proposal: verified journeys

The retained [browser script](check-prototype.js) drives desktop (1440×1000) and phone (390×844) layouts with real locators and input. Its final [execution record](prototype-browser-verification.json) contains **27 successful assertion groups across five scenarios**, **34 screenshots**, zero JavaScript page errors and zero attempted external requests.

- A successful simulated transport remains separate from the failed name assertion. Empty data uses registry fallback, incomplete candidates stay inconclusive, and a connection failure has no current response/verdict.
- Changing prepared inputs clears the current verdict. Cancelling a local run preserves the previous observation; reload interruption is a different visible state.
- Every entry-to-exit node opens its own source. Guard, reason and audience survive a revision conflict and reload. Unsupported guard text is preserved but cannot execute.
- Saving a correction leaves the original source and response unchanged. Explicit selection and replay compute a new comparison. Offline assertions can pass while real integration/coverage remains Not run.
- Person and checkout drafts, source, notes, exports and callbacks stay task-scoped. Recovery is explicitly a finite local simulation; missing real documentation remains uncollected.
- Exported recipes run in the retained Node runner and remain task-specific. A shared snapshot opens read-only, cannot execute and does not replace the editable task.
- Config draft re-selection and reload retain the local draft. Keyboard tabs, field names, representative dark/reduced-motion states, and the phone task picker are exercised.

The browser pass caught a misleading notice in the proposal: explicit cancellation was described as “interrupted by reload.” It now reports cancellation separately, labels the previous result as retained, and checks both cases on both devices.

## Reproduce

Start the read-only review server, then run:

```sh
node demo/admin-intent-review/server.js --port 4100
# in another terminal
node demo/admin-intent-review/check-prototype.js
```

Requires installed Playwright and Chromium. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium. The script overwrites only its own report, proposal screenshots and ignored recipe downloads. It closes its browser contexts. There are no model, database, Docker, real workspace or production API effects.

For current Admin, start the disposable fixture with a new manifest path, run the separate script, then stop the fixture with Ctrl-C:

```sh
node demo/admin-intent-review/fixture.js 4112 work/admin-intent-review/new-browser-fixture.json
# in another terminal
node demo/admin-intent-review/check-admin.js work/admin-intent-review/new-browser-fixture.json
node demo/admin-intent-review/check-admin.js work/admin-intent-review/new-browser-fixture.json --followup
```

The second command appends the focused correction/recovery scenarios and fresh-link defect checks. This is an observation/capture driver, not a production release gate; inspect its classified assertions and capture failures rather than treating its process exit as product acceptance. The current-app script intentionally creates synthetic records and exercises saves/runs only inside this fixture. Do not point it at a real configuration. Its execution report separates verified defects, observations, scripted capture problems and missing integration states.

## Coverage boundaries

The original **239-scenario** ledger is frozen evidence, not a claim that every state passed. The state viewer adds exact browser references beside matching entries; no match means no additional proof. Current appearance, real gestures, synthetic execution, static source inspection and integration coverage remain separate.

This is not a user study, screen-reader certification, physical touch test, full dark-theme sweep, 200% zoom check, production scale benchmark, real Joern parsing, model evaluation or live environment execution. The proposal persists in this tab's sessionStorage only. Server/account/cross-chat durability remains a production requirement.

The earlier deterministic detector refused an unverifiable download. No detector pass, injected overlay, helper archive or trend comparison is claimed. The durable evidence is this folder's named reports and screenshots.

Questions skipped: the authorized browser follow-up, review plan and separate demo are complete; production implementation is a subsequent decision.
