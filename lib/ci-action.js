// Reserve a receipt before an external POST. Lost replies are never retried.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { error } = require('./ci-http');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stable(value) { return Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value; }
async function perform(kind, requestId, input, run) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(requestId)) throw error('request_id must be a stable action key (1–160 letters, digits, dots, colons, dashes or underscores)');
  const dir = path.join(require('./access').scopedDirectory(require('./config').PATHS.cache), 'ci-actions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, digest([kind, requestId]) + '.json'), fingerprint = digest(stable(input));
  const receipt = { kind, request_id: requestId, fingerprint, state: 'submitting', startedAt: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); }
  catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (saved && saved.fingerprint !== fingerprint) throw error('request_id already refers to different action arguments', 'DT_CI_ACTION_CONFLICT', 409);
    return saved?.result ? { ...saved.result, replayed: true, request_id: requestId } : { request_id: requestId, state: saved?.state || 'unknown', outcome: saved?.state === 'submitting' ? 'pending' : 'unknown', replayed: true, guidance: 'This action was already submitted or reserved. Inspect the existing PR/queue; do not use a new key to retry an uncertain action.' };
  }
  const lifecycle = require('./state-machine').create(require('./lifecycles').action); lifecycle.to('executing');
  try {
    require('./execution').check();
    const result = { ...await run(), request_id: requestId };
    require('./atomic-file').atomicFile(file, JSON.stringify({ ...receipt, state: 'completed', result }), { mode: 0o600 });
    lifecycle.to('completed'); return result;
  } catch (cause) {
    lifecycle.to('unknown');
    try { require('./atomic-file').atomicFile(file, JSON.stringify({ ...receipt, state: 'unknown', error: cause.code || 'DT_CI_ACTION_UNKNOWN' }), { mode: 0o600 }); } catch {}
    throw Object.assign(error('Action outcome is unknown or rejected. Recover the existing PR/queue before submitting again: ' + require('./redact').clean(cause.message), 'DT_CI_ACTION_UNKNOWN', cause.statusCode || 502), { requestId });
  }
}
module.exports = { perform, digest };
