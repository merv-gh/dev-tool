// Read-only operational snapshots. Missing instrumentation is a gap, never zero CPU/RAM.
const fs = require('node:fs'), path = require('node:path');
const C = require('./config'), E = require('./execution');
const { readJson, writeJson } = require('./util');
const config = () => { const c = C.load(); return C.interpolate(c.raw.architecture || {}, c.lookup()); };
const file = env => { C.getEnv(env); return path.join(C.PATHS.cache, env, 'architecture-observations.json'); };
const number = value => ['string','number'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function snapshot(env) {
  const value = readJson(file(env)) || { env, resources: [], gaps: [] };
  const consul = require('./redact').clean(readJson(path.join(C.PATHS.cache, env, 'consul.json')));
  return { ...value, consul: consul ? { ...consul, stale: value.resources?.some(r => r.id === 'consul' && r.stale) } : null, stale: !value.at || !Number.isFinite(Date.parse(value.at)) || Date.now() - Date.parse(value.at) > Number(config().staleAfterMs || 300000) };
}
async function json(url, headers = {}) {
  E.check(); const signals = [E.signal(), AbortSignal.timeout(10000)].filter(Boolean);
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.any(signals) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Observation endpoint HTTP ' + response.status); }
  let text = '', bytes = 0; const decoder = new TextDecoder();
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error('Observation response exceeds 2 MiB'); text += decoder.decode(chunk, { stream: true }); }
  E.check(); return JSON.parse(text + decoder.decode());
}
function metricValues(metrics = []) {
  const out = {};
  for (const row of metrics.slice(0, 20000)) {
    const value = number(row.value); if (value === null) continue;
    // Exact names and units, not a heuristic over arbitrary "memory" fields.
    if (['process_cpu_usage', 'process_cpu_load', 'java_lang_OperatingSystem_ProcessCpuLoad'].includes(row.name) && value <= 1) out.cpuPercent = value * 100;
    if (['jvm_memory_used_bytes', 'java_lang_Memory_HeapMemoryUsage_used'].includes(row.name)) {
      const labels = row.labels || {}; if (labels.area && labels.area !== 'heap') continue;
      out.memoryUsedBytes = (out.memoryUsedBytes || 0) + value;
    }
    if (['jvm_memory_max_bytes', 'java_lang_Memory_HeapMemoryUsage_max'].includes(row.name)) {
      const labels = row.labels || {}; if (labels.area && labels.area !== 'heap') continue;
      out.memoryLimitBytes = (out.memoryLimitBytes || 0) + value;
    }
  }
  return out;
}
const PG_SQL = `select current_database() as database,
 pg_database_size(current_database())::text as database_bytes,
 current_setting('max_connections')::int as max_connections,
 (select count(*)::int from pg_stat_activity where datname=current_database()) as connections,
 (select count(*)::int from pg_stat_activity where datname=current_database() and state='active') as active_connections,
 xact_commit::text, xact_rollback::text, blks_read::text, blks_hit::text, deadlocks::text, temp_bytes::text, stats_reset
 from pg_stat_database where datname=current_database()`;
