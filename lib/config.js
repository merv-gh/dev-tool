// Configuration: one home folder (DT_HOME, default: this repo) with
//   config.json   structure: environments, integrations, tools, browser sites, server. Values may be
//                 ${VAR} / ${VAR:-default} references (defaults can nest: ${A:-${B}}).
//   .env          the values: passwords, tokens, URLs with credentials, plus docker compose settings.
//   notes.json, plugins/, scripts/, and data: cache/, repos/, passports/
// See config.example.json and .env.example.
//
// The older layout still works when there is no config.json: envs.json (optional) + .env.<env> per
// environment + .env.personal + .env.browser. `dt migrate-config` turns it into config.json + .env.
//
// Each env is resolved independently (nothing is written to process.env), so one process can talk
// to several environments at once.

const fs = require('fs');
const path = require('path');

// ROOT: the code (repo root; or dist/ when running the bundle dist/dt.js). HOME defaults to the repo root.
const BUNDLED = path.basename(__dirname) !== 'lib';
const ROOT = BUNDLED ? __dirname : path.join(__dirname, '..');
const HOME = path.resolve(process.env.DT_HOME || process.env.DT_CONFIG_DIR || (BUNDLED ? path.join(ROOT, '..') : ROOT));
const CONFIG_FILE = path.join(HOME, 'config.json');
const SECRETS_FILE = path.join(HOME, '.env');
const ENVS_FILE = path.join(HOME, 'envs.json'); // legacy
const NOT_ENVS = new Set(['personal', 'browser', 'example']);
const PATHS = {
  cache: path.resolve(process.env.DT_CACHE_DIR || path.join(HOME, 'cache')),
  repos: path.resolve(process.env.DT_REPOS_DIR || path.join(HOME, 'repos')),
  passports: path.resolve(process.env.DT_PASSPORTS_DIR || path.join(HOME, 'passports')),
  plugins: path.resolve(process.env.DT_PLUGINS_DIR || path.join(HOME, 'plugins')),
  scripts: path.resolve(process.env.DT_SCRIPTS_DIR || path.join(HOME, 'scripts')),
  views: path.resolve(process.env.DT_VIEWS_DIR || path.join(HOME, 'views')),
  work: path.resolve(process.env.DT_WORK_DIR || path.join(HOME, 'work')),
  // build helpers the runner needs too (dt's JUnit launcher); a volume shared with it in compose
  build: path.resolve(process.env.DT_BUILD_DIR || path.join(process.env.DT_CACHE_DIR || path.join(HOME, 'cache'), 'build')),
};

const LOG_FIELDS = { time: '@timestamp', message: 'message', service: 'service.name', level: 'log.level', trace: 'trace.id' };

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

// "${A}", "${A:-x}", "${A:-${B:-y}}", "prefix-${A}"; unset with no default -> "" (a lone reference -> null)
function interpolate(value, vars) {
  if (Array.isArray(value)) return value.map(v => interpolate(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, vars)]));
  if (typeof value !== 'string' || !value.includes('${')) return value;
  const lone = /^\$\{[^}]*\}$/.test(value) || /^\$\{\w+:-\$\{.*\}\}$/.test(value);
  let out = '', i = 0;
  while (i < value.length) {
    const start = value.indexOf('${', i);
    if (start < 0) { out += value.slice(i); break; }
    out += value.slice(i, start);
    // find the matching "}"
    let depth = 0, end = start;
    for (let j = start; j < value.length; j++) {
      if (value.startsWith('${', j)) { depth++; j++; } else if (value[j] === '}' && --depth === 0) { end = j; break; }
    }
    if (depth !== 0) { out += value.slice(start); break; }
    const inner = value.slice(start + 2, end);
    const m = inner.match(/^(\w+)(?::-([\s\S]*))?$/);
    if (m) {
      const v = vars(m[1]);
      out += v !== undefined && v !== '' ? v : m[2] !== undefined ? interpolate(m[2], vars) ?? '' : '';
    } else out += value.slice(start, end + 1);
    i = end + 1;
  }
  return lone && out === '' ? null : out;
}

let state = null;

