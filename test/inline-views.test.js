const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ DTState: require('../lib/state-machine'), TextEncoder, TextDecoder });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/inline.js'), 'utf8') + '\nthis.inline = dtInline;', context);
const inline = context.inline;

test('inline policy collapses routine output and opens actionable failures across result families', () => {
  for (const view of ['workspace-coverage', 'ci', 'code', 'code-cell', 'semantic-analysis', 'semantic-flow-map', 'passport-ports', 'json', 'table', 'patch', 'tests', 'collection-report', 'reproduction', 'scenario-run', 'list-diff', 'text-diff', 'api-exchange', 'differential']) {
    assert.equal(inline.describe(view, {}).open, false, view);
  }
  assert.equal(inline.describe('json', { cases: { not: 'a test suite' } }).open, false);
  assert.equal(inline.describe('tests', { outcome: 'passed', counts: { passed: 42, tests: 42 }, ms: 1250 }).summary, '42 passed · 0 failed · 1.3 s');
  for (const [view, data] of [
    ['workspace-coverage',{summary:{missed:1}}],['workspace-coverage',{summary:{missedBranches:1}}],['workspace-coverage',{summary:{unknown:1}}],['workspace-coverage',{state:'stale'}],['ci',{state:'build_failed'}],['ci',{state:'passed',revision:{match:false}}],['ci',{kind:'jenkins-tests',counts:{failed:1}}],['tests', { counts: { errors: 1 } }], ['tests', { compile: ['javac failed'] }],
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
test('a passing test run opens attached coverage gaps, including branch-only, unknown, stale and unavailable data',()=>{
 const fresh={available:true,state:'measured',summary:{covered:3,executable:3,missed:0,unknown:0,missedBranches:0,complete:true}};
 assert.equal(inline.describe('tests',{outcome:'passed',coverage:fresh}).open,false);
 for(const coverage of [{...fresh,summary:{...fresh.summary,missedBranches:1}},{...fresh,summary:{...fresh.summary,unknown:1}},{...fresh,summary:{...fresh.summary,complete:false}},{...fresh,stale:true},{available:false,state:'unavailable',gaps:['No execution data']}])assert.equal(inline.describe('tests',{outcome:'passed',coverage}).open,true,JSON.stringify(coverage));
 assert.match(inline.coverageSummary({...fresh,summary:{...fresh.summary,missedBranches:1}}),/1 branches missed/);assert.match(inline.coverageSummary({available:false,state:'unavailable'}),/unavailable.*incomplete/);
});
test('coverage source selection preserves focus and retains branch gaps in the default filter',()=>{
 const elements=new Map(),focus=[],el=id=>{if(!elements.has(id))elements.set(id,{id,checked:true,classList:{add(){}},querySelector:s=>({focus:()=>focus.push(s)})});return elements.get(id);};
 const DATA={workspace:'owned',base:'base-sha',sourceFingerprint:'pin',state:'measured',available:true,summary:{complete:true},files:[{path:'A.java',counts:{},lines:[{line:4,state:'covered',missedBranches:1,source:'if (b)'}]},{path:'B.java',counts:{},lines:[{line:9,state:'missed',source:'save();'}]}]},html=require('../lib/views').get('workspace-coverage').html,script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 vm.runInNewContext(script,{DATA,META:{publicUrl:'https://tools.example.test',scope:{story:'ticket'}},dt:{esc:s=>String(s??''),json(){},copy(){}},URL:class extends URL {static createObjectURL(){return 'blob:sample';}},URLSearchParams,Blob,document:{getElementById:el},location:{href:'https://tools.example.test/show/id'}});
 assert.match(el('wc-lines').innerHTML,/branches missed/);
 el('wc-files').onclick({target:{closest:()=>({dataset:{file:'1'}})}});assert.equal(el('wc-path').textContent,'B.java');assert.deepEqual(focus,['[data-file="1"]']);assert.match(el('wc-read').href,/story=ticket/);
});
