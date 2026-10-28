// Flows of a service through its code and its libraries' code: each entry point (HTTP endpoint, Kafka
// listener, @Scheduled job, event listener; the service's own or a library's, e.g. a controller of a
// starter that calls a handler interface the service implements) with
//   chain       the methods it reaches, through calls and interface dispatch into implementations
//   out         what leaves the service: topics produced, HTTP calls (Feign, RestTemplate, WebClient),
//               tables read and written (SQL, repositories), database functions, ES indices
//   beans       the Spring beans on the chain: the real ones in an isolated flow test
//   mocks       their dependencies that are not on the chain: repositories, clients, KafkaTemplate,
//               other beans; the mocks of that test
//   properties  @Value keys the beans need, with the service's values
// keys: code indexes (the service and its libraries); config: the service's merged Spring config.
const X = require('./passport/extract');

const ENTRY_ANNOS = { Scheduled: 'scheduled', EventListener: 'event', TransactionalEventListener: 'event', RabbitListener: 'queue', JmsListener: 'queue', SqsListener: 'queue' };
const EXT = [
  [/kafka\.core\.KafkaTemplate|StreamBridge|KafkaProducer|ReactiveKafkaProducerTemplate/, 'kafka'],
  [/RestTemplate|WebClient|RestClient|HttpClient|OkHttpClient|feign\./, 'http'],
  [/JdbcTemplate|JdbcClient|EntityManager|DataSource|JdbcOperations|MongoTemplate|R2dbcEntityTemplate/, 'db'],
  [/ElasticsearchOperations|ElasticsearchClient|RestHighLevelClient/, 'es'],
  [/RabbitTemplate|JmsTemplate|AmqpTemplate|SqsTemplate/, 'queue'],
  [/RedisTemplate|StringRedisTemplate|CacheManager/, 'cache'],
  [/ApplicationEventPublisher/, 'event'],
];
const SKIP_TYPES = /^(String|int|long|boolean|Integer|Long|Boolean|double|Double|Duration|BigDecimal)$/;
const base = (t) => String(t || '').replace(/<[\s\S]*$/, '').trim();
const elem = (t) => (String(t).match(/^(?:java\.util\.)?(?:List|Set|Collection|Iterable|Optional|ObjectProvider|Provider)\s*<\s*(?:\?\s*extends\s+)?([\w$.]+)/) || [])[1];

function flows(keys, { config = {}, maxDepth = 14 } = {}) {
  const G = require('./impact').load({ repos: keys });
  const unresolved = new Set();
  const resolve = X.resolver(config, unresolved);
  const own = (id) => (id && id.startsWith('ext:') && G.classes.has(id.slice(4)) ? id.slice(4) : id);
  const cls = (methodId) => G.classes.get(methodId.split('#')[0]);
  // entries
  const entries = [];
  for (const [from, list] of G.fwd) {
    for (const e of list) {
      if (e.kind === 'handler' && from.startsWith('endpoint:')) entries.push({ entry: from.slice(9), kind: 'http', method: e.to });
      if (e.kind === 'consumes') entries.push({ entry: `kafka ${resolve(e.to.slice(6))}`, kind: 'kafka', method: from, topic: resolve(e.to.slice(6)) });
    }
  }
  for (const c of G.classes.values()) {
    if (c.test) continue;
    for (const m of c.methods) for (const a of m.annos || []) if (ENTRY_ANNOS[a]) entries.push({ entry: `${ENTRY_ANNOS[a]} ${c.name}#${m.name}`, kind: ENTRY_ANNOS[a], method: `${c.id}#${m.name}` });
  }
  const seenEntry = new Set();
  return entries.filter(e => { const k = `${e.entry}|${e.method}`; if (seenEntry.has(k)) return false; seenEntry.add(k); return true; })
    .map(e => ({ ...e, ...walk(G, e.method, { resolve, own, cls, maxDepth, config }) }));
}

