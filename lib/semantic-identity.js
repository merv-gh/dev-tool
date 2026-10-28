// Stable, source-neutral identities. Never infer a database or code revision from display names.
const enc = s => encodeURIComponent(String(s ?? 'unknown'));
const dec = s => decodeURIComponent(s);
const identifier = s => /^[a-z_][a-z0-9_$]*$/.test(String(s)) ? String(s) : '"' + String(s).replace(/"/g, '""') + '"';
const qualified = (...parts) => parts.map(identifier).join('.');
const norm = s => (String(s || '').match(/"(?:""|[^"])*"|[^"]+/g) || []).map(x => x.startsWith('"') ? identifier(x.slice(1,-1).replace(/""/g,'"')) : x.replace(/\s+/g,'').toLowerCase()).join('');
const signature = m => `${m.name}(${(m.params || []).map(p => String(p.type || '?').replace(/\s+/g, '')).join(',')})`;
function code(repo, revision, symbol) { return `code:${enc(repo)}@${enc(revision || 'unknown')}:${symbol}`; }
function parseCode(id) { const m = String(id).match(/^code:([^@]+)@([^:]+):(.+)$/); return m ? { repo: dec(m[1]), revision: dec(m[2]), symbol: m[3] } : null; }
function pg(kind, env, db, object) { return `${kind}:${enc(env)}:${enc(db)}:${norm(object)}`; }
function parsePg(id) { const m = String(id).match(/^(table|column|pgfn):([^:]+):([^:]+):(.+)$/); return m ? { kind: m[1], env: dec(m[2]), db: dec(m[3]), object: m[4] } : null; }
const revision = idx => idx?.workspace || idx?.key?.startsWith('work/') ? `${idx?.sha || 'unknown'}+work:${idx?.sourceDigest || idx?.builtAt || 'unknown'}` : idx?.sha || 'unknown';
module.exports = { protocol: 'dt.identity/v1', code, parseCode, pg, parsePg, signature, norm, revision, identifier, qualified };
