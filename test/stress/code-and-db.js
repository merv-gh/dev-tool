#!/usr/bin/env node
// Stress test of the indexes: how long they take to build, how big they get, how fast and how right
// grep and impact are at scale. Not part of npm test (it takes a minute and a lot of disk).
//
//   node test/stress/code-and-db.js                     40 services x 400 files, code only
//   node test/stress/code-and-db.js --repos 80 --files 600
//   node test/stress/code-and-db.js --pg postgres://postgres:pw@127.0.0.1:55432/postgres --tables 2000
//
// Code: synthetic Spring services that call each other (Feign -> endpoints), share Kafka topics and
// tables, with entities, repositories, DAOs with SQL, listeners, config. Every grep is checked against a
// full scan of the same files; ripgrep is timed too when installed.
// Database (--pg): a schema of N tables with FKs, enum types, functions reading them, views, triggers,
// loaded into a scratch database, synced, indexed, snapshotted, and the snapshot loaded into another
// database and compared with pg_dump-like catalog queries.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const REPOS = Number(arg('repos', 40)), FILES = Number(arg('files', 400)), PG = arg('pg', null), TABLES = Number(arg('tables', 2000));
const KEEP = process.argv.includes('--keep');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-stress-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { stress: { postgres: PG ? { big: PG.replace(/\/[^/]*$/, '/dt_stress') } : {} } } }));

