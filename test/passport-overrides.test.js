const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-passport-overrides-'));
process.env.DT_HOME = home; process.env.DT_RATE_PER_SEC = '0'; process.env.DT_LOG = 'quiet';
for (const name of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_REPOS_DIR','DT_TOOLS']) delete process.env[name];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { orders: 'postgres://test:unused@127.0.0.1:1/orders', billing: 'postgres://test:unused@127.0.0.1:1/billing' } }, uat: {} }, scripts: { starters: false } }));
const A = require('../lib/access'), O = require('../lib/passport/overrides'), P = require('../lib/passport'), Ports = require('../lib/passport/ports');
const sha = 'a'.repeat(40), later = 'b'.repeat(40);
const scope = (principalId = 'alice', storyId = 'one') => A.normalize({ principalId, storyId, role: 'user', multiUser: true });
function passport(service, revision = sha) {
  return { service, env: 'dev', repo: { project: 'SHOP', repo: service, sha: revision, ref: 'main' }, builtAt: '2026-11-04T12:00:00Z', dependencies: { internal: [], external: [] }, libraries: [], db: { datasources: [] }, http: [], es: [], config: { files: [] },
    effective: { endpoints: [{ method: 'POST', path: '/orders', handler: 'Orders#create(Order)', file: 'src/Orders.java', line: 12, custom: 'preserve me' }], calls: [], consumes: [{ topic: 'orders.created', handler: 'Consumer#read(Order)', file: 'src/Consumer.java', line: 20 }], produces: [], tables: [{ table: 'sales.orders', access: 'read,write', file: 'src/Orders.java', line: 35, via: 'JDBC mapping' }] },
    summary: { endpoints: 1, consumes: ['orders.created'], produces: [], tables: { 'sales.orders': ['read','write'] }, calls: [], libraries: [] } };
}
function save(value) { const folder = path.join(P.DIR, value.service); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'passport.json'), JSON.stringify(value)); return value; }
function input(service, extra = {}) { return { service, expected_revision: null, reason: 'Ticket ORD-42: confirmed application mapping', ...extra }; }
function port(type = 'kafka-produce', extra = {}) { return { type, handler: { file: 'src/Publisher.java', line: 40, signature: 'Publisher#send(Order)' }, boundary: { cluster: 'events-dev', topic: 'orders.published' }, mappings: [{ from: 'argument.order.id', to: 'payload.orderId', direction: 'request', evidence: 'Publisher.java:40' }], ...extra }; }
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('typed detections preserve read/write direction and missing evidence without inventing exact identities', () => {
  save(passport('directions'));
  const listed = O.ports({ service: 'directions' });
  assert.deepEqual(listed.ports.map(x => x.type), ['http-ingress','kafka-consume','db-read','db-write']);
  assert.ok(listed.gaps.find(x => x.missing?.includes('boundary.cluster')));
  assert.ok(listed.gaps.find(x => x.missing?.includes('boundary.db')));
  assert.ok(listed.ports.every(x => x.evidence.origin === 'detected' && x.status === 'detected'));
});

test('add/correct/disable keep automatic bytes unchanged, expose reason/history, and preserve untouched native metadata', () => {
  save(passport('orders')); const file = path.join(P.DIR, 'orders/passport.json'), original = fs.readFileSync(file);
  const before = O.adjustments({ service: 'orders' }), consumer = before.ports.find(x => x.type === 'kafka-consume');
  const created = O.adjust(input('orders', { operations: [{ action: 'add', port: port() }, { action: 'disable', port_id: consumer.id }] }));
  assert.equal(created.history.length, 1); assert.equal(created.disabled[0].id, consumer.id); assert.equal(created.ports.find(x => x.type === 'kafka-produce').evidence.reason, 'Ticket ORD-42: confirmed application mapping');
  const effective = P.load('orders');
  assert.equal(effective.effective.consumes.length, 0); assert.equal(effective.effective.produces.length, 1); assert.equal(effective.effective.produces[0].manual, true);
  assert.equal(effective.effective.endpoints[0].custom, 'preserve me'); assert.equal(effective.effective.tables[0].access, 'read,write');
  assert.deepEqual(fs.readFileSync(file), original);
  const added = created.ports.find(x => x.type === 'kafka-produce');
  const updated = O.adjust(input('orders', { expected_revision: created.revision, reason: 'Correct the topic from application-dev.yml', operations: [{ action: 'correct', port_id: added.id, port: port('kafka-produce', { boundary: { cluster: 'events-dev', topic: 'orders.confirmed' } }) }] }));
  assert.notEqual(updated.revision, created.revision); assert.equal(updated.history[0].previousRevision, created.revision); assert.equal(updated.history[1].reason, created.history[0].reason);
  assert.equal(O.adjustments({ service: 'orders', at_revision: created.revision }).ports.find(x => x.id === added.id).boundary.topic, 'orders.published');
  assert.throws(() => O.adjust(input('orders', { expected_revision: created.revision, operations: [{ action: 'disable', port_id: added.id }] })), { code: 'STATE_CONFLICT' });
});

