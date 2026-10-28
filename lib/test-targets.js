// Target manifests are operator configuration, never model-provided shell or credentials.
const crypto = require('crypto');
const os = require('os');
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
function resolve(id = 'local', { env, fixturePath, db, inspection = false } = {}) {
  const cfg = require('./config').getTests();
  const configured = cfg.targets || {};
  const manifest = configured[id] || (id === 'local' ? { reviewed: true, kind: 'local', dependencies: [], effects: 'workspace-and-scratch', runnerUrl: cfg.runnerUrl } : null);
  if (!manifest) throw new Error(`unknown test target ${id}; test_targets lists reviewed execution targets`);
  if (manifest.reviewed !== true) throw new Error(`test target ${id} is not reviewed`);
  if (!['local', 'captured-dev', 'live-dev'].includes(manifest.kind)) throw new Error(`invalid test target kind ${manifest.kind}`);
  if (!inspection && manifest.kind === 'captured-dev' && !fixturePath) throw new Error(`test target ${id} requires fixture_path with captured source provenance`);
  if (manifest.kind === 'live-dev') {
    if (manifest.allowLive !== true || !manifest.runnerUrl || !manifest.environment || !manifest.deployment?.revision || !manifest.dependencies?.length || !manifest.effects) throw new Error(`live-dev target ${id} requires allowLive, runnerUrl, environment, deployment.revision, dependencies and effects`);
    if (fixturePath || db) throw new Error('live-dev target cannot replace its declared dependencies with a scratch fixture or DDL database');
    if (env && env !== manifest.environment) throw new Error(`catalog environment ${env} conflicts with target environment ${manifest.environment}`);
  }
  for (const dep of manifest.dependencies || []) if (!dep.id || !dep.kind || !dep.environment || !['read-only', 'sandbox-write'].includes(dep.access)) throw new Error(`test target ${id} has an incomplete dependency declaration`);
  const runnerUrl = manifest.runnerUrl || null;
  if (runnerUrl && !/^https?:\/\//.test(runnerUrl)) throw new Error('target runnerUrl must be HTTP(S)');
  if (runnerUrl) { const endpoint = new URL(runnerUrl); if (endpoint.username || endpoint.password) throw new Error('target runnerUrl must not contain embedded credentials; use runnerToken'); }
  const metadata = {
    id, kind: manifest.kind, manifestSha256: digest(manifest), environment: manifest.environment || null,
    sourceEnvironment: env || null, deployment: manifest.deployment ? Object.fromEntries(['service','revision','version','imageDigest'].filter(k=>manifest.deployment[k]!==undefined).map(k=>[k,manifest.deployment[k]])) : null,
    host: runnerUrl ? { placement: 'remote', origin: new URL(runnerUrl).origin } : { placement: 'local', hostname: os.hostname() },
    dependencies: (manifest.dependencies || []).map(({ id, kind, environment, access }) => ({ id, kind, environment, access })),
    effects: manifest.effects || 'workspace-and-scratch',
    isolation: 'build process with cleaned environment; host filesystem and network are not sandboxed by this profile',
    attestation: { deploymentVerified: false, runtimeReadsVerified: false },
    provenance: manifest.kind === 'live-dev' ? 'configured live deployment and dependencies; execution is not a deployment attestation' : fixturePath ? 'captured fixture replay on isolated dependencies' : db ? 'scratch database from catalog or saved DDL' : 'project local dependencies; env alone does not select a live deployment',
  };
  return { metadata, env: { ...(manifest.env || {}) }, runnerUrl, runnerToken: manifest.runnerToken || cfg.runnerToken, requireRunner: !!runnerUrl, forceLocal: !runnerUrl };
}
function list() {
  const cfg = require('./config').getTests();
  return ['local', ...Object.keys(cfg.targets || {}).filter(id => id !== 'local')].map(id => {
    try { const metadata = resolve(id, { inspection: true }).metadata; return { ...metadata, available: true, availability: 'manifest-valid; runner/dependency reachability checked on execution', ...(metadata.kind === 'captured-dev' ? { required: ['fixture_path'] } : {}) }; } catch (e) { return { id, kind: cfg.targets?.[id]?.kind, available: false, reason: e.message }; }
  });
}
function jobKey(args) {
  const clean = { ...args }; delete clean.job;
  const cfg = require('./config').getTests();
  let workspace;
  try { const m = require('./workspace').checkId(args.workspace); workspace = { sha: m.sha, path: m.path, contents: require('./testrun').fingerprint(m.path, { includeTests: true }) }; } catch {}
  return `tests:${args.workspace}:${digest({ args: clean, cfg, workspace })}`;
}
module.exports = { resolve, list, stable, digest, jobKey };
