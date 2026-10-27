// Resolves an environment from envs.json (optional) + its .env file.
// Each env is resolved independently (nothing is written to process.env),
// so one process can talk to dev and uat at the same time.
//
// envs.json is optional. Without it every .env.<name> file (except personal/browser/example) is an
// env, and every DATABASE_URL / DATABASE_URL_<NAME> in it is a database. With it, each field
// below overrides the default (see envs.example.json).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// where envs.json, notes.json, .env.<env> and .env.personal live (tests point it elsewhere)
const CONFIG_DIR = process.env.DT_CONFIG_DIR || ROOT;
const ENVS_FILE = path.join(CONFIG_DIR, 'envs.json');
const NOT_ENVS = new Set(['personal', 'browser', 'example']);

const DEFAULTS = {
  es: { hostsVar: 'ELASTICSEARCH_HOSTS', userVar: 'ELASTICSEARCH_USER', passVar: 'ELASTICSEARCH_PASS', hosts: [] },
  kafkaUi: { var: 'KAFKA_UI_URL', url: null },
  schemaRegistry: { var: 'SCHEMA_REGISTRY_URL', url: null },
  consul: { var: 'CONSUL_URL', url: null },
  logs: {
    hostsVar: 'LOGS_ES_HOSTS', userVar: 'LOGS_ES_USER', passVar: 'LOGS_ES_PASS',
    index: 'logs-*', indexVar: 'LOGS_INDEX',
    fields: { time: '@timestamp', message: 'message', service: 'service.name', level: 'log.level', trace: 'trace.id' },
    fieldVars: { time: 'LOGS_FIELD_TIME', message: 'LOGS_FIELD_MESSAGE', service: 'LOGS_FIELD_SERVICE', level: 'LOGS_FIELD_LEVEL', trace: 'LOGS_FIELD_TRACE' },
    kibana: null, kibanaVar: 'LOGS_KIBANA_URL',
  },
};

function parseEnvFile(file) {
  const vars = {};
  if (!fs.existsSync(file)) return vars;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    vars[m[1]] = v;
  }
  return vars;
}

let envs = null;
const cache = {};

