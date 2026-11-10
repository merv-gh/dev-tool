// Invocation success and application evidence are different facts. Only known
// contracts are interpreted here: an arbitrary HTTP status/body is never a verdict.
const FAILED = new Set(['failed', 'error', 'cancelled', 'interrupted', 'timeout', 'compile-error', 'no-tests-ran', 'skipped-only', 'all-tests-skipped', 'cleanup-failed', 'invalid', 'different']);
const TESTS = new Set(['test_run', 'test_compare']);
const ASSERTIONS = new Set(['scenario_check', 'scenario_preflight', 'scenario_emulate', 'scenario_assert', 'scenario_observe', 'scenario_run', 'scenario_verify', 'collection_check', 'collection_validate', 'collection_run', 'collection_report', 'script_run', 'fixture_validate', 'fixture_runtime_preflight', 'fixture_runtime_start', 'fixture_runtime_arm', 'fixture_runtime_check', 'fixture_runtime_cleanup']);
function classify(tool, value, { invocation = 'succeeded', job, traceId } = {}) {
  const r = value && typeof value === 'object' ? value : {};
  const out = { version: 1, invocation, ...(traceId ? { traceId } : {}) };
  const id = !tool.startsWith('jenkins_') && typeof r.job === 'string' ? r.job : job?.id;
  if (id) out.job = { id, state: job?.state || r.state || r.status || 'unknown', ...(job?.traceId ? { traceId: job.traceId } : {}) };
  const payload = job?.result || job?.resultSummary || r;
  if (/^jenkins_(build|wait|tests)$/.test(tool) && payload.state) out.execution={kind:'ci',status:['failed','unstable','aborted'].includes(payload.state)?'failed':payload.state};
  else if (/^bitbucket_pr_(status|wait)$/.test(tool) && payload.state) out.execution={kind:'review',status:payload.state==='build_failed'?'failed':payload.state};
  else if (tool === 'files_archive' && payload.archived === true) out.execution = { kind: 'files', status: payload.sourceRemoved === true ? 'archived' : 'cleanup-failed' };
  else if (tool === 'testdb_template_verify' && typeof payload.ok === 'boolean') out.execution = { kind: 'assertions', status: payload.ok ? 'passed' : 'failed' };
  else if (tool === 'testdb_gc' && Array.isArray(payload.failures)) out.execution = { kind: 'cleanup', status: payload.failures.length ? 'cleanup-failed' : 'done' };
  else if (tool === 'differential_check' && ['equivalent', 'different'].includes(payload.outcome)) out.execution = { kind: 'assertions', status: payload.outcome };
  else if (TESTS.has(tool) && typeof payload.outcome === 'string') out.execution = { kind: 'tests', status: payload.outcome, ...(payload.counts ? { counts: payload.counts } : {}) };
  else if (ASSERTIONS.has(tool)) {
    if (typeof payload.ok === 'boolean') out.execution = { kind: 'assertions', status: payload.ok ? 'passed' : 'failed' };
    else if (typeof payload.status === 'string') out.execution = { kind: 'assertions', status: payload.status };
  }
  if (!out.execution && out.job) out.execution = { kind: 'job', status: out.job.state };
  out.failed = invocation === 'failed' || FAILED.has(out.execution?.status) || FAILED.has(out.job?.state);
  return out;
}
module.exports = { classify, FAILED };
