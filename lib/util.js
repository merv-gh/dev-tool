const fs = require('fs');
const path = require('path');
const { PATHS } = require('./config');

const CACHE = PATHS.cache;

// Run fn over items with at most n in flight; never throws, returns [{item, value|error}].
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const cursor = require('./state-machine').create(require('./lifecycles').enumeration, items.length ? 'available' : 'exhausted');
  async function worker() {
    while (!cursor.terminal) {
      require('./execution').check();
      const i = next++; if (next === items.length) cursor.to('exhausted');
      try { out[i] = { item: items[i], value: await fn(items[i], i) }; }
      catch (error) { out[i] = { item: items[i], error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function http(url, options = {}) {
  const O=require('./observations');let observation,facts={};
  if(options.observe){let endpoint;try{endpoint=new URL(url).origin;}catch{}observation=O.start({kind:'model',name:'completion',source:options.observe.purpose,purpose:options.observe.purpose,model:options.body?.model,endpoint,requestBytes:Buffer.byteLength(typeof options.body==='string'?options.body:JSON.stringify(options.body||{}))});}
  const request=async()=>{try{const value=await httpRequest(url,{...options,onHeaders:status=>{facts.httpStatus=status;require('./telemetry').annotate({'http.response.status_code':status});if(status>=400)facts.errorCode='HTTP_'+status;facts.headersMs=Date.now()-observation.row.startedAt;},onBody:bytes=>{facts.responseBytes=bytes;},observe:!!observation});const usage=O.usage(value);if(options.observe)require('./telemetry').annotate({'gen_ai.usage.input_tokens':usage.inputTokens,'gen_ai.usage.output_tokens':usage.outputTokens});observation?.end(null,{...facts,...usage,error:!!value?.error,errorCode:value?.error?'UPSTREAM_ERROR':facts.errorCode});return value;}catch(error){observation?.end(error,facts);throw error;}};
  return require('./telemetry').run('http.client', {'dt.kind':options.observe?'model':'network','http.request.method':options.method||'GET',...(options.observe?{'gen_ai.operation.name':options.observe.purpose==='docs.embed'?'embeddings':'chat','gen_ai.request.model':options.body?.model,'dt.model.purpose':options.observe.purpose}:{})}, () => observation?observation.run(request):request());
}
async function httpRequest(url, { method = 'GET', body, headers = {}, auth, timeout = 30000, raw = false, signal, onHeaders, onBody, observe } = {}) {
  const h = { ...headers };
  if (auth && auth.user) h.authorization = 'Basic ' + Buffer.from(`${auth.user}:${auth.pass || ''}`).toString('base64');
  if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); h['content-type'] ??= 'application/json'; }
  const E = require('./execution'); E.check();
  const signals = [signal, E.signal(), AbortSignal.timeout(timeout)].filter(Boolean);
  const lifecycle = require('./state-machine').create(require('./lifecycles').http);
  let res;
  try {
    res = await fetch(url, { method, body, headers: h, signal: AbortSignal.any(signals) });
  } catch (e) {
    lifecycle.to('failed');
    // "fetch failed" alone hides the reason (ECONNREFUSED, EHOSTUNREACH, ETIMEDOUT, ...)
    E.check();
    const c = e.cause;
    throw new Error(`${method} ${url} -> ${e.name === 'TimeoutError' ? `timeout ${timeout}ms` : (c && (c.code || c.message)) || e.message}`);
  }
  lifecycle.to('reading');
  if(observe)onHeaders(res.status);
  try {
  const text = await res.text(); E.check();
  if(observe)onBody(Buffer.byteLength(text));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  if (raw) { lifecycle.to('completed'); return text; }
  try { const value = JSON.parse(text); lifecycle.to('completed'); return value; } catch { throw new Error(`${method} ${url} -> not JSON: ${text.slice(0, 200)}`); }
  } catch (error) { if (!lifecycle.terminal) lifecycle.to('failed'); throw error; }
}
// {a:{b:1}, c:[{d:2}]} -> {"a.b":"number", "c[].d":"number"}
function flattenTypes(obj, prefix = '', out = {}) {
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] !== null && typeof obj[0] === 'object') flattenTypes(obj[0], prefix + '[]', out);
    else out[prefix] = 'array';
  } else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flattenTypes(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = obj === null ? 'null' : typeof obj;
  }
  return out;
}

// Only objects/arrays: a key like "007" or a 19-digit id must stay a string.
function tryJson(s) {
  if (typeof s !== 'string' || !/^\s*[[{]/.test(s)) return s;
  try { return JSON.parse(s); } catch { return s; }
}

// Files people read or edit (config, notes, scripts) are indented; caches are compact: half the size, and
// a big index stays under the longest string V8 can build. Written to a temp file and renamed, so a reader
// never sees half a file and a failed write keeps the previous one.
function writeJson(file, data) {
  const cache = path.resolve(file).startsWith(path.resolve(CACHE) + path.sep);
  require('./atomic-file').atomicFile(file, cache ? JSON.stringify(data) : JSON.stringify(data, null, 2));
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ctime and file identity also catch same-size replacements whose mtime was preserved.
function fileStamp(file) {
  try { const s = fs.statSync(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; } catch { return null; }
}

// File-name-safe version of a topic/index name
const safeName = (s) => s.replace(/[^\w.@-]/g, '_');

function table(rows) {
  if (!rows.length) return '(0 rows)';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  };
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => cell(r[c]).length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(w[i])).join(' | ');
  return [line(cols), w.map(n => '-'.repeat(n)).join('-+-'), ...rows.map(r => line(cols.map(c => cell(r[c]))))].join('\n');
}

module.exports = { CACHE, pool, http, flattenTypes, tryJson, writeJson, readJson, fileStamp, safeName, table };
