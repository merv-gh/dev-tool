# Assessment B — Admin detector, accessibility, state and evidence review

Method: isolated Assessment B. Assessment A's report and findings were not read. This report is evidence for the parent synthesis, not a standalone accessibility certification.

Target: `web/admin.html`, baseline `5a8ba086dde01702b4351ff84be6df12d9339538`. Relevant Admin composition and shared style files match that baseline. Fixture reproduction manifest: `work/admin-intent-review/fixture.json` (local, ignored work artifact); fixture URL: `http://127.0.0.1:4096/admin`. `AGENTS.md`, Impeccable `SKILL.md`, `reference/critique.md`, and the technical criteria in `reference/audit.md` informed the review. No production files were changed. `PRODUCT.md`, `DESIGN.md`, and `.impeccable/critique/ignore.md` were absent.

## What the evidence supports

All **22 Admin navigation areas have an initial screenshot**. This is root-surface coverage, not all-state coverage. The fixed Admin corpus contains **34 image files, 32 distinct image hashes**, and 34 corresponding DOM snapshots. **33** images are 1280px or wider; **one** is 704px wide (`scripts-editor.jpg`). All are light theme. These dimensions are image dimensions, not a claim about the original browser viewport height.

The [state inventory](state-inventory.json) contains **239 significant scenario entries**: **34 captured**, **139 uncaptured**, and **66 needing a backend integration or deliberate fixture state/fault injection**. Entries sometimes group closely related outcomes; this is a finite review checklist, not an exhaustive state-machine product of every tool argument. The shared shell is recorded separately. The 318 enabled tool contracts and 37 renderer definitions are component data, not 318 or 37 separately tested Admin workflows.

This is a **frozen independent corpus of 34 Admin captures**, identified by the exact `captures[].id` and SHA-256 records in `state-inventory.json`; it was fixed before the parent expanded the separate gallery to 37 renderer captures. These counts apply only to those fixed names, not to the final contents of `screenshots/current/`. The fixed corpus deliberately excludes every standalone `view-*.jpg` gallery capture. A standalone renderer screenshot does not prove that the Admin Views editor selected, copied, saved, or previewed that renderer.

Three screenshots — `semantic-settled.jpg`, `semantic-retained.jpg`, and `semantic-capabilities.jpg` — are **byte-identical**, as are their DOM snapshots. They show the prepared argument form. They do not establish a retained-analysis result or engine-capability response. `context-selected` and `context-file` show the same file-open scenario at different capture/scroll positions. Some DOM snapshots preceded their screenshots: `history-initial.txt` shows empty rows while `history-initial.jpg` shows populated history. Filenames describe capture intent; the visible state governs the inventory.

No new browser interaction was verified by Assessment B. A new-tab attempt returned `Browser is not available: iab`; the available-surface inventory returned `{"apps":[],"browsers":[]}`. Existing screenshots were visually inspected with the native local-image tool, and DOM/source evidence was checked. The parent's reported stalled input attempts are tooling failures, not product defects.

## Deterministic detector and overlay status

One real attempt was made:

```text
<skill-base>/scripts/impeccable detect --json web/admin.html
```

The portable command above identifies the attempt. The exact private local invocation is retained only in the ignored assessment work record, `work/admin-intent-review/build-b-inventory.py`; it is omitted from these review deliverables. Exit code: **127**. Stdout: empty. Exact stderr:

```text
impeccable: cannot verify https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.5/impeccable-darwin-x64 against https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.5/impeccable-darwin-x64.sha256 (sidecar unavailable or hashing failed); refusing the unverified download
```

The deterministic scan is **unavailable**, not clean. Finding count, rules, file locations, and false positives are unknown. The refusal was respected; no verification bypass or alternative binary was used. Context loading had already failed in the parent; it was not rerun.

No mutable-injection preflight, overlay injection, console detection, or live-server startup was possible without an available browser surface. No user-visible overlay is claimed. Assessment B created no browser tab or live server requiring cleanup. Target-slug persistence and final critique storage are owned by the parent.

## Evidence-backed issues

### B1 · P1 · Site and renderer selection remains click-only

