// Full passport build against real (local) git repos: service + internal library at its tag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-passport-'));
process.env.DT_PASSPORTS_DIR = path.join(tmp, 'passports');
process.env.DT_REPOS_DIR = path.join(tmp, 'repos');
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_CONFIG_DIR = tmp; // no local .env files in tests
process.env.DT_CACHE_DIR = path.join(tmp, 'cache');
process.env.INTERNAL_GROUPS = 'com.acme.libs';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
function makeRepo(name, fixture, tag) {
  const work = path.join(tmp, 'src', name);
  fs.cpSync(path.join(__dirname, 'fixtures', fixture), work, { recursive: true });
  sh(work, 'init', '-q', '-b', 'main'); sh(work, 'add', '.'); sh(work, 'commit', '-q', '-m', 'init');
  if (tag) sh(work, 'tag', tag);
  sh(work, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  return work;
}
const svcSrc = makeRepo('order-service', 'order-service');
makeRepo('common-lib', 'common-lib', 'v1.4.2');

// Bitbucket stand-ins: repo search and git remotes point at the local repos.
const atl = require('../lib/atlassian');
atl.repos = async (filter) => ['order-service', 'common-lib'].filter(r => r.includes(filter)).map(repo => ({ project: 'SHOP', repo }));
const realGit = require('../lib/git');
const gitImpl = {
  fetchRef: (p, r, ref) => realGit.fetchRef(p, r, ref, { url: `file://${path.join(tmp, 'src', r)}` }),
  fetchFirst: (p, r, refs) => realGit.fetchFirst(p, r, refs, { url: `file://${path.join(tmp, 'src', r)}` }),
};
const passport = require('../lib/passport');

test('build: service + library at the version tag, effective view, files saved', async () => {
  const p = await passport.build('order-service', { gitImpl });
  assert.equal(p.repo.project, 'SHOP');
  assert.match(p.repo.sha, /^[0-9a-f]{40}$/);
  assert.equal(p.libraries.length, 1);
  const lib = p.libraries[0];
  assert.equal(lib.artifactId, 'common-lib');
  assert.equal(lib.ref, 'v1.4.2');
  assert.equal(lib.exactVersion, true);
  assert.equal(lib.provides.endpoints, 1);
  assert.ok(p.effective.endpoints.some(e => e.path === '/internal/info' && e.source === 'common-lib'), 'library controller is part of the service');
  assert.ok(p.summary.consumes.includes('lib_events'));
  assert.deepEqual(p.summary.tables['sales.orders'].sort(), ['entity', 'owner', 'read', 'repository', 'write']);
  assert.equal(p.changes, null);
  assert.ok(fs.existsSync(path.join(process.env.DT_PASSPORTS_DIR, 'order-service', 'passport.md')));
  const md = fs.readFileSync(path.join(process.env.DT_PASSPORTS_DIR, 'order-service', 'passport.md'), 'utf8');
  assert.match(md, /\| GET \| \/api\/orders\/\{id\} \| OrderController.getOrder/);
});

test('rebuild after a commit reports what changed and keeps history', async () => {
  const ctl = path.join(svcSrc, 'src/main/java/com/acme/order/OrderController.java');
  fs.writeFileSync(ctl, fs.readFileSync(ctl, 'utf8').replace('public List<OrderDto> search', '@DeleteMapping("/{id}")\n    public void remove(@PathVariable Long id) {}\n\n    @RequestMapping(value = "/search", method = RequestMethod.POST)\n    public List<OrderDto> searchV2').replace('@RequestMapping(value = "/search", method = RequestMethod.POST)\n    public List<OrderDto> searchV2', 'public List<OrderDto> searchV2'));
  sh(svcSrc, 'commit', '-q', '-am', 'delete endpoint');
  const p = await passport.build('order-service', { gitImpl });
  assert.ok(p.changes && !p.changes.none);
  assert.deepEqual(p.changes.endpoints.added, ['DELETE /api/orders/{id}']);
  assert.equal(p.changes.endpoints.removed.length, 0);
  assert.equal(fs.readdirSync(path.join(process.env.DT_PASSPORTS_DIR, 'order-service', 'history')).length, 1);
});

test('build at a specific sha', async () => {
  const first = sh(svcSrc, 'rev-list', '--max-parents=0', 'HEAD');
  const p = await passport.build('order-service', { gitImpl, ref: first, libraries: false });
  assert.equal(p.repo.sha, first);
  assert.ok(!p.effective.endpoints.some(e => e.method === 'DELETE'));
});

test('list, who_uses and catalog lines across passports', async () => {
  await passport.build('order-service', { gitImpl });
  const l = passport.list();
  assert.equal(l.length, 1);
  assert.ok(l[0].produces.includes('order_created'));
  const who = passport.whoUses('order_created');
  assert.ok(who.some(w => w.role === 'produces' && w.service === 'order-service'));
  assert.ok(passport.whoUses('sales.order_history').some(w => w.role === 'write'));
  assert.ok(passport.whoUses('payment-service').some(w => w.role === 'calls'));
  assert.ok(passport.whoUses('/internal/info').some(w => w.source === 'common-lib'));
});

test('ambiguous repo name asks for PROJECT/slug', async () => {
  atl.repos = async () => [{ project: 'A', repo: 'x-api' }, { project: 'B', repo: 'x-worker' }];
  await assert.rejects(passport.resolveRepo('x'), /Several repos match "x".*A\/x-api, B\/x-worker/);
  assert.deepEqual(await passport.resolveRepo('x', 'b/x-worker'), { project: 'B', repo: 'x-worker' });
});

test('deployed sha: from /version JSON (Spring actuator git info) or plain text', async () => {
  const consul = require('../lib/consul');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  consul.service = async () => ({ service: 'x', instances: [{ address: 'a', port: 1, version: null }, { address: 'b', port: 2, version: JSON.stringify({ git: { branch: 'main', commit: { id: sha, time: 't' } } }) }] });
  assert.deepEqual((await passport.deployedSha('dev', 'x')).sha, sha);
  consul.service = async () => ({ service: 'x', instances: [{ address: 'a', port: 1, version: 'order-service 2.7.0 (build 3f9c2ab1)' }] });
  assert.equal((await passport.deployedSha('dev', 'x')).sha, '3f9c2ab1');
  consul.service = async () => ({ query: 'x', matches: ['x-a', 'x-b'] });
  await assert.rejects(passport.deployedSha('dev', 'x'), /did you mean x-a, x-b/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
