// Data behind /admin: what is configured and indexed per env, jobs, passports, and the few things
// people edit there (envs.json, notes, service -> repo mapping). Secrets (.env files) are never shown or edited.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readJson, writeJson } = require('./util');

function status() {
  const p = config.getPersonal();
  const pp = require('./passport');
  const repos = readJson(path.join(pp.DIR, '_repos.json'), {});
  const passports = pp.list().map(x => ({ ...x, mapped: repos[x.service] ? `${repos[x.service].project}/${repos[x.service].repo}` : null }));
  for (const [service, r] of Object.entries(repos)) if (!passports.some(x => x.service === service)) passports.push({ service, repo: `${r.project}/${r.repo}`, mapped: `${r.project}/${r.repo}`, builtAt: null });
  const envs = config.envNames().map(e => { try { return require('./indexer').status(e); } catch (err) { return { env: e, error: err.message }; } });
  return {
    version: require('../package.json').version,
    auth: { apiKey: !!process.env.DT_API_KEY, trustNetwork: process.env.DT_TRUST_NETWORK === '1' },
    config: { dir: config.CONFIG_DIR, envsJson: fs.existsSync(config.ENVS_FILE), notes: Object.keys(require('./notes').all()).length },
    integrations: {
      bitbucket: p.bitbucket.url && p.bitbucket.token ? p.bitbucket.url : null,
      confluence: p.confluence.url && p.confluence.token ? p.confluence.url : null,
      graph: p.graphUrl, internalGroups: p.internalGroups,
    },
    envs, passports,
    jobs: require('./jobs').list(25),
    tools: require('./tools').groups(),
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

function readConfig() {
  const exists = fs.existsSync(config.ENVS_FILE);
  let text;
  if (exists) text = fs.readFileSync(config.ENVS_FILE, 'utf8');
  else {
    // no envs.json: show what is in effect (one entry per .env.<name> file) as a starting point
    text = JSON.stringify(Object.fromEntries(config.envNames().map(e => [e, { envFile: config.getEnv(e).envFile }])), null, 2);
  }
  return { file: config.ENVS_FILE, exists, text, example: fs.readFileSync(path.join(config.ROOT, 'envs.example.json'), 'utf8') };
}

function writeConfig(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) throw new Error('envs.json must be an object: { "<env>": { ... } }');
  for (const [name, def] of Object.entries(parsed)) {
    if (!/^[\w-]+$/.test(name)) throw new Error(`bad env name "${name}"`);
    if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error(`env "${name}" must be an object`);
    if (def.pg !== undefined && def.pg !== 'auto' && (typeof def.pg !== 'object' || Array.isArray(def.pg))) throw new Error(`env "${name}": pg must be "auto" or { "<db>": "<ENV_VAR>" }`);
  }
  if (fs.existsSync(config.ENVS_FILE)) fs.copyFileSync(config.ENVS_FILE, config.ENVS_FILE + '.bak');
  fs.writeFileSync(config.ENVS_FILE, JSON.stringify(parsed, null, 2) + '\n');
  config.reload();
  return { saved: config.ENVS_FILE, envs: config.envNames(), note: 'Applied; Open WebUI picks up new env names when it reloads the tool list' };
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

module.exports = { status, object, readConfig, writeConfig, setNote, setRepo };
