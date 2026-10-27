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
// JS (sandboxed, lib/js.js): { "js": "code" } steps; on any step "before" (args), "capture" { var: "path" }, "after"
// (result, test/expect); the script and its collections also have "vars", "before", "after".
// "{{link:shop.order}}" is a site link URL. Generators: {{uuid}}, {{now}}, {{date:YYYYMMDD-HHmmss}}, {{rand:6}}
// (digits), {{hex:8}}. A step with "optional": true may fail without stopping the run.
// More step kinds:
//   { "set": { "folder": "out/{{date:YYYYMMDD}}/{{uuid}}" } }                 compute values once, use as {{folder}}
//   { "transform": "{{doc.text}}", "replace": [{ "find": "ORD-\\d+", "regex": true, "with": "ORD-{{rand:6}}" }],
//     "json": { "order.id": "{{uuid}}", "items.*.sku": "X" }, "as": "copy" }    rewrite text; the same match gets the same new value
//   { "http": "POST https://api.dev.example.com/imports", "body": { "folder": "{{folder}}" }, "as": "res" }
//                                       only to URL prefixes in config.json scripts.http.allow
// "tool": true (or a name) on a script, or on a collection (scripts/<collection>/_collection.json), makes it a
// tool of its own. Scripts can be called by id, by name, or by a fuzzy name ("refund check").
// Browser steps run in dt's own browser session (the browser container); after them the network
// requests are learned as API routes (see routes.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('./config');

const DIR = PATHS.scripts;
const MAX_DEPTH = 5;
const ID = /^[a-z0-9][\w.-]*(\/[a-z0-9][\w.-]*)*$/i;

function file(id) {
  if (!ID.test(id || '') || id.split('/').some(s => s === '..' || s.startsWith('.'))) throw new Error(`bad script id "${id}": use collection/name, letters, digits, . _ -`);
  return path.join(DIR, `${id}.json`);
}

// ── names: exact id, "name" or "collection/name" suffix, else a fuzzy match on id + description ──
const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const subseq = (w, h) => { let i = 0; for (const c of h) if (c === w[i]) i++; return i === w.length; };

function resolve(q, within = '') {
  q = String(q || '').trim().replace(/\.json$/, '');
  if (!q) throw new Error('script id or name required');
  const pre = within ? `${within}/` : '';
  const ids = walk(DIR).filter(id => id.startsWith(pre));
  if (ids.includes(q) || ids.includes(pre + q)) return ids.includes(q) ? q : pre + q;
  const nq = norm(q);
  const named = ids.filter(id => norm(id.split('/').pop()) === nq || id.endsWith(`/${q}`));
  if (named.length === 1) return named[0];
  const words = nq.split(' ').filter(Boolean);
  const scored = (named.length ? named : ids).map(id => {
    let desc = '';
    try { desc = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')).description || ''; } catch {}
    const idn = norm(id), all = `${idn} ${norm(desc)}`;
    const score = words.reduce((n, w) => n + (idn.includes(w) ? 2 : all.includes(w) ? 1 : subseq(w, idn.replace(/ /g, '')) ? 1 : 0), 0) / (2 * words.length);
    return { id, score };
  }).filter(x => x.score >= 0.5).sort((a, b) => b.score - a.score || a.id.length - b.id.length);
  if (!scored.length) throw new Error(`no script matches "${q}"${within ? ` in ${within}` : ''} (script_list shows them)`);
  if (scored.length === 1 || scored[0].score > scored[1].score) return scored[0].id;
  throw new Error(`"${q}" matches several scripts: ${scored.slice(0, 6).map(x => x.id).join(', ')}; use the id`);
}

function get(id) {
  let exact = false;
  try { exact = fs.existsSync(file(id)); } catch {}
  if (!exact) id = resolve(id);
  let text;
  try { text = fs.readFileSync(file(id), 'utf8'); } catch { throw new Error(`no script "${id}" (script_list shows them)`); }
  try { return { id, ...JSON.parse(text) }; } catch (e) { throw new Error(`script ${id}: ${e.message}`); }
}

function walk(dir, prefix = '', folders = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents.sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (e.name.startsWith('.') || e.name.startsWith('_')) return [];
    if (e.isDirectory()) { folders.push(`${prefix}${e.name}`); return walk(path.join(dir, e.name), `${prefix}${e.name}/`, folders); }
    return e.name.endsWith('.json') ? [`${prefix}${e.name.slice(0, -5)}`] : [];
  });
}

