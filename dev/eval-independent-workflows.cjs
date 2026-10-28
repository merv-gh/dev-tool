#!/usr/bin/env node
// Frozen independent review corpus. This runner never changes relevance labels or guide terms.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const corpusPath = path.join(__dirname, 'eval/independent-compound-workflows.v1.json');
const freezePath = corpusPath.replace(/\.json$/, '.freeze.json');
async function run({ applyErrata = false } = {}) {
  if (require.cache[require.resolve('../lib/config')]) throw Error('Run independently before loading configuration');
  const bytes = fs.readFileSync(corpusPath), corpus = JSON.parse(bytes), freeze = JSON.parse(fs.readFileSync(freezePath));
  if (digest(bytes) !== freeze.sha256) throw Error('Independent corpus changed after freeze');
  const errata = applyErrata ? JSON.parse(fs.readFileSync(corpusPath.replace(/\.json$/, '.errata.json'))) : null;
  if (errata && errata.corpusSha256 !== freeze.sha256) throw Error('Errata do not match frozen corpus');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-independent-guides-'));
  for (const key of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS)$/.test(key)) delete process.env[key];
  process.env.DT_HOME = home; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  require('./eval/discovery-fixture').seed(home);
  const T = require('../lib/tools');
  try {
    const initial = await T.schemas({ profile: 'lean-find' }), cases = [];
    for (const c of corpus.cases) {
      const search = await T.call('tool_search', { query: c.query, limit: 5 });
      const plan = c.guide ? await T.call('tool_execute', { name: 'workflow_plan', arguments: { id: c.guide } }) : null;
      const stages = Object.fromEntries(Object.entries(c.stages).map(([id, original]) => {
        const names = original.map(n => errata?.capabilities[n] || n);
        const s = plan?.stages.find(s => s.id === id);
        return [id, { expected: names, missing: names.filter(n => !s?.tools.includes(n)) }];
      }));
      cases.push({ id: c.id, query: c.query, expectedGuide: c.guide, returnedGuides: search.workflows.map(w => w.id), guideHit: c.guide ? search.workflows.some(w => w.id === c.guide) : search.workflows.length === 0, rankedTools: search.tools.map(t => t.name), responseBytes: Buffer.byteLength(JSON.stringify(search)), stages, boundaryRequired: c.boundary || null, boundaries: plan?.boundaries || [], executionPerformed: plan?.executionPerformed || false });
    }
    const disabled = ['test_run', 'fixture_capture', 'api_request_replay'];
    require('./eval/discovery-fixture').configure(home, { disable: disabled });
    await T.reload();
    const disabledChecks = [];
    for (const [guide, tool] of [['test-target', 'test_run'], ['reproduce-state', 'fixture_capture'], ['ui-api-collection', 'api_request_replay']]) {
      const plan = await T.call('workflow_plan', { id: guide });
      const search = await T.call('tool_search', { query: corpus.cases.find(c => c.guide === guide).query, limit: 5 });
      let executeRejected = false;
      try { await T.call('tool_execute', { name: tool, arguments: {} }); } catch { executeRejected = true; }
      disabledChecks.push({ guide, tool, listedUnavailable: plan.stages.some(s => s.unavailable.includes(tool)), absentExecutableStage: plan.stages.every(s => !s.tools.includes(tool)), absentSearchTools: search.tools.every(t => t.name !== tool), executeRejected, executionPerformed: plan.executionPerformed });
    }
    const supported = cases.filter(c => c.expectedGuide), boundaries = cases.filter(c => c.boundaryRequired), stageResults = supported.flatMap(c => Object.values(c.stages));
    return { version: 1, kind: 'independent-frozen-workflow-guide-check', observedAt: new Date().toISOString(), frozenAt: freeze.frozenAt, corpusSha256: digest(bytes), ...(errata ? { errata } : {}), sourceRevision: freeze.candidateRevision, guidesSha256: digest(fs.readFileSync(path.join(__dirname, '../lib/workflow-guides.json'))), ranker: require('../lib/config').getTools().discoveryRanker, initial: { tools: initial.length, utf8Bytes: Buffer.byteLength(JSON.stringify(initial)) }, metrics: { cases: cases.length, positiveCases: supported.length, guideHitsAt2: supported.filter(c => c.guideHit).length, guideRecallAt2: supported.filter(c => c.guideHit).length / supported.length, declaredStages: stageResults.length, stagesWithAllExpectedEnabledCapabilities: stageResults.filter(s => !s.missing.length).length, unrelatedCasesWithoutGuide: cases.filter(c => !c.expectedGuide && c.guideHit).length, boundaryCases: boundaries.length, boundaryCasesWithExplicitGuideLimits: boundaries.filter(c => c.expectedGuide && c.boundaries.length).length, maxSearchBytes: Math.max(...cases.map(c => c.responseBytes)), disabledChecksPassed: disabledChecks.filter(c => c.listedUnavailable && c.absentExecutableStage && c.absentSearchTools && c.executeRejected && !c.executionPerformed).length }, cases, disabledChecks, limits: 'Independent author reviewed current guide definitions before writing cases, then froze labels and hash before any query. No guide terms or ranking changed after measurements. Guide recall and enabled capability coverage do not prove symptom diagnosis, task execution, configured backend availability, semantic adequacy of boundaries, or actual smaller-model performance. Required stage mappings are local reviewer judgments.' };
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
if (require.main === module) run({ applyErrata: process.argv.includes('--apply-errata') }).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { run };
