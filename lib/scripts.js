// Saved scripts: repeatable actions, kept as JSON files in scripts/ (in the dt home), nested in
// collections by folder: scripts/orders/support/refund-check.json is "orders/support/refund-check".
//   { "description": "...",
//     "params": { "orderId": { "description": "...", "required": true }, "env": { "default": "dev" } },
//     "steps": [
//       { "tool": "pg_query", "args": { "env": "{{env}}", "sql": "select ..." }, "as": "order" },   dt tool
//       { "script": "shop/login" },                                                               another script
//       { "open": "shop.order" },                       browser: a site link from config, <orderId> from params
//       { "browser": "click", "args": { "element": "Refund button", "ref": "{{ref}}" } },          any Playwright MCP tool
//       { "browser": "snapshot", "as": "page" } ] }
// "{{name}}" takes a param or an earlier step's result ("as"), with dotted paths: {{order.rows.0.status}};
// "{{link:shop.order}}" is a site link URL. A step with "optional": true may fail without stopping the run.
// Browser steps run in dt's own browser session (the browser container); after them the network
// requests are learned as API routes (see routes.js).
const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

const DIR = PATHS.scripts;
const MAX_DEPTH = 5;
const ID = /^[a-z0-9][\w.-]*(\/[a-z0-9][\w.-]*)*$/i;

function file(id) {
  if (!ID.test(id || '') || id.split('/').some(s => s === '..' || s.startsWith('.'))) throw new Error(`bad script id "${id}": use collection/name, letters, digits, . _ -`);
  return path.join(DIR, `${id}.json`);
}

function get(id) {
  let text;
  try { text = fs.readFileSync(file(id), 'utf8'); } catch { throw new Error(`no script "${id}" (script_list shows them)`); }
  try { return { id, ...JSON.parse(text) }; } catch (e) { throw new Error(`script ${id}: ${e.message}`); }
}

function walk(dir, prefix = '') {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents.sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (e.name.startsWith('.') || e.name.startsWith('_')) return [];
    if (e.isDirectory()) return walk(path.join(dir, e.name), `${prefix}${e.name}/`);
    return e.name.endsWith('.json') ? [`${prefix}${e.name.slice(0, -5)}`] : [];
  });
}

// Scripts under a collection (or all), and the collection tree with counts.
function list(collection = '') {
  const pre = collection ? collection.replace(/\/+$/, '') + '/' : '';
  const ids = walk(DIR).filter(id => !pre || id.startsWith(pre));
  const scripts = ids.map(id => {
    try { const s = get(id); return { id, description: s.description || '', params: Object.keys(s.params || {}), steps: (s.steps || []).length, browser: (s.steps || []).some(x => x.browser || x.open) }; }
    catch (e) { return { id, error: e.message }; }
  });
  const collections = {};
  for (const id of ids) {
    const parts = id.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) { const c = parts.slice(0, i).join('/'); collections[c] = (collections[c] || 0) + 1; }
  }
  return { collection: collection || '', collections: Object.entries(collections).map(([c, n]) => ({ collection: c, scripts: n })), scripts };
}

const KINDS = ['tool', 'script', 'browser', 'open', 'wait'];
function validate(def) {
  if (!def || typeof def !== 'object') throw new Error('script must be an object');
  if (!def.description) throw new Error('description required (say what it does and when to use it)');
  if (!Array.isArray(def.steps) || !def.steps.length) throw new Error('steps required: a non-empty list');
  def.steps.forEach((s, i) => {
    const kinds = KINDS.filter(k => s && s[k] !== undefined);
    if (kinds.length !== 1) throw new Error(`step ${i + 1}: needs exactly one of ${KINDS.join(', ')}`);
    if (s.args !== undefined && (typeof s.args !== 'object' || Array.isArray(s.args))) throw new Error(`step ${i + 1}: args must be an object`);
    if (s.as !== undefined && !/^[a-z_]\w*$/i.test(s.as)) throw new Error(`step ${i + 1}: "as" must be a name`);
  });
  for (const [k, p] of Object.entries(def.params || {})) if (!/^\w+$/.test(k) || (p && typeof p !== 'object')) throw new Error(`param ${k}: use { "description", "default", "required" }`);
}

function save(id, def) {
  const f = file(id);
  const { id: _, ...body } = def;
  validate(body);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const existed = fs.existsSync(f);
  fs.writeFileSync(f, JSON.stringify({ ...body, savedAt: new Date().toISOString() }, null, 2) + '\n');
  return { id, saved: true, replaced: existed, file: path.relative(require('./config').HOME, f) };
}

function remove(id) {
  const f = file(id);
  if (!fs.existsSync(f)) throw new Error(`no script "${id}"`);
  fs.unlinkSync(f);
  // drop collections left empty
  for (let d = path.dirname(f); d.startsWith(DIR + path.sep); d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }
  }
  return { id, deleted: true };
}

