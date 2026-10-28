// Flow tests for real: the "commons" libraries are built into a scratch Maven repository (as Nexus would
// have them), the service's workspace pulls their sources through a fake Bitbucket, and the tests written
// from test_context run with Maven: the library controller dispatches to the service's handler, and
// what leaves the service (Kafka through the library publisher, HTTP, JPA, the library's JDBC audit) is
// checked on the mocks. Needs Maven 3.9+ (for maven.repo.local.tail): DT_TEST_MAVEN=$(command -v mvn).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MVN = process.env.DT_TEST_MAVEN;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flowslive-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_GIT_DIR = path.join(home, 'git');
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('flow tests through a library controller run green with Maven', { skip: !MVN && 'set DT_TEST_MAVEN', timeout: 900000 }, async () => {
  const FIX = path.join(__dirname, 'fixtures', 'bitbucket');
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).toString().trim();
  const repos = {};
  for (const key of ['LIB/commons', 'SHOP/orders-service']) {
    const dir = path.join(home, 'remote', key);
    fs.cpSync(path.join(FIX, key), dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
    if (key === 'LIB/commons') git(dir, 'tag', 'v1.2.0');
    repos[key] = dir;
  }
  // the libraries as the company repository has them; everything else read from ~/.m2
  const m2 = path.join(home, 'm2');
  const tail = path.join(os.homedir(), '.m2', 'repository');
  execFileSync(MVN, ['-B', '-q', '-ntp', 'install', '-DskipTests', `-Dmaven.repo.local=${m2}`, `-Dmaven.repo.local.tail=${tail}`], { cwd: repos['LIB/commons'], stdio: 'pipe' });
  const bb = await require('./fake-bitbucket').start({ repos });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: { dev: {} }, bitbucket: { url: bb.url, token: bb.token }, passports: { internalGroups: ['com.acme'] },
    tests: { maven: MVN, mavenRepo: m2, args: [`-Dmaven.repo.local.tail=${tail}`] },
  }));
  try {
    await require('../lib/bbindex').build({ perSec: 1000 });
    const realGit = require('../lib/git');
    const gitImpl = {
      fetchRef: (p, r, ref, o = {}) => realGit.fetchRef(p, r, ref, { ...o, url: `file://${repos[`${p}/${r}`]}` }),
      fetchFirst: (p, r, refs, o = {}) => realGit.fetchFirst(p, r, refs, { ...o, url: `file://${repos[`${p}/${r}`]}` }),
    };
    const ws = await require('../lib/workspace').open({ project: 'SHOP', repo: 'orders-service', ref: 'main', url: `file://${repos['SHOP/orders-service']}`, git: gitImpl });
    const T = require('../lib/tools');
    const run = async (args) => { let r = await T.call('test_run', args); while (r.state === 'running') r = await T.call('test_run', { workspace: args.workspace, job: r.job }); return r; };

    // the library endpoint, as the model would write it from the context
    const c = await T.call('test_context', { workspace: ws.id, target: 'POST /process/order' });
    assert.equal(c.style, 'flow');
    assert.ok(c.rules.some(r => /lifecycle/.test(r)));
    const head = c.skeleton.slice(0, c.skeleton.indexOf('    @Test'));
    await T.call('workspace_write', { workspace: ws.id, path: c.test.path, content: `${head.replace('import static org.mockito.ArgumentMatchers.any;', 'import static org.mockito.ArgumentMatchers.any;\nimport static org.mockito.ArgumentMatchers.anyString;')}    @Test
    void placesTheOrderAndTellsEveryone() throws Exception {
        when(orders.save(any())).thenAnswer(inv -> {
            Order o = inv.getArgument(0);
            java.lang.reflect.Field id = Order.class.getDeclaredField("id");
            id.setAccessible(true);
            id.set(o, 42L);
            return o;
        });
        mvc.perform(post("/process/{type}", "order")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\\"customer\\": \\"c-1\\", \\"amount\\": 12.50}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value("42"));
        verify(restTemplate).postForObject(eq("http://payments-service/api/authorize"), any(Object.class), eq(String.class));
        verify(kafkaTemplate).send(eq("orders.placed"), eq("42"), org.mockito.ArgumentMatchers.contains("\\"amount\\":12.5"));
        verify(jdbc).update(anyString(), eq((Object) "order"));
    }

    @Test
    void unknownTypeIsNotFoundAndNothingLeaves() throws Exception {
        mvc.perform(post("/process/{type}", "refund").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isNotFound());
        verifyNoInteractions(orders, restTemplate, jdbc);
        verify(kafkaTemplate, never()).send(anyString(), any(), any());
    }
}
` });
    const web = await run({ workspace: ws.id, tests: [path.basename(c.test.path, '.java')] });
    assert.equal(web.outcome, 'passed', JSON.stringify(web, null, 2));
    assert.equal(web.counts.tests, 2);

    // the scheduled job: no web layer, the job called as the scheduler would
    const j = await T.call('test_context', { workspace: ws.id, target: 'ReconcileJob#run' });
    const jhead = j.skeleton.slice(0, j.skeleton.indexOf('    @Test'));
    await T.call('workspace_write', { workspace: ws.id, path: j.test.path, content: `${jhead}    @Test
    void settlesWhatPaymentsSettled() throws Exception {
        Order paid = new Order("c-1", java.math.BigDecimal.TEN), open = new Order("c-2", java.math.BigDecimal.ONE);
        for (Object[] x : new Object[][] { { paid, 1L }, { open, 2L } }) { java.lang.reflect.Field id = Order.class.getDeclaredField("id"); id.setAccessible(true); id.set(x[0], x[1]); }
        when(orders.findByStatus("NEW")).thenReturn(java.util.List.of(paid, open));
        when(orders.findById(1L)).thenReturn(java.util.Optional.of(paid));
        when(restTemplate.getForObject("http://payments-service/api/payments/1", String.class)).thenReturn("SETTLED");
        when(restTemplate.getForObject("http://payments-service/api/payments/2", String.class)).thenReturn("PENDING");
        entry.run();
        verify(orders).save(paid);
        verify(orders, never()).save(open);
        org.assertj.core.api.Assertions.assertThat(paid.getStatus()).isEqualTo("SETTLED");
    }
}
` });
    const job = await run({ workspace: ws.id, tests: [path.basename(j.test.path, '.java')] });
    assert.equal(job.outcome, 'passed', JSON.stringify(job, null, 2));
  } finally { bb.close(); }
});