test('manual overlays are isolated by principal/chat and exact environment/source revision', () => {
  save(passport('private-service'));
  const created = A.run(scope(), () => O.adjust(input('private-service', { operations: [{ action: 'add', port: port() }] })));
  assert.ok(created.ports.some(x => x.evidence.origin === 'manual'));
  for (const selected of [scope('bob'), scope('alice','two')]) A.run(selected, () => { assert.equal(O.adjustments({ service: 'private-service' }).revision, null); assert.ok(P.load('private-service').effective.ports.every(x => x.evidence.origin === 'detected')); });
  A.run(scope(), () => {
    assert.equal(O.adjustments({ service: 'private-service', env: 'uat' }).revision, null);
    assert.equal(O.ports({ service: 'private-service', revision: later }).ports.length, 0);
  });
});

test('auto refresh preserves overrides at one SHA and never applies them to a different commit', () => {
  const base = save(passport('refresh'));
  const initial = O.adjust(input('refresh', { operations: [{ action: 'add', port: port() }] }));
  save({ ...base, effective: { ...base.effective, calls: [{ client: 'billing', method: 'GET', path: '/balance', file: 'src/Billing.java', line: 8 }] } });
  assert.equal(P.load('refresh').portAdjustments.revision, initial.revision); assert.equal(P.load('refresh').effective.calls.length, 1);
  const history = path.join(P.DIR, 'refresh/history'); fs.mkdirSync(history); fs.writeFileSync(path.join(history, 'old.json'), JSON.stringify(base));
  save(passport('refresh', later));
  assert.equal(P.load('refresh').portAdjustments.revision, null);
  assert.equal(O.ports({ service: 'refresh', revision: sha }).ports.find(x => x.type === 'kafka-produce').evidence.origin, 'manual');
});

test('unknown passports allow declared ports and retain explicit identity/handler gaps', () => {
  const value = { service: 'incomplete', effective: { endpoints: [], consumes: [], produces: [], tables: [], calls: [] } }; save(value);
  const result = O.adjust(input('incomplete', { operations: [{ action: 'add', port: { type: 'scheduled', boundary: { schedule: 'every 5 minutes', registration: 'operator statement' } } }] }));
  assert.equal(result.identity.repo, null); assert.equal(result.identity.revision, null); assert.equal(result.identity.env, null);
  assert.equal(result.ports[0].status, 'declared'); assert.ok(result.gaps[0].missing.includes('handler.signature'));
  assert.equal(P.load('incomplete').effective.scheduled.length, 1);
  const normalized = require('../lib/passport/edges').normalize(P.load('incomplete'));
  assert.equal(normalized.portEdges.length, 0, 'unknown statements never become exact executable paths');
});

