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
const crypto = require('crypto');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

const MAX_READ = 5 * 1024 * 1024;
const MAX_SEARCH_FILE = 512 * 1024;

function store(name) {
  if (typeof name === 'string' && name.startsWith('context:')) { const id = name.slice(8); require('./context').get(id); return { name, type: 'context', id, write: true }; }
  const all = require('./config').getFiles();
  const s = all[name];
  if (!s) throw new Error(`no file store "${name}"; stores: ${Object.keys(all).join(', ') || 'none (files in config.json)'}`);
  if (!['local', 'sftp'].includes(s.type)) throw new Error(`store ${name}: type must be "local" or "sftp"`);
  const a=require('./access').current();if(a.scopeKey!=='legacy'){if(s.shared)return {...s,write:a.role==='admin'&&s.write===true};if(s.type==='local')return {...s,path:require('./access').scopedDirectory(path.resolve(require('./config').HOME,s.path||s.root||'.'))};return {...s,scopeBaseRoot:s.root||'/',root:path.posix.join(s.root||'/','_stories',a.scopeKey)};}
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
  const abs = (p) => {
    let current = root;
    for (const part of ['', ...rel(p).split('/')]) {
      current = path.join(current,part);
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('File store paths cannot contain symbolic links'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return current;
  };
  return {
    async archiveCheck(p) {
      const full = abs(p); let current = root;
      for (const part of ['', ...rel(p).split('/')]) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Archive source cannot contain symbolic links'); }
      if (!fs.statSync(full).isFile()) throw new Error('Archive one regular file at a time');
    },
    async rename(from, to) { fs.renameSync(abs(from), abs(to)); },
    async unlink(p) { fs.unlinkSync(abs(p)); },
    async restore(from, to) { fs.linkSync(abs(from), abs(to)); fs.unlinkSync(abs(from)); },
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
  const E = require('./execution'); E.check();
  const conn = new Client();
  const signal = E.signal();
  let rejectConnection, connectionClosed = false;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const stop = () => { rejectConnection?.(E.abortError(signal?.reason)); conn.destroy(); return closed; };
  const release = E.resource(stop);
  const onAbort = () => { stop(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  conn.once('close', () => { connectionClosed = true; signal?.removeEventListener('abort', onAbort); release(); resolveClosed(); });
  let root = path.posix.normalize(s.root || '/');
  const abs = (p) => path.posix.join(root, rel(p));
  let sf;
  try { sf = await new Promise((resolve, reject) => {
    const t = setTimeout(() => { conn.end(); reject(new Error(`sftp ${s.host}: timeout`)); }, s.timeoutMs || 20000);
    rejectConnection = error => { clearTimeout(t); reject(error); };
    conn.on('ready', () => conn.sftp((err, x) => { clearTimeout(t); err ? reject(err) : resolve(x); }));
    conn.on('error', (e) => { clearTimeout(t); reject(new Error(`sftp ${s.host}: ${e.message}`)); });
    let privateKey = s.privateKey ? String(s.privateKey).replace(/\\n/g, '\n') : undefined; // one-line keys in .env use \n
    if (s.privateKeyFile) {
      const f = path.resolve(require('./config').HOME, s.privateKeyFile);
      try { privateKey = fs.readFileSync(f); } catch (e) { clearTimeout(t); return reject(new Error(`sftp ${s.host}: privateKeyFile ${s.privateKeyFile}: ${e.code || e.message}`)); }
    }
    conn.connect({ host: s.host, port: Number(s.port || 22), username: s.user || s.username, password: s.password || undefined, privateKey, passphrase: s.passphrase || undefined, readyTimeout: s.timeoutMs || 20000, ...(s.hostKey ? { hostVerifier: (key) => require('crypto').createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === String(s.hostKey).replace(/^SHA256:/, '').replace(/=+$/, '') } : {}) });
  }); } catch (error) { signal?.removeEventListener('abort', onAbort); release(); conn.destroy(); throw error; }
  rejectConnection = null;
  const abortable = run => new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', aborted); fn(value); };
    const aborted = () => done(reject, E.abortError(signal.reason));
    if (signal?.aborted) return aborted();
    signal?.addEventListener('abort', aborted, { once: true });
    try { run(value => done(resolve, value), error => done(reject, error)); } catch (error) { done(reject, error); }
  });
  const call = (fn, ...a) => abortable((resolve, reject) => sf[fn](...a, (err, r) => (err ? reject(Object.assign(new Error(`${fn} ${a[0]}: ${err.message}`), { code: err.code })) : resolve(r))));
  const missing = error => error.code === 2 || error.code === 'ENOENT';
  const directory = st => (st.mode & 0o170000) === 0o040000;
  const noLink = st => { if ((st.mode & 0o170000) === 0o120000) throw new Error('SFTP paths cannot contain symbolic links'); return st; };
  let base;
  try {
    // Preserve relative SFTP roots by resolving them against the server's home,
    // rather than interpreting them against the dev-tool host filesystem.
    const home = path.posix.isAbsolute(root) && (!s.scopeBaseRoot || path.posix.isAbsolute(s.scopeBaseRoot)) ? '/' : await call('realpath', '.');
    root = path.posix.resolve(home, root);
    base = path.posix.resolve(home, s.scopeBaseRoot || root);
  } catch (error) { conn.end(); throw error; }
  async function checkedAbsolute(target, allowMissing = false) {
    let current = '/';
    for (const part of target.split('/').filter(Boolean)) {
      current = path.posix.join(current, part);
      try { noLink(await call('lstat', current)); }
      catch (error) { if (allowMissing && missing(error)) return target; throw error; }
    }
    return target;
  }
  const checked = (p, allowMissing = false) => checkedAbsolute(abs(p), allowMissing);
  const exists = async p => { try { await checked(p); return true; } catch (error) { if (missing(error)) return false; throw error; } };
  async function makeDirectory(target) {
    try { if (!directory(noLink(await call('lstat', target)))) throw new Error(`SFTP path is not a directory: ${target}`); }
    catch (error) {
      if (!missing(error)) throw error;
      try { await call('mkdir', target); }
      catch (mkdirError) {
        // Two chats can create the common _stories parent concurrently.
        // Accept only the exact directory; never an intervening symlink/file.
        const st = noLink(await call('lstat', target));
        if (!directory(st)) throw mkdirError;
      }
    }
  }
  async function scopedRoot() {
    await checkedAbsolute(base);
    if (!directory(await call('lstat', base))) throw new Error('SFTP store root is not a directory');
    let current = base;
    const suffix = path.posix.relative(base, root);
    if (suffix.startsWith('../') || path.posix.isAbsolute(suffix)) throw new Error('SFTP story root leaves the configured store');
    for (const part of suffix.split('/').filter(Boolean)) { current = path.posix.join(current, part); await makeDirectory(current); }
  }
  const mkdirp = async p => {
    await scopedRoot();
    await checked(p, true);
    let current = root;
    for (const part of rel(p).split('/').filter(Boolean)) { current = path.posix.join(current, part); await makeDirectory(current); }
  };
  return {
    async archiveCheck(p) {
      let current = '/';
      for (const part of abs(p).split('/').filter(Boolean)) { current = path.posix.join(current, part); const st = await call('lstat', current); if ((st.mode & 0o170000) === 0o120000) throw new Error('Archive source cannot contain symbolic links'); }
      const st = await call('lstat', abs(p));
      if ((st.mode & 0o170000) !== 0o100000) throw new Error('Archive one regular file at a time');
    },
    async rename(from, to) { await call('rename', await checked(from), await checked(to, true)); },
    async unlink(p) { await call('unlink', await checked(p)); },
    async restore(from, to) { await call('rename', await checked(from), await checked(to, true)); },
    async list(dir) {
      return (await call('readdir', await checked(dir))).filter(e => (e.attrs.mode & 0o170000) !== 0o120000).map(e => ({ name: e.filename, dir: (e.attrs.mode & 0o170000) === 0o040000, size: (e.attrs.mode & 0o170000) === 0o040000 ? null : e.attrs.size, mtime: new Date(e.attrs.mtime * 1000).toISOString() }));
    },
    async read(p) {
      const st = await call('lstat', await checked(p));
      if (st.size > MAX_READ) throw new Error(`${p} is ${st.size} bytes (max ${MAX_READ})`);
      return abortable((resolve, reject) => {
        const chunks = [];
        let ended = false;
        sf.createReadStream(abs(p)).on('data', c => chunks.push(c)).on('end', () => { ended = true; resolve(Buffer.concat(chunks)); }).on('close', () => { if (!ended) reject(new Error(`read ${p}: SFTP connection closed before completion`)); }).on('error', e => reject(new Error(`read ${p}: ${e.message}`)));
      });
    },
    async write(p, buf, { overwrite = false } = {}) {
      if (!overwrite && await exists(p)) throw new Error(`${p} already exists (pass overwrite)`);
      await mkdirp(path.posix.dirname(rel(p)));
      await checked(p, true);
      await abortable((resolve, reject) => {
        const w = sf.createWriteStream(abs(p));
        w.on('close', resolve).on('error', e => reject(new Error(`write ${p}: ${e.message}`)));
        w.end(buf);
      });
    },
    mkdir: mkdirp,
    exists,
    async close() { if (connectionClosed) return; const timer = setTimeout(() => conn.destroy(), 500); timer.unref(); conn.end(); try { await closed; } finally { clearTimeout(timer); } },
    root,
  };
}

function contextStore(s) {
  const C = require('./context');
  return {
    async archiveCheck(p) { C.read({ id: s.id, path: p, encoding: 'base64' }); },
    async remove(p, revision) { C.remove({ id: s.id, path: p, expected_revision: revision }); },
    async list(dir) { return C.directory({ id: s.id, dir }).map(f => ({ name: path.posix.basename(f.path), dir: f.dir, size: f.bytes, mtime: f.updatedAt })); },
    async read(p) { return Buffer.from(C.read({ id: s.id, path: p, encoding: 'base64' }).content, 'base64'); },
    async write(p, buf, { overwrite = false } = {}) { return C.write({ id: s.id, path: p, content: buf.toString('base64'), encoding: 'base64', ...(overwrite ? {} : { expected_revision: null }) }); },
    async mkdir(p) { return C.mkdir({ id: s.id, path: p }); },
    async close() {},
  };
}

async function open(name) {
  const s = store(name);
  await require('./limit').take(`files:${name}`);
  return { s, b: s.type === 'context' ? contextStore(s) : s.type === 'sftp' ? await sftp(s) : local(s) };
}

async function withStore(name, fn) {
  const { s, b } = await open(name);
  try { return await fn(b, s); } finally { await b.close(); }
}

const mustWrite = (s) => { if (!s.write) throw new Error(`store ${s.name} is read-only: set "write": true on it in config.json`); };

function stores() {
  return Object.values(require('./config').getFiles()).map(s => store(s.name)).map(s => ({ store: s.name, type: s.type, where: s.type === 'sftp' ? `sftp://${s.user || s.username || ''}@${s.host}:${s.port || 22}${s.root || '/'}` : s.path || s.root || '.', write: s.write }));
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
    return { store: name, path: rel(p), size: buf.length, revision: digest(buf), ...(encoding === 'base64' || binary ? { base64: buf.toString('base64') } : { text: buf.toString('utf8') }) };
  });
}

// For the file browser: text (up to 1 MB shown), images as data, other binaries as a hex head.
const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
async function preview(name, p) {
  return withStore(name, async (b) => {
    const buf = await b.read(rel(p));
    const ext = (p.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || '';
    if (IMG[ext] && buf.length <= 3e6) return { path: rel(p), size: buf.length, image: `data:${IMG[ext]};base64,${buf.toString('base64')}` };
    const binary = buf.subarray(0, 8000).includes(0);
    if (binary) return { path: rel(p), size: buf.length, binary: true, hex: buf.subarray(0, 512).toString('hex').match(/.{1,32}/g).join('\n') };
    const text = buf.toString('utf8');
    return { path: rel(p), size: buf.length, ext, text: text.slice(0, 1e6), clipped: text.length > 1e6 };
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

async function removeArchivedSource(b, p, revision) {
  if (b.remove) return b.remove(p, revision);
  const holding = path.posix.join(path.posix.dirname(p), '.dt-archive-' + crypto.randomUUID());
  await b.rename(p, holding);
  try {
    await b.archiveCheck(holding);
    if (digest(await b.read(holding)) !== revision) throw new Error('Source changed during archival; original retained');
    await b.unlink(holding);
  } catch (error) {
    try { await b.restore(holding, p); }
    catch (restore) { error.recoveryPath = holding; error.recoveryError = restore.message; }
    throw error;
  }
}

async function archive({ store: name, path: source, context, expected_revision, summary }) {
  if (!/^[a-f0-9]{64}$/.test(expected_revision || '')) throw new Error('expected_revision from files_read or context_read is required');
  const p = rel(source); if (!p) throw new Error('Choose one file to archive');
  const C = require('./context'); C.get(context);
  const target = 'archived/' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8) + '/' + p;
  return withStore(name, async (b, s) => {
    mustWrite(s); await b.archiveCheck(p);
    if (s.type === 'context' && s.id === context) {
      const saved = C.archive({ id: context, path: p, expected_revision, summary });
      return { archived: true, sourceRemoved: true, from: { store: name, path: p }, to: { store: name, path: saved.path }, revision: saved.revision, bytes: saved.bytes };
    }
    const data = await b.read(p), revision = digest(data);
    if (revision !== expected_revision) throw new Error('Source changed since the last read; read it again before archiving');
    const saved = C.write({ id: context, path: target, content: data.toString('base64'), encoding: 'base64', expected_revision: null, summary: [summary, `Archived from ${name}:${p}`].filter(Boolean).join(' — ').slice(0, 1000) });
    // Verify durable bytes before the source can be removed. A failed removal
    // leaves the archive and reports the retained source/recovery path explicitly.
    if (C.read({ id: context, path: target, encoding: 'base64' }).revision !== revision) throw new Error('Archive verification failed; source retained');
    const result = { archived: true, from: { store: name, path: p }, to: { store: 'context:' + context, path: target }, revision, bytes: saved.bytes };
    try { await removeArchivedSource(b, p, revision); return { ...result, sourceRemoved: true }; }
    catch (error) { return { ...result, sourceRemoved: false, error: error.message, ...(error.recoveryPath ? { sourceRecovery: { store: name, path: error.recoveryPath }, recoveryError: error.recoveryError } : {}), guidance: 'Archive is saved. Inspect the source or recovery path before retrying; do not delete either copy blindly.' }; }
  });
}

module.exports = { stores, list, search, read, write, mkdir, copy, archive, preview, rel, glob };
