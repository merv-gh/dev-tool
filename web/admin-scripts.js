// /admin: saved scripts as nested collections (folders), edited Postman style, and the browser sites
// (config.json browser.sites) with their link map. Uses api, esc, toast, dur and S from admin.html.
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const BROWSER_TOOLS = ['navigate', 'snapshot', 'click', 'type', 'fill_form', 'press_key', 'select_option', 'hover', 'wait_for', 'take_screenshot', 'network_requests', 'navigate_back', 'evaluate'];
const KINDS = { tool: 'dt tool', script: 'script', open: 'open link', browser: 'browser', wait: 'wait', set: 'set values', transform: 'transform', http: 'http request', js: 'javascript' };
const JS_HELP = `<details class="cheat"><summary>JavaScript: what the code sees, with examples</summary><pre class="code">vars     params, collection vars, results saved with "save as", captures (changes are kept)
args     a step's input, in its before hook (change it, or return a new one)
result   a step's result, in its after hook (return a value to replace it); the previous result in a js step
uuid() now() date('YYYYMMDD') rand(6) hex(8)  log(...)  test(name, fn)  expect(x).toBe / toEqual / toMatch / toContain / toBeTruthy / toBeGreaterThan / toHaveProperty / .not  assert(ok, msg)

// before (a step): change what it sends
args.body.requestId = uuid();
args.headers['x-run'] = vars.runId;

// capture (a step): result paths into vars
{ "orderId": "json.id", "firstSku": "json.items[0].sku" }

// after (a step): check it, keep values, reshape it
test('created', () => expect(result.status).toBe(201));
vars.total = result.json.items.reduce((n, i) => n + i.qty, 0);
return result.json.items.map(i => i.sku);   // the step's result is now ['KB-01', 'MS-02']

// a javascript step: the return value is its result ("save as")
const doc = JSON.parse(vars.doc.text);
doc.items.forEach(i => { i.id = uuid(); });
return JSON.stringify(doc, null, 2);

// script / collection before: set up vars for every step
vars.runId = 'run-' + hex(6);
vars.today = date('YYYY-MM-DD');</pre><div class="hint">Runs in a sandbox: no files, no secrets, 5 seconds per piece. Failing tests fail the run. The agent can try code with js_run.</div></details>`;
const TARGET_HINT = { js: '', tool: 'tool name, e.g. pg_query', script: 'collection/name', open: 'site.link, e.g. crm.order', browser: 'click, type, snapshot…', wait: 'seconds, or text to wait for', transform: 'text to rewrite, e.g. {{doc.text}}', http: 'POST https://api…/imports/{{id}}' };
const ARGS_HINT = {
  tool: 'args JSON, e.g. {"env": "{{env}}", "sql": "select …"}', browser: 'args JSON, e.g. {"element": "Save button", "ref": "e12"}', script: 'params JSON, e.g. {"orderId": "{{orderId}}"}',
  set: 'values JSON, e.g. {"folder": "out/{{date:YYYYMMDD}}/{{uuid}}", "orderId": "ORD-{{rand:6}}"}',
  transform: 'JSON: {"replace": [{"find": "ORD-\\\\d+", "regex": true, "with": "ORD-{{rand:6}}"}], "json": {"order.id": "{{uuid}}"}}',
  http: 'JSON: {"body": {"folder": "{{folder}}"}, "headers": {"authorization": "Bearer …"}}',
};
// where each kind keeps the JSON of its textarea
const ARGS_FIELDS = { transform: ['replace', 'json', 'consistent'], http: ['body', 'headers', 'timeoutMs'] };
const stepArgs = (s, k) => (k === 'script' ? s.params || s.args : k === 'set' ? s.set : ARGS_FIELDS[k] ? Object.fromEntries(ARGS_FIELDS[k].filter(f => s[f] !== undefined).map(f => [f, s[f]])) : s.args);
const base = (id) => id.split('/').pop();
const defaultToolName = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const parentOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');
const join = (folder, name) => (folder ? `${folder}/${name}` : name);

// ── scripts: tree ──
let SC = { scripts: [], collections: [] }, cur = null, subtab = 'steps', SITES = null;
const openFolders = new Set(store.get('dt-pm-open', []));
const saveOpen = () => store.set('dt-pm-open', [...openFolders]);

async function loadScripts() {
  SC = await api('/api/admin/scripts');
  $('nScripts').textContent = SC.scripts.length || '';
  renderTree();
  if (!cur) renderEditor();
}

function buildTree() {
  const root = { path: '', folders: {}, scripts: [] };
  const ensure = (p) => {
    let n = root;
    if (!p) return n;
    for (const seg of p.split('/')) {
      const path = join(n.path, seg);
      n = n.folders[seg] = n.folders[seg] || { name: seg, path, folders: {}, scripts: [] };
    }
    return n;
  };
  for (const c of SC.collections) ensure(c.collection);
  for (const s of SC.scripts) ensure(parentOf(s.id)).scripts.push(s);
  return root;
}

