const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-editor-gradle-'));
process.env.DT_HOME = home;
process.env.DT_GIT_DIR = path.join(home, 'git');
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_LOG = 'quiet';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_TOOLS', 'DT_RUNNER_URL', 'DT_RUNNER_TOKEN']) delete process.env[key];
const cfg = raw => { fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, ...raw })); require('../lib/config').reload(); };
cfg({});
const G = require('../lib/git'), W = require('../lib/workspace'), E = require('../lib/workspace-editor'), I = require('../lib/gradle-inventory'), A = require('../lib/access'), J = require('../lib/jobs');
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Editor test', GIT_AUTHOR_EMAIL: 'editor@example.test', GIT_COMMITTER_NAME: 'Editor test', GIT_COMMITTER_EMAIL: 'editor@example.test' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe' }).toString().trim();
function repository(name, files) {
  const seed = path.join(home, 'seed', name); fs.mkdirSync(seed, { recursive: true }); git(seed, 'init', '-q', '-b', 'main');
  for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true }); fs.writeFileSync(path.join(seed, file), content); }
  git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'fixture');
  return { seed, spec: { project: 'TEST', repo: name, ref: 'main', url: `file://${seed}` }, sha: git(seed, 'rev-parse', 'HEAD') };
}
const fixture = {
  'settings.gradle.kts': 'rootProject.name = "payments"\ninclude(":api", ":core")\n',
  'gradle.properties': 'platformVersion=1.4.0\n',
  'build.gradle.kts': '// implementation("ignored:comment:0.0")\nplugins { id("java") version "1.0" }\nval jacksonVersion = "2.15.0"\ndependencies {\n  implementation("com.acme:platform:${platformVersion}")\n  implementation("com.fasterxml.jackson:jackson-core:$jacksonVersion")\n  implementation(libs.jackson.databind)\n  implementation(project(":core"))\n  implementation("org.unknown:managed")\n  implementation("org.unknown:dynamic:${pickVersion()}")\n}\n',
  'api/build.gradle': "dependencies {\n api group: 'com.acme', name: 'api', version: platformVersion\n implementation 'org.literal:leaf:1.2.3'\n}\n",
  'core/build.gradle.kts': 'dependencies {\n implementation(libs.jackson.databind)\n implementation("org.literal:leaf:1.2.3")\n}\n',
  'gradle/libs.versions.toml': '[versions]\njackson = "2.16.0"\n[libraries]\njackson-databind = { module = "com.fasterxml.jackson:jackson-databind", version.ref = "jackson" }\njackson-annotations = { module = "com.fasterxml.jackson:jackson-annotations", version.ref = "jackson" }\n',
  'README.md': '\uFEFFПривет, мир\r\nworkspace UTF-8\r\n',
  'gradlew': '#!/bin/sh\nprintf "runner-command:%s\\n" "$*"\n',
};
const payments = repository('payments', fixture), library = repository('library', { 'build.gradle': "dependencies { api 'org.literal:leaf:1.2.3' }\n", 'nested/build.gradle.kts': 'dependencies { implementation("org.demo:nested:0.7.0") }\n' });
let workspace, snapshot;
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('real checkout editor: full UTF-8/BOM/CRLF source, CAS, path and binary boundaries', async () => {
  workspace = await W.open(payments.spec);
  const file = E.read(workspace.id, 'README.md'); assert.equal(file.content, fixture['README.md']); assert.equal(file.eol, 'CRLF');
  const saved = E.save(workspace.id, 'README.md', file.content + 'Изменение\r\n', file.revision); assert.notEqual(saved.revision, file.revision);
  assert.throws(() => E.save(workspace.id, 'README.md', 'stale', file.revision), { code: 'DT_WORKSPACE_CONFLICT' });
  assert.throws(() => E.save(workspace.id, 'README.md', 'missing revision'), /expected_revision/);
  assert.throws(() => E.save(workspace.id, 'README.md', 'create over existing', null), { code: 'DT_WORKSPACE_CONFLICT' });
  assert.equal(E.save(workspace.id, 'new/новый.txt', 'новый', null).created, true);
  for (const name of ['../config.json', '/etc/passwd', 'C:/file', '.git/config', '.dt/token', 'src/../../config.json', 'a\\b']) assert.throws(() => E.read(workspace.id, name), /relative|off limits/);
  const root = W.checkId(workspace.id).path;
  fs.symlinkSync(home, path.join(root, 'outside')); assert.throws(() => E.read(workspace.id, 'outside/config.json'), /symlink/);
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 255, 10])); assert.throws(() => E.read(workspace.id, 'binary.bin'), { code: 'DT_EDITOR_BINARY' });
  fs.writeFileSync(path.join(root, 'bad.txt'), Buffer.from([255])); assert.throws(() => E.read(workspace.id, 'bad.txt'), { code: 'DT_EDITOR_ENCODING' });
  assert.ok(E.tree(workspace.id).entries.some(x => x.path === 'build.gradle.kts')); assert.ok(!E.tree(workspace.id).entries.some(x => x.name === '.git'));
  A.run({ principalId: 'other', storyId: 'task', multiUser: true }, () => { assert.equal(E.list().workspaces.length, 0); assert.throws(() => E.read(workspace.id, 'README.md'), /no workspace|available/); });
});

