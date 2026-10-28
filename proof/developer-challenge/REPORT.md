# Independent developer challenge results

Eight independent application cases were diagnosed and edited through the existing dt registry on unmodified tool commit `4b6dc31ebc085fd0852db986a23ed66840d0632f`. All eight candidates passed the author's separate, blind acceptance execution. Only the Java library case completed a real project test through dt: the seven Node projects cannot be selected by the Maven/Gradle runner. Independent acceptance is not counted as native tool execution.

## Scope and reproducibility

Public pack: `developer-v1`, revision SHA256 `bce05d24eb9c9d45e96c26f8ca01d09276b9a048e2db5879ee86d80034e71d73`. The author froze the oracle separately before releasing the pack. The solver did not read it. All application reads, searches, edits and attempted project runs went through `node cli.js tool`; the evidence recorder invokes that exact existing boundary. Shell commands installed dependencies, provisioned fixtures, configured task-local Git routing, and recorded evidence. No dt implementation was changed.

The disposable setup is `/Users/user/.codex/worktrees/developer-challenge-proof/prepared`; `DT_HOME` is its `dt-home` directory, and workspaces are below `dt-home/work`. Source environment `fixture` contains two SELECT-only PostgreSQL databases. A separate scratch control database runs on the solver's own PG16 container, `dt-challenge-solver-pg`, loopback port 55487. Existing `dt-pg` and `dt-demo-webui` were untouched. The Java setup uses Temurin21 and the supplied Maven3.9.11 executable.

The public harness initially advertised an unavailable workspace URL argument and a wrong branch. The author corrected the setup contract: standard `{project,repo,ref:"main"}` arguments plus an isolated `GIT_CONFIG_GLOBAL` file map fake Bitbucket clone URLs to local fixture remotes. C03 received the author's separately versioned build-only overlay, pinning Maven/JUnit plugins; no application behavior or expected tests were supplied by it.

`call.mjs` stores exact secret-safe arguments, outputs, original output byte counts and elapsed times in `evidence/`. New records also include request/output digests and a 64KiB output bound. `*-test.json` and `*-fix.json` are replayable registry requests, not direct source edits. `stage-requests.mjs` only creates request documents. `submissions.json` identifies patch files, Git bases and native test proof. The C06 patch preview is explicitly truncated by dt; replay its write requests plus fixture export, or retain the downloadable full patch. The preview must not be mistaken for a full patch.

## Per-case verdicts

| Case | Symptom and evidenced diagnosis | Before → after actual tests | Fix correct | Test sensitivity | Tool complete |
|---|---|---|---|---|---|
| C01 | Per-unit VAT rounding produced357 rather than invoice356; Number arithmetic also lost the safe-integer boundary. Sum extended net lines, then round once using integer arithmetic. | Author: fail2 → pass2 | Yes, blind acceptance | Real baseline failures | **No:** Node selection unsupported |
| C02 | Checkout truncated12.50 major units to12 cents before calling the real reservations adapter. Parse exact decimal text to1250 cents and reject invalid/overflowing totals before any downstream call. | Author: fail2 → pass2 | Yes, blind acceptance | Real baseline failures | **No:** Node selection unsupported |
| C03 | Service imports `LedgerAmount`; its currency scale map contains KWD3/JPY0, but conversion hardcodes2. Use the selected currency's scale. | **dt Maven:** fail2 → pass2; author independently compiled service + library | Yes, blind acceptance | **Native red-green2 tests** | **Yes for library fix/build;** service acceptance separately executed |
| C04 | Production `90s` was parsed as90ms; staging90000 remained90000. Parse and validate full duration syntax and exact multipliers. | Author: fail2 → pass2 | Yes, blind acceptance | Real baseline failures | **No:** Node selection unsupported |
| C05 | Number conversion collapsed adjacent large decimal IDs. Validate and canonicalize exact identities before mutating dedup state; preserve tenant scope. | Author: fail2 → pass2 | Yes, blind acceptance | Real baseline failures | **No:** Node selection unsupported |
| C06 | Risk lookup ignored tenant and payment update ignored tenant. Real source queries showed tenant11 BLOCKED and tenant22 APPROVED, sharing account/order IDs. Add tenant to both SQL predicates and parameters. | Author real PG16: pass1/fail3 → pass4 | Yes, blind acceptance | Actual four-table/two-DB before/after states | **No:** Node runner gap; native capture/export/replay passed |
| C07 | Quotation was unimplemented. Implement validated thresholds, odd-cent half refunds, and nonrefundable behavior without changing input. | Author: pass1/fail1 → pass2 | Yes, blind acceptance | Positive threshold and invalid-input assertions; mutation check requested separately | **No:** Node selection unsupported |
| C08 | Test-writing task against the actual reference module. Add behavior tests for SKU-scoped duplicates, immutability, safe arithmetic and failed-event retry; production bytes unchanged. | Author reference: pass2; all8 independent semantic mutants rejected | Yes, tests-only acceptance | **8/8 mutants detected** | **No:** Node selection unsupported |

