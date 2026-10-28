// Compile checks after a write, with a JDK but no Maven: a small jar stands in for the classpath (a fake
// JUnit, AssertJ, Spring and Jakarta), the warm compiler checks the file, the clear fixes are applied
// (imports from the jar and the JDK, static imports, javax -> jakarta, @MockBean -> @MockitoBean,
// throws Exception) and the rest is offered (which Money to import, a method that is not there).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-check-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_RUNNER_URL']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const JDK = spawnSync('javac', ['-version']).status === 0;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const LIB = {
  'org/springframework/stereotype/Component.java': 'package org.springframework.stereotype; public @interface Component {}',
  'org/junit/jupiter/api/Test.java': 'package org.junit.jupiter.api; public @interface Test {}',
  'org/assertj/core/api/Assertions.java': 'package org.assertj.core.api; public class Assertions { public static Check assertThat(Object o) { return new Check(); } public static class Check { public Check isEqualByComparingTo(String s) { return this; } } }',
  'org/springframework/test/context/bean/override/mockito/MockitoBean.java': 'package org.springframework.test.context.bean.override.mockito; public @interface MockitoBean {}',
  'jakarta/persistence/Entity.java': 'package jakarta.persistence; public @interface Entity {}',
  'com/x/money/Money.java': 'package com.x.money; public class Money {}',
  'org/y/Money.java': 'package org.y; public class Money {}',
};

test('the class index reads jar directories itself', { skip: !JDK && 'no JDK' }, () => {
  const J = require('../lib/javacheck');
  const jar = buildJar();
  const names = J.zipEntries(jar);
  assert.ok(names.includes('org/y/Money.class') && names.includes('com/x/money/Money.class'));
  const idx = J.jarIndex([jar]);
  assert.deepEqual(idx.Money.sort(), ['com.x.money.Money', 'org.y.Money']);
});

