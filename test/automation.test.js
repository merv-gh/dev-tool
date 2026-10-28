// Scripts as tools (fuzzy names, collections), the call log and its shortcut suggestions, file stores
// (local + SFTP), and the new script steps (set, transform, http) on the full example:
// copy a template, give it new ids, upload it to a new SFTP folder, POST that folder to an API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-auto-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;

const sftpRoot = path.join(home, 'sftp-root');
fs.mkdirSync(path.join(sftpRoot, 'upload'), { recursive: true });
fs.mkdirSync(path.join(home, 'files', 'templates', 'orders'), { recursive: true });
const TEMPLATE = { orderId: 'ORD-1001', customer: { id: 'C-77', name: 'Ada' }, items: [{ id: 'L-1', ref: 'ORD-1001' }, { id: 'L-2', ref: 'ORD-1001' }] };
fs.writeFileSync(path.join(home, 'files', 'templates', 'orders', 'order-basic.json'), JSON.stringify(TEMPLATE, null, 2));
fs.writeFileSync(path.join(home, 'files', 'templates', 'readme.txt'), 'templates for partner uploads\n');

const posts = [];
const api = http.createServer((req, res) => {
  let b = '';
  req.on('data', c => b += c).on('end', () => {
    posts.push({ method: req.method, url: req.url, type: req.headers['content-type'], body: b });
    res.setHeader('content-type', 'application/json');
    res.statusCode = req.url === '/imports' ? 202 : 404;
    res.end(JSON.stringify({ accepted: req.url === '/imports', id: 'imp-1' }));
  });
});

let sftp, apiUrl;
const clientKey = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } }).privateKey;
fs.mkdirSync(path.join(home, 'keys'), { recursive: true });
fs.writeFileSync(path.join(home, 'keys', 'archive'), clientKey);
test.before(async () => {
  sftp = await require('./sftp-server').start({ root: sftpRoot, clientKey });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    envs: { dev: { consul: 'http://127.0.0.1:9' } },
    files: {
      templates: { type: 'local', path: 'files/templates' },
      partner: { type: 'sftp', host: '127.0.0.1', port: sftp.port, user: 'dt', password: '${PARTNER_PW}', root: '/upload', write: true },
      archive: { type: 'sftp', host: '127.0.0.1', port: sftp.port, user: 'dt', privateKeyFile: 'keys/archive', hostKey: sftp.hostFingerprint, root: '/upload' },
      pinned_wrong: { type: 'sftp', host: '127.0.0.1', port: sftp.port, user: 'dt', password: 'pw', hostKey: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      bad_key: { type: 'sftp', host: '127.0.0.1', port: sftp.port, user: 'dt', privateKeyFile: 'keys/missing' },
    },
    scripts: { http: { allow: [`${apiUrl}/imports`] } },
  }));
  fs.writeFileSync(path.join(home, '.env'), 'PARTNER_PW=pw\n');
});
test.after(() => { sftp.close(); api.close(); fs.rmSync(home, { recursive: true, force: true }); });

const tools = () => require('../lib/tools');

