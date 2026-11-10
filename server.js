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
const mcpRequests=new Map();

function send(res, status, body, extra = {}) {
  if(status===429)extra={'retry-after':String(body?.retryAfter||body?.result?.retryAfter||1),...extra};
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const readJsonBody = (req, form = false) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0, failed = false;
  req.on('data', c => { if (failed) return; size += c.length; if (size > require('./lib/config').getTools().maxInputBytes) { failed = true; chunks.length = 0; reject(Object.assign(new Error('Request body exceeds configured input budget'), { code: 'DT_ARGUMENT_INVALID', statusCode: 413 })); } else chunks.push(c); }).on('error', reject).on('end', () => {
    if (failed) return;
    try { resolve(chunks.length ? (form?Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))):JSON.parse(Buffer.concat(chunks))) : {}); } catch (e) { reject(e); }
  });
});
const errorPayload = e => require('./lib/redact').clean({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.issues ? { issues: e.issues } : {}), ...(e.retryAfter?{retryAfter:e.retryAfter}:{}) });

// Tools reach the infrastructure with your credentials. Allowed: this machine; a request with
// DT_API_KEY (Authorization: Bearer, or the dt_key cookie set by /admin?key=...); or anyone on the
// network when DT_TRUST_NETWORK=1 (compose publishes the port on 127.0.0.1 only).
const cookie = (req, name) => (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1];
function sameSecret(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function trusted(req) {return !!require('./lib/access').identity(req);}

function status() {
  const p = getPersonal();
  return {
    version: VERSION, host: os.hostname(),
    personal: { found: p.found, bitbucket: !!p.bitbucket.token, confluence: !!p.confluence.token },
    envs: envNames().map(env => {
      const e = getEnv(env);
      const synced = (f) => readJson(path.join(CACHE, env, f))?.syncedAt || null;
      const lines = catalog.count(env);
      return {
        env, envFileFound: e.envFileFound, pgConfigured: Object.values(e.pg).filter(Boolean).length,
        synced: { pg: synced('pg/_index.json'), es: synced('es/_index.json'), kafka: synced('kafka/_index.json'), consul: synced('consul.json') },
        catalogLines: lines,
      };
    }),
  };
}

// ── MCP (Streamable HTTP, JSON responses) ─────────────────────────────
async function mcpHandle(msg, session, requestSignal) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const scope=require('./lib/access').current().scopeKey,key=JSON.stringify([scope,session||'',msg.id]);
  switch (msg.method) {
    case 'notifications/cancelled': {const target=mcpRequests.get(JSON.stringify([scope,session||'',msg.params?.requestId]));target?.abort('MCP request cancelled');return null;}
    case 'initialize':
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dt', version: VERSION },
        instructions: require('./lib/webui').prompt(),
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: await tools.schemas() });
    case 'tools/call': {
      if(mcpRequests.has(key))return {jsonrpc:'2.0',id:msg.id,error:{code:-32600,message:'Request id is already active in this session'}};
      const lifecycle=require('./lib/state-machine').create(require('./lib/lifecycles').mcp),controller=new AbortController(),abort=controller.abort.bind(controller);controller.abort=why=>{if(lifecycle.terminal)return;lifecycle.to('cancelling');abort(why);};const onAbort=()=>controller.abort(requestSignal.reason);if(requestSignal?.aborted)onAbort();else requestSignal?.addEventListener('abort',onAbort,{once:true});mcpRequests.set(key,controller);
      try {
        const delivered = require('./lib/chat-pressure').response(msg.params.name, await tools.call(msg.params.name, msg.params.arguments || {}, { source: 'mcp', session,signal:controller.signal }),{session,usage:msg.params?._meta?.['dev-tool/context']});
        const result = delivered.value;
        lifecycle.to('replied');
        return reply({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],_meta:{'dev-tool/context':delivered.meta} });
      } catch (e) {
        lifecycle.to('replied');
        return reply({ content: [{ type: 'text', text: `Error: ${errorPayload(e).error}` }], structuredContent: errorPayload(e), isError: true });
      } finally {lifecycle.to('closed');mcpRequests.delete(key);requestSignal?.removeEventListener('abort',onAbort);}
    }
    default:
      if (msg.id === undefined) return null; // notifications/initialized etc.
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

