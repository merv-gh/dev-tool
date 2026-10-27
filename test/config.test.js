// config.json + .env: references, envs, browser secrets; tools from config (sql/http), plugins from
// files and URLs (sha256 pins), hot reload when config.json changes; migration from the older layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-config-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;

// a tiny HTTP service: an API for an http tool, and plugin files to download
let pluginCode = `module.exports = [{ name: 'remote_hi', description: 'hi', run: () => 'hi from remote' }];`;
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/api/builds/order-service')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ auth: req.headers.authorization, query: req.url.split('?')[1] || '', builds: [{ id: 1, status: 'ok' }, { id: 2, status: 'failed' }] }));
  }
  if (req.url === '/plugin.js') return res.end(pluginCode);
  res.statusCode = 404; res.end();
});
let base;
test.before(() => new Promise(r => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; r(); })));
test.after(() => { srv.close(); fs.rmSync(home, { recursive: true, force: true }); });

const writeConfig = (c) => { fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(c, null, 2)); const t = new Date(Date.now() + Math.random() * 1e6); fs.utimesSync(path.join(home, 'config.json'), t, t); };

test('interpolate: references, defaults, nested defaults, lone unset -> null', () => {
  const { interpolate } = require('../lib/config');
  const v = (k) => ({ A: 'a', E: '' }[k]);
  assert.equal(interpolate('${A}', v), 'a');
  assert.equal(interpolate('${B}', v), null);
  assert.equal(interpolate('${B:-x}', v), 'x');
  assert.equal(interpolate('${B:-${A}}', v), 'a');
  assert.equal(interpolate('${B:-${C:-z}}', v), 'z');
  assert.equal(interpolate('${E:-d}', v), 'd', 'empty counts as unset');
  assert.equal(interpolate('http://${A}:${B:-80}/x', v), 'http://a:80/x');
  assert.deepEqual(interpolate({ k: ['${A}', 1] }, v), { k: ['a', 1] });
});

test('config.json + .env: envs, integrations, server, browser secrets file', () => {
  fs.writeFileSync(path.join(home, '.env'), "DEV_DB=postgres://u:p@db:5432/orders\nES_PASS=pw\nBB_TOKEN=t0k\nCRM_USER=ann\nCRM_PASSWORD=it's secret\nUNLISTED=nope\n");
  writeConfig({
    envs: {
      dev: { postgres: { orders: '${DEV_DB}', missing: '${NOPE}' }, elasticsearch: { hosts: 'http://es1:9200,http://es2:9200', user: 'elastic', password: '${ES_PASS}' }, consul: 'http://consul:8500/', logs: { index: 'app-*', fields: { level: 'severity' } } },
      uat: {},
    },
    bitbucket: { url: 'https://bb.example.com/', token: '${BB_TOKEN}' },
    passports: { internalGroups: ['com.acme.libs'] },
    browser: { sites: { crm: { url: 'https://crm/login', secrets: ['CRM_USER', 'CRM_PASSWORD'] } } },
    server: { publicUrl: 'https://dt.example.com/', ratePerSec: 3 },
  });
  const cfg = require('../lib/config');
  cfg.reload();
  assert.deepEqual(cfg.envNames(), ['dev', 'uat']);
  const dev = cfg.getEnv('dev');
  assert.deepEqual(dev.pg, { orders: 'postgres://u:p@db:5432/orders', missing: null });
  assert.equal(dev.defaultDb, 'orders');
  assert.deepEqual(dev.es, { hosts: ['http://es1:9200', 'http://es2:9200'], user: 'elastic', pass: 'pw' });
  assert.equal(dev.consul, 'http://consul:8500');
  assert.deepEqual(dev.logs.hosts, dev.es.hosts, 'logs fall back to the data cluster');
  assert.equal(dev.logs.fields.level, 'severity');
  assert.equal(dev.logs.fields.time, '@timestamp');
  assert.equal(cfg.getEnv('uat').kafkaUi, null);
  assert.throws(() => cfg.endpoint('uat', 'consul'), /envs\.uat\.consul/);
  assert.deepEqual(cfg.getPersonal().bitbucket, { url: 'https://bb.example.com', token: 't0k' });
  assert.deepEqual(cfg.getPersonal().internalGroups, ['com.acme.libs']);
  delete process.env.DT_PUBLIC_URL; delete process.env.DT_RATE_PER_SEC;
  assert.equal(cfg.getServer().publicUrl, 'https://dt.example.com');
  assert.equal(cfg.getServer().ratePerSec, 3);
  process.env.DT_RATE_PER_SEC = '0';
  assert.equal(cfg.getServer().ratePerSec, 0, 'environment wins');

  const b = require('../lib/browser').writeSecrets();
  const text = fs.readFileSync(b.file, 'utf8');
  assert.match(text, /^CRM_USER=ann$/m);
  assert.match(text, /^CRM_PASSWORD="it's secret"$/m);
  assert.doesNotMatch(text, /UNLISTED|BB_TOKEN|DEV_DB/, 'only browser secrets');
  assert.equal(fs.statSync(b.file).mode & 0o777, 0o600);
});

