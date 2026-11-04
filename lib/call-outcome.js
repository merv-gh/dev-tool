// Pure evidence classification is shared with the operational SQLite owner.
const { classify } = require('./call-evidence');
function refresh(call) {
  if (!call.evidence?.job) return call;
  const job = require('./jobs').get(call.evidence.job.id);
  if (!job) return { ...call, evidence: { ...call.evidence, job: { ...call.evidence.job, retained: false } } };
  return { ...call, evidence: classify(call.target || call.tool, null, { invocation: call.evidence.invocation, traceId: call.evidence.traceId, job }) };
}
function failed(call) { return call.evidence ? call.evidence.failed : call.ok === false; }
module.exports = { classify, refresh, failed };
