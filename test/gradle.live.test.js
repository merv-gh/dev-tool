// Gradle for real: a Kotlin-DSL multi-module build (the bug in one module, a controller in another) and
// a Groovy-DSL service. Only the named tests run (--tests), quietly, on a warm daemon; the answer is
// compact (expected/actual, short stacks, no Gradle log). Prints the times.
//   DT_TEST_GRADLE=$(command -v gradle) npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GRADLE = process.env.DT_TEST_GRADLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-gradlelive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const repo = (name) => {
  const src = path.join(home, 'remote', name);
  fs.cpSync(path.join(__dirname, 'fixtures', 'gradle', name), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  return src;
};

const CALC_TEST = `package com.acme.billing.core;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class InvoiceCalculatorTest {
    InvoiceCalculator calc = new InvoiceCalculator();

    @Test
    void vatIsOnTheDiscountedAmount() {
        // 100 - 10% = 90, + 20% VAT = 108
        assertThat(calc.total(List.of(new BigDecimal("60"), new BigDecimal("40")), 10, new BigDecimal("0.20"))).isEqualByComparingTo("108.00");
    }

    @Test
    void noDiscount() {
        assertThat(calc.total(List.of(new BigDecimal("100")), 0, new BigDecimal("0.20"))).isEqualByComparingTo("120.00");
    }
}
`;

