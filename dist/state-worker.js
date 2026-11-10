var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// lib/call-evidence.js
var require_call_evidence = __commonJS({
  "lib/call-evidence.js"(exports2, module2) {
    var FAILED = /* @__PURE__ */ new Set(["failed", "error", "cancelled", "interrupted", "timeout", "compile-error", "no-tests-ran", "skipped-only", "all-tests-skipped", "cleanup-failed", "invalid", "different"]);
    var TESTS = /* @__PURE__ */ new Set(["test_run", "test_compare"]);
    var ASSERTIONS = /* @__PURE__ */ new Set(["scenario_check", "scenario_preflight", "scenario_emulate", "scenario_assert", "scenario_observe", "scenario_run", "scenario_verify", "collection_check", "collection_validate", "collection_run", "collection_report", "script_run", "fixture_validate", "fixture_runtime_preflight", "fixture_runtime_start", "fixture_runtime_arm", "fixture_runtime_check", "fixture_runtime_cleanup"]);
    function classify(tool, value, { invocation = "succeeded", job, traceId } = {}) {
      const r = value && typeof value === "object" ? value : {};
      const out = { version: 1, invocation, ...traceId ? { traceId } : {} };
      const id = !tool.startsWith("jenkins_") && typeof r.job === "string" ? r.job : job?.id;
      if (id) out.job = { id, state: job?.state || r.state || r.status || "unknown", ...job?.traceId ? { traceId: job.traceId } : {} };
      const payload = job?.result || job?.resultSummary || r;
      if (/^jenkins_(build|wait|tests)$/.test(tool) && payload.state) out.execution = { kind: "ci", status: ["failed", "unstable", "aborted"].includes(payload.state) ? "failed" : payload.state };
      else if (/^bitbucket_pr_(status|wait)$/.test(tool) && payload.state) out.execution = { kind: "review", status: payload.state === "build_failed" ? "failed" : payload.state };
      else if (tool === "files_archive" && payload.archived === true) out.execution = { kind: "files", status: payload.sourceRemoved === true ? "archived" : "cleanup-failed" };
      else if (tool === "testdb_template_verify" && typeof payload.ok === "boolean") out.execution = { kind: "assertions", status: payload.ok ? "passed" : "failed" };
      else if (tool === "testdb_gc" && Array.isArray(payload.failures)) out.execution = { kind: "cleanup", status: payload.failures.length ? "cleanup-failed" : "done" };
      else if (tool === "differential_check" && ["equivalent", "different"].includes(payload.outcome)) out.execution = { kind: "assertions", status: payload.outcome };
      else if (TESTS.has(tool) && typeof payload.outcome === "string") out.execution = { kind: "tests", status: payload.outcome, ...payload.counts ? { counts: payload.counts } : {} };
      else if (ASSERTIONS.has(tool)) {
        if (typeof payload.ok === "boolean") out.execution = { kind: "assertions", status: payload.ok ? "passed" : "failed" };
        else if (typeof payload.status === "string") out.execution = { kind: "assertions", status: payload.status };
      }
      if (!out.execution && out.job) out.execution = { kind: "job", status: out.job.state };
      out.failed = invocation === "failed" || FAILED.has(out.execution?.status) || FAILED.has(out.job?.state);
      return out;
    }
    module2.exports = { classify, FAILED };
  }
});

