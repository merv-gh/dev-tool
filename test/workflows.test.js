const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-guides-'));
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet';
require('../dev/eval/discovery-fixture').seed(home);
const T = require('../lib/tools'), W = require('../lib/workflows');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
test('compound requests route to explicit multi-stage guides without changing lexical rankings or claiming execution', async () => {
  const cases = [
    ['find all places across functions and repositories where this column gets read and written', 'column-lineage', 'pg_usage'],
    ['recreate bug locally find related entities in databases es kafka messages state', 'reproduce-state', 'fixture_plan'],
    ['refactor method takes postgres function results fills fields compare locally and dev environment', 'differential-refactor', 'impact'],
    ['run this test on dev environment', 'test-target', 'test_run'],
  ];
  for (const [query, id, capability] of cases) {
    const r = await T.call('tool_search', { query });
    assert.ok(r.workflows.some(g => g.id === id), JSON.stringify(r));
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 4096);
    const p = await T.call('tool_execute', { name: 'workflow_plan', arguments: { id } });
    assert.equal(p.executionPerformed, false); assert.match(p.view, /\/show\//);
    assert.ok(p.stages.some(s => s.tools.includes(capability)));
    assert.ok(p.boundaries.length); assert.ok(p.required.length);
  }
  const r = await T.call('tool_search', { query: 'the unknown frobnicator' });
  assert.deepEqual(r.workflows, []);
  await assert.rejects(T.call('workflow_plan', { id: 'not-a-workflow' }), /Unknown workflow/);
});
test('built-in guides reference actual registered capability names', async () => {
  const enabled = new Set((await T.schemas({ metadata: true })).map(t => t.name));
  for (const guide of W.definitions()) for (const stage of guide.stages) for (const name of stage.tools)
    assert.ok(enabled.has(name), `${guide.id}/${stage.id} references unknown capability ${name}`);
});
test('disabled tools cannot appear as executable guide candidates and unknown profiles fail closed', async () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tools: { disable: ['test_run'] } }));
  await T.reload();
  const r = await T.call('workflow_plan', { id: 'test-target' });
  assert.ok(r.stages.some(s => s.unavailable.includes('test_run')));
  assert.ok(r.stages.every(s => !s.tools.includes('test_run')));
  assert.equal(r.executionPerformed, false);
  const initial = await T.schemas({ profile: 'lean-find' });
  assert.equal(initial.length, 5); assert.ok(Buffer.byteLength(JSON.stringify(initial)) <= 4096);
});
test('guides update independently as data, reject executable/invalid overrides and preserve explicit boundaries', async () => {
  fs.mkdirSync(path.join(home, 'workflows'));
  const file = path.join(home, 'workflows', 'team.json');
  const g = { id: 'team-triage', title: 'Team triage', terms: 'triage invoice', required: ['invoice id'], stages: [{ id: 'evidence', goal: 'Read evidence', tools: ['find'] }], boundaries: ['No automatic diagnosis.'] };
  fs.writeFileSync(file, JSON.stringify({ version: 1, guides: [g] }));
  assert.equal((await T.call('workflow_plan', { id: 'team-triage' })).title, 'Team triage');
  g.title = 'Updated independently'; fs.writeFileSync(file, JSON.stringify({ version: 1, guides: [g] }));
  assert.equal(W.plan('team-triage', []).title, 'Updated independently');
  fs.writeFileSync(file, JSON.stringify({ version: 1, guides: [{ ...g, command: 'unexpected executable' }] }));
  assert.throws(() => W.definitions(), /unknown property/);
  fs.rmSync(file);
});
test('bounded multilingual discovery retains full evidence and explicitly counts omitted items', () => {
  const r = W.bounded({ total: 30, tools: Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'пример'.repeat(150), next: { tool: 'tool_describe', args: { name: `tool_${i}` } } })), workflows: [], lexical: { mode: 'normalized-keywords', ranker: 'legacy', matchedTerms: ['пример'], unmatchedTerms: [] } }, 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 2048);
  assert.equal(r.total, 30); assert.equal(r.truncated, true); assert.equal(r.omitted.tools + r.tools.length, 30);
  const id = r.view.split('/').at(-1), full = require('../lib/results').load(id);
  assert.equal(full.data.tools.length, 30); assert.equal(full.data.tools[0].description, 'пример'.repeat(150));
});
