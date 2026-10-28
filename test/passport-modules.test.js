// Libraries that are modules of a bigger repo (a "starter" with modules), found by shorter names or an
// explicit mapping; only the module is read; Gradle versions from ext { } pick the right tag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-modules-'));
process.env.DT_HOME = tmp;
process.env.DT_RATE_PER_SEC = '0';
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({
  envs: { dev: {} },
  passports: { internalGroups: ['com.acme'], libraryRepos: { 'odd-name-*': 'PLAT/platform-tools' } },
}));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const w = (root, files) => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); } };
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
const repo = (name, files, tag) => { const d = path.join(tmp, 'src', name); w(d, files); sh(d, 'init', '-q', '-b', 'main'); sh(d, 'add', '.'); sh(d, 'commit', '-q', '-m', 'x'); if (tag) sh(d, 'tag', tag); return d; };

// a Gradle service; versions in ext { } and a map-style dependency
repo('billing-service', {
  'build.gradle': `group = 'com.acme.billing'
ext {
  starterVersion = '2.0.0'
}
ext.versions = [tools: '1.1']
dependencies {
  implementation "com.acme.libs:acme-starter-kafka:$starterVersion"
  implementation group: 'com.acme.libs', name: 'acme-starter-web', version: starterVersion
  implementation "com.acme.tools:odd-name-metrics:\${versions.tools}"
}`,
  'src/main/java/com/acme/billing/App.java': 'class App {}',
});
// a multi-module starter: kafka (Maven) and web (Gradle) modules; the tag is for the repo
repo('acme-starter', {
  'pom.xml': '<project><groupId>com.acme.libs</groupId><artifactId>acme-starter-parent</artifactId><version>2.0.0</version><packaging>pom</packaging><modules><module>acme-starter-kafka</module></modules></project>',
  'acme-starter-kafka/pom.xml': '<project><parent><groupId>com.acme.libs</groupId><artifactId>acme-starter-parent</artifactId><version>2.0.0</version></parent><artifactId>acme-starter-kafka</artifactId></project>',
  'acme-starter-kafka/src/main/java/com/acme/libs/kafka/Listener.java': 'class Listener {\n  @KafkaListener(topics = "billing_events")\n  void on(String m) {}\n}',
  'web/build.gradle': "plugins { id 'java' }",
  'web/src/main/java/com/acme/libs/web/Ping.java': '@RestController\nclass Ping {\n  @GetMapping("/ping")\n  String ping() { return "ok"; }\n}',
  'other/src/main/java/Other.java': '@RestController\nclass Other {\n  @GetMapping("/not-mine")\n  String x() { return ""; }\n}',
}, 'v2.0.0');
repo('platform-tools', {
  'metrics/pom.xml': '<project><groupId>com.acme.tools</groupId><artifactId>odd-name-metrics</artifactId></project>',
  'metrics/src/main/java/M.java': '@RestController\nclass M {\n  @GetMapping("/metrics/x")\n  String m() { return ""; }\n}',
}, 'v1.1');

const atl = require('../lib/atlassian');
const searched = [];
atl.repos = async (q) => { searched.push(q); return ['billing-service', 'acme-starter', 'platform-tools', 'acme-other', 'acme-tools'].filter(r => r.includes(q)).map(repo => ({ project: 'LIB', repo })); };
// what dt looks at before taking a repo found by name: its folders and poms
const local = (r, p = '') => path.join(tmp, 'src', r, p);
atl.browse = async (project, r, dir = '') => { if (!fs.existsSync(local(r, dir))) throw new Error('404'); return fs.readdirSync(local(r, dir), { withFileTypes: true }).filter(e => e.name !== '.git').map(e => ({ name: e.name, type: e.isDirectory() ? 'DIRECTORY' : 'FILE' })); };
atl.file = async (project, r, p) => { if (!fs.existsSync(local(r, p))) throw new Error('404'); return fs.readFileSync(local(r, p), 'utf8'); };
repo('acme-tools', { 'pom.xml': '<project><groupId>com.acme.tools</groupId><artifactId>acme-tools</artifactId><modules><module>cli</module></modules></project>', 'cli/pom.xml': '<project><artifactId>acme-tools-cli</artifactId></project>' });
const realGit = require('../lib/git');
const fetched = [];
const gitImpl = {
  fetchRef: (p, r, ref) => { fetched.push(`${r}@${ref || 'HEAD'}`); return realGit.fetchRef(p, r, ref, { url: `file://${path.join(tmp, 'src', r)}` }); },
  fetchFirst: (p, r, refs) => realGit.fetchFirst(p, r, refs, { url: `file://${path.join(tmp, 'src', r)}` }),
  remoteRefs: (p, r) => realGit.remoteRefs(p, r, { url: `file://${path.join(tmp, 'src', r)}` }),
};

