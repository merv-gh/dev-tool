// A Bitbucket Server stand-in for tests: the REST calls dt makes (repo list with paging, browse, raw),
// over local folders; plus noise repos that only have names and folders. Counts every request.
const http = require('http');
const fs = require('fs');
const path = require('path');

function start({ repos, noise = [], token = 'test-token', pageSize = 25 }) {
  // repos: { "PROJECT/slug": "/local/dir" }; noise: [{ key: "PROJECT/slug", dirs: [...] }]
  const all = [...Object.keys(repos).map(k => ({ key: k })), ...noise].sort((a, b) => a.key.localeCompare(b.key));
  const requests = [];
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    requests.push(u.pathname);
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { errors: [{ message: 'auth' }] });
    if (u.pathname === '/rest/api/1.0/repos') {
      const name = (u.searchParams.get('name') || '').toLowerCase();
      const list = all.filter(r => r.key.split('/')[1].toLowerCase().includes(name));
      const start = Number(u.searchParams.get('start') || 0), limit = Math.min(Number(u.searchParams.get('limit') || 25), pageSize);
      const values = list.slice(start, start + limit).map(r => ({ slug: r.key.split('/')[1], name: r.key.split('/')[1], project: { key: r.key.split('/')[0] } }));
      return send(res, 200, { values, isLastPage: start + limit >= list.length, nextPageStart: start + limit });
    }
    const m = u.pathname.match(/^\/rest\/api\/1\.0\/projects\/([^/]+)\/repos\/([^/]+)\/(browse|raw)(?:\/(.*))?$/);
    if (!m) return send(res, 404, { errors: [{ message: 'not found' }] });
    const key = `${m[1]}/${m[2]}`, rel = decodeURIComponent(m[4] || '');
    const dir = repos[key];
    if (!dir) {
      const n = noise.find(r => r.key === key);
      if (!n) return send(res, 404, { errors: [{ message: 'no repo' }] });
      if (m[3] === 'raw') return send(res, 404, { errors: [{ message: 'no file' }] });
      return send(res, 200, { children: { values: (n.dirs || []).map(d => ({ path: { name: d }, type: 'DIRECTORY' })).concat((n.files || []).map(f => ({ path: { name: f }, type: 'FILE' }))), isLastPage: true } });
    }
    const full = path.join(dir, rel);
    if (!full.startsWith(dir) || !fs.existsSync(full)) return send(res, 404, { errors: [{ message: 'no such path' }] });
    if (m[3] === 'raw') return send(res, 200, fs.readFileSync(full, 'utf8'));
    const values = fs.readdirSync(full, { withFileTypes: true }).filter(e => e.name !== '.git').map(e => ({ path: { name: e.name }, type: e.isDirectory() ? 'DIRECTORY' : 'FILE' }));
    send(res, 200, { children: { values, isLastPage: true } });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, token, requests, close: () => server.close() })));
}

module.exports = { start };