// Scripts under a collection (or all), and every collection (folders, also empty ones) with counts.
function list(collection = '') {
  const pre = collection ? collection.replace(/\/+$/, '') + '/' : '';
  const folders = [];
  const ids = walk(DIR, '', folders).filter(id => !pre || id.startsWith(pre));
  const scripts = ids.map(id => {
    try { const s = get(id); return { id, description: s.description || '', params: Object.keys(s.params || {}), steps: (s.steps || []).length, browser: (s.steps || []).some(x => x.browser || x.open), js: !!(s.before || s.after || (s.steps || []).some(x => x.js !== undefined || x.before || x.after)), tool: s.tool ? toolName(s.tool, id) : null }; }
    catch (e) { return { id, error: e.message }; }
  });
  const collections = folders.filter(c => !pre || `${c}/`.startsWith(pre)).map(c => ({ collection: c, scripts: ids.filter(id => id.startsWith(`${c}/`)).length }));
  return { collection: collection || '', collections, scripts };
}

// ── collections are folders: create, move/rename (scripts and folders), delete ──
function folder(p) {
  const id = String(p || '').replace(/^\/+|\/+$/g, '');
  file(id || 'x'); // same naming rules as ids
  return { id, dir: path.join(DIR, id) };
}

function mkdir(p) {
  const f = folder(p);
  if (!f.id) throw new Error('collection name required');
  fs.mkdirSync(f.dir, { recursive: true });
  return { collection: f.id, created: true };
}

// from/to are script ids, or collections (folders). Moving into an existing collection: to = "<collection>/<name>".
function move(from, to) {
  const src = String(from || '').replace(/\/+$/, ''), dst = String(to || '').replace(/\/+$/, '');
  if (!src || !dst) throw new Error('from and to required');
  if (src === dst) return { from: src, to: dst, moved: false };
  const isScript = fs.existsSync(file(src));
  const a = isScript ? file(src) : folder(src).dir;
  const b = isScript ? file(dst) : folder(dst).dir;
  if (!isScript && !fs.existsSync(a)) throw new Error(`no script or collection "${src}"`);
  if (!isScript && (dst + '/').startsWith(src + '/')) throw new Error('cannot move a collection into itself');
  if (fs.existsSync(b)) throw new Error(`"${dst}" already exists`);
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(a, b);
  return { from: src, to: dst, kind: isScript ? 'script' : 'collection', moved: true };
}

function removeFolder(p) {
  const f = folder(p);
  if (!f.id || !fs.existsSync(f.dir)) throw new Error(`no collection "${p}"`);
  const n = walk(f.dir).length;
  fs.rmSync(f.dir, { recursive: true });
  return { collection: f.id, deleted: true, scripts: n };
}

// ── collection settings: scripts/<collection>/_collection.json { description, tool } ──
const META = '_collection.json';
const toolName = (t, id) => (typeof t === 'string' && t ? t : String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 's_$1'));

function getCollection(p) {
  const f = folder(p);
  if (!f.id || !fs.existsSync(f.dir)) throw new Error(`no collection "${p}"`);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(f.dir, META), 'utf8')); } catch {}
  return { collection: f.id, description: meta.description || '', tool: meta.tool || false, toolName: meta.tool ? toolName(meta.tool, f.id) : null, vars: meta.vars || {}, before: meta.before || '', after: meta.after || '', scripts: walk(f.dir).map(x => `${f.id}/${x}`) };
}

