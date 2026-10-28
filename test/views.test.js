// Diffs (lists, text), views (built-in, custom, sandboxed pages with the data inside), the diff/show tools
// with embeds, the file browser listing and its previews; and the example: a db column vs ids in a file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-views-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
process.env.DT_PUBLIC_URL = 'http://127.0.0.1:4999';
delete process.env.DT_TOOLS;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];

const files = path.join(home, 'files', 'partner');
fs.mkdirSync(path.join(files, 'reports', '2026', '10'), { recursive: true });
fs.mkdirSync(path.join(files, 'inbox'), { recursive: true });
fs.writeFileSync(path.join(files, 'reports', '2026', '10', 'settled.csv'), 'order_id,amount\n2,10\n3,10\n4,10\n4,10\n9,10\n');
fs.writeFileSync(path.join(files, 'inbox', 'order-7.json'), '{"orderId":"ORD-7","items":[{"sku":"A"}]}');
fs.writeFileSync(path.join(files, 'inbox', 'blob.bin'), Buffer.from([0, 1, 2, 3, 255]));
fs.writeFileSync(path.join(files, 'secret.txt'), 'not listed');
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { consul: 'http://127.0.0.1:9' } }, files: { partner: { type: 'local', path: 'files/partner' } } }));

const server = require('../server').start({ port: 0, host: '127.0.0.1' });
let base;
test.before(() => new Promise(r => server.on('listening', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(home, { recursive: true, force: true }); });
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const local = (url) => url.replace('http://127.0.0.1:4999', base);

test('diffLists: numbers and strings, duplicates, case, text input', () => {
  const { diffLists } = require('../lib/diff');
  const d = diffLists([1, 2, 3, 3, '007'], ['2', ' 3 ', 4, 7]);
  assert.deepEqual([d.onlyFirst, d.common, d.onlyLast], [['1'], ['2', '3', '007'], ['4']]);
  assert.deepEqual(d.duplicatesFirst, ['3']);
  assert.equal(d.same, false);
  assert.deepEqual(diffLists('a\nB,c', ['b', 'C', 'a'], { ignoreCase: true }).same, true);
  assert.deepEqual(diffLists(['007'], ['7'], { numeric: false }).onlyFirst, ['007']);
});

test('diffLines: LCS with trimmed head/tail, counts', () => {
  const { diffLines } = require('../lib/diff');
  const d = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(d.ops.map(o => o.op + o.text), [' a', '-b', '+B', ' c', ' d', '+e']);
  assert.deepEqual(d.counts, { first: 4, last: 5, added: 2, removed: 1, same: 3 });
  assert.equal(diffLines('x', 'x').same, true);
});

test('views: built-ins listed; custom save, override, remove; names checked', () => {
  const V = require('../lib/views');
  assert.deepEqual(V.list().filter(v => v.builtin).map(v => v.name), ['code', 'collection-report', 'diagram', 'impact', 'json', 'knowledge-map', 'list-diff', 'patch', 'reproduction', 'scenario-run', 'table', 'tests', 'text-diff', 'xml']);
  assert.ok(V.get('json').sample, 'built-ins have sample data');
  V.save('order-card', { html: '<!-- {"description": "ignored"} -->\n<h1 id="h"></h1><script>dt.$("#h").textContent = DATA.id</script>', description: 'one order', sample: { id: 'ORD-1' } });
  const v = V.get('order-card');
  assert.deepEqual([v.builtin, v.description, v.sample], [false, 'one order', { id: 'ORD-1' }]);
  assert.ok(!v.html.includes('ignored'), 'a pasted meta comment is replaced');
  assert.equal(V.save('json', { html: '<pre>mine</pre>', description: 'my json' }).overridesBuiltin, true);
  assert.equal(V.get('json').html, '<pre>mine</pre>');
  V.remove('json');
  assert.equal(V.get('json').builtin, true);
  assert.throws(() => V.remove('json'), /built-in views cannot be deleted/);
  assert.throws(() => V.save('Bad Name', { html: 'x' }), /bad view name/);
  assert.throws(() => V.get('nope'), /no view "nope"/);
});

test('render: data inside the page, script-safe; diff helpers included', () => {
  const html = require('../lib/views').render('json', { s: '</script><script>alert(1)</script>', u: ' ' }, { title: '<b>t</b>' });
  assert.ok(!html.includes('</script><script>alert(1)'), 'no way out of the data script');
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.match(html, /<title>&lt;b&gt;t&lt;\/b&gt;<\/title>/);
  assert.match(html, /dt\.diffLists = function diffLists/);
});

test('show + /show: sandboxed, no network, embeds; another view of the same data', async () => {
  const r = await post('/oapi/show', { view: 'json', data: { a: [1, 2] }, title: 'numbers' });
  assert.equal(r.headers.get('content-disposition'), 'inline');
  assert.match(r.headers.get('location'), /^http:\/\/127\.0\.0\.1:4999\/show\/[a-z0-9]+\?embed=1$/);
  const page = await fetch(local(r.headers.get('location')));
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /^sandbox allow-scripts/);
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  const html = await page.text();
  assert.match(html, /window\.DATA = \{"a":\[1,2\]\}/);
  assert.match(html, /<body class="embed">/);
  const xml = await fetch(local(r.headers.get('location')).replace('?embed=1', '?view=table'));
  assert.match(await xml.text(), /"view":"table"/);
  assert.equal((await post('/oapi/show', { view: 'nope', data: 1 })).status, 400);
  assert.equal((await fetch(`${base}/show/zzz`)).status, 404);
});