The Node rejection was actually attempted for every case using `test_run {workspace,tests:["test/regression.test.cjs"],mode:"build"}`. It returns `state:"failed"` and `no test class ...`, even though `workspace_write` confirms that file exists. These are runner limitations, not executed failing application assertions. The initial argument-free C01 probe also failed with `which test classes to run`; it is not a reproduction test.

## Exact application revisions

| Case | Repository and workspace | Git base |
|---|---|---|
| C01 | CASES/c01 — c01-main-a04c | `632a0fdc240ca8052c7c92e257c69594d08f77f4` |
| C02 | CASES/c02 — c02-main-728a | `53a2705aa73bc39b5a9b3f46265390b4b9f7101b` |
| C03 | LIB/common-primitives — common-primitives-main-7397 | `6f76bff2c5c699a70e64b591799200a3f142f544` |
| C03 consumer | FIN/ledger-service — ledger-service-main-81bf, unchanged | `852ff1d184c20785f38aa3e9e070c403e1c987e4` |
| C04 | CASES/c04 — c04-main-43a5 | `637246d07986be76bfa479e0e3d9efce2da41b11` |
| C05 | CASES/c05 — c05-main-8261 | `fb856dd357ce41129c7284f9f0c4540688ef6a36` |
| C06 | CASES/c06 — c06-main-a358 | `1220a889a7718475828bfdd82c727b51a7a58f29` |
| C07 | CASES/c07 — c07-main-49cc | `3a0b29fbf683c57cb2ad929cdd658b6be85b927e` |
| C08 | CASES/c08 — c08-main-476f | `e034f2cfa31df5ec6c8d838d2f67f27e6497dd6d` |

The C03 native run used `mvn ... test ... -pl decimal -am`; both test methods are recorded as red-green by `workspace_patch`. The real native baseline, green build, and patch are `2026-10-28T21-48-23-301Z-c03-red.json`, `2026-10-28T21-49-31-211Z-c03-green.json`, and `2026-10-28T21-50-09-743Z-c03-patch.json`. `impact` independently traces the library method to `PostingService#post` and `#main`.

For C06, `find` preceded live reads. Parameterized `pg_query` observed both tenants in each database and exact decimal strings. `fixture_plan` used the schema composite FK plus two explicitly evidenced tenant-qualified cross-database relationships. `fixture_capture` read8 rows in4 queries, `complete:true`, no gaps. `fixture_export` created hashed SQL/JSON resources; `fixture_replay` actually loaded and validated both databases on scratch PG, then dropped them. The captured fixture is not a distributed snapshot; no Kafka or Elasticsearch source was part of this original case.

## Measurements and limits

The frozen initial evidence contains103 recorded registry invocations, 97.516s summed subprocess time, 115792 original stdout bytes and27831 stderr bytes. Parallel calls overlap, so summed subprocess time is not user elapsed time. The evidence window is21:40:38–21:51:55 UTC and includes setup failures, discovery, waits on author observations and tool gaps. Initial unrecorded schema discovery is documented in README and excluded from these counts. See `metrics.json` for per-case totals.

This corpus proves source navigation, targeted patches, native Maven/JUnit regression execution, actual PG state queries, and bounded two-database capture/export/replay. It does not prove real network RPC orchestration (C02 calls actual modules in process), actual staging/production deployment (C04 uses configuration files), live Kafka delivery/order guarantees (C05 uses state in memory), or distributed commit under failures (C06 has two logical databases on one isolated server). All business rejection states checked in C06 preserve both databases; that does not imply atomicity across independently failing commits.

`call_history {failed:true}` omitted jobs whose registry invocation succeeded but whose returned job state was failed. A subsequent filtered history call did retrieve persisted calls, so this is a failure-status/filtering distinction, not evidence that CLI history is lost. The recorder is the durable per-call evidence for this run.

Supplemental S01–S04 evidence is kept separately and is not included in the initial eight-case verdicts or measurement snapshot.
