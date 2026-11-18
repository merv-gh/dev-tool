// Explicit workflow actions through the configured Kafka UI. No consumer group, commits or retries.
const { getEnv } = require('./config');
const E = require('./execution'), L = require('./limit');
const integer = (n, fallback, min, max, name) => {
  n ??= fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw Error(`${name} must be ${min}..${max}`);
  return n;
};
function offset(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('Kafka offsets must be decimal strings when larger than safe integers');
  if (!/^\d+$/.test(String(value))) throw Error('Invalid Kafka offset');
  return BigInt(value);
}
async function request(env, path, { method = 'GET', body, signal, deadline = Date.now() + 30000, preserveOffsets = false } = {}) {
  const base = getEnv(env).kafkaUi;
  if (!base) throw Error(`Kafka UI is not configured for ${env}`);
  const left = () => { E.check(); if (signal?.aborted) throw E.abortError(signal.reason); if (Date.now() >= deadline) throw Error('Kafka operation deadline exceeded'); };
  left();
  const bounded = AbortSignal.any([signal, E.signal(), AbortSignal.timeout(Math.max(1, deadline-Date.now()))].filter(Boolean));
  return L.network(`kafka:${env}`, async () => {
    left();
    const r = await require('./scripts').httpRequest({ method, url: base.replace(/\/$/, '') + path, ...(body !== undefined ? { body } : {}) }, { allowErrors: true, rawResponse: preserveOffsets, maxResponseBytes: 2097152, timeoutMs: Math.max(1, Math.min(30000, deadline - Date.now())), signal: bounded });
    if (r.truncated) throw Error('Kafka UI response exceeded 2 MiB; narrow the batch');
    if (r.status < 200 || r.status >= 300) throw Error(`Kafka UI returned HTTP ${r.status}`);
    return preserveOffsets ? JSON.parse(r.text.replace(/"(offsetMin|offsetMax)"\s*:\s*(-?\d{16,})/g, '"$1":"$2"')) : r.json !== undefined ? r.json : r.text;
  }, {signal:bounded});
}
async function target(a, options = {}) {
  if (!a.topic || typeof a.topic !== 'string') throw Error('topic required');
  const clusters = await request(a.env, '/api/clusters', options);
  if (!Array.isArray(clusters)) throw Error('Kafka UI did not return clusters');
  const chosen = a.cluster ? clusters.find(c => c.name === a.cluster) : clusters.find(c => c.status === 'online') || clusters[0];
  if (!chosen) throw Error('Kafka cluster not found');
  return { env: a.env, cluster: chosen.name, topic: a.topic, path: `/api/clusters/${encodeURIComponent(chosen.name)}/topics/${encodeURIComponent(a.topic)}` };
}
async function bounds(t, options) {
  // Preserve int64 offsets before parsing, including JSON responses from Kafka UI.
  const raw = await request(t.env, t.path, { ...options, preserveOffsets: true });
  const ps = raw?.partitions;
  if (!Array.isArray(ps) || !ps.length) throw Error('Kafka topic has no partition offsets');
  return ps.map(p => { const low=offset(p.offsetMin), high=offset(p.offsetMax); if(high<low)throw Error('Invalid Kafka partition bounds'); return { partition: integer(p.partition, undefined, 0, 2147483647, 'partition'), low, high }; }).sort((a,b) => a.partition - b.partition);
}
async function checkpoint(a) {
  const t = await target(a), ps = await bounds(t);
  return { version: 1, env: t.env, cluster: t.cluster, topic: t.topic, offsets: Object.fromEntries(ps.map(p => [p.partition, String(p.high)])), observedAt: new Date().toISOString() };
}
const at = (value, path) => String(path).split('.').reduce((v,k) => v != null && Object.hasOwn(Object(v), k) ? v[k] : undefined, value);
function matches(message, match) {
  return Object.entries(match).every(([path, value]) => require('node:util').isDeepStrictEqual(at(message, path), value));
}
async function wait(a) {
  const timeout = integer(a.timeout_ms, 30000, 1, 120000, 'timeout_ms'), poll = integer(a.poll_ms, 1000, 100, 30000, 'poll_ms');
  const budget = integer(a.max_messages, 2000, 1, 10000, 'max_messages'), batchSize = integer(a.batch_size, 100, 1, 500, 'batch_size');
  const match = a.match || {};
  if (!match || typeof match !== 'object' || Array.isArray(match)) throw Error('match must be an object of message paths to exact values');
  const deadline = Date.now() + timeout, signal = E.signal(), options = { signal, deadline }, t = await target(a, options);
  const cp = a.checkpoint;
  if (cp && (cp.version !== 1 || cp.env !== t.env || cp.cluster !== t.cluster || cp.topic !== t.topic || !cp.offsets || typeof cp.offsets !== 'object')) throw Error('Checkpoint must belong to the same environment, cluster and topic');
  let ps = await bounds(t, options), offsets = cp ? { ...cp.offsets } : Object.fromEntries(ps.map(p => [p.partition, String(p.high)]));
  for (const v of Object.values(offsets)) offset(v);
  const started = Date.now(); let scanned = 0, polls = 0;
  for (;;) {
    E.check(); polls++;
    if(Object.keys(offsets).length!==ps.length)throw Error('Kafka partitions changed since checkpoint; take a new checkpoint');
    for (const p of ps) {
      if (!Object.hasOwn(offsets, p.partition)) throw Error('Kafka partitions changed since checkpoint; take a new checkpoint');
      let next = offset(offsets[p.partition]);
      if (next < p.low) throw Error(`Kafka checkpoint expired in partition ${p.partition}; records were removed`);
      if (next > p.high) throw Error(`Kafka checkpoint is ahead of partition ${p.partition}; topic may have been recreated`);
      if (next === p.high) continue;
      const q = new URLSearchParams({ keySerde: 'String', valueSerde: 'String', seekType: 'OFFSET', seekTo: `${p.partition}::${next}`, seekDirection: 'FORWARD', partition: String(p.partition), offset: String(next), limit: String(Math.min(batchSize, budget - scanned)) });
      const raw = await request(t.env, t.path + '/messages?' + q, options);
      if (typeof raw !== 'string' || !raw.split('\n').some(line => line.startsWith('data:') && /"type"\s*:\s*"DONE"/.test(line))) throw Error('Kafka UI returned an incomplete message stream; offsets were not advanced');
      const batch = require('./kafka').parseSse(typeof raw === 'string' ? raw : JSON.stringify(raw)).map(require('./kafka').toSample).filter(m => m.partition === p.partition && offset(m.offset) >= next && offset(m.offset) < p.high).sort((a,b) => offset(a.offset) < offset(b.offset) ? -1 : 1);
      // A completed empty seek means this range contains only compacted records.
      if (!batch.length) offsets[p.partition] = String(p.high);
      for (const message of batch.slice(0, Math.min(batchSize, budget - scanned))) {
        scanned++; offsets[p.partition] = String(offset(message.offset) + 1n);
        if (matches(message, match)) return { matched: true, message, env: t.env, cluster: t.cluster, topic: t.topic, scanned, polls, ms: Date.now() - started, checkpoint: { version: 1, env: t.env, cluster: t.cluster, topic: t.topic, offsets } };
      }
      if (scanned >= budget) throw Object.assign(Error(`Kafka wait scan limit ${budget} reached before a match; narrow the match or raise max_messages`), { code: 'DT_KAFKA_SCAN_LIMIT' });
    }
    if (Date.now() + poll >= deadline) throw Object.assign(Error(`Kafka wait timed out without a match (${scanned} messages scanned)`), { code: 'DT_KAFKA_WAIT_TIMEOUT' });
    await L.sleep(Math.min(poll, deadline - Date.now()), signal);
    ps = await bounds(t, options);
  }
}
async function produce(a) {
  const partition = integer(a.partition, undefined, 0, 2147483647, 'partition');
  if (!Object.hasOwn(a, 'value')) throw Error('value required (null explicitly produces a tombstone)');
  if (a.headers && (typeof a.headers !== 'object' || Array.isArray(a.headers) || Object.values(a.headers).some(v => typeof v !== 'string'))) throw Error('headers must map names to strings');
  const t = await target(a), ps = await bounds(t);
  if (!ps.some(p => p.partition === partition)) throw Error('Partition not found in topic');
  const encode = value => value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
  const body = { partition, key: encode(a.key), content: encode(a.value), headers: a.headers || {}, keySerde: a.key_serde || 'String', valueSerde: a.value_serde || 'String' };
  try {
    const receipt = await request(t.env, t.path + '/messages', { method: 'POST', body });
    return { sent: true, acknowledged: true, env: t.env, cluster: t.cluster, topic: t.topic, partition, ...(receipt ? { receipt } : {}) };
  } catch (e) { throw Object.assign(Error(`Kafka produce failed; delivery may be unknown. Inspect the topic before retrying. ${e.message}`), { code: 'DT_KAFKA_PRODUCE_UNCERTAIN' }); }
}
module.exports = { checkpoint, wait, produce, matches };