**Evidence: source + existing DOM/screenshot.** `web/admin-scripts.js:514` creates site rows as nested `div` elements with `data-site`; `:644` does the same for views with `data-view`. Click handlers exist at `:581` and `:686`. `web/admin-ux.js:53` only adds keyboard activation to catalog lines, jobs, script rows, and folders. It does not include site or view rows. `views-initial.txt` exposes renderer choices as generic elements, rather than buttons. `sites-initial.jpg` visibly contains the `shop` choice, although its earlier DOM snapshot had not populated it yet.

A keyboard user can reach **+ Site** or **+ View**, but the source offers no native focus or activation route for selecting an existing site or renderer. Use real buttons/links for these rows, keep selected-state semantics, and verify Enter/Space plus visible focus. This is a concrete accessibility gap; no screen-reader or physical keyboard test was completed.

### B2 · P1 · The default semantic task expands a contract into a 6147px form

**Evidence: screenshot + DOM + source.** `semantic-settled.txt` exposes **62 form field roles inside the selected panel: 51 comboboxes, 7 spinbuttons, and 4 textboxes**. The screenshot is **1280 × 6147**; `semantic-initial.jpg` is **1440 × 6147**. Both show long repeated `from` and `to` selector blocks before **Run investigation**. The nested selector contract has 24 properties (`lib/tools-semantic.js:13`). `web/tool-form.js:219` renders every nested object property, while progressive disclosure at `:601` applies only to the top-level argument list. The task presets and source/target picker added by `web/admin-ux.js:23` do not prevent this default expanded form.

For a calls/values task, lead with exact analysis and two symbol picks; reveal file/line, expression, transport, or database selector fields only when the user chooses that endpoint kind. Put output format and byte budget in advanced options. Keep exact JSON for power users. The Run action and a short summary of what will be queried should remain close to the task inputs.

### B3 · P1 · Clicking the selected Config area can replace an unsaved draft

**Evidence: source only; reproducible interaction remains uncaptured.** `web/admin-ux.js:48` guards configuration edits only when `next !== tab`. Clicking the already-selected Config navigation button still calls `show('config')`; `web/admin.html:728` invokes `loadConfig()`, and `:583` assigns the server text to the editor. The explicit Reload button has a discard guard (`web/admin-ux.js:56`), but this same-tab route reload bypasses it.

Treat reselecting the current area as a no-op, or run the same dirty guard before any configuration fetch that replaces the editor. The separate demo should include the exact sequence: edit config, click the selected Config area, and preserve the draft. Do not describe this as a browser-tested data-loss incident; it is a verified source path.

### B4 · P2 · Several names and result announcements still depend on fallback behavior

**Evidence: source + existing DOM.** `history-initial.txt` exposes the source filter as an unnamed combobox. `web/admin.html:267` gives `hsSource` neither an associated label nor an accessible name; the fallback in `web/admin-ux.js:53` covers inputs and textareas, not selects. The configuration textarea becomes a textbox named `cfg`, which is an implementation identifier rather than “Configuration JSON”. `web/admin-scripts.js:669` creates the `vwPrev` iframe without a `title`. Config save/error feedback is inserted into `cfgMsg` (`web/admin.html:434`, `:762–763`) without a status/alert role or live region.

Add purposeful labels, title the preview frame, and announce save/error outcomes consistently with Context, Service environments, and Runtime. Nested semantic selectors also repeat names such as `id`, `repo`, and `analysis Id` without a semantic group label: `web/tool-form.js:171` uses nested `div` containers. Fieldset/legend or group labels would distinguish source and target for assistive technology.

### B5 · P2 · Whole applications are embedded inside the Admin shell

**Evidence: screenshot + source; focus/scroll behavior untested.** The Admin source has seven static iframe hosts; generated result/editor frames bring the distinct Admin host IDs to twelve. Studio, Pages, API explorer, and Self-reflection are whole-app embeds (`web/admin.html:175–176`, `:239`, `:428`). These apps can then open result frames (`web/studio.html:1`, `web/api-client.html:81,90`, `web/self-reflection.html:1`), creating two iframe boundaries between Admin and retained evidence. All static Admin frames are titled; `vwPrev` is the observed naming exception above.

`studio-initial.jpg` repeats “Developer studio” and its introduction below the Admin area heading. `pages-initial.jpg` repeats its Pages heading and task identity. Admin parent DOM snapshots stop at these iframe boundaries, so they do not validate the embedded controls. The API initial view has a service navigator, request editor, and response area inside the persistent Admin navigator.

