// Disposable UI playground. Source indexing is real; infrastructure and retained CPG rows are synthetic.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');

async function main() {
  const port = Number(process.argv[2] || 4064), manifestFile = path.resolve(process.argv[3] || 'work/ux-pass/demo.json');
  if (!Number.isInteger(port) || port < 1024 || port > 65534) throw Error('Choose an unprivileged port with the next port free for the local API');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ux-review-'));
  // All writes must stay inside the disposable home, regardless of a developer's usual overrides.
  for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_REPOS_DIR', 'DT_PASSPORTS_DIR', 'DT_PLUGINS_DIR', 'DT_SCRIPTS_DIR', 'DT_VIEWS_DIR', 'DT_WORK_DIR', 'DT_BUILD_DIR', 'DT_SEMANTIC_URL', 'DT_SEMANTIC_TOKEN', 'DT_BROWSER_MCP', 'DT_TOOLS', 'DT_TOOL_PROFILE']) delete process.env[key];
  Object.assign(process.env, { DT_HOME: home, DT_NO_DOCTOR: '1', DT_RATE_PER_SEC: '0', DT_LOG: 'quiet' });
  const apiBase = 'http://127.0.0.1:' + (port + 1), base = 'http://127.0.0.1:' + port;
  await require('./service-architecture').seed(home, port);
  const configFile = path.join(home, 'config.json'), config = JSON.parse(fs.readFileSync(configFile));
  delete config.server.accessTokens;
  config.server.host = '127.0.0.1';
  config.files = { notes: { type: 'local', path: 'notes', write: true } };
  config.scripts = { starters: false, http: { allow: [apiBase + '/api'] } };
  config.api = { authProfiles: { demo: { label: 'Demo API · server bearer', url: apiBase + '/api', bearerToken: '${UX_DEMO_TOKEN}', autoPrefill: true } } };
  fs.writeFileSync(path.join(home, '.env'), 'UX_DEMO_TOKEN=synthetic-demo-bearer\n');
  fs.writeFileSync(configFile, JSON.stringify(config));
  require('../lib/config').reload();
  const passportFile = path.join(home, 'passports/checkout/passport.json'), passport = JSON.parse(fs.readFileSync(passportFile));
  Object.assign(passport, { app: { springBoot: '3.3.4' }, http: [], dependencies: { internal: [], external: [] }, config: { files: [], unresolved: [] } });
  fs.writeFileSync(passportFile, JSON.stringify(passport));
  const semanticHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ux-semantic-'));
  try {
    require('../dev/semantic-ui-fixture').create(semanticHome);
    fs.cpSync(path.join(semanticHome, 'cache/semantic'), path.join(home, 'cache/semantic'), { recursive: true });
    fs.cpSync(path.join(semanticHome, 'passports/fixture-orders'), path.join(home, 'passports/fixture-orders'), { recursive: true });
  } finally { fs.rmSync(semanticHome, { recursive: true, force: true }); }
  const tools = require('../lib/tools'), views = require('../lib/views');
  await tools.call('context_open', { id: 'shop-142', title: 'SHOP-142 · Checkout investigation', summary: 'Trace authorized refunds, preserve findings and prepare a regression test.', tickets: ['SHOP-142'], repositories: ['DEMO/checkout'], tags: ['checkout', 'refunds'] });
  await tools.call('context_write', { id: 'shop-142', path: 'progress.md', content: '# Checkout investigation\n\n- [x] Inspect entry points\n- [x] Find refund table and events\n- [ ] Validate payment errors\n', summary: 'Plan and current progress' });
  await tools.call('context_write', { id: 'shop-142', path: 'evidence/boundaries.json', content: JSON.stringify(passport.effective, null, 2), summary: 'Detected boundary evidence' });
  const samples = [];
  for (const view of views.list().filter(view => view.builtin)) {
    const data = views.get(view.name).sample;
    if (data !== undefined) samples.push({ name: view.name, url: (await tools.call('show', { view: view.name, data, title: view.name + ' · Synthetic UI fixture' })).view });
  }
  const passportView = await tools.call('passport', { service: 'checkout' }), map = await tools.call('map', { env: 'dev', focus: 'svc:checkout', depth: 1 }), dossier = await require('../lib/service-architecture').collect({ service: 'checkout', env: 'dev', joern: false });
  const echo = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 42, status: 'fixture', bearerApplied: request.headers.authorization === 'Bearer synthetic-demo-bearer', path: request.url }));
  });
  await new Promise((resolve, reject) => { echo.once('error', reject); echo.listen(port + 1, '127.0.0.1', resolve); });
  require('../server').start({ port, host: '127.0.0.1' });
  const manifest = { home, base, apiBase, admin: base + '/admin', passport: passportView.view, map: map.view, dossier: dossier.view, samples };
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ ...manifest, manifest: manifestFile }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
