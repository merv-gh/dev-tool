// Bounded REST calls. Never redirect credentials or retry an external POST.
const E = require('./execution');
const error = (message, code = 'DT_CI_ARGUMENT', statusCode = 400) => Object.assign(Error(message), { code, statusCode });
function base(value) {
  let url; try { url = new URL(value); } catch { throw error('Configure an HTTP(S) integration URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw error('Integration URL must be HTTP(S), without credentials, query or fragment');
  return url.href.replace(/\/$/, '');
}
async function request(root, route, { headers = {}, method = 'GET', body, signal, timeoutMs = 15000, maxBytes = 1048576, partial = false, target = 'ci' } = {}) {
  const url = base(root) + route;
  if (!route.startsWith('/') || route.startsWith('//')) throw error('REST route must stay inside its configured integration');
  const h = { accept: 'application/json', ...headers };
  if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); h['content-type'] ||= 'application/json'; }
  return require('./limit').network(target, async () => {
    E.check();
    const signals = [E.signal(), signal, AbortSignal.timeout(timeoutMs)].filter(Boolean);
    let response;
    try { response = await fetch(url, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.any(signals) }); }
    catch (cause) { E.check(); throw Object.assign(error('Integration request did not return a response; an action outcome may be unknown', 'DT_CI_NETWORK', 502), { cause }); }
    const chunks = []; let bytes = 0, truncated = false;
    if (method !== 'HEAD') for await (const chunk of response.body || []) {
      const keep = Math.min(chunk.length, Math.max(0, maxBytes - bytes));
      if (keep) chunks.push(Buffer.from(chunk.subarray(0, keep))); bytes += keep;
      if (chunk.length > keep) { truncated = true; break; }
    }
    E.check();
    if (response.status >= 300) throw error(`Integration returned HTTP ${response.status}${response.status < 400 ? '; check the configured canonical base URL' : ''}`, 'DT_CI_HTTP', response.status);
    if (truncated && !partial) throw error('Integration response exceeded its byte budget; request a smaller page', 'DT_CI_RESPONSE_LIMIT', 502);
    const buffer = Buffer.concat(chunks), text = buffer.toString('utf8');
    return { status: response.status, headers: response.headers, buffer, text, truncated, json: () => {
      try { return text ? JSON.parse(text) : null; } catch { throw error('Integration returned invalid JSON', 'DT_CI_RESPONSE', 502); }
    } };
  });
}
module.exports = { base, request, error };
