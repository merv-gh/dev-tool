// Exercise the shipped editor script with a small DOM harness; transport is covered in server.test.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-context-ui-'));
process.env.DT_CONFIG_DIR = tmp; process.env.DT_CACHE_DIR = path.join(tmp, 'cache');
const C = require('../lib/context'), tools = require('../lib/tools');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function harness(override) {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', hidden: false, disabled: false, options: [], children: [], append(...items) { this.children.push(...items); this.options.push(...items); }, replaceChildren() { this.children = []; this.options = []; }, addEventListener() {}, focus() {} });
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let discard = true;
  const runtime = vm.createContext({ $, console, URLSearchParams, location:{hash:'#context'}, setTimeout, clearTimeout, confirm: () => discard, window: { addEventListener() {} }, document: { createElement: element, querySelectorAll: () => [...elements.values()] }, api: async (url, args) => override?.(url,args) ?? (url === '/api/tools' ? tools.schemas() : { result: await tools.call(url.split('/').pop(), args) }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/admin-context.js'), 'utf8'), runtime);
  return { $, run: code => vm.runInContext(code, runtime), discard: value => discard = value };
}
test('Task memory deep links select the exact saved context and operator note', async () => {
  const c=C.open({id:'dev-tool-self',title:'Operating context'});C.write({id:c.id,path:'operator-notes.md',content:'Preserved operating knowledge.'});
  const h=harness();h.run("location.hash='#context?story=review-story&env=dev&context=dev-tool-self&file=operator-notes.md'");
  await h.run('loadContexts()');assert.equal(h.run('contextState.id'),c.id);assert.equal(h.$('cxPath').value,'operator-notes.md');assert.equal(h.$('cxContent').value,'Preserved operating knowledge.');
});
test('editor saves notes and metadata independently without losing drafts; stale edits survive rejection', async () => {
  const c = C.open({ title: 'UI memory' }), h = harness();
  await h.run('loadContexts()'); await h.run(`contextSelect(${JSON.stringify(c.id)})`);
  assert.equal(h.$('cxPath').value, 'progress.md');
  h.$('cxTitle').value = 'Pending title'; h.run('contextMarkDirty(false)');
  h.$('cxContent').value = '# first progress'; h.run('contextMarkDirty(true)');
  await h.$('cxSaveFile').onclick();
  assert.equal(C.read({ id: c.id, path: 'progress.md' }).content, '# first progress');
  assert.equal(h.$('cxTitle').value, 'Pending title'); assert.equal(h.run('contextDirty'), true);
  await h.$('cxSaveMeta').onclick(); assert.equal(C.get(c.id).title, 'Pending title'); assert.equal(h.run('contextDirty'), false);
  h.$('cxContent').value = '# unsaved progress'; h.run('contextMarkDirty(true)');
  h.$('cxTitle').value = 'Saved title'; h.run('contextMarkDirty(false)');
  await h.$('cxSaveMeta').onclick();
  assert.equal(C.get(c.id).title, 'Saved title'); assert.equal(h.$('cxContent').value, '# unsaved progress'); assert.equal(h.run('contextDirty'), true);
  C.write({ id: c.id, path: 'progress.md', content: '# another chat changed it' });
  await h.$('cxSaveFile').onclick();
  assert.match(h.$('cxMessage').textContent, /changed/); assert.equal(h.run('contextDirty'), true); assert.equal(h.$('cxContent').value, '# unsaved progress');
  assert.equal(C.read({ id: c.id, path: 'progress.md' }).content, '# another chat changed it');
  const second = C.open({ title: 'Another task' }); h.discard(false);
  await h.run(`contextSelect(${JSON.stringify(second.id)})`); assert.equal(h.run('contextState.id'), c.id);
  h.discard(true);
  const loading = h.run(`contextSelect(${JSON.stringify(second.id)})`);
  h.$('cxContent').value = '# typed while loading'; h.run('contextMarkDirty(true)');
  await loading; assert.equal(h.run('contextState.id'), c.id); assert.equal(h.$('cxContent').value, '# typed while loading');
});
test('scratchpad captures failures and keeps output visible without overwriting note drafts', async () => {
  const c = C.open({ title: 'Scratchpad' }), h = harness();
  await h.run('loadContexts()'); await h.run(`contextSelect(${JSON.stringify(c.id)})`);
  h.$('cxContent').value = '# draft'; h.run('contextMarkDirty(true)');
  h.$('cxTool').value = 'pg_query'; h.$('cxArgs').value = '{}';
  await h.$('cxRun').onclick();
  assert.match(h.$('cxRunOutput').textContent, /Missing argument: sql/); assert.equal(h.$('cxCaptured').hidden, false);
  assert.ok(C.get(c.id).files.some(f => f.path.startsWith('calls/')));
  assert.equal(h.$('cxContent').value, '# draft'); assert.equal(h.run('contextDirty'), true);
  assert.equal(h.$('cxRun').disabled, false);
});

test('suggested tool fields render the proposed arguments before the user reviews or runs them', async () => {
  const c=C.open({title:'Suggested tool'}),h=harness(url=>url.endsWith('/context_hint')?{result:{guidance:'Inspect this source',suggestion:{tool:'find',arguments:{q:'orders'},explanation:'Use cached evidence',missing:[]},validation:[]}}:undefined);
  await h.run('loadContexts()');await h.run(`contextSelect(${JSON.stringify(c.id)})`);
  h.run("let renderedArgs;contextToolSchema=()=>{renderedArgs=$('cxArgs').value;}");
  h.$('cxArgs').value='{"q":"previous task"}';h.$('cxGoal').value='Find orders';
  await h.$('cxHint').onclick();
  assert.deepEqual(JSON.parse(h.run('renderedArgs')),{q:'orders'});
  assert.equal(h.$('cxTool').value,'find');
});


test('saving a file cannot hide a concurrent metadata edit from another chat', async () => {
  const c = C.open({ title: 'Before concurrent edit' }), h = harness();
  await h.run('loadContexts()'); await h.run(`contextSelect(${JSON.stringify(c.id)})`);
  h.$('cxTitle').value = 'My title draft'; h.run('contextMarkDirty(false)');
  C.update({ id: c.id, title: 'Other chat title' });
  h.$('cxContent').value = '# saved progress'; h.run('contextMarkDirty(true)'); await h.$('cxSaveFile').onclick();
  assert.equal(h.$('cxTitle').value, 'My title draft');
  await h.$('cxSaveMeta').onclick();
  assert.match(h.$('cxMessage').textContent, /changed/); assert.equal(C.get(c.id).title, 'Other chat title');
  assert.equal(h.$('cxTitle').value, 'My title draft'); assert.equal(h.run('contextDirty'), true);
});

test('editor archives a saved file and preserves an unsaved draft when discard is declined', async () => {
  const c = C.open({ title: 'Archive in editor' }), h = harness();
  await h.run('loadContexts()'); await h.run(`contextSelect(${JSON.stringify(c.id)})`);
  const saved = C.read({ id: c.id, path: 'progress.md' }).content;
  h.$('cxContent').value = '# unsaved'; h.run('contextMarkDirty(true)'); h.discard(false);
  await h.$('cxDeleteFile').onclick();
  assert.equal(C.read({ id: c.id, path: 'progress.md' }).content, saved);
  assert.equal(h.$('cxContent').value, '# unsaved');
  h.discard(true); await h.$('cxDeleteFile').onclick();
  const archived = C.get(c.id).files.find(f => f.path.startsWith('archived/'));
  assert.ok(archived); assert.equal(C.read({ id: c.id, path: archived.path }).content, saved);
  assert.ok(!C.get(c.id).files.some(f => f.path === 'progress.md'));
  assert.match(h.$('cxMessage').textContent, /archived/);
});
