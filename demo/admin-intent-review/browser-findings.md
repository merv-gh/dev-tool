# Current Admin browser verification

This supplement follows the frozen independent Assessment B review. It uses installed Playwright Chromium against a disposable loopback fixture, with actual UI interactions and no app-global mutation. The reusable driver is `check-admin.js`; detailed assertions, exact state references and capture classifications are in `admin-browser-verification.json`.

The final corpus has **76 distinct capture files across all 22 Admin areas**, including one 390px Context interaction. **42 exact ledger states** are referenced. This does not establish all-state or all-integration coverage. Standalone renderer samples and the proposal demo are separate corpora.

The run retained **45 step attempts across bounded passes**: 30 verified, 7 with verified defects, 2 observations, and 6 historical capture failures. All historical harness failures have a recorded resolution or product-defect reclassification; they remain visible in the report. The last correction pass completed seven check groups and reproduced two product defects without locator failures.

Actual UI evidence confirms:

- Selecting the active Config area replaces an unsaved editor draft without a discard dialog. No config save was performed.
- Existing Sites choices are skipped by keyboard Tab navigation. Views choices lack native focusability, and the selected renderer preview iframe has no title.
- A fresh Workbench tool URL prepares a draft, then navigator initialization hides the composer. A subsequent same-document draft URL restores a usable composer.
- A fresh `#map` URL requests an empty environment before environment initialization. Its error appears in hidden Context while the Map area remains blank. Navigating to Map after environment initialization loads the real map and selectable node detail.

The browser also exercised catalog results/table detail/no matches; context file dirty/save/validation; synthetic scratchpad success/error and saved receipts; project publication validation; script params/hooks and a successful local synthetic run; semantic retained analysis, capabilities, ports and presets; owned synthetic Workbench success/failure/cancellation; runtime details/diagnostic modes/metadata records; job logs; history filters; environment definition validation; and loaded Studio, Pages, API and Self-reflection selectors. A local echo GET produced a rendered response and retained exchange evidence.

Failures from `demo_workbench fail=true` are deliberate synthetic tool outcomes, not injected route responses. External browser requests were blocked and recorded. No real database, broker, search cluster, build/container supervisor, Joern parser or model provider was run. Runtime diagnostic screenshots may show empty or unavailable evidence; they do not prove a real trace or coverage run. Merely opening a metadata record does not claim that a note was saved.

The driver refuses non-loopback origins and manifests whose existing home is not a `dt-ux-review-` directory under the OS temporary directory before seeding any data. The report omits private filesystem homes and normalizes stack paths. Reproduction requires starting `fixture.js` with a fresh manifest path, then passing that path to `check-admin.js`; fixture ownership and shutdown remain explicit.

Cleanup was checked: Chromium closed; fixture wrapper PID 81097 and child PID 81098 exited; ports 4112/4113 closed; the temporary home and runtime manifest were removed. The frozen `evidence-review.md` and `state-inventory.json` were not changed.