function renderTree() {
  const q = $('pmFilter').value.trim().toLowerCase();
  const hit = (s) => !q || `${s.id} ${s.description || ''}`.toLowerCase().includes(q);
  const count = (f) => f.scripts.filter(hit).length + Object.values(f.folders).reduce((n, x) => n + count(x), 0);
  const pad = (d) => `style="padding-left:${8 + d * 14}px"`;
  const html = (f, d) => [
    ...Object.values(f.folders).sort((a, b) => a.name.localeCompare(b.name)).filter(x => !q || count(x)).map(x => {
      const isOpen = q ? true : openFolders.has(x.path);
      return `<div class="tn" data-folder="${esc(x.path)}" draggable="true"><div class="tr" ${pad(d)}><span class="tw">${isOpen ? '▾' : '▸'}</span><span>📁</span><span class="nm">${esc(x.name)}</span><span class="cnt">${count(x) || ''}</span>
        <span class="acts"><button data-act="new-script" title="New script here">+</button><button data-act="new-folder" title="New collection inside">+📁</button><button data-act="settings" title="Description, tool">⚙</button><button data-act="rename" title="Rename">✎</button><button data-act="delete" title="Delete">✕</button></span></div>${isOpen ? html(x, d + 1) : ''}</div>`;
    }),
    ...f.scripts.filter(hit).sort((a, b) => a.id.localeCompare(b.id)).map(s => `<div class="tn" data-sid="${esc(s.id)}" draggable="true"><div class="tr ${cur && cur.id === s.id ? 'on' : ''}" ${pad(d)} title="${esc(s.error || s.description || '')}"><span class="tw"></span>
      <span class="badge-k ${s.error ? 'mix' : s.browser ? 'web' : s.js ? 'mix' : 'tool'}" title="${s.error ? 'cannot be read' : s.browser ? 'uses the browser' : s.js ? 'has JavaScript' : 'tools only'}">${s.error ? 'ERR' : s.browser ? 'WEB' : s.js ? 'JS' : 'RUN'}</span><span class="nm">${esc(base(s.id))}</span>${s.tool ? `<span class="cnt" title="exposed as tool ${esc(s.tool)}">⚒</span>` : ''}
      <span class="acts"><button data-act="dup" title="Duplicate">⧉</button><button data-act="rename" title="Rename">✎</button><button data-act="delete" title="Delete">✕</button></span></div></div>`),
  ].join('');
  const t = buildTree();
  $('pmTree').innerHTML = html(t, 0) || `<div class="empty">${q ? 'No match.' : 'No scripts yet. Create one with + Script, or ask the agent to save what it just did.'}</div>`;
}

