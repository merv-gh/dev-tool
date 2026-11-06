// Reusable conformance checks for the reference operations. No automatic retry.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
async function run({url,token}){
 const origin=new URL(url).origin,checks=[],scope=(principalId,storyId)=>({principalId,storyId,scopeKey:crypto.createHash('sha256').update(principalId+'\0'+storyId).digest('hex').slice(0,32)});
 const invoke=async(tool,args,context,signal)=>{const requestId=crypto.randomUUID(),res=await fetch(origin+'/execute',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({protocol:'dt.tool/v1',requestId,tool,arguments:args,context}),signal,redirect:'error'});assert.equal(res.status,200);const body=await res.json();require('../lib/schema').assert(body,require('../contracts/v1/tool-response.schema.json'));assert.equal(body.requestId,requestId);assert.equal(body.tool,tool);return body;};
 assert.equal((await fetch(origin+'/capabilities')).status,401);checks.push('service authentication required');
 const manifest=await fetch(origin+'/capabilities',{headers:{authorization:'Bearer '+token}}).then(r=>r.json());require('../lib/adapter-capabilities').validate(manifest);assert.equal(manifest.scopeAware,true);checks.push('versioned bounded capability manifest');
 const a=scope('a','task'),b=scope('b','task'),other=scope('a','other');assert.ok((await invoke('find',{q:'refund'},a)).result.length);checks.push('valid envelope and result identity');
 await invoke('fixture_put',{name:'x',value:'private'},a);assert.equal((await invoke('fixture_get',{name:'x'},a)).result.value,'private');for(const owner of [b,other])assert.equal((await invoke('fixture_get',{name:'x'},owner)).error.code,'NOT_FOUND');checks.push('principal and story isolation');
 assert.equal((await invoke('find',{}, {...a,scopeKey:b.scopeKey})).error.code,'DT_SCOPE_INVALID');checks.push('forged scope rejected');
 assert.equal((await invoke('unsupported_operation',{},a)).error.code,'UNSUPPORTED_OPERATION');checks.push('unsupported operations are explicit gaps');
 const c=new AbortController(),pending=invoke('fixture_delay',{},a,c.signal);setTimeout(()=>c.abort(),20);await assert.rejects(pending,{name:'AbortError'});checks.push('disconnect and cancellation without retry');
 return {protocol:'dt.adapter-conformance/v1',passed:checks.length,checks,limits:['Reference-operation conformance is not proof of a different adapter implementation or semantic language support.']};
}
module.exports={run};if(require.main===module)run({url:process.argv[2],token:process.env.DT_ADAPTER_TOKEN}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
