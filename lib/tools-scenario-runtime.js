// Focused scenario stages for Open WebUI, MCP and CLI. All execution references reviewed workspace
// profiles; no tool accepts a shell command. Each returned result has an interactive view by default.
module.exports = function scenarioRuntimeTools() {
  const P = () => require('./scenario-package'), R = () => require('./scenario-runtime');
  const str = description => ({ type: 'string', description }), obj = description => ({ type: 'object', description }), bool = description => ({ type: 'boolean', description });
  const source = a => { if (a.artifact) return a.artifact; if (!a.workspace || !a.package) throw new Error('Provide artifact, or workspace and package'); return P().load(a.workspace, a.package); };
  function shown(result, title, view = true, data = result) {
    if (!view) return result;
    try { return { ...result, view: require('./results').saveView('scenario-run', data, { title }) }; } catch (e) { return { ...result, viewError: e.message }; }
  }
  const location = { workspace: str('Writable workspace id'), package: str('Repository-relative path to scenario.json'), view: { ...bool('Include an interactive result view; default true'), default: true } };
  async function background(kind, a, fn) {
    const Jobs = require('./jobs'); let job = a.job ? Jobs.find(a.job) : null;
    if (a.job && (!job || !job.key.startsWith(`${kind}:`))) throw new Error(`${kind} job not found`);
    if (!job) {
      if (!a.workspace || !a.package) throw new Error('workspace and package are required to start a scenario job');
      job = Jobs.start(`${kind}:${P().digest([a.workspace, a.package, a.deadline_ms, a.quiet_ms, a.ttl_ms, a.view !== false])}`, `${kind} ${a.package}`, async log => { log('Verify package and runtime capabilities'); const result = await fn(); log(result.ok ? 'Scenario stage passed' : 'Scenario stage needs attention'); return shown(result, kind === 'scenario-start' ? 'Scenario session' : 'Scenario run', a.view); });
    }
    let completed = job;
    if (job.state === 'running') {
      let timer;
      try { completed = await Promise.race([job.promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, Math.min(50000, require('./config').getTests().waitMs))); })]); }
      finally { clearTimeout(timer); }
    }
    return completed ? { job: completed.id, state: completed.state, ms: completed.ms, ...(completed.error ? { error: completed.error } : completed.result) } : { job: job.id, state: 'running', log: job.log.slice(-3), next: `Call ${kind.replace('-', '_')} with job to wait for the result; progress is also on /admin.` };
  }
  return [
    { name: 'scenario_package', description: 'Package a complete passport scenario: captured reads, bound action inputs, independent expectations, optional PG/Kafka fixture files, and a reviewed runtime profile. Writes portable versioned test resources and returns their path/hash. Full data stays in the default visualization; include_artifact=true returns it for transfer. No application execution.',
      input: { workspace: location.workspace, name: str('Scenario name'), inventory: obj('scenario_inventory result'), state: obj('Complete scenario_state_capture result'), actions: obj('scenario_actions result'), expectations: obj('scenario_expectations result'), fixture_path: str('Optional exported related-data fixture directory'), profile: str('Repository-relative reviewed runtime profile JSON'), directory: str('Optional resource directory'), overwrite: bool('Replace existing package'), include_artifact: { ...bool('Return full portable data in tool output; default false to keep model context small'), default: false }, view: location.view }, required: ['workspace', 'inventory', 'state', 'actions', 'expectations'],
      run: a => { const artifact = P().create({ ...a, fixturePath: a.fixture_path }), saved = P().importPackage(a.workspace, artifact, a), result = { ...saved, summary: P().verify(artifact), ...(a.include_artifact ? { artifact } : {}) }; return shown(result, 'Portable scenario package', a.view, { ...result, artifact }); } },
    { name: 'scenario_import', description: 'Verify and write a portable scenario into [module/]src/test/resources/dt-scenarios/<name>. Import writes data and hashed resources; it never installs or runs commands. The referenced runtime profile must already exist in the reviewed workspace.',
      input: { workspace: location.workspace, artifact: obj('Versioned portable scenario artifact'), directory: str('Optional repository-relative resource directory'), overwrite: bool('Replace existing scenario resources'), view: location.view }, required: ['workspace', 'artifact'], run: a => shown(P().importPackage(a.workspace, a.artifact, a), 'Imported scenario', a.view) },
    { name: 'scenario_verify', description: 'Independently verify a scenario package version, content hashes, complete state/action/expectation bindings, resource hashes and proof level. No execution or network access.',
      input: { ...location, artifact: obj('Or inline portable artifact') }, run: a => shown(P().verify(source(a)), 'Scenario integrity', a.view) },
    { name: 'scenario_diff', description: 'Explain semantic changes between two verified portable scenarios: reads, inputs, expected effects, runtime profile and resource fingerprints. Expectations remain independent of observed output.',
      input: { before: obj('Previous portable artifact'), after: obj('Current portable artifact'), view: location.view }, required: ['before', 'after'], run: a => shown(P().diff(a.before, a.after), 'Scenario changes', a.view) },
    { name: 'scenario_explain', description: 'Show how every captured dependency connects to scenario actions and independently bound effects, including provenance, proof boundaries and the next execution stages.',
      input: { ...location, artifact: obj('Or inline portable artifact') }, run: a => shown(P().explain(source(a)), 'Scenario contract', a.view) },
    { name: 'scenario_preflight', description: 'Check a scenario against its reviewed runtime profile before starting anything. Node containers support HTTP/config/files with network disabled; other dependencies require explicit project test adapters. Unsupported brokers, codecs or observers are blocking gaps.',
      input: location, required: ['workspace', 'package'], run: async a => shown(await R().probe(a.workspace, a.package), 'Scenario preflight', a.view) },
    { name: 'scenario_start', description: 'Start the unchanged Node service in a private Docker network-none container, arrange exact HTTP fixtures/config/files, wait for readiness and return a leased session. No host ports, sockets, environment credentials or live HTTP fallback. Poll with job if still running. Use scenario_stop when finished.',
      input: { ...location, job: str('Poll a scenario_start job; workspace/package may be omitted'), ttl_ms: { type: 'integer', default: 300000, minimum: 1000, maximum: 3600000 } }, run: a => background('scenario-start', a, () => R().start(a.workspace, a.package, { ttlMs: a.ttl_ms })) },
    { name: 'scenario_act', description: 'Invoke one bound HTTP action on an isolated scenario session and record its actual response. Inputs come from the verified package; each action runs once per clean session.',
      input: { session: str('scenario_start session id'), action: str('Bound action id'), view: location.view }, required: ['session', 'action'], run: async a => shown(await R().act(a.session, a.action), 'Scenario action', a.view) },
    { name: 'scenario_observe', description: 'Independently collect real response, HTTP calls and file effects from a scenario session, polling until the deadline and then checking an explicit quiet window. Unexpected HTTP calls/files fail. Captured evidence and assertion results are retained for separate inspection.',
      input: { session: str('Scenario session id'), deadline_ms: { type: 'integer', minimum: 0, maximum: 30000 }, quiet_ms: { type: 'integer', minimum: 0, maximum: 10000 }, view: location.view }, required: ['session'], run: async a => shown(await R().observe(a.session, { deadlineMs: a.deadline_ms, quietMs: a.quiet_ms }), 'Observed scenario effects', a.view) },
    { name: 'scenario_assert', description: 'Recheck independently collected scenario observations against the package expectations. Does not accept model-supplied observations or alter expected values. Keeps process proof distinct from build/test proof.',
      input: { session: str('Observed scenario session id'), view: location.view }, required: ['session'], run: a => shown(R().check(a.session), 'Scenario assertions', a.view) },
    { name: 'scenario_inspect', description: 'List retained scenario sessions, including leases and cleanup failures. With session, inspect actual actions, result, timeline, logs, phase timings and proof boundaries. Expired failures remain inspectable without recapturing live state.',
      input: { session: str('Optional scenario session id; omit to list retained sessions'), view: location.view }, run: async a => shown(await R().inspect(a.session), 'Scenario evidence', a.view) },
    { name: 'scenario_stop', description: 'Stop and remove only the container owned by this scenario session. Ownership labels are verified before deletion; evidence is retained and repeated stop is safe.',
      input: { session: str('Scenario session id') }, required: ['session'], run: a => R().stop(a.session) },
    { name: 'scenario_cleanup', description: 'Recover expired scenario leases after interruption or restart, removing only containers whose ownership labels match durable session records. Reports cleanup failures explicitly.', input: {}, run: () => R().cleanup() },
    { name: 'scenario_run', description: 'Run a verified scenario end to end. The node-container adapter arranges isolated reads, starts the actual service, invokes actions, independently observes effects and always stops. The test-run adapter runs reviewed real project tests with verified multi-DB fixtures and checks the independent observation report. Poll with job if still running; proof levels and unsupported boundaries remain explicit.',
      input: { ...location, job: str('Poll a scenario_run job; workspace/package may be omitted'), deadline_ms: { type: 'integer', minimum: 0, maximum: 30000 }, quiet_ms: { type: 'integer', minimum: 0, maximum: 10000 } }, run: a => background('scenario-run', a, () => R().run(a.workspace, a.package, { deadlineMs: a.deadline_ms, quietMs: a.quiet_ms })) },
  ].map(t => ({ ...t, group: 'code' }));
};
