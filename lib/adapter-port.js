// Language-neutral replacement seam. Validation, enable/disable policy and tracing stay outside it.
// No retry/fallback: a lost response may represent a completed action and must remain explicit.
const crypto = require('crypto');
const PROTOCOL = 'dt.tool/v1';
function route(name) {
  const backends = require('./config').getTools().backends;
  if (Object.hasOwn(backends, name)) return backends[name];
  const prefix = Object.keys(backends).filter(k => k.endsWith('*') && name.startsWith(k.slice(0, -1))).sort((a, b) => b.length - a.length)[0];
  return prefix ? backends[prefix] : null;
}
async function execute(tool, args, backend, { signal } = {}) {
  const access = require('./access'), execution = require('./execution'), owner = access.owner();
  if (owner.scopeKey !== 'legacy' && (backend.scopeAware !== true || !backend.token)) throw Object.assign(new Error('Scoped tool backends require scopeAware:true and an authenticated service token; the adapter must enforce the trusted principal and story context'), { code: 'DT_BACKEND_SCOPE_REQUIRED' });
  signal ||= execution.signal();
  const url = new URL(backend.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Tool backend needs an HTTP(S) URL without credentials or fragment');
  const timeoutMs = backend.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Tool backend timeoutMs must be 1..120000');
  const context = owner.scopeKey !== 'legacy' ? { principalId: owner.principalId, storyId: owner.storyId, scopeKey: owner.scopeKey,
    ...(execution.current()?.id ? { executionId: execution.current().id } : {}),
    ...(execution.current()?.revision ? { revision: execution.current().revision } : {}) } : null;
  const request = { protocol: PROTOCOL, requestId: crypto.randomUUID(), tool, arguments: args, ...(context ? { context } : {}) };
  const lifecycle = require('./state-machine').create(require('./lifecycles').adapter);
  lifecycle.to('sending');
  try {
  const localSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([localSignal, signal]) : localSignal, headers: { 'content-type': 'application/json', accept: 'application/json', ...(context ? { 'x-dt-principal': owner.principalId, 'x-dt-story': owner.storyId, 'x-dt-scope': owner.scopeKey } : {}), ...(backend.token ? { authorization: `Bearer ${backend.token}` } : {}) }, body: JSON.stringify(request) });
  if (!response.ok) throw Object.assign(new Error(`Tool backend ${tool}: HTTP ${response.status}; execution outcome may be unknown`), { code: 'DT_BACKEND_FAILED', requestId: request.requestId });
  lifecycle.to('reading');
  let bytes = 0; const chunks = [];
  for await (const chunk of response.body || []) { bytes += chunk.length; if (bytes > 20 * 1024 * 1024) throw new Error('Tool backend response exceeds 20 MiB'); chunks.push(chunk); }
  let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Tool backend returned invalid JSON; execution outcome may be unknown'); }
  const issues = require('./schema').validate(body, require('../contracts/v1/tool-response.schema.json'));
  if (issues.length || body.requestId !== request.requestId || body.tool !== tool) throw Object.assign(new Error('Tool backend contract mismatch; execution outcome may be unknown'), { code: 'DT_BACKEND_CONTRACT', requestId: request.requestId });
  lifecycle.to('verified');
  if (Object.hasOwn(body, 'error')) { lifecycle.to('rejected'); throw Object.assign(new Error(require('./redact').clean(body.error.message, { known: [backend.token] })), { code: body.error.code, requestId: request.requestId }); }
  lifecycle.to('succeeded');return body.result;
  } catch (error) { if (!lifecycle.terminal) lifecycle.to('unknown'); throw error; }
}
module.exports = { PROTOCOL, route, execute };
