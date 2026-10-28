// TestData from a service's edges, without a build: the shipping-service fixture (validated nested bodies, a
// JSON Kafka event, a text message the listener parses, entities with an FK to a dictionary table) and its
// synced catalog (with the dictionaries' rows). The source is checked, not compiled (testdata.live does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-testdata-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_RUNNER_URL']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { ship: 'postgres://u:p@127.0.0.1:1/ship' } } } }));
fs.mkdirSync(path.join(home, 'cache', 'dev', 'pg'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixtures', 'pg', 'ship.catalog.json'), path.join(home, 'cache', 'dev', 'pg', 'ship.json'));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const TD = require('../lib/testdata');

test('declarations: annotations with arguments, type-use annotations, record components', () => {
  const d = TD.declaration('@NotEmpty @Size(max = 20) List<@Valid Parcel> parcels');
  assert.deepEqual(d, { annos: { NotEmpty: {}, Size: { max: 20 } }, type: 'List<Parcel>', name: 'parcels', init: null, elemAnnos: { Valid: {} } });
  assert.deepEqual(TD.declaration('@NotBlank @Pattern(regexp = "[A-Z]{2}") String country').annos, { NotBlank: {}, Pattern: { regexp: '[A-Z]{2}' } });
  assert.deepEqual(TD.declaration('@DecimalMax("70.000") BigDecimal w').annos, { DecimalMax: { value: '70.000' } });
  const sh = TD.shape('package x;\n// a comment with record Fake(\npublic record P(@Min(1) int count, String sku) {\n  public record Inner(String a) {}\n}\n', { name: 'P', line: 3 });
  assert.equal(sh.kind, 'record');
  assert.deepEqual(sh.components.map(c => [c.type, c.name, c.annos]), [['int', 'count', { Min: { value: 1 } }], ['String', 'sku', {}]]);
  const en = TD.shape('enum Level { STANDARD, EXPRESS("x"), SAME_DAY; Level() {} Level(String s) {} }', { name: 'Level', line: 1 });
  assert.deepEqual(en.constants, ['STANDARD', 'EXPRESS', 'SAME_DAY']);
  const cls = TD.shape('class S { @Id @GeneratedValue private Long id; private Status status = Status.NEW; private static final int X = 1; protected S() {} public S(Long a, String b) { this.a = a; } public Long getId() { return id; } void setStatus(Status s) { status = s; } }', { name: 'S', line: 1 });
  assert.deepEqual(cls.fields.map(f => [f.name, f.init]), [['id', null], ['status', 'Status.NEW']]);
  assert.deepEqual(cls.ctors.map(c => [c.visibility, c.params.length]), [['protected', 0], ['public', 2]]);
  assert.ok(cls.methods.has('getId') && cls.methods.has('setStatus'));
});

// the internal library's index, as a passport gives it; the topics as catalog_sync what=kafka leaves them
function withLibraryAndTopics(id) {
  const lib = path.join(home, 'remote', 'dict-lib');
  if (!fs.existsSync(lib)) fs.cpSync(path.join(__dirname, 'fixtures', 'dict-lib'), lib, { recursive: true });
  require('../lib/codeindex').build(lib, 'lib/dict-lib');
  const metaFile = path.join(home, 'cache', 'work', `${id}.json`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  meta.libs = [{ artifactId: 'acme-dictionary', index: 'lib/dict-lib' }];
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  fs.mkdirSync(path.join(home, 'cache', 'dev', 'kafka'), { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, 'fixtures', 'kafka'))) fs.copyFileSync(path.join(__dirname, 'fixtures', 'kafka', f), path.join(home, 'cache', 'dev', 'kafka', f));
}

test('values: a regex sample, CHECK lists and bounds, strings the code parses', () => {
  assert.equal(TD.sample('[A-Z]{2}'), 'AA');
  assert.equal(TD.sample('^\\d{5}(-\\d{4})?$'), '11111');
  assert.equal(TD.sample('(EUR|USD)'), 'EUR');
  const t = { constraints: [{ type: 'c', def: "CHECK ((status = ANY (ARRAY['NEW'::text, 'SETTLED'::text])))" }, { type: 'c', def: 'CHECK ((weight_kg > (0)::numeric))' }] };
  assert.deepEqual(TD.checksOf(t, 'status').in, ['NEW', 'SETTLED']);
  assert.deepEqual([TD.checksOf(t, 'weight_kg').min, TD.checksOf(t, 'weight_kg').minExclusive], [0, true]);
  const p = TD.parsedNames(['service.changeStatus(Long.parseLong(shipmentId.trim()));', 'new BigDecimal(l.weightKg())', 'UUID.fromString(e.getRef())']);
  assert.deepEqual(Object.fromEntries(p), { shipmentId: 'integer', weightKg: 'decimal', ref: 'uuid' });
});

test('TestData of a service: its edges, values from validation and the database, ids that agree, cases', async () => {
  const src = path.join(home, 'remote', 'shipping-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'shipping-service'), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  const ws = await require('../lib/workspace').open({ project: 'SHIP', repo: 'shipping-service', ref: 'main', url: `file://${src}`, libraries: false });
  withLibraryAndTopics(ws.id);
  const r = await TD.generate(ws.id, { env: 'dev', write: false });
  assert.equal(r.path, 'src/test/java/com/acme/ship/TestData.java');
  assert.equal(r.database, 'ship');
  const kinds = r.edges.map(e => `${e.kind} ${e.use || e.value}`);
  for (const want of ['body TestData.createShipment()', 'body TestData.statusChange()', 'path SHIPMENT_ID', 'kafka-in TestData.orderPaid()', 'kafka-in String.valueOf(SHIPMENT_ID)', 'kafka-out TestData.shipmentSent()', 'repository TestData.shipment()', 'repository TestData.carrier()']) assert.ok(kinds.includes(want), `${want}\n${kinds.join('\n')}`);
  const dict = Object.fromEntries(r.dictionaries.map(d => [d.table, d]));
  // the forms a dictionary takes: an entity read by a repository, the library's DictionaryModel and a subclass
  // filled by plain SQL, an enum named like its table (that lacks a code the table has)
  assert.deepEqual(dict['ship.d_carriers'], { table: 'ship.d_carriers', rows: 3, java: ['entity com.acme.ship.Carrier'], reads: ['CarrierRepository#findByActiveTrue (repository, active only)'], use: ['TestData.carrier(), TestData.carriers(), TestData.activeCarriers()'] });
  assert.deepEqual(dict['ship.d_countries'].java, ['model com.acme.common.dict.DictionaryModel (lib/dict-lib)']);
  assert.deepEqual(dict['ship.d_countries'].reads, ['ShipDictionaries#countries (jdbc)']);
  assert.deepEqual(dict['ship.d_parcel_types'].java, ['model com.acme.ship.ParcelTypeDictionary']);
  assert.deepEqual(dict['ship.d_parcel_types'].reads, ['ShipDictionaries#parcelTypes (jdbc, active only)']);
  assert.deepEqual(dict['ship.d_parcel_types'].valuesFor, ['Parcel.parcelType']);
  assert.deepEqual(dict['ship.d_service_levels'], { table: 'ship.d_service_levels', rows: 4, java: ['enum com.acme.ship.api.ServiceLevel'], enumDiffers: { notInEnum: ['ECONOMY'] } });
  // topics: what the schema and last messages give, and a DTO that lacks a field of its topic's schema
  const edge = (at) => r.edges.find(e => e.at.startsWith(at));
  assert.equal(edge('parcels.scanned').topic, 'schema AVRO v3, 3 last messages');
  assert.equal(edge('parcels.scanned').message, 'TestData.parcelsScannedMessage()');
  assert.deepEqual(edge('ShipmentEvents.kafka').differs, { notInDto: ['carrierName'], from: 'schema JSON v2' });
  const s = r.source;
  // the body: the active carrier of the dictionary, the country as its column (char(2)) and the pattern allow
  assert.match(s, /new CreateShipment\(ORDER_ID, "DHL", List\.of\(parcel\(\)\), apiAddress\(\), ServiceLevel\.STANDARD\)/);
  // the parcel type: a code of the dictionary its name points at
  assert.match(s, /new Parcel\(new BigDecimal\("1\.000"\), 1, "SKU-1", "BOX"\)/);
  assert.match(s, /new Address\("Main Street 1", "Berlin", "DE", "10115", "test@example\.com"\)/);
  // the event: the same order, the personal fields synthetic; sku, qty and the weight's format from the last messages
  assert.match(s, /new OrderPaid\(ORDER_ID, "test@example\.com", List\.of\(line\(\)\), orderPaidAddress\(\), Instant\.parse/);
  assert.match(s, /new OrderPaid\.Line\("SKU-778", 2, "0\.750"\)/);
  assert.match(s, /new OrderPaid\.Address\("Main Street 1", "Berlin", "DE", "10115"\)/);
  assert.doesNotMatch(s, /jane|Lyon|Rue Real|corp\.example/);
  // the scan: the most frequent type of the last messages (a symbol of the Avro enum), their hub code
  assert.match(s, /new ParcelScanned\(SHIPMENT_ID, "IN_HUB", "HUB-FRA-1", Instant\.parse/);
  assert.match(s, /public static String parcelsScannedMessage\(\) \{\n\s+return json\(parcelScanned\(\)\);/);
  // dictionaries as the service reads them: rows into its model classes, the active ones apart
  assert.match(s, /\/\/ dictionary ship\.d_parcel_types: the active rows \(active\)\n\s+public static List<ParcelTypeDictionary> activeParcelTypes\(\) \{\n\s+return List\.of\(\n\s+new ParcelTypeDictionary\(1L, "BOX", "Box"\),\n\s+new ParcelTypeDictionary\(2L, "ENVELOPE", "Envelope"\)\);/);
  assert.match(s, /public static List<DictionaryModel> countries\(\) \{\n\s+return List\.of\(\n\s+new DictionaryModel\(null, "DE", "Germany"\)/);
  assert.match(s, /import com\.acme\.common\.dict\.DictionaryModel;/);
  assert.ok(s.includes('"parcels[0].parcelType not in ship.d_parcel_types", with(createShipment(), "parcels", List.of(with(parcel(), "parcelType", "ZZZ"))), true'));
  // the row: through the constructor, then id and the database default
  assert.match(s, /Shipment x = new Shipment\(ORDER_ID, "DHL", new BigDecimal\("1\.000"\), "DE", ServiceLevel\.STANDARD\);\n\s+set\(x, "id", SHIPMENT_ID\);\n\s+set\(x, "createdAt", OffsetDateTime/);
  // the dictionary entity: a real row; all rows as a list
  assert.match(s, /set\(x, "code", "DHL"\);\n\s+set\(x, "name", "DHL Parcel"\);\n\s+set\(x, "maxWeightKg", new BigDecimal\("31\.500"\)\);\n\s+set\(x, "active", true\);/);
  assert.match(s, /public static List<Carrier> carriers\(\)/);
  assert.match(s, /set\(x, "code", "OLD"\)[^\n]+set\(x, "active", false\)/);
  assert.match(s, /public static List<Carrier> activeCarriers\(\)/);
  // cases: nested only where @Valid cascades, edges valid, broken constraints invalid
  for (const want of ['"carrierCode 11 long", with(createShipment(), "carrierCode", "x".repeat(11)), false',
    '"parcels[0].weightKg 70.000", with(createShipment(), "parcels", List.of(with(parcel(), "weightKg", new BigDecimal("70.000")))), true',
    '"parcels[0].weightKg 70.001", with(createShipment(), "parcels", List.of(with(parcel(), "weightKg", new BigDecimal("70.001")))), false',
    '"to.country not matching", with(createShipment(), "to", with(apiAddress(), "country", "#")), false',
    '"level null", with(createShipment(), "level", null), true',
    '"status null", with(statusChange(), "status", null), false']) assert.ok(s.includes(want), want);
  assert.match(s, /public static final long SHIPMENT_ID = \d+L;/);
  assert.match(s, /public static final long ORDER_ID = \d+L;/);
  assert.match(s, /public static String shipmentsReturnedMessage\(\) \{\n\s+return String\.valueOf\(SHIPMENT_ID\);/);
  // rows: plain SQL, the unique order_id counts up, the FKs to dictionaries point at loaded rows
  assert.deepEqual(r.rows, [{ table: 'ship.shipments', use: 'new TestData.Rows(jdbc).shipment()', why: ['order_id unique', 'carrier_code -> ship.d_carriers (a loaded row)', 'country -> ship.d_countries (a loaded row)'] }]);
  // the skeleton of a service method stubs the dictionary read with the rows the query asks for
  await TD.generate(ws.id, { env: 'dev' });
  const ctx = require('../lib/testgen').context(ws.id, 'ShipmentService#create', { flow: false });
  assert.match(ctx.skeleton, /when\(dictionaries\.parcelTypes\(\)\)\.thenReturn\(TestData\.activeParcelTypes\(\)\);/);
  assert.match(ctx.skeleton, /when\(carriers\.findById\(any\(\)\)\)\.thenReturn\(Optional\.of\(TestData\.carrier\(\)\)\);/);
  const flow = require('../lib/testgen').context(ws.id, 'kafka parcels.scanned');
  assert.match(flow.skeleton, /entry\.onScan\(TestData\.parcelsScannedMessage\(\)\);/);
  assert.match(s, /return jdbc\.queryForObject\("insert into ship\.shipments \(order_id, carrier_code, weight_kg, country\) values \(\?, \?, \?, \?\) returning id", Long\.class, next\(\), "DHL", new BigDecimal\("1\.000"\), "DE"\);/);
});

test('TestData is written while it is what dt wrote; once changed by hand it is left as it is', async () => {
  const W = require('../lib/workspace');
  const ws = W.list().find(w => w.id.startsWith('shipping-service'));
  const first = await TD.generate(ws.id, { env: 'dev', write: true }).catch(e => e);
  assert.ok(!(first instanceof Error), String(first));
  assert.equal(first.written, true);
  const file = path.join(W.checkId(ws.id).path, first.path);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(TD.untouched(text));
  // again: still untouched, written again
  assert.equal((await TD.generate(ws.id, { env: 'dev' })).written, true);
  // a hand edit: kept, and the answer has what dt would write
  W.write(ws.id, first.path, { edits: [{ find: 'return new Parcel(new BigDecimal("1.000"), 1, "SKU-1", "BOX");', replace: 'return new Parcel(new BigDecimal("1.000"), 1, "SKU-MINE", "BOX");' }] });
  const again = await TD.generate(ws.id, { env: 'dev' });
  assert.equal(again.written, false);
  assert.match(again.kept, /changed by hand/);
  assert.match(again.source, /"SKU-1"/);
  assert.match(fs.readFileSync(file, 'utf8'), /"SKU-MINE"/);
});

test('rows of a table without an entity: the parent first, a parameter to share it', async () => {
  const src = path.join(home, 'remote', 'payments-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'payments-service'), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  const ws = await require('../lib/workspace').open({ project: 'PAY', repo: 'payments-service', ref: 'main', url: `file://${src}`, libraries: false });
  const r = await TD.generate(ws.id, { env: 'dev', write: false });
  assert.deepEqual(r.rows.map(x => x.use), ['new TestData.Rows(jdbc).customer()', 'new TestData.Rows(jdbc).payment(customerId)']);
  assert.match(r.source, /public long payment\(\) \{\n\s+return payment\(customer\(\)\);\n\s+\}/);
  assert.match(r.source, /public long payment\(long customerId\) \{\n\s+return jdbc\.queryForObject\("insert into pay\.payments \(customer_id, amount\) values \(\?, \?\) returning id", Long\.class, customerId, new BigDecimal\("10\.00"\)\);/);
  assert.match(r.source, /"insert into pay\.customers \(email\) values \(\?\) returning id", Long\.class, "email-" \+ next\(\) \+ "@example\.com"/);
});

test('the DDL snapshot carries the rows of the dictionary tables', () => {
  const D = require('../lib/ddl');
  const snap = D.snapshot('dev', 'ship', { tables: ['ship.shipments'] });
  assert.deepEqual(snap.tables.sort(), ['ship.d_carriers', 'ship.d_countries', 'ship.d_service_levels', 'ship.shipments']);
  assert.equal(snap.counts.dictionaryRows, 10);
  assert.match(snap.sql, /insert into ship\.d_carriers \(code, name, max_weight_kg, active\) overriding system value values\n  \('DHL', 'DHL Parcel', '31\.500', true\)/);
  // before the FKs, so they hold
  assert.ok(snap.sql.indexOf('insert into ship.d_countries') < snap.sql.indexOf('foreign key') || !/foreign key/i.test(snap.sql.slice(0, snap.sql.indexOf('insert into ship.d_countries'))));
});