function secretsVars() {
  // the single .env, plus the legacy personal/browser files when present
  return { ...parseEnvFile(path.join(HOME, '.env.browser')), ...parseEnvFile(path.join(HOME, '.env.personal')), ...parseEnvFile(SECRETS_FILE) };
}

// Files that make up the config; when any of them changes on disk, everything is re-read
// (checked at most once a second), so edits to config.json or .env apply without a restart.
let checkedAt = 0, sig = null;
function signature() {
  const files = [CONFIG_FILE, SECRETS_FILE, ENVS_FILE, path.join(HOME, '.env.personal'), path.join(HOME, '.env.browser')];
  try { for (const f of fs.readdirSync(HOME)) if (/^\.env\.[\w-]+$/.test(f)) files.push(path.join(HOME, f)); } catch {}
  return files.map(f => { try { return `${f}:${fs.statSync(f).mtimeMs}`; } catch { return ''; } }).join('|');
}
function checkFresh() {
  const now = Date.now();
  if (now - checkedAt < 1000) return;
  checkedAt = now;
  const s = signature();
  if (sig !== null && s !== sig) { state = null; for (const k of Object.keys(envCache)) delete envCache[k]; }
  sig = s;
}

function load() {
  checkFresh();
  if (state) return state;
  const secrets = secretsVars();
  const lookup = (extra = {}) => (k) => extra[k] ?? secrets[k] ?? process.env[k];
  if (fs.existsSync(CONFIG_FILE)) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { throw new Error(`${CONFIG_FILE}: ${e.message}`); }
    state = { format: 'config.json', raw, secrets, lookup };
  } else {
    state = { format: 'legacy', raw: legacyRaw(), secrets, lookup };
  }
  return state;
}

// Forget everything read so far (after config.json, envs.json or an env file changed).
function reload() { state = null; checkedAt = 0; sig = null; for (const k of Object.keys(envCache)) delete envCache[k]; }

// ── legacy layout -> the same shape as config.json (references, not values) ──
function legacyRaw() {
  let envs = null;
  if (fs.existsSync(ENVS_FILE)) envs = JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8'));
  else {
    envs = {};
    let files = [];
    try { files = fs.readdirSync(HOME); } catch {}
    for (const f of files) {
      const m = f.match(/^\.env\.([\w-]+)$/);
      if (m && !NOT_ENVS.has(m[1])) envs[m[1]] = {};
    }
    if (!Object.keys(envs).length) envs.dev = {};
  }
  const ref = (name, def) => (name ? `\${${name}${def ? `:-${def}` : ''}}` : def ?? null);
  const out = { envs: {} };
  for (const [name, def] of Object.entries(envs)) {
    const es = { hostsVar: 'ELASTICSEARCH_HOSTS', userVar: 'ELASTICSEARCH_USER', passVar: 'ELASTICSEARCH_PASS', hosts: [], ...(def.es || {}) };
    const ep = (k, v) => { const e = { var: v, url: null, ...(def[k] || {}) }; return ref(e.var, e.url); };
    const L = { hostsVar: 'LOGS_ES_HOSTS', userVar: 'LOGS_ES_USER', passVar: 'LOGS_ES_PASS', index: 'logs-*', indexVar: 'LOGS_INDEX', kibanaVar: 'LOGS_KIBANA_URL', kibana: null, ...(def.logs || {}) };
    const fields = {};
    for (const [k, d] of Object.entries({ ...LOG_FIELDS, ...(L.fields || {}) })) fields[k] = ref(`LOGS_FIELD_${k.toUpperCase()}`, d);
    const hostsRef = ref(es.hostsVar, es.hosts.join(','));
    let postgres = 'auto';
    if (def.pg && typeof def.pg === 'object') {
      postgres = {};
      // ["A", "B"] = first one that is set
      for (const [db, keys] of Object.entries(def.pg)) postgres[db] = [].concat(keys).reduceRight((acc, k) => `\${${k}${acc ? `:-${acc}` : ''}}`, '');
    }
    out.envs[name] = {
      envFile: def.envFile || `.env.${name}`,
      postgres, defaultDb: def.defaultDb,
      elasticsearch: { hosts: hostsRef, user: ref(es.userVar), password: ref(es.passVar) },
      kafkaUi: ep('kafkaUi', 'KAFKA_UI_URL'), schemaRegistry: ep('schemaRegistry', 'SCHEMA_REGISTRY_URL'), consul: ep('consul', 'CONSUL_URL'),
      logs: {
        hosts: ref(L.hostsVar), user: ref(L.userVar), password: ref(L.passVar),
        index: ref(L.indexVar, L.index), fields, kibana: ref(L.kibanaVar, L.kibana || ''),
      },
    };
  }
  out.bitbucket = { url: '${BITBUCKET_URL}', token: '${BITBUCKET_HTTP_TOKEN}' };
  out.confluence = { url: '${CONFLUENCE_URL}', user: '${CONFLUENCE_USERNAME}', token: '${CONFLUENCE_API_TOKEN}' };
  out.passports = { internalGroups: '${INTERNAL_GROUPS}' };
  out.graph = { url: '${GRAPH_URL}' };
  out.tools = { enable: ['all'], disable: [], plugins: [], custom: [] };
  // .env.browser: <NAME>_URL plus <NAME>_* secrets
  const b = parseEnvFile(path.join(HOME, '.env.browser'));
  out.browser = { sites: {} };
  for (const k of Object.keys(b).filter(k => k.endsWith('_URL'))) {
    const n = k.slice(0, -4);
    out.browser.sites[n.toLowerCase()] = { url: `\${${k}}`, secrets: Object.keys(b).filter(s => s.startsWith(n + '_') && s !== k) };
  }
  return out;
}

