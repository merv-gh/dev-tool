const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-performance-'));
process.env.DT_HOME = home;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const { writeJson, fileStamp } = require('../lib/util');
const CI = require('../lib/codeindex');
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

function replacePreservingMtime(file, value) {
  const previous = fs.statSync(file);
  const next = file + '.new';
  fs.writeFileSync(next, value);
  fs.utimesSync(next, previous.atime, previous.mtime);
  fs.renameSync(next, file);
}

test('unchanged code indexes reuse outputs; source, metadata and extraction changes rebuild them', () => {
  const root = path.join(home, 'source'), source = path.join(root, 'Order.java');
  put(source, 'class Order { String status = "pending"; }\n');
  const first = CI.build(root, 'SHOP/orders', { sha: 'a' });
  const manifest = path.join(CI.keyDir('SHOP/orders'), 'files.json');
  const stamp = fileStamp(manifest);
  const second = CI.build(root, 'SHOP/orders', { sha: 'a' });
  assert.equal(second.reused, true);
  assert.equal(second.builtAt, first.builtAt);
  assert.equal(fileStamp(manifest), stamp, 'a reused index performs no writes');
  replacePreservingMtime(source, 'class Order { String status = "shipped"; }\n');
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'a' }).reused, undefined);
  assert.equal(CI.grep(['SHOP/orders'], 'shipped').hits.length, 1);
  assert.equal(CI.grep(['SHOP/orders'], 'pending').hits.length, 0);
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }).reused, undefined);
  assert.equal(CI.load('SHOP/orders').sha, 'b');
  CI.build(root, 'SHOP/orders', { sha: 'b' }, { extracted: { app: { name: 'before' } } });
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }, { extracted: { app: { name: 'before' } } }).reused, true);
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }, { extracted: { app: { name: 'after' } } }).reused, undefined);
  assert.equal(CI.load('SHOP/orders').graph_().app.name, 'after');
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }, { force: true }).reused, undefined);
  put(path.join(root, 'New.java'), 'class New {}');
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }).files, 2);
  fs.rmSync(source);
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }).files, 1);
  fs.symlinkSync(path.join(root, 'New.java'), path.join(root, 'Alias.java'));
  CI.build(root, 'SHOP/orders', { sha: 'b' });
  assert.equal(CI.build(root, 'SHOP/orders', { sha: 'b' }).reused, undefined, 'symlink inputs cannot be validated by this manifest');
});

test('manifest and usage memos notice external replacement with an unchanged builtAt', () => {
  const index = CI.load('SHOP/orders');
  assert.equal(CI.load('SHOP/orders'), index);
  assert.ok(CI.list().some(x => x.key === 'SHOP/orders' && !x.tri && !x.list));
  const manifest = path.join(CI.keyDir('SHOP/orders'), 'files.json');
  const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  replacePreservingMtime(manifest, JSON.stringify({ ...data, sha: 'c' }));
  assert.equal(CI.load('SHOP/orders').sha, 'c');
  assert.notEqual(CI.load('SHOP/orders'), index);
  const pgfile = path.join(home, 'cache', 'dev', 'pg', '_usage.json');
  const P = require('../lib/pgindex');
  writeJson(pgfile, { builtAt: 'same', edges: [{ target: 'a' }] });
  const first = P.load('dev');
  assert.equal(P.load('dev'), first);
  replacePreservingMtime(pgfile, JSON.stringify({ builtAt: 'same', edges: [{ target: 'b' }] }));
  assert.equal(P.load('dev').edges[0].target, 'b');
  fs.rmSync(pgfile);
  assert.deepEqual(P.load('dev'), { edges: [] });
  fs.rmSync(manifest);
  assert.equal(CI.load('SHOP/orders'), null);
});

test('cached catalog search preserves ranking and invalidates replacement/removal', () => {
  const C = require('../lib/catalog');
  const file = path.join(home, 'cache', 'dev', 'catalog.txt');
  put(file, 'pg orders data.other ~1: id bigint | used by: svc payment(read)\npg orders data.payment ~1: id bigint\nkafka payment 2: id\n');
  assert.deepEqual(C.find('dev', 'pg: payment', { limit: 1 }), ['pg orders data.payment ~1: id bigint']);
  assert.equal(C.find('dev', 'payment').length, 3);
  replacePreservingMtime(file, 'pg orders data.new ~1: id bigint\n');
  assert.deepEqual(C.find('dev', 'payment'), []);
  assert.equal(C.find('dev', 'new').length, 1);
  fs.rmSync(file);
  assert.deepEqual(C.find('dev', 'new'), []);
});

test('catalog refresh accepts schema-only and sample-only Kafka caches', () => {
  const C = require('../lib/catalog');
  writeJson(path.join(home, 'cache/dev/kafka/sample-only.json'), { topic: 'sample-only', samples: [{ value: { orderId: 42, lines: [{ sku: 'a' }] } }] });
  writeJson(path.join(home, 'cache/dev/kafka/schema-only.json'), { topic: 'schema-only', valueSchema: { type: 'JSON', schema: { type: 'object', properties: { orderId: { type: 'integer' } } } } });
  assert.ok(C.build('dev') >= 2);
  assert.match(C.find('dev', 'kafka: sample-only')[0], /value.orderId/);
  assert.match(C.find('dev', 'kafka: schema-only')[0], /value.orderId/);
});

test('fast preparation prunes generated trees and invalidates build inputs and missing outputs', () => {
  const F = require('../lib/fastrun');
  const root = path.join(home, 'maven');
  put(path.join(root, 'pom.xml'), '<project>root</project>');
  put(path.join(root, 'module', 'pom.xml'), '<project>module</project>');
  put(path.join(root, 'target', 'generated', 'pom.xml'), '<project>generated</project>');
  put(path.join(root, 'node_modules', 'dependency', 'pom.xml'), '<project>dependency</project>');
  fs.symlinkSync(root, path.join(root, 'loop'));
  assert.deepEqual(F.pomsIn(root).map(f => path.relative(root, f)), ['module/pom.xml', 'pom.xml']);
  const cfg = { args: [], mavenRepo: '/repo', javaHome: null }, plan = { module: '.' }, mvn = { cmd: 'mvn', args: [] };
  const key = F.preparationKey(root, plan, cfg, mvn);
  put(path.join(root, 'target', 'generated', 'pom.xml'), 'ignored change');
  assert.equal(F.preparationKey(root, plan, cfg, mvn), key);
  assert.notEqual(F.preparationKey(root, plan, { ...cfg, args: ['-Pprofile'] }, mvn), key);
  assert.notEqual(F.preparationKey(root, plan, { ...cfg, javaHome: '/jdk' }, mvn), key);
  put(path.join(root, '.mvn', 'maven.config'), '-Pnew');
  assert.notEqual(F.preparationKey(root, plan, cfg, mvn), key);
  const state = { buildKey: key, classes: root, testClasses: root, launcherDir: root, launcherJar: path.join(root, 'launcher.jar'), classpath: [path.join(root, 'dependency.jar')] };
  for (const f of ['DtLauncher.class', 'launcher.jar', 'dependency.jar']) put(path.join(root, f), 'x');
  assert.equal(F.preparedStateUsable(state, key), true);
  assert.equal(F.preparedStateUsable(state, 'other'), false);
  fs.rmSync(path.join(root, 'dependency.jar'));
  assert.equal(F.preparedStateUsable(state, key), false);
});
