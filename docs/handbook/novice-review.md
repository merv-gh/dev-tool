# Independent novice review — draft handbook

Reviewed 2026-11-05 against the draft present at the start of this review. This verdict does not assume the author's subsequently proposed repairs have landed.

## Verdict

**6.5 / 10 for a first-time user's ability to finish work unaided.** The guide is a useful evidence-oriented reference, but a novice can still lose saved memory through navigation, cannot reliably use the portable tool index, and must invent several transitions between discovery, exact-version selection, execution, and extension authoring. The strongest material explains how to avoid false conclusions; the weakest material shows how to complete the next concrete action.

I read the primary documents before implementation source and then performed one bounded browser inspection of the disposable demo. I did not edit the application/docs/configuration, send business API requests, refresh infrastructure, create source workspaces, or push code. Live writes were confined to self-context, its operator note, and a synthetic `show` result. Schema checks below use the supplied portable reference rather than author assumptions.

## Findings

### P1 — Saving self-context hands the novice into a different story

**Location:** `/handbook#self-context`; README lines 124–140.

**Reproduction:** Open the standalone handbook, set Chat / task to `novice-handbook-review`, Apply scope, then Save persistent self-context. It reports `Saved dev-tool-self: operating-context.md, capabilities.json. Operator notes preserved.` The resulting Open Task memory link is `/admin#context`, with no selected story/context identity. Admin opens at Chat / task = `default` and shows only the sample SHOP-142 context. The newly saved context appears absent. I recovered it only by manually entering `novice-handbook-review` in Admin and applying the scope again.

The click itself did not navigate in this in-app browser, so I followed its observed destination directly. The **scope loss is independently visible after loading that exact destination**, not inferred from the click behavior.

**Repair:** Carry the selected environment, story, and returned context ID into the handoff; have Task memory select that exact saved folder. Display the active story next to the destination when restoring it. The prose should explicitly say that reopening in another story hides this context.

### P2 — Most portable tool-reference links target nonexistent heading anchors

**Location:** `docs/handbook/tools.md`, beginning at line 8 and repeated throughout.

**Reproduction:** The TOC writes `catalog_sync` as `(#catalog-sync)`, but the destination heading is `### catalog_sync` and has no explicit anchor. GitHub-flavored Markdown heading IDs retain underscores. The same mismatch affects **208 of 223** tool links. `find` works, which makes the pattern harder to diagnose as a novice.

**Repair:** Generate explicit anchors matching each href, or generate hrefs using the actual renderer's heading slug convention. Validate all 223 fragment destinations in the generated artifact.

### P2 — Exact-version teaching does not carry the chosen identity into the next prepared call

**Location:** README Indices, lines 523–560; Code search/Joern, lines 734–786; tools.md `code_search` and `semantic_search` schemas.

The guide correctly says to retain SHA/revisionKey/analysis IDs and to select an exact generation. Its prepared sequence then lists versions and searches with a mutable `repo` alias or `{service, env, query}`. It never shows the novice which returned value goes into which next field. The reference reveals that `code_search.repos` accepts an immutable revisionKey and `semantic_search.analysis`/`revisionSet` can select retained evidence, but discovering this requires leaving the workflow and reading large schemas.

**Consequence:** A reader can follow every visible example while believing the search is pinned, although the example does not explicitly bind the retained generation. This matters particularly in the shared-library case.

**Repair:** Add a two-call worked chain: list/read real returned identities, select one, then prepare `code_search` using its returned revision key and `semantic_search` using its exact analysis ID. Annotate the response field → argument mapping. Include a visible identity confirmation before interpreting the result. Do not invent example IDs.

### P2 — The extension chapter promises creation but provides only selection and inspection

**Location:** README Extend tools and result views, lines 1383–1437.

The stated outcome is “Create a scoped extension.” I can learn when to choose a script, declarative SQL/HTTP tool, plugin, or renderer, but cannot author one from this chapter. There is no minimal `tools.custom` configuration, plugin export shape, or `view_save` example; no precise activation/validation sequence; and no direct link to a complete authoring example. `tool_contracts`/`tool_describe` help inspect a transport/input contract but do not themselves teach the config/plugin implementation shape.

**Repair:** Include one small, harmless extension from declaration through validation, enabled-registry discovery, synthetic execution, and removal/disable. Link a separate minimal plugin skeleton and a `view_save` + `show` example with DATA/sample. State which part is global and which part belongs to the current story. Keep the effects and prerequisite labels attached to those examples.

### P2 — The first page uses scope identities before giving the novice an operational map

**Location:** README lines 43–48; detailed source-vs-target explanation first appears at lines 1174–1178; glossary lines 1786–1802.

The first page introduces token, story, principal (later), profile, environment, Chat / task ID, and execution target in a short paragraph. It says env does not choose a deployed test target, but does not yet show what does choose the target or where to inspect it. A novice may think Chat / task must be an existing Open WebUI chat identifier, or that “profile” is an authorization role. The glossary also uses CAS/retained projection without expanding those terms and does not define execution target, runner, or profile.

