// `dt migrate-config`: the older layout (envs.json + .env.<env> + .env.personal + .env.browser) becomes
// config.json (structure; plain values inlined) + one .env (secrets). Per-env secrets get the env name as
// a prefix (DEV_DATABASE_URL_ORDERS) so environments cannot collide. Old files are left in place.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SECRETISH = /(DATABASE_URL|PASS|PASSWORD|TOKEN|SECRET|API_KEY|_KEY$|_USER$|USERNAME|LOGIN)/i;
const MARK = '\u0000';

// drop nulls, empty strings, empty objects/arrays
function clean(v) {
  if (Array.isArray(v)) { const a = v.map(clean).filter(x => x !== undefined); return a.length ? a : undefined; }
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]).filter(([, x]) => x !== undefined));
    return Object.keys(o).length ? o : undefined;
  }
  return v === null || v === '' ? undefined : v;
}

function plan() {
  if (fs.existsSync(config.CONFIG_FILE)) throw new Error(`${config.CONFIG_FILE} already exists`);
  const s = config.load();
  if (s.format !== 'legacy') throw new Error('nothing to migrate');
  const raw = s.raw;
  const secrets = {};      // new .env entries
  const personal = { ...config.parseEnvFile(path.join(config.HOME, '.env.browser')), ...config.parseEnvFile(path.join(config.HOME, '.env.personal')) };
  for (const [k, v] of Object.entries(personal)) secrets[k] = v;

  // resolve plain values, keep secrets as references (renamed per env)
  // set secrets -> references; unset secrets only when nothing else in a fallback chain is set
  const resolveWith = (lookup, rename) => {
    const one = (str) => {
      const pass = (keepUnset) => config.interpolate(str, (name) => {
        const v = lookup(name);
        if (!SECRETISH.test(name)) return v;
        if ((v === undefined || v === '') && !keepUnset) return undefined;
        return `${MARK}${rename(name, v)}${MARK}`;
      });
      let r = pass(false);
      if (r === null || r === '') r = pass(true); // empty line in .env to fill in
      return typeof r === 'string' ? r.replace(new RegExp(`${MARK}(\\w+)${MARK}`, 'g'), '${$1}') : r;
    };
    const walk = (x) => (typeof x === 'string' ? one(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x);
    return walk;
  };

  const out = { envs: {} };
  for (const [name, def] of Object.entries(raw.envs)) {
    const fileVars = def.envFile ? config.parseEnvFile(path.join(config.HOME, def.envFile)) : {};
    const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_';
    const lookup = (k) => fileVars[k] ?? personal[k];
    const rename = (k, v) => {
      if (k in personal && !(k in fileVars)) return k; // shared (.env.personal): keep the name
      const nk = k.startsWith(prefix) ? k : prefix + k;
      secrets[nk] = v ?? secrets[nk] ?? '';
      return nk;
    };
    const r = resolveWith(lookup, rename);
    const { envFile, ...rest } = def;
    const e = r(rest);
    if (def.postgres === 'auto') {
      e.postgres = {};
      for (const [k, url] of Object.entries(fileVars)) {
        const m = k.match(/^DATABASE_URL(?:_(\w+))?$/);
        if (m && url) e.postgres[m[1] ? m[1].toLowerCase() : decodeURIComponent(new URL(url).pathname.slice(1))] = `\${${rename(k, url)}}`;
      }
    }
    // the default log field names need not be spelled out
    const DEF = { time: '@timestamp', message: 'message', service: 'service.name', level: 'log.level', trace: 'trace.id' };
    if (e.logs && e.logs.fields) for (const [k, v] of Object.entries(e.logs.fields)) if (DEF[k] === v) delete e.logs.fields[k];
    if (e.logs && e.logs.index === 'logs-*') delete e.logs.index;
    if (e.elasticsearch && typeof e.elasticsearch.hosts === 'string') e.elasticsearch.hosts = e.elasticsearch.hosts.split(',').map(x => x.trim()).filter(Boolean);
    out.envs[name] = clean(e) || {};
  }
  const r = resolveWith((k) => personal[k], (k, v) => { secrets[k] = v ?? secrets[k] ?? ''; return k; });
  out.bitbucket = r(raw.bitbucket);
  out.confluence = r(raw.confluence);
  const groups = config.interpolate(raw.passports.internalGroups, (k) => personal[k]);
  out.passports = { internalGroups: String(groups || '').split(',').map(x => x.trim()).filter(Boolean) };
  out.graph = { url: '${GRAPH_URL}' };
  out.tools = { enable: ['all'], disable: [], plugins: [], custom: [] };
  out.browser = { sites: Object.fromEntries(Object.entries(raw.browser.sites).map(([k, v]) => [k, { url: config.interpolate(v.url, (x) => personal[x]), secrets: v.secrets }])) };
  const cleaned = clean(out);
  cleaned.tools = out.tools;
  return { config: cleaned, secrets };
}

const envLine = (k, v) => `${k}=${/^[\w@%+=:,./-]*$/.test(v) ? v : !v.includes("'") ? `'${v}'` : JSON.stringify(v)}`;

function migrate({ write = true } = {}) {
  const p = plan();
  if (!write) return p;
  if (fs.existsSync(config.SECRETS_FILE)) throw new Error(`${config.SECRETS_FILE} already exists; move it away first`);
  fs.writeFileSync(config.CONFIG_FILE, JSON.stringify(p.config, null, 2) + '\n');
  fs.writeFileSync(config.SECRETS_FILE, '# secrets and compose settings for dt (migrated)\n' + Object.entries(p.secrets).map(([k, v]) => envLine(k, String(v))).join('\n') + '\n', { mode: 0o600 });
  config.reload();
  const old = fs.readdirSync(config.HOME).filter(f => f === 'envs.json' || (/^\.env\.[\w-]+$/.test(f) && !f.endsWith('.example')));
  return { wrote: [config.CONFIG_FILE, config.SECRETS_FILE], envs: Object.keys(p.config.envs), secrets: Object.keys(p.secrets).length, oldFiles: old, note: 'config.json is used from now on; check both files, then delete the old ones' };
}

module.exports = { migrate, plan };