test('all typed ports carry field mappings and exact edges keep clusters/databases/schedules distinct', () => {
  save(passport('typed'));
  const loc = { file: 'src/Flow.java', line: 9, signature: 'Flow#handle(Payload)' };
  const definitions = [
    { type: 'http-ingress', boundary: { host: 'api.dev.example.test', method: 'POST', path: '/orders' } },
    { type: 'http-egress', boundary: { host: 'billing.dev.example.test', method: 'GET', path: '/invoices', target_service: 'billing' } },
    ...['events-a','events-b'].map(cluster => ({ type: 'kafka-produce', boundary: { cluster, topic: 'same-topic' } })),
    { type: 'db-read', boundary: { db: 'orders', schema: 'sales', table: 'orders', columns: ['id'] } },
    { type: 'db-write', boundary: { db: 'billing', schema: 'sales', table: 'orders', columns: ['id'] } },
    { type: 'scheduled', boundary: { schedule: '0 */5 * * * *', registration: '@Scheduled' } },
    { type: 'internal-library', boundary: { artifact: 'acme:validator', version: '2', module: 'core', target_repo: 'LIB/validator', target_revision: later, target_signature: 'Validator#validate(Payload)' } },
  ];
  O.adjust(input('typed', { operations: definitions.map((value, index) => ({ action: 'add', port: { ...value, id: `manual:typed-${index}`, handler: loc, mappings: [{ from: 'payload.id', to: 'value.id', direction: 'argument' }] } })) }));
  const normalized = require('../lib/passport/edges').normalize(P.load('typed'));
  assert.equal(normalized.portEdges.length, 8); assert.ok(normalized.portEdges.every(edge => edge.proof === 'declared' && edge.mappings.length === 1));
  const topics = normalized.portEdges.filter(edge => edge.kind === 'kafka-produce').map(edge => edge.to); assert.equal(new Set(topics).size, 2);
  const tables = normalized.portEdges.filter(edge => edge.kind.startsWith('db-')).flatMap(edge => [edge.from,edge.to]).filter(id => id.startsWith('table:')); assert.equal(new Set(tables).size, 2);
  assert.equal(normalized.portEdges.find(edge => edge.kind === 'scheduled').from.startsWith('schedule:'), true);
});

test('port correction can change kind without leaving the old native connection behind', () => {
  save(passport('change-kind')); const current = O.ports({ service: 'change-kind' }).ports.find(x => x.type === 'kafka-consume');
  O.adjust(input('change-kind', { operations: [{ action: 'correct', port_id: current.id, port: port('kafka-produce') }] }));
  const result = P.load('change-kind'); assert.equal(result.effective.consumes.length, 0); assert.equal(result.effective.produces[0].topic, 'orders.published');
  assert.equal(result.effective.ports.find(x => x.id === current.id).detected.type, 'kafka-consume');
});

test('validation rejects missing revisions, empty reasons, traversal, invalid port kinds and forged provenance', () => {
  save(passport('validation'));
  const operations = [{ action: 'add', port: port() }];
  assert.throws(() => O.adjust({ service: 'validation', reason: 'test', operations }), /expected_revision/);
  assert.throws(() => O.adjust(input('validation', { reason: ' ', operations })), /reason/);
  assert.throws(() => O.adjust(input('validation', { operations: [{ action: 'add', port: port('unknown') }] })), /port.type/);
  assert.throws(() => O.adjust(input('validation', { revision: 'main', operations })), /full 40/);
  assert.throws(() => O.adjust(input('validation', { operations: [{ action: 'add', port: port('kafka-produce', { handler: { file: '../outside', line: 1 } }) }] })), /relative source/);
  const result = O.adjust(input('validation', { operations: [{ action: 'add', port: { ...port(), evidence: { origin: 'detected' }, service: 'forged' } }] }));
  assert.equal(result.ports.find(x => x.type === 'kafka-produce').evidence.origin, 'manual'); assert.equal(result.ports.find(x => x.type === 'kafka-produce').service, 'validation');
});

test('exact call-site locators survive history and reject traversal or generation-local node IDs', () => {
  save(passport('call-site'));
  const call = { file: 'src/Publisher.java', line: 43, column: 12, name: 'send', signature: 'KafkaTemplate#send(String,Object)' };
  const result = O.adjust(input('call-site', { operations: [{ action: 'add', port: port('kafka-produce', { handler: { file: 'src/Publisher.java', line: 40, signature: 'Publisher#send(Order)', call } }) }] }));
  assert.deepEqual(result.ports.find(x => x.type === 'kafka-produce').handler.call, call);
  assert.deepEqual(O.adjustments({ service: 'call-site', at_revision: result.revision }).ports.find(x => x.type === 'kafka-produce').handler.call, call);
  for (const bad of [{ file: '../outside', line: 1 }, { file: 'src/Publisher.java', line: 1, node_id: 'local-123' }]) assert.throws(() => O.adjust(input('call-site', { expected_revision: result.revision, operations: [{ action: 'add', port: port('kafka-produce', { handler: { call: bad } }) }] })), /relative source|call locator/);
});

