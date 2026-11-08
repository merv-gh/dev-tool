// Opt in with DT_SEMANTIC_LIVE_URL/TOKEN. Uses real Joern, real Git branches and Java behavior.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const enabled = !!(process.env.DT_SEMANTIC_LIVE_URL && process.env.DT_SEMANTIC_LIVE_TOKEN);
test('real branch value-flow comparison, compact evidence and workspace fix retain the original analyses', { skip: !enabled, timeout: 15 * 60000 }, async t => {
  const keep = process.env.DT_SEMANTIC_BRANCH_HOME, home = path.resolve(keep || fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flow-live-')));
  fs.mkdirSync(home, { recursive: true }); process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0'; process.env.DT_NO_DOCTOR = '1';
  for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_WORK_DIR', 'DT_PASSPORTS_DIR', 'DT_SEMANTIC_URL', 'DT_SEMANTIC_TOKEN']) delete process.env[k];
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { evaluation: {} }, semantic: { url: process.env.DT_SEMANTIC_LIVE_URL, token: process.env.DT_SEMANTIC_LIVE_TOKEN }, tests: { compileCheck: false } }));
  const F = require('../dev/branch-flow-fixture'), CI = require('../lib/codeindex'), S = require('../lib/semantic-code'), T = require('../lib/tools'), W = require('../lib/workspace');
  t.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); if (!keep) fs.rmSync(home, { recursive: true, force: true }); });
  const settle = async (name, args) => { let r = await T.call(name, { ...args, format: 'full' }); for (let i = 0; r.state === 'running' && i < 24; i++) r = await T.call(name, { ...(name === 'semantic_query' ? { operation: args.operation } : {}), job: r.job, waitMs: 30000, format: 'full' }); assert.ok(!r.error && r.state !== 'running', JSON.stringify(r)); return r; };
  const stateFile = path.join(home, 'fixture.json'); let state;
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile));
  else {
    const f = F.create(path.join(home, 'service')), baseRoot = path.join(home, 'baseline');
    F.git(f.root, ['worktree', 'add', '--detach', '--quiet', baseRoot, f.baseline]);
    const a = CI.build(baseRoot, f.repo, { project: 'DEMO', repo: 'payments', sha: f.baseline, ref: 'main' }), b = CI.build(f.root, f.repo, { project: 'DEMO', repo: 'payments', sha: f.feature, ref: 'feature/rebates' });
    const before = await settle('semantic_index', { revisionKey: a.revisionKey }), after = await settle('semantic_index', { revisionKey: b.revisionKey });
    state = { ...f, baseKey: a.revisionKey, featureKey: b.revisionKey, baseAnalysis: before.analyses[0].id, featureAnalysis: after.analyses[0].id };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
  const request = { operation: 'compare', mode: 'dataflow', analyses: [state.baseAnalysis, state.featureAnalysis], from: { kind: 'method', name: 'submit', parameter: 'rebate' }, to: { kind: 'call', name: 'publish', argument: 2 }, maxHops: 30, maxPaths: 8, waitMs: 30000 };
  const report = { repo: state.repo, baseline: state.baseline, feature: state.feature, checks: {} };
  await t.test('feature paths reveal changed event expression and conservative predicate coupling at the wrong ledger value', async () => {
    const event = await settle('semantic_query', request); report.event = event;
    assert.equal(event.comparison.before.status, 'no-supported-path', JSON.stringify(event));
    assert.equal(event.comparison.after.status, 'static-dataflow', JSON.stringify(event));
    assert.ok(event.results.some(r => r.change === 'added'));
    const ledger = await settle('semantic_query', { ...request, to: { ...request.to, name: 'save' } }); report.ledger = ledger;
    assert.equal(ledger.comparison.before.status, 'no-supported-path'); assert.equal(ledger.comparison.after.status, 'static-dataflow', JSON.stringify(ledger));
    const candidate=ledger.results.find(r=>r.after)?.after;
    assert.equal(candidate.nodes.at(-1).code,'gross'); assert.ok(candidate.nodes.some(n=>n.inCondition)); assert.ok(candidate.caveats.length);
    assert.equal(ledger.proof.feasibility, 'unknown'); assert.ok(ledger.gaps.some(g => g.kind === 'bounded-absence'));
    assert.equal(F.grade(state.root).passed, false); report.checks.bugConfirmed = true;
  });
  await t.test('edited workspace is a new retained source snapshot of the same service', async () => {
    const opened = await W.open({ project: 'DEMO', repo: 'payments', ref: 'feature/rebates', url: state.root, fresh: true });
    W.write(opened.id, F.FILE, { edits: [{ find: 'ledger.save(tenant, gross);', replace: 'ledger.save(tenant, payable);' }] });
    assert.equal(F.grade(W.checkId(opened.id).path).passed, true);
    const fixed = await settle('semantic_index', { repo: 'work/' + opened.id }); report.fixedAnalysis = fixed.analyses[0];
    assert.equal(fixed.analyses[0].repo, state.repo); assert.equal(fixed.analyses[0].sha, state.feature);
    assert.notEqual(fixed.analyses[0].sourceDigest, S.load(state.featureAnalysis).sourceDigest);
    const delta = await settle('semantic_query', { ...request, analyses: [state.featureAnalysis, fixed.analyses[0].id], to: { ...request.to, name: 'save' } }); report.fixed = delta;
    assert.equal(delta.comparison.before.status, 'static-dataflow'); assert.equal(delta.comparison.after.status, 'static-dataflow', JSON.stringify(delta));
    assert.ok(delta.results.some(r => r.change === 'changed'&&r.before.nodes.at(-1).code==='gross'&&r.after.nodes.at(-1).code==='payable'&&r.after.nodes.some(n=>n.code==='gross - rebate'))); report.checks.fixFlowConfirmed = true;
    const original = await settle('semantic_query', { ...request, to: { ...request.to, name: 'save' } });
    assert.equal(original.results.find(r=>r.after)?.after.nodes.at(-1).code, 'gross'); report.checks.originalPreserved = true;
    // Same workspace identity after another edit must not reuse its stale projection.
    W.write(opened.id, F.FILE, { edits: [{ find: 'ledger.save(tenant, payable);', replace: 'ledger.save(tenant, gross);' }] });
    const reverted = await settle('semantic_index', { repo: 'work/' + opened.id });
    assert.notEqual(reverted.analyses[0].id, fixed.analyses[0].id); report.checks.workspaceRefresh = true;
  });
  await t.test('default tool JSON is shorter and full native inline evidence remains accessible', async () => {
    const full = await settle('semantic_query', request), preview = await T.call('semantic_query', { operation: 'compare', job: full.job, max_output_bytes: 4096 });
    const bytes = v => Buffer.byteLength(JSON.stringify(v));
    assert.equal(preview.format, 'compact'); assert.ok(bytes(preview) <= 4096); assert.ok(bytes(preview) < bytes(full));
    assert.deepEqual(preview.proof, full.proof); assert.ok(preview.view);
    const saved = require('../lib/results').load(preview.view.split('/').pop());
    assert.deepEqual(saved.data.results, full.results); assert.equal(saved.view, 'semantic-analysis');
    report.preview = { bytes: bytes(preview), fullBytes: bytes(full), proof: preview.proof, omitted: preview.omitted }; report.checks.compactFullEvidence = true;
  });
  fs.writeFileSync(path.join(home, 'branch-flow-live-report.json'), JSON.stringify(report, null, 2));
});
