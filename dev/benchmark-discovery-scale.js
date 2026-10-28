#!/usr/bin/env node
// Reproducible local capability scale. No inference/network and no production sources.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const start = performance.now(), home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-discovery-scale-'));
for (const k of Object.keys(process.env)) if (/^DT_(HOME|CONFIG_DIR|CACHE_DIR|REPOS_DIR|PASSPORTS_DIR|PLUGINS_DIR|SCRIPTS_DIR|VIEWS_DIR|WORK_DIR|BUILD_DIR|TOOLS|TOOL_PROFILE)$/.test(k)) delete process.env[k];
process.env.DT_HOME = home; process.env.DT_LOG = 'quiet';
const count = Number(process.env.DT_SCALE_TOOLS || 1000), samples = Number(process.env.DT_SCALE_SAMPLES || 100);
if (!Number.isInteger(count) || count < 1000 || count > 10000 || !Number.isInteger(samples) || samples < 30 || samples > 1000) throw new Error('Bounded scale requires 1000..10000 tools and 30..1000 samples');
require('./eval/discovery-fixture').seed(home, { profile: 'lean-find' });
fs.mkdirSync(path.join(home, 'plugins'));
fs.writeFileSync(path.join(home, 'plugins', 'scale.js'), `module.exports=Array.from({length:${count}},(_,i)=>({name:'service_'+i+'_evidence',group:'scale',description:'Inspect cached service '+i+' identity tenant revision schema event evidence and independent coverage',input:{env:{type:'string'},id:{type:'string'}},run:a=>({synthetic:true,...a})}));`);
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)];
(async () => {
  const T = require('../lib/tools'), cold = performance.now();
  await T.call('tool_search', { query: 'service_999_evidence', limit: 5 });
  const coldSearchMs = performance.now() - cold, timings = [], bytes = []; let exactHits = 0;
  for (let i = 0; i < samples; i++) {
    const name = `service_${(i * 617) % count}_evidence`, at = performance.now();
    const r = await T.call('tool_search', { query: name, limit: 8 });
    timings.push(performance.now() - at); bytes.push(Buffer.byteLength(JSON.stringify(r)));
    if (r.tools[0]?.name === name) exactHits++;
  }
  const schemas = await T.schemas({ profile: 'lean-find' }), initialBytes = Buffer.byteLength(JSON.stringify(schemas));
  const p95 = percentile(timings, .95), maxBytes = Math.max(...bytes);
  const report = { version: 1, kind: 'synthetic-discovery-scale', observedAt: new Date().toISOString(), provenance: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, cpus: os.availableParallelism(), memoryBytes: os.totalmem(), sourceRevision: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim(), fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(home, 'plugins/scale.js'))).digest('hex') }, fixture: { additionalTools: count, enabledTools: (await T.schemas()).length, samples, ranker: 'legacy', initialTools: schemas.length, initialSchemaBytes: initialBytes }, timing: { coldSearchMs, coldTotalMs: cold - start + coldSearchMs, warmP50Ms: percentile(timings, .5), warmP95Ms: p95, warmMaxMs: Math.max(...timings) }, output: { maxBytes, budgetBytes: 4096, exactNameHits: exactHits }, memory: { rssBytes: process.memoryUsage().rss, peakRssBytes: process.resourceUsage().maxRSS * 1024 }, gates: { warmP95Under250ms: p95 <= 250, outputBounded: maxBytes <= 4096, exactNameResolution: exactHits === samples, smallInitialProfile: schemas.length <= 5 && initialBytes <= 4096 }, limits: 'Synthetic capability metadata only; no network/inference. Impact scale is measured separately. Hardware/load affect latency; no guarantee for unmeasured plugins or models.' };
  console.log(JSON.stringify(report, null, 2)); if (process.argv.includes('--assert-ready') && Object.values(report.gates).some(x => !x)) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 2; }).finally(() => fs.rmSync(home, { recursive: true, force: true }));