test('files: local and SFTP stores list, search, read, write, copy; read-only and path checks', async () => {
  const T = tools();
  assert.deepEqual((await T.call('files_stores', {})).map(s => [s.store, s.type, s.write]).slice(0, 3), [['templates', 'local', false], ['partner', 'sftp', true], ['archive', 'sftp', false]]);
  const l = await T.call('files_list', { store: 'templates', recursive: true });
  assert.deepEqual(l.rows.map(r => r.path), ['orders', 'orders/order-basic.json', 'readme.txt']);
  const s = await T.call('files_search', { store: 'templates', text: 'c-77' });
  assert.equal(s.rows[0].path, 'orders/order-basic.json');
  assert.equal(s.rows[0].line, 4);
  await assert.rejects(T.call('files_write', { store: 'templates', path: 'x.txt', content: 'x' }), /read-only/);
  await assert.rejects(T.call('files_read', { store: 'templates', path: '../../etc/passwd' }), /leaves the store/);

  const w = await T.call('files_write', { store: 'partner', path: 'probe/a.txt', content: 'hello' });
  assert.equal(w.size, 5);
  assert.equal(fs.readFileSync(path.join(sftpRoot, 'upload', 'probe', 'a.txt'), 'utf8'), 'hello');
  await assert.rejects(T.call('files_write', { store: 'partner', path: 'probe/a.txt', content: 'again' }), /already exists/);
  await T.call('files_write', { store: 'partner', path: 'probe/a.txt', content: 'again', overwrite: true });
  assert.equal((await T.call('files_read', { store: 'partner', path: 'probe/a.txt' })).text, 'again');
  await T.call('files_copy', { from_store: 'templates', from: 'readme.txt', to_store: 'partner', to: 'probe/readme.txt' });
  assert.deepEqual((await T.call('files_list', { store: 'partner', dir: 'probe' })).rows.map(r => r.path), ['probe/a.txt', 'probe/readme.txt']);
  assert.equal((await T.call('files_search', { store: 'partner', pattern: '*.txt' })).total, 2);
});

test('files: SFTP login with a key file and a pinned host key; wrong pins and missing keys fail', async () => {
  const T = tools();
  const l = await T.call('files_list', { store: 'archive', dir: 'probe' });
  assert.deepEqual(l.rows.map(r => r.path), ['probe/a.txt', 'probe/readme.txt']);
  await assert.rejects(T.call('files_write', { store: 'archive', path: 'x.txt', content: 'x' }), /read-only/);
  await assert.rejects(T.call('files_list', { store: 'pinned_wrong' }), /sftp 127\.0\.0\.1/);
  await assert.rejects(T.call('files_list', { store: 'bad_key' }), /privateKeyFile keys\/missing: ENOENT/);
});

test('transform: replacements are consistent per match, JSON paths, generators', () => {
  const S = require('../lib/scripts');
  const t = S.transform(JSON.stringify(TEMPLATE, null, 2), {
    replace: [{ find: 'ORD-\\d+', regex: true, with: 'ORD-{{rand:6}}' }],
    json: { 'items.*.id': '{{uuid}}', 'customer.id': '{{customerId}}' },
  }, { customerId: 'C-900' });
  const doc = JSON.parse(t.text);
  assert.match(doc.orderId, /^ORD-\d{6}$/);
  assert.notEqual(doc.orderId, 'ORD-1001');
  assert.ok(doc.items.every(i => i.ref === doc.orderId), 'the same old id gets the same new id everywhere');
  assert.match(doc.items[0].id, /^[0-9a-f-]{36}$/);
  assert.notEqual(doc.items[0].id, doc.items[1].id, 'each item a new uuid');
  assert.equal(doc.customer.id, 'C-900');
  assert.equal(t.replaced, 6);
  assert.equal(t.map['ORD-1001'], doc.orderId);
  assert.throws(() => S.transform('{}', { json: { 'no.such': 1 } }, {}), /no "no.such"/);
  assert.match(S.generate('date:YYYYMMDD'), /^\d{8}$/);
  assert.match(S.generate('hex:8'), /^[0-9a-f]{8}$/);
  assert.equal(S.generate('nothing'), undefined);
});