test('Gradle: only the named tests, quiet, compact answers; Kotlin DSL multi-module and Groovy DSL', { skip: !GRADLE && 'set DT_TEST_GRADLE', timeout: 900000 }, async () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tests: { gradle: GRADLE } }));
  const W = require('../lib/workspace'), T = require('../lib/tools');
  const ws = await W.open({ project: 'BILL', repo: 'billing', ref: 'main', url: `file://${repo('billing')}`, libraries: false });
  const run = async (a) => { let r = await T.call('test_run', { workspace: ws.id, ...a }); while (r.state === 'running') r = await T.call('test_run', { workspace: ws.id, job: r.job }); return r; };
  const times = {};

  const ctx = await T.call('test_context', { workspace: ws.id, target: 'InvoiceCalculator#total' });
  assert.equal(ctx.test.path, 'billing-core/src/test/java/com/acme/billing/core/InvoiceCalculatorTest.java');
  assert.equal(ctx.setup.buildTool, 'gradle');
  const red = await run({ tests: ['InvoiceCalculatorTest'], files: [{ path: ctx.test.path, content: CALC_TEST }] });
  times.firstRed = red.ms;
  assert.equal(red.mode, 'gradle');
  assert.match(red.command, /:billing-core:test --tests com\.acme\.billing\.core\.InvoiceCalculatorTest/);
  assert.deepEqual([red.outcome, red.counts.tests, red.counts.failed], ['failed', 2, 1], JSON.stringify(red, null, 2));
  const f = red.failures[0];
  assert.equal(f.test, 'InvoiceCalculatorTest#vatIsOnTheDiscountedAmount');
  assert.deepEqual([f.expected, f.actual], ['108.00', '110.00'], 'expected/actual from the report message');
  assert.ok(f.stack.split('\n').length <= 14 && /InvoiceCalculatorTest\.java:15/.test(f.stack), f.stack);
  assert.equal(red.tail, undefined, 'no Gradle log when the reports say it all');

  const again = await run({ tests: ['InvoiceCalculatorTest#vatIsOnTheDiscountedAmount'] });
  times.warmRerunOneMethod = again.ms;
  assert.equal(again.counts.tests, 1, 'one method only');

  const green = await run({ tests: ['InvoiceCalculatorTest'], files: [{ path: 'billing-core/src/main/java/com/acme/billing/core/InvoiceCalculator.java', edits: [{ find: 'BigDecimal vat = sum.multiply(vatRate);', replace: 'BigDecimal vat = discounted.multiply(vatRate);' }] }] });
  times.fixAndRun = green.ms;
  assert.equal(green.outcome, 'passed', JSON.stringify(green, null, 2));

  // a compile error: the Gradle log is the answer, compact
  const broken = await run({ tests: ['InvoiceCalculatorTest'], files: [{ path: ctx.test.path, edits: [{ find: 'void noDiscount() {', replace: 'void noDiscount() { int x = "s";' }] }] });
  assert.equal(broken.outcome, 'compile-error', JSON.stringify(broken, null, 2));
  assert.ok(broken.compile.some(e => /InvoiceCalculatorTest\.java$/.test(e.file)), JSON.stringify(broken.compile));
  assert.ok(broken.tail.split('\n').length <= 40);
  await run({ tests: ['InvoiceCalculatorTest'], files: [{ path: ctx.test.path, content: CALC_TEST }] });

  // a web slice in the other module, with the core module as a project dependency
  const web = await T.call('test_context', { workspace: ws.id, target: 'InvoiceController#total' });
  assert.equal(web.style, 'webmvc');
  const webTest = web.skeleton.replace(/@Test\n    void totalReturnsOk[\s\S]*?\n    }\n/, `@Test
    void totalComesFromTheCalculator() throws Exception {
        when(calculator.total(any(), eq(10), any())).thenReturn(new java.math.BigDecimal("108.00"));
        mvc.perform(post("/invoices/total").contentType(MediaType.APPLICATION_JSON).content("{\\"lines\\": [60, 40], \\"discount\\": 10}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(108.00));
    }
`).replace('import static org.mockito.ArgumentMatchers.any;', 'import static org.mockito.ArgumentMatchers.any;\nimport static org.mockito.ArgumentMatchers.eq;');
  const w = await run({ tests: ['InvoiceControllerTest'], files: [{ path: web.test.path, content: webTest }] });
  times.webSlice = w.ms;
  assert.equal(w.outcome, 'passed', JSON.stringify(w, null, 2));
  assert.match(w.command, /:billing-api:test/);

  const p = await T.call('workspace_patch', { workspace: ws.id });
  assert.ok(p.tests.includes('red-green: InvoiceCalculatorTest#vatIsOnTheDiscountedAmount'), JSON.stringify(p.tests));

  // Groovy DSL, single module, Mockito
  const ws2 = await W.open({ project: 'LED', repo: 'ledger-service', ref: 'main', url: `file://${repo('ledger-service')}`, libraries: false });
  const c2 = await T.call('test_context', { workspace: ws2.id, target: 'Converter#convert' });
  assert.equal(c2.style, 'mockito');
  const t2 = c2.skeleton.replace(/var result = subject\.convert\([^;]*\);[\s\S]*?\n    }/, `when(rates.rate("EUR", "USD")).thenReturn(new BigDecimal("1.0850"));
        assertThat(subject.convert(new BigDecimal("10.00"), "EUR", "USD")).isEqualByComparingTo("10.85");
        verify(rates).rate("EUR", "USD");
    }`).replace(/\n\s*\/\/ Boundaries[\s\S]*?\/\/ \}\n/, '\n');
  const r2 = await T.call('test_run', { workspace: ws2.id, tests: ['ConverterTest'], files: [{ path: c2.test.path, content: t2 }] });
  let r2b = r2; while (r2b.state === 'running') r2b = await T.call('test_run', { workspace: ws2.id, job: r2b.job });
  assert.equal(r2b.outcome, 'passed', JSON.stringify(r2b, null, 2));
  assert.match(r2b.command, / test --tests com\.acme\.ledger\.ConverterTest/);
  console.log(`times (ms): ${JSON.stringify(times)}`);
});

