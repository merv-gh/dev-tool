// Screenshots of every page, from the running demo (sh demo/start.sh), into docs/screenshots/.
//   NODE_PATH=<dir with playwright> node demo/screenshots.js [http://127.0.0.1:4800]     (ONLY=name,name for some)
// admin-scripts and api-routes need the demo with a browser (DEMO_BROWSER=1) and the demo scripts (demo/scripts/).
// Needs the playwright package (npm i -D playwright, or any install of it) and its Chromium.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4800';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const tool = async (name, args) => {
  const r = await fetch(`${BASE}/api/tool/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = 'demo';
  const logs = await tool('logs_search', { env, from: '1h' });
  const trace = await tool('logs_trace', { env, trace: 'tr-51842' });
  const shots = [
    ['admin-index', `${BASE}/admin#index`],
    ['admin-explore-table', `${BASE}/admin#explore`, async (p) => { await p.fill('#q', 'pg: sales.orders'); await p.waitForSelector('.line'); await p.click('.line[data-name="orders:sales.orders"]'); await p.waitForSelector('#detail h3'); }],
    ['admin-explore-function', `${BASE}/admin#explore`, async (p) => { await p.fill('#q', 'pgfn: order_total'); await p.waitForSelector('.line'); await p.click('.line[data-name="orders:sales.order_total"]'); await p.waitForSelector('#detail h3'); }],
    ['admin-passports', `${BASE}/admin#passports`],
    ['admin-jobs', `${BASE}/admin#jobs`, async (p) => { await p.waitForSelector('#jobs tr[data-job]'); await p.click('#jobs tr[data-job]'); await p.waitForSelector('.joblog'); }],
    ['admin-scripts', `${BASE}/admin#scripts`, async (p) => {
      await p.click('[data-script="shop/support/order-check"]'); await p.waitForFunction(() => document.getElementById('scDef').value);
      await p.fill('#scParams', '{"orderId": 1042}'); await p.click('#scRun'); await p.waitForSelector('#scOut table', { timeout: 60000 });
    }],
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
      if (scheme === 'dark' && !['admin-explore-table', 'dashboard', 'logs', 'passport'].includes(name)) continue;
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'networkidle' });
      if (act) await act(p);
      await p.waitForTimeout(400);
      const h = Math.ceil(await p.evaluate(() => Math.max(...[...document.querySelectorAll('td, th, button, p, h1, h2, pre, svg, .chip, .tile, .line, textarea, .empty')].filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect().bottom + scrollY)))) + 16;
      const file = path.join(OUT, `${name}${scheme === 'dark' ? '-dark' : ''}.png`);
      await p.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: 1280, height: Math.min(h, /^admin-(explore|config|scripts)/.test(name) ? 2000 : 1300) } });
      console.log(path.relative(process.cwd(), file));
      await p.close();
    }
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