// ── running ──
const dig = (o, keys) => keys.reduce((v, k) => (v == null ? undefined : v[k]), o);

function lookup(expr, scope) {
  expr = expr.trim();
  if (expr.startsWith('link:')) return require('./config').siteUrl(expr.slice(5).trim(), scope);
  const keys = expr.split('.');
  const v = dig(scope, keys);
  if (v === undefined) throw new Error(`{{${expr}}} is not set (params: ${Object.keys(scope).join(', ') || 'none'})`);
  return v;
}

// Strings with {{...}}; a string that is only "{{x}}" keeps x's type.
function fill(value, scope) {
  if (Array.isArray(value)) return value.map(v => fill(v, scope));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, scope)]));
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  const whole = value.match(/^\{\{([^}]+)\}\}$/);
  if (whole) return lookup(whole[1], scope);
  return value.replace(/\{\{([^}]+)\}\}/g, (m, e) => { const v = lookup(e, scope); return typeof v === 'object' ? JSON.stringify(v) : String(v); });
}

function params(def, given = {}) {
  const out = { ...given };
  for (const [k, p] of Object.entries(def.params || {})) {
    if ((out[k] === undefined || out[k] === '') && p && p.default !== undefined) out[k] = p.default;
    if ((out[k] === undefined || out[k] === '') && p && p.required) throw new Error(`script ${def.id}: missing param ${k}${p.description ? ` (${p.description})` : ''}`);
  }
  return out;
}

const brief = (v, n = 3000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)} ... [${s.length - n} more chars]` : v;
};
const browserTool = (name) => (name.startsWith('browser_') ? name : `browser_${name}`);

async function runSteps(def, scope, st) {
  for (const [i, step] of def.steps.entries()) {
    const started = Date.now();
    const label = step.tool ? `tool ${step.tool}` : step.script ? `script ${step.script}` : step.browser ? `browser ${browserTool(step.browser)}` : step.open ? `open ${step.open}` : `wait ${step.wait}`;
    const rec = { script: def.id, step: i + 1, do: label };
    st.log.push(rec);
    try {
      let result;
      if (step.tool) {
        if (step.tool.startsWith('script_')) throw new Error('use a "script" step to run another script');
        result = await require('./tools').call(step.tool, fill(step.args || {}, scope));
      } else if (step.script) {
        if (st.depth >= MAX_DEPTH) throw new Error(`scripts nest deeper than ${MAX_DEPTH}`);
        const sub = get(step.script);
        st.depth++;
        try { result = await runSteps(sub, params(sub, fill(step.params || step.args || {}, scope)), st); } finally { st.depth--; }
      } else if (step.wait !== undefined) {
        const w = fill(step.wait, scope);
        result = (await browser(st).call('browser_wait_for', typeof w === 'number' ? { time: w } : { text: String(w) })).text;
      } else {
        const b = browser(st);
        const [name, args] = step.open ? ['browser_navigate', { url: /^https?:\/\//.test(step.open) ? fill(step.open, scope) : require('./config').siteUrl(fill(step.open, scope), scope) }] : [browserTool(step.browser), fill(step.args || {}, scope)];
        if (name === 'browser_navigate') st.pages.add(args.url);
        result = (await b.call(name, args)).text;
      }
      if (step.as) scope[step.as] = result;
      Object.assign(rec, { ok: true, ms: Date.now() - started, result: brief(result) });
    } catch (e) {
      Object.assign(rec, { ok: false, ms: Date.now() - started, error: e.message });
      if (!step.optional) throw Object.assign(e, { scriptStep: rec });
    }
  }
  return scope;
}

function browser(st) {
  if (!st.browser) st.browser = require('./browser-mcp').session();
  return st.browser;
}

// Run a saved script (or an unsaved definition, for routes_discover). -> { ok, steps: [...], results, routes }
async function run(idOrDef, given = {}, { source } = {}) {
  const def = typeof idOrDef === 'string' ? get(idOrDef) : { id: '(inline)', ...idOrDef };
  const st = { log: [], depth: 0, browser: null, pages: new Set() };
  const scope = params(def, given);
  const keys = new Set(Object.keys(scope));
  let error = null;
  try { await runSteps(def, scope, st); } catch (e) { error = e.message; }
  let routes;
  if (st.browser) {
    try {
      const seen = require('./routes').parseNetwork((await st.browser.call('browser_network_requests', {})).text).filter(r => !st.pages.has(r.url)); // pages opened are not API calls
      routes = require('./routes').learn(seen, source || `script:${def.id}`);
    }
    catch (e) { routes = { error: e.message }; }
    await st.browser.close();
  }
  const results = Object.fromEntries(Object.entries(scope).filter(([k]) => !keys.has(k)).map(([k, v]) => [k, brief(v, 6000)]));
  return { script: def.id, ok: !error, ...(error ? { error } : {}), steps: st.log, results, ...(routes ? { routes } : {}) };
}

module.exports = { list, get, save, remove, run, fill, validate, DIR };
