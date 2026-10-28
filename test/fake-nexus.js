// A private Maven repository for tests: files from a folder, only with the right basic-auth
// credentials (401 with a challenge otherwise, as Nexus does). Records who asked for what.
const http = require('http');
const fs = require('fs');
const path = require('path');

function start({ dir, user, password, host = '127.0.0.1' }) {
  const requests = [];
  const want = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  const server = http.createServer((req, res) => {
    const ok = req.headers.authorization === want;
    requests.push({ path: req.url, auth: req.headers.authorization ? (ok ? 'ok' : 'wrong') : 'none' });
    if (!ok) { res.writeHead(401, { 'www-authenticate': 'Basic realm="nexus"' }); return res.end(); }
    const f = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/repository\/maven-releases/, ''));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
  // host: where the build reaches it (with a build runner in another container: this container's address)
  return new Promise(r => server.listen(0, host === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0', () => r({ url: `http://${host}:${server.address().port}/repository/maven-releases`, requests, close: () => server.close() })));
}

module.exports = { start };
