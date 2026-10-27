// Code mode: JavaScript that calls dt tools from the sandbox (tools.x(...)), prints with text(), and is
// shown with the "code" view; also tool calls from script hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-code-'));
process.env.DT_HOME = home;
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;
fs.mkdirSync(path.join(home, 'files', 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'files', 'data', 'a.txt'), '3\n1\n2\n');
fs.writeFileSync(path.join(home, 'files', 'data', 'b.txt'), '2\n3\n4\n');
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: { consul: 'http://127.0.0.1:9' } }, files: { data: { type: 'local', path: 'files/data' } }, scripts: { codeTimeoutMs: 3000 } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const T = () => require('../lib/tools');

test('code: calls tools, computes, prints; the user sees code + output', async () => {
  const r = await T().call('code', { title: 'sum and diff', code: `
    const read = async (p) => (await tools.files_read({ store: 'data', path: p })).text.trim().split('\\n').map(Number);
    const [a, b] = await Promise.all([read('a.txt'), read('b.txt')]);
    text('sum', a.reduce((x, y) => x + y, 0), b.reduce((x, y) => x + y, 0));
    const d = await tools.diff({ first: a, last: b, labels: ['a', 'b'] });
    text({ onlyA: d.onlyFirst, onlyB: d.onlyLast });
    return d.counts.common;` });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.output, 'sum 6 9\n{\n  "onlyA": [\n    "1"\n  ],\n  "onlyB": [\n    "4"\n  ]\n}');
  assert.equal(r.returned, 2);
  assert.deepEqual(r.calls.map(c => c.split(' ')[0]), ['files_read', 'files_read', 'diff']);
  assert.equal(r.views.length, 1, 'views made by called tools are listed');
  assert.match(r.view, /\/show\/[a-z0-9]+$/);
  const shown = require('../lib/results').load(r.view.split('/').pop());
  assert.equal(shown.view, 'code');
  assert.equal(shown.data.title, 'sum and diff');
  assert.match(shown.data.code, /tools\.diff/);
  assert.ok(require('../lib/calls').history({ source: 'code' }).some(c => c.tool === 'diff'), 'calls from code are logged as "code"');
});

test('code: tool errors are exceptions; tools.list; no recursion; syntax errors and timeouts reported', async () => {
  const r = await T().call('code', { code: `
    try { await tools.files_read({ store: 'data', path: 'nope.txt' }); } catch (e) { text('caught', e.message.includes('ENOENT') || e.message); }
    try { await tools.code({ code: '1' }); } catch (e) { text(e.message); }
    try { await tools.no_such_tool({}); } catch (e) { text(e.message); }
    const names = (await tools.list()).map(t => t.name);
    text(names.includes('pg_query'), names.includes('code'));` });
  assert.equal(r.output, 'caught true\ncode cannot call itself\nUnknown tool no_such_tool\ntrue false');
  assert.deepEqual(r.calls.map(c => c.split(' ').slice(0, 2).join(' ')), ['files_read (failed)', 'no_such_tool (failed)']);
  const bad = await T().call('code', { code: 'const = 1' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unexpected|SyntaxError|token/);
  const slow = await T().call('code', { code: 'while (true) {}' });
  assert.match(slow.error, /stopped after 3000ms/);
});

test('script hooks and js steps can call tools too', async () => {
  const S = require('../lib/scripts');
  S.save('code/hooks', { description: 'x', steps: [
    { js: 'const r = await tools.files_list({ store: "data" }); return r.rows.map(x => x.path)', as: 'names' },
    { set: { n: 1 }, after: 'vars.text = (await tools.files_read({ store: "data", path: vars.names[0] })).text.trim()' },
  ] });
  const r = await S.run('code/hooks');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.results.names, ['a.txt', 'b.txt']);
  assert.equal(r.results.text, '3\n1\n2');
  assert.ok(require('../lib/calls').history({ source: 'script:code/hooks' }).some(c => c.tool === 'files_list'));
});

test('the code view renders the code, output and calls', () => {
  const html = require('../lib/views').render('code', { code: 'text(1)', output: '1', calls: [{ tool: 'pg_query', ms: 3, ok: true }], ms: 5 });
  assert.match(html, /"code":"text\(1\)"/);
  assert.ok(require('../lib/views').list().some(v => v.name === 'code' && v.builtin));
});
