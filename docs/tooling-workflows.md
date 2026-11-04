# Tooling review: usage, scratch databases, patches and file archives

## What the available call history proves

The accessible records are synthetic developer-challenge runs, not production usage telemetry. The prepared challenge log contains 153 call events (28 October 2026): workspace_read 33, workspace_write 19, test_run 17, workspace_open 15, workspace_patch 9, code_search 6. There are no explicit testdb_* or workspace_push calls in that log. Two later synthetic native-replay logs contain 155 and 43 events; neither contains explicit testdb_* calls. These datasets do not justify removing tools or claiming production adoption.

One of the 17 test_run events specifies db, one specifies fixture_path, and none specifies fixture_template. These are requested routes, not proof that preparation or tests completed. The older records contain invocation success/error but lack the newer execution evidence needed to count passed tests. Internal calls to testdb.create, template allocation and cleanup are not separate registry events.

For an actual configured instance, inspect call_history (filter by tool/source/failed/status), trace/job evidence and testdb_resources. call_patterns finds repeated sequences. The local log retains approximately the newest 5,000 events with a size bound; discovery/history/script-definition lookups are deliberately omitted, and tool_execute may produce both wrapper and target events. Counts are retained invocation events, not unique user tasks. Successful invocation does not imply passing tests, successful verification or complete cleanup.

## PostgreSQL testing routes

| Route | What it does | Lifecycle |
| --- | --- | --- |
| test_run with env + db, or ddl_path | Loads a DDL snapshot into a new scratch database and supplies Spring datasource settings. This does not automatically copy production rows. | The runner creates and drops it, including after execution failures. Cleanup failures remain visible. |
| test_run with fixture_path | Loads saved, verified SQL schema/data/constraints into private scratch databases; Kafka payload files remain fixture resources. | Automatic cleanup after the run. |
| The same with fixture_template=true | Builds/reuses an immutable prefilled base, then allocates private per-run clones. | Automatic lease cleanup; bases remain reusable. |
| Explicit testdb_* calls | Initializes the dedicated scratch control cluster, builds/verifies bases, allocates leases and exposes resources for debugging/manual runs. | The caller releases leases; testdb_gc reclaims eligible owned resources. |

Use tests.pgUrl / DT_TEST_DB_URL for a dedicated scratch PostgreSQL control database. Source env selects catalog provenance and is not permission to write into that environment. The control registry and database ownership markers must agree before deletion; prefixes alone are insufficient. The Compose testdb profile uses tmpfs, so its databases are disposable when that container is recreated. This facility provides PostgreSQL, not a complete ES/Kafka service environment.

The manual lifecycle is testdb_initialize → testdb_template_plan/build → testdb_template_verify → testdb_clone → inspect/use/reset → testdb_release. testdb_lease_inspect and testdb_resources expose retained resources without passwords; clone/reset return scratch bindings. GC supports dryRun, protects active leases/pinned bases and retains cleanup failures. The tester profile exposes initialization and lease inspection alongside its common template tools; discovery reaches the detailed retention/GC capabilities.

Call history now classifies testdb_template_verify(ok=false) as failed evidence and nonempty testdb_gc.failures as cleanup-failed, while keeping invocation success separate.

## Workspace patch versus push

| Tool | Output and effects |
| --- | --- |
| workspace_patch | Produces the current diff against the workspace base, including untracked files, file counts, existing test proof and a downloadable patch. It uses Git intent-to-add locally to include new files. It creates no commit and publishes nothing. |
| workspace_push | Commits changes and publishes them to the requested feature branch. Requires push.enabled and an explicit user request. It never forces or targets protected/default branches; it can replay onto a moved branch and stops on conflicts. After success, the pushed commit becomes the workspace base, so a new patch is empty until further edits. |

Neither tool runs tests. Existing test proof is reported; push does not enforce green tests. Run test_run mode=build and inspect its outcome before publication. Exporting a patch is optional if the user directly requests a push.

## Archive instead of delete

files_archive moves one file from a writable context/local/SFTP store into a destination context's archived/<batch>/<original-relative-path>. Read with files_read or context_read first and supply its SHA256 revision as expected_revision. Context files are limited to 2 MiB each and 64 MiB total; archive refuses capacity violations before removing external source bytes. Directory/bulk archival is not supported.

```sh
node cli.js tool files_read '{"store":"exports","path":"results/report.json"}'
node cli.js tool files_archive '{"store":"exports","path":"results/report.json","context":"task-context-id","expected_revision":"<revision from read>","summary":"Superseded calculation; retain provenance"}'
```

Within the same context, a rename preserves bytes without temporarily consuming another file's quota; the index and searchable summary move with it. Cross-store operations save and verify the archive before source removal. Local/SFTP sources are staged under a temporary sibling name and rechecked before removal; changed bytes are retained. Symlink sources are refused. The archive destination is unique and never overwritten.

Inspect archived, sourceRemoved and any sourceRecovery path. If source removal fails, the archive remains available and the result identifies the retained source/recovery copy. Do not retry deletion blindly. Local rollback never overwrites a newly created replacement source. This is a file move, not an atomic transaction across an SFTP server and local disk; active writers should be stopped before archival. Files remain retrievable with context_read or the context file store. Restoring them is an explicit copy/write using the existing overwrite/revision controls.

The Context editor's Archive file action uses this tool. context_delete_file remains available for intentional permanent deletion, and its description directs ordinary cleanup to archival. The tool is available by name in direct/tester profiles and through discovery elsewhere. A saved archive with failed source removal is classified as cleanup-failed in history rather than a completed move.

## Admin map URL repair

Public result URLs can use a container hostname, a public base-path prefix, or a different interface from the one serving Admin. The map and screenshot frames now validate the expected keyed result path and load it on Admin's current origin. Arbitrary paths, credentials in URLs and non-HTTP schemes remain rejected. Public links intended for Open WebUI still depend on a correctly configured server.publicUrl / DT_PUBLIC_URL; rebasing Admin frames does not repair an unreachable public URL for another application.

Verification covers local/context/SFTP archival, binary retention, stale revisions, quota failures, index rollback, replacement-source recovery, editor drafts, partial outcome classification and alternate-public-origin map/screenshot embedding.