function setCollection(p, { description = '', tool = false, vars = {}, before = '', after = '' } = {}) {
  const f = folder(p);
  if (!f.id || !fs.existsSync(f.dir)) throw new Error(`no collection "${p}"`);
  if (tool && !/^[a-z][a-z0-9_]{1,63}$/.test(toolName(tool, f.id))) throw new Error(`tool name "${toolName(tool, f.id)}": lowercase letters, digits and _`);
  if (vars && (typeof vars !== 'object' || Array.isArray(vars))) throw new Error('vars must be { "name": value }');
  for (const [h, v] of [['before', before], ['after', after]]) if (v && ![].concat(v).every(x => typeof x === 'string')) throw new Error(`${h} must be JavaScript`);
  const meta = { description: String(description || '').trim(), tool: tool || false, ...(vars && Object.keys(vars).length ? { vars } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}) };
  fs.writeFileSync(path.join(f.dir, META), JSON.stringify(meta, null, 2) + '\n');
  return getCollection(f.id);
}

// Scripts and collections marked "tool" -> tool definitions for the registry (lib/tools.js).
const PARAM_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
function exposed() {
  const folders = [];
  const ids = walk(DIR, '', folders);
  const out = [], errors = [];
  for (const id of ids) {
    let def;
    try { def = get(id); } catch { continue; }
    if (!def.tool) continue;
    const name = toolName(def.tool, id);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) { errors.push({ source: `script ${id}`, error: `tool name "${name}": lowercase letters, digits and _` }); continue; }
    const input = {}, required = [];
    for (const [k, p] of Object.entries(def.params || {})) {
      input[k] = { type: PARAM_TYPES.has(p && p.type) ? p.type : 'string', description: (p && p.description) || k, ...(p && p.default !== undefined ? { default: p.default } : {}) };
      if (p && p.required) required.push(k);
    }
    out.push({ name, group: 'scripts', origin: `script ${id}`, description: `${def.description || id} (saved script ${id}; returns each step and the named results)`, input, required, run: (a) => run(id, a, { source: 'tool' }) });
  }
  for (const c of folders) {
    const meta = getCollection(c);
    if (!meta.tool) continue;
    const name = toolName(meta.tool, c);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) { errors.push({ source: `collection ${c}`, error: `tool name "${name}": lowercase letters, digits and _` }); continue; }
    const items = meta.scripts.map(id => { try { const d = get(id); return { rel: id.slice(c.length + 1), d }; } catch { return null; } }).filter(Boolean);
    const lines = items.map(({ rel, d }) => `- ${rel}: ${d.description || ''}${Object.keys(d.params || {}).length ? ` (params: ${Object.entries(d.params).map(([k, p]) => `${k}${p && p.required ? '*' : ''}`).join(', ')})` : ''}`);
    out.push({
      name, group: 'scripts', origin: `collection ${c}`,
      description: `${meta.description || `Saved scripts of the ${c} collection`}. Run one by name (a close name is enough):\n${lines.join('\n') || '(empty)'}`,
      input: { script: { type: 'string', description: 'Script name in this collection', ...(items.length ? { enum: items.map(x => x.rel) } : {}) }, params: { type: 'object', description: 'Its params', additionalProperties: true } },
      required: ['script'],
      run: (a) => run(resolve(a.script, c), a.params || {}, { source: 'tool' }),
    });
  }
  return { tools: out, errors };
}

// Changes under scripts/ (files and folders), so the tool registry knows when to rebuild.
function signature() {
  const parts = [];
  const visit = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      try { parts.push(`${f}:${fs.statSync(f).mtimeMs}`); } catch {}
      if (e.isDirectory()) visit(f);
    }
  };
  visit(DIR);
  return crypto.createHash('sha1').update(parts.sort().join('|')).digest('hex');
}

function copy(from, to) {
  const s = get(from);
  const { id, savedAt, ...def } = s;
  if (fs.existsSync(file(to))) throw new Error(`"${to}" already exists`);
  return save(to, def);
}

