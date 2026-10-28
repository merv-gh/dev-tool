#!/usr/bin/env node
// Offline registry evaluation. Never reads user configuration or calls live backends.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { performance } = require('perf_hooks');
const root = path.resolve(__dirname, '..');
const corpusPath = path.join(__dirname, 'eval/compact-discovery.corpus.json');
const corpusText = fs.readFileSync(corpusPath, 'utf8'), corpus = JSON.parse(corpusText);
const bytes = x => Buffer.byteLength(JSON.stringify(x), 'utf8');
const size = x => ({ utf8Bytes: bytes(x), estimatedTokens: Math.ceil(bytes(x) / 4), tokenEstimateMethod: 'UTF-8 bytes / 4; not a tokenizer measurement' });
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];

async function benchmark() {
  // This must happen before loading lib/config, which fixes paths at module load.
  if (require.cache[require.resolve('../lib/config')]) throw new Error('Run benchmark in its own process before importing configuration');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-discovery-eval-'));
  for (const key of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS)$/.test(key)) delete process.env[key];
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  require('./eval/discovery-fixture').seed(home, { discoveryRanker: 'bm25' });
  const T = require('../lib/tools');
  try {
    const schemas = await T.schemas({ metadata: true });
    const profiles = {};
    for (const profile of ['compact', 'lean', 'lean-find', 'all']) {
      try { const defs = await T.schemas({ profile }); profiles[profile] = { count: defs.length, ...size(defs), openAiFunctions: size(defs.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))) }; }
      catch (e) { if (e.code !== 'DT_PROFILE_UNKNOWN') throw e; }
    }
    const timings = [], cases = [];
    // Warm registration and schema construction independently from request timings.
    await T.call('tool_search', { query: 'registry warmup', limit: 5 });
    for (const item of corpus.cases) {
      if (!item.relevant.length || item.relevant.some(n => !schemas.some(t => t.name === n))) throw new Error('Invalid relevance judgment ' + item.id);
      const start = performance.now(), result = await T.call('tool_search', { query: item.query, limit: 5 });
      timings.push(performance.now() - start);
      const ranked = result.tools.map(t => t.name), relevant = new Set(item.relevant);
      const recall = k => ranked.slice(0, k).filter(n => relevant.has(n)).length / relevant.size;
      const describes = await Promise.all(ranked.map(name => T.call('tool_describe', { name })));
      cases.push({ ...item, ranked, recallAt3: recall(3), recallAt5: recall(5), search: size(result), top3Descriptions: size(describes.slice(0, 3)) });
    }
    const mean = field => cases.reduce((n, c) => n + c[field], 0) / cases.length;
    const report = {
      version: 1, kind: 'deterministic-registry-retrieval', ranker: 'bm25', experimentalOptIn: true, corpusVersion: corpus.version,
      corpusSha256: crypto.createHash('sha256').update(corpusText).digest('hex'),
      registrySha256: crypto.createHash('sha256').update(JSON.stringify(schemas)).digest('hex'),
      runtime: process.version, environment: 'temporary local config; dev/staging/prod; built-in enabled tools only; no remote systems',
      modelEvaluation: { performed: false, reason: 'Registry retrieval and scripted contract checks do not evaluate a language model' },
      profiles,
      metrics: { cases: cases.length, meanRecallAt3: mean('recallAt3'), meanRecallAt5: mean('recallAt5'), hitAt3: cases.filter(c => c.recallAt3 > 0).length / cases.length, hitAt5: cases.filter(c => c.recallAt5 > 0).length / cases.length },
      latencyMs: { kind: 'warm in-process real registry calls including local trace/history; no HTTP or model inference', samples: timings.length, p50: percentile(timings, .5), p95: percentile(timings, .95), max: Math.max(...timings) },
      context: { meanSearchBytes: cases.reduce((n, c) => n + c.search.utf8Bytes, 0) / cases.length, maxSearchBytes: Math.max(...cases.map(c => c.search.utf8Bytes)), meanTop3DescriptionBytes: cases.reduce((n, c) => n + c.top3Descriptions.utf8Bytes, 0) / cases.length },
      cases,
      contractChecks: await require('./eval/discovery-checks').checks(T, home, { discoveryRanker: 'bm25' }),
    };
    return report;
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
if (require.main === module) benchmark().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { benchmark };