test('custom tools from config: sql binds :params, http fills {path} and query, rows path -> table', async () => {
  const tools = require('../lib/tools');
  assert.deepEqual(tools.bindSql('select :a::int, :b, :a', { a: 1, b: 'x' }), { text: 'select $1::int, $2, $1', values: [1, 'x'] });
  assert.throws(() => tools.bindSql('select :c', {}), /Missing argument: c/);
  fs.appendFileSync(path.join(home, '.env'), 'CI_TOKEN=ci-123\n');
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  cfg.tools = {
    disable: ['confluence'],
    custom: [
      { name: 'ci_builds', type: 'http', description: 'Builds of a service', url: `${base}/api/builds/{service}`, headers: { authorization: 'Bearer ${CI_TOKEN}' }, params: { service: { required: true }, branch: {} }, rows: 'builds' },
      { name: 'orders_by_status', type: 'sql', description: 'Orders by status', db: 'orders', sql: 'select * from sales.orders where status = :status limit :limit', params: { status: { required: true }, limit: { type: 'integer', default: 5 } } },
      { name: 'Bad Name', type: 'sql', description: 'x', sql: 'select 1' },
    ],
  };
  writeConfig(cfg);
  const r = await tools.call('ci_builds', { service: 'order-service', branch: 'main' });
  assert.equal(r.total, 2);
  const stored = require('../lib/results').load(r.view.split('/').pop());
  assert.equal(stored.rows[1].status, 'failed');
  const list = await tools.schemas();
  const sql = list.find(t => t.name === 'orders_by_status');
  assert.deepEqual(sql.inputSchema.required, ['status']);
  assert.ok(sql.inputSchema.properties.env, 'no env in the definition -> env parameter');
  assert.ok(!list.some(t => t.name === 'confluence_search'), 'tools.disable');
  const g = await tools.groups();
  assert.ok(g.errors.some(e => /Bad Name/.test(e.source)), 'bad definitions are reported, not fatal');
  assert.ok(g.groups.find(x => x.group === 'custom').tools.every(t => t.origin === 'config'));
  // the http tool really sent the header and the extra parameter
  const raw = await require('../lib/util').http(`${base}/api/builds/order-service?branch=main`, { headers: { authorization: 'Bearer ci-123' } });
  assert.equal(raw.auth, 'Bearer ci-123');
  assert.equal(raw.query, 'branch=main');
});

test('plugins: local file and URL, sha256 pin, hot reload on config change, update re-downloads', async () => {
  const tools = require('../lib/tools');
  fs.mkdirSync(path.join(home, 'extra'), { recursive: true });
  fs.writeFileSync(path.join(home, 'extra', 'local.js'), `module.exports = { tools: [{ name: 'local_hi', description: 'hi', input: { who: { type: 'string' } }, run: (a, ctx) => 'hi ' + a.who + ' ' + typeof ctx.tabular }] };`);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  cfg.tools = { plugins: ['extra/local.js', `${base}/plugin.js`, { url: `${base}/plugin.js?pinned`, sha256: '0'.repeat(64) }] };
  writeConfig(cfg);
  assert.equal(await tools.call('local_hi', { who: 'x' }), 'hi x function');
  assert.equal(await tools.call('remote_hi'), 'hi from remote');
  const g = await tools.groups();
  const pinned = g.plugins.find(p => p.pinned);
  assert.equal(pinned.present, false, 'a pin that does not match is not loaded');
  assert.ok(g.plugins.find(p => p.remote && !p.pinned).sha256.length === 64);
  assert.ok(!(await tools.schemas()).some(t => t.name === 'ci_builds'), 'config changed: custom tools gone without a restart');

  pluginCode = `module.exports = [{ name: 'remote_hi', description: 'hi', run: () => 'hi v2' }];`;
  assert.equal(await tools.call('remote_hi'), 'hi from remote', 'downloaded once');
  const r = await tools.reload({ update: true });
  assert.ok(r.fetched.some(f => f.sha256));
  assert.equal(await tools.call('remote_hi'), 'hi v2');
  assert.equal(tools.pluginSource('github:me/plugs/tools/x.js@v1').url, 'https://raw.githubusercontent.com/me/plugs/v1/tools/x.js');
  assert.equal(tools.pluginSource('github:me/plugs/x.js').url, 'https://raw.githubusercontent.com/me/plugs/main/x.js');
});

