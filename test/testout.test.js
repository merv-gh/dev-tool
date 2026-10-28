// Compact test output: long framework stacks fold to the frames that matter, build logs lose their
// noise but keep the failure, expected/actual come out of the usual assertion messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../lib/testout');

const frames = (pkg, n) => Array.from({ length: n }, (_, i) => `\tat ${pkg}.C${i}.m${i}(C${i}.java:${i + 1})`);
const SPRING = [
  'java.lang.IllegalStateException: Failed to load ApplicationContext for [WebMergedContextConfiguration@1 testClass = com.acme.orders.FlowTest]',
  ...frames('org.springframework.test.context.cache', 12),
  '\tat app//com.acme.orders.FlowTest.placesTheOrder(FlowTest.java:42)',
  ...frames('org.junit.platform.engine.support', 40),
  ...frames('java.base/java.util', 10),
  'Caused by: org.springframework.beans.factory.UnsatisfiedDependencyException: Error creating bean with name \'orderService\': Unsatisfied dependency expressed through constructor parameter 2',
  ...frames('org.springframework.beans.factory.support', 30),
  '\t... 61 more',
  'Caused by: org.springframework.beans.factory.NoSuchBeanDefinitionException: No qualifying bean of type \'com.acme.libs.kafka.EventPublisher\' available: expected at least 1 bean which qualifies as autowire candidate.',
  ...frames('org.springframework.beans.factory.support', 25),
  '\tat com.acme.libs.kafka.EventPublisher.<init>(EventPublisher.java:14)',
  '\t... 80 more',
].join('\n');

test('a 130-line Spring stack: repo frames, the throwing frames, the causes; the rest folded', () => {
  const repo = (cls) => cls.startsWith('com.acme.');
  const s = O.compactStack(SPRING, repo);
  const lines = s.split('\n');
  assert.ok(lines.length <= 30, `${lines.length} lines:\n${s}`);
  assert.match(s, /^java\.lang\.IllegalStateException: Failed to load ApplicationContext/);
  assert.match(s, /\tat com\.acme\.orders\.FlowTest\.placesTheOrder\(FlowTest\.java:42\)/, 'the loader prefix (app//) is dropped');
  assert.match(s, /\t\.\.\. 50 frames: org\.junit\.platform, java\.util\n/, 'framework frames folded, by package');
  assert.match(s, /Caused by: org\.springframework\.beans\.factory\.NoSuchBeanDefinitionException: No qualifying bean of type 'com\.acme\.libs\.kafka\.EventPublisher'/, 'the root cause is kept');
  assert.match(s, /EventPublisher\.<init>\(EventPublisher\.java:14\)/);
  assert.ok(!/C20\.m20/.test(s), 'framework frames in the middle are folded');
  // a very long chain keeps the first exception and the root cause
  const many = O.compactStack([SPRING, ...Array.from({ length: 30 }, (_, i) => `Caused by: x.E${i}: cause ${i}\n\tat com.acme.A.b(A.java:${i})`)].join('\n'), repo, { maxLines: 20 });
  assert.ok(many.split('\n').length <= 21);
  assert.match(many, /^java\.lang\.IllegalStateException/);
  assert.match(many, /cause 29/);
});

test('build logs: banners, downloads, tasks, INFO logs out; the failure kept', () => {
  const maven = [
    '[INFO] Scanning for projects...', '[INFO] Downloading from central: https://repo/x.pom', 'Downloaded from central: https://repo/y.jar (12 kB at 40 kB/s)',
    '  .   ____          _            __ _ _', ' :: Spring Boot ::                (v3.3.5)',
    '2026-10-28T10:00:00.123+03:00  INFO 1234 --- [main] o.s.b.t.c.SpringBootTestContextBootstrapper : Loaded default TestExecutionListener',
    'WARNING: A terminally deprecated method in sun.misc.Unsafe has been called', 'Mockito is currently self-attaching to enable the inline-mock-maker.',
    '[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 1.2 s <<< FAILURE! -- in com.acme.pay.FeeCalculatorTest',
    '[ERROR] com.acme.pay.FeeCalculatorTest.fee -- Time elapsed: 0.01 s <<< FAILURE!', '\tat com.acme.pay.FeeCalculatorTest.fee(FeeCalculatorTest.java:12)',
    '[INFO] BUILD FAILURE', '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.2.5:test',
  ].join('\n');
  const m = O.compactLog(maven);
  assert.ok(!/Downloading|Spring Boot ::|Loaded default|sun\.misc|self-attaching|Scanning/.test(m), m);
  assert.match(m, /Tests run: 2, Failures: 1/);
  assert.match(m, /Failed to execute goal/);
  const gradle = [
    '> Configure project :billing-core', '> Task :billing-core:compileJava UP-TO-DATE', '> Task :billing-core:test FAILED',
    'InvoiceCalculatorTest > vatIsOnTheDiscountedAmount() FAILED', '    org.opentest4j.AssertionFailedError at InvoiceCalculatorTest.java:15',
    '2 tests completed, 1 failed', 'FAILURE: Build failed with an exception.', '* What went wrong:', "Execution failed for task ':billing-core:test'.",
    'Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.', "You can use '--warning-mode all' to show the individual deprecation warnings",
  ].join('\n');
  const g = O.compactLog(gradle);
  assert.ok(!/> Task|> Configure|Deprecated Gradle|warning-mode/.test(g), g);
  assert.match(g, /2 tests completed, 1 failed/);
  assert.match(g, /Execution failed for task ':billing-core:test'/);
  assert.equal(O.compactLog('just\nsome\nlines').split('\n').length, 3, 'nothing recognisable: the last lines as they are');
  const big = Array.from({ length: 500 }, (_, i) => `[ERROR] line ${i}`).join('\n');
  assert.ok(O.compactLog(big).split('\n').length <= 41);
});

test('expected/actual from JUnit, AssertJ, Hamcrest, Spring, Mockito messages', () => {
  assert.deepEqual(O.expectedActual('expected: <0.67> but was: <0.66>'), { expected: '0.67', actual: '0.66' });
  assert.deepEqual(O.expectedActual('JSON path "$.fee" expected:<0.6> but was:<0.59>'), { expected: '0.6', actual: '0.59' });
  assert.deepEqual(O.expectedActual('\nexpected: "SETTLED"\n but was: "NEW"'), { expected: '"SETTLED"', actual: '"NEW"' });
  assert.deepEqual(O.expectedActual('\nExpecting actual:\n  110.00\nto be equal to:\n  108.00\nwhen comparing values using BigDecimalComparator'), { expected: '108.00', actual: '110.00' });
  assert.deepEqual(O.expectedActual('\nExpected: is <3>\n     but: was <2>'), { expected: 'is <3>', actual: 'was <2>' });
  const mock = O.expectedActual('\nArgument(s) are different! Wanted:\nkafkaTemplate.send(\n    "orders.placed",\n    "42"\n);\n-> at FlowTest.java:64\nActual invocations have different arguments at position [1]:\nkafkaTemplate.send(\n    "orders.placed",\n    "43"\n);\n-> at EventPublisher.publish(EventPublisher.java:21)');
  assert.match(mock.expected, /"42"/);
  assert.match(mock.actual, /"43"/);
  assert.equal(O.expectedActual('boom'), null);
  assert.equal(O.compactMessage(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')).split('\n').length, 7);
});
