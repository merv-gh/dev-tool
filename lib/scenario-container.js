// These two standalone Node programs are mounted into a --network none container. The application
// itself runs unchanged from its reviewed workspace entry point; no host ports or sockets are exposed.
// Keep them dependency-free so a stock Node image is enough.
function harness() {
  const fs = require('fs'), http = require('http'), path = require('path'), { spawn } = require('child_process'), { isDeepStrictEqual } = require('util');
  const input = JSON.parse(fs.readFileSync('/dt-control/input.json', 'utf8')), counts = new Map(), records = '/dt-evidence/events.jsonl';
  const event = value => fs.appendFileSync(records, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
  const normalizedPath = p => { const u = new URL(p, 'http://local'); u.searchParams.sort(); return u.pathname + u.search; };
  const sequences = new Map();
  try {
    const watch = fs.watch('/dt-files', { recursive: true }, (change, filename) => event({ kind: filename ? 'file-change' : 'file-watch-gap', change, path: filename && String(filename).replace(/\\/g, '/') }));
    watch.on('error', e => event({ kind: 'file-watch-gap', error: e.message }));
  } catch (e) { event({ kind: 'file-watch-gap', error: e.message }); }
  const handler = async (id, req, res) => {
    let bytes = 0, chunks = [];
    for await (const part of req) { bytes += part.length; if (bytes > 1024 * 1024) { event({ kind: 'http-mismatch', reason: 'request exceeds 1 MiB' }); res.writeHead(413).end(); return; } chunks.push(part); }
    let body = Buffer.concat(chunks).toString('utf8'); try { body = JSON.parse(body); } catch {}
    if (!chunks.length) body = null;
    const request = { method: req.method, path: normalizedPath(req.url), body };
    const exchanges = input.http[id]?.exchanges || [];
    const index = exchanges.findIndex((exchange, i) => {
      const expected = exchange.request, n = counts.get(`${id}:${i}`) || 0, max = exchange.times?.max ?? exchange.times?.value ?? 1;
      return n < max && request.method === (expected.method || 'GET').toUpperCase() && request.path === normalizedPath(expected.path || '/')
        && isDeepStrictEqual(request.body, Object.hasOwn(expected, 'body') ? expected.body : null)
        && Object.entries(expected.headers || {}).every(([key, value]) => req.headers[key.toLowerCase()] === String(value));
    });
    if (index < 0) { event({ kind: 'http-mismatch', state: id, request, reason: 'No exact method/path/body/header fixture with remaining calls' }); res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"scenario HTTP fixture mismatch"}'); return; }
    const exchange = exchanges[index], count = counts.get(`${id}:${index}`) || 0;
    if (input.http[id].ordered && index !== (sequences.get(id) || 0)) { event({ kind: 'http-mismatch', state: id, request, reason: `Expected exchange ${sequences.get(id) || 0}, received ${index}` }); res.writeHead(503).end(); return; }
    counts.set(`${id}:${index}`, count + 1);
    if (input.http[id].ordered && count + 1 >= (exchange.times?.max ?? exchange.times?.value ?? 1)) sequences.set(id, index + 1);
    const responses = exchange.responses || [exchange.response], response = responses[Math.min(count, responses.length - 1)];
    event({ kind: 'http', state: id, exchange: index, request, count: count + 1 });
    if (response.delayMs) await new Promise(r => setTimeout(r, response.delayMs));
    if (response.close) { res.destroy(); return; }
    const text = typeof response.body === 'string' ? response.body : response.body == null ? '' : JSON.stringify(response.body);
    res.writeHead(response.status || 200, { 'content-type': 'application/json', ...(response.headers || {}) }); res.end(text);
  };
  const servers = [];
  Promise.all(Object.keys(input.http).map(id => new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { handler(id, req, res).catch(error => { event({ kind: 'http-mismatch', state: id, reason: error.message }); if (!res.headersSent) res.writeHead(503); res.end(); }); });
    servers.push(server); server.once('error', reject); server.listen(input.ports[id], '127.0.0.1', resolve);
  }))).then(() => {
    const child = spawn(process.execPath, ['--experimental-permission', '--allow-fs-read=/workspace', '--allow-fs-read=/dt-files', '--allow-fs-read=/tmp', '--allow-fs-read=/dt-control/audit.js', '--allow-fs-write=/dt-files', '--allow-fs-write=/tmp', '--require', '/dt-control/audit.js', path.join('/workspace', input.profile.entry), ...(input.profile.args || [])], { cwd: '/workspace', env: { PATH: process.env.PATH, HOME: '/tmp', TMPDIR: '/tmp', NODE_ENV: 'test', ...input.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.on('message', message => { if (message && message.dtFileAudit === 1 && typeof message.path === 'string' && message.path.startsWith('/dt-files/')) event({ kind: 'file-operation', path: path.relative('/dt-files', message.path), operation: String(message.operation || 'write').slice(0, 40) }); });
    child.stdout.on('data', c => process.stdout.write(c)); child.stderr.on('data', c => process.stderr.write(c));
    child.on('error', e => { event({ kind: 'process-error', error: e.message }); process.exit(1); });
    child.on('close', code => { event({ kind: 'process-exit', code }); process.exit(code || 0); });
    process.on('SIGTERM', () => { child.kill('SIGTERM'); servers.forEach(server => server.close()); setTimeout(() => process.exit(0), 500).unref(); });
    event({ kind: 'started', pid: child.pid });
  }).catch(error => { event({ kind: 'process-error', error: error.message }); process.exit(1); });
}
function audit() {
  // Ordinary Node fs/fs.promises writes are traced after success, preserving short-lived effects
  // that filesystem watchers may coalesce. This is test instrumentation for trusted service code,
  // not an adversarial security boundary or proof about arbitrary native filesystem syscalls.
  const fs = require('fs'), path = require('path'), { fileURLToPath } = require('url'), descriptors = new Map();
  const filename = value => typeof value === 'number' ? descriptors.get(value) : value instanceof URL ? fileURLToPath(value) : typeof value === 'string' || Buffer.isBuffer(value) ? path.resolve(String(value)) : null;
  const record = (operation, value) => { const full = filename(value); if (full?.startsWith('/dt-files/')) process.send?.({ dtFileAudit: 1, operation, path: full }); };
  const methods = { writeFile: [0], appendFile: [0], unlink: [0], rename: [0, 1], rm: [0], mkdir: [0], rmdir: [0], copyFile: [1], cp: [1], truncate: [0], chmod: [0], chown: [0], symlink: [1], link: [1] };
  for (const [name, positions] of Object.entries(methods)) {
    if (fs[name + 'Sync']) { const original = fs[name + 'Sync']; fs[name + 'Sync'] = function (...args) { const result = Reflect.apply(original, this, args); positions.forEach(i => record(name, args[i])); return result; }; }
    if (fs[name]) { const original = fs[name]; fs[name] = function (...args) { const callback = args.at(-1); if (typeof callback === 'function') args[args.length - 1] = function (error, ...values) { if (!error) positions.forEach(i => record(name, args[i])); Reflect.apply(callback, this, [error, ...values]); }; return Reflect.apply(original, this, args); }; }
    if (fs.promises[name]) { const original = fs.promises[name]; fs.promises[name] = async function (...args) { const result = await Reflect.apply(original, this, args); positions.forEach(i => record(name, args[i])); return result; }; }
  }
  const openSync = fs.openSync; fs.openSync = function (file, flags, ...args) { const fd = Reflect.apply(openSync, this, [file, flags, ...args]); descriptors.set(fd, filename(file)); if (typeof flags === 'number' || /[wa+]/.test(flags || 'r')) record('open', file); return fd; };
  for (const name of ['writeSync', 'writevSync', 'ftruncateSync', 'fchmodSync', 'fchownSync']) { const original = fs[name]; if (original) fs[name] = function (...args) { const result = Reflect.apply(original, this, args); record(name, args[0]); return result; }; }
  const closeSync = fs.closeSync; fs.closeSync = function (fd) { const result = Reflect.apply(closeSync, this, [fd]); descriptors.delete(fd); return result; };
  const open = fs.open; fs.open = function (file, flags, ...args) { const callback = args.at(-1); if (typeof callback === 'function') args[args.length - 1] = function (error, fd) { if (!error) { descriptors.set(fd, filename(file)); if (typeof flags === 'number' || /[wa+]/.test(flags || 'r')) record('open', file); } Reflect.apply(callback, this, [error, fd]); }; return Reflect.apply(open, this, [file, flags, ...args]); };
  for (const name of ['write', 'writev', 'ftruncate', 'fchmod', 'fchown']) { const original = fs[name]; if (original) fs[name] = function (...args) { const callback = args.at(-1); if (typeof callback === 'function') args[args.length - 1] = function (error, ...values) { if (!error) record(name, args[0]); Reflect.apply(callback, this, [error, ...values]); }; return Reflect.apply(original, this, args); }; }
  const promiseOpen = fs.promises.open; fs.promises.open = async function (file, flags, ...args) { const handle = await Reflect.apply(promiseOpen, this, [file, flags, ...args]); if (typeof flags === 'number' || /[wa+]/.test(flags || 'r')) record('open', file); for (const name of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown']) { const original = handle[name]; handle[name] = async function (...values) { const result = await Reflect.apply(original, this, values); record(name, file); return result; }; } return handle; };
  const stream = fs.createWriteStream; fs.createWriteStream = function (file, options) { const result = Reflect.apply(stream, this, [file, options]); result.on('finish', () => record('stream', file || options?.fd)); return result; };
  require('module').syncBuiltinESMExports();
}
function client() {
  const http = require('http'); let data = '';
  process.stdin.on('data', c => { data += c; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(data), body = Object.hasOwn(input, 'body') ? typeof input.body === 'string' ? input.body : JSON.stringify(input.body) : null;
      const req = http.request({ hostname: '127.0.0.1', port: input.port, method: input.method || 'GET', path: input.path, headers: { ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...(input.headers || {}) }, timeout: input.timeoutMs || 10000 }, res => {
        let size = 0, chunks = [];
        res.on('data', c => { size += c.length; if (size > 2 * 1024 * 1024) req.destroy(new Error('HTTP response exceeds 2 MiB')); else chunks.push(c); });
        res.on('end', () => { let value = Buffer.concat(chunks).toString('utf8'); try { value = JSON.parse(value); } catch {} process.stdout.write(JSON.stringify({ status: res.statusCode, headers: res.headers, body: value })); });
      });
      req.on('timeout', () => req.destroy(new Error('HTTP deadline expired')));
      req.on('error', e => { process.stderr.write(e.message); process.exitCode = 1; }); req.end(body);
    } catch (e) { process.stderr.write(e.message); process.exitCode = 1; }
  });
}
module.exports = { harness: `(${harness.toString()})();\n`, client: `(${client.toString()})();\n`, audit: `(${audit.toString()})();\n` };
