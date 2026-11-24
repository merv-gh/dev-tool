# Data lineage finish review

## 1. Verdict and scope

**Verdict: ship within the reviewed scope.** All three findings from the initial finish review are resolved. No fixes, recapture, redesign, or rebuild are owed by this review.

The initial review covered `web/views/data-lineage.html`, `web/inline.js`, `lib/views.js`, and `docs/data-lineage.md`, using `web/views/impact.html`, `web/views/_views.css`, and `web/ui.css` as incumbent authority. This confirmation pass is limited to the three reported defects and their necessary host integration. It is not a new review of the backend or unrelated UI.

This remains an ordinary Operate-mode extension. The context launcher had already failed verification; it was not retried or bypassed, and no detector result is claimed. This reviewer changed only this report.

## 2. Direction and fidelity

The compact conversation-oriented direction is preserved. Status precedes evidence; direct records, object accessors, and substring candidates remain distinct. Paths progress vertically without horizontal nesting, with source, repository revision, database, and broker identity available.

The fixes retain system fonts, neutral surfaces, thin dividers, native controls, and the existing disclosure pattern. Long names now consume height while remaining readable. The candidate summary correction strengthens the existing evidence distinctions. No replacement visual system was introduced or requested.

## 3. Craft and accessibility

The original review found the supplied light-theme captures legible and correctly populated, with native labels, lists, disclosures, buttons, status semantics, and visible focus styling. This pass confirms the identified wrapping defect is fixed in headings, row titles, and path buttons at 1440px and 390px widths.

The four long-label captures show complete labels within the page, with readable wrapping rather than clipping. The collapsed candidate capture now uses the correct evidence vocabulary. Dark mode, assistive-technology output, and zoom were not established by this evidence; no new claim about those checks is made.

## 4. Interaction, scale, and evidence

The initial review opened and visually inspected all original 11 captures. The latest verification at **`2026-11-24T01:11:49.238Z`** records 13 passing checks, 17 captures, and `errors: []` in `demo/data-lineage/evidence/verification.json`. The original 11 states were recaptured. This bounded confirmation visually inspected all six added captures:

- `demo/data-lineage/evidence/readers-long-desktop.png` and `demo/data-lineage/evidence/readers-long-mobile.png`.
- `demo/data-lineage/evidence/trace-long-desktop.png` and `demo/data-lineage/evidence/trace-long-mobile.png`.
- `demo/data-lineage/evidence/name-candidates-inline.png`.
- `demo/data-lineage/evidence/workbench-inline-handoff.png`.

All six are valid full-page captures. The long-label cases record document width equal to viewport width at 1440×1000 and 390×844. Synthetic stress labels are explicitly identified as renderer examples, not indexed access findings.

The browser verifier now uses the actual Admin Workbench iframe, opens a retained-source action, confirms working local storage and editable `expected_source_digest` arguments, clicks Run, and waits for a successful backend `code_read` result. It separately installs a custom view override, confirms its popup retains an opaque origin and storage `SecurityError`, and removes the override. These behaviors are supported by `demo/data-lineage/verify.cjs:38` through its custom-override cleanup at line 53; the screenshot itself shows the native host, while assertions establish the popup execution and isolation.

The demonstrated scope remains real HTTP tools, source indexing, SQLite, background workers, and the production renderer on disposable synthetic source/catalog fixtures. No Java service, Joern, live database, or Kafka runtime execution is claimed. The original findings concerning bounded lists, retained evidence, source digests, and static-evidence disclosures remain unchanged; they were not reopened in this confirmation pass.

## 5. Original finding dispositions

| Original finding | Disposition | Confirmed resolution |
| --- | --- | --- |
| P1: prepared actions inherit the native host sandbox | **Resolved** | Shared native-frame policy enables popup escape for server-controlled same-origin `/show` responses, while custom response CSP retains its restriction. Actual Workbench source handoff and backend Run succeed. |
| P2: long identifiers create horizontal overflow | **Resolved** | Heading, row title, and step-button wrapping stays within desktop and phone viewports. |
| P2: collapsed name results are labelled as access records | **Resolved** | The collapsed real candidate result says “6 name candidates.” |

**Embedded handoff:** `web/tool-client.js:3` adds `resultFrame`, narrowly checks same-origin `/show` URLs, excludes credential-bearing URLs, resets the host policy for other content, and never grants `allow-same-origin`. Native result hosts use the helper; Workbench integration is at `web/admin-workbench.js:1026`. The linked composer is prepared after explorer initialization (`web/admin-workbench.js:348`), so the Run control remains usable. Source review and the actual browser interaction resolve the original blocked handoff. The child view CSP remains the authority for built-in versus custom popup escape. `docs/data-lineage.md:88` states the external Open WebUI outer-sandbox limitation and normal-tab fallback. Srcdoc/admin previews retain their restrictive policy.

**Long names:** `web/views/data-lineage.html:3` supplies local `min-width`, maximum width, `overflow-wrap: anywhere`, and normal white-space for the affected elements. `demo/data-lineage/verify.cjs:31` supplies explicit long column, method, and route labels; all four targeted captures show complete wrapping, and their recorded document widths equal their viewport widths. The flat path direction remains intact.

**Candidate summary:** `web/inline.js:99` branches the inline count label on `mode === "mentions"`, preserving the access-record and static-path labels for their respective modes. `demo/data-lineage/verify.cjs:36` asserts the real collapsed candidate summary contains “6 name candidates” and excludes “access records”; the corresponding capture confirms the rendered wording.

No unresolved or partial findings remain from this finish review. Stop the visual review here.
