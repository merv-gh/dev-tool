// Data behind /admin: what is configured and indexed per env, jobs, passports, and the few things
// people edit there (envs.json, notes, service -> repo mapping). Secrets (.env files) are never shown or edited.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readJson, writeJson } = require('./util');

async function status() {
  const p = config.getPersonal();
  const pp = require('./passport');
  const repos = readJson(path.join(pp.DIR, '_repos.json'), {});
  const passports = pp.list().map(x => ({ ...x, mapped: repos[x.service] ? `${repos[x.service].project}/${repos[x.service].repo}` : null }));
  for (const [service, r] of Object.entries(repos)) if (!passports.some(x => x.service === service)) passports.push({ service, repo: `${r.project}/${r.repo}`, mapped: `${r.project}/${r.repo}`, builtAt: null });
  const envs = config.envNames().map(e => { try { return require('./indexer').status(e); } catch (err) { return { env: e, error: err.message }; } });
  return {
    version: require('../package.json').version,
    auth: { apiKey: !!config.getServer().apiKey, trustNetwork: config.getServer().trustNetwork },
    config: { dir: config.HOME, format: config.load().format, notes: Object.keys(require('./notes').all()).length, browserSites: config.getBrowser().sites.map(s => s.site), scripts: require('./scripts').list().scripts.length },
    integrations: {
      bitbucket: p.bitbucket.url && p.bitbucket.token ? p.bitbucket.url : null,
      confluence: p.confluence.url && p.confluence.token ? p.confluence.url : null,
      graph: p.graphUrl, internalGroups: p.internalGroups,
    },
    envs, passports,
    jobs: require('./jobs').list(25),
    tools: await require('./tools').groups(),
  };
}

// One object for the browser on the admin page: Postgres details with usages, plus matching catalog lines.
function object(env, name) {
  name = String(name || '').trim();
  if (!name) return { objects: [], lines: [] };
  const objects = require('./pgindex').describe(env, name).map(({ body, ...o }) => ({ ...o, body: body && body.length > 20000 ? body.slice(0, 20000) + '\n...' : body, note: require('./notes').get(o.object, o.db) }));
  const lines = require('./catalog').find(env, name, { limit: 100 });
  return { objects, lines, note: require('./notes').get(name) };
}

// The structure file people edit: config.json, or envs.json in the older layout.
function readConfig() {
  const s = config.load();
  const modern = s.format === 'config.json';
  const file = modern ? config.CONFIG_FILE : config.ENVS_FILE;
  const exists = fs.existsSync(file);
  let text;
  if (exists) text = fs.readFileSync(file, 'utf8');
  else text = JSON.stringify(modern ? {} : Object.fromEntries(config.envNames().map(e => [e, { envFile: config.getEnv(e).envFile }])), null, 2);
  const example = fs.readFileSync(path.join(config.ROOT, 'config.example.json'), 'utf8');
  return { file, format: s.format, exists, text, example, secrets: path.basename(config.SECRETS_FILE) };
}

// Validates, keeps the previous version as <file>.bak, applies without a restart (tools reload too).
async function writeConfig(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object');
  const modern = config.load().format === 'config.json';
  const envs = modern ? parsed.envs : parsed;
  if (!envs || typeof envs !== 'object' || Array.isArray(envs) || !Object.keys(envs).length) throw new Error(modern ? 'config.json needs "envs": { "<env>": { ... } }' : 'envs.json must be an object: { "<env>": { ... } }');
  for (const [name, def] of Object.entries(envs)) {
    if (!/^[\w-]+$/.test(name)) throw new Error(`bad env name "${name}"`);
    if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error(`env "${name}" must be an object`);
    const pg = modern ? def.postgres : def.pg;
    if (pg !== undefined && pg !== 'auto' && (typeof pg !== 'object' || Array.isArray(pg))) throw new Error(`env "${name}": ${modern ? 'postgres' : 'pg'} must be "auto" or { "<db>": "<url or \${VAR}>" }`);
  }
  if (modern && parsed.tools) {
    const t = require('./tools');
    for (const def of [].concat(parsed.tools.custom || [])) t.declarative(def);
    for (const p of [].concat(parsed.tools.plugins || [])) t.pluginSource(p);
    for (const k of ['enable', 'disable']) if (parsed.tools[k] !== undefined && !Array.isArray(parsed.tools[k])) throw new Error(`tools.${k} must be a list`);
  }
  const file = modern ? config.CONFIG_FILE : config.ENVS_FILE;
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n');
  config.reload();
  const tools = await require('./tools').reload();
  for (const e of config.envNames()) try { require('./catalog').build(e); } catch {} // site map lines in find
  return { saved: file, envs: config.envNames(), tools, note: 'Applied. Open WebUI shows new tools when it next loads the tool list; restart the browser container after changing browser sites.' };
}

