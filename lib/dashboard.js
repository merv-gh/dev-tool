// Environment overview for the `overview` tool and the /dash page. Each section is its own
// rate-limit key, and the combined result is reused for 10s, so many open dashboards cost the
// same as one.
const limit = require('./limit');
const monitor = require('./monitor');

const TTL = 10000;
const cache = {};

async function section(key, fn) {
  try { await limit.take(key); return await fn(); }
  catch (e) { return { error: e.message }; }
}

async function build(env) {
  const [health, es, kafka] = await Promise.all([
    section(`consul:${env}`, () => monitor.health(env)),
    section(`es:${env}`, () => monitor.esHealth(env)),
    section(`kafka:${env}`, () => monitor.kafkaLag(env, { top: 50 })),
  ]);
  const trim = (s, filter, n) => (s.error ? s : { summary: s.summary, rows: s.rows.filter(filter).slice(0, n) });
  return {
    env,
    at: new Date().toISOString(),
    health: trim(health, r => r.status === 'down' || r.status === 'degraded', 50),
    es: trim(es, () => true, 50),
    kafka: trim(kafka, r => r.lag > 0 || (r.state && r.state !== 'STABLE'), 20),
  };
}

function overview(env) {
  const c = cache[env];
  if (c && Date.now() - c.t < TTL) return c.p;
  const p = build(env);
  cache[env] = { t: Date.now(), p };
  p.catch(() => { delete cache[env]; });
  return p;
}

module.exports = { overview };
