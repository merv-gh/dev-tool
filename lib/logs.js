// ELK log search: hits + a timeline histogram split by level + level/service facets, and
// trace view (every line of one trace id across services, in time order).
const { getEnv } = require('./config');
const { http } = require('./util');

function client(envName) {
  const L = getEnv(envName).logs;
  if (!L || !L.hosts.length) throw new Error(`Logs not configured for ${envName}: set LOGS_ES_HOSTS (or ELASTICSEARCH_HOSTS) in ${getEnv(envName).envFile}`);
  const auth = L.user ? { user: L.user, pass: L.pass } : undefined;
  return async (p, opts = {}) => {
    let last;
    for (const host of L.hosts) {
      try { return await http(host.replace(/\/$/, '') + p, { auth, timeout: 60000, ...opts }); }
      catch (e) { last = e; if (!/ECONN|EHOST|ENOTFOUND|timeout|UND_ERR/i.test(e.message)) throw e; }
    }
    throw last;
  };
}

// "15m" | "2h" | "7d" | ISO date -> ES date math / ISO, and the window length in ms
const UNIT = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
function parseRange(from = '15m', to = 'now') {
  const rel = (x) => { const m = String(x).match(/^(?:now-)?(\d+)([smhdw])$/); return m && { math: `now-${m[1]}${m[2]}`, ms: Number(m[1]) * UNIT[m[2]] }; };
  const f = rel(from);
  const toIso = to === 'now' ? null : new Date(to);
  const end = toIso ? toIso.getTime() : Date.now();
  const start = f ? end - f.ms : new Date(from).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Bad time range from=${from} to=${to}; use e.g. 15m, 2h, 1d or ISO dates`);
  return { gte: f && !toIso ? f.math : new Date(start).toISOString(), lte: toIso ? toIso.toISOString() : 'now', start, end };
}

const INTERVALS = ['1s', '5s', '10s', '30s', '1m', '5m', '10m', '30m', '1h', '3h', '12h', '1d'];
function interval(ms, buckets = 60) {
  for (const i of INTERVALS) if (ms / (parseInt(i) * UNIT[i.slice(-1)]) <= buckets) return i;
  return '1d';
}

function buildQuery(f, { query, service, level, traceId, range }) {
  const must = [];
  const filter = [{ range: { [f.time]: { gte: range.gte, lte: range.lte } } }];
  if (query) must.push({ query_string: { query, default_operator: 'AND', analyze_wildcard: true, default_field: '*' } });
  if (service) filter.push({ bool: { should: [].concat(service).map(s => ({ match_phrase: { [f.service]: s } })), minimum_should_match: 1 } });
  if (level) filter.push({ bool: { should: [].concat(level).flatMap(l => [{ match_phrase: { [f.level]: l } }, { match_phrase: { [f.level]: String(l).toUpperCase() } }]), minimum_should_match: 1 } });
  if (traceId) filter.push({ match_phrase: { [f.trace]: traceId } });
  return { bool: { must, filter } };
}

// Value at a dotted path, whether the source is nested ({a:{b:1}}) or flat ({"a.b":1}).
function pick(src, p) {
  if (!src || !p) return undefined;
  if (p in src) return src[p];
  let cur = src;
  const parts = p.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    const rest = parts.slice(i).join('.');
    if (rest in cur) return cur[rest];
    cur = cur[parts[i]];
  }
  return cur;
}

function normalize(f, hit) {
  const s = hit._source || {};
  const msg = pick(s, f.message);
  return {
    time: pick(s, f.time) ?? null,
    level: String(pick(s, f.level) ?? '').toUpperCase() || null,
    service: pick(s, f.service) ?? null,
    message: typeof msg === 'string' ? msg.slice(0, 4000) : msg == null ? null : JSON.stringify(msg).slice(0, 4000),
    trace: pick(s, f.trace) ?? null,
    _index: hit._index,
    _id: hit._id,
    source: s,
  };
}

// Facets are a separate request: terms on a text field fails, then we retry with .keyword.
async function facets(es, index, f, q, range, fixed) {
  const body = (sfx) => ({
    size: 0, query: q,
    aggs: {
      levels: { terms: { field: f.level + sfx, size: 10 } },
      services: { terms: { field: f.service + sfx, size: 30 } },
      timeline: { date_histogram: { field: f.time, fixed_interval: fixed, min_doc_count: 0, extended_bounds: { min: range.start, max: range.end } },
        aggs: { level: { terms: { field: f.level + sfx, size: 6 } } } },
    },
  });
  for (const sfx of ['', '.keyword']) {
    try {
      const r = await es(`/${encodeURIComponent(index)}/_search`, { method: 'POST', body: body(sfx) });
      return {
        levels: r.aggregations.levels.buckets.map(b => ({ key: String(b.key).toUpperCase(), count: b.doc_count })),
        services: r.aggregations.services.buckets.map(b => ({ key: b.key, count: b.doc_count })),
        timeline: r.aggregations.timeline.buckets.map(b => ({ t: b.key, total: b.doc_count, levels: Object.fromEntries(b.level.buckets.map(x => [String(x.key).toUpperCase(), x.doc_count])) })),
      };
    } catch {}
  }
  return null;
}

function kibanaLink(L, { query, service, level, traceId, range }) {
  if (!L.kibana) return null;
  const parts = [query, service && `${L.fields.service}:"${service}"`, level && `${L.fields.level}:${level}`, traceId && `${L.fields.trace}:"${traceId}"`].filter(Boolean);
  const q = parts.join(' AND ').replace(/'/g, "!'");
  const time = `from:'${new Date(range.start).toISOString()}',to:'${new Date(range.end).toISOString()}'`;
  return `${L.kibana}/app/discover#/?_g=(time:(${time}))&_a=(query:(language:lucene,query:'${encodeURIComponent(q)}'))`;
}

