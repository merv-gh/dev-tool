# Independent finish review

## 1. Disposition — fix

Keep this composition and fix the five bounded issues below. No visual rebuild is warranted. The conversation-first structure, native controls, optional Files/Background pane, and vertical source path meet the requested direction. The remaining issues affect evidence truthfulness, retained work, and phone interaction rather than taste.

This verdict applies to the separate synthetic UI model. It is not a production release decision. Recapture after the fixes because the current evidence is tied to the current source hashes.

## 2. Evidence validity and scope

Reviewed `README.md`, `implementation-plan.md`, `intent-bindings.json`, `index.html`, `conversation.css`, `client.cjs`, `store.cjs`, and the relevant browser/test code in `demo/admin-intent-review/conversation/`. Read the Impeccable craft-floor and Operate guidance. No implementation files were changed during this assessment.

Actually opened and visually inspected all 14 captures with the image-viewing tool:

| Capture family | Widths inspected | Filename/content validity |
| --- | --- | --- |
| `screenshots/conversation-*.jpg` | 1440, 390 | Initial retained response, task scope, contextual actions and composer |
| `screenshots/edit-alongside-chat-*.jpg` | 1440, 390 | Saved guarded policy in Files; desktop beside chat, phone in its responsive full-screen pane |
| `screenshots/nested-path-*.jpg` | 1440, 390 | Expanded vertical database/selection path with collapsed wide-field branch |
| `screenshots/overnight-checkpoint-*.jpg` | 1440, 390 | Refund checkpoint, missing source and continuation controls |
| `screenshots/passing-check-*.jpg` | 1440, 390 | Collapsed passing fixture assertion, with explicit simulation wording |
| `screenshots/unknown-acknowledgement-*.jpg` | 1440, 390 | Lost acknowledgement, reconcile action and disabled duplicate Run |
| `screenshots/action-finder-1440.jpg` | 1440 | Search/filter finder with bounded results |
| `screenshots/dark-1440.jpg` | 1440 | Dark initial conversation |

The final `browser-verification.json` has `passed: true`, 15 check groups, 14 captures, 135 prepared intents, eight main-journey clicks at each width, zero recorded top-level navigation/scope reselections, no page errors and no forbidden requests. Independently recomputed SHA-256 values match all five recorded files (`index.html`, CSS, client, store and bundle). Those are credible current-source gesture records, not proof of untested paths. In particular, its keyboard assertion covers opening/closing the action finder, not the full keyboard journey.

The earlier context/detector download-verification failure was supplied as a limitation; neither was rerun. No browser was used for this independent review, per the review scope. Three additional in-memory store probes reproduced the storage, accepted-revision and transcript-retention issues below without writing application state.

## 3. Material findings

### P1 — A check can test a different source revision from the one accepted

**Locations:** `demo/admin-intent-review/conversation/store.cjs:39–44`; `client.cjs:49,55,85`.

`startAction()` retains the prepared target but does not capture the saved source text/revision. `finishAction()` reads the file's current saved value instead. Reproduced: accept a regression at revision 1, save the annulment guard while it is running, then finish it; the resulting check passes revision 2. The receipt and exported recipe therefore cannot establish which source was admitted to that run. This matters particularly when editing alongside background work.

**Bounded fix:** snapshot source text/revision at admission and use that snapshot for evaluation and receipts. If the current file has moved on, identify the older checked revision as stale against the current saved file. Keep any exported reproduction aligned with the receipt it represents. Verify the edit-during-run interleaving in both directions.

### P1 — Storage failure can claim that drafts are saved, with an incomplete recovery route

**Locations:** `demo/admin-intent-review/conversation/store.cjs:24`; `client.cjs:5,13,16,55`.

With no storage object, the optional `storage?.setItem()` call does nothing and `persist()` still returns `true`; an in-memory probe reproduced this. With a throwing storage object it returns `false`, but `renderHeader()` can overwrite the warning with “Saved in this browser.” A user can close the page believing their draft is retained. The fallback “export before closing” points to a recipe that includes the saved policy and fixture, not dirty file drafts, the composer draft or other task files.

**Bounded fix:** preserve an explicit volatile/storage-failed state across rendering. Explain what will be lost. Either provide a full recovery export containing the work being protected, or make the recipe's limited saved-fixture scope explicit and offer a way to recover drafts. Verify both unavailable storage access and failed writes after normal renders/task changes.

### P1 — Bounding history deletes retained evidence and strands its discovery controls

**Locations:** `demo/admin-intent-review/conversation/store.cjs:32`; `client.cjs:32,51–53`.