const KINDS = ['tool', 'script', 'browser', 'open', 'wait', 'set', 'transform', 'http', 'js'];
function validate(def) {
  if (!def || typeof def !== 'object') throw new Error('script must be an object');
  if (!def.description) throw new Error('description required (say what it does and when to use it)');
  if (!Array.isArray(def.steps) || !def.steps.length) throw new Error('steps required: a non-empty list');
  def.steps.forEach((s, i) => {
    const kinds = KINDS.filter(k => s && s[k] !== undefined);
    if (kinds.length !== 1) throw new Error(`step ${i + 1}: needs exactly one of ${KINDS.join(', ')}`);
    if (s.args !== undefined && (typeof s.args !== 'object' || Array.isArray(s.args))) throw new Error(`step ${i + 1}: args must be an object`);
    if (s.as !== undefined && !/^[a-z_]\w*$/i.test(s.as)) throw new Error(`step ${i + 1}: "as" must be a name`);
    if (s.set !== undefined && (!s.set || typeof s.set !== 'object' || Array.isArray(s.set))) throw new Error(`step ${i + 1}: set must be { "name": value }`);
    if (s.transform !== undefined && s.replace !== undefined && !Array.isArray(s.replace)) throw new Error(`step ${i + 1}: replace must be a list of { find, with }`);
    if (s.http !== undefined && !/^(GET|POST|PUT|PATCH|DELETE)\s+\S+$/i.test(String(s.http))) throw new Error(`step ${i + 1}: http must be "METHOD url"`);
    for (const h of ['before', 'after', 'js']) if (s[h] !== undefined && ![].concat(s[h]).every(x => typeof x === 'string')) throw new Error(`step ${i + 1}: ${h} must be JavaScript (a string, or a list of lines)`);
    if (s.capture !== undefined && (typeof s.capture !== 'object' || Array.isArray(s.capture) || !Object.entries(s.capture).every(([k, v]) => /^[a-z_]\w*$/i.test(k) && typeof v === 'string'))) throw new Error(`step ${i + 1}: capture must be { "name": "path.in.result" }`);
  });
  for (const [k, p] of Object.entries(def.params || {})) if (!/^\w+$/.test(k) || (p && typeof p !== 'object')) throw new Error(`param ${k}: use { "description", "default", "required" }`);
  for (const h of ['before', 'after']) if (def[h] !== undefined && ![].concat(def[h]).every(x => typeof x === 'string')) throw new Error(`${h} must be JavaScript (a string, or a list of lines)`);
  if (def.vars !== undefined && (typeof def.vars !== 'object' || Array.isArray(def.vars))) throw new Error('vars must be { "name": value }');
  if (def.tool && typeof def.tool === 'string' && !/^[a-z][a-z0-9_]{1,63}$/.test(def.tool)) throw new Error(`tool name "${def.tool}": lowercase letters, digits and _`);
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
  fs.unlinkSync(f); // its collection stays, even when empty
  return { id, deleted: true };
}

// ── running ──
const dig = (o, keys) => keys.reduce((v, k) => (v == null ? undefined : v[k]), o);

const pad = (n, w = 2) => String(n).padStart(w, '0');
function fmtDate(d, f) {
  return f.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, (t) => ({ YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), SSS: pad(d.getMilliseconds(), 3) }[t]));
}
// value generators, used when no param or result has that name
function generate(expr) {
  let m;
  if (expr === 'uuid') return crypto.randomUUID();
  if (expr === 'now') return new Date().toISOString();
  if (expr === 'timestamp') return Date.now();
  if ((m = expr.match(/^date(?::(.+))?$/))) return fmtDate(new Date(), m[1] || 'YYYY-MM-DD');
  if ((m = expr.match(/^rand:(\d{1,3})$/))) return Array.from(crypto.randomBytes(Number(m[1])), b => b % 10).join('').replace(/^0/, '1');
  if ((m = expr.match(/^hex:(\d{1,3})$/))) return crypto.randomBytes(Math.ceil(Number(m[1]) / 2)).toString('hex').slice(0, Number(m[1]));
  return undefined;
}

