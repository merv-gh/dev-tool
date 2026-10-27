// Kafka via kafka-ui's HTTP API (it decodes Avro/JSON for us) + Schema Registry.
const path = require('path');
const { getEnv } = require('./config');
const { CACHE, http, pool, writeJson, readJson, tryJson, flattenTypes, safeName } = require('./util');

function ui(envName) {
  const url = getEnv(envName).kafkaUi;
  if (!url) throw new Error(`kafka-ui URL not set for ${envName} (KAFKA_MANAGER in ${getEnv(envName).envFile})`);
  return url.replace(/\/$/, '');
}

const clusterCache = {};
async function cluster(envName) {
  if (!clusterCache[envName]) {
    const clusters = await http(`${ui(envName)}/api/clusters`);
    clusterCache[envName] = (clusters.find(c => c.status === 'online') || clusters[0]).name;
  }
  return clusterCache[envName];
}

async function topics(envName) {
  const base = `${ui(envName)}/api/clusters/${await cluster(envName)}/topics`;
  const all = [];
  for (let page = 1; ; page++) {
    const res = await http(`${base}?page=${page}&perPage=500&showInternal=false`, { timeout: 60000 });
    all.push(...res.topics);
    if (page >= (res.pageCount || 1)) break;
  }
  return all;
}

function parseSse(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const ev = tryJson(line.slice(5).trim());
    if (ev && ev.type === 'MESSAGE') out.push(ev.message);
  }
  return out;
}

const toSample = (m) => ({
  partition: m.partition, offset: m.offset, timestamp: m.timestamp,
  key: tryJson(m.key), headers: m.headers, value: tryJson(m.content),
});

// Last n messages of a topic: read from (offsetMax - n) on each of the busiest partitions.
async function lastMessages(envName, topic, n = 3, partitions) {
  const c = await cluster(envName);
  if (!partitions) {
    const t = await http(`${ui(envName)}/api/clusters/${c}/topics/${encodeURIComponent(topic)}`);
    partitions = t.partitions || [];
  }
  const busiest = partitions.filter(p => p.offsetMax > p.offsetMin)
    .sort((a, b) => b.offsetMax - a.offsetMax).slice(0, Math.max(1, Math.min(3, n)));
  const msgs = [];
  for (const p of busiest) {
    const offset = Math.max(p.offsetMin, p.offsetMax - n);
    const q = new URLSearchParams({ keySerde: 'String', valueSerde: 'String', limit: String(n), partition: String(p.partition), offset: String(offset) });
    const text = await http(`${ui(envName)}/api/clusters/${c}/topics/${encodeURIComponent(topic)}/messages?${q}`, { raw: true, timeout: 20000 });
    msgs.push(...parseSse(text).map(toSample));
  }
  return msgs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, n);
}

async function sync(envName, { only, samples = 3, log = console.error } = {}) {
  const started = Date.now();
  let list = await topics(envName);
  if (only) list = list.filter(t => only.some(o => t.name.includes(o)));
  log(`kafka: ${list.length} topics, cluster ${await cluster(envName)}`);

  // Schema registry: latest version of every subject, 10 in parallel.
  const sr = getEnv(envName).schemaRegistry;
  const schemas = {};
  if (sr) {
    try {
      const subjects = await http(`${sr}/subjects`);
      const res = await pool(subjects, 10, s => http(`${sr}/subjects/${encodeURIComponent(s)}/versions/latest`));
      for (const r of res) if (r.value) schemas[r.item] = { version: r.value.version, id: r.value.id, type: r.value.schemaType || 'AVRO', schema: tryJson(r.value.schema) };
      log(`kafka: ${Object.keys(schemas).length} schema subjects`);
    } catch (e) { log(`kafka: schema registry ERROR ${e.message}`); }
  }

  const dir = path.join(CACHE, envName, 'kafka');
  let done = 0;
  const results = await pool(list, 10, async (t) => {
    const msgs = (t.partitions || []).some(p => p.offsetMax > p.offsetMin)
      ? await lastMessages(envName, t.name, samples, t.partitions) : [];
    const values = msgs.map(m => m.value).filter(v => v && typeof v === 'object');
    const fields = Object.assign({}, ...values.map(v => flattenTypes(v)));
    writeJson(path.join(dir, `${safeName(t.name)}.json`), {
      topic: t.name,
      partitions: t.partitionCount,
      replication: t.replicationFactor,
      cleanup: t.cleanUpPolicy,
      messages: (t.partitions || []).reduce((s, p) => s + (p.offsetMax - p.offsetMin), 0),
      lastMessageAt: msgs[0]?.timestamp || null,
      keySchema: schemas[`${t.name}-key`] || null,
      valueSchema: schemas[`${t.name}-value`] || null,
      fields,
      samples: msgs,
    });
    if (++done % 50 === 0) log(`kafka: ${done}/${list.length}`);
    return { samples: msgs.length };
  });
  for (const r of results) if (r.error) log(`kafka ${r.item.name}: ERROR ${r.error.message}`);

  writeJson(path.join(dir, '_index.json'), {
    syncedAt: new Date().toISOString(), cluster: await cluster(envName),
    topics: list.map(t => ({ topic: t.name, partitions: t.partitionCount, messages: (t.partitions || []).reduce((s, p) => s + (p.offsetMax - p.offsetMin), 0) })),
    subjects: Object.keys(schemas),
  });
  log(`kafka: done ${Date.now() - started}ms, ${results.filter(r => r.error).length} errors`);
  return { topics: list.length, errors: results.filter(r => r.error).length, ms: Date.now() - started };
}

function cached(envName, topic) {
  return readJson(path.join(CACHE, envName, 'kafka', `${safeName(topic)}.json`));
}

module.exports = { topics, lastMessages, sync, cached, cluster };
