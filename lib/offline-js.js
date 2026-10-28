// Local scenario/experiment programs. Keep the ordinary script runner compatible: this adds a
// separate realm inside its permission-model child (empty environment, no files/processes/workers,
// bounded memory and a parent-enforced timeout). Programs get JSON data and explicit tool RPC only.
//
// This is a constrained interpreter for trusted project code, NOT an adversarial security boundary:
// node:vm is not a security mechanism, and Node <25's permission model does not restrict networking.
// Network APIs and Node capabilities are absent from the program's realm. Callers must allowlist
// onTool; that callback is the only intended way out. Run untrusted code in an OS/container sandbox.
// The word `import` is rejected anywhere in source (even strings/comments): V8's dynamic-import
// errors can originate in the host realm, so allowing that syntax would undermine this constraint.
const J = require('./js');
const { diffLists, diffLines } = require('./diff');

// Everything in this bootstrap, including helper functions, proxies, promises, errors and parsed
// input, is created IN the new realm. Never pass a host function/object as a program helper. The
// primitive-only host bridge is captured here, deleted from globalThis, and not in user code scope.
const BOOTSTRAP = String.raw`
(function () {
  'use strict';
  const bridge = globalThis.__dtBridge;
  const input = JSON.parse(globalThis.__dtInput);
  delete globalThis.__dtBridge;
  delete globalThis.__dtInput;
  const jsonStringify = JSON.stringify.bind(JSON), jsonParse = JSON.parse.bind(JSON);
  const entries = Object.entries, defineProperty = Object.defineProperty;
  const logs = [], tests = [], output = [], pending = [], requests = new Map();
  const out = { vars: input.vars, args: input.args, result: input.result, logs, tests, output };
  let seq = 0;
  const fmt = (v, pretty) => {
    if (typeof v === 'string') return v;
    try { return jsonStringify(v, null, pretty ? 2 : undefined) ?? String(v); }
    catch { return String(v); }
  };
  const message = (e) => { try { return String(e && e.message || e); } catch { return 'program error'; } };
  const check = (ok, msg) => { if (!ok) throw new Error(msg || 'assertion failed'); };
  function expect(v) {
    const matchers = (neg) => ({
      toBe: (x) => check((v === x) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to be ' + fmt(x)),
      toEqual: (x) => check((jsonStringify(v) === jsonStringify(x)) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to equal ' + fmt(x)),
      toMatch: (re) => check(new RegExp(re).test(String(v)) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to match ' + re),
      toContain: (x) => check((v != null && v.includes(x)) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to contain ' + fmt(x)),
      toBeTruthy: () => check(!!v !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to be truthy'),
      toBeGreaterThan: (x) => check((v > x) !== neg, 'expected ' + fmt(v) + (neg ? ' not' : '') + ' to be greater than ' + fmt(x)),
      toHaveProperty: (k) => check((v != null && String(k).split('.').reduce((a, p) => a == null ? undefined : a[p], v) !== undefined) !== neg, 'expected ' + fmt(v).slice(0, 200) + (neg ? ' not' : '') + ' to have ' + k),
    });
    return Object.assign(matchers(false), { not: matchers(true) });
  }
  const rpc = (tool, args) => {
    if (typeof tool !== 'string' || !tool) return Promise.reject(new Error('tool name must be a nonempty string'));
    let payload;
    try { payload = jsonStringify({ id: ++seq, tool, args: args === undefined ? {} : args }); }
    catch (e) { return Promise.reject(new Error('tool arguments are not JSON: ' + message(e))); }
    const id = seq;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Set a handler now so fire-and-forget RPC cannot create an unhandled host rejection.
    promise.catch(() => {});
    requests.set(id, { resolve, reject, promise });
    bridge(payload);
    return promise;
  };
  const tools = new Proxy(Object.create(null), { get: (_, name) => {
    if (typeof name !== 'string' || name === 'then') return undefined;
    if (name === 'call') return (name, args) => rpc(name, args);
    if (name === 'list') return () => rpc('__list', {});
    return (args) => rpc(name, args);
  } });
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const date = (f = 'YYYY-MM-DD', d = new Date()) => f.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, t => ({ YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), SSS: pad(d.getMilliseconds(), 3) }[t]));
  const hex = (n = 8) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const rand = (n = 6) => Array.from({ length: n }, (_, i) => Math.floor(Math.random() * (i ? 10 : 9)) + (i ? 0 : 1)).join('');
  const helpers = {
    tools, expect, assert: check, date, hex, rand,
    // UUIDs/random values are for fixtures, not cryptographic use.
    uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); }),
    now: () => new Date().toISOString(),
    diffLists: ${diffLists.toString()},
    diffLines: ${diffLines.toString()},
    log: (...args) => { logs.push(args.map(v => fmt(v)).join(' ').slice(0, 2000)); },
    text: (...args) => { output.push(args.map(v => fmt(v, true)).join(' ')); },
    test: (name, fn) => {
      const done = (ok, e) => tests.push(ok ? { name, ok: true } : { name, ok: false, error: message(e) });
      try {
        const r = fn();
        if (r && typeof r.then === 'function') pending.push(Promise.resolve(r).then(() => done(true), e => done(false, e)));
        else done(true);
      } catch (e) { done(false, e); }
    },
  };
  for (const [name, value] of entries(helpers)) defineProperty(globalThis, name, { value, enumerable: true });
  defineProperty(globalThis, 'console', { value: Object.freeze({ log: helpers.log, info: helpers.log, warn: helpers.log, error: helpers.log }) });
  return {
    receive: (payload) => {
      const reply = jsonParse(payload), request = requests.get(reply.id);
      if (!request) return;
      requests.delete(reply.id);
      if (reply.error !== undefined) request.reject(new Error(String(reply.error)));
      else request.resolve(reply.result);
    },
    execute: async (fn) => {
      let returned;
      try {
        returned = await fn(out.vars, out.args, out.result);
      } catch (e) { out.error = message(e); }
      try {
        // Tests can register other async tests, and unawaited RPC must settle before completion.
        let done = 0;
        while (done < pending.length || requests.size) {
          const batch = pending.slice(done); done = pending.length;
          await Promise.allSettled([...batch, ...Array.from(requests.values(), r => r.promise)]);
        }
        if (!out.error && returned !== undefined) { out.returned = returned; out.hasReturn = true; }
      } catch (e) { out.error = message(e); }
      try { return jsonStringify(out); }
      catch (e) { return jsonStringify({ logs, tests, output, error: 'result is not JSON: ' + message(e) }); }
    },
  };
})()
`;

