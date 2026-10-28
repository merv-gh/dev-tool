#!/usr/bin/env node
// A small, dependency-free local test loop. npm test remains the complete check.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const posix = p => p.split(path.sep).join('/');
const testsIn = root => fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.js')).map(f => `test/${f}`).sort();

function localDependency(root, from, spec) {
  if (!spec.startsWith('.')) return null;
  const p = path.resolve(root, path.dirname(from), spec);
  if (p !== root && !p.startsWith(root + path.sep)) return null;
  for (const candidate of [p, p + '.js', path.join(p, 'index.js')]) {
    try { if (fs.statSync(candidate).isFile()) return posix(path.relative(root, candidate)); } catch {}
  }
  // Preserve deleted dependency edges, so deleting a module still selects its users.
  return posix(path.relative(root, path.extname(p) ? p : p + '.js'));
}

function dependencies(root, file, memo = new Map()) {
  if (memo.has(file)) return memo.get(file);
  const out = new Set([file]);
  memo.set(file, out);
  let source;
  try { source = fs.readFileSync(path.join(root, file), 'utf8'); } catch { return out; }
  for (const m of source.matchAll(/\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g)) {
    const dep = localDependency(root, file, m[2]);
    if (dep) for (const f of dependencies(root, dep, memo)) out.add(f);
  }
  // Child-process helpers are often passed as path.join(__dirname, 'helper.js')
  // rather than required. Literal joins are still reliable dependency edges.
  for (const m of source.matchAll(/path\.(?:join|resolve)\(\s*__dirname\s*,((?:\s*(['"])[^'"\n]+\2\s*,?)+)\)/g)) {
    const parts = [...m[1].matchAll(/(['"])([^'"\n]+)\1/g)].map(p => p[2]);
    if (!parts.at(-1)?.endsWith('.js')) continue;
    const dep = localDependency(root, file, './' + parts.join('/'));
    if (dep) for (const f of dependencies(root, dep, memo)) out.add(f);
  }
  return out;
}

function select(root, changed, { local = false, live = false } = {}) {
  const all = testsIn(root).filter(f => (!local || (!f.endsWith('.live.test.js') && f !== 'test/dist.test.js')) && (!live || f.endsWith('.live.test.js')));
  if (changed === null) return { tests: all, reasons: ['complete requested test group'] };
  const files = [...new Set(changed.map(f => posix(path.relative(root, path.resolve(root, f)))))];
  const chosen = new Set(), reasons = [];
  // Resolve each test independently: a shared recursive memo could lose edges in a cycle.
  const closures = new Map(all.map(f => [f, dependencies(root, f)]));
  for (const file of files) {
    if (/^(docs\/|README(?:\.|$)|LICENSE(?:\.|$))/.test(file)) { reasons.push(`${file}: documentation only`); continue; }
    if (file.endsWith('.test.js') && all.includes(file)) { chosen.add(file); reasons.push(`${file}: changed test`); continue; }
    if (file.endsWith('.live.test.js') && local) { reasons.push(`${file}: outside local test group`); continue; }
    // Runtime assets, build files, fixture trees and configuration can be opened dynamically
    // or passed to child processes. Their dependency graph is not a CommonJS require graph.
    if (!file.endsWith('.js') || !/^(lib\/|test\/[^/]+\.js$)/.test(file)) {
      all.forEach(f => chosen.add(f)); reasons.push(`${file}: runtime/build input; select entire group`); continue;
    }
    const affected = all.filter(f => closures.get(f).has(file));
    if (!affected.length) { all.forEach(f => chosen.add(f)); reasons.push(`${file}: no static dependency coverage; select entire group`); }
    else { affected.forEach(f => chosen.add(f)); reasons.push(`${file}: ${affected.length} dependent test files`); }
  }
  return { tests: all.filter(f => chosen.has(f)), reasons };
}

function gitChanges(root, base = 'HEAD') {
  const run = args => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'git failed');
    return r.stdout.split('\0').filter(Boolean);
  };
  // diff against base includes staged and unstaged edits; untracked tests matter as well.
  return [...run(['diff', '--name-only', '-z', base, '--']), ...run(['ls-files', '--others', '--exclude-standard', '-z'])];
}

function main(argv = process.argv.slice(2), root = ROOT) {
  let local = false, live = false, changed = false, list = false, base = 'HEAD';
  const files = [], nodeArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') local = true;
    else if (a === '--live') live = true;
    else if (a === '--changed') changed = true;
    else if (a === '--list') list = true;
    else if (a === '--watch') nodeArgs.push('--watch');
    else if (a === '--base' || a === '--files' || a === '--name' || a === '--concurrency') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${a} requires a value`);
      if (a === '--base') { base = value; changed = true; }
      else if (a === '--files') files.push(...value.split(',').filter(Boolean));
      else if (a === '--name') nodeArgs.push('--test-name-pattern', value);
      else if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error('--concurrency must be a positive integer');
      else nodeArgs.push('--test-concurrency', value);
    } else if (a === '--') { nodeArgs.push(...argv.slice(i + 1)); break; }
    else if (a === '--help') {
      process.stdout.write('node dev/test.js [--local | --live] [--changed [--base REF] | --files path,path] [--list] [--name pattern] [--watch] [--concurrency N] [-- NODE_TEST_FLAGS]\n');
      return 0;
    } else throw new Error(`unknown test option ${a}`);
  }
  if (local && live) throw new Error('--local and --live are mutually exclusive');
  const touched = changed ? [...gitChanges(root, base), ...files] : files.length ? files : null;
  const result = select(root, touched, { local, live });
  if (list) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0; }
  process.stderr.write(`test selection: ${result.tests.length} files\n${result.reasons.map(r => `  ${r}`).join('\n')}\n`);
  if (!result.tests.length) return 0; // never invoke node --test with no files: it discovers everything
  const r = spawnSync(process.execPath, ['--test', ...nodeArgs, ...result.tests], { cwd: root, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

module.exports = { dependencies, select, gitChanges, main };
if (require.main === module) {
  try { process.exitCode = main(); } catch (e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
}
