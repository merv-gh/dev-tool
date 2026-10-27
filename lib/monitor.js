// Whole-environment views in a handful of requests: Consul health of every service in one
// call, ES cluster + index health in two, Kafka consumer lag in one (via kafka-ui).
const { getEnv, endpoint } = require('./config');
const { http } = require('./util');

const dcCache = {};
async function consulDc(env) {
  if (!dcCache[env]) {
    const self = await http(`${endpoint(env, 'consul')}/v1/agent/self`).catch(() => null);
    dcCache[env] = self?.Config?.Datacenter || 'dc1';
  }
  return dcCache[env];
}

const worst = (a, b) => (['critical', 'warning', 'passing'].indexOf(a) <= ['critical', 'warning', 'passing'].indexOf(b) ? a : b);

async function health(env) {
  const base = endpoint(env, 'consul');
  const [checks, catalog, dc] = await Promise.all([
    http(`${base}/v1/health/state/any`),
    http(`${base}/v1/catalog/services`),
    consulDc(env),
  ]);
  // Node checks (serfHealth etc.) apply to every service instance on that node.
  const nodeState = {};
  const nodeWhy = {};
  for (const c of checks) {
    if (c.ServiceName) continue;
    nodeState[c.Node] = worst(c.Status, nodeState[c.Node] || 'passing');
    if (c.Status !== 'passing') nodeWhy[c.Node] = `${c.Node}: node ${c.Name}: ${(c.Output || '').trim().slice(0, 200)}`;
  }

  const svc = {};
  for (const name of Object.keys(catalog)) svc[name] = { instances: {}, failing: [] };
  for (const c of checks) {
    if (!c.ServiceName) continue;
    const s = (svc[c.ServiceName] ??= { instances: {}, failing: [] });
    const key = `${c.Node}/${c.ServiceID}`;
    s.instances[key] = worst(c.Status, worst(s.instances[key] || 'passing', nodeState[c.Node] || 'passing'));
    if (c.Status !== 'passing') s.failing.push(`${c.Node}: ${c.Name}: ${(c.Output || '').trim().slice(0, 200)}`);
    if (nodeWhy[c.Node] && !s.failing.includes(nodeWhy[c.Node])) s.failing.push(nodeWhy[c.Node]);
  }

  const ui = `${base}/ui/${dc}/services`;
  const rows = Object.entries(svc).map(([service, s]) => {
    const states = Object.values(s.instances);
    const n = states.length;
    const passing = states.filter(x => x === 'passing').length;
    const critical = states.filter(x => x === 'critical').length;
    const status = n === 0 ? 'no checks' : passing === n ? 'healthy' : critical === n ? 'down' : 'degraded';
    return { status, service, instances: n, passing, warning: n - passing - critical, critical, failing: s.failing.slice(0, 5).join(' | ') || null, link: `${ui}/${encodeURIComponent(service)}/instances` };
  }).sort((a, b) => ['down', 'degraded', 'no checks', 'healthy'].indexOf(a.status) - ['down', 'degraded', 'no checks', 'healthy'].indexOf(b.status) || a.service.localeCompare(b.service));

  const count = (st) => rows.filter(r => r.status === st).length;
  return {
    summary: { services: rows.length, healthy: count('healthy'), degraded: count('degraded'), down: count('down'), noChecks: count('no checks') },
    rows,
  };
}

async function esHealth(env) {
  const es = require('./es').client(env);
  const [cluster, indices] = await Promise.all([
    es('/_cluster/health'),
    es('/_cat/indices?format=json&h=index,health,status,docs.count,store.size,pri,rep'),
  ]);
  const rows = indices.filter(i => !i.index.startsWith('.') && i.health !== 'green')
    .map(i => ({ health: i.health, index: i.index, status: i.status, docs: Number(i['docs.count'] || 0), size: i['store.size'], primaries: i.pri, replicas: i.rep }))
    .sort((a, b) => (a.health === 'red' ? -1 : 0) - (b.health === 'red' ? -1 : 0));
  return {
    summary: {
      cluster: cluster.cluster_name, status: cluster.status, nodes: cluster.number_of_nodes,
      unassignedShards: cluster.unassigned_shards, indices: indices.length, notGreen: rows.length,
    },
    rows,
  };
}

async function kafkaLag(env, { top = 100 } = {}) {
  const kafka = require('./kafka');
  const base = endpoint(env, 'kafkaUi');
  const cluster = await kafka.cluster(env);
  const res = await http(`${base}/api/clusters/${cluster}/consumer-groups/paged?page=1&perPage=${top}&orderBy=MESSAGES_BEHIND&sortOrder=DESC`, { timeout: 60000 });
  const groups = res.consumerGroups || res.groups || [];
  const rows = groups.map(g => ({
    group: g.groupId,
    lag: g.messagesBehind ?? g.consumerLag ?? null,
    state: g.state,
    members: g.members,
    topics: g.topics,
    link: `${base}/ui/clusters/${cluster}/consumer-groups/${encodeURIComponent(g.groupId)}`,
  }));
  return {
    summary: { cluster, groups: rows.length, lagging: rows.filter(r => r.lag > 0).length, maxLag: Math.max(0, ...rows.map(r => r.lag || 0)), notStable: rows.filter(r => r.state && r.state !== 'STABLE').length },
    rows,
  };
}

module.exports = { health, esHealth, kafkaLag };