test('one job inventories every module of multiple Git repositories, with immutable SHA reuse', async () => {
  const calls = [], observedGit = { ...G, fetchRef: async (...args) => { calls.push(['fetch', args[1], args[2]]); return G.fetchRef(...args); }, git: async (...args) => { calls.push(['git', ...args[0]]); return G.git(...args); } };
  const result = await I.index({ repos: [payments.spec, library.spec], git: observedGit });
  assert.equal(result.counts.indexed, 2); assert.equal(result.counts.failed, 0);
  snapshot = I.load(result.repositories.find(r => r.repo === 'TEST/payments').revision);
  assert.equal(snapshot.sha, payments.sha); assert.equal(snapshot.files.length, 6); assert.deepEqual(snapshot.readStats, { treeProcesses: 1, batchProcesses: 1, blobs: 6 });
  assert.equal(calls.filter(c => c[1] === 'ls-tree').length, 2);
  const platform = snapshot.dependencies.find(d => d.coordinate === 'com.acme:platform'); assert.equal(platform.version, '1.4.0'); assert.equal(platform.owner.path, 'gradle.properties');
  const local = snapshot.dependencies.find(d => d.coordinate === 'com.fasterxml.jackson:jackson-core'); assert.equal(local.owner.key, 'jacksonVersion');
  const map = snapshot.dependencies.find(d => d.coordinate === 'com.acme:api'); assert.equal(map.owner.path, 'gradle.properties');
  const literal = snapshot.dependencies.find(d => d.coordinate === 'org.literal:leaf'); assert.equal(literal.owner.kind, 'literal');
  assert.ok(snapshot.dependencies.some(d => d.kind === 'project' && d.internal)); assert.ok(snapshot.dependencies.filter(d => d.group === 'org.unknown').every(d => d.state === 'unresolved'));
  assert.ok(!snapshot.dependencies.some(d => d.coordinate === 'ignored:comment'));
  const before = fs.readFileSync(path.join(home, 'cache', 'gradle', 'revisions', snapshot.revision + '.json'));
  const cached = await I.indexRepo({ ...payments.spec, ref: payments.sha }, { git: { fetchRef: () => { throw Error('must not fetch cached SHA'); } } });
  assert.equal(cached.reused, true); assert.deepEqual(fs.readFileSync(path.join(home, 'cache', 'gradle', 'revisions', snapshot.revision + '.json')), before);
  fs.writeFileSync(path.join(payments.seed, 'gradle.properties'), 'platformVersion=1.5.0\n'); git(payments.seed, 'add', '.'); git(payments.seed, 'commit', '-qm', 'new platform');
  const changed = await I.indexRepo(payments.spec); assert.notEqual(changed.revision, snapshot.revision); assert.equal(changed.dependencies.find(d => d.coordinate === 'com.acme:platform').version, '1.5.0'); assert.equal(I.load(snapshot.revision).dependencies.find(d => d.coordinate === 'com.acme:platform').version, '1.4.0');
});