`addMessage()` silently removes the oldest messages after 80. A store probe with 81 follow-ups left 80 messages and no retained evidence blocks, while `observedRows` and `flowShown` remained `true`. “Compare raw rows” and “Trace the mapping” then attempt to focus a removed message instead of recovering it. This breaks the stable-task/evidence contract and the context panel's statement that the original transcript remains retained.

**Bounded fix:** separate retained history from the bounded rendered window. For this synthetic model, retaining all fixture messages is sufficient; production needs a durable archive/cursor. Verify that older rows, path and check receipts remain reopenable after more than 80 messages.

### P2 — Phone panes hide keyboard focus and panel-to-composer handoffs

**Locations:** `demo/admin-intent-review/conversation/conversation.css:5`; `index.html:12`; `client.cjs:14–15,59–67,77,84,109,130`.

At 390px the inspector covers the conversation, but opening it does not move focus into the visible pane or make the covered conversation inert; closing it does not return focus to its trigger. Keyboard users can traverse controls behind the visible Files/Background surface. There is also a direct pointer-flow defect: “Supply another source” populates/focuses the covered composer without revealing it; “Attach to message” changes that same hidden composer and puts its feedback behind Files. Users must infer that closing the pane reveals the result.

**Bounded fix:** give phone overlays a coherent focus entry/containment/return policy, including Escape and Tasks. For actions whose next step is in the composer, reveal the conversation and focus it. Verify a complete keyboard edit/run flow and both handoffs at 390px, not only the action finder.

### P2 — A status message from one task appears under another task

**Locations:** `demo/admin-intent-review/conversation/client.cjs:12,107,120`; `screenshots/overnight-checkpoint-1440.jpg`.

The overnight screenshot shows “Prepared a path investigation for registry-09999” while SHOP-142 is selected, although that preparation came from PERS-218. `notify()` writes a global notice and `switchTask()` does not clear or restore a task-specific notice. This gives an incorrect account of the selected task and is especially confusing when accepted work is independent across tasks.

**Bounded fix:** scope retained notices to their task or clear transient feedback on task change. Verify switching immediately after preparing an action and after a save/error.

## 4. Interaction and scale assessment

The primary hierarchy is effective: a recognizable task list, one stable conversation, a persistent composer, and optional evidence alongside. The initial screen offers two useful next steps rather than 135 choices. Nested native disclosures keep conditions and source boundaries readable; the current phone captures do not overflow horizontally. Files and Background becoming full-screen panes on a phone is a reasonable structural adaptation, subject to the handoff/focus fix above. Source-reference buttons remain very compact on phones (10px text with 1px vertical padding); enlarge their hit area in the adaptation without adding visual bulk. This was assessed from CSS and screenshots, not a physical touch-device measurement.

The action finder uses goal language and exact tool search, with 25 results per page. The bindings accurately distinguish 16 interactive synthetic fixtures from 119 generic prepared/model-receipt journeys. That is discoverability coverage, not 135 implemented production interactions. Passing checks collapse; failure, gap, lost acknowledgement and cleanup states remain visible and actionable. The screenshots distinguish HTTP success, static reachability and a fixture assertion; real integration and coverage are explicitly unproved.

The generated 10,000-service index, 1,500 fields paged by 25, lazy branches and cycle references demonstrate a suitable interaction shape. They do not establish backend latency, long-history rendering, real permission enforcement or event-stream behavior. The implementation plan already identifies indexed server queries, cursors, scoped events and windowing as rollout work; do not substitute silent transcript deletion for windowing.

Normal local-storage draft/task switching, concurrent-save recovery, no-duplicate reconciliation and read-only review links have named gesture evidence. The deterministic fixed-fixture replay is appropriately narrow and rejects unsupported edits/changed expectations. Reproducibility remains conditional on fixing admitted-source pinning, honest storage state and evidence retention.

## 5. Handoff limitations

This review supports continuing with this UI composition after the bounded fixes. It does not certify production rollout, JVM compilation, Postgres/API execution, cross-user persistence, concurrent-tab merging, real authorization, privacy isolation, server-owned jobs or a durable team share URL. The proposal and plan generally label these boundaries honestly.

The current visual evidence is valid but predates the requested fixes. Rerun the named store/browser verification and recapture affected desktop/phone states after the batch, including a keyboard pane handoff, a storage-failure state, an edit-during-run receipt and retained evidence after a long conversation. Do not claim detector, full accessibility, zoom, screen-reader, mobile virtual-keyboard or physical touch-device verification from this packet. No brand/system documents, detector output or implementation changes were created by this reviewer.
