// Real new-resource pipeline: source scratch PG -> guarded read-only capture -> resources ->
// two replay PG databases -> Maven/JUnit business code. Kafka is saved envelopes, not a broker.
// DT_TEST_PG_URL=... DT_TEST_MAVEN=/path/to/mvn DT_JAVA_HOME=/path/to/jdk21 node --test test/reproduction.live.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const PG = process.env.DT_TEST_PG_URL, MVN = process.env.DT_TEST_MAVEN;
const skip = !PG || !MVN ? 'set DT_TEST_PG_URL and DT_TEST_MAVEN' : false;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-reproduction-jvm-'));
process.env.DT_HOME = home;
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_WORK_DIR', 'DT_BUILD_DIR', 'DT_REPOS_DIR', 'DT_PLUGINS_DIR', 'DT_TOOLS', 'DT_RUNNER_URL']) delete process.env[key];
process.env.DT_GIT_DIR = path.join(home, 'git');
process.env.DT_RATE_PER_SEC = '0';
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const put = (relative, content) => { const f = path.join(home, relative); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
const config = sources => put('config.json', JSON.stringify({ envs: { dev: { postgres: sources || {} } }, tests: { maven: MVN, pgUrl: PG, javaHome: process.env.DT_JAVA_HOME || process.env.JAVA_HOME } }));

const POM = `<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
<modelVersion>4.0.0</modelVersion>
<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.5</version><relativePath/></parent>
<groupId>example</groupId><artifactId>reproduction-resource-integration</artifactId><version>1.0.0</version>
<properties><java.version>17</java.version></properties>
<dependencies>
<dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><scope>runtime</scope></dependency>
<dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></dependency>
<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
</dependencies></project>`;
const JAVA = `package example;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.sql.*;

public final class ReleaseEngine {
  public record Receipt(long tenantId, String orderId, BigDecimal amount, String status) {}
  static Connection connection(String prefix) throws SQLException {
    return DriverManager.getConnection(System.getenv(prefix + "_URL"), System.getenv(prefix + "_USERNAME"), System.getenv(prefix + "_PASSWORD"));
  }
  public Receipt release(long tenant, String orderId, JsonNode envelope) throws Exception {
    for (String part : new String[] { "key", "value" }) {
      JsonNode p = envelope.path(part);
      if (p.path("tenantId").asLong(-1) != tenant || !p.path("orderId").asText().equals(orderId)) throw new IllegalArgumentException("event identity does not match tenant and order");
    }
    if (!envelope.path("value").path("type").asText().equals("PAID")) throw new IllegalArgumentException("expected paid event");
    try (Connection orders = connection("ORDERS_DATASOURCE"); Connection billing = connection("BILLING_DATASOURCE")) {
      orders.setAutoCommit(false); billing.setAutoCommit(false);
      try {
        long account; BigDecimal amount;
        try (PreparedStatement s = orders.prepareStatement("select account_id, amount from sales.orders where tenant_id=? and id=? and status='PAID'")) {
          s.setLong(1, tenant); s.setLong(2, Long.parseLong(orderId));
          try (ResultSet r = s.executeQuery()) { if (!r.next()) throw new IllegalStateException("no paid order for tenant"); account=r.getLong(1); amount=r.getBigDecimal(2); }
        }
        if (amount.compareTo(new BigDecimal(envelope.path("value").path("amount").asText())) != 0) throw new IllegalArgumentException("event amount differs from database amount");
        try (PreparedStatement s = orders.prepareStatement("select enabled from sales.accounts where tenant_id=? and id=?")) {
          s.setLong(1, tenant); s.setLong(2, account);
          try (ResultSet r=s.executeQuery()) { if (!r.next() || !r.getBoolean(1)) throw new IllegalStateException("account is disabled"); }
        }
        try (PreparedStatement s = billing.prepareStatement("select credit_limit, status from risk.accounts where tenant_id=? and id=?")) {
          s.setLong(1, tenant); s.setLong(2, account);
          try (ResultSet r=s.executeQuery()) { if (!r.next() || !"APPROVED".equals(r.getString(2)) || r.getBigDecimal(1).compareTo(amount)<0) throw new IllegalStateException("insufficient credit"); }
        }
        try (PreparedStatement s = orders.prepareStatement("update sales.orders set status='RELEASED' where tenant_id=? and id=?")) {
          s.setLong(1,tenant); s.setLong(2,Long.parseLong(orderId)); if(s.executeUpdate()!=1) throw new IllegalStateException("order update count");
        }
        try (PreparedStatement s = billing.prepareStatement("update pay.payments set amount=?, status='CAPTURED' where tenant_id=? and order_id=?")) {
          s.setBigDecimal(1,amount); s.setLong(2,tenant); s.setLong(3,Long.parseLong(orderId)); if(s.executeUpdate()!=1) throw new IllegalStateException("payment update count");
        }
        // These disposable sources do not claim a distributed transaction; all validation
        // precedes either commit, and tests assert the resulting state of both databases.
        orders.commit(); billing.commit();
        return new Receipt(tenant,orderId,amount,"RELEASED");
      } catch (Exception e) { orders.rollback(); billing.rollback(); throw e; }
    }
  }
}`;
const JUNIT = `package example;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class ReleaseFixtureTest {
  static final ObjectMapper JSON = new ObjectMapper();
  static final String ORDER = "9007199254740993";
  static JsonNode original;
  @BeforeAll static void loadVerifiedResourceEnvelopes() throws Exception {
    Path fixture=Path.of(System.getenv("DT_FIXTURE_PATH"));
    JsonNode manifest=JSON.readTree(fixture.resolve("manifest.json").toFile());
    assertTrue(manifest.path("complete").asBoolean());
    Path eventFile=fixture.resolve(manifest.path("topics").path("orders.paid").path("directory").asText()).resolve("messages.jsonl");
    List<String> lines=Files.readAllLines(eventFile); assertEquals(1,lines.size()); original=JSON.readTree(lines.get(0));
    assertEquals(ORDER,original.path("key").path("orderId").asText());
    assertEquals("9007199254740995",original.path("offset").asText());
    Map<String,String> names=new LinkedHashMap<>();
    try(Connection a=ReleaseEngine.connection("ORDERS_DATASOURCE");Connection b=ReleaseEngine.connection("BILLING_DATASOURCE")) {
      assertNotEquals(a.getCatalog(),b.getCatalog()); assertTrue(a.getCatalog().startsWith("dt_test_")); assertTrue(b.getCatalog().startsWith("dt_test_"));
      names.put("orders",a.getCatalog()); names.put("billing",b.getCatalog());
    }
    JSON.writeValue(Path.of("target","replay-databases.json").toFile(),names);
  }
  @BeforeEach void resetOnlyDisposableReplayState() throws Exception {
    try(Connection a=ReleaseEngine.connection("ORDERS_DATASOURCE");Connection b=ReleaseEngine.connection("BILLING_DATASOURCE");Statement x=a.createStatement();Statement y=b.createStatement()) {
      x.executeUpdate("update sales.orders set status='PAID'");
      y.executeUpdate("update pay.payments set status='PENDING',amount=0.000000");
      y.executeUpdate("update risk.accounts set credit_limit=150.000001,status='APPROVED'");
    }
  }
  void assertState(String orderStatus,String paymentStatus,String amount) throws Exception {
    try(Connection a=ReleaseEngine.connection("ORDERS_DATASOURCE");Connection b=ReleaseEngine.connection("BILLING_DATASOURCE");Statement x=a.createStatement();Statement y=b.createStatement();ResultSet order=x.executeQuery("select tenant_id,id,status,amount from sales.orders");ResultSet payment=y.executeQuery("select tenant_id,order_id,status,amount from pay.payments")) {
      assertTrue(order.next()); assertEquals(11,order.getLong(1)); assertEquals(ORDER,order.getString(2)); assertEquals(orderStatus,order.getString(3)); assertEquals(new BigDecimal("100.000001"),order.getBigDecimal(4)); assertFalse(order.next());
      assertTrue(payment.next()); assertEquals(11,payment.getLong(1)); assertEquals(ORDER,payment.getString(2)); assertEquals(paymentStatus,payment.getString(3)); assertEquals(new BigDecimal(amount),payment.getBigDecimal(4)); assertFalse(payment.next());
    }
  }
  @Test void releasesExactAmountAndWritesBothDatabases() throws Exception {
    ReleaseEngine.Receipt receipt=new ReleaseEngine().release(11,ORDER,original);
    assertEquals(11,receipt.tenantId()); assertEquals(ORDER,receipt.orderId()); assertEquals(new BigDecimal("100.000001"),receipt.amount()); assertEquals("RELEASED",receipt.status());
    assertState("RELEASED","CAPTURED","100.000001");
  }
  @Test void rejectsDifferentTenantWithoutAnyWrites() throws Exception {
    ObjectNode wrong=original.deepCopy(); ((ObjectNode)wrong.path("key")).put("tenantId",22); ((ObjectNode)wrong.path("value")).put("tenantId",22);
    assertThrows(IllegalArgumentException.class,()->new ReleaseEngine().release(11,ORDER,wrong)); assertState("PAID","PENDING","0.000000");
  }
  @Test void rejectsChangedEventAmountWithoutAnyWrites() throws Exception {
    ObjectNode wrong=original.deepCopy(); ((ObjectNode)wrong.path("value")).put("amount","100.000002");
    assertThrows(IllegalArgumentException.class,()->new ReleaseEngine().release(11,ORDER,wrong)); assertState("PAID","PENDING","0.000000");
  }
  @Test void rejectsInsufficientActualCreditWithoutAnyWrites() throws Exception {
    try(Connection b=ReleaseEngine.connection("BILLING_DATASOURCE");Statement s=b.createStatement()) { s.executeUpdate("update risk.accounts set credit_limit=99.000000"); }
    assertThrows(IllegalStateException.class,()->new ReleaseEngine().release(11,ORDER,original)); assertState("PAID","PENDING","0.000000");
  }
  @AfterAll static void reportActualPortableScenarioEffects() throws Exception {
    String packagePath=System.getenv("DT_SCENARIO_PACKAGE"); if(packagePath==null) return;
    JsonNode scenario=JSON.readTree(Path.of(packagePath).toFile());
    try(Connection a=ReleaseEngine.connection("ORDERS_DATASOURCE");Connection b=ReleaseEngine.connection("BILLING_DATASOURCE");Statement x=a.createStatement();Statement y=b.createStatement()) {
      x.executeUpdate("update sales.orders set status='PAID'"); y.executeUpdate("update pay.payments set status='PENDING',amount=0.000000"); y.executeUpdate("update risk.accounts set credit_limit=150.000001,status='APPROVED'");
    }
    ReleaseEngine.Receipt actual=new ReleaseEngine().release(11,ORDER,original);
    Map<String,Object> observed=new LinkedHashMap<>();
    observed.put("receipt",Map.of("tenantId",actual.tenantId(),"orderId",actual.orderId(),"amount",actual.amount().toPlainString(),"status",actual.status()));
    try(Connection a=ReleaseEngine.connection("ORDERS_DATASOURCE");Connection b=ReleaseEngine.connection("BILLING_DATASOURCE");Statement x=a.createStatement();Statement y=b.createStatement();ResultSet order=x.executeQuery("select tenant_id,id,status,amount from sales.orders");ResultSet payment=y.executeQuery("select tenant_id,order_id,status,amount from pay.payments")) {
      List<Object> rows=new ArrayList<>(); while(order.next()) rows.add(Map.of("tenantId",order.getLong(1),"orderId",order.getString(2),"status",order.getString(3),"amount",order.getBigDecimal(4).toPlainString())); observed.put("order-write",rows);
      rows=new ArrayList<>(); while(payment.next()) rows.add(Map.of("tenantId",payment.getLong(1),"orderId",payment.getString(2),"status",payment.getString(3),"amount",payment.getBigDecimal(4).toPlainString())); observed.put("payment-write",rows);
    }
    JSON.writeValue(Path.of(System.getenv("DT_SCENARIO_OUTPUT")).toFile(),Map.of("version",1,"artifact",scenario.path("sha256").asText(),"actions",List.of("release"),"observed",observed));
  }
}`;

test('captured resources execute real two-database Java business code and saved Kafka envelopes', { skip, timeout: 900000 }, async () => {
  config();
  const postgres = require('postgres'), admin = postgres(PG, { max: 1, onnotice: () => {} });
  const DB = require('../lib/testdb'), R = require('../lib/reproduction');
  const sourceNames = [], runId = crypto.randomBytes(6).toString('hex');
  try {
    const commerce = await DB.create(`src${runId}commerce`, [
      'create schema sales',
      'create table sales.accounts(tenant_id bigint not null,id bigint not null,enabled boolean not null,primary key(tenant_id,id))',
      'create table sales.orders(tenant_id bigint not null,id bigint not null,account_id bigint not null,status text not null,amount numeric(20,6) not null,primary key(tenant_id,id),foreign key(tenant_id,account_id) references sales.accounts(tenant_id,id))',
      'insert into sales.accounts values(11,7,true),(22,7,true)',
      "insert into sales.orders values(11,9007199254740993,7,'PAID',100.000001),(22,9007199254740993,7,'PAID',200.000002)",
    ]); sourceNames.push(commerce.database); assert.deepEqual(commerce.errors, []);
    const billing = await DB.create(`src${runId}billing`, [
      'create schema risk', 'create schema pay',
      'create table risk.accounts(tenant_id bigint not null,id bigint not null,credit_limit numeric(20,6) not null,status text not null,primary key(tenant_id,id))',
      'create table pay.payments(tenant_id bigint not null,order_id bigint not null,status text not null,amount numeric(20,6) not null,primary key(tenant_id,order_id))',
      "insert into risk.accounts values(11,7,150.000001,'APPROVED'),(22,7,250.000002,'BLOCKED')",
      "insert into pay.payments values(11,9007199254740993,'PENDING',0.000000),(22,9007199254740993,'OTHER',20.000000)",
    ]); sourceNames.push(billing.database); assert.deepEqual(billing.errors, []);
    const sourceUrl = name => { const u = new URL(PG); u.pathname = '/' + name; return u.toString(); };
    config({ commerce: sourceUrl(commerce.database), billing: sourceUrl(billing.database) }); require('../lib/config').reload();
    const indexed = await require('../lib/pg').sync('dev', { log: () => {} });
    assert.ok(indexed.every(d => !d.error), 'real source schema indexing succeeds');
    put('cache/dev/kafka/orders.paid.json', JSON.stringify({ topic: 'orders.paid', keySchema: { type: 'JSON', schema: { type: 'object', properties: { tenantId: { type: 'integer' }, orderId: { type: 'string' } } } }, valueSchema: { type: 'JSON', schema: { type: 'object', properties: { tenantId: { type: 'integer' }, orderId: { type: 'string' }, amount: { type: 'string' }, type: { type: 'string' } } } }, fields: { tenantId: 'number', orderId: 'string', amount: 'string', type: 'string' } }));
    const orderId = '9007199254740993';
    const envelope = tenantId => ({ partition: 1, offset: tenantId === 11 ? '9007199254740995' : '9007199254740996', timestamp: '1793145600000', key: { tenantId, orderId }, value: { tenantId, orderId, amount: tenantId === 11 ? '100.000001' : '200.000002', type: 'PAID' }, headers: { schemaVersion: '3' } });
    const input = { env: 'dev', seeds: [{ db: 'commerce', table: 'sales.orders', where: { tenant_id: 11, id: orderId } }], relations: [
      { from: { db: 'commerce', table: 'sales.orders', columns: ['tenant_id', 'account_id'] }, to: { db: 'billing', table: 'risk.accounts', columns: ['tenant_id', 'id'] }, required: true, evidence: 'ReleaseEngine checks exact tenant/account credit' },
      { from: { db: 'commerce', table: 'sales.orders', columns: ['tenant_id', 'id'] }, to: { db: 'billing', table: 'pay.payments', columns: ['tenant_id', 'order_id'] }, required: true, evidence: 'ReleaseEngine updates exact tenant/order payment' },
    ], topics: [{ topic: 'orders.paid', matches: [
      { path: 'key.tenantId', from: { db: 'commerce', table: 'sales.orders', column: 'tenant_id' } },
      { path: 'key.orderId', from: { db: 'commerce', table: 'sales.orders', column: 'id' } },
    ] }] };
    // No PG adapter override: production guarded read-only transactions read the source DBs.
    const captured = await R.capture(input, { messages: async () => ({ messages: [envelope(11), envelope(22)], windows: [{ partition: 1, from: '9007199254740995', highExclusive: '9007199254740997' }], truncated: false }) });
    assert.equal(captured.complete, true, JSON.stringify(captured.gaps));
    assert.equal(captured.counts.rows, 4); assert.equal(captured.counts.messages, 1);
    assert.equal(captured.rows['commerce:sales.orders'][0].id, orderId);
    assert.equal(captured.rows['commerce:sales.orders'][0].amount, '100.000001');
    assert.ok(Object.values(captured.rows).every(rows => rows.every(row => String(row.tenant_id) === '11')));
    const src = path.join(home, 'source');
    put('source/pom.xml', POM); put('source/src/main/java/example/ReleaseEngine.java', JAVA); put('source/src/test/java/example/ReleaseFixtureTest.java', JUNIT);
    const git = (...args) => execFileSync('git', args, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'synthetic reproduction integration');
    const ws = await require('../lib/workspace').open({ project: 'TEST', repo: 'reproduction-service', ref: 'main', url: `file://${src}`, libraries: false });
    const exported = R.exportFixture(ws.id, captured, { name: 'release' });
    const verified = R.loadFixture(ws.id, exported.path);
    assert.deepEqual(Object.keys(verified.databases).sort(), ['billing', 'commerce']);
    const T = require('../lib/tools');
    let result = await T.call('test_run', { workspace: ws.id, tests: ['ReleaseFixtureTest'], fixture_path: exported.path, fixture_bindings: { commerce: 'ORDERS_DATASOURCE', billing: 'BILLING_DATASOURCE' }, mode: 'build' });
    while (result.state === 'running') result = await T.call('test_run', { workspace: ws.id, job: result.job });
    assert.equal(result.outcome, 'passed', JSON.stringify({ outcome: result.outcome, failures: result.failures, compile: result.compile, tail: result.tail, hints: result.hints }, null, 2));
    assert.equal(result.mode, 'build');
    assert.deepEqual(result.counts, { tests: 4, passed: 4, failed: 0, errors: 0, skipped: 0 });
    const replayNames = JSON.parse(fs.readFileSync(path.join(home, ws.path, 'target/replay-databases.json'), 'utf8'));
    assert.equal(new Set(Object.values(replayNames)).size, 2);
    for (const name of Object.values(replayNames)) assert.equal((await admin`select datname from pg_database where datname = ${name}`).length, 0, 'test_run removes replay DBs after real Java execution');
    const sourceStatus = await require('../lib/pg').query('dev', 'select status, amount from sales.orders where tenant_id = $1 and id = $2', { db: 'commerce', params: [11, orderId] });
    assert.equal(sourceStatus.rows[0].status, 'PAID', 'only replay databases were changed by Java');
    assert.equal(sourceStatus.rows[0].amount, '100.000001');
    assert.deepEqual(R.loadFixture(ws.id, exported.path).files, verified.files, 'Java consumed resources without modifying verified files');
    // The portable runtime consumes the same resources and checks independently collected real
    // database effects, in addition to the project's four business assertions. No test result alone
    // is accepted as evidence that this scenario contract passed.
    const State = require('../lib/scenario-state'), Scenario = require('../lib/scenario'), Package = require('../lib/scenario-package');
    const states = Object.keys(captured.rows).map((key, index) => ({ id: `db-${index}`, kind: 'pg', target: { db: key.split(':')[0], table: key.slice(key.indexOf(':') + 1) }, required: true, actions: ['release'], provenance: [{ source: 'live-capture' }], resolution: { status: 'resolved' } }));
    states.push({ id: 'paid-event', kind: 'kafka', target: { topic: 'orders.paid' }, required: true, actions: ['release'], provenance: [{ source: 'saved-envelope' }], resolution: { status: 'resolved' } });
    const inventory = { version: 1, service: 'release-service', env: 'dev', states, gaps: [], actions: [{ id: 'release', kind: 'method', target: 'example.ReleaseEngine#release', required: true, input: { known: true }, dependencies: states.map(s => s.id), expectations: ['receipt', 'order-write', 'payment-write'] }], expectations: [
      { id: 'receipt', kind: 'return', target: 'example.ReleaseEngine#release', action: 'release', required: true },
      { id: 'order-write', kind: 'pg', target: { db: 'commerce', table: 'sales.orders' }, action: 'release', required: true },
      { id: 'payment-write', kind: 'pg', target: { db: 'billing', table: 'pay.payments' }, action: 'release', required: true },
    ] };
    const state = await State.captureState(State.planState(inventory, Object.fromEntries(states.map(s => [s.id, { value: s.kind === 'pg' ? captured.rows[`${s.target.db}:${s.target.table}`] : captured.events['orders.paid'].messages }]))), { mask: false });
    const actions = Scenario.actions(inventory, { bindings: { release: { tenantId: 11, orderId, event: captured.events['orders.paid'].messages[0] } } });
    const receipt = { tenantId: 11, orderId, amount: '100.000001', status: 'RELEASED' };
    const expectations = Scenario.expectations(inventory, { bindings: { receipt: { match: { op: 'exact', value: receipt } }, 'order-write': { match: { op: 'exact', value: [receipt] } }, 'payment-write': { match: { op: 'exact', value: [{ ...receipt, status: 'CAPTURED' }] } } } });
    const profilePath = 'release.runtime.json';
    const workspaceRoot = require('../lib/workspace').checkId(ws.id).path;
    fs.writeFileSync(path.join(workspaceRoot, profilePath), JSON.stringify({ version: 1, adapter: 'test-run', tests: ['ReleaseFixtureTest'], mode: 'build', report: 'target/scenario-observations.json', fixtureBindings: { commerce: 'ORDERS_DATASOURCE', billing: 'BILLING_DATASOURCE' } }));
    const artifact = Package.create({ workspace: ws.id, name: 'portable-release', inventory, state, actions, expectations, fixturePath: exported.path, profile: profilePath });
    const imported = Package.importPackage(ws.id, artifact);
    const portable = await require('../lib/scenario-runtime').run(ws.id, imported.path);
    assert.equal(portable.ok, true, JSON.stringify(portable));
    assert.equal(portable.proof.level, 'build'); assert.equal(portable.proof.expectationsChecked, true); assert.equal(portable.proof.runtimeReadsVerified, false);
    assert.equal(portable.checks.passed, 3); assert.equal(portable.result.counts.tests, 4);
    const changed = structuredClone(artifact); changed.contract.expectations.expectations.find(e => e.id === 'receipt').match.value.amount = '100.000002'; delete changed.sha256; changed.sha256 = Package.digest(changed);
    const wrong = Package.importPackage(ws.id, changed, { directory: 'src/test/resources/dt-scenarios/wrong-expectation' });
    const negative = await require('../lib/scenario-runtime').run(ws.id, wrong.path);
    assert.equal(negative.result.outcome, 'passed', 'project JUnit tests still pass');
    assert.equal(negative.ok, false, 'independent wrong package expectation fails actual service scenario');
    assert.ok(negative.checks.results.some(c => c.id === 'receipt' && !c.ok));
    console.log(JSON.stringify({ integration: 'captured-resources-to-real-java', sourceDatabases: 2, replayDatabases: 2, capturedRows: captured.counts.rows, savedKafkaEnvelopes: captured.counts.messages, mode: result.mode, counts: result.counts, ms: result.ms, replayCleanupVerified: true }));
  } finally {
    await require('../lib/pg').closeAll();
    try { for (const name of sourceNames) await DB.drop(name); }
    finally { await admin.end({ timeout: 2 }); }
  }
});