test('upgrade preview identifies shared owners and applies guarded patches only to matching owned SHA', async () => {
  const p = I.plan({ revision: snapshot.revision, dependency: 'com.fasterxml.jackson:jackson-databind', version: '2.17.2' });
  assert.equal(p.applicable, true); assert.equal(p.changes.length, 1); assert.ok(p.changes[0].affected.some(d => d.coordinate === 'com.fasterxml.jackson:jackson-annotations')); assert.ok(p.changes[0].affected.some(d => d.path === 'core/build.gradle.kts'));
  assert.equal(E.read(workspace.id, 'gradle/libs.versions.toml').content, fixture['gradle/libs.versions.toml']);
  const applied = await I.apply({ plan: p.id, workspace: workspace.id }); assert.equal(applied.written.length, 1); assert.match(E.read(workspace.id, 'gradle/libs.versions.toml').content, /jackson = "2.17.2"/);
  await assert.rejects(I.apply({ plan: p.id, workspace: workspace.id }), { code: 'DT_WORKSPACE_CONFLICT' });
  const literal = I.plan({ revision: snapshot.revision, dependency: 'org.literal:leaf', version: '1.3.0' }); assert.equal(literal.changes.length, 2);
  const one = E.read(workspace.id, literal.files[1].path); E.save(workspace.id, one.path, one.content + '// concurrent change\n', one.revision);
  await assert.rejects(I.apply({ plan: literal.id, workspace: workspace.id }), { code: 'DT_WORKSPACE_CONFLICT' }); assert.match(E.read(workspace.id, literal.files[0].path).content, /1\.2\.3/);
  const unresolved = I.plan({ revision: snapshot.revision, dependency: 'org.unknown:dynamic', version: '3.0.0' }); assert.equal(unresolved.applicable, false); await assert.rejects(I.apply({ plan: unresolved.id, workspace: workspace.id }), /unresolved/);
  A.run({ principalId: 'someone', storyId: 'different', multiUser: true }, () => { assert.throws(() => I.load(snapshot.revision), /not found/); assert.throws(() => I.plan({ revision: snapshot.revision, dependency: 'org.literal:leaf', version: '2.0.0' }), /not found/); });
  const wrong = await W.open({ ...library.spec, fresh: true }); await assert.rejects(I.apply({ plan: literal.id, workspace: wrong.id }), /must match/);
});

test('static parser refuses computed, reassigned, rich and missing version ownership', () => {
  const parsed = I.parseFiles([{ path: 'build.gradle', content: 'def changed = "1.0"\nchanged = pick()\ndependencies {\nimplementation "org.demo:computed:1.0" + suffix\nimplementation "org.demo:reassigned:$changed"\nimplementation "org.demo:missing:$missing"\nimplementation "org.demo:range:[1,2)"\n}\n' }]);
  assert.equal(parsed.dependencies.length, 4); assert.ok(parsed.dependencies.every(d => d.state === 'unresolved' && !d.owner));
  const expressions = I.parseFiles([{ path: 'build.gradle', content: 'def v = "1.0"\nplugins { id("org.demo") version "1.0" + suffix }\ndependencies { implementation(group: "org.demo", name: "map", version: v + suffix) }\n' }]); assert.ok(expressions.dependencies.every(d => d.state === 'unresolved' && !d.owner));
  const slashy = I.parseFiles([{ path: 'build.gradle', content: 'def example = /implementation "org.demo:fake:1.0"/\ndef quoted = $/implementation "org.demo:also-fake:1.0"/$\n' }]); assert.equal(slashy.dependencies.length, 0);
  const catalogs = I.parseFiles([{ path: 'gradle/libs.versions.toml', content: '[libraries]\ncore = "org.demo:root:1.0"\n' }, { path: 'nested/gradle/libs.versions.toml', content: '[libraries]\ncore = "org.demo:nested:2.0"\n' }, { path: 'build.gradle', content: 'dependencies { implementation(libs.core) }' }, { path: 'nested/module/build.gradle.kts', content: 'dependencies { implementation(libs.core) }' }]); assert.equal(catalogs.dependencies.find(d => d.path === 'build.gradle').coordinate, 'org.demo:root'); assert.equal(catalogs.dependencies.find(d => d.path === 'nested/module/build.gradle.kts').coordinate, 'org.demo:nested');
  const plugins = I.parseFiles([{ path: 'gradle/libs.versions.toml', content: '[versions]\nkotlin = "2.0.0"\n[plugins]\nkotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }\n' }, { path: 'build.gradle.kts', content: 'plugins { alias(libs.plugins.kotlin.jvm) }' }]); assert.equal(plugins.dependencies.find(d => d.path === 'build.gradle.kts').coordinate, 'plugin:org.jetbrains.kotlin.jvm'); assert.equal(plugins.dependencies.find(d => d.path === 'build.gradle.kts').owner.key, 'kotlin');
});

