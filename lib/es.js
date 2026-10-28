const path = require('path');
const { getEnv } = require('./config');
const { CACHE, http, pool, writeJson, safeName } = require('./util');

function client(envName) {
  const { es } = getEnv(envName);
  const auth = es.user ? { user: es.user, pass: es.pass } : undefined;
  // Try hosts in order; a dead node should not fail the call.
  return async (p, opts = {}) => {
    let last;
    for (const host of es.hosts) {
      try { return await http(host.replace(/\/$/, '') + p, { auth, ...opts }); }
      catch (e) { last = e; if (!/fetch failed|timeout|ECONN/i.test(e.message + (e.cause?.code || ''))) throw e; }
    }
    throw last || new Error('No Elasticsearch hosts configured');
  };
}

// "a==1 && b==x" -> bool/term query; JSON passes through.
function buildQuery(q, size = 10) {
  q = (q || '').trim();
  if (!q) return { size, query: { match_all: {} } };
  if (q.startsWith('{')) return JSON.parse(q);
  const filter = q.split('&&').map(part => {
    const m = part.trim().match(/^([\w.@-]+)\s*(==|=|~)\s*(.+)$/);
    if (!m) return { query_string: { query: part.trim() } };
    const value = m[3].trim().replace(/^['"]|['"]$/g, '');
    return m[2] === '~' ? { match: { [m[1]]: value } } : { term: { [m[1]]: value } };
  });
  return { size, query: { bool: { filter } } };
}

async function search(envName, index, q, { size } = {}) {
  const es = client(envName);
  const body = buildQuery(q, size);
  const started = Date.now();
  const res = await es(`/${encodeURIComponent(index)}/_search`, { method: 'POST', body });
  return {
    env: envName, index, ms: Date.now() - started,
    total: res.hits.total?.value ?? res.hits.total,
    hits: res.hits.hits.map(h => ({ _index: h._index, _id: h._id, ...h._source })),
  };
}

// mapping properties -> {"a.b": "keyword"}
function flattenMapping(props, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(props || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v.properties) flattenMapping(v.properties, p, out);
    else out[p] = v.type || 'object';
  }
  return out;
}

async function sync(envName, { only, log = console.error } = {}) {
  const es = client(envName);
  const started = Date.now();
  const [indices, aliases, mappings, info, settings] = await Promise.all([
    es('/_cat/indices?format=json&h=index,health,status,docs.count,store.size'),
    es('/_cat/aliases?format=json&h=alias,index'),
    es('/_mapping'),
    es('/'),
    es('/_settings?include_defaults=false'),
  ]);
  let names = indices.map(i => i.index).filter(n => !n.startsWith('.'));
  if (only) names = names.filter(n => only.some(o => n.includes(o)));

  const aliasesOf = {};
  for (const a of aliases) (aliasesOf[a.index] ??= []).push(a.alias);

  // Samples: one _msearch per 50 indices instead of a request per index.
  const samples = {};
  const chunks = [];
  for (let i = 0; i < names.length; i += 50) chunks.push(names.slice(i, i + 50));
  await pool(chunks, 4, async (chunk) => {
    const body = chunk.map(n => JSON.stringify({ index: n }) + '\n' + JSON.stringify({ size: 2 }) + '\n').join('');
    const res = await es('/_msearch', { method: 'POST', body, headers: { 'content-type': 'application/x-ndjson' }, timeout: 60000 });
    res.responses.forEach((r, i) => { samples[chunk[i]] = (r.hits?.hits || []).map(h => ({ _id: h._id, ...h._source })); });
  });

  const dir = path.join(CACHE, envName, 'es');
  const byName = Object.fromEntries(indices.map(i => [i.index, i]));
  for (const n of names) {
    const m = mappings[n]?.mappings || {};
    // ES 6 nests properties under the type name
    const props = m.properties || Object.values(m).find(t => t && t.properties)?.properties;
    writeJson(path.join(dir, `${safeName(n)}.json`), {
      index: n,
      aliases: aliasesOf[n] || [],
      health: byName[n].health,
      docs: Number(byName[n]['docs.count'] || 0),
      size: byName[n]['store.size'],
      fields: flattenMapping(props),
      samples: samples[n] || [],
      mapping: m,
      settings: Object.fromEntries(Object.entries(settings[n]?.settings?.index || {}).filter(([key]) => ['analysis','similarity','sort','max_ngram_diff','max_shingle_diff'].includes(key))),
    });
  }
  writeJson(path.join(dir, '_index.json'), {
    syncedAt: new Date().toISOString(), version: info.version?.number,
    indices: names.map(n => ({ index: n, aliases: aliasesOf[n] || [], docs: Number(byName[n]['docs.count'] || 0) })),
  });
  log(`es: ${names.length} indices, ${Date.now() - started}ms`);
  return { indices: names.length, ms: Date.now() - started };
}

module.exports = { search, sync, buildQuery, client };
