// Local source editor and deliberately small command terminal. Ownership comes from access ALS,
// never a browser argument. No terminal input is passed to a shell.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const W = require('./workspace');
const MAX_FILE = 2 * 1024 * 1024, MAX_OUTPUT = 65536;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, code = 'DT_ARGUMENT_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

function filePath(id, value = '.', { root = false } = {}) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) throw fail('Use a relative workspace path without parent segments');
  if (value.split('/').some(s => ['.git', '.dt'].includes(s))) throw fail('Workspace runtime and Git internals are off limits');
  const meta = W.checkId(id);
  return { meta, ...W.resolvePath(meta, value, { allowRoot: root }) };
}

function policy() {
  const cfg = require('./config').load().raw.workspaceEditor || {};
  const tests = require('./config').getTests();
  return { readOnlyCommands: ['pwd', 'ls', 'git status', 'git diff', 'git diff --stat', 'git log', 'git branch'],
    buildCommands: ['gradle test', 'gradle build', 'gradle dependencies', 'mvn test', 'mvn verify'],
    buildsEnabled: cfg.terminalBuilds === true && require('./access').current().role === 'admin' && !!(tests.runnerUrl && tests.runnerToken), maxFileBytes: MAX_FILE, maxOutputBytes: MAX_OUTPUT };
}

function list() { return { workspaces: W.list(), policy: policy() }; }
function tree(id, rel = '.') {
  const { full, rel: name } = filePath(id, rel, { root: true });
  if (!fs.statSync(full).isDirectory()) throw fail('Choose a folder to list');
  const all = fs.readdirSync(full, { withFileTypes: true }).filter(e => !['.git', '.dt', 'node_modules', '.gradle', 'target', 'build'].includes(e.name));
  all.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return { workspace: id, path: name || '.', entries: all.slice(0, 1000).map(e => ({ name: e.name, path: [name, e.name].filter(Boolean).join('/'), kind: e.isSymbolicLink() ? 'blocked' : e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'blocked' })), truncated: all.length > 1000 };
}
function source(id, rel) {
  const { full, rel: name } = filePath(id, rel);
  const stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > MAX_FILE) throw fail(`Choose a text file smaller than ${MAX_FILE} bytes`, 'DT_EDITOR_FILE_LIMIT', 413);
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0)) throw fail('Binary files cannot be edited', 'DT_EDITOR_BINARY');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw fail('This file is not valid UTF-8; its bytes were preserved', 'DT_EDITOR_ENCODING'); }
  return { workspace: id, path: name, content, revision: hash(bytes), bytes: bytes.length, eol: content.includes('\r\n') ? 'CRLF' : 'LF' };
}
function save(id, rel, content, expectedRevision) {
  require('./task-harness').assertWorkspaceWrite(id);
  const { full } = filePath(id, rel);
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE || content.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)) throw fail('Save valid UTF-8 text within the editor file limit');
  if (expectedRevision !== null && !/^[a-f0-9]{64}$/.test(expectedRevision || '')) throw fail('expected_revision is required; reload the file before saving');
  if (fs.existsSync(full)) source(id, rel); // never silently convert a binary/invalid source
  const written = W.write(id, rel, { content, expected_revision: expectedRevision });
  return { ...written, revision: hash(Buffer.from(content)), saved: true };
}