test('simultaneous processes cannot overwrite one exact adjustment head', async () => {
  save(passport('concurrent'));
  const script = `const O=require(${JSON.stringify(require.resolve('../lib/passport/overrides'))});try{const r=O.adjust(JSON.parse(process.argv[1]));console.log(JSON.stringify({saved:true,revision:r.revision}));}catch(e){console.log(JSON.stringify({saved:false,code:e.code}));}`;
  const run = id => new Promise((resolve, reject) => { let stdout=''; const child=spawn(process.execPath,['-e',script,JSON.stringify(input('concurrent',{operations:[{action:'add',port:{...port(),id:'manual:'+id}}]}))],{env:process.env});child.stdout.on('data',data=>stdout+=data);child.on('error',reject);child.on('close',code=>code?reject(Error('child failed')):resolve(JSON.parse(stdout))); });
  const results = await Promise.all([run('one'),run('two')]);
  assert.equal(results.filter(x => x.saved).length, 1); assert.equal(results.find(x => !x.saved).code, 'STATE_CONFLICT');
  assert.equal(O.adjustments({service:'concurrent'}).history.length, 1);
});

test('registered tool schemas enforce typed edits and persist a visible manual result', async () => {
  save(passport('registered')); const T = require('../lib/tools');
  const names = (await T.schemas()).map(x => x.name); for (const name of ['semantic_ports','passport_adjustments','passport_adjust']) assert.ok(names.includes(name));
  const result = await T.call('passport_adjust', input('registered', { operations: [{ action: 'add', port: port() }] }));
  assert.equal(result.saved, true); assert.ok(result.view);
  await assert.rejects(T.call('passport_adjust', input('registered', { expected_revision: result.revision, operations: [{ action: 'add', port: { ...port(), evidence: { origin: 'detected' } } }] })), /evidence|unknown|not allowed|unexpected/i);
});

test('map cache observes a corrected scoped port immediately and displays declared evidence', async () => {
  save(passport('map-correct'));
  const M = require('../lib/service-map');
  await A.run(scope('map-user'), async () => {
    const before = await M.graph('dev'), old = O.ports({ service: 'map-correct' }).ports.find(x => x.type === 'kafka-consume');
    assert.ok(before.ids.has('kafka:orders.created'));
    O.adjust(input('map-correct', { operations: [{ action: 'correct', port_id: old.id, port: port('kafka-consume', { boundary: { cluster: 'events-verified', topic: 'corrected.orders' } }) }] }));
    const after = await M.graph('dev'); assert.notEqual(after.meta[2], before.meta[2]);
    assert.ok(after.ids.has('kafka:events-verified:corrected.orders'));
    const neighbors = await M.neighbors({ env: 'dev', id: 'svc:map-correct' });
    assert.match(JSON.stringify(neighbors), /manual/); assert.match(JSON.stringify(neighbors), /confirmed application mapping/);
  });
  await A.run(scope('map-other'), async () => { const graph = await M.graph('dev'); assert.equal(graph.ids.has('kafka:events-verified:corrected.orders'), false); });
});

test('cancelled execution cannot publish an adjustment or acquire its filesystem lock', async () => {
  save(passport('cancelled')); const E = require('../lib/execution');
  const execution = E.start({ tool: 'cancelled-passport-write' }, () => O.adjust(input('cancelled', { operations: [{ action: 'add', port: port() }] })));
  E.cancel(execution.id, 'cancel before dispatch'); await assert.rejects(execution.promise, { code: 'DT_CANCELLED' });
  assert.equal(O.adjustments({ service: 'cancelled' }).revision, null);
});