In a separate demo, compose the main work area from shared application components with one scope header. Keep sandboxed frames for untrusted result renderers. If iframe composition stays, define height, focus entry/exit, loading/error, and scope propagation contracts, then capture them explicitly. Do not remove result sandboxing merely to simplify layout.

### B6 · P2 · Context has two save targets but one prominent dirty cue

**Evidence: screenshot + source.** `context-dirty.jpg` shows **Unsaved edits** beside **Save context**, although the edited item is the progress file and **Save file** is at the bottom. `web/admin-context.js:9` uses the shared marker; the metadata handler at `:24–29` saves metadata and clears only the metadata draft. File saving is separate at `:155`. The source does retain dirty state and has leave guards, so this is a save-target clarity issue rather than proven silent loss.

Place “Unsaved file: progress.md” beside a local save action and show metadata edits separately. After a tool completes, keep the saved receipt visible, as `context-tool-result.jpg` already does. A successful run, saved file, reusable recipe, and linked workspace are distinct objects; `context-saved-results.jpg` correctly contains a saved run while the library counter still says zero saved actions because that counter counts `recipes/` files (`web/admin-context.js:137`). Clarify that noun instead of treating the counter as a storage bug.

### B7 · P2 · Complete-map and raw-history defaults outgrow their useful reading scale

**Evidence: screenshots + DOM.** `capabilities-initial.jpg` fits **318 tools** into a graph beside **21 starting-object choices**; its graph labels are effectively an overview texture at this scale. Search, object selection, zoom, and Fit already exist, but the opening state does not establish a smaller working slice. `history-initial.jpg` is **5606px high**, largely from inline raw arguments; it includes both real fixture operations and synthetic renderer samples.

Start the map at a chosen object/question with a clear “show full map” expansion. In history, show a compact purpose, outcome, source identity, and parameter summary per call; disclose raw JSON on selection. Preserve reproducible arguments and provenance in the detail view.

## Existing implementation that should be preserved

- `web/admin-ux.js:41–49` assigns tab/panel relationships, selected state, roving tabindex, and arrow/Home/End handling to all 22 areas. Context subviews have a comparable contract. This is confirmed in source and DOM; full keyboard behavior is still untested.
- Context, project knowledge, service environments, semantic jobs, and runtime provide status regions, explicit scope, dirty guards, and retained-evidence language. `context-tool-result.jpg` visibly distinguishes completed work from its saved receipt. Error paths frequently retain the current draft and use revision checks.
- Shared CSS provides light/dark tokens and focus-visible outlines. A tempting dark-primary contrast finding would be a false positive: `web/ui.css:55` changes `--on-accent` to `#111827` in dark mode. No computed-style or contrast certification is claimed. Likewise, job status includes text such as “syncing” in addition to a colored dot.
- Named result frames are sandboxed where appropriate. Existing loaded, empty, unconfigured, source-gap, and “no observations” messages often tell the user what evidence is missing instead of implying proof.

## State coverage by Admin area

“Backend” means a trustworthy rendered observation needs a configured/local backend run or deliberate state/fault fixture; some are possible with the disposable demo and do not require production services.

