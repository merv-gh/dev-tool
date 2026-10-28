// TestData on a real build and database: the shipping-service fixture with its schema (dictionaries d_carriers,
// d_countries) synced, TestData generated from it, then tests that use it as they would be written:
// validation cases through MockMvc, Mockito tests of the service, a listener, JPA against the DDL snapshot
// with the dictionaries' rows; and a test_context skeleton that runs as it comes. Needs Maven and Postgres:
//   DT_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/postgres DT_TEST_MAVEN=$(command -v mvn) npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PG = process.env.DT_TEST_PG_URL, MVN = process.env.DT_TEST_MAVEN;
const skip = !PG || !MVN ? 'set DT_TEST_PG_URL and DT_TEST_MAVEN' : false;
// the tests in fixtures/shipping-tests, with each case of TestData#createShipmentCases
const PASSED = 52;

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tdlive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
process.env.DT_COMPILE_WAIT_MS = '600000';
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('TestData from the edges and the database: tests that use it pass, a skeleton runs as it comes', { skip, timeout: 900000 }, async () => {
  const scratch = new URL(PG); scratch.pathname = '/postgres';
  // the internal library (DictionaryModel) as the company repository has it; the rest from ~/.m2
  const m2 = path.join(home, 'm2');
  const tail = path.join(os.homedir(), '.m2', 'repository');
  const lib = path.join(home, 'remote', 'dict-lib');
  fs.cpSync(path.join(__dirname, 'fixtures', 'dict-lib'), lib, { recursive: true });
  execFileSync(MVN, ['-B', '-q', '-ntp', 'install', '-DskipTests', `-Dmaven.repo.local=${m2}`, `-Dmaven.repo.local.tail=${tail}`], { cwd: lib, stdio: 'pipe' });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: { dev: { postgres: { ship: PG } } },
    tests: { maven: MVN, mavenRepo: m2, args: [`-Dmaven.repo.local.tail=${tail}`], pgUrl: scratch.toString().replace(/\/postgres$/, '/dt_scratch_ship') },
  }));
  // the topics as catalog_sync what=kafka leaves them (schema registry, last messages)
  fs.mkdirSync(path.join(home, 'cache', 'dev', 'kafka'), { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, 'fixtures', 'kafka'))) fs.copyFileSync(path.join(__dirname, 'fixtures', 'kafka', f), path.join(home, 'cache', 'dev', 'kafka', f));
  const postgres = require('postgres');
  const admin = postgres(PG, { onnotice: () => {} });
  await admin.unsafe(fs.readFileSync(path.join(__dirname, 'fixtures', 'pg', 'ship.sql'), 'utf8'));
  await admin.unsafe('drop database if exists dt_scratch_ship').then(() => admin.unsafe('create database dt_scratch_ship'));
  await admin.end();
  await require('../lib/indexer').refresh({ env: 'dev', what: 'pg' }).promise;

  const src = path.join(home, 'remote', 'shipping-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'shipping-service'), src, { recursive: true });
  const g = (args) => execFileSync('git', args, { cwd: src, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g(['init', '-q', '-b', 'main']); g(['add', '.']); g(['commit', '-qm', 'init']);
  const ws = await require('../lib/workspace').open({ project: 'SHIP', repo: 'shipping-service', ref: 'main', url: `file://${src}` });
  // the library's code index, as the service's passport gives it to the workspace
  require('../lib/codeindex').build(lib, 'lib/dict-lib');
  const metaFile = path.join(home, 'cache', 'work', `${ws.id}.json`);
  fs.writeFileSync(metaFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(metaFile, 'utf8')), libs: [{ artifactId: 'acme-dictionary', index: 'lib/dict-lib' }] }));
  const T = require('../lib/tools');
  const run = async (args) => { let r = await T.call('test_run', args); while (r.state === 'running') r = await T.call('test_run', { workspace: args.workspace, job: r.job }); return r; };

  const td = await T.call('test_data', { workspace: ws.id, env: 'dev' });
  assert.equal(td.compile.ok, true, JSON.stringify(td.compile, null, 2));
  assert.equal(td.database, 'ship');

  // the snapshot for the DB test: the tables with the dictionaries' rows
  const ctx = await T.call('test_context', { workspace: ws.id, target: 'ShipmentRepository', env: 'dev' });
  assert.equal(ctx.ddl.counts.dictionaryRows, 10);
  assert.ok(ctx.testData.factories.Shipment, JSON.stringify(ctx.testData));

  const dir = 'src/test/java/com/acme/ship/';
  const tests = fs.readdirSync(path.join(__dirname, 'fixtures', 'shipping-tests'));
  for (const n of tests) {
    const w = await T.call('workspace_write', { workspace: ws.id, path: dir + n, content: fs.readFileSync(path.join(__dirname, 'fixtures', 'shipping-tests', n), 'utf8') });
    assert.equal(w.compile.ok, true, `${n}: ${JSON.stringify(w.compile, null, 2)}`);
  }
  const r = await run({ workspace: ws.id, tests: tests.map(n => n.replace('.java', '')), env: 'dev', db: 'ship' });
  assert.equal(r.outcome, 'passed', JSON.stringify(r.failures || r.tail, null, 2));
  assert.equal(r.counts.failed + r.counts.errors, 0);
  assert.equal(r.counts.passed, PASSED);

  // a skeleton with TestData: the arguments and the stubs from it, runs as it comes
  const sk = await T.call('test_context', { workspace: ws.id, target: 'ShipmentService#create', flow: false });
  assert.match(sk.skeleton, /when\(carriers\.findById\(any\(\)\)\)\.thenReturn\(Optional\.of\(TestData\.carrier\(\)\)\);/);
  assert.match(sk.skeleton, /when\(shipments\.findByOrderId\(any\(\)\)\)\.thenReturn\(Optional\.empty\(\)\);/);
  assert.match(sk.skeleton, /subject\.create\(TestData\.createShipment\(\)\)/);
  assert.match(sk.skeleton, /when\(dictionaries\.parcelTypes\(\)\)\.thenReturn\(TestData\.activeParcelTypes\(\)\);/);
  const path2 = sk.test.path.replace(/Test\.java$/, 'SkeletonTest.java');
  await T.call('workspace_write', { workspace: ws.id, path: path2, content: sk.skeleton.replace('class ShipmentServiceTest', 'class ShipmentServiceSkeletonTest') });
  const r2 = await run({ workspace: ws.id, tests: ['ShipmentServiceSkeletonTest'] });
  assert.equal(r2.outcome, 'passed', JSON.stringify(r2.failures, null, 2));

  // flow skeletons: the input from TestData (the body, the path id, the event, the parsed text), the edge stubbed
  const flows = [];
  for (const target of ['POST /shipments', 'PUT /shipments/{id}/status', 'kafka orders.paid', 'kafka shipments.returned', 'kafka parcels.scanned']) {
    const f = await T.call('test_context', { workspace: ws.id, target });
    assert.equal(f.style, 'flow', target);
    await T.call('workspace_write', { workspace: ws.id, path: f.test.path, content: f.skeleton });
    flows.push({ target, cls: f.test.class.split('.').pop(), skeleton: f.skeleton });
  }
  assert.match(flows[0].skeleton, /\.content\(TestData\.json\(TestData\.createShipment\(\)\)\)/);
  assert.match(flows[1].skeleton, /put\("\/shipments\/\{p1\}\/status", TestData\.SHIPMENT_ID\)/);
  assert.match(flows[2].skeleton, /entry\.onOrderPaid\(TestData\.orderPaid\(\)\);/);
  assert.match(flows[3].skeleton, /entry\.onReturn\(String\.valueOf\(TestData\.SHIPMENT_ID\)\);/);
  assert.match(flows[4].skeleton, /entry\.onScan\(TestData\.parcelsScannedMessage\(\)\);/);
  const r3 = await run({ workspace: ws.id, tests: flows.map(f => f.cls) });
  assert.equal(r3.outcome, 'passed', JSON.stringify(r3.failures, null, 2));
  assert.equal(r3.counts.passed, 5);
});
