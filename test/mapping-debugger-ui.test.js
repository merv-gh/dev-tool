// Controller contracts complement the real browser showcase: no implicit sends, draft and evidence retention.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
let demo;
test.before(async () => demo = await require('../demo/mapping-debugger').start());
test.after(async () => demo?.close());
function harness(search = '', cryptoAvailable = true) {
  let allowDiscard = true; const all = [], ids = new Map(), documentEvents = {}, requests = [], downloads = [], events = {};
  function element(tag = 'div') {
    const e = { tagName: tag, value: '', _text: '', children: [], hidden: false, disabled: false, checked: false, listeners: {}, classList: { toggle() {} }, setAttribute(k, v) { this[k] = v; }, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, add(option) { this.children.push(option); if (this.children.length === 1) this.value = option.value; }, addEventListener(k, fn) { this.listeners[k] = fn; }, matches() { return ['input', 'textarea'].includes(tag); }, click() { downloads.push(this.download); }, remove() {} };
    Object.defineProperty(e, 'textContent', { get: () => e._text + e.children.map(c => c.textContent || '').join(' '), set: v => e._text = String(v) }); Object.defineProperty(e, 'lastChild', { get: () => e.children.at(-1) });
    all.push(e); return e;
  }
  const html = fs.readFileSync(path.join(__dirname, '../web/mapping-debugger.html'), 'utf8');
  for (const m of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) { const e = element(m[1]); e.id = m[2]; e.value = m[0].match(/\bvalue="([^"]*)"/)?.[1] || ''; ids.set(e.id, e); }
  const $ = id => ids.get(id) || all.find(e => e.id === id) || null;
  Object.assign($('headers'), { value: '{}' }); Object.assign($('params'), { value: '{}' }); $('body-kind').value = 'none'; $('method').value = 'GET'; $('add-kind').value = 'pg'; $('follow').checked = false;
  const context = vm.createContext({ document: { getElementById: $, createElement: element, body: element('body'), querySelectorAll: () => all.filter(e => ['button','input','select','textarea'].includes(e.tagName)), addEventListener: (k, fn) => documentEvents[k] = fn }, location: { search, href: 'http://local/mapping-debugger' }, history: { replaceState() {} }, URL, URLSearchParams, Option: function(label, value) { return { label, value, textContent: label }; }, AbortController, structuredClone, crypto: cryptoAvailable ? require('node:crypto').webcrypto : undefined, Blob, setTimeout, confirm: () => allowDiscard, prompt: () => 'unit-snapshot', addEventListener: (k, fn) => events[k] = fn, fetch: async (url, opts) => { const name = url.split('/').pop(), args = JSON.parse(opts.body); requests.push({ name, args }); try { const r = await require('../lib/access').run({ storyId: 'mapping-demo' }, () => require('../lib/tools').call(name, args, { signal: opts.signal })); return { ok: true, json: async () => ({ result: r }) }; } catch (e) { return { ok: false, status: 400, json: async () => ({ error: e.message }) }; } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/mapping-debugger.js'), 'utf8'), context, { filename: path.join(__dirname, '../web/mapping-debugger.js') });
  const flush = async () => { for (let i = 0; i < 80; i++) { await new Promise(r => setTimeout(r, 5)); if (!$('save').disabled) return; } throw Error('Controller did not settle'); };
  const fire = async (e, type = 'click') => { await (e.listeners[type] || e['on' + type])?.({ target: e }); if (type === 'input') documentEvents.input?.({ target: e }); await flush(); };
  const edit = async (id, value, type = 'input') => { $(id).value = value; await fire($(id), type); };
  return { $, all, requests, events, flush, fire, edit, downloads, location: context.location, discard: v => allowDiscard = v };
}
test('loading frozen evidence never sends reads; pointer edits stay local and errors are visible', async () => {
  const before = demo.calls.length, h = harness('?id=' + demo.run.id); await h.flush(); assert.equal(demo.calls.length, before); assert.match(h.$('response').textContent, /countryCode/); assert.match(h.$('comparison-summary').textContent, /1 different/);
  const input = h.$('comparisons').children[0].children[0].children[1].lastChild; input.value = '/missing'; await h.fire(input, 'input'); assert.match(h.$('comparisons').textContent, /Missing path/); assert.match(h.$('comparison-summary').textContent, /0 different/); assert.equal(demo.calls.length, before);
  await h.fire(h.$('discover')); assert.match(h.$('references').textContent, /RegistryRepository/); await h.edit('browse-db', 'reference', 'change'); await h.fire(h.$('browse')); assert.match(h.$('objects').textContent, /resolve_name/);
  await h.edit('trace-name', 'missing.function'); await h.fire(h.$('trace')); assert.match(h.$('notice').textContent, /not in|not.*catalog|not found/);
});
test('editing SQL params survives save and reload; run selects only reads, preserving request outcome', async () => {
  const h = harness('?id=registry-name-mapping'); await h.flush(); await h.edit('name', 'ui-controller'); await h.edit('title', 'UI mapping contract');
  const pgEditor = h.$('probes').children[0].children[1], params = pgEditor.children[4].lastChild; params.value = '[99]'; await h.fire(params, 'input'); await h.fire(h.$('add')); assert.equal(h.$('probes').children[0].children[1].children[4].lastChild.value, '[99]'); await h.fire(h.$('probes').children.at(-1).children[1].lastChild); await h.fire(h.$('save')); assert.match(h.$('notice').textContent, /Saved ui-controller/);
  const before = demo.calls.filter(r => r.kind === 'api').length; await h.fire(h.$('run-reads')); assert.equal(demo.calls.filter(r => r.kind === 'api').length, before); assert.match(h.$('probes').textContent, /United Kingdom/); assert.match(h.$('response').textContent, /No body|Choose/);
  await h.fire(h.$('send')); assert.match(h.$('response-meta').textContent, /HTTP 200/); assert.match(h.$('comparison-summary').textContent, /different/);
  await h.edit('title','Unsaved draft that must survive'); h.discard(false); await h.fire(h.$('recordings').children[0]); assert.equal(h.$('title').value,'Unsaved draft that must survive'); assert.match(h.$('notice').textContent,/Draft preserved/); h.discard(true); await h.edit('title','UI mapping contract'); await h.fire(h.$('save')); await h.fire(h.$('refresh-recording')); assert.match(h.$('notice').textContent, /without replay/); await h.fire(h.$('snapshot')); assert.match(h.$('view-link').href, /\/show\//); await h.fire(h.$('name-snapshot')); assert.match(h.$('view-link').href, /unit-snapshot/);
  const reload = harness('?id=ui-controller'); await reload.flush(); assert.equal(reload.$('probes').children[0].children[1].children[4].lastChild.value, '[\n  99\n]');
  await h.fire(h.$('add-comparison')); await h.fire(h.$('add')); assert.match(h.$('probes').textContent, /Registry rows/); assert.ok(h.requests.some(r => r.name === 'mapping_debug' && r.args.steps?.length === 3));
});
test('blank/invalid drafts show recoverable errors and do not send implicit requests', async () => {
  const h = harness(); await h.flush(); const before = demo.calls.length; await h.fire(h.$('add-comparison')); assert.match(h.$('notice').textContent, /Add a source read/); await h.fire(h.$('run-reads')); assert.match(h.$('notice').textContent, /lowercase name/); assert.equal(demo.calls.length, before); assert.equal(h.$('save').disabled, false);
});

test('edit every source target and request field, then save exact typed parameters and export reproducible calls', async () => {
 const h=harness('?id=registry-name-mapping',false);await h.flush();await h.edit('name','ui-source-edits');await h.edit('title','Source target edits');
 const edit=async(e,v,type='input')=>{e.value=v;await h.fire(e,type);};
 const pg=h.$('probes').children[0].children[1];await edit(pg.children[1].children[0].lastChild,'Reference row');await edit(pg.children[1].children[1].lastChild,'uat','change');await edit(pg.children[2].lastChild,'reference');await edit(pg.children[3].lastChild,'select id, display_name from registry.countries where id = $1 limit 7');await edit(pg.children[5].lastChild,'7');await edit(pg.children[6].lastChild,'RegistryMapper.java:18');
 const es=h.$('probes').children[1].children[1];await edit(es.children[2].lastChild,'registry');await edit(es.children[3].lastChild,'id==43');
 const kafka=h.$('probes').children[2].children[1];await edit(kafka.children[2].lastChild,'registry-updates');
 const c=h.$('comparisons').children[0].children[0];await edit(c.children[0].lastChild,'Mapped display name');await edit(c.children[2].lastChild,'search','change');await edit(c.children[3].lastChild,'/0/display_name');
 await h.edit('headers','{"x-demo":"mapping"}');await h.edit('method','POST','change');await h.edit('body-kind','json','change');await h.edit('body','{"id":42}');await h.edit('assumptions','Same key; explicit UAT read');await h.fire(h.$('save'));assert.match(h.$('notice').textContent,/Saved/);
 const d=require('../lib/mapping-debugger').tool({action:'get',id:'ui-source-edits'}).definition;assert.equal(d.probes[0].env,'uat');assert.equal(d.probes[0].limit,7);assert.equal(d.probes[0].label,'Reference row');assert.equal(d.probes[0].evidence,'RegistryMapper.java:18');assert.equal(d.probes[1].query,'id==43');assert.equal(d.comparisons[0].probe,'search');assert.deepEqual(d.request.body.value,{id:42});assert.equal(d.request.headers['x-demo'],'mapping');assert.equal(d.request.method,'POST');
 await h.fire(h.$('export'));assert.ok(h.downloads.includes('ui-source-edits.json'));
 // Internal deployments may use plain HTTP, where crypto.randomUUID is absent.
 await h.fire(h.$('add'));assert.equal(h.$('probes').children.length,4);await h.fire(h.$('probes').children.at(-1).children[1].lastChild);await h.fire(h.$('comparisons').children.at(-1).children[0].lastChild);
 await h.fire(h.$('discover'));await h.edit('route','0','change');assert.match(h.$('url').value,/countries/);await h.edit('env','uat','change');assert.match(h.$('notice').textContent,/Environment changed/);await h.fire(h.$('refresh'));assert.match(h.$('notice').textContent,/not configured|Refreshed/);
 h.discard(false);const original=h.location.href;await h.fire(h.$('new'));assert.equal(h.location.href,original);h.discard(true);await h.fire(h.$('new'));assert.match(h.location.href,/mapping-debugger/);
});
