// Synthetic commit-index benchmark; never reads a configured environment.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-index-bench-'));
process.env.DT_HOME = home;
for (const key of ['DT_CACHE_DIR', 'DT_CONFIG_DIR', 'DT_PASSPORTS_DIR']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { test: {} } }));
const CI = require('../lib/codeindex'), root = path.join(home, 'repo');
fs.mkdirSync(root);
for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(root, `Part${i}.java`), `package demo;\nclass Part${i} {\n${Array.from({ length: 20 }, (_, j) => ` int method${j}() { return ${j}; }`).join('\n')}\n}`);
const meta = sha => ({ project: 'DEMO', repo: 'service', ref: 'main', sha: sha.repeat(40) });
const measure = fn => { const start = performance.now(), result = fn(); return { ms: Math.round((performance.now() - start) * 100) / 100, reused: result.reused, key: result.revisionKey }; };
try {
  const cold = measure(() => CI.build(root, 'DEMO/service', meta('a')));
  const warm = measure(() => CI.build(root, 'DEMO/service', meta('a')));
  const file = path.join(root, 'Part0.java'), before = fs.readFileSync(file);
  fs.writeFileSync(file, before.toString().replace('return 0;', 'return 42;'));
  const changed = measure(() => CI.build(root, 'DEMO/service', meta('b')));
  fs.writeFileSync(file, before);
  const back = measure(() => CI.build(root, 'DEMO/service', meta('a')));
  assert.equal(warm.reused, true); assert.equal(back.reused, true); assert.equal(back.key, cold.key);
  assert.match(CI.read(changed.key, 'Part0.java').text, /return 42/);
  console.log(JSON.stringify({ classes: 300, methods: 6000, cold, warm, changed, back, retainedRevisions: CI.list({ versions: true }).filter(i => i.immutable).length }, null, 2));
} finally { fs.rmSync(home, { recursive: true, force: true }); }
