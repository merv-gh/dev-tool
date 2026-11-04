const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-adapter-scope-'));process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_STATE_BACKEND='legacy';
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));
const A=require('../lib/access'),E=require('../lib/execution'),P=require('../lib/adapter-port');
let server,url,received=[];
test.before(async()=>{server=http.createServer((req,res)=>{let text='';req.on('data',b=>text+=b);req.on('end',()=>{const body=JSON.parse(text);received.push({body,headers:req.headers});const issues=require('../lib/schema').validate(body,require('../contracts/v1/tool-request.schema.json'));res.setHeader('content-type','application/json');res.end(JSON.stringify({protocol:P.PROTOCOL,requestId:body.requestId,tool:body.tool,result:{valid:!issues.length}}));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});

test('multi-user adapters fail before sending unless authenticated and explicitly scope aware',async()=>{
 await A.run({principalId:'alice',storyId:'one',multiUser:true},async()=>{await assert.rejects(P.execute('testdb_clone',{}, {url,token:'service-token'}),e=>e.code==='DT_BACKEND_SCOPE_REQUIRED');await assert.rejects(P.execute('testdb_clone',{}, {url,scopeAware:true}),e=>e.code==='DT_BACKEND_SCOPE_REQUIRED');});
 assert.equal(received.length,0);
});
test('scope-aware adapters receive only server-owned identity despite forged tool arguments',async()=>{
 await A.run({principalId:'alice',storyId:'one',multiUser:true},()=>E.run({tool:'adapter',revision:'config-generation-42'},async()=>{const result=await P.execute('testdb_clone',{context:{principalId:'bob',storyId:'forged'}},{url,token:'service-token',scopeAware:true});assert.equal(result.valid,true);const record=received.at(-1);assert.equal(record.headers.authorization,'Bearer service-token');assert.equal(record.headers['x-dt-principal'],'alice');assert.equal(record.headers['x-dt-story'],'one');assert.equal(record.body.context.principalId,'alice');assert.equal(record.body.context.storyId,'one');assert.equal(record.body.context.scopeKey,A.owner().scopeKey);assert.equal(record.body.context.executionId,E.current().id);assert.equal(record.body.context.revision,'config-generation-42');assert.equal(record.body.arguments.context.principalId,'bob');}));
});
test('legacy adapter requests preserve their original envelope',async()=>{assert.equal((await P.execute('testdb_clone',{}, {url,token:'service-token'})).valid,true);const record=received.at(-1);assert.deepEqual(Object.keys(record.body).sort(),['arguments','protocol','requestId','tool']);assert.equal(record.headers['x-dt-principal'],undefined);});

test('explicit single-user chats also require and forward scoped adapter identity',async()=>{
 await A.run({...A.LEGACY,storyId:'local-story'},async()=>{await assert.rejects(P.execute('testdb_clone',{}, {url,token:'service-token'}),e=>e.code==='DT_BACKEND_SCOPE_REQUIRED');const result=await P.execute('testdb_clone',{}, {url,token:'service-token',scopeAware:true});assert.equal(result.valid,true);assert.equal(received.at(-1).body.context.storyId,'local-story');assert.notEqual(received.at(-1).body.context.scopeKey,'legacy');});
});
