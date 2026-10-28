// Testcontainers through the runner, for real: run inside the dt container with the runner service up
// (compose jdk profile: JDK, the host's Docker socket). A Maven service whose test starts Postgres with
// Testcontainers; test_run goes to the runner; the doctor sees the runner's JDK and Docker.
//   docker compose run --rm -v "$PWD:/src:ro" -w /src -e DT_TEST_RUNNER=1 dt node --test test/runner.live.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const on = process.env.DT_TEST_RUNNER && process.env.DT_RUNNER_URL;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-runnerlive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('a Testcontainers test runs on the runner against the host\'s Docker', { skip: !on && 'inside the dt container with the runner: DT_TEST_RUNNER=1', timeout: 1200000 }, async () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
  const src = path.join(home, 'remote', 'tc-service');
  fs.cpSync(path.join(__dirname, 'fixtures', 'tc-service'), src, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: src, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  g('init', '-q', '-b', 'main'); g('add', '.'); g('commit', '-qm', 'x');
  const d = await require('../lib/doctor').check();
  const by = Object.fromEntries(d.checks.map(c => [c.check, c]));
  assert.equal(by.runner?.status, 'ok', JSON.stringify(by.runner));
  assert.equal(by['Docker (Testcontainers)']?.status, 'ok', JSON.stringify(by['Docker (Testcontainers)']));

  const ws = await require('../lib/workspace').open({ project: 'TC', repo: 'tc-service', ref: 'main', url: `file://${src}` });
  const T = require('../lib/tools');
  let r = await T.call('test_run', { workspace: ws.id, tests: ['TotalsTest'], files: [{ path: 'src/test/java/com/acme/tc/TotalsTest.java', content: `package com.acme.tc;

import java.sql.DriverManager;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class TotalsTest {
    @Container
    static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void sumsInPostgres() throws Exception {
        try (var c = DriverManager.getConnection(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword())) {
            assertThat(new Totals().sum(c, 40, 2)).isEqualTo(42);
        }
    }
}
` }] });
  while (r.state === 'running') r = await T.call('test_run', { workspace: ws.id, job: r.job });
  assert.equal(r.outcome, 'passed', JSON.stringify(r, null, 2));
  // gradle-style check of the patch: dt's own files stay out
  const p = await T.call('workspace_patch', { workspace: ws.id });
  assert.deepEqual(p.files.map(f => f.path), ['src/test/java/com/acme/tc/TotalsTest.java']);
});
