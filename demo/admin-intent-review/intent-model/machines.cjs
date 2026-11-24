// Proposed interaction contracts, not the production runtime. No services are invoked.
const { createMachine, assign } = require('xstate');
const node = (label, on = {}, description = '') => ({ meta: { label, description }, on });
const group = (label, initial, states, on = {}, description = '') => ({ ...node(label, on, description), initial, states });
const to = (target, extra = {}) => ({ target, ...extra });
const guarded = (guard, yes, no) => [{ guard, target: yes }, { target: no }];
const commonContext = ({ input }) => ({ canRead: true, canWrite: true, admin: true, owner: 'owner-a', ...(input || {}) });
const definitions = {
  session: {
    meta: { label: 'Task and scope', lifetime: 'One actor per owned task', description: 'Opening, resuming and changing scope must finish before restoring a linked action. Opening a chat never recreates its workspace.' },
    initial: 'initializing',
    context: ({input}) => ({...commonContext({input}),pendingLink:false}),
    guards: { hasPendingLink: ({context}) => context.pendingLink },
    actions: { rememberLink: assign({pendingLink:true}) },
    states: {
      initializing: node('Resolve identity, environment and retained task', { OPEN_LINK: {actions:'rememberLink'}, READY: guarded('hasPendingLink','opening','home'), FAILED: 'unavailable', UNAUTHORIZED: 'signedOut' }),
      unavailable: node('Initialization failed; explain and retry', { RETRY: 'initializing' }),
      signedOut: node('Access required; retain the deep link', { AUTHENTICATED: 'initializing' }),
      home: node('Choose an existing task or start one', { NEW: 'creating', OPEN: 'opening', OPEN_LINK: 'opening' }),
      creating: group('Create a durable task', 'draft', {
        draft: node('Describe task and choose scope', { VALID: 'saving', INVALID: 'invalid', CANCEL: '#session.home' }),
        invalid: node('Explain missing task fields; keep draft', { EDIT: 'draft' }),
        saving: node('Persist task identity', { SAVED: '#session.active', FAILED: 'saveFailed', ACK_UNKNOWN: 'unknown' }),
        saveFailed: node('Task not saved; keep draft', { RETRY: 'saving', CANCEL: '#session.home' }),
        unknown: node('Check whether creation was accepted', { FOUND: '#session.active', NOT_FOUND: 'draft' })
      }),
      opening: node('Load retained task, files, workspace and jobs', { LOADED: 'active', NOT_FOUND: 'missing', DENIED: 'denied', FAILED: 'unavailable' }),
      missing: node('Link missing or expired; choose another task', { CHOOSE: 'home' }),
      denied: node('Owned scope is unavailable to this principal', { CHOOSE: 'home' }),
      active: group('Task open; conversation is the main surface', 'conversation', {
        conversation: node('Conversation with Files and Background drawers', { FILES: 'files', BACKGROUND: 'background', CHANGE_SCOPE: 'scopeChange', CLOSE: '#session.home', ARCHIVE: 'archiveConfirm' }),
        files: node('Selected task files; paged folders', { CHAT: 'conversation', BACKGROUND: 'background' }),
        background: node('Owned background tasks; active and blocked first', { CHAT: 'conversation', FILES: 'files' }),
        scopeChange: node('Resolve dirty work and active operations first', { KEEP_SCOPE: 'conversation', SAFE: 'scopeLoading' }),
        scopeLoading: node('Load the requested scope; do not mix results', { LOADED: 'conversation', FAILED: 'scopeFailed', DENIED: 'scopeDenied' }),
        scopeFailed: node('Scope failed; retain previous task and draft', { RETRY: 'scopeLoading', KEEP_SCOPE: 'conversation' }),
        scopeDenied: node('New scope denied; retain previous task', { KEEP_SCOPE: 'conversation' }),
        archiveConfirm: node('Archive task without cancelling independent jobs', { CANCEL: 'conversation', CONFIRM: '#session.archived' })
      }),
      archived: node('Archived task, retained files and execution history', { RESTORE: 'opening', CHOOSE: 'home' })
    }
  },
  chat: {
    meta: { label: 'Conversation', lifetime: 'One actor per task conversation', description: 'Composer stays usable for steering. Tool receipts collapse into the conversation. Files and jobs keep their own lifetimes.' },
    context: () => ({ draft: '', submitted: '', steering: '', contextPressure:false }), initial: 'ready',
    on: { EDIT: {actions:'edit'}, CONTEXT_WARNING: {actions:'warnContext'} },
    states: {
      ready: node('Write, attach evidence, or choose a suggested intent', { EDIT: { actions: 'edit' }, SEND: guarded('hasMessage', 'submitting', 'empty'), ATTACH: 'attaching', COMPACT: 'compactConfirm' }),
      empty: node('Write a message before sending', { EDIT: { target: 'ready', actions: 'edit' } }),
      attaching: node('Select retained evidence; opening runs nothing', { ATTACHED: 'ready', CANCEL: 'ready', FAILED: 'attachmentFailed' }),
      attachmentFailed: node('Attachment unavailable; message retained', { RETRY: 'attaching', KEEP_MESSAGE: 'ready' }),
      submitting: node('Message persisted; waiting for admission', { ACCEPTED: {target:'responding',actions:'accepted'}, OVERLOADED: 'overloaded', FAILED: 'sendFailed', ACK_UNKNOWN: 'unknown' }),
      overloaded: node('Busy: show queue/retry time; no retry storm', { RETRY: 'submitting', KEEP_DRAFT: 'ready' }),
      sendFailed: node('Send failed; retain message and attachments', { RETRY: 'submitting', EDIT: { target: 'ready', actions: 'edit' } }),
      unknown: node('Reconnect and reconcile the accepted message', { FOUND: 'responding', NOT_FOUND: 'ready' }),
      responding: group('Assistant turn', 'streaming', {
        streaming: node('Stream text; keep composer active', { TOOL: 'tool', QUESTION: 'question', DONE: '#chat.complete', STEER: { actions: 'steer' }, CONTEXT_FULL: '#chat.contextBlocked', CANCEL: '#chat.cancelling', DISCONNECTED: '#chat.unknown' }),
        tool: node('Tool running; receipt, progress and cancel alongside', { TOOL_DONE: 'streaming', TOOL_FAILED: 'streaming', STEER: { actions: 'steer' }, CANCEL: '#chat.cancelling', QUESTION: 'question', DISCONNECTED: '#chat.unknown' }),
        question: node('Needs user input; preserve partial work', { ANSWER: 'streaming', STEER: { actions: 'steer' }, CANCEL: '#chat.cancelling' })
      }),
      complete: node('Retained answer, assumptions and next actions', { EDIT: { target: 'ready', actions: 'edit' }, SEND: guarded('hasMessage', 'submitting', 'empty'), COMPACT: 'compactConfirm' }),
      contextBlocked: node('Context full; keep conversation and offer explicit compaction', { COMPACT: 'compactConfirm', SAVE_AND_NEW: 'ready' }),
      compactConfirm: node('Review what will be summarized; compaction is optional', { CONFIRM: guarded('explicit', 'compacting', 'contextBlocked'), CANCEL: 'ready' }),
      compacting: node('Compact only after explicit user/model action', { DONE: 'ready', FAILED: 'compactionFailed', CANCEL: 'ready' }),
      compactionFailed: node('Original conversation retained', { RETRY: 'compactConfirm', KEEP_ORIGINAL: 'ready' }),
      cancelling: node('Cancellation requested; wait for acknowledgement', { CANCELLED: 'cancelled', ACK_UNKNOWN: 'unknown', CLEANUP_FAILED: 'cleanupFailed' }),
      cleanupFailed: node('Stop acknowledged; cleanup still needs attention', { RETRY_CLEANUP: 'cancelling' }),
      cancelled: node('Turn stopped; partial answer and files retained', { EDIT: { target: 'ready', actions: 'edit' }, SEND: guarded('hasMessage', 'submitting', 'empty') })
    },
    guards: { hasMessage: ({ context }) => !!context.draft.trim(), explicit: ({ event }) => event.explicit === true },
    actions: { accepted: assign({submitted:({context})=>context.draft,draft:''}), warnContext: assign({contextPressure:true}), edit: assign({ draft: ({ event }) => event.text || '' }), steer: assign({ steering: ({ event }) => event.text || '' }) }
  },
  action: {
    meta: { label: 'Tool or API action', lifetime: 'One actor per execution; owner and target pinned', description: 'All capabilities reuse this receipt lifecycle. A completed invocation does not prove an assertion. Effects are never silently replayed after an unknown acknowledgement.' },
    context: commonContext, initial: 'draft',
    states: {
      draft: node('Prepare from chat, selected evidence, or exact arguments', { PREPARE: 'preflight' }),
      preflight: group('Resolve before execution', 'scope', {
        scope: node('Resolve environment, service, database and exact ref', { RESOLVED: 'access', MISSING: 'missing', STALE: 'stale' }),
        missing: node('Choose an indexed identity or explicit override', { CHOOSE: 'scope', CANCEL: '#action.draft' }),
        stale: node('Show source age; refresh or use pinned evidence', { REFRESH: 'scope', USE_PIN: 'access', CANCEL: '#action.draft' }),
        access: node('Check principal, operation and target', { AUTHORIZE: guarded('authorized', 'arguments', 'denied') }),
        denied: node('Explain denied action without exposing private results', { CHANGE: 'scope', CANCEL: '#action.draft' }),
        arguments: node('Validate required fields and target substitutions', { VALID: '#action.ready', INVALID: 'invalid' }),
        invalid: node('Inline validation; keep entered arguments', { EDIT: 'arguments', CANCEL: '#action.draft' })
      }),
      ready: node('Prepared only; explicit Run or authorized task policy', { RUN: guarded('explicit', 'running', 'approvalNeeded'), EDIT: 'draft', CLOSE: 'draft' }),
      approvalNeeded: node('Execution needs an explicit action or saved policy', { CONFIRM: guarded('explicit', 'running', 'ready'), CANCEL: 'ready' }),
      running: group('Observe one accepted execution', 'queued', {
        queued: node('Queued; show position, elapsed time and admission', { STARTED: 'active', OVERLOADED: '#action.overloaded', CANCEL: '#action.cancelling', TIMEOUT: '#action.failed' }),
        active: node('Stream progress; UI remains interactive', { PROGRESS: {}, SUCCEEDED: '#action.result.success', EMPTY: '#action.result.empty', PARTIAL: '#action.result.partial', FAILED: '#action.failed', TIMEOUT: '#action.failed', ACK_UNKNOWN: '#action.unknown', DISCONNECTED: '#action.unknown', CANCEL: '#action.cancelling' })
      }),
      overloaded: node('Capacity limit; show bounded retry action', { RETRY: 'ready', CANCEL: 'draft' }),
      result: group('Retained receipt; not an assertion verdict', 'success', {
        success: node('Invocation completed; inspect and retain evidence', { INSPECT: 'inspecting', NEW_RUN: '#action.preflight' }),
        empty: node('No results; show exact query and next option', { INSPECT: 'inspecting', NEW_RUN: '#action.preflight' }),
        partial: node('Incomplete or truncated; show gaps and cursor', { INSPECT: 'inspecting', NEXT_PAGE: '#action.ready', NEW_RUN: '#action.preflight' }),
        inspecting: node('Read a saved result without executing again', { BACK: 'success', NEW_RUN: '#action.preflight' })
      }),
      failed: node('Error plus original arguments and retained prior result', { RETRY_READ: guarded('safeRead', 'ready', 'replayBlocked'), PREPARE_AGAIN: 'preflight', CANCEL: 'draft' }),
      replayBlocked: node('Effect retry needs reconciliation and a new explicit run', { RECONCILE: 'unknown', PREPARE_AGAIN: 'preflight' }),
      unknown: node('Query execution status; do not replay an effect', { FOUND_RUNNING: 'running.active', FOUND_DONE: 'result.success', NOT_ACCEPTED: 'ready', STILL_UNKNOWN: 'unresolved' }),
      unresolved: node('Unknown outcome remains visible for manual resolution', { RECONCILE: 'unknown' }),
      cancelling: node('Cancel requested; acknowledgement pending', { ACK: 'cleanup', ACK_UNKNOWN: 'unknown', FAILED: 'cleanupFailed' }),
      cleanup: node('Release owned resources; keep receipt', { DONE: 'cancelled', FAILED: 'cleanupFailed' }),
      cleanupFailed: node('Cleanup failed; resource IDs retained', { RETRY_CLEANUP: 'cleanup', RECONCILE: 'unknown' }),
      cancelled: node('Cancelled and cleanup confirmed', { NEW_RUN: 'preflight', INSPECT: 'result.inspecting' })
    },
    guards: {
      authorized: ({ context, event }) => context.canRead && (!event.effect || context.canWrite) && event.allowed !== false && (!event.owner || event.owner === context.owner),
      explicit: ({ event }) => event.explicit === true || event.authorizedPolicy === true,
      safeRead: ({ event }) => event.readOnly === true && event.idempotent === true
    }
  },
  file: {
    meta: { label: 'File, note or configuration draft', lifetime: 'One actor per owned file/editor', description: 'Selecting the same file is a no-op. File content, metadata and publication have separate saves. Lists are paged; state does not grow with file count.' },
    context: ({ input }) => ({ canWrite: true, draft: 'original', saved: 'original', ...(input || {}) }), initial: 'closed',
    states: {
      closed: node('No file open', { OPEN: 'loading', NEW: 'newDraft' }),
      loading: node('Load selected file and revision', { LOADED: 'open.clean', MISSING: 'missing', DENIED: 'denied', FAILED: 'loadFailed' }),
      missing: node('File missing; keep its reference and offer recovery', { CHOOSE: 'closed', CREATE: 'newDraft' }),
      denied: node('File access denied', { CHOOSE: 'closed' }),
      loadFailed: node('Load failed; retry the same identity', { RETRY: 'loading', CHOOSE: 'closed' }),
      newDraft: node('Name a relative file and choose its location', { VALID: 'open.dirty', INVALID: 'invalidName', CANCEL: 'closed' }),
      invalidName: node('Explain invalid path; keep contents', { EDIT: 'newDraft' }),
      open: group('Selected file', 'clean', {
        clean: node('Saved revision and audience visible', { EDIT: { target: 'dirty', actions: 'edit' }, CLOSE: '#file.closed', SELECT_OTHER: '#file.loading', RESELECT: {}, ARCHIVE: 'archiveConfirm', DELETE: 'deleteConfirm', ACCESS_REVOKED: 'readOnly' }),
        dirty: node('Unsaved file; Save file is local to this editor', { EDIT: { actions: 'edit' }, SAVE: guarded('canWrite', 'saving', 'readOnly'), RESELECT: {}, SELECT_OTHER: 'leaveConfirm', CLOSE: 'leaveConfirm', ACCESS_REVOKED: 'readOnly' }),
        saving: node('Save exact revision; preserve draft until acknowledged', { SAVED: { target: 'clean', actions: 'saved' }, CONFLICT: 'conflict', FAILED: 'saveFailed', ACK_UNKNOWN: 'unknown' }),
        saveFailed: node('Save failed; draft retained', { RETRY: 'saving', EDIT: { target: 'dirty', actions: 'edit' }, SELECT_OTHER: 'leaveConfirm' }),
        conflict: node('Show base/current/draft; do not replace the draft', { KEEP_DRAFT: 'dirty', REVIEW_REMOTE: 'reviewRemote', REMOTE_DELETED: 'remoteDeleted' }),
        reviewRemote: node('Compare revisions beside retained draft', { REBASE: 'dirty', BACK: 'conflict', DISCARD_DRAFT: { target: 'clean', actions: 'discard' } }),
        remoteDeleted: node('Remote removed; local draft available to save elsewhere', { SAVE_COPY: '#file.newDraft', KEEP_DRAFT: 'dirty' }),
        readOnly: node('Read-only or access revoked; retained draft is copyable', { ACCESS_RESTORED: 'dirty', SAVE_COPY: '#file.newDraft', CLOSE: 'leaveConfirm' }),
        unknown: node('Reconcile revision before retrying save', { SAVED: { target: 'clean', actions: 'saved' }, NOT_SAVED: 'dirty', CONFLICT: 'conflict' }),
        leaveConfirm: node('Keep editing, save, or explicitly discard this file', { KEEP: 'dirty', SAVE: guarded('canWrite', 'saving', 'readOnly'), DISCARD: { target: '#file.closed', actions: 'discard' } }),
        archiveConfirm: node('Move into context archive; retain restore location', { CONFIRM: guarded('canWrite', 'archiving', 'readOnly'), CANCEL: 'clean' }),
        archiving: node('Move file with a retained receipt', { DONE: '#file.archived', FAILED: 'archiveFailed', ACK_UNKNOWN: 'unknown' }),
        archiveFailed: node('Archive failed; original identity retained', { RETRY: 'archiving', CANCEL: 'clean' }),
        deleteConfirm: node('Explicitly confirm deletion and exact file', { CONFIRM: guarded('canWrite', 'deleting', 'readOnly'), CANCEL: 'clean' }),
        deleting: node('Delete selected file only', { DONE: '#file.deleted', FAILED: 'deleteFailed', ACK_UNKNOWN: 'unknown' }),
        deleteFailed: node('Delete failed; source and error visible', { RETRY: 'deleteConfirm', CANCEL: 'clean' })
      }),
      archived: node('Archived file; original location retained', { RESTORE: 'loading', CHOOSE: 'closed' }),
      deleted: node('Deletion receipt retained; refresh listing', { CHOOSE: 'closed' })
    },
    guards: { canWrite: ({ context }) => context.canWrite },
    actions: { edit: assign({ draft: ({ event }) => typeof event.text === 'string' ? event.text : 'draft A' }), saved: assign({ saved: ({ context }) => context.draft }), discard: assign({ draft: ({ context }) => context.saved }) }
  },
  job: {
    meta: { label: 'Background task, loop or wait', lifetime: 'One durable actor per owned job; independent of chat visibility', description: 'Conversation navigation does not stop work. Resume reconciles an execution ID; it never restarts a task blindly. Queue, policy, budget and cleanup remain visible.' },
    context: commonContext, initial: 'draft',
    states: {
      draft: node('Describe goal, sources, limits and allowed effects', { PLAN: 'preflight' }),
      preflight: node('Validate access, target branch, budget and stop rules', { VALID: 'ready', INVALID: 'invalid', DENIED: 'denied' }),
      invalid: node('Keep plan and explain required changes', { EDIT: 'draft' }),
      denied: node('Policy does not permit this operation', { EDIT: 'draft' }),
      ready: node('Ready; execution requires Start or saved task policy', { START: guarded('explicit', 'persisting', 'approvalNeeded') }),
      approvalNeeded: node('Wait for explicit start authorization', { CONFIRM: guarded('explicit', 'persisting', 'ready'), CANCEL: 'draft' }),
      persisting: node('Persist run, identity and policy before dispatch', { SAVED: 'queued', FAILED: 'saveFailed', ACK_UNKNOWN: 'reconciling' }),
      saveFailed: node('Run not persisted; no work dispatched', { RETRY: 'persisting', EDIT: 'draft' }),
      queued: node('Admitted queue; cancel remains available', { STARTED: 'running', CANCEL: 'cancelling', OVERLOADED: 'capacityWait' }),
      capacityWait: node('Capacity unavailable; bounded wait, no fan-out storm', { CAPACITY: 'queued', CANCEL: 'cancelling' }),
      running: group('Background work', 'active', {
        active: node('Current step, elapsed time and retained checkpoint', { CHECKPOINT: {}, WAIT: 'waiting', QUESTION: 'needsInput', PAUSE: 'pausing', SUCCEEDED: '#job.finished.success', PARTIAL: '#job.finished.partial', FAILED: '#job.finished.failed', BUDGET: 'budgetStopped', CANCEL: '#job.cancelling', DISCONNECTED: '#job.reconciling' }),
        waiting: node('Wait for Jenkins, review, Kafka or a timer; not a busy loop', { EVENT: 'active', TIMEOUT: 'blocked', PAUSE: 'pausing', CANCEL: '#job.cancelling' }),
        needsInput: node('Blocked question beside retained progress', { ANSWER: 'active', CANCEL: '#job.cancelling' }),
        blocked: node('Dependency timed out; successful steps retained', { RETRY_STEP: 'active', PAUSE: 'pausing', CANCEL: '#job.cancelling' }),
        pausing: node('Pause requested; wait for checkpoint acknowledgement', { ACK: 'paused', ACK_UNKNOWN: '#job.reconciling' }),
        paused: node('Paused at durable checkpoint', { RESUME: 'active', CANCEL: '#job.cancelling' }),
        budgetStopped: node('Budget or iteration limit reached', { EXTEND: guarded('explicit', 'paused', 'needsInput'), CANCEL: '#job.cancelling' })
      }),
      reconciling: node('Reconnect to owned run; observe before resuming', { RUNNING: 'running.active', PAUSED: 'running.paused', COMPLETED: 'finished.success', UNKNOWN: 'unresolved' }),
      unresolved: node('Unknown execution outcome; do not duplicate work', { RECONCILE: 'reconciling', RESOLVE_STOPPED: 'cancelled' }),
      cancelling: node('Cancellation requested; await acknowledgement', { ACK: 'cleaning', ACK_UNKNOWN: 'reconciling', FAILED: 'cleanupFailed' }),
      cleaning: node('Release owned leases/processes and record cleanup', { DONE: 'cancelled', FAILED: 'cleanupFailed' }),
      cleanupFailed: node('Cleanup failed; resources and retry visible', { RETRY_CLEANUP: 'cleaning', RECONCILE: 'reconciling' }),
      cancelled: node('Stopped with cleanup confirmed; checkpoints retained', { INSPECT: 'finished.inspecting', REPLAN: 'draft' }),
      finished: group('Retained job outcome', 'success', {
        success: node('Steps complete; read assertion/coverage separately', { INSPECT: 'inspecting', FOLLOWUP: '#job.draft' }),
        partial: node('Partial success with unresolved sources', { INSPECT: 'inspecting', RETRY_FAILED: '#job.preflight' }),
        failed: node('Failed step plus retained earlier successes', { INSPECT: 'inspecting', RETRY_FAILED: '#job.preflight' }),
        inspecting: node('Read logs, files, receipts and checkpoint without rerun', { FOLLOWUP: '#job.draft' })
      })
    }, guards: { explicit: ({ event }) => event.explicit === true || event.authorizedPolicy === true }
  },
  flow: {
    meta: { label: 'Entry-to-exit investigation', lifetime: 'One pinned investigation; entity children loaded on demand', description: 'Nested vertical lists: service → entry → call/decision/loop → transformation → exit. Collapse unrelated branches; page high fan-out; reference cycles and repeated callees instead of duplicating them.' },
    initial: 'choosing', context: commonContext,
    states: {
      choosing: node('Choose service/ref and an entry, line or observed symptom', { SELECT: 'resolving' }),
      resolving: group('Resolve exact evidence', 'catalog', {
        catalog: node('Search cached names and source pins first', { FOUND: 'source', NO_INDEX: 'grep', STALE: 'stale', NO_MATCH: 'missing' }),
        grep: node('Use fast ripgrep fallback; identify semantic limitations', { FOUND: 'source', NO_MATCH: 'missing', FAILED: 'failed' }),
        stale: node('Choose pinned evidence or request an index refresh', { USE_PIN: 'source', REFRESH: 'indexing' }),
        indexing: node('Non-blocking indexing job; keep conversation usable', { READY: 'source', FAILED: 'failed', CANCEL: '#flow.cancelled' }),
        missing: node('No match; narrow service/ref or enter an exact source', { REFINE: 'catalog', MANUAL: 'source' }),
        failed: node('Evidence load failed; retained selection remains', { RETRY: 'catalog', CANCEL: '#flow.cancelled' }),
        source: node('Pin repository SHA, file and entry/exit selectors', { RESOLVED: '#flow.exploring', MISSING_LIBRARY: 'library' }),
        library: node('Resolve internal library version from build.gradle', { EXACT: 'source', MISSING_VERSION: 'fallback' }),
        fallback: node('Try default branch; label the version assumption', { FOUND: 'source', NOT_FOUND: 'gap' }),
        gap: node('Unresolved library path remains an explicit gap', { CONTINUE_WITH_GAP: '#flow.exploring', RETRY: 'library' })
      }),
      exploring: group('Nested entry-to-exit list', 'collapsed', {
        collapsed: node('Show only the selected entry and its immediate exits', { EXPAND: 'loadingChildren', SELECT_NODE: 'sourceDetail', COMPARE: '#flow.comparing', PREPARE_CHANGE: '#flow.changePrepared' }),
        loadingChildren: node('Load one parent cursor; bound fan-out and depth', { LOADED: 'expanded', MORE: 'paged', CYCLE: 'reference', FAILED: 'loadFailed' }),
        expanded: node('Nested calls, data changes and branch conditions', { SELECT_NODE: 'sourceDetail', ASSUMPTIONS: 'assumptions', COLLAPSE: 'collapsed', MORE: 'loadingChildren', COMPARE: '#flow.comparing' }),
        paged: node('More children exist; show count, cursor and Load more', { NEXT: 'loadingChildren', COLLAPSE: 'collapsed' }),
        reference: node('Cycle or repeated callee: link to its source once', { OPEN_REFERENCE: 'sourceDetail', BACK: 'expanded' }),
        sourceDetail: node('File/line, revision, input/output fields and evidence', { BACK: 'expanded', ASSUMPTIONS: 'assumptions', CORRECT: 'correction' }),
        assumptions: node('Conditions, loops, stream filters and unresolved calls', { ACCEPT_AS_ASSUMPTION: 'expanded', REJECT: 'rejected', CORRECT: 'correction' }),
        rejected: node('Rejected path retained as excluded, not silently removed', { REVISIT: 'assumptions', BACK: 'expanded' }),
        correction: node('Reasoned manual overlay; original source unchanged', { SAVE: 'correctionSaved', CONFLICT: 'correctionConflict', CANCEL: 'sourceDetail' }),
        correctionConflict: node('Keep overlay draft while comparing revisions', { REBASE: 'correction', CANCEL: 'sourceDetail' }),
        correctionSaved: node('Saved overlay is not runtime proof', { BACK: 'expanded', PREPARE_CHANGE: '#flow.changePrepared' }),
        loadFailed: node('Failed expansion keeps already loaded branches', { RETRY: 'loadingChildren', BACK: 'collapsed' })
      }),
      comparing: group('Compare branch/ref paths', 'selecting', {
        selecting: node('Choose independent before/after immutable refs', { VALID: 'loading', INVALID: 'invalid' }),
        invalid: node('Explain missing ref; keep both selections', { EDIT: 'selecting' }),
        loading: node('Load each pinned path independently', { READY: 'diff', PARTIAL: 'partial', FAILED: 'failed', CANCEL: '#flow.cancelled' }),
        partial: node('Show unavailable path/gaps; do not equate missing with removed', { RETRY: 'loading', INSPECT: 'diff' }),
        failed: node('Comparison failed; selections retained', { RETRY: 'loading' }),
        diff: node('Nested added/changed/removed paths and assumptions', { BACK: '#flow.exploring', PREPARE_CHANGE: '#flow.changePrepared' })
      }),
      changePrepared: node('Attach exact source path and assumptions to a change request', { BACK: 'exploring', VERIFY: 'awaitingProof' }),
      awaitingProof: node('Require an independent entry-to-exit regression', { PROVEN: guarded('runtimeProof', 'proven', 'unproven'), FAILED: 'unproven' }),
      proven: node('Runtime assertion supports the selected path and revision', { REVISIT: 'exploring' }),
      unproven: node('Static reachability or a mock is insufficient', { INVESTIGATE: 'exploring', RETRY_PROOF: 'awaitingProof' }),
      cancelled: node('Investigation stopped; pinned findings retained', { RESUME: 'choosing' })
    }, guards: { runtimeProof: ({ event }) => event.runtime === true && event.independentExpectation === true }
  },
  workspace: {
    meta: { label: 'Workspace and change', lifetime: 'One retained checkout or context folder; independent of chat', description: 'Non-Git context folders are valid. Reopen attaches the same owned workspace. Branch/SHA and dirty files stay visible. Task-branch pushes and draft PRs require policy checks.' },
    context: commonContext, initial: 'choosing',
    states: {
      choosing: node('Choose retained workspace, repository or context-only folder', { OPEN: 'loading', CREATE_FOLDER: 'creatingFolder', CLONE: 'cloning' }),
      creatingFolder: node('Create a writable non-Git task folder', { READY: 'ready.folder', FAILED: 'failed' }),
      cloning: node('Clone/check out exact branch or commit', { READY: 'ready.clean', FAILED: 'failed', CANCEL: 'cancelled' }),
      loading: node('Attach retained workspace; never reset it for a new chat', { LOADED: 'ready.clean', MISSING: 'missing', DENIED: 'denied' }),
      missing: node('Workspace missing; recovery is explicit', { CHOOSE: 'choosing' }),
      denied: node('Workspace belongs to a different scope', { CHOOSE: 'choosing' }),
      failed: node('Workspace creation/load failed', { RETRY: 'choosing' }),
      ready: group('Retained workspace', 'clean', {
        clean: node('Pinned branch/SHA with no unsaved patch', { EDIT: 'dirty', BRANCH: 'branching', PATCH: 'patchPreview', COMMIT: 'commitPreparing', REOPEN: {}, OPEN_TERMINAL: 'terminal' }),
        folder: node('Context folder without Git; read/write/run supported', { EDIT: 'folderDirty', OPEN_TERMINAL: 'terminal', REOPEN: {} }),
        folderDirty: node('Files saved in non-Git context; Git-only actions unavailable', { READ: 'folder', OPEN_TERMINAL: 'terminal' }),
        dirty: node('Changed files grouped by folder', { PATCH: 'patchPreview', BRANCH: 'dirtyBranch', COMMIT: 'commitPreparing', REOPEN: {}, OPEN_TERMINAL: 'terminal' }),
        dirtyBranch: node('Switching branches needs a dirty-work decision', { KEEP: 'dirty', SAVE: 'branching', DISCARD: guarded('explicit', 'branching', 'dirty') }),
        branching: node('Change branch without deleting unrelated task files', { DONE: 'clean', CONFLICT: 'branchConflict', FAILED: 'branchFailed' }),
        branchConflict: node('Resolve conflicting files; preserve both versions', { RESOLVED: 'dirty', CANCEL: 'dirty' }),
        branchFailed: node('Branch change failed; original workspace retained', { BACK: 'dirty' }),
        patchPreview: node('Review patch and exact base SHA before applying', { APPLY: 'applying', CANCEL: 'dirty' }),
        applying: node('Apply checked patch; compile diagnostics are separate', { DONE: 'dirty', CONFLICT: 'patchConflict', FAILED: 'patchFailed' }),
        patchConflict: node('Patch conflict; show affected files and retained draft', { RESOLVE: 'dirty', CANCEL: 'dirty' }),
        patchFailed: node('Patch not applied; original files retained', { EDIT: 'patchPreview' }),
        terminal: node('Owned terminal session; detach is not process kill', { DETACH: 'dirty', CLOSE: 'dirty', FAILED: 'terminalFailed' }),
        terminalFailed: node('Terminal disconnected; reconcile owned process', { REATTACH: 'terminal', BACK: 'dirty' }),
        commitPreparing: node('Review diff, ignores, checks and commit message', { VALID: 'committing', INVALID: 'commitInvalid', CANCEL: 'dirty' }),
        commitInvalid: node('Explain blocked commit; keep files/message', { EDIT: 'commitPreparing' }),
        committing: node('Create commit in the retained checkout', { DONE: 'committed', FAILED: 'commitFailed' }),
        commitFailed: node('Commit failed; changes retained', { RETRY: 'commitPreparing' }),
        committed: node('Local commit exists; push is a separate action', { PUSH: guarded('taskBranch', 'pushing', 'pushBlocked'), EDIT: 'dirty' }),
        pushBlocked: node('Protected/wrong branch or missing push permission', { CHANGE_TARGET: 'committed' }),
        pushing: node('Push exact commit to authorized task branch', { DONE: 'pushed', FAILED: 'pushFailed', ACK_UNKNOWN: 'pushUnknown' }),
        pushFailed: node('Push failed; local commit retained', { RETRY: 'committed' }),
        pushUnknown: node('Read remote SHA before deciding whether to push again', { FOUND: 'pushed', NOT_FOUND: 'committed', UNKNOWN: 'pushUnresolved' }),
        pushUnresolved: node('Unknown push outcome; no automatic replay', { RECONCILE: 'pushUnknown' }),
        pushed: node('Remote task-branch commit and checks linked', { DRAFT_PR: 'draftPr', EDIT: 'dirty' }),
        draftPr: node('Create/update draft PR; merge stays manual', { DONE: 'review', FAILED: 'prFailed', ACK_UNKNOWN: 'prUnknown' }),
        prFailed: node('Draft PR failed; remote commit retained', { RETRY: 'pushed' }),
        prUnknown: node('Read existing PR before retrying creation', { FOUND: 'review', NOT_FOUND: 'pushed' }),
        review: node('Wait for build and review; iterate in same task', { COMMENTS: 'dirty', CHECKS_FAILED: 'dirty', DONE: 'clean' })
      }),
      cancelled: node('Creation stopped; retain any recoverable checkout', { CHOOSE: 'choosing' })
    }, guards: { explicit: ({ event }) => event.explicit === true, taskBranch: ({ context, event }) => context.canWrite && event.taskBranch === true && event.protected !== true }
  },
  verification: {
    meta: { label: 'Compilation, tests and changed coverage', lifetime: 'One run per pinned workspace revision', description: 'Outside-in assertions are independent of implementation. Warm compilation, Lombok fallback, shared leases and CI profiles remain explicit. Coverage is only for observed runtime code.' },
    initial: 'planning',
    states: {
      planning: node('Choose entry, expected exits, changed code and baseline', { PLAN: 'preparing' }),
      preparing: group('Prepare a reproducible run', 'profile', {
        profile: node('Choose CI Testcontainers or owned workspace leases', { LOCAL: 'leases', CI: 'containers', INVALID: 'profileInvalid' }),
        profileInvalid: node('Missing/invalid profile; keep override values', { EDIT: 'profile' }),
        leases: node('Acquire isolated databases, topics and ES indices', { READY: 'compiling', FAILED: 'leaseFailed', CANCEL: '#verification.cancelling' }),
        leaseFailed: node('Partial allocation recorded; cleanup before retry', { CLEANED: 'profile', CLEANUP_FAILED: '#verification.cleanupFailed' }),
        containers: node('Prepare independent test containers', { READY: 'compiling', FAILED: 'containerFailed', CANCEL: '#verification.cancelling' }),
        containerFailed: node('Container startup failed; retain logs', { RETRY: 'profile' }),
        compiling: node('Try warm incremental compilation with annotation processors', { READY: '#verification.running', UNSUPPORTED: 'fullBuild', FAILED: 'compileFailed' }),
        fullBuild: node('Correctness fallback to full Gradle/Maven build', { READY: '#verification.running', FAILED: 'compileFailed' }),
        compileFailed: node('Show compile diagnostics and internal import candidates', { EDIT: '#verification.planning' })
      }),
      running: node('Run selected integration assertions; stream logs', { PASSED: 'results.passed', FAILED: 'results.failed', PARTIAL: 'results.partial', TIMEOUT: 'results.interrupted', CANCEL: 'cancelling', DISCONNECTED: 'reconciling' }),
      reconciling: node('Find owned runner and retained test receipt', { RUNNING: 'running', COMPLETED: 'results.partial', UNKNOWN: 'results.interrupted' }),
      results: group('Separate assertions, transport and coverage', 'partial', {
        passed: node('Assertions passed for this pinned run', { COVERAGE: 'coverage', VERIFY: '#verification.proving', RERUN: '#verification.planning' }),
        failed: node('First failing assertion open; passing details collapsed', { INSPECT: 'detail', RERUN: '#verification.planning' }),
        partial: node('Incomplete run; no full-pass claim', { INSPECT: 'detail', RERUN: '#verification.planning' }),
        interrupted: node('Timeout or lost runner; retain logs and prior results', { INSPECT: 'detail', RERUN: '#verification.planning' }),
        detail: node('Expected/actual, stack, target, logs and source pin', { BACK: 'partial', RERUN: '#verification.planning' }),
        coverage: node('Touched-line and branch coverage; gaps remain visible', { COMPLETE: '#verification.proving', MISSING: 'coverageMissing', PARTIAL: 'coverageMissing' }),
        coverageMissing: node('Missing runtime coverage is unknown, not zero/proof', { RERUN: '#verification.planning', INSPECT: 'detail' })
      }),
      proving: node('Check an independent expected result and exact path/ref', { ASSERT: guarded('independent', 'proven', 'unproven') }),
      proven: node('Observed regression supports this change; broader gaps retained', { RERUN: 'planning' }),
      unproven: node('A successful build/mock/static path is not independent proof', { REPLAN: 'planning' }),
      cancelling: node('Cancel runner; await cleanup', { ACK: 'cleaning', ACK_UNKNOWN: 'reconciling' }),
      cleaning: node('Release only this run’s leased resources', { DONE: 'cancelled', FAILED: 'cleanupFailed' }),
      cleanupFailed: node('Retain failed resource IDs and retry cleanup', { RETRY_CLEANUP: 'cleaning' }),
      cancelled: node('Cancelled with cleanup confirmed', { REPLAN: 'planning' })
    }, guards: { independent: ({ event }) => event.runtime === true && event.independentExpectation === true }
  },
  memory: {
    meta: { label: 'Task memory and shared understanding', lifetime: 'Task-owned files plus versioned shared publication', description: 'Task/chat continuity uses durable identity. Shared definitions are readable to all authorized readers; only admins publish. Executions/results stay private.' },
    context: commonContext, initial: 'searching',
    states: {
      searching: node('Find by task, ticket, repositories, services or keywords', { FOUND: 'reading', EMPTY: 'missing', FAILED: 'searchFailed' }),
      searchFailed: node('Search failed; retain query', { RETRY: 'searching' }),
      missing: node('No context found; choose scope before creating', { CREATE: 'creating', REFINE: 'searching' }),
      creating: node('Create indexed context with ownership and purpose', { SAVED: 'reading', FAILED: 'createFailed', ACK_UNKNOWN: 'reconciling' }),
      createFailed: node('Context not saved; draft retained', { RETRY: 'creating' }),
      reconciling: node('Find the owned context before retrying creation', { FOUND: 'reading', NOT_FOUND: 'creating' }),
      reading: node('Read retained briefing, files, assumptions and source pins', { EDIT: 'editing', ATTACH: 'attaching', RESTORE: 'restoring', PUBLISH: 'publishReview', SEARCH: 'searching' }),
      attaching: node('Attach existing context/workspace to a new chat', { DONE: 'reading', DENIED: 'denied', FAILED: 'attachFailed' }),
      attachFailed: node('Attachment failed; original context unchanged', { RETRY: 'attaching' }),
      restoring: node('Restore continuation/checkpoint without rerunning tools', { DONE: 'reading', STALE: 'stale', FAILED: 'attachFailed' }),
      stale: node('Retained understanding is stale; show exact source age', { KEEP_PIN: 'reading', REFRESH: 'gathering' }),
      gathering: node('Background gather updates a draft, not published truth', { DONE: 'editing', PARTIAL: 'gatherPartial', FAILED: 'gatherFailed', CANCEL: 'reading' }),
      gatherPartial: node('Retain collected evidence and list missing sources', { REVIEW: 'editing', RETRY: 'gathering' }),
      gatherFailed: node('Source failure does not clear previous memory', { RETRY: 'gathering', KEEP: 'reading' }),
      editing: node('Edit private understanding, maps, files or queries', { SAVE: 'saving', INVALID: 'invalid', CANCEL: 'reading' }),
      invalid: node('Invalid metadata or graph; draft retained', { EDIT: 'editing' }),
      saving: node('Save draft against the loaded revision', { SAVED: 'reading', CONFLICT: 'conflict', FAILED: 'saveFailed' }),
      conflict: node('Show current publication alongside retained draft', { REBASE: 'editing', SAVE_COPY: 'creating' }),
      saveFailed: node('Save failed; original and draft retained', { RETRY: 'saving', EDIT: 'editing' }),
      publishReview: node('Review audience, reason, sources and revision', { PUBLISH: guarded('admin', 'publishing', 'denied'), CANCEL: 'reading' }),
      denied: node('Publication/attachment not allowed; private draft retained', { KEEP_PRIVATE: 'reading' }),
      publishing: node('Publish a versioned shared definition', { SAVED: 'published', CONFLICT: 'conflict', FAILED: 'publishFailed', ACK_UNKNOWN: 'publishUnknown' }),
      publishFailed: node('Publication failed; draft retained', { RETRY: 'publishReview' }),
      publishUnknown: node('Read publication revision before retry', { FOUND: 'published', NOT_FOUND: 'publishReview' }),
      published: node('Shared revision with author, reason and history', { READ: 'reading', EDIT: 'editing' })
    }, guards: { admin: ({ context }) => context.admin === true }
  },
  share: {
    meta: { label: 'Reproducible handoff', lifetime: 'Named definition and pinned evidence; recipient-owned execution', description: 'Review links never execute. Share recipes/source references without credentials or another user’s private execution. Live replay is a separate authorized action.' },
    initial: 'selecting',
    states: {
      selecting: node('Select finding, files, exact inputs and source pins', { SELECT: 'naming' }),
      naming: node('Give a stable name and explain expected/actual behavior', { VALID: 'reviewing', INVALID: 'invalid' }),
      invalid: node('Name or prerequisites missing; retain draft', { EDIT: 'naming' }),
      reviewing: node('Inspect audience, redactions, assumptions and dependencies', { SAVE: 'saving', CANCEL: 'naming' }),
      saving: node('Persist named definition; private results remain private', { SAVED: 'saved', CONFLICT: 'conflict', FAILED: 'failed', ACK_UNKNOWN: 'unknown' }),
      conflict: node('Name/revision conflict; preserve both definitions', { RENAME: 'naming', REVIEW_CURRENT: 'reviewing' }),
      failed: node('Save failed; handoff draft retained', { RETRY: 'saving' }),
      unknown: node('Resolve saved name before retrying creation', { FOUND: 'saved', NOT_FOUND: 'reviewing' }),
      saved: node('Stable review link and reproducible recipe', { OPEN: 'reviewOnly', EXPORT: 'exported', PREPARE_REPLAY: 'replayPreparing', EDIT: 'naming' }),
      exported: node('Exported definition and prerequisites; no embedded secrets', { BACK: 'saved' }),
      reviewOnly: node('Read retained evidence; zero execution effects', { CLOSE: 'saved', PREPARE_REPLAY: 'replayPreparing' }),
      replayPreparing: node('Bind recipient-owned environment, credentials and permissions', { VALID: 'replayReady', DENIED: 'denied', MISSING: 'prerequisitesMissing' }),
      denied: node('Replay access denied; shared definition still readable', { BACK: 'reviewOnly' }),
      prerequisitesMissing: node('Explain missing environment/ref/credential binding', { EDIT: 'replayPreparing', BACK: 'reviewOnly' }),
      replayReady: node('Prepared only; Run is separate from opening', { RUN: guarded('explicit', 'replaying', 'reviewOnly'), CANCEL: 'reviewOnly' }),
      replaying: node('Execute under recipient access with a new private receipt', { DONE: 'replayResult', FAILED: 'replayFailed', CANCEL: 'replayCancelled' }),
      replayResult: node('Private result; compare independent expected values', { BACK: 'saved' }),
      replayFailed: node('Private failure; shared recipe unchanged', { RETRY: 'replayPreparing', BACK: 'saved' }),
      replayCancelled: node('Replay cancelled; retained definition unchanged', { BACK: 'saved' })
    }, guards: { explicit: ({ event }) => event.explicit === true }
  },
  operations: {
    meta: { label: 'Indices, integrations and harness operations', lifetime: 'One actor per bounded admin operation', description: 'Large catalogs are queried and paged. Refresh publishes a new generation atomically; old/pinned revisions are retained. Telemetry includes model calls, ownership, latency and outcomes.' },
    context: commonContext, initial: 'overview',
    states: {
      overview: node('Connections, index freshness and active operations', { INSPECT: 'inspecting', REFRESH: 'refreshPlanning', CONFIGURE: 'configuring', TELEMETRY: 'telemetry' }),
      inspecting: node('Inspect capabilities, metadata, health and exact source age', { BACK: 'overview', REFRESH: 'refreshPlanning' }),
      refreshPlanning: node('Choose environment/source/repo SHA and refresh scope', { START: guarded('admin', 'refreshing', 'denied'), CANCEL: 'overview' }),
      refreshing: group('Non-destructive generation refresh', 'queued', {
        queued: node('Admitted refresh job; old generation readable', { STARTED: 'building', CANCEL: '#operations.cancelling' }),
        building: node('Fetch minimal source pages; retain exact revisions', { BUILT: 'validating', FAILED: 'failed', PARTIAL: 'partial', CANCEL: '#operations.cancelling' }),
        validating: node('Check new generation before switching readers', { VALID: 'publishing', INVALID: 'failed' }),
        publishing: node('Atomic pointer swap; preserve pinned old versions', { DONE: '#operations.refreshed', FAILED: 'failed', ACK_UNKNOWN: 'unknown' }),
        partial: node('Incomplete source generation; old valid one remains current', { RETRY: 'building', KEEP_OLD: '#operations.overview' }),
        failed: node('Refresh failed; old generation remains available', { RETRY: 'building', KEEP_OLD: '#operations.overview' }),
        unknown: node('Read generation pointer before publishing again', { NEW_CURRENT: '#operations.refreshed', OLD_CURRENT: 'validating' })
      }),
      refreshed: node('New generation and retained old/pinned references visible', { BACK: 'overview', INSPECT: 'inspecting' }),
      configuring: node('Edit configuration via the same safe file lifecycle', { VALID: 'configReview', INVALID: 'configInvalid', CANCEL: 'overview' }),
      configInvalid: node('Validation fails without replacing the active config', { EDIT: 'configuring' }),
      configReview: node('Inspect changed settings and intended connections', { ACTIVATE: guarded('admin', 'activating', 'denied'), CANCEL: 'configuring' }),
      activating: node('Activate a validated revision', { DONE: 'overview', FAILED: 'configFailed' }),
      configFailed: node('Activation failed; last good configuration retained', { EDIT: 'configuring' }),
      denied: node('Admin action denied; read-only observations remain available', { BACK: 'overview' }),
      telemetry: group('Observe calls without issuing new model/tool work', 'summary', {
        summary: node('Latency, responses, failures, model call count and queue', { FILTER: 'filtered', SELECT: 'detail', LIVE: 'live', BACK: '#operations.overview' }),
        filtered: node('Paged matching executions; selected receipt matches filters', { CLEAR: 'summary', SELECT: 'detail' }),
        detail: node('Trace, original arguments, response and owner metadata', { BACK: 'summary', EXPORT: 'exported' }),
        exported: node('Redacted reproducible query/trace export', { BACK: 'detail' }),
        live: node('Bounded event subscription; no per-row polling', { DISCONNECTED: 'disconnected', STOP: 'summary' }),
        disconnected: node('Reconnect with cursor; retain displayed observations', { RECONNECT: 'live', STOP: 'summary' })
      }),
      cancelling: node('Cancel refresh; never remove current/pinned versions', { ACK: 'overview', FAILED: 'cleanupFailed' }),
      cleanupFailed: node('Temporary generation cleanup failed; current remains intact', { RETRY_CLEANUP: 'overview' })
    }, guards: { admin: ({ context, event }) => context.admin && event.allowed !== false }
  },
  connection: {
    meta: { label: 'Network and event stream', lifetime: 'One connection per browser/session, multiplexed events', description: 'A disconnected UI does not mean a task stopped. Resume with cursors; reconcile effect acknowledgements; never replay mutations on reconnect.' },
    initial: 'connecting',
    states: {
      connecting: node('Connect and authenticate once', { CONNECTED: 'online', FAILED: 'offline', DENIED: 'denied' }),
      online: node('Multiplex owned job/tool events', { DISCONNECTED: 'offline', EXPIRED: 'authExpired', SCOPE_CHANGED: 'resyncing' }),
      offline: node('Offline; retained conversation/files/results remain readable', { RETRY: 'connecting', RECONNECTED: 'resyncing' }),
      resyncing: node('Resume cursor; fetch missed state, not effects', { READY: 'online', GAP: 'snapshot', FAILED: 'offline', DENIED: 'denied' }),
      snapshot: node('Cursor expired; load bounded owned snapshots', { READY: 'online', FAILED: 'offline' }),
      authExpired: node('Reauthenticate; keep drafts and running job IDs', { AUTHENTICATED: 'connecting' }),
      denied: node('Access denied; do not display another owner’s retained data', { AUTHENTICATED: 'connecting' })
    }
  }
};
// Stable explicit IDs allow transitions, the diagram, recipes and tests to share one source.
function hydrate(id, def) {
  const out = { ...def, id };
  if (def.states) out.states = Object.fromEntries(Object.entries(def.states).map(([key, value]) => [key, hydrate(id + '.' + key, value)]));
  return out;
}
const configs = Object.fromEntries(Object.entries(definitions).map(([id, def]) => {
  const { guards, actions, ...config } = def;
  return [id, hydrate(id, config)];
}));
const machines = Object.fromEntries(Object.entries(configs).map(([id, config]) => [id, createMachine(config, { guards: definitions[id].guards, actions: definitions[id].actions })]));
const eventLabels = {
  PREPARE: 'Prepare the action', RESOLVED: 'Resolve target', AUTHORIZE: 'Check access', VALID: 'Validate inputs', RUN: 'Run explicitly', STARTED: 'Worker starts', SUCCEEDED: 'Complete successfully', FAILED: 'Observe failure', EMPTY: 'No matching results', PARTIAL: 'Observe incomplete results', CANCEL: 'Request cancellation', ACK: 'Acknowledge stop', DONE: 'Complete', LOADED: 'Load retained record', EDIT: 'Edit draft', SAVE: 'Save exact revision', SAVED: 'Confirm save', CONFLICT: 'Observe revision conflict', RETRY: 'Retry explicitly', RESELECT: 'Select the same item', SELECT_OTHER: 'Select another item', KEEP: 'Keep editing', DISCARD: 'Discard explicitly', STEER: 'Send steering', COMPACT: 'Request compaction', OPEN: 'Open retained evidence', OPEN_LINK: 'Open shared task link', ACK_UNKNOWN: 'Lose acknowledgement', DISCONNECTED: 'Lose connection', RECONCILE: 'Reconcile execution', REOPEN: 'Reattach retained workspace'
};
function eventsFor(machine) {
  const names = new Set();
  function visit(n) { for (const event of n.transitions.keys()) names.add(event); for (const child of Object.values(n.states)) visit(child); }
  visit(machine.root);
  return [...names].flatMap(type => {
    const base = { type, text: 'draft A', explicit: true, allowed: true, taskBranch: true, readOnly: true, idempotent: true, runtime: true, independentExpectation: true };
    const variants = [base];
    if (['CONFIRM','RUN','START','EXTEND','DISCARD'].includes(type)) variants.push({ ...base, explicit: false });
    if (['AUTHORIZE','START','ACTIVATE'].includes(type)) variants.push({ ...base, allowed: false });
    if (type === 'PUSH') variants.push({ ...base, taskBranch: false }, { ...base, protected: true });
    if (type === 'RETRY_READ') variants.push({ ...base, readOnly: false });
    if (['ASSERT','PROVEN'].includes(type)) variants.push({ ...base, independentExpectation: false });
    return variants;
  });
}
module.exports = { machines, configs, definitions, eventLabels, eventsFor };