test('the example: copy a template, new ids, upload to a new SFTP folder, POST the folder', async () => {
  const T = tools();
  await T.call('script_save', {
    id: 'partner/send-order', description: 'Send a test order to the partner: template with new ids, uploaded to a new folder, then announced to the import API',
    params: { customerId: { default: 'C-500', description: 'customer for the order' }, template: { default: 'order-basic', description: 'template name' } },
    steps: [
      { tool: 'files_search', args: { store: 'templates', pattern: '{{template}}*.json' }, as: 'found' },
      { tool: 'files_read', args: { store: 'templates', path: '{{found.rows.0.path}}' }, as: 'doc' },
      { set: { folder: 'in/{{date:YYYYMMDD}}-{{hex:8}}', orderId: 'ORD-{{rand:6}}' } },
      { transform: '{{doc.text}}', replace: [{ find: 'ORD-1001', with: '{{orderId}}' }], json: { 'customer.id': '{{customerId}}', 'items.*.id': '{{uuid}}' }, as: 'copy' },
      { tool: 'files_write', args: { store: 'partner', path: '{{folder}}/order.json', content: '{{copy}}' } },
      { http: `POST ${apiUrl}/imports`, body: { folder: '/upload/{{folder}}', files: ['order.json'], orderId: '{{orderId}}' }, as: 'res' },
    ],
  });
  const r = await T.call('script_run', { id: 'send order', params: { customerId: 'C-321' } }); // fuzzy name
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  assert.equal(r.script, 'partner/send-order');
  const folder = r.results.folder;
  assert.match(folder, /^in\/\d{8}-[0-9a-f]{8}$/);
  const sent = JSON.parse(fs.readFileSync(path.join(sftpRoot, 'upload', folder, 'order.json'), 'utf8'));
  assert.equal(sent.orderId, r.results.orderId);
  assert.ok(sent.items.every(i => i.ref === sent.orderId && /^[0-9a-f-]{36}$/.test(i.id)));
  assert.equal(sent.customer.id, 'C-321');
  assert.equal(sent.customer.name, 'Ada', 'the rest of the document is kept');
  const post = posts.at(-1);
  assert.equal(post.type, 'application/json');
  assert.deepEqual(JSON.parse(post.body), { folder: `/upload/${folder}`, files: ['order.json'], orderId: sent.orderId });
  assert.equal(r.results.res.status, 202);
  assert.deepEqual(r.results.res.json, { accepted: true, id: 'imp-1' });
  assert.equal(r.results.res.headers['content-type'], 'application/json');
  assert.ok(r.results.res.ms >= 0);
  assert.equal(r.results.res.truncated, false);
  assert.equal(r.steps[3].result.replaced, 6);

  // http only to allowed prefixes
  await T.call('script_save', { id: 'partner/bad', description: 'x', steps: [{ http: `POST ${apiUrl}/admin`, body: {} }] });
  const bad = await T.call('script_run', { id: 'partner/bad' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not allowed: add its URL prefix to scripts.http.allow/);
});

test('names: exact, by name, fuzzy, ambiguous', () => {
  const S = require('../lib/scripts');
  assert.equal(S.resolve('partner/send-order'), 'partner/send-order');
  assert.equal(S.resolve('send-order'), 'partner/send-order');
  assert.equal(S.resolve('sendorder'), 'partner/send-order', 'letters in order');
  assert.equal(S.resolve('test order partner'), 'partner/send-order', 'words from the description count');
  S.save('partner/send-invoice', { description: 'Send an invoice', steps: [{ set: { a: 1 } }] });
  assert.throws(() => S.resolve('send'), /matches several scripts: partner\/send-invoice, partner\/send-order|matches several scripts: partner\/send-order, partner\/send-invoice/);
  assert.throws(() => S.resolve('zzz'), /no script matches/);
});

test('scripts and collections as tools; rebuilt when scripts change', async () => {
  const T = tools();
  let names = (await T.schemas()).map(t => t.name);
  assert.ok(!names.includes('partner'));
  await T.call('script_collection', { collection: 'partner', description: 'Partner test uploads', tool: true });
  await T.call('script_save', { id: 'partner/send-invoice', description: 'Send an invoice', params: { amount: { type: 'number', required: true } }, steps: [{ set: { doubled: '{{amount}}' } }], tool: 'send_invoice' });
  const sch = await T.schemas();
  names = sch.map(t => t.name);
  assert.ok(names.includes('partner') && names.includes('send_invoice'), names.join(','));
  const col = sch.find(t => t.name === 'partner');
  assert.match(col.description, /^Partner test uploads\. Run one by name/);
  assert.match(col.description, /- send-order: Send a test order.*\(params: customerId, template\)/);
  assert.deepEqual(col.inputSchema.properties.script.examples.sort(), ['bad', 'send-invoice', 'send-order']);
  const inv = sch.find(t => t.name === 'send_invoice');
  assert.deepEqual(inv.inputSchema.required, ['amount']);
  assert.equal(inv.inputSchema.properties.amount.type, 'number');
  const r = await T.call('send_invoice', { amount: 12 });
  assert.equal(r.results.doubled, 12);
  const r2 = await T.call('partner', { script: 'invoice', params: { amount: 3 } });
  assert.equal(r2.script, 'partner/send-invoice');
  assert.match((await T.call('script_list', {})).collections.find(c => c.collection === 'partner').tool, /^partner$/);
});

test('call log: history, repeated calls and sequences become script suggestions', async () => {
  const T = tools();
  const C = require('../lib/calls');
  assert.ok(C.history({ source: 'script:partner/send-order' }).some(c => c.tool === 'files_write'), 'calls made by scripts are logged with their script');
  fs.writeFileSync(C.FILE, ''); // start from a clean log
  for (const n of [11, 12, 13]) {
    await T.call('files_search', { store: 'templates', text: `ORD-${n}` }, { source: 'mcp' });
    await T.call('files_read', { store: 'templates', path: 'readme.txt' }, { source: 'mcp' });
  }
  const h = C.history({ source: 'mcp' });
  assert.equal(h.length, 6);
  assert.equal(h[0].tool, 'files_read', 'newest first');
  assert.ok(C.history({ q: 'ORD-12' }).length >= 1);

  const p = C.patterns({ min: 3 });
  const rep = p.find(x => x.kind === 'repeat' && x.tools[0] === 'files_search' && x.count === 3);
  assert.ok(rep, JSON.stringify(p, null, 2));
  assert.deepEqual(rep.script.steps[0].args, { store: 'templates', text: 'ORD-{{text}}' }, 'only the changing number becomes a param');
  assert.match(rep.script.params.text.description, /e\.g\. 11 \/ 12 \/ 13/);
  assert.equal(p.filter(x => x.kind === 'sequence').length, 1, 'search→read once, not search→read→search→read');
  const seq = p.find(x => x.kind === 'sequence');
  assert.deepEqual(seq.tools, ['files_search', 'files_read']);
  assert.equal(seq.count, 3);
  assert.deepEqual(seq.script.steps.map(s => s.tool), ['files_search', 'files_read']);
  await T.call('script_run', { id: 'partner/send-order' }, { source: 'mcp' });
  assert.ok(!C.patterns({ min: 2 }).some(x => x.tools.includes('files_write')), 'work already done by scripts is not suggested');
  // a suggestion saves and runs as is
  await T.call('script_save', { id: 'suggested/search-order', ...seq.script });
  const run = await T.call('script_run', { id: 'suggested/search-order', params: { s1_text: '14' } });
  assert.equal(run.ok, true, JSON.stringify(run));
  assert.ok(T.call('call_history', { tool: 'files_read', limit: 2 }));
});

test('generalize: whole values, slots in text, missing keys', () => {
  const { generalize } = require('../lib/calls');
  const g = generalize([
    { args: { env: 'dev', sql: "select * from t where id = 4 and s = 'new'", q: 'a b' } },
    { args: { env: 'dev', sql: "select * from t where id = 9 and s = 'paid'", q: 'c' } },
  ]);
  assert.deepEqual(g.args, { env: 'dev', q: '{{q}}', sql: "select * from t where id = {{id}} and s = '{{s}}'" }, 'named after the column they are compared to');
  assert.deepEqual(Object.keys(g.params), ['q', 'id', 's']);
  assert.deepEqual(g.params.s.examples, ['new', 'paid']);
});
