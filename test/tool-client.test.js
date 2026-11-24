const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../web/tool-client');
function fixture(){const sockets=[],events=[],fallback=[];class Socket{
 constructor(){this.readyState=0;this.frames=[];sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}
 send(raw){if(this.failSend)throw Error('Socket write failed');const f=JSON.parse(raw);this.frames.push(f);if(f.type==='call'){this.onmessage({data:JSON.stringify({id:f.id,type:'accepted'})});if(f.tool==='script_list')queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:f.id,type:'result',status:200,result:{scripts:[]}})}));if(f.tool==='missing')queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:f.id,type:'error',status:403,error:'Denied'})}));}if(f.type==='subscribe')queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:f.id,type:'subscribed',cursor:'epoch.1',events:[],reset:false})}));}
 close(){this.readyState=3;this.onclose();}
 }
 const client=create({WebSocket:Socket,location:{origin:'http://example.test'},fetch:async(...args)=>{fallback.push(args);return new Response('{}');},emit:(type,data)=>events.push({type,...data})});return {client,sockets,events,fallback};}
const request=(tool,args={},options={})=>['/api/tool/'+tool,{method:'POST',headers:{'content-type':'application/json','x-dt-story':'task'},body:JSON.stringify(args),...options}];
test('native frame popup escape is limited to same-origin retained /show responses and resets on other content',()=>{
 const {resultFrame}=require('../web/tool-client'),attrs=new Map(),frame={setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 for(const src of ['/show/retained123?embed=1','http://example.test/show/my-view']){attrs.set('srcdoc','preview');resultFrame(frame,src,{origin:'http://example.test'});assert.match(attrs.get('sandbox'),/allow-popups-to-escape-sandbox/);assert.doesNotMatch(attrs.get('sandbox'),/allow-same-origin/);assert.equal(attrs.has('srcdoc'),false);assert.equal(frame.src,src);}
 for(const src of ['https://outside.test/show/retained123','http://user:pass@example.test/show/retained123','/view/retained123','/admin','about:blank','javascript:alert(1)']){resultFrame(frame,src,{origin:'http://example.test'});assert.doesNotMatch(attrs.get('sandbox'),/escape-sandbox|allow-same-origin/);}
});
test('UI fetch adapter multiplexes calls, preserves JSON/error/status semantics and only emits metadata progress',async()=>{
 const f=fixture();try{const [a,b]=await Promise.all([f.client.fetch(...request('script_list')),f.client.fetch(...request('missing'))]);assert.equal(a.headers.get('x-dt-transport'),'websocket');assert.deepEqual(await a.json(),{result:{scripts:[]}});assert.equal(b.status,403);assert.equal((await b.json()).error,'Denied');assert.equal(f.sockets.length,1);assert.equal(f.client.stats.sent,2);assert.equal(f.client.stats.active,0);assert.ok(f.events.some(e=>e.type==='accepted'));assert.ok(!f.events.some(e=>e.args));assert.equal(f.fallback.length,0);
  await f.client.fetch('/static/data.json');await f.client.fetch('http://other.test/api/tool/a',{method:'POST',body:'{}'});await f.client.fetch(...request('script_list',{}, {credentials:'omit'}));await f.client.fetch('/api/tool/a',{method:'POST',body:'invalid'});assert.equal(f.fallback.length,4);
 }finally{f.client.close();}
});
test('cancellation sends a cancel command, disconnect rejects pending work and never resends a mutation',async()=>{
 const f=fixture();try{const controller=new AbortController(),p=f.client.fetch(...request('slow',{}, {signal:controller.signal}));await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(p,e=>e.name==='AbortError');assert.equal(f.sockets[0].frames.at(-1).type,'cancel');
  const pending=f.client.fetch(...request('mutate'));await new Promise(r=>setImmediate(r));f.sockets[0].close();await assert.rejects(pending,/outcome may be unknown/);assert.equal(f.fallback.length,0);assert.equal(f.sockets[0].frames.filter(f=>f.tool==='mutate').length,1);
  await f.client.fetch(...request('script_list'));assert.equal(f.sockets.length,2);assert.equal(f.client.stats.active,0);
 }finally{f.client.close();}
});
test('HTTP fallback occurs only before dispatch when WebSocket cannot connect',async()=>{
 let hits=0;const client=create({WebSocket:class{constructor(){throw Error('Unsupported');}},location:{origin:'http://example.test'},fetch:async()=>{hits++;return new Response('{"result":true}');}});
 assert.equal((await (await client.fetch(...request('mutate'))).json()).result,true);assert.equal(hits,1);
 const aborted=new AbortController();aborted.abort();await assert.rejects(client.fetch(...request('mutate',{}, {signal:aborted.signal})),e=>e.name==='AbortError');assert.equal(hits,1);client.close();
});
test('WebSocket event subscriptions preserve ready/replay cursors and unsubscribe explicitly',async()=>{
 const f=fixture(),received=[],ready=[];let sub;try{sub=f.client.subscribe({channel:'page:shared:example:revision',headers:{'x-dt-story':'task'},onEvent:e=>received.push(e),onReady:r=>ready.push(r)});await new Promise(r=>setImmediate(r));const frame=f.sockets[0].frames.find(f=>f.type==='subscribe');assert.equal(frame.headers['x-dt-story'],'task');assert.equal(sub.cursor,'epoch.1');
  f.sockets[0].onmessage({data:JSON.stringify({id:frame.id,type:'event',event:{id:'epoch.2',type:'changed',data:{value:42}}})});assert.equal(received[0].data.value,42);assert.equal(sub.cursor,'epoch.2');assert.equal(ready.length,1);
  sub.close();assert.equal(f.sockets[0].frames.at(-1).type,'unsubscribe');
 }finally{f.client.close();}
});
test('a response deadline sends cancel and rejects without retrying, even if frames are malformed',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{const p=f.client.fetch(...request('hung')),proof=assert.rejects(p,/timed out/);await new Promise(r=>setImmediate(r));f.sockets[0].onmessage({data:'not JSON'});t.mock.timers.tick(9001001);await proof;assert.equal(f.sockets[0].frames.at(-1).type,'cancel');assert.equal(f.fallback.length,0);assert.equal(f.client.stats.active,0);
 }finally{f.client.close();}
});
test('read subscriptions reconnect from their last cursor, while revoked subscriptions stop',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),states=[];let sub;try{sub=f.client.subscribe({channel:'events:test',onState:s=>states.push(s)});await new Promise(r=>setImmediate(r));const old=f.sockets[0].frames.at(-1);f.sockets[0].onmessage({data:JSON.stringify({id:old.id,type:'event',event:{id:'epoch.9',type:'changed',data:{}}})});f.sockets[0].close();t.mock.timers.tick(1000);await new Promise(r=>setImmediate(r));assert.equal(f.sockets.length,2);assert.equal(f.sockets[1].frames[0].after,'epoch.9');assert.ok(states.includes('reconnecting'));
  f.sockets[1].onmessage({data:JSON.stringify({id:old.id,type:'error',status:403,error:'Revoked'})});assert.ok(states.includes('unavailable'));sub.close();
  const aborted=new AbortController();aborted.abort();f.client.subscribe({channel:'events:test',signal:aborted.signal});assert.equal(f.sockets[1].frames.at(-1).type,'unsubscribe');
 }finally{f.client.close();}
});
test('a blocked handshake falls back before dispatch, while an established write failure does not replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let fallbacks=0;class Stalled{constructor(){this.readyState=0;}close(){this.onclose();}}
 const client=create({WebSocket:Stalled,location:{origin:'http://example.test'},fetch:async()=>{fallbacks++;return new Response('{}');}});const p=client.fetch(...request('mutate'));t.mock.timers.tick(1500);await p;assert.equal(fallbacks,1);client.close();
 const f=fixture();try{await f.client.fetch(...request('script_list'));f.sockets[0].failSend=true;await assert.rejects(f.client.fetch(...request('mutate')),/write failed/);assert.equal(f.fallback.length,0);}finally{f.client.close();}
});
