// Everything about one service on one page, and an end-to-end check of dt's parts at the same time:
//   1. each environment: health of every service, the dashboard, this service's instances and the
//      version and commit deployed (and whether the environments run the same build)
//   2. the passport: endpoints, topics, tables, libraries, flows
//   3. the impact of the code part to test
//   4. a workspace on master (or ref), an isolated test of the code part written and run, its patch
// Each step keeps its result and the link of its view; /showcase/<id> shows them all embedded.
const T = () => require('./tools');

function parseVersion(text) {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    const commit = v.git?.commit?.id || v.git?.commit || v.commit || v.sha || null;
    return { version: v.build?.version || v.version || null, commit: typeof commit === 'object' ? commit.id || null : commit, branch: v.git?.branch || v.branch || null };
  } catch {
    const sha = (String(text).match(/\b[0-9a-f]{7,40}\b/) || [])[0];
    return { version: null, commit: sha || null, branch: null };
  }
}

async function run({ service, target, envs, ref, test, log = () => {} } = {}) {
  const cfg = require('./config');
  envs = (Array.isArray(envs) ? envs : String(envs || '').split(',')).map(s => s.trim()).filter(Boolean);
  if (!envs.length) envs = cfg.envNames();
  const started = Date.now();
  const steps = [];
  const step = async (key, title, fn) => {
    const t0 = Date.now();
    log(`${title}...`);
    try {
      const r = await fn();
      steps.push({ key, title, ok: r?.ok !== false, ms: Date.now() - t0, ...r });
      log(`${title}: ${r?.ok === false ? 'failed' : 'ok'}${r?.summary ? ` (${r.summary})` : ''}`);
      return r;
    } catch (e) {
      steps.push({ key, title, ok: false, ms: Date.now() - t0, error: e.message });
      log(`${title}: ERROR ${e.message}`);
      return null;
    }
  };

  // 1. environments
  const versions = [];
  for (const env of envs) {
    await step(`health:${env}`, `Health of ${env}`, async () => {
      const h = await T().call('health', { env }, { source: 'showcase' });
      const mine = h.rows.find(r => r.service === service);
      return { env, view: h.view, summary: `${h.summary.healthy}/${h.summary.services} healthy${h.summary.down ? `, ${h.summary.down} down` : ''}${h.summary.degraded ? `, ${h.summary.degraded} degraded` : ''}`, service: mine || null };
    });
    await step(`dashboard:${env}`, `Dashboard of ${env}`, async () => {
      const o = await T().call('overview', { env }, { source: 'showcase' });
      return { env, view: o.dashboard, summary: o.summary ? Object.entries(o.summary).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ').slice(0, 160) : undefined };
    });
    await step(`instances:${env}`, `${service} in ${env}`, async () => {
      const s = await T().call('consul_service', { env, name: service }, { source: 'showcase' });
      if (!s.instances) throw new Error(`${service} is not in Consul of ${env}${s.matches?.length ? ` (did you mean ${s.matches.slice(0, 4).join(', ')}?)` : ''}`);
      for (const i of s.instances) versions.push({ env, instance: `${i.node} ${i.address}:${i.port}`, status: i.status, ...parseVersion(i.version) });
      const vs = [...new Set(s.instances.map(i => parseVersion(i.version).version).filter(Boolean))];
      return { env, instances: s.instances.length, passing: s.instances.filter(i => i.status === 'passing').length, versions: vs, summary: `${s.instances.filter(i => i.status === 'passing').length}/${s.instances.length} passing, version ${vs.join(', ') || 'unknown'}` };
    });
  }
  await step('versions', 'Versions across environments', async () => {
    const rows = versions.map(v => ({ env: v.env, instance: v.instance, status: v.status, version: v.version || '', commit: v.commit || '', branch: v.branch || '' }));
    const byEnv = {};
    for (const v of versions) if (v.version) (byEnv[v.env] ||= new Set()).add(`${v.version}@${v.commit || '?'}`);
    const builds = Object.fromEntries(Object.entries(byEnv).map(([e, s]) => [e, [...s]]));
    const distinct = new Set(Object.values(builds).flat());
    const view = require('./results').saveView('table', rows, { title: `${service}: versions in ${envs.join(', ')}` });
    return { view, builds, same: distinct.size <= 1, summary: distinct.size <= 1 ? `the same build everywhere (${[...distinct][0] || 'unknown'})` : Object.entries(builds).map(([e, b]) => `${e} ${b.join('/')}`).join(' vs ') };
  });

  // 2. the passport (also fetches the repo, its libraries, and indexes the code)
  const pp = await step('passport', `Passport of ${service}`, async () => {
    const p = await T().call('passport', { service, refresh: true }, { source: 'showcase' });
    return { view: p.view, repo: p.repo, summary: `${p.summary.endpoints} endpoints, consumes ${p.summary.consumes.join(', ') || '-'}, produces ${p.summary.produces.join(', ') || '-'}, ${Object.keys(p.summary.tables).length} tables, ${(p.flows || []).length} flows`, flows: (p.flows || []).slice(0, 8) };
  });

  // 3. impact of the code part
  if (target) {
    await step('impact', `Impact of ${target}`, async () => {
      const i = await T().call('impact', { target, env: envs[0] }, { source: 'showcase' });
      if (!i.resolved?.length) throw new Error(i.note || `nothing named ${target}`);
      return { view: i.view, summary: `${Object.values(i.counts || {}).reduce((a, b) => a + b, 0)} affected: ${Object.entries(i.counts || {}).map(([k, v]) => `${v} ${k}`).join(', ')}${i.endpoints?.length ? `; endpoints ${i.endpoints.join(', ')}` : ''}${i.tests?.length ? `; tests ${i.tests.join(', ')}` : ''}` };
    });
  }

  // 4. master (or ref): an isolated test of the code part, run; its patch
  if (target) {
    const ws = await step('workspace', `Workspace on ${ref || 'the default branch'}`, async () => {
      const w = await T().call('workspace_open', { service, ...(pp?.repo ? { project: pp.repo.project, repo: pp.repo.repo } : {}), ref: ref || '' }, { source: 'showcase' });
      return { workspace: w.id, ref: w.ref || 'default branch', sha: w.sha, summary: `${w.project}/${w.repo} @ ${String(w.sha).slice(0, 10)}, ${w.files} files, ${(w.libs || []).length} libraries` };
    });
    if (ws?.workspace) {
      const ctx = await step('test_context', `Test context of ${target}`, async () => {
        const c = await T().call('test_context', { workspace: ws.workspace, target }, { source: 'showcase' });
        return { style: c.style, path: c.test.path, className: c.test.class.split('.').pop(), skeleton: c.skeleton, summary: `${c.style} test at ${c.test.path}${c.dependencies?.length ? `, mocks ${c.dependencies.map(d => d.name).join(', ')}` : ''}${c.flow ? `, flow: ${c.flow.beans.map(b => b.name).join(' -> ')}` : ''}` };
      });
      if (ctx?.path) {
        const content = test || ctx.skeleton;
        await step('test_run', `Run ${ctx.className}`, async () => {
          if (!content) throw new Error('no skeleton for this test style: pass test= with the test source');
          let r = await T().call('test_run', { workspace: ws.workspace, tests: [ctx.className], files: [{ path: ctx.path, content }] }, { source: 'showcase' });
          while (r.state === 'running') r = await T().call('test_run', { workspace: ws.workspace, job: r.job }, { source: 'showcase' });
          if (r.error) throw new Error(r.error);
          // the step works when the tests ran; a test that finds a bug is a result, not a broken step
          return { ok: r.outcome === 'passed' || r.outcome === 'failed', view: r.view, outcome: r.outcome, counts: r.counts, mode: r.mode, testMs: r.ms, failures: r.failures, written: test ? 'given' : 'skeleton', summary: `${r.outcome}: ${r.counts.passed}/${r.counts.tests} passed in ${(r.ms / 1000).toFixed(1)} s (${r.mode})${r.failures?.length ? `; ${r.failures[0].test}: ${r.failures[0].expected != null ? `expected ${r.failures[0].expected}, got ${r.failures[0].actual}` : String(r.failures[0].message || '').split('\n')[0].slice(0, 120)}` : ''}` };
        });
        await step('patch', 'Patch', async () => {
          const p = await T().call('workspace_patch', { workspace: ws.workspace }, { source: 'showcase' });
          const verdicts = {};
          for (const t of p.tests || []) { const v = t.split(':')[0]; verdicts[v] = (verdicts[v] || 0) + 1; }
          return { view: p.view, download: p.download, files: (p.files || []).map(f => f.path), tests: p.tests, summary: `${(p.files || []).length} file${(p.files || []).length === 1 ? '' : 's'}${Object.keys(verdicts).length ? `; tests ${Object.entries(verdicts).map(([v, n]) => `${n} ${v}`).join(', ')}` : ''}` };
        });
      }
    }
  }

  const result = { service, target: target || null, envs, ref: ref || null, at: new Date().toISOString(), ms: Date.now() - started, ok: steps.every(s => s.ok), steps };
  result.view = require('./results').saveView('showcase', result, { title: `${service}${target ? ` · ${target}` : ''}` }, { page: 'showcase' });
  return result;
}

// For the model and the CLI: one line per step
function summary(r) {
  return {
    service: r.service, target: r.target, envs: r.envs, ok: r.ok, ms: r.ms,
    steps: r.steps.map(s => `${s.ok ? 'ok' : 'FAILED'}  ${s.title}${s.summary ? `: ${s.summary}` : ''}${s.error ? `: ${s.error}` : ''}`),
    view: r.view,
  };
}

module.exports = { run, summary, parseVersion };
