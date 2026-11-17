const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../web/ui-events');

for (const malformed of ['data: {broken}\n\n', 'x'.repeat(262145)]) {
  test('malformed event stream closes its old reader before reconnecting: ' + (malformed.startsWith('data:') ? 'JSON' : 'budget'), async () => {
    let cancelled = false, attempts = 0, connection;
    const received = [], bus = E.create();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { connection.close(); reject(Error('Event retry did not recover')); }, 3000);
      bus.on('recovered', event => { received.push(event.data); connection.close(); clearTimeout(timeout); resolve(); });
      connection = E.connect('http://localhost/api/ui-events?channel=broken', { bus, fetch: async () => {
        attempts++;
        if (attempts === 2) assert.equal(cancelled, true, 'release the previous HTTP reader before another connection is admitted');
        return { ok: true, body: new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(attempts === 1 ? malformed : 'event: ui\ndata: {"type":"recovered","data":"retained"}\n\n'));
        }, cancel() { cancelled = true; } }) };
      } });
    });
    assert.equal(attempts, 2); assert.deepEqual(received, ['retained']);
  });
}

test('permanent access failures close without retries and detached listeners receive no later signals', async () => {
  const bus = E.create(), states = [], received = []; let attempts = 0;
  const detach = bus.on('changed', event => received.push(event));
  detach(); bus.emit({ type: 'changed' }); assert.deepEqual(received, []);
  bus.on('*', event => received.push(event)); bus.clear(); bus.emit({ type: 'changed' }); assert.deepEqual(received, []);
  await new Promise(resolve => {
    E.connect('http://localhost/api/ui-events', { bus, fetch: async () => { attempts++; return { ok: false, status: 403 }; }, onState: state => { states.push(state); if (state === 'closed') resolve(); } });
  });
  assert.deepEqual(states, ['connecting', 'unavailable', 'closed']); assert.equal(attempts, 1);
});

test('external cancellation releases an active reader and prevents reconnect', async () => {
  const abort = new AbortController(), states = []; let attempts = 0, cancelled = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Connection did not close')), 1000);
    E.connect('http://localhost/api/ui-events', { signal: abort.signal, fetch: async () => {
      attempts++; return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: ready\ndata: {"cursor":"initial","reset":false}\n\n')); }, cancel() { cancelled = true; } }) };
    }, onState: state => { states.push(state); if (state === 'connected') queueMicrotask(() => abort.abort()); if (state === 'closed') { clearTimeout(timer); resolve(); } } });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true); assert.equal(attempts, 1); assert.equal(states.at(-1), 'closed');
});