// inline rename/create in the tree: replaces the row's name with an input
function inlineName(row, value, commit) {
  const nm = row.querySelector('.nm');
  const input = document.createElement('input');
  input.value = value; input.style.cssText = 'flex:1;min-width:0;font-size:13px;padding:1px 4px';
  nm.replaceWith(input); input.focus(); input.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (ok && v && v !== value) { try { await commit(v); } catch (e) { toast(e.message); } }
    loadScripts();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function newFolder(parent) {
  let name = 'new-collection', i = 1;
  while (SC.collections.some(c => c.collection === join(parent, name))) name = `new-collection-${++i}`;
  await api('/api/admin/scripts/folder', { path: join(parent, name) });
  if (parent) openFolders.add(parent);
  saveOpen();
  await loadScripts();
  const row = document.querySelector(`[data-folder="${CSS.escape(join(parent, name))}"] > .tr`);
  if (row) inlineName(row, name, (v) => api('/api/admin/scripts/move', { from: join(parent, name), to: join(parent, v) }));
}

function newScript(folder) {
  if (!confirmDiscard()) return;
  if (folder) { openFolders.add(folder); saveOpen(); }
  cur = { id: null, folder, name: 'new-script', def: { description: '', params: {}, steps: [{ tool: '', args: {} }] }, dirty: true };
  subtab = 'steps';
  renderTree(); renderEditor();
  const t = document.querySelector('#pmMain input.title');
  if (t) { t.focus(); t.select(); }
}

async function openScript(id) {
  if (cur && cur.id === id) return;
  if (!confirmDiscard()) return;
  try {
    const { id: _, savedAt, ...def } = await api(`/api/admin/script?id=${encodeURIComponent(id)}`);
    cur = { id, folder: parentOf(id), name: base(id), def: { description: '', params: {}, steps: [], ...def }, dirty: false, savedAt };
    renderTree(); renderEditor();
  } catch (e) { toast(e.message); }
}

const confirmDiscard = () => !cur || !cur.dirty || confirm('Discard unsaved changes?');

$('pmTree').addEventListener('click', async (ev) => {
  const tn = ev.target.closest('.tn');
  if (!tn) return;
  ev.stopPropagation();
  const act = ev.target.closest('[data-act]')?.dataset.act;
  const folder = tn.dataset.folder, sid = tn.dataset.sid;
  const row = tn.querySelector(':scope > .tr');
  try {
    if (folder !== undefined) {
      if (act === 'new-script') return newScript(folder);
      if (act === 'new-folder') return newFolder(folder);
      if (act === 'settings') return openCollection(folder);
      if (act === 'rename') return inlineName(row, base(folder), async (v) => {
        const to = join(parentOf(folder), v);
        await api('/api/admin/scripts/move', { from: folder, to });
        if (openFolders.delete(folder)) openFolders.add(to);
        saveOpen();
        if (cur && cur.folder && (cur.folder + '/').startsWith(folder + '/')) { cur.folder = to + cur.folder.slice(folder.length); if (cur.id) cur.id = join(cur.folder, cur.name); renderEditor(); }
      });
      if (act === 'delete') {
        const n = SC.scripts.filter(s => s.id.startsWith(folder + '/')).length;
        if (!confirm(`Delete collection ${folder}${n ? ` and its ${n} script${n > 1 ? 's' : ''}` : ''}?`)) return;
        await api('/api/admin/scripts/folder/delete', { path: folder });
        if (cur && cur.id && cur.id.startsWith(folder + '/')) { cur = null; renderEditor(); }
        toast('Deleted'); return loadScripts();
      }
      openFolders.has(folder) ? openFolders.delete(folder) : openFolders.add(folder);
      saveOpen(); return renderTree();
    }
    if (act === 'rename') return inlineName(row, base(sid), async (v) => {
      const to = join(parentOf(sid), v);
      await api('/api/admin/scripts/move', { from: sid, to });
      if (cur && cur.id === sid) { cur.id = to; cur.name = v; renderEditor(); }
    });
    if (act === 'dup') {
      let to = `${sid}-copy`, i = 1;
      while (SC.scripts.some(s => s.id === to)) to = `${sid}-copy-${++i}`;
      await api('/api/admin/scripts/copy', { from: sid, to });
      await loadScripts();
      return openScript(to);
    }
    if (act === 'delete') {
      if (!confirm(`Delete script ${sid}?`)) return;
      await api('/api/admin/script/delete', { id: sid });
      if (cur && cur.id === sid) { cur = null; renderEditor(); }
      toast('Deleted'); return loadScripts();
    }
    openScript(sid);
  } catch (e) { toast(e.message); }
});

// drag a script or collection onto a collection (or the empty tree area for the top level)
$('pmTree').addEventListener('dragstart', (ev) => {
  const tn = ev.target.closest('.tn');
  if (!tn) return;
  ev.dataTransfer.setData('text/plain', JSON.stringify(tn.dataset.sid ? { id: tn.dataset.sid } : { folder: tn.dataset.folder }));
  ev.dataTransfer.effectAllowed = 'move';
});
const dropTarget = (ev) => ev.target.closest('.tn[data-folder]') || (ev.target.closest('#pmTree') && $('pmTree'));
$('pmTree').addEventListener('dragover', (ev) => {
  const t = dropTarget(ev);
  if (!t) return;
  ev.preventDefault();
  document.querySelectorAll('.drop-on').forEach(x => x !== t && x.classList.remove('drop-on'));
  t.classList.add('drop-on');
});
$('pmTree').addEventListener('dragleave', (ev) => { if (ev.target === $('pmTree')) $('pmTree').classList.remove('drop-on'); });
$('pmTree').addEventListener('drop', async (ev) => {
  ev.preventDefault();
  const t = dropTarget(ev);
  document.querySelectorAll('.drop-on').forEach(x => x.classList.remove('drop-on'));
  let what;
  try { what = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch { return; }
  const into = t && t.dataset ? t.dataset.folder || '' : '';
  const from = what.id || what.folder;
  const to = join(into, base(from));
  if (to === from || parentOf(from) === into) return;
  try {
    await api('/api/admin/scripts/move', { from, to });
    if (into) { openFolders.add(into); saveOpen(); }
    if (cur && cur.id && (cur.id === from || cur.id.startsWith(from + '/'))) { cur.id = to + cur.id.slice(from.length); cur.folder = parentOf(cur.id); renderEditor(); }
    toast(`Moved to ${into || 'top level'}`);
  } catch (e) { toast(e.message); }
  loadScripts();
});
$('pmFilter').addEventListener('input', renderTree);
$('pmNewFolder').onclick = () => newFolder('').catch(e => toast(e.message));
$('pmNewScript').onclick = () => newScript('');

// ── collection settings: description, and the collection as a tool ──
async function openCollection(p) {
  if (!confirmDiscard()) return;
  try {
    const c = await api(`/api/admin/collection?path=${encodeURIComponent(p)}`);
    cur = null; renderTree();
    $('pmMain').innerHTML = `<div class="crumb">collection</div><div class="titlebar"><span class="title" style="font-size:17px;font-weight:600;padding:3px 6px">📁 ${esc(c.collection)}</span><span class="spacer"></span><button class="primary" id="colSave">Save</button></div>
      <div class="grid-form"><label>Description</label><input id="colDesc" value="${esc(c.description)}" placeholder="What the scripts in it are for (the agent reads this)">
        <label>As a tool</label><div><label class="muted" style="display:inline-flex;gap:5px;align-items:center;font-size:12px"><input type="checkbox" id="colTool" ${c.tool ? 'checked' : ''}>Expose the collection as one tool</label>
          <input id="colToolName" value="${esc(typeof c.tool === 'string' ? c.tool : '')}" placeholder="${esc(defaultToolName(c.collection))}" style="width:200px;font-size:12px;margin-left:8px" spellcheck="false">
          <div class="hint">The tool lists its scripts with their descriptions and params, and runs one by name; a close name is enough.</div></div>
        <label>vars</label><textarea id="colVars" rows="${Math.max(2, jsonText(c.vars).split('\n').length)}" spellcheck="false" placeholder='{ "tenant": "t1", "baseUrl": "https://api.dev.example.com" }'>${esc(jsonText(c.vars))}</textarea>
        <label>before</label><textarea id="colBefore" rows="${Math.max(2, code(c.before).split('\n').length)}" spellcheck="false" placeholder="vars.runId = 'run-' + hex(6);">${esc(code(c.before))}</textarea>
        <label>after</label><textarea id="colAfter" rows="${Math.max(2, code(c.after).split('\n').length)}" spellcheck="false" placeholder="test('no errors', () => expect(vars.errors || []).toEqual([]));">${esc(code(c.after))}</textarea></div>
      <p class="hint">For every script in this collection and below: vars are defaults (outer collections first; a script's own vars and params win), before runs before its steps, after at the end.</p>${JS_HELP}
      <h2>Scripts <span class="muted">${c.scripts.length}</span></h2>
      <div class="card scroll"><table><tbody>${c.scripts.map(id => { const x = SC.scripts.find(s => s.id === id) || {}; return `<tr><td class="mono"><a href="#" data-goto="${esc(id)}">${esc(id.slice(c.collection.length + 1))}</a></td><td class="det">${esc(x.description || '')}</td><td class="mono muted">${esc((x.params || []).join(', '))}</td></tr>`; }).join('') || '<tr><td class="empty">Empty.</td></tr>'}</tbody></table></div>`;
    $('colSave').onclick = async () => {
      let vars = {};
      try { vars = $('colVars').value.trim() ? JSON.parse($('colVars').value) : {}; } catch (e) { return toast(`vars JSON: ${e.message}`); }
      try { const r = await api('/api/admin/collection', { path: c.collection, description: $('colDesc').value, tool: $('colTool').checked ? $('colToolName').value.trim() || true : false, vars, before: $('colBefore').value, after: $('colAfter').value }); toast(r.toolName ? `Saved: tool ${r.toolName}` : 'Saved'); } catch (e) { toast(e.message); }
    };
    $('pmMain').querySelectorAll('[data-goto]').forEach(a => a.onclick = (ev) => { ev.preventDefault(); openScript(a.dataset.goto); });
  } catch (e) { toast(e.message); }
}

// From the History tab: a suggested script, opened unsaved in the editor.
function newScriptFrom(def, name) {
  if (!confirmDiscard()) return;
  cur = { id: null, folder: 'suggested', name: name || 'shortcut', def: { description: def.description || '', params: def.params || {}, steps: def.steps || [] }, dirty: true };
  subtab = 'steps';
  show('scripts');
  renderTree(); renderEditor();
}

// ── scripts: editor ──
const stepKind = (s) => Object.keys(KINDS).find(k => s[k] !== undefined) || 'tool';
const jsonText = (v) => (v && Object.keys(v).length ? JSON.stringify(v, null, 2) : '');

function datalists() {
  const tools = (S?.tools?.groups || []).flatMap(g => g.tools.filter(t => t.enabled && !t.name.startsWith('script_')).map(t => t.name));
  const links = (SITES?.sites || []).flatMap(s => [s.name, ...s.links.map(l => `${s.name}.${l.link}`)]);
  const opt = (xs) => xs.map(x => `<option value="${esc(x)}">`).join('');
  return `<datalist id="dl-tool">${opt(tools)}</datalist><datalist id="dl-script">${opt(SC.scripts.map(s => s.id).filter(id => id !== cur?.id))}</datalist>
    <datalist id="dl-open">${opt(links)}</datalist><datalist id="dl-browser">${opt(BROWSER_TOOLS)}</datalist>`;
}

function renderEditor() {
  const box = $('pmMain');
  if (!cur) { box.innerHTML = '<div class="empty">Open a script on the left, or create one with <b>+ Script</b>.</div>'; return; }
  if (!SITES) api('/api/admin/sites').then(r => { SITES = r; if (cur) $('pmDatalists').innerHTML = datalists(); }).catch(() => {});
  const d = cur.def;
  const nSteps = (d.steps || []).length, nParams = Object.keys(d.params || {}).length;
  box.innerHTML = `<div id="pmDatalists">${datalists()}</div>
    <div class="crumb">${esc(cur.folder ? cur.folder.split('/').join(' / ') : 'top level')}${cur.savedAt ? ` · saved ${esc(fmtDate(cur.savedAt))}` : ''}</div>
    <div class="titlebar"><input class="title" id="pmName" value="${esc(cur.name)}" spellcheck="false"><span class="dirty" id="pmDirty">${cur.dirty ? '● unsaved' : ''}</span>
      <button class="primary" id="pmSave" title="Ctrl/⌘+S">Save</button>${cur.id ? '<button id="pmDup">Duplicate</button><button id="pmDel">Delete</button>' : ''}</div>
    <input id="pmDesc" value="${esc(d.description || '')}" placeholder="Description: what it does and when to use it (the agent reads this)" style="width:100%;margin-top:6px">
    <div class="row" style="margin-top:6px;font-size:12px"><label class="muted" style="display:inline-flex;gap:5px;align-items:center"><input type="checkbox" id="pmTool" ${d.tool ? 'checked' : ''}>Expose as a tool of its own</label>
      <input id="pmToolName" value="${esc(typeof d.tool === 'string' ? d.tool : '')}" placeholder="${esc(defaultToolName(join(cur.folder, cur.name)))}" style="width:200px;font-size:12px" ${d.tool ? '' : 'hidden'} spellcheck="false">
      <span class="muted">${d.tool ? 'the agent calls it directly, with the params as arguments' : 'otherwise the agent runs it with script_run (by name or a close name)'}</span></div>
    <div class="subtabs" id="pmSub">${[['steps', `Steps <span class="n">${nSteps}</span>`], ['params', `Params <span class="n">${nParams || ''}</span>`], ['scripts', `Vars &amp; scripts${d.before || d.after || (d.vars && Object.keys(d.vars).length) ? ' <span class="n">●</span>' : ''}`], ['json', 'JSON']].map(([k, l]) => `<button data-sub="${k}" class="${subtab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pmBody">${subtab === 'steps' ? stepsHtml(d) : subtab === 'params' ? paramsHtml(d) : subtab === 'scripts' ? scriptsHtml(d) : `<textarea id="pmJson" rows="22" spellcheck="false">${esc(JSON.stringify(d, null, 2))}</textarea><div class="hint" id="pmJsonErr"></div>`}</div>
    <div class="runbar">${Object.entries(d.params || {}).map(([k, p]) => `<label class="muted" style="font-size:12px">${esc(k)}${p && p.required ? '*' : ''}<input data-run="${esc(k)}" placeholder="${esc(p && p.default !== undefined ? String(p.default) : '')}" value="${esc(cur.runParams?.[k] ?? '')}"></label>`).join('')}
      <span class="spacer"></span><button class="primary" id="pmRun">▶ Run</button></div>
    <div id="pmOut">${cur.lastRun ? runHtml(cur.lastRun) : ''}</div>`;
}

function stepsHtml(d) {
  return (d.steps || []).map((s, i) => {
    const k = stepKind(s);
    const args = stepArgs(s, k);
    return `<div class="step" data-i="${i}"><div class="sh"><span class="no">${i + 1}</span>
      <select data-f="kind">${Object.entries(KINDS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${k === 'set' ? '<span class="target muted" style="font-size:12px">values below are computed once and usable as {{name}}</span>' : k === 'js' ? '<span class="target muted" style="font-size:12px">code below; it returns the step\'s result</span>' : `<input class="target" data-f="target" list="dl-${k}" value="${esc(s[k] ?? '')}" placeholder="${esc(TARGET_HINT[k])}" spellcheck="false">`}
      <input data-f="as" value="${esc(s.as || '')}" placeholder="save as" style="width:110px" spellcheck="false">
      <label title="A failure does not stop the run"><input type="checkbox" data-f="optional" ${s.optional ? 'checked' : ''}>optional</label>
      <button class="icon" data-move="-1" title="Up" ${i ? '' : 'disabled'}>↑</button><button class="icon" data-move="1" title="Down" ${i < d.steps.length - 1 ? '' : 'disabled'}>↓</button><button class="icon" data-remove title="Remove">✕</button></div>
      ${ARGS_HINT[k] ? `<textarea data-f="args" rows="${Math.min(8, Math.max(2, jsonText(args).split('\n').length))}" spellcheck="false" placeholder="${esc(ARGS_HINT[k])}">${esc(jsonText(args))}</textarea>` : ''}
      ${k === 'js' ? `<textarea data-f="code" rows="${Math.min(14, Math.max(3, code(s.js).split('\n').length + 1))}" spellcheck="false" placeholder="const doc = JSON.parse(vars.doc.text);&#10;doc.items.forEach(i => { i.id = uuid(); });&#10;return JSON.stringify(doc, null, 2);">${esc(code(s.js))}</textarea>` : ''}
      ${hooksHtml(s, i)}</div>`;
  }).join('') + `<div class="row"><button id="pmAddStep">+ Add step</button><span class="hint">{{name}} inserts a param or a result saved with "save as" ({{order.rows.0.id}}); {{link:site.link}} a site link URL.</span></div>`;
}

const code = (c) => [].concat(c || []).join('\n');
const hooksSet = (s) => [s.before && 'before', s.capture && Object.keys(s.capture).length && 'capture', s.after && 'after'].filter(Boolean);
function hooksHtml(s, i) {
  const set = hooksSet(s);
  const open = set.length || (cur.openHooks && cur.openHooks.has(i));
  return `<details class="hooks" data-hooks="${i}" ${open ? 'open' : ''}><summary>before · capture · after${set.length ? ` <span class="badge-k mix">${set.join(' · ')}</span>` : ''}</summary>
    <div class="hook-grid"><label>before</label><textarea data-f="before" rows="${Math.max(2, code(s.before).split('\n').length)}" spellcheck="false" placeholder="args.body.requestId = uuid();">${esc(code(s.before))}</textarea>
    <label>capture</label><textarea data-f="capture" rows="${Math.max(1, jsonText(s.capture).split('\n').length)}" spellcheck="false" placeholder='{ "orderId": "json.id", "firstSku": "json.items[0].sku" }'>${esc(jsonText(s.capture))}</textarea>
    <label>after</label><textarea data-f="after" rows="${Math.max(2, code(s.after).split('\n').length)}" spellcheck="false" placeholder="test('ok', () => expect(result.status).toBe(200));&#10;vars.total = result.json.total;">${esc(code(s.after))}</textarea></div></details>`;
}

function scriptsHtml(d) {
  return `<div class="hook-grid">
    <label>vars</label><textarea id="pmVars" rows="${Math.max(2, jsonText(d.vars).split('\n').length)}" spellcheck="false" placeholder='{ "region": "eu", "batch": "B-{{date:YYYYMMDD}}" }'>${esc(jsonText(d.vars))}</textarea>
    <label>before</label><textarea id="pmBefore" rows="${Math.max(3, code(d.before).split('\n').length)}" spellcheck="false" placeholder="vars.runId = 'run-' + hex(6);">${esc(code(d.before))}</textarea>
    <label>after</label><textarea id="pmAfter" rows="${Math.max(3, code(d.after).split('\n').length)}" spellcheck="false" placeholder="test('job finished', () => expect(vars.status).toBe('done'));">${esc(code(d.after))}</textarea></div>
    <p class="hint">vars are defaults for this script (params win; collection vars come first). before runs once before the steps, after once at the end, with the last result as <code>result</code>. Collections have their own vars and hooks (⚙ on a folder).</p>${JS_HELP}`;
}

function paramsHtml(d) {
  const rows = Object.entries(d.params || {}).map(([k, p]) => `<tr><td><input data-p="name" value="${esc(k)}" spellcheck="false"></td><td><input data-p="default" value="${esc(p && p.default !== undefined ? (typeof p.default === 'string' ? p.default : JSON.stringify(p.default)) : '')}"></td>
    <td style="text-align:center"><input type="checkbox" data-p="required" ${p && p.required ? 'checked' : ''}></td><td><input data-p="description" value="${esc((p && p.description) || '')}"></td><td><button class="icon" data-premove>✕</button></td></tr>`).join('');
  return `<table class="edit"><thead><tr><th style="width:22%">Name</th><th style="width:22%">Default</th><th>Required</th><th>Description</th><th></th></tr></thead><tbody id="pmParams">${rows}</tbody></table>
    <div class="row" style="margin-top:6px"><button id="pmAddParam">+ Add param</button><span class="hint">Use them in steps as {{name}}; site links take their &lt;params&gt; from here.</span></div>`;
}

// form -> cur.def (the current subtab only)
function readForm() {
  cur.name = $('pmName').value.trim();
  cur.def.description = $('pmDesc').value;
  if ($('pmTool').checked) cur.def.tool = $('pmToolName').value.trim() || true; else delete cur.def.tool;
  $('pmToolName').hidden = !$('pmTool').checked;
  if (subtab === 'steps') {
    cur.def.steps = [...document.querySelectorAll('#pmBody .step')].map(el => {
      const f = (n) => el.querySelector(`[data-f="${n}"]`);
      const k = f('kind').value;
      let target = f('target') ? f('target').value.trim() : '';
      if (k === 'wait' && /^\d+(\.\d+)?$/.test(target)) target = Number(target);
      const step = k === 'set' ? { set: {} } : { [k]: target };
      const a = f('args');
      if (a && a.value.trim()) {
        let v;
        try { v = JSON.parse(a.value); a.style.borderColor = ''; } catch { v = a.value; a.style.borderColor = 'var(--bad)'; }
        if (k === 'set') step.set = v;
        else if (ARGS_FIELDS[k] && v && typeof v === 'object') Object.assign(step, v);
        else step[k === 'script' ? 'params' : 'args'] = v;
      }
      if (k === 'js') step.js = f('code').value;
      if (f('before').value.trim()) step.before = f('before').value;
      if (f('capture').value.trim()) {
        try { step.capture = JSON.parse(f('capture').value); f('capture').style.borderColor = ''; } catch { step.capture = f('capture').value; f('capture').style.borderColor = 'var(--bad)'; }
      }
      if (f('after').value.trim()) step.after = f('after').value;
      if (f('as').value.trim()) step.as = f('as').value.trim();
      if (f('optional').checked) step.optional = true;
      return step;
    });
  } else if (subtab === 'scripts') {
    const v = $('pmVars').value.trim();
    if (v) { try { cur.def.vars = JSON.parse(v); $('pmVars').style.borderColor = ''; } catch { $('pmVars').style.borderColor = 'var(--bad)'; } } else delete cur.def.vars;
    for (const [id, key] of [['pmBefore', 'before'], ['pmAfter', 'after']]) { if ($(id).value.trim()) cur.def[key] = $(id).value; else delete cur.def[key]; }
  } else if (subtab === 'params') {
    const params = {};
    for (const tr of document.querySelectorAll('#pmParams tr')) {
      const g = (n) => tr.querySelector(`[data-p="${n}"]`);
      const name = g('name').value.trim();
      if (!name) continue;
      const p = {};
      const dv = g('default').value;
      if (dv !== '') p.default = /^(-?\d+(\.\d+)?|true|false)$/.test(dv) ? JSON.parse(dv) : dv;
      if (g('required').checked) p.required = true;
      if (g('description').value.trim()) p.description = g('description').value.trim();
      params[name] = p;
    }
    cur.def.params = params;
  } else {
    try { cur.def = JSON.parse($('pmJson').value); $('pmJsonErr').textContent = ''; }
    catch (e) { $('pmJsonErr').innerHTML = `<span class="err-text">${esc(e.message)}</span>`; return false; }
  }
  cur.runParams = Object.fromEntries([...document.querySelectorAll('[data-run]')].map(x => [x.dataset.run, x.value]));
  return true;
}
const touch = () => { cur.dirty = true; $('pmDirty').textContent = '● unsaved'; };

$('pmMain').addEventListener('input', (ev) => {
  if (!cur || ev.target.dataset.run !== undefined) { if (cur) readForm(); return; }
  readForm(); touch();
});
$('pmMain').addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (!cur || !d.dataset || d.dataset.hooks === undefined) return;
  cur.openHooks = cur.openHooks || new Set();
  d.open ? cur.openHooks.add(Number(d.dataset.hooks)) : cur.openHooks.delete(Number(d.dataset.hooks));
}, true);
$('pmMain').addEventListener('change', (ev) => {
  if (!cur) return;
  if (ev.target.dataset.f === 'kind') {
    readForm();
    const i = Number(ev.target.closest('.step').dataset.i);
    const old = cur.def.steps[i], k = ev.target.value;
    const keep = Object.fromEntries(Object.entries(old).filter(([x]) => ['as', 'optional', 'before', 'after', 'capture'].includes(x)));
    cur.def.steps[i] = { ...(k === 'set' ? { set: {} } : k === 'js' ? { js: 'return result;' } : { [k]: k === 'wait' ? 2 : '' }), ...(['tool', 'browser'].includes(k) ? { args: {} } : k === 'script' ? { params: {} } : {}), ...keep };
    touch(); renderEditor();
  }
});
$('pmMain').addEventListener('click', async (ev) => {
  if (!cur) return;
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.sub) {
    if (!readForm()) return toast('Fix the JSON first');
    subtab = b.dataset.sub; return renderEditor();
  }
  if (b.id === 'pmAddStep') { readForm(); cur.def.steps.push({ tool: '', args: {} }); touch(); renderEditor(); return document.querySelector('#pmBody .step:last-of-type .target')?.focus(); }
  if (b.id === 'pmAddParam') { readForm(); let n = 'param', i = 1; while (cur.def.params[n]) n = `param${++i}`; cur.def.params[n] = {}; touch(); return renderEditor(); }
  if (b.dataset.premove !== undefined) { b.closest('tr').remove(); readForm(); touch(); return renderEditor(); }
  const step = b.closest('.step');
  if (step) {
    readForm();
    const i = Number(step.dataset.i), s = cur.def.steps;
    if (b.dataset.remove !== undefined) s.splice(i, 1);
    else if (b.dataset.move) { const j = i + Number(b.dataset.move); [s[i], s[j]] = [s[j], s[i]]; }
    touch(); return renderEditor();
  }
  if (b.id === 'pmSave') return saveScript();
  if (b.id === 'pmRun') return runScript();
  if (b.id === 'pmDup') return document.querySelector(`[data-sid="${CSS.escape(cur.id)}"] [data-act="dup"]`)?.click();
  if (b.id === 'pmDel') return document.querySelector(`[data-sid="${CSS.escape(cur.id)}"] [data-act="delete"]`)?.click();
});

async function saveScript() {
  if (!readForm()) return toast('Fix the JSON first');
  const id = join(cur.folder, cur.name);
  try {
    if (cur.id && cur.id !== id) await api('/api/admin/scripts/move', { from: cur.id, to: id });
    const r = await api('/api/admin/script', { id, script: cur.def });
    Object.assign(cur, { id: r.id, dirty: false, savedAt: new Date().toISOString() });
    toast(r.replaced ? 'Saved' : 'Created');
    await loadScripts(); renderEditor();
    return true;
  } catch (e) { toast(e.message); return false; }
}

async function runScript() {
  readForm();
  if ((cur.dirty || !cur.id) && !(await saveScript())) return;
  const params = Object.fromEntries(Object.entries(cur.runParams || {}).filter(([, v]) => v !== '').map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
  $('pmRun').disabled = true; $('pmOut').innerHTML = '<div class="muted" style="margin-top:8px">Running…</div>';
  try { cur.lastRun = await api('/api/admin/script/run', { id: cur.id, params }); } catch (e) { cur.lastRun = { ok: false, error: e.message, steps: [] }; }
  $('pmOut').innerHTML = runHtml(cur.lastRun);
  $('pmRun').disabled = false;
}

function runHtml(r) {
  return `<div class="row" style="margin:10px 0 6px"><span class="state ${r.ok ? 'done' : 'failed'}">${r.ok ? 'ok' : 'failed'}</span>${r.error ? `<span class="err-text">${esc(r.error)}</span>` : ''}${r.routes ? `<span class="muted">routes: ${esc(r.routes.error || `${r.routes.api} api requests, ${r.routes.added} new`)}</span>` : ''}</div>
    ${r.tests ? `<div class="row" style="margin:6px 0;font-size:12px"><b>Tests</b><span class="state done">${r.tests.passed} passed</span>${r.tests.failed ? `<span class="state failed">${r.tests.failed} failed</span>` : ''}</div>
      <table style="margin-bottom:8px"><tbody>${r.tests.list.map(t => `<tr><td style="width:24px">${t.ok ? '✅' : '❌'}</td><td>${esc(t.name)}</td><td class="mono muted">${t.step ? `step ${t.step}` : 'script'} ${esc(t.hook || '')}</td><td class="err-text">${esc(t.error || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${r.logs ? `<details open><summary>Log (${r.logs.length})</summary><pre class="code" style="max-height:200px">${esc(r.logs.map(l => `${l.step ? `[${l.step}${l.hook ? ` ${l.hook}` : ''}] ` : ''}${l.msg}`).join('\n'))}</pre></details>` : ''}
    ${r.steps.length ? `<table><thead><tr><th>#</th><th>Step</th><th class="num">Took</th><th>Result</th></tr></thead><tbody>${r.steps.map(x => `<tr><td>${esc(x.script === r.script ? String(x.step) : `${x.script} ${x.step}`)}</td><td class="mono">${esc(x.do)}</td><td class="num">${dur(x.ms)}</td><td class="det">${x.ok === false ? `<span class="err-text">${esc(x.error)}</span>` : `<pre class="code" style="max-height:160px">${esc(typeof x.result === 'string' ? x.result : JSON.stringify(x.result, null, 2))}</pre>`}</td></tr>`).join('')}</tbody></table>` : ''}`;
}

document.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
    if (tab === 'scripts' && cur) { ev.preventDefault(); saveScript(); }
    if (tab === 'sites' && site) { ev.preventDefault(); saveSite(); }
  }
});
window.addEventListener('beforeunload', (ev) => { if ((cur && cur.dirty) || (site && site.dirty)) ev.preventDefault(); });

// ── sites ──
let site = null; // { was, name, url, description, secrets: [{name, set}], links: [{link, path, description}], dirty }

async function loadSites() {
  SITES = await api('/api/admin/sites');
  $('nSites').textContent = SITES.sites.length || '';
  $('stList').innerHTML = SITES.sites.length ? SITES.sites.map(s => `<div class="tn" data-site="${esc(s.name)}"><div class="tr ${site && site.was === s.name ? 'on' : ''}"><span>🌐</span><span class="nm">${esc(s.name)}</span><span class="cnt">${s.links.length || ''}</span></div></div>`).join('')
    : '<div class="empty">No sites yet.</div>';
  if (!site) renderSite();
}

// same rule as the server: relative to the site URL, "/x" from its origin
function linkUrl(baseUrl, p) {
  if (/^https?:\/\//.test(p) || !/^https?:\/\//.test(baseUrl || '')) return p;
  const origin = baseUrl.match(/^https?:\/\/[^/]+/)[0];
  return p.startsWith('/') ? origin + p : baseUrl.replace(/\/[^/]*$/, '/') + p;
}

function renderSite() {
  const box = $('stMain');
  if (!site) { box.innerHTML = '<div class="empty">Pick a site, or add one.</div>'; return; }
  const ro = !SITES.editable;
  const saved = SITES.sites.find(s => s.name === site.was);
  const baseUrl = saved && saved.url === site.url && saved.resolved ? saved.resolved.url : site.url;
  box.innerHTML = `${ro ? '<p class="err-text">Sites are edited in config.json. Run <code>node cli.js migrate-config</code> first.</p>' : ''}
    <div class="titlebar"><input class="title" id="stName" value="${esc(site.name)}" placeholder="site name" spellcheck="false"><span class="dirty" id="stDirty">${site.dirty ? '● unsaved' : ''}</span>
      <button class="primary" id="stSave" ${ro ? 'disabled' : ''}>Save</button>${site.was ? `<button id="stDel" ${ro ? 'disabled' : ''}>Delete</button>` : ''}</div>
    <div class="grid-form">
      <label>Start URL</label><div><input id="stUrl" value="${esc(site.url)}" placeholder="https://crm.dev.example.com/login, or \${CRM_URL}" style="width:100%" spellcheck="false">${baseUrl !== site.url ? `<div class="hint">= ${esc(baseUrl)}</div>` : ''}</div>
      <label>Description</label><input id="stDesc" value="${esc(site.description)}" placeholder="What the site is for">
      <label>Login secrets</label><div>${site.secrets.map((s, i) => `<span class="secret ${s.set === false ? 'missing' : ''}" title="${s.set === false ? 'no value in .env yet' : s.set ? 'value set in .env' : 'new'}">${esc(s.name)}<button data-secret="${i}" title="Remove">✕</button></span>`).join('')}
        <input id="stSecret" placeholder="add NAME, Enter" style="width:150px" spellcheck="false"><div class="hint">The model types the name; the browser container gets the value from .env. Missing values are marked.</div></div>
    </div>
    <h2>Links <span class="muted">${site.links.length}</span></h2>
    <table class="edit"><thead><tr><th style="width:16%">Name</th><th style="width:30%">Path or URL</th><th>Description</th><th>Opens</th><th></th></tr></thead><tbody id="stLinks">
      ${site.links.map((l, i) => { const u = linkUrl(baseUrl, l.path); return `<tr data-i="${i}"><td><input data-l="link" value="${esc(l.link)}" placeholder="order" spellcheck="false"></td><td><input data-l="path" value="${esc(l.path)}" placeholder="/orders/<orderId>" spellcheck="false"></td><td><input data-l="description" value="${esc(l.description)}"></td>
        <td class="where">${/<\w+>/.test(u) || !/^https?:/.test(u) ? esc(u) : `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`}</td><td><button class="icon" data-lremove="${i}">✕</button></td></tr>`; }).join('')}
    </tbody></table>
    <div class="row" style="margin-top:6px"><button id="stAddLink">+ Add link</button><span class="hint">Relative to the start URL ("/x" from its host); &lt;param&gt; parts are filled per call (site_url, or "open" steps in scripts).</span></div>
    <div id="stMsg" class="hint"></div>`;
}

function readSite() {
  site.name = $('stName').value.trim(); site.url = $('stUrl').value.trim(); site.description = $('stDesc').value;
  site.links = [...document.querySelectorAll('#stLinks tr')].map(tr => ({ link: tr.querySelector('[data-l="link"]').value.trim(), path: tr.querySelector('[data-l="path"]').value.trim(), description: tr.querySelector('[data-l="description"]').value }));
}
const touchSite = () => { site.dirty = true; $('stDirty').textContent = '● unsaved'; };

function openSite(name) {
  if (site && site.dirty && !confirm('Discard unsaved changes?')) return;
  const s = SITES.sites.find(x => x.name === name);
  site = s ? { was: s.name, name: s.name, url: s.url, description: s.description, secrets: s.secrets.map(x => ({ ...x })), links: s.links.map(x => ({ ...x })), dirty: false } : null;
  loadSites(); renderSite();
}

async function saveSite() {
  readSite();
  try {
    const r = await api('/api/admin/sites', { was: site.was || '', site: { name: site.name, url: site.url, description: site.description, secrets: site.secrets.map(s => s.name), links: site.links } });
    site.was = r.site; site.dirty = false;
    await loadSites();
    openSite(r.site);
    toast('Saved');
    if (/Restart/.test(r.note)) $('stMsg').textContent = r.note;
  } catch (e) { toast(e.message); }
}

$('stList').addEventListener('click', (ev) => { const tn = ev.target.closest('[data-site]'); if (tn) openSite(tn.dataset.site); });
$('stNew').onclick = () => {
  if (site && site.dirty && !confirm('Discard unsaved changes?')) return;
  site = { was: '', name: '', url: '', description: '', secrets: [], links: [{ link: '', path: '', description: '' }], dirty: true };
  renderSite(); $('stName').focus();
};
$('stMain').addEventListener('input', (ev) => {
  if (!site || ev.target.id === 'stSecret') return;
  readSite(); touchSite();
  // refresh the "Opens" previews in place
  const saved = SITES.sites.find(x => x.name === site.was);
  const baseUrl = saved && saved.url === site.url && saved.resolved ? saved.resolved.url : site.url;
  document.querySelectorAll('#stLinks tr').forEach((tr, i) => { const u = linkUrl(baseUrl, site.links[i].path); tr.querySelector('td.where').innerHTML = /<\w+>/.test(u) || !/^https?:/.test(u) ? esc(u) : `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`; });
});
$('stMain').addEventListener('keydown', (ev) => {
  if (ev.target.id !== 'stSecret' || ev.key !== 'Enter') return;
  const v = ev.target.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (v && !site.secrets.some(s => s.name === v)) { readSite(); site.secrets.push({ name: v, set: null }); touchSite(); renderSite(); $('stSecret').focus(); }
});
$('stMain').addEventListener('click', async (ev) => {
  if (!site) return;
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.secret !== undefined) { readSite(); site.secrets.splice(Number(b.dataset.secret), 1); touchSite(); return renderSite(); }
  if (b.dataset.lremove !== undefined) { readSite(); site.links.splice(Number(b.dataset.lremove), 1); touchSite(); return renderSite(); }
  if (b.id === 'stAddLink') { readSite(); site.links.push({ link: '', path: '', description: '' }); touchSite(); renderSite(); return document.querySelector('#stLinks tr:last-child input')?.focus(); }
  if (b.id === 'stSave') return saveSite();
  if (b.id === 'stDel') {
    if (!confirm(`Delete site ${site.was} from config.json?`)) return;
    try { await api('/api/admin/sites', { was: site.was }); site = null; toast('Deleted'); loadSites(); } catch (e) { toast(e.message); }
  }
});

// ── history: the call log and the repeated work in it ──
let PT = [], hsTimer;
async function loadHistory() {
  const q = encodeURIComponent($('hsQ').value.trim()), src = encodeURIComponent($('hsSource').value);
  const [calls, pats] = await Promise.all([api(`/api/admin/calls?q=${q}&source=${src}`), api('/api/admin/patterns')]);
  PT = pats;
  $('ptCount').textContent = pats.length || '';
  $('patterns').innerHTML = pats.length ? pats.map((p, i) => `<div class="step"><div class="sh"><span class="badge-k ${p.kind === 'sequence' ? 'web' : 'tool'}">${p.kind === 'sequence' ? 'SEQ' : 'REP'}</span>
      <b>${esc(p.summary)}</b><span class="muted" style="font-size:12px">last ${esc(fmtDate(p.last))}</span><span class="spacer"></span><button class="primary small" data-pt="${i}">Save as script…</button></div>
      <div class="hint">${p.script.steps.map((s, j) => `${j + 1}. <code>${esc(s.tool)}</code> ${esc(JSON.stringify(s.args))}`).join('<br>')}${Object.keys(p.script.params).length ? `<br>params: ${Object.entries(p.script.params).map(([k, x]) => `<code>${esc(k)}</code> <span class="muted">${esc(x.description)}</span>`).join(' · ')}` : ''}</div></div>`).join('')
    : '<div class="empty">Nothing repeated yet. Patterns show up after the same call (3×) or the same sequence of tools (2×).</div>';
  $('hsCount').textContent = calls.length >= 300 ? '300+' : calls.length;
  $('calls').innerHTML = calls.length ? calls.map(c => `<tr><td style="white-space:nowrap">${esc(fmtDate(c.at))}</td><td class="mono">${esc(c.source)}</td><td class="mono">${esc(c.tool)}</td>
      <td class="det mono" style="max-width:560px">${esc(JSON.stringify(c.args).slice(0, 300))}${c.error ? `<div class="err-text">${esc(c.error)}</div>` : ''}</td><td class="num">${dur(c.ms)}</td><td><span class="state ${c.ok ? 'done' : 'failed'}">${c.ok ? 'ok' : 'failed'}</span></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">No calls logged yet.</td></tr>';
}
$('patterns').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-pt]');
  if (!b) return;
  const p = PT[Number(b.dataset.pt)];
  newScriptFrom(p.script, p.tools.join('-then-').replace(/_/g, '-').slice(0, 60));
});
$('hsQ').addEventListener('input', () => { clearTimeout(hsTimer); hsTimer = setTimeout(() => loadHistory().catch(e => toast(e.message)), 250); });
$('hsSource').addEventListener('change', () => loadHistory().catch(e => toast(e.message)));
