const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { define, create } = require('./state-machine');
const model = define('IO.atomic-file', 'new', { new: ['staging', 'aborted'], staging: ['installed', 'aborted'], installed: [], aborted: [] }, ['installed', 'aborted']);
// Shared by context, scripts, registry markers and revision/head publication.
// Installed means the rename happened; it does not claim fsync durability.
function atomicFile(file, bytes, { mode } = {}) {
  const lifecycle = create(model), temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', ...(mode === undefined ? {} : { mode }) }); lifecycle.to('staging');
    fs.renameSync(temporary, file); lifecycle.to('installed');
  } catch (error) { if (!lifecycle.terminal) lifecycle.to('aborted'); throw error; }
  finally { fs.rmSync(temporary, { force: true }); }
}
module.exports = { atomicFile, model };
