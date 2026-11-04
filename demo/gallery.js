// README gallery: every native result renderer plus the newer interactive workflows.
// Start demo/start.sh first. Needs Playwright (as demo/screenshots.js does).
// node demo/gallery.js [base URL] [--semantic-home <home from test/semantic.live.test.js>]
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:4800';
const OUT = path.join(__dirname, '../docs/screenshots');
const SEMANTIC_HOME = process.argv.includes('--semantic-home') ? process.argv[process.argv.indexOf('--semantic-home') + 1] : null;
if (!['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)) throw Error('Use a local demo, not a production environment');

async function json(route, options) {
  const response = await fetch(BASE + route, options), value = await response.json();
  if (!response.ok) throw Error(route + ': ' + JSON.stringify(value.error));
  return value;
}
async function tool(name, args) {
  return (await json('/api/tool/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).result;
}
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  if (process.argv.includes('--catalog-only')) {
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    try { await catalog(JSON.parse(fs.readFileSync(path.join(OUT, 'gallery.json'))), browser); }
    finally { await browser.close(); }
    return;
  }
  const shots = [], add = (name, title, url, act, origin = 'demo tool execution') => shots.push({ name, title, url, act, origin });
  // A complete renderer inventory. Sample titles stay visible in the screenshots.
  const views = await json('/api/admin/views');
  for (const view of views.filter(v => v.builtin)) {
    const source = await json('/api/admin/view?name=' + encodeURIComponent(view.name));
    if (source.sample === undefined) throw Error('Missing screenshot sample for ' + view.name);
    const result = await tool('show', { view: view.name, data: source.sample, title: `${view.name} · sample fixture` });
    add('sample-' + view.name, view.name, result.view, async page => {
      // Standalone views expose the payload; chat captures separately verify collapse defaults.
      await page.locator('.inline-result').evaluateAll(elements => elements.forEach(e => e.open = true));
    }, 'built-in sample fixture; presentation only');
  }

  const context = await tool('context_open', { id: 'readme-order-investigation', title: 'SHOP-142 · Order settlement investigation', summary: 'Trace an order from HTTP through internal libraries, Kafka and Postgres. Preserve evidence and the test plan.', tickets: ['SHOP-142'], repositories: ['SHOP/order-service'], tags: ['orders', 'settlement'] });
  const id = context.id || context.context?.id;
  if (!id) throw Error('Context did not return an id');
  await tool('context_write', { id, path: 'progress.md', content: '# Order settlement investigation\n\nGoal: find the source of the fee rounding difference.\n\n- [x] Compare demo and UAT versions\n- [x] Inspect sales.orders writers and the payment flow\n- [x] Reproduce expected 0.67 vs actual 0.66\n- [ ] Review the fix and run the collection suite\n\nEvidence is scoped to this demo. Runtime behavior requires its own test.\n', summary: 'Current plan, progress and remaining validation' });
  await tool('context_run', { id, tool: 'pg_usage', arguments: { env: 'demo', name: 'sales.orders' }, summary: 'Who reads and writes the order table' });
  add('admin-context', 'Context memory, nearby files & scratchpad', BASE + '/admin#context', async page => {
    await page.locator('#cxList button').filter({ hasText: 'SHOP-142' }).first().click();
    await page.locator('#cxWorking').waitFor({ state: 'visible' });
    await page.locator('#cxFiles button').filter({ hasText: 'progress.md' }).first().click();
  });
  add('admin-context-scratchpad', 'Editable tool arguments & saved context results', BASE + '/admin#context', async page => {
    await page.locator('#cxList button').filter({ hasText: 'SHOP-142' }).first().click();
    await page.locator('#cxTool option').first().waitFor({ state: 'attached' });
    await page.locator('#cxTool').selectOption('pg_usage');
    await page.locator('#cxArgs').fill(JSON.stringify({ env: 'demo', name: 'sales.orders' }, null, 2));
    await page.locator('#cxRun').click();
    await page.locator('#cxRun:not([disabled])').waitFor();
    await page.locator('#cxRun').scrollIntoViewIfNeeded();
  });
  add('admin-runtime', 'Owned executions, metadata, jobs & configuration', BASE + '/admin#runtime', async page => {
    await page.locator('[data-rt-execution]').first().waitFor();
    await page.locator('[data-rt-execution]').first().click();
    await page.locator('#rtExecution h3').waitFor();
  });
  add('admin-runtime-metadata', 'Read and annotate persisted operational records', BASE + '/admin#runtime', async page => {
    await page.locator('[data-rt-record]').first().click();
    await page.locator('#rtMetadataEditor').scrollIntoViewIfNeeded();
  });
  add('admin-runtime-config', 'Active configuration, storage and scheduler limits', BASE + '/admin#runtime', async page => {
    await page.locator('#rtConfig').evaluate(element => element.open = true);
    await page.locator('#rtSystem').scrollIntoViewIfNeeded();
  });
  add('admin-semantic', 'Retained semantic versions & tool workbench', BASE + '/admin#semantic', async page => {
    await page.locator('#smTool option').first().waitFor({ state: 'attached' });
    await page.locator('#smList').click();
    await page.locator('#smRun:not([disabled])').waitFor();
  });
  add('admin-ports-editor', 'Passport metadata, port corrections & evidence', BASE + '/admin#semantic?service=orders&env=dev', async page => {
    await page.locator('#smTool option').first().waitFor({ state: 'attached' });
    // Standard demo falls back to its order-service when real semantic fixtures were not supplied.
    if (!SEMANTIC_HOME) await page.locator('#smService').fill('order-service');
    await page.locator('#smPorts').click();
    await page.locator('#smPortEditor').waitFor({ state: 'visible' });
    await page.locator('#smMetadataEdit').click();
    await page.locator('#smArgs').scrollIntoViewIfNeeded();
  });
  const map = await tool('map', { env: 'demo', focus: 'svc:order-service', depth: 1, include_candidates: true });
  add('microservices-map', 'Service map with explicit static candidates and source evidence', map.view, async page => {
    await page.locator('#map-canvas svg').waitFor({ timeout: 30000 });
    await page.locator('[data-node="svc:order-service"]').click();
    await page.locator('#map-neighbors').waitFor();
    await Promise.all([page.waitForResponse(r => r.url().includes('/graph?')), page.locator('#map-neighbors').click()]);
    await page.locator('#map-fit').click();
  });
  add('admin-map-inspection', 'Map inspection with editable arguments and native results', BASE + '/admin#context', async page => {
    await page.locator('#cxMapOpen').click();
    const frame = page.frameLocator('#cxMapFrame');
    await frame.locator('#map-search').fill('order-service');
    await frame.locator('[data-node="svc:order-service"]').click();
    await frame.locator('.map-action').filter({ hasText: /^passport/ }).first().click();
    await frame.locator('#map-call-args').fill(JSON.stringify({ service: 'order-service', refresh: false }, null, 2));
    await frame.locator('#map-call-run').click();
    await frame.locator('#map-call-status').filter({ hasText: 'Completed.' }).waitFor();
    await page.locator('#cxMapFrame').scrollIntoViewIfNeeded();
  });
  const exchange = await tool('api_exchange_import', { source: 'Invented demo exchange; no HTTP request replayed', data: {
    request: { method: 'GET', url: 'https://shop.example.com/api/orders/1042', headers: { accept: 'application/json' } },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { kind: 'json', value: { id: 1042, status: 'paid', total: 42.75, items: [{ sku: 'BOOK-01', quantity: 2 }] } } },
    timing: { durationMs: 38 }
  } });
  add('api-client', 'Editable API requests, capture & response explorer', exchange.client, null, 'invented imported exchange; no replay');
  add('api-response', 'Native inline HTTP response', exchange.view, null, 'invented imported exchange; no replay');

  let showcase = process.env.SHOWCASE_VIEW;
  if (!showcase) {
    const result = await tool('showcase', { service: 'payments-service', envs: 'demo,uat' });
    let observed = result;
    while (observed.state === 'running') observed = await tool('showcase', { job: observed.job });
    if (!observed.ok) throw Error('Showcase failed: ' + JSON.stringify(observed));
    showcase = observed.view;
  }
  add('showcase', 'One-service investigation, versions, ports & semantic readiness', showcase, async page => {
    await page.locator('#sections details.sc').first().waitFor();
  });
  if (process.env.SHOWCASE_VIEW) {
    const saved = await json('/api/result/' + new URL(showcase, BASE).pathname.split('/').pop());
    for (const [key, name, title] of [
      ['impact', 'code-impact', 'Actual code impact from the service showcase'],
      ['test_run', 'workspace-test-run', 'Real Maven/JUnit run reproducing the rounding bug'],
      ['patch', 'workspace-patch', 'Actual workspace patch and recorded test verdicts'],
    ]) {
      const step = saved.data?.steps?.find(step => step.key === key);
      if (step?.view) add(name, title, step.view);
    }
  }

  // Only selected result payloads are imported. Never read tokens/configuration from the test home.
  if (SEMANTIC_HOME) {
    const dir = path.join(SEMANTIC_HOME, 'cache/results');
    const saved = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f))));
    for (const [name, title, select] of [
      ['semantic-reachability', 'Real Joern · Java service and two internal libraries', d => d.mode === 'reachability' && d.results?.some(p => new Set((p.nodes || []).map(n => n.repo)).size >= 3)],
      ['semantic-dataflow', 'Real Joern · value flow across the saved CPG', d => d.mode === 'dataflow' && d.results?.some(p => p.kind === 'data-flow' && p.nodes?.length)],
      ['semantic-composed', 'Real Joern local slices with declared HTTP/DB mappings', d => d.mode === 'dataflow' && d.results?.some(p => p.proof?.status === 'composed-static-lineage')],
      ['passport-adjustments', 'Manual ports, exact source identity and correction history', d => d.identity?.service === 'orders' && d.history?.length && d.ports?.some(p => p.status === 'declared')],
    ]) {
      const record = saved.find(r => r.kind === 'view' && select(r.data || {}));
      if (!record) throw Error('Real semantic result is missing: ' + name);
      const result = await tool('show', { view: record.view, data: record.data, title });
      add(name, title, result.view, async page => {
        await page.locator('.inline-result').evaluateAll(elements => elements.forEach(e => e.open = true));
        if (name === 'passport-adjustments') await page.locator('.pp-port').first().evaluate(e => e.open = true);
      }, 'retained real Joern end-to-end test result; demo source repositories');
    }
  }

  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [], captures = [];
  try {
    for (const width of [1280, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
      for (const shot of shots) {
        if (process.env.ONLY && !process.env.ONLY.split(',').includes(shot.name)) continue;
        if (width === 390 && !['showcase', 'admin-context', 'admin-runtime', 'admin-ports-editor', 'semantic-dataflow', 'semantic-composed', 'sample-patch', 'sample-tests'].includes(shot.name)) continue;
        const page = await ctx.newPage();
        page.on('pageerror', error => errors.push({ name: shot.name, width, message: error.message }));
        await page.goto(new URL(shot.url, BASE).href, { waitUntil: 'networkidle' });
        if (shot.act) await shot.act(page);
        await page.evaluate(() => document.fonts.ready);
        // Capture the viewport, preserving the actual responsive layout and overflow affordances.
        const filename = shot.name + (width === 390 ? '-mobile' : '') + '.png';
        await page.screenshot({ path: path.join(OUT, filename) });
        const overflow = await page.evaluate(() => document.body.scrollWidth > innerWidth + 1);
        captures.push({ file: filename, title: shot.title, width, origin: shot.origin, overflow });
        console.log(filename);
        await page.close();
      }
      await ctx.close();
    }
    const previous = process.env.ONLY && fs.existsSync(path.join(OUT, 'gallery.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'gallery.json'))).captures : [];
    const report = { captures: [...previous.filter(old => !captures.some(c => c.file === old.file)), ...captures], errors, renderers: views.filter(v => v.builtin).map(v => v.name) };
    await catalog(report, browser);
    if (errors.length) throw Error('Browser errors: ' + JSON.stringify(errors));
    const overflow = captures.filter(capture => capture.overflow);
    if (overflow.length) throw Error('Page overflow: ' + overflow.map(capture => capture.file).join(', '));
  } finally { await browser.close(); }
}
async function catalog(report, browser) {
    const { captures } = report, captured = new Set(captures.map(c => c.file));
    report.additionalScreenshots = fs.readdirSync(OUT).filter(file => file.endsWith('.png') && !captured.has(file) && file !== 'functionality-overview.png').sort().map(file => ({ file, title: file.replace(/\.png$/, '').replaceAll('-', ' '), origin: 'bundled demo; separate live-tool or Open WebUI capture script' }));
    fs.writeFileSync(path.join(OUT, 'gallery.json'), JSON.stringify(report, null, 2) + '\n');
    const groups = [
      ['Investigations & editing', captures.filter(s => s.width === 1280 && !s.file.startsWith('sample-'))],
      ['All native result views · sample fixtures', captures.filter(s => s.width === 1280 && s.file.startsWith('sample-'))],
      ['Mobile', captures.filter(s => s.width === 390)],
      ['Live tools, admin, Open WebUI & dark mode', report.additionalScreenshots],
    ];
    let markdown = '# Screenshot gallery\n\nCaptured from the running demo with `demo/gallery.js`, `demo/screenshots.js` and `demo/chat-screenshots.js`. Synthetic samples demonstrate rendering; real Joern captures use retained end-to-end test results. Open WebUI uses a scripted model with real tool calls. This gallery does not imply every integration was executed. [Capture instructions](../../demo/README.md).\n\n';
    for (const [title, items] of groups) {
      markdown += `## ${title}\n\n| | |\n| --- | --- |\n`;
      for (let i = 0; i < items.length; i += 2) markdown += '| ' + items.slice(i, i + 2).map(s => `![${s.title}](${s.file}) **${s.title}**`).join(' | ') + (items[i + 1] ? '' : ' | ') + ' |\n';
      markdown += '\n';
    }
    fs.writeFileSync(path.join(OUT, 'README.md'), markdown);
    const featured = ['showcase.png', 'chat-semantic.png', 'semantic-composed.png', 'admin-ports-editor.png', 'admin-context.png', 'microservices-map.png', 'sample-patch.png', 'sample-tests.png', 'admin-runtime.png', 'api-client.png', 'sample-knowledge-map.png', 'sample-reproduction.png'];
    const contact = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await contact.setContent('<html><style>body{margin:0;padding:24px;background:#eef1f5;color:#1c293b;font:16px system-ui}h1{margin:0 0 20px;font-size:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}figure{margin:0}img{display:block;width:100%;border:1px solid #d1d8e1;border-radius:6px}figcaption{font-size:13px;margin:7px 0 4px}</style><h1>dev-tool · functionality gallery</h1><div class="grid">' + featured.filter(file => fs.existsSync(path.join(OUT, file))).map(file => '<figure><img src="data:image/png;base64,' + fs.readFileSync(path.join(OUT, file)).toString('base64') + '"><figcaption>' + esc(captures.find(s => s.file === file)?.title || file) + '</figcaption></figure>').join('') + '</div></html>');
    await contact.screenshot({ path: path.join(OUT, 'functionality-overview.png'), fullPage: true });
    await contact.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
