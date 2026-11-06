const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ DTState: require('../lib/state-machine'), TextEncoder, TextDecoder });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/inline.js'), 'utf8') + '\nthis.inline = dtInline;', context);
const inline = context.inline;

test('inline policy collapses routine output and opens actionable failures across result families', () => {
  for (const view of ['code', 'code-cell', 'semantic-analysis', 'passport-ports', 'json', 'table', 'patch', 'tests', 'collection-report', 'reproduction', 'scenario-run', 'list-diff', 'text-diff', 'api-exchange', 'differential']) {
    assert.equal(inline.describe(view, {}).open, false, view);
  }
  assert.equal(inline.describe('json', { cases: { not: 'a test suite' } }).open, false);
  assert.equal(inline.describe('tests', { outcome: 'passed', counts: { passed: 42, tests: 42 }, ms: 1250 }).summary, '42 passed · 0 failed · 1.3 s');
  for (const [view, data] of [
    ['tests', { counts: { errors: 1 } }], ['tests', { compile: ['javac failed'] }],
    ['tests', { cases: [{ status: 'error' }] }], ['tests', { outcome: 'timeout' }],
    ['collection-report', { hooks: [{ result: { ok: false } }] }],
    ['collection-report', { cleanupErrors: [{ error: 'cleanup' }] }],
    ['code', { calls: [{ ok: false }] }], ['api-exchange', { response: { status: 500 } }],
    ['differential', { cases: [{ equal: false }] }], ['scenario-run', { result: { checks: { failed: 1 } } }],
  ]) { assert.equal(inline.describe(view, data).open, true, JSON.stringify([view, data])); }
  assert.equal(inline.describe('diagram', {}).open, true);
  assert.equal(inline.describe('knowledge-map', {}).open, true);
  assert.equal(inline.describe('code-cell', {state:'done',engine:'node',nextCursor:2,output:[{text:'ready'}]}).open, false);
  assert.equal(inline.describe('code-cell', {state:'running'}).open, true);
  assert.equal(inline.describe('code-cell', {state:'failed',result:{error:'query failed'}}).open, true);
  assert.equal(inline.describe('semantic-analysis',{job:'parse-1',state:'running'}).open,false);
  assert.equal(inline.describe('semantic-analysis',{operation:'paths',results:[{nodes:[]}]}).open,true);
  assert.equal(inline.describe('semantic-analysis',{job:'parse-1',state:'failed'}).open,true);
});

test('patch navigation matches paths rather than positions, preserves clipped, deleted, renamed and binary files', () => {
  const patch = 'diff --git a/deleted.txt b/deleted.txt\n--- a/deleted.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n' +
    'diff --git "a/old name.txt" "b/new name.txt"\nsimilarity index 100%\nrename from old name.txt\nrename to new name.txt\n' +
    'diff --git a/assets/pic.png b/assets/pic.png\nBinary files differ\n' +
    'diff --git "a/src/\\303\\251.txt" "b/src/\\303\\251.txt"\n--- "a/src/\\303\\251.txt"\n+++ "b/src/\\303\\251.txt"\n@@ -1 +1 @@\n-a\n+b\n';
  const files = inline.patchFiles(patch, [{ path: 'clipped.txt', added: 4 }, { path: 'src/é.txt', added: 1, removed: 1 }, { path: 'deleted.txt', removed: 1 }]);
  assert.deepEqual(Array.from(files, f => f.path), ['clipped.txt', 'src/é.txt', 'deleted.txt', 'new name.txt', 'assets/pic.png']);
  assert.equal(files[0].patch, ''); assert.match(files[1].patch, /\\303/); assert.match(files[2].patch, /\/dev\/null/);
  assert.match(files[3].patch, /rename from/); assert.match(files[4].patch, /Binary files/);
  assert.equal(inline.patchFiles('')[Symbol.iterator]().next().done, true);
  assert.equal(inline.gitPath('"b/a\\tb\\042.txt"'), 'a\tb".txt');
});

test('every shipped view keeps executable scripts and the shared inline policy available in sandboxed pages', () => {
  const views = require('../lib/views');
  for (const view of views.list().filter(v => v.builtin)) {
    const html = views.render(view.name, views.get(view.name).sample, {}, { embed: true });
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    for (const [, script] of scripts) assert.doesNotThrow(() => new vm.Script(script, { filename: view.name }), view.name);
    assert.match(html, /dtInline.mount\(document.querySelector/);
    assert.match(html, /class="embed"/);
  }
});
