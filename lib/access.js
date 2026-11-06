// Authenticated principal + chat/story boundary. Tool arguments never select an owner.
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const path = require('node:path');
const context = new AsyncLocalStorage();
const LEGACY = Object.freeze({ principalId: 'local', storyId: 'default', role: 'admin', scopeKey: 'legacy', multiUser: false });
const identifier = /^[a-zA-Z0-9][\w.:-]{0,159}$/;
const deny = (message = 'Resource is not available in this story') => Object.assign(new Error(message), { code: 'DT_ACCESS_DENIED', statusCode: 403 });

function normalize(value = {}) {
  if (!value.multiUser && (!value.storyId || value.storyId === 'default')) return LEGACY;
  const principalId = String(value.principalId || 'local'), storyId = String(value.storyId || 'default');
  if (!identifier.test(principalId) || !identifier.test(storyId)) throw deny('Invalid principal or story identifier');
  return Object.freeze({ principalId, storyId, role: value.role === 'admin' ? 'admin' : 'user', multiUser: !!value.multiUser,
    ...(value.storyBound ? { storyBound: true } : {}),
    scopeKey: crypto.createHash('sha256').update(principalId + '\0' + storyId).digest('hex').slice(0, 32) });
}
const current = () => context.getStore() || LEGACY;
const owner = () => ({ ...current() });
const run = (scope, fn) => context.run(normalize(scope), fn);
function visible(value) {
  const other = value || LEGACY;
  return current().scopeKey === (other.scopeKey || (!other.multiUser ? 'legacy' : null));
}
function assertOwner(value) { if (!visible(value)) throw deny(); }
function requireAdmin() { if (current().role !== 'admin') throw deny('Administrator access is required'); }
function scopedDirectory(base) { return current().scopeKey === 'legacy' ? base : path.join(base, '_stories', current().scopeKey); }
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const selectedStory = headers => headers['x-dt-story'] || headers['x-openwebui-chat-id'] || headers['x-chat-id'] || headers['mcp-session-id'] || 'default';

function identity(req) {
  const lifecycle = require('./state-machine').create(require('./lifecycles').identity);
  const accepted = value => { lifecycle.to('authenticated'); const scope = normalize(value); lifecycle.to('scoped'); return scope; };
  const rejected = () => { lifecycle.to('rejected'); return null; };
  try {
  const config = require('./config'), cfg = config.getServer(), tokens = cfg.accessTokens || [];
  const bearer = (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
  let cookie;
  try { cookie = decodeURIComponent((String(req.headers.cookie || '').match(/(?:^|;\s*)dt_key=([^;]+)/) || [])[1] || ''); }
  catch { cookie = ''; }
  const supplied = bearer || cookie;
  if (tokens.length) {
    const token = tokens.find(item => sameSecret(supplied, item.token));
    if (!token && !(cfg.apiKey && sameSecret(supplied, cfg.apiKey))) return rejected();
    const principal = token || { id: 'operator', role: 'admin' }, role = principal.role === 'admin' ? 'admin' : 'user';
    if (role !== 'admin' && config.generation().lastError) throw Object.assign(deny('Configuration is invalid; ask an administrator to repair it'), { statusCode: 503, code: 'DT_CONFIG_INVALID' });
    let principalId = principal.id;
    if (req.headers['x-dt-principal']) {
      if (role !== 'admin') throw deny('Only administrators can select another principal');
      principalId = String(req.headers['x-dt-principal']);
    }
    if (principal.story && req.headers['x-dt-story'] && principal.story !== req.headers['x-dt-story']) throw deny('This token is bound to another story');
    return accepted({ principalId, storyId: String(principal.story || selectedStory(req.headers)), role, multiUser: true, storyBound: !!principal.story });
  }
  if (supplied && (!cfg.apiKey || !sameSecret(supplied, cfg.apiKey))) return rejected();
  const localScope = () => accepted({ ...LEGACY, storyId: selectedStory(req.headers) });
  if (cfg.apiKey && sameSecret(supplied, cfg.apiKey)) return localScope();
  const remote = req.socket.remoteAddress || '';
  return cfg.trustNetwork || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ? localScope() : rejected();
  } catch (error) { if (!lifecycle.terminal) lifecycle.to('rejected'); throw error; }
}
// Global integration administration is separate from private task work.
const ADMIN_TOOLS = new Set(['catalog_sync', 'tools_reload', 'testdb_initialize', 'testdb_gc', 'testdb_template_invalidate', 'testdb_template_pin', 'plugin_install', 'config_write', 'architecture_save', 'architecture_refresh']);
function checkTool(name) { if (current().multiUser && ADMIN_TOOLS.has(name)) requireAdmin(); }
module.exports = { current, owner, run, visible, assertOwner, requireAdmin, scopedDirectory, normalize, identity, sameSecret, deny, LEGACY, checkTool };