// One entry: the chain, what leaves, beans, mocks, properties
function walk(G, start, { resolve, own, cls, maxDepth = 14 }) {
  const depth = new Map([[start, 0]]);
  const order = [start];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (depth.get(id) >= maxDepth) continue;
    for (const e of G.fwd.get(id) || []) {
      if (e.kind !== 'calls' && e.kind !== 'dispatch') continue;
      const to = own(e.to);
      if (!to.includes('#') || to.startsWith('ext:') || depth.has(to) || !cls(to)) continue;
      depth.set(to, depth.get(id) + 1);
      order.push(to);
    }
  }
  const out = { produces: [], http: [], tables: [], functions: [], es: [], external: [] };
  const push = (list, v) => { if (!list.some(x => JSON.stringify(x) === JSON.stringify(v))) list.push(v); };
  // one entry per table and access, with every place that does it
  const table = (v) => { const x = out.tables.find(t => t.table === v.table && t.access === v.access); if (x) { if (v.at && !x.at.includes(v.at)) x.at.push(v.at); if (v.via && !x.via.includes(v.via)) x.via.push(v.via); } else out.tables.push({ table: v.table, access: v.access, via: v.via ? [v.via] : [], at: v.at ? [v.at] : [] }); };
  for (const m of order) {
    for (const e of G.fwd.get(m) || []) {
      const to = own(e.to);
      if (to.startsWith('table:')) table({ table: to.slice(6), access: e.kind, at: e.where });
      else if (to.startsWith('pgfn:')) push(out.functions, { function: to.slice(5), at: e.where });
      else if (to.startsWith('es:')) push(out.es, { index: resolve(to.slice(3)), at: e.where });
      else if (to.startsWith('endpoint:')) push(out.http, { call: to.slice(9), via: m.split('.').pop(), at: e.where });
      else if (e.kind === 'calls' && to.startsWith('ext:')) {
        const t = to.slice(4).replace(/#.*$/, ''), kind = (EXT.find(([re]) => re.test(t)) || [])[1];
        if (kind) push(out.external, { kind, type: t.split('.').pop(), call: to.split('#')[1], arity: e.arity, from: m.split('.').pop(), at: e.where });
      } else if (e.kind === 'calls' && cls(to)?.role === 'repository') {
        // a Spring Data repository: the table of its entity
        const repo = cls(to);
        for (const r of G.fwd.get(repo.id) || []) if (r.kind === 'repository') {
          const ent = G.classes.get(own(r.to));
          if (ent?.table) table({ table: ent.table, access: /^(save|delete|update|insert|persist|remove)/i.test(to.split('#')[1]) ? 'write' : 'read', via: `${repo.name}.${to.split('#')[1]}`, at: e.where });
        }
      }
    }
    for (const e of G.rev.get(m) || []) if (e.kind === 'produced-by') push(out.produces, { topic: resolve(e.from.slice(6)), raw: e.from.slice(6) !== resolve(e.from.slice(6)) ? e.from.slice(6) : undefined, from: m.split('.').pop(), at: e.where });
  }
  // beans on the chain, and what they need
  const beans = [];
  // concrete Spring beans: interfaces (Spring Data repositories, Feign clients) are at the edge
  for (const m of order) { const c = cls(m); if (c && c.kind === 'class' && (c.bean || c.role === 'controller' || c.role === 'listener') && !beans.some(b => b.id === c.id)) beans.push(c); }
  const beanIds = new Set(beans.map(b => b.id));
  const implemented = (typeId) => beans.some(b => (b.impl || []).map(own).includes(typeId) || (b.ext || []).map(own).includes(typeId));
  const mocks = [], properties = [];
  for (const b of beans) {
    const deps = [...(b.bean ? b.ctor || [] : []), ...(b.fields || []).filter(f => f.inject)];
    for (const d of deps) {
      if (d.value) {
        if (!properties.some(p => p.key === d.value)) { const v = resolve(`\${${d.value}}`); properties.push({ key: d.value, value: v === `\${${d.value}}` ? null : v, hasDefault: !!d.valueDefault, bean: b.name }); }
        continue;
      }
      if (SKIP_TYPES.test(base(d.type))) continue;
      const tid = own(d.typeId);
      const el = elem(d.type);
      if (el) { continue; } // collections of beans: Spring injects the implementations on the chain
      if (tid && (beanIds.has(tid) || implemented(tid))) continue;
      const dc = tid && G.classes.get(tid);
      const why = dc ? (dc.role === 'repository' ? 'repository (database)' : dc.role === 'feign' ? 'Feign client (HTTP)' : dc.kind === 'interface' ? 'interface with no implementation on this flow' : 'bean not on this flow') : `external (${(EXT.find(([re]) => re.test(String(tid || d.type))) || [, 'library'])[1]})`;
      if (!mocks.some(x => base(x.type) === base(d.type))) mocks.push({ type: d.type, typeId: tid || null, name: d.name, why, for: b.name });
    }
  }
  const chain = order.map(m => ({ method: m, depth: depth.get(m), repo: G.nodes.get(m)?.repo || cls(m)?.repo, at: G.nodes.get(m) ? `${G.nodes.get(m).file}:${G.nodes.get(m).line}` : null }));
  return { chain, out, beans: beans.map(b => ({ id: b.id, name: b.name, role: b.role, repo: b.repo, file: b.file })), mocks, properties };
}

// The flow from one method (not an entry point itself: a service method, a handler)
function from(keys, methodId, { config = {} } = {}) {
  const G = require('./impact').load({ repos: keys });
  const resolve = X.resolver(config, new Set());
  const own = (id) => (id && id.startsWith('ext:') && G.classes.has(id.slice(4)) ? id.slice(4) : id);
  return { entry: methodId, kind: 'method', method: methodId, ...walk(G, methodId, { resolve, own, cls: (m) => G.classes.get(m.split('#')[0]) }) };
}

// The service's merged Spring config, from its checkout
function serviceConfig(root) {
  const files = X.walk(root).filter(f => /\.(ya?ml|properties)$/.test(f.path));
  return X.loadConfig(files).merged;
}

module.exports = { flows, from, walk, serviceConfig };
