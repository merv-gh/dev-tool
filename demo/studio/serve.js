// Interactive local showcase. Configuration, Git and HTTP data are disposable fixtures.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
async function start({ port = 0 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-studio-showcase-'));
  for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_TOOLS', 'DT_TOOL_PROFILE', 'DT_SECURITY_PROFILE']) delete process.env[key];
  Object.assign(process.env, { DT_HOME: home, DT_GIT_DIR: path.join(home, 'git'), DT_LOG: 'quiet', DT_NO_DOCTOR: '1', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy' });
  const fixture = await require('../../test/helpers/ui-page-fixture').seed(home, { auth: true });
  const A = require('../../lib/access'), T = require('../../lib/tools');
  const server = require('../../server').start({ host: '127.0.0.1', port });
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, file = path.join(home, 'config.json'), config = JSON.parse(fs.readFileSync(file));
  config.server.publicUrl = base;
  fs.writeFileSync(file, JSON.stringify(config)); require('../../lib/config').reload();
  const scope = { principalId: 'admin', storyId: 'showcase', role: 'admin', multiUser: true };
  let links;
  await A.run(scope, async () => {
    const demo = await require('../seed-editor').seed();
    for (const env of ['dev', 'uat']) fs.writeFileSync(path.join(home, 'cache', env, 'catalog.txt'), 'pg orders sales.orders [table] ~42: id bigint, status text\nsvc billing-api DEMO/billing@fixture: tables sales.orders\n');
    await T.call('continuation_create', { task_id: 'DEMO-42', title: 'Payments dependency release', summary: 'Review shared version owners, inspect affected source, retain checks and continue from another chat.', repositories: ['DEMO/payments-editor'], workspaces: [demo.workspace] });
    await T.call('continuation_write', { path: 'notes/release.md', content: '# Synthetic release investigation\n\nInspect the Jackson catalog owner and all affected consumers. Apply only after reviewing the exact source SHA. Next: run an explicit build on a configured runner.', summary: 'Fixture findings and next steps', expected_revision: null });
    const definition = { version: 1, title: 'Backend checks', description: 'Synthetic local health API. Opening sends no request; click Check health deliberately.', inputs: {}, sources: [{ id: 'services', rows: [{ name: 'orders-api', status: 'passing' }, { name: 'billing-api', status: 'passing' }] }], datasets: [], actions: [{ id: 'health', label: 'Check health', arguments: { request: { method: 'GET', url: fixture.base + '/dev/v1/health/state/any' } }, emits: ['health.checked'] }], widgets: [{ id: 'checks', type: 'panel', title: 'Services and explicit API check', collapsed: false, span: 2, children: [{ id: 'services', type: 'collection', title: 'Synthetic service observation', data: 'services', itemTitle: 'name', columns: [{ field: 'status', label: 'Status', format: 'status' }], on: [{ event: 'health.checked', effect: 'notice', message: 'Health response retained. Refresh explicitly to collect another observation.' }] }, { id: 'health', type: 'action', title: 'Inspect backend response', action: 'health' }] }] };
    const page = await T.call('ui_page', { action: 'save', id: 'backend-checks', definition, expected_revision: null });
    const pageName = await T.call('named_view', { action: 'save', name: 'Payments release board', expected_revision: null, target: { type: 'page', id: page.id } });
    const modelLinks = {};
    for (const template of ['diff-lines', 'workflow-continuation']) {
      const run = await T.call('logic_model', { action: 'run', template, mode: template === 'diff-lines' ? 'check' : 'simulate', seed: 42, coverage: template !== 'diff-lines' });
      const name = await T.call('named_view', { action: 'save', name: template + ' showcase', scope: 'shared', share: true, expected_revision: null, target: { type: 'result', id: new URL(run.view).pathname.split('/').pop() } });
      modelLinks[template] = name.url;
    }
    links = { studio: base + '/studio?story=showcase', editor: base + demo.editor, page: base + '/pages?story=showcase&id=backend-checks&scope=shared', namedDefinition: pageName.url, models: modelLinks };
  });
  let closing;
  const close = () => closing ||= (async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await require('../../lib/automation-flow').close(); await require('../../lib/isolate').stop(); await require('../../lib/state-store').close(); await fixture.close(); fs.rmSync(home, { recursive: true, force: true }); })();
  return { home, base, links, token: 'pages-admin-token-0123456', close };
}
module.exports = { start };
if (require.main === module) start({ port: Number(process.env.DT_DEMO_PORT || 0) }).then(demo => {
  console.log(JSON.stringify({ fixture: 'Synthetic local data only; no production model or infrastructure', signIn: demo.base + '/admin', demoToken: demo.token, links: demo.links }, null, 2));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => demo.close().catch(error => { console.error(error); process.exitCode = 1; }));
}).catch(error => { console.error(error); process.exitCode = 1; });
