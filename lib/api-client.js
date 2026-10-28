// Transport-neutral v1 exchange and request contracts. Browser capture is an adapter; persistence,
// attribution and scripts consume plain JSON, so a different capture/index/store can replace it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE, readJson, writeJson } = require('./util');
const S = () => require('./scripts');
const R = () => require('./routes');
const DIR = path.join(CACHE, 'api-exchanges');
const MAX_BODY = 262144, MAX_INPUT = 4 * 1048576, MAX_ENTRIES = 100, KEEP = 500;
const SECRET = /password|passwd|secret|token|authorization|api.?key|session|cookie|credential|email|phone|ssn|private.?key/i;
const OMIT_HEADER = /^(cookie|set-cookie|host|content-length|connection|transfer-encoding|accept-encoding|proxy-authorization|sec-.*)$/i;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const clone = x => JSON.parse(JSON.stringify(x));
const bytes = x => Buffer.byteLength(typeof x === 'string' ? x : JSON.stringify(x));
const safeName = x => String(x).replace(/[^a-z0-9_]/gi, '_').replace(/^([^a-z_])/i, 'p_$1').slice(0, 60) || 'value';
const id = () => crypto.randomBytes(12).toString('hex');
function bounded(input) { if (bytes(input) > MAX_INPUT) throw new Error('exchange import exceeds 4 MiB; split the capture'); }
function headers(input) { return Array.isArray(input) ? Object.fromEntries(input.map(h => [h.name, h.value])) : input || {}; }
function secretRef(name, ctx, location) {
  if (location.startsWith('response/')) { ctx.redactions.push({location,reason:'sensitive response field'}); return '[redacted]'; }
  const base = safeName(name); let param = ['__proto__','prototype','constructor'].includes(base) ? 'p_'+base : base, n = 1;
  while (ctx.params[param] && ctx.params[param].location !== location) param = `${base}_${++n}`;
  ctx.params[param] = { type: 'string', required: true, secret: true, description: `Supply ${name} at run time; the captured value was removed`, location };
  ctx.redactions.push({ location, param, reason: 'sensitive field' });
  return `{{${param}}}`;
}
function redactJson(value, ctx, location) {
  if (Array.isArray(value)) return value.map((v, i) => redactJson(v, ctx, `${location}/${i}`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET.test(k) ? secretRef(k, ctx, `${location}/${k}`) : redactJson(v, ctx, `${location}/${k}`)]));
  return value;
}
function cleanHeaders(input, ctx, location) {
  const out = {};
  for (const [key, v] of Object.entries(headers(input))) {
    const name = key.toLowerCase();
    if (OMIT_HEADER.test(name)) { if (/cookie|authorization/i.test(name)) ctx.redactions.push({ location: `${location}/${name}`, reason: 'browser/session header omitted' }); continue; }
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) continue;
    const text = String(v).slice(0, 8192);
    out[name] = SECRET.test(name) ? (/^(Bearer|Basic)\s/i.test(text) ? text.split(/\s/)[0] + ' ' : '') + secretRef(name, ctx, `${location}/${name}`) : text;
  }
  return out;
}
function cleanUrl(input, ctx, location = 'request/url') {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol)) throw new Error('request URL must use http or https');
  if (url.username || url.password) { url.username = ''; url.password = ''; ctx.redactions.push({ location, reason: 'URL credentials omitted' }); }
  url.hash = '';
  for (const key of [...new Set(url.searchParams.keys())]) if (SECRET.test(key)) { const vals = url.searchParams.getAll(key); url.searchParams.delete(key); vals.forEach((_, i) => url.searchParams.append(key, secretRef(key, ctx, `${location}/query/${key}/${i}`))); }
  return url.toString().replace(/%7B%7B([^%]+)%7D%7D/gi, '{{$1}}');
}
function body(input, contentType, ctx, location, supplied = false) {
  if (input === undefined || input === null || input === '') return { kind: supplied ? 'text' : 'none', ...(supplied ? { value: input ?? '' } : {}) };
  if (input && typeof input === 'object' && input.kind) {
    if (input.kind === 'text' && input.reviewed === true && typeof input.value === 'string' && bytes(input.value) <= MAX_BODY) return {kind:'text',value:input.value,reviewed:true,bytes:bytes(input.value),contentType:input.contentType||contentType||'text/plain'};
    if (['binary', 'unsupported', 'unavailable'].includes(input.kind)) return { kind: input.kind, reason: String(input.reason || 'Body unavailable'), ...(input.bytes ? { bytes: Number(input.bytes) } : {}) };
    return body(input.value, input.contentType || contentType, ctx, location, true);
  }
  const size = bytes(input);
  if (size > MAX_BODY) { ctx.gaps.push({ kind: 'body-truncated', location, bytes: size, limit: MAX_BODY }); return { kind: 'unsupported', bytes: size, reason: 'Body exceeds 256 KiB capture limit' }; }
  if (/multipart\/|octet-stream|image\/|audio\/|video\//i.test(contentType || '')) { ctx.gaps.push({ kind: 'unsupported-body', location }); return { kind: 'unsupported', contentType, bytes: size, reason: 'Binary and multipart bodies require a separate file fixture' }; }
  let value = input;
  if (typeof input !== 'string') return { kind: 'json', value: redactJson(input, ctx, location), bytes: size, contentType: contentType || 'application/json' };
  if (/json/i.test(contentType || '') || /^[\[{]/.test(input.trim())) { try { value = JSON.parse(input); return { kind: 'json', value: redactJson(value, ctx, location), bytes: size, contentType: contentType || 'application/json' }; } catch {} }
  if (/x-www-form-urlencoded/i.test(contentType || '')) {
    const p = new URLSearchParams(input); for (const key of [...p.keys()]) if (SECRET.test(key)) p.set(key, secretRef(key, ctx, `${location}/${key}`));
    return { kind: 'form', value: p.toString().replace(/%7B%7B([^%]+)%7D%7D/gi, '{{$1}}'), bytes: size, contentType };
  }
  // Unstructured text cannot be reliably scrubbed by field name. Preserve no raw payload by default.
  ctx.gaps.push({ kind: 'unstructured-body', location, reason: 'Text body omitted; explicitly supply reviewed text when preparing a request' });
  return { kind: 'unavailable', contentType, bytes: size, reason: 'Unstructured body needs explicit review' };
}
function normalize(entry, source = {}, {resolve = R().resolve} = {}) {
  if (!entry || typeof entry !== 'object') throw new Error('exchange must be an object');
  const ctx = { params: {}, redactions: [], gaps: [] };
  const req = entry.request || entry, res = entry.response || {};
  const requestHeaders = headers(req.headers), responseHeaders = headers(res.headers);
  const method = String(req.method || 'GET').toUpperCase(); if (!METHODS.has(method)) throw new Error(`unsupported HTTP method ${method}`);
  const url = cleanUrl(req.url, ctx);
  const post = req.postData;
  const requestBody = body(req.body ?? post?.text ?? (post?.params ? Object.fromEntries(post.params.map(p => [p.name, p.value])) : undefined), post?.mimeType || requestHeaders['content-type'] || requestHeaders['Content-Type'], ctx, 'request/body');
  const content = res.content;
  const responseBody = content?.encoding === 'base64' ? { kind: 'unsupported', reason: 'Base64/binary response omitted', bytes: content.size } : body(res.body ?? content?.text ?? res.json ?? res.text, content?.mimeType || responseHeaders['content-type'] || responseHeaders['Content-Type'], ctx, 'response/body');
  if (entry.metadataOnly) ctx.gaps.push({ kind: 'metadata-only', reason: 'Network listing does not include headers or bodies; use browser capture instrumentation or import a HAR' });
  let route;try{route=resolve(url,method);}catch{route={status:'unknown',candidates:[]};ctx.gaps.push({kind:'route-attribution-unavailable',reason:'Cached passport endpoints could not be read'});}
  const exchange = { schema: 'dt.api-exchange', version: 1, id: id(), at: new Date().toISOString(), source: { ...(Number.isInteger(entry.sequence)?{sequence:entry.sequence}:{}), kind: String(source.kind || 'import').slice(0, 80), ...(source.session ? { session: String(source.session) } : {}), ...(source.site ? { site: String(source.site) } : {}), ...(source.note ? { note: String(source.note).slice(0, 1000) } : {}) }, request: { method, url, headers: cleanHeaders(requestHeaders, ctx, 'request/headers'), body: requestBody }, response: { status: Number.isInteger(Number(res.status ?? entry.status)) && Number(res.status ?? entry.status)>=100 && Number(res.status ?? entry.status)<=599 ? Number(res.status ?? entry.status) : null, statusText: String(res.statusText || '').slice(0, 100), headers: cleanHeaders(responseHeaders, ctx, 'response/headers'), body: responseBody }, timing: { durationMs: Number.isFinite(Number(entry.time ?? entry.timing?.durationMs ?? res.ms)) && Number(entry.time ?? entry.timing?.durationMs ?? res.ms)>=0 ? Number(entry.time ?? entry.timing?.durationMs ?? res.ms) : null }, route, params: ctx.params, redactions: ctx.redactions, gaps: ctx.gaps };
  if (entry.error) exchange.gaps.push({ kind: 'network-error', reason: 'Response capture failed; request metadata retained' });
  return exchange;
}
function persist(exchange) {
  fs.mkdirSync(DIR, { recursive: true }); writeJson(path.join(DIR, exchange.id + '.json'), exchange);
  const files = fs.readdirSync(DIR).filter(f => /^[a-f0-9]{24}\.json$/.test(f)).map(f => ({ f, time: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.time - a.time);
  for (const f of files.slice(KEEP)) fs.unlinkSync(path.join(DIR, f.f));
  return exchange;
}
function get(exchange) { if (!/^[a-f0-9]{24}$/.test(exchange || '')) throw new Error('invalid exchange id'); const e = readJson(path.join(DIR, exchange + '.json')); if (!e) throw new Error('exchange not found or expired'); return e; }
function list({ q = '', limit = 50 } = {}) {
  let files; try { files = fs.readdirSync(DIR); } catch { return []; }
  return files.filter(f => /^[a-f0-9]{24}\.json$/.test(f)).map(f => readJson(path.join(DIR, f))).filter(Boolean).filter(e => `${e.request.method} ${e.request.url} ${e.response.status} ${e.route.candidates.map(c => c.service).join(' ')}`.toLowerCase().includes(String(q).toLowerCase())).sort((a,b) => b.at.localeCompare(a.at)).slice(0, Math.max(1, Math.min(Number(limit) || 50, KEEP))).map(e => ({ id: e.id, at: e.at, method: e.request.method, url: e.request.url, status: e.response.status, ms: e.timing.durationMs, route: e.route, gaps: e.gaps.length }));
}
function importExchanges(input, source = {}) {
  bounded(input); let entries;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { entries = R().parseNetwork(input).map(e => ({ ...e, metadataOnly: true })); } }
  if (!entries) entries = Array.isArray(input) ? input : Array.isArray(input?.log?.entries) ? input.log.entries : Array.isArray(input?.entries) ? input.entries : [input];
  if (entries.length > MAX_ENTRIES) throw new Error('at most 100 exchanges per import');
  let resolve;try{resolve=R().resolver();}catch{resolve=()=>{throw new Error('unavailable');};}
  const exchanges = entries.map(e => normalize(e, source, {resolve}));
  exchanges.forEach(persist);
  try { R().learn(exchanges.map(e => ({ method: e.request.method, url: e.request.url, status: e.response.status })), `exchange:${source.kind || 'import'}`); } catch { for(const e of exchanges){e.gaps.push({kind:'route-index-update-failed',reason:'Exchanges retained; route index could not be rebuilt'});persist(e);} }
  return { exchanges, count: exchanges.length };
}
function editable(request) {
  const req = clone(request); req.headers ||= {}; req.body ||= {kind:'none'};
  if (!METHODS.has(String(req.method).toUpperCase())) throw new Error('unsupported HTTP method');
  req.method = req.method.toUpperCase(); const u = new URL(req.url); if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('URL must use http(s) without inline credentials');
  for (const h of Object.keys(req.headers || {})) if (OMIT_HEADER.test(h)) throw new Error(`header ${h} is browser/transport managed; supply credentials via a named authorization placeholder`);
  if (!['none', 'json', 'text', 'form'].includes(req.body?.kind || 'none')) throw new Error(`cannot replay ${req.body?.kind} body; supply a reviewed JSON/text/form body first`);
  if (bytes(req) > MAX_BODY * 2) throw new Error('prepared request exceeds 512 KiB');
  return req;
}
// Bind explicit locations only: positional URL path segments include the initial empty segment.
function prepare({ exchange, request, bindings = {}, description, assertions, capture, before, after, finally: finalHook } = {}) {
  const e = exchange ? (typeof exchange === 'string' ? get(exchange) : clone(exchange)) : null;
  const req = editable(request || e?.request || {}), params = { ...(e?.params || {}) }, encoded = [];
  for (const [name, binding] of Object.entries(bindings)) {
    if (!/^[a-z_]\w*$/i.test(name)) throw new Error(`invalid parameter ${name}`);
    const placeholder = `{{${name}}}`; let old;
    if (binding.in === 'path' || binding.in === 'query') {
      const u = new URL(req.url);
      if (binding.in === 'path') { const segments = u.pathname.split('/'); if (!Number.isInteger(binding.index) || binding.index < 1 || binding.index >= segments.length) throw new Error(`invalid path segment for ${name}`); old = decodeURIComponent(segments[binding.index]); segments[binding.index] = placeholder; u.pathname = segments.join('/'); }
      else { if (!u.searchParams.has(binding.key)) throw new Error(`query ${binding.key} not found`); old = u.searchParams.get(binding.key); u.searchParams.set(binding.key, placeholder); }
      req.url = u.toString().replace(/%7B%7B([^%]+)%7D%7D/gi, '{{$1}}'); encoded.push(name);
    } else if (binding.in === 'header') { const key = String(binding.key).toLowerCase(); if (OMIT_HEADER.test(key)) throw new Error('cannot bind browser/transport managed header'); old = req.headers[key]; req.headers[key] = placeholder; }
    else if (binding.in === 'body') { if (req.body.kind !== 'json') throw new Error('body bindings require JSON'); const parts = String(binding.path || '').split('.').filter(Boolean); let obj = req.body.value; for (const key of parts.slice(0, -1)) { if (!Object.hasOwn(obj || {}, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('body path not found'); obj = obj[key]; } const key = parts.at(-1); if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || !Object.hasOwn(obj || {}, key)) throw new Error('body path not found'); old = obj[key]; obj[key] = placeholder; }
    else throw new Error(`binding ${name}: in must be path, query, header or body`);
    params[name] = { type: typeof old === 'number' ? 'number' : typeof old === 'boolean' ? 'boolean' : 'string', required: true, description: binding.description || `${binding.in} ${binding.key || binding.path || binding.index}`, ...(binding.secret ? { secret: true } : {}), ...(binding.default !== undefined && !binding.secret ? { default: binding.default } : {}) };
  }
  for (const match of JSON.stringify(req).matchAll(/\{\{([a-z_]\w*)\}\}/gi)) if (!params[match[1]]) params[match[1]] = { type: 'string', required: true, description: `Request parameter ${match[1]}` };
  for (const match of req.url.matchAll(/\{\{([a-z_]\w*)\}\}/gi)) encoded.push(match[1]);
  if (req.body?.kind === 'form' && !Object.keys(req.headers).some(k=>k.toLowerCase()==='content-type')) req.headers['content-type']='application/x-www-form-urlencoded';
  const step = { http: `${req.method} ${req.url}`, headers: req.headers || {}, ...(req.body?.kind !== 'none' && req.body?.value !== undefined ? { body: req.body.value } : {}), urlEncodeParams: [...new Set(encoded)], allowErrors: true, as: 'response', ...(assertions ? { assertions } : {}), ...(capture ? { capture } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}), ...(finalHook ? { finally: finalHook } : {}) };
  const script = { description: description || `${req.method} ${e?.route.path || new URL(req.url).pathname}`, params, steps: [step], provenance: { schema: 'dt.api-request', version: 1, ...(e ? { exchange: e.id, source: e.source, route: e.route } : {}) } };
  S().validate(script);
  return { schema: 'dt.api-request', version: 1, request: req, params, script, ...(e ? { exchange: e.id, route: e.route } : {}), mutation: !['GET', 'HEAD', 'OPTIONS'].includes(req.method) };
}
async function replay({ prepared, exchange, request, params = {}, timeoutMs = 30000 } = {}) {
  const p = prepared || prepare({ exchange, request });
  if (p.schema !== 'dt.api-request' || p.version !== 1) throw new Error('unsupported prepared request contract');
  // Rebuild executable request from the public contract; never trust executable script supplied in it.
  const clean = prepare({ request: p.request });
  clean.script.params = p.params || clean.params;
  const values = S().params(clean.script, params), step = clean.script.steps[0], encoded = { ...values };
  for (const name of step.urlEncodeParams) if (encoded[name] !== undefined) encoded[name] = encodeURIComponent(String(encoded[name]));
  const sent = { method: clean.request.method, url: S().fill(clean.request.url, encoded), headers: S().fill(clean.request.headers || {}, values), ...(clean.request.body?.value !== undefined ? { body: S().fill(clean.request.body.value, values) } : {}) };
  const result = await S().httpRequest(sent, { timeoutMs, allowErrors: true, maxResponseBytes: MAX_BODY });
  const out = persist(normalize({ request: sent, response: result, time: result.ms }, { kind: 'explicit-replay', note: p.exchange ? `replayed exchange ${p.exchange}` : 'API client' }));
  if (result.truncated) out.gaps.push({ kind: 'response-truncated', limit: MAX_BODY });
  persist(out); R().learn([{ method: out.request.method, url: out.request.url, status: out.response.status }], `exchange:${out.id}`);
  return out;
}
function save({ id: scriptId, prepared, exchange, request, bindings, description, overwrite = false, tool = false, assertions, capture, before, after, finally: finalHook } = {}) {
  const p = prepare({ ...(prepared || {}), exchange: exchange || prepared?.exchange, request: request || prepared?.request, bindings, description, assertions, capture, before, after, finally: finalHook });
  if (prepared?.params) p.script.params = prepared.params;
  if (S().list().scripts.some(s => s.id === scriptId) && !overwrite) throw new Error('script already exists; use overwrite explicitly');
  // Captured defaults never contain secrets. Explicit edits are scrubbed once more before persistence.
  const scrubbed = normalize({ request: p.request }, { kind: 'saved-request' });
  const safe = prepare({ request: scrubbed.request, description: description || p.script.description, assertions, capture, before, after, finally: finalHook });
  const referenced = new Set([...JSON.stringify(safe.script.steps).matchAll(/\{\{([a-z_]\w*)\}\}/gi)].map(m=>m[1]));
  safe.script.params = Object.fromEntries(Object.entries({ ...p.script.params, ...scrubbed.params }).filter(([k])=>referenced.has(k)).map(([k,v]) => { const x={...v}; if (x.secret || SECRET.test(k)) { delete x.default; x.secret=true; x.required=true; } return [k,x]; }));
  safe.script.provenance = p.script.provenance; safe.script.tool = tool;
  return { ...S().save(scriptId, safe.script), params: safe.script.params, provenance: safe.script.provenance };
}

// A browser session is ephemeral: cookies and active pages never enter the exchange store.
const sessions = new Map(), TTL = 15 * 60000;
async function sessionGet(key) { const s = sessions.get(key); if (!s || Date.now() - s.used > TTL) { if (s) { sessions.delete(key); clearTimeout(s.timer); await s.browser.close(); } throw new Error('browser session not found or idle for 15 minutes; open a new session'); } s.used = Date.now(); armSession(key,s); return s; }
const captureInstall = `async (page) => {
 if (page.__dtApiCapture) return { installed: true };
 const store = page.__dtApiCapture = { entries: [], pending: new Set(), dropped: 0, sequence:0, bytes:0 };
 page.on('requestfinished', request => {
  const sequence=++store.sequence;
  const job = (async () => { try {
   const response = await request.response(); if (!response) return;
   const headers = await response.allHeaders(); const length = Number(headers['content-length']);
   const type = headers['content-type'] || ''; let body = { kind: 'unavailable', reason: 'Content length unknown or too large; import a bounded HAR body instead' };
   if (Number.isFinite(length) && length >= 0 && length <= ${MAX_BODY} && /json|text|xml|x-www-form-urlencoded/i.test(type)) body = await response.text();
   else if (/image|audio|video|octet-stream|multipart/i.test(type)) body = {kind:'unsupported',reason:'Binary or multipart payload',bytes:length};
   const post = request.postData();
   store.entries.push({ sequence, request: {method:request.method(),url:request.url(),headers:await request.allHeaders(),body:post && post.length > ${MAX_BODY} ? {kind:'unsupported',reason:'Request body too large',bytes:post.length}:post}, response:{status:response.status(),statusText:response.statusText(),headers,body}, timing:{durationMs:Math.max(0,request.timing().responseEnd)} });
   store.bytes=store.entries.reduce((n,e)=>n+JSON.stringify(e).length*4,0);
   while (store.entries.length > ${MAX_ENTRIES} || store.bytes > 3*1048576) { const removed=store.entries.shift();store.bytes-=JSON.stringify(removed).length*4;store.dropped++; }
  } catch(e) { store.entries.push({sequence,request:{method:request.method(),url:request.url()},error:String(e)}); } })();
  store.pending.add(job); job.finally(() => store.pending.delete(job));
 });
 return {installed:true};
}`;
const captureRead = `async (page) => { const s = page.__dtApiCapture; if (!s) return {entries:[],unavailable:true}; await Promise.race([Promise.allSettled([...s.pending]),new Promise(r=>setTimeout(r,1500))]); const entries=s.entries.splice(0).sort((a,b)=>a.sequence-b.sequence);s.bytes=0; const dropped=s.dropped;s.dropped=0; return {entries,dropped,pending:s.pending.size}; }`;
function armSession(key,s) { clearTimeout(s.timer);s.timer=setTimeout(()=>{if(sessions.get(key)===s){sessions.delete(key);s.browser.close().catch(()=>{});}},TTL);s.timer.unref?.(); }
function toolJson(r) { const text = r.text; try { return JSON.parse(text); } catch {} const m = text.match(/### Result\s*\n([\s\S]*?)(?:\n###|$)/); if (m) { try { return JSON.parse(m[1]); } catch {} } throw new Error('browser run_code did not return structured JSON'); }
async function browserOpen({ site, link, params = {}, url, timeoutMs } = {}) {
  for (const [key, s] of sessions) if (Date.now() - s.used > TTL) { sessions.delete(key); clearTimeout(s.timer); await s.browser.close(); }
  if (sessions.size >= 20) throw new Error('20 active browser sessions; close one first');
  const browser = require('./browser-mcp').session({ timeout: timeoutMs || 30000 }), key = id();
  try {
    const tools = await browser.tools(); const detailed = tools.some(t => t.name === 'browser_run_code');
    if (detailed) await browser.call('browser_run_code', { code: captureInstall });
    const target = url || (site ? require('./config').siteUrl(link ? `${site}.${link}` : site, params) : null);
    let page; if (target) { const u = new URL(target); if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('browser URL must use http(s) without inline credentials'); page = (await browser.call('browser_navigate', { url: target })).text; }
    const state={browser,used:Date.now(),detailed,site};sessions.set(key,state);armSession(key,state);
    return { session: key, mode: detailed ? 'exchanges' : 'metadata-only', ...(page ? { page } : {}), next: 'Inspect the UI with api_browser_action, then call api_browser_capture. This isolated session keeps browser cookies in the browser.' };
  } catch (e) { await browser.close(); throw e; }
}
async function browserAction({ session, action = 'snapshot', args = {} } = {}) {
  const s = await sessionGet(session);
  const allowed = ['snapshot','navigate','click','type','fill_form','press_key','select_option','hover','wait_for','take_screenshot','navigate_back','network_requests'];
  action = action.replace(/^browser_/, ''); if (!allowed.includes(action)) throw new Error(`unsupported browser action; choose ${allowed.join(', ')}`);
  return s.browser.call(`browser_${action}`, args);
}
async function browserCapture({ session, source } = {}) {
  const s = await sessionGet(session); let entries, captureGaps = [];
  if (s.detailed) { const result = toolJson(await s.browser.call('browser_run_code', { code: captureRead })); entries = result.entries || []; if (result.dropped) captureGaps.push({ kind:'capture-overflow', dropped:result.dropped }); if (result.pending) captureGaps.push({kind:'pending-responses',count:result.pending}); }
  else entries = R().parseNetwork((await s.browser.call('browser_network_requests', {})).text).map(e => ({ ...e, metadataOnly:true }));
  const result = importExchanges(entries, { kind:'playwright-mcp', session, site:s.site, note:source });
  return { ...result, gaps:captureGaps, session, mode:s.detailed?'exchanges':'metadata-only' };
}
async function browserClose({ session }) { const s = sessions.get(session); if (s) { sessions.delete(session); clearTimeout(s.timer); await s.browser.close(); } return { session, closed:true }; }
function show(exchange) { const e = typeof exchange === 'string' ? get(exchange) : exchange; const client = `${require('./results').publicUrl()}/api-client?exchange=${encodeURIComponent(e.id)}`; return { ...e, client, view: require('./results').saveView('api-exchange', e, { title: `${e.request.method} ${e.route.path || 'API exchange'}`, client }) }; }
module.exports = { normalize, importExchanges, get, list, prepare, replay, save, browserOpen, browserAction, browserCapture, browserClose, show, MAX_BODY, DIR, captureInstall, captureRead };
