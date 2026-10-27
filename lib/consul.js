const path = require('path');
const { getEnv } = require('./config');
const { CACHE, http, pool, writeJson } = require('./util');

function base(envName) {
  const url = getEnv(envName).consul;
  if (!url) throw new Error(`Consul URL not set for ${envName}`);
  return url.replace(/\/$/, '');
}

async function instances(envName, service) {
  const nodes = await http(`${base(envName)}/v1/health/service/${encodeURIComponent(service)}`);
  return nodes.map(n => {
    const checks = n.Checks || [];
    const status = checks.some(c => c.Status === 'critical') ? 'critical'
      : checks.some(c => c.Status === 'warning') ? 'warning' : 'passing';
    return { address: n.Service.Address || n.Node.Address, port: n.Service.Port, node: n.Node.Node, status, tags: n.Service.Tags, meta: n.Service.Meta };
  });
}

// Fuzzy: exact name, else the single service containing the text.
async function service(envName, name, { version = true } = {}) {
  const all = Object.keys(await http(`${base(envName)}/v1/catalog/services`));
  const matches = all.includes(name) ? [name] : all.filter(s => s.includes(name));
  if (matches.length !== 1) return { query: name, matches };
  const list = await instances(envName, matches[0]);
  if (version) {
    await pool(list.filter(i => i.status === 'passing'), 10, async (i) => {
      try { i.version = await http(`http://${i.address}:${i.port}/version`, { timeout: 3000, raw: true }).then(t => t.slice(0, 500)); }
      catch (e) { i.version = null; }
    });
  }
  return { service: matches[0], instances: list };
}

async function sync(envName, { log = console.error } = {}) {
  const started = Date.now();
  const catalog = await http(`${base(envName)}/v1/catalog/services`);
  const res = await pool(Object.keys(catalog), 10, s => instances(envName, s));
  const services = {};
  for (const r of res) services[r.item] = r.error ? { error: r.error.message } : { tags: catalog[r.item], instances: r.value };
  writeJson(path.join(CACHE, envName, 'consul.json'), { syncedAt: new Date().toISOString(), services });
  log(`consul: ${res.length} services, ${Date.now() - started}ms`);
  return { services: res.length, ms: Date.now() - started };
}

module.exports = { service, instances, sync };
