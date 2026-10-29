#!/usr/bin/env node
// Memory under large load: every everyday tool against big caches, each in its own process with a capped
// heap (like dt in a container), then all of them in one process (the server keeps what it caches).
// Not part of npm test. Reports peak heap and RSS per tool; a tool that runs out of memory is a failure.
//
//   node test/stress/code-and-db.js --repos 80 --files 600 --keep     a home with big code indexes
//   node test/stress/memory.js --home <kept home> [--heap 1024] [--dbs 4 --tables 3000 --functions 1500 --dict 200 --topics 3000 --pages 2000]
//   node test/stress/memory.js --scale small                          a quick run in a fresh home (used by the npm test check)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SMALL = arg('scale', '') === 'small';
const N = (n, big, small) => Number(arg(n, SMALL ? small : big));
const HEAP = N('heap', 1024, 256), DBS = N('dbs', 4, 2), TABLES = N('tables', 3000, 300), FNS = N('functions', 1500, 150), DICT = N('dict', 200, 20), DICT_ROWS = N('dict-rows', 10000, 2000), TOPICS = N('topics', 3000, 200), PAGES = N('pages', 2000, 100);
const home = arg('home', null) || fs.mkdtempSync(path.join(os.tmpdir(), 'dt-memory-'));
const ROOT = path.join(__dirname, '..', '..');
const env = 'stress';

