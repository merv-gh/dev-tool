const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const W = require('./workspace');
const T = require('./test-targets');
function file(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) throw new Error('differential paths must be workspace relative');
  const full = W.resolvePath({ path: root }, rel).full;
  if (fs.existsSync(full) && !fs.realpathSync(full).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('differential path escapes workspace');
  return full;
}
function observedFiles(root, paths) {
  const out = {};
  for (const rel of paths) {
    const full = file(root, rel);
    if (!fs.existsSync(full)) { out[rel] = { exists: false }; continue; }
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > 1048576) throw new Error(`effect observation requires regular files <= 1 MiB: ${rel}`);
    out[rel] = { exists: true, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') };
  }
  return out;
}
function normalize(value, rules) {
  // Human-readable object-field paths; only return fields can be omitted, never errors/effects.
  const out = structuredClone(value);
  for (const rule of rules || []) {
    if (rule.kind !== 'omit' || !Array.isArray(rule.path) || !rule.path.length || !rule.reason || rule.path.some(p => typeof p !== 'string')) throw new Error('normalizers require kind=omit, a nonempty field path and a review reason');
    let parent = out.value;
    for (const part of rule.path.slice(0, -1)) parent = parent?.$dtType === 'object' ? parent.entries.find(([k]) => k === part)?.[1] : undefined;
    if (parent?.$dtType === 'object') parent.entries = parent.entries.filter(([k]) => k !== rule.path.at(-1));
  }
  return out;
}
async function databaseObservations(profile, execution, input) {
  const observed = {};
  for (const spec of profile.observers || []) {
    if (spec.kind !== 'postgres' || !spec.id || !spec.query || !spec.db) throw new Error('differential observers require id, kind=postgres, db and a reviewed read-only query');
    const env = spec.environment || execution.metadata.environment;
    if (!env) throw new Error(`observer ${spec.id} requires an explicit environment or a target environment`);
    const params = (spec.argumentIndexes || []).map(i => { if (!Number.isInteger(i) || i < 0 || i >= input.args.length) throw new Error(`invalid observer argument index ${i}`); return input.args[i]; });
    const result = await require('./pg').query(env, spec.query, { db: spec.db, params });
    if (result.rows.length > 1000 || Buffer.byteLength(JSON.stringify(result.rows)) > 1048576) throw new Error(`observer ${spec.id} exceeds 1000 rows / 1 MiB; narrow the reviewed query`);
    observed[spec.id] = result.rows;
  }
  return observed;
}
async function check({ profile: profileId, baseline, candidate, inputs, target = 'local', baseline_target, candidate_target, sourceEnv, log = () => {} }) {
  const cfg = require('./config').getTests();
  const profile = cfg.differentialProfiles?.[profileId];
  if (!profile || profile.reviewed !== true || profile.kind !== 'node-module' || !profile.module) throw new Error('differential_check requires a reviewed tests.differentialProfiles node-module profile');
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100 || inputs.some(x => !x.id || !Array.isArray(x.args))) throw new Error('inputs must have 1..100 {id,args} cases');
  if (new Set(inputs.map(x => x.id)).size !== inputs.length) throw new Error('differential input IDs must be unique');
  if (Buffer.byteLength(JSON.stringify(inputs)) > 1048576) throw new Error('differential inputs exceed 1 MiB');
  normalize({}, profile.normalizers);
  const executions = [baseline_target || target, candidate_target || target].map(id => T.resolve(id, { env: sourceEnv }));
  if (executions.some(execution => execution.runnerUrl)) throw new Error('node-module differential observer is local-only; configure a local dependency target or an external differential adapter');
  const workspaces = [baseline, candidate].map(id => W.checkId(id));
  if (baseline === candidate) throw new Error('baseline and candidate must be separate workspace snapshots');
  const versions = workspaces.map(m => ({ workspace: m.id, revision: m.sha, sourceSha256: T.digest(require('./testrun').fingerprint(m.path, { includeTests: true })), moduleSha256: crypto.createHash('sha256').update(fs.readFileSync(file(m.path, profile.module))).digest('hex') }));
  const cases = [];
  for (const input of inputs) {
    const observations = [];
    for (const [position, m] of workspaces.entries()) {
      const execution = executions[position];
      fs.mkdirSync(require('./config').PATHS.build, { recursive: true });
      const scratch = fs.mkdtempSync(path.join(require('./config').PATHS.build, 'differential-'));
      try {
        const request = path.join(scratch, 'request.json'), response = path.join(scratch, 'response.json');
        fs.writeFileSync(request, JSON.stringify({ module: file(m.path, profile.module), export: profile.export, args: input.args }));
        const before = { files: observedFiles(m.path, profile.observeFiles || []), databases: await databaseObservations(profile, execution, input) };
        const privacy = require('./execution-privacy'), knownSecrets = privacy.secrets(cfg, execution), mask = text => require('./execution-privacy').mask(text, knownSecrets);
        const env = { ...require('./testrun').cleanEnv(cfg), ...Object.fromEntries(Object.entries(cfg.env || {}).map(([k,v]) => [k,String(v)])), ...execution.env };
        const r = await require('./testrun').execLocal(cfg.node || process.execPath, [path.join(__dirname, 'differential-worker.js'), request, response], { cwd: m.path, env, timeoutMs: Math.min(cfg.timeoutMs, profile.timeoutMs || 30000), log: line => log(mask(line)) });
        if (r.code !== 0 || r.killed || !fs.existsSync(response)) throw new Error(`differential worker ${m.id}/${input.id}: ${r.killed ? 'timeout' : `exit ${r.code}`}`);
        if (fs.statSync(response).size > 1048576) throw new Error('differential result exceeds 1 MiB');
        observations.push({ ...JSON.parse(fs.readFileSync(response)), effects: { observer: 'parent filesystem and read-only database snapshots', before, after: { files: observedFiles(m.path, profile.observeFiles || []), databases: await databaseObservations(profile, execution, input) } } });
      } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    }
    const equal = T.stable(normalize(observations[0], profile.normalizers)) === T.stable(normalize(observations[1], profile.normalizers));
    const knownSecrets = [...new Set(executions.flatMap(e => require('./execution-privacy').secrets(cfg, e)))], mask = text => require('./execution-privacy').mask(text, knownSecrets);
    cases.push({ id: input.id, equal, baseline: require('./execution-privacy').clean(observations[0], mask), candidate: require('./execution-privacy').clean(observations[1], mask) });
  }
  const result = { version: 1, profile: profileId, profileSha256: T.digest(profile), inputsSha256: T.digest(inputs), execution: { baseline: executions[0].metadata, candidate: executions[1].metadata }, versions, normalizers: profile.normalizers || [], outcome: cases.every(c => c.equal) ? 'equivalent' : 'different', counts: { cases: cases.length, equal: cases.filter(c => c.equal).length }, cases, proof: { type: 'executed-differential', returnValues: true, errorSemantics: true, fileEffects: profile.observeFiles?.length > 0, databaseEffects: (profile.observers || []).some(o => o.kind === 'postgres'), networkEffects: false, configuredSecretsMaskedAfterComparison: true, coverage: 'only declared inputs and independent file/database snapshots; no claim of exhaustive reads, atomic distributed snapshots or complete semantic equivalence' } };
  result.sha256 = T.digest(result);
  return result;
}
module.exports = { check, normalize, observedFiles };
