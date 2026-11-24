// Exercise the shipped browser controller, without replacing it or exporting its private state.
// The facade supplies only DOM/CodeMirror/transport boundaries; assertions follow user actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourceFile = path.resolve(__dirname, '../web/editor.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const revision = content => crypto.createHash('sha256').update(content).digest('hex');

function mount({ search = '?workspace=owned-a&story=chat-1', workspaces, builds = true, rootTruncated = false, initialFailure } = {}) {
  const elements = new Map(), requests = [], links = [], confirmations = [], answers = [], timers = new Map(), windowEvents = new Map(), overrides = [], observations = [];
  let timerId = 0, mirror, nextTerminal = [], nextIndex = [], sequence = 0;
  class Node {
    constructor(tag = 'div', id) { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.parentNode = null; this.attrs = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.checked = false; this.listeners = new Map(); this._text = ''; this._value = undefined; this.classes = new Set(); this.classList = { toggle: (name, force) => { const on = force === undefined ? !this.classes.has(name) : force; if (on) this.classes.add(name); else this.classes.delete(name); return on; }, contains: name => this.classes.has(name) }; }
    get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
    set textContent(value) { this._text = String(value ?? ''); this.replaceChildren(); }
    get value() { return this._value ?? (this.tagName === 'SELECT' ? this.options[0]?.value || '' : ''); }
    set value(value) { this._value = String(value); }
    get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
    get selectedOptions() { return this.options.filter(option => option.value === this.value); }
    get isConnected() { return this.root || !!this.parentNode?.isConnected; }
    get scrollHeight() { return this.textContent.length; }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    add(child) { this.append(child); }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; if (this.tagName === 'SELECT') this._value = undefined; this.append(...children); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name]; }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
    async fire(name = 'click', event = {}) { const e = { prevented: false, preventDefault() { this.prevented = true; }, ...event }; for (const callback of this.listeners.get(name) || []) await callback(e); return e; }
    querySelectorAll(selector) { const matches = node => selector === 'button[data-path]' ? node.tagName === 'BUTTON' && !!node.dataset.path : node.tagName.toLowerCase() === selector; const found = []; for (const child of this.children) { if (matches(child)) found.push(child); found.push(...child.querySelectorAll(selector)); } return found; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const get = id => { if (!elements.has(id)) { const element = new Node(['workspace', 'inventoryRevision'].includes(id) ? 'select' : id === 'commands' ? 'datalist' : 'div', id); element.root = true; elements.set(id, element); } return elements.get(id); };
  const option = (caption, value) => { const node = new Node('option'); node.textContent = caption; node.value = value; return node; };
  get('inventory').hidden = true; get('upgrade').hidden = true; get('allowBuild').checked = false;
  for (const value of ['pwd', 'ls', 'git status']) get('commands').append(option('', value));
  class Doc { constructor(content, mode, firstLine, separator) { this.content = content; this.mode = mode; this.firstLine = firstLine; this.separator = separator; } getValue() { return this.content; } }
  const CodeMirror = { Doc, fromTextArea(_area, options) { const listeners = new Map(), wrapper = new Node('div'); get('sourcePane').append(wrapper); mirror = {
    options, doc: new Doc(''), wrapper, refreshes: 0, focuses: 0, cursor: { line: 0, ch: 0 }, commands: [],
    getWrapperElement: () => wrapper, on(name, callback) { listeners.set(name, callback); },
    getValue() { return this.doc.getValue(); }, setValue(value) { this.doc.content = value; listeners.get('change')?.(); },
    swapDoc(doc) { this.doc = doc; listeners.get('change')?.(); }, setOption(name, value) { this.options[name] = value; },
    refresh() { this.refreshes++; }, focus() { this.focuses++; }, getCursor() { return this.cursor; },
    execCommand(name) { this.commands.push(name); }, type(value) { this.setValue(this.getValue() + value); },
    move(line, ch) { this.cursor = { line, ch }; listeners.get('cursorActivity')?.(); }, key(name) { return this.options.extraKeys[name](); },
  }; return mirror; } };
  const owned = workspaces || [{ id: 'owned-a', repo: 'DEMO/payments', ref: 'main', sha: 'a'.repeat(40), exists: true }, { id: 'owned-b', repo: 'DEMO/library', ref: null, sha: 'b'.repeat(40), exists: true }, { id: 'expired', repo: 'DEMO/expired', exists: false }];
  const files = new Map();
  const put = (workspace, name, content, eol = 'LF') => { const file = { workspace, path: name, content, revision: revision(content), eol }; files.set(workspace + ':' + name, file); return file; };
  for (const workspace of ['owned-a', 'owned-b']) { put(workspace, 'src/Платёж.java', '\uFEFFpackage demo;\r\nclass Платёж {}\r\n', 'CRLF'); put(workspace, 'build.gradle', 'implementation "org.demo:core:1.0"\n'); put(workspace, 'README.md', '# Workspace\n'); }
  const shared = { id: 'shared', coordinate: 'org.demo:core', version: '1.0', path: 'build.gradle', line: 1, owner: { path: 'build.gradle', line: 1, key: 'platformVersion', kind: 'variable' } };
  const literal = { id: 'literal', coordinate: 'org.demo:leaf', version: '2.0', path: 'module/build.gradle.kts', line: 7, owner: { path: 'module/build.gradle.kts', line: 7, kind: 'literal' } };
  const unresolved = { id: 'unknown', alias: 'libs.dynamic', path: 'build.gradle', line: 8, reason: 'computed dependency' };
  const inventories = new Map([['revision-a', { revision: 'revision-a', dependencies: [shared, literal, unresolved] }], ['revision-b', { revision: 'revision-b', dependencies: [{ ...literal, coordinate: 'org.other:leaf' }] }]]);
  const terminalJobs = new Map(), indexJobs = new Map(), plans = new Map();
  const fault = (message, code, status = 409, nested = false) => ({ http: true, ok: false, status, body: nested ? { result: { error: message, code } } : { error: message, code } });
  function backend(name, args) {
    if (name === 'workspace_editor') {
      if (args.action === 'list') { if (initialFailure) return fault(initialFailure, 'DT_OFFLINE', 503); return { workspaces: owned, policy: { buildsEnabled: builds, buildCommands: ['gradle test', 'mvn verify'] } }; }
      if (args.action === 'tree') return { entries: args.path === '.' ? [{ name: 'src', path: 'src', kind: 'directory' }, { name: 'empty', path: 'empty', kind: 'directory' }, { name: 'build.gradle', path: 'build.gradle', kind: 'file' }, { name: 'README.md', path: 'README.md', kind: 'file' }, { name: 'outside', path: 'outside', kind: 'blocked' }] : args.path === 'src' ? [{ name: 'Платёж.java', path: 'src/Платёж.java', kind: 'file' }] : [], truncated: args.path === '.' && rootTruncated };
      const file = files.get(args.workspace + ':' + args.path);
      if (args.action === 'read') return file ? { ...file } : fault('File not found', 'DT_NOT_FOUND', 404);
      if (args.action === 'save') { if (file?.revision !== args.expected_revision) return fault('File changed', 'DT_WORKSPACE_CONFLICT'); const saved = put(args.workspace, args.path, args.content, file.eol); return { path: saved.path, revision: saved.revision, saved: true }; }
    }
    if (name === 'workspace_terminal') {
      if (args.action === 'run') { const job = 'terminal-' + ++sequence; terminalJobs.set(job, { command: args.command, states: nextTerminal.length ? nextTerminal : [{ state: 'done', code: 0, out: ' M src/Платёж.java', log: [] }] }); nextTerminal = []; return { job, state: 'running' }; }
      if (args.action === 'clear') return { cleared: true };
      const job = terminalJobs.get(args.job); if (!job) return fault('No terminal job', 'DT_NOT_FOUND', 404);
      if (args.action === 'cancel') { job.states = [{ state: 'cancelled', out: 'cancelled by operator', log: [] }]; return { state: 'cancelled' }; }
      const state = job.states.length > 1 ? job.states.shift() : job.states[0]; return { command: job.command, job: args.job, ...state };
    }
    if (name === 'gradle_inventory') {
      if (args.action === 'list') return { revisions: [...inventories.keys()].map((key, index) => ({ revision: key, repo: index ? 'DEMO/library' : 'DEMO/payments', sha: 'a'.repeat(40), files: 3 })) };
      if (args.action === 'read') return inventories.get(args.revision);
      if (args.action === 'index') { const job = 'index-' + ++sequence; indexJobs.set(job, nextIndex.length ? nextIndex : [{ state: 'done', counts: { indexed: 2, reused: 1, failed: 0 }, log: [] }]); nextIndex = []; return { job, state: 'running' }; }
      if (args.job) { const states = indexJobs.get(args.job); return states.length > 1 ? states.shift() : states[0]; }
    }
    if (name === 'gradle_bump') {
      if (args.action === 'plan') {
        const id = 'plan-' + ++sequence, content = `implementation "org.demo:core:${args.version}"\n`;
        const result = { id, applicable: true, changes: [{ path: 'build.gradle', line: 1, value: '1.0', replacement: args.version, affected: [{ coordinate: args.dependency, path: 'build.gradle', line: 1 }, { alias: 'libs.shared.consumer', path: 'module/build.gradle.kts', line: 3 }] }], blocked: [], files: [{ path: 'build.gradle', content }] }; plans.set(id, result); return result;
      }
      const plan = plans.get(args.plan); for (const file of plan.files) put(args.workspace, file.path, file.content); return { applied: true, written: plan.files.map(file => ({ path: file.path })) };
    }
    throw new Error(`Unexpected tool request ${name} ${JSON.stringify(args)}`);
  }
  const location = new URL('http://local/editor' + search);
  const sandbox = { console, URL, URLSearchParams, CodeMirror, location, history: { replaceState(_a, _b, value) { const next = new URL(value, location.href); location.href = next.href; links.push(next.href); } },
    document: { getElementById: get, createElement: tag => new Node(tag), createElementNS: (ns, tag) => { const node = new Node(tag); node.namespaceURI = ns; return node; } },
    Option: function(caption, value) { return option(caption, value); },
    ResizeObserver: class { constructor(callback) { observations.push(callback); } observe() { this.observing = true; } },
    confirm(message) { confirmations.push(message); return answers.length ? answers.shift() : false; },
    addEventListener(name, callback) { windowEvents.set(name, callback); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    async fetch(url, opts) {
      const name = url.split('/').pop(), args = JSON.parse(opts.body), request = { name, args, opts }; requests.push(request);
      const index = overrides.findIndex(item => item.name === name && item.matches(args));
      const value = index < 0 ? backend(name, args) : await overrides.splice(index, 1)[0].handler(args, request);
      if (value?.http) return { ok: value.ok, status: value.status, json: async () => value.body };
      return { ok: true, status: 200, json: async () => ({ result: value }) };
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: sourceFile });
  return { get, requests, links, files, inventories, confirmations, timers, observations, windowEvents, backend, fault, mirror: () => mirror,
    answer: (...values) => answers.push(...values), calls: (name, action) => requests.filter(r => r.name === name && (!action || r.args.action === action)),
    async settle() { await tick(); await tick(); },
    fire: (id, event = 'click') => get(id).fire(event),
    tree: name => get('tree').querySelectorAll('button[data-path]').find(node => node.dataset.path === name),
    async open(name) { const node = get('tree').querySelectorAll('button[data-path]').find(node => node.dataset.path === name); assert.ok(node, `visible file/folder ${name}`); await node.fire(); },
    async timer(delay) { const found = [...timers.entries()].find(([, timer]) => delay === undefined || timer.delay === delay); assert.ok(found, `pending ${delay || ''} timer`); timers.delete(found[0]); await found[1].callback(); },
    nextTerminal: values => { nextTerminal = values; }, nextIndex: values => { nextIndex = values; },
    override(name, matches, handler) { overrides.push({ name, matches, handler }); },
    hold(name, matches = () => true) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); const gate = { resolve, reject, request: null, complete() { resolve(backend(name, gate.request.args)); } }; overrides.push({ name, matches, handler: (args, request) => { gate.request = request; return promise; } }); return gate; },
  };
}