**Repair:** Place a compact early map with example values, meaning, and where set: environment = source provenance; Chat / task = stable chosen investigation ID; profile = model discovery set; target/runtime bindings = actual execution placement and dependencies; authenticated user/role = permissions. Link `test_targets` and the reproduction chapter from that map. Expand CAS and CPG at first use.

### P3 — The boundary cases teach decisions, but do not provide a repeatable practice exercise

**Location:** README Case: the cent lost between services, lines 868–964; Capture/replay, lines 1164–1205.

I can construct a boundary ledger, reject a formatter-only “fix,” and state an independent expectation (10.01 major units → 1001 cents). The tenant and stale-projection cases also explain useful negative checks. The cases are explicitly illustrative, so their observations cannot be verified in the demo and there is no linked tiny fixture/selector that lets a novice perform the red/green sequence. The reproduction chapter names many lifecycles but contains no prepared runnable progression. This is a transfer gap rather than an inaccurate production claim.

**Repair:** Offer one clearly labeled optional local exercise with a small real defect, exact source-discovery steps, a known independent contract, the original failing assertion, the same selector after repair, and retained proof/cleanup. Keep the broader cases as reasoning exercises. Do not present a rendered sample test result as completion of that exercise.

## Six requested tasks: completion evidence

| Task | Result | Evidence and remaining gap |
| --- | --- | --- |
| 1. Source environment vs execution target and scope | Conceptually completed after cross-reading; first-page usability partial | I can now distinguish env provenance, story memory, discovery profile, and target/runtime execution. The decisive source/target explanation is much later than the first warning; see P2 orientation finding. |
| 2. Save/reopen self-context without losing operator notes | Completed with manual recovery | Saved `dev-tool-self` under story `novice-handbook-review`; recovered it by reapplying that story in Admin; edited `operator-notes.md` with `Novice review marker: preserved across self-context refresh on 2026-11-05.`; refreshed snapshots in Admin Field guide; reopened the note and verified that exact marker remained. Scope handoff failed; preservation worked. |
| 3. Correct index/refresh and exact revision | Refresh choice learned; exact-version sequence partial | I can distinguish source refresh from `catalog_sync what=index` and choose PG/passport/code/semantic layers. Used the live reference to search/select `semantic_index`, checked `versions`, and ran a no-target listing. Its visualization reported no matching retained results in this new story. I did not parse or refresh anything. The workflow does not yet show response identity → next search argument binding. |
| 4. Boundary bug with independent evidence and tests | Reasoning completed; execution unverified | Can identify the first violating boundary, pin service/library identities, freeze independent expected values, require real-path red/green and tenant/no-write counterchecks, and separate live projection catch-up. I did not execute application tests: workspace/source modifications and infrastructure runs were outside this review's authorized writes, and the teaching case has no executable local exercise. This is not a claim that the runtime is broken. |
| 5. Discover/prepare unfamiliar tool and inspect visualization | Completed | In All tools, searched `semantic_index`, inspected the form/effect warning, enabled `versions`, and ran its listing. Opened Visual index → tests → Open interactive sample, reviewed the prepared `show` call, then ran it. The native view showed 3/4 passing, first failure `FeeCalculatorTest.feeIsRoundedHalfUp[1]`, expected 0.67 vs actual 0.66, source line 15, focused stack and filters. The sample was visibly labeled presentation evidence. |
| 6. Extend tools / monitor effectiveness | Monitoring concepts completed; authoring partial | Can choose script/custom/plugin/renderer, inspect contracts, and separate invocation error/latency from task outcomes. Live briefing showed this story's bounded call history; those values were operational hints, not a grade. No extension was authored (outside authorized writes and no minimal recipe in the chapter). |

## Reference and presentation observations

- Live discovery is usable once the user reaches All tools: exact filtering, required-field forms, editable JSON, effect warnings and prepare-before-run are visible. The tests sample is genuinely interactive and useful for learning what failure evidence to inspect.
- The portable reference has 223 tool sections and exact schemas, but 10,811 lines make it a lookup artifact. It needs working fragment navigation and task-to-next-call examples to function as novice instruction.
- All 32 Markdown image references in README point to existing files. I did not inspect every image or every native renderer. Captions clearly distinguish synthetic/sample evidence from real execution.
- No broken actual tool invocation or application error was observed in the limited browser actions. A failed automation locator for an iframe summary was a reviewer selector issue, resolved through the visible accessibility control; it is not counted as an application defect.
- No claim is made about non-admin permissions, mobile layout, real PG/Kafka/ES connectivity, fresh Joern parsing, local/JVM/Node test execution, cancellation cleanup, or secret redaction under adversarial data. Those were not exercised.

## Suggested order

1. Repair scoped Task memory handoff and portable anchors.
2. Add the exact-identity carry-forward chain and early scope/target map.
3. Make extension creation concrete; provide one optional executable local boundary exercise.
4. Have a fresh novice repeat the six tasks without author coaching. Measure completed actions and preserved evidence, not calls made or chapters marked read.