test('PG usage projects private DB corrections without publishing them to shared cache or another owner', () => {
  const PG = require('../lib/pgindex'), root = path.join(home, 'cache/dev/pg'); fs.mkdirSync(root, { recursive: true });
  for (const [db, table] of [['orders','orders'],['billing','invoices']]) fs.writeFileSync(path.join(root, db + '.json'), JSON.stringify({ db, database: db, syncedAt: '2026-11-04', tables: [{ schema: 'sales', name: table, kind: 'table', columns: [{ name: 'id', type: 'bigint' }] }], functions: [], triggers: [] }));
  const value = passport('pg-correct'); value.db.datasources = [{ db: 'orders' }]; save(value); PG.build('dev');
  const originalCache = fs.readFileSync(path.join(root, '_usage.json'));
  A.run(scope('pg-alice'), () => {
    const write = O.ports({ service: value.service }).ports.find(port => port.type === 'db-write');
    O.adjust(input(value.service, { operations: [{ action: 'correct', port_id: write.id, port: { type: 'db-write', handler: { file: 'src/Orders.java', line: 35, signature: 'Orders#save(Order)' }, boundary: { db: 'billing', schema: 'sales', table: 'invoices', columns: ['id'] }, mappings: [{ from: 'order.id', to: 'sales.invoices.id', direction: 'write' }] } }] }));
    const old = PG.usages('dev', 'orders:sales.orders').find(row => row.user === value.service); assert.equal(old.role, 'read');
    const corrected = PG.usages('dev', 'billing:sales.invoices').find(row => row.user === value.service); assert.equal(corrected.role, 'write'); assert.equal(corrected.proof, 'declared'); assert.equal(corrected.source, 'manual');
    assert.equal(PG.describe('dev', 'billing:sales.invoices')[0].usedBy.find(row => row.user === value.service).provenance.origin, 'manual');
    assert.equal(PG.uses('dev', value.service).filter(row => row.user === value.service).length, 2);
    assert.deepEqual(fs.readFileSync(path.join(root, '_usage.json')), originalCache, 'read-side projection never rewrites the shared index');
    PG.build('dev'); assert.equal(PG.load('dev').edges.find(row => row.user === value.service).role, 'read,write', 'even an explicit build under a private owner writes only detections');
  });
  A.run(scope('pg-bob'), () => { assert.equal(PG.usages('dev', 'orders:sales.orders').find(row => row.user === value.service).role, 'read,write'); assert.equal(PG.usages('dev', 'billing:sales.invoices').some(row => row.user === value.service), false); });
});

test('shared catalog, route and knowledge builds never publish private manual declarations', () => {
  save(passport('shared-build'));
  const R = require('../lib/routes'), C = require('../lib/catalog'), K = require('../lib/knowledge');
  let projected;
  A.run(scope('shared-alice'), () => {
    O.adjust(input('shared-build', { operations: [{ action: 'add', port: { type: 'http-ingress', handler: { file: 'src/Private.java', line: 7, signature: 'Private#check()' }, boundary: { host: 'private.example.test', method: 'GET', path: '/private-manual-only' } } }] }));
    projected = P.load('shared-build');
    assert.ok(R.list({ service: 'shared-build' }).some(row => row.path === '/private-manual-only'));
    assert.equal(R.catalogLines({ manual: false }).some(row => row.includes('/private-manual-only')), false);
    C.build('dev');
    assert.equal(fs.readFileSync(path.join(home, 'cache/dev/catalog.txt'), 'utf8').includes('/private-manual-only'), false);
    const graph = K.build('dev', { pages: [] });
    assert.equal(JSON.stringify(graph).includes('/private-manual-only'), false);
  });
  A.run(scope('shared-bob'), () => {
    assert.equal(R.list({ service: 'shared-build' }).some(row => row.path === '/private-manual-only'), false);
    assert.equal(O.apply(projected).effective.ports.some(port => port.evidence.origin === 'manual'), false, 're-projecting starts from original detections');
    assert.equal(P.whoUses('/private-manual-only').length, 0, 'incomplete unrelated passports are tolerated');
  });
});