test('editor boots owned task scope, expands accessible tree and opens Unicode source with independent tabs', async () => {
  const s = mount({ rootTruncated: true }); await s.settle();
  assert.equal(s.get('workspace').value, 'owned-a'); assert.equal(s.get('workspace').options.length, 3); assert.equal(s.get('repository').textContent, 'DEMO/payments · main');
  assert.ok(s.requests.every(r => r.opts.headers['x-dt-story'] === 'chat-1' && r.opts.credentials === 'same-origin'));
  assert.equal(s.get('buildOption').hidden, false); assert.ok(s.get('commands').options.some(o => o.value === 'gradle test')); assert.equal(s.tree('outside').disabled, true); assert.match(s.get('tree').textContent, /first 1,000/);
  await s.open('src'); assert.equal(s.tree('src').getAttribute('aria-expanded'), 'true'); const reads = s.calls('workspace_editor', 'tree').length; await s.open('src'); assert.equal(s.tree('src').getAttribute('aria-expanded'), 'false'); await s.open('src'); assert.equal(s.calls('workspace_editor', 'tree').length, reads);
  await s.open('src/Платёж.java'); assert.match(s.mirror().getValue(), /Платёж/); assert.equal(s.mirror().doc.separator, '\r\n'); assert.equal(s.mirror().options.mode, 'text/x-java'); assert.equal(s.get('encoding').textContent, 'UTF-8 · CRLF'); assert.equal(s.tree('src/Платёж.java').getAttribute('aria-current'), 'true');
  s.mirror().move(4, 7); assert.equal(s.get('cursor').textContent, 'Line 5, column 8'); s.mirror().type('// unsaved');
  await s.open('build.gradle'); assert.equal(s.mirror().options.mode, 'text/x-groovy'); assert.equal(s.get('tabs').children.length, 2); await s.get('tabs').children[0].children[0].fire(); assert.match(s.mirror().getValue(), /unsaved/);
  const fileReads = s.calls('workspace_editor', 'read').length; await s.open('src/Платёж.java'); assert.equal(s.calls('workspace_editor', 'read').length, fileReads);
  await s.fire('find'); assert.deepEqual(s.mirror().commands, ['findPersistent']); s.observations[0](); assert.ok(s.mirror().refreshes > 0); await s.open('empty'); assert.match(s.get('tree').textContent, /This folder is empty/);
});

