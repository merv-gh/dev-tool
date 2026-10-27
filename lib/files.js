// File stores: local folders and SFTP servers, one interface (list, search, read, write, mkdir, copy).
//   config.json  "files": { "templates": { "type": "local", "path": "files/templates" },
//                           "partner": { "type": "sftp", "host": "sftp.dev.example.com", "user": "dt",
//                                        "password": "${PARTNER_SFTP_PASSWORD}", "root": "/upload", "write": true },
//                           "archive": { "type": "sftp", "host": "…", "user": "…", "privateKeyFile": "keys/id_ed25519",
//                                        "passphrase": "${…}", "hostKey": "SHA256:…", "root": "/exports" } }
// Paths are relative to the store's root and cannot leave it. Stores are read-only unless "write": true,
// and writes never overwrite unless asked to.
const fs = require('fs');
const path = require('path');

const MAX_READ = 5 * 1024 * 1024;
const MAX_SEARCH_FILE = 512 * 1024;

function store(name) {
  const all = require('./config').getFiles();
  const s = all[name];
  if (!s) throw new Error(`no file store "${name}"; stores: ${Object.keys(all).join(', ') || 'none (files in config.json)'}`);
  if (!['local', 'sftp'].includes(s.type)) throw new Error(`store ${name}: type must be "local" or "sftp"`);
  return s;
}

// "a/b/../c" inside the root; never above it
function rel(p) {
  const segs = [];
  for (const seg of String(p || '').replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!segs.length) throw new Error(`path ${p} leaves the store`); segs.pop(); } else segs.push(seg);
  }
  return segs.join('/');
}

const glob = (g) => new RegExp(`^${String(g).split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.')).join('.*')}$`, 'i');

// ── backends: each has list(dir) -> [{name, dir, size, mtime}], read(p) -> Buffer, write(p, buf, {overwrite}), mkdir(p), exists(p), close() ──
function local(s) {
  const root = path.resolve(require('./config').HOME, s.path || s.root || '.');
  const abs = (p) => path.join(root, rel(p));
  return {
    async list(dir) {
      const d = abs(dir);
      return fs.readdirSync(d, { withFileTypes: true }).map(e => {
        const st = fs.statSync(path.join(d, e.name));
        return { name: e.name, dir: e.isDirectory(), size: e.isDirectory() ? null : st.size, mtime: st.mtime.toISOString() };
      });
    },
    async read(p) {
      const st = fs.statSync(abs(p));
      if (st.isDirectory()) throw new Error(`${p} is a directory`);
      if (st.size > MAX_READ) throw new Error(`${p} is ${st.size} bytes (max ${MAX_READ})`);
      return fs.readFileSync(abs(p));
    },
    async write(p, buf, { overwrite = false } = {}) {
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
      fs.writeFileSync(abs(p), buf, { flag: overwrite ? 'w' : 'wx' });
    },
    async mkdir(p) { fs.mkdirSync(abs(p), { recursive: true }); },
    async exists(p) { return fs.existsSync(abs(p)); },
    async close() {},
    root,
  };
}

