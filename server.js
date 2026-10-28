// MCP + small HTTP API over lib/. Open WebUI is the UI; this only serves tools.
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const httpMod = require('http');
const fs = require('fs');
const { envNames, getEnv, getPersonal, getServer } = require('./lib/config');
const { CACHE, readJson } = require('./lib/util');
const catalog = require('./lib/catalog');
const tools = require('./lib/tools');
const results = require('./lib/results');

const VERSION = require('./package.json').version;

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const readJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(c)).on('error', reject).on('end', () => {
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(e); }
  });
});

// Tools reach the infrastructure with your credentials. Allowed: this machine; a request with
// DT_API_KEY (Authorization: Bearer, or the dt_key cookie set by /admin?key=...); or anyone on the
// network when DT_TRUST_NETWORK=1 (compose publishes the port on 127.0.0.1 only).
const cookie = (req, name) => (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1];
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function trusted(req) {
  const { apiKey: key, trustNetwork } = getServer();
  if (key) {
    const bearer = (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
    if (sameSecret(bearer, key) || sameSecret(decodeURIComponent(cookie(req, 'dt_key') || ''), key)) return true;
  }
  if (trustNetwork) return true;
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function status() {
  const p = getPersonal();
  return {
    version: VERSION, host: os.hostname(),
    personal: { found: p.found, bitbucket: !!p.bitbucket.token, confluence: !!p.confluence.token },
    envs: envNames().map(env => {
      const e = getEnv(env);
      const synced = (f) => readJson(path.join(CACHE, env, f))?.syncedAt || null;
      let lines = 0;
      try { lines = fs.readFileSync(path.join(CACHE, env, 'catalog.txt'), 'utf8').split('\n').length - 1; } catch {}
      return {
        env, envFileFound: e.envFileFound, pgConfigured: Object.values(e.pg).filter(Boolean).length,
        synced: { pg: synced('pg/_index.json'), es: synced('es/_index.json'), kafka: synced('kafka/_index.json'), consul: synced('consul.json') },
        catalogLines: lines,
      };
    }),
  };
}

// ── MCP (Streamable HTTP, JSON responses) ─────────────────────────────
async function mcpHandle(msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion || '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dt', version: VERSION },
        instructions: require('./lib/webui').prompt(),
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: await tools.schemas() });
    case 'tools/call': {
      const started = Date.now();
      try {
        const result = await tools.call(msg.params.name, msg.params.arguments || {}, { source: 'mcp' });
        console.error(`mcp ${msg.params.name} ${Date.now() - started}ms`);
        return reply({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] });
      } catch (e) {
        console.error(`mcp ${msg.params.name} ERROR ${e.message}`);
        return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      if (msg.id === undefined) return null; // notifications/initialized etc.
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

async function mcp(req, res) {
  const body = await readJsonBody(req);
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map(mcpHandle))).filter(Boolean);
  if (!replies.length) return send(res, 202, '');
  send(res, 200, batch ? replies : replies[0], { 'mcp-session-id': req.headers['mcp-session-id'] || crypto.randomUUID() });
}

const page = (file) => (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(path.join(__dirname, 'web', file)));
};
const viewPage = page('view.html');

