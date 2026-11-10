// Bounded cancellable polling works with JSON MCP, OpenAPI and the CLI alike.
const E = require('./execution'), R = require('./results'), { error } = require('./ci-http');
function cursor(kind, target, data) {
  const body = Buffer.from(JSON.stringify({ v: 1, kind, target: require('./ci-action').digest(target), ...data })).toString('base64url');
  return body + '.' + R.sign('ci-wait\0' + require('./access').owner().scopeKey + '\0' + body);
}
function readCursor(value, kind, target) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 2048) throw Error();
    const [body, token, extra] = value.split('.');
    if (extra || !R.verify('ci-wait\0' + require('./access').owner().scopeKey + '\0' + body, token)) throw Error();
    const c = JSON.parse(Buffer.from(body, 'base64url'));
    if (c.v !== 1 || c.kind !== kind || c.target !== require('./ci-action').digest(target)) throw Error();
    return c;
  } catch { throw error('Cursor belongs to another target/story or is invalid; obtain a new status cursor'); }
}
async function poll({ observe, decide, wait_ms = 15000, poll_ms = 3000, title = 'CI wait' }) {
  if (!Number.isInteger(wait_ms) || wait_ms < 0 || wait_ms > 25000) throw error('wait_ms must be 0..25000');
  if (!Number.isInteger(poll_ms) || poll_ms < 100 || poll_ms > 10000) throw error('poll_ms must be 100..10000');
  const lifecycle = require('./state-machine').create(require('./lifecycles').ciWait);
  const started = Date.now(), deadline = wait_ms ? AbortSignal.timeout(wait_ms) : null, parent = E.signal();
  let last, checks = 0, verdict = null;
  try {
    await E.run({ kind: 'wait', title, signal: deadline ? AbortSignal.any([deadline, parent].filter(Boolean)) : parent }, async () => {
      for (;;) {
        E.check(); last = await observe(); checks++;
        verdict = decide(last);
        if (verdict) { lifecycle.to('complete'); return; }
        if (!wait_ms || Date.now() - started >= wait_ms) { lifecycle.to('pending'); return; }
        lifecycle.to('sleeping');
        await require('./limit').sleep(Math.min(poll_ms, Math.max(1, wait_ms - (Date.now() - started))), E.signal());
        lifecycle.to('checking');
      }
    });
  } catch (cause) {
    if (parent?.aborted) { if (!lifecycle.terminal) lifecycle.to('cancelled'); throw cause; }
    if (deadline?.aborted) { if (!lifecycle.terminal) lifecycle.to('pending'); }
    else { if (!lifecycle.terminal) lifecycle.to('failed'); throw cause; }
  }
  return { ...(last || {}), wait: { state: verdict || 'pending', checks, elapsedMs: Date.now() - started, timedOut: !verdict && !!wait_ms, observed: !!last } };
}
module.exports = { cursor, readCursor, poll };