test('save sends exact CAS source, prevents duplicate saves and keeps edits typed during pending acknowledgement', async () => {
  const s = mount(); await s.settle(); await s.open('src'); await s.open('src/Платёж.java');
  const original = s.files.get('owned-a:src/Платёж.java'); s.mirror().type('// submitted\r\n'); const submitted = s.mirror().getValue();
  const gate = s.hold('workspace_editor', a => a.action === 'save'), pending = s.mirror().key('Ctrl-S'); await s.settle();
  assert.equal(gate.request.args.expected_revision, original.revision); assert.equal(gate.request.args.content, submitted); assert.equal(s.get('save').disabled, true);
  s.mirror().type('// later typing\r\n'); await s.mirror().key('Cmd-S'); assert.equal(s.calls('workspace_editor', 'save').length, 1); gate.complete(); await pending;
  assert.match(s.mirror().getValue(), /later typing/); assert.equal(s.get('dirty').textContent, 'Unsaved changes'); assert.equal(s.get('save').disabled, false);
  await s.fire('save'); const second = s.calls('workspace_editor', 'save').at(-1); assert.equal(second.args.expected_revision, revision(submitted)); assert.equal(s.get('dirty').textContent, 'Saved'); assert.equal(s.files.get('owned-a:src/Платёж.java').content, s.mirror().getValue());
  await s.mirror().key('Ctrl-S'); assert.equal(s.calls('workspace_editor', 'save').length, 2);
});

