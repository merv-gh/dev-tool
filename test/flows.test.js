// The hard case: libraries in a repo named "commons" whose folders hold the real artifacts (one folder
// even named differently from its artifactId), a controller of a library calling a handler interface the
// service implements, and the service going out over HTTP, Kafka (through a library publisher), JPA and
// JDBC (a library audit trail); plus a @Scheduled job and a Kafka listener. Against a fake Bitbucket:
// the repo index finds every library and module, the passport has the flows, impact crosses repos, and
// the flow test context imports the chain's beans and mocks exactly its edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flows-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];

const FIX = path.join(__dirname, 'fixtures', 'bitbucket');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString().trim();
const repos = {};
for (const key of ['LIB/commons', 'SHOP/orders-service', 'PLAT/starter']) {
  const dir = path.join(home, 'remote', key);
  fs.cpSync(path.join(FIX, key), dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  if (key === 'LIB/commons') git(dir, 'tag', 'v1.2.0');
  repos[key] = dir;
}
// many other repos, some with misleading names
const noise = [
  { key: 'LIB/commons-legacy', dirs: ['old-utils'] }, { key: 'LIB/acme-web', dirs: ['src'], files: ['pom.xml'] },
  ...Array.from({ length: 40 }, (_, i) => ({ key: `P${i % 5}/service-${i}`, dirs: ['src', 'docs'] })),
];
const realGit = require('../lib/git');
const gitImpl = {
  fetchRef: (p, r, ref, o = {}) => realGit.fetchRef(p, r, ref, { ...o, url: `file://${repos[`${p}/${r}`]}` }),
  fetchFirst: (p, r, refs, o = {}) => realGit.fetchFirst(p, r, refs, { ...o, url: `file://${repos[`${p}/${r}`]}` }),
};

let bb;
test.before(async () => {
  bb = await require('./fake-bitbucket').start({ repos, noise });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: { dev: {} }, bitbucket: { url: bb.url, token: bb.token }, passports: { internalGroups: ['com.acme'] },
  }));
});
test.after(() => { bb.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('bitbucket index: every repo, root build files, first-level folders, module artifactIds', async () => {
  const B = require('../lib/bbindex');
  const r = await B.build({ perSec: 1000 });
  assert.equal(r.repos, 45);
  const commons = B.load().repos.find(x => x.repo === 'commons');
  assert.deepEqual(commons.self, { groupId: 'com.acme.libs', artifactId: 'commons-parent' });
  assert.deepEqual(commons.modules.map(m => `${m.dir}=${m.artifactId}`), ['audit=acme-audit-core', 'kafka=acme-kafka-support', 'acme-web-starter=acme-web-starter']);
  assert.deepEqual(B.load().repos.find(x => x.repo === 'starter').modules.map(m => m.dir), ['acme-web', 'metrics'], 'gradle includes');
  // folder name differs from the artifact; repo name says nothing
  assert.deepEqual(B.lookup({ groupId: 'com.acme.libs', artifactId: 'acme-audit-core' })[0], { project: 'LIB', repo: 'commons', module: 'audit', score: 105, why: 'module audit declares acme-audit-core' });
  assert.equal(B.lookup({ artifactId: 'acme-kafka-support' })[0].module, 'kafka');
  assert.notEqual(B.lookup({ groupId: 'com.acme.libs', artifactId: 'acme-web-starter' })[0].repo, 'acme-web', 'a declared module beats a look-alike repo');
  // a second run keeps what is fresh: only the repo list is asked again
  const before = bb.requests.length;
  await B.build({ perSec: 1000 });
  assert.ok(bb.requests.length - before <= 3, 'fresh repos are not indexed again');
  require('../lib/catalog').build('dev');
  assert.match(require('../lib/catalog').find('dev', 'repo: acme-audit-core')[0], /^repo LIB\/commons .*audit \(acme-audit-core\)/);
});

test('passport: libraries found through the index, read per module; flows through library and service', async () => {
  const p = await require('../lib/passport').build('orders-service', { repo: 'SHOP/orders-service', gitImpl });
  const libs = Object.fromEntries(p.libraries.map(l => [l.artifactId, l]));
  assert.deepEqual(Object.keys(libs).sort(), ['acme-audit-core', 'acme-kafka-support', 'acme-web-starter'], 'acme-audit-core comes through acme-web-starter');
  assert.deepEqual([libs['acme-web-starter'].module, libs['acme-kafka-support'].module, libs['acme-audit-core'].module], ['acme-web-starter', 'kafka', 'audit']);
  assert.ok(Object.values(libs).every(l => l.ref === 'v1.2.0' && !l.error), JSON.stringify(p.libraries));
  assert.ok(p.effective.endpoints.some(e => e.path === '/process/{type}' && e.source === 'acme-web-starter'));

  const flow = (entry) => p.flows.find(f => f.entry === entry);
  const web = flow('POST /process/{}');
  assert.ok(web, JSON.stringify(p.flows.map(f => f.entry)));
  assert.deepEqual(web.via.map(v => v.split(' ')[0]), ['ProcessController', 'ProcessHandler', 'AuditTrail', 'OrderProcessHandler', 'OrderService', 'Order', 'OrderRepository', 'PaymentGateway', 'EventPublisher']);
  assert.deepEqual(web.out.produces.map(x => x.topic), ['orders.placed'], 'the library publisher\'s topic, from the service config');
  assert.deepEqual(web.out.tables.map(t => `${t.table}:${t.access}`).sort(), ['audit.events:write', 'shop.orders:write']);
  assert.deepEqual(web.out.external.map(x => `${x.kind} ${x.type}.${x.call}`).sort(), ['db JdbcTemplate.update', 'http RestTemplate.postForObject', 'kafka KafkaTemplate.send']);
  assert.deepEqual(web.beans, ['ProcessController', 'AuditTrail', 'OrderProcessHandler', 'OrderService', 'PaymentGateway', 'EventPublisher']);
  assert.deepEqual(web.mocks.map(m => m.split(':')[0]).sort(), ['JdbcTemplate jdbc', 'KafkaTemplate<String, String> kafkaTemplate', 'OrderRepository orders', 'RestTemplate restTemplate']);
  const job = flow('scheduled ReconcileJob#run');
  assert.deepEqual(job.out.external.map(x => x.call), ['getForObject']);
  assert.deepEqual(job.out.tables.map(t => `${t.table}:${t.access}`).sort(), ['shop.orders:read', 'shop.orders:write']);
  assert.ok(flow('kafka payments.settled'), 'the listener topic resolved from the config');
});

test('impact crosses repos: a service method reaches the library endpoint through the handler interface', () => {
  const I = require('../lib/impact');
  const r = I.impact('OrderService#place', { repos: 'SHOP/*,LIB/*' });
  assert.deepEqual(r.endpoints, ['POST /process/{}']);
  assert.ok(r.items.some(i => i.name === 'ProcessController#process' && i.repo === 'LIB/commons/acme-web-starter'));
  const lib = I.impact('com.acme.libs.kafka.EventPublisher#publish', { repos: 'SHOP/*,LIB/*' });
  assert.ok(lib.items.some(i => i.name === 'OrderService#place'), 'who in the service uses the library method');
});

test('flow test context: the chain\'s beans imported, the edge mocked, properties, what to verify', async () => {
  const W = require('../lib/workspace');
  const ws = await W.open({ project: 'SHOP', repo: 'orders-service', ref: 'main', url: `file://${repos['SHOP/orders-service']}`, git: gitImpl });
  assert.deepEqual(ws.libs.map(l => `${l.artifactId}@${l.repo}/${l.module}`).sort(), ['acme-audit-core@LIB/commons/audit', 'acme-kafka-support@LIB/commons/kafka', 'acme-web-starter@LIB/commons/acme-web-starter']);
  const c = require('../lib/testgen').context(ws.id, 'POST /process/order');
  assert.equal(c.style, 'flow');
  assert.equal(c.test.path, 'src/test/java/com/acme/orders/ProcessControllerProcessFlowTest.java');
  const sk = c.skeleton;
  assert.match(sk, /@WebMvcTest\(controllers = ProcessController\.class\)\n@Import\(\{ProcessController\.class, AuditTrail\.class, OrderProcessHandler\.class, OrderService\.class, PaymentGateway\.class, EventPublisher\.class\}\)/);
  assert.match(sk, /@TestPropertySource\(properties = \{"acme\.events\.topic=orders\.placed", "orders\.payments-url=http:\/\/payments-service\/api"\}\)/);
  for (const m of ['@MockBean\n    JdbcTemplate jdbc;', '@MockBean\n    KafkaTemplate<String, String> kafkaTemplate;', '@MockBean\n    OrderRepository orders;', '@MockBean\n    RestTemplate restTemplate;']) assert.ok(sk.includes(m), m);
  assert.match(sk, /import com\.acme\.libs\.web\.ProcessController;/);
  assert.match(sk, /import org\.springframework\.kafka\.core\.KafkaTemplate;/);
  assert.match(sk, /mvc\.perform\(post\("\/process\/\{p1\}", "1"\)/);
  assert.match(sk, /\/\/ verify\(kafkaTemplate\)\.send\(eq\("orders\.placed"\), any\(\), any\(\)\);/);
  assert.match(sk, /\/\/ verify\(restTemplate\)\.postForObject\(any\(\), any\(\), any\(\)\);/);
  assert.match(sk, /\/\/ verify\(orders\)\.save\(any\(\)\);/);
  const job = require('../lib/testgen').context(ws.id, 'ReconcileJob#run');
  assert.equal(job.style, 'flow', 'a class of the service, asked as a flow from an entry point');
  assert.match(job.skeleton, /@SpringJUnitConfig\n@Import\(\{ReconcileJob\.class, OrderService\.class, PaymentGateway\.class\}\)/);
  assert.match(job.skeleton, /entry\.run\(\);/);
  assert.ok(!/KafkaTemplate/.test(job.skeleton), 'only the edge of this flow');
});
