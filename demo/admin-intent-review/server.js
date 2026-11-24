#!/usr/bin/env node
// Read-only review server. Prototype actions stay in the browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const i = args.indexOf('--port');
const port = i < 0 ? 4100 : Number(args[i + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose an unprivileged port.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Read-only review server'); }
  let file;
  try {
    const url = new URL(req.url, 'http://localhost');
    const staticRoot = path.resolve(__dirname, '../../web');
    file = url.pathname.startsWith('/static/') ? path.resolve(staticRoot, decodeURIComponent(url.pathname.slice(8))) : url.pathname === '/tokens.css' ? path.resolve(__dirname, '../../web/ui.css') : path.resolve(__dirname, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.pathname.startsWith('/static/')) { if (!file.startsWith(staticRoot + path.sep)) throw Error('outside'); }
    else if (url.pathname !== '/tokens.css' && !file.startsWith(__dirname + path.sep)) throw Error('outside');
  } catch { res.writeHead(400); return res.end(); }
  if (!types[path.extname(file)]) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});
server.listen(port, '127.0.0.1', () => console.log('Admin review: http://127.0.0.1:' + port));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
