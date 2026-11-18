// Offline navigation for the API client. Never probes a replica or sends HTTP.
const path = require('node:path');
const C = require('./config'), { readJson } = require('./util');
function target(instance) {
  const address = String(instance.address || ''), port = Number(instance.port);
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535 || /[\s/@?#]/.test(address)) return null;
  const scheme = instance.meta?.scheme === 'https' || instance.meta?.protocol === 'https' ? 'https' : 'http';
  try {
    const url = new URL(`${scheme}://${address.includes(':') && !address.startsWith('[') ? '[' + address + ']' : address}:${port}`);
    return { url: url.origin, id: String(instance.id || ''), status: instance.status || 'unknown', node: instance.node || '', source: 'consul' };
  } catch { return null; }
}
function catalog({ env, q = '', group, offset = 0, limit = 100 } = {}) {
  env ||= C.envNames()[0]; C.getEnv(env); // includes principal/environment authorization
  const snapshot = readJson(path.join(C.PATHS.cache, env, 'consul.json'));
  const groups = new Map(), warnings = [];
  const ensure = (key, name, service = '') => {
    if (!groups.has(key)) groups.set(key, { key, name, service, routes: [], targets: [], observedAt: null, stale: false });
    return groups.get(key);
  };
  for (const p of require('./passport').list({ manual: false })) ensure('service:' + p.service, p.service, p.service);
  for (const [name, service] of Object.entries(snapshot?.services || {})) {
    const g = ensure('service:' + name, name, name);
    g.targets = (service.instances || []).map(target).filter(Boolean).sort((a,b) => (a.status !== 'passing') - (b.status !== 'passing') || a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
    g.observedAt = service.observedAt || snapshot.syncedAt || null;
    g.stale = !!service.stale || !!service.error;
  }
  let routes;
  try { routes = require('./routes').list({ env, includeDeclared: true }); }
  catch (e) { routes = []; warnings.push({ source: 'routes', message: e.message }); }
  const observed = require('./routes').load().routes || {}, byRoute = new Map();
  for (const route of routes) {
    const key = route.service ? 'service:' + route.service : route.host ? 'host:' + route.host : 'unattributed';
    const g = ensure(key, route.service || route.host || 'Unattributed routes', route.service);
    const saved = observed[`${route.host} ${route.method} ${route.path}`];
    let origin;
    try { const url = new URL(saved?.example); if (/^https?:$/.test(url.protocol)) origin = url.origin; } catch {}
    if (origin && !g.targets.some(t => t.url === origin)) g.targets.push({ url: origin, source: 'observed', status: 'observed' });
    const identity = JSON.stringify([key, route.method, route.path]), prior = byRoute.get(identity);
    if (prior) {
      if (route.host && !prior.hosts.includes(route.host)) prior.hosts.push(route.host);
      if (origin && !prior.origins.includes(origin)) prior.origins.push(origin);
      prior.seen += route.seen || 0;
    } else {
      const item = { ...route, hosts: route.host ? [route.host] : [], origins: origin ? [origin] : [], ...(origin ? { origin } : {}) };
      byRoute.set(identity, item); g.routes.push(item);
    }
  }
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = text => words.every(w => text.toLowerCase().includes(w));
  const all = [...groups.values()].sort((a,b) => a.name.localeCompare(b.name));
  for (const g of all) {
    g.totalRoutes = g.routes.length;
    g.routes = g.routes.filter(r => matches(`${g.name} ${r.method} ${r.path} ${r.handler} ${r.hosts.join(' ')}`));
  }
  const selected = all.find(g => g.key === group), rows = selected?.routes || [];
  offset = Math.max(0, Math.floor(Number(offset) || 0)); limit = Math.max(1, Math.min(250, Math.floor(Number(limit) || 100)));
  return {
    env, environments: C.envNames(), consul: { indexed: !!snapshot, observedAt: snapshot?.syncedAt || null }, warnings,
    services: all.filter(g => !words.length || g.routes.length || matches(g.name)).map(({ routes, ...g }) => ({ ...g, routeCount: routes.length })),
    routes: rows.slice(offset, offset + limit), total: rows.length, offset,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
  };
}
module.exports = { catalog, target };