// This program executes in lib/js.js's child, never in the application's process. Only serialized
// primitives cross into its vm context, and the user function is compiled outside the bridge's
// lexical closure. A bridge invocation never returns a host promise, object or error to the realm.
const PROGRAM = String.raw`
'use strict';
const vm = require('node:vm');
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
let control;
const stringify = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
const bridge = (payload) => {
  if (typeof payload !== 'string') return;
  let request;
  try { request = parse(payload); } catch { return; }
  const respond = (reply) => {
    let serialized;
    try { serialized = stringify(reply); }
    catch { serialized = stringify({ id: request.id, error: 'tool result is not JSON' }); }
    control.receive(serialized);
  };
  Promise.resolve().then(() => tools.call(request.tool, request.args)).then(
    (result) => respond({ id: request.id, result }),
    (error) => respond({ id: request.id, error: String(error && error.message || error) })
  );
};
Object.setPrototypeOf(bridge, null);
Object.freeze(bridge);
context.__dtBridge = bridge;
context.__dtInput = stringify(vars.data);
control = new vm.Script(${JSON.stringify(BOOTSTRAP)}, { filename: 'offline-helpers.js' }).runInContext(context);
const fn = new vm.Script('(async function(vars, args, result) { "use strict";\n' + vars.code + '\n})', { filename: 'offline-program.js' }).runInContext(context);
return parse(await control.execute(fn));
`;

async function run(code, data = {}, options = {}) {
  code = String(code);
  if (/\bimport\b/u.test(code)) {
    return { vars: data.vars || {}, ...(data.args === undefined ? {} : { args: data.args }), ...(data.result === undefined ? {} : { result: data.result }), logs: [], tests: [], output: [], error: 'offline code cannot contain the import keyword (including strings/comments)' };
  }
  const response = await J.run(PROGRAM, { vars: { code, data: { vars: {}, ...data } } }, options);
  // Child/runtime/compilation errors have the same return contract as ordinary JavaScript steps.
  if (response.error) return { vars: data.vars || {}, ...(data.args === undefined ? {} : { args: data.args }), ...(data.result === undefined ? {} : { result: data.result }), logs: response.logs || [], tests: response.tests || [], output: response.output || [], error: response.error };
  return response.returned;
}

module.exports = { run };
