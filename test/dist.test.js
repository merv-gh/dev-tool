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
