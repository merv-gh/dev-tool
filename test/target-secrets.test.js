const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-target-privacy-')),secret='target-private-<sentinel>&"19384',baseSecret='base-private-sentinel-28174';
process.env.DT_HOME=home;process.env.DT_LOG='quiet';process.env.DT_RATE_PER_SEC='0';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR','DT_BUILD_DIR','DT_RUNNER_URL','DT_TOOLS'])delete process.env[k];
fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},tests:{waitMs:5000,timeoutMs:3000,compileCheck:false,env:{BASE_SECRET:baseSecret},targets:{private:{reviewed:true,kind:'local',env:{TARGET_SECRET:secret,EMPTY_VALUE:''}},userinfo:{reviewed:true,kind:'local',runnerUrl:`http://user:${secret}@127.0.0.1:9`}},differentialProfiles:{private:{reviewed:true,kind:'node-module',module:'src/value.cjs',export:'run'}}}}));
const U=require('../lib/util'),W=require('../lib/workspace'),T=require('../lib/tools');
function workspace(id,files){const root=path.join(home,'work',id);for(const[p,s]of Object.entries(files)){const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);}U.writeJson(path.join(home,'cache','work',id+'.json'),{id,path:root,project:'T',repo:id,sha:'one',createdAt:new Date().toISOString(),dirty:true});return root;}
function forbidden(value){const s=typeof value==='string'?value:JSON.stringify(value);assert.ok(!s.includes(secret),'selected target secret escaped');assert.ok(!s.includes(baseSecret),'base config secret escaped');}
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('selected target credentials never reach test messages, names, views, history, logs or saved reports',async()=>{
 const root=workspace('private',{'test/secrets.test.cjs':`const t=require('node:test');t('failure '+process.env.TARGET_SECRET,()=>{console.log(process.env.BASE_SECRET);require('node:assert/strict').fail('message '+process.env.TARGET_SECRET)});`});
 const r=await T.call('test_run',{workspace:'private',tests:['test/secrets.test.cjs'],target:'private'});assert.equal(r.outcome,'failed');forbidden(r);forbidden(require('../lib/results').load(r.view.split('/').pop()));
 for(const f of ['cache/_jobs.json','cache/_calls.jsonl','cache/logs/dt.log','cache/work/private.runs.json'])if(fs.existsSync(path.join(home,f)))forbidden(fs.readFileSync(path.join(home,f),'utf8'));
 for(const f of fs.readdirSync(path.join(root,'.dt','node-reports')))if(f.endsWith('.xml')||f.endsWith('.json')||f.endsWith('.jsonl'))forbidden(fs.readFileSync(path.join(root,'.dt','node-reports',f),'utf8'));
});
test('differential observers compare raw values but only return/log masked configured credentials',async()=>{
 for(const id of ['baseline','candidate'])workspace(id,{'src/value.cjs':`exports.run=()=>{console.log(process.env.TARGET_SECRET);return {value:process.env.TARGET_SECRET,base:process.env.BASE_SECRET}}`});
 const logs=[];const r=await require('../lib/differential').check({profile:'private',baseline:'baseline',candidate:'candidate',target:'private',inputs:[{id:'one',args:[]}],log:s=>logs.push(s)});assert.equal(r.outcome,'equivalent');forbidden(logs);forbidden(r);
});
test('runner URLs reject embedded credentials before reachability/execution',()=>assert.throws(()=>require('../lib/test-targets').resolve('userinfo'),/credential|userinfo/i));