function readEnvs() {
  if (envs) return envs;
  if (fs.existsSync(ENVS_FILE)) return (envs = JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8')));
  envs = {};
  let files = [];
  try { files = fs.readdirSync(CONFIG_DIR); } catch {}
  for (const f of files) {
    const m = f.match(/^\.env\.([\w-]+)$/);
    if (m && !NOT_ENVS.has(m[1])) envs[m[1]] = {};
  }
  if (!Object.keys(envs).length) envs.dev = {};
  return envs;
}

// Forget everything read so far (after the admin page edits envs.json or an .env file).
function reload() {
  envs = null; personal = null;
  for (const k of Object.keys(cache)) delete cache[k];
}

const dbNameOf = (url) => { try { return decodeURIComponent(new URL(url).pathname.slice(1)) || 'postgres'; } catch { return 'postgres'; } };

function getEnv(name) {
  name = name || envNames()[0];
  if (cache[name]) return cache[name];
  const def = readEnvs()[name];
  if (!def) throw new Error(`Unknown env "${name}". Known: ${envNames().join(', ')}`);
  const envFile = def.envFile || `.env.${name}`;
  const fileVars = parseEnvFile(path.join(CONFIG_DIR, envFile));
  const v = (key) => (key && (fileVars[key] ?? process.env[key])) || undefined;
  const merge = (k) => ({ ...DEFAULTS[k], ...(def[k] || {}) });
  const endpoint = (e) => (v(e.var) || e.url || '').replace(/\/$/, '') || null;
  const list = (s) => s.split(',').map(x => x.trim()).filter(Boolean);

  // pg: {db: VAR | [VAR, ...]} from envs.json, or every DATABASE_URL[_NAME] in the env file
  const pg = {};
  if (def.pg && typeof def.pg === 'object') {
    for (const [db, keys] of Object.entries(def.pg)) {
      const key = [].concat(keys).find(k => v(k));
      pg[db] = key ? v(key) : null;
    }
  } else {
    for (const [k, url] of Object.entries(fileVars)) {
      const m = k.match(/^DATABASE_URL(?:_(\w+))?$/);
      if (m && url) pg[m[1] ? m[1].toLowerCase() : dbNameOf(url)] = url;
    }
  }

  const es = merge('es');
  const hosts = v(es.hostsVar);
  const esHosts = hosts ? list(hosts) : es.hosts;
  const L = merge('logs');
  const ownLogs = v(L.hostsVar);
  const fields = {};
  for (const [k, d] of Object.entries({ ...DEFAULTS.logs.fields, ...L.fields })) fields[k] = v((L.fieldVars || {})[k]) || d;

  return (cache[name] = {
    name,
    envFile,
    envFileFound: fs.existsSync(path.join(CONFIG_DIR, envFile)),
    pg,
    defaultDb: def.defaultDb || Object.keys(pg).find(k => pg[k]) || null,
    es: { hosts: esHosts, user: v(es.userVar), pass: v(es.passVar) },
    kafkaUi: endpoint(merge('kafkaUi')),
    // ELK: its own cluster if LOGS_ES_HOSTS is set, else the data ES cluster and login
    logs: {
      hosts: ownLogs ? list(ownLogs) : esHosts,
      user: ownLogs ? v(L.userVar) : v(es.userVar),
      pass: ownLogs ? v(L.passVar) : v(es.passVar),
      index: v(L.indexVar) || L.index,
      fields,
      kibana: (v(L.kibanaVar) || L.kibana || '').replace(/\/$/, '') || null,
    },
    schemaRegistry: endpoint(merge('schemaRegistry')),
    consul: endpoint(merge('consul')),
  });
}

// Personal tokens (Bitbucket, Confluence, LLM): one file, shared by all envs.
let personal;
function getPersonal() {
  if (personal) return personal;
  const vars = parseEnvFile(path.join(CONFIG_DIR, '.env.personal'));
  const v = (k) => vars[k] ?? process.env[k] ?? undefined;
  return (personal = {
    found: fs.existsSync(path.join(CONFIG_DIR, '.env.personal')),
    bitbucket: { url: (v('BITBUCKET_URL') || '').replace(/\/$/, '') || null, token: v('BITBUCKET_HTTP_TOKEN') },
    confluence: { url: (v('CONFLUENCE_URL') || '').replace(/\/$/, ''), user: v('CONFLUENCE_USERNAME'), token: v('CONFLUENCE_API_TOKEN') },
    llm: { baseUrl: (v('LLM_BASE_URL') || '').replace(/\/$/, ''), key: v('LLM_API_KEY'), model: v('LLM_MODEL') },
    // Maven/Gradle group prefixes of your own libraries (comma list), for passports
    internalGroups: (v('INTERNAL_GROUPS') || '').split(',').map(s => s.trim()).filter(Boolean),
    graphUrl: (v('GRAPH_URL') || '').replace(/\/$/, '') || null,
  });
}

const envNames = () => Object.keys(readEnvs());

// An endpoint of an env, or a clear error saying which variable to set.
const VARS = { consul: 'CONSUL_URL', kafkaUi: 'KAFKA_UI_URL', schemaRegistry: 'SCHEMA_REGISTRY_URL' };
function endpoint(name, kind) {
  const e = getEnv(name);
  if (!e[kind]) {
    const def = readEnvs()[e.name] || {};
    throw new Error(`${kind} not configured for ${e.name}: set ${(def[kind] && def[kind].var) || VARS[kind]} in ${e.envFile} (or ${kind}.url in envs.json)`);
  }
  return e[kind];
}

module.exports = { ROOT, CONFIG_DIR, ENVS_FILE, envNames, getEnv, getPersonal, reload, parseEnvFile, endpoint };
