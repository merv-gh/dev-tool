// docker-compose runs dist/ (no image build), so dist/ must match the sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

let esbuild = true;
try { require.resolve('esbuild'); } catch { esbuild = false; }

test('dist/ is built from the current sources (npm run build)', { skip: !esbuild && 'esbuild not installed (npm install)' }, () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'build.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test('the bundle runs on its own', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'dist', 'dt.js'), 'help'], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
  assert.match(r.stdout + r.stderr, /dt sync/);
});

test('bundled differential checks spawn their shipped worker without source-tree dependencies', () => {
  const fs = require('fs'), os = require('os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bundle-diff-'));
  const put = (name, value) => { const f = path.join(home, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    put('config.json', { envs: { dev: {} }, tests: { differentialProfiles: { projection: { reviewed: true, kind: 'node-module', module: 'src/value.cjs' } } } });
    for (const id of ['before', 'after']) {
      put(`work/${id}/src/value.cjs`, 'module.exports=x=>({id:x,amount:"1.2300"})');
      put(`cache/work/${id}.json`, { id, path: path.join(home, 'work', id), project: 'BUNDLE', repo: id, sha: id, createdAt: new Date().toISOString() });
    }
    const r = spawnSync(process.execPath, [path.join(__dirname, '../dist/dt.js'), 'tool', 'differential_check', JSON.stringify({ profile: 'projection', baseline: 'before', candidate: 'after', inputs: [{ id: 'precision', args: ['9007199254740993'] }] })], { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, DT_HOME: home, DT_LOG: 'quiet', NODE_PATH: '' } });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.equal(JSON.parse(r.stdout).outcome, 'equivalent');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