## Independent follow-up — bounded text/source recheck

Rechecked the revised generated documents and their relevant source/contracts on 2026-11-05, at the author's request. **The original 6.5/10 draft score and verdict above are preserved.** This follow-up assesses the repairs by reading; it is not a fresh novice task-completion score or a second browser run. The root reviewer owns final browser confirmation and runtime/test evidence.

| Original concern | Recheck result |
| --- | --- |
| Portable reference anchors | Addressed. Automated static inspection found 223 tool TOC links, 223 explicit unique anchors, zero missing destinations and zero duplicate IDs. The `tool-catalog_sync` links now have matching explicit anchors. |
| Early scope/target orientation | Addressed in text. “Keep these identities separate” now explains that the user chooses the stable Chat / task label, separates authenticated user/role, environment, profile, source revision and execution target/runner, and includes a prepared read-only `test_targets` example. The glossary now expands CAS and CPG and defines profile and execution target/runner. CPG is also expanded at its first atlas use. |
| Exact identity carry-forward | Addressed in text and preparation guard. The new table maps `code_index` listing `rows[n].revisionKey` to `code_search.repo` and `semantic_index` `analyses[n].id` to the analysis argument. The prepared examples use those exact variables. In `web/handbook.js`, both variables start blank and each pinned example's `requires` guard rejects prepare/copy until the user supplies a nonblank returned identity, opens Example variables, and focuses the missing input. Source contracts confirm that `code_search.repo` is used as the source selector and accepts immutable index keys, and semantic tools support explicit analysis selection. This prevents accidental blank fallback in these prepared examples; it does not validate that an arbitrary pasted value is a real matching returned identity, so the documented returned-identity check still matters. |
| Concrete extension authoring/removal | Addressed. The chapter now includes a parameter-bound read-only SQL declaration, a dependency-free CommonJS plugin with input/required/run, describe/run CLI calls, and removal/reload/discovery verification. These shapes match `paramsSchema`/`bindSql`, declarative SQL loading and local plugin loading in `lib/tools.js`. It explicitly distinguishes global administrator installation from the story-scoped renderer. `view_save` followed by `show` is concrete and uses textContent safely for the label; Admin Views has the documented custom-view removal operation. No extension was installed or removed during this recheck. |
| Optional executable boundary practice | Addressed as a bounded local teaching exercise. It first opens a context, then captures two actual `js_run` calls with `context_run`. The original converter loses the cent and large-value precision; the repair parses digits with BigInt. Both versions concatenate the same `centsChecks` constant: the same three named tests and independent expected strings are retained. The sandbox's `test` helper records assertion failures, `js_run` returns those tests, and `context_run` stores the call arguments/result in `calls/...json`, consistent with the reading instructions. The text correctly separates invocation/capture success from assertion success and separates this local seam exercise from full-service/workspace red-green proof. No application test or sandbox execution was repeated by this reviewer. |
| Self-context handoff | Source repair is consistent with the original finding. The returned Admin link now carries story, environment, `context=dev-tool-self`, and `file=operator-notes.md`; Admin reads the linked story/env before requests and selects the requested context/file. Operator-note preservation logic remains guarded and does not overwrite an existing note. Browser verification remains for the root's final pass. |

**Remaining actionable issue:** one low-priority navigation wording improvement. In Add your first custom capability, replace “Reload tools in Tools” with **“Admin → Config → Tools → Reload tools”**. Tools is a heading within Config, rather than a primary navigation tab, so the current wording can still make a novice search the sidebar for a nonexistent Tools area. The visible source location is `web/admin.html`'s `tab-config` section.

A small generated-introduction copyedit also remains: the placeholder list currently has no comma between `{{context}}` and `{{ticket}}`. Neither remaining item blocks the repaired workflows. No remaining P1/P2 issue was identified in this bounded text/source recheck.


## Author verification and final disposition

The independent draft verdict and follow-up above are unchanged. The two final
copyedits are now applied: the installation instructions name
**Admin → Config → Tools → Reload tools**, and the generated placeholder list
has the missing comma. The final browser check confirmed the returned memory
link opens the same story, environment, context and operator note. Automated
checks also confirmed note preservation and user/story isolation.

The confirmation covered all 21 chapters, every one of the 223 enabled tool
forms, all 20 native sample renders, actual immutable code-search carry-forward,
and the local sandbox exercise (two failures before, three passes after, with
the same assertion names and saved records). A long raw-result layout defect
found in confirmation was fixed by wrapping the result panel; a focused
regression then passed all 12 chapter/viewport combinations. This is author
verification, not a new independent novice score.

The [verification record](../benchmarks/handbook-verification.json) and
[screenshot gallery](../screenshots/README.md#field-guide-and-self-context)
record evidence and limits. Fresh Joern parsing, real infrastructure access,
Open WebUI transport and autonomous model quality were not rerun for this
handbook change.