test('CAS conflict preserves draft; reload, close, reconnect and workspace switches respect explicit discard', async () => {
  const s = mount(); await s.settle(); await s.open('build.gradle'); s.mirror().type('// browser draft');
  const key = 'owned-a:build.gradle', external = { ...s.files.get(key), content: '// independently changed\n', revision: revision('// independently changed\n') }; s.files.set(key, external);
  await s.fire('save'); assert.match(s.get('status').textContent, /draft is preserved/); assert.match(s.mirror().getValue(), /browser draft/); assert.ok(s.get('status').classList.contains('error'));
  const before = s.requests.length; await s.fire('reload'); assert.equal(s.requests.length, before); s.get('workspace').value = 'owned-b'; await s.fire('workspace', 'change'); assert.equal(s.get('workspace').value, 'owned-a'); assert.equal(s.requests.length, before);
  s.get('story').value = 'other-task'; await s.fire('connect'); assert.equal(s.requests.length, before); await s.get('tabs').children[0].children[1].fire(); assert.equal(s.get('tabs').children.length, 1);
  const unload = { prevented: false, preventDefault() { this.prevented = true; } }; s.windowEvents.get('beforeunload')(unload); assert.equal(unload.prevented, true);
  s.answer(true); await s.fire('reload'); assert.equal(s.mirror().getValue(), external.content); assert.equal(s.get('dirty').textContent, 'Saved');
  await s.open('README.md'); await s.get('tabs').children[1].children[1].fire(); assert.equal(s.get('tabs').children.length, 1); assert.equal(s.mirror().getValue(), external.content);
  await s.get('tabs').children[0].children[1].fire(); assert.equal(s.get('editorEmpty').hidden, false); assert.equal(s.get('dirty').textContent, 'No file open');
  const pristine = { preventDefault() { throw Error('clean editor must not prompt'); } }; s.windowEvents.get('beforeunload')(pristine);
  s.get('workspace').value = 'owned-b'; await s.fire('workspace', 'change'); assert.equal(s.get('workspace').value, 'owned-b'); assert.match(s.get('repository').textContent, /library/);
});

