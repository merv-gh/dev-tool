# One task conversation

**Implemented scale revision:** the [researched workbench direction](../production-scale-research.md) now runs here with the shared production Monaco/Explorer and focused path components. Read the [current implementation and limits](../../../docs/code-workbench.md) and [current browser record](workbench-evidence/verification.json). Earlier screenshots and verdicts below remain historical evidence for the preceding composition.

Interactive UI model derived from the [135-intent XState map](../intent-model/README.md). It replaces the earlier four-destination proposal. Start the review server, then open [the conversation](http://127.0.0.1:4100/conversation/index.html):

```sh
node demo/admin-intent-review/server.js --port 4100
```

The conversation remains a synthetic browser-local prototype and makes no tool/model calls. This iteration also changes the real `/editor` and semantic trace renderer through shared components. Monaco and Headless Tree are pinned build dependencies and vendored runtime assets. The separate browser verifier uses a disposable real checkout and HTTP server; it does not contact a production environment or establish release readiness.

Read the [rollout plan](implementation-plan.md), [local composition notes](design-notes.md), [intent-to-UI bindings](intent-bindings.json), [browser evidence](browser-verification.json) and [final independent verdict](independent-verdict.md) alongside the prototype. The [original assessment](independent-review.md) is retained as review history. The existing production defects remain outside this change.

## The interaction model

Keep the task as the stable unit. The conversation, workspace, retained files, selected environment and independent jobs stay together. A user can investigate, correct, test and retain evidence in one conversation, with optional details alongside it. Opening a file, source branch or receipt never runs an action.

| User intent | Immediate interaction | Detail only when needed |
| --- | --- | --- |
| Continue work | Select a recent task or search by ticket | Retained scope, checkpoint and execution IDs |
| Understand a result | Response, raw rows or a concise failed assertion in the timeline | Exact inputs, provenance, elapsed time and raw receipts |
| Find the next step | Two contextual actions near the result and composer | One searchable finder covers all 135 intents and exact tool names |
| Trace a field | Open focused path steps beside the conversation | Search, Callers/Callees, source peek, evidence and a collapsible vertical route |
| Change a finding or source | Open the relevant file beside the evidence | Separate file Save, revision conflict comparison and terminal preparation |
| Verify the fix | Run the visible saved revision directly | Configure target, arguments and failure scenario through the action finder |
| Guide running work | Use the still-active composer | Current-turn Stop and independent Background controls |
| Resume unattended work | Read the checkpoint and blocker in the conversation | Pause/resume/stop acknowledgements, budget and owned execution ID |
| Share | Name and copy a read-only review | Export a fixed-fixture recipe; execution is a separate decision |
| Operate the harness | Find the intent without moving away from the task | The initial prototype prepares the mapped model journey; production editors stay a later adaptation |

A click on a known read or “Run regression” is already an execution instruction: no redundant confirmation. Unknown scope, edited arguments and effects such as pushes use a prepared action with an explicit Run. Destructive, privilege and publication rules remain in the underlying model and must be enforced by the production backend.

## Review the complete flow

1. Compare raw rows in PERS-218. The newer annulled document matches the wrong response.
2. Trace the mapping. The focused working area opens beside the conversation. Search a field or inspect the current step and its callers/callees. Open pinned source, then its workspace copy.
3. Edit selection policy beside that path. Insert the supported annulment guard and save the file.
4. Run the saved regression. The fixture assertion passes and collapses. The receipt explicitly keeps real integration and coverage as **not run**.
5. Share the retained investigation. The review link opens read-only and sends no execution request.

The previous composition’s recorded main journey took **eight clicks** at both 1440px and 390px: Compare rows → Trace → Edit policy → Insert guard → Save → Run → Share → Copy. It requires zero top-level navigation and zero scope reselections. Optional deeper source inspection is excluded. No comparative production click baseline or claim of universal UX optimality is implied.

Optional paths exercise dirty drafts, simultaneous task buffers, concurrent save conflicts, editable arguments, failure, partial evidence, missing acknowledgement, cancellation/cleanup, steering, explicit compaction discovery, connection recovery and retained overnight work. The action finder offers every mapped intent without showing 135 tiles on arrival. The bindings distinguish **16 interactive synthetic fixture intents** from **119 generic prepared-action/model-receipt intents**. Preparation and an executable expected-model endpoint establish discoverability and lifecycle coverage; production forms and backend outputs for those 119 remain rollout work.

## Scale contract

The focused path browser searches a 50,000-node synthetic graph, including 1,500 fields, 200-step paths, shared callees and cycles. It shows bounded neighbor/search lists. The Explorer searches 20,000 generated file paths and loads only opened file contents; its DOM is virtualized. The service finder searches a generated 10,000-service fixture, with at most 25 visible options. Action results are also paged at 25; tool autocomplete does not inject the entire catalog into the page.

For production, task search and file trees must use backend indices/cursors, conversations must window old messages, and event subscriptions must be scoped to the owned task. Use one resumable event stream; never poll each job or hydrate every Consul instance to open chat. The prototype's 40-message render window, browser-local retained history and search are **not** production infrastructure benchmarks.

## Persistence and sharing boundaries

The proposal uses a namespaced localStorage record. It restores task-isolated file actors and drafts across reloads and tabs on this browser profile. It is not cross-user/server persistence, has no concurrent-tab merge, and is not suitable for private production results. Reset clears only this prototype record. When storage is unavailable, the footer offers **Export recovery**; the same full task backup is available in Share.

| Artifact | What it preserves | How to use it |
| --- | --- | --- |
| Export task recovery | Selected task's saved files, dirty file buffers, composer text, retained history and state snapshots | Import from Model context. Creates a separate recovered task and preserves the original. It does not execute a recipe. |
| Export recipe | Current saved policy and the fixed synthetic fixture | Run with `replay.cjs`. Dirty buffers, arbitrary task files and conversation recovery are outside this artifact. |
| Export checked recipe | Source text and revision pinned to a specific check receipt | Run with `replay.cjs` to reproduce that admitted revision, even if the editor has since changed. |
| Copy review link | Read-only synthetic snapshot with saved files and the latest 20 messages | Open to inspect. The URL runs nothing and is not a full history backup. |

Jobs and accepted local action timers have task lifetimes, independent of the currently visible conversation. Closing the browser stops this simulation; returning reconciles an accepted action instead of silently sending another one. Production execution must continue on the server. The prototype's named review URL embeds only its synthetic snapshot and cannot provide a durable, short team URL. Production should use `/show/<name>` with revisioned definitions and access-checked private execution results.

An accepted check pins source text and revision at admission. Saving a newer file while it runs cannot change the tested candidate; an older receipt is visibly stale against the current revision. The DOM shows at most **40 messages** at a time while retaining the full prototype history. Earlier-message navigation and direct recall reopen old rows and source paths. This browser-local archive remains bounded by browser storage capacity.

The exact source specimen and fixed fixture support two policies (original and guard inserted). Other edits are retained and produce an inconclusive check rather than a false pass. The offline recipe is deterministic and rejects changes to its independent expected result. It does not compile Java or query Postgres.

## Evidence and reproduction

The previous [browser record](browser-verification.json) passed **19 check groups** and contains **19 captures**, all 135 findable/prepared intents, the two eight-click journeys, and SHA-256 hashes for five source/bundle files. It records no page errors or forbidden requests. Named checks include full draft recovery/import, retained evidence after 150 additional messages, revision-pinned receipts, the phone Tasks drawer, and a keyboard edit/save/run flow. These are scoped synthetic gestures, not 135 end-to-end production workflows.

The Node run passed **30 tests**: 18 model and 12 store tests. The [final independent verdict](independent-verdict.md) resolves all five prototype findings and accepts the composition at this synthetic-prototype scope. It does not approve production rollout. No full screen-reader, zoom, physical-touch or mobile virtual-keyboard session is claimed.

Run the server in another terminal before the browser check:

```sh
npm ci --prefix demo/admin-intent-review/intent-model
node demo/admin-intent-review/conversation/build.cjs
node --test demo/admin-intent-review/conversation/store.test.cjs
node --test demo/admin-intent-review/intent-model/model.test.cjs
node demo/admin-intent-review/conversation/verify-workbench.cjs
# check-browser.cjs and its manifest document the previous textarea/tree composition.
node demo/admin-intent-review/conversation/replay.cjs path/to/exported-recipe.json
```

The build uses the existing root esbuild installation and the isolated pinned XState dependency. The current browser verifier uses installed Playwright/Chromium and writes scoped screenshots and interaction evidence. Its editor section exercises a disposable real checkout and backend; its conversation section remains synthetic. The older browser script and source hashes describe only its earlier frozen composition. Bundled XState's license is in [THIRD-PARTY.md](../intent-model/THIRD-PARTY.md).

See [the rollout plan](implementation-plan.md) for the transition from this model to production.
