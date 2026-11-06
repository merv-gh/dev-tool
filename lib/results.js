// Full tool results for the viewer (/view/<id>). The model gets a preview + link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson } = require('./util');

const DIR = path.join(CACHE, 'results');
const KEEP = 500;          // newest results kept on disk
const MAX_ROWS = 10000;    // rows stored per result

const publicUrl = () => require('./config').getServer().publicUrl;

// Prefix only scoped IDs; old unprefixed links remain the legacy default scope.
const scopePrefix=()=>{const s=require('./access').current().scopeKey;return s==='legacy'?'':'s'+s+'z';};
const inScope=file=>{const prefix=scopePrefix();return prefix?file.startsWith(prefix):!/^s[a-f0-9]{32}z/.test(file);};
const newId=()=>scopePrefix()+Date.now().toString(36)+crypto.randomBytes(9).toString('hex');
function install(id, text) {
  const lifecycle = require('./state-machine').create(require('./lifecycles').result);
  lifecycle.to('serialized');
  try { require('./atomic-file').atomicFile(path.join(DIR, `${id}.json`), text); lifecycle.to('stored'); }
  catch (error) { lifecycle.to('failed');throw error; }
}

// the newest KEEP results, and at most results.maxMb (default 500) megabytes: the oldest go first
function prune() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && inScope(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(DIR, f));
  let maxMb = 500;
  try { maxMb = Number(process.env.DT_RESULTS_MAX_MB || require('./config').load().raw.results?.maxMb || 500); } catch {}
  const kept = files.slice(Math.max(0, files.length - KEEP)).map(f => ({ f, size: fs.statSync(path.join(DIR, f)).size }));
  let total = kept.reduce((n, x) => n + x.size, 0);
  for (const x of kept) { if (total <= maxMb * 1048576) break; fs.unlinkSync(path.join(DIR, x.f)); total -= x.size; }
}

// Which page renders which kind (all read /api/result/<id>).
const PAGES = { map: 'map', 'map-preview':'map-preview', logs: 'logs', trace: 'logs', pr: 'pr' };

// kind: pg | es | kafka | health | logs | ... rows: array of objects. meta: query, env, target, timings.
function save(kind, rows, meta) {
  fs.mkdirSync(DIR, { recursive: true });
  // Unguessable: the id is the only key to the data for embeds (they load it cross-origin).
  const id = newId();
  install(id, JSON.stringify({
    ...meta, id, kind, owner:require('./access').owner(), at: new Date().toISOString(),
    total: rows.length, truncated: rows.length > MAX_ROWS || undefined, rows: rows.slice(0, MAX_ROWS),
  }));
  try { prune(); } catch {}
  return `${publicUrl()}/${PAGES[kind] || 'view'}/${id}`;
}

// Data shown by a view (lib/views.js) -> /show/<id>. page: another page for it (files).
function saveView(view, data, meta = {}, { page = 'show' } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const id = newId();
  const text = JSON.stringify({ ...meta, id, kind: 'view', owner:require('./access').owner(), view, at: new Date().toISOString(), data });
  if (text.length > 20e6) throw new Error(`too much data to show (${Math.round(text.length / 1e6)} MB; max 20)`);
  install(id, text);
  try { prune(); } catch {}
  return `${publicUrl()}/${page}/${id}`;
}

function raw(id) {
  if (!/^[a-z0-9]+$/.test(id)) return null;
  return readJson(path.join(DIR, `${id}.json`));
}

function load(id) { const value=raw(id);return value&&require('./access').visible(value.owner)?value:null;}
function list(limit = 50) {
  try {
    return fs.readdirSync(DIR).filter(f => f.endsWith('.json')&&inScope(f)).sort().reverse().slice(0, limit).map(f => {
      const r = readJson(path.join(DIR, f)) || {};
      return { id: r.id, kind: r.kind === 'view' ? `view:${r.view}` : r.kind, at: r.at, env: r.env, target: r.db || r.index || r.topic || r.store, query: String(r.query || r.title || '').slice(0, 160), total: r.total };
    });
  } catch { return []; }
}

// Token for live pages that aren't stored results (the dashboard): HMAC with a per-install secret.
let secret;
function sign(value) {
  if (!secret) {
    const f = path.join(CACHE, '.secret');
    try { secret = fs.readFileSync(f, 'utf8'); }
    catch { secret = crypto.randomBytes(32).toString('hex'); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, secret, { mode: 0o600 }); }
  }
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 32);
}
const verify = (value, token) => typeof token === 'string' && token.length === 32 && crypto.timingSafeEqual(Buffer.from(sign(value)), Buffer.from(token));

module.exports = { save, saveView, load, raw, list, publicUrl, sign, verify };