test('responses from old workspaces and detached folders cannot repopulate the active editor', async () => {
  const s = mount(); await s.settle(); const read = s.hold('workspace_editor', a => a.action === 'read'); const opening = s.open('build.gradle'); await s.settle();
  s.get('workspace').value = 'owned-b'; await s.fire('workspace', 'change'); read.complete(); await opening; assert.equal(s.get('tabs').children.length, 0); assert.equal(s.get('editorEmpty').hidden, false); assert.match(s.get('repository').textContent, /library/);
  const folder = s.hold('workspace_editor', a => a.action === 'tree' && a.path === 'src'); const expanding = s.open('src'); await s.settle(); await s.fire('refresh'); folder.complete(); await expanding; assert.equal(s.tree('src/Платёж.java'), undefined);
  await s.open('build.gradle'); s.mirror().type('// pending save'); const save = s.hold('workspace_editor', a => a.action === 'save'), saving = s.fire('save'); await s.settle(); s.answer(true); s.get('workspace').value = 'owned-a'; await s.fire('workspace', 'change'); const currentStatus = s.get('status').textContent; save.complete(); await saving; assert.equal(s.get('tabs').children.length, 0); assert.equal(s.get('status').textContent, currentStatus);
});

test('a late file read cannot replace a newer selection or overwrite edits made while reloading', async () => {
  const s = mount(); await s.settle();
  const old = s.hold('workspace_editor', a => a.action === 'read' && a.path === 'build.gradle');
  const pending = s.open('build.gradle'); await s.settle(); await s.open('README.md'); old.complete(); await pending;
  assert.equal(s.get('tabs').children.length, 1); assert.match(s.get('tabs').textContent, /README/);
  const gate = s.hold('workspace_editor', a => a.action === 'read' && a.path === 'README.md');
  const reloading = s.fire('reload'); await s.settle(); s.mirror().type('// typed during read'); gate.complete(); await reloading;
  assert.match(s.mirror().getValue(), /typed during read/); assert.match(s.get('status').textContent, /draft is preserved/);
});

test('terminal polls bounded output, cancels owned jobs, clears and recovers usable controls after failures', async () => {
  const s = mount(); await s.settle(); s.nextTerminal([{ state: 'running', log: ['compiling Unicode source'] }, { state: 'done', out: 'результат', log: [], code: 0, truncated: true }]);
  s.get('command').value = ''; await s.fire('terminalForm', 'submit'); assert.equal(s.calls('workspace_terminal', 'run')[0].args.command, 'git status'); assert.match(s.get('output').textContent, /compiling Unicode source/); assert.equal(s.get('run').disabled, true); assert.equal(s.get('cancel').disabled, false);
  await s.timer(700); assert.match(s.get('output').textContent, /результат/); assert.match(s.get('output').textContent, /Earlier output omitted/); assert.match(s.get('output').textContent, /exit 0/); assert.equal(s.get('run').disabled, false);
  await s.fire('clear'); assert.equal(s.get('output').textContent, ''); assert.equal(s.calls('workspace_terminal', 'clear').length, 1);
  s.nextTerminal([{ state: 'running', out: 'starting', log: [] }]); s.get('command').value = 'gradle test'; s.get('allowBuild').checked = true; await s.fire('terminalForm', 'submit'); assert.equal(s.calls('workspace_terminal', 'run').at(-1).args.allow_build, true); await s.fire('cancel'); assert.match(s.get('output').textContent, /cancelled by operator/); assert.equal(s.get('terminalState').textContent, 'cancelled'); assert.equal(s.get('cancel').disabled, true);
  s.override('workspace_terminal', a => a.action === 'run', () => s.fault('Build permission denied', 'DT_ACCESS_DENIED', 403, true)); await s.fire('terminalForm', 'submit'); assert.match(s.get('status').textContent, /Build permission denied/); assert.equal(s.get('run').disabled, false);
  s.override('workspace_terminal', a => a.action === 'read', () => { throw Error('connection lost'); }); await s.fire('terminalForm', 'submit'); assert.match(s.get('status').textContent, /connection lost/); assert.equal(s.get('cancel').disabled, true); assert.equal(s.get('run').disabled, false);
});

