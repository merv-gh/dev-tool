const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-webui-context-'));process.env.DT_HOME=home;process.env.DT_LOG='quiet';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','LLM_CONTEXT_WINDOW','LLM_COMPACT_AT','LLM_CONTEXT_RESERVE','LLM_COMPACTION_MODE','ENABLE_CONTEXT_COMPACTION'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},llm:{compactionMode:'auto',contextWindows:{wide:65536}}}));
const W=require('../lib/webui');let server,base,broken=false,custom='',imports=[],models=[],separate=false,available=['small','wide'],denied=false,collision=false,alias=false,previousThreshold,contextTool;
const settings={'chat.context_compaction.enable':false,'unrelated.value':'preserved'},presets=new Map();
test.before(async()=>{server=http.createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const body=text?JSON.parse(text):null;res.setHeader('content-type','application/json');
 const reply=(x,code=200)=>{res.statusCode=code;res.end(JSON.stringify(x));};
 if(req.url==='/health')return reply({status:true});
 assert.equal(req.headers.authorization,'Bearer fixture-admin');
 if(req.url==='/api/v1/tools/id/dt_chat_context')return contextTool?reply(contextTool):reply({},404);
 if(req.url==='/api/v1/tools/create'||req.url==='/api/v1/tools/id/dt_chat_context/update'){contextTool=body;return reply(body);}
 if(req.url==='/api/v1/tools/')return reply([{id:'dt'}]);if(req.url==='/api/models')return reply({data:available.map(id=>({id}))});
 if(req.url==='/api/v1/configs/namespace/chat')return broken?reply({error:'unsupported'},404):reply({...settings,'chat.context_compaction.prompt_template':custom||settings['chat.context_compaction.prompt_template']||''});
 if(req.url==='/api/v1/configs/import'){imports.push(body.config);Object.assign(settings,body.config);return reply(settings);}
 if(req.url.startsWith('/api/v1/models/model?id=dt-context-summary-'))return collision?reply({meta:{custom:true}}):presets.has(req.url.split('=')[1])?reply(presets.get(req.url.split('=')[1])):reply({error:'missing'},404);
 if(req.url==='/api/v1/models/create'){presets.set(body.id,body);return reply(body);}
 if(req.url.startsWith('/api/v1/models/model?id='))return denied?reply({error:'forbidden'},403):reply({id:'small',user_id:'source-owner',...(alias?{base_model_id:'provider-base'}:{}),params:{system:'User instruction',temperature:0.2,...(previousThreshold?{compact_token_threshold:previousThreshold}:{})},meta:{custom:'kept'},access_control:{read:{group_ids:['team']}},access_grants:[{id:'grant1',principal_type:'group',principal_id:separate&&req.url.endsWith('wide')?'other-team':'team',permission:'read'}]});
 if(req.url.startsWith('/api/v1/models/model/update?id=dt-context-summary-')){presets.set(body.id,body);return reply(body);}
 if(req.url.startsWith('/api/v1/models/model/update')){models.push(body);return reply(body);}return reply({error:req.url},404);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(home,{recursive:true,force:true});});
