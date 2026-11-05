const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../web/admin-runtime.js'), 'utf8');
function harness(api = async () => ({})) {
  const elements = new Map(), storage = new Map(), requests = [];
  const element = () => ({ value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, checked: false, dataset: {}, children: [], handlers: {}, append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); }, replaceChildren() { this.children = []; }, focus() {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let discard = true;
  const context = vm.createContext({ $, URL, console, Date, crypto: { randomUUID: () => 'new-tab' }, location: { href: 'https://tools.example/admin' }, tab: 'runtime', contextState: null, contextFile: null, selectedJob: null, refresh: async () => {}, loadContexts: async () => {}, loadHistory: async () => {}, show() {}, contextCanLeave: () => true, confirm: () => discard, setTimeout: () => 1, clearTimeout() {}, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, window: { addEventListener() {} }, document: { addEventListener() {}, querySelectorAll: () => [], createElement: element }, api: async (url, body, options) => { requests.push({ url, body, options }); return api(url, body, options); } });
  vm.runInContext(source, context);
  return { $, requests, run: code => vm.runInContext(code, context), discard: value => discard = value, storage };
}
test('Admin preserves the legacy default scope and only exposes principal override to an admin', () => {
  const h = harness(); h.run("runtimeState={identity:{role:'local'}}; runtimeApplyIdentity({principalId:'local',storyId:'default',role:'local',multiUser:false})");
  assert.equal(h.$('rtStory').value, 'default'); assert.equal(h.$('rtPrincipalControl').hidden, true);
  h.run("runtimePrincipal='other'; runtimeState={identity:{role:'user'}}"); assert.equal(h.run("adminRequestHeaders()['x-dt-principal']"), undefined);
  h.run("runtimeState={identity:{role:'admin'}}"); assert.equal(h.run("adminRequestHeaders()['x-dt-principal']"), 'other');
  const multi = harness(); multi.run("runtimeState={identity:{role:'user'}}; runtimeApplyIdentity({principalId:'alice',storyId:'default',role:'user',multiUser:true})");
  assert.equal(multi.$('rtStory').value, 'admin-new-tab'); assert.equal(multi.run("adminRequestHeaders()['x-dt-story']"), 'admin-new-tab');
});
test('identity bootstrap recovers a story-bound token despite a previously selected story', async () => {
  const h = harness(async url => url === '/api/tools' ? [] : url.startsWith('/api/admin/metadata') ? { records: [] } : { identity: { principalId: 'alice', storyId: 'fixed-chat', role: 'user', multiUser: true, storyBound: true }, executions: [] });
  h.run("runtimeStory='previous-account-chat'"); await h.run('loadRuntime()');
  assert.equal(h.requests[0].options.identityOnly, true); assert.equal(h.$('rtStory').value, 'fixed-chat'); assert.equal(h.$('rtStory').disabled, true); assert.equal(h.$('rtScopeApply').disabled, true);
  assert.equal(h.run("adminRequestHeaders()['x-dt-story']"), 'fixed-chat'); assert.match(h.$('rtScopeStatus').textContent, /token is bound/);
});
test('parallel execution timeline uses shared time bounds and retains actual parent relationships', () => {
  const h = harness(); h.run(`runtimeState={executions:[{id:'root',tool:'code',state:'running',startedAt:'2026-11-04T10:00:00Z',children:2},{id:'a',parentId:'root',tool:'pg_query',state:'done',startedAt:'2026-11-04T10:00:01Z',endedAt:'2026-11-04T10:00:03Z',ms:2000},{id:'b',parentId:'root',tool:'find',state:'done',startedAt:'2026-11-04T10:00:01Z',endedAt:'2026-11-04T10:00:02Z',ms:1000}]}; runtimeRenderExecutions()`);
  assert.match(h.$('rtExecutions').innerHTML, /rt-children/); assert.match(h.$('rtExecutions').innerHTML, /data-rt-execution="a"/); assert.match(h.$('rtExecutions').innerHTML, /data-rt-execution="b"/);
  const timeline = h.run("rtTimeline(runtimeState.executions,Date.parse('2026-11-04T10:00:04Z'))"); assert.equal(timeline.get('a').left, timeline.get('b').left); assert.equal(timeline.get('a').width, 50); assert.equal(timeline.get('b').width, 25);
  const cyclic = h.run("rtExecutionTree([{id:'x',parentId:'y',title:'<bad>'},{id:'y',parentId:'x'}])"); assert.equal((cyclic.match(/data-rt-execution=/g) || []).length, 2); assert.ok(!cyclic.includes('<bad>'));
});
test('metadata annotation edits send a revision, preserve stale drafts and never write operational state', async () => {
  const h = harness(async (url, body) => { if (body) throw Error('Metadata changed; reload before saving'); return { kind: 'executions', id: 'one', revision: 'v1', editable: ['label', 'notes', 'tags'], owner: { principalId: 'alice', storyId: 'CHAT-1' }, value: { state: 'done', metadata: {} } }; });
  await h.run("runtimeSelectMetadata('executions','one')"); h.$('rtMetadataLabel').value = 'Useful calculation'; h.$('rtMetadataNotes').value = 'My unsaved note'; h.$('rtMetadataTags').value = 'orders, incident'; h.$('rtMetadataNotes').handlers.input();
  await h.run("runtimeSaveMetadata('executions','one')");
  const saved = h.requests.find(request => request.body); assert.equal(saved.body.expected_revision, 'v1'); assert.deepEqual(Object.keys(saved.body.patch), ['label', 'notes', 'tags']); assert.equal(saved.body.patch.state, undefined);
  assert.equal(h.$('rtMetadataNotes').value, 'My unsaved note'); assert.equal(h.run('runtimeMetadataDirty'), true); assert.match(h.$('rtMetadataMessage').textContent, /draft is preserved/);
  h.discard(false); await h.run("runtimeSelectMetadata('executions','two')"); assert.equal(h.run('runtimeMetadataSelected.id'), 'one');
});
test('metadata save cannot hide edits typed while the write was pending', async () => {
  let finish; const pending = new Promise(resolve => finish = resolve);
  const h = harness(async (url, body) => body ? pending : url.includes('?') ? { records: [] } : { kind: 'calls', id: 'one', revision: 'v1', editable: ['label', 'notes', 'tags'], value: { metadata: {} } });
  await h.run("runtimeSelectMetadata('calls','one')"); h.$('rtMetadataNotes').value = 'First note'; h.$('rtMetadataNotes').handlers.input();
  const saving = h.run("runtimeSaveMetadata('calls','one')"); h.$('rtMetadataNotes').value = 'Newer draft'; h.$('rtMetadataNotes').handlers.input();
  finish({ kind: 'calls', id: 'one', revision: 'v2', value: { metadata: { notes: 'First note' } } }); await saving;
  assert.equal(h.run('runtimeMetadataSelected.revision'), 'v2'); assert.equal(h.run('runtimeMetadataDirty'), true); assert.equal(h.$('rtMetadataNotes').value, 'Newer draft'); assert.match(h.$('rtMetadataMessage').textContent, /Newer edits/);
});
test('an old scope cannot populate the inspector after scope changes', async () => {
  let finish; const pending = new Promise(resolve => finish = resolve), h = harness(async () => pending);
  const loading = h.run("runtimeSelectExecution('old-execution')"); h.run('runtimeScopeVersion++'); finish({ id: 'old-execution', title: 'Old private result', state: 'done' }); await loading;
  assert.ok(!h.$('rtExecution').innerHTML.includes('Old private result'));
  h.run("runtimeState={identity:{role:'user'}}; runtimeCodePending=true"); h.$('rtStory').value = 'another'; await h.run('runtimeChangeScope()'); assert.match(h.$('rtScopeStatus').textContent, /Wait for the code tool response/);
});
test('cancellation and code results expose incomplete outcomes and only embed recognized native views', () => {
  const h = harness(); assert.match(h.run("rtCancellation({state:'draining'})"), /still active/); assert.match(h.run("rtCancellation({state:'cancelled',cleanupIncomplete:1})"), /unknown/);
  assert.equal(h.run("rtNativeView('https://internal.example/show/abc123')"), '/show/abc123?embed=1'); assert.equal(h.run("rtNativeView('javascript:alert(1)')"), null); assert.equal(h.run("rtNativeView('https://external.example/admin')"), null);
  assert.equal(h.run("rtNativeView('https://public.example/dt/show/abc123')"), '/show/abc123?embed=1');
  assert.match(h.run("rtTable([{name:'<script>',count:7}])"), /&lt;script&gt;/);
  h.$('rtCodeView').contentWindow = {}; h.$('rtCodeView').style = {};
  h.run("runtimeViewMessage({source:$('rtCodeView').contentWindow,data:{type:'iframe:height',height:90}})"); assert.equal(h.$('rtCodeView').style.height, '90px');
  h.run("runtimeViewMessage({source:{},data:{type:'iframe:height',height:900}})"); assert.equal(h.$('rtCodeView').style.height, '90px');
});
test('standalone code cell views expose output, returns, errors, cursors and ownership', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/views/code-cell.html'), 'utf8'), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  function render(data) {
    const elements = new Map(), $ = selector => { if (!elements.has(selector)) elements.set(selector, { textContent: '', innerHTML: '', hidden: true }); return elements.get(selector); };
    const dt = { $, esc: value => String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'), prettyJson: JSON.stringify, title(value) { $('[data-title]').textContent = value; }, json(element, value) { element.value = value; }, table(element, value) { element.value = value; } };
    vm.runInNewContext(script, { DATA: data, dt }); return $;
  }
  const done = render({ id: 'cell-1', executionId: 'execution-1', owner: { principalId: 'alice', storyId: 'CHAT-1' }, state: 'done', engine: 'node', cursor: 2, nextCursor: 3, output: [{ cursor: 3, kind: 'text', text: '<script>bad()</script>' }], result: { hasReturn: true, returned: 7 } });
  assert.equal(done('#cc-result').open, true); assert.equal(done('#cc-return').open, true); assert.match(done('#cc-facts').innerHTML, /CHAT-1/); assert.match(done('#cc-output').innerHTML, /&lt;script&gt;/); assert.equal(done('#cc-return-value').value, 7); assert.match(done('#cc-next').textContent, /prior cursor/);
  const failed = render({ id: 'cell-2', state: 'failed', result: { error: 'tool rejected' } }); assert.equal(failed('#cc-result').open, true); assert.equal(failed('#cc-error').textContent, 'tool rejected');
  const active = render({ id: 'cell-3', state: 'draining' }); assert.equal(active('#cc-notice').hidden, false); assert.match(active('#cc-next').textContent, /does not restart/);
});