test('late terminal results do not overwrite another workspace output', async () => {
  const s = mount(); await s.settle(); const gate = s.hold('workspace_terminal', a => a.action === 'read'), running = s.fire('terminalForm', 'submit'); await s.settle(); s.get('workspace').value = 'owned-b'; await s.fire('workspace', 'change'); const output = s.get('output').textContent; gate.complete(); await running; assert.equal(s.get('output').textContent, output); assert.equal(s.get('cancel').disabled, true);
});

test('dependency review filters declarations, displays shared consumers and refuses to apply over unsaved drafts', async () => {
  const s = mount(); await s.settle(); await s.open('build.gradle'); await s.fire('dependencies'); assert.equal(s.get('inventory').hidden, false); s.get('inventoryRevision').value = 'revision-a'; await s.fire('inventoryRevision', 'change');
  assert.equal(s.get('dependencyRows').children.length, 3); assert.match(s.get('dependencyRows').textContent, /Shared owner: platformVersion/); assert.match(s.get('dependencyRows').textContent, /Literal version/); assert.match(s.get('dependencyRows').textContent, /computed dependency/);
  s.get('dependencyFilter').value = 'PLATFORMVERSION'; await s.fire('dependencyFilter', 'input'); assert.equal(s.get('dependencyRows').children.length, 1); await s.get('dependencyRows').children[0].fire(); assert.equal(s.get('planBump').disabled, false); assert.match(s.get('upgradeTitle').textContent, /org.demo:core/);
  s.get('newVersion').value = '1.2.0'; await s.fire('planBump'); assert.match(s.get('plan').textContent, /libs.shared.consumer/); assert.match(s.get('plan').textContent, /Proposed build.gradle/); assert.match(s.get('plan').textContent, /1.2.0/); assert.equal(s.get('applyBump').disabled, false);
  s.mirror().type('// not saved'); await s.fire('applyBump'); assert.match(s.get('status').textContent, /Save or close unsaved/); assert.equal(s.calls('gradle_bump', 'apply').length, 0);
  await s.fire('save'); await s.fire('applyBump'); assert.equal(s.calls('gradle_bump', 'apply').length, 1); assert.equal(s.mirror().getValue(), 'implementation "org.demo:core:1.2.0"\n'); assert.match(s.get('status').textContent, /Applied changes to 1 file/); assert.equal(s.get('dirty').textContent, 'Saved');
  s.get('dependencyFilter').value = 'dynamic'; await s.fire('dependencyFilter', 'input'); await s.get('dependencyRows').children[0].fire(); assert.equal(s.get('planBump').disabled, true); assert.match(s.get('plan').textContent, /computed dependency/);
  s.get('dependencyFilter').value = 'nothing matches'; await s.fire('dependencyFilter', 'input'); assert.equal(s.get('dependencyRows').children.length, 0); assert.match(s.get('inventoryStatus').textContent, /No matching/);
  await s.fire('closeInventory'); assert.equal(s.get('inventory').hidden, true); await s.fire('toggleExplorer'); assert.equal(s.get('explorer').hidden, true); assert.equal(s.get('toggleExplorer').getAttribute('aria-expanded'), 'false');
});

