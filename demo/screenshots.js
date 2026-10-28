// Screenshots of every page, from the running demo (sh demo/start.sh), into docs/screenshots/.
//   NODE_PATH=<dir with playwright> node demo/screenshots.js [http://127.0.0.1:4800]     (ONLY=name,name for some)
// admin-scripts and api-routes need the demo with a browser (DEMO_BROWSER=1) and the demo scripts (demo/scripts/).
// Needs the playwright package (npm i -D playwright, or any install of it) and its Chromium.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4800';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
// expand collections in the tree (their open state is remembered between pages)
const expand = async (p, ...folders) => { for (const f of folders) if (await p.$(`[data-folder="${f}"] > .tr .tw`).then(e => e.textContent()) !== '▾') await p.click(`[data-folder="${f}"] > .tr`); };
const tool = async (name, args) => {
  const r = await fetch(`${BASE}/api/tool/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = 'demo';
  // some repeated work for the History tab
  for (const n of [1001, 1002, 1003]) await tool('pg_query', { env, sql: `select id, status, total from sales.orders where id = ${n}` });
  for (const t of ['sales.orders', 'sales.payments']) { await tool('find', { env, q: `pg: ${t}` }); await tool('pg_usage', { env, name: t }); }
  const logs = await tool('logs_search', { env, from: '1h' });
  const trace = await tool('logs_trace', { env, trace: 'tr-51842' });
  const shots = [
    ['admin-index', `${BASE}/admin#index`],
    ['admin-explore-table', `${BASE}/admin#explore`, async (p) => { await p.fill('#q', 'pg: sales.orders'); await p.waitForSelector('.line'); await p.click('.line[data-name="orders:sales.orders"]'); await p.waitForSelector('#detail h3'); }],
    ['admin-explore-function', `${BASE}/admin#explore`, async (p) => { await p.fill('#q', 'pgfn: order_total'); await p.waitForSelector('.line'); await p.click('.line[data-name="orders:sales.order_total"]'); await p.waitForSelector('#detail h3'); }],
    ['admin-passports', `${BASE}/admin#passports`],
    ['admin-jobs', `${BASE}/admin#jobs`, async (p) => { await p.waitForSelector('#jobs tr[data-job]'); await p.click('#jobs tr[data-job]'); await p.waitForSelector('.joblog'); }],
    ['admin-scripts', `${BASE}/admin#scripts`, async (p) => {
      await expand(p, 'shop', 'shop/support');
      await p.click('[data-sid="shop/support/order-check"] > .tr'); await p.waitForSelector('#pmBody .step');
      await p.fill('[data-run="orderId"]', '1042'); await p.click('#pmRun'); await p.waitForSelector('#pmOut table', { timeout: 60000 });
    }],
    ['admin-script-files', `${BASE}/admin#scripts`, async (p) => {
      await expand(p, 'partner');
      await p.click('[data-sid="partner/send-order"] > .tr'); await p.waitForSelector('#pmBody .step');
      await p.fill('[data-run="customerId"]', 'C-42'); await p.click('#pmRun'); await p.waitForSelector('#pmOut table', { timeout: 60000 });
    }],
    ['admin-script-js', `${BASE}/admin#scripts`, async (p) => {
      await expand(p, 'partner');
      await p.click('[data-sid="partner/send-order-js"] > .tr'); await p.waitForSelector('#pmBody .step');
      await p.click('#pmRun'); await p.waitForSelector('#pmOut table', { timeout: 60000 });
    }],
    ['admin-views', `${BASE}/admin#views`, async (p) => {
      await p.click('[data-view="text-diff"] .tr'); await p.waitForSelector('#vwPrev');
      await p.waitForFunction(() => { const f = document.getElementById('vwPrev'); return f && f.srcdoc.length > 100; }); await p.waitForTimeout(800);
    }],
    ['view-list-diff', (await tool('script_run', { id: 'reconcile/shipped-vs-settlement' })).view],
    ['view-text-diff', (await tool('diff', { mode: 'text', format: 'json', labels: ['template', 'sent to the partner'], title: 'order-basic.json → order.json',
      first: fs.readFileSync(path.join(__dirname, 'files/templates/orders/order-basic.json'), 'utf8'),
      last: (await tool('script_run', { id: 'partner/send-order-js', params: { customerId: 'C-42' } })).results.order })).view],
    ['view-xml', (await tool('show', { view: 'xml', data: fs.readFileSync(path.join(__dirname, 'sftp/partner/inbox/order-1042.xml'), 'utf8'), title: 'partner/inbox/order-1042.xml' })).view],
    ['feature-refunds', (await tool('feature', { text: 'How do refunds work?', spaces: 'SHOP', env })).view, async p => { await p.waitForSelector('#diagram-canvas svg', { timeout: 30000 }); }],
    ['files', (await tool('files_browse', { store: 'partner' })).view + '?open=reports%2F2026%2F10%2Fsummary.json', async (p) => { await p.waitForSelector('#body .j-tree'); }],
    ['files-xml', (await tool('files_show', { store: 'partner', path: 'partner/inbox/order-1042.xml' })).view, async (p) => { await p.waitForSelector('#body pre.src'); }],
    ['admin-history', `${BASE}/admin#history`, async (p) => { await p.waitForSelector('#patterns .step'); }],
    ['admin-sites', `${BASE}/admin#sites`, async (p) => { await p.click('[data-site="shop"] .tr'); await p.waitForSelector('#stLinks tr'); }],
    ['admin-api', `${BASE}/admin#api`, async (p) => { await p.waitForSelector('#routes tr td'); }],
    ['admin-config', `${BASE}/admin#config`, async (p) => { await p.waitForSelector('#toolGroups tr'); }],
    ['pg-usage', (await tool('pg_usage', { env, name: 'sales.orders' })).view],
    ['pg-query', (await tool('orders_by_status', { env, status: 'paid', limit: 40 })).view],
    ['health', (await tool('health', { env })).view],
    ['kafka-lag', (await tool('kafka_lag', { env })).view],
    ['kafka-last', (await tool('kafka_last', { env, topic: 'order_created', n: 8 })).view],
    ['dashboard', (await tool('overview', { env })).dashboard],
    ['logs', logs.view],
    ['trace', trace.view],
    ['pull-request', (await tool('bitbucket_pr', { project: 'SHOP', repo: 'payment-service', id: 42 })).view],
    ['passport', (await tool('passport', { service: 'order-service' })).view],
    ['who-uses', (await tool('who_uses', { env, name: 'order_total' })).view],
    ['api-routes', (await tool('api_routes', { q: 'api' })).view],
  ].filter(([name]) => !process.env.ONLY || process.env.ONLY.split(',').includes(name));
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, colorScheme: scheme });
    for (const [name, url, act] of shots) {
      if (scheme === 'dark' && !['admin-explore-table', 'dashboard', 'logs', 'passport', 'view-list-diff', 'files', 'feature-refunds'].includes(name)) continue;
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'networkidle' });
      await p.addStyleTag({ content: '.pm-side { position: static !important; }' }); // sticky sidebars look misplaced in full-page shots
      if (act) await act(p);
      await p.waitForTimeout(400);
      const h = Math.ceil(await p.evaluate(() => Math.max(...[...document.querySelectorAll('td, th, button, p, h1, h2, pre, svg, .chip, .tile, .line, textarea, .empty, .tree, .pv, .col')].filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect().bottom + scrollY)))) + 16;
      const file = path.join(OUT, `${name}${scheme === 'dark' ? '-dark' : ''}.png`);
      await p.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: 1280, height: Math.min(h, /^admin-(explore|config|script)/.test(name) ? 2200 : 1300) } });
      console.log(path.relative(process.cwd(), file));
      await p.close();
    }
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