async function mcp(req, res) {
  const body = await readJsonBody(req);
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map(msg => mcpHandle(msg, req.headers['x-openwebui-chat-id'] || req.headers['x-chat-id'] || req.headers['mcp-session-id'],req.dtSignal)))).filter(Boolean);
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
async function openapi(profile = require('./lib/config').getTools().profile) {
  const paths = {};
  for (const t of await tools.schemas({ profile })) {
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
  return { openapi: '3.1.0', info: { title: `dt (${profile})`, version: VERSION, description: 'Microservice investigation and isolated testing tools. Profile selects discovery, not permissions.' }, 'x-dt-profile': profile, paths };
}

async function oapi(req, res, url) {
  const name = url.pathname.split('/').pop();
  let result;
  // Open WebUI says which chat a call comes from when ENABLE_FORWARD_USER_INFO_HEADERS is on
  const session = req.headers['x-openwebui-chat-id'] || req.headers['x-chat-id'] || null;
  let pressure;
  try { const delivered = require('./lib/chat-pressure').response(name, await tools.call(name, await readJsonBody(req), { source: 'openapi', session, signal:req.dtSignal }),{session,usage:req.headers['x-dt-context-usage']});result=delivered.value;pressure=delivered.meta; }
  catch (e) { return send(res, e.statusCode || 400, errorPayload(e)); }
  const target = result && typeof result === 'object' && (result.view || result.dashboard);
  const embed = typeof target === 'string' ? target + (target.includes('?') ? '&' : '?') + 'embed=1' : null;
  const headers={'x-dt-context':JSON.stringify(pressure),'access-control-expose-headers':'Content-Disposition, Location, X-Dt-Context'};
  if (embed) return send(res, 200, ['embed', result], { ...headers,'content-disposition': 'inline', location: embed });
  send(res, 200, result,headers);
}

const admin = require('./lib/admin');
const tokenOk = (url, value) => results.verify(value, url.searchParams.get('t'));
const CORS = { 'access-control-allow-origin': '*' };

// [method, path or prefix*, trusted only, handler]
// Pages are plain HTML; their data comes from trusted endpoints, or from ones keyed by an unguessable
// result id / signed token (embeds in Open WebUI load them from a sandboxed, cross-origin iframe).
const routes = [
  ['GET', '/api/capabilities', true, async (req,res,url) => send(res,200,await require('./lib/capability-map').graph({env:url.searchParams.get('env')||undefined}))],
  ['GET', '/handbook', true, page('handbook.html')],
  ['GET', '/api/handbook', true, async (req,res) => send(res,200,await require('./lib/handbook').catalog())],
  ['GET', '/api/handbook/context', true, async (req,res,url) => send(res,200,await require('./lib/handbook').selfContext({env:url.searchParams.get('env')||undefined}))],
  ['GET', '/api/handbook/sample', true, (req,res,url) => { const view=require('./lib/views').get(url.searchParams.get('view'));if(view.sample===undefined)return send(res,404,{error:'This view has no sample'});send(res,200,{view:view.name,data:view.sample}); }],
  ['GET', '/handbook-images/*', false, (req,res,url) => { const file=require('./lib/handbook').imageFile(url.pathname.slice('/handbook-images/'.length));if(!file)return send(res,404,{error:'Unknown handbook image'});res.writeHead(200,{'content-type':'image/png','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'});res.end(fs.readFileSync(file)); }],
  ['GET', '/api-client', true, page('api-client.html')],
  ['GET', '/', false, (req, res) => send(res, 200, { name: 'dt', mcp: '/mcp', openapi: '/openapi.json', tools: '/api/tools', status: '/api/status', admin: '/admin', results: '/view', prompt: '/api/prompt' })],
  ['GET', '/health', false, (req, res) => send(res, 200, { ok: true, version: VERSION })],
  ['GET', '/api/status', false, (req, res) => send(res, 200, { trusted: trusted(req), ...status() })],
  ['GET', '/api/prompt', false, (req, res) => { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); res.end(require('./lib/webui').prompt()); }],
  ['GET', '/api/find', true, async (req, res, url) => send(res, 200, await require('./lib/isolate').exec('catalog','find',[url.searchParams.get('env') || envNames()[0], url.searchParams.get('q') || '', { limit: Number(url.searchParams.get('limit')) || 300 }]))],
  ['GET', '/api/tools', false, async (req, res, url) => send(res, 200, await tools.schemas({ profile: url.searchParams.get('profile') || 'all' }))],
  ['POST', '/api/tool/*', true, async (req, res, url) => {
    try { send(res, 200, { result: await tools.call(url.pathname.split('/').pop(), await readJsonBody(req), { source: 'api', session: req.headers['x-openwebui-chat-id'] || req.headers['x-chat-id'], signal:req.dtSignal }) }); }
    catch (e) { send(res, e.statusCode || 400, errorPayload(e)); }
  }],
  ['GET', '/openapi.json', false, async (req, res, url) => send(res, 200, await openapi(url.searchParams.get('profile') || undefined))],
  ['GET', '/openapi/*', false, async (req, res, url) => { const name = url.pathname.slice('/openapi/'.length); if (!/^[a-z][\w-]*\.json$/.test(name)) return send(res, 404, { error: 'Unknown profile URL' }); send(res, 200, await openapi(name.slice(0, -5))); }],
  ['GET', '/contracts/*', false, (req, res, url) => { const full = require('./lib/contracts').resolve(url.pathname.slice('/contracts/'.length)); if (!full) return send(res, 404, { error: 'Unknown contract' }); send(res, 200, fs.readFileSync(full, 'utf8'), CORS); }],
  ['POST', '/oapi/*', true, oapi],

  // admin: watch, edit and refresh the index
  ['POST','/api/session',false,async(req,res)=>{
    const form=String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'),body=await readJsonBody(req,form),token=(String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i)||[])[1]||body.token;
    if(typeof token!=='string'||token.length>8192)return send(res,401,{error:'A valid token is required'});
    const identity=require('./lib/access').identity({...req,headers:{...req.headers,authorization:'Bearer '+token}});if(!identity)return send(res,401,{error:'Invalid or expired token'});
    const cookie=`dt_key=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${getServer().securityProfile==='team'?'; Secure':''}`;
    let next='/admin';if(typeof body.next==='string'&&body.next.length<5000){const target=new URL(body.next,'http://local');if(target.origin==='http://local'&&target.pathname==='/workbench')next=target.pathname+target.search;}res.writeHead(303,{location:next,'set-cookie':cookie,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();
  }],
  ['GET', '/admin', false, (req, res, url) => {
    const key = getServer().securityProfile==='team'?null:url.searchParams.get('key');
    if (key && require('./lib/access').identity({...req,headers:{...req.headers,authorization:'Bearer '+key}})) {
      res.writeHead(302, { location: '/admin', 'set-cookie': `dt_key=${encodeURIComponent(key)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${getServer().securityProfile==='team'?'; Secure':''}` });
      return res.end();
    }
    if (!trusted(req)) { res.writeHead(401, {'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'"});return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to dev-tool</title><link rel="stylesheet" href="/static/ui.css"><main class="wrap"><h1>Sign in to dev-tool</h1><p>Use your access token. It stays out of the URL.</p><form action="/api/session" method="post"><label for="token">Access token</label> <input id="token" name="token" type="password" required autocomplete="current-password"> <button type="submit">Sign in</button></form></main></html>'); }
    page('admin.html')(req, res);
  }],
  ['GET', '/api/admin/status', true, async (req, res) => send(res, 200, await admin.status())],
  ['GET','/workbench',false,(req,res,url)=>{
    if(!trusted(req)){const next='/workbench'+url.search;res.writeHead(401,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'"});return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Workbench</title><link rel="stylesheet" href="/static/ui.css"><main class="wrap"><h1>Sign in to Workbench</h1><p>Open this page directly if your chat blocks authenticated embeds. Use your access token; it stays out of the URL.</p><form action="/api/session" method="post"><input type="hidden" name="next" value="'+next.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'"><label for="token">Access token</label> <input id="token" name="token" type="password" required autocomplete="current-password"> <button type="submit">Sign in</button></form></main></html>');}page('admin.html')(req,res);
  }],
  ['POST','/api/admin/workbench/tree',true,async(req,res)=>send(res,200,await require('./lib/workbench-explorer').tree(await readJsonBody(req)))],
  ['POST','/api/admin/workbench/detail',true,async(req,res)=>send(res,200,await require('./lib/workbench-explorer').detail(await readJsonBody(req)))],
  ['GET', '/api/admin/workbench', true, async (req, res, url) => send(res, 200, await require('./lib/workbench').bootstrap({ env: url.searchParams.get('env') || undefined }))],
  ['POST', '/api/admin/workbench/choices', true, async (req, res) => send(res, 200, await require('./lib/workbench').choices(await readJsonBody(req)))],
  ['POST', '/api/admin/workbench/run', true, async (req, res) => send(res, 202, await require('./lib/workbench').start(await readJsonBody(req)))],
  ['GET', '/api/admin/workbench/run/*', true, (req, res, url) => send(res, 200, require('./lib/workbench').state(url.pathname.split('/').pop()))],
  ['GET', '/api/admin/workbench/evidence/*', true, (req, res, url) => send(res, 200, require('./lib/workbench').evidence(url.pathname.split('/').pop()))],
  ['POST', '/api/admin/workbench/assist', true, async (req, res) => { const body = await readJsonBody(req); send(res, 200, await require('./lib/execution').run({ kind: 'tool', tool: 'workbench_help', source: 'workbench', signal: req.dtSignal }, () => require('./lib/workbench').assist(body))); }],
  ['POST', '/api/admin/job/*/cancel', true, (req, res, url) => {
    try { send(res, 200, require('./lib/jobs').cancel(url.pathname.split('/').slice(-2)[0], 'cancelled from /admin')); } catch (e) { send(res, 404, { error: e.message }); }
  }],
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
    try { send(res, 200, await admin.writeConfig(...((b)=>[b.text,b.expected_revision])(await readJsonBody(req)))); } catch (e) { send(res, e.statusCode||400, errorPayload(e)); }
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
  ['GET', '/api/admin/calls', true, async (req, res, url) => send(res, 200, (await require('./lib/calls').historyPage({ q: url.searchParams.get('q') || '', source: url.searchParams.get('source') || '', limit: 300 })).records)],
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
    if (!type || !/^(?:views\/|vendor\/ecs-canvas\/)?[\w.-]+$/.test(name) || !fs.existsSync(path.join(__dirname, 'web', name))) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache', ...CORS });
    res.end(fs.readFileSync(path.join(__dirname, 'web', name)));
  }],
  ['GET', '/logs/*', false, page('logs.html')],
  ['GET', '/map-preview/*', false, (req,res,url)=>{const r=results.load(url.pathname.split('/').pop());if(!r||r.kind!=='map-preview'||!/^image\/(png|jpeg|webp)$/.test(r.image?.mimeType)||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.image?.data))return send(res,404,{error:'Screenshot not found'});const title=String(r.title||'Screenshot').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"});res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:12px;font:13px system-ui;background:#fafafa;color:#222}img{max-width:100%;height:auto}h1{font-size:15px}</style><h1>${title}</h1><p>Captured ${r.capturedAt}</p><img alt="${title}" src="data:${r.image.mimeType};base64,${r.image.data}"><script>const report=()=>{if(parent!==window)parent.postMessage({type:"iframe:height",height:Math.ceil(document.body.getBoundingClientRect().height)+24},"*")};new ResizeObserver(report).observe(document.body);addEventListener("load",report);for(const ms of [500,1500,3000])setTimeout(report,ms);</script></html>`);}],
  ['GET', '/map/*', false, page('map.html')],
  ['GET', '/architecture/*', false, page('architecture.html')],
  ['GET', '/api/architecture/*', false, (req,res,url) => require('./lib/architecture-http').handle(req,res,url)],
  ['GET', '/api/map/*', false, async (req,res,url) => {
    try {
      const parts=url.pathname.split('/').filter(Boolean), id=parts[2], action=parts[3]||'graph', result=results.load(id);
      if(!result||result.kind!=='map') return send(res,404,{error:'Map result not found'},CORS);
      const M=require('./lib/service-map'), a={...result.map}; delete a.refresh;
      if(action==='graph') {
        if(url.searchParams.has('focus')) a.focus=url.searchParams.get('focus')||undefined;
        if(url.searchParams.has('candidates'))a.include_candidates=url.searchParams.get('candidates')==='1';
        if(url.searchParams.has('libraries'))a.include_libraries=url.searchParams.get('libraries')==='1';
        const bytes=await M.snapshot(a);res.writeHead(200,{'content-type':'application/vnd.dt.map','cache-control':'no-store','x-content-type-options':'nosniff','x-dt-map-focus':encodeURIComponent(a.focus||(a.layer?'feature:'+a.layer:'')),'x-dt-map-libraries':a.include_libraries?'1':'0','x-dt-map-candidates':a.include_candidates?'1':'0','access-control-expose-headers':'X-DT-Map-Focus, X-DT-Map-Libraries, X-DT-Map-Candidates',...CORS});res.end(bytes);
      } else if(action==='full'){const g=await M.graph(a.env);res.writeHead(200,{'content-type':'application/vnd.dt.map','content-disposition':'attachment; filename="microservices.dtm"',...CORS});res.end(g.bytes);}
      else if(action==='node')send(res,200,await M.inspect({env:a.env,id:url.searchParams.get('id')}),CORS);
      else if(action==='neighbors')send(res,200,await M.neighbors({env:a.env,id:url.searchParams.get('id'),limit:30,include_candidates:url.searchParams.get('candidates')==='1',include_libraries:url.searchParams.get('libraries')==='1'}),CORS);
      else if(action==='search')send(res,200,await M.search({env:a.env,query:url.searchParams.get('q')||'',include_libraries:url.searchParams.get('libraries')==='1',limit:30}),CORS);
      else send(res,404,{error:'Unknown map action'},CORS);
    }catch(e){send(res,400,errorPayload(e),CORS);}
  }],
  ['GET', '/pr/*', false, page('pr.html')],
  ['GET', '/passport/*', false, page('passport.html')],
  ['GET', '/api/passport/*', false, (req, res, url) => {
    const service = decodeURIComponent(url.pathname.split('/').pop());
    const ok = tokenOk(url, `passport:${service}`);
    if (!ok && !trusted(req)) return send(res, 403, { error: 'needs a passport link from the passport tool' });
    const p = require('./lib/passport').load(service,{env:url.searchParams.get('env')||undefined});
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
    let html, policy;
    try { const V=require('./lib/views'),definition=V.get(view);policy=V.policy(definition);html = V.render(view, data, { title: r.title || r.query || '', at: r.at, id: r.id, client:r.client, story:r.owner?.storyId }, { embed: url.searchParams.has('embed'),definition }); }
    catch (e) { return send(res, 404, { error: e.message }); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
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
  require('./lib/operational-metrics').start();
  const server = httpMod.createServer(async (req, res) => {
    const controller=new AbortController();req.dtSignal=controller.signal;
    const disconnected=()=>{if(!res.writableEnded)controller.abort('HTTP client disconnected');};
    req.once('aborted',disconnected);res.once('close',disconnected);
    const url = new URL(req.url, 'http://x'),A=require('./lib/access');
    let identity;try{require('./lib/security').enforce(req);identity=A.identity(req);}catch(e){return send(res,e.statusCode||403,errorPayload(e));}
    const supplied=!!req.headers.authorization||!!cookie(req,'dt_key');
    if(!identity&&getServer().securityProfile==='team'&&url.pathname==='/api/status')return send(res,403,{error:'Authentication is required'});
    if(!identity&&(getServer().accessTokens.length||getServer().securityProfile==='team')&&(['/api/tools','/openapi.json'].includes(url.pathname)||url.pathname.startsWith('/openapi/')))return send(res,403,{error:'Authentication is required'});
    const protectedRuntime=url.pathname.startsWith('/api/admin/runtime')||url.pathname.startsWith('/api/admin/execution/')||url.pathname.startsWith('/api/admin/metadata');
    let route = routes.find(([m, p]) => m === req.method && (p.includes('*/')
      ? new RegExp('^' + p.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$').test(url.pathname)
      : p.endsWith('*') ? url.pathname.startsWith(p.slice(0, -1)) : url.pathname === p));
    if(protectedRuntime)route=[req.method,url.pathname,true,null];
    try {
      if (!route) return send(res, 404, { error: 'not found' });
      if(req.method!=='GET'&&url.pathname!=='/api/admin/config'&&url.pathname!=='/api/session'&&require('./lib/config').generation().lastError)return send(res,503,{error:'Configuration is invalid; repair it in Admin before starting new work',code:'DT_CONFIG_INVALID'});
      if (route[2] && !identity) return send(res, 403, { error: 'Authentication is required' });
      if(supplied&&!identity&&!['/admin','/api/session'].includes(url.pathname))return send(res,403,{error:'Invalid access token'});
      let scope=identity||A.LEGACY;
      // Keyed immutable result links remain read-only capabilities for sandboxed embeds.
      // Explicit story headers are enforced; same-principal browser embeds restore their saved story.
      {const key=url.pathname.match(/\/(?:architecture|map|map-preview|show|patch|logs|view|result|files)\/([a-z0-9]+)(?:\.patch)?(?:\/|$)/)?.[1];if(key){const value=results.raw(key);if(value?.owner&&(!identity||(!req.headers['x-dt-story']&&!req.headers['x-openwebui-chat-id']&&!req.headers['x-chat-id']&&!identity.storyBound&&identity.principalId===value.owner.principalId)))scope={...value.owner,role:'user'};}}
      const workRequest=url.pathname==='/mcp'||url.pathname.startsWith('/api/tool/')||url.pathname==='/api/admin/refresh';
      await A.run(scope,()=>require('./lib/telemetry').withCarrier(workRequest?{traceparent:req.headers.traceparent}:null,async()=>{
        const observation=workRequest?require('./lib/telemetry').begin('http.server',{'dt.kind':'http','http.request.method':req.method,'http.route':route[1]},{kind:1}):null;
        const handle=async()=>{
        try {
        const globalWrite=req.method!=='GET'&&['/api/admin/tools/reload','/api/admin/refresh','/api/admin/notes','/api/admin/repos','/api/admin/sites'].includes(url.pathname);
        if(url.pathname==='/api/admin/config'||globalWrite)A.requireAdmin();
        if(protectedRuntime){if(!await require('./lib/runtime-admin').handle(req,res,url,send,readJsonBody))send(res,404,{error:'Unknown runtime endpoint'});return;}
        await route[3](req,res,url);
        } catch(error){observation?.end(error,{'http.response.status_code':error.statusCode||500});throw error;}
        finally{observation?.end(null,{'http.response.status_code':res.statusCode});}
        };
        return observation?observation.run(handle):handle();
      }));
    } catch (e) {
      if (!res.headersSent) send(res, e.statusCode || (['DT_NOT_FOUND','NOT_FOUND'].includes(e.code)?404:['STATE_CONFLICT','STALE_REVISION'].includes(e.code)?409:e.code === 'DT_PROFILE_UNKNOWN' || e.code === 'DT_ARGUMENT_INVALID' ? 400 : 500), errorPayload(e)); else res.end();
    }
  });
  server.once('close',()=>require('./lib/operational-metrics').stop().catch(()=>{}));
  // the browser container starts after dt is healthy and reads these secrets once
  try { require('./lib/browser').writeSecrets(); } catch (e) { console.error(`browser secrets: ${e.message}`); }
  tools.ready().catch(e => console.error(`tools: ${e.message}`));
  // what fetching and tests need, once at start: problems go to the log (dt doctor for the full list)
  if (!process.env.DT_NO_DOCTOR && !process.env.NODE_TEST_CONTEXT) setTimeout(() => require('./lib/doctor').check().then(d => {
    const bad = d.checks.filter(c => c.status !== 'ok');
    console.error(`doctor: ${d.counts.ok} ok, ${d.counts.warn} warnings, ${d.counts.fail} failing`);
    for (const c of bad) console.error(`doctor: ${c.status.toUpperCase()} ${c.check}: ${c.detail}${c.fix ? ` (fix: ${c.fix})` : ''}`);
  }).catch(e => console.error(`doctor: ${e.message}`)), 2000).unref();
  // workspaces nobody used for tests.workspaceDays
  const sweep = () => { try { require('./lib/workspace').sweep().then(r => { if (r.length) console.error(`workspaces removed (unused ${require('./lib/config').getTests().workspaceDays} days): ${r.join(', ')}`); }); } catch {} };
  setTimeout(sweep, 5000).unref();
  setInterval(sweep, 6 * 3600e3).unref();
  server.listen(port, host, () => console.error(`dt serve: http://${host}:${port}  (mcp: /mcp, admin: /admin)`));
  return server;
}

module.exports = { start, trusted };
