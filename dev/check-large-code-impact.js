#!/usr/bin/env node
// Reuses an existing large benchmark index; adds two tiny local consumer fixtures.
// No source fetches or large-index rebuilds.
// node dev/check-large-code-impact.js <benchmark-home> [output.json] [--once]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
async function run(home, output, { repeats = 2 } = {}) {
  assert.ok(home, 'Pass the home folder produced by benchmark-code-search.js');
  for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_REPOS_DIR', 'DT_WORK_DIR', 'DT_TOOLS']) delete process.env[key];
  process.env.DT_HOME = path.resolve(home); process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  const tools = require('../lib/tools'), CI = require('../lib/codeindex'), selected = CI.select('PUBLIC/spring-framework');
  assert.equal(selected.length, 1, 'Pinned Spring Framework benchmark index is required');
  const info = CI.load(selected[0]), target = 'org.springframework.context.ApplicationEventPublisher#publishEvent(Object)';
  const fixture = (repo, name, source, dependency) => {
    const root = path.join(process.env.DT_HOME, 'impact-fixtures', repo), file = path.join(root, name + '.java'); fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(file, source);
    return CI.build(root, 'FIXTURE/' + repo, { project: 'FIXTURE', repo, sha: require('node:crypto').createHash('sha256').update(source + dependency).digest('hex').slice(0,40), ref: 'fixture', libs: [{ index: dependency }] });
  };
  const helper = fixture('events-helper', 'EventBridge', 'package fixture;\nimport org.springframework.context.ApplicationEventPublisher;\npublic class EventBridge { ApplicationEventPublisher publisher; public void send(Object event) { publisher.publishEvent(event); } }\n', info.revisionKey);
  const service = fixture('order-events', 'OrderEvents', 'package fixture;\nimport fixture.EventBridge;\npublic class OrderEvents { EventBridge bridge; public void emit(Object event) { bridge.send(event); } }\n', helper.revisionKey);
  const sample = async () => { const start = performance.now(), result = await tools.call('impact', { repos: service.revisionKey, target, depth: 3, max_output_bytes: 32768 }); assert.equal(result.resolvedTotal, 1); assert.ok(result.total > 0); for (const caller of ['ApplicationEventPublisher#publishEvent', 'EventBridge#send', 'OrderEvents#emit']) assert.ok(result.nearest.some(line => line.includes(caller)), 'Expected caller: ' + caller); return { elapsedMs: +(performance.now() - start).toFixed(3), resolvedTotal: result.resolvedTotal, total: result.total, traversalComplete: result.traversalComplete, complete: result.complete, gapTotal: result.gapTotal, cutReasons: result.cutReasons, nearest: result.nearest }; };
  try {
    const cold = await sample(), warm = repeats > 1 ? await sample() : null;
    const report = { protocol: 'dt.large-impact-probe/v1', observedAt: new Date().toISOString(), repo: 'PUBLIC/spring-framework', sha: info.sha, sourceBytes: info.bytes, classes: info.classes, target, selectedService: 'FIXTURE/order-events', automaticDependencyExpansion: true, repositoryChain: ['FIXTURE/order-events','FIXTURE/events-helper','PUBLIC/spring-framework'], workerHeapMb: require('../lib/config').getTools().workerHeapMb || 1024, maxRssBytes: process.resourceUsage().maxRSS * 1024, cold, warm, ok: true };
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); return report;
  } finally { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); }
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3], { repeats: process.argv.includes('--once') ? 1 : 2 }).catch(error => { console.error(error.stack); process.exitCode = 1; });
