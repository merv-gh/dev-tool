#!/usr/bin/env node
// Demo files only; production routes and writes are deliberately absent.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(option('--port', 4088)), manifestPath = option('--manifest', null);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose a port between 1024 and 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Read-only demo'); }
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname === '/current') {
    let m;
    try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { res.writeHead(503); return res.end('Start demo/ui-ux.js and pass its manifest to this server. See README.md.'); }
    const base = new URL(m.base);
    if (!['127.0.0.1', 'localhost'].includes(base.hostname)) { res.writeHead(400); return res.end('Use a local disposable fixture'); }
    const target = url.searchParams.get('story') === 'handoff' ? base.origin + '/admin#context' : m.passport;
    if (new URL(target).origin !== base.origin) { res.writeHead(400); return res.end(); }
    res.writeHead(302, { location: target }); return res.end();
  }
  let file;
  try { file = url.pathname === '/tokens.css' ? path.resolve(__dirname, '../../web/ui.css') : path.resolve(__dirname, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname !== '/tokens.css' && (!file.startsWith(__dirname + path.sep) || !types[path.extname(file)])) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); return res.end('Not found.'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});
server.listen(port, '127.0.0.1', () => console.log('UX storybook: http://127.0.0.1:' + port));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
