const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), path = require('path');
function harness(call=async()=>({})) {
  const elements = new Map(), $ = id => { if (!elements.has(id)) elements.set(id, { hidden: true }); return elements.get(id); };
  const location = { href: 'https://tools.example/admin', origin: 'https://tools.example' };
  const handlers=[],sent=[]; $('cxMapFrame').contentWindow={postMessage:value=>sent.push(value)};
  const context = vm.createContext({ DTState: require('../lib/state-machine'), $, location, URL, contextCall:call, window: { addEventListener(type,handler) {if(type==='message')handlers.push(handler);} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/admin-map.js'), 'utf8'), context);
  return { $, sent, dispatch:async data=>{for(const handler of handlers)await handler({source:$('cxMapFrame').contentWindow,data});}, foreign:async data=>{for(const handler of handlers)await handler({source:{},data});}, run: s => vm.runInContext(s, context) };
}
test('Admin embeds map and screenshot results on its current origin despite another public URL', async () => {
  const h = harness(); await h.run('adminMapOpen("http://dt:4000/map/abc123", "dev")');
  assert.equal(h.$('cxMapFrame').src, 'https://tools.example/map/abc123?embed=1');
  assert.equal(h.$('cxMapPanel').hidden, false);
  assert.equal(h.run('adminMapViewUrl("http://localhost:4000/map-preview/abc123", "map-preview").href'), 'https://tools.example/map-preview/abc123');
  assert.equal(h.run('adminMapViewUrl("https://public.example/tool-prefix/map/abc123", "map").href'), 'https://tools.example/map/abc123');
  for (const view of ['javascript:alert(1)', 'https://foreign.example/admin', '/map/../admin', '/map/id/extra', 'https://user:pass@foreign.example/map/abc']) {
    assert.throws(() => h.run(`adminMapViewUrl(${JSON.stringify(view)}, "map")`), /Unexpected/);
  }
});
test('inspector executes edited arguments only for its own frame and suggested tools, then embeds native results',async()=>{
 const calls=[],h=harness(async(tool,args)=>{calls.push({tool,args});if(tool==='map_node')return {actions:[{tool:'pg_query',valid:true}]};if(tool==='pg_query')return [{count:7}];if(tool==='show')return {view:'http://dt:4000/show/abc123'};return {};});
 await h.run('adminMapOpen("http://dt:4000/map/map123", "dev")');
 const payload={type:'dt:map-run',map:'map123',node:'db:sales',request:'1',tool:'pg_query',arguments:{env:'dev',db:'sales',sql:'SELECT count(*) FROM sales.orders'}};
 await h.foreign(payload);assert.equal(calls.length,0);await h.dispatch({...payload,map:'other'});assert.equal(calls.length,0);
 await h.dispatch(payload);assert.equal(calls[1].args.sql,payload.arguments.sql);assert.equal(calls[2].tool,'show');assert.equal(calls[2].args.view,'table');assert.equal(h.sent.at(-1).view,'/show/abc123?embed=1');
 const before=calls.length;await h.dispatch({...payload,tool:'workspace_push'});assert.equal(calls.length,before+1);assert.match(h.sent.at(-1).error,/not an inspection/);
 await h.dispatch({...payload,tool:'map_adjustments',arguments:{env:'other'}});assert.equal(calls.at(-1).args.env,'dev','manual corrections remain in selected map environment');
});
test('pending inspection cannot deliver results into a newly opened map',async()=>{
 let finish;const waiting=new Promise(r=>finish=r),h=harness(async(tool)=>tool==='map_node'?{actions:[{tool:'passport',valid:true}]}:waiting);
 await h.run('adminMapOpen("/map/first", "dev")');const pending=h.dispatch({type:'dt:map-run',map:'first',node:'svc:orders',request:'1',tool:'passport',arguments:{service:'orders'}});
 await new Promise(r=>setImmediate(r));await h.run('adminMapOpen("/map/second", "uat")');finish({view:'https://public.example/passport/orders?t=signed'});await pending;assert.equal(h.sent.length,0);
});
test('visualization failure preserves a successfully executed inspection result',async()=>{
 const h=harness(async tool=>{if(tool==='map_node')return {actions:[{tool:'pg_query',valid:true}]};if(tool==='pg_query')return [{count:7}];throw Error('show disabled');});await h.run('adminMapOpen("/map/map123", "dev")');
 await h.dispatch({type:'dt:map-run',map:'map123',node:'db:sales',request:'1',tool:'pg_query',arguments:{sql:'SELECT 7'}});
 assert.equal(h.sent.at(-1).result[0].count,7);assert.equal(h.sent.at(-1).error,undefined);assert.equal(h.sent.at(-1).visualizationError,'show disabled');
});
