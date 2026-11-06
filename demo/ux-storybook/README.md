# UI/UX review stories

Two interactive proposals, kept outside the production app so we can review behavior and screenshots before implementation. The independent review examines the existing app; these proposals explore its most important workflow gaps.

- **[Independent review](independent-review.md):** observed findings, evidence, priorities and strengths to retain.
- **[Review guide](review-guide.md):** the three goals, decisions, tradeoffs and production boundaries.
- **[Verification](verification.json):** browser interactions and the actual baseline commit.

## Open the proposals

From the repository root:

```sh
node demo/ux-storybook/server.js
# http://127.0.0.1:4088
```

No Docker, remote network, credentials, model or extra packages are required. The server binds to localhost. All prototype execution is a deterministic local fixture; edits stay in the current browser session or an explicitly prepared review link. It never publishes project knowledge, modifies a passport or calls a production tool.

To compare with a live **disposable** current app, use two terminals:

```sh
node demo/ui-ux.js 4086 work/ux-storybook/fixture.json
node demo/ux-storybook/server.js --port 4088 --manifest work/ux-storybook/fixture.json
```

The first launcher creates a temporary config home. Java indexing in that baseline is real; infrastructure and retained semantic data are synthetic. Stop both launchers with Ctrl-C. The manifest and temporary paths are deliberately excluded from committed evidence. Without a live baseline, the Before tabs still show the archived screenshots.

## Stories and screenshots

| Story | Current screen | Proposed desktop | Proposed mobile | Extra state |
| --- | --- | --- | --- | --- |
| Follow & correct a finding | [Passport correction workspace](screenshots/before-investigate-desktop.png) | [Flow and source inspector](screenshots/after-investigate-desktop.png) | [Stacked inspector](screenshots/after-investigate-mobile.png) | [Correction and prepared lookup](screenshots/after-investigate-correction.png) |
| Reproduce & share | [Task scratchpad](screenshots/before-handoff-desktop.png) | [Replay and handoff](screenshots/after-handoff-desktop.png) | [Stacked replay](screenshots/after-handoff-mobile.png) | [Partial failure, previous output retained](screenshots/after-handoff-error.png) |

[Overview](screenshots/overview-desktop.png) · [Mobile overview](screenshots/overview-mobile.png) · [Current passport on mobile](screenshots/before-investigate-mobile.png) · [Current scratchpad on mobile](screenshots/before-handoff-mobile.png).

The Before images record the current app. After images use a separate illustrative refund case with deliberate ambiguity. They compare workflow composition; they are not a pixel-perfect same-data benchmark or evidence of deployed features. `storybook-fixture-v1` identifies that illustrative fixture, not a Git SHA or a production index generation.

### Follow & correct

1. Open **Follow & correct**. Prepare the fixed refund example. The question is an editable investigation note; adaptive intent routing is proposed for the real app.
2. Select the candidate table and inspect its illustrative source in the adjacent inspector.
3. Correct the target, provide a reason, choose task draft or project proposal, and apply it. The original detection remains visible.
4. Move the table up/down, switch between flow and evidence list, prepare a catalog lookup, or undo the correction.
5. Continue to the handoff; the question, selection, layout and edits follow you.

The real app already supports revisioned port corrections and graph selection. This proposal adds proximity to source evidence, an intent-to-action path and coherent handoff. A project proposal here is only local state; actual shared publication remains an admin action.

### Reproduce & share

1. Edit the evidence query and task reference, then **Replay fixture**.
2. Try **Catalog unavailable**, retry, cancel a run and search for a value that has no matches. Observe per-step status and recovery while previous successful output remains available.
3. Add a handoff note and prepare a review link. Open it in a fresh browser session to restore the same inputs, failure scenario, selected finding, declared correction and graph position. Opening a link never starts a replay. A failed fixture scenario also replays as the expected failure in Node.
4. Download `recipe.json`, `engine.js` and `replay.js` into one folder, then run:

```sh
node replay.js recipe.json
```

The runner verifies the expected offline result and rejects a different fixture revision. The exported state is authoritative; the steps describe the two fixture operations. It is a complete replay of this example, **not** an exporter for existing dev-tool scripts. Production packaging must also capture inherited collection hooks/vars, source and index identities, authorization reference names, saved-result hashes and explicit assertions. See the review guide.

A screenshot download is labeled **example**, because it is an archived illustration rather than a capture of the current browser state. To reproduce a current view, install Playwright and Chromium and use its prepared review URL:

```sh
NODE_PATH=<node_modules-containing-playwright> node demo/ux-storybook/capture.js \
  --url '<local-review-link>' --out work/ux-storybook/reproduced.png
# Add --mobile for a 390px viewport.
# Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to an existing browser if needed.
```

Review links contain the note, question and draft corrections. They contain no app authorization token. Review the content before sharing; recipients need this storybook and the matching fixture. Copying a link is separate from running it.

## Reproduce the review batch

With the two local servers above running:

```sh
NODE_PATH=<node_modules-containing-playwright> node demo/ux-storybook/check.js \
  http://127.0.0.1:4088 work/ux-storybook/fixture.json work/ux-storybook/check
```

This captures current/proposed desktop/mobile screenshots and verifies correction, source inspection, layout, exact prepared arguments, deterministic browser/Node replay, failure, retry, cancellation, empty results and fresh-session sharing. Only the disposable baseline is accepted. It does not run live Postgres/Kafka/Joern, assess an autonomous model, establish screen-reader conformance or simulate physical touch. The first independent review was source plus a live app; its prototype acceptance follow-up is recorded separately.

Demo-only changes do not require rebuilding the production bundle. Screenshots, reasons and runnable files all live in this folder; no production files were edited for these proposals.