function command(id, input, allowBuild = false) {
  if (typeof input !== 'string' || input.length > 200 || /[\r\n\0]/.test(input)) throw fail('Choose one of the terminal commands');
  const value = input.trim().replace(/\s+/g, ' '), p = policy();
  const m = W.checkId(id);
  // No user-controlled options, paths, Git revisions, executable names, or environment variables.
  const git = { 'git status': ['status', '--short', '--branch', '--untracked-files=normal'], 'git diff': ['diff', '--no-ext-diff', '--no-textconv', '--no-color'], 'git diff --stat': ['diff', '--no-ext-diff', '--no-textconv', '--stat'], 'git log': ['log', '-10', '--oneline', '--no-decorate'], 'git branch': ['branch', '--show-current'] };
  if (p.readOnlyCommands.includes(value)) return { value, meta: m, kind: 'inspect', ...(git[value] ? { cmd: 'git', args: ['--no-pager', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...git[value]] } : {}) };
  if (!p.buildCommands.includes(value)) throw fail('Unsupported command. Use pwd, ls, git status, git diff, git diff --stat, git log, git branch, or an enabled build command');
  if (!allowBuild || !p.buildsEnabled) throw fail('Build commands require allow_build=true, an administrator, workspaceEditor.terminalBuilds=true, and a configured authenticated runner', 'DT_TERMINAL_BUILD_DISABLED', 403);
  const [tool, task] = value.split(' '), R = require('./testrun'), cfg = require('./config').getTests();
  const [cmd, args] = tool === 'gradle' ? R.gradleCmd(m.path, cfg) : R.mavenCmd(m.path, cfg);
  return { value, meta: m, kind: 'build', cmd, args: [...args, ...(tool === 'gradle' ? ['--console=plain', '--no-daemon', task] : ['-B', '-ntp', task])] };
}
const terminalKey = id => `editor-terminal:${id}:`;
function terminalJob(id, job) {
  W.checkId(id);
  const found = require('./jobs').get(job);
  if (!found || !found.key.startsWith(terminalKey(id))) throw fail('Terminal job not found in this workspace and task', 'DT_NOT_FOUND', 404);
  return found;
}
function bounded(text) {
  const clean = require('./redact').clean(String(text || '')), bytes = Buffer.from(clean);
  return { out: bytes.length > MAX_OUTPUT ? new TextDecoder().decode(bytes.subarray(bytes.length - MAX_OUTPUT)).replace(/^\uFFFD/, '') : clean, truncated: bytes.length > MAX_OUTPUT };
}
function run(id, input, allowBuild) {
  const spec = command(id, input, allowBuild);
  const job = require('./jobs').start(`${terminalKey(id)}${crypto.randomBytes(8).toString('hex')}`, spec.value, async log => {
    const release = W.hold(id);
    try {
      require('./execution').check();
      let result;
      if (spec.value === 'pwd') result = { code: 0, out: '.', runner: { placement: 'workspace-reader' } };
      else if (spec.value === 'ls') result = { code: 0, out: tree(id).entries.map(e => e.name + (e.kind === 'directory' ? '/' : '')).join('\n'), runner: { placement: 'workspace-reader' } };
      else if (spec.kind === 'inspect') result = await require('./testrun').execLocal(spec.cmd, spec.args, { cwd: spec.meta.path, timeoutMs: 15000, env: require('./utf8').environment({ PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }), log });
      else {
        const cfg = require('./config').getTests(), R = require('./testrun');
        const { env, hide } = await R.envFor({ tool: spec.value.startsWith('gradle') ? 'gradle' : 'maven' }, cfg);
        result = await require('./runner').exec(spec.cmd, spec.args, { cwd: spec.meta.path, env, timeoutMs: 120000, log: line => log(hide(line)) });
        result.out = hide(result.out);
        W.touch(id, { dirty: true });
      }
      return { workspace: id, command: spec.value, ...result, ...bounded(result.out), readOnly: spec.kind === 'inspect' };
    } finally { release(); }
  });
  return { workspace: id, job: job.id, state: job.state, executionId: job.executionId, command: spec.value };
}
function clearFile(id) { W.checkId(id); return path.join(require('./access').scopedDirectory(require('./util').CACHE), 'editor', `${id}.json`); }
function terminal(id, { action = 'read', command: input, job, allow_build = false } = {}) {
  if (action === 'run') return run(id, input, allow_build);
  if (action === 'clear') { require('./util').writeJson(clearFile(id), { clearedAt: Date.now() }); return { workspace: id, cleared: true, out: '' }; }
  const found = terminalJob(id, job);
  if (action === 'cancel') return require('./jobs').cancel(found.id, 'cancelled from workspace editor');
  if (action !== 'read') throw fail('Unknown terminal action');
  const cleared = require('./util').readJson(clearFile(id), {})?.clearedAt > Date.parse(found.startedAt);
  return { workspace: id, job: found.id, state: found.state, executionId: found.executionId, command: found.title, log: cleared ? [] : found.log.slice(-30), ...(cleared ? { out: '', cleared: true } : found.result || {}), ...(found.error ? { error: found.error } : {}) };
}
module.exports = { list, tree, read: source, save, terminal, policy, filePath, MAX_FILE, MAX_OUTPUT };
