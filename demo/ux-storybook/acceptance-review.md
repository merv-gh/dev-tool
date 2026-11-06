# Independent prototype acceptance and visual review

6 November 2026. The independent reviewer inspected both proposals with a fresh browser context after completing the current-app assessment. This is a qualitative review and bounded browser verification, not a usability study.

## Material acceptance findings and response

| Independent finding | Response in the prototype | Evidence |
| --- | --- | --- |
| An unrelated question still prepares the refund flow | Explicitly label the button and guidance as a fixed refund example. The question is retained as a note; adaptive routing is a production proposal | Initial investigate screen and review guide |
| Searching the corrected table returns nothing | Search declared targets as well as original source labels | Browser and Node replay check for `sales.refunds` |
| Project proposal conflicts with “Private task draft” header | Separate storage ownership (“Private browser draft”) from correction target (“Project proposal · unpublished”) | Scope metadata and local correction status |
| Failure scenario is absent from a shared failed investigation | Include and validate the selected scenario in review state and recipes | Fresh-session scenario restore and expected-failure CLI replay |
| README, review guide and screenshot were pending | Finish all three and check local links/assets after the screenshot batch | Static asset/link check and archived screenshots |

The reviewer observed successful failure/cancel handling and retention of previous successful output. Their fresh 390px recipient restored query/correction without document overflow or uncaught JavaScript errors. Parent verification additionally exercises an independent browser session and CLI.

## First desktop/mobile visual batch

Both stories and their baseline screens were captured at 1440px and 390px. Four proposed desktop/mobile images were visually inspected together. The first batch found two material composition problems:

- Full evidence rows duplicated the graph and made the mobile inspection unnecessarily long. Keep the evidence list in a disclosure while the graph is visible; open it automatically in the Evidence list lens. Source and uncertainty stay outside the disclosure in the inspector.
- A fixed notification could cover source or result content and could show an old action's feedback in another story. Place feedback in normal document flow and clear it when switching workspace or starting/finishing replay. Persistent outcome remains next to the initiating action.

The selected table's illustrative source now starts open, because it supports the correction decision. Selecting a finding focuses the source inspector on a phone; desktop keeps focus on the selected graph control. Exact recipe, advanced layout and production packaging details remain collapsed by default.

One consolidated fix batch was followed by a single confirmation batch. No production UI was modified. See [verification.json](verification.json) for the final checks and scope.
