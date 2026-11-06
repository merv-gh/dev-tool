(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DTState = factory();
})(globalThis, function() {
'use strict';
// Small, dependency-free transition engine. Payload, cancellation, persistence,
// cleanup and outcome stay separate; a state label cannot prove any of them.
const bindings = new WeakMap();
const observers = new Set();
function observe(listener) { if (typeof listener !== 'function') throw new TypeError('State observer must be a function'); observers.add(listener); return () => observers.delete(listener); }
function notify(event) { for (const listener of observers) try { listener(event); } catch {} }
function define(name, initial, transitions, terminal = []) {
  const states = Object.keys(transitions);
  if (!states.includes(initial) || terminal.some(s => !states.includes(s))) throw new Error(`Invalid state model ${name}`);
  const edges = Object.fromEntries(Object.entries(transitions).map(([from, targets]) => {
    if (!Array.isArray(targets) || targets.some(s => !states.includes(s))) throw new Error(`Invalid targets in ${name}.${from}`);
    if (terminal.includes(from) && targets.some(to => to !== from)) throw new Error(`Terminal state has outgoing edges: ${name}.${from}`);
    return [from, Object.freeze([...new Set(targets)])];
  }));
  return Object.freeze({ name, initial, states: Object.freeze(states), terminal: Object.freeze([...terminal]), transitions: Object.freeze(edges) });
}
function assertState(model, state) {
  if (!Object.hasOwn(model.transitions, state)) throw Object.assign(new Error(`${model.name}: unknown state ${String(state)}`), { code: 'DT_STATE_UNKNOWN', machine: model.name });
  return state;
}
function next(model, from, to) {
  assertState(model, from); assertState(model, to);
  // Reasserting a fact is idempotent; terminal states cannot be revived.
  if (from !== to && !model.transitions[from].includes(to)) throw Object.assign(new Error(`${model.name}: illegal transition ${from} -> ${to}`), { code: 'DT_STATE_TRANSITION', machine: model.name, from, to });
  return to;
}
function create(model, initial = model.initial) {
  let state = assertState(model, initial);
  function transition(to) {
    const from = state;
    try { state = next(model, state, to); }
    catch (error) { if (observers.size) notify({ kind: 'rejected', machine: model.name, from, to, code: error.code }); throw error; }
    if (observers.size) notify({ kind: from === to ? 'reassert' : 'transition', machine: model.name, from, to });
    return state;
  }
  return Object.freeze({ model, get state() { return state; }, is: (...values) => values.includes(state),
    can: to => state === to || model.transitions[state].includes(to),
    to: transition, get terminal() { return model.terminal.includes(state); } });
}
// Keep the ordinary JSON shape (including old persisted records) while routing
// every mutation through the same transition table. No graph/history per row.
function bind(record, model, field = 'state') {
  const prior = bindings.get(record)?.get(field);
  if (prior) { if (prior.model !== model) throw new Error(`State field already bound: ${field}`); return record; }
  const machine = create(model, record[field] ?? model.initial), own = bindings.get(record) || new Map();
  own.set(field, machine); bindings.set(record, own);
  Object.defineProperty(record, field, { enumerable: true, configurable: false, get: () => machine.state, set: to => machine.to(to) });
  return record;
}

// UI epochs are logical clocks, not request cancellation or authorization.
// Every advance invalidates all older snapshots; resetting to zero is forbidden
// because an old response could then appear current again (the ABA problem).
class Revision {
  #value = 0;
  get value() { return this.#value; }
  set value(value) {
    if (!Number.isSafeInteger(value) || value !== this.#value + 1) throw new Error('Revision must advance exactly once');
    this.#value = value;
  }
  advance() { this.value++; return this.value; }
  current(value) { return value === this.value; }
}
const pendingModel = define('UI.pending', 'idle', { idle: ['busy'], busy: ['idle'] });
class Pending {
  #count = 0;
  constructor() { this.lifecycle = create(pendingModel); }
  get value() { return this.#count; }
  set value(value) {
    if (!Number.isSafeInteger(value) || value < 0 || Math.abs(value - this.#count) !== 1) throw new Error('Invalid pending-operation transition');
    this.lifecycle.to(value ? 'busy' : 'idle'); this.#count = value;
  }
}
const dirtyModel = define('UI.draft-field', 'clean', { clean: ['dirty'], dirty: ['clean'] });
class Dirty {
  constructor() { this.lifecycle = create(dirtyModel); }
  get value() { return this.lifecycle.is('dirty'); }
  set value(value) { if (typeof value !== 'boolean') throw new Error('Draft flag must be boolean'); this.lifecycle.to(value ? 'dirty' : 'clean'); }
}
const activityModel = define('UI.activity', 'idle', { idle: ['active'], active: ['idle'] });
class Activity {
  constructor() { this.lifecycle = create(activityModel); }
  get value() { return this.lifecycle.is('active'); }
  set value(value) { if (typeof value !== 'boolean') throw new Error('Activity must be boolean'); this.lifecycle.to(value ? 'active' : 'idle'); }
}
class Draft {
  constructor() { this.fields = new Map(); this.edits = new Revision(); }
  get revision() { return this.edits.value; }
  get dirty() { return [...this.fields.values()].some(field => field.value); }
  has(name) { return this.fields.get(name)?.value || false; }
  mark(name) { const field = this.fields.get(name) || new Dirty(); field.value = true; this.fields.set(name, field); this.edits.advance(); }
  clear(name) { if (name === undefined) this.fields.clear(); else this.fields.delete(name); }
}


const selectionModel = define('UI.selection', 'empty', { empty: ['selected'], selected: ['empty'] });
class Selection {
  #value;
  constructor(value) { this.lifecycle = create(selectionModel); this.value = value; }
  get value() { return this.#value; }
  set value(value) { this.lifecycle.to(value == null || value === '' ? 'empty' : 'selected'); this.#value = value; }
}
const disclosureModel = define('UI.disclosure', 'closed', { closed: ['open'], open: ['closed'] });
const flagBindings = new WeakMap();
function flag(record, field = 'dirty') {
  if (!record) return record;
  const fields = flagBindings.get(record) || new Map(); if (fields.has(field)) return record;
  const dirty = new Dirty(), revision = new Revision(); dirty.value = !!record[field];
  Object.defineProperty(record, field, { enumerable: true, configurable: false, get: () => dirty.value, set: value => { dirty.value = value; if (value) revision.advance(); } });
  fields.set(field, { dirty, revision }); flagBindings.set(record, fields); return record;
}
function editRevision(record, field = 'dirty') { return flagBindings.get(record)?.get(field)?.revision.value || 0; }
const framingModel = define('P05.framing', 'empty', { empty: ['partial', 'closed'], partial: ['empty', 'closed'], closed: [] }, ['closed']);
const utf8Bytes = value => typeof Buffer === 'function' ? Buffer.byteLength(value) : new TextEncoder().encode(value).length;
class Framer {
  constructor({ separator = /\n/, maxBytes = 20 * 1024 * 1024 } = {}) {
    // Protocol delimiters have a finite carry. Never rescan/copy the growing
    // record on every chunk: retain fragments and join once when it is complete.
    const carry = { '\\n': 0, '\\n\\n': 1, '\\r?\\n\\r?\\n': 3 }[separator.source];
    if (carry === undefined) throw new Error('Unsupported protocol delimiter');
    this.separator = separator; this.carryChars = carry; this.maxBytes = maxBytes;
    this.parts = []; this.partBytes = 0; this.tail = ''; this.pendingBytes = 0;
    this.decoder = new TextDecoder(); this.lifecycle = create(framingModel);
  }
  get buffer() { return this.parts.join('') + this.tail; }
  append(fragment) {
    if (!fragment) return;
    const last = this.parts.length - 1;
    if (last >= 0 && this.parts[last].length < 1024) this.parts[last] += fragment;
    else this.parts.push(fragment);
  }
  push(chunk) {
    if (this.lifecycle.terminal) throw new Error('Frame reader is closed');
    const decoded = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.pendingBytes = Math.max(0, this.pendingBytes + (typeof chunk === 'string' ? utf8Bytes(chunk) : chunk.byteLength) - utf8Bytes(decoded));
    let text = this.tail + decoded; this.tail = '';
    const frames = []; let match;
    this.separator.lastIndex = 0;
    while ((match = this.separator.exec(text))) {
      const fragment = text.slice(0, match.index);
      if (this.partBytes + utf8Bytes(fragment) > this.maxBytes) throw new Error('Protocol frame exceeds byte budget');
      this.append(fragment); frames.push(this.parts.join('')); this.parts = []; this.partBytes = 0;
      text = text.slice(match.index + match[0].length); this.separator.lastIndex = 0;
    }
    let cut = Math.max(0, text.length - this.carryChars);
    // Do not split a UTF-16 pair when accounting for UTF-8 bytes of fragments.
    if (cut && cut < text.length && /[\uDC00-\uDFFF]/.test(text[cut])) cut--;
    const prefix = text.slice(0, cut); this.tail = text.slice(cut);
    if (prefix) { this.append(prefix); this.partBytes += utf8Bytes(prefix); }
    if (this.partBytes + utf8Bytes(this.tail) + this.pendingBytes > this.maxBytes) throw new Error('Protocol frame exceeds byte budget');
    this.lifecycle.to(this.partBytes || this.tail || this.pendingBytes ? 'partial' : 'empty'); return frames;
  }
  discard() { this.parts = []; this.tail = ''; this.partBytes = this.pendingBytes = 0; this.decoder.decode(); this.lifecycle.to('closed'); }
  finish() {
    if (this.lifecycle.terminal) return;
    const flushed = this.decoder.decode(); this.lifecycle.to('closed');
    if (this.partBytes || this.tail || flushed) throw new Error('Stream ended with an incomplete protocol frame');
  }
}

const diagnosticsModel = define('UI.diagnostics-view','activity',{activity:['traces','coverage'],traces:['activity','coverage'],coverage:['activity','traces']});
const projectContextScopeModel=define('UI.project-context-scope','task',{task:['project'],project:['task']});
const models = Object.freeze({ projectContextScope:projectContextScopeModel, diagnostics:diagnosticsModel, pending: pendingModel, dirty: dirtyModel, activity: activityModel, selection: selectionModel, disclosure: disclosureModel, framing: framingModel });
return { define, create, bind, next, assertState, observe, Revision, Pending, Dirty, Draft, Activity, Selection, disclosureModel, flag, editRevision, Framer, models };

});
