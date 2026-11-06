// Background jobs are scoped to a principal and story, deduplicated within that scope.
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson, writeJson } = require('./util');
const E = require('./execution');
const { bind } = require('./state-machine'), lifecycle = require('./lifecycles').job;
const KEEP = 100;
let jobs = [], loadedScopes = new Set();
const storage = () => { try { return require('./state-store'); } catch { return null; } };
const legacyFile = owner => require('./access').run(owner || require('./access').owner(), () => path.join(require('./access').scopedDirectory(CACHE), '_jobs.json'));
function all() {
  const owner = require('./access').owner(), scopeKey = owner.scopeKey;
  if (!loadedScopes.has(scopeKey)) {
    loadedScopes.add(scopeKey);
    const projection = storage()?.snapshot?.('jobs'), saved = projection?.length ? projection : readJson(legacyFile(owner), []) || [];
    for (const j of saved) if (!jobs.some(x => x.id === j.id)) jobs.push(recover({ ...j, owner: j.owner || owner }));
  }
  for (const j of storage()?.snapshot?.('jobs') || []) {
    const index = jobs.findIndex(x => x.id === j.id);
    if (index < 0) jobs.push(recover(j));
    else if (jobs[index].processId !== process.pid) jobs[index] = recover(j);
  }
  return jobs;
}
function recover(j) { bind(j, lifecycle); let alive = false; if (j.processId) try { process.kill(j.processId, 0); alive = true; } catch {} if (['running', 'queued', 'cancelling', 'draining'].includes(j.state) && !alive) j.state = 'interrupted'; return j; }
const view = ({ promise, ...j }) => { const execution = j.executionId ? E.get(j.executionId) : null; return { ...j, ...(j.error ? { error: execution?.error || require('./redact').clean(j.error) } : {}), log: require('./redact').clean(j.log), ...(execution ? { cleanup: { state: execution.state, resources: execution.resources, children: execution.children, incomplete: execution.cleanupIncomplete || 0 }, outcome: execution.outcome } : {}) }; };
const resultFile = job => path.join(path.dirname(legacyFile(job.owner)), 'job-results', `${job.id}.json`);
function persisted(job) {
  const record = { ...view(job) };
  if (record.result !== undefined) {
    const text = JSON.stringify(record.result), bytes = Buffer.byteLength(text || '');
    if (bytes > 65536) { writeJson(resultFile(job), record.result); record.resultReference = { id: job.id, bytes, sha256: crypto.createHash('sha256').update(text).digest('hex') }; record.resultSummary = Object.fromEntries(['outcome','counts','ok','status'].filter(key => record.result && record.result[key] !== undefined).map(key => [key, record.result[key]])); delete record.result; }
  }
  return record;
}
function hydrate(job) { if (job?.resultReference && job.result === undefined) { const result = readJson(resultFile(job)); if (result !== null) job.result = result; } return job; }

function persist(job) {
  const s = storage();
  if (s?.enabled?.()) { if (job) s.putJob(persisted(job), job.owner); else for (const j of all()) s.putJob(persisted(j), j.owner); }
  else try { const owner = job?.owner || require('./access').owner(); writeJson(legacyFile(owner), all().filter(j => (j.owner?.scopeKey || 'legacy') === owner.scopeKey).slice(0, KEEP).map(persisted)); } catch {}
}
function start(key, title, run) {
  const access = require('./access'), owner = access.owner();
  const running = all().find(j => j.key === key && j.state === 'running' && (j.owner?.scopeKey || 'legacy') === owner.scopeKey);
  if (running) return running;
  const job = { id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), key, title, owner, processId: process.pid, state: 'running', startedAt: new Date().toISOString(), log: [] };
  bind(job, lifecycle);
  const log = line => { job.log.push(`${new Date().toISOString().slice(11, 19)} ${String(line).slice(0, 2000)}`); while (job.log.length > 500 || job.log.reduce((n,l)=>n+Buffer.byteLength(l),0) > 32768) job.log.shift(); };
  all().unshift(job); const ownJobs = jobs.filter(j => j.owner?.scopeKey === owner.scopeKey); if (ownJobs.length > KEEP) { const old = jobs.findLastIndex(j => j.owner?.scopeKey === owner.scopeKey && j.state !== 'running'); if (old >= 0) jobs.splice(old, 1); }
  const T = require('./trace'), session = T.current()?.session;
  job.executionId = `job:${job.id}`;
  const execution = E.start({ id: job.executionId, kind: 'job', tool: title, title, source: 'job', detached: true }, () => {
    E.check(); // An immediate cancel must prevent even the callback's first statement.
    if (job.state !== 'running') throw E.abortError(job.error);
    return T.call(title, { job: job.id }, { kind: 'job', source: 'job', session }, () => { job.traceId = T.current().id; return run(log); });
  });
  job.promise = execution.promise.then(r => { if (job.state === 'running') { job.state = 'done'; job.result = r; } }, e => { if (job.state === 'running') { job.state = e.code === 'DT_CANCELLED' ? 'cancelled' : 'failed'; job.error = e.message; } log(`ERROR ${e.message}`); })
    .finally(() => { job.endedAt = new Date().toISOString(); job.ms = Date.parse(job.endedAt) - Date.parse(job.startedAt); const state = E.get(job.executionId); if (state?.cleanupIncomplete) job.cleanupIncomplete = state.cleanupIncomplete; persist(job); }).then(() => view(job));
  persist(job); return job;
}
function cancel(id, why = 'cancelled') {
  const job = find(id); if (!job) throw new Error(`no job ${id}`);
  if (job.state !== 'running') return { ...view(job), note: `already ${job.state}` };
  if (job.processId && job.processId !== process.pid) throw Object.assign(new Error('This job is owned by another running process; cancel it on that server'), { code: 'DT_JOB_REMOTE_OWNER' });
  job.state = 'cancelled'; job.error = why; job.endedAt = new Date().toISOString(); job.ms = Date.parse(job.endedAt) - Date.parse(job.startedAt);
  const n = job.executionId ? E.cancel(job.executionId, why).stopped : job.traceId ? require('./trace').kill(job.traceId, why) : 0;
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${why}${n ? ` (${n} process${n === 1 ? '' : 'es'} stopped)` : ''}`);
  persist(job); return { ...view(job), stopped: n };
}
const visible = j => require('./access').visible(j.owner);
const list = (limit = 30) => all().filter(visible).slice(0, limit).map(j => ({ ...view(j), log: j.log.slice(-3) }));
const find = id => hydrate(all().find(x => x.id === id && visible(x)) || null);
const get = id => { const j = find(id); return j ? view(j) : null; };
module.exports = { start, cancel, list, get, find };