async function search(envName, opts = {}) {
  const L = getEnv(envName).logs;
  const es = client(envName);
  const f = L.fields;
  const index = opts.index || L.index;
  const range = parseRange(opts.from, opts.to);
  const fixed = interval(range.end - range.start);
  const q = buildQuery(f, { ...opts, range });
  const size = Math.min(opts.size || 200, 2000);
  const started = Date.now();
  const [res, fac] = await Promise.all([
    es(`/${encodeURIComponent(index)}/_search`, { method: 'POST', body: {
      size, track_total_hits: true, query: q,
      sort: [{ [f.time]: { order: opts.order || 'desc', unmapped_type: 'date' } }],
      aggs: { timeline: { date_histogram: { field: f.time, fixed_interval: fixed, min_doc_count: 0, extended_bounds: { min: range.start, max: range.end } } } },
    } }),
    opts.facets === false ? null : facets(es, index, f, q, range, fixed),
  ]);
  const rows = res.hits.hits.map(h => normalize(f, h));
  const timeline = fac?.timeline || (res.aggregations?.timeline?.buckets || []).map(b => ({ t: b.key, total: b.doc_count, levels: {} }));
  return {
    total: res.hits.total?.value ?? res.hits.total,
    ms: Date.now() - started,
    index, interval: fixed,
    range: { from: new Date(range.start).toISOString(), to: new Date(range.end).toISOString() },
    levels: fac?.levels || [],
    services: fac?.services || [],
    timeline,
    fields: f,
    kibana: kibanaLink(L, { ...opts, range }),
    rows,
  };
}

async function trace(envName, traceId, { from = '24h', size = 1000 } = {}) {
  const r = await search(envName, { traceId, from, size, order: 'asc', facets: false });
  const svc = new Map();
  for (const row of r.rows) {
    const s = svc.get(row.service) || { service: row.service, first: row.time, last: row.time, lines: 0, errors: 0 };
    s.last = row.time; s.lines++;
    if (/ERROR|FATAL/.test(row.level || '')) s.errors++;
    svc.set(row.service, s);
  }
  return { ...r, traceId, hops: [...svc.values()] };
}

module.exports = { search, trace, parseRange, interval, buildQuery, normalize, pick };
