# Separate Admin prototype — behavior review and fixes

Reviewed the proposal sources and the existing `screenshots/proposed/findings-desktop.jpg`. That image predates this behavior pass. This review exercised JavaScript and the offline runner in Node; it does not claim a browser click-through, keyboard audit, mobile validation or fresh screenshot verification. No independent Playwright session was used.

Changes are confined to `demo.js`, `engine.js` and `replay.js`, plus this requested report. No production Admin or CSS files were changed by this pass.

## Result

The demo now keeps two separate task records, preserves drafts through local navigation/reload, shows distinct source samples per selected node, and exports task-specific recipes. Saving a correction does not patch source, change an existing API observation or mark checks passed. A user must explicitly select the saved guard for an offline replay or verification run.

Persistence is **sessionStorage in this browser tab's session only**. It is not server, account, cross-chat or durable workspace storage. The header and rail say so. Reload restores local task drafts/results and interrupts pending local simulations; it does not invent a continuing background worker. Reset clears the demo's session record.

## Concrete findings and resolution

| Original gap | Implemented behavior | Verification |
|---|---|---|
| One mutable state object shared notes, corrections, statuses and export contents between person-service and checkout tasks. | Separate task records keyed by `PERS-218` and `SHOP-142`. Each retains its own selected scene/node, correction draft, notes/instructions, replay/check policy, results and local checkpoint. Navigation and reload restore the selected task. | Node session round-trip and render/handler checks; switching tasks while a local callback finishes preserves the other task's state. |
| Guard, reason and save scope were regenerated whenever source view rendered. Conflict text claimed preservation without retaining entered values. | Inputs update their task draft immediately. A conflict preserves all three values, names expected/current revision and displays the illustrative latest evidence before explicit draft retention. Arbitrary guard text is preserved but rejected for execution. | Engine conflict tests and render/handler test with a custom guard/reason/review scope across conflict, rebase, re-render and save. |
| Selecting a path node changed only the heading, while every node displayed the selection policy. Checkout source links also opened person-service code. | Entry, query, selection, mapping and exit each have different file/code/basis samples. Checkout has its own five samples and source references. | Node checks verify five unique samples per task and checkout entry content. |
| A saved correction automatically changed displayed source and the API/check verdict. | Original source and original retained observation stay unchanged. The correction is stored separately. Request, Checks and Handoff each expose an explicit policy choice; the supported saved guard is available only after a valid save. Checks initially say Not run and are computed only after Run. | Engine and render/handler checks confirm save leaves the original failed observation and unrun checks intact. |
| Empty and partial candidate states reused a stale assertion/response or displayed complete candidate rows. Connection failure still showed a current 200 result. | Empty data produces a coherent registry fallback and no selected document. Partial data displays one candidate and an inconclusive verdict. Failure produces no current response/assertion. Changing prepared scenario/policy clears the current verdict; any previous observation is distinctly labeled. | Engine scenarios, render/handler checks for preparation/empty/partial, and standalone recipe replay outcomes. |
| The overnight handoff displayed/exported the person-name task, source and assertion. | Checkout handoff names `SHOP-142`, `DEMO/checkout`, its retained notes/source references and missing documentation. Its recipe only checks checkpoint retention; it contains no person request/ID/contract. Runner rejects mismatched task/fixture scope. | Engine recipe scope checks, rendered checkout handoff check and standalone checkout recipe replay. |
| Worker controls appeared to start, retry or clean up an actual worker, while only changing labels. | Controls explicitly prepare and run a finite **local simulation**. Retry preparation shows the failed step/target; confirmation computes a local completion. Pause/resume/stop affect that local simulation and retain its task state. The real missing source remains unresolved after simulated recovery. | Source review plus render/handler callback isolation test. No actual worker, resource lease or cleanup is claimed. |
| “Read-only review URL” was editable when opened and did not carry a complete task snapshot. | Prepared URL carries a normalized task snapshot marked read-only. It opens without running anything or overwriting the editable local task. Edit/run controls are disabled; navigation and export remain available. A copy button has a selectable-URL fallback. | Node normalization and read-only rendering check; actual browser clipboard behavior remains unverified. |
| Config reopen and several selectors implied capabilities that were not connected. | Config reopen really re-renders the stored browser-session JSON draft. Configuration activation/validation/index refresh are explicitly unavailable. Request target is a disabled fixed-fixture selector rather than an unimplemented custom HTTP target. | Source review and engine persistence round-trip. |

The exported runner uses a fixed embedded fixture, a boolean supported policy and explicit expected value. It rejects modified fixture identity/data, unsupported arbitrary guards, malformed recipes and mismatched task scope. It never evaluates JavaScript/code from a recipe or guard.

## Checks performed

- `node --check` on all three changed JavaScript files: passed.
- `node demo/admin-intent-review/replay.js --self-test`: **14 check groups passed**. This is retained in the runner for repeatability. Covers original/corrected selection, partial/error/empty data, coherent name parts, distinct source samples, correction conflict/policy handling, task/session isolation, reload interruption, blocked/corrupt storage, recipe scope, changed expectations, incomplete checkpoint and invalid fixture/guard rejection.
- A temporary Node VM render/handler harness: **9 check groups passed**. Exercises the actual `demo.js` handlers and generated markup with a minimal document stub: exact draft preservation, unsupported guard rejection, save without source/result mutation, task-specific handoffs and notes, reload retention, prepared/empty/partial comparisons, task-isolated completion callbacks and read-only review rendering. This is JavaScript logic evidence, **not browser DOM/accessibility validation**. The temporary harness was removed after the run.
- Standalone `replay.js` child processes with exported JSON: **6 cases passed**. Original selection exits 1 with failed assertion; saved policy exits 0 with passing assertion; partial exits 1/inconclusive; transport error exits 1/not-run; checkout checkpoint exits 0/checkpoint-retained; malformed recipe exits 2. Temporary recipe files were removed.

The production test suite/build was not run for these isolated demo-only changes. No production bundle needed rebuilding.

## Remaining limits

- All samples are illustrative. There is no HTTP/database/model/Joern/Gradle/JUnit process, source patch, real requirements collection, server task persistence, authentication, admin review queue, lease or runtime coverage. A passing fixture case is not integration proof.
- The app supports two fixed tasks, five source nodes per task and one supported correction policy. It does not create arbitrary tasks, accept arbitrary request targets or execute arbitrary guard code.
- Concurrent-edit conflict is a deliberate local scenario with a simulated revision note. It demonstrates recovery interaction, not distributed concurrency behavior.
- A local documentation-recovery completion never resolves the actual external documentation gap. Checkout exports retain that distinction.
- Review links contain the task's local note/draft/snapshot in the URL. They are finite review artifacts, not permission-bearing server links. Very large snapshots can exceed practical URL limits; no server-backed share store is implemented.
- Browser storage can be blocked, cleared or lost when its tab/session ends. The UI reports storage failure and remains memory-only; there is no account-level recovery.
- Real browser layout after these changes, clipboard/download behavior, focus order, screen-reader announcements, 200% zoom and mobile composition still require the parent's final browser pass. The existing native viewport limitation must not be reported as successful phone verification.

The task-first composition should be judged with these limits visible. Its key proof is continuity of task identity, evidence and recovery decisions; it does not demonstrate production infrastructure capabilities.

## Authorized browser follow-up

The later [browser follow-up](browser-review.md) supplies real Playwright gestures, desktop/phone screenshots, read-only snapshot checks and downloaded-recipe replay. Those observations are separate from this original Node review. The final browser pass also distinguishes explicit cancellation from reload interruption and labels the preserved observation accordingly. Production source remains unchanged.
