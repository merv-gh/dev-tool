// Versioned, self-contained scenario contracts. Runtime commands remain in reviewed workspace
// profiles: importing a data artifact never installs a shell command or executes a build.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const MAX_BYTES = 20 * 1024 * 1024;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  if (typeof value === 'bigint') return String(value);
  return value;
}
function json(value) {
  if (Array.isArray(value)) return `[${value.map(v => v === undefined ? 'null' : json(v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${json(value[k])}`).join(',')}}`;
  if (typeof value === 'bigint') return JSON.stringify(String(value));
  if (typeof value === 'number' && !Number.isFinite(value) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new Error('scenario package values must be finite JSON');
  return JSON.stringify(value);
}
const digest = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : json(v)).digest('hex');
function relative(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0') || path.posix.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..')) throw new Error(`scenario path must be relative without traversal: ${p}`);
  return p;
}
function workspacePath(workspace, rel, { missing = false } = {}) {
  relative(rel);
  const W = require('./workspace'), m = W.checkId(workspace), root = fs.realpathSync(m.path), full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep) || rel.split('/').includes('.git')) throw new Error('scenario path escapes workspace');
  let cursor = full;
  while (cursor !== root) { if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('scenario paths cannot contain symlinks'); cursor = path.dirname(cursor); }
  if (!missing && !fs.existsSync(full)) throw new Error(`missing scenario file ${rel}`);
  return { full, rel, root };
}
function portable(value, root, trail = []) {
  if (Array.isArray(value)) return value.map(v => portable(v, root, trail));
  if (!value || typeof value !== 'object') return value;
  const metadata = !trail.some(key => ['value', 'binding', 'match'].includes(key));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !metadata || !['capturedAt', 'builtAt', 'trace'].includes(key)).map(([key, item]) => {
    if (metadata && key === 'source' && trail[0] === 'state' && trail[1] === 'states' && item && typeof item === 'object') { const { capture, ...rest } = item; return [key, portable(rest, root, [...trail, key])]; }
    if (metadata && ['file', 'path'].includes(key) && (trail.includes('provenance') || trail.at(-1) === 'repo') && typeof item === 'string' && path.isAbsolute(item)) {
      if (root && item.startsWith(root + path.sep)) return [key, path.relative(root, item).split(path.sep).join('/')];
      throw new Error(`absolute source ${key} cannot be exported: use a repository-relative path`);
    }
    return [key, portable(item, root, [...trail, key])];
  }));
}
function create({ workspace, name = 'scenario', inventory, state, actions, expectations, fixturePath, profile, notes = [] }) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(name) || name === '..') throw new Error('invalid scenario name');
  const root = require('./workspace').checkId(workspace).path;
  const contract = canonical(portable({ inventory, state, actions, expectations }, root));
  // Rehash after portable provenance normalization. Bindings and business expectations are unchanged.
  contract.state.inventory = contract.inventory;
  contract.state.inventoryHash = require('./scenario-state').inventoryHash(contract.inventory);
  const gaps = require('./scenario-state').contractGaps(contract.inventory, contract.state, contract.actions, contract.expectations);
  if (gaps.length) throw new Error(`scenario contract incomplete: ${gaps.map(g => g.kind).join(', ')}`);
  const files = {};
  if (fixturePath) {
    require('./reproduction').loadFixture(workspace, fixturePath);
    const dir = require('./reproduction').resourcePath(workspace, fixturePath).full;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const rel of [...Object.keys(manifest.files), 'manifest.json']) {
      relative(rel);
      const text = fs.readFileSync(path.join(dir, rel), 'utf8');
      files[`fixture/${rel}`] = { encoding: 'utf8', sha256: digest(text), data: text };
    }
  }
  let runtime = null;
  if (profile) { const p = workspacePath(workspace, profile); if (/(^|\/)src\/test\/resources\/dt-(scenarios|fixtures)\//.test(p.rel)) throw new Error('runtime profiles must live outside imported test resources'); runtime = { profile: p.rel, sha256: digest(fs.readFileSync(p.full)) }; }
  const result = { format: 'dt-scenario', version: 1, name, service: inventory.service, contract, resources: { files }, runtime, notes,
    proof: { level: 'discovery', applicationExecuted: false, runtimeReadsVerified: false } };
  result.sha256 = digest(result);
  verify(result);
  return result;
}
function verify(artifact) {
  if (!artifact || artifact.format !== 'dt-scenario' || artifact.version !== 1 || !artifact.contract || !artifact.resources?.files) throw new Error('unsupported scenario package format/version');
  if (Buffer.byteLength(json(artifact)) > MAX_BYTES) throw new Error('scenario package exceeds 20 MiB');
  const { sha256, ...body } = artifact;
  if (sha256 !== digest(body)) throw new Error('scenario package hash mismatch');
  if (artifact.proof?.level !== 'discovery' || artifact.proof.applicationExecuted !== false || artifact.proof.runtimeReadsVerified !== false) throw new Error('portable input packages cannot claim execution proof');
  const { inventory, state, actions, expectations } = artifact.contract;
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(artifact.name || '') || artifact.name === '..' || !artifact.service || artifact.service !== inventory?.service) throw new Error('scenario package name/service identity differs from its contract');
  if (!isDeepStrictEqual(state?.inventory, inventory)) throw new Error('scenario state embeds a different inventory');
  if (artifact.notes && (!Array.isArray(artifact.notes) || artifact.notes.some(n => typeof n !== 'string'))) throw new Error('scenario notes must be strings');
  const gaps = require('./scenario-state').contractGaps(inventory, state, actions, expectations);
  if (gaps.length) throw new Error(`scenario contract invalid: ${gaps.map(g => g.kind).join(', ')}`);
  for (const [rel, item] of Object.entries(artifact.resources.files)) {
    relative(rel);
    if (!rel.startsWith('fixture/')) throw new Error('scenario resource must be inside fixture/');
    if (item.encoding !== 'utf8' || typeof item.data !== 'string' || digest(item.data) !== item.sha256) throw new Error(`scenario resource hash mismatch: ${rel}`);
  }
  const mf = artifact.resources.files['fixture/manifest.json'];
  if (mf) {
    const manifest = JSON.parse(mf.data);
    if (manifest.version !== 1 || !manifest.complete || manifest.gaps?.length) throw new Error('scenario fixture is incomplete');
    for (const [rel, expected] of Object.entries(manifest.files || {})) {
      relative(rel); const file = artifact.resources.files[`fixture/${rel}`];
      if (!file || file.sha256 !== expected) throw new Error(`scenario fixture manifest hash mismatch: ${rel}`);
    }
    for (const rel of Object.keys(artifact.resources.files)) if (rel !== 'fixture/manifest.json' && !Object.hasOwn(manifest.files || {}, rel.slice('fixture/'.length))) throw new Error(`unreferenced scenario fixture resource: ${rel}`);
    for (const [db, value] of Object.entries(manifest.databases || {})) {
      if (value.directory !== `pg/${Buffer.from(db).toString('hex')}`) throw new Error('scenario fixture database directory does not match its source identity');
      for (const kind of ['schema', 'data', 'constraints']) if (!Object.hasOwn(manifest.files, `${value.directory}/${kind}.sql`)) throw new Error(`missing fixture ${db} ${kind}.sql`);
    }
    for (const [topic, value] of Object.entries(manifest.topics || {})) {
      if (value.directory !== `kafka/${Buffer.from(topic).toString('hex')}`) throw new Error('scenario fixture topic directory does not match its source identity');
      for (const file of ['messages.jsonl', 'schema.json', 'offsets.json']) if (!Object.hasOwn(manifest.files, `${value.directory}/${file}`)) throw new Error(`missing fixture ${topic} ${file}`);
    }
    for (const [index, value] of Object.entries(manifest.elasticsearch || {})) {
      if (value.directory !== `es/${Buffer.from(index).toString('hex')}`) throw new Error('scenario fixture ES directory does not match its source identity');
      for (const file of ['mapping.json','documents.jsonl','observation.json']) if (!Object.hasOwn(manifest.files, `${value.directory}/${file}`)) throw new Error(`missing fixture ${index} ${file}`);
    }
  } else if (Object.keys(artifact.resources.files).length) throw new Error('scenario resources need fixture/manifest.json');
  if (artifact.runtime) { relative(artifact.runtime.profile); if (/(^|\/)src\/test\/resources\/dt-(scenarios|fixtures)\//.test(artifact.runtime.profile)) throw new Error('runtime profiles must live outside imported test resources'); if (!/^[a-f0-9]{64}$/.test(artifact.runtime.sha256)) throw new Error('invalid runtime profile fingerprint'); }
  return { ok: true, format: artifact.format, version: artifact.version, sha256, service: artifact.service, name: artifact.name,
    states: inventory.states.length, actions: actions.actions.length, expectations: expectations.expectations.length, resources: Object.keys(artifact.resources.files).length, proof: artifact.proof };
}
function read(workspace, file) { return JSON.parse(fs.readFileSync(workspacePath(workspace, file).full, 'utf8')); }
function load(workspace, file) { const artifact = read(workspace, file); verify(artifact); return artifact; }
function verifyExtracted(workspace, file, artifact) {
  verify(artifact);
  const root = path.posix.dirname(file);
  for (const [rel, item] of Object.entries(artifact.resources.files)) {
    const actual = workspacePath(workspace, `${root}/${rel}`);
    if (digest(fs.readFileSync(actual.full)) !== item.sha256) throw new Error(`extracted scenario resource differs from package: ${rel}`);
  }
  return { ok: true, resources: Object.keys(artifact.resources.files).length };
}
function importPackage(workspace, artifact, { directory, overwrite = false } = {}) {
  verify(artifact);
  directory ||= `src/test/resources/dt-scenarios/${artifact.name}`;
  if (!/(^|\/)src\/test\/resources\/dt-scenarios\/[\w.-]+$/.test(directory)) throw new Error('scenario directory must be [module/]src/test/resources/dt-scenarios/<name>');
  const dest = workspacePath(workspace, directory, { missing: true });
  if (fs.existsSync(dest.full) && !overwrite) throw new Error('scenario package exists; overwrite=true replaces it');
  const stage = `${dest.full}.tmp-${crypto.randomBytes(5).toString('hex')}`;
  try {
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'scenario.json'), JSON.stringify(artifact, null, 2) + '\n');
    for (const [rel, item] of Object.entries(artifact.resources.files)) { fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.writeFileSync(path.join(stage, rel), item.data); }
    if (fs.existsSync(dest.full)) fs.rmSync(dest.full, { recursive: true });
    fs.mkdirSync(path.dirname(dest.full), { recursive: true }); fs.renameSync(stage, dest.full);
    require('./workspace').touch(workspace, { dirty: true });
    return { workspace, path: `${dest.rel}/scenario.json`, directory: dest.rel, sha256: artifact.sha256, files: ['scenario.json', ...Object.keys(artifact.resources.files)] };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
function diff(before, after) {
  verify(before); verify(after); const changes = [];
  const visit = (a, b, location) => {
    if (isDeepStrictEqual(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every(v => v && typeof v.id === 'string') && new Set(a.map(v => v.id)).size === a.length && new Set(b.map(v => v.id)).size === b.length) {
      const aa = new Map(a.map(v => [v.id, v])), bb = new Map(b.map(v => [v.id, v]));
      for (const id of new Set([...aa.keys(), ...bb.keys()])) visit(aa.get(id), bb.get(id), `${location}/${id.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      return;
    }
    if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], `${location}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    } else changes.push({ path: location, before: a, after: b });
  };
  for (const key of ['contract', 'runtime', 'notes']) visit(before[key], after[key], `/${key}`);
  const a = before.resources.files, b = after.resources.files;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[key]?.sha256 !== b[key]?.sha256) changes.push({ path: `/resources/files/${key}`, before: a[key]?.sha256, after: b[key]?.sha256 });
  return { equal: !changes.length, before: before.sha256, after: after.sha256, changes };
}
function explain(artifact) {
  const summary = verify(artifact), { inventory, state, actions, expectations } = artifact.contract;
  return { ...summary, workflow: ['verify package', 'preflight reviewed runtime profile', 'start isolated session', 'act', 'observe', 'assert', 'stop'],
    states: inventory.states.map(s => ({ id: s.id, kind: s.kind, target: s.target, source: state.states[s.id]?.source, actions: s.actions, provenance: s.provenance })),
    actions: actions.actions.map(a => ({ id: a.id, kind: a.kind, target: a.target, input: a.binding, reads: a.dependencies, expects: a.expectations })),
    expectations: expectations.expectations.map(e => ({ id: e.id, kind: e.kind, target: e.target, action: e.action, match: e.match })),
    boundaries: ['Package verification proves integrity and contract binding.', 'Process proof covers independent supported observations; it does not prove every runtime read.', 'Build proof reports actual project test results; project adapters own unsupported dependencies.'] };
}
module.exports = { create, verify, importPackage, load, read, diff, explain, verifyExtracted, workspacePath, relative, digest, json };
