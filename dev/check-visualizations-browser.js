// Opt-in, synthetic browser coverage. No real environment or external network is used.
// NODE_PATH=<playwright modules> node dev/check-visualizations-browser.js [output folder]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

async function run(out = path.join('work', 'visualization-proof'), { screenshots = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-visualizations-'));
  process.env.DT_HOME = home;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { example: {} } }));
  const views = require('../lib/views'), format = require('../web/map-format');
  const web = path.resolve(__dirname, '../web'), at = '2026-11-01T10:00:00.000Z';
  const patch = views.get('patch').sample;
  const table = { id: 'result', kind: 'pg', env: 'example', db: 'orders', at, total: 120, query: 'select * from orders', rows: Array.from({ length: 120 }, (_, i) => ({ id: i + 1, status: i % 2 ? 'new' : 'paid', total: 10 + i, customer: { name: `Customer ${i}` } })) };
  const logs = { id: 'logs', kind: 'logs', env: 'example', at, total: 40, query: 'orders', rows: Array.from({ length: 40 }, (_, i) => ({ time: at, level: i % 2 ? 'INFO' : 'ERROR', service: `service-${String(i).padStart(2, '0')}`, message: `Order ${i}`, source: { order: i } })) };
  const passport = { service: 'order-service', env: 'example', repo: { project: 'SHOP', repo: 'orders', ref: 'main', sha: 'abc123abc123' }, builtAt: at, app: {}, effective: { endpoints: [], consumes: [], produces: [], calls: [], tables: [] }, summary: { endpoints: 0, consumes: [], produces: [], tables: {}, calls: [] }, libraries: [], http: [], db: { datasources: [] }, es: [], dependencies: { external: [] }, config: { unresolved: [] } };
  const mapNodes = [{ id: 'svc:orders', kind: 'service', label: 'Order service', scope: 'SHOP', detail: 'Verified API service' }, { id: 'topic:orders.paid', kind: 'kafka', label: 'orders.paid', scope: 'events', detail: 'Payment event' }];
  const mapBytes = format.encode(mapNodes, [{ from: mapNodes[0].id, to: mapNodes[1].id, kind: 'produces', certainty: 'code', where: 'Publisher.java:12' }], ['example', at, 'abc123', 'Microservice map', '2', '1', '0', '0']);
  const sample = name => {
    const data = views.get(name).sample;
    if (name === 'diagram') return { ...data, diagrams: [{ name: 'Order flow', format: 'mermaid', source: 'graph LR; orders-->paid', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 220"><rect x="40" y="60" width="180" height="60" fill="#e8eefb"/><text x="70" y="95">Order service</text><path d="M220 90 H320" stroke="#666"/><text x="330" y="95">orders.paid</text></svg>' }] };
    return data;
  };
  const requests = [], errors = [], findings = [], captures = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); requests.push(url.pathname + url.search);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const send = (body, type = 'application/json') => { res.setHeader('Content-Type', type); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    if (url.pathname.startsWith('/static/')) {
      const file = path.resolve(web, url.pathname.slice(8));
      if (!file.startsWith(web + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
      return send(fs.readFileSync(file), file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    }
    if (url.pathname.startsWith('/show/')) {
      const name = url.pathname.split('/')[2]; res.setHeader('Content-Security-Policy', views.CSP);
      return send(views.render(name, sample(name), {}, { embed: url.searchParams.has('embed') }), 'text/html');
    }
    if (url.pathname.startsWith('/embed/')) {
      const target = url.pathname.slice(6);
      return send(`<iframe title="Chat result" sandbox="allow-scripts allow-popups allow-downloads" src="${target}?embed=1" style="width:100%;border:0;height:120px"></iframe><script>addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.source===f.contentWindow&&e.data.type==='iframe:height')f.style.height=e.data.height+'px'})</script>`, 'text/html');
    }
    if (url.pathname === '/api/result/result') return send(table);
    if (url.pathname === '/api/result/es') return send({ ...table, kind: 'es' });
    if (url.pathname === '/api/result/empty') return send({ ...table, total: 0, rows: [] });
    if (url.pathname === '/api/result/logs') return send(logs);
    if (url.pathname === '/api/result/pr') return send({ pr: { id: 7, project: 'SHOP', repo: 'orders', title: 'Round payment totals', state: 'OPEN', author: 'Example', from: 'fix', to: 'main', updated: at, reviewers: [], comments: [], files: patch.files.map(f => ({ path: f.path, add: f.added, del: f.removed })), diff: patch.patch } });
    if (url.pathname === '/api/result/showcase') return send({ data: { service: 'order-service', envs: ['example'], at, ms: 15, steps: [{ key: 'health:example', title: 'Health', ok: true, summary: 'All healthy', ms: 15 }] } });
    if (url.pathname === '/api/files/files') return send(url.searchParams.has('path') ? { ext: 'json', text: '{"order":42}', size: 12 } : { title: 'Task context', data: { store: 'context:example', entries: [{ path: 'notes.json', size: 12, mtime: at }], select: 'notes.json' } });
    if (url.pathname.startsWith('/api/passport/')) return send(passport);
    if (url.pathname === '/api/dash') return send({ at, health: { summary: { healthy: 3, services: 3, down: 0, degraded: 0 }, rows: [] }, es: { summary: { status: 'green', nodes: 1, notGreen: 0, unassignedShards: 0 }, rows: [] }, kafka: { summary: { lagging: 0, groups: 3, maxLag: 0, notStable: 0 }, rows: [] } });
    if (url.pathname.startsWith('/api/map/')) {
      if (/\/(graph|full)$/.test(url.pathname)) return send(Buffer.from(mapBytes), 'application/octet-stream');
      if (url.pathname.endsWith('/node')) return send({ node: mapNodes[0], actions: [], links: [] });
      return send({ text: '' });
    }
    const page = url.pathname.split('/')[1];
    if (['view', 'logs', 'map', 'files', 'pr', 'passport', 'dash', 'showcase'].includes(page)) return send(fs.readFileSync(path.join(web, page + '.html')), 'text/html');
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let checks = 0;
  fs.mkdirSync(out, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === base || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text; } }, configurable: true }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
    const ready = async route => {
      await page.goto(base + route, { waitUntil: 'networkidle' });
      const shell = page.locator('.inline-result'); if (await shell.count()) await shell.evaluate(el => el.open = true);
    };
    const menu = async scope => { await scope.locator('.dt-more > summary').click(); await scope.locator('.dt-more-panel:popover-open').waitFor(); };
    const capture = async name => { if (screenshots) { const file = path.join(out, name + '.png'); await page.screenshot({ path: file }); captures.push(file); } };
    // One batched desktop/mobile inspection across every built-in and legacy visualization.
    const routes = [...views.list().filter(v => v.builtin).map(v => '/show/' + v.name), '/view/result', '/logs/logs', '/map/map', '/files/files', '/pr/pr', '/passport/order-service', '/dash', '/showcase/showcase'];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) {
        await ready(route);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        if (overflow) findings.push({ width, route, issue: 'Page overflows horizontally' });
        assert.equal(await page.locator('details.dt-more[open]').count(), 0, route);
        if (await page.locator('.dt-more').count()) {
          await menu(page);
          const bounds = await page.locator('.dt-more-panel').boundingBox();
          if (bounds.x < -1 || bounds.x + bounds.width > width + 1) findings.push({ width, route, issue: 'Options exceed viewport' });
          await capture(route.replaceAll('/', '-') + '-' + width + '-options');
          await page.keyboard.press('Escape'); assert.equal(await page.locator('.dt-more[open]').count(), 0);
          assert.equal(await page.locator('.dt-more > summary').evaluate(el => el === document.activeElement), true); checks += 3;
        } else if (['/show/tests', '/show/patch', '/dash', '/files/files'].includes(route)) await capture(route.replaceAll('/', '-') + '-' + width);
        checks++;
      }
    }
    await page.setViewportSize({ width: 1000, height: 900 });
    await ready('/view/result');
    await page.locator('#filter').fill('paid'); await page.waitForFunction(() => document.querySelector('#page').textContent.includes('of 60'));
    for (const fmt of ['tsv', 'csv', 'json', 'md']) {
      await menu(page); await page.locator(`[data-copy="${fmt}"]`).click();
      const value = await page.evaluate(() => window.__copied);
      assert.ok(value.includes('119'), fmt + ' includes all filtered pages');
      if (fmt === 'json') assert.equal(JSON.parse(value).length, 60); else if (fmt !== 'md') assert.equal(value.split('\n').length, 61);
      checks++;
    }
    for (const fmt of ['csv', 'json']) {
      await menu(page); const downloaded = page.waitForEvent('download'); await page.locator(`[data-dl="${fmt}"]`).click();
      const value = fs.readFileSync(await (await downloaded).path(), 'utf8');
      assert.equal(fmt === 'json' ? JSON.parse(value).length : value.split('\n').length - 1, 60); checks++;
    }
    await menu(page); await page.locator('#flat').click(); assert.equal(await page.locator('#flat').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.dt-more > summary').getAttribute('aria-label'), /1 active/);
    await page.locator('#size').selectOption('100'); assert.match(await page.locator('#page').textContent(), /1–60/); checks += 3;
    await page.keyboard.press('Escape'); await page.locator('.dt-more > summary').focus(); await page.keyboard.press('Enter'); await page.locator('.dt-more-panel:popover-open').waitFor();
    await page.keyboard.press('Tab'); assert.equal(await page.locator('#flat').evaluate(el => el === document.activeElement), true); checks++;
    await page.locator('#filter').click(); await page.waitForFunction(() => !document.querySelector('.dt-more').open); checks++;
    await ready('/logs/logs'); assert.equal(await page.locator('#service-filter option').count(), 41);
    await page.locator('#service-filter').selectOption('service-39'); assert.match(await page.locator('#count').textContent(), /^1 of 40/); checks += 2;
    await ready('/show/impact'); await page.locator('#filt').selectOption('pgfn'); assert.equal(await page.locator('#layers .it').count(), 1); checks++;
    await ready('/show/knowledge-map'); await menu(page); await page.locator('#evidence-filter').selectOption('indexed'); assert.match(await page.locator('.dt-more > summary').getAttribute('aria-label'), /1 active/); checks++;
    await ready('/map/map'); await menu(page); await page.locator('#map-candidates').check(); await page.waitForTimeout(100); assert.match(await page.locator('.dt-more > summary').getAttribute('aria-label'), /1 active/); assert.ok(requests.some(r => /graph\?.*candidates=1/.test(r))); checks += 2;
    await ready('/show/collection-report');
    for (const id of ['cr-download', 'cr-junit']) { await menu(page); const pending = page.waitForEvent('download'); await page.locator('#' + id).click(); assert.ok(fs.statSync(await (await pending).path()).size > 20); checks++; }
    // Real chat iframe: popup cannot clip to the old height or scroll panel. Escape restores focus.
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(base + '/embed/view/result', { waitUntil: 'networkidle' });
      const frame = page.frameLocator('iframe'); await frame.locator('.inline-result > summary').click();
      assert.equal(await frame.getByRole('link', { name: /Open full view/ }).count(), 1); checks++;
      await frame.locator('.dt-more > summary').click(); await frame.locator('.dt-more-panel:popover-open').waitFor();
      await page.waitForTimeout(150);
      const fits = await frame.locator('.dt-more-panel').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
      assert.ok(fits, 'embedded options visible at ' + width); await capture('chat-table-' + width); checks++;
    }
    await ready('/view/es'); assert.equal(await page.locator('#flat').getAttribute('aria-pressed'), 'true'); assert.match(await page.locator('.dt-more > summary').getAttribute('aria-label'), /1 active/); checks += 2;
    await ready('/view/empty'); await menu(page); assert.equal(await page.locator('[data-copy=csv]').isVisible(), true); await page.keyboard.press('Escape'); checks++;
    // The disclosure still works when the browser has no Popover API.
    const fallback = await context.newPage();
    await fallback.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined }));
    await fallback.goto(base + '/view/empty', { waitUntil: 'networkidle' }); await fallback.locator('.dt-more > summary').click();
    assert.ok(await fallback.locator('[data-copy=csv]').isVisible()); await fallback.keyboard.press('Escape'); assert.equal(await fallback.locator('.dt-more[open]').count(), 0); await fallback.close(); checks += 2;
    assert.deepEqual(errors, []);
    const report = { checks, views: routes.length, errors, findings, captures };
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    assert.deepEqual(findings, [], 'responsive visualization findings');
    return report;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); }
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
