// Invocation success and application evidence are different facts. Only known
// contracts are interpreted here: an arbitrary HTTP status/body is never a verdict.
const FAILED = new Set(['failed', 'error', 'cancelled', 'interrupted', 'timeout', 'compile-error', 'no-tests-ran', 'skipped-only', 'all-tests-skipped', 'cleanup-failed', 'invalid', 'different']);
const TESTS = new Set(['test_run', 'test_compare']);
const ASSERTIONS = new Set(['scenario_check', 'scenario_emulate', 'scenario_assert', 'scenario_observe', 'scenario_run', 'scenario_verify', 'collection_check', 'collection_validate', 'collection_run', 'collection_report', 'script_run', 'fixture_validate', 'fixture_runtime_preflight', 'fixture_runtime_start', 'fixture_runtime_arm', 'fixture_runtime_check', 'fixture_runtime_cleanup']);
function classify(tool, value, { invocation = 'succeeded', job, traceId } = {}) {
  const r = value && typeof value === 'object' ? value : {};
  const out = { version: 1, invocation, ...(traceId ? { traceId } : {}) };
  const id = typeof r.job === 'string' ? r.job : job?.id;
  if (id) out.job = { id, state: job?.state || r.state || r.status || 'unknown', ...(job?.traceId ? { traceId: job.traceId } : {}) };
  const payload = job?.result || r;
  if (tool === 'differential_check' && ['equivalent', 'different'].includes(payload.outcome)) out.execution = { kind: 'assertions', status: payload.outcome };
  else if (TESTS.has(tool) && typeof payload.outcome === 'string') out.execution = { kind: 'tests', status: payload.outcome, ...(payload.counts ? { counts: payload.counts } : {}) };
  else if (ASSERTIONS.has(tool)) {
    if (typeof payload.ok === 'boolean') out.execution = { kind: 'assertions', status: payload.ok ? 'passed' : 'failed' };
    else if (typeof payload.status === 'string') out.execution = { kind: 'assertions', status: payload.status };
  }
  if (!out.execution && out.job) out.execution = { kind: 'job', status: out.job.state };
  out.failed = invocation === 'failed' || FAILED.has(out.execution?.status) || FAILED.has(out.job?.state);
  return out;
}
function refresh(call) {
  if (!call.evidence?.job) return call;
  const job = require('./jobs').get(call.evidence.job.id);
  if (!job) return { ...call, evidence: { ...call.evidence, job: { ...call.evidence.job, retained: false } } };
  return { ...call, evidence: classify(call.target || call.tool, null, { invocation: call.evidence.invocation, traceId: call.evidence.traceId, job }) };
}
function failed(call) { return call.evidence ? call.evidence.failed : call.ok === false; }
module.exports = { classify, refresh, failed };