const envCache = {};
const list = (s) => (Array.isArray(s) ? s : String(s || '').split(',')).map(x => String(x).trim()).filter(Boolean);
const dbNameOf = (url) => { try { return decodeURIComponent(new URL(url).pathname.slice(1)) || 'postgres'; } catch { return 'postgres'; } };
const trimUrl = (u) => (u ? String(u).replace(/\/$/, '') : null) || null;

function getEnv(name) {
  name = name || envNames()[0];
  checkFresh();
  if (envCache[name]) return envCache[name];
  const s = load();
  const def = (s.raw.envs || {})[name];
  if (!def) throw new Error(`Unknown env "${name}". Known: ${envNames().join(', ')}`);
  const envFile = def.envFile || null;
  const fileVars = envFile ? parseEnvFile(path.join(HOME, envFile)) : {};
  const d = interpolate(def, s.lookup(fileVars));

  const pg = {};
  if (d.postgres && typeof d.postgres === 'object') for (const [db, url] of Object.entries(d.postgres)) pg[db] = url || null;
  else if (d.postgres === 'auto' || d.postgres === undefined) {
    for (const [k, url] of Object.entries(fileVars)) {
      const m = k.match(/^DATABASE_URL(?:_(\w+))?$/);
      if (m && url) pg[m[1] ? m[1].toLowerCase() : dbNameOf(url)] = url;
    }
  }
  const es = d.elasticsearch || {};
  const L = d.logs || {};
  const esHosts = list(es.hosts);
  const ownLogs = list(L.hosts);
  return (envCache[name] = {
    name,
    envFile: envFile || path.basename(CONFIG_FILE),
    envFileFound: envFile ? fs.existsSync(path.join(HOME, envFile)) : s.format === 'config.json',
    pg,
    defaultDb: d.defaultDb || Object.keys(pg).find(k => pg[k]) || null,
    es: { hosts: esHosts, user: es.user || undefined, pass: es.password || undefined },
    kafkaUi: trimUrl(d.kafkaUi),
    schemaRegistry: trimUrl(d.schemaRegistry),
    consul: trimUrl(d.consul),
    // ELK: its own cluster if logs.hosts is set, else the data ES cluster and login
    logs: {
      hosts: ownLogs.length ? ownLogs : esHosts,
      user: ownLogs.length ? L.user || undefined : es.user || undefined,
      pass: ownLogs.length ? L.password || undefined : es.password || undefined,
      index: L.index || 'logs-*',
      fields: { ...LOG_FIELDS, ...Object.fromEntries(Object.entries(L.fields || {}).filter(([, v]) => v)) },
      kibana: trimUrl(L.kibana),
    },
  });
}