let seed = 42;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = (xs) => xs[rnd(xs.length)];
const t0 = () => process.hrtime.bigint();
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`);
const report = [];
const row = (what, value, note = '') => { report.push({ what, value, note }); console.log(`  ${what.padEnd(46)} ${String(value).padStart(12)}  ${note}`); };
const dirSize = (d) => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size; return n; };

const NOUNS = ['order', 'payment', 'invoice', 'customer', 'refund', 'ledger', 'shipment', 'stock', 'price', 'coupon', 'account', 'transfer', 'report', 'audit', 'session', 'device'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const svcName = (i) => `${NOUNS[i % NOUNS.length]}-${['service', 'api', 'worker', 'gateway', 'sync'][Math.floor(i / NOUNS.length) % 5]}${i >= NOUNS.length * 5 ? i : ''}`;
const topics = Array.from({ length: Math.max(10, REPOS), }, (_, i) => `${NOUNS[i % NOUNS.length]}.${['created', 'updated', 'settled', 'failed'][i % 4]}${i >= 64 ? '.' + i : ''}`);
const tables = Array.from({ length: Math.max(20, REPOS * 2) }, (_, i) => `s${i % 8}.${NOUNS[i % NOUNS.length]}_${i}`);

// ── code ──────────────────────────────────────────────────────────────────
function genRepo(i) {
  const name = svcName(i), base = `com.acme.r${i}`;
  const root = path.join(home, 'repos', 'STRESS', name);
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w('pom.xml', `<project><modelVersion>4.0.0</modelVersion><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.5</version></parent><groupId>com.acme</groupId><artifactId>${name}</artifactId><version>1.0.${i}</version></project>`);
  const myTopic = topics[i % topics.length], inTopic = topics[(i + 3) % topics.length];
  w('src/main/resources/application.yml', `spring:\n  application:\n    name: ${name}\napp:\n  topics:\n    out: ${myTopic}\n    in: ${inTopic}\n  limits:\n    max-${NOUNS[i % 16]}-batch: ${100 + i}\n`);
  w('src/main/resources/db/migration/V1__init.sql', `create table if not exists ${tables[i * 2 % tables.length]} (id bigserial primary key, status text, amount numeric);\n`);
  const per = Math.max(8, FILES);
  const pkgs = ['web', 'service', 'repo', 'dao', 'events', 'util', 'model', 'config'];
  for (let f = 0; f < per; f++) {
    const pkg = pkgs[f % pkgs.length], noun = NOUNS[(i + f) % NOUNS.length], cls = `${cap(noun)}${cap(pkg)}${f}`;
    const methods = [];
    const n = 6 + rnd(8);
    for (let m = 0; m < n; m++) {
      const callee = `${cap(NOUNS[(i + f + m) % 16])}Service${(f + m) % per - ((f + m) % per) % 8 + 1 < per ? (f + m) % per - ((f + m) % per) % 8 + 1 : 1}`;
      const body = [];
      for (let l = 0; l < 8 + rnd(10); l++) body.push(`        long v${l} = Math.max(${rnd(1000)}L, input.length() * ${rnd(50)}L); // ${noun} step ${l} code-${i}-${f}-${m}-${l}`);
      if (pkg === 'service' && m === 0) body.push(`        helper.${'process'}${m}(input);`);
      methods.push(`    public long ${noun}Op${m}(String input) {\n${body.join('\n')}\n        return v0;\n    }`);
      void callee;
    }
    let head = '', fields = '', extra = '';
    if (pkg === 'web') {
      head = `@RestController\n@RequestMapping("/api/${noun}s${f}")\n`;
      fields = `    private final ${cap(noun)}Service${f - (f % 8) + 1 < per ? f - (f % 8) + 1 : 1} service;\n    public ${cls}(${cap(noun)}Service${f - (f % 8) + 1 < per ? f - (f % 8) + 1 : 1} service) { this.service = service; }\n`;
      extra = `    @GetMapping("/{id}")\n    public String get(@PathVariable Long id) { return String.valueOf(service.${noun}Op0("x" + id)); }\n    @PostMapping("/{id}/settle")\n    public String settle(@PathVariable Long id) { return String.valueOf(service.${noun}Op1("s" + id)); }\n`;
    } else if (pkg === 'service') {
      head = '@Service\n';
      const daoCls = `${cap(NOUNS[(i + f + 3) % 16])}Dao${f + 3 < per ? f + 3 : 3}`;
      fields = `    private final ${daoCls} dao;\n    private final Helper${i} helper;\n    public ${cls}(${daoCls} dao, Helper${i} helper) { this.dao = dao; this.helper = helper; }\n`;
      extra = `    public long hot${i}(String id) { return dao.load${f + 3 < per ? f + 3 : 3}(id) + helper.process0(id); }\n`;
    } else if (pkg === 'dao') {
      head = '@Repository\n';
      const t = tables[(i + f) % tables.length];
      fields = '    private final org.springframework.jdbc.core.JdbcTemplate jdbc;\n    public ' + cls + '(org.springframework.jdbc.core.JdbcTemplate jdbc) { this.jdbc = jdbc; }\n';
      extra = `    public long load${f}(String id) {\n        return jdbc.queryForObject("select count(*) from ${t} where status = ? and amount > 0", Long.class, id);\n    }\n    public void mark${f}(long id) {\n        jdbc.update("update ${t} set status = 'done' where id = ?", id);\n    }\n`;
    } else if (pkg === 'events') {
      head = '@Component\n';
      fields = '    private final KafkaTemplate<String, String> kafkaTemplate;\n    public ' + cls + '(KafkaTemplate<String, String> kafkaTemplate) { this.kafkaTemplate = kafkaTemplate; }\n';
      extra = `    public void publish(String id) { kafkaTemplate.send("${myTopic}", id, "{}"); }\n    @KafkaListener(topics = "${inTopic}", groupId = "${name}")\n    public void on${cap(noun)}(String msg) { publish(msg); }\n`;
    } else if (pkg === 'model' && f % 3 === 0) {
      const t = tables[(i * 2 + f) % tables.length];
      head = `@Entity\n@Table(name = "${t.split('.')[1]}", schema = "${t.split('.')[0]}")\n`;
      fields = '    @Id\n    private Long id;\n    private String status;\n    @Column(name = "amount")\n    private java.math.BigDecimal amount;\n    public String getStatus() { return status; }\n';
    } else if (pkg === 'config' && f % 8 === 7) {
      // a Feign client of another service's endpoint
      const j = (i + 1) % REPOS, other = NOUNS[(j + 0) % 16];
      w(`src/main/java/${base.replace(/\./g, '/')}/clients/${cap(other)}Client${f}.java`, `package ${base}.clients;\n\n@FeignClient(name = "${svcName(j)}")\npublic interface ${cap(other)}Client${f} {\n    @GetMapping("/api/${other}s0/{id}")\n    String get(@PathVariable("id") Long id);\n}\n`);
    }
    w(`src/main/java/${base.replace(/\./g, '/')}/${pkg}/${cls}.java`, `package ${base}.${pkg};\n\nimport ${base}.util.*;\nimport ${base}.dao.*;\nimport ${base}.service.*;\nimport org.springframework.kafka.core.KafkaTemplate;\n\n${head}public class ${cls} {\n${fields}${extra}\n${methods.join('\n\n')}\n}\n`);
  }
  w(`src/main/java/${base.replace(/\./g, '/')}/util/Helper${i}.java`, `package ${base}.util;\n\n@Component\npublic class Helper${i} {\n    public long process0(String s) { return s.length(); }\n}\n`);
  w(`src/test/java/${base.replace(/\./g, '/')}/service/HotTest.java`, `package ${base}.service;\n\nclass HotTest {\n    @org.junit.jupiter.api.Test\n    void hot() { new ${cap(NOUNS[(i + 1) % 16])}Service1(null, new ${base}.util.Helper${i}()).hot${i}("1"); }\n}\n`);
  return { name, root };
}