test('a private repository: credentials from gradle.properties in the config folder, ${VAR} from .env, masked', { skip: !GRADLE && 'set DT_TEST_GRADLE', timeout: 900000 }, async () => {
  // the company library, published to a password-protected repository
  const repoDir = path.join(home, 'nexus');
  const lib = path.join(home, 'greeting');
  fs.mkdirSync(path.join(lib, 'com', 'acme', 'libs'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'com', 'acme', 'libs', 'Greeting.java'), 'package com.acme.libs;\npublic final class Greeting {\n    public static String hello(String name) { return "hello, " + name; }\n}\n');
  const jh = process.env.JAVA_HOME || process.env.DT_JAVA_HOME;
  const bin = (t) => (jh ? path.join(jh, 'bin', t) : t);
  execFileSync(bin('javac'), ['--release', '17', '-d', path.join(lib, 'out'), path.join(lib, 'com', 'acme', 'libs', 'Greeting.java')]);
  const art = path.join(repoDir, 'com', 'acme', 'libs', 'greeting', '1.0.0');
  fs.mkdirSync(art, { recursive: true });
  execFileSync(bin('jar'), ['cf', path.join(art, 'greeting-1.0.0.jar'), '-C', path.join(lib, 'out'), '.']);
  fs.writeFileSync(path.join(art, 'greeting-1.0.0.pom'), '<project><modelVersion>4.0.0</modelVersion><groupId>com.acme.libs</groupId><artifactId>greeting</artifactId><version>1.0.0</version></project>');
  // builds on a runner container reach this container by its network address
  const ip = process.env.DT_RUNNER_URL ? Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address : null;
  const nexus = await require('./fake-nexus').start({ dir: repoDir, user: 'ci-reader', password: 'n3xus-s3cret', host: ip || '127.0.0.1' });
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tests: { gradle: GRADLE } }));
    require('../lib/config').reload();
    const W = require('../lib/workspace'), T = require('../lib/tools');
    const ws = await W.open({ project: 'APP', repo: 'nexus-app', ref: 'main', url: `file://${repo('nexus-app')}`, libraries: false });
    const files = [{ path: 'src/test/java/com/acme/app/WelcomeTest.java', content: 'package com.acme.app;\n\nimport org.junit.jupiter.api.Test;\n\nimport static org.assertj.core.api.Assertions.assertThat;\n\nclass WelcomeTest {\n    @Test\n    void shouts() {\n        assertThat(new Welcome().to("ada")).isEqualTo("HELLO, ADA");\n    }\n}\n' }];
    const run = async (a) => { let r = await T.call('test_run', { workspace: ws.id, ...a }); while (r.state === 'running') r = await T.call('test_run', { workspace: ws.id, job: r.job }); return r; };

    // without the machine's settings the build script cannot even be read
    const without = await run({ tests: ['WelcomeTest'], files });
    assert.notEqual(without.outcome, 'passed');
    assert.match(without.tail, /nexusUrl/, without.tail);
    assert.ok(without.hints.some(h => /gradle\.properties/.test(h)), JSON.stringify(without.hints));
    assert.ok(without.tail.split('\n').length <= 40);

    // as on a developer machine: gradle.properties with the repository, the password from .env
    fs.writeFileSync(path.join(home, 'gradle.properties'), `nexusUrl=${nexus.url}\nmavenUser=ci-reader\nmavenPassword=\${NEXUS_PASSWORD}\n`);
    fs.writeFileSync(path.join(home, '.env'), 'NEXUS_PASSWORD=n3xus-s3cret\n');
    require('../lib/config').reload();
    const ok = await run({ tests: ['WelcomeTest'] });
    assert.equal(ok.outcome, 'passed', JSON.stringify(ok, null, 2));
    assert.deepEqual(ok.gradleProperties, [`${path.basename(home)}/gradle.properties`]);
    assert.ok(nexus.requests.some(r => /greeting-1\.0\.0\.jar$/.test(r.path) && r.auth === 'ok'), JSON.stringify(nexus.requests.slice(-5)));
    assert.ok(!JSON.stringify(ok).includes('n3xus-s3cret'), 'the password is never shown');
  } finally { nexus.close(); }
});
