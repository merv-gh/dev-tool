// Compile checks for real: a Maven (Spring Boot 3.3) and a Gradle service, the classpath prepared by
// their builds, the warm compiler on the runner when there is one. A test written with the usual slips
// (no imports, @MockitoBean on a Boot without it, a checked exception) comes back fixed and compiling;
// a call that does not exist comes back as an error with what the class has. Prints the times.
//   in the dt container (compose jdk profile): DT_TEST_MAVEN=/opt/jdk/maven/bin/mvn DT_TEST_GRADLE=/opt/gradle/bin/gradle
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MVN = process.env.DT_TEST_MAVEN, GRADLE = process.env.DT_TEST_GRADLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-checklive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const repo = (from, name) => {
  const src = path.join(home, 'remote', name);
  fs.cpSync(path.join(__dirname, 'fixtures', from), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  return src;
};

async function scenario(T, { from, name, file, body, wrong }) {
  const W = require('../lib/workspace');
  const J = require('../lib/javacheck');
  const ws = await W.open({ project: 'PAY', repo: name, ref: 'main', url: `file://${repo(from, name)}`, libraries: false });
  // as after workspace_open: the classpath in the background
  const t0 = Date.now();
  J.warm(ws.id);
  const tools = require('../lib/tools');
  let r = await tools.call('workspace_write', { workspace: ws.id, path: file, content: body });
  const first = Date.now() - t0;
  assert.equal(r.compile?.ok, true, JSON.stringify(r.compile, null, 2));
  const text = fs.readFileSync(path.join(home, ws.path, file), 'utf8');
  const t1 = Date.now();
  r = await tools.call('workspace_write', { workspace: ws.id, path: file, edits: [{ find: wrong[0], replace: wrong[1] }] });
  const again = Date.now() - t1;
  assert.equal(r.compile.ok, false);
  T.diagnostic(`${name}: first check ${first} ms (with the classpath prepare), then ${again} ms (compiler ${r.compile.compileMs} ms)`);
  return { text, r, ws };
}

test('Maven: a Spring test with the usual slips is fixed and compiles; a missing method is shown', { skip: !MVN && 'set DT_TEST_MAVEN', timeout: 900000 }, async (t) => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tests: { maven: MVN, compileWaitMs: 600000 } }));
  require('../lib/config').reload();
  const { text, r } = await scenario(t, {
    from: 'payments-service', name: 'payments-service', file: 'src/test/java/com/acme/pay/PaymentControllerCheckTest.java',
    body: `package com.acme.pay;

@WebMvcTest(PaymentController.class)
class PaymentControllerCheckTest {
    @Autowired MockMvc mvc;
    @MockitoBean PaymentService service;

    @Test
    void settles() {
        when(service.settle(7L)).thenReturn(new Payment(1L, new BigDecimal("10.00"), new BigDecimal("0.59")));
        mvc.perform(post("/payments/{id}/settle", 7)).andExpect(status().isOk());
        verify(service).settle(7L);
    }
}
`,
    wrong: ['verify(service).settle(7L);', 'verify(service).settel(7L);'],
  });
  for (const want of ['import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;', 'import org.springframework.test.web.servlet.MockMvc;', 'import java.math.BigDecimal;', '@MockBean PaymentService', 'import org.springframework.boot.test.mock.mockito.MockBean;', 'import static org.mockito.Mockito.when;', 'import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;', 'import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;', 'void settles() throws Exception {']) assert.ok(text.includes(want), `${want}\n${text}`);
  assert.equal(r.compile.errors.length, 1, JSON.stringify(r.compile));
  assert.ok(r.compile.suggestions.some(s => /PaymentService has no settel: settle\?/.test(s.why)), JSON.stringify(r.compile.suggestions));
});

test('Gradle: the classpath from an init script; a test with no imports compiles after the check', { skip: !GRADLE && 'set DT_TEST_GRADLE', timeout: 900000 }, async (t) => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tests: { gradle: GRADLE, compileWaitMs: 600000 } }));
  require('../lib/config').reload();
  const { text, r } = await scenario(t, {
    from: 'gradle/ledger-service', name: 'ledger-service', file: 'src/test/java/com/acme/ledger/ConverterCheckTest.java',
    body: `package com.acme.ledger;

class ConverterCheckTest {
    @Test
    void converts() {
        RateClient rates = mock(RateClient.class);
        assertThat(new Converter(rates)).isNotNull();
        List<String> none = new ArrayList<>();
        assertThat(none).isEmpty();
    }
}
`,
    wrong: ['assertThat(none).isEmpty();', 'assertThat(none).isEmpty();\n        Money m = null;'],
  });
  for (const want of ['import org.junit.jupiter.api.Test;', 'import java.util.List;', 'import java.util.ArrayList;', 'import static org.mockito.Mockito.mock;', 'import static org.assertj.core.api.Assertions.assertThat;']) assert.ok(text.includes(want), `${want}\n${text}`);
  assert.ok(r.compile.suggestions.some(s => /no class Money/.test(s.why)) || r.compile.suggestions.some(s => /Money is in/.test(s.why)), JSON.stringify(r.compile));
});
