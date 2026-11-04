// Exercise the actual upgrade command without requiring Docker or printing secrets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(t, contents = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-launcher-')), home = path.join(root, 'home with spaces'), bin = path.join(root, 'bin'), code = path.join(root, 'code');
  fs.mkdirSync(home); fs.mkdirSync(bin);
  fs.mkdirSync(path.join(code, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../run.sh'), path.join(code, 'run.sh'));
  fs.writeFileSync(path.join(code, 'dist/dt.js'), 'bundle-v1');
  fs.writeFileSync(path.join(code, 'dist/view.html'), 'view-v1');
  fs.writeFileSync(path.join(home, 'config.json'), '{"envs":{"dev":{}}}');
  fs.writeFileSync(path.join(home, '.env'), contents);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
if [ "$1" = info ]; then exit 1; fi
printf '%s\\n' "$COMPOSE_PROFILES" > "$CAPTURE.profiles"
printf '%s\\n' "$DT_SEMANTIC_URL" > "$CAPTURE.url"
printf '%s\\n' "$DT_BUNDLE_REVISION" > "$CAPTURE.revision"
printf '%s\\n' "$@" > "$CAPTURE.args"
`, { mode: 0o755 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { home, code, run(args = ['up', '-d'], extra = {}) {
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CAPTURE: path.join(root, 'capture'), DT_DOCKER_GID: '0' };
    for (const key of ['COMPOSE_PROFILES', 'DT_HOME', 'DT_SEMANTIC_ENABLED', 'DT_SEMANTIC_URL', 'DT_SEMANTIC_TOKEN']) delete env[key];
    const result = spawnSync('sh', [path.join(code, 'run.sh'), '--home', home, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const read = name => fs.readFileSync(path.join(root, 'capture.' + name), 'utf8').trim();
    return { profiles: read('profiles'), url: read('url'), revision: read('revision'), args: read('args').split('\n'), secrets: fs.readFileSync(path.join(home, '.env'), 'utf8') };
  } };
}

test('git pull + run.sh up -d upgrades old profiles and keeps generated tokens stable', t => {
  const f = fixture(t, 'COMPOSE_PROFILES=webui,browser,graph,jdk,testdb\n');
  const first = f.run();
  assert.equal(first.profiles, 'webui,browser,graph,jdk,testdb,semantic');
  assert.equal(first.url, 'http://semantic:4110');
  assert.match(first.revision, /^\d+-\d+$/);
  assert.deepEqual(first.args.slice(-3), ['up', '--build', '-d']);
  assert.match(first.secrets, /^DT_SEMANTIC_TOKEN=[0-9a-f]{64}$/m);
  assert.equal(f.run().secrets, first.secrets);
  assert.match(first.secrets, /^COMPOSE_PROFILES=webui,browser,graph,jdk,testdb$/m);
  assert.equal(f.run().revision, first.revision);
  fs.writeFileSync(path.join(f.code, 'dist/view.html'), 'view-v2');
  const updated = f.run();
  assert.notEqual(updated.revision, first.revision, 'an asset-only update must recreate cached views');
  assert.equal(updated.secrets, first.secrets);
});

test('quoted legacy settings and an existing remote semantic endpoint are preserved', t => {
  const f = fixture(t, 'export COMPOSE_PROFILES="jdk,testdb,semantic" # chosen\nDT_SEMANTIC_URL=https://analysis.example.com\nDT_SEMANTIC_TOKEN=existing-token-long-enough\n');
  const r = f.run(['logs', '-f', 'dt']);
  assert.equal(r.profiles, 'jdk,testdb,semantic');
  assert.equal(r.url, ''); // left to Compose's --env-file, not overwritten by run.sh
  assert.equal((r.secrets.match(/^DT_SEMANTIC_TOKEN=/gm) || []).length, 1);
  assert.deepEqual(r.args.slice(-3), ['logs', '-f', 'dt']);
});

test('tools-only, empty profiles and semantic opt-out never enable the worker', t => {
  for (const [contents, args, extra, profiles] of [
    ['COMPOSE_PROFILES=webui,semantic\n', ['--tools-only','up','-d'], {}, ''],
    ['COMPOSE_PROFILES=\n', ['up','-d'], {}, ''],
    ['COMPOSE_PROFILES=webui,semantic\nDT_SEMANTIC_ENABLED=0\n', ['up','-d'], {}, 'webui'],
    ['COMPOSE_PROFILES=webui,semantic\n', ['--no-semantic','up','-d'], {}, 'webui'],
    ['', ['up','-d'], { COMPOSE_PROFILES: '' }, ''],
  ]) {
    const r = fixture(t, contents).run(args, extra);
    assert.equal(r.profiles, profiles);
    assert.doesNotMatch(r.secrets, /^DT_SEMANTIC_TOKEN=/m);
  }
});

test('new install gets every profile, explicit env wins, and no-build is respected', t => {
  const r = fixture(t).run(['up','--no-build','-d'], { COMPOSE_PROFILES: 'jdk', DT_SEMANTIC_TOKEN: 'external-token-long-enough', DT_SEMANTIC_URL: 'https://worker.example.com' });
  assert.equal(r.profiles, 'jdk,semantic'); assert.equal(r.url, 'https://worker.example.com');
  assert.doesNotMatch(r.secrets, /^DT_SEMANTIC_TOKEN=/m);
  assert.deepEqual(r.args.slice(-3), ['up','--no-build','-d']);
  assert.equal(fixture(t).run().profiles, 'webui,browser,graph,jdk,testdb,semantic');
});