test('setup enables and verifies native compaction using only a partial config update',async()=>{
 const result=await W.setup({base,key:'fixture-admin',log:()=>{}});assert.equal(result.contextCompaction.enabled,true);assert.equal(settings['chat.context_compaction.token_threshold'],24576);assert.equal(settings['chat.context_compaction.token_cap'],49152);
 assert.ok(Object.keys(imports[0]).every(k=>k.startsWith('chat.context_compaction.')||k.startsWith('chat.tool_search.')));assert.equal(settings['unrelated.value'],'preserved');assert.equal(settings['chat.tool_search.enable'],true);assert.equal(settings['chat.tool_search.defer_threshold'],0);
 assert.equal(models[0].params.compact_token_threshold,24576);assert.equal(models[1].params.compact_token_threshold,49152);assert.equal(models[0].params.temperature,0.2);assert.match(models[0].params.system,/^User instruction/);assert.equal(models[0].meta.custom,'kept');assert.deepEqual(models[0].access_control,{read:{group_ids:['team']}});
 assert.deepEqual(result.contextCompaction.alwaysLoaded,['find','result_read','tool_search','tool_describe','tool_execute','code','context_status','context_compact'],'32K windows defer specialized schemas too');
 assert.match(settings['chat.context_compaction.prompt_template'],/actions already sent/);assert.equal(contextTool.meta.dtContextTools,true);assert.ok(contextTool.access_grants.some(g=>g.principal_id==='source-owner'));assert.ok(result.toolIds.includes('dt_chat_context'));
 assert.equal(result.contextCompaction.summaryModel,'','different chat models must not send history to another model by default');const helper=presets.get(result.contextCompaction.preparedSummaryModel);assert.equal(helper.base_model_id,'wide');assert.deepEqual(helper.meta.toolIds,[]);assert.equal(helper.meta.capabilities.function_calling,false);assert.doesNotMatch(helper.params.system,/pg_query/);assert.deepEqual(helper.access_control,models[0].access_control);
 assert.deepEqual(helper.access_grants,[{principal_type:'group',principal_id:'team',permission:'read'},{principal_type:'user',principal_id:'source-owner',permission:'read'}]);assert.deepEqual(models[0].access_grants,[{principal_type:'group',principal_id:'team',permission:'read'}]);
});
test('repeat setup raises stale thresholds, applies explicit thresholds, and keeps unrelated model parameters',async()=>{
 const config=require('../lib/config'),file=path.join(home,'config.json'),original=fs.readFileSync(file,'utf8');
 try{
  previousThreshold=2000;
  const result=await W.setup({base,key:'fixture-admin',model:'small',log:()=>{}});
  assert.equal(models.at(-1).params.compact_token_threshold,24576);assert.equal(result.contextCompaction.thresholds[0].compactAt,24576);
  const wide=await W.setup({base,key:'fixture-admin',model:'wide',log:()=>{}});assert.ok(wide.contextCompaction.alwaysLoaded.includes('pg_query'),'larger windows can retain the everyday set');
  fs.writeFileSync(file,JSON.stringify({envs:{dev:{}},llm:{compactAt:12000,compactionMode:'auto'}}));config.reload();previousThreshold=24576;
  await W.setup({base,key:'fixture-admin',model:'small',log:()=>{}});
  assert.equal(models.at(-1).params.compact_token_threshold,12000);assert.equal(models.at(-1).params.temperature,0.2);
 }finally{previousThreshold=undefined;fs.writeFileSync(file,original);config.reload();}
});
test('manual mode keeps Compact available, removes stale automatic triggers, and can switch back to auto',async()=>{
 const config=require('../lib/config'),file=path.join(home,'config.json'),original=fs.readFileSync(file,'utf8');
 try{
  fs.writeFileSync(file,JSON.stringify({envs:{dev:{}}}));config.reload();previousThreshold=2000;
  const result=await W.setup({base,key:'fixture-admin',model:'qwen3.8:27b',log:()=>{}});
  assert.equal(result.contextCompaction.mode,'manual');assert.equal(result.contextCompaction.automatic,false);assert.equal(settings['chat.context_compaction.enable'],true,'native Compact action needs the feature enabled');
  assert.equal(result.contextCompaction.thresholds[0].contextWindow,262144);assert.equal(result.contextCompaction.thresholds[0].automaticThreshold,null);assert.ok(models.at(-1).params.compact_token_threshold>262144);
  assert.equal(settings['chat.context_compaction.token_cap'],models.at(-1).params.compact_token_threshold);
  assert.equal(presets.get(result.contextCompaction.preparedSummaryModel).params.max_tokens,4096);
  fs.writeFileSync(file,original);config.reload();previousThreshold=models.at(-1).params.compact_token_threshold;
  await W.setup({base,key:'fixture-admin',model:'small',log:()=>{}});assert.equal(models.at(-1).params.compact_token_threshold,24576);assert.equal(settings['chat.context_compaction.token_cap'],24576);
 }finally{previousThreshold=undefined;fs.writeFileSync(file,original);config.reload();}
});
test('a user-owned summary prompt is preserved across repeat setup',async()=>{
 custom='Keep these custom summary rules {{COMPACTED_MESSAGES}}';settings['chat.context_compaction.prompt_template']=custom;await W.setup({base,key:'fixture-admin',model:'small',log:()=>{}});assert.equal(settings['chat.context_compaction.prompt_template'],custom);assert.ok(!Object.hasOwn(imports.at(-1),'chat.context_compaction.prompt_template'));
});
test('different model access boundaries retain native per-chat summaries',async()=>{
 separate=true;const result=await W.setup({base,key:'fixture-admin',log:()=>{}});assert.equal(result.contextCompaction.summaryModel,'');assert.equal(settings['chat.context_compaction.enable'],true);separate=false;
});
test('one model selects a tool-free summary preset and keeps provider aliases',async()=>{
 const config=require('../lib/config'),file=path.join(home,'config.json'),original=fs.readFileSync(file,'utf8');fs.writeFileSync(file,JSON.stringify({envs:{dev:{}},llm:{contextWindows:{wide:8192}}}));config.reload();
 available=['wide'];alias=true;settings['chat.context_compaction.model']='';
 const result=await W.setup({base,key:'fixture-admin',model:'wide',log:()=>{}}),helper=presets.get(result.contextCompaction.summaryModel);
 assert.equal(result.contextCompaction.summaryModel,result.contextCompaction.preparedSummaryModel);assert.equal(helper.base_model_id,'provider-base');assert.ok(helper.access_grants.some(g=>g.principal_id==='source-owner'));
 assert.deepEqual(result.contextCompaction.alwaysLoaded,['find','result_read','tool_search','tool_describe','tool_execute','code','context_status','context_compact']);
 alias=false;available=['small','wide'];fs.writeFileSync(file,original);config.reload();
});
test('explicit shared-model selection is respected and access failures never become public presets',async()=>{
 const config=require('../lib/config'),settingsFile=path.join(home,'config.json'),original=fs.readFileSync(settingsFile,'utf8'),selected=[...presets.keys()][0];
 fs.writeFileSync(settingsFile,JSON.stringify({envs:{dev:{}},llm:{compactionModel:selected}}));config.reload();separate=true;
 const result=await W.setup({base,key:'fixture-admin',log:()=>{}});assert.equal(result.contextCompaction.summaryModel,selected);assert.equal(result.contextCompaction.preparedSummaryModel,undefined);
 fs.writeFileSync(settingsFile,original);config.reload();separate=false;settings['chat.context_compaction.model']='';
 denied=true;const before=imports.length;await assert.rejects(W.setup({base,key:'fixture-admin',model:'small',log:()=>{}}),/403/);assert.equal(imports.length,before);denied=false;
 collision=true;await assert.rejects(W.setup({base,key:'fixture-admin',model:'small',log:()=>{}}),/already used/);collision=false;
});
test('unsupported native compaction fails clearly; explicit unmanaged setup remains compatible',async()=>{
 broken=true;await assert.rejects(W.setup({base,key:'fixture-admin',model:'small',log:()=>{}}),/v0.12.4/);
 previousThreshold=3000;
 const count=imports.length,result=await W.setup({base,key:'fixture-admin',model:'small',contextCompaction:false,log:()=>{}});assert.equal(result.contextCompaction.managed,false);assert.equal(imports.length,count);assert.equal(models.at(-1).params.compact_token_threshold,3000);previousThreshold=undefined;
});
