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
const routeCache=new Map();
function catalog({ env, q = '', group, offset = 0, limit = 100, resources: includeResources = false, resources_only = false } = {}) {
  env ||= C.envNames()[0]; C.getEnv(env); // includes principal/environment authorization
  if(resources_only)return {env,environments:C.envNames(),resources:resources(env)};
  const snapshot = readJson(path.join(C.PATHS.cache, env, 'consul.json'));
  const groups = new Map(), warnings = [];
  const ensure = (key, name, service = '') => {
    if (!groups.has(key)) groups.set(key, { key, name, service, routes: [], targets: [], observedAt: null, stale: false });
    return groups.get(key);
  };
  for (const [name, service] of Object.entries(snapshot?.services || {})) {
    const g = ensure('service:' + name, name, name);
    g.targets = (service.instances || []).map(target).filter(Boolean).sort((a,b) => (a.status !== 'passing') - (b.status !== 'passing') || a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
    g.observedAt = service.observedAt || snapshot.syncedAt || null;
    g.expired = !g.observedAt || Date.now()-Date.parse(g.observedAt)>15000;
    g.stale = !!service.stale || !!service.error || !!service.invalidatedAt;
  }
  let routes;
  try {
    const index=require('./route-index'),key=require('./access').current().scopeKey+'\0'+env,stamp=index.signature({env})+'\0'+require('./util').fileStamp(require('./routes').FILE),hit=routeCache.get(key);
    if(hit?.stamp===stamp)routes=hit.routes;else{routes=require('./routes').list({env,includeDeclared:true});routeCache.set(key,{stamp,routes});while(routeCache.size>32)routeCache.delete(routeCache.keys().next().value);}
    for(const p of index.passports({manual:false}))ensure('service:'+p.service,p.service,p.service);
  }
  catch (e) { routes = []; warnings.push({ source: 'routes', message: e.message }); }
  const observed = require('./routes').load().routes || {}, byRoute = new Map();
  for (const route of routes) {
    const key = route.service ? 'service:' + route.service : route.host ? 'host:' + route.host : 'unattributed';
    const g = ensure(key, route.service || route.host || 'Unattributed routes', route.service);
    const saved = observed[`${route.host} ${route.method} ${route.path}`];
    let origin;
    if(saved?.example)try { const url = new URL(saved.example); if (/^https?:$/.test(url.protocol)) origin = url.origin; } catch {}
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
    env, environments: C.envNames(), ...(includeResources ? {resources:resources(env)} : {}), consul: { configured:!!C.getEnv(env).consul,indexed: !!snapshot, observedAt: snapshot?.syncedAt || null, maxAgeMs:15000 }, warnings,
    services: all.filter(g => (!group || g.key===group) && (!words.length || g.routes.length || matches(g.name))).map(({ routes, ...g }) => ({ ...g, routeCount: routes.length })),
    routes: rows.slice(offset, offset + limit), total: rows.length, offset,
    nextOffset: offset + limit < rows.length ? offset + limit : null,
  };
}
function resources(env) {
  const e = C.getEnv(env), dir = path.join(C.PATHS.cache, env);
  const files = folder => { try { return require('fs').readdirSync(path.join(dir, folder)).filter(n => n.endsWith('.json') && !n.startsWith('_')).map(n => n.slice(0, -5)); } catch { return []; } };
  const kafka = readJson(path.join(dir, 'kafka', '_index.json'));
  const names={databases:Object.keys(e.pg).filter(db => e.pg[db]),indices:files('es'),topics:(kafka?.topics || []).map(t => t.topic)};
  return { ...Object.fromEntries(Object.entries(names).map(([k,v])=>[k,v.slice(0,500)])), truncated:Object.fromEntries(Object.entries(names).filter(([,v])=>v.length>500).map(([k,v])=>[k,v.length])), cluster: kafka?.cluster || null, kafka: !!e.kafkaUi, elasticsearch: !!e.es.hosts.length, browser: !!C.getBrowser().mcp, sites: C.getBrowser().sites.map(s => ({ site:s.site, links:Object.keys(s.links || {}) })) };
}
async function refresh({env, service, catalog:refreshCatalog=false} = {}) {
  env ||= C.envNames()[0]; C.getEnv(env);
  if ((!refreshCatalog&&!service)||(service!==undefined&&(typeof service!=='string'||!service.trim()||service.length>256))) throw Error('Select an exact service or refresh the service catalog');
  const progress=require('./tool-events').progress;progress('consul-admission');
  await require('./limit').take('consul:'+env, {signal:require('./execution').signal()});progress('consul-fetching');
  const base=C.getEnv(env).consul;if(!base)throw Error('Consul is not configured');
  const [names,instances]=await Promise.all([refreshCatalog?require('./util').http(base.replace(/\/$/,'')+'/v1/catalog/services',{timeout:5000}):null,service?require('./consul').instances(env,service,{timeout:5000}):null]);
  require('./execution').check();
  const file = path.join(C.PATHS.cache, env, 'consul.json'), snapshot = readJson(file) || {services:{}};
  const at = new Date().toISOString();
  snapshot.services ||= {};
  if(refreshCatalog){const next={};for(const name of Object.keys(names)){next[name]={...snapshot.services[name],tags:names[name],invalidatedAt:at};}snapshot.services=next;snapshot.syncedAt=at;}
  if(service)snapshot.services[service] = {tags:snapshot.services[service]?.tags || [], instances, observedAt:at};
  require('./atomic-file').atomicFile(file, JSON.stringify(snapshot)+'\n');
  progress('consul-refreshed',{services:Object.keys(snapshot.services).length});
  return {env, service, observedAt:at, ...(instances?{instances:instances.map(target).filter(Boolean)}:{}),services:Object.keys(snapshot.services).length,invalidated:refreshCatalog,maxAgeMs:15000,next:'Discovered service targets can follow the refreshed instance. Manual URL overrides remain pinned. No API request was replayed.'};
}
function database({env, db, q='', offset=0, limit=30} = {}) {
  env ||= C.envNames()[0]; const configured = C.getEnv(env).pg;
  if (!Object.hasOwn(configured,db || '') || !configured[db] || !/^[\w.-]+$/.test(db) || db.startsWith('.')) throw Error('Choose a configured database');
  const file = path.join(C.PATHS.cache,env,'pg',db+'.json'), cat = require('./pgstore').load(file);
  if (!cat) return {env,db,objects:[],nextOffset:null,gap:'Database has no cached schema. Refresh the Postgres catalog in Admin.'};
  const tables=cat.tables || [], functions=cat.functions || [], total=tables.length+functions.length, objects=[];
  let cursor=Math.max(0,Math.floor(offset)), scanned=0; limit=Math.max(1,Math.min(50,limit));
  const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';
  for (;cursor<total && scanned<10000 && objects.length<limit;cursor++,scanned++) {
    const fn=cursor>=tables.length, row=fn?functions[cursor-tables.length]:tables[cursor], name=row.schema+'.'+row.name;
    if(!name.toLowerCase().includes(String(q).toLowerCase()))continue;
    objects.push({name,kind:row.kind || (fn?'function':'table'),columns:!fn?(row.columns || []).slice(0,100):undefined,arguments:fn?row.arguments:undefined,body:fn?String(row.body || '').slice(0,8000):undefined,sql:fn?null:`select * from ${quote(row.schema)}.${quote(row.name)} limit 20`});
  }
  return {env,db,objects,nextOffset:cursor<total?cursor:null,scanned,indexed:true,revision:cat._revision,notice:'Cached schema; queries run only when you press Run query.'};
}
async function resolveTarget({env,service,instance_id}={}){
 env ||= C.envNames()[0];C.getEnv(env);if(typeof service!=='string'||!service||service.length>256)throw Error('Select an exact service');
 let row=readJson(path.join(C.PATHS.cache,env,'consul.json'))?.services?.[service],at=row?.observedAt;
 if(!at||!Number.isFinite(Date.parse(at))||Date.now()-Date.parse(at)>15000||row.stale||row.invalidatedAt){const r=await refresh({env,service});const chosen=r.instances.find(t=>t.id===instance_id&&t.status==='passing')||r.instances.find(t=>t.status==='passing');if(!chosen)throw Error('No passing Consul instance for '+service);return {...chosen,instances:r.instances,env,service,observedAt:r.observedAt};}
 const targets=(row.instances||[]).map(target).filter(Boolean),chosen=targets.find(t=>t.id===instance_id&&t.status==='passing')||targets.find(t=>t.status==='passing');if(!chosen)throw Error('No passing Consul instance for '+service);return {...chosen,instances:targets,env,service,observedAt:at};
}
module.exports = { catalog, target, resources, refresh, database, resolveTarget };
