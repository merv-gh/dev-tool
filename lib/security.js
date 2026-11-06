// Deployment policy is separate from identity. Local compatibility is explicit;
// team mode never infers authentication from a socket or forwarded header.
const crypto = require('node:crypto'), fs = require('node:fs');
function settings(server = {}) {
  const profile = process.env.DT_SECURITY_PROFILE || server.securityProfile || 'local';
  if (!['local','team'].includes(profile)) throw Error('server.securityProfile must be local or team');
  const origins = server.allowedOrigins || [], proxies = server.trustedProxies || [];
  if (!Array.isArray(origins) || !Array.isArray(proxies) || origins.length > 100 || proxies.length > 100) throw Error('Origin and proxy policies must be bounded lists');
  for (const origin of origins) { const u = new URL(origin); if (!['http:','https:'].includes(u.protocol) || u.origin !== origin || u.username) throw Error('allowedOrigins must contain exact HTTP(S) origins'); }
  for (const proxy of proxies) if (typeof proxy !== 'string' || !require('node:net').isIP(proxy)) throw Error('trustedProxies must contain exact proxy IP addresses');
  return { profile, allowedOrigins: origins, trustedProxies: proxies };
}
function enforce(req) {
  const c = require('./config').getServer();
  if (c.securityProfile !== 'team') return;
  const deny = message => { throw Object.assign(Error(message), { code:'DT_SECURITY_POLICY', statusCode:403 }); };
  const origin = req.headers.origin, allowed = new Set([new URL(c.publicUrl).origin,...c.allowedOrigins]);
  if (origin && !allowed.has(origin)) deny('Browser origin is not allowed');
  // Bearer-authenticated machine requests need no browser Origin. Cookies do.
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && !req.headers.authorization && /(?:^|;\s*)dt_key=/.test(req.headers.cookie || '') && !allowed.has(origin)) deny('Cookie mutations require an allowed Origin');
  const remote = req.socket.remoteAddress || '';
  const forwarded = req.headers['x-forwarded-proto'];
  if (forwarded && !c.trustedProxies.includes(remote)) deny('Forwarded transport headers require a configured trusted proxy');
}
function verifyPlugin(file, spec) {
  const team = require('./config').getServer().securityProfile === 'team';
  if (team && spec.remote && (!/^https:\/\//.test(spec.url) || !/^[a-f0-9]{64}$/i.test(spec.sha256 || ''))) throw Error('Team mode requires HTTPS and an approved sha256 for remote plugins');
  if (spec.sha256) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== spec.sha256.toLowerCase()) throw Error('Plugin sha256 mismatch; cached code was not loaded');
  }
}
function report() {
  const C = require('./config'), c = C.getServer(), checks = [];
  const add = (check,status,detail) => checks.push({group:'security',check,status,detail});
  add('deployment profile',c.securityProfile === 'team'?'ok':'warn',c.securityProfile === 'team'?'Authenticated team service':'Local compatibility mode; select team before network exposure');
  add('authentication',c.accessTokens.some(t=>!t.revoked&&(!t.expiresAt||Date.parse(t.expiresAt)>Date.now()))||c.apiKey?'ok':'fail','Team mode requires an active token or API key; credentials are never returned');
  add('TLS gateway',c.publicUrl.startsWith('https:')?'ok':'warn','Use HTTPS publicUrl behind a TLS gateway; keep the application port private');
  for (const spec of C.getTools().plugins) { const s=typeof spec==='string'?{url:spec}:spec; if (/^(https?:|github:)/.test(s.url||''))add('remote plugin',/^[a-f0-9]{64}$/i.test(s.sha256||'')?'ok':'fail','Remote plugin needs an approved content hash before team activation'); }
  add('trusted plugin boundary','warn','In-process plugins inherit server access; use authenticated external adapters for a separate trust boundary');
  return {profile:c.securityProfile,checks,counts:Object.fromEntries(['ok','warn','fail'].map(s=>[s,checks.filter(c=>c.status===s).length]))};
}
module.exports = {settings, enforce, verifyPlugin, report};
