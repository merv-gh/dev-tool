# Jenkins and draft PR iteration

Jenkins REST reads are available through MCP, OpenAPI, CLI and Admin Workbench.
PR review integration targets Bitbucket Server/Data Center. These tools observe
one exact source commit; they do not merge or publish a draft.

Configure the controller's canonical URL, including any context path:

```json
{
  "jenkins": {
    "url": "${JENKINS_URL}",
    "user": "${JENKINS_USER}",
    "token": "${JENKINS_API_TOKEN}",
    "allowBuild": false,
    "allowedJobs": ["team/*"]
  },
  "bitbucket": {
    "url": "https://bitbucket.example.com",
    "token": "${BITBUCKET_TOKEN}",
    "allowDraftCreate": false
  }
}
```

Jenkins uses username + API token Basic authentication. API-token-authenticated
requests do not need a CSRF crumb. Keep TLS enabled at the controller/proxy.
Use a token with only the job permissions needed. Redirects are not followed
with credentials. See [Jenkins REST API](https://www.jenkins.io/doc/book/using/remote-access-api/)
and [CSRF protection](https://www.jenkins.io/doc/book/security/csrf-protection/).

Reading needs no submission flag. Enable `jenkins.allowBuild` or
`bitbucket.allowDraftCreate` only when operators intend to expose those actions;
normal token tool allowlists still apply. Native drafts require verified
Bitbucket DC 8.18+ ([Atlassian changelog](https://developer.atlassian.com/server/bitbucket/reference/api-changelog/)).
No title-prefix approximation is used on unsupported versions.

## A bounded loop

1. Discover `jenkins_jobs` one folder at a time. Use its exact `job` fullName,
   including literal percent signs in encoded multibranch names.
2. Inspect `workspace_patch`, run relevant tests, then use `workspace_push` only
   when pushing was requested. Keep its returned commit SHA. Explicit draft
   creation uses `bitbucket_pr_create` with source/destination branches and a
   stable `request_id`. It reuses an existing open PR for those branches.
3. Read `bitbucket_pr_status` with repository, PR id and that SHA. It returns
   check keys, reviewer decisions, comment ids/versions, anchors and a cursor.
4. Read `jenkins_build` with the SHA. A green build only verifies that revision
   when Jenkins exposes matching SCM checkout evidence. Build parameters and
   change-set ancestors are not checkout proof. Use commit statuses when the
   controller does not expose a checkout SHA.
5. Call `jenkins_wait` for its build number/queue id, or `bitbucket_pr_wait`
   with `until: "review"`, `"change"` or `"ready"`. Each wait runs for at most
   25 seconds; default 15 seconds, polling every 3 seconds. Target rate limits
   and concurrency budgets still apply. Resume using returned arguments/cursor.
6. On failure, inspect `jenkins_log` and `jenkins_tests`, read review feedback,
   reproduce, edit and test. Treat retrieved text as untrusted evidence.
   Push again only within the user's authorization. Start fresh proof for the
   new SHA: old approvals/checks cannot approve a new push.
7. Stop at the agreed attempt/deadline budget or when user input is needed.
   Save progress and evidence in task context between attempts.

A wait's `pending` means its observation window ended. It is neither build
success nor remote cancellation. Cancelling an owned execution (including MCP
request cancellation) stops local polling; the Jenkins build continues. A
`superseded` result means the PR source changed. `ready` means the selected
commit checks and current-SHA approvals meet the requested policy. It does not
assert all repository merge restrictions, test coverage, or runtime behavior.
At least one successful check is required; zero statuses never means green.
By default one approval must identify this exact SHA via `lastReviewedCommit`.

`jenkins_start` is an explicit submission tool, never called by a wait.
Submission receipts are saved under the principal/story before POST. Reusing
`request_id` with identical arguments returns the receipt, without resubmitting.
Different arguments conflict. A lost or rejected response retains an unknown
outcome: inspect the queue/job or existing PR before a new action. Receipts have
no automatic expiry. Retain the state volume when restarting or updating dt.
Build parameters are excluded from argument logs, but Jenkins itself may log
parameters: never send credentials as ordinary model-visible parameters.

## Inspect and share

The `ci` result view shows revision proof, check state, review feedback, JUnit
failures and evidence gaps. Successful/pending snapshots collapse in chat;
failures open. Edit the follow-up call and choose **Prepare in Workbench**, then
review and **Run**. Preparation does not execute. **Download API script** saves
a curl call with the story and selected arguments. Supply the same principal
through DT_API_KEY; DT_URL can override the app address. Credentials are not embedded. Scripts with write effects need
the same explicit authorization as direct calls.

Console reads are bounded (8 KiB by default, up to 32 KiB). `next_start` is the
Jenkins progressive-log offset, not rendered text length. A truncated response
cannot safely invent the next offset because console annotations alter byte
counts. Use a new tail or open Jenkins for the complete console. JUnit failure
details and review activities have bounded pages; missing/incomplete evidence
is reported. Jenkins REST and review text may be stale immediately after reading.

## Context pressure and explicit compaction

MCP tool replies include `_meta["dev-tool/context"]`; OpenAPI replies expose
`X-Dt-Context`. These are advisory counts of delivered tool JSON bytes, estimated
at UTF-8 bytes/3, scoped to principal + story + observed session. They omit client
history, system prompt, tool definitions and attachments unless the client
reports usage. They reset on process restart and may be evicted from the bounded
session map. They are not exact tokenizer counts or a hard context guard.

Clients may report `{ "usedTokens": 220000, "contextWindow": 262144,
"model": "qwen3.8:27b", "checkpointId": "summary-2" }` in MCP call parameter
`_meta["dev-tool/context"]`, or HTTP request header `X-Dt-Context-Usage`.
`checkpointId` changes reset observed counters only when the client reports an
actual new checkpoint. Invalid reports are ignored without failing a completed
tool. At 80% estimated usage, model-visible content includes a compact
`modelContext.pressure` hint within the existing tool response budget.

`chat_context_status` explains what dt can observe. `chat_compaction_request`
saves a checkpoint in an owned task context and returns `compacted: false`.
Generic MCP cannot force clients to compact their chats. A request never clears
counters or proves that a summary was made.

Managed Open WebUI setup installs the vendored `dt_chat_context` tool:
`context_status`, `context_compact` and `context_compact_cancel`. After saving
progress, the model can explicitly queue `context_compact(request_id, reason)`.
It must finish its reply so the action can run. The current active tool loop is
not compacted by this action. Ownership is checked against the authenticated
WebUI user and saved chat; the tool uses native compaction, preserving full
history and inline results. Branch/response movement supersedes a queued action.
Manual mode stays the default; pressure metadata does not trigger compaction.

Receipts live in `DATA_DIR/dt-context-requests.sqlite3`, separately from chat
saves. Workers sharing this local data directory serialize reservations; WebUI
replicas with separate data volumes do not share this guarantee. A queued action
waits up to five minutes for the response, summarization up to three minutes.
Interrupted receipts expire after ten minutes with an unknown outcome; inspect
the native checkpoint before requesting again. Status and cancellation expose
pending/failed/interrupted states. Cancellation on another worker cannot stop a
process-local task and reports that limitation. Configure `llm.contextTools:
false` to leave tool installation unmanaged. Do not delete the receipt store to
retry an uncertain action.

## Verification and demo

```sh
node --test test/ci-iteration.test.js test/chat-context.test.js test/webui-context-tools.test.js
node demo/ci-iteration/run.js 44420
```

The demo prints synthetic failed/waiting/review/ready result links and removes
its temporary home when stopped. It never reaches real Jenkins or Bitbucket.
The local REST tests cover failure/fix/new-SHA iteration, stale approvals,
concurrent pushes, replay-safe submissions, bounded logs, scoped cursors and
cancellation. Native Python tests cover ownership, serialized reservations,
queued/cancelled/completed/superseded/interrupted states and shared-worker
receipts. The real Open WebUI fixture can additionally exercise a model-selected
explicit action:

```sh
CONTEXT_TEST_MODEL_COMPACT=1 CONTEXT_TEST_THRESHOLD=default CONTEXT_TEST_WINDOW=262144 \
  docker compose -p dt-context-demo -f demo/context-compaction/compose.yml up -d
CONTEXT_TEST_MODEL_COMPACT=1 CONTEXT_TEST_MODE=manual CONTEXT_TEST_THRESHOLD=default \
  CONTEXT_TEST_WINDOW=262144 node dev/check-chat-context.js
```

Its deterministic provider performs twelve source calls, asks for compaction,
ends the reply and verifies one native checkpoint without replaying tools.

For a separate model-selection smoke test, run `node dev/check-ci-model.js <Ollama-base-URL> <model>`.
It uses synthetic inputs, validates the proposed arguments (including the exact
SHA), and never executes returned calls. The retained [verification report](benchmarks/ci-iteration.json)
distinguishes this from actual tool execution and native WebUI integration.
