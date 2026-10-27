// Per-target rate limit for live queries: server.ratePerSec / DT_RATE_PER_SEC (default 1, 0 = off) per
// system+env, e.g. "pg:dev", "kafka:uat", "bitbucket". Calls queue instead of failing,
// up to DT_RATE_MAX_WAIT_MS, so a burst from the model is spread out, not rejected.
const rate = () => require('./config').getServer().ratePerSec;
const MAX_WAIT = Number(process.env.DT_RATE_MAX_WAIT_MS ?? 30000);
const next = new Map();

async function take(key) {
  const RATE = rate();
  if (!RATE || !key) return 0;
  const gap = 1000 / RATE;
  const now = Date.now();
  const at = Math.max(now, next.get(key) || 0);
  const wait = at - now;
  if (wait > MAX_WAIT) throw new Error(`rate limit: ${key} is busy (${Math.ceil(wait / 1000)}s queued). Retry later or batch the question.`);
  next.set(key, at + gap);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return wait;
}

module.exports = { take, rate };
