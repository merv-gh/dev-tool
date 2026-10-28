// API routes: what each service exposes (passports: Spring mappings in code) merged with what was
// seen on the wire (browser network requests: from saved scripts / routes_discover run by dt, or
// pasted by the model from the chat browser's browser_network_requests). Observed URLs are
// normalized to patterns (ids -> <id>) and matched to code endpoints, so "GET /api/orders/<id>"
// on the shop host is attributed to order-service's OrderController.get.
//   cache/routes.json  { routes: { "<host> <METHOD> <path>": { host, method, path, query, statuses, count, first, last, sources, example } } }
const path = require('path');
const { CACHE, readJson, writeJson } = require('./util');

const FILE = path.join(CACHE, 'routes.json');
const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const STATIC = /\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp4|webm|html?)$/i;

// One path segment -> "<id>" when it looks like a value rather than a name.
function idLike(seg) {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{12,}$/i.test(seg) && /\d/.test(seg)) return true;
  if (seg.length >= 16 && /\d/.test(seg) && /[a-z]/i.test(seg) && !/[-_.]/.test(seg)) return true; // opaque tokens
  if (/^[A-Z]{2,5}-?\d{3,}$/.test(seg)) return true; // ORD-12345
  return false;
}

function normalize(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || STATIC.test(u.pathname)) return null;
  const segs = u.pathname.split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  return { host: u.host, path: segs.map(s => (s && idLike(s) ? '<id>' : s)).join('/') || '/', query: [...new Set(u.searchParams.keys())].sort() };
}

// Text of Playwright MCP's browser_network_requests (or any list with "METHOD URL ... status").
function parseNetwork(text) {
  const out = [];
  const re = new RegExp(`\\b(${METHODS})\\b\\]?\\s+(https?://\\S+?)(?=[\\s\\]]|$)([^\\n]*)`, 'g');
  for (const m of String(text).matchAll(re)) {
    const status = (m[3].match(/\b([1-5]\d\d)\b/) || [])[1];
    out.push({ method: m[1], url: m[2].replace(/[),;]+$/, ''), status: status ? Number(status) : null });
  }
  return out;
}

const load = () => readJson(FILE, { routes: {} });

function learn(entries, source) {
  const db = load();
  const now = new Date().toISOString();
  let added = 0, seen = 0;
  for (const e of entries) {
    const n = normalize(e.url);
    if (!n) continue;
    const method = String(e.method || 'GET').toUpperCase();
    const key = `${n.host} ${method} ${n.path}`;
    let r = db.routes[key];
    if (!r) { r = db.routes[key] = { host: n.host, method, path: n.path, query: [], statuses: {}, count: 0, first: now, sources: [], example: e.url.slice(0, 300) }; added++; }
    r.query = [...new Set([...r.query, ...n.query])].sort();
    if (e.status) r.statuses[e.status] = (r.statuses[e.status] || 0) + 1;
    r.count++; r.last = now; seen++;
    if (source && !r.sources.includes(source)) r.sources = [...r.sources, source].slice(-5);
  }
  writeJson(FILE, db);
  if (added) try { for (const env of require('./config').envNames()) require('./catalog').build(env); } catch {} // find "api:" sees them
  return { requests: entries.length, api: seen, added, total: Object.keys(db.routes).length };
}

// Code endpoints from passports, as matchers: "/orders/{id}" matches ".../orders/<id>" (a gateway may add a prefix).
function codeEndpoints() {
  const P = require('./passport');
  const out = [];
  for (const s of P.list()) {
    const p = P.load(s.service);
    for (const e of p?.effective?.endpoints || []) {
      const segs = String(e.path || '').split('/').filter(Boolean);
      const re = new RegExp(`(^|/)${segs.map(x => (/^\{.*\}$/.test(x) ? '[^/]+' : x.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))).join('/')}/?$`, 'i');
      out.push({ service: p.service, method: String(e.method || '').toUpperCase(), path: e.path, handler: e.handler || '', where: e.file ? `${e.file}:${e.line}` : '', source: e.source || '', re, weight: segs.length });
    }
  }
  return out;
}

const siteOf = (host) => require('./config').getBrowser().sites.find(s => { try { return new URL(s.url).host === host; } catch { return false; } })?.site || '';

// Keep ambiguity when a gateway path matches more than one service. Consumers may attach further
// host/service evidence, but the shared path alone must never select an arbitrary handler.
function resolve(url, method = 'GET') {
  return resolver()(url, method);
}
// Compile cached passport paths once for a capture batch, rather than rereading every passport
// for every request in a large microservice environment.
function resolver() {
  const code = codeEndpoints();
  return (url, method = 'GET') => {
  const route = normalize(url);
  if (!route) return { status: 'unknown', candidates: [] };
  const matches = code.filter(c => (!c.method || c.method === 'ANY' || c.method === String(method).toUpperCase()) && c.re.test(route.path)).sort((a, b) => b.weight - a.weight);
  const candidates = matches.filter(c => c.weight === matches[0]?.weight).map(({ re, weight, ...c }) => c);
  return { ...route, method: String(method).toUpperCase(), site: siteOf(route.host), status: candidates.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : 'observed', candidates };
  };
}

// Merged list: code endpoints (with how often they were seen) + observed routes not in code.
function list({ q, service, host } = {}) {
  const code = codeEndpoints();
  const rows = [];
  const seenFor = new Map();
  for (const r of Object.values(load().routes)) {
    const m = code.filter(c => (!c.method || c.method === r.method || c.method === 'ANY') && c.re.test(r.path)).sort((a, b) => b.weight - a.weight)[0];
    const row = { service: m?.service || '', method: r.method, path: r.path, host: r.host, site: siteOf(r.host), seen: r.count, statuses: Object.entries(r.statuses).map(([k, n]) => `${k}×${n}`).join(' '), query: r.query.join(','), handler: m?.handler || '', where: m?.where || '', source: r.sources.join(', '), last: r.last };
    if (m) { const k = `${m.service} ${m.method} ${m.path}`; seenFor.set(k, [...(seenFor.get(k) || []), row]); }
    rows.push(row);
  }
  for (const c of code) {
    if (seenFor.has(`${c.service} ${c.method} ${c.path}`)) continue;
    rows.push({ service: c.service, method: c.method, path: c.path, host: '', site: '', seen: 0, statuses: '', query: '', handler: c.handler, where: c.where, source: c.source ? `code (${c.source})` : 'code', last: '' });
  }
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return rows
    .filter(r => (!service || r.service === service) && (!host || r.host === host || r.site === host))
    .filter(r => words.every(w => `${r.service} ${r.method} ${r.path} ${r.host} ${r.site} ${r.handler}`.toLowerCase().includes(w)))
    .sort((a, b) => a.service.localeCompare(b.service) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// catalog.txt lines for find ("api:" prefix): code endpoints and observed routes.
function catalogLines() {
  return list().map(r => `api ${r.service || r.site || r.host} ${r.method} ${r.path}${r.query ? `?${r.query}` : ''} [${r.seen ? `seen ${r.seen}${r.statuses ? ` ${r.statuses}` : ''}` : 'code'}]${r.host ? ` ${r.host}` : ''}${r.handler ? ` -> ${r.handler}` : ''}`);
}

module.exports = { normalize, parseNetwork, learn, list, load, catalogLines, idLike, resolve, resolver, FILE };