const envNames = () => Object.keys(load().raw.envs || {});
const resolved = (key) => { const s = load(); return interpolate(s.raw[key] || {}, s.lookup()); };

// Bitbucket, Confluence, passports, code graph: shared by all envs.
function getPersonal() {
  const s = load();
  const bb = resolved('bitbucket'), cf = resolved('confluence'), pp = resolved('passports'), g = resolved('graph'), llm = resolved('llm');
  const v = s.lookup();
  return {
    found: s.format === 'config.json' ? fs.existsSync(SECRETS_FILE) : fs.existsSync(path.join(HOME, '.env.personal')),
    bitbucket: { url: trimUrl(bb.url), token: bb.token || undefined },
    confluence: { ...cf, url: trimUrl(cf.url) || '', user: cf.user || undefined, token: cf.token || undefined },
    llm: { ...llm, baseUrl: trimUrl(llm.baseUrl || v('LLM_BASE_URL')) || '', key: llm.key || v('LLM_API_KEY'), model: llm.model || v('LLM_MODEL') },
    // Maven/Gradle group prefixes of your own libraries, for passports
    internalGroups: list(pp.internalGroups),
    // artifactId (glob) or groupId:artifactId (glob) -> "PROJECT/repo", for libraries that are modules of a bigger repo
    libraryRepos: pp.libraryRepos && typeof pp.libraryRepos === 'object' ? pp.libraryRepos : {},
    // requests per second while indexing every Bitbucket repo (catalog_sync what=bitbucket)
    indexRatePerSec: Number(pp.indexRatePerSec) || 8,
    graphUrl: trimUrl(g.url),
  };
}

// tools: { enable: [groups|names], disable: [...], plugins: [path | https URL | github:owner/repo/path@ref | {url, sha256}], custom: [declarative tools] }
function getTools() {
  const t = resolved('tools');
  const spec = process.env.DT_TOOLS; // env override: "all,-confluence"
  const parts = spec ? list(spec) : null;
  return {
    enable: parts ? parts.filter(p => !p.startsWith('-')) : list(t.enable && t.enable.length ? t.enable : ['all']),
    disable: parts ? parts.filter(p => p.startsWith('-')).map(p => p.slice(1)) : list(t.disable),
    plugins: [].concat(t.plugins || []),
    custom: [].concat(t.custom || []),
    profile: process.env.DT_TOOL_PROFILE || t.profile || 'all',
    profiles: t.profiles && typeof t.profiles === 'object' ? t.profiles : {},
    backends: t.backends && typeof t.backends === 'object' ? t.backends : {},
    maxInputBytes: Number.isInteger(t.maxInputBytes) && t.maxInputBytes > 0 && t.maxInputBytes <= 50 * 1024 * 1024 ? t.maxInputBytes : 2 * 1024 * 1024,
  };
}

// browser.sites: { name: { url, secrets: [VAR names in .env], links: { name: "/path/<id>" | { path, description } } } }.
// Secret values only go to the browser container. Links are the site map the model gets: short direct
// URLs (relative to the site URL, or absolute), with <param> placeholders.
// browser.mcp: the Playwright MCP endpoint dt itself uses for saved scripts and route discovery.
function siteLinks(base, links = {}) {
  return Object.entries(links).map(([name, l]) => {
    const x = typeof l === 'string' ? { path: l } : { ...l };
    let url = x.url || x.path || '';
    if (!/^https?:\/\//.test(url) && base) {
      const origin = (base.match(/^https?:\/\/[^/]+/) || [''])[0];
      url = url.startsWith('/') ? origin + url : base.replace(/\/[^/]*$/, '/') + url;
    }
    return { link: name, url, params: [...new Set([...url.matchAll(/<(\w+)>/g)].map(m => m[1]))], ...(x.description ? { description: x.description } : {}) };
  });
}

