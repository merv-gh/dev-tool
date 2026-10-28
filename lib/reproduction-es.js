// Elasticsearch read port v1. PIT fixes the read view while separately observed mappings are recorded.
const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function queryFor(matches, rows) {
  const groups = new Map();
  for (const match of matches) { const key = `${match.from.db}:${match.from.table}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(match); }
  const must = [];
  for (const [key, rules] of groups) {
    const should = (rows[key] || []).map(row => ({ bool: { filter: rules.map(rule => {
      const value = row[rule.from.column], field = rule.path === '_id' ? '_id' : rule.path.replace(/^_source\./, '').replace(/\[\]/g, '');
      return value == null ? { bool: { must_not: [{ exists: { field } }] } } : { term: { [field]: value } };
    }) } }));
    must.push(should.length ? { bool: { should, minimum_should_match: 1 } } : { match_none: {} });
  }
  return { bool: { must } };
}
async function capture(env, index, { maxDocuments, matches, rows, mapping, settings = {}, client } = {}) {
  const rawClient = client || require('./es').client(env);
  client = async (route, options = {}) => require('./fixture-json').parse(await rawClient(route, { ...options, raw: true }));
  const startedAt = new Date().toISOString(), actual = await client(`/${encodeURIComponent(index)}/_mapping`);
  const actualMapping = actual[index]?.mappings;
  const settingsResponse = await client(`/${encodeURIComponent(index)}/_settings?include_defaults=false`);
  const actualSettings = Object.fromEntries(Object.entries(settingsResponse[index]?.settings?.index || {}).filter(([key]) => ['analysis','similarity','sort','max_ngram_diff','max_shingle_diff'].includes(key)));
  if (!actualMapping) throw new Error('ES capture mapping response must identify the exact concrete index');
  // Nested mapping correlation needs nested queries; fail closed rather than silently under-fetch.
  const nested = value => value && typeof value === 'object' && (value.type === 'nested' || Object.values(value).some(nested));
  if (nested(actualMapping)) throw new Error('ES nested mappings require a reviewed nested-query adapter; native fixture capture supports object/scalar mappings');
  const opened = await client(`/${encodeURIComponent(index)}/_pit?keep_alive=1m`, { method: 'POST' });
  if (!opened.id) throw new Error('ES server did not provide a point-in-time id');
  let pit = opened.id;
  try {
    const response = await client('/_search', { method: 'POST', body: { pit: { id: pit, keep_alive: '1m' }, query: queryFor(matches, rows), size: maxDocuments + 1, sort: ['_shard_doc'], track_total_hits: true, seq_no_primary_term: true } });
    pit = response.pit_id || pit;
    const total = response.hits?.total?.value ?? response.hits?.total;
    if (!Number.isInteger(total) || response.hits?.total?.relation === 'gte') throw new Error('ES exact hit count was not provided');
    const documents = (response.hits?.hits || []).slice(0, maxDocuments).map(hit => ({ _id: hit._id, _index: index, _source: hit._source, _seq_no: hit._seq_no, _primary_term: hit._primary_term }));
    require('./reproduction').exactNumbers(documents, `ES ${index}`);
    return { documents, mapping: actualMapping, settings:actualSettings, truncated: total > maxDocuments, observation: { version: 1, adapter: 'elasticsearch-pit/v1', pointInTimeVerified: true, pitFingerprint: hash(pit), startedAt, finishedAt: new Date().toISOString(), exactTotal: total, mappingFingerprint: hash(actualMapping), reviewedMappingFingerprint: hash(mapping), settingsFingerprint:hash(actualSettings), reviewedSettingsFingerprint:hash(settings) } };
  } finally { await client('/_pit', { method: 'DELETE', body: { id: pit } }); }
}
module.exports = { queryFor, capture };
