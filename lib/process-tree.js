// A build owns its process group. Trace cancellation and deadlines terminate descendants too.
const { spawn } = require('child_process');
function spawnTree(cmd, args, options = {}) {
  const p = spawn(cmd, args, { ...options, detached: process.platform !== 'win32' });
  const directKill = p.kill.bind(p);
  p.kill = (signal = 'SIGTERM') => {
    if (!p.pid) return false;
    if (process.platform === 'win32') { require('child_process').spawn('taskkill', ['/pid', String(p.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore' }); return true; }
    try { process.kill(-p.pid, signal); return true; } catch (e) { if (e.code === 'ESRCH') return false; return directKill(signal); }
  };
  return p;
}
function stop(p, graceMs = 1000) {
  p.kill('SIGTERM');
  const t = setTimeout(() => p.kill('SIGKILL'), graceMs); t.unref();
}
module.exports = { spawnTree, stop };