test('names to try for a library repo', () => {
  const { libraryRepoNames } = require('../lib/passport');
  assert.deepEqual(libraryRepoNames({ groupId: 'com.acme.libs', artifactId: 'acme-starter-kafka' }), ['acme-starter-kafka', 'acme-starter', 'acme', 'libs', 'acme-libs']);
  assert.deepEqual(libraryRepoNames({ groupId: 'com.acme', artifactId: 'orders-spring-boot-starter' }).slice(0, 6), ['orders-spring-boot-starter', 'orders-spring-boot', 'orders-spring', 'orders']);
});

test('modules of a bigger repo: found, only the module read, tag from the ext { } version', async () => {
  const p = await require('../lib/passport').build('billing-service', { gitImpl });
  const byId = Object.fromEntries(p.libraries.map(l => [l.artifactId, l]));
  const kafka = byId['acme-starter-kafka'];
  assert.equal(kafka.error, undefined, kafka.error);
  assert.deepEqual([kafka.repo, kafka.module, kafka.version, kafka.ref], ['LIB/acme-starter', 'acme-starter-kafka', '2.0.0', 'v2.0.0']);
  assert.match(kafka.found, /acme-starter/);
  const web = byId['acme-starter-web'];
  assert.deepEqual([web.repo, web.module, web.ref], ['LIB/acme-starter', 'web', 'v2.0.0'], 'a Gradle module named without the repo prefix');
  const metrics = byId['odd-name-metrics'];
  assert.deepEqual([metrics.repo, metrics.module, metrics.version, metrics.found], ['PLAT/platform-tools', 'metrics', '1.1', 'passports.libraryRepos "odd-name-*"']);
  assert.ok(p.effective.consumes.some(c => c.topic === 'billing_events' && c.source === 'acme-starter-kafka'));
  const eps = p.effective.endpoints.map(e => `${e.path} ${e.source}`);
  assert.ok(eps.includes('/ping acme-starter-web') && eps.includes('/metrics/x odd-name-metrics'), eps.join(', '));
  assert.ok(!eps.some(e => e.startsWith('/not-mine')), 'other modules of the repo are not read');
  assert.ok(p.effective.endpoints.find(e => e.path === '/ping').file.startsWith('web/src/'), 'file paths are relative to the repo');
  assert.equal(searched.filter(q => q === 'acme-starter').length, 1, 'one Bitbucket search per name per build');
  assert.equal(fetched.filter(f => f.startsWith('acme-starter@')).length, 1, 'the tag is known before fetching: one fetch, no failed tries');
  assert.ok(fetched.includes('acme-starter@v2.0.0'));
});

test('a library that cannot be found says what was tried and how to map it', async () => {
  const p = require('../lib/passport');
  const atlRepos = atl.repos;
  atl.repos = async () => [];
  try {
    fs.writeFileSync(path.join(tmp, 'src', 'billing-service', 'build.gradle'), 'group = "com.acme.billing"\ndependencies { implementation "com.acme.libs:ghost-lib:1.0" }');
    sh(path.join(tmp, 'src', 'billing-service'), 'commit', '-qam', 'ghost');
    const r = await p.build('billing-service', { gitImpl });
    const ghost = r.libraries.find(l => l.artifactId === 'ghost-lib');
    assert.match(ghost.error, /no Bitbucket repo declares ghost-lib \(searched ghost-lib, ghost, libs, acme-libs\).*passports\.libraryRepos/);
  } finally { atl.repos = atlRepos; }
});

test('a repo found by name is looked at first: a look-alike that does not declare the artifact is not fetched', async () => {
  const p = require('../lib/passport');
  fs.writeFileSync(path.join(tmp, 'src', 'billing-service', 'build.gradle'), 'group = "com.acme.billing"\ndependencies { implementation "com.acme.tools:acme-tools-core:3.0" }');
  sh(path.join(tmp, 'src', 'billing-service'), 'commit', '-qam', 'tools');
  const before = fetched.length;
  const r = await p.build('billing-service', { gitImpl });
  const core = r.libraries.find(l => l.artifactId === 'acme-tools-core');
  assert.match(core.error, /no Bitbucket repo declares acme-tools-core .*looked inside LIB\/acme-tools/);
  assert.ok(!fetched.slice(before).some(f => f.startsWith('acme-tools@')), 'never fetched on a guess');
});