test('cached dependency search finds upgrade consumers across repositories and retains revision selectors', () => {
  const found = I.search({ dependency: 'org.literal:leaf' }); assert.equal(found.total, 3); assert.equal(new Set(found.rows.map(d => d.repo)).size, 2); assert.ok(found.rows.every(d => /^[a-f0-9]{64}$/.test(d.revision)));
  assert.equal(I.search({ dependency: 'org.literal:leaf', repos: ['TEST/library'] }).total, 1); assert.equal(I.search({ q: 'leaf', limit: 1 }).truncated, true); assert.ok(I.search({ dependency: 'org.literal:leaf', history: true }).total > found.total);
  A.run({ principalId: 'someone', storyId: 'another', multiUser: true }, () => assert.equal(I.search({ q: 'leaf' }).total, 0));
});

test('failed multi-file apply restores earlier writes and reports the rollback', async () => {
  const clean = await W.open({ ...payments.spec, ref: payments.sha, fresh: true });
  const p = I.plan({ revision: snapshot.revision, dependency: 'org.literal:leaf', version: '1.8.0' });
  const originalSave = E.save; let count = 0;
  E.save = (...args) => { if (++count === 2) throw new Error('simulated disk write failure'); return originalSave(...args); };
  let result;
  try { result = await I.apply({ plan: p.id, workspace: clean.id }); } finally { E.save = originalSave; }
  assert.equal(result.applied, false); assert.equal(result.rollback.complete, true); assert.equal(result.rollback.restored.length, 1); assert.match(result.error, /disk write failure/);
  for (const file of p.files) assert.equal(E.read(clean.id, file.path).revision, file.expected_revision);
});

test('browser editor state preserves typing during save and rejects stale task responses', () => {
  const C = require('../web/editor.js');
  let content = 'original'; const doc = { getValue: () => content };
  const draft = C.draft({ content, revision: 'first', eol: 'CRLF' }, doc);
  content = 'submitted'; draft.dirty = true; draft.saving = true; content = 'typed while saving';
  C.saved(draft, 'submitted', 'second'); assert.equal(draft.revision, 'second'); assert.equal(draft.original, 'submitted'); assert.equal(draft.dirty, true); assert.equal(draft.saving, false); assert.equal(doc.getValue(), 'typed while saving');
  C.saved(draft, content, 'third'); assert.equal(draft.dirty, false);
  const scope = { epoch: 1, workspace: 'first', story: 'task' }, valid = C.guard(scope); assert.equal(valid(), true); scope.story = 'another-task'; assert.equal(valid(), false); scope.story = 'task'; scope.workspace = 'second'; assert.equal(valid(), false);
  const rows = [{ coordinate: 'org.demo:a', owner: { key: 'sharedVersion' }, version: '1.0', path: 'build.gradle' }, { reason: 'computed dependency', path: 'other/build.gradle.kts' }];
  assert.deepEqual(C.dependencies(rows, 'SHAREDVERSION'), [rows[0]]); assert.deepEqual(C.dependencies(rows, 'computed'), [rows[1]]); assert.equal(C.mode('build.gradle.kts'), 'text/x-kotlin'); assert.equal(C.mode('Платёж.java'), 'text/x-java');
});

