// Evidence logs keep useful structure, never credential-bearing values. Execution inputs stay intact.
const sensitive = key => /(^|[_\s.-])(password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|client[_-]?secret)([_\s.-]|$)/i.test(String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
function values(value) {
  const out = new Set(), seen = new WeakSet();
  const visit = v => { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v); for (const [key, x] of Object.entries(v)) if (sensitive(key) && typeof x === 'string' && x.length >= 4) out.add(x); else visit(x); };
  visit(value); return [...out];
}
function clean(value, { known = [] } = {}) {
  const secrets = new Set(known.filter(v => typeof v === 'string' && v.length >= 4));
  try {
    const C = require('./config');
    for (const [key, v] of Object.entries({ ...C.parseEnvFile(C.SECRETS_FILE), ...C.parseEnvFile(require('path').join(C.HOME, '.env.personal')) })) if (sensitive(key) && v.length >= 4) secrets.add(v);
    const p = C.getPersonal();
    for (const v of [p.bitbucket.token, p.confluence.token, p.llm.key, C.getServer().apiKey]) if (v && v.length >= 4) secrets.add(v);
  } catch {}
  const scanned = new WeakSet();
  const discover = v => { if (!v || typeof v !== 'object' || scanned.has(v)) return; scanned.add(v); for (const [key, x] of Object.entries(v)) if (sensitive(key) && typeof x === 'string' && x.length >= 4) secrets.add(x); else discover(x); };
  discover(value);
  const text = v => {
    let out = String(v).replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/?#@]*:[^\s/@]+@/gi, '$1[redacted]@').replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]').replace(/([?&](?:access_token|token|api_?key|password|secret)=)[^&#\s"']+/gi, '$1[redacted]');
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(secret).join('[redacted]');
    return out;
  };
  const seen = new WeakSet();
  function walk(v, depth = 0) {
    if (typeof v === 'string') return text(v);
    if (!v || typeof v !== 'object') return typeof v === 'bigint' ? String(v) : v;
    if (seen.has(v) || depth > 64) return '[circular or too deep]';
    seen.add(v);
    const result = Array.isArray(v) ? v.map(x => walk(x, depth + 1)) : Object.fromEntries(Object.entries(v).map(([key, x]) => [key, sensitive(key) && x != null ? '[redacted]' : walk(x, depth + 1)]));
    seen.delete(v); return result;
  }
  return walk(value);
}
module.exports = { clean, sensitive, values };
