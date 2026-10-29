// Large load: what keeps dt from running out of memory, and what happens when a call still does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-memory-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS', 'DT_WORKER_HEAP_MB']) delete process.env[key];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { big: { postgres: { db0: 'postgres://x:y@127.0.0.1:1/db0' } } } }));
const PG = path.join(home, 'cache', 'big', 'pg');
fs.mkdirSync(PG, { recursive: true });
const table = (t, cols = 30) => ({ schema: 's', name: `t${t}`, kind: 'table', columns: Array.from({ length: cols }, (_, c) => ({ name: `c${c}`, type: 'text' })) });
const catalog = (extra = {}) => ({ db: 'db0', database: 'db0', version: 'PostgreSQL 16', syncedAt: '2026-10-01T00:00:00.000Z', tables: [table(1), { ...table(2, 3), name: 'd_kind' }], functions: [], viewDeps: [], triggers: [], types: [], sequences: [], extensions: [], ...extra });
test.after(() => { require('../lib/isolate').stop(); fs.rmSync(home, { recursive: true, force: true }); });

test('dictionary rows live next to the catalog and load only when used', () => {
  const pg = require('../lib/pg');
  fs.writeFileSync(path.join(PG, 'db0.json'), JSON.stringify(catalog({ dictionaries: { 's.d_kind': { count: 2 } } })));
  fs.writeFileSync(path.join(PG, 'db0.dictionaries.json'), JSON.stringify({ 's.d_kind': { columns: ['c0', 'c1', 'c2'], rows: [[1, 'A', true], [2, 'B', false]] } }));
  const cat = pg.loadDb('big', 'db0');
  assert.ok(!JSON.stringify(cat).includes('"rows"'), 'listing or describing a catalog does not carry the rows');
  assert.deepEqual(cat.dictionaries['s.d_kind'].rows, [{ c0: 1, c1: 'A', c2: true }, { c0: 2, c1: 'B', c2: false }]);
  assert.equal(cat.dictionaries['s.d_kind'].count, 2);
});

test('an older catalog with rows inline is cut down unparsed, and says how to get them back', () => {
  const pg = require('../lib/pg'), file = path.join(PG, 'db0.json');
  fs.rmSync(path.join(PG, 'db0.dictionaries.json'), { force: true });
  const rows = Array.from({ length: 5000 }, (_, i) => ({ c0: i, c1: `code ${i}`, c2: true }));
  fs.writeFileSync(file, JSON.stringify(catalog({ dictionaries: { 's.d_kind': { rows } } }), null, 2));
  const before = fs.statSync(file).size;
  process.env.DT_PG_SLIM_BYTES = String(before - 1);
  try {
    const cat = pg.loadDb('big', 'db0');
    assert.ok(fs.statSync(file).size < before / 10, 'rewritten without the rows');
    assert.deepEqual(cat.tables.map(t => t.name), ['t1', 'd_kind'], 'the catalog itself is intact');
    assert.match(cat.dictionariesNote, /catalog_sync what=pg/);
  } finally { delete process.env.DT_PG_SLIM_BYTES; }
});

test('cache files are compact and replaced whole; files people edit stay indented', () => {
  const { writeJson, CACHE } = require('../lib/util');
  const inCache = path.join(CACHE, 'x', 'a.json'), outside = path.join(home, 'notes-test.json');
  writeJson(inCache, { a: [1, 2] }); writeJson(outside, { a: [1, 2] });
  assert.equal(fs.readFileSync(inCache, 'utf8'), '{"a":[1,2]}');
  assert.match(fs.readFileSync(outside, 'utf8'), /\n {2}"a"/);
  assert.deepEqual(fs.readdirSync(path.dirname(inCache)).filter(f => f.endsWith('.tmp')), [], 'no temp file left');
});

test('too-large arguments are refused before anything else, and the history keeps only their size', async () => {
  const T = require('../lib/tools'), data = Array.from({ length: 120000 }, (_, i) => ({ id: i, name: `row ${i}` }));
  const t = Date.now();
  await assert.rejects(T.call('show', { view: 'table', data }, { source: 'test' }), /Arguments exceed/);
  assert.ok(Date.now() - t < 3000, `refused in ${Date.now() - t} ms`);
  const [last] = require('../lib/calls').history({ tool: 'show', limit: 1 });
  assert.equal(last.ok, false);
  assert.deepEqual(last.args, { argumentsOmitted: true, bytes: last.args.bytes });
  assert.ok(last.args.bytes > 2e6 && !JSON.stringify(last).includes('row 119999'), 'the history keeps the size, not the rows');
});

test('a heavy call that runs out of memory fails alone; dt keeps answering', async () => {
  const T = require('../lib/tools');
  fs.writeFileSync(path.join(PG, 'db0.json'), JSON.stringify(catalog({ tables: Array.from({ length: 4000 }, (_, t) => table(t)), dictionaries: {} })));
  process.env.DT_WORKER_HEAP_MB = '8';
  try {
    await assert.rejects(T.call('pg_usage', { name: 's.t1', env: 'big' }, { source: 'test' }), e => e.code === 'DT_OUT_OF_MEMORY' && /dt itself is still running/.test(e.message));
  } finally { delete process.env.DT_WORKER_HEAP_MB; require('../lib/isolate').stop(); }
  const r = await T.call('pg_table', { name: 's.t7', env: 'big' }, { source: 'test' });
  assert.equal(r[0].object, 's.t7', 'the next call is answered (in a new worker)');
});

test('impact over many repos takes the ones that name the target and their callers, and says so', () => {
  const CI = require('../lib/codeindex'), src = path.join(home, 'src');
  for (let r = 0; r < 18; r++) {
    const dir = path.join(src, `svc${r}`, 'src/main/java/x');
    fs.mkdirSync(dir, { recursive: true });
    const body = r === 3 ? 'public class Ledger { public void post() {} }' : r === 4 ? 'public class Books { Ledger ledger; void run() { ledger.post(); } }' : r === 5 ? 'public class Client { String url = "http://svc4/books"; }' : `public class Other${r} { void x() {} }`;
    fs.writeFileSync(path.join(dir, `C${r}.java`), `package x;\n${body}\n`);
    CI.build(path.join(src, `svc${r}`), `P/svc${r}`, { project: 'P', repo: `svc${r}` });
  }
  const G = require('../lib/impact').load({ target: 'x.Ledger' });
  assert.deepEqual([...G.keys].sort(), ['P/svc3', 'P/svc4', 'P/svc5'], 'the repos naming Ledger, then the one naming the service that uses it');
  assert.ok(G.gaps.some(g => g.kind === 'impact-scoped' && /3 of 18/.test(g.detail)));
});