| Admin area | Captured | Uncaptured | Backend | Initial evidence |
|---|---:|---:|---:|---|
| Workbench | 1 | 7 | 3 | [Screenshot](screenshots/current/workbench-initial.jpg) · DOM record: `workbench-initial.txt` |
| Tool map | 1 | 5 | 1 | [Screenshot](screenshots/current/capabilities-initial.jpg) · DOM record: `capabilities-initial.txt` |
| Evidence index | 3 | 2 | 3 | [Screenshot](screenshots/current/index-initial.jpg) · DOM record: `index-initial.txt` |
| Explore evidence | 1 | 6 | 1 | [Screenshot](screenshots/current/explore-initial.jpg) · DOM record: `explore-initial.txt` |
| Service passports | 1 | 4 | 3 | [Screenshot](screenshots/current/passports-initial.jpg) · DOM record: `passports-initial.txt` |
| Services map | 1 | 6 | 3 | [Screenshot](screenshots/current/map-initial.jpg) · DOM record: `map-initial.txt` |
| Context and project knowledge | 8 | 16 | 4 | [Screenshot](screenshots/current/context-initial.jpg) · DOM record: `context-initial.txt` |
| Scripts and collections | 2 | 7 | 3 | [Screenshot](screenshots/current/scripts-initial.jpg) · DOM record: `scripts-initial.txt` |
| Executable pages | 1 | 5 | 3 | [Screenshot](screenshots/current/pages-initial.jpg) · DOM record: `pages-initial.txt` |
| Developer studio | 1 | 6 | 3 | [Screenshot](screenshots/current/studio-initial.jpg) · DOM record: `studio-initial.txt` |
| Browser destinations | 1 | 8 | 1 | [Screenshot](screenshots/current/sites-initial.jpg) · DOM record: `sites-initial.txt` |
| API explorer | 1 | 11 | 6 | [Screenshot](screenshots/current/api-initial.jpg) · DOM record: `api-initial.txt` |
| Result renderers | 1 | 7 | 0 | [Screenshot](screenshots/current/views-initial.jpg) · DOM record: `views-initial.txt` |
| Field guide | 1 | 6 | 1 | [Screenshot](screenshots/current/handbook-initial.jpg) · DOM record: `handbook-initial.txt` |
| Investigation history | 2 | 4 | 0 | [Screenshot](screenshots/current/history-initial.jpg) · DOM record: `history-initial.txt` |
| Service environments | 1 | 7 | 6 | [Screenshot](screenshots/current/environments-initial.jpg) · DOM record: `environments-initial.txt` |
| Runtime and observability | 2 | 5 | 7 | [Screenshot](screenshots/current/runtime-initial.jpg) · DOM record: `runtime-initial.txt` |
| Self-reflection | 1 | 5 | 4 | [Screenshot](screenshots/current/reflection-initial.jpg) · DOM record: `reflection-initial.txt` |
| Architecture knowledge | 1 | 6 | 4 | [Screenshot](screenshots/current/architecture-initial.jpg) · DOM record: `architecture-initial.txt` |
| Joern and service ports | 1 | 8 | 4 | [Screenshot](screenshots/current/semantic-initial.jpg) · DOM record: `semantic-initial.txt` |
| Background jobs | 1 | 1 | 5 | [Screenshot](screenshots/current/jobs-initial.jpg) · DOM record: `jobs-initial.txt` |
| Configuration | 1 | 7 | 1 | [Screenshot](screenshots/current/config-initial.jpg) · DOM record: `config-initial.txt` |
| **Total** | **34** | **139** | **66** | **22 areas** |

## Required capture and verification work

1. Add deterministic fixture routes for loading, empty, populated, invalid, dirty, saving, saved, revision conflict, unauthorized, integration unavailable, running, cancellation, cleanup, and retained-result states. Keep these explicitly synthetic. Build one specimen per component family and connect it to the scenario entries in `state-inventory.json`.
2. Capture each specimen at desktop and a 390px phone width, with 200% zoom and dark-theme representatives. Capture long field names, source SHAs, paths, JSON, empty arrays, and large result lists. The one 704px Scripts image proves neither phone behavior nor complete Admin responsiveness.
3. Exercise keyboard entry, focus visibility, selection, validation, discard, cancellation, iframe entry/exit, and scope changes. Include Sites and Views selection plus the Config same-tab sequence. A screenshot proves appearance; a successful gesture and resulting state are separate evidence.
4. Use the disposable fixture to run a complete local investigation from selection through a saved receipt and resumed evidence. For PG, Kafka, ES, Consul, repositories/build workers, Joern, browser capture, model providers, and environment supervisors, record configured dependencies and actual outcomes. Missing integrations should yield a captured explanation and next action, not a passing claim.
5. For the separate proposal demo, reuse the same fixed fixtures and labels so current/proposed screenshots can be compared. Keep the production Admin files untouched until the user chooses the direction.

## Run accounting

Assessment independence maintained; A was not read. Detector attempted once and unavailable with exact failure recorded. Browser fresh-tab creation failed and inventory was empty; no overlay was injected. No B live-server or browser tab exists to stop. The named inventory/report and `work/admin-intent-review/b-source-matches.txt`, `b-inventory-counts.txt`, and `build-b-inventory.py` are deliberate review artifacts. No additional temporary binaries were accepted. The parent owns final target-slug storage, critique persistence/trend accounting, fixture shutdown, and any supplemental gallery inventory.

Questions skipped: this is an internal independent assessment; the parent owns the user-facing critique and follow-up question.
