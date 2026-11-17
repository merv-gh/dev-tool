# Workspace editor and Gradle upgrades

Open **Workspace editor** from Studio or Admin, or visit `/editor?workspace=<id>&story=<task>` after `workspace_open`. The editor uses locally bundled CodeMirror 5.65.16 with line numbers, bracket matching, syntax modes, per-file undo history, find, keyboard save, and open-file tabs. It uses the shared light/dark `ui.css` tokens. No CDN or external editor service is needed.

Choose an owned workspace and task. Expand folders, open source, edit and save. Ctrl+S/⌘S saves; Ctrl+F/⌘F searches. Full UTF-8 source is read without display line numbers. BOMs and CRLF are preserved. Binary, malformed UTF-8, oversized files, Git/runtime internals, symlinks and parent paths are rejected. A save must carry the SHA-256 revision returned by the last read; concurrent changes return `DT_WORKSPACE_CONFLICT` and preserve the browser draft. Closing/switching away from a dirty draft requires an explicit discard.

`workspace_editor` supports `list`, `tree`, `read` and `save`. `expected_revision:null` creates a new file only. Tool arguments cannot select a principal: workspace, job and inventory ownership come from the authenticated task context. UI requests carry the selected `x-dt-story`; changing that header never grants another principal's access.

## Terminal

The panel runs `pwd`, `ls`, `git status`, `git diff`, `git diff --stat`, `git log` and `git branch`. These are fixed commands and options. Input is never evaluated by a shell; executable names, custom arguments, environment values and path/revision selectors are not accepted. Git inspection disables filesystem hooks and external diff/text conversion. Output is redacted and capped at 64 KiB; jobs retain bounded logs and actual placement/exit evidence. Clear hides earlier output; Cancel uses the existing execution/process-tree lifecycle.

Build execution requires all of the following: administrator access, `workspaceEditor.terminalBuilds:true`, configured `tests.runnerUrl` and `tests.runnerToken`, and `allow_build:true` on this run. Allowed build commands are `gradle test`, `gradle build`, `gradle dependencies`, `mvn test` and `mvn verify`. They use the workspace wrapper/configured build executable and the existing filtered build environment. Execution uses the authenticated runner with a two-minute deadline; there is no local build fallback. A build executes repository code, so enabling it is an explicit operator policy.

```json
{"workspaceEditor":{"terminalBuilds":true},"tests":{"runnerUrl":"http://runner:4100","runnerToken":"${DT_RUNNER_TOKEN}"}}
```

## Cross-repository dependency inventory

```sh
node cli.js tool gradle_inventory '{"action":"index","repos":["PAY/payments","LIB/platform"]}'
node cli.js tool gradle_inventory '{"job":"<returned-job>"}'
node cli.js tool gradle_inventory '{"action":"list"}'
node cli.js tool gradle_inventory '{"action":"read","revision":"<revision>"}'
node cli.js tool gradle_inventory '{"action":"search","dependency":"org.slf4j:slf4j-api"}'
```

An index call starts one cancellable job for all selected repos. Omit `repos` to discover every Bitbucket repository. Each repository resolves to one SHA, lists its tracked files once, and reads all matching blobs in one `git cat-file --batch` process. Matching sources include every nested `build.gradle`/`build.gradle.kts`, settings file, `gradle.properties`, and `gradle/*.versions.toml`. Bounded source size/count limits fail visibly. Symlinks are excluded and reported. Dirty working files do not affect these committed snapshots.

Snapshots are immutable and addressed by repository, full SHA, parser format and configured internal groups. A cached full SHA needs no Git fetch or parse. A branch resolving to a retained SHA reuses it. `readStats` reports tree/batch/blob counts. Repository/revision lists and job results survive restarts within their authenticated task.

`search` finds dependency versions and owners across every cached repository without network access. `q` accepts plain search words; `dependency` matches an exact coordinate; `repos` narrows repository names. Results include the immutable revision for planning. `history:true` includes retained older commits; the default searches each repository's latest indexed revision.

The static lexer skips comments and preserves exact source offsets. It recognizes Groovy/Kotlin coordinate declarations, common named `group/name/version` forms, literal local/extra variables, inherited properties, plugin versions, version catalog literals/`version.ref` and catalog usages. `project(":module")` is an internal project reference with no external version owner; configured internal groups label internal external artifacts. An absent, computed, ambiguous, reassigned, managed or rich version remains explicitly unresolved. This is a source inventory, not Gradle dependency resolution: external catalogs, custom build logic, bundles, complex scopes and runtime substitutions require inspection.

## Review and apply

```sh
node cli.js tool gradle_bump '{"action":"plan","revision":"<revision>","dependency":"com.fasterxml.jackson.core:jackson-databind","version":"2.17.2"}'
node cli.js tool gradle_bump '{"action":"apply","plan":"<plan-id>","workspace":"<matching-workspace>"}'
```

Plans do not edit source. A plan shows exact version owners, proposed file content, blocked declarations and every known consumer sharing each owner. A literal upgrade edits only that parsed version span. A property/catalog/variable upgrade edits its shared owner once. Comments and unrelated equal version strings remain untouched. Unresolved selected declarations block apply.

Apply is explicit. It requires an owned workspace for the same repository and checked-out HEAD SHA, and verifies every target file hash before the first save. Save failures restore this operation's exact bytes using revision guards. The result reports `applied:false`, the error, and whether rollback completed; independently changed files are preserved and named as incomplete. Filesystem rollback cannot promise crash atomicity. No build, commit, push or remote mutation is implied. Review `git diff` and run the build explicitly afterwards.

## Demo and verification

`DT_HOME=/path/to/config node demo/seed-editor.js` seeds a synthetic local Git repo, opens/reuses a workspace, inventories root/nested Gradle files and prints an editor URL plus immutable revision. It includes a real Unicode Java filename and shared catalog/property ownership. The helper can be imported as `require('./demo/seed-editor').seed()` after setting `DT_HOME`; it does not start a server, alter existing source or invoke a build.

Focused verification: `node --test test/editor-gradle.test.js`. Tests use real temporary Git repos and a real token-protected HTTP runner, checking UTF-8/CAS/boundaries, immutable reuse, revision changes, guarded shared-owner upgrades, failed-save rollback, inspection execution, runner-only builds and process cancellation.

`node demo/check-editor.js /absolute/output/directory` exercises the actual editor UI at desktop and 390px widths using Playwright. It checks Unicode saves, stale revision draft preservation, real inspection output, catalog preview/apply, same-origin assets, console/network errors and horizontal overflow. It writes screenshots and an evidence report; it uses a temporary synthetic configuration and deletes it afterwards.

Bundled editor license and source archive hash: `web/vendor/codemirror/LICENSE` and `PROVENANCE.json`. Upstream files are unmodified concatenations from the pinned npm archive.
