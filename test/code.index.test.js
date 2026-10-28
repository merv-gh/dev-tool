// Code index: trigram grep (same answers as a full scan, literal pieces of regexes), the symbol graph of a
// Spring service, impact radius over code + database (columns included), DDL snapshots from a synced
// catalog, workspaces and their patch, test context and skeletons, test report parsing. No build tools or
// databases needed (test/workspace.live.test.js runs Maven and Postgres).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-code-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { postgres: { pay: 'postgres://x@127.0.0.1:9/pay' } } } }));
// the synced catalog of test/fixtures/pg/pay.sql, as catalog_sync leaves it
fs.mkdirSync(path.join(home, 'cache', 'dev', 'pg'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixtures', 'pg', 'pay.catalog.json'), path.join(home, 'cache', 'dev', 'pg', 'pay.json'));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const FIX = path.join(__dirname, 'fixtures', 'payments-service');
const CI = () => require('../lib/codeindex');

test('grep: the trigram prefilter gives the same hits as reading every file', () => {
  const root = path.join(home, 'gen');
  const words = ['order', 'payment', 'invoice', 'customer', 'refund', 'ledger', 'status', 'amount'];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 150; i++) {
    const dir = path.join(root, 'src', 'main', 'java', 'p' + (i % 7));
    fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    for (let l = 0; l < 40; l++) lines.push(`    ${words[rnd(8)]}_${rnd(50)}.${words[rnd(8)]}(${rnd(1000)}); // ${words[rnd(8)].toUpperCase()} ÄÖ ${rnd(9)}`);
    fs.writeFileSync(path.join(dir, `C${i}.java`), `package p${i % 7};\nclass C${i} {\n${lines.join('\n')}\n}\n`);
  }
  fs.writeFileSync(path.join(root, 'app.yml'), 'kafka:\n  topic: payment_17.created\n');
  CI().build(root, 'GEN/gen', { project: 'GEN', repo: 'gen' });
  const files = CI().walk(root).map(f => ({ path: f.path, text: fs.readFileSync(path.join(root, f.path), 'utf8') }));
  const naive = (re) => files.flatMap(f => f.text.split('\n').map((l, i) => (re.test(l) ? `${f.path}:${i + 1}` : null)).filter(Boolean));
  const cases = [
    ['payment_17', false], ['PAYMENT', false], ['ÄÖ 3', false], ['zz_not_there', false], ['ab', false],
    ['order_\\d+\\.refund\\(', true], ['(invoice|ledger)_4[0-9]\\.', true], ['status_1?2\\.amount', true], ['\\w+_3\\.customer', true], ['^\\s+refund', true], ['C1[0-9]\\b', true],
  ];
  for (const [p, regex] of cases) {
    const r = CI().grep(['GEN/gen'], p, { regex, limit: 100000, perFile: 1000 });
    const want = naive(new RegExp(regex ? p : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.deepEqual(r.hits.map(h => `${h.path}:${h.line}`).sort(), want.sort(), `pattern ${p}`);
    if (p === 'zz_not_there') assert.equal(r.scanned, 0, 'no candidate file is read');
    if (p === 'payment_17') assert.ok(r.scanned < files.length, 'the prefilter skips files');
  }
  assert.equal(CI().required('(ab|cd)\\d|xyz', true), null, 'an alternative without a literal: no prefilter');
  assert.deepEqual(CI().required('(ab|cd)xyz', true), [['abxyz'], ['cdxyz']], 'a group of plain alternatives is spelled out');
  assert.deepEqual(CI().required('(ab|cd)?xyz', true), [['xyz']], 'an optional group only ends the run');
  assert.deepEqual(CI().required('fooBar\\d+baz|qux_\\w', true), [['fooBar', 'baz'], ['qux_']]);
  assert.deepEqual(CI().required('colou?r_name', true), [['colo', 'r_name']]);
  assert.match(CI().grep(['GEN/gen'], 'topic', { glob: '*.yml' }).hits[0].path, /app\.yml/);
});

test('code graph of a Spring service: roles, injection, calls, entity columns, SQL, topics, endpoints', () => {
  CI().build(FIX, 'PAY/payments-service', { project: 'PAY', repo: 'payments-service' });
  const g = CI().load('PAY/payments-service').graph_();
  const cls = (n) => g.classes.find(c => c.name === n);
  const has = (from, to, kind) => g.edges.some(e => e[0] === from && e[1] === to && e[2] === kind);
  assert.deepEqual(['PaymentController', 'PaymentService', 'PaymentRepository', 'BalanceDao', 'SettlementListener', 'Payment', 'CreatePayment'].map(n => cls(n).role), ['controller', 'service', 'repository', 'repository', 'component', 'entity', null]);
  assert.deepEqual(cls('PaymentService').fields.filter(f => f.inject).map(f => f.name), ['payments', 'fees', 'events']);
  assert.deepEqual(cls('CreatePayment').fields.filter(f => f.inject), [], 'record components are not injected');
  assert.equal(cls('BalanceDao').methods.find(m => m.name === 'countsByStatus').ret, 'List<Map<String, Object>>');
  const P = 'com.acme.pay.';
  assert.ok(has(`${P}PaymentService#create`, `${P}FeeCalculator#fee`, 'calls'));
  assert.ok(has(`${P}PaymentService#create`, `${P}PaymentRepository#save`, 'calls'));
  assert.ok(has(`${P}PaymentRepository#save`, `${P}PaymentRepository`, 'member'), 'inherited repository methods are members');
  assert.ok(has(`${P}PaymentService#settle`, `${P}Payment.status`, 'writes'));
  assert.ok(has(`${P}PaymentRepository`, `${P}Payment`, 'repository'));
  assert.ok(has(`${P}Payment`, 'table:pay.payments', 'entity'));
  assert.deepEqual(cls('Payment').fields.map(f => f.column).filter(Boolean), ['id', 'customer_id', 'amount', 'fee', 'status', 'created_at']);
  assert.ok(has(`${P}BalanceDao#balance`, 'pgfn:pay.customer_balance', 'calls'));
  assert.ok(has(`${P}PaymentRepository#pendingFor`, 'table:pay.payments', 'read'));
  assert.ok(has(`${P}SettlementListener#onSettlement`, 'topic:settlements', 'consumes'));
  assert.ok(has('topic:payments.created', `${P}PaymentEvents#created`, 'produced-by'));
  assert.ok(has('endpoint:POST /payments/{}/settle', `${P}PaymentController#settle`, 'handler'));
  assert.deepEqual(g.errors, []);
});

test('impact: method -> callers -> endpoint; column -> entity field, function body, views -> DAO', () => {
  const I = require('../lib/impact');
  const m = I.impact('FeeCalculator#fee', { env: 'dev' });
  assert.deepEqual(m.items.map(i => `${i.depth} ${i.name}`), ['1 PaymentService#create', '2 PaymentController#create', '3 endpoint:POST /payments']);
  assert.deepEqual(m.endpoints, ['POST /payments']);

  const c = I.impact('pay.payments.fee', { env: 'dev' });
  assert.equal(c.kind, 'column');
  assert.deepEqual(c.items.map(i => `${i.depth} ${i.kind} ${i.name}`).sort(), ['1 field Payment.fee', '1 pgfn pgfn:pay.customer_balance', '1 table table:pay.settled_payments', '2 method BalanceDao#balance', '2 table table:pay.customer_totals'].sort());

  const t = I.impact('settlements', { env: 'dev' });
  assert.deepEqual(t.items.map(i => i.name), ['SettlementListener#onSettlement']);
  const e = I.impact('POST /payments/7/settle', { env: 'dev' });
  assert.deepEqual(e.resolved, ['endpoint:POST /payments/{}/settle']);
  const tbl = I.impact('pay.customers', { env: 'dev' });
  assert.ok(tbl.items.some(i => i.id === 'table:pay.payments' && /references/.test(i.via)), 'FKs: payments references customers');
  const none = I.impact('NoSuchThing', { env: 'dev' });
  assert.deepEqual(none.resolved, []);
  // a class: its members and everything that uses them; tests that reach it are listed
  const svc = I.impact('PaymentService', { env: 'dev' });
  assert.ok(svc.items.some(i => i.name === 'SettlementListener#onSettlement'));
  assert.ok(svc.resolved.includes('com.acme.pay.PaymentService#settle'));
});

test('DDL snapshot: all objects in order; a subset closed over FKs, triggers and functions', () => {
  const D = require('../lib/ddl');
  const all = D.snapshot('dev', 'pay', {});
  assert.deepEqual(all.counts, { tables: 4, views: 2, functions: 2, types: 2, sequences: 3 });
  const sql = all.sql;
  const at = (s) => { const i = sql.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
  assert.ok(at('create type pay.refund_reason as enum') < at('create table pay.refunds'));
  assert.ok(at('create sequence if not exists pay.customers_id_seq') < at('create table pay.customers'));
  at('id bigint generated by default as identity not null');
  at("status text default 'NEW'::text not null");
  assert.ok(at('create view pay.settled_payments') < at('create view pay.customer_totals'), 'views after their sources');
  assert.ok(at('alter table pay.payments add constraint payments_customer_id_fkey') > at('create table pay.customers'));
  at('CREATE TRIGGER payments_touch');
  at("comment on column pay.payments.fee is 'Card fee: 2.9% + 0.30, at least 0.50'");
  assert.ok(!/CREATE UNIQUE INDEX customers_pkey/.test(sql), 'indexes of constraints come with the constraint');
  const sub = D.snapshot('dev', 'pay', { tables: ['payments'] });
  assert.deepEqual(sub.tables.sort(), ['pay.customers', 'pay.payments']);
  assert.deepEqual(sub.functions, ['pay.touch']);
  const fn = D.snapshot('dev', 'pay', { functions: ['customer_balance'] });
  assert.deepEqual(fn.tables.sort(), ['pay.customers', 'pay.payments', 'pay.refunds'], 'tables the function reads, and their FK targets');
  assert.deepEqual(D.requested(fn.sql).functions.sort(), ['pay.customer_balance', 'pay.touch']);
  // statements survive a round trip through a file
  assert.equal(require('../lib/testrun').splitSql(all.sql).length, all.statements.length);
});

test('workspace from a git remote: write, edit, patch that applies; test context and skeletons', async () => {
  const src = path.join(home, 'remote', 'payments-service');
  fs.cpSync(FIX, src, { recursive: true });
  const g = (args, cwd = src) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString().trim();
  g(['init', '-q', '-b', 'main']); g(['add', '.']); g(['commit', '-qm', 'init']);
  const W = require('../lib/workspace');
  const ws = await W.open({ project: 'PAY', repo: 'payments-service', ref: 'main', url: `file://${src}` });
  assert.equal(ws.sha, g(['rev-parse', 'HEAD']));
  assert.deepEqual(ws.build, ['pom.xml']);
  assert.throws(() => W.write(ws.id, '../escape.txt', { content: 'x' }), /outside the workspace/);
  assert.throws(() => W.write(ws.id, '.git/config', { content: 'x' }), /off limits/);
  assert.throws(() => W.write(ws.id, 'src/main/java/com/acme/pay/FeeCalculator.java', { edits: [{ find: 'BigDecimal', replace: 'X' }] }), /exactly once/);
  W.write(ws.id, 'src/main/java/com/acme/pay/FeeCalculator.java', { edits: [{ find: 'RoundingMode.DOWN', replace: 'RoundingMode.HALF_UP' }] });

  const T = require('../lib/testgen');
  const svc = T.context(ws.id, 'PaymentService');
  assert.equal(svc.style, 'mockito');
  assert.deepEqual(svc.methods.find(m => m.name === 'create').calls, ['payments.save(...)', 'fees.fee(BigDecimal amount) -> BigDecimal', 'events.created(Payment p) -> void']);
  assert.match(svc.skeleton, /@ExtendWith\(MockitoExtension\.class\)[\s\S]*@Mock\n {4}PaymentRepository payments;[\s\S]*@InjectMocks\n {4}PaymentService subject;/);
  assert.match(svc.skeleton, /var result = subject\.create\(1L, new BigDecimal\("10\.00"\)\);/);
  assert.match(svc.skeleton, /void getTest\(\)/, 'no test method named like a static helper');
  const web = T.context(ws.id, 'PaymentController#settle');
  assert.equal(web.style, 'webmvc');
  assert.match(web.skeleton, /@WebMvcTest\(PaymentController\.class\)[\s\S]*@MockBean\n {4}PaymentService service;[\s\S]*post\("\/payments\/\{id\}\/settle", 1\)/);
  const repo = T.context(ws.id, 'PaymentRepository', { env: 'dev' });
  assert.equal(repo.style, 'jpa');
  assert.equal(repo.ddl.path, 'src/test/resources/dt-schema/pay.sql');
  assert.deepEqual(repo.inserts.map(i => i.sql), ['insert into pay.customers (email) values (?)', 'insert into pay.payments (customer_id, amount) values (?, ?)']);
  const dao = T.context(ws.id, 'BalanceDao', { env: 'dev' });
  assert.deepEqual(dao.ddl.tables.sort(), ['pay.customers', 'pay.payments', 'pay.refunds'], 'the snapshot grows with each test that needs more');
  W.write(ws.id, svc.test.path, { content: svc.skeleton });

  const p = await W.patch(ws.id);
  assert.deepEqual(p.files.map(f => `${f.status} ${f.path}`).sort(), ['added src/test/java/com/acme/pay/PaymentServiceTest.java', 'added src/test/resources/dt-schema/pay.sql', 'modified src/main/java/com/acme/pay/FeeCalculator.java']);
  const check = path.join(home, 'check');
  execFileSync('git', ['clone', '-q', src, check]);
  fs.writeFileSync(path.join(home, 'p.patch'), p.patch);
  execFileSync('git', ['apply', path.join(home, 'p.patch')], { cwd: check });
  assert.match(fs.readFileSync(path.join(check, 'src/main/java/com/acme/pay/FeeCalculator.java'), 'utf8'), /HALF_UP/);
  // the workspace index follows the writes
  W.index(ws.id);
  assert.equal(CI().grep([`work/${ws.id}`], 'class PaymentServiceTest').hits.length, 1);
  await W.drop(ws.id);
  assert.equal(W.list().length, 0);
});

test('test reports: JUnit XML cases, compile errors of Maven/javac/Kotlin, code parts from stack traces', () => {
  const R = require('../lib/testrun');
  const dir = path.join(home, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'TEST-com.acme.pay.FeeCalculatorTest.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.acme.pay.FeeCalculatorTest" tests="3" failures="1" errors="1" skipped="1">
  <testcase name="roundsHalfUpToCents" classname="com.acme.pay.FeeCalculatorTest" time="0.012">
    <failure message="&#10;expected: 0.67&#10; but was: 0.66" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError:
expected: 0.67
	at com.acme.pay.FeeCalculatorTest.roundsHalfUpToCents(FeeCalculatorTest.java:14)
	at com.acme.pay.FeeCalculator.fee(FeeCalculator.java:18)
]]></failure>
  </testcase>
  <testcase name="npe" classname="com.acme.pay.FeeCalculatorTest" time="0.001"><error message="boom" type="java.lang.NullPointerException">java.lang.NullPointerException: boom</error></testcase>
  <testcase name="later" classname="com.acme.pay.FeeCalculatorTest" time="0"><skipped/></testcase>
  <testcase name="ok" classname="com.acme.pay.FeeCalculatorTest" time="0.003"/>
</testsuite>`);
  const cases = R.parseReports([dir], 0);
  assert.deepEqual(cases.map(c => `${c.name}:${c.status}`), ['roundsHalfUpToCents:failed', 'npe:error', 'later:skipped', 'ok:passed']);
  assert.match(cases[0].message, /expected: 0\.67/);
  const g = CI().load('PAY/payments-service').graph_();
  const parts = R.codeParts(FIX, g, cases[0].stack);
  assert.deepEqual(parts.map(p => `${p.file}:${p.line}`), ['src/main/java/com/acme/pay/FeeCalculator.java:18'], 'only frames of classes in the repo (the test class is not in this index)');
  assert.match(parts[0].snippet.text, />\s+18\s+ {8}BigDecimal fee = /);
  const out = `[ERROR] ${FIX}/src/test/java/com/acme/pay/XTest.java:[31,21] cannot find symbol
${FIX}/src/main/java/com/acme/pay/Y.java:7: error: ';' expected
e: file://${FIX}/src/main/kotlin/Z.kt:3:9 Unresolved reference: foo`;
  assert.deepEqual(R.compileErrors(out, FIX).map(e => `${e.file}:${e.line} ${e.message}`), ['src/test/java/com/acme/pay/XTest.java:31 cannot find symbol', "src/main/java/com/acme/pay/Y.java:7 ';' expected", 'src/main/kotlin/Z.kt:3 Unresolved reference: foo']);
  assert.deepEqual(R.plan(FIX, ['src/test/java/com/acme/pay/XTest.java']).tool, 'maven');
});

test('tools: code_search, code_symbols, impact and patch views', async () => {
  process.env.DT_PUBLIC_URL = 'http://127.0.0.1:4999';
  const T = require('../lib/tools');
  const s = await T.call('code_search', { pattern: 'kafkaTemplate.send', repos: 'payments-service' });
  assert.equal(s.total, 1);
  assert.match(s.rows[0].file, /PaymentEvents\.java:18$/);
  const y = await T.call('code_symbols', { q: 'payment settle' });
  assert.ok(y.rows.some(r => r.id === 'com.acme.pay.PaymentService#settle'));
  const i = await T.call('impact', { target: 'FeeCalculator#fee', env: 'dev', repos: 'PAY/*' });
  assert.match(i.view, /\/show\//);
  assert.equal(require('../lib/views').list().filter(v => ['impact', 'patch', 'tests'].includes(v.name) && v.builtin).length, 3);
  const html = require('../lib/views').render('impact', require('../lib/results').load(i.view.split('/').pop()).data, { title: 'x' });
  assert.match(html, /PaymentService#create/);
});