async function code() {
  console.log(`\nCode: ${REPOS} services x ${FILES} files`);
  let t = t0();
  const repos = Array.from({ length: REPOS }, (_, i) => genRepo(i));
  row('generate sources', `${Math.round(ms(t))} ms`);
  const srcBytes = dirSize(path.join(home, 'repos'));
  const CI = require('../../lib/codeindex');
  const times = [];
  t = t0();
  let files = 0, classes = 0, edges = 0;
  for (const r of repos) {
    const s = t0();
    const info = CI.build(r.root, `STRESS/${r.name}`, { project: 'STRESS', repo: r.name });
    times.push(ms(s)); files += info.files; classes += info.classes; edges += info.edges;
  }
  const total = ms(t);
  times.sort((a, b) => a - b);
  row('source files / bytes', `${files}`, fmt(srcBytes));
  row('index build: total', `${(total / 1000).toFixed(1)} s`, `${Math.round(files / (total / 1000))} files/s, ${fmt(srcBytes / (total / 1000))}/s`);
  row('index build: per repo median / p95', `${Math.round(times[times.length >> 1])} ms`, `p95 ${Math.round(times[Math.floor(times.length * 0.95)])} ms`);
  const idxBytes = dirSize(CI.DIR);
  let tri = 0, graph = 0;
  for (const r of repos) { const d = CI.keyDir(`STRESS/${r.name}`); tri += fs.statSync(path.join(d, 'tri.bin')).size; graph += fs.statSync(path.join(d, 'graph.json')).size; }
  row('index size on disk', fmt(idxBytes), `${(idxBytes / srcBytes * 100).toFixed(0)}% of sources (trigrams ${fmt(tri)}, graph ${fmt(graph)})`);
  row('classes / edges', `${classes}`, `${edges} edges`);

  // grep: every query against a full scan of the same files
  const keys = CI.select('STRESS/*');
  const all = [];
  for (const k of keys) { const idx = CI.load(k); for (const f of idx.list) all.push({ key: k, path: f.path, full: path.join(idx.root, f.path) }); }
  const naive = (re) => { let n = 0; for (const f of all) { const lines = fs.readFileSync(f.full, 'utf8').split('\n'); for (const l of lines) if (re.test(l)) n++; } return n; };
  const queries = [
    ['rare literal', 'code-7-123-4-5', false], ['config key', 'max-payment-batch', false], ['topic name', topics[5], false],
    ['common word (no filter help)', 'return', false], ['class name', 'PaymentService1', false],
    ['regex with literal', 'jdbc\\.update\\("update s\\d\\.\\w+_1\\d set', true], ['regex alternatives', '(ledger|coupon)Op1[0-3]\\(', true],
    ['regex, no literal', '\\bv1[0-7] = Math', true], ['annotation', '@KafkaListener\\(topics = "' + topics[2].replace(/\./g, '\\.'), true],
  ];
  const rg = (() => { try { execFileSync('rg', ['--version']); return true; } catch { return false; } })();
  for (const [label, p, regex] of queries) {
    const s = t0();
    const r = CI.grep(keys, p, { regex, limit: 1e7, perFile: 1e6, ignoreCase: false });
    const tq = ms(s);
    const re = new RegExp(regex ? p : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const s2 = t0();
    const want = naive(re);
    const tn = ms(s2);
    let rgms = '';
    if (rg) { const s3 = t0(); try { execFileSync('rg', ['-c', '--no-messages', regex ? p : '-F', ...(regex ? [] : [p]), path.join(home, 'repos')], { maxBuffer: 1 << 28 }); } catch {} rgms = `, rg ${Math.round(ms(s3))} ms`; }
    if (r.hits.length !== want) throw new Error(`grep "${p}": ${r.hits.length} hits, full scan ${want}`);
    row(`grep ${label}`, `${tq.toFixed(1)} ms`, `${r.hits.length} hits, read ${r.scanned}/${all.length} files; full scan ${Math.round(tn)} ms${rgms}`);
  }

  // symbols, impact
  const I = require('../../lib/impact');
  let s = t0();
  const G = I.load({ repos: 'STRESS/*' });
  row('load all graphs for impact', `${Math.round(ms(s))} ms`, `${G.nodes.size} nodes, heap ${fmt(process.memoryUsage().heapUsed)}`);
  const targets = [
    ['hot helper method (called everywhere)', 'com.acme.r3.util.Helper3#process0'],
    ['a table (DAOs in many services)', `table:${tables[4]}`],
    ['a column (entity fields, SQL)', `column:${tables[4]}.status`],
    ['a topic (producers -> consumers, cross-service)', `topic:${topics[3]}`],
    ['an endpoint (Feign callers in other services)', 'GET /api/payments0/7'],
  ];
  for (const [label, target] of targets) {
    s = t0();
    const r = I.impact(target, { repos: 'STRESS/*', depth: 5, limit: 5000, grep: false });
    const repos = new Set(r.items.map(x => x.repo));
    row(`impact ${label}`, `${Math.round(ms(s))} ms`, `${r.items.length} items in ${repos.size} repos, ${r.endpoints.length} endpoints, ${r.tests.length} tests`);
    if (!r.items.length) throw new Error(`impact ${target}: nothing found`);
  }
}

// ── database ──────────────────────────────────────────────────────────────
async function db() {
  const postgres = require('postgres');
  console.log(`\nDatabase: ${TABLES} tables on ${PG.replace(/\/\/[^@]*@/, '//***@')}`);
  const admin = postgres(PG, { onnotice: () => {}, max: 1 });
  for (const d of ['dt_stress', 'dt_stress_copy']) { await admin.unsafe(`drop database if exists ${d}`); await admin.unsafe(`create database ${d}`); }
  await admin.end();
  const url = (d) => PG.replace(/\/[^/]*$/, `/${d}`);
  const sql = postgres(url('dt_stress'), { onnotice: () => {}, max: 1 });
  let t = t0();
  const schemas = 8;
  const ddl = [];
  for (let s = 0; s < schemas; s++) ddl.push(`create schema s${s}`, `create type s${s}.state as enum ('new', 'active', 'done', 'failed')`);
  for (let i = 0; i < TABLES; i++) {
    const s = i % schemas, cols = [];
    const DEF = { text: "''", bigint: '0', 'numeric(12,2)': '0', timestamptz: 'now()', boolean: 'false', jsonb: "'{}'" };
    for (let c = 0; c < 20; c++) { const ty = pick(Object.keys(DEF)); cols.push(`c${c}_${pick(NOUNS)} ${ty}${rnd(4) ? '' : ` not null default ${DEF[ty]}`}`); }
    const fk = i > 10 && rnd(3) === 0 ? `, parent_id bigint references s${(i - 7) % schemas}.t${i - 7}(id)` : '';
    ddl.push(`create table s${s}.t${i} (id bigserial primary key, status s${s}.state not null default 'new', amount numeric(12,2), ${cols.join(', ')}${fk})`);
    if (rnd(2)) ddl.push(`create index t${i}_status on s${s}.t${i} (status, amount)`);
  }
  for (let f = 0; f < TABLES / 4; f++) {
    const a = rnd(TABLES), b = rnd(TABLES);
    ddl.push(`create function s${a % schemas}.f${f}(p_id bigint) returns numeric language plpgsql stable as $$ declare x numeric; begin select coalesce(sum(t.amount), 0) into x from s${a % schemas}.t${a} t join s${b % schemas}.t${b} u on u.id = t.id where t.id = p_id and t.status = 'active'; return x; end $$`);
  }
  for (let v = 0; v < TABLES / 10; v++) { const a = rnd(TABLES); ddl.push(`create view s${a % schemas}.v${v} as select id, status, amount from s${a % schemas}.t${a} where status <> 'failed'`); }
  ddl.push('create function s0.touch() returns trigger language plpgsql as $$ begin NEW.amount := coalesce(NEW.amount, 0); return NEW; end $$');
  for (let i = 0; i < TABLES; i += 20) ddl.push(`create trigger t${i}_touch before insert on s${i % schemas}.t${i} for each row execute function s0.touch()`);
  for (const d of ddl) await sql.unsafe(d);
  await sql.end();
  row('create schema in Postgres', `${(ms(t) / 1000).toFixed(1)} s`, `${ddl.length} statements`);

  const pg = require('../../lib/pg');
  t = t0();
  const [r] = await pg.sync('stress', { log: () => {} });
  if (r.error) throw new Error(r.error);
  row('catalog_sync (pg)', `${(ms(t) / 1000).toFixed(1)} s`, `${r.tables} relations, ${r.functions} functions, ${r.triggers} triggers, ${r.viewDeps} view deps`);
  const catFile = path.join(home, 'cache', 'stress', 'pg', 'big.json');
  row('catalog cache size', fmt(fs.statSync(catFile).size));
  t = t0();
  const u = require('../../lib/pgindex').build('stress');
  row('usage index build', `${Math.round(ms(t))} ms`, `${u.edges} edges`);
  t = t0();
  const lines = require('../../lib/catalog').build('stress');
  row('catalog.txt build', `${Math.round(ms(t))} ms`, `${lines} lines, ${fmt(fs.statSync(path.join(home, 'cache', 'stress', 'catalog.txt')).size)}`);
  const cat = pg.loadDb('stress', 'big');
  const someCol = cat.tables[Math.floor(cat.tables.length / 2)].columns[5];
  for (const q of [`t${TABLES - 1}`, `${someCol.name} ${someCol.type.split('(')[0]}`, `pgfn: f${Math.floor(TABLES / 8)}`, 'status amount t99']) {
    t = t0();
    const hits = require('../../lib/catalog').find('stress', q, { limit: 200 });
    row(`find "${q}"`, `${ms(t).toFixed(1)} ms`, `${hits.length} lines`);
  }
  const D = require('../../lib/ddl');
  t = t0();
  const all = D.snapshot('stress', 'big', {});
  row('DDL snapshot: whole database', `${Math.round(ms(t))} ms`, `${all.statements.length} statements, ${fmt(all.sql.length)}`);
  t = t0();
  const fn = cat.functions.find(f => /^f\d/.test(f.name));
  const sub = D.snapshot('stress', 'big', { functions: [`${fn.schema}.${fn.name}`] });
  row('DDL snapshot: one function, closed over', `${Math.round(ms(t))} ms`, `${sub.counts.tables} tables, ${sub.counts.functions} functions`);
  // the snapshot loads into an empty database, and gives the same catalog back
  const copy = postgres(url('dt_stress_copy'), { onnotice: () => {}, max: 1 });
  t = t0();
  const errors = [];
  for (const st of all.statements) { try { await copy.unsafe(st); } catch (e) { errors.push(`${st.slice(0, 80)}: ${e.message}`); } }
  await copy.end();
  row('load the snapshot into an empty database', `${(ms(t) / 1000).toFixed(1)} s`, `${errors.length} failed statements`);
  if (errors.length) throw new Error(errors.slice(0, 5).join('\n'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { stress: { postgres: { big: url('dt_stress') } }, copy: { postgres: { big: url('dt_stress_copy') } } } }));
  require('../../lib/config').reload();
  await pg.sync('copy', { log: () => {} });
  // everything but row estimates must be the same
  const A = pg.loadDb('stress', 'big'), B = pg.loadDb('copy', 'big');
  const diffs = [];
  for (const k of ['tables', 'functions', 'viewDeps', 'triggers', 'types', 'sequences', 'extensions']) {
    const a = (A[k] || []).map(x => JSON.stringify({ ...x, est_rows: 0 })), b = (B[k] || []).map(x => JSON.stringify({ ...x, est_rows: 0 }));
    const i = a.findIndex((x, j) => x !== b[j]);
    if (a.length !== b.length || i >= 0) diffs.push(`${k}: ${a.length} vs ${b.length}${i >= 0 ? `\n  source ${a[i].slice(0, 400)}\n  copy   ${String(b[i]).slice(0, 400)}` : ''}`);
  }
  row('snapshot round trip: catalogs identical', diffs.length ? 'NO' : 'yes', diffs.length ? diffs.map(d => d.split('\n')[0]).join('; ') : 'tables, columns, constraints, indexes, functions, views, triggers, types, sequences');
  if (diffs.length) throw new Error(`the copy differs from the source:\n${diffs.join('\n')}`);
  t = t0();
  // the object most used by functions, views, triggers and FKs
  const used = new Map();
  for (const e of require('../../lib/pgindex').load('stress').edges) used.set(e.target, (used.get(e.target) || 0) + 1);
  const hot = [...used].sort((a, b) => b[1] - a[1])[0][0];
  const imp = require('../../lib/impact').impact(hot, { env: 'stress', grep: false, depth: 4 });
  row(`impact of the most used db object (${hot})`, `${Math.round(ms(t))} ms`, `${imp.items.length} items (functions, views, FKs)`);
  await pg.closeAll();
  const a2 = postgres(PG, { onnotice: () => {}, max: 1 });
  for (const d of ['dt_stress', 'dt_stress_copy']) await a2.unsafe(`drop database if exists ${d} with (force)`);
  await a2.end();
}

(async () => {
  const started = Date.now();
  try {
    if (!process.argv.includes('--no-code')) await code();
    if (PG) await db();
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
    const out = arg('json', null);
    if (out) fs.writeFileSync(out, JSON.stringify({ repos: REPOS, files: FILES, tables: PG ? TABLES : 0, node: process.version, rows: report }, null, 2));
  } finally {
    if (!KEEP) fs.rmSync(home, { recursive: true, force: true }); else console.log(`kept ${home}`);
  }
})().catch(e => { console.error(`\nFAILED: ${e.stack || e.message}`); process.exit(1); });