function getBrowser() {
  const s = load();
  const b = s.raw.browser || {};
  const sites = b.sites || {};
  const v = s.lookup();
  return {
    sites: Object.entries(sites).map(([site, x]) => {
      const url = interpolate(x.url, v);
      return { site, url, secrets: [].concat(x.secrets || []), ...(x.description ? { description: x.description } : {}), links: siteLinks(url, interpolate(x.links || {}, v)) };
    }),
    mcp: process.env.DT_BROWSER_MCP || interpolate(b.mcp, v) || null,
    secretValues: () => Object.fromEntries(Object.values(sites).flatMap(x => [].concat(x.secrets || [])).map(k => [k, v(k)]).filter(([, val]) => val !== undefined)),
  };
}

// "site.link" (or "site/link") with params -> full URL; every <param> must be given.
function siteUrl(ref, params = {}) {
  const [site, link] = String(ref).split(/[./]/, 2);
  const s = getBrowser().sites.find(x => x.site === site);
  if (!s) throw new Error(`no browser site "${site}" (browser.sites in config.json)`);
  if (!link) return s.url;
  const l = s.links.find(x => x.link === link);
  if (!l) throw new Error(`site ${site} has no link "${link}"; links: ${s.links.map(x => x.link).join(', ') || 'none'}`);
  const missing = l.params.filter(p => params[p] === undefined || params[p] === '');
  if (missing.length) throw new Error(`${site}.${link} needs ${missing.join(', ')} (${l.url})`);
  return l.url.replace(/<(\w+)>/g, (m, k) => encodeURIComponent(params[k]));
}

// scripts: { http: { allow: [URL prefixes http steps may call] }, js: true | false, jsTimeoutMs, codeTimeoutMs (the code tool) }
function getScripts() {
  const c = resolved('scripts');
  return { httpAllow: [].concat((c.http || {}).allow || []).filter(Boolean).map(String), js: c.js !== false, jsTimeoutMs: Number(c.jsTimeoutMs) || 5000, codeTimeoutMs: Number(c.codeTimeoutMs) || 60000 };
}

// files: { <store>: { type: "local", path } | { type: "sftp", host, port, user, password | privateKey, passphrase, root }, write?: true }
function getFiles() {
  const c = resolved('files');
  return Object.fromEntries(Object.entries(c).map(([name, x]) => [name, { name, ...x, type: x.type || (x.host ? 'sftp' : 'local'), write: x.write === true }]));
}

// timeouts: { pgQueryMs (pg_query and tools, default 60 s), pgIndexMs (catalog sync, default 2 min),
//            catalogSyncWaitMs (how long the catalog_sync tool waits before saying "still running") }
function getTimeouts() {
  const c = resolved('timeouts'), e = process.env;
  const n = (env, cfg, def) => Number(e[env] || cfg || def);
  return {
    pgQueryMs: n('DT_PG_QUERY_TIMEOUT_MS', c.pgQueryMs, 60000),
    pgIndexMs: n('DT_PG_INDEX_TIMEOUT_MS', c.pgIndexMs, 120000),
    catalogSyncWaitMs: n('DT_CATALOG_SYNC_WAIT_MS', c.catalogSyncWaitMs, 50000),
  };
}

