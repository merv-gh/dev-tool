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
// Serialized into a fresh run-owned reporter file. Node 22 JUnit omits file identity, so the
// structured event stream is authoritative; console formatting cannot turn a run green.
async function* nodeReporter(source) {
  const display = v => typeof v === 'string' ? v.slice(0, 5000) : require('util').inspect(v, { depth: 5, maxArrayLength: 50, maxStringLength: 5000, customInspect: false });
  const error = (e, depth = 0) => e ? { name: e.name, message: String(e.message || '').slice(0, 16000), stack: String(e.stack || '').slice(0, 30000), code: e.code, failureType: e.failureType, ...(Object.hasOwn(e, 'expected') ? { expected: display(e.expected), actual: display(e.actual) } : {}), ...(depth < 3 && e.cause ? { cause: error(e.cause, depth + 1) } : {}) } : null;
  for await (const event of source) {
    if (!['test:pass', 'test:fail'].includes(event.type)) continue;
    const d = event.data;
    yield JSON.stringify({ type: event.type, data: { name: String(d.name).slice(0, 4096), file: d.file, line: d.line, nesting: d.nesting, testNumber: d.testNumber, skip: !!d.skip, todo: !!d.todo, details: { type: d.details?.type, duration_ms: d.details?.duration_ms, error: error(d.details?.error) } } }) + '\n';
  }
}
function command(root, files, cfg, runId) {
  const dir = path.join(root, '.dt', 'node-reports'); fs.mkdirSync(dir, { recursive: true });
  const report = path.join(dir, `TEST-${runId}.jsonl`), reporter = path.join(dir, `reporter-${runId}.cjs`);
  fs.writeFileSync(reporter, `module.exports = ${nodeReporter.toString()};\n`);
  return { cmd: cfg.node || process.execPath, args: ['--test', `--test-reporter=${reporter}`, `--test-reporter-destination=${report}`, ...files.map(f => path.resolve(root, f))], cwd: root, report };
}
function parse(report, root) {
  if (!fs.existsSync(report)) return [];
  if (fs.statSync(report).size > 4 * 1048576) throw new Error('Node test report exceeds 4 MiB');
  const events = fs.readFileSync(report, 'utf8').split('\n').filter(Boolean).map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`invalid Node test event JSON at line ${index + 1}`); } });
  const cases = [], pendingChildren = new Map(), realRoot = fs.realpathSync(root);
  for (const { type, data: d } of events) {
    if (!['test:pass', 'test:fail'].includes(type) || !d?.file || !Number.isInteger(d.nesting)) throw new Error('invalid Node test event');
    const levels = pendingChildren.get(d.file) || new Set();
    const parent = [...levels].some(n => n > d.nesting);
    for (const n of levels) if (n > d.nesting) levels.delete(n);
    levels.add(d.nesting); pendingChildren.set(d.file, levels);
    const failed = type === 'test:fail';
    const synthetic = path.isAbsolute(d.name) && path.resolve(d.name) === path.resolve(d.file);
    if (d.details?.type === 'suite' || (!failed && (synthetic || parent))) continue;
    const e = d.details?.error, cause = e?.cause || e;
    const filename = path.resolve(d.file), relative = path.relative(filename.startsWith(realRoot + path.sep) ? realRoot : root, filename).split(path.sep).join('/');
    cases.push({ class: relative, file: relative, name: d.name, ms: Math.round(d.details?.duration_ms || 0), status: failed ? 'failed' : d.skip || d.todo ? 'skipped' : 'passed', message: cause?.message || e?.message, type: cause?.name || e?.failureType, stack: cause?.stack || e?.stack, ...(cause?.expected !== undefined ? { expected: cause.expected, actual: cause.actual } : {}) });
  }
  return cases;
}
module.exports = { find, command, parse };