test('diff tool: lists and texts, embedded, with the differences for the model', async () => {
  const T = require('../lib/tools');
  const l = await T.call('diff', { first: [1, 2, 3], last: '2\n3\n4', labels: ['db', 'file'] });
  assert.deepEqual([l.onlyFirst, l.onlyLast, l.counts.common], [['1'], ['4'], 2]);
  assert.match(l.view, /\/show\/[a-z0-9]+$/);
  const page = await (await fetch(local(l.view))).text();
  assert.match(page, /"labels":\["db","file"\]/);
  const t = await T.call('diff', { mode: 'text', format: 'json', first: '{"a":1,"b":2}', last: { a: 1, b: 3 } });
  assert.deepEqual(t.changes.map(c => c.op + c.text.trim()), ['-"b": 2', '+"b": 3']);
});

test('files_browse / files_show: a tree listing; previews only for its files', async () => {
  const T = require('../lib/tools');
  const b = await T.call('files_browse', { store: 'partner', dir: 'inbox' });
  assert.deepEqual([b.folders, b.files], [0, 2]);
  assert.match(b.view, /\/files\/[a-z0-9]+$/);
  const id = b.view.split('/').pop();
  const listing = await (await fetch(`${base}/api/files/${id}`)).json();
  assert.deepEqual(listing.data.entries.map(e => e.path).sort(), ['inbox/blob.bin', 'inbox/order-7.json']);
  const j = await (await fetch(`${base}/api/files/${id}?path=inbox/order-7.json`)).json();
  assert.equal(j.ext, 'json');
  assert.match(j.text, /ORD-7/);
  assert.equal((await (await fetch(`${base}/api/files/${id}?path=inbox/blob.bin`)).json()).binary, true);
  assert.equal((await fetch(`${base}/api/files/${id}?path=secret.txt`)).status, 403, 'not a file of this listing');
  assert.equal((await fetch(`${base}/api/files/${id}?path=../config.json`)).status, 400);
  assert.equal((await fetch(`${base}/files/${id}`)).status, 200);

  const s = await T.call('files_show', { store: 'partner', path: 'inbox/order-7.json' });
  assert.match(s.view, /\/files\/[a-z0-9]+\?open=inbox%2Forder-7\.json$/);
  await assert.rejects(T.call('files_show', { store: 'partner', path: 'inbox/nope.json' }), /no file/);
  const all = await T.call('files_browse', { store: 'partner', pattern: '*.csv' });
  assert.deepEqual([all.files, all.folders], [1, 4]);
});

test('the example: ids from one source vs a file, compared in a script, the run embeds the diff', async () => {
  const S = require('../lib/scripts');
  S.save('reconcile/ids', {
    description: 'ids vs the settlement file',
    params: { ids: { default: [1, 2, 3, 4] } },
    steps: [
      { tool: 'files_read', args: { store: 'partner', path: 'reports/2026/10/settled.csv' }, after: 'return result.text.trim().split("\\n").slice(1).map(l => l.split(",")[0])', as: 'fileIds' },
      { js: 'const d = diffLists(vars.ids, vars.fileIds); test("found the gap", () => expect(d.onlyFirst).toEqual(["1"])); return d.counts', as: 'counts' },
      { tool: 'diff', args: { first: '{{ids}}', last: '{{fileIds}}', labels: ['ours', 'settled'] }, as: 'diff' },
    ],
  });
  const r = await S.run('reconcile/ids');
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  assert.deepEqual(r.results.counts, { first: 4, last: 5, onlyFirst: 1, common: 3, onlyLast: 1, duplicatesFirst: 0, duplicatesLast: 1 });
  assert.equal(r.view, r.results.diff.view, 'the run carries the view of its diff');
  const o = await post('/oapi/script_run', { id: 'reconcile/ids' });
  assert.match(o.headers.get('location'), /\/show\/[a-z0-9]+\?embed=1$/, 'script runs embed in Open WebUI');
});
