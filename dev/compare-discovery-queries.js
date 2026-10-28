#!/usr/bin/env node
// Compare untouched public queries with a frozen baseline algorithm replay and
// real current-registry calls. Public judgment labels never enter tool_search.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const input = process.argv[2];
if (!input) { console.error('Usage: node dev/compare-discovery-queries.js queries.json'); process.exit(1); }
const text = fs.readFileSync(input, 'utf8'), corpus = JSON.parse(text), cases = Array.isArray(corpus) ? corpus : corpus.cases;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-query-comparison-'));
for (const key of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS)$/.test(key)) delete process.env[key];
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
require('./eval/discovery-fixture').seed(home, { discoveryRanker: 'bm25' });
const priorDescription = 'Find the enabled tool for a task before calling it. Searches names, semantic descriptions and groups, with required arguments and effect hints. Results are bounded; use tool_describe for the exact schema, then tool_execute.';
const priorConsulDescription = 'Live: instances of ONE service registered in Consul with health and /version. Fuzzy name match. For all services use health.';
async function compare() {
  const T = require('../lib/tools'), schemas = await T.schemas({ metadata: true }), originalSchemas = schemas.map(t => t.name === 'tool_search' ? { ...t, description: priorDescription } : t.name === 'consul_service' ? { ...t, description: priorConsulDescription } : t), results = [];
  for (const item of cases) {
    const query = item.query || item.task, words = query.toLowerCase().split(/[\s_:-]+/).filter(Boolean);
    const baseline = originalSchemas.map(t => { const name = t.name.toLowerCase(), text = `${name.replace(/_/g, ' ')} ${t.group} ${t.description}`.toLowerCase(); return { t, score: (name === query.toLowerCase() ? 1000 : 0) + words.reduce((n, w) => n + (text.includes(w) ? 20 : 0) + (name.includes(w) ? 3 : 0), 0) }; }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
    const current = await T.call('tool_search', { query, limit: 5 }), ranked = current.tools.map(t => t.name), prior = baseline.slice(0, 5).map(x => x.t.name);
    const recall = list => ({ recallAt3: list.slice(0, 3).filter(n => item.relevant.includes(n)).length / item.relevant.length, recallAt5: list.filter(n => item.relevant.includes(n)).length / item.relevant.length });
    results.push({ ...item, query, baselineAlgorithmReplay: prior, improvedRealRegistry: ranked, lexical: current.lexical, ...(item.relevant?.length ? { baselineMetrics: recall(prior), improvedMetrics: recall(ranked) } : {}) });
  }
  const judged = results.filter(r => r.relevant?.length);
  const aggregate = key => Object.fromEntries(['recallAt3', 'recallAt5'].map(metric => [metric, judged.reduce((n, c) => n + c[key][metric], 0) / judged.length]));
  return { version: 1, kind: 'untouched-query-discovery-comparison', ranker: 'bm25', experimentalOptIn: true, baseline: '4b6dc31 deterministic substring ranking algorithm replay over original built-in descriptions', current: 'real tool_search registry calls; temporary synthetic config; no external systems or LLM', corpusSha256: crypto.createHash('sha256').update(text).digest('hex'), cases: results, ...(judged.length ? { metrics: { judgedCases: judged.length, baseline: aggregate('baselineMetrics'), improved: aggregate('improvedMetrics') } } : {}), limits: 'Lexical ranking is not symptom diagnosis, semantic recall, permission to act or application proof. No unsupported-operation success is inferred from returned tools.' };
}
compare().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => fs.rmSync(home, { recursive: true, force: true }));
