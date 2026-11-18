const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../web/ui-events');

test('browser events prefer the shared WebSocket, preserve cursors and reject cross-origin channels',()=>{
 const previous={socket:globalThis.DTToolSocket,location:globalThis.location};let options,closed=0;globalThis.location={origin:'http://local.test'};globalThis.DTToolSocket={subscribe:value=>{options=value;return{close:()=>closed++};}};
 try{const bus=E.create(),events=[];bus.on('*',e=>events.push(e));const connection=E.connect('/api/ui-events?channel=scope:events',{bus,headers:{'x-dt-story':'task'},after:'old.1'});assert.equal(options.channel,'scope:events');assert.equal(options.headers['x-dt-story'],'task');options.onReady({cursor:'epoch.1',reset:true});assert.equal(events[0].type,'ui.reset');options.onEvent({id:'epoch.2',type:'changed',data:{value:42}});assert.equal(connection.cursor,'epoch.2');assert.equal(events[1].data.value,42);connection.close();assert.equal(closed,1);assert.throws(()=>E.connect('http://other.test/api/ui-events?channel=scope:events'),/this server/);
 }finally{globalThis.DTToolSocket=previous.socket;globalThis.location=previous.location;}
});

test('an unavailable WebSocket event channel falls back to one bounded authenticated SSE stream',async()=>{
 const previous={socket:globalThis.DTToolSocket,location:globalThis.location};let options,closed=0,fetches=0,connection;globalThis.location={origin:'http://local.test'};globalThis.DTToolSocket={subscribe:value=>{options=value;return{close:()=>closed++};}};
 try{const bus=E.create();let received;const done=new Promise(r=>bus.on('recovered',e=>{received=e;connection.close();r();}));connection=E.connect('/api/ui-events?channel=scope:events',{bus,headers:{'x-dt-story':'task'},fetch:async(url,init)=>{fetches++;assert.equal(init.headers['x-dt-story'],'task');return {ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: ui\nid: epoch.2\ndata: {"id":"epoch.2","type":"recovered","data":{"value":42}}\n\n'));},cancel(){}})};}});options.onState('unavailable');await done;assert.equal(received.data.value,42);assert.equal(fetches,1);assert.equal(closed,1);
 }finally{connection?.close();globalThis.DTToolSocket=previous.socket;globalThis.location=previous.location;}
});

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