// web/state-machine.js
var require_state_machine = __commonJS({
  "web/state-machine.js"(exports2, module2) {
    (function(root, factory) {
      if (typeof module2 === "object" && module2.exports) module2.exports = factory();
      else root.DTState = factory();
    })(globalThis, function() {
      "use strict";
      const bindings = /* @__PURE__ */ new WeakMap();
      const observers = /* @__PURE__ */ new Set();
      function observe(listener) {
        if (typeof listener !== "function") throw new TypeError("State observer must be a function");
        observers.add(listener);
        return () => observers.delete(listener);
      }
      function notify(event) {
        for (const listener of observers) try {
          listener(event);
        } catch {
        }
      }
      function define(name, initial, transitions, terminal = []) {
        const states = Object.keys(transitions);
        if (!states.includes(initial) || terminal.some((s) => !states.includes(s))) throw new Error(`Invalid state model ${name}`);
        const edges = Object.fromEntries(Object.entries(transitions).map(([from, targets]) => {
          if (!Array.isArray(targets) || targets.some((s) => !states.includes(s))) throw new Error(`Invalid targets in ${name}.${from}`);
          if (terminal.includes(from) && targets.some((to) => to !== from)) throw new Error(`Terminal state has outgoing edges: ${name}.${from}`);
          return [from, Object.freeze([...new Set(targets)])];
        }));
        return Object.freeze({ name, initial, states: Object.freeze(states), terminal: Object.freeze([...terminal]), transitions: Object.freeze(edges) });
      }
      function assertState(model, state) {
        if (!Object.hasOwn(model.transitions, state)) throw Object.assign(new Error(`${model.name}: unknown state ${String(state)}`), { code: "DT_STATE_UNKNOWN", machine: model.name });
        return state;
      }
      function next(model, from, to) {
        assertState(model, from);
        assertState(model, to);
        if (from !== to && !model.transitions[from].includes(to)) throw Object.assign(new Error(`${model.name}: illegal transition ${from} -> ${to}`), { code: "DT_STATE_TRANSITION", machine: model.name, from, to });
        return to;
      }
      function create(model, initial = model.initial) {
        let state = assertState(model, initial);
        function transition(to) {
          const from = state;
          try {
            state = next(model, state, to);
          } catch (error) {
            if (observers.size) notify({ kind: "rejected", machine: model.name, from, to, code: error.code });
            throw error;
          }
          if (observers.size) notify({ kind: from === to ? "reassert" : "transition", machine: model.name, from, to });
          return state;
        }
        return Object.freeze({
          model,
          get state() {
            return state;
          },
          is: (...values) => values.includes(state),
          can: (to) => state === to || model.transitions[state].includes(to),
          to: transition,
          get terminal() {
            return model.terminal.includes(state);
          }
        });
      }
      function bind(record, model, field = "state") {
        const prior = bindings.get(record)?.get(field);
        if (prior) {
          if (prior.model !== model) throw new Error(`State field already bound: ${field}`);
          return record;
        }
        const machine = create(model, record[field] ?? model.initial), own = bindings.get(record) || /* @__PURE__ */ new Map();
        own.set(field, machine);
        bindings.set(record, own);
        Object.defineProperty(record, field, { enumerable: true, configurable: false, get: () => machine.state, set: (to) => machine.to(to) });
        return record;
      }
      class Revision {
        #value = 0;
        get value() {
          return this.#value;
        }
        set value(value) {
          if (!Number.isSafeInteger(value) || value !== this.#value + 1) throw new Error("Revision must advance exactly once");
          this.#value = value;
        }
        advance() {
          this.value++;
          return this.value;
        }
        current(value) {
          return value === this.value;
        }
      }
      const pendingModel = define("UI.pending", "idle", { idle: ["busy"], busy: ["idle"] });
      class Pending {
        #count = 0;
        constructor() {
          this.lifecycle = create(pendingModel);
        }
        get value() {
          return this.#count;
        }
        set value(value) {
          if (!Number.isSafeInteger(value) || value < 0 || Math.abs(value - this.#count) !== 1) throw new Error("Invalid pending-operation transition");
          this.lifecycle.to(value ? "busy" : "idle");
          this.#count = value;
        }
      }
      const dirtyModel = define("UI.draft-field", "clean", { clean: ["dirty"], dirty: ["clean"] });
      class Dirty {
        constructor() {
          this.lifecycle = create(dirtyModel);
        }
        get value() {
          return this.lifecycle.is("dirty");
        }
        set value(value) {
          if (typeof value !== "boolean") throw new Error("Draft flag must be boolean");
          this.lifecycle.to(value ? "dirty" : "clean");
        }
      }
      const activityModel = define("UI.activity", "idle", { idle: ["active"], active: ["idle"] });
      class Activity {
        constructor() {
          this.lifecycle = create(activityModel);
        }
        get value() {
          return this.lifecycle.is("active");
        }
        set value(value) {
          if (typeof value !== "boolean") throw new Error("Activity must be boolean");
          this.lifecycle.to(value ? "active" : "idle");
        }
      }
      class Draft {
        constructor() {
          this.fields = /* @__PURE__ */ new Map();
          this.edits = new Revision();
        }
        get revision() {
          return this.edits.value;
        }
        get dirty() {
          return [...this.fields.values()].some((field) => field.value);
        }
        has(name) {
          return this.fields.get(name)?.value || false;
        }
        mark(name) {
          const field = this.fields.get(name) || new Dirty();
          field.value = true;
          this.fields.set(name, field);
          this.edits.advance();
        }
        clear(name) {
          if (name === void 0) this.fields.clear();
          else this.fields.delete(name);
        }
      }
      const selectionModel = define("UI.selection", "empty", { empty: ["selected"], selected: ["empty"] });
      class Selection {
        #value;
        constructor(value) {
          this.lifecycle = create(selectionModel);
          this.value = value;
        }
        get value() {
          return this.#value;
        }
        set value(value) {
          this.lifecycle.to(value == null || value === "" ? "empty" : "selected");
          this.#value = value;
        }
      }
      const disclosureModel = define("UI.disclosure", "closed", { closed: ["open"], open: ["closed"] });
      const flagBindings = /* @__PURE__ */ new WeakMap();
      function flag(record, field = "dirty") {
        if (!record) return record;
        const fields = flagBindings.get(record) || /* @__PURE__ */ new Map();
        if (fields.has(field)) return record;
        const dirty = new Dirty(), revision = new Revision();
        dirty.value = !!record[field];
        Object.defineProperty(record, field, { enumerable: true, configurable: false, get: () => dirty.value, set: (value) => {
          dirty.value = value;
          if (value) revision.advance();
        } });
        fields.set(field, { dirty, revision });
        flagBindings.set(record, fields);
        return record;
      }
      function editRevision(record, field = "dirty") {
        return flagBindings.get(record)?.get(field)?.revision.value || 0;
      }
      const framingModel = define("P05.framing", "empty", { empty: ["partial", "closed"], partial: ["empty", "closed"], closed: [] }, ["closed"]);
      const utf8Bytes = (value) => typeof Buffer === "function" ? Buffer.byteLength(value) : new TextEncoder().encode(value).length;
      class Framer {
        constructor({ separator = /\n/, maxBytes = 20 * 1024 * 1024 } = {}) {
          const carry = { "\\n": 0, "\\n\\n": 1, "\\r?\\n\\r?\\n": 3 }[separator.source];
          if (carry === void 0) throw new Error("Unsupported protocol delimiter");
          this.separator = separator;
          this.carryChars = carry;
          this.maxBytes = maxBytes;
          this.parts = [];
          this.partBytes = 0;
          this.tail = "";
          this.pendingBytes = 0;
          this.decoder = new TextDecoder();
          this.lifecycle = create(framingModel);
        }
        get buffer() {
          return this.parts.join("") + this.tail;
        }
        append(fragment) {
          if (!fragment) return;
          const last = this.parts.length - 1;
          if (last >= 0 && this.parts[last].length < 1024) this.parts[last] += fragment;
          else this.parts.push(fragment);
        }
        push(chunk) {
          if (this.lifecycle.terminal) throw new Error("Frame reader is closed");
          const decoded = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
          this.pendingBytes = Math.max(0, this.pendingBytes + (typeof chunk === "string" ? utf8Bytes(chunk) : chunk.byteLength) - utf8Bytes(decoded));
          let text = this.tail + decoded;
          this.tail = "";
          const frames = [];
          let match;
          this.separator.lastIndex = 0;
          while (match = this.separator.exec(text)) {
            const fragment = text.slice(0, match.index);
            if (this.partBytes + utf8Bytes(fragment) > this.maxBytes) throw new Error("Protocol frame exceeds byte budget");
            this.append(fragment);
            frames.push(this.parts.join(""));
            this.parts = [];
            this.partBytes = 0;
            text = text.slice(match.index + match[0].length);
            this.separator.lastIndex = 0;
          }
          let cut = Math.max(0, text.length - this.carryChars);
          if (cut && cut < text.length && /[\uDC00-\uDFFF]/.test(text[cut])) cut--;
          const prefix = text.slice(0, cut);
          this.tail = text.slice(cut);
          if (prefix) {
            this.append(prefix);
            this.partBytes += utf8Bytes(prefix);
          }
          if (this.partBytes + utf8Bytes(this.tail) + this.pendingBytes > this.maxBytes) throw new Error("Protocol frame exceeds byte budget");
          this.lifecycle.to(this.partBytes || this.tail || this.pendingBytes ? "partial" : "empty");
          return frames;
        }
        discard() {
          this.parts = [];
          this.tail = "";
          this.partBytes = this.pendingBytes = 0;
          this.decoder.decode();
          this.lifecycle.to("closed");
        }
        finish() {
          if (this.lifecycle.terminal) return;
          const flushed = this.decoder.decode();
          this.lifecycle.to("closed");
          if (this.partBytes || this.tail || flushed) throw new Error("Stream ended with an incomplete protocol frame");
        }
      }
      const diagnosticsModel = define("UI.diagnostics-view", "activity", { activity: ["traces", "coverage"], traces: ["activity", "coverage"], coverage: ["activity", "traces"] });
      const projectContextScopeModel = define("UI.project-context-scope", "task", { task: ["project"], project: ["task"] });
      const models = Object.freeze({ projectContextScope: projectContextScopeModel, diagnostics: diagnosticsModel, pending: pendingModel, dirty: dirtyModel, activity: activityModel, selection: selectionModel, disclosure: disclosureModel, framing: framingModel });
      return { define, create, bind, next, assertState, observe, Revision, Pending, Dirty, Draft, Activity, Selection, disclosureModel, flag, editRevision, Framer, models };
    });
  }
});

// lib/state-machine.js
var require_state_machine2 = __commonJS({
  "lib/state-machine.js"(exports2, module2) {
    module2.exports = require_state_machine();
  }
});

// lib/lifecycles.js
var require_lifecycles = __commonJS({
  "lib/lifecycles.js"(exports2, module2) {
    var { define } = require_state_machine2();
    var execution = define("SM01.execution", "queued", {
      queued: ["running", "cancelling", "draining", "failed", "cancelled", "interrupted"],
      running: ["cancelling", "draining", "done", "failed", "interrupted"],
      cancelling: ["draining", "cancelled", "interrupted"],
      draining: ["cancelling", "done", "failed", "cancelled", "interrupted"],
      done: [],
      failed: [],
      cancelled: [],
      interrupted: []
    }, ["done", "failed", "cancelled", "interrupted"]);
    var job = define("SM02.job", "running", {
      queued: ["running", "cancelled", "interrupted"],
      running: ["done", "failed", "cancelled", "interrupted"],
      cancelling: ["cancelled", "interrupted"],
      draining: ["done", "failed", "cancelled", "interrupted"],
      done: [],
      failed: [],
      cancelled: [],
      interrupted: []
    }, ["done", "failed", "cancelled", "interrupted"]);
    var admission = define("SM04.admission", "queued", {
      queued: ["running", "cancelled"],
      running: ["fulfilled", "rejected"],
      fulfilled: [],
      rejected: [],
      cancelled: []
    }, ["fulfilled", "rejected", "cancelled"]);
    var worker = define("SM06.worker", "idle", {
      idle: ["busy", "stopping", "stopped"],
      busy: ["idle", "stopping", "stopped"],
      stopping: ["stopped"],
      stopped: []
    }, ["stopped"]);
    var session = define("SM07.session", "idle", { idle: ["running"], running: ["idle"] });
    var sandbox = define("SM07.sandbox", "absent", { absent: ["alive"], alive: ["absent"] });
    var cell = define("SM08.cell", "queued", { queued: ["done", "failed", "cancelled"], done: [], failed: [], cancelled: [] }, ["done", "failed", "cancelled"]);
    var settlement = define("SM09.settlement", "pending", { pending: ["settled"], settled: [] }, ["settled"]);
    var process2 = define("SM03.process", "running", { running: ["terminating", "exited"], terminating: ["killing", "exited"], killing: ["exited"], exited: [] }, ["exited"]);
    var span = define("SM03.span", "running", { running: ["succeeded", "failed"], succeeded: [], failed: [] }, ["succeeded", "failed"]);
    var networkAdmission = define("SM05.network-admission", "eligible", { eligible: ["reserved"], reserved: ["waiting", "admitted", "cancelled"], waiting: ["admitted", "cancelled"], admitted: [], cancelled: [] }, ["admitted", "cancelled"]);
    var runnerRequest = define("SM10.request", "requesting", { requesting: ["streaming", "failed"], streaming: ["completed", "failed"], completed: [], failed: [] }, ["completed", "failed"]);
    var circuit = define("SM10.endpoint", "available", { available: ["cooldown"], cooldown: ["available"] });
    var store = define("SM11.store", "cold", { cold: ["starting", "ready", "closed"], starting: ["ready", "failed", "closed"], ready: ["failed", "closed"], failed: ["starting", "closed"], closed: [] }, ["closed"]);
    var storeClose = define("SM11.close", "open", { open: ["flushing"], flushing: ["closing", "closed", "open"], closing: ["closed", "open"], closed: [] }, ["closed"]);
    var writer = define("SM12.writer", "idle", { idle: ["writing"], writing: ["idle", "failed"], failed: ["writing"] });
    var config = define("SM14.config", "cold", { cold: ["stale", "validating"], stale: ["validating"], validating: ["ready", "rejected"], ready: ["stale"], rejected: ["stale", "validating"] });
    var registry = define("SM15.registry", "missing", { missing: ["building"], active: ["building"], building: ["active", "superseded", "rejected"], superseded: ["building", "rejected"], rejected: [] }, ["rejected"]);
    var transaction = define("SM20.transaction", "opening", { opening: ["reading", "rolled-back", "cancelled"], reading: ["committed", "rolled-back", "cancelled"], committed: [], "rolled-back": [], cancelled: [] }, ["committed", "rolled-back", "cancelled"]);
    var scratch = define("SM22.scratch-resource", "creating", { creating: ["ready", "failed", "cleanup-failed", "deleted"], ready: ["frozen", "cleanup-failed", "deleted"], frozen: ["cleanup-failed", "deleted"], failed: ["cleanup-failed", "deleted"], "cleanup-failed": ["deleted"], deleted: [] }, ["deleted"]);
    var template = define("SM23.template", "building", { building: ["ready", "failed", "invalid", "deleted"], ready: ["invalid", "deleted"], failed: ["invalid", "deleted"], invalid: ["deleted"], deleted: [] }, ["deleted"]);
    var lease = define("SM24.lease", "creating", { creating: ["active", "released", "cleanup-failed"], active: ["released", "cleanup-failed"], "cleanup-failed": ["released"], released: [] }, ["released"]);
    var leaseReset = define("SM25.reset", "allocating", { allocating: ["replacement-ready", "failed"], "replacement-ready": ["releasing-old", "compensating"], "releasing-old": ["completed", "compensating"], compensating: ["failed", "cleanup-failed"], completed: [], failed: [], "cleanup-failed": [] }, ["completed", "failed", "cleanup-failed"]);
    var publication = define("SM41.publication", "checking", { checking: ["reused", "staging", "aborted"], staging: ["verified", "aborted"], verified: ["committed", "aborted"], committed: ["published", "alias-failed"], reused: ["published", "alias-failed"], published: [], aborted: [], "alias-failed": [] }, ["published", "aborted", "alias-failed"]);
    var edgeSnapshot = define("SM55.edge-snapshot", "missing", { missing: ["valid", "invalid", "removed"], valid: ["valid", "stale", "removed"], stale: ["valid", "stale", "removed"], invalid: ["valid", "invalid", "removed"], removed: [] }, ["removed"]);
    var catalogWriter = define("SM42.catalog-writer", "open", { open: ["flushing", "aborted"], flushing: ["synced", "aborted"], synced: ["published", "aborted"], published: [], aborted: [] }, ["published", "aborted"]);
    var descriptor = define("P01.descriptor", "open", { open: ["closed"], closed: [] }, ["closed"]);
    var handshake = define("SM18.handshake", "disconnected", {
      disconnected: ["initializing", "closing"],
      initializing: ["ready", "disconnected", "closing"],
      ready: ["closing"],
      closing: ["disconnected"]
    });
    var fixture = define("SM26.fixture", "starting", { starting: ["ready", "cleanup-failed", "stopped"], ready: ["cleanup-failed", "stopped"], "cleanup-failed": ["stopped"], stopped: [] }, ["stopped"]);
    var scenario = define("SM28.scenario", "starting", { starting: ["ready", "failed", "stopped"], ready: ["failed", "stopped"], failed: ["stopped"], stopped: [] }, ["stopped"]);
    var collection = define("SM35.collection", "running", { running: ["passed", "failed", "cancelled"], passed: [], failed: [], cancelled: [] }, ["passed", "failed", "cancelled"]);
    var semantic = define("SM45.semantic", "uploading", {
      uploading: ["queued", "failed", "interrupted"],
      queued: ["parsing", "querying", "cancelling", "failed", "cancelled", "interrupted"],
      parsing: ["enriching", "cancelling", "failed", "cancelled", "interrupted"],
      enriching: ["ready", "cancelling", "failed", "cancelled", "interrupted"],
      querying: ["ready", "cancelling", "failed", "cancelled", "interrupted"],
      cancelling: ["cancelled", "failed", "interrupted"],
      draining: ["ready", "cancelled", "failed", "interrupted"],
      ready: [],
      failed: [],
      cancelled: [],
      interrupted: []
    }, ["ready", "failed", "cancelled", "interrupted"]);
    var sftp = define("SM19.sftp", "connecting", { connecting: ["opening", "closing", "failed", "closed"], opening: ["ready", "closing", "failed", "closed"], ready: ["closing", "failed", "closed"], closing: ["failed", "closed"], failed: ["closing", "closed"], closed: [] }, ["closed"]);
    var sftpOperation = define("SM19.operation", "pending", { pending: ["settled"], settled: [] }, ["settled"]);
    var control = define("SM21.control", "opening", { opening: ["locked", "failed"], locked: ["initializing", "verifying", "failed"], initializing: ["verifying", "failed"], verifying: ["ready", "failed"], ready: ["releasing", "failed"], failed: ["releasing"], releasing: ["closed", "cleanup-failed"], closed: [], "cleanup-failed": [] }, ["closed", "cleanup-failed"]);
    var archive = define("SM54.archive", "checking", { checking: ["copied", "archived", "failed"], copied: ["verified", "failed"], verified: ["removing"], removing: ["archived", "source-retained", "recovery-needed"], archived: [], failed: [], "source-retained": [], "recovery-needed": [] }, ["archived", "failed", "source-retained", "recovery-needed"]);
    var archiveRemoval = define("SM54.source-removal", "source", { source: ["holding", "removed"], holding: ["verified", "restoring"], verified: ["removed", "restoring"], restoring: ["restored", "recovery-needed"], removed: [], restored: [], "recovery-needed": [] }, ["removed", "restored", "recovery-needed"]);
    var contextArchive = define("SM54.context-archive", "checking", { checking: ["renamed"], renamed: ["published", "restoring"], restoring: ["restored", "recovery-needed"], published: [], restored: [], "recovery-needed": [] }, ["published", "restored", "recovery-needed"]);
    var context = define("SM53.context", "active", { active: ["paused", "done"], paused: ["active", "done"], done: ["active", "paused"] });
    var captureCall = define("SM51.capture-call", "invoking", { invoking: ["succeeded", "failed"], succeeded: ["saving"], failed: ["saving"], saving: ["saved", "save-failed"], saved: [], "save-failed": [] }, ["saved", "save-failed"]);
    var pit = define("SM75.pit", "opening", { opening: ["open"], open: ["reading", "closing"], reading: ["closing"], closing: ["closed", "close-failed"], closed: [], "close-failed": [] }, ["closed", "close-failed"]);
    var identity = define("SM16.identity", "unverified", { unverified: ["authenticated", "rejected"], authenticated: ["scoped", "rejected"], scoped: [], rejected: [] }, ["scoped", "rejected"]);
    var mcp = define("SM17.request", "running", { running: ["cancelling", "replied", "closed"], cancelling: ["replied", "closed"], replied: ["closed"], closed: [] }, ["closed"]);
    var effects = define("SM27.effects", "unarmed", { unarmed: ["arming"], arming: ["armed", "rejected"], armed: ["observing"], observing: ["checked", "failed"], checked: [], rejected: [], failed: [] }, ["checked", "rejected", "failed"]);
    var action = define("SM29.action", "reserved", { reserved: ["executing"], executing: ["completed", "unknown"], completed: [], unknown: [] }, ["completed", "unknown"]);
    var quietWindow = define("SM30.quiet-window", "sampling", { sampling: ["quiet", "timed-out", "cancelled", "failed"], quiet: ["sampling", "stable", "timed-out", "cancelled", "failed"], stable: [], "timed-out": [], cancelled: [], failed: [] }, ["stable", "timed-out", "cancelled", "failed"]);
    var semanticPublication = define("SM46.publication", "checking", { checking: ["reused", "staging"], staging: ["accepted", "compensating"], accepted: ["waiting", "compensating"], waiting: ["downloading", "compensating"], downloading: ["verified", "compensating"], verified: ["committed", "compensating"], committed: ["published", "superseded", "alias-failed"], reused: [], published: [], superseded: [], "alias-failed": [], compensating: ["aborted", "cleanup-failed"], aborted: [], "cleanup-failed": [] }, ["reused", "published", "superseded", "alias-failed", "aborted", "cleanup-failed"]);
    var knowledgeRefresh = define("SM49.refresh", "reading", { reading: ["unchanged", "writing", "failed"], writing: ["updated", "failed"], unchanged: [], updated: [], failed: [] }, ["unchanged", "updated", "failed"]);
    var observation = define("SM50.observation", "refreshing", { refreshing: ["fresh", "stale", "missing"], fresh: [], stale: [], missing: [] }, ["fresh", "stale", "missing"]);
    var preparation = define("SM40.preparation", "queued", { queued: ["running"], running: ["ready", "failed"], ready: [], failed: [] }, ["ready", "failed"]);
    var mavenPrepare = define("SM39.maven-prepare", "checking", { checking: ["reused", "building"], building: ["classpath", "failed"], classpath: ["launcher", "failed"], launcher: ["publishing", "failed"], publishing: ["ready", "failed"], reused: [], ready: [], failed: [] }, ["reused", "ready", "failed"]);
    var deepQuery = define("SM47.deep-query", "checking", { checking: ["reused", "submitting", "failed"], submitting: ["waiting", "compensating"], waiting: ["reading", "compensating"], reading: ["saving", "compensating"], saving: ["ready", "compensating"], ready: [], reused: [], failed: [], compensating: ["failed", "cleanup-failed"], "cleanup-failed": [] }, ["reused", "ready", "failed", "cleanup-failed"]);
    var adapter = define("SM76.adapter", "prepared", { prepared: ["sending"], sending: ["reading", "unknown"], reading: ["verified", "unknown"], verified: ["succeeded", "rejected"], succeeded: [], rejected: [], unknown: [] }, ["succeeded", "rejected", "unknown"]);
    var capture = define("SM31.capture", "planned", { planned: ["reading"], reading: ["validating", "failed"], validating: ["complete", "incomplete", "failed"], complete: [], incomplete: [], failed: [] }, ["complete", "incomplete", "failed"]);
    var scenarioState = define("SM32.binding", "planned", { planned: ["missing", "reading"], reading: ["captured", "partial", "failed"], missing: [], captured: [], partial: [], failed: [] }, ["missing", "captured", "partial", "failed"]);
    var script = define("SM33.script", "before", { before: ["steps", "cleaning"], steps: ["after", "cleaning"], after: ["cleaning"], cleaning: ["settled"], settled: [] }, ["settled"]);
    var retry = define("SM34.retry", "ready", { ready: ["attempting"], attempting: ["matched", "waiting", "stopped"], waiting: ["attempting", "stopped"], matched: [], stopped: [] }, ["matched", "stopped"]);
    var gitFetch = define("SM36.fetch", "initializing", { initializing: ["fetching", "failed"], fetching: ["checking-out", "repairing", "fallback", "failed"], repairing: ["fetching", "fallback", "failed"], fallback: ["checking-out", "failed"], "checking-out": ["recording", "fallback", "failed"], recording: ["ready", "failed"], ready: [], failed: [] }, ["ready", "failed"]);
    var workspacePush = define("SM37.push", "checking", { checking: ["staging", "failed"], staging: ["committing", "failed"], committing: ["committed", "failed"], committed: ["replaying", "pushing", "failed"], replaying: ["replayed", "conflict", "failed"], replayed: ["pushing", "failed"], pushing: ["pushed", "unknown"], pushed: ["recording", "metadata-failed"], recording: ["completed", "metadata-failed"], completed: [], failed: [], conflict: [], unknown: [], "metadata-failed": [] }, ["completed", "failed", "conflict", "unknown", "metadata-failed"]);
    var refresh = define("SM43.refresh", "sources", { sources: ["indexing", "failed"], indexing: ["ready", "failed"], ready: [], failed: [] }, ["ready", "failed"]);
    var passport = define("SM44.passport", "resolving", { resolving: ["fetching", "failed"], fetching: ["extracting", "failed"], extracting: ["libraries", "failed"], libraries: ["analyzing", "failed"], analyzing: ["publishing", "failed"], publishing: ["ready", "failed"], ready: [], failed: [] }, ["ready", "failed"]);
    var realm = define("SM78.program", "prepared", { prepared: ["executing", "rejected"], executing: ["settled", "failed"], settled: [], rejected: [], failed: [] }, ["settled", "rejected", "failed"]);
    var http = define("SM76.http", "sending", { sending: ["reading", "failed"], reading: ["completed", "failed"], completed: [], failed: [] }, ["completed", "failed"]);
    var migration = define("SM13.migration", "new", { new: ["reading"], reading: ["paused", "complete"], paused: ["reading"], complete: ["reading"] });
    var testInvocation = define("SM38.invocation", "running", { running: ["settled", "failed"], settled: [], failed: [] }, ["settled", "failed"]);
    var testProof = define("SM38.proof-evidence", "no-red", { "no-red": ["red-seen"], "red-seen": ["changed-green-seen"], "changed-green-seen": [] }, ["changed-green-seen"]);
    var generatedResource = define("SM52.generated-resource", "checking", { checking: ["retained", "preview", "writing"], writing: ["written", "failed"], retained: [], preview: [], written: [], failed: [] }, ["retained", "preview", "written", "failed"]);
    var searchBackend = define("SM77.backend", "unknown", { unknown: ["available", "unavailable"], available: ["unavailable"], unavailable: [] }, ["unavailable"]);
    var revisionModel = (name) => define(name, "checking", { checking: ["locked", "checked", "failed"], locked: ["checked", "failed"], checked: ["revision-written", "head-written", "failed"], "revision-written": ["head-written", "failed"], "head-written": ["completed", "failed"], completed: [], failed: [] }, ["completed", "failed"]);
    var passportEdit = revisionModel("SM55.passport-edit");
    var mapEdit = revisionModel("SM56.map-edit");
    var architectureEdit = revisionModel("SM57.architecture-edit");
    var definition = define("SM58.definition", "checking", { checking: ["custom", "builtin", "missing"], custom: [], builtin: [], missing: [] }, ["custom", "builtin", "missing"]);
    var apiReplay = define("SM59.replay", "prepared", { prepared: ["sending"], sending: ["received", "unknown"], received: ["saved", "save-failed"], saved: [], unknown: [], "save-failed": [] }, ["saved", "unknown", "save-failed"]);
    var browserLease = define("SM60.browser-lease", "opening", { opening: ["ready", "failed"], ready: ["capturing", "expired", "closing"], capturing: ["ready", "expired", "closing"], expired: ["closing"], failed: ["closing"], closing: ["closed"], closed: [] }, ["closed"]);
    var result = define("SM61.result", "allocating", { allocating: ["serialized", "failed"], serialized: ["stored", "failed"], stored: [], failed: [] }, ["stored", "failed"]);
    var sourceSpan = define("P03.source-span", "code", { code: ["quoted", "text-block", "line-comment", "block-comment", "done"], quoted: ["code"], "text-block": ["code"], "line-comment": ["code"], "block-comment": ["code"], done: [] }, ["done"]);
    var reportFile = define("P06.report-file", "clean", { clean: ["failed"], failed: [] }, ["failed"]);
    var markup = define("P07.markup-stack", "root", { root: ["nested"], nested: ["root"] });
    var traversal = define("P08.traversal", "searching", { searching: ["found", "exhausted", "truncated"], found: [], exhausted: [], truncated: [] }, ["found", "exhausted", "truncated"]);
    var enumeration = define("P09.enumeration", "available", { available: ["exhausted"], exhausted: [] }, ["exhausted"]);
    var compiler = define("SM40.compiler", "starting", { starting: ["ready", "stopped"], ready: ["stopping", "stopped"], stopping: ["stopped"], stopped: [] }, ["stopped"]);
    var docsRefresh = define("SM48.refresh", "listing", { listing: ["pages", "failed"], pages: ["reconciling", "failed"], reconciling: ["watermark", "partial", "failed"], watermark: ["current", "failed"], current: [], partial: [], failed: [] }, ["current", "partial", "failed"]);
    var starter = define("SM58.starter", "checking", { checking: ["retained", "copying"], copying: ["copied"], retained: [], copied: [] }, ["retained", "copied"]);
    var bundle = define("SM74.bundle", "bundling", { bundling: ["collecting"], collecting: ["comparing"], comparing: ["verified", "stale", "writing"], writing: ["written"], verified: [], stale: [], written: [] }, ["verified", "stale", "written"]);
    var configMigration = define("SM74.config-migration", "planning", { planning: ["preview", "staging"], staging: ["secrets-published", "compensating"], "secrets-published": ["config-published", "compensating"], "config-published": ["ready", "compensating"], compensating: ["rolled-back", "cleanup-failed"], preview: [], ready: [], "rolled-back": [], "cleanup-failed": [] }, ["preview", "ready", "rolled-back", "cleanup-failed"]);
    var diagnosticStore = define("SM79.diagnostic-store", "cold", { cold: ["starting", "closed", "failed"], starting: ["ready", "failed", "closed"], ready: ["failed", "closed"], failed: ["closed"], closed: [] }, ["closed"]);
    var projectContextPublication = define("SM80.project-context-publication", "draft", { draft: ["locked"], locked: ["checked", "failed"], checked: ["files-written", "failed"], "files-written": ["revision-written", "failed"], "revision-written": ["published", "failed"], published: [], failed: [] }, ["published", "failed"]);
    var ciWait = define("SM81.ci-wait", "checking", { checking: ["sleeping", "complete", "pending", "cancelled", "failed"], sleeping: ["checking", "pending", "cancelled", "failed"], complete: [], pending: [], cancelled: [], failed: [] }, ["complete", "pending", "cancelled", "failed"]);
    module2.exports = { ciWait, projectContextPublication, diagnosticStore, bundle, configMigration, starter, docsRefresh, compiler, execution, job, admission, worker, session, sandbox, cell, settlement, process: process2, span, networkAdmission, runnerRequest, circuit, store, storeClose, writer, config, registry, transaction, scratch, template, lease, leaseReset, publication, edgeSnapshot, catalogWriter, descriptor, handshake, fixture, scenario, collection, semantic, sftp, sftpOperation, control, archive, archiveRemoval, contextArchive, context, captureCall, pit, identity, mcp, effects, action, quietWindow, semanticPublication, knowledgeRefresh, observation, preparation, mavenPrepare, deepQuery, adapter, capture, scenarioState, script, retry, gitFetch, workspacePush, refresh, passport, realm, http, migration, testInvocation, testProof, generatedResource, searchBackend, passportEdit, mapEdit, architectureEdit, definition, apiReplay, browserLease, result, sourceSpan, reportFile, markup, traversal, enumeration };
  }
});

// lib/state-worker.js
var { parentPort, workerData } = require("worker_threads");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var { DatabaseSync } = require("node:sqlite");
var options = workerData;
var db;
var closed = false;
var statements = /* @__PURE__ */ new Map();
var status = { backend: "sqlite", schemaVersion: 1, journalMode: "wal", durability: "FULL", imported: {}, malformedImports: 0, oversizedImports: 0, retentionDeleted: 0, lastCommitAt: null, lastError: null };
var kinds = /* @__PURE__ */ new Set(["calls", "jobs", "executions"]);
var stmt = (sql) => {
  if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
  return statements.get(sql);
};
var legacyOwner = options.legacyOwner;
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
var publicRow = (row) => row ? { kind: row.kind, id: row.id, revision: row.revision, updatedAt: row.updated_at, owner: parsed(row.owner), value: { ...parsed(row.payload), ...row.annotations !== "{}" ? { metadata: parsed(row.annotations) } : {} }, editable: ["label", "notes", "tags"], cursor: String(row.seq) } : null;
function begin(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    status.lastCommitAt = now();
    status.lastError = null;
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}
function put({ kind, id, value, owner }) {
  if (!kinds.has(kind) || typeof id !== "string" || !owner?.scopeKey) throw new Error("invalid operational metadata");
  if (kind === "calls" && value.evidence?.job?.id) {
    const row = stmt("SELECT payload FROM records WHERE kind='jobs' AND scope=? AND id=?").get(owner.scopeKey, value.evidence.job.id);
    if (row) value = { ...value, evidence: require_call_evidence().classify(value.target || value.tool, null, { invocation: value.evidence.invocation, traceId: value.evidence.traceId, job: parsed(row.payload) }) };
  }
  const payload = JSON.stringify(value), existing = stmt("SELECT revision, annotations FROM records WHERE kind=? AND scope=? AND id=?").get(kind, owner.scopeKey, id);
  const evidence = value.evidence || {}, revision = (existing?.revision || 0) + 1;
  const updatedAt = now(), at = value.at || value.startedAt || updatedAt;
  const state = evidence.execution?.status || evidence.invocation || value.state || "";
  const failed = evidence.failed === true || value.ok === false || require_call_evidence().FAILED.has(value.state) || require_call_evidence().FAILED.has(value.result?.outcome || value.resultSummary?.outcome);
  stmt(`INSERT INTO records(kind,id,scope,owner,at,updated_at,revision,tool,source,state,category,failed,job_id,payload,annotations)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,scope,id) DO UPDATE SET owner=excluded.owner,
    updated_at=excluded.updated_at,revision=excluded.revision,tool=excluded.tool,source=excluded.source,state=excluded.state,
    category=excluded.category,failed=excluded.failed,job_id=excluded.job_id,payload=excluded.payload`).run(
    kind,
    id,
    owner.scopeKey,
    JSON.stringify(owner),
    at,
    updatedAt,
    revision,
    value.tool || "",
    value.source || "",
    state,
    evidence.execution?.kind || value.kind || "",
    failed ? 1 : 0,
    evidence.job?.id || "",
    payload,
    existing?.annotations || "{}"
  );
  if (kind === "jobs") reconcileCalls(id, owner.scopeKey, value);
}
function reconcileCalls(id, scope, job) {
  const { classify } = require_call_evidence();
  for (const row of stmt("SELECT id,payload FROM records WHERE kind='calls' AND scope=? AND job_id=?").all(scope, id)) {
    const value = parsed(row.payload);
    if (!value?.evidence) continue;
    value.evidence = classify(value.target || value.tool, null, { invocation: value.evidence.invocation, traceId: value.evidence.traceId, job });
    stmt("UPDATE records SET payload=?,state=?,category=?,failed=?,revision=revision+1,updated_at=? WHERE kind='calls' AND scope=? AND id=?").run(JSON.stringify(value), value.evidence.execution?.status || value.evidence.invocation || "", value.evidence.execution?.kind || "", value.evidence.failed ? 1 : 0, now(), scope, row.id);
  }
}
function retain() {
  for (const kind of kinds) {
    const keep = options.retention[kind];
    status.retentionDeleted += Number(stmt(`DELETE FROM records WHERE seq IN (SELECT seq FROM (
      SELECT seq,ROW_NUMBER() OVER (PARTITION BY scope ORDER BY seq DESC) AS rn FROM records WHERE kind=?) WHERE rn>?)`).run(kind, keep).changes);
  }
  status.retentionDeleted += Number(stmt(`DELETE FROM records WHERE seq IN (SELECT seq FROM (
    SELECT seq,SUM(length(CAST(payload AS BLOB))) OVER (PARTITION BY scope ORDER BY seq DESC) AS bytes
    FROM records WHERE kind='calls') WHERE bytes>?)`).run(options.callBytes).changes);
}
function projection() {
  const records = [];
  let bytes = 0;
  for (const kind of kinds) {
    let before = Number.MAX_SAFE_INTEGER, count = 0;
    while (count < options.projectionLimit) {
      const rows = stmt("SELECT * FROM records WHERE kind=? AND seq<? ORDER BY seq DESC LIMIT ?").all(kind, before, Math.min(64, options.projectionLimit - count));
      if (!rows.length) break;
      let accepted = 0;
      for (const row of rows) {
        const size = Buffer.byteLength(row.payload) + Buffer.byteLength(row.annotations) + 400;
        if (bytes + size > options.projectionBytes) break;
        records.push(publicRow(row));
        bytes += size;
        count++;
        accepted++;
      }
      if (accepted < rows.length || bytes >= options.projectionBytes) break;
      before = rows[rows.length - 1].seq;
      if (rows.length < 64) break;
    }
  }
  const document = { version: 1, backend: "sqlite", writtenAt: now(), records };
  const temporary = `${options.projection}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(document), { mode: 384 });
    fs.renameSync(temporary, options.projection);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
    }
    status.projectionError = error.message;
  }
  return document.records;
}
function migrationCursor(key) {
  return parsed(stmt("SELECT value FROM migrations WHERE id=?").get(key)?.value) || { offset: 0, lines: 0 };
}
function saveCursor(key, value) {
  const prior = migrationCursor(key), model = require_lifecycles().migration;
  const lifecycle = require_state_machine2().create(model, prior.state || "new");
  lifecycle.to("reading");
  lifecycle.to(value.complete ? "complete" : "paused");
  stmt("INSERT INTO migrations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(key, JSON.stringify({ ...value, state: lifecycle.state }));
}
async function importCalls(file, importOwner = legacyOwner) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return;
  }
  const key = `jsonl:${path.resolve(file)}:${stat.dev}:${stat.ino}`, prior = migrationCursor(key);
  if (prior.offset > stat.size) {
    status.imported.calls = { complete: false, error: "legacy source was truncated; retained imported records" };
    return;
  }
  let offset = prior.offset, lines = prior.lines, batch = [];
  const flush = () => {
    if (!batch.length) return;
    begin(() => {
      for (const row of batch) put(row);
      saveCursor(key, { offset, lines });
    });
    batch = [];
  };
  const input = fs.createReadStream(file, { start: prior.offset, end: Math.max(prior.offset, stat.size - 1) });
  let parts = [], size = 0, oversized = false;
  const consume = (chunk, terminated) => {
    size += chunk.length;
    if (!oversized && size <= options.maxRecordBytes) parts.push(chunk);
    else {
      oversized = true;
      parts = [];
    }
    if (!terminated) return;
    const lineOffset = offset;
    offset += size + 1;
    lines++;
    if (oversized) status.oversizedImports++;
    else {
      const line = Buffer.concat(parts).toString("utf8").replace(/\r$/, ""), value = parsed(line);
      if (value && typeof value.tool === "string") batch.push({ kind: "calls", id: `legacy:${crypto.createHash("sha256").update(`${path.resolve(file)}:${lineOffset}:${line}`).digest("hex").slice(0, 32)}`, value, owner: importOwner });
      else if (line.trim()) status.malformedImports++;
    }
    parts = [];
    size = 0;
    oversized = false;
    if (batch.length >= options.batchSize) flush();
  };
  try {
    for await (const chunk of input) {
      let start = 0, newline;
      while ((newline = chunk.indexOf(10, start)) >= 0) {
        consume(chunk.subarray(start, newline), true);
        start = newline + 1;
      }
      if (start < chunk.length) consume(chunk.subarray(start), false);
    }
    flush();
    begin(() => saveCursor(key, { offset, lines }));
    status.imported.calls = { complete: offset === stat.size, lines, offset, pendingBytes: stat.size - offset };
  } finally {
    input.destroy();
  }
}
function importJobs(file, importOwner = legacyOwner) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return;
  }
  const key = `jobs:${path.resolve(file)}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (migrationCursor(key).complete) return;
  if (stat.size > 16 * 1048576) {
    status.imported.jobs = { complete: false, error: "legacy jobs exceed 16 MiB; export and import bounded metadata" };
    return;
  }
  const values = parsed(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(values)) {
    status.imported.jobs = { complete: false, error: "legacy jobs are not a JSON array" };
    return;
  }
  for (let index = 0; index < values.length; index += options.batchSize) begin(() => {
    for (const value of values.slice(index, index + options.batchSize)) {
      if (!value?.id || Buffer.byteLength(JSON.stringify(value)) > options.maxRecordBytes) continue;
      const recovered = ["running", "queued", "cancelling", "draining"].includes(value.state) ? { ...value, state: require_state_machine2().next(require_lifecycles().job, value.state, "interrupted"), error: value.error || "server restarted; operation was not replayed" } : value;
      if (!stmt("SELECT 1 FROM records WHERE kind='jobs' AND scope=? AND id=?").get(importOwner.scopeKey, value.id)) put({ kind: "jobs", id: value.id, value: recovered, owner: importOwner });
    }
  });
  begin(() => saveCursor(key, { complete: true, count: values.length }));
  status.imported.jobs = { complete: true, count: values.length };
}
async function importScopedLegacy() {
  let directories;
  try {
    directories = fs.readdirSync(options.legacyScopes, { withFileTypes: true });
  } catch {
    return;
  }
  let imported = 0;
  for (const entry of directories) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
    const directory = path.join(options.legacyScopes, entry.name), file = path.join(directory, "_owner.json");
    let owner;
    try {
      if (fs.statSync(file).size > 2048) continue;
      owner = parsed(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!owner || !/^[a-zA-Z0-9][\w.:-]{0,159}$/.test(owner.principalId) || !/^[a-zA-Z0-9][\w.:-]{0,159}$/.test(owner.storyId)) continue;
    const expected = crypto.createHash("sha256").update(owner.principalId + "\0" + owner.storyId).digest("hex").slice(0, 32);
    if (expected !== entry.name || owner.scopeKey !== expected) continue;
    const importedOwner = { principalId: owner.principalId, storyId: owner.storyId, scopeKey: expected, role: owner.role === "admin" ? "admin" : "user", multiUser: owner.multiUser === true };
    await importCalls(path.join(directory, "_calls.jsonl"), importedOwner);
    importJobs(path.join(directory, "_jobs.json"), importedOwner);
    imported++;
  }
  status.imported.scopes = imported;
}
async function init() {
  fs.mkdirSync(path.dirname(options.file), { recursive: true, mode: 448 });
  db = new DatabaseSync(options.file);
  fs.chmodSync(options.file, 384);
  db.exec("PRAGMA busy_timeout=2000;");
  const bootstrap = async (fn) => {
    const deadline = Date.now() + 6e3;
    for (; ; ) {
      try {
        return fn();
      } catch (error) {
        if (![5, 6].includes(Number(error.errcode) & 255) || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  };
  await bootstrap(() => db.exec("PRAGMA journal_mode=WAL;"));
  db.exec("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
  await bootstrap(() => begin(() => {
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) throw new Error(`operational state schema ${version} is newer than supported schema 1`);
    db.exec(`CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL,owner TEXT NOT NULL,
    at TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL,tool TEXT NOT NULL,source TEXT NOT NULL,
    state TEXT NOT NULL,category TEXT NOT NULL,failed INTEGER NOT NULL,job_id TEXT NOT NULL,payload TEXT NOT NULL,
    annotations TEXT NOT NULL DEFAULT '{}',UNIQUE(kind,scope,id));
    CREATE INDEX IF NOT EXISTS records_scope_page ON records(kind,scope,seq DESC);
    CREATE INDEX IF NOT EXISTS records_scope_tool ON records(kind,scope,tool,seq DESC);
    CREATE INDEX IF NOT EXISTS records_scope_status ON records(kind,scope,state,failed,seq DESC);
    CREATE INDEX IF NOT EXISTS records_scope_job ON records(kind,scope,job_id);
    CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    PRAGMA user_version=1;`);
  }));
  await importCalls(options.legacyCalls);
  importJobs(options.legacyJobs);
  await importScopedLegacy();
  begin(() => {
    retain();
  });
  begin(() => {
    for (const row of stmt("SELECT * FROM records WHERE kind IN ('jobs','executions') AND state IN ('queued','running','cancelling','draining')").all()) {
      const value = parsed(row.payload);
      value.state = require_state_machine2().next(require_lifecycles()[row.kind === "jobs" ? "job" : "execution"], value.state, "interrupted");
      value.error ||= "server restarted; operation was not replayed";
      let live = false;
      if (value.processId) {
        try {
          process.kill(value.processId, 0);
          live = true;
        } catch (error) {
          live = error.code === "EPERM";
        }
      }
      if (!live) put({ kind: row.kind, id: row.id, value, owner: parsed(row.owner) });
    }
  });
  return { records: projection(), status: stats() };
}
function whereFor(query, owner) {
  const filters = ["kind=?", "scope=?"], args = [query.kind, owner.scopeKey];
  for (const [name, column] of [["tool", "tool"], ["category", "category"]]) if (query[name]) {
    filters.push(`${column}=?`);
    args.push(query[name]);
  }
  if (query.status) {
    filters.push(query.kind === "calls" ? "(state=? OR json_extract(payload,'$.evidence.invocation')=?)" : "state=?");
    args.push(query.status);
    if (query.kind === "calls") args.push(query.status);
  }
  if (query.source === "direct") filters.push("source NOT LIKE 'script:%'");
  else if (query.source) {
    filters.push("source=?");
    args.push(query.source);
  }
  if (query.failed === true) filters.push("failed=1");
  if (query.before) {
    filters.push("seq<?");
    args.push(Number(query.before));
  }
  if (query.q) for (const word of String(query.q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10)) {
    filters.push("lower(tool||' '||source||' '||payload||' '||annotations) LIKE ? ESCAPE '\\'");
    args.push(`%${word.replace(/[\\%_]/g, "\\$&")}%`);
  }
  return { sql: filters.join(" AND "), args };
}
function list(query, owner) {
  if (!kinds.has(query.kind)) throw new Error("metadata kind must be calls, jobs, or executions");
  const { sql, args } = whereFor(query, owner), limit = Math.max(1, Math.min(500, Number(query.limit) || 100));
  const rows = [];
  let before = Number.MAX_SAFE_INTEGER, bytes = 0, more = false;
  while (rows.length <= limit) {
    const page = stmt(`SELECT * FROM records WHERE ${sql} AND seq<? ORDER BY seq DESC LIMIT ?`).all(...args, before, Math.min(32, limit - rows.length + 1));
    if (!page.length) break;
    let accepted = 0;
    for (const row of page) {
      const size = Buffer.byteLength(row.payload) + Buffer.byteLength(row.annotations) + 400;
      if (rows.length >= limit || bytes + size > 4 * 1048576) {
        more = true;
        break;
      }
      rows.push(row);
      bytes += size;
      accepted++;
    }
    if (more || accepted < page.length) break;
    before = page[page.length - 1].seq;
    if (page.length < 32) break;
  }
  return { records: rows.map(publicRow), total: stmt(`SELECT count(*) AS n FROM records WHERE ${sql}`).get(...args).n, nextCursor: more && rows.length ? String(rows[rows.length - 1].seq) : null };
}
function get(kind, id, owner) {
  return publicRow(stmt("SELECT * FROM records WHERE kind=? AND scope=? AND id=?").get(kind, owner.scopeKey, id));
}
function edit({ kind, id, patch, expectedRevision }, owner) {
  return begin(() => {
    const row = stmt("SELECT * FROM records WHERE kind=? AND scope=? AND id=?").get(kind, owner.scopeKey, id);
    if (!row) throw Object.assign(new Error("metadata record not found"), { code: "NOT_FOUND" });
    if (row.revision !== expectedRevision) throw Object.assign(new Error("metadata changed; refresh before saving"), { code: "STALE_REVISION" });
    const annotations = { ...parsed(row.annotations), ...patch };
    stmt("UPDATE records SET annotations=?,revision=revision+1,updated_at=? WHERE seq=?").run(JSON.stringify(annotations), now(), row.seq);
    return get(kind, id, owner);
  });
}
function stats() {
  return { ...status, counts: Object.fromEntries(stmt("SELECT kind,count(*) AS n FROM records GROUP BY kind").all().map((row) => [row.kind, row.n])), bytes: (() => {
    try {
      return fs.statSync(options.file).size;
    } catch {
      return 0;
    }
  })() };
}
async function command(message) {
  const { op, data, owner } = message;
  switch (op) {
    case "init":
      return init();
    case "batch":
      options.callBytes = data.callBytes;
      begin(() => {
        for (const record of data.records) put(record);
        retain();
      });
      return { records: projection(), status: stats() };
    case "list":
      return list(data, owner);
    case "get":
      return get(data.kind, data.id, owner);
    case "edit": {
      const record = edit(data, owner);
      projection();
      return record;
    }
    case "status":
      return stats();
    case "flush":
      db.exec("PRAGMA wal_checkpoint(PASSIVE)");
      return { records: projection(), status: stats() };
    case "clear":
      begin(() => stmt("DELETE FROM records WHERE kind=? AND scope=?").run(data.kind, owner.scopeKey));
      projection();
      return { ok: true };
    case "close": {
      projection();
      db.close();
      closed = true;
      return { ok: true };
    }
    default:
      throw new Error("unknown state command");
  }
}
var chain = Promise.resolve();
parentPort.on("message", (message) => {
  chain = chain.then(async () => {
    try {
      if (closed) throw new Error("state worker closed");
      parentPort.postMessage({ id: message.id, ok: true, value: await command(message) });
    } catch (error) {
      const detail = { at: now(), message: error.message, code: error.code };
      if (["init", "batch", "flush", "close"].includes(message.op) || message.op === "edit" && !["NOT_FOUND", "STALE_REVISION"].includes(error.code)) status.lastError = detail;
      else if (!["NOT_FOUND", "STALE_REVISION"].includes(error.code)) status.lastQueryError = detail;
      parentPort.postMessage({ id: message.id, ok: false, error: { message: error.message, code: error.code } });
    }
  });
});
