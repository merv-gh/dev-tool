// Everything that fills the index, as one place the CLI, the catalog_sync tool and the admin page call.
//   pg | es | kafka | consul   live sync of one source (optionally only some dbs / name parts)
//   passports                  rebuild service passports (all cached ones, or `only` services)
//   index                      rebuild catalog.txt + the Postgres usage index from the cache (no network)
//   all                        pg, es, kafka, consul, then index
// Per-source outcome (when, how long, counts, error) goes to cache/<env>/_sources.json for the admin page.
const path = require('path');
const { envNames, getEnv } = require('./config');
const { CACHE, readJson, writeJson } = require('./util');
const limit = require('./limit');
const jobs = require('./jobs');

const LIVE = ['pg', 'es', 'kafka', 'consul'];
const WHAT = [...LIVE, 'passports', 'index', 'all'];
const sourcesFile = (env) => path.join(CACHE, env, '_sources.json');

function record(env, key, value) {
  const s = readJson(sourcesFile(env), {});
  s[key] = { at: new Date().toISOString(), ...value };
  writeJson(sourcesFile(env), s);
}

function configured(env, kind) {
  const e = getEnv(env);
  return {
    pg: Object.values(e.pg).some(Boolean), es: e.es.hosts.length > 0, kafka: !!e.kafkaUi, consul: !!e.consul,
  }[kind];
}

async function syncSource(env, kind, only, log) {
  await limit.take(`${kind}:${env}`);
  const started = Date.now();
  try {
    const r = await require(`./${kind}`).sync(env, { only, log });
    if (kind === 'pg') for (const d of r) record(env, `pg:${d.db}`, d.error ? { ok: false, error: d.error } : { ok: true, ...d });
    else record(env, kind, { ok: true, ms: Date.now() - started, ...(typeof r === 'object' && !Array.isArray(r) ? r : { count: Array.isArray(r) ? r.length : undefined }) });
    return r;
  } catch (e) {
    record(env, only && kind === 'pg' ? `pg:${only.join(',')}` : kind, { ok: false, ms: Date.now() - started, error: e.message });
    throw e;
  }
}

async function rebuildPassports(only, log) {
  const pp = require('./passport');
  const names = only && only.length ? only : pp.list().map(p => p.service);
  const out = {};
  for (const service of names) {
    const prev = pp.load(service);
    // same target as last time: the deployed commit of its env, or its branch/tag (a fixed sha would not change)
    const opts = prev?.env ? { env: prev.env } : prev && !/^[0-9a-f]{7,40}$/.test(prev.repo.ref || '') && prev.repo.ref !== 'HEAD' ? { ref: prev.repo.ref } : {};
    log(`passport ${service}: building${opts.env ? ` (deployed in ${opts.env})` : opts.ref ? ` (${opts.ref})` : ''}`);
    try {
      const p = await pp.build(service, { ...opts, rebuildCatalog: false });
      out[service] = { sha: p.repo.sha, changed: p.changes ? !p.changes.none : null };
      log(`passport ${service}: ${p.repo.sha.slice(0, 10)}${p.changes && !p.changes.none ? ', changed' : ''}`);
    } catch (e) { out[service] = { error: e.message }; log(`passport ${service}: ERROR ${e.message}`); }
  }
  return out;
}

function rebuildIndex(env, log) {
  const lines = require('./catalog').build(env);
  const u = require('./pgindex').load(env);
  log(`index ${env}: ${lines} catalog lines, ${u.edges.length} usage edges`);
  record(env, 'index', { ok: true, lines, edges: u.edges.length });
  return { catalogLines: lines, usageEdges: u.edges.length };
}

// Runs as a job (shown on the admin page); resolves with the result.
function refresh({ env, what = 'all', only } = {}) {
  env = env || envNames()[0];
  if (!WHAT.includes(what)) throw new Error(`what must be one of ${WHAT.join(', ')}`);
  getEnv(env); // unknown env -> error now, not inside the job
  only = typeof only === 'string' ? only.split(',').map(s => s.trim()).filter(Boolean) : only;
  const title = `${what}${only?.length ? ` (${only.join(', ')})` : ''} ${what === 'passports' ? '' : env}`.trim();
  const key = what === 'passports' ? `passports:${(only || []).join(',')}` : `${env}:${what}:${(only || []).join(',')}`;
  return jobs.start(key, title, async (log) => {
    const out = {};
    if (what === 'passports') {
      out.passports = await rebuildPassports(only, log);
      for (const e of envNames()) out[e] = rebuildIndex(e, log);
      return out;
    }
    const kinds = what === 'all' ? LIVE.filter(k => configured(env, k)) : LIVE.includes(what) ? [what] : [];
    for (const k of kinds) {
      log(`${k} ${env}: syncing${only?.length ? ` ${only.join(', ')}` : ''}`);
      try { out[k] = await syncSource(env, k, only, (l) => log(l)); }
      catch (e) { out[k] = { error: e.message }; log(`${k} ${env}: ERROR ${e.message}`); }
    }
    Object.assign(out, rebuildIndex(env, log));
    return out;
  });
}

// Admin overview of one env: what is configured, synced when, how big, last error.
function status(env) {
  const e = getEnv(env);
  const src = readJson(sourcesFile(env), {});
  const pg = require('./pg');
  const configuredDbs = Object.entries(e.pg);
  const dbs = configuredDbs.map(([db, url]) => {
    const cat = url ? pg.loadDb(env, db) : null;
    const s = src[`pg:${db}`] || {};
    return {
      db, configured: !!url, host: url ? safeHost(url) : null,
      syncedAt: cat?.syncedAt || null, tables: cat?.tables.length ?? null, functions: cat?.functions?.length ?? null,
      triggers: cat?.triggers?.length ?? null, ms: cat?.ms ?? s.ms ?? null, error: s.ok === false ? s.error : null,
    };
  });
  const idx = (kind) => readJson(path.join(CACHE, env, kind, '_index.json'));
  const one = (kind, count) => ({ configured: configured(env, kind), syncedAt: count.syncedAt || src[kind]?.at || null, count: count.n, error: src[kind]?.ok === false ? src[kind].error : null, ms: src[kind]?.ms ?? null });
  const esI = idx('es'), kI = idx('kafka'), consul = readJson(path.join(CACHE, env, 'consul.json'));
  const usage = require('./pgindex').load(env);
  let lines = 0;
  try { lines = require('fs').readFileSync(path.join(CACHE, env, 'catalog.txt'), 'utf8').split('\n').length - 1; } catch {}
  return {
    env, envFile: e.envFile, envFileFound: e.envFileFound,
    pg: dbs,
    es: one('es', { syncedAt: esI?.syncedAt, n: esI?.indices ? Object.keys(esI.indices).length : null }),
    kafka: one('kafka', { syncedAt: kI?.syncedAt, n: kI?.topics ? (Array.isArray(kI.topics) ? kI.topics.length : Object.keys(kI.topics).length) : null }),
    consul: one('consul', { syncedAt: consul?.syncedAt, n: consul?.services ? Object.keys(consul.services).length : null }),
    logs: { configured: e.logs.hosts.length > 0, index: e.logs.index },
    index: { builtAt: usage.builtAt || null, catalogLines: lines, usageEdges: usage.edges.length },
  };
}

const safeHost = (url) => { try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}${u.pathname}`; } catch { return '?'; } };

module.exports = { refresh, status, WHAT };
