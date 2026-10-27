// Views: how a result is shown (in Open WebUI, embedded; or on its own). A view is an HTML fragment
// with a first-line comment <!-- { "description": "...", "sample": <data> } -->; its script reads DATA
// and META and uses the `dt` helpers (web/views/_helpers.js, plus dt.diffLists / dt.diffLines).
//   built-in: web/views/<name>.html     custom: views/<name>.html in the config folder (wins by name)
// Pages are served sandboxed (CSP sandbox, no same origin, no network: connect-src 'none'), with the
// data written into the page, so a custom view cannot call dt or send data anywhere.
const fs = require('fs');
const path = require('path');
const { PATHS, ROOT } = require('./config');

const BUILTIN = path.join(__dirname, path.basename(__dirname) === 'lib' ? '../web/views' : 'web/views');
const DIR = PATHS.views;
const NAME = /^[a-z][a-z0-9-]{1,40}$/;

const CSP = [
  'sandbox allow-scripts allow-popups allow-downloads',
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com",
  "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  "connect-src 'none'", "form-action 'none'", "base-uri 'none'", 'frame-ancestors *',
].join('; ');

function parse(text) {
  const m = text.match(/^\s*<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  let meta = {};
  if (m) { try { meta = JSON.parse(m[1]); } catch (e) { meta = { error: `first-line comment is not JSON: ${e.message}` }; } }
  return { meta, html: m ? text.slice(m[0].length) : text };
}

function files(dir) { try { return fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.startsWith('_')).map(f => f.slice(0, -5)); } catch { return []; } }

function get(name) {
  if (!NAME.test(name || '')) throw new Error(`bad view name "${name}": lowercase letters, digits and -`);
  for (const [dir, builtin] of [[DIR, false], [BUILTIN, true]]) {
    const f = path.join(dir, `${name}.html`);
    if (fs.existsSync(f)) {
      const text = fs.readFileSync(f, 'utf8');
      const { meta, html } = parse(text);
      return { name, builtin, overrides: !builtin && fs.existsSync(path.join(BUILTIN, `${name}.html`)), description: meta.description || '', sample: meta.sample, error: meta.error, html, text };
    }
  }
  throw new Error(`no view "${name}"; views: ${list().map(v => v.name).join(', ')}`);
}

function list() {
  const names = [...new Set([...files(DIR), ...files(BUILTIN)])].sort();
  return names.map(n => { const v = get(n); return { name: n, builtin: v.builtin, overrides: v.overrides, description: v.description, hasSample: v.sample !== undefined, ...(v.error ? { error: v.error } : {}) }; });
}

function save(name, { html, description = '', sample }) {
  if (!NAME.test(name || '')) throw new Error(`bad view name "${name}": lowercase letters, digits and -`);
  if (typeof html !== 'string' || !html.trim()) throw new Error('html required: the page body, with a <script> that reads DATA');
  const body = parse(html).html; // a pasted first-line comment is replaced by the given meta
  const meta = JSON.stringify({ description: String(description || '').trim(), ...(sample !== undefined ? { sample } : {}) });
  fs.mkdirSync(DIR, { recursive: true });
  const f = path.join(DIR, `${name}.html`);
  const existed = fs.existsSync(f);
  fs.writeFileSync(f, `<!-- ${meta} -->\n${body.replace(/^\s+/, '')}`);
  return { view: name, saved: true, replaced: existed, overridesBuiltin: fs.existsSync(path.join(BUILTIN, `${name}.html`)) };
}

function remove(name) {
  if (!NAME.test(name || '')) throw new Error('bad view name');
  const f = path.join(DIR, `${name}.html`);
  if (!fs.existsSync(f)) throw new Error(`no custom view "${name}" (built-in views cannot be deleted)`);
  fs.unlinkSync(f);
  return { view: name, deleted: true };
}

// JSON inside <script>: no "</script>", no HTML comment openers, no line separators
const safeJson = (v) => JSON.stringify(v === undefined ? null : v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

let shared;
function assets() {
  if (!shared) {
    const web = path.join(BUILTIN, '..');
    const { diffLists, diffLines } = require('./diff');
    shared = {
      css: fs.readFileSync(path.join(web, 'ui.css'), 'utf8') + '\n' + fs.readFileSync(path.join(BUILTIN, '_views.css'), 'utf8'),
      js: fs.readFileSync(path.join(BUILTIN, '_helpers.js'), 'utf8') + `\ndt.diffLists = ${diffLists.toString()};\ndt.diffLines = ${diffLines.toString()};\n`,
    };
  }
  return shared;
}

// The full page for a view with this data. html: a view body to use instead of the saved one (admin preview).
// metaCsp: the policy as a <meta> too (for previews in an iframe srcdoc, where there is no header)
function render(name, data, meta = {}, { embed = false, html, metaCsp = false } = {}) {
  const v = html !== undefined ? { name, html: parse(html).html } : get(name);
  const a = assets();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(meta.title || name)}</title>${metaCsp ? `<meta http-equiv="Content-Security-Policy" content="${esc(CSP.split('; ').filter(d => !/^(sandbox|frame-ancestors)/.test(d)).join('; '))}">` : ''}
<style>${a.css}</style>
<script>window.DATA = ${safeJson(data)}; window.META = ${safeJson({ view: name, ...meta })};</script>
<script>${a.js}</script></head>
<body class="${embed ? 'embed' : ''}"><div class="wrap">${v.html}</div></body></html>`;
}

module.exports = { list, get, save, remove, render, CSP, BUILTIN, DIR };