function lookup(expr, scope) {
  expr = expr.trim();
  if (expr.startsWith('link:')) return require('./config').siteUrl(expr.slice(5).trim(), scope);
  const keys = expr.split('.');
  let v = dig(scope, keys);
  if (v === undefined) v = generate(expr);
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

// The input of a step (what a before hook sees as `args`), and running a step from it.
function stepInput(step, scope) {
  if (step.tool) return fill(step.args || {}, scope);
  if (step.browser) return fill(step.args || {}, scope);
  if (step.script) return fill(step.params || step.args || {}, scope);
  if (step.open) return { url: /^https?:\/\//.test(step.open) ? fill(step.open, scope) : require('./config').siteUrl(fill(step.open, scope), scope) };
  if (step.http) { const [, method, url] = String(step.http).match(/^(\w+)\s+(\S+)$/); return { method: method.toUpperCase(), url: fill(url, scope), headers: fill(step.headers || {}, scope), ...(step.body !== undefined ? { body: fill(step.body, scope) } : {}) }; }
  if (step.set) return fill(step.set, scope);
  if (step.transform !== undefined) return { text: fill(step.transform, scope) };
  if (step.wait !== undefined) return { wait: fill(step.wait, scope) };
  return {};
}

const kindOf = (step) => KINDS.find(k => step[k] !== undefined);
const label = (step) => (step.tool ? `tool ${step.tool}` : step.script ? `script ${step.script}` : step.browser ? `browser ${browserTool(step.browser)}` : step.open ? `open ${step.open}`
  : step.set ? `set ${Object.keys(step.set).join(', ')}` : step.transform !== undefined ? 'transform' : step.http ? `http ${String(step.http).split(/\s+/)[0].toUpperCase()}`
  : step.js !== undefined ? 'js' : `wait ${step.wait}`);

// "rows.0.id", "rows[0].id", "" (the whole result)
const capturePath = (v, p) => (!p || p === '.' || p === '$' ? v : dig(v, String(p).replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)));

// Run a hook (JS) against the scope; keep its vars, logs and tests. -> the sandbox output
async function hook(code, st, where, { scope, args, result }) {
  if (!st.js) st.js = new (require('./js').Session)();
  const onTool = (name, a) => {
    if (name === '__list') return require('./tools').schemas().then(ts => ts.map(t => ({ name: t.name, description: t.description.split('. ')[0] })));
    return require('./tools').call(name, a, { source: `script:${where.script}` });
  };
  const r = await st.js.run([].concat(code).join('\n'), { vars: scope, args, result }, { onTool, timeoutMs: [].concat(code).join('\n').includes('tools.') ? require('./config').getScripts().codeTimeoutMs : undefined });
  if (r.vars && typeof r.vars === 'object') { for (const k of Object.keys(scope)) if (!(k in r.vars)) delete scope[k]; Object.assign(scope, r.vars); }
  for (const msg of r.logs || []) st.logs.push({ ...where, msg });
  for (const t of r.tests || []) st.tests.push({ ...where, ...t });
  if (r.error) throw new Error(`${where.hook}: ${r.error}`);
  return r;
}

async function runSteps(def, scope, st) {
  for (const [i, step] of def.steps.entries()) {
    const started = Date.now();
    const rec = { script: def.id, step: i + 1, do: label(step) };
    const where = { script: def.id, step: i + 1 };
    st.log.push(rec);
    try {
      let input = stepInput(step, scope);
      if (step.before) {
        const r = await hook(step.before, st, { ...where, hook: 'before' }, { scope, args: input });
        input = r.hasReturn && r.returned && typeof r.returned === 'object' ? r.returned : r.args;
        input = fill(input, scope); // the hook may have set vars the args refer to
      }
      let result;
      const k = kindOf(step);
      if (k === 'tool') {
        if (step.tool.startsWith('script_')) throw new Error('use a "script" step to run another script');
        result = await require('./tools').call(step.tool, input, { source: `script:${def.id}` });
      } else if (k === 'set') {
        result = input;
        Object.assign(scope, result);
      } else if (k === 'transform') {
        const t = transform(input.text, step, scope);
        result = t.text;
        rec.detail = { replaced: t.replaced, map: t.map };
      } else if (k === 'http') {
        result = await httpStep(input, step);
      } else if (k === 'js') {
        const r = await hook(step.js, st, { ...where, hook: 'js' }, { scope, result: st.last });
        result = r.hasReturn ? r.returned : null;
      } else if (k === 'script') {
        if (st.depth >= MAX_DEPTH) throw new Error(`scripts nest deeper than ${MAX_DEPTH}`);
        const sub = get(step.script);
        st.depth++;
        try { result = await runScript(sub, params(sub, input), st); } finally { st.depth--; }
      } else if (k === 'wait') {
        const w = input.wait;
        result = (await browser(st).call('browser_wait_for', typeof w === 'number' ? { time: w } : { text: String(w) })).text;
      } else {
        const [name, args] = k === 'open' ? ['browser_navigate', input] : [browserTool(step.browser), input];
        if (name === 'browser_navigate') st.pages.add(args.url);
        result = (await browser(st).call(name, args)).text;
      }
      // after the step: captures into vars, then the after hook (may replace the result, run tests)
      for (const [name, p] of Object.entries(step.capture || {})) {
        const v = capturePath(result, p);
        if (v === undefined) throw new Error(`capture ${name}: no "${p}" in the result`);
        scope[name] = v;
      }
      if (step.after) {
        const r = await hook(step.after, st, { ...where, hook: 'after' }, { scope, result });
        if (r.hasReturn) result = r.returned;
      }
      if (step.as) scope[step.as] = result;
      st.last = result;
      if (result && typeof result === 'object' && typeof result.view === 'string' && /^https?:/.test(result.view)) st.lastView = result.view;
      Object.assign(rec, { ok: true, ms: Date.now() - started, result: rec.detail ? { ...rec.detail, text: brief(result, 1500) } : brief(result) });
      delete rec.detail;
    } catch (e) {
      Object.assign(rec, { ok: false, ms: Date.now() - started, error: e.message });
      delete rec.detail;
      if (!step.optional) throw Object.assign(e, { scriptStep: rec });
    }
  }
  return scope;
}

// One script with its collections' vars and hooks (outermost collection first, like Postman):
// collection vars < script vars < params; before hooks, the steps, then after hooks.
function chain(id) {
  const parts = String(id || '').split('/').slice(0, -1);
  const out = [];
  for (let n = 1; n <= parts.length; n++) {
    try { const m = JSON.parse(fs.readFileSync(path.join(DIR, ...parts.slice(0, n), META), 'utf8')); out.push({ collection: parts.slice(0, n).join('/'), ...m }); } catch {}
  }
  return out;
}

async function runScript(def, scope, st) {
  const cols = chain(def.id);
  for (const c of cols) for (const [k, v] of Object.entries(c.vars || {})) if (scope[k] === undefined) scope[k] = fill(v, scope);
  for (const [k, v] of Object.entries(def.vars || {})) if (scope[k] === undefined) scope[k] = fill(v, scope);
  const where = { script: def.id, step: 0 };
  for (const c of cols) if (c.before) await hook(c.before, st, { ...where, hook: `before (${c.collection})` }, { scope });
  if (def.before) await hook(def.before, st, { ...where, hook: 'before' }, { scope });
  await runSteps(def, scope, st);
  if (def.after) await hook(def.after, st, { ...where, step: def.steps.length + 1, hook: 'after' }, { scope, result: st.last });
  for (const c of [...cols].reverse()) if (c.after) await hook(c.after, st, { ...where, step: def.steps.length + 1, hook: `after (${c.collection})` }, { scope, result: st.last });
  return scope;
}

// Rewrite a text (or JSON value): regex/plain replacements and JSON paths. Each distinct match gets one new
// value, so an id that appears in several places is replaced the same way everywhere.
function transform(input, step, scope) {
  let text = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const map = {};
  let replaced = 0;
  for (const r of [].concat(step.replace || [])) {
    if (!r || r.find === undefined) throw new Error('replace entries need "find" and "with"');
    const re = r.regex ? new RegExp(r.find, (r.flags || '').includes('g') ? r.flags : `${r.flags || ''}g`) : new RegExp(String(r.find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const seen = {};
    text = text.replace(re, (...m) => {
      const match = m[0];
      replaced++;
      if (r.consistent !== false && match in seen) return seen[match];
      const groups = m.slice(1, -2);
      const v = String(fill(r.with ?? '', { ...scope, match, group: groups }));
      seen[match] = v; map[match] = v;
      return v;
    });
  }
  if (step.json) {
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`transform json: the text is not JSON (${e.message})`); }
    for (const [p, val] of Object.entries(step.json)) {
      const n = setPath(doc, p.split('.'), (old) => { const v = fill(val, { ...scope, value: old }); if (typeof old !== 'object') map[String(old)] = v; return v; });
      if (!n) throw new Error(`transform json: no "${p}" in the document`);
      replaced += n;
    }
    text = JSON.stringify(doc, null, /\n/.test(typeof input === 'string' ? input : '\n') ? 2 : 0);
  }
  return { text, replaced, map };
}

function setPath(o, keys, f) {
  if (o == null || typeof o !== 'object') return 0;
  const [k, ...rest] = keys;
  const targets = k === '*' ? Object.keys(o) : k in o ? [k] : [];
  let n = 0;
  for (const t of targets) {
    if (!rest.length) { o[t] = f(o[t]); n++; } else n += setPath(o[t], rest, f);
  }
  return n;
}

// "METHOD url" with optional headers and body, only to URL prefixes allowed in config.json (scripts.http.allow).
async function httpStep(input, step) {
  const { method, url, headers = {} } = input;
  const allow = require('./config').getScripts().httpAllow;
  if (!allow.some(a => url.startsWith(a))) throw new Error(`http to ${url} is not allowed: add its URL prefix to scripts.http.allow in config.json${allow.length ? ` (allowed: ${allow.join(', ')})` : ''}`);
  await require('./limit').take(`http:${new URL(url).host}`);
  let body = input.body;
  if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'; }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(step.timeoutMs || 30000) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  const out = { status: res.status, ...(json !== undefined ? { json } : { text: text.slice(0, 20000) }) };
  if (!res.ok && !step.allowErrors) throw new Error(`HTTP ${res.status} from ${method} ${url}: ${text.slice(0, 300)}`);
  return out;
}

function browser(st) {
  if (!st.browser) st.browser = require('./browser-mcp').session();
  return st.browser;
}

// Run a saved script (or an unsaved definition, for routes_discover). -> { ok, steps: [...], results, routes }
async function run(idOrDef, given = {}, { source } = {}) {
  const def = typeof idOrDef === 'string' ? get(idOrDef) : { id: '(inline)', ...idOrDef };
  const st = { log: [], logs: [], tests: [], depth: 0, browser: null, pages: new Set(), last: undefined };
  const scope = params(def, given);
  const keys = new Set(Object.keys(scope));
  let error = null;
  try { await runScript(def, scope, st); } catch (e) { error = e.message; }
  if (st.js) st.js.close();
  let routes;
  if (st.browser) {
    try {
      const seen = require('./routes').parseNetwork((await st.browser.call('browser_network_requests', {})).text).filter(r => !st.pages.has(r.url)); // pages opened are not API calls
      routes = require('./routes').learn(seen, source || `script:${def.id}`);
    }
    catch (e) { routes = { error: e.message }; }
    await st.browser.close();
  }
  const failed = st.tests.filter(t => !t.ok);
  if (!error && failed.length) error = `${failed.length} of ${st.tests.length} tests failed: ${failed.map(t => t.name).join(', ')}`;
  const results = Object.fromEntries(Object.entries(scope).filter(([k]) => !keys.has(k)).map(([k, v]) => [k, brief(v, 6000)]));
  return {
    script: def.id, ok: !error, ...(error ? { error } : {}),
    ...(st.lastView ? { view: st.lastView } : {}), // the last view a step made, embedded in the chat
    steps: st.log, results,
    ...(st.tests.length ? { tests: { passed: st.tests.length - failed.length, failed: failed.length, list: st.tests } } : {}),
    ...(st.logs.length ? { logs: st.logs } : {}),
    ...(routes ? { routes } : {}),
  };
}

module.exports = { list, get, save, remove, run, fill, validate, mkdir, move, copy, removeFolder, resolve, getCollection, setCollection, exposed, signature, transform, generate, DIR };
