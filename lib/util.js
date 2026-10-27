const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const CACHE = process.env.DT_CACHE_DIR || path.join(ROOT, 'cache');

// Run fn over items with at most n in flight; never throws, returns [{item, value|error}].
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { item: items[i], value: await fn(items[i], i) }; }
      catch (error) { out[i] = { item: items[i], error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function http(url, { method = 'GET', body, headers = {}, auth, timeout = 30000, raw = false } = {}) {
  const h = { ...headers };
  if (auth && auth.user) h.authorization = 'Basic ' + Buffer.from(`${auth.user}:${auth.pass || ''}`).toString('base64');
  if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); h['content-type'] ??= 'application/json'; }
  let res;
  try {
    res = await fetch(url, { method, body, headers: h, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    // "fetch failed" alone hides the reason (ECONNREFUSED, EHOSTUNREACH, ETIMEDOUT, ...)
    const c = e.cause;
    throw new Error(`${method} ${url} -> ${e.name === 'TimeoutError' ? `timeout ${timeout}ms` : (c && (c.code || c.message)) || e.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  if (raw) return text;
  try { return JSON.parse(text); } catch { throw new Error(`${method} ${url} -> not JSON: ${text.slice(0, 200)}`); }
}

// {a:{b:1}, c:[{d:2}]} -> {"a.b":"number", "c[].d":"number"}
function flattenTypes(obj, prefix = '', out = {}) {
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] !== null && typeof obj[0] === 'object') flattenTypes(obj[0], prefix + '[]', out);
    else out[prefix] = 'array';
  } else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flattenTypes(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = obj === null ? 'null' : typeof obj;
  }
  return out;
}

// Only objects/arrays: a key like "007" or a 19-digit id must stay a string.
function tryJson(s) {
  if (typeof s !== 'string' || !/^\s*[[{]/.test(s)) return s;
  try { return JSON.parse(s); } catch { return s; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// File-name-safe version of a topic/index name
const safeName = (s) => s.replace(/[^\w.@-]/g, '_');

function table(rows) {
  if (!rows.length) return '(0 rows)';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  };
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => cell(r[c]).length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(w[i])).join(' | ');
  return [line(cols), w.map(n => '-'.repeat(n)).join('-+-'), ...rows.map(r => line(cols.map(c => cell(r[c]))))].join('\n');
}

module.exports = { CACHE, pool, http, flattenTypes, tryJson, writeJson, readJson, safeName, table };
