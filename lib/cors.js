// One browser policy for every HTTP transport, including errors and streams.
// Reflect origins for credentialed fetches: '*' cannot be combined with include.
const { validateHeaderName } = require('node:http');
const EXPOSE = 'Content-Disposition, Location, X-DT-Context, MCP-Session-Id, MCP-Protocol-Version, Retry-After, X-DT-Map-Focus, X-DT-Map-Libraries, X-DT-Map-Candidates, Traceparent';
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
function token(value) {
  try { validateHeaderName(value); } catch { throw Object.assign(Error('Invalid CORS preflight method or header name'), { code: 'DT_ARGUMENT_INVALID', statusCode: 400 }); }
  return value;
}
function handle(req, res) {
  const config = require('./config').getServer(), origin = req.headers.origin;
  res.setHeader('vary', 'Origin');
  if (origin && !require('./security').originAllowed(origin, config)) {
    res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'Browser origin is not allowed', code: 'DT_SECURITY_POLICY' }));
    return true;
  }
  res.setHeader('access-control-allow-origin', origin || '*');
  if (origin) res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-expose-headers', EXPOSE);
  if (req.method !== 'OPTIONS') return false;
  const method = req.headers['access-control-request-method'];
  const requested = String(req.headers['access-control-request-headers'] || '').split(',').map(s => s.trim()).filter(Boolean);
  requested.forEach(token);
  if (method) token(method);
  res.setHeader('vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
  res.setHeader('access-control-allow-methods', [...new Set([...METHODS, ...(method ? [method] : [])])].join(', '));
  res.setHeader('access-control-allow-headers', requested.length ? requested.join(', ') : 'Authorization, Content-Type, X-DT-Story, X-DT-Principal, MCP-Session-Id, MCP-Protocol-Version, Traceparent, Tracestate, Baggage');
  res.setHeader('access-control-max-age', '600');
  if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('access-control-allow-private-network', 'true');
  res.writeHead(204); res.end();
  return true;
}
module.exports = { handle };