async function collect(env, { log = () => {} } = {}) {
  require('./access').requireAdmin();
  const settings = C.getEnv(env), prior = readJson(file(env)), resources = [], gaps = [], at = new Date().toISOString();
  const capture = async (id, kind, fn) => {
    E.check(); log('Observe ' + id);
    const lifecycle = require('./state-machine').create(require('./lifecycles').observation);
    try { const value = await fn(); lifecycle.to('fresh'); resources.push({ id, kind, at, source: kind, ...value }); }
    catch (error) {
      E.check(); const old = prior?.resources?.find(r => r.id === id); lifecycle.to(old ? 'stale' : 'missing');
      if (old) resources.push({ ...old, stale: true, error: 'Refresh failed; retained previous observation' });
      else if (id === 'consul') resources.push({ id, kind, at: null, stale: true, error: 'Consul refresh failed' });
      gaps.push({ kind: 'observation-failed', target: id, message: require('./redact').clean(error.message) });
    }
  };
  if (settings.consul) await capture('consul', 'consul', async () => {
    await require('./limit').take('consul:' + env); await require('./consul').sync(env, { log, retainPrevious: true });
    const snapshot = readJson(path.join(C.PATHS.cache, env, 'consul.json'));
    for (const [name, service] of Object.entries(snapshot?.services || {})) if (service.error) gaps.push({ kind: 'consul-service-failed', target: 'svc:' + name, message: service.instances?.length ? 'Refresh failed; retained previous instances with their original timestamp' : 'No successful instance observation' });
    return { status: 'observed', note: 'Service instances and health checks; not resource telemetry' };
  });
  for (const db of Object.keys(settings.pg).slice(0, 30)) await capture('db:' + db, 'postgres', async () => {
    await require('./limit').take('pg:' + env);
    const row = (await require('./pg').query(env, PG_SQL, { db })).rows[0] || {};
    const hit = number(row.blks_hit), read = number(row.blks_read);
    return { name: db, ...Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? v.toString() : v])), cacheHitPercent: hit !== null && read !== null && hit + read ? hit / (hit + read) * 100 : null,
      gaps: ['Standard pg_stat views do not expose host CPU or memory. Add an explicit telemetry mapping to display those.'] };
  });
  if (settings.kafkaUi) {
    let clusters = [];
    try { await require('./limit').take('kafka:' + env); clusters = await json(settings.kafkaUi + '/api/clusters'); if (!Array.isArray(clusters)) throw new Error('Kafka cluster list is not an array'); }
    catch (error) { E.check(); gaps.push({ kind: 'kafka-unavailable', message: error.message }); resources.push(...(prior?.resources || []).filter(r => r.kind === 'kafka').map(r => ({ ...r, stale: true, error: 'Cluster refresh failed; retained previous observation' }))); }
    for (const cluster of clusters.slice(0, 10)) await capture('kafka-cluster:' + cluster.name, 'kafka', async () => {
      const root = `${settings.kafkaUi}/api/clusters/${encodeURIComponent(cluster.name)}`;
      await require('./limit').take('kafka:' + env); const stats = await json(root + '/stats');
      const record = { name: cluster.name, status: cluster.status, ...Object.fromEntries(['brokerCount','onlinePartitionCount','offlinePartitionCount','underReplicatedPartitionCount','inSyncReplicasCount','outOfSyncReplicasCount','version'].filter(k => stats[k] != null).map(k => [k, stats[k]])), bytesInPerSec: number(cluster.bytesInPerSec), bytesOutPerSec: number(cluster.bytesOutPerSec), brokers: [], gaps: [] };
      try {
        await require('./limit').take('kafka:' + env); const brokers = await json(root + '/brokers');
        if (!Array.isArray(brokers)) throw new Error('Broker list is not an array');
        const budget = Math.min(50, Math.max(1, Number(config().maxMetricBrokers) || 12));
        for (const broker of brokers.slice(0, budget)) {
          E.check(); const id = broker.id ?? broker.brokerId;
          const value = { id, host: broker.host, port: broker.port };
          try { await require('./limit').take('kafka:' + env); const metrics = await json(root + `/brokers/${encodeURIComponent(id)}/metrics`); Object.assign(value, metricValues(metrics.metrics)); }
          catch { E.check(); value.gap = 'Broker CPU/JVM metrics unavailable'; }
          record.brokers.push(value);
        }
        if (brokers.length > record.brokers.length) record.gaps.push('Broker metric budget reached; counts remain cluster-wide');
      } catch { E.check(); record.gaps.push('Broker instrumentation unavailable; cluster stats remain usable'); }
      return record;
    });
  }
  // Optional JSON telemetry comes only from administrator-configured endpoints.
  for (const source of (config().telemetry || []).filter(s => s.env === env).slice(0, 50)) await capture('telemetry:' + source.id, 'telemetry', async () => {
    if (!/^https?:\/\//.test(source.url || '')) throw new Error('Telemetry URL must be HTTP(S)');
    const data = await json(source.url, source.headers || {}), values = {};
    for (const [name, mapping] of Object.entries(source.fields || {})) {
      if (!['cpuPercent', 'memoryUsedBytes', 'memoryLimitBytes'].includes(name)) continue;
      const field = typeof mapping === 'string' ? { path: mapping } : mapping;
      const raw = String(field.path || '').split('.').reduce((v, key) => v && Object.hasOwn(v, key) ? v[key] : undefined, data), value = number(raw);
      if (value !== null) { const scaled = value * Number(field.scale ?? 1); if (Number.isFinite(scaled) && scaled >= 0 && (name !== 'cpuPercent' || scaled <= 100)) values[name] = scaled; }
    }
    return { target: source.target, name: source.id, ...values, mapping: Object.fromEntries(Object.entries(source.fields || {}).map(([k,v]) => [k, typeof v === 'string' ? v : v.path])), note: 'Explicit configured metric paths and units' };
  });
  E.check(); const value = { env, at, resources, gaps }; writeJson(file(env), value); return { env, at, resources: resources.length, gaps };
}
module.exports = { collect, snapshot, metricValues, PG_SQL, config };
