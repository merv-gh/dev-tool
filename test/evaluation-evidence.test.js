const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-evidence-')); process.env.DT_HOME = home; process.env.DT_LOG = 'quiet';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const E = require('../lib/evaluation-evidence');
const transcript = E.chain([{ tool: 'test_run', arguments: { workspace: 'candidate' }, result: { outcome: 'failed' } }, { tool: 'workspace_write', arguments: { path: 'src/value.cjs', content: 'fixed' } }, { tool: 'test_run', result: { outcome: 'passed' } }]);
function report() { return { version: 1, case: 'test-case', kind: 'fix', claimedStatus: 'complete', observedAt: new Date().toISOString(), integrity: { publicSha256: 'a'.repeat(64), oracleSha256: 'b'.repeat(64), candidatePatchSha256: E.digest('patch'), protectedUnchanged: true, publicFrozenAt: '2026-01-01', oracleFrozenAt: '2026-01-02', graderFrozenAt: '2026-01-03', solverStartedAt: '2026-01-04' }, transcript: { artifact: 'transcript.json', events: transcript.length, head: transcript.at(-1).hash }, execution: { baseline: { through: 'tool', outcome: 'failed', assertionFailure: true, counts: { tests: 1, failed: 1 } }, post: { through: 'tool', tool: 'test_run', outcome: 'passed', target: 'local', revision: 'candidate', counts: { tests: 2, passed: 2, failed: 0, errors: 0, skipped: 0 } } }, grade: { independent: true, passed: true, assertions: 4 } }; }
test('retained evidence verifies the exact transcript, candidate patch and parent signature', async () => {
  const saved = E.save(report(), { 'candidate.patch': 'patch', 'transcript.json': transcript });
  assert.equal(saved.verified, true); assert.equal(saved.assessment.toolComplete, true); assert.equal(saved.assessment.blindProtocol, 'presealed');
  const r = await require('../lib/tools').call('evaluation_evidence', { run: saved.id });
  assert.equal(r.verified, true); assert.match(r.view, /\/show\//);
  fs.appendFileSync(path.join(home, 'cache/evaluations', saved.id, 'candidate.patch'), 'changed');
  const changed = E.verify(saved.id); assert.equal(changed.verified, false); assert.equal(changed.assessment.toolComplete, false); assert.equal(changed.assessment.falseSuccess, true);
});
test('grading rejects external-only success, empty/skip tests, weakened contracts, infrastructure red and absent independent grade', () => {
  const mutations = [r => { r.execution.post.through = 'external'; }, r => { r.execution.post.counts = { tests: 0, passed: 0, failed: 0, errors: 0 }; }, r => { r.execution.post.counts.skipped = 2; }, r => { r.integrity.protectedUnchanged = false; }, r => { r.execution.baseline = { through: 'tool', outcome: 'compile-error', counts: { tests: 0, errors: 1 } }; }, r => { r.grade.independent = false; }, r => { r.grade.assertions = 0; }];
  for (const mutate of mutations) { const r = report(); mutate(r); const verdict = E.assess(r); assert.equal(verdict.complete, false); assert.equal(verdict.falseSuccess, true); }
  const procedural = report(); procedural.integrity.graderFrozenAt = '2026-01-05';
  assert.equal(E.assess(procedural).blindProtocol, 'procedural-or-unverified');
});
test('tests-only work must execute the reference and kill behavioral mutants through tools', () => {
  const r = report(); r.kind = 'tests'; r.execution.baseline = { through: 'tool', outcome: 'passed', counts: { tests: 2, passed: 2, failed: 0, errors: 0 } };
  assert.equal(E.assess(r).complete, false);
  r.mutations = { executed: true, through: 'tool', total: 4, killed: 4, infrastructureFailures: 0 };
  assert.equal(E.assess(r).complete, true);
  r.mutations.killed--; assert.equal(E.assess(r).complete, false);
});
test('expected unsupported behavior never becomes a completion claim', () => {
  const r = report(); r.kind = 'expected-gap'; r.claimedStatus = 'blocked'; r.grade.expectedUnsupported = true;
  assert.equal(E.assess(r).expectedGapCorrect, true); assert.equal(E.assess(r).toolComplete, false);
  r.claimedStatus = 'complete'; assert.equal(E.assess(r).falseSuccess, true);
});
test('hash chain catches altered, reordered, missing and repeated transcript events', () => {
  assert.equal(E.verifyChain(transcript), true);
  for (const t of [transcript.slice(1), [...transcript].reverse(), [transcript[0], transcript[0]], transcript.map((e, i) => i === 1 ? { ...e, result: { hidden: 'changed' } } : e)]) assert.equal(E.verifyChain(t), false);
});
test('actual protected-file audit rejects changed expectations/harness, new files and symlinks', () => {
  const dir = path.join(home, 'candidate'); fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/value.cjs'), 'bug'); fs.writeFileSync(path.join(dir, 'expected.json'), 'business contract');
  const before = E.snapshot(dir); fs.writeFileSync(path.join(dir, 'src/value.cjs'), 'fix');
  assert.equal(E.protectedFiles(before, dir, ['src/']).protectedUnchanged, true);
  fs.writeFileSync(path.join(dir, 'expected.json'), 'weakened'); fs.writeFileSync(path.join(dir, 'harness.cjs'), 'skip tests');
  assert.deepEqual(E.protectedFiles(before, dir, ['src/']).forbidden, ['expected.json', 'harness.cjs']);
  fs.symlinkSync(__filename, path.join(dir, 'src/escape.cjs'));
  assert.throws(() => E.snapshot(dir), /symlinks/);
});
test('candidate dependency and generated-directory inputs cannot bypass the protected-file audit', () => {
  const dir = path.join(home, 'dependency-audit'); fs.mkdirSync(dir);
  const before = E.snapshot(dir);
  for (const rel of ['node_modules/fake/index.cjs', 'src/build/harness.cjs', 'src/target/expected.json', '.gradle/input.json', '.dt/injected.cjs']) {
    const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'unreviewed executable input');
  }
  assert.deepEqual(E.protectedFiles(before, dir).forbidden.sort(), ['.dt/injected.cjs', '.gradle/input.json', 'node_modules/fake/index.cjs', 'src/build/harness.cjs', 'src/target/expected.json'].sort());
});
test('supported verification-harness execution is distinct from actual model completion', () => {
  const r = report(); r.execution.post.revision = { beforeSha256: 'a'.repeat(64), afterSha256: 'a'.repeat(64) };
  r.execution.cleanup = { complete: true };
  r.modelInteraction = { candidateChanged: true, passingTestObserved: false };
  let a = E.assess(r); assert.equal(a.toolComplete, true); assert.equal(a.modelComplete, false); assert.equal(a.falseSuccess, true);
  r.modelInteraction.passingTestObserved = true;
  assert.equal(E.assess(r).modelComplete, true);
  r.claimedStatus = 'blocked'; assert.equal(E.assess(r).modelComplete, false);
  r.claimedStatus = 'complete'; r.execution.cleanup.complete = false; assert.equal(E.assess(r).modelComplete, false);
  r.execution.cleanup.complete = true; r.execution.post.revision.afterSha256 = 'b'.repeat(64); assert.equal(E.assess(r).modelComplete, false);
});
