// Actual-service execution. Isolated Node processes use Docker --network none; JVM/build adapters
// reuse test_run and report build proof without claiming container isolation or exhaustive reads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { isDeepStrictEqual } = require('util');
const P = require('./scenario-package');
const { CACHE, readJson } = require('./util');
const ROOT = path.join(CACHE, 'scenario-runs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const checkCancellation = () => { const why = require('./trace').current()?.cancelled; if (why) throw new Error(`scenario cancelled: ${why}`); };
const bounded = (n, def, max) => { n ??= def; if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`duration/limit must be 0..${max}`); return n; };
function exec(command, args, { input, timeoutMs = 30000, cwd } = {}) {
  return new Promise(resolve => {
    let out = '', error = '', done = false;
    const child = spawn(command, args, { cwd, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LANG|LC_\w+|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|TMPDIR)$/.test(key))), stdio: ['pipe', 'pipe', 'pipe'] });
    require('./trace').child(child);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', c => { out = (out + c).slice(-2 * 1024 * 1024); }); child.stderr.on('data', c => { error = (error + c).slice(-30000); });
    const finish = (code, reason) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, error: reason || error }); };
    child.on('error', e => finish(-1, e.message)); child.on('close', code => finish(code));
    child.stdin.on('error', () => {}); child.stdin.end(input || '');
  });
}
function sessionPath(id) { if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('invalid scenario session id'); return path.join(ROOT, id); }
function load(id, { stopped = false, expired = false } = {}) {
  const dir = sessionPath(id), m = readJson(path.join(dir, 'session.json'));
  if (!m) throw new Error('scenario session not found');
  if (!stopped && m.status !== 'ready') throw new Error(`scenario session is ${m.status}`);
  if (!expired && Date.now() > m.expiresAt) throw new Error('scenario session lease expired; stop it or run scenario_cleanup');
  return { m, dir };
}
function save(m) {
  const file = path.join(sessionPath(m.id), 'session.json'), prior = readJson(file);
  if (prior?.status === 'stopped' && m.status !== 'stopped') Object.assign(m, { status: 'stopped', stoppedAt: prior.stoppedAt, timings: { ...m.timings, cleanupMs: prior.timings.cleanupMs } });
  const temp = `${file}.tmp-${crypto.randomBytes(5).toString('hex')}`;
  fs.writeFileSync(temp, JSON.stringify(m, null, 2), { mode: 0o600 }); fs.renameSync(temp, file);
}
async function locked(id, fn) {
  const lock = path.join(sessionPath(id), 'operation.lock');
  try { fs.mkdirSync(lock); } catch (e) { if (e.code === 'EEXIST') throw new Error('scenario session already has an active action/observation'); throw e; }
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
function publicSession(m) {
  return { id: m.id, workspace: m.workspace, package: m.packagePath, artifact: m.artifact, service: m.service, status: m.status,
    startedAt: m.startedAt, expiresAt: new Date(m.expiresAt).toISOString(), adapter: m.adapter, proof: m.proof, actions: m.actions, timings: m.timings, ...(m.cleanupError ? { cleanupError: m.cleanupError } : {}), ...(m.result ? { result: m.result } : {}) };
}
function profileFor(workspace, artifact) {
  if (!artifact.runtime) throw new Error('scenario package needs a reviewed workspace runtime profile');
  const p = P.workspacePath(workspace, artifact.runtime.profile), text = fs.readFileSync(p.full);
  if (P.digest(text) !== artifact.runtime.sha256) throw new Error('runtime profile changed: review it and create a new scenario package');
  const profile = JSON.parse(text);
  if (profile.version !== 1 || !['node-container', 'test-run'].includes(profile.adapter)) throw new Error('runtime profile version 1 adapter must be node-container or test-run');
  return profile;
}
function requestFor(action) {
  const binding = action.binding;
  if (!binding || typeof binding !== 'object' || !binding.path || !String(binding.path).startsWith('/') || String(binding.path).startsWith('//') || /[\r\n]/.test(binding.path)) throw new Error(`action ${action.id} needs a bound relative HTTP path`);
  const declared = String(action.target).match(/^([A-Z]+)\s+(.+)$/), method = String(binding.method || declared?.[1] || 'GET').toUpperCase();
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method) || declared && method !== declared[1]) throw new Error(`action ${action.id} method differs from its declared entry`);
  if (declared) {
    const pattern = declared[2].split(/\{[^}]*\}/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/?]+');
    if (!new RegExp(`^${pattern}(?:\\?.*)?$`).test(binding.path)) throw new Error(`action ${action.id} path differs from its declared entry`);
  }
  return { method, path: binding.path, headers: binding.headers || {}, ...(Object.hasOwn(binding, 'body') ? { body: binding.body } : {}) };
}
function validateHttp(value, id) {
  if (!Array.isArray(value?.exchanges) || !value.exchanges.length) throw new Error(`HTTP state ${id} needs exchanges [{request,response}]`);
  for (const exchange of value.exchanges) {
    if (!exchange.request || !String(exchange.request.path || '/').startsWith('/') || String(exchange.request.path || '/').startsWith('//')) throw new Error(`HTTP state ${id} exchange needs a local request.path`);
    const min = exchange.times?.min ?? exchange.times?.value ?? 1, max = exchange.times?.max ?? exchange.times?.value ?? 1;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 1000) throw new Error(`HTTP state ${id} call count must satisfy 0 <= min <= max <= 1000`);
    const responses = exchange.responses || [exchange.response];
    if (!Array.isArray(responses) || !responses.length || responses.some(r => !r || typeof r !== 'object' || r.status && (!Number.isInteger(r.status) || r.status < 100 || r.status > 599))) throw new Error(`HTTP state ${id} needs valid response fixtures`);
    responses.forEach(r => bounded(r.delayMs, 0, 10000));
  }
}
function preflight(workspace, packagePath) {
  const artifact = P.load(workspace, packagePath), profile = profileFor(workspace, artifact), gaps = [], { inventory, state, actions, expectations } = artifact.contract;
  const gap = (kind, detail, id) => gaps.push({ kind, detail, ...(id ? { id } : {}) });
  if (profile.adapter === 'node-container') {
    try { P.workspacePath(workspace, profile.entry); } catch (e) { gap('entrypoint', e.message); }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(profile.image || '')) gap('image', 'Specify an existing stock Node image; the runtime never pulls images');
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535 || profile.port === 19081) gap('port', 'Service port must be 1..65535 and different from stub port 19081');
    if (profile.args && (!Array.isArray(profile.args) || profile.args.length > 100 || profile.args.some(a => typeof a !== 'string' || a.length > 2048))) gap('args', 'Entrypoint args must be at most 100 strings of at most 2048 characters');
    try {
      bounded(profile.readyTimeoutMs, 10000, 60000); bounded(profile.actionTimeoutMs, 10000, 30000);
      bounded(profile.temporal?.deadlineMs, 1000, 30000); bounded(profile.temporal?.quietMs, 0, 10000); bounded(profile.temporal?.intervalMs, 50, 1000);
      if (profile.readyTimeoutMs === 0 || profile.actionTimeoutMs === 0) throw new Error('Readiness and action deadlines must be positive');
      if (profile.readyPath && (!profile.readyPath.startsWith('/') || profile.readyPath.startsWith('//') || /[\r\n]/.test(profile.readyPath))) throw new Error('Readiness path must be a relative HTTP path');
      if (profile.readyStatus !== undefined && (!Number.isInteger(profile.readyStatus) || profile.readyStatus < 100 || profile.readyStatus > 599)) throw new Error('Readiness status must be 100..599');
    } catch (e) { gap('runtime-limits', e.message); }
    const mapped = new Set();
    const filePaths = [];
    for (const [kind, bindings] of Object.entries({ http: profile.http, config: profile.config, file: profile.files })) for (const [id, binding] of Object.entries(bindings || {})) {
      const dep = inventory.states.find(s => s.id === id);
      if (!dep || dep.kind !== kind) { gap('state-binding', `Runtime ${kind} mapping does not match inventory state`, id); continue; }
      mapped.add(id);
      try {
        if (kind === 'http') { validateHttp(state.states[id].value, id); if (!/^[A-Z][A-Z0-9_]*$/.test(binding)) throw new Error('HTTP mapping must name an environment variable'); }
        if (kind === 'config' && !/^[A-Z][A-Z0-9_]*$/.test(binding)) throw new Error('Config mapping must name an environment variable');
        if (kind === 'file') {
          P.relative(binding.path); filePaths.push(binding.path);
          if (!['json', 'text', 'base64'].includes(binding.encoding || 'json')) throw new Error('File encoding must be json, text or base64');
          if (['text', 'base64'].includes(binding.encoding) && typeof state.states[id].value !== 'string') throw new Error('Text/base64 file state must be an explicit string');
          if (binding.encoding === 'base64' && Buffer.from(state.states[id].value, 'base64').toString('base64') !== state.states[id].value) throw new Error('File base64 data must be canonical and valid');
        }
      } catch (e) { gap('state-binding', e.message, id); }
    }
    for (const dep of inventory.states) if (dep.required !== false && !mapped.has(dep.id)) gap('unsupported-runtime-state', `node-container supports explicit HTTP, config and file reads; ${dep.kind} needs a project test adapter`, dep.id);
    for (const action of actions.actions) try { if (action.kind !== 'http') throw new Error(`${action.kind} actions need a project test adapter; native Kafka/schedule/method replay is not implemented`); requestFor(action); } catch (e) { gap('unsupported-runtime-action', e.message, action.id); }
    const envVars = [...Object.values(profile.http || {}), ...Object.values(profile.config || {})];
    if (new Set(filePaths).size !== filePaths.length || filePaths.some(file => filePaths.some(other => other !== file && file.startsWith(other + '/')))) gap('file-binding', 'File state paths must be distinct and cannot be parents of another file');
    if (new Set(envVars).size !== envVars.length || envVars.some(k => ['PATH', 'HOME', 'NODE_OPTIONS', 'NODE_PATH', 'PORT', 'DT_SCENARIO_FILES'].includes(k))) gap('environment-binding', 'State environment bindings must be unique and cannot replace runtime control variables');
    for (const id of Object.keys(profile.observations || {})) if (!expectations.expectations.some(e => e.id === id)) gap('observation', 'Unknown expectation id', id);
    for (const expected of expectations.expectations) {
      const id = expected.id, observation = profile.observations?.[id] || (['status', 'return'].includes(expected.kind) ? { kind: expected.kind, action: expected.action } : null);
      if (!observation) { gap('unbound-observer', 'Bind an independent runtime observer for this expectation', id); continue; }
      if (!['status', 'return', 'http', 'file'].includes(observation.kind)) gap('observation', `Unsupported observer ${observation.kind}`, id);
      if (observation.kind !== expected.kind) gap('observation-kind', `A ${expected.kind} expectation cannot be satisfied by a ${observation.kind} observer`, id);
      if (Object.hasOwn(observation, 'action') && observation.action !== expected.action) gap('observation-action', 'Observer action must equal the declared expectation action', id);
      const action = actions.actions.find(a => a.id === expected.action);
      if (expected.action && !action) gap('observation-action', 'Expectation action is not in the bound runtime actions', id);
      if (expected.select && ['kind', 'target', 'action'].some(key => Object.hasOwn(expected.select, key) && !isDeepStrictEqual(expected.select[key], expected[key]))) gap('observation-selector', 'Runtime selectors cannot change declared effect kind, target or action', id);
      if (['status', 'return'].includes(observation.kind) && (!action || !isDeepStrictEqual(expected.target, action.target))) gap('observation-target', 'Response observer target must equal its declared action entry', id);
      if (observation.kind === 'http') {
        const dep = inventory.states.find(s => s.id === observation.state);
        if (!profile.http?.[observation.state] || dep?.kind !== 'http') gap('observation', 'HTTP observer needs a mapped HTTP state id', id);
        else if (!isDeepStrictEqual(dep.target, expected.target) || expected.action && !action?.dependencies.includes(dep.id)) gap('observation-target', 'HTTP observer must collect the exact target declared for this action', id);
      }
      if (observation.kind === 'file') try { P.relative(observation.path); if (typeof expected.target?.path !== 'string' || expected.target.path !== observation.path) throw new Error('File observer path must equal the concrete declared expectation target.path'); } catch (e) { gap('observation-target', e.message, id); }
    }
  } else {
    if (!Array.isArray(profile.tests) || !profile.tests.length || profile.tests.some(t => typeof t !== 'string')) gap('tests', 'test-run profile needs exact project test selectors');
    if (!['build', 'fast', 'auto', undefined].includes(profile.mode)) gap('mode', 'test mode must be build, fast or auto');
    try { P.workspacePath(workspace, profile.report, { missing: true }); if (!/^(?:[^/]+\/)*(?:target|build)\//.test(profile.report)) throw new Error('Project observation report must be below a target/ or build/ directory'); } catch (e) { gap('observation-report', e.message); }
    if (Object.keys(artifact.resources.files).length && !profile.fixtureBindings && Object.keys(JSON.parse(artifact.resources.files['fixture/manifest.json'].data).databases || {}).length > 1) gap('datasources', 'Multiple fixture databases need explicit fixtureBindings');
    try { P.verifyExtracted(workspace, packagePath, artifact); } catch (e) { gap('fixture-integrity', e.message); }
  }
  return { ok: !gaps.length, workspace, package: packagePath, artifact: artifact.sha256, service: artifact.service, adapter: profile.adapter, gaps,
    support: profile.adapter === 'node-container' ? { states: ['http', 'config', 'file'], actions: ['http'], observations: ['status', 'return', 'http', 'file'], network: 'docker --network none', brokerCodecs: [] } : { execution: 'existing test_run', dependencies: 'owned by reviewed project tests', runtimeReadsVerified: false },
    proof: { level: 'discovery', applicationExecuted: false, runtimeReadsVerified: false } };
}
async function probe(workspace, packagePath) {
  checkCancellation();
  const report = preflight(workspace, packagePath);
  if (!report.ok || report.adapter !== 'node-container') return report;
  const artifact = P.load(workspace, packagePath), profile = profileFor(workspace, artifact);
  const inspected = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', profile.image], { timeoutMs: 10000 });
  report.prerequisites = { image: profile.image, imageId: inspected.code === 0 ? inspected.out.trim() : null, docker: inspected.code === 0, imagePull: false };
  if (inspected.code !== 0) { report.ok = false; report.gaps.push({ kind: 'docker-image', detail: `Docker must be reachable and ${profile.image} must already exist: ${inspected.error || inspected.out}` }); }
  return report;
}
async function identity(m) {
  const r = await exec('docker', ['inspect', '--format', '{{json .Config.Labels}}', m.container]);
  if (r.code !== 0) {
    // A failed daemon/auth/transport call is not evidence that the owned resource disappeared.
    // Keep its lease/capacity reservation intact so cleanup remains visible and retryable.
    const absent = new RegExp(`^(?:Error(?: response from daemon)?:\\s*)?No such (?:object|container):\\s*${m.container.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
    if (r.code === 1 && absent.test(r.error)) return false;
    throw new Error(`cannot verify scenario container: ${r.error || r.out || `docker inspect exited ${r.code}`}`);
  }
  let labels; try { labels = JSON.parse(r.out); } catch { throw new Error('cannot verify scenario container ownership'); }
  if (!labels || labels['dt.scenario.owner'] !== m.owner || labels['dt.scenario.id'] !== m.id) throw new Error('container ownership does not match scenario session; refusing to operate');
  return true;
}
function sessionArtifact(m) {
  const artifact = P.load(m.workspace, m.packagePath);
  if (artifact.sha256 !== m.artifact) throw new Error('scenario package changed during session');
  if (!isDeepStrictEqual(profileFor(m.workspace, artifact), m.profile)) throw new Error('durable session profile differs from its reviewed profile');
  const checked = preflight(m.workspace, m.packagePath);
  if (!checked.ok) throw new Error(`session runtime preflight failed: ${checked.gaps.map(g => `${g.kind}: ${g.detail}`).join('; ')}`);
  return artifact;
}
function fileTree(dir) {
  const result = {};
  function walk(root, prefix) {
    if (!fs.existsSync(root)) return;
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name, full = path.join(root, item.name);
      if (item.isSymbolicLink()) { result[rel] = { unsupported: 'symlink' }; continue; }
      if (item.isDirectory()) walk(full, rel);
      else if (item.isFile()) { const stat = fs.statSync(full); result[rel] = stat.size > 2 * 1024 * 1024 ? { unsupported: 'file exceeds 2 MiB' } : { sha256: P.digest(fs.readFileSync(full)), bytes: stat.size }; }
      else result[rel] = { unsupported: 'special file' };
      if (Object.keys(result).length > 1000) throw new Error('scenario file tree exceeds 1000 files');
    }
  }
  walk(dir, ''); return result;
}
function fileValue(dir, observer) {
  const full = path.join(dir, P.relative(observer.path));
  let cursor = full;
  while (cursor !== dir) { if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('file observer refuses symlink'); cursor = path.dirname(cursor); }
  if (!fs.existsSync(full)) return null;
  if (!fs.statSync(full).isFile() || fs.statSync(full).size > 2 * 1024 * 1024) throw new Error('file observer requires an ordinary file <= 2 MiB');
  const body = fs.readFileSync(full); return observer.encoding === 'base64' ? body.toString('base64') : observer.encoding === 'text' ? body.toString('utf8') : JSON.parse(body.toString('utf8'));
}
async function request(m, request) {
  checkCancellation();
  if (!await identity(m)) throw new Error('scenario container disappeared');
  const r = await exec('docker', ['exec', '-i', m.container, 'node', '/dt-control/client.js'], { input: JSON.stringify({ port: m.port, ...request }), timeoutMs: (request.timeoutMs || 10000) + 3000 });
  if (r.code !== 0) throw new Error(`service request failed: ${r.error || r.out}`);
  try { return JSON.parse(r.out); } catch { throw new Error('service client did not return a valid response'); }
}
async function start(workspace, packagePath, { ttlMs = 300000 } = {}) {
  const started = Date.now(), report = await probe(workspace, packagePath);
  if (!report.ok) return { ok: false, preflight: report };
  const artifact = P.load(workspace, packagePath), profile = profileFor(workspace, artifact);
  if (profile.adapter === 'test-run') throw new Error('test-run is one-shot: use scenario_run');
  ttlMs = bounded(ttlMs, 300000, 3600000);
  if (ttlMs < 1000) throw new Error('scenario lease must be at least 1000 ms');
  const id = crypto.randomBytes(12).toString('hex'), dir = sessionPath(id), owner = crypto.randomBytes(20).toString('hex');
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const m = { id, workspace, packagePath, artifact: artifact.sha256, service: artifact.service, profile, adapter: profile.adapter, status: 'starting', startedAt: new Date().toISOString(), expiresAt: Date.now() + ttlMs,
    container: `dt-scenario-${id}`, owner, port: profile.port, actions: [], timings: {}, proof: { level: 'process', applicationExecuted: false, runtimeReadsVerified: false, network: 'none' } };
  const reservation = path.join(ROOT, '.reservation.lock');
  try { fs.mkdirSync(reservation); } catch (e) { if (e.code === 'EEXIST') throw new Error('scenario startup reservation is busy; retry after the current reservation'); throw e; }
  try {
    fs.writeFileSync(path.join(reservation, 'owner.json'), JSON.stringify({ pid: process.pid }));
    const active = fs.readdirSync(ROOT).filter(id => /^[a-f0-9]{24}$/.test(id)).map(id => readJson(path.join(ROOT, id, 'session.json'))).filter(s => s && ['starting', 'ready'].includes(s.status));
    const maximum = require('./config').getTests().scenarioConcurrency ?? 2;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 8) throw new Error('tests.scenarioConcurrency must be 1..8');
    if (active.length >= maximum) throw new Error(`scenario capacity ${maximum} reached; stop or clean up a session before starting another`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); save(m);
  } finally { fs.rmSync(reservation, { recursive: true, force: true }); }
  try {
    const input = { profile, http: {}, ports: {}, env: { PORT: String(profile.port), DT_SCENARIO_FILES: '/dt-files' } };
    let port = 19081;
    for (const [sid, variable] of Object.entries(profile.http || {})) {
      if (port === profile.port) port++;
      input.http[sid] = artifact.contract.state.states[sid].value; input.ports[sid] = port; input.env[variable] = `http://127.0.0.1:${port++}`;
    }
    for (const [sid, variable] of Object.entries(profile.config || {})) { const v = artifact.contract.state.states[sid].value; input.env[variable] = typeof v === 'object' ? JSON.stringify(v) : String(v); }
    fs.mkdirSync(path.join(dir, 'files'));
    for (const [sid, binding] of Object.entries(profile.files || {})) {
      const value = artifact.contract.state.states[sid].value, full = path.join(dir, 'files', binding.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, binding.encoding === 'base64' ? Buffer.from(value, 'base64') : binding.encoding === 'text' ? String(value) : JSON.stringify(value));
    }
    m.filesBefore = fileTree(path.join(dir, 'files'));
    fs.mkdirSync(path.join(dir, 'control')); fs.mkdirSync(path.join(dir, 'evidence'));
    fs.writeFileSync(path.join(dir, 'control/input.json'), JSON.stringify(input));
    fs.writeFileSync(path.join(dir, 'control/harness.js'), require('./scenario-container').harness);
    fs.writeFileSync(path.join(dir, 'control/client.js'), require('./scenario-container').client);
    fs.writeFileSync(path.join(dir, 'control/audit.js'), require('./scenario-container').audit);
    fs.writeFileSync(path.join(dir, 'evidence/events.jsonl'), '');
    const root = fs.realpathSync(require('./workspace').checkId(workspace).path);
    if (root.includes(',') || dir.includes(',')) throw new Error('Docker mount paths containing commas are unsupported');
    const create = await exec('docker', ['run', '--detach', '--pull=never', '--name', m.container, '--label', `dt.scenario.owner=${owner}`, '--label', `dt.scenario.id=${id}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--cpus', '1', '--tmpfs', '/tmp:rw,nosuid,size=64m', '--mount', `type=bind,source=${root},target=/workspace,readonly`, '--mount', `type=bind,source=${dir}/control,target=/dt-control,readonly`, '--mount', `type=bind,source=${dir}/files,target=/dt-files`, '--mount', `type=bind,source=${dir}/evidence,target=/dt-evidence`, '--workdir', '/workspace', '--entrypoint', 'node', profile.image, '/dt-control/harness.js']);
    if (create.code !== 0) throw new Error(`Docker start failed: ${create.error || create.out}`);
    m.timings.startMs = Date.now() - started;
    const deadline = Date.now() + bounded(profile.readyTimeoutMs, 10000, 60000), ready = profile.readyPath || '/health';
    if (!ready.startsWith('/') || ready.startsWith('//')) throw new Error('readiness path must be local');
    let last;
    do {
      checkCancellation();
      try { const response = await request(m, { path: ready, timeoutMs: 500 }); if (response.status === (profile.readyStatus || 200)) { m.status = 'ready'; m.proof.applicationExecuted = true; m.timings.readyMs = Date.now() - started - m.timings.startMs; save(m); return { ok: true, session: publicSession(m) }; } last = `HTTP ${response.status}`; } catch (e) { last = e.message; }
      await sleep(50);
    } while (Date.now() < deadline);
    throw new Error(`Service readiness deadline expired: ${last}`);
  } catch (e) {
    m.status = 'failed'; m.error = e.message; save(m);
    let logs = ''; try { logs = (await exec('docker', ['logs', '--tail', '100', m.container])).out; } catch {}
    await stop(id).catch(() => {});
    return { ok: false, error: e.message, session: publicSession(m), logs };
  }
}
async function act(id, actionId) {
  return locked(id, async () => {
    const { m } = load(id), artifact = sessionArtifact(m);
    const action = artifact.contract.actions.actions.find(a => a.id === actionId);
    if (!action) throw new Error('unknown scenario action');
    if (m.actions.some(a => a.id === actionId)) throw new Error('action already performed; start a clean session for deterministic replay');
    const started = Date.now(), before = readEvents(id).length;
    try {
      const response = await request(m, { ...requestFor(action), timeoutMs: bounded(m.profile.actionTimeoutMs, 10000, 30000) });
      const result = { id: actionId, at: new Date().toISOString(), ms: Date.now() - started, eventStart: before, response };
      m.actions.push(result); save(m); return { ok: true, session: id, action: result };
    } catch (e) { m.actions.push({ id: actionId, at: new Date().toISOString(), ms: Date.now() - started, error: e.message, eventStart: before }); save(m); return { ok: false, session: id, action: actionId, error: e.message }; }
  });
}
function readEvents(id) {
  const file = path.join(sessionPath(id), 'evidence/events.jsonl');
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('scenario event evidence exceeds 4 MiB');
  const text = fs.readFileSync(file, 'utf8'), lines = text.split('\n');
  if (lines.at(-1) !== '') lines.pop(); // writer may be completing its final atomic line
  return lines.filter(Boolean).map(line => JSON.parse(line));
}
function sample(m, artifact) {
  const observed = {}, events = readEvents(m.id), violations = events.filter(e => ['http-mismatch', 'process-error', 'process-exit', 'file-watch-gap'].includes(e.kind));
  const { expectations } = artifact.contract;
  for (const expected of expectations.expectations) {
    const observer = m.profile.observations?.[expected.id] || (['status', 'return'].includes(expected.kind) ? { kind: expected.kind, action: expected.action } : null);
    if (!observer) continue;
    const action = m.actions.find(a => a.id === (observer.action || expected.action));
    if (expected.action && !action) continue;
    if (observer.kind === 'status' && action?.response) observed[expected.id] = action.response.status;
    else if (observer.kind === 'return' && action?.response) observed[expected.id] = action.response.body;
    else if (observer.kind === 'http') { const next = action && m.actions[m.actions.indexOf(action) + 1]; observed[expected.id] = events.slice(action?.eventStart || 0, next?.eventStart).filter(e => e.kind === 'http' && e.state === observer.state).map(e => e.request); }
    else if (observer.kind === 'file') observed[expected.id] = fileValue(path.join(sessionPath(m.id), 'files'), observer);
  }
  // Every unexpected file write is independently detected, including undeclared side files.
  const files = fileTree(path.join(sessionPath(m.id), 'files')), allowed = new Set(Object.values(m.profile.observations || {}).filter(o => o.kind === 'file').map(o => o.path));
  const allowedDirectories = new Set([...allowed].flatMap(rel => { const parts = rel.split('/'), result = []; for (let n = 1; n < parts.length; n++) result.push(parts.slice(0, n).join('/')); return result; }));
  for (const event of events) if (['file-change', 'file-operation'].includes(event.kind) && !allowed.has(event.path) && !allowedDirectories.has(event.path)) violations.push({ kind: 'unexpected-file-effect', path: event.path, change: event.change || event.operation });
  for (const rel of new Set([...Object.keys(files), ...Object.keys(m.filesBefore || {})])) if (!isDeepStrictEqual(files[rel], m.filesBefore?.[rel]) && !allowed.has(rel)) violations.push({ kind: 'unexpected-file-effect', path: rel });
  for (const [sid, value] of Object.entries(artifact.contract.state.states)) if (m.profile.http?.[sid]) for (let index = 0; index < value.value.exchanges.length; index++) {
    const exchange = value.value.exchanges[index], count = events.filter(e => e.kind === 'http' && e.state === sid && e.exchange === index).length;
    const min = exchange.times?.min ?? exchange.times?.value ?? 1, max = exchange.times?.max ?? exchange.times?.value ?? 1;
    if (count < min || count > max) violations.push({ kind: 'http-call-count', state: sid, exchange: index, count, min, max });
  }
  for (const a of artifact.contract.actions.actions) if (!m.actions.some(done => done.id === a.id && done.response)) violations.push({ kind: 'unperformed-action', action: a.id });
  const checks = require('./scenario').check(expectations, observed);
  return { ok: checks.ok && !violations.length, observed, checks, violations, events, files, proof: { ...m.proof, level: 'process', applicationExecuted: true, independentObservations: true, runtimeReadsVerified: false } };
}
async function observe(id, { deadlineMs, quietMs, intervalMs } = {}) {
  return locked(id, async () => {
    const { m } = load(id), artifact = sessionArtifact(m);
    if (!await identity(m)) throw new Error('scenario container disappeared');
    const temporal = m.profile.temporal || {};
    deadlineMs = bounded(deadlineMs, temporal.deadlineMs ?? 1000, 30000); quietMs = bounded(quietMs, temporal.quietMs ?? 0, 10000); intervalMs = Math.max(10, bounded(intervalMs, temporal.intervalMs ?? 50, 1000));
    const start = Date.now(), deadline = start + deadlineMs; let result, quietStart = null, samples = 0;
    do {
      checkCancellation();
      result = sample(m, artifact); samples++;
      if (result.ok) { quietStart ??= Date.now(); if (Date.now() - quietStart >= quietMs) break; }
      else quietStart = null;
      if (Date.now() >= deadline) break;
      await sleep(Math.min(intervalMs, deadline - Date.now()));
    } while (Date.now() <= deadline);
    if (result.ok && quietStart != null && Date.now() - quietStart < quietMs) { result.ok = false; result.violations.push({ kind: 'quiet-window-incomplete', requiredMs: quietMs, observedMs: Date.now() - quietStart }); }
    result.temporal = { deadlineMs, quietMs, elapsedMs: Date.now() - start, samples };
    m.result = result; m.timings.observeMs = result.temporal.elapsedMs; save(m);
    return { session: id, ...result };
  });
}
async function inspect(id) {
  if (!id) return { sessions: (fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter(id => /^[a-f0-9]{24}$/.test(id)).map(id => readJson(path.join(ROOT, id, 'session.json'))).filter(Boolean) : []).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100).map(m => ({ ...publicSession(m), ...(m.cleanupError ? { cleanupError: m.cleanupError } : {}) })) };
  const { m } = load(id, { stopped: true, expired: true });
  const logs = m.status === 'stopped' ? m.logs || '' : (await exec('docker', ['logs', '--tail', '100', m.container])).out;
  return { session: publicSession(m), events: readEvents(id), logs, ...(m.error ? { error: m.error } : {}) };
}
function check(id) {
  const { m } = load(id, { stopped: true, expired: true });
  if (!m.result) throw new Error('Collect independent effects with scenario_observe first');
  const artifact = sessionArtifact(m);
  const checks = require('./scenario').check(artifact.contract.expectations, m.result.observed);
  return { session: id, ok: checks.ok && !m.result.violations.length, checks, violations: m.result.violations, temporal: m.result.temporal, proof: m.result.proof };
}
async function stop(id) {
  const { m } = load(id, { stopped: true, expired: true }), started = Date.now();
  let present;
  try { present = await identity(m); } catch (e) { m.cleanupError = e.message; save(m); throw e; }
  if (m.status === 'stopped' && !present) return { stopped: true, session: id, reused: true };
  if (present) {
    const logs = await exec('docker', ['logs', '--tail', '100', m.container]); m.logs = `${logs.out}${logs.error}`.slice(-30000);
    const r = await exec('docker', ['rm', '--force', m.container]);
    if (r.code !== 0) { m.cleanupError = r.error; save(m); throw new Error(`scenario container cleanup failed: ${r.error}`); }
  }
  delete m.cleanupError; m.status = 'stopped'; m.stoppedAt = new Date().toISOString(); m.timings.cleanupMs = Date.now() - started; save(m);
  return { stopped: true, session: id, ms: m.timings.cleanupMs };
}
async function cleanup() {
  const results = [];
  const reservation = path.join(ROOT, '.reservation.lock');
  if (fs.existsSync(reservation) && Date.now() - fs.statSync(reservation).mtimeMs > 30000) {
    const owner = readJson(path.join(reservation, 'owner.json')); let alive = false;
    if (owner?.pid) try { process.kill(owner.pid, 0); alive = true; } catch (e) { if (e.code !== 'ESRCH') alive = true; }
    if (!alive) { fs.rmSync(reservation, { recursive: true, force: true }); results.push({ recoveredStartupReservation: true }); }
  }
  for (const id of fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter(id => /^[a-f0-9]{24}$/.test(id)) : []) {
    const { m } = load(id, { stopped: true, expired: true });
    if (Date.now() > m.expiresAt) try { results.push(await stop(id)); } catch (e) { results.push({ session: id, error: e.message }); }
  }
  return { ok: results.every(r => !r.error), results };
}
async function run(workspace, packagePath, options = {}) {
  const report = await probe(workspace, packagePath);
  if (!report.ok) return { ok: false, preflight: report };
  const artifact = P.load(workspace, packagePath), profile = profileFor(workspace, artifact);
  if (profile.adapter === 'test-run') {
    const root = path.posix.dirname(packagePath), fixture = artifact.resources.files['fixture/manifest.json'];
    // test_run/reproduction verifies these extracted files again before loading any database.
    const reportFile = P.workspacePath(workspace, profile.report, { missing: true }).full;
    fs.rmSync(reportFile, { force: true });
    const result = await require('./testrun').run(workspace, { tests: profile.tests, mode: profile.mode || 'build', scenarioPath: packagePath, scenarioOutput: profile.report, ...(fixture ? { fixturePath: `${root}/fixture`, fixtureBindings: profile.fixtureBindings, fixtureTemplate: profile.template === true } : {}) });
    const gaps = []; let observationReport, checks;
    try {
      P.workspacePath(workspace, profile.report);
      if (fs.statSync(reportFile).size > 4 * 1024 * 1024) throw new Error('project observation report exceeds 4 MiB');
      observationReport = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (observationReport.version !== 1 || observationReport.artifact !== artifact.sha256) throw new Error('project observation report version/artifact fingerprint mismatch');
      const actual = observationReport.actions;
      if (!Array.isArray(actual) || actual.some(id => typeof id !== 'string') || new Set(actual).size !== actual.length || !isDeepStrictEqual([...actual].sort(), artifact.contract.actions.actions.map(a => a.id).sort())) throw new Error('project report must account for every bound action exactly once');
      checks = require('./scenario').check(artifact.contract.expectations, observationReport.observed);
    } catch (e) { gaps.push({ kind: 'project-observation-report', detail: e.message }); }
    return { ok: result.outcome === 'passed' && !gaps.length && checks?.ok === true, adapter: 'test-run', result, gaps, checks, observed: observationReport?.observed,
      proof: { level: 'build', applicationExecuted: result.counts?.tests > 0, independentObservations: 'collected by reviewed project adapter', expectationsChecked: checks?.ok === true, runtimeReadsVerified: false, network: 'owned by project test adapter' } };
  }
  const prepared = await start(workspace, packagePath, options);
  if (!prepared.ok) return prepared;
  const id = prepared.session.id;
  let output;
  try {
    for (const action of artifact.contract.actions.actions) { const r = await act(id, action.id); if (!r.ok) { output = { ok: false, session: id, action: r, proof: prepared.session.proof }; break; } }
    if (!output) output = await observe(id, options);
  } finally { await stop(id); }
  const final = await inspect(id);
  return { ...output, timings: final.session.timings, sessionStatus: final.session.status };
}
module.exports = { preflight, probe, start, act, observe, check, inspect, stop, cleanup, run, requestFor, profileFor, fileTree, exec };
