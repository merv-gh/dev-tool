// Site map links, API routes (normalize, parse, learn, match to code endpoints), saved scripts
// (collections, templating, nesting, tool and browser steps) against a fake Playwright MCP server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-scripts-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;

// fake Playwright MCP: JSON answer for initialize, SSE for the rest; one page per session
const sessions = new Map();
let nextSession = 1;
const mcp = http.createServer((req, res) => {
  if (req.method === 'DELETE') { sessions.delete(req.headers['mcp-session-id']); res.statusCode = 200; return res.end(); }
  let body = '';
  req.on('data', c => body += c).on('end', () => {
    const msg = JSON.parse(body);
    if (msg.method === 'initialize') {
      const id = `s${nextSession++}`;
      sessions.set(id, { visited: [] });
      res.setHeader('mcp-session-id', id); res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } }));
    }
    if (msg.id === undefined) { res.statusCode = 202; return res.end(); }
    const s = sessions.get(req.headers['mcp-session-id']);
    if (!s) { res.statusCode = 404; return res.end('no session'); }
    const { name, arguments: a } = msg.params || {};
    let result;
    if (name === 'browser_navigate') {
      s.visited.push(a.url);
      result = { content: [{ type: 'text', text: `### Page\n- Page URL: ${a.url}` }] };
    } else if (name === 'browser_snapshot') result = { content: [{ type: 'text', text: `- heading "Order" [ref=e1]\n- visited ${s.visited.join(', ')}` }] };
    else if (name === 'browser_wait_for') result = { content: [{ type: 'text', text: 'waited' }] };
    else if (name === 'browser_network_requests') {
      const host = s.visited.length ? new URL(s.visited[0]).origin : 'http://x';
      result = { content: [{ type: 'text', text: [
        `[GET] ${s.visited[0]} => [200] OK`,
        `[GET] ${host}/static/app.3f2a.js => [200] OK`,
        `[GET] ${host}/api/orders/42?expand=items => [200] OK`,
        `[POST] ${host}/api/orders/42/refunds => [201] Created`,
        `[GET] ${host}/api/customers/9b2f5a0e-1c3d-4e5f-8a9b-0c1d2e3f4a5b => [404] Not Found`,
      ].join('\n') }] };
    } else if (name === 'browser_click') result = { isError: true, content: [{ type: 'text', text: 'Element not found' }] };
    else result = { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] };
    res.setHeader('content-type', 'text/event-stream');
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
    res.end();
  });
});

