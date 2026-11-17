// Small durable JSON store shared by private workflows and explicit continuations.
// Locks protect both cross-process edits and runners. A dead writer is recoverable;
// a live writer is never displaced merely because its lock is old.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const invalid = (message, code = 'DT_ARGUMENT_INVALID', statusCode = 400) => Object.assign(Error(message), { code, statusCode });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value) || value === '..') throw invalid('Invalid durable record id'); return value; };
function create(root, maxBytes = 8 * 1048576) {
  function safe(...parts) {
    // The configured home is the trusted boundary; reject links introduced in
    // any feature/principal/story directory below it, not only the final file.
    const home = require('./config').HOME;
    const relative = path.relative(home, root);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw invalid('Durable store must be inside the configured home');
    let ancestor = home;
    for (const part of relative.split(path.sep).filter(Boolean)) { ancestor = path.join(ancestor, part); try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw invalid('Durable state paths cannot be symbolic links'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    let file = root;
    for (const part of [null, ...parts]) {
      if (part !== null) file = path.join(file, key(part));
      try { if (fs.lstatSync(file).isSymbolicLink()) throw invalid('Durable state paths cannot be symbolic links'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return file;
  }
  function read(name) {
    const file = safe(name + '.json');
    try { if (fs.statSync(file).size > maxBytes) throw invalid('Durable record exceeds storage budget'); return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  function write(name, value) {
    const data = JSON.stringify(value), file = safe(name + '.json');
    if (Buffer.byteLength(data) > maxBytes) throw invalid('Durable record exceeds storage budget');
    fs.mkdirSync(safe(), { recursive: true, mode: 0o700 });
    const temporary = safe('tmp-' + crypto.randomUUID()), fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, file); const dir = fs.openSync(safe(), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    finally { fs.rmSync(temporary, { force: true }); }
    return value;
  }
  function list(prefix = '') {
    let names; try { names = fs.readdirSync(safe()); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return names.filter(n => n.endsWith('.json') && n.startsWith(prefix)).sort().map(n => read(n.slice(0, -5))).filter(Boolean);
  }
  function lock(name) {
    fs.mkdirSync(safe(), { recursive: true, mode: 0o700 });
    // A filesystem bakery lock avoids deleting/replacing a shared lock pathname:
    // two stale-lock reapers must never accidentally remove each other's lock.
    // Each contender owns one unique directory. Its pid is visible atomically in
    // the mkdir name even if it crashes before publishing its chosen ticket.
    const prefix = key(name) + '.lock-', own = prefix + process.pid + '-' + crypto.randomUUID(), dir = path.join(safe(), own);
    fs.mkdirSync(dir, { mode: 0o700 });
    const release = () => fs.rmSync(dir, { recursive: true, force: true });
    function contenders() {
      return fs.readdirSync(safe()).filter(n => n.startsWith(prefix)).map(n => {
        const suffix = n.slice(prefix.length), match = suffix.match(/^(\d+)-[a-f0-9-]{36}$/);
        if (!match) throw invalid('Damaged durable writer lock', 'STATE_CONFLICT', 409);
        const candidate = path.join(safe(), n); let stat;
        try { stat = fs.lstatSync(candidate); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid('Invalid durable writer lock');
        try { process.kill(Number(match[1]), 0); } catch (e) { if (e.code === 'ESRCH') { fs.rmSync(candidate, { recursive: true, force: true }); return null; } }
        let ticket; try { const f = path.join(candidate, 'ticket.json'); if (fs.lstatSync(f).isSymbolicLink()) throw invalid('Invalid durable writer ticket'); ticket = JSON.parse(fs.readFileSync(f, 'utf8')).ticket; } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
        return { name: n, ticket: Number.isSafeInteger(ticket) && ticket > 0 ? ticket : null };
      }).filter(Boolean);
    }
    try {
      const ticket = Math.max(0, ...contenders().map(c => c.ticket || 0)) + 1;
      fs.writeFileSync(path.join(dir, 'ticket.json'), JSON.stringify({ ticket }), { mode: 0o600, flag: 'wx' });
      const blocked = contenders().some(c => c.name !== own && (c.ticket === null || c.ticket < ticket || c.ticket === ticket && c.name < own));
      if (blocked) throw invalid('Durable record is owned by a running writer; retry after it finishes', 'STATE_CONFLICT', 409);
      return release;
    } catch (error) { release(); throw error; }
  }
  function update(name, fn) { const release = lock(name); try { return fn(read(name)); } finally { release(); } }
  return { read, write, list, lock, update, root, safe };
}
module.exports = { create, key, hash, invalid };