test('admin writeConfig validates config.json and applies it', async () => {
  const admin = require('../lib/admin');
  assert.equal(admin.readConfig().format, 'config.json');
  await assert.rejects(admin.writeConfig('{"envs": {}}'), /needs "envs"/);
  await assert.rejects(admin.writeConfig('{"envs": {"dev": {"postgres": [1]}}}'), /postgres must be/);
  await assert.rejects(admin.writeConfig('{"envs": {"dev": {}}, "tools": {"custom": [{"name": "x1", "type": "ftp", "description": "d"}]}}'), /type must be/);
  const r = await admin.writeConfig('{"envs": {"dev": {}, "qa": {}}}');
  assert.deepEqual(r.envs, ['dev', 'qa']);
  assert.ok(fs.existsSync(path.join(home, 'config.json.bak')));
});

test('migrate-config: the older layout becomes config.json + .env with the same resolved values', () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-migrate-'));
  fs.writeFileSync(path.join(old, 'envs.json'), JSON.stringify({
    dev: { envFile: '.env.dev', pg: { main: 'DATABASE_URL', alt: ['DATABASE_URL_X', 'DATABASE_URL_Y'] }, es: { hosts: ['http://es:9200'], hostsVar: 'ELASTICSEARCH_HOSTS', userVar: 'ELASTICSEARCH_USER', passVar: 'ELASTICSEARCH_PASS' }, consul: { url: 'http://consul:8500', var: 'CONSUL_HOST' } },
    uat: { envFile: '.env.uat' },
  }));
  fs.writeFileSync(path.join(old, '.env.dev'), 'DATABASE_URL=postgres://a/main\nDATABASE_URL_Y=postgres://a/y\nELASTICSEARCH_USER=e\nELASTICSEARCH_PASS=p\nCONSUL_HOST=http://consul-override:8500\n');
  fs.writeFileSync(path.join(old, '.env.uat'), 'DATABASE_URL_ORDERS=postgres://b/orders\n');
  fs.writeFileSync(path.join(old, '.env.personal'), 'BITBUCKET_URL=http://bb\nBITBUCKET_HTTP_TOKEN=tok\nINTERNAL_GROUPS=com.a\n');
  fs.writeFileSync(path.join(old, '.env.browser'), 'CRM_URL=https://crm\nCRM_PASSWORD=pw\n');
  const { execFileSync } = require('child_process');
  const run = (code) => JSON.parse(execFileSync(process.execPath, ['-e', code], { env: { ...process.env, DT_HOME: old }, cwd: path.join(__dirname, '..') }).toString());
  const snapshot = `const c=require('./lib/config');console.log(JSON.stringify({dev:c.getEnv('dev'),uat:c.getEnv('uat'),bb:c.getPersonal().bitbucket,groups:c.getPersonal().internalGroups,sites:c.getBrowser().sites,vals:c.getBrowser().secretValues()}))`;
  const before = run(snapshot);
  const m = run(`console.log(JSON.stringify(require('./lib/migrate').migrate()))`);
  assert.deepEqual(m.envs, ['dev', 'uat']);
  const after = run(snapshot);
  for (const k of ['pg', 'es', 'consul', 'defaultDb']) assert.deepEqual(after.dev[k], before.dev[k], `dev.${k}`);
  assert.deepEqual(after.uat.pg, before.uat.pg);
  assert.deepEqual([after.bb, after.groups, after.sites, after.vals], [before.bb, before.groups, before.sites, before.vals]);
  const env = fs.readFileSync(path.join(old, '.env'), 'utf8');
  assert.match(env, /^DEV_DATABASE_URL=postgres:\/\/a\/main$/m);
  assert.match(env, /^UAT_DATABASE_URL_ORDERS=postgres:\/\/b\/orders$/m);
  const cfg = JSON.parse(fs.readFileSync(path.join(old, 'config.json'), 'utf8'));
  assert.equal(cfg.envs.dev.consul, 'http://consul-override:8500', 'plain values are inlined');
  assert.equal(cfg.envs.dev.elasticsearch.password, '${DEV_ELASTICSEARCH_PASS}', 'secrets stay references');
  assert.doesNotMatch(JSON.stringify(cfg), /postgres:\/\/|tok"|"pw"/, 'no secret values in config.json');
  fs.rmSync(old, { recursive: true, force: true });
});