// ── data: Postgres catalogs (with dictionary tables), Kafka topics, Confluence pages ──
function seed() {
  const cfgFile = path.join(home, 'config.json');
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : { envs: {} };
  const dbs = Array.from({ length: DBS }, (_, i) => `db${i}`);
  cfg.envs[env] = { ...(cfg.envs[env] || {}), postgres: Object.fromEntries(dbs.map(d => [d, `postgres://x:y@127.0.0.1:1/${d}`])) };
  cfg.confluence = { url: 'https://wiki.example.com', token: 'x', spaces: ['BIG'] };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  const pg = path.join(home, 'cache', env, 'pg'); fs.mkdirSync(pg, { recursive: true });
  const col = (t, c) => `c${c}_${t % 97}`;
  for (const db of dbs) {
    const tables = Array.from({ length: TABLES }, (_, t) => ({ schema: `s${t % 12}`, name: `t${t}`, kind: 'table', comment: null, est_rows: '1000',
      columns: Array.from({ length: 30 }, (_, c) => ({ name: col(t, c), type: c ? 'text' : 'bigint', nullable: c > 0, default: null, identity: null, generated: null, comment: null })),
      constraints: [{ name: `t${t}_pkey`, type: 'p', def: `PRIMARY KEY (${col(t, 0)})` }] }));
    const tn = t => `${tables[t].schema}.${tables[t].name}`;
    const functions = Array.from({ length: FNS }, (_, f) => {
      const a = f % TABLES, b = (f * 7 + 3) % TABLES, c = (f * 13 + 5) % TABLES, cols = n => Array.from({ length: 10 }, (_, k) => `x.${col(n, k)}`).join(', ');
      return { schema: `s${f % 12}`, name: `f${f}`, kind: 'function', args: 'p_id bigint', signature: 'p_id bigint', returns: 'TABLE(a text)', arg_list: [{ name: 'p_id', type: 'bigint', mode: 'in' }], lang: 'plpgsql', volatility: 'stable', security_definer: false, comment: f % 50 ? null : `DEPRECATED: ${col(a, 1)} -> s0.f0(p_id)`,
        body: `\nbegin\n  return query select ${cols(a)}, y.${col(b, 1)}\n  from ${tn(a)} x join ${tn(b)} y on y.${col(b, 0)} = x.${col(a, 0)} where x.${col(a, 3)} = p_id;\n  update ${tn(c)} set ${col(c, 4)} = 'x' where ${col(c, 0)} = p_id;\nend ` };
    });
    const dict = Array.from({ length: DICT }, (_, d) => ({ schema: 'dict', name: `d_kind${d}`, kind: 'table', columns: ['id', 'code', 'name', 'active', 'sort', 'note'].map(n => ({ name: n, type: 'text' })) }));
    const views = Array.from({ length: Math.floor(TABLES / 20) }, (_, v) => ({ schema: 's0', name: `v${v}`, kind: 'view', columns: [{ name: 'a', type: 'text' }], definition: `select x.${col(v, 1)} as a from ${tn(v)} x` }));
    fs.writeFileSync(path.join(pg, `${db}.json`), JSON.stringify({ db, database: db, version: 'PostgreSQL 16', syncedAt: new Date().toISOString(), ms: 1, tables: [...tables, ...views, ...dict], functions, viewDeps: [], triggers: [], types: [], sequences: [], extensions: [],
      dictionaries: Object.fromEntries(dict.map(t => [`dict.${t.name}`, { count: DICT_ROWS }])) }));
    // dictionary rows live next to the catalog
    fs.writeFileSync(path.join(pg, `${db}.dictionaries.json`), JSON.stringify(Object.fromEntries(dict.map(t => [`dict.${t.name}`, { columns: ['id', 'code', 'name', 'active', 'sort', 'note'], rows: Array.from({ length: DICT_ROWS }, (_, i) => [i, `C${i}`, `Entry ${i} of ${t.name}`, i % 9 !== 0, i, `note ${i}`]) }]))));
  }
  const kafka = path.join(home, 'cache', env, 'kafka'); fs.mkdirSync(kafka, { recursive: true });
  const topics = Array.from({ length: TOPICS }, (_, t) => ({ topic: `topic_${t}`, partitions: 6, messages: 1000 + t }));
  for (const t of topics) fs.writeFileSync(path.join(kafka, `${t.topic}.json`), JSON.stringify({ ...t, replication: 3, cleanup: 'DELETE', lastMessageAt: new Date().toISOString(), keySchema: null, valueSchema: null,
    fields: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, 'string'])), samples: Array.from({ length: 5 }, (_, i) => ({ partition: 0, offset: i, timestamp: new Date().toISOString(), key: `k${i}`, value: Object.fromEntries(Array.from({ length: 20 }, (_, j) => [`field${j}`, `value ${i}-${j} `.repeat(4)])) })) }));
  fs.writeFileSync(path.join(kafka, '_index.json'), JSON.stringify({ syncedAt: new Date().toISOString(), cluster: env, topics, subjects: [] }));
  const conf = path.join(home, 'cache', 'confluence', 'BIG', 'pages'); fs.mkdirSync(conf, { recursive: true });
  const P = require(path.join(ROOT, 'lib', 'docs-parse'));
  for (let p = 0; p < PAGES; p++) {
    const storage = Array.from({ length: 12 }, (_, s) => `<h2>Section ${s}</h2><p>Service svc-${p % 80} writes s${s % 12}.t${(p * s) % TABLES} and produces topic_${(p + s) % TOPICS}. Refunds over ${s * 100} EUR need approval.</p><table><tr><th>Code</th><th>Meaning</th></tr><tr><td>E${s}</td><td>Error ${s} of page ${p}</td></tr></table>`).join('');
    const page = { id: String(10000 + p), space: 'BIG', title: `Page ${p}`, version: 1, url: `https://wiki.example.com/pages/${10000 + p}`, storage, attachments: [] };
    fs.writeFileSync(path.join(conf, `${page.id}.json`), JSON.stringify({ ...page, ...P.parse(page) }));
  }
}

