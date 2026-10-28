const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-offline-js-'));
process.env.DT_HOME = home;
process.env.DT_OFFLINE_TEST_SECRET = 'must-never-be-visible';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, scripts: { jsTimeoutMs: 3000 } }));
const O = require('../lib/offline-js');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('offline JS: JSON data, fixture helpers, logs, output, tests and return contract', async () => {
  const data = { vars: { n: 1 }, args: { count: 2 }, result: { state: 'new' } };
  const r = await O.run(`
    vars.n += args.count;
    args.count++;
    result.state = 'closed';
    test('state', () => expect(result).toHaveProperty('state'));
    test('quantity', () => expect(vars.n).toBe(3));
    log('quantity', vars.n);
    console.info('state', result);
    text({ state: result.state });
    assert(diffLists(['007', 'x'], [7, 'y']).common[0] === '007');
    expect(diffLines('a\\nb', 'a\\nc').counts.added).toBe(1);
    return { uuid: uuid(), now: now(), year: date('YYYY'), rand: rand(6), hex: hex(8) };
  `, data);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.vars, { n: 3 });
  assert.deepEqual(r.args, { count: 3 });
  assert.deepEqual(r.result, { state: 'closed' });
  assert.equal(r.hasReturn, true);
  assert.deepEqual(r.tests, [{ name: 'state', ok: true }, { name: 'quantity', ok: true }]);
  assert.deepEqual(r.logs, ['quantity 3', 'state {"state":"closed"}']);
  assert.deepEqual(r.output, ['{\n  "state": "closed"\n}']);
  assert.match(r.returned.uuid, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.match(r.returned.now, /^\d{4}-\d\d-\d\dT/);
  assert.match(r.returned.year, /^\d{4}$/);
  assert.match(r.returned.rand, /^[1-9]\d{5}$/);
  assert.match(r.returned.hex, /^[\da-f]{8}$/);
  assert.deepEqual(data, { vars: { n: 1 }, args: { count: 2 }, result: { state: 'new' } }, 'input is serialized, never shared');
});

test('offline JS: independent state, actions and expectations use local allowlisted tool RPC', async () => {
  const state = {
    orders: [{ id: 42, customer_id: 9, amount: 17, state: 'open' }],
    customers: [{ id: 9, status: 'active', balance: 100 }],
    events: [{ topic: 'payments', key: '42', partition: 1, offset: '9223372036854775800', value: { orderId: 42, amount: 17 } }],
  };
  const calls = [];
  const onTool = async (name, args) => {
    calls.push({ name, args });
    if (name === '__list') return ['state_read', 'action', 'events_read'];
    if (name === 'state_read') {
      // Reverse completion order exercises concurrent RPC request correlation.
      await new Promise(resolve => setTimeout(resolve, args.db === 'orders' ? 12 : 1));
      return state[args.db].filter(row => row.id === args.id);
    }
    if (name === 'events_read') return state.events.filter(e => e.key === args.key);
    if (name === 'action') {
      const order = state.orders.find(row => row.id === args.orderId);
      const customer = state.customers.find(row => row.id === order.customer_id);
      assert.equal(args.amount, order.amount);
      customer.balance -= args.amount;
      order.state = 'paid';
      state.events.push({ topic: 'order-paid', key: String(order.id), value: { orderId: order.id, balance: customer.balance } });
      return { orderId: order.id, state: order.state };
    }
    throw new Error('offline tool denied: ' + name);
  };
  const r = await O.run(`
    const [orders, customers, events] = await Promise.all([
      tools.state_read({ db: 'orders', id: vars.orderId }),
      tools.call('state_read', { db: 'customers', id: 9 }),
      tools.events_read({ key: String(vars.orderId) })
    ]);
    test('foreign key joins', () => expect(orders[0].customer_id).toBe(customers[0].id));
    test('captured offsets remain precise', () => expect(events[0].offset).toBe('9223372036854775800'));
    const action = await tools.action({ orderId: orders[0].id, amount: events[0].value.amount });
    test('action response', () => expect(action).toEqual({ orderId: 42, state: 'paid' }));
    test('persisted cross database effects', async () => {
      const customer = (await tools.state_read({ db: 'customers', id: 9 }))[0];
      expect(customer.balance).toBe(83);
      test('nested async expectation', async () => expect((await tools.events_read({ key: '42' })).length).toBe(2));
    });
    expect(await tools.list()).toContain('state_read');
    try { await tools.pg_query({ sql: 'select secrets' }); assert(false); }
    catch (e) { expect(e.message).toMatch(/offline tool denied/); }
    return action;
  `, { vars: { orderId: 42 } }, { onTool });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.tests.length, 5);
  assert.equal(r.tests.every(t => t.ok), true, JSON.stringify(r.tests));
  assert.deepEqual(r.returned, { orderId: 42, state: 'paid' });
  assert.equal(state.customers[0].balance, 83);
  assert.equal(state.events.length, 2);
  assert.equal(calls.some(call => call.name === 'pg_query'), true);
});

