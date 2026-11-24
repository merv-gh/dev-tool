# Admin intent review and separate proposal

Latest implementation: [Monaco and focused paths](../../docs/code-workbench.md), with [current captures and checks](conversation/workbench-evidence/verification.json).

Design basis: [production-scale editor and flow research](production-scale-research.md), with [fresh independent information review](scale-information-review.md). The narrow Files pane and unbounded nested flows below are now comparison evidence.

Previous interactive direction: [one task conversation](http://127.0.0.1:4100/conversation/index.html), with its [interaction and evidence guide](conversation/README.md), [production rollout plan](conversation/implementation-plan.md), [local design notes](conversation/design-notes.md) and [135-intent XState map](intent-model/README.md). The earlier multi-surface proposal below is retained as review history.

Review baseline: `5a8ba08`. The original review was read-only. The current implementation changes the production editor, file navigation API and semantic path renderer; the conversation shell remains a separate fixture.

## Open the review

```sh
node demo/admin-intent-review/server.js --port 4100
# http://127.0.0.1:4100
```

The server is read-only and binds to localhost. Stop it with Ctrl-C. Open [the conversation](http://127.0.0.1:4100/conversation/index.html) for the current proposal or [the gallery](http://127.0.0.1:4100/) for the full review. The gallery uses retained captures; the current-app fixture is not needed to read the review or use the proposal.

The conversation is a separate synthetic UI model: 16 intents have interactive fixtures; 119 use a shared prepared action and executable model receipt. All 135 are discoverable. No production tool call, backend persistence or real integration is implemented by this prototype. Its [browser record](conversation/browser-verification.json), [final independent verdict](conversation/independent-verdict.md) and [intent bindings](conversation/intent-bindings.json) define the evidence scope. All five prototype review findings are resolved; the verdict approves this bounded prototype only. The six existing production defects remain unfixed.

- [Combined findings and implementation plan](plan.md)
- [Independent design assessment: all 22 Admin areas](design-review.md)
- [Independent source/accessibility/state assessment](evidence-review.md)
- [Review of all 37 result components](renderer-review.md)
- [239 significant Admin scenarios](state-inventory.json), also browsable at `/states.html`
- [Prototype behavior review and fixes](prototype-review.md)
- [Actual browser journeys, reproduced defects and reproduction commands](browser-review.md)
- [Independent browser findings: six reproduced defects](browser-findings.md)
- [Current-app browser execution record](admin-browser-verification.json) and [proposal execution record](prototype-browser-verification.json)
- [Current capture manifest](captures.json) and [proposal capture manifest](proposed-captures.json)

Current evidence contains **100 captures**: 22 initial desktop areas, 22 first-arrival 390px areas, 37 result components and 19 further context/selection/deep-link/attempt states. There are 96 unique images. Identical attempted semantic actions are explicitly labeled as unverified responses. The independent B ledger freezes its original 34-file corpus; it does not count later standalone components or phone captures as proven Admin transitions.

Proposal evidence contains **36 captures**: 18 scenes at 1440×1000 and 390×844. All final proposal page widths equal their viewport widths. These original captures are visual observations. Native input stalled; after explicit authorization, installed Playwright verified the actual proposal journeys on both devices. Its 34 additional screenshots and 27 successful assertion groups are recorded separately. The current-app follow-up adds **76 captures across all 22 areas** and maps **42 exact ledger states**, without changing the frozen independent ledger. These earlier records contain **246 capture entries**; the XState intent model adds **nine**, making a historical baseline of **255**. The conversation adds **19**, bringing the gallery to **274 capture entries**. Repeated views and widths are included; these counts are not distinct workflows. Earlier evidence stays frozen, and conversation checks are recorded separately.

## Earlier multi-surface proposal

For the current direction, use [the conversation walkthrough](conversation/README.md#review-the-complete-flow). Open `/demo.html` to inspect the earlier proposal described here. Every value, request and worker state is illustrative. No model/tool/API/database call is sent. Two fixed tasks are supported; New demo task opens their starting intents, not arbitrary task creation.

1. **Wrong API data:** open Request & data. Inspect the failed whole-name assertion beside raw candidate rows. Try complete, empty, partial and connection-failure scenarios. Changing prepared inputs removes the current verdict; previous observations stay separate. Replay is explicit, with local progress and cancellation.
2. **Source and correction:** inspect each entry-to-exit node; each has its own sample source. Edit guard, reason and scope. Simulate a concurrent edit, inspect the newer revision and retain the draft explicitly. Saving never changes the original source or existing response. The finite fixture supports `active & valid & !annulled`; other text is preserved as a draft but is not executed.
3. **Independent verification:** after saving the supported guard, choose it explicitly in Request & data or Checks and run the offline comparison. Real integration/coverage remains Not run. No source patch, Joern path or successful HTTP status becomes runtime proof.
4. **Overnight recovery:** choose SHOP-142 (Choose task on a phone). Inspect its checkpoint, retained successes and failed documentation source. Prepare and confirm a local failed-step retry, pause/resume/stop it, and inspect retained notes. Simulated recovery never claims the real missing source was collected.
5. **Handoff:** use a task-specific name and note. Prepare a read-only review URL carrying the local snapshot, or export the task's offline recipe. Opening the link runs nothing and does not overwrite an editable task. Person recipes verify names; checkout recipes verify checkpoint retention. Credentials and production results are absent.

Drafts, observations, policies and notes are isolated by task in **sessionStorage for this browser tab**. Reload interrupts local simulations and restores retained state. There is no server/account/cross-chat persistence in this proposal. Reset only clears this demo's namespaced record. Real persistence is a production requirement in the plan.

## Replay and checks

Download `recipe.json`, `engine.js` and `replay.js` from the proposal into one folder:

```sh
node replay.js recipe.json
```

The original full-data selection fails; the explicitly selected saved guard passes. Partial data is inconclusive and a transport failure has no current assertion. The runner rejects modified fixtures, mismatched tasks and unsupported guards. No recipe JavaScript is evaluated.

Repeat the retained Node checks:

```sh
node demo/admin-intent-review/replay.js --self-test
```

Fourteen engine check groups passed in this session. The independent behavior reviewer additionally exercised nine Node render/handler groups and six standalone CLI cases; these are logic evidence, not browser accessibility or integration tests. All demo JavaScript syntax and static server/link checks are recorded in `verification.json`.

Repeat the real proposal browser journeys while the review server is running:

```sh
node demo/admin-intent-review/check-prototype.js
```

The script checks desktop/phone task flows, cancellation versus reload interruption, conflict drafts, read-only sharing, downloaded recipes, task isolation, keyboard tabs and representative dark/reduced-motion states. It uses only the synthetic proposal and closes its browser contexts. Downloaded recipes are kept in the ignored `work/admin-intent-review/browser/` folder.

## Reproduce current-app captures

Use a new manifest path if an older fixture is still running:

```sh
node demo/admin-intent-review/fixture.js 4096 work/admin-intent-review/new-fixture.json
```

This launches the actual current app with a temporary config home, actual fixture source indexing, synthetic infrastructure and retained semantic samples, copied example scripts, and a synthetic browser destination. Ctrl-C stops it and removes its temporary home. No real developer configuration is used. Docker or a remote model is not required.

Optional local Playwright batch, explicitly invoked in another terminal:

```sh
node demo/admin-intent-review/capture.js work/admin-intent-review/new-fixture.json work/admin-intent-review/reproduced
```

Requires installed Playwright/Chromium. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium. This optional batch script captures root states at desktop/phone and available sample renderers; it was not used for the authorized interaction follow-up. For the retained real-interaction script, use `node demo/admin-intent-review/check-admin.js work/admin-intent-review/new-fixture.json`. Then append the focused recovery/fresh-link checks with the same command plus `--followup`, before stopping the fixture. It operates only on a live disposable fixture and records observations rather than serving as a release gate. Neither script proves all 239 scenarios. Capturing every backend, permission, conflict, cancellation and cleanup state requires the fixtures named in the ledger.

## Review limits

The user-facing direction is supported by two isolated assessments plus current visuals/source. No usability participants, screen-reader session, physical touch, 200% zoom, full dark-theme pass, large-estate performance or real integration state sweep was completed. Representative proposal dark/reduced-motion and keyboard interactions were verified with Playwright; current Admin follows the exact named scope in its browser report. Native input stalled independently of app state; its cause was not attributed to a product bug. Impeccable context/detector refused an unverifiable download, so no detector pass, injected overlay, trend or helper-generated critique archive is claimed. The named reports are the durable review record.

Questions skipped: the requested review, plan and separate demo are supplied; choosing a production implementation phase is a subsequent decision.