// ── the calls: everyday tools, the index rebuild, and a big result view ──
const CALLS = [
  ['find', { q: 't42', env }], ['find', { q: 'pg: c3_42', env }], ['pg_table', { name: 's6.t42', env }], ['pg_function', { name: 's1.f1', env }],
  ['pg_usage', { name: 's6.t42', env }], ['pg_usage', { name: 'db0:s6.t42.c3_42', env }], ['field_trace', { name: 'db0:s1.f1', env }],
  ['kafka_topic', { topic: 'topic_42', env }], ['who_uses', { name: 'topic_42', env }], ['docs_search', { query: 'refunds approval', spaces: 'BIG' }],
  ['code_search', { pattern: 'OrderController|PaymentClient', regex: true }], ['code_symbols', { q: 'Service0' }], ['impact', { target: 's1.t1', env }],
  ['catalog_sync', { what: 'index', env }],
  ['show', { view: 'table', data: Array.from({ length: 200000 }, (_, i) => ({ id: i, name: `row ${i}`, value: i * 1.5 })) }],
];
const harness = `
const T = require(${JSON.stringify(path.join(ROOT, 'lib', 'tools'))}); let peak = 0, rss = 0;
const sample = () => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed); rss = Math.max(rss, m.rss); }; setInterval(sample, 5).unref();
const calls = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')), out = [];
(async () => { for (const [name, args] of calls) { const t = Date.now(); peak = 0; sample(); let ok = true, error;
  try { await T.call(name, args, { source: 'stress' }); } catch (e) { ok = false; error = e.message.slice(0, 160); }
  sample(); out.push({ name, ok, error, ms: Date.now() - t, peakMB: Math.round(peak / 1e6), rssMB: Math.round(rss / 1e6), heldMB: Math.round(process.memoryUsage().heapUsed / 1e6) }); }
  console.log('RESULT ' + JSON.stringify(out)); process.exit(0); })();`;
function run(calls) {
  const input = path.join(home, `.calls-${process.pid}.json`); fs.writeFileSync(input, JSON.stringify(calls)); // too big for argv
  const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP}`, '-e', harness, input], { env: { ...process.env, DT_HOME: home, DT_LOG: 'quiet', DT_RATE_PER_SEC: '0' }, encoding: 'utf8', maxBuffer: 64 << 20 });
  fs.rmSync(input, { force: true });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('RESULT '));
  if (line) return JSON.parse(line.slice(7)).map((x, i) => ({ ...x, args: calls[i][1] }));
  const oom = /heap out of memory|Allocation failed/i.test(r.stderr || '');
  return calls.map(([name, args]) => ({ name, args, ok: false, error: oom ? `OUT OF MEMORY (heap ${HEAP} MB)` : `crashed: ${(r.stderr || '').split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200)}` }));
}

if (require.main === module) {
  if (!arg('home', null) || !process.argv.includes('--no-seed')) { console.log(`seeding ${home}: ${DBS} dbs x ${TABLES} tables, ${FNS} functions, ${DICT} dictionaries x ${DICT_ROWS} rows, ${TOPICS} topics, ${PAGES} pages`); seed(); }
  process.env.DT_HOME = home;
  console.log(`\neach call alone (heap capped at ${HEAP} MB):`);
  const alone = CALLS.flatMap(c => run([c]));
  for (const r of alone) console.log(`  ${(r.name + ' ' + JSON.stringify(r.args).slice(0, 44)).padEnd(64)} ${r.ok ? 'ok  ' : 'FAIL'} ${String(r.ms ?? '-').padStart(7)} ms  peak ${String(r.peakMB ?? '-').padStart(5)} MB  rss ${String(r.rssMB ?? '-').padStart(5)} MB ${r.error || ''}`);
  console.log('\nall calls in one process (what a long-running server holds):');
  const together = run(CALLS);
  for (const r of together) console.log(`  ${(r.name + ' ' + JSON.stringify(r.args).slice(0, 44)).padEnd(64)} ${r.ok ? 'ok  ' : 'FAIL'} held ${String(r.heldMB ?? '-').padStart(5)} MB ${r.error || ''}`);
  const failed = [...alone, ...together].filter(r => !r.ok && /OUT OF MEMORY|out of memory|crashed/.test(r.error || '')); // a worker that ran out counts too: the call failed
  if (!arg('home', null)) fs.rmSync(home, { recursive: true, force: true });
  if (failed.length) { console.log(`\n${failed.length} calls ran out of memory or crashed`); process.exit(1); }
}
module.exports = { run, seed, CALLS };