test('terminal executes actual inspection commands with task isolation, rejects shell and defaults builds off', async () => {
  const r = E.terminal(workspace.id, { action: 'run', command: 'git status' }); await J.find(r.job).promise;
  const result = E.terminal(workspace.id, { action: 'read', job: r.job }); assert.equal(result.state, 'done'); assert.equal(result.code, 0); assert.match(result.out, /README\.md/); assert.equal(result.runner.placement, 'local');
  for (const command of ['sh -c whoami', 'git status; cat /etc/passwd', 'git diff ../secret', 'git --version', 'ls\nwhoami']) assert.throws(() => E.terminal(workspace.id, { action: 'run', command }), /command/);
  assert.throws(() => E.terminal(workspace.id, { action: 'run', command: 'gradle test', allow_build: true }), { code: 'DT_TERMINAL_BUILD_DISABLED' });
  const other = await W.open({ ...library.spec, fresh: true }); assert.throws(() => E.terminal(other.id, { action: 'read', job: r.job }), /not found/);
  A.run({ principalId: 'other', storyId: 'task', multiUser: true }, () => assert.throws(() => E.terminal(workspace.id, { action: 'read', job: r.job }), /no workspace|available/));
  E.terminal(workspace.id, { action: 'clear' }); assert.equal(E.terminal(workspace.id, { action: 'read', job: r.job }).out, '');
});

test('terminal build runs only on authenticated runner, records command/output and supports cancellation', async () => {
  process.env.DT_RUNNER_TOKEN = 'editor-test-token';
  const server = require('../lib/runner').serve({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  cfg({ workspaceEditor: { terminalBuilds: true }, tests: { runnerUrl: url, runnerToken: process.env.DT_RUNNER_TOKEN } });
  try {
    const denied = await fetch(url + '/exec', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' }, body: JSON.stringify({ cmd: 'sh', args: ['gradlew'], cwd: W.checkId(workspace.id).path }) }); assert.equal(denied.status, 401);
    const r = E.terminal(workspace.id, { action: 'run', command: 'gradle test', allow_build: true }); await J.find(r.job).promise; const done = E.terminal(workspace.id, { action: 'read', job: r.job });
    assert.equal(done.code, 0); assert.equal(done.runner.placement, 'remote'); assert.match(done.out, /runner-command:--console=plain --no-daemon test/);
    const large = E.read(workspace.id, 'gradlew'); E.save(workspace.id, 'gradlew', '#!/bin/sh\nhead -c 90000 /dev/zero | tr "\\000" x\n', large.revision);
    const long = E.terminal(workspace.id, { action: 'run', command: 'gradle test', allow_build: true }); await J.find(long.job).promise; const bounded = E.terminal(workspace.id, { action: 'read', job: long.job }); assert.equal(bounded.truncated, true); assert.ok(Buffer.byteLength(bounded.out) <= E.MAX_OUTPUT);
    const wrapper = E.read(workspace.id, 'gradlew'); E.save(workspace.id, 'gradlew', '#!/bin/sh\necho waiting-for-cancel\nsleep 30\n', wrapper.revision);
    const slow = E.terminal(workspace.id, { action: 'run', command: 'gradle test', allow_build: true });
    const deadline = Date.now() + 10000;
    while (!J.get(slow.job).log.some(line => line.includes('waiting-for-cancel')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(J.get(slow.job).log.some(line => line.includes('waiting-for-cancel'))); E.terminal(workspace.id, { action: 'cancel', job: slow.job }); await J.find(slow.job).promise; assert.equal(E.terminal(workspace.id, { action: 'read', job: slow.job }).state, 'cancelled');
    A.run({ principalId: 'nonadmin', storyId: 'task', multiUser: true }, () => assert.equal(E.policy().buildsEnabled, false));
  } finally { cfg({}); delete process.env.DT_RUNNER_TOKEN; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