test('fixes: one clear import is applied, several are offered, a test method throws Exception', () => {
  const J = require('../lib/javacheck');
  const text = 'package com.acme;\n\nimport java.util.List;\n\nclass ATest {\n    @Test\n    void a() {\n        Files.readString(null);\n    }\n}\n';
  const known = new Set(['org.junit.jupiter.api.Test', 'com.x.Money', 'org.y.Money']);
  const index = { Test: ['org.junit.jupiter.api.Test'], Money: ['com.x.Money', 'org.y.Money'] };
  const d = (line, code, message) => ({ kind: 'ERROR', line, code, message });
  const r = J.fixesFor(text, [d(6, 'compiler.err.cant.resolve', 'cannot find symbol\n  symbol:   class Test\n  location: class ATest'), d(8, 'compiler.err.cant.resolve.location', 'cannot find symbol\n  symbol:   variable Files\n  location: class ATest'), d(8, 'compiler.err.cant.resolve', 'cannot find symbol\n  symbol:   class Money')], { index, known, own: ['com.acme.'], graph: null });
  assert.match(r.text, /import org\.junit\.jupiter\.api\.Test;/);
  assert.match(r.text, /import java\.nio\.file\.Files;/);
  assert.equal(r.fixed.length, 2);
  assert.equal(r.suggestions[0].options.length, 2);
  assert.equal(r.suggestions[0].options[0].edits.length, 1);
  const t = J.fixesFor(r.text, [d(10, 'compiler.err.unreported.exception.need.to.catch.or.throw', 'unreported exception java.io.IOException; must be caught or declared to be thrown')], { index, known, own: [], graph: null });
  assert.match(t.text, /void a\(\) throws Exception \{/);
});

test('check after a write: fixed in the file, the rest with ready edits, then clean', { skip: !JDK && 'no JDK', timeout: 120000 }, async () => {
  const J = require('../lib/javacheck');
  const W = require('../lib/workspace');
  const src = path.join(home, 'remote', 'payments-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'payments-service'), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  const ws = await W.open({ project: 'PAY', repo: 'payments-service', ref: 'main', url: `file://${src}`, libraries: false });
  const root = path.join(home, ws.path);
  // the classpath as a prepare would leave it: here the small jar
  const major = Number((spawnSync('javac', ['-version'], { encoding: 'utf8' }).stdout.match(/javac (\d+)/) || [])[1]);
  fs.mkdirSync(path.join(home, 'cache', 'work'), { recursive: true });
  fs.writeFileSync(path.join(home, 'cache', 'work', `${ws.id}.check.json`), JSON.stringify({ '.': { classpath: [buildJar()], processorpath: [], sources: [path.join(root, 'src/main/java'), path.join(root, 'src/test/java')].filter(fs.existsSync), release: 17, buildHash: J.buildHash(root), javaMajor: major, javaHome: null } }));

  const file = 'src/test/java/com/acme/pay/FeeCheckTest.java';
  W.write(ws.id, file, { content: `package com.acme.pay;

import javax.persistence.Entity;

class FeeCheckTest {
    @MockBean FeeCalculator other;

    @Entity static class Row {}

    @Test
    void fee() {
        BigDecimal amount = new BigDecimal("1.00");
        assertThat(new FeeCalculator().fee(amount)).isEqualByComparingTo("0.50");
        Files.readString(Path.of("x"));
    }
}
` });
  const t0 = Date.now();
  let r = await J.check(ws.id, [file]);
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const want of ['import jakarta.persistence.Entity;', 'import java.math.BigDecimal;', 'import static org.assertj.core.api.Assertions.assertThat;', 'import org.springframework.test.context.bean.override.mockito.MockitoBean;', 'import java.nio.file.Files;', 'import java.nio.file.Path;', 'import org.junit.jupiter.api.Test;', '@MockitoBean FeeCalculator', 'void fee() throws Exception {']) assert.ok(text.includes(want), `${want}\n${text}`);
  assert.ok(r.fixed.length >= 8, r.fixed.join('\n'));
  const first = Date.now() - t0;

  // what needs a choice: ready edits; a method that is not there: what the class has
  W.write(ws.id, file, { edits: [{ find: '        Files.readString', replace: '        Money m = null;\n        new FeeCalculator().feee(amount);\n        Files.readString' }] });
  const t1 = Date.now();
  r = await J.check(ws.id, [file]);
  const again = Date.now() - t1;
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2, JSON.stringify(r.errors));
  const money = r.suggestions.find(s => /Money is in 2 packages/.test(s.why));
  assert.ok(money, JSON.stringify(r.suggestions, null, 2));
  assert.ok(r.suggestions.some(s => /FeeCalculator has no feee: fee\?/.test(s.why)), JSON.stringify(r.suggestions, null, 2));
  // take a suggestion as it is, fix the typo: clean
  W.write(ws.id, file, { edits: [...money.options.find(o => o.import === 'com.x.money.Money').edits, { find: '.feee(', replace: '.fee(' }] });
  r = await J.check(ws.id, [file]);
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  console.log(`compile check: first ${first} ms (JVM start + fixes, 4 rounds), then ${again} ms`);
  assert.ok(again < 5000, `${again} ms`);

  // fix=false: the file stays as written, the fixes come as one ready edit list
  const plain = 'src/test/java/com/acme/pay/PlainTest.java';
  const written = 'package com.acme.pay;\n\nclass PlainTest {\n    @Test\n    void fee() {\n        assertThat(new BigDecimal("1")).isEqualByComparingTo("1");\n    }\n}\n';
  W.write(ws.id, plain, { content: written });
  r = await J.check(ws.id, [plain], { fix: false });
  assert.equal(fs.readFileSync(path.join(root, plain), 'utf8'), written);
  assert.equal(r.ok, false);
  const clear = r.suggestions.find(s => /fix=false/.test(s.why));
  assert.ok(clear?.edits.length, JSON.stringify(r.suggestions, null, 2));
  W.write(ws.id, plain, { edits: clear.edits });
  r = await J.check(ws.id, [plain]);
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  assert.equal(r.fixed, undefined);
});

test('edits between two texts: each finds once, applied in order they give the new text', () => {
  const { editsBetween } = require('../lib/javacheck');
  const a = 'package x;\n\nimport a.B;\n\nclass T {\n  @Test\n  void t() {\n  }\n  @Test\n  void t() {\n  }\n}';
  const b = 'package x;\n\nimport a.B;\nimport org.junit.jupiter.api.Test;\n\nclass T {\n  @Test\n  void t() {\n  }\n  @Test\n  void t() throws Exception {\n  }\n}';
  let t = a;
  for (const e of editsBetween(a, b)) { assert.equal(t.split(e.find).length, 2, e.find); t = t.replace(e.find, e.replace); }
  assert.equal(t, b);
});

