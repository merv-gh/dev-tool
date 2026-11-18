const test=require('node:test'), assert=require('node:assert/strict'), W=require('../web/api-workflow-model');
test('workflow presets use the ordinary script language and independent targets',()=>{
  for(const type of Object.keys(W.types)){const step=W.create(type,'uat');assert.equal(W.kind(step),type==='tool'?'tool':type);assert.ok(W.title(step));if(step.tool){assert.equal(step.args.env,'uat');assert.match(W.target(step),/uat/);}}
  assert.equal(W.kind({wait:2}),'advanced');assert.equal(W.title({wait:2}),'Advanced step');assert.equal(W.target({}),'');
  assert.equal(W.title({tool:'custom'}),'custom');assert.equal(W.kind({tool:'custom'}),'tool');assert.equal(W.title({script:'a/b'}),'Script · a/b');
  const body=W.definition({id:'a/b',revision:'old',savedAt:'old',description:'Test',steps:[{tool:'pg_query',args:{db:'orders'},as:'order'}],provenance:{kind:'http'},finally:'log("cleanup")'});
  assert.equal(body.id,undefined);assert.equal(body.revision,undefined);assert.equal(body.finally,'log("cleanup")');assert.equal(body.provenance.kind,'http');body.steps[0].args.db='other';assert.deepEqual(W.selection('orders/dev/check'),{collection:'orders/dev',select:['orders/dev/check']});assert.throws(()=>W.selection('root'),/collection/);
});
test('typed template and JSON fields preserve types and reject malformed values',()=>{
  assert.equal(W.value('"{{checkpoint}}"'),'{{checkpoint}}');assert.deepEqual(W.value('{"id":42}'),{id:42});assert.deepEqual(W.value('[42]','array'),[42]);assert.equal(W.value('null','any'),null);assert.equal(W.value('42','any'),42);
  for(const [text,type] of [['{','object'],['null','object'],['[1]','object'],['{}','array']])assert.throws(()=>W.value(text,type),/JSON/);
});
