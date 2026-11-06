const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { BrowserSession } = require('../lib/browser-mcp');
async function peer(fn) {
  const server = http.createServer(async (req,res) => {
    let body='';for await (const chunk of req) body+=chunk;
    await fn(req,res,body?JSON.parse(body):null);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return { url:`http://127.0.0.1:${server.address().port}`, close:()=>new Promise(r=>server.close(r)) };
}
const reply=(res,id,result={})=>{res.writeHead(200,{'content-type':'application/json','mcp-session-id':'browser-test'});res.end(JSON.stringify({jsonrpc:'2.0',id,result}));};

test('a failed initialized notification discards the partial ID and retries the whole handshake', async () => {
  let initialized=0,notifications=0,deleted=0;
  const server=await peer(async(req,res,body)=>{
    if(req.method==='DELETE'){deleted++;res.writeHead(204);return res.end();}
    if(body.method==='initialize'){initialized++;return reply(res,body.id);}
    if(body.method==='notifications/initialized'&&++notifications===1){res.writeHead(503);return res.end('not ready');}
    reply(res,body.id);
  });
  const s=new BrowserSession(server.url);
  try {
    await assert.rejects(s.open(),/HTTP 503/);assert.equal(s.id,null);assert.equal(s.lifecycle.state,'disconnected');assert.equal(deleted,1);
    await s.open();assert.equal(initialized,2);assert.equal(notifications,2);assert.equal(s.lifecycle.state,'ready');
  } finally {await s.close();await server.close();}
});

test('concurrent opens share one handshake, and close cannot leave it ready', async () => {
  let initialized=0,release,entered;
  const waiting=new Promise(r=>entered=r), barrier=new Promise(r=>release=r);
  const server=await peer(async(req,res,body)=>{
    if(req.method==='DELETE'){res.writeHead(204);return res.end();}
    if(body.method==='initialize'){initialized++;entered();await barrier;}
    reply(res,body.id);
  });
  const s=new BrowserSession(server.url);
  try {
    const a=s.open(),b=s.open();await waiting;const closed=s.close();release();
    const results=await Promise.allSettled([a,b]);assert.ok(results.every(r=>r.status==='rejected'));
    await closed;assert.equal(initialized,1);assert.equal(s.lifecycle.state,'disconnected');assert.equal(s.id,null);
    await s.open();assert.equal(initialized,2);assert.equal(s.lifecycle.state,'ready');
  } finally {await s.close();await server.close();}
});
