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
  job.promise = Promise.resolve()
    .then(() => run(log))
    .then((r) => { job.state = 'done'; job.result = r; }, (e) => { job.state = 'failed'; job.error = e.message; log(`ERROR ${e.message}`); })
    .finally(() => { job.endedAt = new Date().toISOString(); job.ms = Date.parse(job.endedAt) - Date.parse(job.startedAt); persist(); })
    .then(() => view(job));
  persist();
  return job;
}

const list = (limit = 30) => all().slice(0, limit).map(j => ({ ...view(j), log: j.log.slice(-3) }));
const get = (id) => { const j = all().find(x => x.id === id); return j ? view(j) : null; };

module.exports = { start, list, get };
