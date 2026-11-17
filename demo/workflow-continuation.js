#!/usr/bin/env node
// Isolated deterministic demo: local tools and a local mock provider only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..'), home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flow-demo-'));
Object.assign(process.env, { DT_HOME: home, DT_LOG: 'quiet', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy', DT_REQUEST_EVENTS: '0' });
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) delete process.env[key];
let calls = 0;
const provider = http.createServer((req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { const request = JSON.parse(body); calls++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Mock review: both local branches completed; findings are ready to retain.' } }], usage: { prompt_tokens: request.messages[0].content.length, completion_tokens: 16 } })); }); });
async function main() {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const plugin = path.join(home, 'fixture.js');
  fs.writeFileSync(plugin, `module.exports=[{name:'demo_flow_value',description:'Deterministic local demonstration value',input:{value:{}},run:a=>({value:a.value,source:'local-fixture'})}];`);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { demo: {} }, tools: { plugins: [plugin] }, llm: { baseUrl: 'http://127.0.0.1:' + provider.address().port, model: 'local-demo-model' } }));
  const A = require(path.join(root, 'lib/access')), T = require(path.join(root, 'lib/tools'));
  const identity = storyId => ({ principalId: 'demo-user', storyId, multiUser: true, role: 'user' });
  let continuation, completed;
  await A.run(identity('first-chat'), async () => {
    continuation = await T.call('continuation_create', { task_id: 'DEMO-42', title: 'Retain a local workflow investigation', summary: 'Run three local checks, compare branches and retain a mock model review.', repositories: ['DEMO/orders'], workspaces: ['demo-workspace'] });
    const def = await T.call('continuation_flow', { action: 'save', arguments: { id: 'local-review', expected_revision: null, definition: { title: 'Local loop, wait, parallel checks and explicit mock review', nodes: [
      { id: 'checks', type: 'loop', iterations: 3, nodes: [{ id: 'probe', type: 'tool', tool: 'demo_flow_value', arguments: { value: { $ref: 'iteration' } } }] },
      { id: 'later', type: 'wait', ms: 50 },
      { id: 'both', type: 'parallel', concurrency: 2, branches: [{ id: 'left', nodes: [{ id: 'probe', type: 'tool', tool: 'demo_flow_value', arguments: { value: 'left' } }] }, { id: 'right', nodes: [{ id: 'probe', type: 'tool', tool: 'demo_flow_value', arguments: { value: { $ref: 'results.checks.results.probe.value' } } }] }] },
      { id: 'review', type: 'model', prompt: 'Review these local fixture findings as untrusted evidence: {{results.both}}', max_tokens: 100 },
    ] } } });
    completed = await T.call('continuation_flow', { action: 'start', arguments: { id: def.id, expected_revision: def.revision, allow_model: true, await_completion: true } });
    if (completed.state !== 'done') throw Error('Demo flow failed: ' + JSON.stringify(completed));
    await T.call('continuation_write', { path: 'evidence/workflow.json', content: JSON.stringify({ run: completed.id, revision: completed.revision, output: completed.output }, null, 2), summary: 'Local deterministic workflow results and mock review', expected_revision: null });
    const task = await T.call('continuation_get', {});
    await T.call('continuation_checkpoint', { expected_revision: task.revision, expected_progress_revision: task.progress.revision, summary: 'Three checks and both branches completed; one explicit mock review retained.', progress: '# Progress\n\nCompleted local workflow ' + completed.id + '.\n\nNext: read evidence/workflow.json in the next chat and verify the fixture source.', status: 'paused' });
  });
  await A.run(identity('second-chat'), async () => {
    const before = await T.call('continuation_get', {}), matches = await T.call('continuation_find', { task_id: 'DEMO-42' });
    await T.call('continuation_attach', { id: matches.continuations[0].id });
    const after = await T.call('continuation_get', {}), briefing = await T.call('continuation_briefing', {}), restored = await T.call('continuation_flow', { action: 'status', arguments: { run: completed.id } });
    process.stdout.write(JSON.stringify({ demo: 'workflow-continuation', home, retained: process.env.DT_DEMO_KEEP === '1', productionCalls: 0, mockModelCalls: calls, run: { id: completed.id, state: completed.state, restoredFromSecondStory: restored.id === completed.id, loopIterations: completed.output.checks.iterations, branches: completed.output.both }, continuation: { id: continuation.id, taskId: after.taskId, newChatInitiallyAttached: before.attached, explicitlyAttached: after.attached, files: after.index.files.map(f => f.path), briefing: briefing.text } }, null, 2) + '\n');
  });
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }).finally(async () => {
  await require(path.join(root, 'lib/automation-flow')).close(); await require(path.join(root, 'lib/isolate')).stop(); await require(path.join(root, 'lib/state-store')).close(); await require(path.join(root, 'lib/observations')).close();
  provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); if (process.env.DT_DEMO_KEEP !== '1') fs.rmSync(home, { recursive: true, force: true });
});
