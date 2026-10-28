// Parent-side evidence writer/verifier. No tool accepts inline grading results:
// model-owned workspaces cannot mint the host's signed evaluation records.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const digest = data => crypto.createHash('sha256').update(typeof data === 'string' || Buffer.isBuffer(data) ? data : canonical(data)).digest('hex');
function canonical(v) { return Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v); }
function chain(events) {
  let previous = '0'.repeat(64);
  return events.map((event, index) => { const { hash: ignored, previous: ignoredPrevious, seq: ignoredSeq, ...body } = event; const entry = { ...body, seq: index + 1, previous }; entry.hash = digest(entry); previous = entry.hash; return entry; });
}
function verifyChain(events) {
  if (!Array.isArray(events)) return false;
  return chain(events).every((entry, i) => entry.hash === events[i].hash && entry.previous === events[i].previous && entry.seq === events[i].seq);
}
const positive = c => c && Number.isSafeInteger(c.tests) && c.tests > 0 && Number.isSafeInteger(c.passed) && c.passed > 0 && c.failed === 0 && c.errors === 0 && (c.skipped || 0) === 0;
const negative = c => c && Number.isSafeInteger(c.tests) && c.tests > 0 && ((c.failed || 0) > 0 || (c.errors || 0) > 0);
function assess(r) {
  const issues = [], need = (v, text) => { if (!v) issues.push(text); };
  need(r.version === 1, 'unsupported evidence version');
  need(typeof r.case === 'string' && r.case.length > 0, 'missing case identity');
  for (const name of ['publicSha256', 'candidatePatchSha256', 'oracleSha256']) need(/^[a-f0-9]{64}$/.test(r.integrity?.[name] || ''), `missing immutable ${name}`);
  need(r.integrity?.protectedUnchanged === true, 'protected inputs/contracts/harness changed or unchecked');
  need(r.transcript?.events > 0 && /^[a-f0-9]{64}$/.test(r.transcript?.head || ''), 'missing hash-chained tool transcript');
  need(r.grade?.independent === true && r.grade?.passed === true, 'independent hidden grade did not pass');
  need(Number.isSafeInteger(r.grade?.assertions) && r.grade.assertions > 0, 'no independently executed hidden assertions');
  const expectedGap = r.kind === 'expected-gap';
  if (expectedGap) {
    need(r.claimedStatus === 'blocked' && r.grade?.expectedUnsupported === true, 'unsupported case was claimed complete');
  } else {
    need(r.execution?.post?.through === 'tool' && r.execution?.post?.tool === 'test_run', 'external execution cannot certify tool completion');
    need(r.execution?.post?.outcome === 'passed' && positive(r.execution?.post?.counts), 'post-change tool run has no complete passing assertions');
    if (r.kind !== 'tests') need(negative(r.execution?.baseline?.counts) && ['failed', 'assertion-failed'].includes(r.execution?.baseline?.outcome), 'baseline must fail actual application assertions');
    else need(positive(r.execution?.baseline?.counts), 'test-writing baseline/reference did not execute passing application assertions');
    need(r.execution?.baseline?.through === 'tool', 'baseline did not execute through supported tools');
    need(r.execution?.post?.target && r.execution?.post?.revision, 'actual execution target/revision not recorded');
    if (r.kind === 'tests') need(r.mutations?.executed === true && r.mutations.through === 'tool' && r.mutations.total > 0 && r.mutations.killed === r.mutations.total && !r.mutations.infrastructureFailures, 'tests did not reject every required behavioral mutant through supported tools');
  }
  const sealed = !!r.integrity?.solverStartedAt && ['publicFrozenAt', 'oracleFrozenAt', 'graderFrozenAt'].every(k => Number.isFinite(Date.parse(r.integrity?.[k])) && Date.parse(r.integrity[k]) < Date.parse(r.integrity.solverStartedAt));
  return { complete: issues.length === 0, fixCorrect: r.grade?.passed === true && r.integrity?.protectedUnchanged === true, toolComplete: !expectedGap && issues.length === 0, expectedGapCorrect: expectedGap && issues.length === 0, falseSuccess: r.claimedStatus === 'complete' && issues.length > 0, blindProtocol: sealed ? 'presealed' : 'procedural-or-unverified', issues, limits: 'Evidence applies to this case, revision and execution target. Signed retention proves record provenance/integrity, not honesty of an arbitrary external author or universal production readiness.' };
}
const root = () => path.join(require('./util').CACHE, 'evaluations');
const filename = name => { if (!/^[a-zA-Z0-9][\w.-]{0,100}$/.test(name) || name.includes('..')) throw new Error('Invalid evidence artifact name'); return name; };
function snapshot(directory) {
  const out = {};
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules', 'target', 'build', '.gradle', '.dt'].includes(entry.name)) continue;
      const name = prefix + entry.name, full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Evaluation inputs cannot contain symlinks: ${name}`);
      if (entry.isDirectory()) walk(full, name + '/');
      else if (entry.isFile()) out[name] = digest(fs.readFileSync(full));
    }
  };
  walk(directory); return out;
}
function protectedFiles(before, directory, editable = []) {
  if (!Array.isArray(editable) || editable.some(p => typeof p !== 'string' || !p || p.startsWith('/') || p.split('/').includes('..') || p.includes('\\'))) throw new Error('Invalid editable input paths');
  const after = snapshot(directory), changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]);
  const forbidden = changed.filter(f => !editable.some(p => p.endsWith('/') ? f.startsWith(p) : f === p));
  return { protectedUnchanged: forbidden.length === 0, changed, forbidden, beforeSha256: digest(before), afterSha256: digest(after) };
}
function save(report, artifacts) {
  if (!artifacts || typeof artifacts !== 'object') throw new Error('Evidence artifacts required');
  const id = crypto.randomBytes(12).toString('hex'), dir = path.join(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  try {
    for (const [name, value] of Object.entries(artifacts)) { filename(name); const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : canonical(value)); if (bytes.length > 10 * 1024 * 1024) throw new Error('Evidence artifact exceeds 10 MiB'); fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx', mode: 0o600 }); files[name] = { sha256: digest(bytes), bytes: bytes.length }; }
    const record = { ...report, id, artifacts: files, assessment: assess(report) };
    const hash = digest(record), signature = require('./results').sign(hash);
    fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({ record, sha256: hash, signature }, null, 2), { flag: 'wx', mode: 0o600 });
    return { id, ...verify(id) };
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
}
function verify(id) {
  if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('Invalid evaluation id');
  const dir = path.join(root(), id), envelope = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8'));
  const record = envelope.record, issues = [];
  if (digest(record) !== envelope.sha256 || !require('./results').verify(envelope.sha256, envelope.signature)) issues.push('record signature/hash mismatch');
  for (const [name, ref] of Object.entries(record.artifacts || {})) { filename(name); try { const data = fs.readFileSync(path.join(dir, name)); if (data.length !== ref.bytes || digest(data) !== ref.sha256) issues.push(`artifact modified: ${name}`); } catch { issues.push(`artifact missing: ${name}`); } }
  const transcript = record.transcript?.artifact;
  if (!transcript || !Object.hasOwn(record.artifacts, transcript)) issues.push('transcript artifact missing');
  else { try { const events = JSON.parse(fs.readFileSync(path.join(dir, filename(transcript)), 'utf8')); if (!verifyChain(events) || events.length !== record.transcript.events || events.at(-1)?.hash !== record.transcript.head) issues.push('transcript chain mismatch'); } catch { issues.push('transcript unreadable'); } }
  if (!record.artifacts?.['candidate.patch'] || record.artifacts['candidate.patch'].sha256 !== record.integrity?.candidatePatchSha256) issues.push('candidate patch digest mismatch');
  const assessment = assess(record);
  return { verified: issues.length === 0, ...record, assessment: { ...assessment, complete: !issues.length && assessment.complete, toolComplete: !issues.length && assessment.toolComplete, falseSuccess: record.claimedStatus === 'complete' && (issues.length > 0 || assessment.falseSuccess), issues: [...issues, ...assessment.issues] } };
}
function list(limit = 20) {
  if (!fs.existsSync(root())) return [];
  return fs.readdirSync(root()).filter(f => /^[a-f0-9]{24}$/.test(f)).map(id => { try { const r = verify(id); return { id, case: r.case, observedAt: r.observedAt, verified: r.verified, assessment: r.assessment }; } catch { return { id, verified: false }; } }).sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt))).slice(0, limit);
}
module.exports = { canonical, digest, chain, verifyChain, assess, snapshot, protectedFiles, save, verify, list };
