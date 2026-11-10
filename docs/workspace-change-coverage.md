# Lombok compilation and coverage of changes

Workspace checks and fast Maven runs recognize declared annotation processors,
Lombok on the classpath, `lombok.config` and generated Java source roots. These
modules compile through the project's Maven `test-compile` or Gradle
`testClasses` task, using its real processor configuration, compiler plugins,
module dependencies and generated-source lifecycle. Fast Maven runs still use
the selected JUnit tests. Ordinary Java retains the warm incremental compiler.

Successful unchanged compilation is reused only while the source/build/config
pins and generated output inventory agree. Production/config changes or missing
outputs trigger a clean regeneration; test-only edits use native incremental
compilation. This can take longer than a per-file check. Diagnostics identify
`compiler: project-build`; generated-symbol failures never cause speculative
import edits. The project must configure a Lombok release compatible with its
JDK and the required annotation processor paths. See [Lombok's Maven setup](https://projectlombok.org/setup/maven).

## Start without existing coverage

1. Open a Git-backed workspace and inspect `workspace_coverage_plan` with
   `{"workspace":"<returned-workspace-id>"}`. It compares the current working
   tree, including staged and untracked production files, against the checkout
   base commit. Supply `base` to select another Git commit/ref.
2. Run the relevant application regression with
   `test_run {"workspace":"<returned-workspace-id>","tests":["QuoteTest"],"coverage":true}`.
   Optionally use `coverage_base` for a different baseline. Coverage is opt-in;
   ordinary test runs do not provision agents.
3. Read `workspace_coverage` with that workspace. The compact reply lists missed
   lines, missed branches and unknown source mappings. Select `report` to reopen
   a retained run, or `file` for all changed lines in one exact path.
4. Open the native view, select a file and inspect uncovered/all changed lines.
   Prepare an editable source-read draft in Workbench, copy a regression
   briefing, or download the complete report JSON. Add assertions of observable
   entry-to-exit effects, then run coverage again.

This is separate from `test_coverage`, which measures dev-tool itself. Admin
Workbench → Change and verify code → Cover the changed lines and branches
prepares the same tools with editable inputs. Tests and coverage views also
render inline in Open WebUI; routine complete results are collapsed and gaps
open for inspection.

## Collection and evidence

JaCoCo 0.8.16 is pinned by default. No project coverage plugin or historical
project-wide baseline is needed. Maven resolves the agent/CLI from its configured
repository/settings/cache; Gradle can resolve them from its own repositories
and cache without Maven. For offline installations, pre-provision jars and set:

```json
{"tests":{"coverage":{"version":"0.8.16","agentJar":"tooling/jacoco-agent.jar","cliJar":"tooling/jacoco-cli.jar"}}}
```

Paths resolve from the config folder. Runner installations must expose the same
paths to the runner. Normal dependency credentials, offline flags and execution
target placement apply. Existing configured jars take precedence.

Fast Maven runs instrument captured changed production classes. Native Maven
and Gradle runs instrument their test JVMs and report only the changed production
bytecode/source lines. Maven's test JVM must consume `argLine`; a hard-coded
Surefire `argLine` can prevent the agent from loading. No execution data then
returns an explicit unavailable reason; use fast mode or update the project's
test JVM configuration. Gradle attaches the agent through a temporary init
script and disables an existing task JaCoCo agent to avoid duplicate injection.
See [JaCoCo agent preparation](https://www.jacoco.org/jacoco/trunk/doc/prepare-agent-mojo.html)
and [Gradle's JaCoCo task configuration](https://docs.gradle.org/current/userguide/jacoco_plugin.html).

Every retained report records base SHA, source/build/test fingerprint, actual
test outcome, production bytecode identities and workspace-relative XML/exec
artifacts under `.dt/coverage/`. Private reports use the workspace's owner/story
scope. Coverage snapshots do not become project publications automatically.
Changing production, test, schema/generator or build inputs makes old reports
stale and revokes their complete/fully-covered claim.

## Limits

- Current automatic scope is added/modified `.java`, `.kt` and `.groovy` files
  under standard `src/main/{java,kotlin,groovy}` roots. Node, custom source roots,
  external services and generated source outside these roots are not measured.
- Only selected tests execute. Test failures are reported separately; a covered
  line is execution evidence, not proof of assertions or business correctness.
  Partial branches remain visible even when their source line executed.
- Deleted code has no current executable-line denominator. Unmapped or ambiguous
  files remain unknown. Other modules not compiled in the selected run remain
  unknown; they are never credited from stale class files.
- Candidate changed lines become executable/non-executable only after mapping to
  captured bytecode. An empty denominator is not 100%. Budget limits are 500
  changed files, 20,000 changed lines, 8 MiB/source and 256 MiB streamed XML.
- Selected tests, static Joern paths and line coverage answer different questions.
  Preserve all three when assessing a change's intended path and observable effect.

## Reproduce the regression

```sh
DT_TEST_MAVEN="$(command -v mvn)" DT_TEST_GRADLE="$(command -v gradle)" \
  node --test test/lombok-coverage.live.test.js
node --test test/workspace-coverage.test.js
```

The committed fixture uses real Lombok builders and JUnit. It demonstrates the
former per-file compiler rejecting an updated generated builder, the native
compiler accepting it, regeneration after a missing builder class, a missed
changed path, complete changed-line coverage after adding its assertion, and
staleness after another edit. A separate real Gradle run exercises Lombok and
coverage without a project JaCoCo plugin. These small regressions validate the
mechanism; they do not claim coverage of an external service.
