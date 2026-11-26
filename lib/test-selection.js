const fs = require('node:fs');
const path = require('node:path');
const invalid = (message, extra = {}) => Object.assign(new Error(message), { code: 'DT_ARGUMENT_INVALID', ...extra });
const diffAliases = new Set(['-diff', '--diff', 'diff', 'changed']);
function normalize(input) {
  const a = { ...input };
  if (a.job) {
    if (Object.keys(a).some(k => !['job', 'workspace', 'all'].includes(k))) throw invalid('Poll with job only (optional workspace and all); start options cannot accompany a job');
    const job = require('./jobs').get(a.job);
    if (!job || !job.key.startsWith('tests:')) throw Object.assign(new Error('Test job not found in this scope'), { code: 'DT_NOT_FOUND' });
    const workspace = job.key.split(':')[1];
    if (a.workspace && a.workspace !== workspace) throw invalid('test job belongs to a different workspace');
    return { ...a, workspace };
  }
  let scope = a.scope;
  const setScope = s => { if (scope && scope !== s) throw invalid('Conflicting test selection; use scope=all, scope=diff, or named tests'); scope = s; };
  if (a.diff === true || a['-diff'] === true) setScope('diff');
  for (const key of ['diff', '-diff']) { if (a[key] !== undefined && typeof a[key] !== 'boolean') throw invalid(`${key} must be boolean`); delete a[key]; }
  if (['all', ...diffAliases].includes(a.mode)) { setScope(a.mode === 'all' ? 'all' : 'diff'); a.mode = 'auto'; }
  if(typeof a.tests==='string' && a.tests.trim().startsWith('[') && a.tests.trim().endsWith(']')){
    try{a.tests=JSON.parse(a.tests);}catch{throw invalid('tests looks like a JSON array but is invalid; pass ["FooTest"] or a test name');}
  }
  if (typeof a.tests === 'string') a.tests = a.tests.split(',').map(t => t.trim());
  if (a.tests !== undefined && (!Array.isArray(a.tests) || a.tests.some(t => typeof t !== 'string' || !t.trim()))) throw invalid('tests must be a test name or array of nonempty names; omit for all, or use scope="diff"');
  if(a.tests)a.tests=a.tests.map(t=>t.trim());
  if (a.tests?.length === 1 && (diffAliases.has(a.tests[0]) || ['all', '*'].includes(a.tests[0]))) {
    setScope(diffAliases.has(a.tests[0]) ? 'diff' : 'all'); delete a.tests;
  }
  if (scope && a.tests?.length) throw invalid('Choose scope or named tests, not both');
  if (!a.tests?.length) { a.tests = []; scope ||= 'all'; }
  if (scope) a.scope = scope;
  if (!a.workspace) {
    const candidates = require('./workspace').list().filter(w => w.exists);
    if (candidates.length !== 1) throw invalid(candidates.length ? 'Multiple workspaces: choose workspace from candidates' : 'No workspace in this scope; open one with workspace_open or workspace_create', { code: candidates.length ? 'DT_WORKSPACE_AMBIGUOUS' : 'DT_WORKSPACE_REQUIRED', candidates });
    a.workspace = candidates[0].id;
  }
  return a;
}
// Explicit test files only: fixture trees, symlinks and generated/vendor trees are not suites.
function discover(root) {
  const node = [], jvm = [], modules = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.some(e => e.isFile() && ['pom.xml','build.gradle','build.gradle.kts'].includes(e.name))) modules.push(path.relative(root, dir) || '.');
    for (const e of entries) {
      const file = path.join(dir, e.name), rel = path.relative(root, file).split(path.sep).join('/');
      if (e.isDirectory()) { if (!/^(\..*|node_modules|target|build|out|dist|vendor|fixtures|__fixtures__|cache)$/.test(e.name)) walk(file); }
      else if (e.isFile()) {
        if (/\.(?:test|spec)\.[cm]?js$/.test(e.name)) node.push(rel);
        if (/(^|\/)src\/(test|it|integrationTest)\/.+\.(java|kt|groovy|scala)$/.test(rel)) jvm.push(rel);
      }
    }
  }
  walk(root);
  return { node: node.sort(), jvm: jvm.sort(), modules: modules.sort() };
}
async function verifyBase(root, base) {
  if (typeof base !== 'string' || !base || base.length > 512 || /^-|[\x00-\x20]/.test(base)) throw invalid('base must be a Git commit or ref');
  try { return await require('./git').git(['rev-parse','--verify',`${base}^{commit}`],root); }
  catch { throw invalid(`Cannot resolve diff base ${base}; pass base with a valid commit or ref`); }
}
async function select(root, metadata, { tests = [], scope, base } = {}) {
  if (tests.length) return { tests, selection: { scope: 'named', selected: tests.length, complete: true } };
  const found = discover(root), isJvm = found.modules.length > 0;
  if (isJvm && found.node.length) throw invalid('Workspace has JVM and Node suites; choose explicit tests to select an execution profile');
  if (!isJvm && !found.node.length) throw invalid('No supported test suite: use a Maven/Gradle project or Node .test/.spec.js/.cjs/.mjs files');
  const selection = { scope: scope || 'all', profile: isJvm ? 'jvm-build' : 'node:test', selected: isJvm ? null : found.node.length, ...(isJvm?{testSourceFiles:found.jvm.length}:{}), modules: found.modules, complete: true };
  if (scope === 'diff') {
    const pin = await verifyBase(root, base || metadata.sha || 'HEAD');
    const G = require('./git'), parts = await Promise.all([
      G.git(['diff','--name-only','--no-renames','-z',pin,'--'],root),
      G.git(['ls-files','--others','--exclude-standard','-z'],root),
    ]);
    const changed = [...new Set(parts.flatMap(x => x.split('\0').filter(Boolean)))];
    Object.assign(selection, { base: pin, changed: changed.length });
    const meaningful = changed.filter(f => !/^(docs\/|README(?:\.|$)|LICENSE(?:\.|$))/.test(f) && !/^\.dt\//.test(f));
    if (!meaningful.length) return { tests: [], noRun: true, selection: { ...selection, selected: 0 } };
    if (!isJvm && meaningful.every(f => found.node.includes(f))) {
      return { tests: meaningful, selection: { ...selection, selected: meaningful.length } };
    }
    // A changed source may have dynamic/transitive users and deleted edges. A complete
    // suite is the conservative affected-test set until a profile proves narrower coverage.
    selection.complete = false;
    selection.fallback = 'all';
    selection.reason = 'Dependency coverage is not proven complete; run the full supported suite for changed runtime/build inputs';
  }
  return { tests: isJvm ? [] : found.node, buildAll: isJvm, selection };
}
module.exports = { normalize, discover, verifyBase, select };
