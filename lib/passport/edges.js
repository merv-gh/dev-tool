// Versioned projection of the ordinary persisted passport contract, shared by graph/index consumers.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const snapshots = new Map();
function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.service !== 'string' || !data.service || !data.effective || typeof data.effective !== 'object' || Array.isArray(data.effective)) throw new Error('Invalid persisted passport: service and effective object required');
  if (data.env != null && typeof data.env !== 'string' || data.repo?.sha != null && typeof data.repo.sha !== 'string') throw new Error('Invalid persisted passport environment/revision');
  const arrays = (object, names) => { for (const name of names) if (object?.[name] !== undefined && (!Array.isArray(object[name]) || object[name].some(x => !x || typeof x !== 'object' || Array.isArray(x)))) throw new Error(`Invalid persisted passport edge array: ${name}`); };
  arrays(data.effective, ['consumes','produces','calls','endpoints','tables','es','feign']);
  arrays(data.effective.kafka, ['consumes','produces']);
  return data;
}
function snapshot() {
  const dir = require('./index').DIR, rows = [], gaps = [], signatures = [];
  let dirs = []; try { dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory()).sort((a,b) => a.name.localeCompare(b.name)); } catch (e) { if (e.code !== 'ENOENT') gaps.push({ kind: 'passport-read-error', message: e.message }); }
  const alive = new Set();
  for (const d of dirs) {
    const f = path.join(dir, d.name, 'passport.json'); alive.add(f);
    let stamp; try { const s = fs.statSync(f); stamp = `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch (e) { if (e.code !== 'ENOENT') gaps.push({ kind: 'passport-read-error', service: d.name, message: e.message }); else snapshots.delete(f); continue; }
    let m = snapshots.get(f);
    if (!m || m.stamp !== stamp) {
      try { const raw = fs.readFileSync(f); const data = validate(JSON.parse(raw)); m = { stamp, digest: crypto.createHash('sha256').update(raw).digest('hex'), data }; snapshots.set(f, m); }
      catch (e) { m = { stamp, digest: `invalid:${stamp}`, data: m?.data, error: e.message }; snapshots.set(f, m); }
    }
    signatures.push([d.name, m.digest, m.error || '']);
    if (m.error) gaps.push({ kind: 'passport-stale-last-good', service: d.name, message: m.error, retained: !!m.data });
    if (m.data) rows.push({ passport: m.data, stale: !!m.error, digest: m.digest });
  }
  for (const f of snapshots.keys()) if (!alive.has(f)) snapshots.delete(f);
  return { protocol: 'dt.passport-edges/v1', signature: JSON.stringify(signatures), rows, gaps };
}
function normalize(p, { env, stale = false, digest } = {}) {
  const effective = p.effective || {}, gaps = [];
  if (env && p.env && p.env !== env) return { included: false, edges: [], gaps: [] };
  const evidence = { env: p.env || null, revision: p.repo?.sha || null, passportDigest: digest || null, stale };
  if (env && !p.env) gaps.push({ kind: 'passport-environment-unknown', service: p.service });
  if (!p.repo?.sha) gaps.push({ kind: 'passport-revision-unknown', service: p.service });
  const edges = [], loc = x => x.file ? `${x.file}:${x.line || 1}` : 'passport';
  const add = (from, to, kind, x) => edges.push({ from, to, kind, where: loc(x), repo: `svc:${p.service}`, ...evidence });
  const svc = `svc:${p.service}`;
  for (const x of effective.consumes || effective.kafka?.consumes || []) if (x.topic && !/^[?(]/.test(x.topic)) add(svc, `topic:${x.topic}`, 'consumes', x);
  for (const x of effective.produces || effective.kafka?.produces || []) if (x.topic && !/^[?(]/.test(x.topic)) add(`topic:${x.topic}`, svc, 'produced-by', x);
  const normPath = p => String(p || '').replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';
  for (const x of effective.calls || effective.feign || []) if (x.method && x.path) add(svc, `endpoint:${x.method.toUpperCase()} ${normPath(x.path)}`, 'calls-http', x);
  for (const x of effective.endpoints || []) if (x.method && x.path) add(`endpoint:${x.method.toUpperCase()} ${normPath(x.path)}`, svc, 'handler', x);
  for (const x of effective.es || []) if (x.index && !/^[?(]/.test(x.index)) add(svc, `es:${x.index}`, 'es', x);
  return { included: true, edges, gaps, evidence };
}
module.exports = { snapshot, normalize };
