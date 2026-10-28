# Independent implementation review

Reviewed the Open WebUI tool surface, discovery/permission boundary, replacement-backend protocol, semantic source/graph behavior, collection suites and evidence exports. This is a bounded implementation review, not the earlier completeness roadmap. The review ran in the isolated `codex/platform-independent-review` worktree; platform source was inspected read-only in the integration worktree.

## Findings

1. **Replacement backend errors could be reported as success (P1).** `lib/adapter-port.js` checked only whether a result or error key existed, then tested the truthiness of `body.error`. A matching `dt.tool/v1` response containing `error:null` was accepted as a successful `undefined` result. Reproduced with a local HTTP server that echoed request identity and returned `error:null`. The integration owner accepted the finding and is validating the full published response contract. Contract mismatch must stay explicit, with no local fallback/retry.
2. **Declared schema assertions could silently disappear (P2).** `lib/schema.js` accepted `3` against `{type:"number",multipleOf:2}` and `[]` against `{type:"array",contains:{const:1},minContains:1}` with no issues. These are assertions, unlike harmless annotation keywords. The integration owner accepted the finding: supported assertions must execute and unsupported assertions must fail explicitly before a tool/backend runs.
3. **Missing exact graph lookups looked complete (P2).** A query for `entity:"service:nonexistent"` in a clean cached environment returned `{nodes:[],complete:true,gaps:[]}`. This conflated a complete lookup with missing cached evidence. The integration owner accepted the finding and is adding an explicit missing-entity gap with `complete:false`.
4. **Collection input retention did not honor the opt-out (P2, fixed here).** Even with `evidence:false`, saved `plan.cases[].params`, `plan.scopes[].params` and case overrides retained inputs. Definition and inherited hook source also remained in all reports. The fix uses a separate `lib/collection-evidence.js` presentation boundary: executable snapshots remain in memory; durable definitions retain source hashes, parameter names and step-kind summaries. Case/scoped inputs and matrix values are omitted by default, opt-in bindings are sanitized, and known credential echoes are scrubbed from results/logs/errors. Running/final history, direct returns, JSON, JUnit and saved views share the same boundary. Execution still receives the original bindings.

## Verification

- A standalone negative check reproduced all four findings before their fixes. It used an ephemeral configuration and local HTTP server, with no environment-system calls.
- `node --test test/collections.test.js`: **23 passed, 0 failed/skipped**, approximately 6.1 seconds.
- New regressions cover a running report before any case, final persisted history, direct returns, saved interactive data, shared-registry JSON/JUnit, input opt-out/opt-in, matrix/scoped inputs, configured credentials, hook-generated credentials, secret echoes, untouched executable credentials and source-summary retention.
- Existing collection checks still cover cancellation/deadlines and finally cleanup, dynamic source edits during a run, nested scopes/datasets, typed parameters, static preflight, safe HTTP retry behavior, assertion failures and CI exit status.
- `git diff --check` passed. Integration rebuild/full-suite verification belongs to the integration worktree after these commits are combined.

## Accepted boundaries

Profiles select the definitions presented to a model; the enabled registry still authorizes direct and `tool_execute` calls. No permission bypass was found in that path. The knowledge source model keeps directional relations and exact revisions separate from runtime proof; optional Confluence content is not required for basic graph/search. Backend transport has no automatic in-process fallback. Generic in-flight actions can have unknown outcomes on cancellation and must not be retried silently.

Credential redaction recognizes credential-shaped fields, configured credentials and their known echoes; it does not infer every possible secret hidden in arbitrary business output. Output inspection remains available even when input retention is off. Historical executable package replay/resumption remains a separate future capability; source revisions are retained without persisting runnable source.

## Browser/API workbench follow-up

Reviewed commit `48b0173` independently against the current integration base. The following concrete issues were fixed in this worktree:

- Saving a prepared bodyless GET/HEAD produced `body:""`; fetch then rejected its execution. The explicit `none` body now survives import, prepare, save and the actual script runner.
- Saved requests lost assertions/captures/hooks already present in a prepared contract unless every field was passed again. The save stage now preserves those declared fields while rebuilding the sole HTTP step. It also preserves original source/handler evidence after exchange expiration; injected arbitrary executable steps remain unused.
- Header bindings used lowercase names without replacing differently cased originals. Prepared headers are now normalized, with duplicate/malformed headers rejected before sending.
- Field-name scrubbing missed credential values echoed under unrelated response names. Known captured strings are scrubbed throughout the normalized artifact, without replacing reusable parameter placeholders. Repeated sensitive form values retain cardinality.
- Capture error records bypassed rolling limits and response jobs had no concurrency bound. Both successful and failed records use one finite enqueue path; at most 16 response reads run at once. Compressed responses are omitted before body reads because wire Content-Length cannot bound decompression.
- Subsequent browser navigation did not repeat the HTTP(S)/inline-credentials validation applied at open. It now applies the same boundary. Reserved prototype names cannot become explicit binding names.
- Native/adapter `unavailable`/`unsupported` body descriptors did not create evidence gaps. They now remain explicit gaps, including base64 bodies; invalid byte metadata is omitted.

Verification used actual local HTTP, the real saved-script engine, a fake streamable MCP server and executed fixed-listener instrumentation. New adversarial tests exercise 1,000 simultaneous responses (16 retained, 984 reported dropped), 105 sequential capture failures (100 retained, five dropped), no-read compressed bodies, differently named secret echoes, bodyless GET/HEAD execution, preserved failing assertions and expired source exchanges. The focused API/scripts/collections/views run passed **68 tests, zero failures/skips** before the final descriptor-gap regression; the API-only run afterward passed **30 tests, zero failures/skips**. Real Chromium/native Playwright capability validation is independently owned by the API implementation agent. No integration or generated distribution files were edited in the review worktree.
