// Full tool results for the viewer (/view/<id>). The model gets a preview + link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson } = require('./util');

const DIR = path.join(CACHE, 'results');
const KEEP = 500;          // newest results kept on disk
const MAX_ROWS = 10000;    // rows stored per result

const publicUrl = () => require('./config').getServer().publicUrl;

function prune() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(DIR, f));
}

// Which page renders which kind (all read /api/result/<id>).
const PAGES = { logs: 'logs', trace: 'logs', pr: 'pr' };

// kind: pg | es | kafka | health | logs | ... rows: array of objects. meta: query, env, target, timings.
function save(kind, rows, meta) {
  fs.mkdirSync(DIR, { recursive: true });
  // Unguessable: the id is the only key to the data for embeds (they load it cross-origin).
  const id = Date.now().toString(36) + crypto.randomBytes(9).toString('hex');
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify({
    id, kind, at: new Date().toISOString(), ...meta,
    total: rows.length, truncated: rows.length > MAX_ROWS || undefined, rows: rows.slice(0, MAX_ROWS),
  }));
  try { prune(); } catch {}
  return `${publicUrl()}/${PAGES[kind] || 'view'}/${id}`;
}

function load(id) {
  if (!/^[a-z0-9]+$/.test(id)) return null;
  return readJson(path.join(DIR, `${id}.json`));
}

function list(limit = 50) {
  try {
    return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit).map(f => {
      const r = readJson(path.join(DIR, f)) || {};
      return { id: r.id, kind: r.kind, at: r.at, env: r.env, target: r.db || r.index || r.topic, query: String(r.query || '').slice(0, 160), total: r.total };
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

module.exports = { save, load, list, publicUrl, sign, verify };
