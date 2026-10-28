const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-outcomes-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tests: { waitMs: 1 } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const O = require('../lib/call-outcome'), C = require('../lib/calls'), J = require('../lib/jobs'), T = require('../lib/tools');

test('explicit application contracts preserve invocation versus failed tests/assertions; HTTP status is not a verdict', () => {
  const r = O.classify('test_run', { outcome: 'failed', counts: { tests: 2, failed: 1 } });
  assert.equal(r.invocation, 'succeeded'); assert.equal(r.failed, true); assert.equal(r.execution.kind, 'tests');
  assert.equal(O.classify('scenario_check', { ok: false }).failed, true);
  assert.equal(O.classify('api_request_replay', { status: 404, ok: false }).failed, false);
  assert.equal(O.classify('script_run', { ok: true, response: { status: 404 } }).failed, false);
  assert.equal(O.classify('unknown', { status: 'failed', ok: false }).execution, undefined);
  assert.equal(O.classify('unknown', null, { invocation: 'failed' }).failed, true);
});

test('registry history includes a returned failed job and its exact trace without calling it an invocation failure', async () => {
  const job = J.start('tests:not-needed-to-poll:broken-job', 'broken-job', async () => { throw new Error('application build failed'); });
  await job.promise;
  const answer = await T.call('tool_execute', { name: 'test_run', arguments: { workspace: 'not-needed-to-poll', job: job.id } });
  assert.equal(answer.state, 'failed');
  const history = C.history({ tool: 'test_run', failed: true });
  assert.equal(history[0].ok, true);
  assert.equal(history[0].evidence.invocation, 'succeeded');
  assert.equal(history[0].evidence.job.id, job.id);
  assert.equal(history[0].evidence.job.traceId, job.traceId);
  assert.ok(history[0].evidence.traceId);
  assert.ok(C.history({ tool: 'tool_execute', failed: true }).some(c => c.evidence.job.id === job.id));
  const tab = await T.call('call_history', { tool: 'test_run', failed: true });
  assert.match(JSON.stringify(tab), /broken|application build failed|"failed"/);
});

test('a call returning running is reconciled after completion and filter applies before limit', async () => {
  let release;
  const job = J.start('pending-evidence', 'pending-evidence', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  C.record({ tool: 'test_run', args: {}, ok: true, evidence: O.classify('test_run', { job: job.id, state: 'running' }) });
  C.record({ tool: 'api_request_replay', args: {}, ok: true, evidence: O.classify('api_request_replay', { status: 500 }) });
  release({ outcome: 'failed', counts: { tests: 1, failed: 1 } }); await job.promise;
  const h = C.history({ failed: true, kind: 'tests', limit: 1 });
  assert.equal(h.length, 1); assert.equal(h[0].evidence.execution.status, 'failed');
  assert.equal(h[0].evidence.job.state, 'done'); assert.equal(h[0].ok, true);
  assert.equal(C.history({ status: 'running' }).length, 0);
});
