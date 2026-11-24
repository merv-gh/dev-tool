// Build-only entry. The distributed editor, workers and tree engine are self-hosted.
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/kotlin/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import { createTree, syncDataLoaderFeature, hotkeysCoreFeature } from '@headless-tree/core';

const assetBase = new URL('.', document.currentScript.src);
globalThis.MonacoEnvironment = { getWorker: () => new Worker(new URL('worker.js', assetBase), { name: 'dt-editor' }) };
monaco.languages.register({ id: 'json', extensions: ['.json'] });
monaco.languages.setMonarchTokensProvider('json', { tokenizer: { root: [[/"(?:[^"\\]|\\.)*"\s*:/, 'key'], [/"(?:[^"\\]|\\.)*"/, 'string'], [/\b(?:true|false|null)\b/, 'keyword'], [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number']] } });
monaco.languages.register({ id: 'groovy', extensions: ['.gradle', '.groovy'] });
monaco.languages.setMonarchTokensProvider('groovy', { tokenizer: { root: [[/\/\/.*$/, 'comment'], [/['"](?:[^'"\\]|\\.)*['"]/, 'string'], [/\b(?:def|class|extends|return|if|else|true|false|null|plugins|dependencies|implementation|api|testImplementation)\b/, 'keyword'], [/\b\d+(?:\.\d+)?\b/, 'number']] } });
const language = path => ({ java: 'java', kt: 'kotlin', kts: 'kotlin', gradle: 'groovy', groovy: 'groovy', js: 'javascript', cjs: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', sql: 'sql', md: 'markdown', yaml: 'yaml', yml: 'yaml', xml: 'xml', html: 'html', css: 'css', properties: 'ini', toml: 'ini', sh: 'shell', py: 'python' }[String(path).split('.').pop().toLowerCase()] || 'plaintext');
class Doc {
  constructor(content, mode, first, separator, path = '') {
    this.model = monaco.editor.createModel(content, language(path || mode));
    if (separator === '\r\n') this.model.setEOL(monaco.editor.EndOfLineSequence.CRLF);
  }
  getValue() { return this.model.getValue(undefined, true); }
  setValue(value) { this.model.setValue(value); }
  dispose() { this.model.dispose(); }
}
function fromTextArea(area, options = {}) {
  const host = document.createElement('div'); host.className = 'dt-code'; area.after(host);
  // Monaco does not support mobile browsers. A readable preview is deliberately explicit.
  const mobile = matchMedia('(max-width:600px)').matches;
  let instance, doc = null; const listeners = new Map(), views = new WeakMap();
  if (mobile) {
    host.classList.add('dt-code-mobile');
    const note = document.createElement('p'); note.textContent = 'Read-only mobile preview · use a desktop for editing';
    const pre = document.createElement('pre'); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Source preview'); host.append(note, pre);
  } else {
    instance = monaco.editor.create(host, { model: null, theme: 'vs', fontSize: 13, lineHeight: 21, fontFamily: 'Menlo, Consolas, monospace', minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, ariaLabel: options.screenReaderLabel || 'Source code', padding: { top: 12 }, renderWhitespace: 'selection', fixedOverflowWidgets: true });
    instance.onDidChangeModelContent(() => listeners.get('change')?.());
    instance.onDidChangeCursorPosition(() => listeners.get('cursorActivity')?.());
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => (options.extraKeys?.['Ctrl-S'])?.());
  }
  return {
    isReadOnly: mobile,
    getWrapperElement: () => host,
    on: (name, fn) => listeners.set(name, fn),
    getValue: () => doc?.getValue() || '',
    setValue(value) { doc?.setValue(value); if (mobile) host.lastChild.textContent = value; },
    swapDoc(next) { if (doc && instance) views.set(doc, instance.saveViewState()); doc = next; if (instance) { instance.setModel(doc.model); instance.restoreViewState(views.get(doc) || null); } else host.lastChild.textContent = doc.getValue(); },
    setOption(name, value) { if (name === 'readOnly') instance?.updateOptions({ readOnly: value }); },
    refresh: () => instance?.layout(),
    focus: () => instance ? instance.focus() : host.lastChild.focus(),
    getCursor: () => ({ line: (instance?.getPosition()?.lineNumber || 1) - 1, ch: (instance?.getPosition()?.column || 1) - 1 }),
    execCommand: () => instance?.getAction('actions.find')?.run(),
    reveal(line, end = line) { if (!instance) return; instance.setSelection(new monaco.Range(line, 1, end, 1)); instance.revealLineInCenter(line); },
    clear() { instance?.setModel(null); doc = null; if (mobile) host.lastChild.textContent = ''; },
    dispose() { instance?.dispose(); host.remove(); }
  };
}
function compare({ before, after, path, onRebase }) {
  const dialog = document.createElement('dialog'); dialog.className = 'dt-compare'; dialog.setAttribute('aria-label', 'Compare latest saved file and your draft');
  const title = document.createElement('h2'); title.textContent = path + ' · latest saved / your draft';
  const note = document.createElement('p'); note.textContent = 'Review the difference. Using the latest revision as the save base preserves your draft; a separate Save writes it.';
  const host = document.createElement('div'); host.className = 'dt-compare-editor'; const controls = document.createElement('div'); const rebase = document.createElement('button'); rebase.textContent = 'Use latest revision as save base'; const close = document.createElement('button'); close.textContent = 'Keep editing'; controls.append(rebase, close); dialog.append(title, note, host, controls); document.body.append(dialog); dialog.showModal();
  const original = monaco.editor.createModel(before, language(path)), modified = monaco.editor.createModel(after, language(path));
  const diff = monaco.editor.createDiffEditor(host, { readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: matchMedia('(min-width:900px)').matches, minimap: { enabled: false }, fontSize: 13 }); diff.setModel({ original, modified });
  rebase.addEventListener('click', () => { onRebase(); dialog.close(); }); close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { diff.dispose(); original.dispose(); modified.dispose(); dialog.remove(); }, { once: true });
}
globalThis.DTEditor = { Doc, fromTextArea, language, compare };

function props(node, values) {
  for (const [name, value] of Object.entries(values)) {
    if (name === 'ref') value?.(node);
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) name === 'tabIndex' ? node.tabIndex = value : node.setAttribute(name, String(value));
  }
}
// Only visible rows are mounted. Folder loading, continuation and search are adapter boundaries.
class Explorer {
  constructor(host, adapter) {
    this.host = host; this.adapter = adapter; this.rows = new Map(); this.children = new Map(); this.pages = new Map(); this.pending = new Set(); this.epoch = 0; this.query = ''; this.height = 30; this.root = '.';
    host.classList.add('dt-explorer');
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a file by name or path'; search.setAttribute('aria-label', 'Find a file by name or path'); this.input = search;
    const navigation = document.createElement('div'); navigation.className = 'dt-tree-navigation';
    const action = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.type = 'button'; b.addEventListener('click', () => Promise.resolve(fn()).catch(e => adapter.onError?.(e))); navigation.append(b); return b; };
    this.rootButton = action('Workspace root', () => this.setRoot('.')); this.parentButton = action('Parent folder', () => this.setRoot(this.root.split('/').slice(0, -1).join('/') || '.'));
    this.focusFolderButton = action('Focus folder', () => this.setRoot(this.selectedFolder || this.root)); this.focusFolderButton.disabled = true;
    this.revealButton = action('Reveal active file', () => this.reveal(this.activePath)); this.revealButton.disabled = true;
    const context = document.createElement('p'); context.className = 'dt-tree-context'; context.tabIndex = 0; context.setAttribute('aria-label', 'Current folder path'); this.context = context;
    const info = document.createElement('p'); info.className = 'dt-tree-info'; info.setAttribute('role', 'status'); this.info = info;
    const viewport = document.createElement('div'); viewport.className = 'dt-tree-viewport'; this.viewport = viewport;
    const canvas = document.createElement('div'); canvas.className = 'dt-tree-canvas'; viewport.append(canvas); this.canvas = canvas; host.replaceChildren(search, navigation, context, info, viewport);
    this.tree = createTree({ rootItemId: '.', getItemName: i => { const row = this.rows.get(i.getId()); return row ? row.name + (this.query && row.path ? ' · ' + row.path : '') : i.getId(); }, isItemFolder: i => this.rows.get(i.getId())?.kind === 'directory',
      dataLoader: { getItem: id => this.rows.get(id), getChildren: id => { if (this.rows.get(id)?.kind === 'directory' && !this.children.has(id)) this.load(id); return this.children.get(id) || []; } },
      features: [syncDataLoaderFeature, hotkeysCoreFeature],
      setState: () => this.schedule(),
      scrollToItem: item => { const i = item.getItemMeta()?.index; if (i == null) return; const top = i * this.height; if (top < viewport.scrollTop || top + this.height > viewport.scrollTop + viewport.clientHeight) { viewport.scrollTop = top; this.render(); } },
      onPrimaryAction: item => { const row = item.getItemData(); if (row.more) this.load(row.parent, true); else { this.selectedFolder = row.kind === 'directory' ? row.path : row.path.split('/').slice(0, -1).join('/') || '.'; this.focusFolderButton.disabled = false; if (row.kind === 'directory') { if (!this.children.has(row.path)) this.load(row.path); } else if (row.kind === 'file') adapter.open(row.path, false); } }
    });
    props(viewport, this.tree.getContainerProps('Workspace files')); this.tree.setMounted(true);
    viewport.addEventListener('scroll', () => this.render());
    viewport.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); const item = this.tree.getFocusedItem(); if (item?.isFolder()) item.isExpanded() ? item.collapse() : item.expand(); else item?.primaryAction(); } });
    search.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.find(search.value), 180); });
    this.observer = new ResizeObserver(() => this.render()); this.observer.observe(viewport);
  }
  schedule() { if (this.scheduled) return; this.scheduled = true; queueMicrotask(() => { this.scheduled = false; if (!this.disposed) this.render(); }); }
  async refresh() { this.epoch++; this.pending.clear(); this.rows.clear(); this.children.clear(); this.pages.clear(); this.tree.getState().expandedItems = []; this.tree.getState().focusedItem = null; this.viewport.scrollTop = 0; this.tree.rebuildTree(); if (this.input.value) await this.find(this.input.value, true); else { this.query = ''; await this.load('.'); } }
  async find(query, refresh = false) { this.query = query; this.height = query ? 52 : 30; this.epoch++; this.pending.clear(); this.rows.clear(); this.children.clear(); this.pages.clear(); this.tree.getState().expandedItems = []; this.tree.getState().focusedItem = null; this.viewport.scrollTop = 0; this.tree.rebuildTree(); await this.load('.', false, refresh); }
  async setRoot(path) { this.root = path || '.'; this.input.value = ''; await this.find(''); }
  async reveal(path) { if (!path) return; this.root = path.split('/').slice(0, -1).join('/') || '.'; this.input.value = path; await this.find(path); if (this.rows.has(path)) { this.tree.getState().focusedItem = path; this.tree.rebuildTree(); this.render(); await this.tree.getItemInstance(path).scrollTo(); this.tree.getItemInstance(path).getElement()?.focus(); } }
  async load(path, more = false, refresh = false) {
    const epoch = this.epoch, key = `${epoch}:${path}`; if (this.pending.has(key)) return; this.pending.add(key); this.info.textContent = 'Loading files…';
    try {
      const result = this.query ? await this.adapter.search(this.query, more ? this.pages.get(path) : undefined, refresh) : await this.adapter.list(path === '.' ? this.root : path, more ? this.pages.get(path) : undefined);
      if (epoch !== this.epoch || this.disposed) return;
      const ids = more ? (this.children.get(path) || []).filter(id => !this.rows.get(id)?.more) : [];
      for (const e of result.entries) { this.rows.set(e.path, e); if (!ids.includes(e.path)) ids.push(e.path); }
      this.pages.set(path, result.next_cursor);
      if (result.next_cursor) { const id = `:more:${path}`; this.rows.set(id, { name: 'Load more files', more: true, parent: path }); ids.push(id); }
      this.children.set(path, ids); this.info.textContent = `${result.total ?? ids.length} ${this.query ? 'matching files' : 'entries in ' + path}${result.next_cursor ? ' · more available' : ''}`;
      this.context.textContent = 'Folder: ' + this.root + (this.query ? ' · searching whole workspace' : ''); this.rootButton.disabled = this.root === '.' && !this.query; this.parentButton.disabled = this.root === '.';
      if (!ids.length) this.info.textContent = this.query ? 'No matching files. Try another name or path.' : 'This folder is empty.';
      this.tree.rebuildTree();
    } catch (e) { if (epoch === this.epoch) { this.info.textContent = e.message + ' · use Refresh to retry'; this.adapter.onError?.(e); } }
    finally { this.pending.delete(key); }
  }
  render() {
    const all = this.tree.getItems(), start = Math.max(0, Math.floor(this.viewport.scrollTop / this.height) - 4), end = Math.min(all.length, start + Math.ceil((this.viewport.clientHeight || 300) / this.height) + 9);
    const focused = document.activeElement?.dataset?.treeId;
    for (const item of this.mounted || []) item.registerElement(null);
    this.canvas.replaceChildren(); this.canvas.style.height = all.length * this.height + 'px'; this.mounted = all.slice(start, end);
    for (let i = start; i < end; i++) {
      const item = all[i], row = item.getItemData(), node = document.createElement('div'); node.className = 'dt-tree-row' + (this.query && !row.more ? ' is-search' : ''); props(node, item.getProps()); node.dataset.treeId = item.getId(); node.dataset.path = row.path || ''; node.title = row.path || row.name;
      if (row.path === this.activePath) { node.setAttribute('aria-current', 'true'); node.setAttribute('aria-selected', 'true'); }
      node.style.top = i * this.height + 'px'; node.style.paddingInlineStart = Math.min(item.getItemMeta().level, 8) * 12 + 6 + 'px';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(icon.namespaceURI, 'path'); p.setAttribute('d', row.kind === 'directory' ? item.isExpanded() ? 'm3 6 5 5 5-5' : 'm6 3 5 5-5 5' : 'M4 2h5l3 3v9H4z M9 2v4h3'); icon.append(p);
      const label = document.createElement('span'); label.className = 'dt-tree-label'; const name = document.createElement('span'); name.textContent = row.name; label.append(name); if (this.query && row.path) { const path = document.createElement('small'); path.textContent = row.path; label.append(path); } node.append(icon, label);
      // Sync programmatic/Tab focus without replacing a pointer target between
      // pointerdown and click. The engine's keyboard handlers read this state.
      node.addEventListener('focus', () => { if (!item.isFocused()) { this.tree.getState().focusedItem = item.getId(); for (const row of this.canvas.children) row.tabIndex = row === node ? 0 : -1; } });
      node.addEventListener('dblclick', () => row.kind === 'file' && this.adapter.open(row.path, true)); this.canvas.append(node);
      if (focused === item.getId()) node.focus({ preventScroll: true });
    }
  }
  setActive(path) { this.activePath = path; this.revealButton.disabled = !path; this.render(); }
  dispose() { this.disposed = true; this.epoch++; clearTimeout(this.timer); this.observer.disconnect(); this.tree.setMounted(false); this.host.replaceChildren(); }
}
globalThis.DTExplorer = Explorer;
