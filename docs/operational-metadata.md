# Operational metadata

Calls, jobs, and executions use one operational SQLite database in `cache/state/operational.sqlite`. Context notes, scripts, configuration, binary maps, repository indexes, and large result artifacts keep their existing formats. The database stores bounded metadata and artifact references; it is not a conversation database.

`DT_STATE_DIR` selects a local directory independently of the configuration folder. Use a local persistent volume for it when configuration lives on a network filesystem. SQLite WAL needs local locking semantics. The database and its projection are private local files.

## Backends and compatibility

`DT_STATE_BACKEND=auto` uses the built-in `node:sqlite` when available (introduced in Node 22.5; early Node 22 releases require `--experimental-sqlite`). Availability is checked against the actual builtin. Other supported Node 22 installations use the legacy backend and report the fallback reason in storage status. `sqlite` requires SQLite and reports initialization failures rather than silently switching writable authorities. `legacy` explicitly retains the JSONL/jobs behavior; editable SQLite annotations are unavailable in that mode.

Synchronous `calls.history`, `calls.patterns`, and job callers read a bounded projection. `projection.json` is a disposable read cache written after committed batches; SQLite remains authoritative. The projection is globally limited to 8 MiB and 5,000 records per kind, so it can omit older stories or large rows. Use the async indexed `historyPage` and metadata list APIs for complete retained history. An async flush refreshes the projection, including records written by another CLI/server process.

The owner of every record is the authenticated principal plus the selected story/chat. A bearer token is never an owner identifier or a database field. Listing, editing, exporting, and synchronous projections use exact scope equality. Administrator access does not implicitly select every user's stories. Original unowned JSONL/jobs records belong only to the local/default scope; token users cannot discover them. Explicit local stories are isolated even without multiple configured users. Scoped legacy call logs carry a small owner sidecar so their later SQLite import preserves that exact scope.

## Durability and limits

A dedicated worker owns all SQLite calls. The main process has a producer queue limited to 1,024 records and 8 MiB, sends batches of up to 64, and accepts records up to 256 KiB. Queries accept at most 500 records and return at most approximately 4 MiB per page. Every SQL query is parameterized; clients cannot submit SQL to this database.

WAL transactions use `synchronous=FULL` and a two-second busy timeout. A metadata write is initially **accepted into memory**, not yet durably acknowledged. Storage status shows pending records, byte limits, rejected records, failed writes, the last error, and the last successful commit. `flush()` is the explicit commit/checkpoint barrier. A failed batch remains queued for an explicit flush retry; no external tool action is retried. Queue overflow and oversized records are rejected visibly. Job/execution metadata also has a conservative traversal budget before serialization, with an explicit `metadataProjection.truncated` marker. Tools keep large output in result artifacts instead of enlarging operational records; a compact job verdict remains available for indexed history filters.

Retention is per story: 5,000 calls, 100 jobs, and 1,000 execution records by default. Calls also honor `log.maxMb` / `DT_LOG_MAX_MB` as a retained payload byte budget per story. SQLite may retain reusable pages after deletion, so its physical file size is not the retained payload size. A busy story cannot evict another story's records. Notes in operational annotations share this retention; use context files for long-lived task notes.

Operational transitions and user annotations have one optimistic revision. Users may edit `label`, `notes`, and `tags` only, using the expected revision. State, errors, ownership, invocation evidence, and identifiers are read-only. A concurrent job transition can make an edit stale; refresh and reapply the draft. Later operational writes preserve committed annotations.

## Migration and recovery

At first initialization, the owner imports `cache/_calls.jsonl` incrementally in bounded transactions. A migration cursor records the source identity, completed byte offset, and line count in the same transaction. IDs derive from source path, line offset, and content. Invalid/oversized lines are counted, and a trailing partial line waits for its newline. The source is never removed or rewritten. Retrying after interruption does not duplicate a committed batch.

The bounded original `_jobs.json` is imported without modifying its backup. Restarted jobs/executions with no live owning process become `interrupted`; live owners in another CLI/server process remain running. Persisted process IDs are diagnostic ownership hints, not resumable handles. No operation is replayed because a completion response was lost. Cancellation of a job owned by another live process must be sent to that process.

The schema has an explicit SQLite `user_version`. A database from an unsupported newer schema fails visibly. Keep the original legacy files until migration and query parity are verified. To back up a live store, first stop writers and await `flush()`/`close()`, then copy the database; copying only the main SQLite file during an active WAL transaction is insufficient.

## API for adapters

`lib/state-store.js` exports `ready`, `status`, `flush`, `close`, `snapshot(kind)`, `recordCall`, `putJob`, `putExecution`, `list`, `get`, `edit`, `export`, and `clear`. Production callers inherit the authenticated execution scope; an explicitly supplied owner is for internal captured execution ownership, never an unvalidated request parameter.

`list({kind, limit, before, q, tool, source, status, category, failed})` returns `{records, total, nextCursor}`. Each record has `{kind,id,owner,revision,updatedAt,value,editable,cursor}`. `kind` is `calls`, `jobs`, or `executions`. `category` filters application evidence such as `tests`, separately from invocation success. Returned-running calls reconcile persisted job verdicts before filtering and pagination.

`edit(kind,id,{expected_revision,patch:{label,notes,tags}})` updates annotations only. `export` uses the same bounded pages; continue with `before: nextCursor`. Exported records preserve owner/evidence/revision metadata. Converting them to legacy JSONL for downgrade is an explicit offline operation: preserve `value` and separate owners, stop SQLite writers first, and retain the SQLite backup. Merely selecting `legacy` does not export newer SQLite records into old files.

Shutdown and tests must await `close()` before deleting a state directory. An idle worker is unreferenced; accepted writes and their acknowledgements keep it referenced until the batch settles. Storage failure must remain visible to operators instead of disappearing in a best-effort catch.
