// The whole loop on a real build and database, as the model would drive it: a workspace of a Spring Boot
// service, impact of a method, test context, a written test that finds a bug, the fix, a DB test against
// the DDL snapshot in a throwaway database, the patch. Needs Maven (or a mvnw) and a scratch Postgres:
//   docker run -d --name dt-pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:16-alpine
//   DT_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55432/postgres DT_TEST_MAVEN=$(command -v mvn) npm test
// The first run downloads Spring Boot 3.3 test dependencies into ~/.m2 unless they are there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PG = process.env.DT_TEST_PG_URL, MVN = process.env.DT_TEST_MAVEN;
const skip = !PG || !MVN ? 'set DT_TEST_PG_URL and DT_TEST_MAVEN' : false;

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-wslive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('workspace -> impact -> test_context -> failing test -> fix -> DB test -> patch', { skip, timeout: 900000 }, async () => {
  const scratch = new URL(PG); scratch.pathname = '/postgres';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: { dev: { postgres: { pay: PG } } },
    tests: { maven: MVN, pgUrl: scratch.toString().replace(/\/postgres$/, '/dt_scratch') },
  }));
  const postgres = require('postgres');
  const admin = postgres(PG, { onnotice: () => {} });
  await admin.unsafe(fs.readFileSync(path.join(__dirname, 'fixtures', 'pg', 'pay.sql'), 'utf8'));
  await admin.unsafe('drop database if exists dt_scratch').then(() => admin.unsafe('create database dt_scratch'));
  await admin.end();
  await require('../lib/indexer').refresh({ env: 'dev', what: 'pg' }).promise;

  // the "Bitbucket" repo: the fixture service in a local git repo
  const src = path.join(home, 'remote', 'payments-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'payments-service'), src, { recursive: true });
  const g = (args) => execFileSync('git', args, { cwd: src, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString().trim();
  g(['init', '-q', '-b', 'main']); g(['add', '.']); g(['commit', '-qm', 'init']);
  const ws = await require('../lib/workspace').open({ project: 'PAY', repo: 'payments-service', ref: 'main', url: `file://${src}` });
  const T = require('../lib/tools');
  // as the model does: a long run answers "running" with a job id, asking again waits for it
  const run = async (args) => { let r = await T.call('test_run', args); while (r.state === 'running') r = await T.call('test_run', { workspace: args.workspace, job: r.job }); return r; };

  const imp = await T.call('impact', { target: 'FeeCalculator#fee', env: 'dev', repos: ws.id });
  assert.deepEqual(imp.endpoints, ['POST /payments']);
  assert.ok(imp.nearest.some(l => /PaymentService#create/.test(l)));

  const ctx = await T.call('test_context', { workspace: ws.id, target: 'FeeCalculator' });
  assert.equal(ctx.style, 'unit');
  assert.equal(ctx.test.path, 'src/test/java/com/acme/pay/FeeCalculatorTest.java');

  // the test the model writes from the context: the comment says "rounded half up"
  await T.call('workspace_write', { workspace: ws.id, path: ctx.test.path, content: `package com.acme.pay;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FeeCalculatorTest {
    FeeCalculator fees = new FeeCalculator();

    @Test
    void roundsHalfUpToCents() {
        assertThat(fees.fee(new BigDecimal("12.70"))).isEqualByComparingTo("0.67");
    }

    @Test
    void chargesAtLeastTheMinimum() {
        assertThat(fees.fee(new BigDecimal("1.00"))).isEqualByComparingTo("0.50");
    }

    @Test
    void rejectsZero() {
        assertThatThrownBy(() -> fees.fee(BigDecimal.ZERO)).isInstanceOf(IllegalArgumentException.class);
    }
}
` });
  const failed = await run({ workspace: ws.id, tests: ['FeeCalculatorTest'] });
  assert.equal(failed.outcome, 'failed', JSON.stringify(failed, null, 2));
  assert.deepEqual([failed.counts.tests, failed.counts.passed, failed.counts.failed], [3, 2, 1]);
  assert.deepEqual([failed.failures[0].expected, failed.failures[0].actual], ['0.67', '0.66']);
  assert.ok(failed.parts.some(p => p.file === 'src/test/java/com/acme/pay/FeeCalculatorTest.java'), 'the failing assertion is a part');

  await T.call('workspace_write', { workspace: ws.id, path: 'src/main/java/com/acme/pay/FeeCalculator.java', edits: [{ find: 'RoundingMode.DOWN', replace: 'RoundingMode.HALF_UP' }] });
  const fixed = await run({ workspace: ws.id, tests: ['FeeCalculatorTest'] });
  assert.equal(fixed.outcome, 'passed', JSON.stringify(fixed, null, 2));

  // a DB test: the context writes the DDL snapshot, the run loads it into a throwaway database
  const dctx = await T.call('test_context', { workspace: ws.id, target: 'BalanceDao', env: 'dev' });
  assert.equal(dctx.style, 'jdbc');
  assert.deepEqual(dctx.ddl.functions.sort(), ['pay.customer_balance', 'pay.touch']);
  assert.match(dctx.skeleton, /@JdbcTest/);
  await T.call('workspace_write', { workspace: ws.id, path: dctx.test.path, content: dctx.skeleton.replace(/    @Test\n    void balance\(\) \{[\s\S]*?\n    \}\n/, `    @Test
    void balanceIsSettledMinusFeesMinusRefunds() {
        long c = jdbc.queryForObject("insert into pay.customers (email) values ('a@example.com') returning id", Long.class);
        long p = jdbc.queryForObject("insert into pay.payments (customer_id, amount, fee, status) values (?, 100.00, 3.20, 'SETTLED') returning id", Long.class, c);
        jdbc.update("insert into pay.payments (customer_id, amount, fee) values (?, 50.00, 1.75)", c);
        jdbc.update("insert into pay.refunds (payment_id, reason, amount) values (?, 'duplicate', 10.00)", p);
        assertThat(subject.balance(c)).isEqualByComparingTo("86.80");
    }
`) });
  const dbRun = await run({ workspace: ws.id, tests: ['BalanceDaoTest'], env: 'dev', ddl_path: dctx.ddl.path });
  assert.equal(dbRun.outcome, 'passed', JSON.stringify(dbRun, null, 2));
  assert.deepEqual(dbRun.database.failedStatements, []);
  assert.equal(dbRun.counts.tests, 2);

  const p = await T.call('workspace_patch', { workspace: ws.id });
  assert.deepEqual(p.files.map(f => f.path).sort(), ['src/main/java/com/acme/pay/FeeCalculator.java', 'src/test/java/com/acme/pay/BalanceDaoTest.java', 'src/test/java/com/acme/pay/FeeCalculatorTest.java', 'src/test/resources/dt-schema/pay.sql']);
  assert.match(p.patch, /-.*RoundingMode\.DOWN[\s\S]*\+.*RoundingMode\.HALF_UP/);
  // the patch applies to the original commit
  const check = path.join(home, 'apply');
  execFileSync('git', ['clone', '-q', src, check]);
  fs.writeFileSync(path.join(home, 'x.patch'), require('../lib/results').load(p.view.split('/').pop()).data.patch);
  execFileSync('git', ['apply', '--check', path.join(home, 'x.patch')], { cwd: check });
  await require('../lib/pg').closeAll();
});
