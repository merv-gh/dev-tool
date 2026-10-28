# Independent developer challenge results

All eight frozen solver submissions passed independent acceptance. This result separates product-tool evidence from grader execution: C03 has native Maven/JUnit red-green evidence; seven Node cases were edited and inspected through existing workspace tools, but their tests ran in the independent acceptance harness because `test_run` supports JVM projects. Their unsupported Node test selection was recorded rather than presented as tool support.

`summary.json` gives baseline/candidate counts, source and test hashes, scope checks and mutation totals. `observations.json` contains actual public-report executions before and after the submitted changes. The original author smoke placeholder remains skipped in Node cases; every submitted regression test executes. C08 is a tests-only task: its production bytes remain unchanged, and its two submitted tests reject all eight independent behavioral mutations. C07's two submitted tests also reject four post-freeze feature mutations. C08 removed one internal-key serialization assertion before final refreeze; all mutation checks were repeated.

The author froze the public pack and private business oracle before solver handoff. The grader/oracle were withheld until all eight original submissions were frozen, then retained outside the public pack under `dev/` for reuse. They contain acceptance assertions and must not be shown to a new independent solver before submission freeze. Supplementary S01-S04 are separate tasks and are not counted as eight additional successes.

To repeat, install dev-tool's npm dependencies; set DT_TEST_MAVEN and DT_JAVA_HOME (or JAVA_HOME), DT_TEST_PG_URL to an isolated disposable scratch control database, and optionally DT_CHALLENGE_M2. Prepare public local remotes and apply the versioned build/transport support before solving. Save a JSON map of case-relative roots to frozen solver workspaces; C03 has separate `C03/LIB/common-primitives` and `C03/FIN/ledger-service` roots. Then:

```
node dev/challenge-assemble.cjs solver-paths.json /absolute/empty-candidate-directory
node dev/challenge-grade.cjs /absolute/candidate-directory
node dev/challenge-mutations.cjs /absolute/candidate-directory
```

The assembler replaces each submitted root, so deleted protected files remain detectable. The grader re-executes actual candidate code/tests, checks frozen fixture/contract/harness bytes, checks non-skipped regression execution, and runs business negatives. It does not accept a modified expected fixture as a source fix. The mutation utility is an additional test-strength probe for the frozen C07 submission shape.

The C06 harness creates two registry-owned replay databases and drops them after each run. It establishes business validation and tenant isolation, and does not establish distributed atomic commit under network failure. Persistent source fixtures use SELECT-only credentials and remain separate from the writable scratch control. ES/Kafka supplementary records are explicitly saved evidence; no live engine or broker was configured.
