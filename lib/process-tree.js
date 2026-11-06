// A build owns its process group. Trace cancellation and deadlines terminate descendants too.
const { spawn } = require('child_process');
function spawnTree(cmd, args, options = {}) {
  const p = spawn(cmd, args, { ...options, env: require('./utf8').environment(options.env), detached: process.platform !== 'win32' });
  const directKill = p.kill.bind(p);
  p.kill = (signal = 'SIGTERM') => {
    if (!p.pid) return false;
    if (process.platform === 'win32') { require('child_process').spawn('taskkill', ['/pid', String(p.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore' }); return true; }
    try { process.kill(-p.pid, signal); return true; } catch (e) { if (e.code === 'ESRCH') return false; return directKill(signal); }
  };
  return p;
}
function stop(p, graceMs = 1000) {
  const lifecycle = require('./state-machine').create(require('./lifecycles').process);
  lifecycle.to('terminating');
  try { p.kill('SIGTERM'); } catch {}
  // Completion includes escalation, even when the leader exits before a descendant.
  return new Promise(resolve => {
    let poll;
    const done = () => { lifecycle.to('exited'); clearTimeout(timer); clearInterval(poll); resolve(); };
    const timer = setTimeout(() => { lifecycle.to('killing'); try { p.kill('SIGKILL'); } catch {} done(); }, graceMs); timer.unref();
    if (p.pid && process.platform !== 'win32') { poll = setInterval(() => { try { process.kill(-p.pid, 0); } catch (e) { if (e.code === 'ESRCH') done(); } }, 20); poll.unref(); }
  });
}
module.exports = { spawnTree, stop };
