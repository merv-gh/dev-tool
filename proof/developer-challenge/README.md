# Independent developer challenge proof

The solver uses the public dt tool registry for application investigation, edits, and test execution. Shell access is limited to disposable fixture setup, public documentation, and evidence recording. Author private graders and expected patches are out of bounds. A tool defect is recorded as a gap, never repaired during a case to count it as solved.

`call.mjs` invokes the existing CLI tool boundary and saves exact JSON arguments, environment identity, stdout/stderr, wall time, and byte counts. Set `DT_HOME` to the disposable challenge config. Optional `DT_PROOF_OUT` relocates raw transcripts. Pass `@arguments.json` when arguments contain multiline source. Tool outputs are evidence; test passes require a real project run and an independent author check.

The first compact discovery used `tool_search`, `tool_describe`, and public README documentation. Dependencies were installed with `npm ci`. The unrecorded first call used the wrong key `q` and failed with `Missing argument: query`; subsequent calls use the described schema. No challenge application source had been accessed at that stage.

## Per-case evidence contract

- Environment, repository ref/hash, workspace, and symptom.
- Discovered tools and replayable exact calls.
- Diagnosis grounded in tool outputs.
- A failing project test before a minimal application patch.
- Passing project build after the patch, business observations independent of the patch, and author grading.
- Requirements-only test tasks also run against a deliberately broken mutant.
- Remaining limits, tool gaps, elapsed times, call counts, and returned bytes.

Only public setup information is accepted from the author. Candidate fixes stay in solver workspaces until frozen for blind grading.
