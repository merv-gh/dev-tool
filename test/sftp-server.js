// A small SFTP server over a local folder, for tests (ssh2's server side). Password auth.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server, utils: { parseKey, sftp: { STATUS_CODE, OPEN_MODE } } } = require('ssh2');

// clientKey: a private key (PEM) whose public half may log in, besides the password
function start({ root, user = 'dt', password = 'pw', port = 0, clientKey }) {
  const hostKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } }).privateKey;
  const allowed = clientKey ? parseKey(clientKey) : null;
  const hostFingerprint = 'SHA256:' + crypto.createHash('sha256').update(parseKey(hostKey).getPublicSSH()).digest('base64').replace(/=+$/, '');
  const writes = [];
  const srv = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.username !== user) return ctx.reject();
      if (ctx.method === 'password' && ctx.password === password) return ctx.accept();
      if (ctx.method === 'publickey' && allowed && ctx.key.algo === allowed.type && ctx.key.data.equals(allowed.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept(); // the client asks whether this key would do
        if (allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
      }
      ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => client.on('session', (accept) => accept().on('sftp', (acc) => {
      const sf = acc();
      const handles = new Map();
      let next = 0;
      const abs = (p) => path.join(root, path.posix.normalize(`/${p}`));
      const attrs = (st) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
      const handle = (v) => { const h = Buffer.alloc(4); h.writeUInt32BE(next++); handles.set(h.toString('hex'), v); return h; };
      const get = (h) => handles.get(h.toString('hex'));
      const fail = (id, e) => sf.status(id, e && e.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE);
      sf.on('REALPATH', (id, p) => sf.name(id, [{ filename: path.posix.normalize(`/${p}`), longname: '', attrs: {} }]));
      for (const op of ['STAT', 'LSTAT']) sf.on(op, (id, p) => { try { sf.attrs(id, attrs(fs.statSync(abs(p)))); } catch (e) { fail(id, e); } });
      sf.on('FSTAT', (id, h) => { try { sf.attrs(id, attrs(fs.fstatSync(get(h).fd))); } catch (e) { fail(id, e); } });
      sf.on('OPENDIR', (id, p) => { try { const names = fs.readdirSync(abs(p)); sf.handle(id, handle({ dir: abs(p), names, done: false })); } catch (e) { fail(id, e); } });
      sf.on('READDIR', (id, h) => {
        const d = get(h);
        if (!d || d.done) return sf.status(id, STATUS_CODE.EOF);
        d.done = true;
        sf.name(id, d.names.map(n => ({ filename: n, longname: n, attrs: attrs(fs.statSync(path.join(d.dir, n))) })));
      });
      sf.on('OPEN', (id, p, flags) => {
        try {
          const w = flags & OPEN_MODE.WRITE;
          const fd = fs.openSync(abs(p), w ? ((flags & OPEN_MODE.EXCL) ? 'wx' : 'w') : 'r');
          if (w) writes.push(path.posix.normalize(`/${p}`));
          sf.handle(id, handle({ fd }));
        } catch (e) { fail(id, e); }
      });
      sf.on('READ', (id, h, offset, len) => {
        const f = get(h);
        const buf = Buffer.alloc(len);
        const n = fs.readSync(f.fd, buf, 0, len, offset);
        n ? sf.data(id, buf.subarray(0, n)) : sf.status(id, STATUS_CODE.EOF);
      });
      sf.on('WRITE', (id, h, offset, data) => { fs.writeSync(get(h).fd, data, 0, data.length, offset); sf.status(id, STATUS_CODE.OK); });
      sf.on('CLOSE', (id, h) => { const f = get(h); if (f && f.fd !== undefined) fs.closeSync(f.fd); handles.delete(h.toString('hex')); sf.status(id, STATUS_CODE.OK); });
      sf.on('MKDIR', (id, p) => { try { fs.mkdirSync(abs(p)); sf.status(id, STATUS_CODE.OK); } catch (e) { fail(id, e); } });
    })));
    client.on('error', () => {});
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ port: srv.address().port, close: () => srv.close(), writes, hostFingerprint })));
}

module.exports = { start };