let shop;
test.before(() => new Promise(r => mcp.listen(0, '127.0.0.1', () => {
  const port = mcp.address().port;
  shop = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: { dev: { consul: 'http://127.0.0.1:9' } },
    scripts: { starters: false }, // this suite lists only its own collections; starters are tested in tool-contracts
    browser: {
      mcp: `${shop}/mcp`,
      sites: { shop: { url: `${shop}/login`, secrets: ['SHOP_PASSWORD'], links: { order: '/orders/<orderId>', search: { path: 'search?q=<q>', description: 'find anything' }, docs: 'https://docs.example.com/x' } } },
    },
  }));
  fs.writeFileSync(path.join(home, '.env'), 'SHOP_PASSWORD=secret\n');
  // a passport with endpoints, for matching observed routes to code
  fs.mkdirSync(path.join(home, 'passports', 'order-service'), { recursive: true });
  fs.writeFileSync(path.join(home, 'passports', 'order-service', 'passport.json'), JSON.stringify({
    service: 'order-service', repo: { project: 'P', repo: 'order-service', ref: 'main', sha: 'abc' },
    summary: { endpoints: 3, consumes: [], produces: [], tables: {}, calls: [], libraries: [] },
    effective: { endpoints: [
      { method: 'GET', path: '/orders/{id}', handler: 'OrderController.get', file: 'OrderController.java', line: 12 },
      { method: 'POST', path: '/orders/{id}/refunds', handler: 'RefundController.create', file: 'RefundController.java', line: 30 },
      { method: 'DELETE', path: '/orders/{id}', handler: 'OrderController.cancel', file: 'OrderController.java', line: 40 },
    ] },
  }));
  r();
})));
test.after(() => { mcp.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('site map: links resolve against the site URL, siteUrl fills <params>', () => {
  const cfg = require('../lib/config');
  const s = cfg.getBrowser().sites[0];
  assert.deepEqual(s.links.map(l => [l.link, l.url, l.params]), [
    ['order', `${shop}/orders/<orderId>`, ['orderId']],
    ['search', `${shop}/search?q=<q>`, ['q']],
    ['docs', 'https://docs.example.com/x', []],
  ]);
  assert.equal(s.links[1].description, 'find anything');
  assert.equal(cfg.siteUrl('shop.order', { orderId: 'A/1' }), `${shop}/orders/A%2F1`);
  assert.equal(cfg.siteUrl('shop'), `${shop}/login`);
  assert.throws(() => cfg.siteUrl('shop.order'), /needs orderId/);
  assert.throws(() => cfg.siteUrl('shop.nope'), /no link "nope"/);
  assert.equal(cfg.getBrowser().mcp, `${shop}/mcp`);
});

test('routes: ids become <id>, static files skipped, network text parsed', () => {
  const R = require('../lib/routes');
  assert.deepEqual(R.normalize('https://h/api/orders/42/items/9b2f5a0e-1c3d-4e5f-8a9b-0c1d2e3f4a5b?b=1&a=2'), { host: 'h', path: '/api/orders/<id>/items/<id>', query: ['a', 'b'] });
  assert.equal(R.normalize('https://h/app.js'), null);
  assert.equal(R.normalize('https://h/api/v2/orders').path, '/api/v2/orders', 'short names stay');
  assert.equal(R.normalize('https://h/o/ORD-12345').path, '/o/<id>');
  const got = R.parseNetwork('[GET] https://h/a => [200] OK\n2. POST https://h/b 201\nnothing here');
  assert.deepEqual(got, [{ method: 'GET', url: 'https://h/a', status: 200 }, { method: 'POST', url: 'https://h/b', status: 201 }]);
});

test('tools: browser_sites shows links, site_url fills them', async () => {
  const tools = require('../lib/tools');
  const s = await tools.call('browser_sites', {});
  assert.equal(s.sites[0].links.length, 3);
  assert.ok(!JSON.stringify(s).includes('secret"'), 'secret values never shown');
  assert.equal((await tools.call('site_url', { site: 'shop', link: 'order', params: { orderId: 7 } })).url, `${shop}/orders/7`);
});

test('scripts: save into nested collections, list, get, validate', async () => {
  const tools = require('../lib/tools');
  await assert.rejects(tools.call('script_save', { id: '../x', description: 'd', steps: [{ tool: 'find' }] }), /bad script id/);
  await assert.rejects(tools.call('script_save', { id: 'a/b', description: 'd', steps: [{ tool: 'find', open: 'x' }] }), /exactly one of/);
  await assert.rejects(tools.call('script_save', { id: 'a/b', description: 'd', steps: [] }), /steps required/);
  const r = await tools.call('script_save', { id: 'shop/common/sites', description: 'site list', params: { only: { default: 'shop' } }, steps: [{ tool: 'browser_sites', args: { site: '{{only}}' }, as: 'sites' }] });
  assert.equal(r.saved, true);
  assert.ok(fs.existsSync(path.join(home, 'scripts', 'shop', 'common', 'sites.json')));
  await tools.call('script_save', { id: 'shop/order-check', description: 'open an order and look', params: { orderId: { required: true } }, steps: [
    { script: 'shop/common/sites', as: 'cfg' },
    { open: 'shop.order' },
    { browser: 'snapshot', as: 'page' },
    { browser: 'click', args: { element: 'Refund', ref: 'e9' }, optional: true },
    { tool: 'site_url', args: { site: 'shop', link: 'search', params: { q: 'order {{orderId}} on {{cfg.sites.sites.0.site}}' } }, as: 'search' },
  ] });
  const l = await tools.call('script_list', {});
  assert.deepEqual(l.collections.map(c => [c.collection, c.scripts, c.tool]), [['shop', 2, null], ['shop/common', 1, null]]);
  assert.deepEqual(l.scripts.map(s => [s.id, s.steps, s.browser]), [['shop/common/sites', 1, false], ['shop/order-check', 5, true]]);
  assert.equal((await tools.call('script_list', { collection: 'shop/common' })).scripts.length, 1);
  assert.equal((await tools.call('script_get', { id: 'shop/order-check' })).params.orderId.required, true);
});

test('scripts: run nests scripts, fills templates, drives the browser, learns routes', async () => {
  const tools = require('../lib/tools');
  await assert.rejects(tools.call('script_run', { id: 'shop/order-check' }), /missing param orderId/);
  const r = await tools.call('script_run', { id: 'shop/order-check', params: { orderId: 42 } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.steps.map(s => [s.script, s.step, s.ok]), [
    ['shop/order-check', 1, true], ['shop/common/sites', 1, true], ['shop/order-check', 2, true],
    ['shop/order-check', 3, true], ['shop/order-check', 4, false], ['shop/order-check', 5, true],
  ]);
  assert.match(r.steps[4].error, /Element not found/);
  assert.match(r.results.page, /visited http:\/\/127\.0\.0\.1:\d+\/orders\/42/);
  assert.equal(r.results.search.url, `${shop}/search?q=order%2042%20on%20shop`);
  assert.deepEqual(r.routes, { requests: 4, api: 3, added: 3, total: 3 }, 'the opened page itself is not an API route');

  const rows = (await tools.call('api_routes', {})).rows;
  const key = (x) => `${x.service}|${x.method} ${x.path}|${x.seen}`;
  assert.deepEqual(rows.map(key).sort(), [
    '|GET /api/customers/<id>|1',
    'order-service|DELETE /orders/{id}|0', 'order-service|GET /api/orders/<id>|1', 'order-service|POST /api/orders/<id>/refunds|1',
  ].sort());
  const get = rows.find(x => x.path === '/api/orders/<id>');
  assert.equal(get.handler, 'OrderController.get');
  assert.equal(get.site, 'shop');
  assert.equal(get.query, 'expand');
  assert.equal(get.statuses, '200×1');
  assert.equal(sessions.size, 0, 'browser session closed');

  // and find sees them
  const lines = await tools.call('find', { q: 'api: refunds', env: 'dev' });
  assert.ok(lines.some(l => l.startsWith('api order-service POST /api/orders/<id>/refunds [seen 1 201×1]')), lines.join('\n'));
  assert.ok((await tools.call('find', { q: 'site: order', env: 'dev' })).some(l => l.startsWith('site shop.order ')));
});

test('routes_learn from pasted network text; routes_discover opens a link', async () => {
  const tools = require('../lib/tools');
  const r = await tools.call('routes_learn', { text: `[GET] ${shop}/api/orders/77?expand=items&page=2 => [200] OK\n[GET] ${shop}/favicon.ico => [200]` });
  assert.deepEqual([r.api, r.added], [1, 0]);
  const row = (await tools.call('api_routes', { q: 'orders', service: 'order-service' })).rows.find(x => x.method === 'GET' && x.seen);
  assert.equal(row.seen, 2);
  assert.equal(row.query, 'expand,page');

  const d = await tools.call('routes_discover', { site: 'shop', link: 'order', params: { orderId: 5 }, wait: 0 });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.steps[0].do, 'open shop.order');
  assert.equal(d.routes.api, 3);
  const routes = require('../lib/routes').load().routes;
  assert.ok(Object.values(routes).some(x => x.sources.includes('discover:shop.order')));
});

test('scripts: collections are folders: create, move, rename, copy, delete', () => {
  const S = require('../lib/scripts');
  S.mkdir('ops/empty');
  assert.ok(S.list().collections.some(c => c.collection === 'ops/empty' && c.scripts === 0), 'empty collections are listed');
  S.remove('shop/common/sites');
  assert.ok(fs.existsSync(path.join(home, 'scripts', 'shop', 'common')), 'deleting a script keeps its collection');
  assert.throws(() => S.remove('shop/common/sites'), /no script/);
  assert.equal(S.move('shop/order-check', 'ops/empty/order-check').kind, 'script');
  assert.equal(S.get('ops/empty/order-check').steps.length, 5);
  assert.equal(S.move('ops/empty', 'ops/support').kind, 'collection');
  assert.ok(S.get('ops/support/order-check'));
  assert.throws(() => S.move('ops', 'ops/support/inner'), /into itself/);
  S.copy('ops/support/order-check', 'ops/support/order-check-2');
  assert.throws(() => S.copy('ops/support/order-check', 'ops/support/order-check-2'), /already exists/);
  assert.throws(() => S.move('ops/support/order-check', 'ops/support/order-check-2'), /already exists/);
  assert.deepEqual(S.removeFolder('ops'), { collection: 'ops', deleted: true, scripts: 2 });
  assert.ok(!S.list().scripts.some(s => s.id.startsWith('ops/')));
  assert.throws(() => S.mkdir('../x'), /bad script id/);
});

test('admin: sites are edited one at a time in config.json', async () => {
  const admin = require('../lib/admin');
  const before = admin.sites();
  assert.equal(before.editable, true);
  assert.deepEqual(before.sites[0].secrets, [{ name: 'SHOP_PASSWORD', set: true }]);
  assert.equal(before.sites[0].links.find(l => l.link === 'search').description, 'find anything');
  await assert.rejects(admin.saveSite('', { name: 'bad name', url: 'http://x' }), /site name/);
  await assert.rejects(admin.saveSite('', { name: 'crm', url: 'ftp://x' }), /url must start/);
  await assert.rejects(admin.saveSite('', { name: 'crm', url: 'http://x', secrets: ['lower'] }), /\.env name/);
  await assert.rejects(admin.saveSite('', { name: 'shop', url: 'http://x' }), /already exists/);
  const r = await admin.saveSite('', { name: 'crm', url: '${CRM_URL:-http://crm.local}', secrets: [{ name: 'CRM_PASSWORD' }], links: [{ link: 'customer', path: '/c/<id>', description: 'one' }, { link: '', path: '' }] });
  assert.match(r.note, /Restart the browser container/);
  const crm = require('../lib/config').getBrowser().sites.find(s => s.site === 'crm');
  assert.equal(crm.links[0].url, 'http://crm.local/c/<id>');
  const raw = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(raw.browser.sites.crm.url, '${CRM_URL:-http://crm.local}', 'references stay references');
  assert.equal(raw.browser.mcp, `${shop}/mcp`, 'the rest of config.json is kept');
  assert.ok((await require('../lib/tools').call('find', { q: 'site: crm.customer', env: 'dev' })).some(l => l.startsWith('site crm.customer http://crm.local/c/<id>')), 'find sees the saved site at once');
  await admin.saveSite('crm', { name: 'backoffice', url: 'http://bo.local', links: [{ link: 'home', path: '/' }] });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).browser.sites), ['shop', 'backoffice'], 'renamed in place');
  await admin.saveSite('backoffice', null);
  assert.deepEqual(admin.sites().sites.map(s => s.name), ['shop']);
  await assert.rejects(admin.saveSite('nope', null), /no site/);
});
