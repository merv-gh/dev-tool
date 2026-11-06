// Versioned projection of the ordinary persisted passport contract, shared by graph/index consumers.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const snapshots = new Map();
const { create } = require('../state-machine'), lifecycle = require('../lifecycles').edgeSnapshot;
function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.service !== 'string' || !data.service || !data.effective || typeof data.effective !== 'object' || Array.isArray(data.effective)) throw new Error('Invalid persisted passport: service and effective object required');
  if (data.env != null && typeof data.env !== 'string' || data.repo?.sha != null && typeof data.repo.sha !== 'string') throw new Error('Invalid persisted passport environment/revision');
  const arrays = (object, names) => { for (const name of names) if (object?.[name] !== undefined && (!Array.isArray(object[name]) || object[name].some(x => !x || typeof x !== 'object' || Array.isArray(x)))) throw new Error(`Invalid persisted passport edge array: ${name}`); };
  arrays(data.effective, ['consumes','produces','calls','endpoints','tables','es','feign']);
  arrays(data.effective.kafka, ['consumes','produces']);
  return data;
}
function snapshot({ env, manual = true } = {}) {
  const dir = require('./index').DIR, rows = [], gaps = [], signatures = [];
  let dirs = []; try { dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory()).sort((a,b) => a.name.localeCompare(b.name)); } catch (e) { if (e.code !== 'ENOENT') gaps.push({ kind: 'passport-read-error', message: e.message }); }
  const alive = new Set();
  for (const d of dirs) {
    const f = path.join(dir, d.name, 'passport.json'); alive.add(f);
    let stamp; try { const s = fs.statSync(f); stamp = `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch (e) { if (e.code !== 'ENOENT') gaps.push({ kind: 'passport-read-error', service: d.name, message: e.message }); else snapshots.delete(f); continue; }
    let m = snapshots.get(f);
    if (!m || m.stamp !== stamp) {
      const phase = m?.lifecycle || create(lifecycle);
      try { const raw = fs.readFileSync(f); const data = validate(JSON.parse(raw)); phase.to('valid'); m = { stamp, digest: crypto.createHash('sha256').update(raw).digest('hex'), data, lifecycle: phase }; snapshots.set(f, m); }
      catch (e) { phase.to(m?.data ? 'stale' : 'invalid'); m = { stamp, digest: `invalid:${stamp}`, data: m?.data, error: e.message, lifecycle: phase }; snapshots.set(f, m); }
    }
    signatures.push([d.name, m.digest, m.error || '']);
    if (m.error) gaps.push({ kind: 'passport-stale-last-good', service: d.name, message: m.error, retained: !!m.data });
    if (m.data) { const passport=manual?require('./overrides').apply(m.data, env ? {env} : {}):m.data;if(manual)signatures.push([d.name,'adjustment',passport.portAdjustments?.revision||'']);rows.push({ passport, stale: !!m.error, digest: m.digest }); }
  }
  for (const f of snapshots.keys()) if (!alive.has(f)) { snapshots.get(f).lifecycle.to('removed'); snapshots.delete(f); }
  return { protocol: 'dt.passport-edges/v1', signature: JSON.stringify(signatures), rows, gaps };
}
function normalize(p, { env, stale = false, digest } = {}) {
  const effective = p.effective || {}, gaps = [];
  if (env && p.env && p.env !== env) return { included: false, edges: [], gaps: [] };
  const evidence = { env: p.env || null, revision: p.repo?.sha || null, passportDigest: digest || null, stale };
  if (env && !p.env) gaps.push({ kind: 'passport-environment-unknown', service: p.service });
  if (!p.repo?.sha) gaps.push({ kind: 'passport-revision-unknown', service: p.service });
  const edges = [], loc = x => x.file ? `${x.file}:${x.line || 1}` : 'passport';
  const add = (from, to, kind, x) => edges.push({ from, to, kind, where: loc(x), repo: `svc:${p.service}`, ...evidence, ...(x.manual?{origin:'manual',proof:'declared',provenance:x.provenance}:{origin:'detected',proof:'static'}) });
  const svc = `svc:${p.service}`;
  for (const x of effective.consumes || effective.kafka?.consumes || []) if (x.topic && !/^[?(]/.test(x.topic)) add(svc, `topic:${x.topic}`, 'consumes', x);
  for (const x of effective.produces || effective.kafka?.produces || []) if (x.topic && !/^[?(]/.test(x.topic)) add(`topic:${x.topic}`, svc, 'produced-by', x);
  const normPath = p => String(p || '').replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';
  for (const x of effective.calls || effective.feign || []) if (x.method && x.path) add(svc, `endpoint:${x.method.toUpperCase()} ${normPath(x.path)}`, 'calls-http', x);
  for (const x of effective.endpoints || []) if (x.method && x.path) add(`endpoint:${x.method.toUpperCase()} ${normPath(x.path)}`, svc, 'handler', x);
  for (const x of effective.es || []) if (x.index && !/^[?(]/.test(x.index)) add(svc, `es:${x.index}`, 'es', x);
  const ports = effective.ports || require('./ports').detected(p), portEdges = [];
  for (const port of ports) {
    const missing = require('./ports').gaps(port); if (missing) gaps.push(missing);
    const h = port.handler, b = port.boundary;
    // Exact method and boundary identities are a separate projection. Legacy
    // service edges above retain their public compatibility contract.
    if (!h.repo || !h.revision || !h.signature || !h.file || !h.line || !port.env) continue;
    const method = require('../semantic-identity').code(h.repo, h.revision, `${h.signature}@${h.file}:${h.line}`);
    let boundary, incoming = ['http-ingress','kafka-consume','db-read','scheduled'].includes(port.type);
    const enc = encodeURIComponent;
    if (port.type.startsWith('http') && b.host && b.method && b.path) boundary = `http:${enc(port.env)}:${enc(b.host)}:${enc(b.method)}:${enc((b.base_path || '') + b.path)}`;
    else if (port.type.startsWith('kafka') && b.cluster && b.topic) boundary = `topic:${enc(port.env)}:${enc(b.cluster)}:${enc(b.topic)}`;
    else if (port.type.startsWith('db-') && b.db && b.schema && b.table) boundary = require('../semantic-identity').pg('table', port.env, b.db, require('../semantic-identity').qualified(b.schema, b.table));
    else if (port.type === 'scheduled' && b.schedule && b.registration) boundary = `schedule:${enc(port.env)}:${enc(port.service)}:${enc(b.registration)}`;
    else if (port.type === 'internal-library' && b.target_repo && b.target_revision && b.target_signature) boundary = require('../semantic-identity').code(b.target_repo, b.target_revision, b.target_signature);
    if (boundary) portEdges.push({ from: incoming ? boundary : method, to: incoming ? method : boundary, kind: port.type, portId: port.id, origin: port.evidence.origin, proof: port.status === 'declared' ? 'declared' : 'static', evidence: port.evidence, mappings: port.mappings, parameters: port.parameters, identity: { service: port.service, env: port.env, repo: port.repo, revision: port.revision } });
  }
  return { included: true, edges, ports, portEdges, gaps, evidence };
}
module.exports = { snapshot, normalize };