// ── OpenAPI tool server (Open WebUI) ──────────────────────────────────
// Open WebUI embeds a tool result as an iframe when the response carries
// `Content-Disposition: inline` + `Location`, and gives the model the second element of a
// two-element JSON array body. So table results show up as the live viewer inside the chat.
async function openapi() {
  const paths = {};
  for (const t of await tools.schemas()) {
    paths[`/oapi/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.description.split('. ')[0],
        description: t.description,
        requestBody: { required: true, content: { 'application/json': { schema: t.inputSchema } } },
        responses: { 200: { description: 'Tool result' } },
      },
    };
  }
  return { openapi: '3.1.0', info: { title: 'dt', version: VERSION, description: 'Read-only dev/uat infrastructure tools' }, paths };
}

async function oapi(req, res, url) {
  const name = url.pathname.split('/').pop();
  let result;
  try { result = await tools.call(name, await readJsonBody(req), { source: 'openapi' }); }
  catch (e) { return send(res, 400, { error: e.message }); }
  const target = result && typeof result === 'object' && (result.view || result.dashboard);
  const embed = typeof target === 'string' ? target + (target.includes('?') ? '&' : '?') + 'embed=1' : null;
  if (embed) return send(res, 200, ['embed', result], { 'content-disposition': 'inline', location: embed });
  send(res, 200, result);
}

const admin = require('./lib/admin');
const tokenOk = (url, value) => results.verify(value, url.searchParams.get('t'));
const CORS = { 'access-control-allow-origin': '*' };

// [method, path or prefix*, trusted only, handler]
// Pages are plain HTML; their data comes from trusted endpoints, or from ones keyed by an unguessable
// result id / signed token (embeds in Open WebUI load them from a sandboxed, cross-origin iframe).
const routes = [
  ['GET', '/', false, (req, res) => send(res, 200, { name: 'dt', mcp: '/mcp', openapi: '/openapi.json', tools: '/api/tools', status: '/api/status', admin: '/admin', results: '/view', prompt: '/api/prompt' })],
  ['GET', '/health', false, (req, res) => send(res, 200, { ok: true, version: VERSION })],
  ['GET', '/api/status', false, (req, res) => send(res, 200, { trusted: trusted(req), ...status() })],
  ['GET', '/api/prompt', false, (req, res) => { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); res.end(require('./lib/webui').prompt()); }],
  ['GET', '/api/find', true, (req, res, url) => send(res, 200, catalog.find(url.searchParams.get('env') || envNames()[0], url.searchParams.get('q') || '', { limit: Number(url.searchParams.get('limit')) || 300 }))],
  ['GET', '/api/tools', false, async (req, res) => send(res, 200, await tools.schemas())],
  ['POST', '/api/tool/*', true, async (req, res, url) => {
    try { send(res, 200, { result: await tools.call(url.pathname.split('/').pop(), await readJsonBody(req), { source: 'api' }) }); }
    catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/openapi.json', false, async (req, res) => send(res, 200, await openapi())],
  ['POST', '/oapi/*', true, oapi],

  // admin: watch, edit and refresh the index
  ['GET', '/admin', false, (req, res, url) => {
    const key = url.searchParams.get('key');
    if (key && getServer().apiKey && sameSecret(key, getServer().apiKey)) {
      res.writeHead(302, { location: '/admin', 'set-cookie': `dt_key=${encodeURIComponent(key)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
      return res.end();
    }
    if (!trusted(req)) { res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<p style="font:14px system-ui;margin:40px">Open <code>/admin?key=&lt;DT_API_KEY&gt;</code> once to sign in.</p>'); }
    page('admin.html')(req, res);
  }],
  ['GET', '/api/admin/status', true, async (req, res) => send(res, 200, await admin.status())],
  ['POST', '/api/admin/tools/reload', true, async (req, res) => send(res, 200, await tools.reload(await readJsonBody(req)))],
  ['POST', '/api/admin/refresh', true, async (req, res) => {
    try { const job = require('./lib/indexer').refresh(await readJsonBody(req)); send(res, 202, { id: job.id, key: job.key, state: job.state }); }
    catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/api/admin/jobs', true, (req, res) => send(res, 200, require('./lib/jobs').list(50))],
  ['GET', '/api/admin/job/*', true, (req, res, url) => { const j = require('./lib/jobs').get(url.pathname.split('/').pop()); j ? send(res, 200, j) : send(res, 404, { error: 'no such job' }); }],
  ['GET', '/api/admin/object', true, (req, res, url) => send(res, 200, admin.object(url.searchParams.get('env') || envNames()[0], url.searchParams.get('name') || ''))],
  ['GET', '/api/admin/config', true, (req, res) => send(res, 200, admin.readConfig())],
  ['POST', '/api/admin/config', true, async (req, res) => {
    try { send(res, 200, await admin.writeConfig((await readJsonBody(req)).text)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/api/admin/notes', true, (req, res) => send(res, 200, require('./lib/notes').all())],
  ['POST', '/api/admin/notes', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, admin.setNote(b.name, b.note)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/repos', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, admin.setRepo(b.service, b.repo)); } catch (e) { send(res, 400, { error: e.message }); }
  }],

  // saved scripts and API routes
  ['GET', '/api/admin/scripts', true, (req, res) => send(res, 200, require('./lib/scripts').list())],
  ['GET', '/api/admin/script', true, (req, res, url) => {
    try { send(res, 200, require('./lib/scripts').get(url.searchParams.get('id'))); } catch (e) { send(res, 404, { error: e.message }); }
  }],
  ['POST', '/api/admin/script', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, require('./lib/scripts').save(b.id, b.script)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/script/run', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, await require('./lib/scripts').run(b.id, b.params || {})); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/script/delete', true, async (req, res) => {
    try { send(res, 200, require('./lib/scripts').remove((await readJsonBody(req)).id)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/scripts/folder', true, async (req, res) => {
    try { send(res, 200, require('./lib/scripts').mkdir((await readJsonBody(req)).path)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/scripts/folder/delete', true, async (req, res) => {
    try { send(res, 200, require('./lib/scripts').removeFolder((await readJsonBody(req)).path)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/scripts/move', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, require('./lib/scripts').move(b.from, b.to)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/scripts/copy', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, require('./lib/scripts').copy(b.from, b.to)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/api/admin/collection', true, (req, res, url) => {
    try { send(res, 200, require('./lib/scripts').getCollection(url.searchParams.get('path'))); } catch (e) { send(res, 404, { error: e.message }); }
  }],
  ['POST', '/api/admin/collection', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, require('./lib/scripts').setCollection(b.path, b)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/api/admin/calls', true, (req, res, url) => send(res, 200, require('./lib/calls').history({ q: url.searchParams.get('q') || '', source: url.searchParams.get('source') || '', limit: 300 }))],
  ['GET', '/api/admin/patterns', true, (req, res) => send(res, 200, require('./lib/calls').patterns({ limit: 30 }))],
  ['GET', '/api/admin/views', true, (req, res) => send(res, 200, require('./lib/views').list())],
  ['GET', '/api/admin/view', true, (req, res, url) => { try { send(res, 200, require('./lib/views').get(url.searchParams.get('name'))); } catch (e) { send(res, 404, { error: e.message }); } }],
  ['POST', '/api/admin/view', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, require('./lib/views').save(b.name, b)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/view/delete', true, async (req, res) => {
    try { send(res, 200, require('./lib/views').remove((await readJsonBody(req)).name)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['POST', '/api/admin/view/preview', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, { html: require('./lib/views').render(b.name || 'preview', b.sample, { title: b.title || `${b.name || 'view'} (sample data)` }, { html: b.html, metaCsp: true, embed: true }) }); }
    catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/api/admin/sites', true, (req, res) => send(res, 200, admin.sites())],
  ['POST', '/api/admin/sites', true, async (req, res) => {
    try { const b = await readJsonBody(req); send(res, 200, await admin.saveSite(b.was || '', b.site === undefined ? null : b.site)); } catch (e) { send(res, 400, { error: e.message }); }
  }],
  ['GET', '/api/admin/routes', true, (req, res, url) => send(res, 200, {
    routes: require('./lib/routes').list({ q: url.searchParams.get('q') || '', service: url.searchParams.get('service') || '' }),
    sites: require('./lib/config').getBrowser().sites.map(({ secrets, ...s }) => ({ ...s, secrets: secrets.length })),
  })],

  ['GET', '/dash', false, page('dash.html')],
  ['GET', '/showcase/*', false, page('showcase.html')],
  ['GET', '/api/dash', false, async (req, res, url) => {
    const env = url.searchParams.get('env') || envNames()[0];
    const ok = tokenOk(url, `dash:${env}`);
    if (!ok && !trusted(req)) return send(res, 403, { error: 'needs a dashboard link from the overview tool' });
    send(res, 200, await require('./lib/dashboard').overview(env), ok ? CORS : {});
  }],
  ['GET', '/static/*', false, (req, res, url) => {
    const name = url.pathname.slice('/static/'.length);
    const type = { '.css': 'text/css', '.js': 'text/javascript' }[path.extname(name)];
    if (!type || !/^(views\/)?[\w.-]+$/.test(name) || !fs.existsSync(path.join(__dirname, 'web', name))) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache', ...CORS });
    res.end(fs.readFileSync(path.join(__dirname, 'web', name)));
  }],
  ['GET', '/logs/*', false, page('logs.html')],
  ['GET', '/pr/*', false, page('pr.html')],
  ['GET', '/passport/*', false, page('passport.html')],
  ['GET', '/api/passport/*', false, (req, res, url) => {
    const service = decodeURIComponent(url.pathname.split('/').pop());
    const ok = tokenOk(url, `passport:${service}`);
    if (!ok && !trusted(req)) return send(res, 403, { error: 'needs a passport link from the passport tool' });
    const p = require('./lib/passport').load(service);
    p ? send(res, 200, { ...p, bitbucketUrl: require('./lib/config').getPersonal().bitbucket.url }, ok ? CORS : {}) : send(res, 404, { error: `No passport for ${service}` }, ok ? CORS : {});
  }],
  ['GET', '/view', true, viewPage],
  ['GET', '/view/*', false, viewPage],
  // views: sandboxed pages with their data inside; ?view=<name> shows the same data another way
  ['GET', '/show/*', false, (req, res, url) => {
    const r = results.load(url.pathname.split('/').pop());
    if (!r) return send(res, 404, { error: 'No such result (results are kept for the latest 500 runs)' });
    const data = r.kind === 'view' ? r.data : r.rows;
    const view = url.searchParams.get('view') || (r.kind === 'view' ? r.view : 'table');
    let html;
    try { html = require('./lib/views').render(view, data, { title: r.title || r.query || '', at: r.at, id: r.id }, { embed: url.searchParams.has('embed') }); }
    catch (e) { return send(res, 404, { error: e.message }); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': require('./lib/views').CSP, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(html);
  }],
  // a workspace patch as a file (the unguessable result id is the key, like /show)
  ['GET', '/patch/*', false, (req, res, url) => {
    const r = results.load(url.pathname.split('/').pop().replace(/\.patch$/, ''));
    if (!r || r.kind !== 'view' || r.view !== 'patch') return send(res, 404, { error: 'No such patch' });
    res.writeHead(200, { 'content-type': 'text/x-diff; charset=utf-8', 'content-disposition': `attachment; filename="${String(r.data.id || 'dt').replace(/[^\w.-]/g, '_')}.patch"`, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(r.data.patch || '');
  }],
  // the file browser: a stored listing of one store directory; previews only inside it
  ['GET', '/files/*', false, page('files.html')],
  ['GET', '/api/files/*', false, async (req, res, url) => {
    const r = results.load(url.pathname.split('/').pop());
    if (!r || r.kind !== 'view' || r.view !== 'files') return send(res, 404, { error: 'No such file listing' }, CORS);
    const p = url.searchParams.get('path');
    if (p === null) return send(res, 200, r, CORS);
    const F = require('./lib/files');
    let rel;
    try { rel = F.rel(p); } catch (e) { return send(res, 400, { error: e.message }, CORS); }
    if (!r.data.entries.some(e => !e.dir && e.path === rel)) return send(res, 403, { error: 'not a file of this listing' }, CORS);
    try { send(res, 200, await F.preview(r.data.store, rel), CORS); } catch (e) { send(res, 400, { error: e.message }, CORS); }
  }],
  ['GET', '/api/results', true, (req, res) => send(res, 200, results.list())],
  ['GET', '/api/result/*', false, (req, res, url) => {
    const r = results.load(url.pathname.split('/').pop());
    r ? send(res, 200, r, CORS) : send(res, 404, { error: 'No such result' }, CORS);
  }],
  ['POST', '/mcp', true, mcp],
  ['GET', '/mcp', true, (req, res) => send(res, 405, { error: 'no SSE stream; POST JSON-RPC' }, { allow: 'POST' })],
  ['DELETE', '/mcp', true, (req, res) => send(res, 200, {})],
];

function start({ port = 4000, host = '127.0.0.1' } = {}) {
  const server = httpMod.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = routes.find(([m, p]) => m === req.method && (p.endsWith('*') ? url.pathname.startsWith(p.slice(0, -1)) : url.pathname === p));
    try {
      if (!route) return send(res, 404, { error: 'not found' });
      if (route[2] && !trusted(req)) return send(res, 403, { error: 'not allowed: call from this machine, send Authorization: Bearer <DT_API_KEY>, or set DT_TRUST_NETWORK=1' });
      await route[3](req, res, url);
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e.message }); else res.end();
    }
  });
  // the browser container starts after dt is healthy and reads these secrets once
  try { require('./lib/browser').writeSecrets(); } catch (e) { console.error(`browser secrets: ${e.message}`); }
  tools.ready().catch(e => console.error(`tools: ${e.message}`));
  server.listen(port, host, () => console.error(`dt serve: http://${host}:${port}  (mcp: /mcp, admin: /admin)`));
  return server;
}

module.exports = { start, trusted };
