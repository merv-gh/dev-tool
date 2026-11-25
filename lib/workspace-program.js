// Reviewed source execution is deliberately separate from the JS sandbox.
// Only an opted-in authenticated runner executes it, never the dt server.
const crypto = require('node:crypto'), fs = require('node:fs');
function run({ workspace, path, runtime = 'node', args = [], allow_execute = false, timeout_ms = 300000 } = {}) {
  const A = require('./access'), C = require('./config');
  A.requireAdmin();
  const tests = C.getTests();
  if (!allow_execute || C.load().raw.workspaceEditor?.programs !== true || !tests.runnerUrl || !tests.runnerToken) throw Object.assign(new Error('Program execution requires allow_execute=true, workspaceEditor.programs=true and an authenticated runner'), { code: 'DT_PROGRAM_DISABLED', statusCode: 403 });
  if (!['node', 'python3', 'bash'].includes(runtime) || !Array.isArray(args) || args.length > 100 || args.some(a => typeof a !== 'string' || a.length > 8000 || a.includes('\0')) || !Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 3600000) throw new Error('Invalid program runtime, arguments or timeout');
  const { meta, full: file } = require('./workspace-editor').filePath(workspace, path);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2 * 1048576) throw new Error('Program entrypoint must be a file up to 2 MiB');
  require('./task-harness').assertWorkspaceWrite(workspace);
  const sourceRevision = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const job = require('./jobs').start('program:' + workspace + ':' + crypto.randomUUID(), 'Run project program', async log => {
    const W = require('./workspace'), release = W.hold(workspace);
    try {
      require('./execution').check();
      if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== sourceRevision) throw new Error('Entrypoint changed before execution; review its current revision');
      const { env, hide } = await require('./testrun').envFor({ tool: 'node' }, tests);
      const result = await require('./runner').exec(runtime, ['./' + path, ...args], { cwd: meta.path, env, timeoutMs: timeout_ms, log: text => log(hide(text)) });
      W.touch(workspace, { dirty: true });
      return { workspace, path, sourceRevision, ...result, out: hide(result.out || ''), ok: result.code === 0 && !result.runnerError && !result.killed, outcome: result.runnerError ? 'unknown' : result.killed ? 'cancelled' : result.code === 0 ? 'completed' : 'failed' };
    } finally { release(); }
  });
  return { workspace, path, sourceRevision, job: job.id, executionId: job.executionId, state: job.state };
}
module.exports = { run };