// tests: running generated tests in workspaces. javaHome/maven/gradle default to JAVA_HOME and PATH (in compose:
// the jdk profile's /opt/jdk). pgUrl: a scratch Postgres where each run gets its own database (the testdb profile).
function getTests() {
  const c = resolved('tests'), e = process.env;
  const os = require('os');
  const m2 = path.join(os.homedir(), '.m2', 'repository');
  const at = (p) => (p ? path.resolve(HOME, p) : null);
  const there = (...ps) => ps.map(at).find(p => p && fs.existsSync(p)) || null;
  return {
    javaHome: there(c.javaHome, e.DT_JAVA_HOME, e.JAVA_HOME),
    maven: there(c.maven, e.DT_MAVEN),
    gradle: there(c.gradle, e.DT_GRADLE),
    mavenRepo: at(c.mavenRepo || e.DT_MAVEN_REPO) || (fs.existsSync(m2) ? m2 : path.join(PATHS.cache, 'm2')),
    // a settings.xml for the company repository: tests.mavenSettings, or maven-settings.xml in the config folder
    mavenSettings: at(c.mavenSettings || e.DT_MAVEN_SETTINGS) || (fs.existsSync(path.join(HOME, 'maven-settings.xml')) ? path.join(HOME, 'maven-settings.xml') : null),
    gradleProperties: [].concat(c.gradleProperties || []),
    env: c.env && typeof c.env === 'object' ? c.env : {},
    // environment variables of dt passed to builds besides PATH, HOME, locale, proxies and JAVA_HOME
    passEnv: [].concat(c.passEnv || []),
    workspaceDays: Number(e.DT_WORKSPACE_DAYS || c.workspaceDays || 7),
    gradleBuildCache: c.gradleBuildCache !== false,
    gradleHome: at(c.gradleUserHome || e.DT_GRADLE_USER_HOME),
    offline: String(e.DT_TESTS_OFFLINE || c.offline || '') === 'true' || c.offline === true,
    timeoutMs: Number(e.DT_TESTS_TIMEOUT_MS || c.timeoutMs || 900000),
    waitMs: Number(e.DT_TESTS_WAIT_MS || c.waitMs || 50000),
    scenarioConcurrency: Number(c.scenarioConcurrency ?? 2),
    // compile checks after each write (workspace_write, test_run files): on unless false; how long a write waits for the first classpath
    compileCheck: c.compileCheck !== false && e.DT_COMPILE_CHECK !== '0',
    compileFix: c.compileFix !== false && e.DT_COMPILE_FIX !== '0',
    compileWaitMs: Number(e.DT_COMPILE_WAIT_MS || c.compileWaitMs || 45000),
    pgUrl: c.pgUrl || e.DT_TEST_DB_URL || null,
    javaToolOptions: c.javaToolOptions !== undefined ? c.javaToolOptions : '-Dnet.bytebuddy.experimental=true',
    javaToolOptionsGradle: c.javaToolOptionsGradle === true,
    // the runner container that runs builds (compose: http://runner:4100); empty: builds run in dt itself
    runnerUrl: (c.runnerUrl !== undefined ? c.runnerUrl : e.DT_RUNNER_URL) || null,
    runnerToken: c.runnerToken || e.DT_RUNNER_TOKEN || null,
    args: [].concat(c.args || []),
  };
}

// server: { publicUrl, apiKey, trustNetwork, ratePerSec }; environment variables win (compose sets them)
function getServer() {
  const c = resolved('server');
  const e = process.env;
  return {
    publicUrl: trimUrl(e.DT_PUBLIC_URL || c.publicUrl) || `http://127.0.0.1:${e.DT_PUBLISHED_PORT || e.PORT || 4000}`,
    apiKey: e.DT_API_KEY || c.apiKey || null,
    trustNetwork: e.DT_TRUST_NETWORK !== undefined ? e.DT_TRUST_NETWORK === '1' : !!c.trustNetwork,
    ratePerSec: Number(e.DT_RATE_PER_SEC !== undefined && e.DT_RATE_PER_SEC !== '' ? e.DT_RATE_PER_SEC : c.ratePerSec ?? 1),
  };
}

// An endpoint of an env, or a clear error saying what to set.
function endpoint(name, kind) {
  const e = getEnv(name);
  if (!e[kind]) throw new Error(`${kind} not configured for ${e.name}: set envs.${e.name}.${kind} in ${path.basename(CONFIG_FILE)}`);
  return e[kind];
}

// push: workspace_push commits a workspace's changes and pushes them to a branch. Off unless push.enabled.
// Never to the repo's default branch, main, master or release/* (whatever the config says; push.protect
// adds patterns), and never forced. push.author: "Name <email>" of the commits (else git's own identity).
const NEVER_PUSH = ['main', 'master', 'release/*'];
function getPush() {
  const c = resolved('push');
  return {
    enabled: c.enabled === true || c.enabled === 'true',
    protect: [...new Set([...NEVER_PUSH, ...list(c.protect || [])])],
    author: c.author || null,
  };
}

module.exports = {
  ROOT, HOME, CONFIG_DIR: HOME, CONFIG_FILE, SECRETS_FILE, ENVS_FILE, PATHS, NEVER_PUSH,
  envNames, getEnv, getPersonal, getTools, getBrowser, siteUrl, getScripts, getFiles, getTimeouts, getTests, getPush, getServer, endpoint, reload, load,
  parseEnvFile, interpolate,
};
