// Reviewed built-in node:test profile: explicit files, no request-provided executable or shell flags.
const fs = require('fs');
const path = require('path');
function find(root, selector) {
  if (typeof selector !== 'string' || selector.startsWith('-') || !/\.(?:[cm]?js)$/.test(selector) || selector.includes('#')) return null;
  const full = path.resolve(root, selector);
  if (!full.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  const real = fs.realpathSync(full), base = fs.realpathSync(root);
  if (!real.startsWith(base + path.sep)) throw new Error(`Node test escapes workspace: ${selector}`);
  return { file: path.relative(root, full), fqn: path.relative(root, full).split(path.sep).join('/') };
}
function command(root, files, cfg, runId) {
  const dir = path.join(root, '.dt', 'node-reports'); fs.mkdirSync(dir, { recursive: true });
  const report = path.join(dir, `TEST-${runId}.xml`);
  return { cmd: cfg.node || process.execPath, args: ['--test', '--test-reporter=junit', `--test-reporter-destination=${report}`, ...files.map(f => path.resolve(root, f))], cwd: root, report };
}
function parse(report, root) {
  const cases = require('./testrun').parseReports([path.dirname(report)], 0, [path.basename(report)]);
  const realRoot = fs.realpathSync(root);
  return cases.filter(c => {
    // Node creates a successful file-wrapper testcase even if the file registered no tests.
    const synthetic = c.file && path.isAbsolute(c.name) && path.resolve(c.name) === path.resolve(c.file);
    if (synthetic && c.status === 'passed') return false;
    if (c.file) { const p = path.resolve(c.file); c.class = path.relative(p.startsWith(realRoot + path.sep) ? realRoot : root, p).split(path.sep).join('/'); }
    c.class ||= 'node:test';
    return true;
  });
}
module.exports = { find, command, parse };