test('inventory selection and upgrade plan responses cannot replace newer reviewed choices', async () => {
  const s = mount(); await s.settle(); const inventory = s.hold('gradle_inventory', a => a.action === 'read'); s.get('inventoryRevision').value = 'revision-a'; const first = s.fire('inventoryRevision', 'change'); await s.settle(); s.get('inventoryRevision').value = 'revision-b'; await s.fire('inventoryRevision', 'change'); inventory.complete(); await first; assert.match(s.get('dependencyRows').textContent, /org.other:leaf/); assert.doesNotMatch(s.get('dependencyRows').textContent, /org.demo:core/);
  s.get('inventoryRevision').value = 'revision-a'; await s.fire('inventoryRevision', 'change'); await s.get('dependencyRows').children[0].fire(); s.get('newVersion').value = '3.0'; const plan = s.hold('gradle_bump', a => a.action === 'plan'), planning = s.fire('planBump'); await s.settle(); await s.get('dependencyRows').children[1].fire(); const text = s.get('plan').textContent; plan.complete(); await planning; assert.equal(s.get('plan').textContent, text); assert.equal(s.get('applyBump').disabled, true);
  s.get('inventoryRevision').value = ''; await s.fire('inventoryRevision', 'change'); assert.equal(s.get('dependencyRows').children.length, 0);
});

test('inventory indexing uses the requested repo/ref and reports progress, reuse and recoverable errors', async () => {
  const s = mount(); await s.settle(); s.get('inventoryRevision').value = 'revision-b'; s.get('repos').value = ' DEMO/payments, , DEMO/library '; s.get('gradleRef').value = ' release/2 ';
  s.nextIndex([{ state: 'running', log: ['DEMO/payments: all Gradle files'] }, { state: 'done', log: [], counts: { indexed: 1, reused: 1, failed: 0 } }]); await s.fire('indexGradle'); assert.equal(s.get('indexGradle').disabled, true); assert.match(s.get('inventoryStatus').textContent, /all Gradle files/); const request = s.calls('gradle_inventory', 'index').at(-1); assert.deepEqual(request.args.repos, ['DEMO/payments', 'DEMO/library']); assert.equal(request.args.ref, 'release/2');
  await s.timer(1000); assert.match(s.get('inventoryStatus').textContent, /Indexed 1; reused 1; failed 0/); assert.equal(s.get('indexGradle').disabled, false); assert.equal(s.get('inventoryRevision').value, 'revision-b');
  s.override('gradle_inventory', a => !!a.job, () => { throw Error('inventory connection reset'); }); await s.fire('indexGradle'); assert.match(s.get('status').textContent, /inventory connection reset/); assert.equal(s.get('indexGradle').disabled, false);
  s.override('gradle_inventory', a => a.action === 'index', () => s.fault('Index refused', 'DT_ACCESS_DENIED', 403)); await s.fire('indexGradle'); assert.match(s.get('status').textContent, /Index refused/); assert.equal(s.get('indexGradle').disabled, false);
});

test('empty, disconnected and failed source states explain recovery without enabling unavailable actions', async () => {
  const s = mount({ search: '?story=default', workspaces: [], builds: false }); await s.settle(); assert.equal(s.get('workspace').value, ''); assert.equal(s.get('buildOption').hidden, true); assert.equal(s.get('command').disabled, true); assert.match(s.get('status').textContent, /Create a workspace/); const before = s.requests.length; await s.fire('terminalForm', 'submit'); await s.fire('clear'); assert.equal(s.requests.length, before); assert.equal(s.get('output').textContent, ''); await s.fire('reload'); await s.mirror().key('Ctrl-S');
  const offline = mount({ initialFailure: 'network offline' }); await offline.settle(); assert.match(offline.get('status').textContent, /network offline/);
  const own = mount({ search: '?path=README.md&story=task', workspaces: [{ id: 'owned-a', repo: 'DEMO/payments', exists: true, sha: 'a'.repeat(40) }] }); await own.settle(); assert.equal(own.get('tabs').children.length, 1); assert.equal(own.mirror().options.mode, 'markdown');
  own.override('workspace_editor', a => a.action === 'read', () => own.fault('File is no longer available', 'DT_NOT_FOUND', 404)); await own.open('build.gradle'); assert.match(own.get('status').textContent, /no longer available/);
  own.override('workspace_editor', a => a.action === 'tree' && a.path === 'src', () => { throw Error('Folder no longer available'); }); await own.open('src'); assert.match(own.get('status').textContent, /Folder no longer available/); assert.equal(own.tree('src').disabled, false);
});
