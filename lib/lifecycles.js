// Executable lifecycle charts. IDs refer to docs/state-machines.md.
// Orthogonal facts (AbortSignal, cleanup completeness, TTL, durability, proof)
// intentionally do not share a single status. Restore validates a known state;
// callers still enforce ownership, revisions and physical-resource guards.
const { define } = require('./state-machine');
const execution = define('SM01.execution', 'queued', {
  queued: ['running', 'cancelling', 'draining', 'failed', 'cancelled', 'interrupted'],
  running: ['cancelling', 'draining', 'done', 'failed', 'interrupted'],
  cancelling: ['draining', 'cancelled', 'interrupted'],
  draining: ['cancelling', 'done', 'failed', 'cancelled', 'interrupted'],
  done: [], failed: [], cancelled: [], interrupted: [],
}, ['done', 'failed', 'cancelled', 'interrupted']);
const job = define('SM02.job', 'running', {
  queued: ['running', 'cancelled', 'interrupted'], running: ['done', 'failed', 'cancelled', 'interrupted'],
  cancelling: ['cancelled', 'interrupted'], draining: ['done', 'failed', 'cancelled', 'interrupted'],
  done: [], failed: [], cancelled: [], interrupted: [],
}, ['done', 'failed', 'cancelled', 'interrupted']);
const admission = define('SM04.admission', 'queued', {
  queued: ['running', 'cancelled'], running: ['fulfilled', 'rejected'], fulfilled: [], rejected: [], cancelled: [],
}, ['fulfilled', 'rejected', 'cancelled']);
const worker = define('SM06.worker', 'idle', {
  idle: ['busy', 'stopping', 'stopped'], busy: ['idle', 'stopping', 'stopped'], stopping: ['stopped'], stopped: [],
}, ['stopped']);
const session = define('SM07.session', 'idle', { idle: ['running'], running: ['idle'] });
const sandbox = define('SM07.sandbox', 'absent', { absent: ['alive'], alive: ['absent'] });
const cell = define('SM08.cell', 'queued', { queued: ['done', 'failed', 'cancelled'], done: [], failed: [], cancelled: [] }, ['done', 'failed', 'cancelled']);
const settlement = define('SM09.settlement', 'pending', { pending: ['settled'], settled: [] }, ['settled']);
const process = define('SM03.process', 'running', { running: ['terminating', 'exited'], terminating: ['killing', 'exited'], killing: ['exited'], exited: [] }, ['exited']);
const span = define('SM03.span', 'running', { running: ['succeeded', 'failed'], succeeded: [], failed: [] }, ['succeeded', 'failed']);
const networkAdmission = define('SM05.network-admission', 'eligible', { eligible: ['reserved'], reserved: ['waiting', 'admitted', 'cancelled'], waiting: ['admitted', 'cancelled'], admitted: [], cancelled: [] }, ['admitted', 'cancelled']);
const runnerRequest = define('SM10.request', 'requesting', { requesting: ['streaming', 'failed'], streaming: ['completed', 'failed'], completed: [], failed: [] }, ['completed', 'failed']);
const circuit = define('SM10.endpoint', 'available', { available: ['cooldown'], cooldown: ['available'] });
const store = define('SM11.store', 'cold', { cold: ['starting', 'ready', 'closed'], starting: ['ready', 'failed', 'closed'], ready: ['failed', 'closed'], failed: ['starting', 'closed'], closed: [] }, ['closed']);
const storeClose = define('SM11.close', 'open', { open: ['flushing'], flushing: ['closing', 'closed', 'open'], closing: ['closed', 'open'], closed: [] }, ['closed']);
const writer = define('SM12.writer', 'idle', { idle: ['writing'], writing: ['idle', 'failed'], failed: ['writing'] });
const config = define('SM14.config', 'cold', { cold: ['stale', 'validating'], stale: ['validating'], validating: ['ready', 'rejected'], ready: ['stale'], rejected: ['stale', 'validating'] });
const registry = define('SM15.registry', 'missing', { missing: ['building'], active: ['building'], building: ['active', 'superseded', 'rejected'], superseded: ['building', 'rejected'], rejected: [] }, ['rejected']);
const transaction = define('SM20.transaction', 'opening', { opening: ['reading', 'rolled-back', 'cancelled'], reading: ['committed', 'rolled-back', 'cancelled'], committed: [], 'rolled-back': [], cancelled: [] }, ['committed', 'rolled-back', 'cancelled']);
const scratch = define('SM22.scratch-resource', 'creating', { creating: ['ready', 'failed', 'cleanup-failed', 'deleted'], ready: ['frozen', 'cleanup-failed', 'deleted'], frozen: ['cleanup-failed', 'deleted'], failed: ['cleanup-failed', 'deleted'], 'cleanup-failed': ['deleted'], deleted: [] }, ['deleted']);
const template = define('SM23.template', 'building', { building: ['ready', 'failed', 'invalid', 'deleted'], ready: ['invalid', 'deleted'], failed: ['invalid', 'deleted'], invalid: ['deleted'], deleted: [] }, ['deleted']);
const lease = define('SM24.lease', 'creating', { creating: ['active', 'released', 'cleanup-failed'], active: ['released', 'cleanup-failed'], 'cleanup-failed': ['released'], released: [] }, ['released']);
const leaseReset = define('SM25.reset', 'allocating', { allocating: ['replacement-ready', 'failed'], 'replacement-ready': ['releasing-old', 'compensating'], 'releasing-old': ['completed', 'compensating'], compensating: ['failed', 'cleanup-failed'], completed: [], failed: [], 'cleanup-failed': [] }, ['completed', 'failed', 'cleanup-failed']);
const publication = define('SM41.publication', 'checking', { checking: ['reused', 'staging', 'aborted'], staging: ['verified', 'aborted'], verified: ['committed', 'aborted'], committed: ['published', 'alias-failed'], reused: ['published', 'alias-failed'], published: [], aborted: [], 'alias-failed': [] }, ['published', 'aborted', 'alias-failed']);
const edgeSnapshot = define('SM55.edge-snapshot', 'missing', { missing: ['valid', 'invalid', 'removed'], valid: ['valid', 'stale', 'removed'], stale: ['valid', 'stale', 'removed'], invalid: ['valid', 'invalid', 'removed'], removed: [] }, ['removed']);
const catalogWriter = define('SM42.catalog-writer', 'open', { open: ['flushing', 'aborted'], flushing: ['synced', 'aborted'], synced: ['published', 'aborted'], published: [], aborted: [] }, ['published', 'aborted']);
const descriptor = define('P01.descriptor', 'open', { open: ['closed'], closed: [] }, ['closed']);
const handshake = define('SM18.handshake', 'disconnected', {
  disconnected: ['initializing', 'closing'], initializing: ['ready', 'disconnected', 'closing'], ready: ['closing'], closing: ['disconnected'],
});
const fixture = define('SM26.fixture', 'starting', { starting: ['ready', 'cleanup-failed', 'stopped'], ready: ['cleanup-failed', 'stopped'], 'cleanup-failed': ['stopped'], stopped: [] }, ['stopped']);
const scenario = define('SM28.scenario', 'starting', { starting: ['ready', 'failed', 'stopped'], ready: ['failed', 'stopped'], failed: ['stopped'], stopped: [] }, ['stopped']);
const collection = define('SM35.collection', 'running', { running: ['passed', 'failed', 'cancelled'], passed: [], failed: [], cancelled: [] }, ['passed', 'failed', 'cancelled']);
const semantic = define('SM45.semantic', 'uploading', {
  uploading: ['queued', 'failed', 'interrupted'], queued: ['parsing', 'querying', 'cancelling', 'failed', 'cancelled', 'interrupted'],
  parsing: ['enriching', 'cancelling', 'failed', 'cancelled', 'interrupted'], enriching: ['ready', 'cancelling', 'failed', 'cancelled', 'interrupted'],
  querying: ['ready', 'cancelling', 'failed', 'cancelled', 'interrupted'], cancelling: ['cancelled', 'failed', 'interrupted'],
  draining: ['ready', 'cancelled', 'failed', 'interrupted'],
  ready: [], failed: [], cancelled: [], interrupted: [],
}, ['ready', 'failed', 'cancelled', 'interrupted']);
const sftp = define('SM19.sftp', 'connecting', { connecting: ['opening', 'closing', 'failed', 'closed'], opening: ['ready', 'closing', 'failed', 'closed'], ready: ['closing', 'failed', 'closed'], closing: ['failed', 'closed'], failed: ['closing', 'closed'], closed: [] }, ['closed']);
const sftpOperation = define('SM19.operation', 'pending', { pending: ['settled'], settled: [] }, ['settled']);
const control = define('SM21.control', 'opening', { opening: ['locked', 'failed'], locked: ['initializing', 'verifying', 'failed'], initializing: ['verifying', 'failed'], verifying: ['ready', 'failed'], ready: ['releasing', 'failed'], failed: ['releasing'], releasing: ['closed', 'cleanup-failed'], closed: [], 'cleanup-failed': [] }, ['closed', 'cleanup-failed']);
const archive = define('SM54.archive', 'checking', { checking: ['copied', 'archived', 'failed'], copied: ['verified', 'failed'], verified: ['removing'], removing: ['archived', 'source-retained', 'recovery-needed'], archived: [], failed: [], 'source-retained': [], 'recovery-needed': [] }, ['archived', 'failed', 'source-retained', 'recovery-needed']);
const archiveRemoval = define('SM54.source-removal', 'source', { source: ['holding', 'removed'], holding: ['verified', 'restoring'], verified: ['removed', 'restoring'], restoring: ['restored', 'recovery-needed'], removed: [], restored: [], 'recovery-needed': [] }, ['removed', 'restored', 'recovery-needed']);
const contextArchive = define('SM54.context-archive', 'checking', { checking: ['renamed'], renamed: ['published', 'restoring'], restoring: ['restored', 'recovery-needed'], published: [], restored: [], 'recovery-needed': [] }, ['published', 'restored', 'recovery-needed']);
const context = define('SM53.context', 'active', { active: ['paused', 'done'], paused: ['active', 'done'], done: ['active', 'paused'] });
const captureCall = define('SM51.capture-call', 'invoking', { invoking: ['succeeded', 'failed'], succeeded: ['saving'], failed: ['saving'], saving: ['saved', 'save-failed'], saved: [], 'save-failed': [] }, ['saved', 'save-failed']);
const pit = define('SM75.pit', 'opening', { opening: ['open'], open: ['reading', 'closing'], reading: ['closing'], closing: ['closed', 'close-failed'], closed: [], 'close-failed': [] }, ['closed', 'close-failed']);
const identity = define('SM16.identity', 'unverified', { unverified: ['authenticated', 'rejected'], authenticated: ['scoped', 'rejected'], scoped: [], rejected: [] }, ['scoped', 'rejected']);
const mcp = define('SM17.request', 'running', { running: ['cancelling', 'replied', 'closed'], cancelling: ['replied', 'closed'], replied: ['closed'], closed: [] }, ['closed']);
const effects = define('SM27.effects', 'unarmed', { unarmed: ['arming'], arming: ['armed', 'rejected'], armed: ['observing'], observing: ['checked', 'failed'], checked: [], rejected: [], failed: [] }, ['checked', 'rejected', 'failed']);
const action = define('SM29.action', 'reserved', { reserved: ['executing'], executing: ['completed', 'unknown'], completed: [], unknown: [] }, ['completed', 'unknown']);
const quietWindow = define('SM30.quiet-window', 'sampling', { sampling: ['quiet', 'timed-out', 'cancelled', 'failed'], quiet: ['sampling', 'stable', 'timed-out', 'cancelled', 'failed'], stable: [], 'timed-out': [], cancelled: [], failed: [] }, ['stable', 'timed-out', 'cancelled', 'failed']);
const semanticPublication = define('SM46.publication', 'checking', { checking: ['reused', 'staging'], staging: ['accepted', 'compensating'], accepted: ['waiting', 'compensating'], waiting: ['downloading', 'compensating'], downloading: ['verified', 'compensating'], verified: ['committed', 'compensating'], committed: ['published', 'superseded', 'alias-failed'], reused: [], published: [], superseded: [], 'alias-failed': [], compensating: ['aborted', 'cleanup-failed'], aborted: [], 'cleanup-failed': [] }, ['reused', 'published', 'superseded', 'alias-failed', 'aborted', 'cleanup-failed']);
const knowledgeRefresh = define('SM49.refresh', 'reading', { reading: ['unchanged', 'writing', 'failed'], writing: ['updated', 'failed'], unchanged: [], updated: [], failed: [] }, ['unchanged', 'updated', 'failed']);
const observation = define('SM50.observation', 'refreshing', { refreshing: ['fresh', 'stale', 'missing'], fresh: [], stale: [], missing: [] }, ['fresh', 'stale', 'missing']);
const preparation = define('SM40.preparation', 'queued', { queued: ['running'], running: ['ready', 'failed'], ready: [], failed: [] }, ['ready', 'failed']);
const mavenPrepare = define('SM39.maven-prepare', 'checking', { checking: ['reused', 'building'], building: ['classpath', 'failed'], classpath: ['launcher', 'failed'], launcher: ['publishing', 'failed'], publishing: ['ready', 'failed'], reused: [], ready: [], failed: [] }, ['reused', 'ready', 'failed']);
const deepQuery = define('SM47.deep-query', 'checking', { checking: ['reused', 'submitting', 'failed'], submitting: ['waiting', 'compensating'], waiting: ['reading', 'compensating'], reading: ['saving', 'compensating'], saving: ['ready', 'compensating'], ready: [], reused: [], failed: [], compensating: ['failed', 'cleanup-failed'], 'cleanup-failed': [] }, ['reused', 'ready', 'failed', 'cleanup-failed']);
const adapter = define('SM76.adapter', 'prepared', { prepared: ['sending'], sending: ['reading', 'unknown'], reading: ['verified', 'unknown'], verified: ['succeeded', 'rejected'], succeeded: [], rejected: [], unknown: [] }, ['succeeded', 'rejected', 'unknown']);
const capture = define('SM31.capture', 'planned', { planned: ['reading'], reading: ['validating', 'failed'], validating: ['complete', 'incomplete', 'failed'], complete: [], incomplete: [], failed: [] }, ['complete', 'incomplete', 'failed']);
const scenarioState = define('SM32.binding', 'planned', { planned: ['missing', 'reading'], reading: ['captured', 'partial', 'failed'], missing: [], captured: [], partial: [], failed: [] }, ['missing', 'captured', 'partial', 'failed']);
const script = define('SM33.script', 'before', { before: ['steps', 'cleaning'], steps: ['after', 'cleaning'], after: ['cleaning'], cleaning: ['settled'], settled: [] }, ['settled']);
const retry = define('SM34.retry', 'ready', { ready: ['attempting'], attempting: ['matched', 'waiting', 'stopped'], waiting: ['attempting', 'stopped'], matched: [], stopped: [] }, ['matched', 'stopped']);
const gitFetch = define('SM36.fetch', 'initializing', { initializing: ['fetching', 'failed'], fetching: ['checking-out', 'repairing', 'fallback', 'failed'], repairing: ['fetching', 'fallback', 'failed'], fallback: ['checking-out', 'failed'], 'checking-out': ['recording', 'fallback', 'failed'], recording: ['ready', 'failed'], ready: [], failed: [] }, ['ready', 'failed']);
const workspacePush = define('SM37.push', 'checking', { checking: ['staging', 'failed'], staging: ['committing', 'failed'], committing: ['committed', 'failed'], committed: ['replaying', 'pushing', 'failed'], replaying: ['replayed', 'conflict', 'failed'], replayed: ['pushing', 'failed'], pushing: ['pushed', 'unknown'], pushed: ['recording', 'metadata-failed'], recording: ['completed', 'metadata-failed'], completed: [], failed: [], conflict: [], unknown: [], 'metadata-failed': [] }, ['completed', 'failed', 'conflict', 'unknown', 'metadata-failed']);
const refresh = define('SM43.refresh', 'sources', { sources: ['indexing', 'failed'], indexing: ['ready', 'failed'], ready: [], failed: [] }, ['ready', 'failed']);
const passport = define('SM44.passport', 'resolving', { resolving: ['fetching', 'failed'], fetching: ['extracting', 'failed'], extracting: ['libraries', 'failed'], libraries: ['analyzing', 'failed'], analyzing: ['publishing', 'failed'], publishing: ['ready', 'failed'], ready: [], failed: [] }, ['ready', 'failed']);
const realm = define('SM78.program', 'prepared', { prepared: ['executing', 'rejected'], executing: ['settled', 'failed'], settled: [], rejected: [], failed: [] }, ['settled', 'rejected', 'failed']);
const http = define('SM76.http', 'sending', { sending: ['reading', 'failed'], reading: ['completed', 'failed'], completed: [], failed: [] }, ['completed', 'failed']);
const migration = define('SM13.migration', 'new', { new: ['reading'], reading: ['paused', 'complete'], paused: ['reading'], complete: ['reading'] });
const testInvocation = define('SM38.invocation', 'running', { running: ['settled', 'failed'], settled: [], failed: [] }, ['settled', 'failed']);
const testProof = define('SM38.proof-evidence', 'no-red', { 'no-red': ['red-seen'], 'red-seen': ['changed-green-seen'], 'changed-green-seen': [] }, ['changed-green-seen']);
const generatedResource = define('SM52.generated-resource', 'checking', { checking: ['retained', 'preview', 'writing'], writing: ['written', 'failed'], retained: [], preview: [], written: [], failed: [] }, ['retained', 'preview', 'written', 'failed']);
const searchBackend = define('SM77.backend', 'unknown', { unknown: ['available', 'unavailable'], available: ['unavailable'], unavailable: [] }, ['unavailable']);
const revisionModel = name => define(name, 'checking', { checking: ['locked', 'checked', 'failed'], locked: ['checked', 'failed'], checked: ['revision-written', 'head-written', 'failed'], 'revision-written': ['head-written', 'failed'], 'head-written': ['completed', 'failed'], completed: [], failed: [] }, ['completed', 'failed']);
const passportEdit = revisionModel('SM55.passport-edit'), mapEdit = revisionModel('SM56.map-edit'), architectureEdit = revisionModel('SM57.architecture-edit');
const definition = define('SM58.definition', 'checking', { checking: ['custom', 'builtin', 'missing'], custom: [], builtin: [], missing: [] }, ['custom', 'builtin', 'missing']);
const apiReplay = define('SM59.replay', 'prepared', { prepared: ['sending'], sending: ['received', 'unknown'], received: ['saved', 'save-failed'], saved: [], unknown: [], 'save-failed': [] }, ['saved', 'unknown', 'save-failed']);
const browserLease = define('SM60.browser-lease', 'opening', { opening: ['ready', 'failed'], ready: ['capturing', 'expired', 'closing'], capturing: ['ready', 'expired', 'closing'], expired: ['closing'], failed: ['closing'], closing: ['closed'], closed: [] }, ['closed']);
const result = define('SM61.result', 'allocating', { allocating: ['serialized', 'failed'], serialized: ['stored', 'failed'], stored: [], failed: [] }, ['stored', 'failed']);
const sourceSpan = define('P03.source-span', 'code', { code: ['quoted', 'text-block', 'line-comment', 'block-comment', 'done'], quoted: ['code'], 'text-block': ['code'], 'line-comment': ['code'], 'block-comment': ['code'], done: [] }, ['done']);
const reportFile = define('P06.report-file', 'clean', { clean: ['failed'], failed: [] }, ['failed']);
const markup = define('P07.markup-stack', 'root', { root: ['nested'], nested: ['root'] });
const traversal = define('P08.traversal', 'searching', { searching: ['found', 'exhausted', 'truncated'], found: [], exhausted: [], truncated: [] }, ['found', 'exhausted', 'truncated']);
const enumeration = define('P09.enumeration', 'available', { available: ['exhausted'], exhausted: [] }, ['exhausted']);
const compiler = define('SM40.compiler', 'starting', { starting: ['ready', 'stopped'], ready: ['stopping', 'stopped'], stopping: ['stopped'], stopped: [] }, ['stopped']);
const docsRefresh = define('SM48.refresh', 'listing', { listing: ['pages', 'failed'], pages: ['reconciling', 'failed'], reconciling: ['watermark', 'partial', 'failed'], watermark: ['current', 'failed'], current: [], partial: [], failed: [] }, ['current', 'partial', 'failed']);
const starter = define('SM58.starter', 'checking', { checking: ['retained', 'copying'], copying: ['copied'], retained: [], copied: [] }, ['retained', 'copied']);
const bundle = define('SM74.bundle', 'bundling', { bundling: ['collecting'], collecting: ['comparing'], comparing: ['verified', 'stale', 'writing'], writing: ['written'], verified: [], stale: [], written: [] }, ['verified', 'stale', 'written']);
const configMigration = define('SM74.config-migration', 'planning', { planning: ['preview', 'staging'], staging: ['secrets-published', 'compensating'], 'secrets-published': ['config-published', 'compensating'], 'config-published': ['ready', 'compensating'], compensating: ['rolled-back', 'cleanup-failed'], preview: [], ready: [], 'rolled-back': [], 'cleanup-failed': [] }, ['preview', 'ready', 'rolled-back', 'cleanup-failed']);
const diagnosticStore = define('SM79.diagnostic-store', 'cold', { cold: ['starting', 'closed', 'failed'], starting: ['ready', 'failed', 'closed'], ready: ['failed', 'closed'], failed: ['closed'], closed: [] }, ['closed']);
const projectContextPublication = define('SM80.project-context-publication', 'draft', { draft: ['locked'], locked: ['checked','failed'], checked: ['files-written','failed'], 'files-written': ['revision-written','failed'], 'revision-written': ['published','failed'], published: [], failed: [] }, ['published','failed']);
const ciWait = define('SM81.ci-wait', 'checking', { checking: ['sleeping','complete','pending','cancelled','failed'], sleeping: ['checking','pending','cancelled','failed'], complete: [], pending: [], cancelled: [], failed: [] }, ['complete','pending','cancelled','failed']);
module.exports = { ciWait, projectContextPublication, diagnosticStore, bundle, configMigration, starter, docsRefresh, compiler, execution, job, admission, worker, session, sandbox, cell, settlement, process, span, networkAdmission, runnerRequest, circuit, store, storeClose, writer, config, registry, transaction, scratch, template, lease, leaseReset, publication, edgeSnapshot, catalogWriter, descriptor, handshake, fixture, scenario, collection, semantic, sftp, sftpOperation, control, archive, archiveRemoval, contextArchive, context, captureCall, pit, identity, mcp, effects, action, quietWindow, semanticPublication, knowledgeRefresh, observation, preparation, mavenPrepare, deepQuery, adapter, capture, scenarioState, script, retry, gitFetch, workspacePush, refresh, passport, realm, http, migration, testInvocation, testProof, generatedResource, searchBackend, passportEdit, mapEdit, architectureEdit, definition, apiReplay, browserLease, result, sourceSpan, reportFile, markup, traversal, enumeration };
