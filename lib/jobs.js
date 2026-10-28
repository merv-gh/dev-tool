// Background jobs for index refreshes: one running job per key (a second request joins it), a log the
// admin page tails, and the last 100 jobs kept in cache/_jobs.json across restarts.
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson, writeJson } = require('./util');

const FILE = path.join(CACHE, '_jobs.json');
const KEEP = 100;
let jobs = null;

function all() {
  if (!jobs) {
    jobs = (readJson(FILE, []) || []).map(j => (j.state === 'running' ? { ...j, state: 'interrupted' } : j));
  }
  return jobs;
}
const view = ({ promise, ...j }) => j;
function persist() { try { writeJson(FILE, all().slice(0, KEEP).map(view)); } catch {} }

// run(log) does the work; returns the job (await job.promise for the result).
function start(key, title, run) {
  const running = all().find(j => j.key === key && j.state === 'running');
  if (running) return running;
  const job = { id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), key, title, state: 'running', startedAt: new Date().toISOString(), log: [] };
  const log = (line) => {
    job.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    if (job.log.length > 1000) job.log.splice(0, 200);
  };
  all().unshift(job);
  if (jobs.length > KEEP) jobs.length = KEEP;
  // traced as a call of its own: its steps and its end show in the logs after the tool answered "running"
  const T = require('./trace');
  const session = T.current()?.session;
  job.promise = Promise.resolve()
    .then(() => T.call(title, { job: job.id }, { kind: 'job', source: 'job', session }, () => { job.traceId = T.current().id; return run((line) => { log(line); }); }))
    // a cancelled job stays cancelled whatever its work returns after its processes were stopped
    .then((r) => { if (job.state === 'running') { job.state = 'done'; job.result = r; } }, (e) => { if (job.state === 'running') { job.state = 'failed'; job.error = e.message; } log(`ERROR ${e.message}`); })
    .finally(() => { job.endedAt = new Date().toISOString(); job.ms = Date.parse(job.endedAt) - Date.parse(job.startedAt); persist(); })
    .then(() => view(job));
  persist();
  return job;
}

// Stop a running job: its processes (builds, git) are killed, it is marked cancelled at once
function cancel(id, why = 'cancelled') {
  const job = all().find(x => x.id === id);
  if (!job) throw new Error(`no job ${id}`);
  if (job.state !== 'running') return { ...view(job), note: `already ${job.state}` };
  job.state = 'cancelled';
  job.error = why;
  job.endedAt = new Date().toISOString();
  job.ms = Date.parse(job.endedAt) - Date.parse(job.startedAt);
  const n = job.traceId ? require('./trace').kill(job.traceId, why) : 0;
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${why}${n ? ` (${n} process${n === 1 ? '' : 'es'} stopped)` : ''}`);
  persist();
  return { ...view(job), stopped: n };
}

const list = (limit = 30) => all().slice(0, limit).map(j => ({ ...view(j), log: j.log.slice(-3) }));
const get = (id) => { const j = all().find(x => x.id === id); return j ? view(j) : null; };
// the job itself (with its promise while it runs), for waiting on it
const find = (id) => all().find(x => x.id === id) || null;

module.exports = { start, cancel, list, get, find };
