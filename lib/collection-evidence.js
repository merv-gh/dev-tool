// A presentation boundary, independent of the executor: retained reports are never runnable
// snapshots. Raw definitions, hooks and bound inputs stay in the in-memory execution plan.
const sensitive = key => /(^|[_\s.-])(password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|client[_-]?secret)([_\s.-]|$)/i.test(String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
function secrets(value, into = new Set()) {
  if (!value || typeof value !== 'object') return into;
  for (const [key, child] of Object.entries(value)) {
    if (sensitive(key) && typeof child === 'string' && child) into.add(child);
    else secrets(child, into);
  }
  return into;
}
function clean(value, known = new Set()) {
  const found = secrets(value, new Set(known));
  const text = value => {
    let out = value.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/?#@]*:[^\s/@]+@/gi, '$1[redacted]@').replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]').replace(/([?&](?:access_token|token|api_?key|password|secret)=)[^&#\s"']+/gi, '$1[redacted]');
    for (const secret of [...found].sort((a, b) => b.length - a.length)) {
      if (out === secret) return '[redacted]';
      if (secret.length >= 4) out = out.split(secret).join('[redacted]');
    }
    return out;
  };
  const visit = x => typeof x === 'string' ? text(x) : Array.isArray(x) ? x.map(visit) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([key, child]) => [key, sensitive(key) && child != null ? '[redacted]' : visit(child)])) : x;
  return visit(value);
}
function configuredSecrets() {
  const found = new Set();
  try {
    const C = require('./config');
    secrets({ ...C.parseEnvFile(C.SECRETS_FILE), ...C.parseEnvFile(require('path').join(C.HOME, '.env.personal')) }, found);
    secrets(C.interpolate(C.load().raw, C.load().lookup()), found);
    const personal = C.getPersonal();
    for (const value of [personal.bitbucket?.token, personal.confluence?.token, personal.llm?.key, C.getServer().apiKey]) if (value) found.add(value);
  } catch {}
  return found;
}
function definitions(items = {}) {
  return Object.fromEntries(Object.entries(items).map(([id, def]) => [id, {
    id, description: def.description || '', revision: require('crypto').createHash('sha256').update(JSON.stringify(def)).digest('hex'),
    parameters: Object.keys(def.params || {}), steps: (def.steps || []).map((step, index) => ({ step: index + 1, kind: ['tool', 'http', 'script', 'browser', 'open', 'wait', 'js', 'set', 'transform'].find(k => step[k] !== undefined) || 'step' })),
  }]));
}
function artifact(run, known) {
  const out = JSON.parse(JSON.stringify(run));
  const retainInputs = out.evidence === true;
  out.definitions = definitions(run.definitions);
  out.plan.definitions = out.definitions;
  delete out.plan.collectionChains;
  const hideCase = c => { delete c.overrides; if (!retainInputs) { delete c.params; c.matrix = {}; } };
  out.cases.forEach(hideCase); out.plan.cases.forEach(hideCase);
  for (const scope of out.plan.scopes) {
    scope.hooks = ['before', 'after', 'finally'].filter(key => scope[key]);
    for (const key of ['before', 'after', 'finally']) delete scope[key];
    if (!retainInputs) scope.params = {};
  }
  out.retention = { inputs: retainInputs ? 'included' : 'omitted', credentials: 'redacted', definitions: 'revision-summaries', executableSnapshot: false };
  return clean(out, known);
}
module.exports = { secrets, configuredSecrets, artifact };