test('port cursors bind their type and disabled filters', () => {
  save(passport('cursor-filters'));
  const page = O.ports({ service: 'cursor-filters', limit: 1 }); assert.ok(page.nextCursor);
  assert.throws(() => O.ports({ service: 'cursor-filters', cursor: page.nextCursor, type: 'db-read' }), { code: 'STATE_CONFLICT' });
  assert.throws(() => O.ports({ service: 'cursor-filters', cursor: page.nextCursor, include_disabled: true }), { code: 'STATE_CONFLICT' });
});

test('metadata-only edits use CAS, preserve refreshes and keep every field declared and scoped', async () => {
  const base = save({ ...passport('metadata-only'), description: 'Detected description', owners: ['detected-team'] });
  const file = path.join(P.DIR, base.service, 'passport.json'), bytes = fs.readFileSync(file);
  await A.run(scope('metadata-alice'), async () => {
    const T = require('../lib/tools');
    const saved = await T.call('passport_adjust', input(base.service, { metadata: { description: 'Reviewed service purpose', owners: ['platform'], tags: ['orders','orders'], notes: 'ORD-42: deployment owner confirmed.' } }));
    assert.equal(saved.metadata.description, 'Reviewed service purpose'); assert.deepEqual(saved.metadata.tags, ['orders']);
    assert.equal(saved.metadataProvenance.notes.status, 'declared'); assert.equal(saved.metadataProvenance.notes.author.principalId, 'metadata-alice');
    assert.equal(saved.detectedMetadata.description, 'Detected description'); assert.deepEqual(fs.readFileSync(file), bytes);
    assert.throws(() => O.adjust(input(base.service, { metadata: { notes: 'stale' } })), { code: 'STATE_CONFLICT' });
    const updated = O.adjust(input(base.service, { expected_revision: saved.revision, metadata: { notes: null } }));
    assert.equal(updated.metadata.notes, null); assert.equal(updated.metadata.description, saved.metadata.description);
    assert.deepEqual(updated.history[0].changes, [{ action: 'metadata', fields: ['notes'] }]);
    assert.equal(O.adjustments({ service: base.service, at_revision: saved.revision }).metadata.notes, 'ORD-42: deployment owner confirmed.');
    save({ ...base, description: 'Refreshed detection' });
    assert.equal(P.load(base.service).description, saved.metadata.description); assert.equal(P.load(base.service).metadataProvenance.description.status, 'declared');
    save({ ...base, repo: { ...base.repo, sha: later } });
    assert.equal(P.load(base.service).description, 'Detected description');
    save(base);
    assert.throws(() => O.adjust(input(base.service, { expected_revision: updated.revision, metadata: { owner: 'forged' } })), /metadata/);
  });
  for (const owner of [scope('metadata-bob'), scope('metadata-alice','another')]) A.run(owner, () => { const loaded = P.load(base.service); assert.equal(loaded.description, 'Detected description'); assert.deepEqual(loaded.metadataProvenance, {}); });
});

test('HTTP tools preserve a known empty base path separately from unknown provenance', async () => {
  save(passport('http-base')); const T = require('../lib/tools');
  const saved = await T.call('passport_adjust', input('http-base', { operations: [{ action: 'add', port: { type: 'http-egress', boundary: { host: 'api.example.test', method: 'POST', path: '/orders', base_path: '' } } }] }));
  const declared = saved.ports.find(port => port.evidence.origin === 'manual'); assert.equal(declared.boundary.base_path, '');
  const listed = await T.call('semantic_ports', { service: 'http-base' }); assert.equal(listed.ports.find(port => port.id === declared.id).boundary.base_path, '');
  assert.equal(O.adjustments({ service: 'http-base', at_revision: saved.revision }).ports.find(port => port.id === declared.id).boundary.base_path, '');
  assert.equal(Ports.normalize({ type: 'http-egress', boundary: {} }, saved.identity, { origin: 'manual' }).boundary.base_path, null);
  assert.throws(() => O.adjust(input('http-base', { expected_revision: saved.revision, operations: [{ action: 'add', port: { type: 'http-egress', boundary: { base_path: 'invalid-prefix' } } }] })), /base_path/);
});
