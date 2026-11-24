// The conversation uses the same shipped Monaco/Explorer/path components as the app.
// This adapter is deliberately synthetic and stores only opened files in the local task.
const { source } = require('./store.cjs');
const files = Array.from({ length: 20000 }, (_, i) => i < 5000 ? `fixtures/wide/File${String(i).padStart(5, '0')}.java` : `services/service-${String(Math.floor((i - 5000) / 150)).padStart(3, '0')}/src/main/java/Person${String(i).padStart(5, '0')}.java`);
let model;
function scaleGraph() {
  if (model) return model;
  const nodes = [
    { id: 'entry', label: 'GET /person/:id', kind: 'HTTP entry' },
    { id: 'read', label: 'Read person and candidate documents', kind: 'Database read', file: 'queries/person-candidates.sql', line: 1, table: 'registry.person_document' },
    { id: 'fields', label: 'Candidate document fields', kind: 'Query result', table: 'registry.person_document' },
    { id: 'selection', label: 'Choose the newest eligible document', kind: 'Selection', file: 'src/DocumentPolicy.java', line: 1, code: source, assumptions: ['Static specimen · candidate iteration is not a runtime observation'] },
    { id: 'active', label: 'Keep active documents', kind: 'Predicate', file: 'src/DocumentPolicy.java', line: 3, code: '.filter(Document::active)' },
    { id: 'date', label: 'Keep effective, unexpired documents', kind: 'Predicate', file: 'src/DocumentPolicy.java', line: 4, endLine: 5 },
    { id: 'annulled', label: 'Annulment guard is absent in source v1', kind: 'Missing predicate', file: 'src/DocumentPolicy.java', line: 3, changes: ['Required: exclude annulled documents before newest-document selection'] },
    { id: 'map', label: 'PersonResponse.fio from one complete document name', kind: 'Data change', file: 'src/DocumentPolicy.java', line: 7, field: 'PersonResponse.fio', changes: ['Document 104 → Анна Смирнова', 'Expected document 103 → Анна Петрова'], assumptions: ['Candidate-to-response correlation is a synthetic fixture, not a live observation'] },
    { id: 'exit', label: 'Return person response', kind: 'HTTP exit', field: 'PersonResponse.fio' },
    { id: 'library', label: 'Inherited AbstractPersonHandler', kind: 'Internal library', basis: 'Assumed default branch', gap: 'Exact deployed library artifact is unavailable. Dispatch remains unverified.' },
    { id: 'audit', label: 'Optional audit service', kind: 'API exit', gap: 'Dynamic target is unresolved. No deployment connection is asserted.' },
    { id: 'fanout', label: '500 downstream call sites', kind: 'Fan-out scale fixture' }
  ];
  const edges = [], edge = (from, to, label = 'Synthetic static connection', callSite) => edges.push({ id: 'edge:' + edges.length, from, to, label, callSite });
  for (const [a, b] of [['entry', 'read'], ['read', 'fields'], ['read', 'selection'], ['selection', 'active'], ['active', 'date'], ['date', 'annulled'], ['annulled', 'map'], ['map', 'exit'], ['selection', 'library'], ['library', 'map'], ['map', 'audit'], ['selection', 'fanout']]) edge(a, b);
  for (let i = 0; i < 1500; i++) { const id = 'field:' + i; nodes.push({ id, label: i === 1499 ? 'document_state.annulled' : 'result_field_' + i, kind: 'Column', field: i === 1499 ? 'annulled' : 'result_field_' + i, table: 'registry.person_document' }); edge('fields', id); }
  for (let i = 0; i < 200; i++) { const id = 'depth:' + i; nodes.push({ id, label: `Deep path step ${i + 1}`, kind: 'Method', repo: 'service-' + i % 20 }); edge(i ? 'depth:' + (i - 1) : 'selection', id, 'Synthetic call', 'Handler.java:' + (i + 1)); }
  edge('depth:199', 'map', 'Shared callee', 'DeepHandler.java:200'); edge('depth:199', 'depth:100', 'Cycle back to an existing method', 'DeepHandler.java:201');
  while (nodes.length < 50000) { const i = nodes.length, id = 'scale:' + i; nodes.push({ id, label: `Method ${String(i).padStart(5, '0')}`, kind: 'Synthetic method', repo: 'service-' + i % 20 }); if (i < 2212) edge('fanout', i < 1962 ? id : 'map', 'Call site ' + (i - 1712), 'Fanout.java:' + i); }
  for (const n of nodes) { n.revision = 'illustrative-v1'; n.evidence ||= n.basis || 'Synthetic static illustration'; }
  model = DTPath.graph(nodes, edges); return model;
}
const make = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
const btn = (text, fn) => { const n = make('button', text); n.type = 'button'; n.addEventListener('click', fn); return n; };
class Workbench {
  constructor({ store, task, review, notify, onAttach, onTest, onFix }) {
    this.store = store; this.task = task; this.review = review; this.notify = notify; this.onAttach = onAttach; this.onTest = onTest; this.onFix = onFix; this.tabs = new Map(); this.current = null; this.loading = false;
    this.host = make('div', null, 'cw');
    const toolbar = make('div', null, 'cw-toolbar'); this.pathButton = btn('Path', () => this.mode('path')); this.filesButton = btn('Files', () => this.mode('files')); this.explorerToggle = btn('Hide Explorer', () => this.showExplorer(this.explorerHost.hidden)); toolbar.append(this.pathButton, this.filesButton, this.explorerToggle, make('small', 'Synthetic fixture · browser-local drafts')); this.host.append(toolbar);
    this.pathHost = make('div', null, 'cw-path'); this.path = new DTPath.Browser(this.pathHost, { graph: scaleGraph(), initialId: task.focusNode || new URL(location.href).searchParams.get('focus') || 'selection', onSelect: n => { task.focusNode = n.id; const url = new URL(location.href); url.searchParams.set('focus', n.id); history.replaceState(null, '', url); }, onSource: n => { this.open(n.file, { snapshot: n.file === 'src/DocumentPolicy.java', line: n.line, endLine: n.endLine }); if (n.file !== 'src/DocumentPolicy.java') notify('Opened the current workspace copy. The locator comes from a static illustration.'); } }); this.host.append(this.pathHost);
    this.filesHost = make('div', null, 'cw-files'); this.explorerHost = make('div', null, 'cw-explorer'); this.editHost = make('div', null, 'cw-edit'); this.filesHost.append(this.explorerHost, this.editHost); this.host.append(this.filesHost);
    this.tabsHost = make('div', null, 'cw-tabs'); this.tabsHost.setAttribute('role', 'tablist'); this.tabsHost.setAttribute('aria-label', 'Open files'); this.editHost.append(this.tabsHost);
    this.fileActions = make('div', null, 'cw-file-actions'); this.saveButton = btn('Save file', () => this.save()); this.attachButton = btn('Attach to message', () => this.onAttach(this.current)); this.editActions = btn('Edit workspace copy', () => this.open(this.tabs.get(this.current).path, { pin: true })); this.fileActions.append(this.saveButton, this.attachButton, this.editActions); this.editHost.append(this.fileActions);
    this.fileState = make('p', 'Choose a file. Single click previews; double click keeps a tab.', 'cw-state'); this.fileState.setAttribute('role', 'status'); this.editHost.append(this.fileState);
    this.sourceHost = make('div', null, 'cw-source'); const area = make('textarea'); area.hidden = true; this.sourceHost.append(area); this.editHost.append(this.sourceHost);
    this.editor = DTEditor.fromTextArea(area, { screenReaderLabel: 'Task source code', extraKeys: { 'Ctrl-S': () => this.save() } });
    this.editor.on('change', () => { if (this.loading || !this.current) return; const tab = this.tabs.get(this.current); if (tab.snapshot) return; tab.pinned = true; this.store.openFile(tab.path); this.store.editFile(tab.doc.getValue()); this.renderTabs(); this.renderState(); });
    this.extra = make('div', null, 'cw-extra'); this.fixButton = btn('Insert annulment guard', () => { this.onFix(); this.refresh(); }); this.testButton = btn('Run saved revision', () => this.onTest()); this.conflictButton = btn('Simulate save conflict', () => { const tab = this.tabs.get(this.current); this.store.openFile(tab.path); this.store.saveFile(true); this.renderState(); }); this.extra.append(this.fixButton, this.testButton); this.editHost.append(this.extra);
    this.conflict = make('div', null, 'cw-conflict'); this.editHost.append(this.conflict);
    const advanced = make('details'); advanced.append(make('summary', 'Fixture controls'), make('p', '20,000 generated paths; 5,000 files in fixtures/wide. Source is loaded only when opened. No filesystem or tool calls.'), this.conflictButton); this.editHost.append(advanced);
    this.explorer = new DTExplorer(this.explorerHost, { list: (path, cursor) => this.list(path, cursor), search: (q, cursor) => this.search(q, cursor), open: (path, pin) => this.open(path, { pin }), onError: e => notify(e.message) }); this.explorer.refresh();
    this.explorerResize = DTResize(this.explorerHost, this.editHost, { min: 140, max: 380, label: 'Resize task file explorer' }); this.mode('files');
  }
  paths() { return [...new Set([...Object.keys(this.task.files), ...files])].sort(); }
  page(entries, cursor) { const offset = Number(cursor) || 0, end = offset + 150; return { entries: entries.slice(offset, end), total: entries.length, next_cursor: end < entries.length ? String(end) : null }; }
  list(path, cursor) { const prefix = path === '.' ? '' : path + '/', children = new Map(); for (const p of this.paths()) if (p.startsWith(prefix)) { const tail = p.slice(prefix.length), name = tail.split('/')[0], full = prefix + name; children.set(full, { path: full, name, kind: tail.includes('/') ? 'directory' : 'file' }); } const entries = [...children.values()].sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name)); return this.page(entries, cursor); }
  search(query, cursor) { return this.page(this.paths().filter(p => p.toLowerCase().includes(query.toLowerCase())).map(p => ({ name: p.split('/').pop(), path: p, kind: 'file' })), cursor); }
  ensure(path) { if (!this.task.files[path]) this.task.files[path] = { saved: `// Synthetic scale file: ${path}\nclass ScaleFixture {\n  String name = "Generated on demand";\n}\n`, revision: 1 }; }
  open(path, { pin = false, snapshot = false, line, endLine } = {}) {
    if (!path) return; this.ensure(path); this.mode('files'); const key = (snapshot ? 'snapshot:' : '') + path;
    if (!this.tabs.has(key)) {
      for (const [id, tab] of this.tabs) if (!tab.pinned && !this.dirty(tab)) { this.tabs.delete(id); tab.doc.dispose(); }
      let content;
      if (snapshot) content = path === 'src/DocumentPolicy.java' ? source : this.task.files[path].saved;
      else if (!this.review) { this.store.openFile(path); content = this.store.fileSnapshot().context.draft; } else content = this.task.files[path].saved;
      this.tabs.set(key, { path, snapshot, pinned: pin || snapshot, doc: new DTEditor.Doc(content, null, 0, '\n', path) });
    } else if (pin) this.tabs.get(key).pinned = true;
    this.activate(key); if (line) this.editor.reveal(line, endLine || line); if (matchMedia('(max-width:600px)').matches) this.showExplorer(false);
  }
  dirty(tab) { return !tab.snapshot && tab.doc.getValue() !== this.task.files[tab.path]?.saved; }
  activate(key) { const tab = this.tabs.get(key); if (!tab) return; this.current = key; this.loading = true; this.editor.swapDoc(tab.doc); this.editor.setOption('readOnly', tab.snapshot || this.review); this.loading = false; this.explorer?.setActive(tab.path); this.renderTabs(); this.renderState(); this.editor.refresh(); }
  renderTabs() { this.tabsHost.replaceChildren(); for (const [key, tab] of this.tabs) { const row = make('div', null, 'cw-tab' + (key === this.current ? ' selected' : '') + (tab.pinned ? '' : ' preview')); const b = btn(tab.path.split('/').pop() + (tab.snapshot ? ' @ v1' : '') + (this.dirty(tab) ? ' •' : ''), () => this.activate(key)); b.role = 'tab'; b.title = tab.path; b.setAttribute('aria-selected', String(key === this.current)); b.addEventListener('dblclick', () => { tab.pinned = true; this.renderTabs(); }); const close = btn('×', () => { if (this.dirty(tab) && !confirm('Close this tab? The draft remains saved in this browser.')) return; this.tabs.delete(key); tab.doc.dispose(); this.current = null; const next = this.tabs.keys().next().value; if (next) this.activate(next); else { this.editor.getWrapperElement().hidden = true; this.renderTabs(); this.renderState(); } }); close.setAttribute('aria-label', 'Close ' + tab.path); row.append(b, close); this.tabsHost.append(row); } this.editor.getWrapperElement().hidden = !this.current; }
  renderState() {
    const tab = this.tabs.get(this.current), dirty = tab && this.dirty(tab); this.saveButton.disabled = !tab || !dirty || tab.snapshot || this.review || this.editor.isReadOnly; this.attachButton.disabled = !tab || this.review || tab.snapshot; this.editActions.hidden = !tab?.snapshot || this.review;
    this.fixButton.hidden = tab?.path !== 'src/DocumentPolicy.java' || tab.snapshot || this.review; this.testButton.hidden = tab?.path !== 'src/DocumentPolicy.java' || tab.snapshot || this.review; this.testButton.disabled = !!dirty; this.conflictButton.disabled = !dirty || tab.snapshot || this.review;
    this.fixButton.disabled = !!this.editor.isReadOnly;
    this.fileState.textContent = tab ? `${tab.path} · ${tab.snapshot ? 'Read-only source @ illustrative-v1' : dirty ? 'Unsaved draft · retained in this browser' : 'Saved · revision ' + this.task.files[tab.path].revision}` : 'Choose a file. Single click previews; double click keeps a tab.';
    this.conflict.replaceChildren(); if (tab && !tab.snapshot && !this.review) { this.store.openFile(tab.path); const state = this.store.state(this.task.id, 'file:' + tab.path); if (['open.conflict', 'open.reviewRemote'].includes(state)) { this.saveButton.disabled = true; this.conflict.append(make('p', 'Concurrent save conflict. Your draft is preserved.'), btn('Review latest', () => { this.store.send(this.task.id, 'file:' + tab.path, 'REVIEW_REMOTE'); this.store.persist(); this.conflict.append(make('pre', this.task.files[tab.path].saved + '\n// Synthetic concurrent note'), btn('Keep merged draft', () => { this.store.send(this.task.id, 'file:' + tab.path, 'REBASE'); this.store.persist(); this.renderState(); })); })); } }
  }
  save() { const tab = this.tabs.get(this.current); if (!tab || this.saveButton.disabled) return; try { this.store.openFile(tab.path); this.store.saveFile(); this.renderTabs(); this.renderState(); this.notify('Saved. Previous evidence and checks keep their admitted revisions.'); } catch (e) { this.notify(e.message); } }
  refresh() { const tab = this.tabs.get(this.current); if (tab && !tab.snapshot && !this.review) { this.store.openFile(tab.path); const value = this.store.fileSnapshot().context.draft; if (value !== tab.doc.getValue()) { this.loading = true; tab.doc.model.pushEditOperations([], [{ range: tab.doc.model.getFullModelRange(), text: value }], () => null); this.loading = false; } } this.renderTabs(); this.renderState(); }
  showExplorer(visible) { this.explorerHost.hidden = !visible; this.explorerResize.hidden = !visible; this.explorerToggle.textContent = visible ? 'Hide Explorer' : 'Show Explorer'; this.explorerToggle.setAttribute('aria-expanded', String(visible)); this.editor?.refresh(); }
  mode(name) { this.name = name; this.filesHost.hidden = name !== 'files'; this.pathHost.hidden = name !== 'path'; this.explorerToggle.hidden = name !== 'files'; this.pathButton.setAttribute('aria-pressed', String(name === 'path')); this.filesButton.setAttribute('aria-pressed', String(name === 'files')); requestAnimationFrame(() => this.editor?.refresh()); }
}
module.exports = { Workbench, scaleGraph };