test('offline JS: failed assertions are retained and an exception preserves earlier tests/logs', async () => {
  const r = await O.run(`
    test('passes', () => expect([1, 2]).toContain(2));
    test('fails', () => expect(2).not.toBe(2));
    test('async fails', async () => { throw new Error('async expectation failed'); });
    await Promise.resolve();
    log('before throw');
    throw new Error('program failed');
  `);
  assert.equal(r.error, 'program failed');
  assert.deepEqual(r.logs, ['before throw']);
  assert.deepEqual(r.tests.map(t => [t.name, t.ok]), [['passes', true], ['fails', false], ['async fails', false]]);
  assert.match(r.tests[1].error, /not to be/);
  assert.equal(r.tests[2].error, 'async expectation failed');
  assert.equal(r.hasReturn, undefined);
});

test('offline JS: no network, filesystem, child-process or environment capability is exposed', async () => {
  let connections = 0;
  const api = http.createServer((req, res) => { connections++; res.end('unexpected'); });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${api.address().port}/never`;
    const r = await O.run(`
      const outcomes = {};
      for (const name of ['fetch', 'require', 'process', 'module', 'Buffer', 'global', 'WebSocket', 'XMLHttpRequest', 'Deno', 'Bun', '__dtBridge', '__dtInput']) {
        outcomes[name] = typeof globalThis[name];
      }
      test('no direct fetch', () => { try { fetch(vars.url); assert(false); } catch (e) { expect(e.message).toMatch(/not defined/); } });
      test('no HTTP builtin', () => { try { require('node:http').get(vars.url); assert(false); } catch (e) { expect(e.message).toMatch(/not defined/); } });
      test('no files', () => { try { require('node:fs').readFileSync('/etc/hosts'); assert(false); } catch (e) { expect(e.message).toMatch(/not defined/); } });
      test('no child process', () => { try { require('node:child_process').execSync('id'); assert(false); } catch (e) { expect(e.message).toMatch(/not defined/); } });
      test('no environment', () => { try { return process.env.DT_OFFLINE_TEST_SECRET; } catch (e) { expect(e.message).toMatch(/not defined/); } });
      return outcomes;
    `, { vars: { url } });
    assert.equal(r.error, undefined);
    assert.equal(r.tests.length, 5);
    assert.equal(r.tests.every(t => t.ok), true);
    assert.equal(Object.values(r.returned).every(v => v === 'undefined'), true, JSON.stringify(r.returned));
    assert.equal(connections, 0);
    assert.equal(JSON.stringify(r).includes('must-never-be-visible'), false);
  } finally { await new Promise(resolve => api.close(resolve)); }
});

test('offline JS: helper, proxy, input, promise, error, and stack constructors stay in the realm', async () => {
  const r = await O.run(`
    const attempts = [
      () => globalThis.constructor.constructor('return process')(),
      () => vars.constructor.constructor('return process')(),
      () => vars.child.constructor.constructor('return process')(),
      () => args.constructor.constructor('return process')(),
      () => result.constructor.constructor('return process')(),
      () => uuid.constructor('return process')(),
      () => tools.call.constructor('return process')(),
      () => tools.state_read.constructor('return process')(),
      () => console.log.constructor('return process')(),
      () => expect(1).toBe.constructor('return process')(),
      () => Promise.resolve().constructor.constructor('return process')(),
      () => Object.getPrototypeOf(async () => {}).constructor('return process')(),
      () => Object.getPrototypeOf(function* () {}).constructor('return process')(),
      () => (new Error('x')).constructor.constructor('return process')(),
      () => eval('process'),
      () => Function('return process')(),
    ];
    let blocked = 0;
    for (const attempt of attempts) {
      try { attempt(); throw new Error('constructor escaped'); }
      catch (e) { assert(/Code generation|undefined|not a function/.test(e.message), e.message); blocked++; }
    }
    Error.prepareStackTrace = (_, frames) => frames;
    const frames = new Error('stack').stack;
    for (const frame of frames) {
      try { frame.getFunction.constructor('return process')(); assert(false, 'stack escaped'); }
      catch (e) { assert(/Code generation/.test(e.message), e.message); }
      assert(frame.getFunction() === undefined, 'strict stack hides function identities');
    }
    return { blocked, attempts: attempts.length, hiddenBridge: typeof __dtBridge };
  `, { vars: { child: {} }, args: {}, result: {} });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.returned.blocked, 16);
  assert.equal(r.returned.hiddenBridge, 'undefined');
});

test('offline JS: RPC results, promises and rejected errors cannot expose host constructors', async () => {
  const r = await O.run(`
    const promise = tools.good({});
    test('RPC promise realm', () => expect(promise.constructor).toBe(Promise));
    const value = await promise;
    test('RPC result realm', () => expect(value.constructor).toBe(Object));
    test('RPC nested result realm', () => expect(value.nested.constructor).toBe(Array));
    try { await tools.denied({}); assert(false, 'must reject'); }
    catch (e) {
      expect(e.constructor).toBe(Error);
      expect(e.message).toBe('local tool denied');
      try { e.constructor.constructor('return process')(); assert(false, 'error escaped'); }
      catch (blocked) { expect(blocked.message).toMatch(/Code generation/); }
    }
    return value;
  `, {}, { onTool: async name => { if (name === 'denied') throw new Error('local tool denied'); return { nested: [{ id: 7 }] }; } });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.tests.every(t => t.ok), true);
  assert.deepEqual(r.returned, { nested: [{ id: 7 }] });
});

test('offline JS: missing allowlist refuses RPC, including list', async () => {
  for (const code of ['return await tools.pg_query({sql:"select 1"})', 'return await tools.list()']) {
    const r = await O.run(code);
    assert.match(r.error, /tools are not available/);
  }
});

test('offline JS: module loading is rejected before execution to avoid host-realm loader errors', async () => {
  let called = false;
  for (const code of [
    'await tools.side_effect({}); return import("node:http")',
    'return import /* hidden comment */ ("node:fs")',
    'return import\n("node:child_process")',
    'return "import is deliberately reserved even in strings"',
    '/* import is deliberately reserved in comments */ return 1',
  ]) {
    const r = await O.run(code, {}, { onTool: async () => { called = true; } });
    assert.match(r.error, /cannot contain the import keyword/);
    assert.equal(r.returned, undefined);
  }
  assert.equal(called, false);
});

test('offline JS: synchronous and microtask loops are killed by the parent timeout', async () => {
  for (const code of ['while (true) {}', 'while (true) { await Promise.resolve(); }']) {
    await assert.rejects(O.run(code, {}, { timeoutMs: 150 }), /stopped after 150ms/);
  }
  assert.equal((await O.run('return 7')).returned, 7, 'a timeout does not poison future runs');
});

test('offline JS: unsupported JSON values and malformed code report bounded errors', async () => {
  const circular = {}; circular.self = circular;
  await assert.rejects(O.run('return vars', { vars: circular }), /data is not JSON/);
  assert.match((await O.run('return 1n')).error, /result is not JSON.*BigInt/);
  assert.match((await O.run('return {')).error, /Unexpected/);
  const r = await O.run(`
    const circular = {}; circular.self = circular;
    try { await tools.bad(circular); assert(false); }
    catch (e) { expect(e.constructor).toBe(Error); expect(e.message).toMatch(/arguments are not JSON/); }
    try { await tools.circular({}); assert(false); }
    catch (e) { expect(e.constructor).toBe(Error); expect(e.message).toMatch(/result is not JSON/); }
    return 'ok';
  `, {}, { onTool: async () => circular });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.returned, 'ok');
});

test('offline JS: fire-and-forget RPC settles and each run gets fresh globals/prototypes', async () => {
  let completed = false;
  const r = await O.run(`
    globalThis.leaked = 'no';
    Object.prototype.leaked = 'no';
    tools.local({});
    return 'done';
  `, {}, { onTool: async () => { await new Promise(resolve => setTimeout(resolve, 10)); completed = true; return {}; } });
  assert.equal(r.error, undefined);
  assert.equal(completed, true);
  const next = await O.run('return { global: typeof leaked, prototype: typeof ({}).leaked };');
  assert.deepEqual(next.returned, { global: 'undefined', prototype: 'undefined' });
  assert.deepEqual((await O.run('vars.changed = true')).vars, { changed: true });
  assert.equal((await O.run('vars.changed = true')).hasReturn, undefined);
});