// ── browser sites, edited one at a time (config.json browser.sites) ──
function sites() {
  const s = config.load();
  const raw = (s.raw.browser || {}).sites || {};
  const resolved = Object.fromEntries(config.getBrowser().sites.map(x => [x.site, x]));
  const set = new Set(Object.keys(config.getBrowser().secretValues()));
  return {
    editable: s.format === 'config.json',
    sites: Object.entries(raw).map(([name, x]) => ({
      name, url: x.url || '', description: x.description || '',
      secrets: [].concat(x.secrets || []).map(k => ({ name: k, set: set.has(k) })),
      links: Object.entries(x.links || {}).map(([link, l]) => (typeof l === 'string' ? { link, path: l, description: '' } : { link, path: l.path || l.url || '', description: l.description || '' })),
      resolved: resolved[name] ? { url: resolved[name].url, links: resolved[name].links } : null,
    })),
  };
}

function siteDef(def) {
  if (!def || typeof def !== 'object') throw new Error('site must be an object');
  const name = String(def.name || '').trim();
  if (!/^[a-z0-9][\w-]*$/i.test(name)) throw new Error('site name: letters, digits, _ and -');
  const url = String(def.url || '').trim();
  if (!/^(https?:\/\/|\$\{)/.test(url)) throw new Error(`${name}: url must start with http(s):// or a \${VAR}`);
  const secrets = [].concat(def.secrets || []).map(x => String(typeof x === 'object' ? x.name : x).trim()).filter(Boolean);
  for (const k of secrets) if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw new Error(`${name}: secret "${k}" must be an .env name like CRM_PASSWORD`);
  const links = {};
  for (const l of [].concat(def.links || [])) {
    const ln = String(l.link || '').trim(), lp = String(l.path || '').trim();
    if (!ln && !lp) continue;
    if (!/^[a-z0-9][\w-]*$/i.test(ln)) throw new Error(`${name}: link name "${ln}": letters, digits, _ and -`);
    if (!lp) throw new Error(`${name}.${ln}: path required`);
    if (links[ln]) throw new Error(`${name}: link "${ln}" twice`);
    links[ln] = l.description ? { path: lp, description: String(l.description).trim() } : lp;
  }
  return { name, body: { url, ...(def.description ? { description: String(def.description).trim() } : {}), secrets, ...(Object.keys(links).length ? { links } : {}) } };
}

// Save one site (rename with `was`), or delete it (def = null). Goes through writeConfig: validated, .bak, reload.
async function saveSite(was, def) {
  if (config.load().format !== 'config.json') throw new Error('sites are edited in config.json; run "dt migrate-config" first');
  const raw = JSON.parse(fs.readFileSync(config.CONFIG_FILE, 'utf8'));
  raw.browser = raw.browser || {};
  const old = raw.browser.sites || {};
  const next = {};
  const d = def ? siteDef(def) : null;
  if (d && d.name !== was && old[d.name]) throw new Error(`site ${d.name} already exists`);
  for (const [k, v] of Object.entries(old)) {
    if (k === was) { if (d) next[d.name] = d.body; } else next[k] = v;
  }
  if (d && !(was in old)) next[d.name] = d.body;
  if (!d && !(was in old)) throw new Error(`no site "${was}"`);
  raw.browser.sites = next;
  const secretsChanged = JSON.stringify((old[was] || {}).secrets || []) !== JSON.stringify(d ? d.body.secrets : []);
  const r = await writeConfig(JSON.stringify(raw));
  return { site: d ? d.name : null, deleted: !d, ...r, note: secretsChanged ? 'Saved. Restart the browser container to give it the changed secrets: ./run.sh restart browser' : 'Saved.' };
}

function setNote(name, note) {
  const r = require('./notes').set(name, note);
  for (const e of config.envNames()) try { require('./catalog').build(e); } catch {}
  return r;
}

function setRepo(service, repo) {
  if (!service) throw new Error('service required');
  const pp = require('./passport');
  const f = path.join(pp.DIR, '_repos.json');
  const m = readJson(f, {});
  if (!repo) delete m[service];
  else {
    const [project, slug] = String(repo).split('/');
    if (!project || !slug) throw new Error('repo must be PROJECT/slug');
    m[service] = { project: project.toUpperCase(), repo: slug };
  }
  writeJson(f, m);
  return { service, repo: m[service] || null };
}

module.exports = { status, object, readConfig, writeConfig, sites, saveSite, setNote, setRepo };
