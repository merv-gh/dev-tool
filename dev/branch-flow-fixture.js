// Disposable real Git service: baseline, incomplete feature and independently checked behavior.
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const FILE = 'src/main/java/example/PaymentService.java';
const source = feature => `package example;

public final class PaymentService {
    private final Ledger ledger;
    private final Events events;

    public PaymentService(Ledger ledger, Events events) {
        this.ledger = ledger;
        this.events = events;
    }

    public long submit(String tenant, long gross, long rebate) {
        if (tenant == null || tenant.isBlank() || gross <= 0) {
            throw new IllegalArgumentException("invalid payment");
        }
${feature ? `        if (rebate < 0 || rebate > gross) {
            throw new IllegalArgumentException("invalid rebate");
        }
        long payable = gross - rebate;
        ledger.save(tenant, gross);
        events.publish(tenant, payable);
        return payable;` : `        ledger.save(tenant, gross);
        events.publish(tenant, gross);
        return gross;`}
    }
}
`;
const ledger = `package example;
public final class Ledger {
    public String tenant;
    public long amount = -1;
    public int writes;
    public void save(String tenant, long amount) {
        this.tenant = tenant;
        this.amount = amount;
        writes++;
    }
}
`;
const events = ledger.replaceAll('Ledger', 'Events').replaceAll('save(', 'publish(');
const publicTest = `const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
test('submit preserves tenant, amount and exactly one write at each exit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-probe-'));
  try {
    const probe = path.join(dir, 'Probe.java');
    fs.writeFileSync(probe, 'import example.*; public class Probe { public static void main(String[] a) { Ledger l = new Ledger(); Events e = new Events(); long value = new PaymentService(l,e).submit("tenant-a",1000,0); if(value!=1000 || l.amount!=1000 || e.amount!=1000 || l.writes!=1 || e.writes!=1 || !"tenant-a".equals(l.tenant) || !"tenant-a".equals(e.tenant)) throw new AssertionError("payment exits disagree"); } }');
    execFileSync('javac', ['-encoding','UTF-8','-d',dir,'src/main/java/example/PaymentService.java','src/main/java/example/Ledger.java','src/main/java/example/Events.java',probe], { timeout: 20000, stdio: 'pipe' });
    execFileSync('java', ['-cp',dir,'Probe'], { timeout: 10000, stdio: 'pipe' });
    assert.ok(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
`;
const rebateTest=publicTest.replace('submit preserves tenant, amount and exactly one write at each exit','nonzero rebate updates API, ledger and event').replace('submit("tenant-a",1000,0)','submit("tenant-a",1000,125)').replaceAll('!=1000','!=875').replace('new AssertionError("payment exits disagree")','new AssertionError("expected 875 at every exit; API="+value+", ledger="+l.amount+", event="+e.amount)');
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-08T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-08T00:00:00Z' } }).trim();
}
function create(root) {
  fs.mkdirSync(path.join(root, path.dirname(FILE)), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, FILE), source(false));
  fs.writeFileSync(path.join(root, 'src/main/java/example/Ledger.java'), ledger);
  fs.writeFileSync(path.join(root, 'src/main/java/example/Events.java'), events);
  fs.writeFileSync(path.join(root, 'test/payment.test.cjs'), publicTest);
  fs.writeFileSync(path.join(root, 'test/rebate.test.cjs'), rebateTest);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'payment-flow-fixture', private: true, scripts: { test: 'node --test test/payment.test.cjs' } }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), '# Payment service\n\n`submit(tenant, gross, rebate)` is the request entry. Ledger and Events are observable in-process adapters representing storage and messaging. Amounts are integer cents.\n\nREBATE-17: subtract the requested rebate, preserving tenant and exactly one ledger write/event per accepted request. API result, stored amount and event amount must all agree. Reject invalid payments and rebates before any effect. Zero rebate preserves existing behavior. This fixture proves Java behavior, not a real database or broker.\n');
  git(root, ['init', '--quiet', '--initial-branch=main']);
  const commit = message => { git(root, ['add', '.']); git(root, ['-c', 'user.name=Flow fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', message]); return git(root, ['rev-parse', 'HEAD']); };
  const baseline = commit('Initial gross payment behavior');
  git(root, ['switch', '--quiet', '-c', 'feature/rebates']);
  fs.writeFileSync(path.join(root, FILE), source(true));
  const feature = commit('Introduce rebate support');
  return { repo: 'DEMO/payments', root, baseline, feature, file: FILE };
}
// This oracle lives outside the model-readable repository and uses different cases
// from its public test. A passing edited test cannot satisfy this check.
function grade(root) {
  const os = require('node:os'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flow-oracle-'));
  const java = `import example.*;
public class Oracle {
  public static void main(String[] args) {
    long[][] cases = {{1000,125},{73,0},{91,91},{987654321,23456789},{7,3},{1,1}};
    int count = 0;
    for (long[] c : cases) {
      Ledger l = new Ledger(); Events e = new Events(); String tenant = "tenant-" + count;
      long actual = new PaymentService(l,e).submit(tenant,c[0],c[1]);
      long expected = c[0] - c[1];
      if(actual!=expected || l.amount!=expected || e.amount!=expected || l.writes!=1 || e.writes!=1 || !tenant.equals(l.tenant) || !tenant.equals(e.tenant)) throw new AssertionError("entry-to-exit mismatch case " + count);
      count++;
    }
    long[][] bad = {{0,0},{-1,0},{100,-1},{100,101},{100,0},{100,0},{100,0}};
    String[] tenants = {"tenant","tenant","tenant","tenant",null,"","   "};
    for (int i=0;i<bad.length;i++) {
      long[] c=bad[i];
      Ledger l = new Ledger(); Events e = new Events(); boolean rejected = false;
      try { new PaymentService(l,e).submit(tenants[i],c[0],c[1]); } catch(IllegalArgumentException ex) { rejected = true; }
      if(!rejected || l.writes!=0 || e.writes!=0) throw new AssertionError("invalid input caused effects");
      count++;
    }
    System.out.println(count);
  }
}`;
  try {
    fs.writeFileSync(path.join(dir, 'Oracle.java'), java);
    execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, ...['PaymentService', 'Ledger', 'Events'].map(n => path.join(root, 'src/main/java/example', n + '.java')), path.join(dir, 'Oracle.java')], { timeout: 20000, stdio: 'pipe' });
    const count = Number(execFileSync('java', ['-cp', dir, 'Oracle'], { timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
    return { passed: count === 13, cases: count };
  } catch (error) {
    return { passed: false, error: String(error.stderr || error.message).slice(0, 1500) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { create, grade, source, git, FILE };
