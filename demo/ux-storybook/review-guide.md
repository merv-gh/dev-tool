# Review brief and proposed changes

Audience: a developer or tester handed a partially explained bug, and the colleague who must check their finding later. The product is an operational developer workbench; it should make source, execution and uncertainty legible without requiring a memorized tool registry.

The existing restrained palette, system typography, forms, exact argument access and evidence semantics remain the visual authority. This is a workflow extension, not a replacement identity. All work in this folder is a prototype; production implementation follows review.

## The three goals

| Goal | A reviewer should be able to do | Concrete test |
| --- | --- | --- |
| Discover intent | Turn an unclear refund bug into a useful first inspection; understand where to go next | Prepare the investigation, inspect a boundary and prepare a catalog lookup without typing a tool name |
| Understand information | Tell source evidence, model candidate, manual correction, running work and execution result apart | Explain the dashed edge, original table candidate, correction scope, failed step, previous output and remaining runtime gaps |
| Reproduce and share | Reopen the selected finding with inputs and edits, then verify the same local result | Open the prepared link in a new session; download and run the three replay files; capture the linked view |

Success is inspectability and correction, not automatically trusting a model. The prototype deliberately retains an ambiguous table candidate and an unproven event-delivery gap.

## Why these two compositions

### Finding, source and correction together

**Observed problem:** Existing port CRUD is capable, but source inspection sits outside the correction workflow. Default intent hints are a truncated registry excerpt. A novice must translate the task into tools and carry exact identifiers between screens.

**Proposal:** A modest intent field leads into a flow/list view. Selecting a candidate puts the evidence, source excerpt, uncertainty, target, citation and scope in one adjacent inspector. “Prepare lookup” reveals exact arguments without executing. The next step is visibly connected to the finding.

| Change | Reason | Cost / boundary |
| --- | --- | --- |
| Source and correction share an inspector | Closer to the user's decision: “what supports this edge?” | Source must come from the exact repository, revision and path; the prototype snippet is illustrative |
| One prepared next action | Recognition is easier than guessing from a registry | Suggestions must retain manual filtering and editable arguments; do not auto-run |
| Original detection stays visible | Correction should not overwrite its evidence | Manual declarations remain a separate, revisioned overlay |
| Layout adjustment separate from edge correction | A user can improve readability without changing claims | Production should preserve per-view layout independently of source and publish scope |
| History, raw structures and rare controls in disclosures | Not used on every inspection; more room for evidence | Key provenance and uncertainty remain outside the disclosure |
| Wider reading/working spacing | Selected source and reason are easier to scan | The graph has less horizontal room; mobile stacks the inspector |

### Execution and reproducible handoff together

**Observed problem:** Results, task files, queries and scripts can be saved in separate places. Selected task/file/script URLs do not consistently identify the selection. A script's own JSON can omit inherited collection variables/hooks. Initiating screens give less progress than Runtime.

**Proposal:** Show editable input and a compact execution chain beside a handoff panel. A failure preserves previous evidence and explains recovery. Separate the saved-review link, machine-readable recipe, runner and illustrative screenshot. Opening saved evidence never executes it.

| Change | Reason | Cost / boundary |
| --- | --- | --- |
| Current step beside run/cancel | Immediate feedback belongs where the action began | Use real execution IDs and cancellation semantics in production |
| Failed step and explicit retry retain arguments | Recovery should not require reconstructing work | Save failure and tool failure need different actions; do not rerun a costly successful tool to retry storage |
| Last successful output survives failure | A failed attempt must not erase earlier evidence | Label its input/run so it cannot be mistaken for the new attempt |
| Exact JSON collapsed initially | Routine work begins with the intent and result | Experts still inspect the full recipe before replay |
| Link includes the selected state | Address-bar handoff should locate the finding, not just an Admin tab | Production should use immutable saved IDs plus authorized scope, not embed sensitive payloads |
| Complete replay files beside screenshot | A screenshot explains; source and arguments reproduce | Match source/index generations and explicitly identify missing dependencies |

## What is and is not wired

**Working locally:** form editing, source disclosure, graph/list selection, declared table correction and undo, scope choice, layout movement, session draft retention, review links, deterministic filtering/replay, step states, simulated catalog failure, cancellation, retries, zero results, file downloads and Node verification.

**Illustrative:** refund source lines, graph edges, environment, model candidate, fixture revision label, production suggestion and the catalog failure. No real model, tools, database, Kafka or Joern is invoked. The current-app screenshots are a different, source-indexed demo baseline and are labeled accordingly.

**Production requirements still to implement after review:** reuse the existing exact-revision code reader and port overlay APIs; guard stale drafts and permissions; emit deep links on ordinary selection; bridge execution state and result-capture status into initiating views; export a complete authorized investigation manifest; preview/import before explicit replay; capture the actual selected view; preserve private task scope and admin publication policy. The prototype does not change those backend policies.

## Questions for the screenshot review

- Is the question-to-finding path obvious before reading help? Would two or three prepared choices be more useful than the single first step shown here?
- Is the source close enough to justify a correction? Does the detected/manual/runtime distinction stay obvious after editing?
- Does the right inspector earn its space, or should it be a bottom panel on a laptop?
- Which information belongs in the collapsed recipe/history panel, and which must remain visible on first glance?
- Can a colleague tell what opening a link does, what replay does, and what remains unverified?
- Is the handoff panel useful during investigation, or should it appear only once the user asks to share?

## Suggested implementation slices after approval

1. Reuse the existing port editor and add exact-revision source preview / prepared code reading; make intent candidates actionable rather than text-only.
2. Emit canonical task/file/script/finding deep links and show a compact execution strip backed by existing Runtime state.
3. Add a handoff composer around saved results, complete script dependencies and immutable source/index identities; provide import/preview and an explicit replay action.

Each slice needs a real Admin and sandboxed inline-view check. The storybook proves composition and bounded fixture behavior; it does not replace production authorization, concurrency or integration tests.
