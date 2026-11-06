const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-adapter-capabilities-'));
for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_SECURITY_PROFILE','DT_API_KEY'])delete process.env[key];
Object.assign(process.env,{DT_HOME:home,DT_NO_DOCTOR:'1',DT_LOG:'quiet',DT_STATE_BACKEND:'legacy'});
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{fixture:{}},scripts:{starters:false}}));
test('reference HTTP adapter passes actual authentication, ownership and cancellation conformance',async()=>{
 const token='adapter-fixture-token-123456789',server=require('../demo/adapter/server').start({port:0,token});await new Promise(r=>server.once('listening',r));
 try{const report=await require('../dev/adapter-conformance').run({url:'http://127.0.0.1:'+server.address().port,token});assert.equal(report.passed,7);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('capability discovery separates text and semantic support without contacting adapters',async t=>{
 const C=require('../lib/config'),M=require('../lib/adapter-capabilities');
 const manifest={protocol:'dt.adapter-capabilities/v1',id:'fixture',scopeAware:true,capabilities:[{operation:'find',languages:['text'],evidence:'text',sourceIdentity:'fixture revision',gaps:['No semantic analysis']}]};
 const config={envs:{fixture:{}},scripts:{starters:false},tools:{backends:{find:{url:'https://adapter.example/execute',token:'private-adapter-token',scopeAware:true,capabilities:manifest},'pg_*':{url:'https://legacy-adapter.example/execute'}}}};
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));C.reload();
 t.mock.method(global,'fetch',()=>{throw Error('Discovery must not use the network');});
 const result=await require('../lib/tools').call('adapter_capabilities',{});
 assert.equal(result.builtin.capabilities.find(c=>c.operation==='code_search').evidence,'text');
 assert.deepEqual(result.builtin.capabilities.find(c=>c.operation==='passport').languages,['java','kotlin']);
 assert.equal(result.adapters.find(a=>a.route==='find').capabilities.id,'fixture');
 assert.ok(result.adapters.find(a=>a.route==='pg_*').gaps.length);
 assert.doesNotMatch(JSON.stringify(result),/private-adapter-token|https:\/\//);
 assert.throws(()=>M.validate({...manifest,capabilities:[{...manifest.capabilities[0],evidence:'imagined'}]}),e=>e.code==='DT_BACKEND_CONTRACT');
});
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