function buildJar() {
  const dir = path.join(home, 'lib');
  const jar = path.join(home, 'fake.jar');
  if (fs.existsSync(jar)) return jar;
  for (const [f, s] of Object.entries(LIB)) { fs.mkdirSync(path.dirname(path.join(dir, 'src', f)), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', f), s); }
  execFileSync('javac', ['-d', path.join(dir, 'out'), ...Object.keys(LIB).map(f => path.join(dir, 'src', f))]);
  execFileSync('jar', ['cf', jar, '-C', path.join(dir, 'out'), '.']);
  return jar;
}

test('after a run: strict stubs, a missing property, a missing bean come back as ready edits', () => {
  const J = require('../lib/javacheck');
  const root = fs.mkdtempSync(path.join(home, 'hints-'));
  const tf = 'src/test/java/com/acme/pay/PayTest.java';
  fs.mkdirSync(path.join(root, path.dirname(tf)), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/main/resources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/main/java/com/acme/pay'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/main/java/com/acme/pay/FeeCalculator.java'), 'package com.acme.pay; class FeeCalculator {}');
  fs.writeFileSync(path.join(root, 'src/main/resources/application.yml'), 'pay:\n  fee:\n    rate: 0.029\n  other: x\n');
  const text = 'package com.acme.pay;\n\nimport org.junit.jupiter.api.Test;\nimport org.springframework.test.context.bean.override.mockito.MockitoBean;\n\nclass PayTest {\n    @MockitoBean PaymentRepository repo;\n\n    @Test\n    void settles() {\n        when(repo.find(1L)).thenReturn(null);\n    }\n}\n';
  fs.writeFileSync(path.join(root, tf), text);
  const cases = [
    { class: 'com.acme.pay.PayTest', name: 'settles', status: 'error', message: 'org.mockito.exceptions.misusing.UnnecessaryStubbingException: \nUnnecessary stubbings detected.\nFollowing stubbings are unnecessary (click to navigate to relevant line of code):\n  1. -> at com.acme.pay.PayTest.settles(PayTest.java:11)\nPlease remove unnecessary stubbings' },
    { class: 'com.acme.pay.PayTest', name: 'ctx', status: 'error', message: 'java.lang.IllegalStateException: Failed to load ApplicationContext', stack: 'Caused by: java.lang.IllegalArgumentException: Could not resolve placeholder \'pay.fee.rate\' in value "${pay.fee.rate}"' },
    { class: 'com.acme.pay.PayTest', name: 'ctx2', status: 'error', message: 'Failed to load ApplicationContext', stack: "NoSuchBeanDefinitionException: No qualifying bean of type 'com.acme.pay.FeeCalculator' available" },
  ];
  const h = J.runHints('none', root, cases);
  const stub = h.find(x => /never used/.test(x.why));
  assert.equal(stub.edits[0].replace.trim(), 'lenient().when(repo.find(1L)).thenReturn(null);');
  assert.match(stub.edits[1].replace, /import static org\.mockito\.Mockito\.lenient;/);
  const prop = h.find(x => /no property pay\.fee\.rate/.test(x.why));
  assert.match(prop.why, /0\.029, from the application properties/);
  assert.equal(prop.edits[0].replace, '@TestPropertySource(properties = "pay.fee.rate=0.029")\nclass PayTest {');
  const bean = h.find(x => /no bean com\.acme\.pay\.FeeCalculator/.test(x.why));
  assert.match(bean.why, /a class of the service: @Import it/);
  assert.match(bean.edits[0].replace, /@MockitoBean FeeCalculator feeCalculator;/);
  // the edits apply as they are
  let t = text;
  for (const e of [...prop.edits]) { assert.equal(t.split(e.find).length, 2, e.find); t = t.replace(e.find, e.replace); }
  assert.match(t, /import org\.springframework\.test\.context\.TestPropertySource;/);
  assert.equal(J.propertyValue(root, 'pay.other'), 'x');
  assert.equal(J.propertyValue(root, 'pay.none'), 'TODO');
});

test('which import: the file\'s own packages, then well-known libraries over obscure ones', () => {
  const { pick } = require('../lib/javacheck');
  assert.equal(pick(['org.aspectj.weaver.ast.Test', 'org.junit.jupiter.api.Test'], []), 'org.junit.jupiter.api.Test');
  assert.equal(pick(['org.junit.Test', 'org.junit.jupiter.api.Test'], []), null);
  assert.equal(pick(['org.junit.Test', 'org.junit.jupiter.api.Test'], [], 'import org.junit.jupiter.params.ParameterizedTest;\n'), 'org.junit.jupiter.api.Test');
  assert.equal(pick(['java.util.List', 'io.vavr.collection.List'], []), 'java.util.List');
  assert.equal(pick(['com.acme.pay.Money', 'org.joda.money.Money'], ['com.acme.']), 'com.acme.pay.Money');
  assert.equal(pick(['com.x.Money', 'org.y.Money'], []), null);
});
