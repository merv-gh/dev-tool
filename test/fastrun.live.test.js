// Fast runs for real (Maven + JDK): red test, the fix written and run in one call, a Spring slice, then
// the full build; the patch has the proof. Prints the times. DT_TEST_MAVEN=$(command -v mvn) npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MVN = process.env.DT_TEST_MAVEN;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fastlive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const FEE_TEST = `package com.acme.pay;

import java.math.BigDecimal;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class FeeCalculatorTest {
    FeeCalculator fees = new FeeCalculator();

    @ParameterizedTest
    @CsvSource({ "12.70, 0.67", "1.00, 0.50", "100.00, 3.20" })
    void feeIsRoundedHalfUp(String amount, String fee) {
        assertThat(fees.fee(new BigDecimal(amount))).isEqualByComparingTo(fee);
    }
}
`;
const WEB_TEST = `package com.acme.pay;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(PaymentController.class)
class PaymentControllerTest {
    @Autowired MockMvc mvc;
    @MockBean PaymentService service;

    @Test
    void settleCallsTheService() throws Exception {
        when(service.settle(7L)).thenReturn(new Payment(1L, new BigDecimal("10.00"), new BigDecimal("0.59")));
        mvc.perform(post("/payments/{id}/settle", 7)).andExpect(status().isOk()).andExpect(jsonPath("$.fee").value(0.59));
        verify(service).settle(7L);
    }
}
`;

test('fast loop: red, fix in one call, green in seconds; full build; red-green in the patch', { skip: !MVN && 'set DT_TEST_MAVEN', timeout: 900000 }, async () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tests: { maven: MVN } }));
  const src = path.join(home, 'remote', 'payments-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'payments-service'), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  const ws = await require('../lib/workspace').open({ project: 'PAY', repo: 'payments-service', ref: 'main', url: `file://${src}`, libraries: false });
  const T = require('../lib/tools');
  const run = async (a) => { let r = await T.call('test_run', { workspace: ws.id, ...a }); while (r.state === 'running') r = await T.call('test_run', { workspace: ws.id, job: r.job }); return r; };
  const times = {};

  const red = await run({ tests: ['FeeCalculatorTest'], files: [{ path: 'src/test/java/com/acme/pay/FeeCalculatorTest.java', content: FEE_TEST }] });
  times.prepareAndRed = red.ms;
  assert.equal(red.mode, 'fast');
  assert.equal(red.prepared, true);
  assert.deepEqual([red.outcome, red.counts.failed, red.counts.passed], ['failed', 1, 2], JSON.stringify(red, null, 2));
  assert.ok(red.parts.some(p => p.file.endsWith('FeeCalculatorTest.java')));

  const again = await run({ tests: ['FeeCalculatorTest'] });
  times.rerun = again.ms;
  assert.equal(again.compiled, 0);

  const green = await run({ tests: ['FeeCalculatorTest'], files: [{ path: 'src/main/java/com/acme/pay/FeeCalculator.java', edits: [{ find: 'RoundingMode.DOWN', replace: 'RoundingMode.HALF_UP' }] }] });
  times.fixAndRun = green.ms;
  assert.equal(green.outcome, 'passed', JSON.stringify(green, null, 2));
  assert.ok(green.compiled >= 1);

  const web = await run({ tests: ['PaymentControllerTest'], files: [{ path: 'src/test/java/com/acme/pay/PaymentControllerTest.java', content: WEB_TEST }] });
  times.springSlice = web.ms;
  assert.equal(web.outcome, 'passed', JSON.stringify(web, null, 2));

  // a compile error in a fast run points at the line
  const broken = await run({ tests: ['PaymentControllerTest'], files: [{ path: 'src/test/java/com/acme/pay/PaymentControllerTest.java', edits: [{ find: 'verify(service).settle(7L);', replace: 'verify(service).settle(7L) // no semicolon' }] }] });
  assert.equal(broken.outcome, 'compile-error');
  assert.ok(broken.compile.some(e => e.file === 'src/test/java/com/acme/pay/PaymentControllerTest.java' && e.line === 23), JSON.stringify(broken.compile));
  await run({ tests: ['PaymentControllerTest'], files: [{ path: 'src/test/java/com/acme/pay/PaymentControllerTest.java', content: WEB_TEST }] });

  const build = await run({ tests: ['FeeCalculatorTest', 'PaymentControllerTest'], mode: 'build' });
  times.fullBuild = build.ms;
  assert.equal(build.outcome, 'passed', JSON.stringify(build, null, 2));
  assert.equal(build.counts.tests, 4);

  const p = await T.call('workspace_patch', { workspace: ws.id });
  assert.ok(p.tests.includes('red-green: FeeCalculatorTest#feeIsRoundedHalfUp[1]'), JSON.stringify(p.tests));
  assert.ok(p.tests.includes('green-only: FeeCalculatorTest#feeIsRoundedHalfUp[2]'));
  assert.ok(!p.notes || !p.notes.some(n => /full build/.test(n)), JSON.stringify(p.notes));
  console.log(`times (ms): ${JSON.stringify(times)}`);
});
