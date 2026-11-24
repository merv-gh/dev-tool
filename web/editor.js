/* global DTEditor, DTExplorer, CodeMirror */
/* State operations are shared with Node tests; the browser branch owns DOM and transport. */
const WorkspaceEditorState = (() => {
  const mode = path => /\.gradle$/.test(path) ? 'text/x-groovy' : /\.(kt|kts)$/.test(path) ? 'text/x-kotlin' : /\.java$/.test(path) ? 'text/x-java' : /\.(js|mjs|cjs|json)$/.test(path) ? /\.json$/.test(path) ? { name: 'javascript', json: true } : 'javascript' : /\.(html|xml|svg)$/.test(path) ? 'xml' : /\.css$/.test(path) ? 'css' : /\.py$/.test(path) ? 'python' : /\.sql$/.test(path) ? 'sql' : /\.toml$/.test(path) ? 'toml' : /\.properties$/.test(path) ? 'properties' : /\.ya?ml$/.test(path) ? 'yaml' : /\.md$/.test(path) ? 'markdown' : /\.sh$/.test(path) ? 'shell' : null;
  const draft = (file, doc) => ({ ...file, original: file.content, dirty: false, saving: false, doc });
  function saved(tab, submitted, revision) {
    tab.original = submitted; tab.revision = revision;
    tab.dirty = tab.doc.getValue() !== submitted; tab.saving = false;
    return tab;
  }
  const guard = (state, keys = ['epoch', 'workspace', 'story']) => {
    const values = keys.map(key => state[key]);
    return () => keys.every((key, index) => state[key] === values[index]);
  };
  const dependencies = (rows, query) => {
    const q = query.toLowerCase();
    return rows.filter(d => [d.coordinate, d.version, d.owner?.key, d.path, d.alias, d.reason].join(' ').toLowerCase().includes(q));
  };
  return { mode, draft, saved, guard, dependencies };
})();
if (typeof module === 'object' && module.exports) module.exports = WorkspaceEditorState;
else (() => {
  'use strict';
  const $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
  const state = { workspace: '', story: params.get('story') || 'default', epoch: 0, tabs: new Map(), active: null, job: null, timer: null, inventory: null, dependency: null, plan: null, loading: false, inventoryRequest: 0, planRequest: 0, openRequest: 0 };
  $('story').value = state.story;
  const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
  async function tool(name, args) {
    const task = params.get('task_run');
    const response = await fetch('/api/tool/' + (task ? 'task_run_action' : name), { method: 'POST', headers: { 'content-type': 'application/json', ...(!task ? {'x-dt-story': state.story} : {}) }, credentials: 'same-origin', body: JSON.stringify(task ? {run:task,tool:name,arguments:args} : args) });
    const body = await response.json();
    if (!response.ok || body.error || body.result?.error) { const error = new Error(body.error || body.result?.error || `Request failed (${response.status})`); error.code = body.code || body.result?.code; throw error; }
    return body.result === undefined ? body : body.result;
  }
  const text = (tag, value, cls) => { const node = document.createElement(tag); node.textContent = value; if (cls) node.className = cls; return node; };
  function on(id, event, fn) { $(id).addEventListener(event, async e => { try { await fn(e); } catch (error) { status(error.message, true); } }); }
  function same(epoch) { return epoch === state.epoch; }
  let editor, explorer;
  const Engine = typeof DTEditor === 'undefined' ? CodeMirror : DTEditor;
  const mode = WorkspaceEditorState.mode;
  function initEditor() {
    editor = Engine.fromTextArea($('source'), { lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, indentUnit: 2, tabSize: 2, lineWrapping: false, screenReaderLabel: 'Workspace source code', extraKeys: { 'Ctrl-S': save, 'Cmd-S': save, 'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent' } });
    editor.getWrapperElement().hidden = true;
    editor.on('change', () => { if (state.loading || !state.active) return; const tab = state.tabs.get(state.active); tab.dirty = editor.getValue() !== tab.original; if (tab.dirty) tab.pinned = true; renderTabs(); updateFileStatus(); });
    editor.on('cursorActivity', () => { const p = editor.getCursor(); $('cursor').textContent = `Line ${p.line + 1}, column ${p.ch + 1}`; });
    new ResizeObserver(() => editor.refresh()).observe($('sourcePane'));
  }
  function renderTabs() {
    $('tabs').replaceChildren();
    for (const [name, tab] of state.tabs) {
      const wrap = text('div', '', 'editor-tab' + (name === state.active ? ' selected' : '') + (tab.pinned ? '' : ' preview'));
      const button = text('button', name.split('/').pop() + (tab.dirty ? ' •' : '')); button.type = 'button'; button.role = 'tab'; button.setAttribute('aria-selected', String(name === state.active)); button.title = name; button.addEventListener('click', () => activate(name));
      button.addEventListener('dblclick', () => { tab.pinned = true; renderTabs(); });
      const close = text('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close ' + name); close.addEventListener('click', () => closeTab(name));
      wrap.append(button, close); $('tabs').append(wrap);
    }
  }
  function activate(name) {
    const tab = state.tabs.get(name); if (!tab) return;
    state.openRequest++;
    state.active = name; state.loading = true; editor.swapDoc(tab.doc); editor.setOption('mode', mode(name)); state.loading = false;
    explorer?.setActive(name);
    $('editorEmpty').hidden = true; editor.getWrapperElement().hidden = false; editor.refresh(); renderTabs(); updateFileStatus();
    for (const button of $('tree').querySelectorAll('button[data-path]')) button.setAttribute('aria-current', String(button.dataset.path === name));
    const url = new URL(location.href); url.searchParams.set('path', name); history.replaceState(null, '', url); editor.focus();
    status(state.workspace + ' · ' + name + (tab.dirty ? ' · unsaved draft' : ''));
  }
  function updateFileStatus() {
    const tab = state.tabs.get(state.active);
    $('save').disabled = !tab || !tab.dirty || !!editor.isReadOnly; $('reload').disabled = !tab; $('find').disabled = !tab || !!editor.isReadOnly;
    $('dirty').textContent = !tab ? 'No file open' : tab.dirty ? 'Unsaved changes' : 'Saved';
    $('revision').textContent = tab ? tab.revision.slice(0, 12) : ''; $('encoding').textContent = 'UTF-8' + (tab ? ' · ' + tab.eol : '');
    $('compareLatest').hidden = !tab?.conflict || !Engine.compare;
  }
  function closeTab(name) {
    const tab = state.tabs.get(name); if (tab?.dirty && !confirm(`Discard unsaved changes in ${name}?`)) return;
    if (state.active === name) editor.clear?.();
    state.tabs.delete(name);
    tab?.doc.dispose?.();
    if (state.active === name) { state.active = null; const next = state.tabs.keys().next().value; if (next) activate(next); else { editor.getWrapperElement().hidden = true; $('editorEmpty').hidden = false; updateFileStatus(); } }
    renderTabs();
  }
  async function openFile(name, reload = false, pin = false) {
    if (!reload && state.tabs.has(name)) { if (pin) state.tabs.get(name).pinned = true; return activate(name); }
    if (!state.tabs.has(name) && state.tabs.size >= 50) { status('50 files are open. Close a tab before opening another file.', true); return; }
    const valid = WorkspaceEditorState.guard(state), workspace = state.workspace, request = ++state.openRequest, previous = state.tabs.get(name), draftBefore = previous?.doc.getValue(); status('Loading ' + name + '…');
    const file = await tool('workspace_editor', { action: 'read', workspace, path: name }); if (!valid() || request !== state.openRequest) return;
    if (previous && previous.doc.getValue() !== draftBefore) { status('You edited this file while it was loading. Your draft is preserved; reload again when ready.', true); return; }
    for (const [path, tab] of state.tabs) if (!tab.pinned && !tab.dirty && path !== name) { state.tabs.delete(path); tab.doc.dispose?.(); }
    state.tabs.get(name)?.doc.dispose?.();
    const draft = WorkspaceEditorState.draft(file, new Engine.Doc(file.content, mode(name), 0, file.eol === 'CRLF' ? '\r\n' : '\n', name)); draft.pinned = pin || previous?.pinned;
    state.tabs.set(name, draft); activate(name);
    const line = Number(params.get('line')); if (line > 0 && name === params.get('path')) editor.reveal?.(line, Number(params.get('endLine')) || line);
    status(workspace + ' · ' + name + ' · single click previews, double click keeps a tab');
  }
  async function save() {
    const name = state.active, tab = state.tabs.get(name); if (!tab || !tab.dirty || tab.saving) return;
    const epoch = state.epoch, content = tab.doc.getValue(), workspace = state.workspace;
    tab.saving = true; $('save').disabled = true; status('Saving ' + name + '…');
    try { const result = await tool('workspace_editor', { action: 'save', workspace, path: name, content, expected_revision: tab.revision }); if (!same(epoch)) return; WorkspaceEditorState.saved(tab, content, result.revision); renderTabs(); updateFileStatus(); status('Saved ' + name); }
    catch (error) { tab.saving = false; if (!same(epoch)) return; tab.conflict = error.code === 'DT_WORKSPACE_CONFLICT'; updateFileStatus(); status(tab.conflict ? 'This file changed outside the editor. Your draft is preserved. Compare the latest revision, then reconcile and save.' : error.message, true); }
  }
  async function compareLatest() {
    const name = state.active, tab = state.tabs.get(name), valid = WorkspaceEditorState.guard(state); if (!tab || !Engine.compare) return;
    status('Loading latest saved revision…'); const latest = await tool('workspace_editor', { action: 'read', workspace: state.workspace, path: name }); if (!valid() || state.tabs.get(name) !== tab) return;
    Engine.compare({ path: name, before: latest.content, after: tab.doc.getValue(), onRebase: () => {
      if (!valid() || state.tabs.get(name) !== tab) return;
      tab.original = latest.content; tab.revision = latest.revision; tab.conflict = false; tab.dirty = tab.doc.getValue() !== latest.content; renderTabs(); updateFileStatus(); status('Draft preserved. Review it and Save to write against the latest revision.');
    } });
  }
  function icon(kind) { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.setAttribute('viewBox', '0 0 20 20'); node.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(node.namespaceURI, 'path'); p.setAttribute('d', kind === 'directory' ? 'M2 5h6l2 2h8v10H2V5Z' : 'M5 2h7l4 4v12H5V2Zm7 0v5h4'); node.append(p); return node; }
  async function folder(path, container) {
    const epoch = state.epoch, result = await tool('workspace_editor', { action: 'tree', workspace: state.workspace, path }); if (!same(epoch) || !container.isConnected) return;
    const list = text('ul', '', 'editor-tree-list');
    for (const entry of result.entries) {
      const li = text('li', ''), row = text('div', '', 'editor-tree-row'), button = text('button', ''); button.type = 'button'; button.dataset.path = entry.path; button.append(icon(entry.kind), text('span', entry.name)); button.disabled = entry.kind === 'blocked';
      if (entry.kind === 'directory') { button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', async () => { try { let nested = li.querySelector('ul'); if (nested) { nested.hidden = !nested.hidden; button.setAttribute('aria-expanded', String(!nested.hidden)); } else { button.disabled = true; await folder(entry.path, li); button.setAttribute('aria-expanded', 'true'); } } catch (error) { status(error.message, true); } finally { button.disabled = false; } }); }
      else button.addEventListener('click', () => openFile(entry.path).catch(error => status(error.message, true)));
      row.append(button); li.append(row); list.append(li);
    }
    if (!result.entries.length) list.append(text('li', 'This folder is empty.', 'empty'));
    if (result.truncated) list.append(text('li', 'Showing the first 1,000 entries.', 'empty'));
    container.append(list);
  }
  async function refreshTree() {
    if (typeof DTExplorer !== 'undefined') {
      explorer?.dispose();
      const valid = WorkspaceEditorState.guard(state), workspace = state.workspace;
      explorer = new DTExplorer($('tree'), {
        list: (path, cursor) => tool('workspace_editor', { action: 'tree', workspace, path, limit: 150, ...(cursor ? { cursor } : {}) }),
        search: (query, cursor, refresh) => tool('workspace_editor', { action: 'search', workspace, query, limit: 150, refresh: !!refresh, ...(cursor ? { cursor } : {}) }),
        open: (path, pin) => valid() && openFile(path, false, pin).catch(e => status(e.message, true)), onError: e => status(e.message, true)
      });
      if (workspace) await explorer.refresh();
    } else { $('tree').replaceChildren(); if (state.workspace) await folder('.', $('tree')); }
  }
  function dirty() { return [...state.tabs.values()].some(t => t.dirty); }
  function clearTabs() { state.loading = true; editor.clear?.(); for (const tab of state.tabs.values()) tab.doc.dispose?.(); state.tabs.clear(); state.loading = false; }
  async function chooseWorkspace(id) {
    if (dirty() && !confirm('Discard unsaved editor changes before switching workspace?')) { $('workspace').value = state.workspace; return; }
    state.epoch++; clearTimeout(state.timer); state.workspace = id; clearTabs(); state.active = null; state.job = null; state.loading = true; editor.setValue(''); state.loading = false; editor.getWrapperElement().hidden = true; $('editorEmpty').hidden = false; renderTabs(); updateFileStatus(); $('tree').replaceChildren();
    for (const element of ['refresh', 'command', 'run']) $(element).disabled = !id; $('cancel').disabled = true;
    const url = new URL(location.href); if (id) url.searchParams.set('workspace', id); else url.searchParams.delete('workspace'); url.searchParams.delete('path'); url.searchParams.set('story', state.story); history.replaceState(null, '', url);
    $('repository').textContent = $('workspace').selectedOptions[0]?.textContent || 'No workspace selected';
    if (id) { await refreshTree(); status('Workspace ready. Choose a file or run git status.'); } else status('Create a workspace with workspace_open, then choose it above.');
    $('output').textContent = id ? 'Inspection terminal ready. Run git status to see workspace changes.' : 'Choose a workspace to inspect it.';
  }
  async function connect() {
    if (dirty() && !confirm('Discard unsaved editor changes before reconnecting?')) return;
    state.story = $('story').value.trim() || 'default'; state.epoch++; const epoch = state.epoch; status('Loading owned workspaces…');
    const result = await tool('workspace_editor', { action: 'list' }); if (!same(epoch)) return;
    $('workspace').replaceChildren(new Option('Choose a workspace…', ''));
    for (const w of result.workspaces.filter(w => w.exists)) $('workspace').add(new Option(w.repo + ' · ' + (w.ref || w.sha), w.id));
    $('buildOption').hidden = !result.policy.buildsEnabled;
    if (result.policy.buildsEnabled) for (const value of result.policy.buildCommands) { if (![...$('commands').options].some(o => o.value === value)) $('commands').append(new Option('', value)); }
    const requested = params.get('workspace') || state.workspace, id = result.workspaces.some(w => w.id === requested && w.exists) ? requested : result.workspaces.length === 1 && result.workspaces[0].exists ? result.workspaces[0].id : '';
    clearTabs(); $('workspace').value = id; await chooseWorkspace(id);
    if (id && params.get('path')) await openFile(params.get('path'));
    await loadInventoryList();
  }
  async function pollTerminal(job, epoch) {
    try { const result = await tool('workspace_terminal', { workspace: state.workspace, action: 'read', job }); if (!same(epoch) || state.job !== job) return;
      $('terminalState').textContent = result.state; $('output').textContent = '$ ' + result.command + '\n' + (result.out !== undefined ? result.out : result.log.join('\n')) + (result.error ? '\n' + result.error : '') + (result.truncated ? '\n[Earlier output omitted]' : '') + (result.code !== undefined ? '\n[exit ' + result.code + ']' : '');
      $('output').scrollTop = $('output').scrollHeight;
      const running = ['running', 'queued'].includes(result.state); $('cancel').disabled = !running; $('run').disabled = running;
      if (running) state.timer = setTimeout(() => pollTerminal(job, epoch), 700);
    } catch (error) { if (same(epoch)) { status(error.message, true); $('run').disabled = false; $('cancel').disabled = true; } }
  }
  async function loadInventoryList() { const epoch = state.epoch, result = await tool('gradle_inventory', { action: 'list' }); if (!same(epoch)) return; const selected = $('inventoryRevision').value; $('inventoryRevision').replaceChildren(new Option('Choose a revision…', '')); for (const r of result.revisions) $('inventoryRevision').add(new Option(r.repo + ' · ' + r.sha.slice(0, 10) + ' · ' + r.files + ' files', r.revision)); if ([...$('inventoryRevision').options].some(o => o.value === selected)) $('inventoryRevision').value = selected; }
  function renderDependencies() {
    $('dependencyRows').replaceChildren(); if (!state.inventory) return;
    const rows = WorkspaceEditorState.dependencies(state.inventory.dependencies, $('dependencyFilter').value);
    for (const dep of rows.slice(0, 300)) {
      const button = text('button', '', 'editor-dependency'); button.type = 'button'; button.setAttribute('aria-current', String(dep.id === state.dependency?.id));
      button.append(text('strong', (dep.coordinate || dep.alias || dep.expression || 'Computed dependency') + (dep.version ? ' · ' + dep.version : '')), text('small', dep.path + ':' + dep.line), text('small', dep.owner ? (dep.owner.kind === 'literal' ? 'Literal version' : 'Shared owner: ' + (dep.owner.key || dep.owner.path)) : dep.reason || 'Unresolved'));
      button.addEventListener('click', () => { state.dependency = dep; state.planRequest++; state.plan = null; $('upgrade').hidden = false; $('upgradeTitle').textContent = dep.coordinate || dep.alias || 'Unresolved declaration'; $('newVersion').value = dep.version || ''; $('plan').replaceChildren(text('p', dep.owner ? `Version owned by ${dep.owner.path}:${dep.owner.line}` : dep.reason || 'No editable version owner')); $('planBump').disabled = !dep.owner; $('applyBump').disabled = true; renderDependencies(); }); $('dependencyRows').append(button);
    }
    $('inventoryStatus').textContent = rows.length ? `${rows.length} declarations${rows.length > 300 ? '; showing the first 300. Refine your search.' : ''}` : 'No matching declarations. Dynamic build logic may require manual inspection.';
  }
  on('connect', 'click', connect); on('workspace', 'change', () => chooseWorkspace($('workspace').value)); on('refresh', 'click', refreshTree); on('save', 'click', save); on('compareLatest', 'click', compareLatest);
  on('reload', 'click', () => { const tab = state.tabs.get(state.active); if (!tab || tab.dirty && !confirm('Discard this draft and reload the saved file?')) return; return openFile(state.active, true); });
  on('find', 'click', () => editor.execCommand('findPersistent'));
  on('toggleExplorer', 'click', () => { $('explorer').hidden = !$('explorer').hidden; $('toggleExplorer').setAttribute('aria-expanded', String(!$('explorer').hidden)); editor.refresh(); });
  const showInventory = visible => { $('inventory').hidden = !visible; $('dependencies').setAttribute('aria-expanded', String(visible)); editor.refresh(); };
  on('dependencies', 'click', () => showInventory($('inventory').hidden)); on('closeInventory', 'click', () => showInventory(false));
  on('terminalForm', 'submit', async e => { e.preventDefault(); if (!state.workspace) return; const epoch = state.epoch; $('run').disabled = true; try { const r = await tool('workspace_terminal', { workspace: state.workspace, action: 'run', command: $('command').value.trim() || 'git status', allow_build: $('allowBuild').checked }); if (!same(epoch)) return; state.job = r.job; $('cancel').disabled = false; await pollTerminal(r.job, epoch); } catch (error) { if (same(epoch)) $('run').disabled = false; throw error; } });
  on('cancel', 'click', async () => { await tool('workspace_terminal', { workspace: state.workspace, action: 'cancel', job: state.job }); await pollTerminal(state.job, state.epoch); });
  on('clear', 'click', async () => { if (state.workspace) await tool('workspace_terminal', { workspace: state.workspace, action: 'clear' }); $('output').textContent = ''; });
  on('indexGradle', 'click', async () => { const epoch = state.epoch; $('indexGradle').disabled = true; try { const r = await tool('gradle_inventory', { action: 'index', repos: $('repos').value.split(',').map(s => s.trim()).filter(Boolean), ref: $('gradleRef').value.trim() || undefined }); $('inventoryStatus').textContent = 'Indexing all build files…'; const observe = async () => { try { const j = await tool('gradle_inventory', { job: r.job }); if (!same(epoch)) return; $('inventoryStatus').textContent = j.state === 'running' ? j.log.slice(-1)[0] || 'Indexing…' : j.error || `Indexed ${j.counts?.indexed || 0}; reused ${j.counts?.reused || 0}; failed ${j.counts?.failed || 0}.`; if (j.state === 'running') setTimeout(observe, 1000); else { $('indexGradle').disabled = false; await loadInventoryList(); } } catch (error) { $('indexGradle').disabled = false; status(error.message, true); } }; await observe(); } catch (error) { $('indexGradle').disabled = false; throw error; } });
  on('inventoryRevision', 'change', async () => { if (!$('inventoryRevision').value) { state.inventoryRequest++; state.inventory = null; renderDependencies(); return; } state.inventoryRequest++; const valid = WorkspaceEditorState.guard(state, ['epoch', 'workspace', 'story', 'inventoryRequest']); const result = await tool('gradle_inventory', { action: 'read', revision: $('inventoryRevision').value }); if (!valid()) return; state.inventory = result; state.plan = null; state.dependency = null; $('upgrade').hidden = true; renderDependencies(); });
  on('dependencyFilter', 'input', renderDependencies);
  on('planBump', 'click', async () => { state.planRequest++; const valid = WorkspaceEditorState.guard(state, ['epoch', 'workspace', 'story', 'planRequest', 'dependency', 'inventory']), result = await tool('gradle_bump', { action: 'plan', revision: state.inventory.revision, dependency: state.dependency.coordinate || state.dependency.id, version: $('newVersion').value.trim() }); if (!valid()) return; state.plan = result; $('plan').replaceChildren(text('p', result.applicable ? `${result.changes.length} version owner${result.changes.length === 1 ? '' : 's'} in ${result.files.length} file${result.files.length === 1 ? '' : 's'}. Review every affected consumer.` : 'This upgrade has unresolved owners or no changes. Inspect the declarations before applying.')); for (const change of result.changes) { $('plan').append(text('p', `${change.path}:${change.line} · ${change.value} → ${change.replacement}`)); const ul = text('ul', '', 'editor-plan-affected'); for (const dep of change.affected) ul.append(text('li', `${dep.coordinate || dep.alias} · ${dep.path}:${dep.line}`)); $('plan').append(ul); } for (const blocked of result.blocked) $('plan').append(text('p', blocked.path + ':' + blocked.line + ' · ' + blocked.reason)); for (const file of result.files) { const details = text('details', '', 'editor-plan-file'); details.append(text('summary', 'Proposed ' + file.path), text('pre', file.content)); $('plan').append(details); } $('applyBump').disabled = !result.applicable || !state.workspace; });
  on('applyBump', 'click', async () => { if (!state.plan || !state.workspace) return; if (dirty()) throw new Error('Save or close unsaved editor drafts before applying the reviewed upgrade.'); const epoch = state.epoch; $('applyBump').disabled = true; const result = await tool('gradle_bump', { action: 'apply', plan: state.plan.id, workspace: state.workspace }); if (!same(epoch)) return; for (const file of result.written) if (state.tabs.has(file.path)) await openFile(file.path, true); status(`Applied changes to ${result.written.length} file${result.written.length === 1 ? '' : 's'}. Run the build explicitly to validate.`); });
  addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  initEditor(); connect().catch(error => status(error.message, true));
})();