async function sftp(s) {
  const { Client } = require('ssh2');
  const conn = new Client();
  const root = path.posix.normalize(s.root || '/');
  const abs = (p) => path.posix.join(root, rel(p));
  const sf = await new Promise((resolve, reject) => {
    const t = setTimeout(() => { conn.end(); reject(new Error(`sftp ${s.host}: timeout`)); }, s.timeoutMs || 20000);
    conn.on('ready', () => conn.sftp((err, x) => { clearTimeout(t); err ? reject(err) : resolve(x); }));
    conn.on('error', (e) => { clearTimeout(t); reject(new Error(`sftp ${s.host}: ${e.message}`)); });
    let privateKey = s.privateKey ? String(s.privateKey).replace(/\\n/g, '\n') : undefined; // one-line keys in .env use \n
    if (s.privateKeyFile) {
      const f = path.resolve(require('./config').HOME, s.privateKeyFile);
      try { privateKey = fs.readFileSync(f); } catch (e) { clearTimeout(t); return reject(new Error(`sftp ${s.host}: privateKeyFile ${s.privateKeyFile}: ${e.code || e.message}`)); }
    }
    conn.connect({ host: s.host, port: Number(s.port || 22), username: s.user || s.username, password: s.password || undefined, privateKey, passphrase: s.passphrase || undefined, readyTimeout: s.timeoutMs || 20000, ...(s.hostKey ? { hostVerifier: (key) => require('crypto').createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === String(s.hostKey).replace(/^SHA256:/, '').replace(/=+$/, '') } : {}) });
  });
  const call = (fn, ...a) => new Promise((resolve, reject) => sf[fn](...a, (err, r) => (err ? reject(new Error(`${fn} ${a[0]}: ${err.message}`)) : resolve(r))));
  const exists = async (p) => { try { await call('stat', abs(p)); return true; } catch { return false; } };
  const mkdirp = async (p) => {
    let cur = root;
    for (const seg of rel(p).split('/').filter(Boolean)) {
      cur = path.posix.join(cur, seg);
      try { await call('stat', cur); } catch { await call('mkdir', cur); }
    }
  };
  return {
    async list(dir) {
      return (await call('readdir', abs(dir))).map(e => ({ name: e.filename, dir: (e.attrs.mode & 0o170000) === 0o040000, size: (e.attrs.mode & 0o170000) === 0o040000 ? null : e.attrs.size, mtime: new Date(e.attrs.mtime * 1000).toISOString() }));
    },
    async read(p) {
      const st = await call('stat', abs(p));
      if (st.size > MAX_READ) throw new Error(`${p} is ${st.size} bytes (max ${MAX_READ})`);
      return new Promise((resolve, reject) => {
        const chunks = [];
        sf.createReadStream(abs(p)).on('data', c => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', e => reject(new Error(`read ${p}: ${e.message}`)));
      });
    },
    async write(p, buf, { overwrite = false } = {}) {
      if (!overwrite && await exists(p)) throw new Error(`${p} already exists (pass overwrite)`);
      await mkdirp(path.posix.dirname(rel(p)));
      await new Promise((resolve, reject) => {
        const w = sf.createWriteStream(abs(p));
        w.on('close', resolve).on('error', e => reject(new Error(`write ${p}: ${e.message}`)));
        w.end(buf);
      });
    },
    mkdir: mkdirp,
    exists,
    async close() { conn.end(); },
    root,
  };
}

async function open(name) {
  const s = store(name);
  await require('./limit').take(`files:${name}`);
  return { s, b: s.type === 'sftp' ? await sftp(s) : local(s) };
}

async function withStore(name, fn) {
  const { s, b } = await open(name);
  try { return await fn(b, s); } finally { await b.close(); }
}

const mustWrite = (s) => { if (!s.write) throw new Error(`store ${s.name} is read-only: set "write": true on it in config.json`); };

function stores() {
  return Object.values(require('./config').getFiles()).map(s => ({ store: s.name, type: s.type, where: s.type === 'sftp' ? `sftp://${s.user || s.username || ''}@${s.host}:${s.port || 22}${s.root || '/'}` : s.path || s.root || '.', write: s.write }));
}

async function list(name, dir = '', { recursive = false, pattern, limit = 500 } = {}) {
  return withStore(name, async (b) => {
    const out = [];
    const re = pattern ? glob(pattern) : null;
    const walk = async (d, depth) => {
      for (const e of (await b.list(d)).sort((x, y) => x.name.localeCompare(y.name))) {
        if (out.length >= limit) return;
        const p = d ? `${d}/${e.name}` : e.name;
        if (!re || re.test(e.name)) out.push({ path: p, dir: e.dir, size: e.size, mtime: e.mtime });
        if (e.dir && recursive && depth < 12) await walk(p, depth + 1);
      }
    };
    await walk(rel(dir), 0);
    return out;
  });
}

// names matching a glob and/or files containing a text (small text files only)
async function search(name, { dir = '', pattern, text, limit = 100 } = {}) {
  const files = (await list(name, dir, { recursive: true, limit: 5000 })).filter(f => !f.dir && (!pattern || glob(pattern).test(path.posix.basename(f.path))));
  if (!text) return files.slice(0, limit);
  const needle = String(text).toLowerCase();
  return withStore(name, async (b) => {
    const out = [];
    for (const f of files) {
      if (out.length >= limit) break;
      if (f.size > MAX_SEARCH_FILE) continue;
      const body = (await b.read(f.path)).toString('utf8');
      if (body.includes('\u0000')) continue; // binary
      const i = body.toLowerCase().indexOf(needle);
      if (i < 0) continue;
      const line = body.slice(0, i).split('\n').length;
      out.push({ ...f, line, match: body.slice(Math.max(0, i - 60), i + needle.length + 60).replace(/\s+/g, ' ') });
    }
    return out;
  });
}

async function read(name, p, { encoding = 'utf8' } = {}) {
  return withStore(name, async (b) => {
    const buf = await b.read(rel(p));
    const binary = encoding !== 'base64' && buf.includes(0);
    return { store: name, path: rel(p), size: buf.length, ...(encoding === 'base64' || binary ? { base64: buf.toString('base64') } : { text: buf.toString('utf8') }) };
  });
}

async function write(name, p, content, { base64 = false, overwrite = false } = {}) {
  return withStore(name, async (b, s) => {
    mustWrite(s);
    const buf = base64 ? Buffer.from(String(content), 'base64') : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    await b.write(rel(p), buf, { overwrite });
    return { store: name, path: rel(p), size: buf.length, written: true };
  });
}

async function mkdir(name, p) {
  return withStore(name, async (b, s) => { mustWrite(s); await b.mkdir(rel(p)); return { store: name, path: rel(p), created: true }; });
}

async function copy(from, fromPath, to, toPath, { overwrite = false } = {}) {
  const src = await read(from, fromPath, { encoding: 'base64' });
  return { from: `${from}:${src.path}`, ...(await write(to, toPath, src.base64, { base64: true, overwrite })) };
}

module.exports = { stores, list, search, read, write, mkdir, copy, rel, glob };
