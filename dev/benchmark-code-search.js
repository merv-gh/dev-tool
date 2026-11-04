#!/usr/bin/env node
// Reproducible native/Zoekt comparison. Only synthetic or explicitly selected local
// sources are read. Zoekt runs on loopback; no source is sent to an external service.
// node dev/benchmark-code-search.js --zoekt-bin <folder> [--public-source <checkout>]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const round = value => Math.round(value * 1000) / 1000;
const bytes = root => { let size = 0; for (const e of fs.readdirSync(root, { withFileTypes: true })) { const p = path.join(root, e.name); size += e.isDirectory() ? bytes(p) : e.isFile() ? fs.statSync(p).size : 0; } return size; };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n'); };
const quantiles = values => { const sorted = [...values].sort((a,b) => a-b); return { p50Ms: round(sorted[Math.floor(sorted.length * .5)]), p95Ms: round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)]), maxMs: round(sorted.at(-1)) }; };
const memory = () => ({ maxRssBytes: process.resourceUsage().maxRSS * 1024, heapUsedBytes: process.memoryUsage().heapUsed });
const queries = [
  { name: 'rare-literal', pattern: 'billing.threshold.rare_needle_72639' },
  { name: 'missing-literal', pattern: 'there_is_no_such_source_298302' },
  { name: 'common-literal', pattern: 'Transactional' },
  { name: 'alternation', pattern: '(?:orderCreated|orderCancelled)_[0-9]{3}', regex: true },
  { name: 'character-class', pattern: '\\b[A-Z]{2}[0-9]{6}\\b', regex: true },
  { name: 'escaped-literal', pattern: 'Topic\\.Order\\.Created', regex: true },
  { name: 'regex-call', pattern: '(?:publish|consume)[A-Z][a-z]+\\(event\\)', regex: true },
  { name: 'public-source', pattern: '@(?:Get|Post|Request)Mapping\\(', regex: true },
  { name: 'unicode-fold', pattern: 'Ärger', regex: true },
];
async function command(file, args, options = {}) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 32 * 1024 * 1024) child.kill(); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16384); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve({ stdout, stderr, ms: round(performance.now() - started) }) : reject(new Error(`${path.basename(file)} exited ${code}: ${stderr}`)));
  });
}
function configure(home) {
  for (const key of ['DT_CACHE_DIR', 'DT_CONFIG_DIR', 'DT_PASSPORTS_DIR', 'DT_REPOS_DIR', 'DT_WORK_DIR']) delete process.env[key];
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
}
async function worker(home, phase) {
  configure(home); const CI = require('../lib/codeindex');
  const inputs = JSON.parse(fs.readFileSync(path.join(home, 'inputs.json')));
  if (phase === 'index') {
    let graphMs = 0; const graph = require('../lib/codegraph'), build = graph.build;
    graph.build = (...args) => { const start = performance.now(); try { return build(...args); } finally { graphMs += performance.now() - start; } };
    const indexes = [], start = performance.now();
    for (const input of inputs) {
      const before = performance.now(), info = CI.build(input.root, input.key, { project: input.project, repo: input.repo, sha: input.sha, ref: 'main' });
      indexes.push({ key: input.key, revisionKey: info.revisionKey, root: CI.load(info.revisionKey).root, sha: input.sha, files: info.files, bytes: info.bytes, classes: info.classes, edges: info.edges, coldMs: round(performance.now() - before) });
    }
    const coldMs = performance.now() - start, warmStart = performance.now();
    for (const input of inputs) assert.equal(CI.build(input.root, input.key, { project: input.project, repo: input.repo, sha: input.sha, ref: 'main' }).reused, true);
    return { indexes, coldMs: round(coldMs), graphMs: round(graphMs), unchangedMs: round(performance.now() - warmStart), diskBytes: bytes(CI.DIR), ...memory() };
  }
  const indexes = JSON.parse(fs.readFileSync(path.join(home, 'native-index.json'))).indexes;
  const keys = indexes.map(i => i.revisionKey), result = [];
  for (const query of queries) {
    const options = { regex: !!query.regex, ignoreCase: true, limit: phase === 'bounded' ? 100 : 100000, perFile: phase === 'bounded' ? 100 : 100000 };
    const start = performance.now(), cold = CI.grep(keys, query.pattern, options), coldMs = performance.now() - start;
    const samples = []; let response;
    for (let i = 0; i < 7; i++) { const t = performance.now(); response = CI.grep(keys, query.pattern, options); samples.push(performance.now() - t); }
    const identities = response.hits.map(h => `${h.repo}\0${h.path}\0${h.line}`).sort();
    result.push({ name: query.name, coldMs: round(coldMs), ...quantiles(samples), hits: response.hits.length, truncated: response.truncated, candidates: response.candidates, filesRead: response.scanned, plan: response.plan, identityHash: hash(JSON.stringify(identities)) });
  }
  return { queries: result, ...memory() };
}
async function main() {
  const argv = process.argv.slice(2), value = (flag, fallback) => { const at = argv.indexOf(flag); return at < 0 ? fallback : argv[at+1]; };
  if (argv[0] === '--worker') { console.log(JSON.stringify(await worker(argv[1], argv[2]))); return; }
  const root = path.resolve(value('--output-dir', path.join('work', 'zoekt-evaluation', 'benchmark')));
  const binaries = path.resolve(value('--zoekt-bin', path.join('work', 'zoekt-evaluation', 'bin')));
  const home = path.join(root, 'home'), resume = argv.includes('--resume'); assert.ok(resume || !fs.existsSync(home), 'Use a new output directory or --resume; existing evidence is preserved');
  const repoCount = Number(value('--repos', '32')), filesPerRepo = Number(value('--files', '128')), fileBytes = Number(value('--file-bytes', '32768'));
  assert.ok(repoCount >= 2 && repoCount <= 128 && filesPerRepo >= 4 && filesPerRepo <= 2000 && fileBytes >= 1024 && fileBytes < 1048576);
  const inputs = resume ? JSON.parse(fs.readFileSync(path.join(home, 'inputs.json'))) : [];
  if (!resume) {
  write(path.join(home, 'config.json'), { envs: { benchmark: {} } });
  for (let r = 0; r < repoCount; r++) {
    const repo = `${r < 8 ? 'internal-library' : 'service'}-${r}`, source = path.join(home, 'sources', repo);
    for (let f = 0; f < filesPerRepo; f++) {
      const java = f % 2 === 0;
      let content = java ? `package bench.repo${r};\nimport bench.library.LibraryApi;\npublic class Part${f} {\n  private LibraryApi api;\n  @Transactional\n  public int calculate(int n) { return api.apply(n); }\n` + Array.from({ length: 16 }, (_, i) => `  public int method${i}(int n) { return n + ${r * 100 + f + i}; }`).join('\n') + '\n}\n' : `service.name=${repo}\npartition=${r}\n`;
      if (f % 17 === 0) content += `\n${java ? '// ' : ''}orderCreated_123 Topic.Order.Created AB123456 publishOrder(event) Ärger\n`;
      if (r === repoCount - 1 && f === filesPerRepo - 1) content += '\nbilling.threshold.rare_needle_72639=true\n';
      let pad = 0; while (Buffer.byteLength(content) < fileBytes) { const token = hash(`${r}:${f}:${pad++}`).slice(0, 24); content += `${java ? '// ' : 'note.'}entry_${pad} = retry policy for warehouse ${r} step ${f} correlation ${token} and internal gateway timeout setting\n`; }
      write(path.join(source, java ? `src/main/java/bench/repo${r}/Part${f}.java` : `config/part-${f}.properties`), content);
    }
    inputs.push({ root: source, key: `BENCH/${repo}`, project: 'BENCH', repo, sha: hash(`${r}:${filesPerRepo}:${fileBytes}`).slice(0, 40), synthetic: true });
  }
  const publicSource = value('--public-source');
  if (publicSource) {
    const source = path.resolve(publicSource), revision = (await command('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim();
    const key = value('--public-repo', 'PUBLIC/' + path.basename(source)); assert.match(key, /^[\w.-]+\/[\w.-]+$/);
    inputs.push({ root: source, key, project: key.split('/')[0], repo: key.split('/')[1], sha: revision, synthetic: false });
  }
  write(path.join(home, 'inputs.json'), inputs);
  }
  const report = resume ? JSON.parse(fs.readFileSync(path.join(root, 'report.json'))) : { protocol: 'dt.code-search-benchmark/v1', observedAt: new Date().toISOString(), corpus: { syntheticRepositories: repoCount, filesPerRepo, requestedBytesPerFile: fileBytes, publicRevisions: inputs.filter(i => !i.synthetic).map(i => ({ repo: i.key, sha: i.sha })) }, host: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, cpus: os.cpus().length, memoryBytes: os.totalmem() }, limits: ['Local synthetic estate and pinned public source; not a production latency guarantee.', 'Native indexing includes semantic graph extraction and source snapshots. Zoekt is an additional text-only index over the exact same frozen files.', 'Timing uses the filesystem cache after corpus creation; warm searches use seven serial samples. No OS cache eviction or concurrency claim.', 'Native timings use the in-process engine; Zoekt timings include HTTP and JSON decoding. This is not an end-to-end tool latency comparison.'] };
  const save = () => write(path.join(root, 'report.json'), report);
  save(); console.error(resume ? 'Reusing frozen source snapshots' : 'Indexing native source snapshots and semantic graphs');
  const native = resume ? JSON.parse(fs.readFileSync(path.join(home, 'native-index.json'))) : JSON.parse((await command(process.execPath, [__filename, '--worker', home, 'index'])).stdout);
  for (const index of native.indexes) assert.ok(fs.existsSync(index.root), 'Frozen source snapshot exists');
  if (!resume) { write(path.join(home, 'native-index.json'), native); report.nativeIndex = { ...native, indexes: native.indexes.map(({ root, ...index }) => index) }; }
  try { const metadata = (await command('go', ['version', '-m', path.join(binaries, 'zoekt-index')])).stdout; report.zoektBuild = { repository: 'https://github.com/sourcegraph/zoekt', commit: metadata.match(/vcs.revision=([a-f0-9]+)/)?.[1], go: metadata.match(/go[0-9.]+/)?.[0] }; } catch { report.zoektBuild ||= { provenance: 'unknown; record the binary build externally' }; }
  save();
  if (!argv.includes('--bounded-only')) { console.error('Measuring native searches'); report.nativeSearch = JSON.parse((await command(process.execPath, [__filename, '--worker', home, 'search'])).stdout); save(); }
  console.error('Measuring bounded native searches'); report.nativeBounded = JSON.parse((await command(process.execPath, [__filename, '--worker', home, 'bounded'])).stdout); save();
  const zoektDir = path.join(root, 'zoekt-index');
  if (!resume || !report.zoektIndex) {
  fs.mkdirSync(zoektDir, { recursive: true });
  let coldMs = 0;
  for (const index of native.indexes) {
    const meta = path.join(root, 'meta.json'); write(meta, { Name: index.revisionKey, Branches: [{ Name: 'main', Version: index.sha }] });
    const indexed = await command(path.join(binaries, 'zoekt-index'), ['-index', zoektDir, '-parallelism', '1', '-disable_ctags', '-file_limit', '1048576', '-meta', meta, index.root]); coldMs += indexed.ms;
  }
  report.zoektIndex = { coldMs: round(coldMs), diskBytes: bytes(zoektDir), ctags: false, parallelism: 1 }; save();
  }
  const net = require('node:net'), probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const log = fs.openSync(path.join(root, 'zoekt-server.log'), 'a');
  const server = spawn(path.join(binaries, 'zoekt-webserver'), ['-index', zoektDir, '-listen', `127.0.0.1:${port}`, '-rpc', '-html=false'], { stdio: ['ignore', log, log] });
  try {
    const endpoint = `http://127.0.0.1:${port}`, request = async (query, limit = 100000) => {
      const Q = `case:no content:${JSON.stringify(query.regex ? query.pattern : query.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}`;
      const response = await fetch(endpoint + '/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Q, Opts: { MaxWallTime: 10000000000, TotalMaxMatchCount: limit * 10, ShardMaxMatchCount: limit * 10, MaxDocDisplayCount: limit, MaxMatchDisplayCount: limit * 10 } }), signal: AbortSignal.timeout(12000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.Error || `HTTP ${response.status}`); return data.Result;
    };
    let ready = false; for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error('Zoekt exited during startup'); try { const health = await fetch(endpoint + '/readyz', { signal: AbortSignal.timeout(1000) }); if (health.ok) { await request(queries[1]); ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } assert.ok(ready, 'Zoekt startup');
    if (!argv.includes('--bounded-only')) {
    report.zoektSearch = { queries: [] };
    for (const query of queries) {
      const started = performance.now(), cold = await request(query), coldSearchMs = performance.now() - started;
      const samples = []; let response;
      for (let i = 0; i < 7; i++) { const t = performance.now(); response = await request(query); samples.push(performance.now() - t); }
      const identities = (response.Files || []).flatMap(file => (file.LineMatches || []).map(line => `${file.Repository}\0${file.FileName}\0${line.LineNumber}`)).sort();
      const baseline = report.nativeSearch.queries.find(q => q.name === query.name);
      report.zoektSearch.queries.push({ name: query.name, coldMs: round(coldSearchMs), ...quantiles(samples), hits: identities.length, identityHash: hash(JSON.stringify(identities)), sameRows: baseline.identityHash === hash(JSON.stringify(identities)), filesConsidered: response.FilesConsidered, filesLoaded: response.FilesLoaded, contentBytesLoaded: response.ContentBytesLoaded, matchCount: response.MatchCount, crashes: response.Crashes, speedupP50: round(baseline.p50Ms / quantiles(samples).p50Ms) }); save();
    }
    }
    report.zoektBounded = { requestedRows: 100, upstreamMatchBudget: 1000, queries: [] };
    for (const query of queries) {
      const samples = []; let response;
      for (let i = 0; i < 7; i++) { const t = performance.now(); response = await request(query, 100); samples.push(performance.now() - t); }
      const matches = (response.Files || []).flatMap(file => (file.LineMatches || []).map(line => ({ repo: file.Repository, path: file.FileName, line: line.LineNumber, text: Buffer.from(line.Line, 'base64').toString('utf8').replace(/\n$/, '') }))).slice(0, 100);
      const re = new RegExp(query.regex ? query.pattern : query.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const baseline = report.nativeBounded.queries.find(q => q.name === query.name);
      report.zoektBounded.queries.push({ name: query.name, ...quantiles(samples), hits: matches.length, sameRowCount: matches.length === baseline.hits, allRowsMatch: matches.every(match => re.test(match.text)), filesConsidered: response.FilesConsidered, filesLoaded: response.FilesLoaded, speedupP50: round(baseline.p50Ms / quantiles(samples).p50Ms) }); save();
    }
    const syntax = [];
    for (const pattern of ['(?<=billing\\.)threshold', '(order)_\\1', 'get(?!Class)']) { try { await request({ regex: true, pattern }); syntax.push({ pattern, supported: true }); } catch (error) { syntax.push({ pattern, supported: false, error: error.message }); } }
    report.zoektRegexCompatibility = syntax;
    report.zoektSearch.residentBytes = Number((await command('ps', ['-o', 'rss=', '-p', String(server.pid)])).stdout.trim()) * 1024;
    report.ready = report.zoektSearch.queries.every(q => q.sameRows && !q.crashes) && report.zoektBounded.queries.every(q => q.allRowsMatch && q.sameRowCount); save(); console.log(JSON.stringify(report, null, 2)); if (!report.ready) process.exitCode = 1;
  } finally { if (server.exitCode === null) { const closed = new Promise(resolve => server.once('close', resolve)); server.kill('SIGTERM'); await closed; } fs.closeSync(log); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { queries, quantiles, command };
